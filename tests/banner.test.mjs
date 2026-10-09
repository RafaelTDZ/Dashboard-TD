import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Teste de regressão do card de status (#status-banner).
//
// O card ficava persistente na tela por dois motivos:
//   1. o HTML não começava com `hidden`, então ele aparecia antes de qualquer upload;
//   2. a classe `flex` do Tailwind vencia o `display: none` do atributo `hidden`,
//      então o timer de fechamento marcava `hidden = true` sem efeito visível.
//
// Aqui o app.js roda em um DOM mínimo de teste, com timers controlados, para
// verificar o comportamento real: escondido ao carregar, visível após o upload e
// escondido de novo quando o timer de fechamento dispara.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const realSetImmediate = globalThis.setImmediate;

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
  return {
    open() {
      const request = { result: {}, onsuccess: null, onerror: null, onupgradeneeded: null };
      request.result = {
        close() {},
        transaction: () => {
          const tx = { oncomplete: null, onerror: null, onabort: null };
          tx.objectStore = () => ({
            get: () => {
              const getRequest = {};
              queueMicrotask(() => getRequest.onsuccess && getRequest.onsuccess());
              return getRequest;
            },
            put: () => {
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
    records: [{ operacao: 'IMP', analista: 'Ana', mercadoria: 'Café', situacao: 'Em Andamento', valor: 100, valorMoeda: 'USD' }]
  };
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => realSetImmediate(resolve));
}

function createStateStub() {
  return {
    isValidSnapshot: () => false,
    normalizeFilters: (filters) => filters,
    defaultFilters: () => ({
      operacao: '', ano: 'LATEST', mes: 'ALL', analista: 'ALL', situacao: 'ALL',
      regDi: 'ALL', mercadoria: 'ALL', modal: 'ALL', incoterm: 'ALL'
    }),
    SNAPSHOT: {}
  };
}

function installGlobals({ document, scheduler }) {
  const saved = {};
  const overrides = {
    document,
    setTimeout: (fn, ms, ...args) => scheduler.setTimeout(fn, ms, ...args),
    clearTimeout: (id) => scheduler.clearTimeout(id),
    indexedDB: createIndexedDb(),
    XLSX: {},
    Worker: class {
      postMessage() {
        queueMicrotask(() => this.onmessage && this.onmessage({ data: { ok: true, result: parseResult() } }));
      }
      terminate() {}
    },
    UI: UI_STUB,
    ETL: ETL_STUB,
    Charts: { init: () => true, render: () => {}, setStyle: () => {} },
    DashboardState: createStateStub(),
    SupabaseStorage: undefined
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

test('card de status aparece só depois do upload e volta a se esconder', async () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const styles = readFileSync(join(root, 'assets', 'css', 'styles.css'), 'utf8');
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');

  // 1. Estado inicial: escondido no HTML, e o `hidden` vence a classe `flex` do Tailwind.
  assert.match(html, /id="status-banner"[^>]*\shidden[\s>]/);
  assert.match(styles, /#status-banner\[hidden\]\s*\{\s*display:\s*none !important;/);

  const scheduler = createScheduler();
  const { document, banner, fileInput, listeners } = createDom();
  const restore = installGlobals({ document, scheduler });
  globalThis.setTimeout = (fn, ms, ...args) => scheduler.setTimeout(fn, ms, ...args);

  try {
    new Function(app)();
    const init = listeners.get('DOMContentLoaded')[0];
    assert.equal(typeof init, 'function');
    init();
    await flush();
    scheduler.advance(0);

    // 2. Sessão restaurada / sem upload: o card continua escondido.
    assert.equal(banner.hidden, true, 'o card não pode aparecer antes de carregar um arquivo');

    // 3. Upload de arquivo: o card aparece.
    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush();
    assert.equal(banner.hidden, false, 'o card deve aparecer depois do upload');

    // 4. Fechamento automático: visível durante a contagem...
    scheduler.advance(7999);
    assert.equal(banner.hidden, false, 'o card deve permanecer visível durante a contagem');
    // ...fade-out ao atingir o prazo...
    scheduler.advance(1);
    assert.equal(banner.classList.contains('is-fading-out'), true);
    // ...e escondido de verdade quando o fade termina.
    scheduler.advance(300);
    assert.equal(banner.hidden, true, 'o card deve voltar a se esconder sozinho');
    assert.equal(banner.classList.contains('is-fading-out'), false);

    // 5. Mudança de filtro dispara refresh(): o card não pode reaparecer.
    document.getElementById('filter-operacao').dispatch('input', { target: { value: 'IMP' } });
    await flush();
    assert.equal(banner.hidden, true, 'refresh() não pode revelar o card de status');

    // 6. Um novo upload volta a mostrar o card, que se esconde de novo sozinho.
    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush();
    assert.equal(banner.hidden, false);
    scheduler.advance(8000 + 300);
    assert.equal(banner.hidden, true);

    // Deixa os encadeamentos de persistência (IndexedDB/fake) assentarem antes de
    // devolver os globais originais.
    await flush(20);
  } finally {
    restore();
  }
});

