import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Testes do payload persistido (M1) e da comparação de snapshots (B6).
//
// O que é gravado no Supabase e no cache local é uma cópia enxuta dos
// registros: sem o índice de busca derivado (_search) e sem campos vazios
// (null, '' e arrays vazios). Os dados em memória continuam completos — a
// busca depende do _search, que é recalculado ao restaurar.

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

function loadState() {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(stateSource, context, { filename: 'state.js' });
  return context.DashboardState;
}

const DashboardState = loadState();

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

const downloads = [];

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
  downloadFile: (name, content) => { downloads.push({ name, content }); }
};

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

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => realSetImmediate(resolve));
}

function makeRecords(count) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    records.push({
      operacao: 'IMP-' + (1000 + index),
      analista: 'Analista ' + index,
      mercadoria: 'Café Torrado ' + index,
      situacao: 'Em Andamento',
      origem: 'Shanghai',
      destino: 'Santos',
      incoterm: 'FOB',
      valor: 1000 + index,
      valorMoeda: 'USD',
      peso: 500,
      // Campos que prepareRecord() enche (vazios) e que não precisam ser
      // gravados: null, '' e arrays vazios.
      regDi: '',
      eta: '',
      ets: '',
      modalidade: '',
      ric: '',
      numeroDi: '',
      protocoloDi: '',
      transportadora: '',
      exportador: '',
      agente: '',
      container: '',
      comments: [],
      faturada: null,
      arquivado: null,
      atracado: null,
      sourceRowNumber: index + 2,
      // Índice derivado, como o prepareRecord() produz antes de persistir.
      _search: ('imp ' + index + ' analista cafe torrado shanghai santos fob').padEnd(220, ' ')
    });
  }
  return records;
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
    DashboardState: DashboardState,
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

async function importFile(records) {
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const indexedDB = createIndexedDb();
  const saves = [];
  downloads.length = 0;
  const supabase = {
    saveSnapshot: (snapshot) => { saves.push(snapshot); return Promise.resolve(true); },
    getLatestSnapshot: () => Promise.resolve(null)
  };
  const worker = class {
    postMessage() {
      queueMicrotask(() => this.onmessage && this.onmessage({
        data: {
          ok: true,
          result: {
            error: null,
            sheetName: '!Importações',
            headerRowNumber: 1,
            totalRows: records.length,
            ignoredRows: 0,
            commentCount: 0,
            currencyCounts: {},
            mapping: { mapped: [], unmapped: [] },
            records
          }
        }
      }));
    }
    terminate() {}
  };
  const restore = installGlobals({ document, scheduler, indexedDB, supabase, worker });
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
  return { document, saves, indexedDB, scheduler, restore };
}

function isEmptyValue(value) {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && !value.length;
}

test('o payload enviado ao Supabase não carrega _search nem campos vazios', async () => {
  const records = makeRecords(40);
  const { saves, restore } = await importFile(records);
  try {
    assert.equal(saves.length, 1, 'a importação grava exatamente um snapshot no Supabase');
    const payload = saves[0];
    assert.equal(payload.records.length, records.length);
    for (const record of payload.records) {
      assert.equal(Object.prototype.hasOwnProperty.call(record, '_search'), false, 'o índice derivado não pode ir ao banco');
      for (const [key, value] of Object.entries(record)) {
        assert.equal(isEmptyValue(value), false, `o campo "${key}" está vazio no payload`);
      }
      assert.ok(record.operacao, 'os campos operacionais continuam no payload');
      assert.ok(record.mercadoria, 'a mercadoria continua no payload');
    }
  } finally {
    restore();
  }
});

test('o payload persistido é menor que o registro em memória', async () => {
  const records = makeRecords(200);
  const rawSize = JSON.stringify(records).length;
  const { saves, restore } = await importFile(records);
  try {
    const payloadSize = JSON.stringify(saves[0].records).length;
    assert.ok(payloadSize < rawSize, 'o payload enxuto precisa ser menor');
    assert.ok(
      payloadSize < rawSize * 0.75,
      `o payload deveria cair bastante (${payloadSize} de ${rawSize} bytes)`
    );
  } finally {
    restore();
  }
});

test('os dados em memória continuam com o índice de busca', async () => {
  const records = makeRecords(3);
  const { document, restore } = await importFile(records);
  try {
    const input = document.getElementById('table-search');
    input.value = 'cafe torrado';
    input.dispatch('input', { target: input });
    const html = document.getElementById('table-body').innerHTML;
    assert.equal((html.match(/<tr class=/g) || []).length, 3, 'a busca funciona depois de importar');
  } finally {
    restore();
  }
});

test('a comparação ignora _search, sourceRowNumber e campos vazios', () => {
  // A linha que ainda está no banco foi gravada no formato antigo: tem o
  // índice derivado, a linha de origem e os campos vazios.
  const oldRow = {
    operacao: 'IMP-1', valor: 10, _search: 'índice antigo', sourceRowNumber: 2,
    comments: [], regDi: '', faturada: null, modalidade: ''
  };
  // O registro novo é gravado no formato enxuto (M1): sem índice e sem campos
  // vazios. Os dois precisam ser reconhecidos como o mesmo processo.
  const newRecord = { operacao: 'IMP-1', valor: 10 };

  const same = DashboardState.compareRecords([oldRow], [newRecord]);
  assert.equal(same.comparable, true);
  assert.equal(same.unchangedCount, 1, 'a linha antiga do banco não pode virar "atualizada"');
  assert.equal(same.updatedCount, 0);

  const changed = DashboardState.compareRecords([oldRow], [Object.assign({}, newRecord, { valor: 99 })]);
  assert.equal(changed.updatedCount, 1, 'uma mudança real continua sendo detectada');
  assert.equal(changed.unchangedCount, 0);
});

test('CSV: números negativos saem como número e textos continuam protegidos', async () => {
  const records = [{
    operacao: 'IMP-1',
    analista: 'Ana Souza',
    mercadoria: 'Café Torrado',
    situacao: 'Em Andamento',
    valor: -1234.56,
    valorMoeda: 'USD',
    exportador: '=SUM(A1:A9)',
    origem: 'Shanghai',
    destino: 'Santos',
    freeTime: 3,
    diasDevCntr: 2,
    diasDemurrage: 1
  }];
  const { document, restore } = await importFile(records);
  try {
    document.getElementById('btn-export-csv').dispatch('click', {});
    assert.equal(downloads.length, 1, 'o clique no botão exporta o CSV');
    const lines = downloads[0].content.split('\r\n');
    const header = lines[0];
    const row = lines[1];
    const columns = header.split(';');
    const valueIndex = columns.indexOf('Valor informado');
    const exportadorIndex = columns.indexOf('Exportador');
    const freeTimeIndex = columns.indexOf('Free time');

    assert.ok(valueIndex > -1 && exportadorIndex > -1 && freeTimeIndex > -1, 'o cabeçalho do CSV mudou');

    const values = row.split(';');
    assert.equal(values[valueIndex], '-1234,56', 'valor negativo precisa sair como número, não como texto');
    assert.ok(!values[valueIndex].includes("'"), 'o prefixo de texto não pode virar número negativo em texto');
    assert.equal(values[freeTimeIndex], '3', 'campo numérico sai sem aspas');
    assert.ok(values[exportadorIndex].startsWith('"\'='), 'texto que começa com = continua protegido contra fórmula');
  } finally {
    restore();
  }
});
