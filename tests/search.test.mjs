import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Testes da busca e do filtro de operação insensíveis a acentos (A3) e do
// momento em que o índice de busca (_search) é calculado (B1).
//
// O app.js roda em um DOM mínimo de teste (mesma estrutura do banner.test.mjs)
// com o DashboardState real, para que o snapshot restaurado passe pela
// validação de verdade e o fluxo de importação seja exercitado de ponta a
// ponta.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const realSetImmediate = globalThis.setImmediate;

const appSource = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
const tableSource = readFileSync(join(root, 'assets', 'js', 'table.js'), 'utf8');
const bannerSource = readFileSync(join(root, 'assets', 'js', 'banner.js'), 'utf8');
const persistenceSource = readFileSync(join(root, 'assets', 'js', 'persistence.js'), 'utf8');
const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');

// table.js, banner.js, persistence.js e import.js são carregados antes de
// app.js no index.html; aqui fazemos o mesmo para que o app encontre os
// módulos ao ser avaliado.
new Function(tableSource)();
new Function(bannerSource)();
new Function(persistenceSource)();
new Function(importSource)();

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
    this._innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.files = null;
  }

  // O app.js monta os <select> com innerHTML e depois lê `select.options`
  // (para saber quais anos/analistas existem). O DOM de teste precisa
  // reproduzir essa leitura, senão o filtro de ano cai sempre para "ALL".
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) { this._innerHTML = String(value); }
  get options() {
    return [...this.innerHTML.matchAll(/<option value="([^"]*)"/g)].map((match) => ({ value: match[1] }));
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

const UI_STUB = {
  toast: () => {},
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

// A canonicalização é o que acontece depois de prepareRecord(): aqui ela
// muda o valor da mercadoria, o que deixa visível se o índice de busca foi
// refeito depois (B1).
let canonicalizeHook = null;

const ETL_STUB = {
  PARSER_VERSION: 99,
  monthName: (month) => 'Mês ' + month,
  normalizeCurrency: (value, fallback) => value || fallback,
  classifyModal: () => 'FCL',
  extractOperationAcronym: () => 'IMP',
  parseExcelDate: () => null,
  parseWorkbook: () => ({ records: [], mapping: { mapped: [], unmapped: [] } }),
  canonicalizeField: (records, field) => { if (canonicalizeHook) canonicalizeHook(records, field); },
  canonicalizeAgents: () => {},
  isConcluida: () => false,
  isCancelada: () => false,
  isDiRegistered: () => false,
  isFaturada: () => false,
  isArquivado: () => false
};

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => realSetImmediate(resolve));
}

function makeRecords() {
  // Ano corrente: o filtro de ano padrão é o ano corrente (B9) e precisa
  // enxergar estes registros.
  const year = new Date().getFullYear();
  return [
    {
      operacao: 'BRP018', analista: 'Ana Souza', mercadoria: 'Ácido Fosfórico', situacao: 'Em Andamento',
      valor: 1000, valorMoeda: 'USD', origem: 'Shanghai', destino: 'Santos',
      monthlyReference: { source: 'ETA', year, month: 3 }
    },
    {
      operacao: 'BRP019', analista: 'Bruno Lima', mercadoria: 'Soja em Grãos', situacao: 'Em Andamento',
      valor: 2000, valorMoeda: 'USD', origem: 'Ningbo', destino: 'Paranaguá',
      monthlyReference: { source: 'ETA', year, month: 4 }
    },
    {
      operacao: 'BRP020', analista: 'Carla Dias', mercadoria: 'Café Torrado', situacao: 'Concluída',
      valor: 3000, valorMoeda: 'USD', origem: 'Santos', destino: 'Hamburg',
      monthlyReference: { source: 'ETA', year, month: 5 }
    }
  ];
}

function makeSnapshot(records) {
  return {
    version: 1,
    records,
    meta: {
      name: 'Importações.xlsx',
      sheetName: '!Importações',
      headerRow: 1,
      rowCount: records.length,
      ignoredRows: 0,
      commentCount: 0,
      parserVersion: 99,
      loadedAt: '2026-10-15T12:00:00.000Z'
    }
  };
}

function installGlobals(options) {
  const saved = {};
  const overrides = {
    document: options.document,
    setTimeout: (fn, ms, ...args) => options.scheduler.setTimeout(fn, ms, ...args),
    clearTimeout: (id) => options.scheduler.clearTimeout(id),
    indexedDB: options.indexedDB,
    XLSX: {},
    Worker: options.worker,
    UI: UI_STUB,
    ETL: ETL_STUB,
    Charts: { init: () => true, render: () => {}, setStyle: () => {} },
    DashboardState: options.dashboardState,
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

function rowCount(document) {
  // Só as linhas de dados (a mensagem de "nenhum registro" também usa <tr>).
  const html = document.getElementById('table-body').innerHTML;
  return (html.match(/<tr class=/g) || []).length;
}

function search(document, term) {
  const input = document.getElementById('table-search');
  input.value = term;
  input.dispatch('input', { target: input });
}

function filterOperacao(document, term) {
  const input = document.getElementById('filter-operacao');
  input.value = term;
  input.dispatch('input', { target: input });
}

async function boot(options = {}) {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const dashboardState = options.dashboardState || loadState();
  const remoteSnapshot = options.remoteSnapshot === undefined ? makeSnapshot(makeRecords()) : options.remoteSnapshot;
  const supabase = options.supabase || {
    saveSnapshot: () => Promise.resolve(true),
    getLatestSnapshot: () => Promise.resolve(remoteSnapshot)
  };
  const worker = options.worker || class {
    postMessage() {
      queueMicrotask(() => this.onmessage && this.onmessage({ data: { ok: true, result: { error: null } } }));
    }
    terminate() {}
  };
  const restore = installGlobals({ document, scheduler, indexedDB, supabase, worker, dashboardState });
  new Function(appSource)();
  const init = listeners.get('DOMContentLoaded')[0];
  assert.equal(typeof init, 'function');
  init();
  await flush();
  scheduler.advance(0);
  await flush();
  return { document, fileInput, scheduler, restore, indexedDB };
}

function loadState() {
  // O state.js publica o DashboardState no global do contexto; um vm próprio
  // evita contaminar o global do teste.
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(stateSource, context, { filename: 'state.js' });
  return context.DashboardState;
}

test('busca sem acento encontra os mesmos registros que a busca com acento', async () => {
  canonicalizeHook = null;
  const { document, scheduler, restore } = await boot();
  try {
    assert.equal(rowCount(document), 3, 'sem filtro, os três registros aparecem');

    search(document, 'ácido fosfórico');
    assert.equal(rowCount(document), 1, 'a busca com acento encontra o registro');
    assert.match(document.getElementById('table-body').innerHTML, /Ácido Fosfórico/, 'o texto exibido mantém o acento');

    search(document, 'acido fosforico');
    assert.equal(rowCount(document), 1, 'a busca sem acento encontra o mesmo registro');

    search(document, 'ACIDO FOSFORICO');
    assert.equal(rowCount(document), 1, 'a busca sem acento ignora a caixa');

    search(document, 'fosfor');
    assert.equal(rowCount(document), 1, 'a busca parcial sem acento funciona');

    search(document, 'acido');
    assert.equal(rowCount(document), 1, 'a busca parcial funciona');

    search(document, 'inexistente');
    assert.equal(rowCount(document), 0, 'uma busca sem resultado não mostra linhas');

    scheduler.advance(600);
    await flush();
  } finally {
    restore();
  }
});

test('filtro de operação ignora caixa e acentos', async () => {
  canonicalizeHook = null;
  const { document, scheduler, restore } = await boot();
  try {
    filterOperacao(document, 'brp018');
    assert.equal(rowCount(document), 1, 'o filtro encontra a operação em minúsculas');

    filterOperacao(document, 'BRP');
    assert.equal(rowCount(document), 3, 'o filtro aceita parte do código');

    filterOperacao(document, 'brp0');
    assert.equal(rowCount(document), 3, 'o filtro aceita prefixo parcial');

    filterOperacao(document, '');
    assert.equal(rowCount(document), 3, 'limpar o filtro traz tudo de volta');

    scheduler.advance(600);
    await flush();
  } finally {
    restore();
  }
});

test('índice de busca é recalculado depois da canonicalização', async () => {
  canonicalizeHook = (records, field) => {
    if (field !== 'mercadoria') return;
    records.forEach((record) => {
      if (record.mercadoria) record.mercadoria = record.mercadoria + ' CANONIZADO';
    });
  };
  const { document, scheduler, restore } = await boot();
  try {
    search(document, 'canonizado');
    assert.equal(rowCount(document), 3, 'a busca usa os valores já canonicalizados');

    search(document, 'acido fosforico canonizado');
    assert.equal(rowCount(document), 1, 'a busca normalizada cobre o valor canonicalizado');

    scheduler.advance(600);
    await flush();
  } finally {
    canonicalizeHook = null;
    restore();
  }
});

test('importação também recalcula o índice depois da canonicalização', async () => {
  canonicalizeHook = (records, field) => {
    if (field !== 'mercadoria') return;
    records.forEach((record) => {
      if (record.mercadoria) record.mercadoria = record.mercadoria + ' CANONIZADO';
    });
  };
  const imported = makeRecords();
  const worker = class {
    postMessage() {
      queueMicrotask(() => this.onmessage && this.onmessage({
        data: {
          ok: true,
          result: {
            error: null,
            sheetName: '!Importações',
            headerRowNumber: 1,
            totalRows: imported.length,
            ignoredRows: 0,
            commentCount: 0,
            currencyCounts: {},
            mapping: { mapped: [], unmapped: [] },
            records: imported
          }
        }
      }));
    }
    terminate() {}
  };
  const { document, fileInput, scheduler, restore } = await boot({
    worker,
    remoteSnapshot: null,
    supabase: {
      saveSnapshot: () => Promise.resolve(true),
      getLatestSnapshot: () => Promise.resolve(null)
    }
  });
  try {
    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(20);
    scheduler.advance(600);
    await flush(20);

    assert.equal(rowCount(document), 3, 'o arquivo importado está na tabela');
    search(document, 'canonizado');
    assert.equal(rowCount(document), 3, 'a busca usa o valor canonicalizado do arquivo importado');
    search(document, 'cafe torrado canonizado');
    assert.equal(rowCount(document), 1, 'a busca sem acento acha o café canonicalizado');
  } finally {
    canonicalizeHook = null;
    restore();
  }
});

// Registros com a referência mensal no ano corrente: o filtro de ano padrão
// (B9) esconde o que é de outro ano.
test('filtro de operação sem acento encontra a operação acentuada', async () => {
  canonicalizeHook = null;
  const year = new Date().getFullYear();
  const records = [
    {
      operacao: 'AÇÃO-9', analista: 'Ana Souza', mercadoria: 'Café Torrado', situacao: 'Em Andamento',
      valor: 1000, valorMoeda: 'USD', origem: 'Shanghai', destino: 'Santos',
      monthlyReference: { source: 'ETA', year, month: 3 }
    },
    {
      operacao: 'BRP019', analista: 'Bruno Lima', mercadoria: 'Soja em Grãos', situacao: 'Em Andamento',
      valor: 2000, valorMoeda: 'USD', origem: 'Ningbo', destino: 'Paranaguá',
      monthlyReference: { source: 'ETA', year, month: 4 }
    }
  ];
  const { document, scheduler, restore } = await boot({ remoteSnapshot: makeSnapshot(records) });
  try {
    filterOperacao(document, 'acao');
    assert.equal(rowCount(document), 1, 'o filtro sem acento encontra a operação acentuada');

    filterOperacao(document, 'AÇÃO');
    assert.equal(rowCount(document), 1, 'o filtro com acento continua funcionando');

    filterOperacao(document, 'acao-9');
    assert.equal(rowCount(document), 1, 'o filtro sem acento funciona no código inteiro');

    filterOperacao(document, 'acao-0');
    assert.equal(rowCount(document), 0, 'o filtro continua filtrando de verdade');

    scheduler.advance(600);
    await flush();
  } finally {
    restore();
  }
});

test('a tabela mostra o total do dataset além do total filtrado (B9/F9)', async () => {
  canonicalizeHook = null;
  const year = new Date().getFullYear();
  const records = makeRecords();
  records.push({
    operacao: 'BRP-ANTIGO', analista: 'Dona Antiga', mercadoria: 'Café Antigo', situacao: 'Concluída',
    valor: 100, valorMoeda: 'USD', origem: 'Ningbo', destino: 'Santos',
    monthlyReference: { source: 'ETA', year: year - 1, month: 3 }
  });
  const { document, scheduler, restore } = await boot({ remoteSnapshot: makeSnapshot(records) });
  try {
    assert.equal(rowCount(document), 3, 'o filtro de ano padrão esconde o registro de outro ano');
    const counter = document.getElementById('table-count');
    assert.match(counter.innerText, /Exibindo 1–3 de 3 filtrados \(4 no total\)/, counter.innerText);
    assert.match(counter.title, /3 filtrados de 4 registros no dataset/, counter.title);

    // O resumo persistente do cabeçalho e o hint do KPI mostram o mesmo
    // recorte sem precisar trocar de aba (F9).
    const summary = document.getElementById('dataset-summary');
    assert.match(summary.innerText, /Importações\.xlsx/, summary.innerText);
    assert.match(summary.innerText, /3 de 4 processos/, summary.innerText);
    assert.match(summary.title, /Importações\.xlsx/, summary.title);
    assert.match(summary.title, /3 filtrados de 4 processos/, summary.title);
    assert.match(summary.title, /Última leitura:/, summary.title);

    const hint = document.getElementById('kpi-processos-hint');
    assert.match(hint.innerText, /3 de 4/, hint.innerText);
    assert.match(hint.innerText, new RegExp(String(year)), hint.innerText);

    // Sem filtro de ano o recorte passa a ser o dataset inteiro.
    const yearSelect = document.getElementById('monthly-year');
    yearSelect.value = 'ALL';
    yearSelect.dispatch('change', { target: yearSelect });

    assert.equal(rowCount(document), 4, 'o filtro "Todos os anos" mostra o dataset inteiro');
    assert.match(document.getElementById('table-count').innerText, /Exibindo 1–4 de 4 registros/);
    assert.match(document.getElementById('dataset-summary').innerText, /4 processos/);
    assert.equal(hint.innerText, '4 registros no dataset');

    scheduler.advance(600);
    await flush();
  } finally {
    restore();
  }
});
