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
const tableSource = readFileSync(join(root, 'assets', 'js', 'table.js'), 'utf8');

// Usa o DashboardState real (validação de snapshots) em vez de um stub.
new Function(stateSource)();
// table.js é carregado antes de app.js no index.html; aqui fazemos o mesmo
// para que o app encontre global.DashboardTable ao ser avaliado.
new Function(tableSource)();

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

function createUiStub(toasts, modals) {
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
    openModal: (options) => { if (modals) modals.push(options); },
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

function makeSnapshotWithRecords(name, loadedAt, records) {
  const snapshot = makeSnapshot(name, loadedAt);
  snapshot.records = records;
  snapshot.meta.rowCount = records.length;
  return snapshot;
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

test('importação é bloqueada quando o arquivo novo não contém todos os processos do banco', async () => {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  indexedDB.store.set(SNAPSHOT_KEY, makeSnapshot('CACHE.xlsx', '2026-10-15T12:00:00.000Z'));
  const remote = makeSnapshotWithRecords('REMOTO.xlsx', '2026-10-16T12:00:00.000Z', [
    { operacao: 'IMP', analista: 'Ana', valor: 100 },
    { operacao: 'IMP-2', analista: 'Ana', valor: 200 },
    { operacao: 'IMP-ANTIGO', analista: 'Ana', valor: 300 }
  ]);
  const spy = createSupabaseSpy(remote);
  const toasts = [];
  const modals = [];
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts, modals), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(30);
    scheduler.advance(600);
    await flush(30);

    assert.equal(spy.saves.length, 0, 'arquivo incompleto não pode ser enviado ao Supabase');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'REMOTO.xlsx', 'o cache local deve continuar com o snapshot válido');
    const blocked = modals.find((entry) => entry.title === 'Importação bloqueada');
    assert.ok(blocked, 'deve abrir o modal de importação bloqueada');
    assert.match(blocked.html, /IMP-ANTIGO/, 'o modal deve listar o processo ausente');
    assert.ok(toasts.some((entry) => entry.type === 'error' && /não foi importado/.test(entry.message)), 'deve avisar que nada foi importado');

    await flush(20);
  } finally {
    restore();
  }
});

test('recusa do banco não grava o snapshot recusado no cache local e restaura o anterior', async () => {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  indexedDB.store.set(SNAPSHOT_KEY, makeSnapshot('CACHE.xlsx', '2026-10-15T12:00:00.000Z'));
  const remote = makeSnapshot('REMOTO.xlsx', '2026-10-16T12:00:00.000Z');
  const spy = { saves: [], storage: null };
  spy.storage = {
    saveSnapshot: (snapshot) => {
      spy.saves.push(snapshot);
      const error = new Error('Supabase retornou 400: SNAPSHOT_MISSING_RECORDS: 1 processo(s) do banco não estão no arquivo novo');
      error.code = 'P0001';
      error.details = 'IMP-ANTIGO';
      return Promise.reject(error);
    },
    getLatestSnapshot: () => Promise.resolve(remote)
  };
  const toasts = [];
  const modals = [];
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts, modals), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(30);
    scheduler.advance(600);
    await flush(30);

    assert.equal(spy.saves.length, 1, 'o arquivo deve ser tentado uma vez no banco');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'REMOTO.xlsx', 'o snapshot recusado não pode substituir o cache local');
    const rejected = modals.find((entry) => entry.title === 'Importação recusada pelo banco');
    assert.ok(rejected, 'deve abrir o modal de recusa do banco');
    assert.ok(toasts.some((entry) => entry.type === 'error' && /snapshot anterior foi mantido/i.test(entry.message)), 'deve avisar que o snapshot anterior foi mantido');

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
    assert.match(
      document.getElementById('dataset-summary').innerText,
      /REMOTO-NOVO\.xlsx/,
      'o resumo persistente do cabeçalho precisa refletir o dataset restaurado'
    );

    await flush(20);
  } finally {
    restore();
  }
});

test('cache local pós-importação usa o created_at do servidor', async () => {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  const clientLoadedAt = '2030-01-01T00:00:00.000Z';
  const serverLoadedAt = '2026-10-15T10:01:00+00:00';
  const spy = {
    saves: [],
    storage: {
      saveSnapshot: (snapshot) => {
        spy.saves.push(snapshot);
        return Promise.resolve({
          version: 1,
          records: snapshot.records,
          meta: {
            name: 'Importações.xlsx',
            sheetName: 'Importações',
            rowCount: 2,
            loadedAt: serverLoadedAt,
            clientLoadedAt
          }
        });
      },
      getLatestSnapshot: () => Promise.resolve(null)
    }
  };
  const ui = createUiStub(toasts);
  // O stub padrão devolve sempre a mesma data; aqui queremos enxergar o valor
  // que a UI recebeu do estado depois do save.
  ui.formatDateTime = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toISOString();
  };
  const restore = installGlobals({ document, scheduler, indexedDB, ui, supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(30);
    scheduler.advance(600);
    await flush(30);

    assert.equal(spy.saves.length, 1, 'a importação deve gravar no Supabase');
    assert.notEqual(spy.saves[0].meta.loadedAt, serverLoadedAt, 'o payload ainda carrega o horário local do cliente');

    const stored = indexedDB.store.get(SNAPSHOT_KEY);
    assert.equal(stored.meta.loadedAt, '2026-10-15T10:01:00.000Z', 'o cache local deve usar o created_at do servidor');
    assert.equal(stored.meta.clientLoadedAt, clientLoadedAt, 'o horário do cliente fica só para diagnóstico');

    assert.equal(
      document.getElementById('last-read-header').innerText,
      'Última leitura: 2026-10-15T10:01:00.000Z',
      'o cabeçalho deve mostrar o horário do servidor'
    );
    assert.equal(
      document.getElementById('last-update-time').innerText,
      'Última leitura: 2026-10-15T10:01:00.000Z',
      'o card de status deve mostrar o horário do servidor'
    );
    assert.ok(!document.getElementById('last-update-time').innerText.includes('2030'), 'o horário futuro do cliente não pode aparecer');

    assert.ok(
      toasts.some((entry) => entry.title === 'Excel carregado' && entry.type === 'success'),
      'o snapshot devolvido pelo banco deve contar como salvo no remoto'
    );

    await flush(20);
  } finally {
    restore();
  }
});

// --- supabase.js: o salvamento usa "Prefer: return=representation" desde o F2,
// então o Supabase devolve a linha gravada com o created_at do servidor. O
// corpo vazio de um proxy antigo continua sendo aceito como sucesso.

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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
    assert.equal(stub.calls[0].options.headers.Prefer, 'return=representation', 'o save precisa pedir o created_at de volta');
    assert.match(stub.calls[0].url, /\/rest\/v1\/excel_imports$/);
  } finally {
    stub.restore();
  }
});

test('salvamento devolve o snapshot com created_at do servidor', async () => {
  const clientLoadedAt = '2030-01-01T00:00:00.000Z';
  const created_at = '2026-10-15T10:01:00+00:00';
  const row = {
    file_name: 'Importações.xlsx',
    sheet_name: '!Importações',
    records: [{ valor: 1 }],
    metadata: { loadedAt: clientLoadedAt, rowCount: 1 },
    created_at
  };
  const stub = stubFetch(() => fakeResponse({ status: 201, body: JSON.stringify([row]) }));
  try {
    new Function(supabaseSource)();
    const saved = await globalThis.SupabaseStorage.saveSnapshot({
      meta: { name: 'Importações.xlsx', sheetName: '!Importações', loadedAt: clientLoadedAt },
      records: [{ valor: 1 }]
    });
    assert.ok(saved && typeof saved === 'object', 'deve devolver o snapshot retornado pelo banco');
    assert.equal(saved.meta.name, 'Importações.xlsx');
    assert.equal(saved.meta.sheetName, '!Importações');
    assert.equal(saved.meta.loadedAt, created_at);
    assert.equal(saved.meta.clientLoadedAt, clientLoadedAt);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.version, globalThis.DashboardState.SNAPSHOT_VERSION);
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

test('erro do trigger do Supabase preserva código e detalhes para a interface', async () => {
  const stub = stubFetch(() => fakeResponse({
    ok: false,
    status: 400,
    body: JSON.stringify({
      code: 'P0001',
      message: 'SNAPSHOT_MISSING_RECORDS: 2 processo(s) do banco não estão no arquivo novo',
      details: 'IMP-1, IMP-2'
    })
  }));
  try {
    new Function(supabaseSource)();
    await assert.rejects(
      () => globalThis.SupabaseStorage.saveSnapshot({ meta: { name: 'x.xlsx', sheetName: 'S' }, records: [{}] }),
      (error) => {
        assert.match(error.message, /SNAPSHOT_MISSING_RECORDS/);
        assert.equal(error.code, 'P0001');
        assert.equal(error.details, 'IMP-1, IMP-2');
        return true;
      }
    );
  } finally {
    stub.restore();
  }
});

test('leitura do último snapshot usa created_at do servidor', async () => {
  const clientLoadedAt = '2030-01-01T00:00:00.000Z';
  const row = {
    file_name: 'Importações.xlsx',
    sheet_name: '!Importações',
    records: [{ valor: 10 }],
    metadata: { loadedAt: clientLoadedAt, rowCount: 1 },
    created_at: '2026-10-15T10:01:00+00:00'
  };
  const stub = stubFetch(() => fakeResponse({ status: 200, body: JSON.stringify([row]) }));
  try {
    new Function(supabaseSource)();
    const snapshot = await globalThis.SupabaseStorage.getLatestSnapshot();
    assert.ok(snapshot, 'deve retornar um snapshot');
    assert.equal(snapshot.meta.name, 'Importações.xlsx');
    assert.equal(snapshot.meta.sheetName, '!Importações');
    assert.equal(snapshot.meta.loadedAt, '2026-10-15T10:01:00+00:00', 'a ordenação deve usar o relógio do servidor');
    assert.equal(snapshot.meta.clientLoadedAt, clientLoadedAt, 'o horário do cliente fica apenas para diagnóstico');
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.version, globalThis.DashboardState.SNAPSHOT_VERSION);
  } finally {
    stub.restore();
  }
});

test('metadata.loadedAt futuro no remoto não vence o cache local na restauração', async () => {
  const scheduler = createScheduler();
  const { document, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  indexedDB.store.set(SNAPSHOT_KEY, makeSnapshot('CACHE-NOVO.xlsx', '2026-10-15T10:00:00.000Z'));
  const row = {
    file_name: 'REMOTO-ANTIGO.xlsx',
    sheet_name: 'Importações',
    records: makeSnapshot('x.xlsx', '2026-10-13T10:00:00.000Z').records,
    metadata: { loadedAt: '2030-01-01T00:00:00.000Z', rowCount: 1 },
    created_at: '2026-10-13T10:00:00+00:00'
  };
  const stub = stubFetch(() => fakeResponse({ status: 200, body: JSON.stringify([row]) }));
  let restoreGlobals = null;
  try {
    new Function(supabaseSource)();
    // Usa o SupabaseStorage real: getLatestSnapshot deve ignorar o loadedAt
    // futuro da metadata e comparar o created_at do servidor com o cache.
    restoreGlobals = installGlobals({
      document,
      scheduler,
      indexedDB,
      ui: createUiStub(toasts),
      supabase: globalThis.SupabaseStorage
    });
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    const restored = toasts.find((entry) => entry.message.indexOf('Último arquivo carregado restaurado:') === 0);
    assert.ok(restored, 'deve restaurar uma sessão');
    assert.match(restored.message, /CACHE-NOVO\.xlsx/, 'o remoto antigo não pode vencer por causa do loadedAt futuro');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'CACHE-NOVO.xlsx', 'o cache local deve permanecer intacto');
    assert.equal(stub.calls.length, 1, 'a restauração deve consultar o Supabase uma vez');

    await flush(20);
  } finally {
    if (restoreGlobals) restoreGlobals();
    stub.restore();
  }
});

test('getLatestSnapshot aborta após 15s e devolve erro de timeout', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = null;
  let cleared = null;
  let requestOptions = null;
  globalThis.setTimeout = (fn, ms) => { scheduled = { fn, ms, id: 42 }; return 42; };
  globalThis.clearTimeout = (id) => { cleared = id; };
  globalThis.fetch = (url, options) => {
    requestOptions = options;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };

  try {
    new Function(supabaseSource)();
    const promise = globalThis.SupabaseStorage.getLatestSnapshot();
    assert.ok(scheduled, 'o timeout precisa ser agendado');
    assert.equal(scheduled.ms, 15000, 'o fetch remoto tem 15s de prazo');
    assert.equal(requestOptions.signal.aborted, false, 'o sinal começa ativo');

    scheduled.fn(); // simula o relógio chegando aos 15s

    await assert.rejects(promise, (error) => {
      assert.match(error.message, /não respondeu em 15s/);
      assert.equal(error.code, 'TIMEOUT');
      assert.equal(error.timeout, true, 'a interface usa error.timeout para a mensagem de importação');
      return true;
    });
    assert.equal(requestOptions.signal.aborted, true, 'o AbortController precisa abortar o fetch');
    assert.equal(cleared, 42, 'o timer precisa ser limpo depois da falha');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.SupabaseStorage;
  }
});

test('cache local é pintado sem esperar o Supabase pendurado', async () => {
  const scheduler = createScheduler();
  const { document, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  const cache = makeSnapshot('CACHE-LOCAL.xlsx', '2026-10-15T10:00:00.000Z');
  indexedDB.store.set(SNAPSHOT_KEY, cache);
  const remote = createDeferred();
  const spy = {
    saves: [],
    storage: {
      saveSnapshot: () => Promise.resolve(true),
      getLatestSnapshot: () => remote.promise
    }
  };
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    // Sem scheduler.advance(15000): o remoto continua pendurado.
    await flush();

    assert.match(
      document.getElementById('dataset-summary').innerText,
      /CACHE-LOCAL\.xlsx/,
      'o cache local precisa aparecer antes de o Supabase responder'
    );
    assert.notEqual(document.getElementById('kpi-processos').innerText, '—', 'os KPIs precisam ser renderizados a partir do cache');
    assert.ok(
      !toasts.some((entry) => entry.title === 'Sessão restaurada'),
      'o toast final só pode aparecer quando a restauração termina'
    );
    assert.equal(spy.saves.length, 0, 'pintar o cache não pode gravar no Supabase');

    await flush(20);
  } finally {
    remote.resolve(null); // encerra a promessa pendente antes de restaurar os globais
    await flush(5);
    restore();
  }
});

test('remoto mais novo reconcilia a tela depois do primeiro paint do cache', async () => {
  const scheduler = createScheduler();
  const { document, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  const cache = makeSnapshot('CACHE-ANTIGO.xlsx', '2026-10-13T10:00:00.000Z');
  const remote = makeSnapshot('REMOTO-NOVO.xlsx', '2026-10-15T10:00:00.000Z');
  indexedDB.store.set(SNAPSHOT_KEY, cache);
  const deferred = createDeferred();
  const spy = {
    saves: [],
    storage: {
      saveSnapshot: () => Promise.resolve(true),
      getLatestSnapshot: () => deferred.promise
    }
  };
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts), supabase: spy.storage });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();

    assert.match(document.getElementById('dataset-summary').innerText, /CACHE-ANTIGO\.xlsx/, 'o cache é o primeiro paint');

    deferred.resolve(remote);
    await flush(20);

    assert.match(
      document.getElementById('dataset-summary').innerText,
      /REMOTO-NOVO\.xlsx/,
      'quando o remoto chega mais novo, ele reconcilia a tela'
    );
    const restored = toasts.find((entry) => entry.message.indexOf('Último arquivo carregado restaurado:') === 0);
    assert.ok(restored, 'deve restaurar uma sessão');
    assert.match(restored.message, /REMOTO-NOVO\.xlsx/, 'o toast final reflete o snapshot reconciliado');
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'REMOTO-NOVO.xlsx', 'o cache local deve ser alinhado com o remoto');
    assert.deepEqual(unhandled, [], 'a reconciliação não pode gerar unhandled rejection');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    await flush(20);
    restore();
  }
});

test('importação com banco sem resposta avisa que o arquivo ficou só no navegador', async () => {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const toasts = [];
  const spy = {
    saves: [],
    storage: {
      saveSnapshot: () => {
        const error = new Error('Supabase não respondeu em 15s.');
        error.code = 'TIMEOUT';
        error.timeout = true;
        return Promise.reject(error);
      },
      getLatestSnapshot: () => Promise.resolve(null)
    }
  };
  const restore = installGlobals({ document, scheduler, indexedDB, ui: createUiStub(toasts), supabase: spy.storage });

  try {
    new Function(appSource)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(30);
    scheduler.advance(600);
    await flush(30);

    const toast = toasts.find((entry) => entry.title === 'Excel carregado');
    assert.ok(toast, 'a importação precisa terminar com um toast');
    assert.equal(toast.type, 'warning', 'sem o banco, o aviso é de atenção');
    assert.match(toast.message, /banco não respondeu em 15s; o arquivo ficou salvo apenas neste navegador/);
    assert.equal(indexedDB.store.get(SNAPSHOT_KEY).meta.name, 'Importações.xlsx', 'o cache local continua sendo atualizado');
  } finally {
    restore();
  }
});
