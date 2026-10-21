import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

// F6 — limite de escala do snapshot.
//
// A importação recusa, antes de qualquer escrita, um arquivo cujo payload
// (a cópia enxuta que vai para o banco) passe do limite de 6 MB. O motivo
// está medido em ANALISE.md/F6: o banco aguenta 10x (2,2 s de INSERT), mas o
// transporte em 4G não (25 MB ≈ 19 s, acima do timeout de 15 s do POST).
//
// O teste também roda o teste de carga (tools/loadtest.mjs) para garantir que
// a medição continua reproduzível.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const realSetImmediate = globalThis.setImmediate;

const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
const normalizeSource = readFileSync(join(root, 'assets', 'js', 'normalize.js'), 'utf8');

function loadState() {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(stateSource, context, { filename: 'state.js' });
  return context.DashboardState;
}

const DashboardState = loadState();
// normalize.js e import.js são IIFEs que publicam globals: eles são avaliados
// no realm principal para que leiam o mesmo globalThis que o teste controla.
new Function(normalizeSource)();
new Function(importSource)();
const normalize = globalThis.DashboardNormalize.create({
  ETL: null,
  isEmptyValue: DashboardState.isEmptyValue
});
const DashboardImport = globalThis.DashboardImport;

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
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn(...due[1].args);
      }
      now = target;
    }
  };
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => realSetImmediate(resolve));
  }
}

// Registro sintético com um comentário longo: o payload persistido cresce
// sem precisar de milhares de registros.
function makeRecords(count, commentLength) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    records.push({
      operacao: 'IMP-' + (1000 + index),
      analista: 'Analista ' + index,
      mercadoria: 'Café Torrado',
      situacao: 'Em Andamento',
      origem: 'Shanghai',
      destino: 'Santos',
      incoterm: 'FOB',
      valor: 1000 + index,
      valorMoeda: 'USD',
      comments: [{ reference: 'C-' + index, text: 'x'.repeat(commentLength), author: 'A', date: '2026-01-01' }]
    });
  }
  return records;
}

async function runImport(records, options = {}) {
  const scheduler = createScheduler();
  const toasts = [];
  const modals = [];
  const saves = [];
  const state = { dataset: [], meta: {}, isDemo: false, page: 1, filters: {}, search: '' };

  const UI = {
    toast(message, type, title) { toasts.push({ message: String(message), type: type, title: title || null }); },
    openModal(payload) { modals.push(payload); },
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
      return {
        records: records,
        mapping: { mapped: [], unmapped: [] },
        totalRows: records.length,
        ignoredRows: 0,
        commentCount: 0,
        currencyCounts: {},
        sheetName: '!Importações',
        headerRowNumber: 1
      };
    }
  };

  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage() {
      queueMicrotask(() => {
        if (this.onmessage) this.onmessage({
          data: { ok: true, result: { records: records, mapping: { mapped: [], unmapped: [] }, totalRows: records.length, ignoredRows: 0, commentCount: 0, currencyCounts: {}, sheetName: '!Importações', headerRowNumber: 1 } }
        });
      });
    }
    terminate() {}
  }

  const overrides = {
    Worker: FakeWorker,
    XLSX: {},
    UI: UI,
    ETL: ETL,
    DashboardState: DashboardState,
    SupabaseStorage: {
      saveSnapshot: (snapshot) => { saves.push(snapshot); return Promise.resolve(true); },
      getLatestSnapshot: () => Promise.resolve(null)
    },
    setTimeout: (fn, ms, ...args) => scheduler.setTimeout(fn, ms, ...args),
    clearTimeout: (id) => scheduler.clearTimeout(id)
  };

  const saved = {};
  Object.entries(overrides).forEach(([key, value]) => {
    saved[key] = globalThis[key];
    globalThis[key] = value;
  });

  const input = {
    files: [{ name: 'grande.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }],
    closest: () => null,
    classList: { toggle() {} },
    value: '',
    disabled: false
  };

  const deps = {
    state: state,
    prepareRecord: (record) => record,
    toPersistedRecord: normalize.toPersistedRecord,
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
    persistNow: () => { saves.push('persistNow'); return Promise.resolve({ saved: true }); }
  };
  if (options.maxSnapshotBytes) deps.maxSnapshotBytes = options.maxSnapshotBytes;

  try {
    const api = DashboardImport.create(deps);
    api.handleFileUpload({ target: input });
    await flush(20);
  } finally {
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  }

  return { toasts: toasts, modals: modals, saves: saves, state: state };
}

test('o limite de escala de produção é 6 MB e está publicado no módulo', () => {
  assert.equal(DashboardImport.MAX_SNAPSHOT_BYTES, 6 * 1024 * 1024);
});

test('measurePayloadBytes conta bytes UTF-8 do payload enxuto', () => {
  const api = DashboardImport.create({
    state: { dataset: [] },
    prepareRecord: (record) => record,
    toPersistedRecord: normalize.toPersistedRecord,
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
    persistNow: () => Promise.resolve({ saved: true })
  });

  const records = [{ operacao: 'IMP-1', mercadoria: 'Café Torrado', vazio: '', lista: [] }];
  const expected = Buffer.byteLength(JSON.stringify([{ operacao: 'IMP-1', mercadoria: 'Café Torrado' }]), 'utf8');
  assert.equal(api.measurePayloadBytes(records), expected);
});

test('um payload acima do limite é recusado antes de gravar no banco', async () => {
  // Limite pequeno para o teste não precisar de milhares de registros.
  const { toasts, modals, saves } = await runImport(makeRecords(20, 400), { maxSnapshotBytes: 1000 });
  try {
    assert.equal(saves.length, 0, 'nada pode ser gravado no banco');
    assert.equal(modals.length, 1, 'o usuário precisa ser avisado com um modal');
    assert.match(modals[0].title, /grande demais/i);
    assert.match(modals[0].html, /grande demais|Nada foi alterado/i);
    const errorToast = toasts.find((entry) => entry.type === 'error');
    assert.ok(errorToast, 'deve haver um aviso de erro');
    assert.match(errorToast.message, /não foi importado/i);
  } finally {
    // nada a restaurar: o harness já devolveu os globals
  }
});

test('um payload dentro do limite segue o fluxo normal de importação', async () => {
  const { toasts, modals, saves } = await runImport(makeRecords(5, 10), { maxSnapshotBytes: 10 * 1024 * 1024 });
  assert.equal(modals.length, 0);
  assert.equal(saves.length, 1, 'o snapshot é gravado no banco');
  assert.equal(saves[0], 'persistNow');
  assert.ok(toasts.some((entry) => entry.title === 'Excel carregado'), 'a importação termina com sucesso');
});

test('um payload acima de 6 MB é recusado com o limite de produção', async () => {
  // 3.000 registros com comentário de 3 KB: payload persistido bem acima de 6 MB.
  const records = makeRecords(3000, 3000);
  const api = DashboardImport.create({
    state: { dataset: [] },
    prepareRecord: (record) => record,
    toPersistedRecord: normalize.toPersistedRecord,
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
    persistNow: () => Promise.resolve({ saved: true })
  });
  const bytes = api.measurePayloadBytes(records);
  assert.ok(bytes > DashboardImport.MAX_SNAPSHOT_BYTES, 'o payload do teste precisa passar de 6 MB');
});

test('o teste de carga (tools/loadtest.mjs) é reproduzível e usa o limite de produção', () => {
  const result = spawnSync(process.execPath, [join(root, 'tools', 'loadtest.mjs'), '--scale=1,5', '--json'], {
    encoding: 'utf8',
    timeout: 120000
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.limits.maxSnapshotBytes, DashboardImport.MAX_SNAPSHOT_BYTES,
    'o script de carga precisa usar o mesmo limite da produção');
  const byScale = {};
  report.results.forEach((entry) => { byScale[entry.scale] = entry; });
  assert.ok(byScale[1], 'a escala 1x precisa ser medida');
  assert.ok(byScale[5], 'a escala 5x precisa ser medida');
  assert.equal(byScale[1].dentroDoLimiteDePayload, true, '1x cabe no limite');
  assert.equal(byScale[5].dentroDoLimiteDePayload, false, '5x não cabe no limite');
  // O custo de CPU do cliente é irrelevante: o gargalo é o transporte.
  assert.ok(byScale[10] === undefined || byScale[10].buildMs < 5000);
});
