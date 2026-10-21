import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Teste dinâmico do fallback de parsing (M5). O teste estático de
// tests/hardening.test.mjs garante que a guarda `settled` existe no código;
// este arquivo garante o comportamento: quando o Worker falha, o parse na
// thread principal acontece uma única vez, só depois que a interface teve a
// chance de pintar o aviso de "Processando…", e nunca depois que a promessa
// já resolveu (timeout de 90 s).

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const realSetImmediate = globalThis.setImmediate;

const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');

function loadState() {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(stateSource, context, { filename: 'state.js' });
  return context.DashboardState;
}

const DashboardState = loadState();

// O import.js é um IIFE que publica globalThis.DashboardImport.
new Function(importSource)();

function createScheduler() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms = 0, ...args) {
      const id = ++sequence;
      timers.set(id, { at: now + ms, fn, args });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn(...due[1].args);
      }
      now = target;
    },
    get pending() { return timers.size; }
  };
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => realSetImmediate(resolve));
  }
}

function parseResult() {
  return {
    records: [{ operacao: 'IMP-1', valor: 10 }],
    mapping: { mapped: [], unmapped: [] },
    totalRows: 1,
    ignoredRows: 0,
    commentCount: 0,
    currencyCounts: {},
    sheetName: '!Importações',
    headerRowNumber: 1
  };
}

// Executa o fluxo de importação com um Worker controlado e devolve o que
// aconteceu: eventos ordenados, chamadas do parse e os avisos da interface.
async function runImport(options = {}) {
  const workerMode = options.workerMode || 'error';
  const events = [];
  const scheduler = createScheduler();
  const workers = [];
  const idleTasks = [];
  const toasts = [];
  const modals = [];
  const parseCalls = { count: 0 };

  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.terminated = false;
      workers.push(this);
    }

    postMessage() {
      const self = this;
      if (workerMode === 'error') {
        queueMicrotask(() => { if (self.onerror) self.onerror({ message: 'worker falhou' }); });
      } else if (workerMode === 'error-twice') {
        queueMicrotask(() => {
          if (self.onerror) self.onerror({ message: 'primeiro erro' });
          if (self.onerror) self.onerror({ message: 'segundo erro' });
        });
      } else if (workerMode === 'success-then-error') {
        queueMicrotask(() => {
          if (self.onmessage) self.onmessage({ data: { ok: true, result: parseResult() } });
        });
        queueMicrotask(() => { if (self.onerror) self.onerror({ message: 'erro tardio' }); });
      }
      // 'manual': o teste dispara o erro quando quiser.
    }

    terminate() { this.terminated = true; }
  }

  const UI = {
    toast(message, type, title) {
      events.push('toast');
      toasts.push({ message: String(message), type: type, title: title || null });
    },
    openModal(options2) { modals.push(options2); },
    closeModal() {},
    copyText() {},
    downloadFile() {},
    escapeHtml: (value) => String(value == null ? '' : value),
    formatNumber: (value) => String(value),
    formatCompactUSD: () => '$0',
    formatUSDFull: () => '$0',
    formatPercent: () => '0%',
    formatCurrencyFull: () => '$0',
    formatDateTime: () => ''
  };

  const ETL = {
    PARSER_VERSION: 7,
    parseWorkbook() {
      parseCalls.count += 1;
      events.push('parse');
      return parseResult();
    }
  };

  const state = {
    dataset: [],
    meta: {},
    isDemo: false,
    page: 1,
    filters: {},
    search: ''
  };

  const deps = {
    state: state,
    prepareRecord: (record) => record,
    canonicalizeDataset: () => {},
    buildSearchIndex: () => {},
    populateFilterOptions: () => {},
    resetFilters: () => {},
    refresh: () => {},
    showTransientUpdateBanner: () => {},
    buildSnapshot: () => null,
    restoreState: () => Promise.resolve(null),
    presentSnapshot: () => {},
    beginSnapshotValidation: () => {},
    endSnapshotValidation: () => {},
    persistNow: () => Promise.resolve({ saved: true, remote: true })
  };

  const overrides = {
    Worker: FakeWorker,
    XLSX: {},
    UI: UI,
    ETL: ETL,
    DashboardState: DashboardState,
    SupabaseStorage: {
      saveSnapshot: () => Promise.resolve(true),
      getLatestSnapshot: () => Promise.resolve(null)
    },
    setTimeout: (fn, ms, ...args) => scheduler.setTimeout(fn, ms, ...args),
    clearTimeout: (id) => scheduler.clearTimeout(id)
  };

  if (options.useIdle) {
    // O navegador entrega a janela ociosa; o teste dispara quando quiser.
    overrides.requestIdleCallback = (task) => { idleTasks.push(task); return idleTasks.length; };
  }

  const saved = {};
  Object.entries(overrides).forEach(([key, value]) => {
    saved[key] = globalThis[key];
    globalThis[key] = value;
  });
  const realConsoleError = console.error;
  console.error = () => {};

  const input = {
    files: [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }],
    closest: () => null,
    classList: { toggle() {} },
    value: '',
    disabled: false
  };

  try {
    const api = globalThis.DashboardImport.create(deps);
    api.handleFileUpload({ target: input });
    await flush(20);
  } catch (error) {
    console.error = realConsoleError;
    throw error;
  }

  return {
    events: events,
    toasts: toasts,
    modals: modals,
    workers: workers,
    idleTasks: idleTasks,
    parseCalls: parseCalls,
    scheduler: scheduler,
    flush: flush,
    restore() {
      console.error = realConsoleError;
      Object.entries(saved).forEach(([key, value]) => {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      });
    }
  };
}

test('M5: quando o Worker falha, o parse na thread principal é adiado e roda uma única vez', async () => {
  const run = await runImport({ workerMode: 'error' });
  try {
    assert.equal(run.workers.length, 1, 'a importação deve tentar o Worker');
    assert.equal(run.parseCalls.count, 0, 'o parse não pode começar junto com o erro do Worker');
    assert.equal(run.toasts.length, 1, 'o aviso de processamento precisa ser pintado antes do parse');
    assert.match(run.toasts[0].message, /^Processando /);

    run.scheduler.advance(0);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 1, 'o fallback precisa parsear exatamente uma vez');
    // O aviso já estava na tela quando o parse finalmente rodou.
    assert.equal(run.events[0], 'toast', 'o aviso precisa ser pintado antes do parse');
    assert.equal(run.events[1], 'parse', 'o parse só pode rodar depois do aviso');

    // Depois de resolvida a promessa, o timeout de 90 s não pode refazer o parse.
    run.scheduler.advance(90000);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 1, 'o parse não pode rodar de novo depois de resolvido');
  } finally {
    run.restore();
  }
});

test('M5: dois erros do Worker ainda resultam em um único parse', async () => {
  const run = await runImport({ workerMode: 'error-twice' });
  try {
    assert.equal(run.parseCalls.count, 0);
    run.scheduler.advance(0);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 1, 'o fallback precisa ser idempotente');
    run.scheduler.advance(90000);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 1);
  } finally {
    run.restore();
  }
});

test('M5: com o Worker respondendo bem, o fallback nunca roda', async () => {
  const run = await runImport({ workerMode: 'success-then-error' });
  try {
    run.scheduler.advance(0);
    await run.flush(20);
    run.scheduler.advance(90000);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 0, 'o parse principal não pode rodar quando o Worker respondeu');
    assert.ok(
      run.toasts.some((entry) => entry.title === 'Excel carregado'),
      'a importação precisa seguir o caminho do Worker'
    );
  } finally {
    run.restore();
  }
});

test('M5: timeout de 90 s antes de um erro tardio não provoca parse fora do prazo', async () => {
  const run = await runImport({ workerMode: 'manual' });
  try {
    assert.equal(run.parseCalls.count, 0);
    run.scheduler.advance(90000);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 0, 'o timeout resolve a promessa sem parse');
    assert.ok(
      run.toasts.some((entry) => /Tempo excedido/.test(entry.message)),
      'a interface precisa avisar que o tempo estourou'
    );

    // O Worker só avisa da falha depois do prazo: o fallback não pode rodar.
    run.workers[0].onerror({ message: 'erro tardio' });
    run.scheduler.advance(0);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 0, 'nada pode ser processado depois do timeout');
  } finally {
    run.restore();
  }
});

test('M5: com requestIdleCallback, o parse só roda quando o navegador dá a janela ociosa', async () => {
  const run = await runImport({ workerMode: 'error', useIdle: true });
  try {
    assert.equal(run.idleTasks.length, 1, 'o fallback precisa esperar a janela ociosa');
    assert.equal(run.parseCalls.count, 0, 'o parse não pode rodar antes da janela ociosa');
    assert.equal(run.toasts.length, 1, 'o aviso precisa estar pintado antes do parse');

    run.scheduler.advance(1000);
    await run.flush(20);
    assert.equal(run.parseCalls.count, 0, 'avançar o relógio não dispara o parse ocioso');

    run.idleTasks[0]();
    await run.flush(20);
    assert.equal(run.parseCalls.count, 1, 'a janela ociosa dispara exatamente um parse');
  } finally {
    run.restore();
  }
});
