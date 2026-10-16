import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Testes de regressão da persistência (Supabase x IndexedDB).
//
// Antes, QUALQUER interação de UI (filtro, busca, estilo, USD/QTD) reenviava o
// dataset inteiro ao Supabase como uma nova linha "mais recente". Uma aba antiga
// com dados velhos sobrescrevia o último arquivo importado e o dashboard
// restaurava dados errados ao recarregar. Agora:
//   1. só a importação de arquivo grava no Supabase (fonte compartilhada);
//   2. interações de UI gravam apenas no IndexedDB (cache local);
//   3. a restauração escolhe o dataset mais recente entre remoto e cache local.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const realSetImmediate = globalThis.setImmediate;

const appSource = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');

// Usa o DashboardState real (validação de snapshots) em vez de um stub.
new Function(stateSource)();

const SNAPSHOT_KEY = 'snapshot';

function createClassList() {
  const names = new Set();
  return {
    add: (...values) => values.forEach((value) => names.add(value)),
    remove: (...values) => values.forEach((value) => names.delete(value)),
    contains: (value) => names.has(value),
    toggle: (value, force) => {
      const next = force === undefined ? !names.has(value) : force;
      if (next) names.add(value);
      else names.delete(value);
      return next;
    },
    values: () => [...names]
  };
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = createClassList();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.innerText = '';
    this.innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.options = [];
    this.files = null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatch(type, event = {}) {
    (this.listeners.get(type) || []).forEach((handler) => handler(event));
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child) { this.children.unshift(child); return child; }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); }
  closest() { return null; }
  focus() {}
  remove() {}
}

function createDom() {
  const elements = new Map();
  const selectors = new Map();
  const listeners = new Map();
  const document = {
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement('div'));
      return elements.get(id);
    },
    querySelector(selector) {
      if (!selectors.has(selector)) selectors.set(selector, new FakeElement('div'));
      return selectors.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    }
  };
  const banner = document.getElementById('status-banner');
  banner.querySelector = (selector) => (selector === '#banner-text' ? document.getElementById('banner-text') : null);
  return { document, banner, fileInput: document.getElementById('excel-file-input'), listeners };
}

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
    },
    get pending() { return timers.size; }
  };
}

// IndexedDB de teste com armazenamento real em memória.
function createIndexedDb() {
  const store = new Map();
  return {
    store,
    open() {
      const request = { result: {}, onsuccess: null, onerror: null, onupgradeneeded: null };
      request.result = {
        close() {},
        transaction: () => {
          const tx = { oncomplete: null, onerror: null, onabort: null };
          tx.objectStore = () => ({
            get: (key) => {
              const getRequest = {};
              queueMicrotask(() => {
                getRequest.result = store.get(key);
                if (getRequest.onsuccess) getRequest.onsuccess();
              });
              return getRequest;
            },
            put: (value, key) => {
              store.set(key, value);
              queueMicrotask(() => tx.oncomplete && tx.oncomplete());
              return {};
            }
          });
          return tx;
        }
      };
      queueMicrotask(() => request.onsuccess && request.onsuccess());
      return request;
    }
  };
}

function createUiStub(toasts) {
  return {
    toast: (message, type, title) => toasts.push({ message, type, title }),
    debounce: (fn) => fn,
    escapeHtml: (value) => String(value == null ? '' : value),
    formatNumber: (value) => String(value),
    formatCompactUSD: () => '$0',
    formatUSDFull: () => '$0',
    formatPercent: (value) => value + '%',
    formatCurrencyFull: () => '$0',
    formatDateTime: () => '01/01/2026 às 00:00',
    openModal: () => {},
    closeModal: () => {},
    copyText: () => {},
    downloadFile: () => {}
  };
}

const ETL_STUB = {
  PARSER_VERSION: 99,
  monthName: (month) => 'Mês ' + month,
  normalizeCurrency: (value, fallback) => value || fallback,
  classifyModal: () => 'FCL',
  extractOperationAcronym: () => 'IMP',
  parseExcelDate: () => null,
  parseWorkbook: () => ({ records: [], mapping: { mapped: [], unmapped: [] } }),
  canonicalizeField: () => {},
  canonicalizeAgents: () => {},
  isConcluida: () => false,
  isCancelada: () => false,
  isDiRegistered: () => false,
  isFaturada: () => false,
  isArquivado: () => false
};

function parseResult() {
  return {
    error: null,
    sheetName: 'Importações',
    headerRowNumber: 1,
    totalRows: 1,
    ignoredRows: 0,
    commentCount: 0,
    currencyCounts: {},
    mapping: { mapped: [], unmapped: [] },
    records: [
      { operacao: 'IMP', analista: 'Ana', mercadoria: 'Café', situacao: 'Em Andamento', valor: 100, valorMoeda: 'USD', monthlyReference: { source: 'ETA', year: 2026, month: 3 } },
      { operacao: 'IMP-2', analista: 'Ana', mercadoria: 'Café', situacao: 'Em Andamento', valor: 200, valorMoeda: 'USD', monthlyReference: { source: 'ETA', year: 2026, month: 4 } }
    ]
  };
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => realSetImmediate(resolve));
}

function makeSnapshot(name, loadedAt) {
  return {
    version: 1,
    records: [{ operacao: 'IMP', analista: 'Ana', mercadoria: 'Café', situacao: 'Em Andamento', valor: 100, valorMoeda: 'USD' }],
    meta: {
      name,
      sheetName: 'Importações',
      headerRow: 1,
      rowCount: 1,
      ignoredRows: 0,
      commentCount: 0,
      parserVersion: 99,
      loadedAt
    }
  };
}

function createSupabaseSpy(remoteSnapshot) {
  const spy = {
    saves: [],
    storage: {
      saveSnapshot: (snapshot) => { spy.saves.push(snapshot); return Promise.resolve(true); },
      getLatestSnapshot: () => Promise.resolve(remoteSnapshot || null)
    }
  };
  return spy;
}

function installGlobals(options) {
  const saved = {};
  const overrides = {
    document: options.document,
    setTimeout: (fn, ms, ...args) => options.scheduler.setTimeout(fn, ms, ...args),
    clearTimeout: (id) => options.scheduler.clearTimeout(id),
    indexedDB: options.indexedDB,
    XLSX: {},
    Worker: class {
      postMessage() {
        queueMicrotask(() => this.onmessage && this.onmessage({ data: { ok: true, result: parseResult() } }));
      }
      terminate() {}
    },
    UI: options.ui,
    ETL: ETL_STUB,
    Charts: { init: () => true, render: () => {}, setStyle: () => {} },
    SupabaseStorage: options.supabase
  };
  Object.entries(overrides).forEach(([key, value]) => {
    saved[key] = globalThis[key];
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  });
  return () => {
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  };
}

test('interações de UI não reenviam o dataset ao Supabase', async () => {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  indexedDB.store.set(SNAPSHOT_KEY, makeSnapshot('base.xlsx', '2026-10-15T12:00:00.000Z'));
  const spy = createSupabaseSpy(null);
  const toasts = [];
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    assert.equal(typeof init, 'function');
    init();
    await flush();
    scheduler.advance(0);

    // Restaurar a sessão a partir do cache não grava no Supabase.
    assert.equal(spy.saves.length, 0, 'restaurar não pode gravar no Supabase');

    // Filtro: persiste só no cache local.
    const operacaoInput = document.getElementById('filter-operacao');
    operacaoInput.value = 'IMP';
    operacaoInput.dispatch('input', { target: operacaoInput });
    await flush();
    scheduler.advance(600);
    await flush();
    assert.equal(spy.saves.length, 0, 'mudar filtro não pode gravar no Supabase');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).filters.operacao, 'IMP', 'o filtro deve ir para o cache local');

    // Busca da tabela: idem.
    const searchInput = document.getElementById('table-search');
    searchInput.value = 'cafe';
    searchInput.dispatch('input', { target: searchInput });
    await flush();
    scheduler.advance(600);
    await flush();
    assert.equal(spy.saves.length, 0, 'buscar não pode gravar no Supabase');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).search, 'cafe', 'a busca deve ir para o cache local');

    // Limpar filtros: idem.
    document.getElementById('btn-reset-filters').dispatch('click', {});
    await flush();
    scheduler.advance(600);
    await flush();
    assert.equal(spy.saves.length, 0, 'limpar filtros não pode gravar no Supabase');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).filters.operacao, '', 'limpar filtros deve atualizar o cache local');

    // Importação: a única operação que grava no remoto.
    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush();
    scheduler.advance(600);
    await flush();

    assert.equal(spy.saves.length, 1, 'importar deve gravar exatamente uma vez no Supabase');
    const payload = spy.saves[0];
    assert.equal(payload.meta.name, 'Importações.xlsx');
    assert.equal(payload.records.length, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'filters'), false, 'o remoto não deve receber filtros');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'search'), false, 'o remoto não deve receber busca');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'Importações.xlsx', 'a importação também deve atualizar o cache local');

    // Depois do import, interações de UI continuam sem tocar no remoto.
    const operacaoAfter = document.getElementById('filter-operacao');
    operacaoAfter.value = 'XYZ';
    operacaoAfter.dispatch('input', { target: operacaoAfter });
    await flush();
    scheduler.advance(600);
    await flush();
    assert.equal(spy.saves.length, 1, 'interações após importar não podem reenviar o dataset');

    // Filtro de mês multi-seleção: desmarcar um mês também grava só no cache local.
    const monthList = document.getElementById('filter-mes-list');
    assert.equal(monthList.children.length, 2, 'a lista deve mostrar os meses presentes nos dados');
    const monthInput = monthList.children[0].children[0];
    assert.equal(monthInput.value, '3');
    monthInput.checked = false; // "Todos os Meses" marcado: desmarcar março deixa só abril.
    monthInput.dispatch('change', {});
    await flush();
    scheduler.advance(600);
    await flush();
    assert.deepEqual(indexedDB.store.get(SNAPSHOT_KEY).filters.mes, ['4'], 'os meses marcados devem ir para o cache local');
    assert.equal(document.getElementById('filter-mes-label').textContent, 'Mês 4', 'o botão deve resumir os meses marcados');
    assert.equal(spy.saves.length, 1, 'marcar meses não pode reenviar o dataset ao Supabase');

    // Interruptor "Todos os Meses": um clique acende tudo e o próximo apaga tudo.
    const master = document.getElementById('filter-mes-all');
    master.checked = true;
    master.dispatch('change', {});
    await flush();
    scheduler.advance(600);
    await flush();
    assert.deepEqual(indexedDB.store.get(SNAPSHOT_KEY).filters.mes, [], 'acender todos = sem filtro de mês');
    assert.equal(document.getElementById('filter-mes-label').textContent, 'Todos os Meses');
    master.checked = false;
    master.dispatch('change', {});
    await flush();
    scheduler.advance(600);
    await flush();
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).filters.mes, 'NONE', 'apagar todos = nenhum mês marcado');
    assert.equal(document.getElementById('filter-mes-label').textContent, 'Selecionar meses');
    assert.equal(spy.saves.length, 1, 'alternar o filtro de mês não pode reenviar o dataset ao Supabase');

    await flush(20);
  } finally {
    restore();
  }
});

test('cache local mais recente vence um remoto sobrescrito por dado velho', async () => {
  const scheduler = createScheduler();
  const { document, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  const remote = makeSnapshot('REMOTO-VELHO.xlsx', '2026-10-13T10:00:00.000Z');
  const cache = makeSnapshot('CACHE-NOVO.xlsx', '2026-10-15T10:00:00.000Z');
  indexedDB.store.set(SNAPSHOT_KEY, cache);
  const spy = createSupabaseSpy(remote);
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    const restored = toasts.find((entry) => entry.message.indexOf('Último arquivo carregado restaurado:') === 0);
    assert.ok(restored, 'deve restaurar uma sessão');
    assert.match(restored.message, /CACHE-NOVO\.xlsx/, 'o dataset local mais recente deve vencer o remoto velho');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'CACHE-NOVO.xlsx', 'o cache local deve permanecer intacto');
    assert.equal(spy.saves.length, 0, 'restaurar do cache não pode gravar no remoto');

    await flush(20);
  } finally {
    restore();
  }
});

test('remoto mais recente vence e alinha o cache local', async () => {
  const scheduler = createScheduler();
  const { document, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  const remote = makeSnapshot('REMOTO-NOVO.xlsx', '2026-10-15T10:00:00.000Z');
  const cache = makeSnapshot('CACHE-VELHO.xlsx', '2026-10-13T10:00:00.000Z');
  indexedDB.store.set(SNAPSHOT_KEY, cache);
  const spy = createSupabaseSpy(remote);
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    const restored = toasts.find((entry) => entry.message.indexOf('Último arquivo carregado restaurado:') === 0);
    assert.ok(restored, 'deve restaurar uma sessão');
    assert.match(restored.message, /REMOTO-NOVO\.xlsx/, 'o remoto mais recente deve vencer');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'REMOTO-NOVO.xlsx', 'o cache local deve ser alinhado com o remoto');

    await flush(20);
  } finally {
    restore();
  }
});

// --- supabase.js: o salvamento usa "Prefer: return=minimal" e o Supabase
// responde 201 sem corpo. Antes, o app tentava interpretar esse corpo como JSON,
// acusava falha ("Persistência indisponível") mesmo com o dataset já salvo e o
// usuário ficava sem saber se o banco tinha recebido o arquivo.

const supabaseSource = readFileSync(join(root, 'assets', 'js', 'supabase.js'), 'utf8');

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve(handler(url, options));
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
      delete globalThis.SupabaseStorage;
    }
  };
}

function fakeResponse(options) {
  return {
    ok: options.ok !== false,
    status: options.status,
    text: () => Promise.resolve(options.body || '')
  };
}

test('salvamento aceita resposta 201 sem corpo sem acusar falha', async () => {
  const stub = stubFetch(() => fakeResponse({ status: 201, body: '' }));
  try {
    new Function(supabaseSource)();
    const saved = await globalThis.SupabaseStorage.saveSnapshot({
      meta: { name: 'teste.xlsx', sheetName: 'Importações' },
      records: [{ valor: 1 }]
    });
    assert.equal(saved, true, 'o dataset deve ser considerado salvo mesmo com corpo vazio');
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].options.method, 'POST');
    assert.match(stub.calls[0].url, /\/rest\/v1\/excel_imports$/);
  } finally {
    stub.restore();
  }
});

test('erro HTTP do Supabase continua sendo reportado', async () => {
  const stub = stubFetch(() => fakeResponse({ ok: false, status: 401, body: '{"message":"negado"}' }));
  try {
    new Function(supabaseSource)();
    await assert.rejects(
      () => globalThis.SupabaseStorage.saveSnapshot({ meta: { name: 'x.xlsx', sheetName: 'S' }, records: [{}] }),
      /Supabase retornou 401/
    );
  } finally {
    stub.restore();
  }
});

test('leitura do último snapshot converte a linha do Supabase', async () => {
  const row = {
    file_name: 'Importações.xlsx',
    sheet_name: '!Importações',
    records: [{ valor: 10 }],
    metadata: { loadedAt: '2026-10-15T10:00:00.000Z', rowCount: 1 },
    created_at: '2026-10-15T10:01:00+00:00'
  };
  const stub = stubFetch(() => fakeResponse({ status: 200, body: JSON.stringify([row]) }));
  try {
    new Function(supabaseSource)();
    const snapshot = await globalThis.SupabaseStorage.getLatestSnapshot();
    assert.ok(snapshot, 'deve retornar um snapshot');
    assert.equal(snapshot.meta.name, 'Importações.xlsx');
    assert.equal(snapshot.meta.sheetName, '!Importações');
    assert.equal(snapshot.meta.loadedAt, '2026-10-15T10:00:00.000Z');
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.version, globalThis.DashboardState.SNAPSHOT_VERSION);
  } finally {
    stub.restore();
  }
});
