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

// normalize.js, filters.js, view.js, snapshot.js, table.js, banner.js,
// persistence.js e import.js são carregados antes de app.js no index.html;
// aqui fazemos o mesmo para que o app encontre os módulos ao ser avaliado.
const normalizeSource = readFileSync(join(root, 'assets', 'js', 'normalize.js'), 'utf8');
new Function(normalizeSource)();
const filtersSource = readFileSync(join(root, 'assets', 'js', 'filters.js'), 'utf8');
new Function(filtersSource)();
const viewSource = readFileSync(join(root, 'assets', 'js', 'view.js'), 'utf8');
new Function(viewSource)();
const snapshotSource = readFileSync(join(root, 'assets', 'js', 'snapshot.js'), 'utf8');
new Function(snapshotSource)();
const tableSource = readFileSync(join(root, 'assets', 'js', 'table.js'), 'utf8');
new Function(tableSource)();
const bannerSource = readFileSync(join(root, 'assets', 'js', 'banner.js'), 'utf8');
new Function(bannerSource)();
const persistenceSource = readFileSync(join(root, 'assets', 'js', 'persistence.js'), 'utf8');
new Function(persistenceSource)();
const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
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

function createDom(options = {}) {
  const elements = new Map();
  const selectors = new Map();
  const listeners = new Map();
  const document = {
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new FakeElement('div');
        // `breakOn` simula uma falha de vínculo: o elemento existe (a
        // estrutura está completa), mas o addEventListener estoura. É o
        // caminho que leva o app.js a mostrarStatusBannerError().
        if (options.breakOn === id) {
          element.addEventListener = () => { throw new Error('Falha simulada ao vincular a interface.'); };
        }
        elements.set(id, element);
      }
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
    records: [{ operacao: 'IMP', analista: 'Ana', mercadoria: 'Café', situacao: 'Em Andamento', valor: 100, valorMoeda: 'USD' }]
  };
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => realSetImmediate(resolve));
}

function createStateStub() {
  return {
    SNAPSHOT_VERSION: 1,
    isValidSnapshot: () => false,
    normalizeFilters: (filters) => filters,
    normalizeAnalistaMode: (mode) => (mode === 'qtd' ? 'qtd' : 'valor'),
    normalizeUiStyle: (style) => (style === 'modern' ? 'modern' : 'classic'),
    normalizeRecordKey: (value) => String(value == null ? '' : value).trim().toUpperCase(),
    compareRecords: (previous, next) => {
      const previousKeys = new Set((previous || []).map((record) => String(record.operacao).trim().toUpperCase()));
      const nextKeys = new Set((next || []).map((record) => String(record.operacao).trim().toUpperCase()));
      const removed = [...previousKeys].filter((key) => !nextKeys.has(key));
      return {
        comparable: true,
        previousValid: true,
        nextValid: true,
        previousCount: previousKeys.size,
        nextCount: nextKeys.size,
        addedCount: [...nextKeys].filter((key) => !previousKeys.has(key)).length,
        updatedCount: 0,
        removedCount: removed.length,
        unchangedCount: 0,
        removed
      };
    },
    defaultFilters: () => ({
      operacao: '', ano: 'ALL', mes: 'ALL', analista: 'ALL', situacao: 'ALL',
      regDi: 'ALL', mercadoria: 'ALL', modal: 'ALL', incoterm: 'ALL', despachante: 'ALL'
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

test('card de status: visível sem arquivo, transitório com arquivo', async () => {
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

    // 2. Sem arquivo: o card fica visível com a orientação de como começar.
    assert.equal(banner.hidden, false, 'sem arquivo o card precisa estar visível');
    assert.match(document.getElementById('banner-text').innerHTML, /Nenhum arquivo carregado/);

    // 3. Upload de arquivo: o card passa a descrever o arquivo.
    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush();
    assert.equal(banner.hidden, false, 'o card deve aparecer depois do upload');
    assert.match(document.getElementById('banner-text').innerHTML, /Importações\.xlsx/);

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

// ---------------------------------------------------------------------------
// T1 — o estado do dataset precisa ser VISÍVEL, não só "não escondido".
//
// O card de status (#status-banner) tem dois modos:
//   - sem arquivo  -> fica visível com a orientação de como começar;
//   - com arquivo  -> mostra o que foi carregado e some sozinho (transitório).
// O bug A2 existia porque o resumo era escrito num card que nascia `hidden` e
// nunca era revelado.
// ---------------------------------------------------------------------------

test('sem arquivo o card de status fica visível com a orientação de como começar', async () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const scheduler = createScheduler();
  const { document, listeners } = createDom();
  const restore = installGlobals({ document, scheduler });

  try {
    new Function(app)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    const banner = document.getElementById('status-banner');
    assert.equal(banner.hidden, false, 'o estado vazio precisa aparecer para o usuário');
    assert.equal(banner.classList.contains('is-fading-out'), false);

    const bannerText = document.getElementById('banner-text');
    assert.match(bannerText.innerHTML, /Nenhum arquivo carregado/, 'o estado vazio precisa ser observável');
    assert.match(bannerText.innerHTML, /Carregar Excel Atualizado/);
    assert.equal(document.getElementById('last-update-time').innerText, 'Aguardando arquivo');

    // Sem arquivo não há o que esconder: o card NÃO expira.
    scheduler.advance(8000 + 300);
    assert.equal(banner.hidden, false, 'o estado vazio não pode sumir sozinho');
  } finally {
    restore();
  }
});

test('depois do upload o card mostra o arquivo e some sozinho', async () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const restore = installGlobals({ document, scheduler });

  try {
    new Function(app)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    fileInput.files = [{ name: 'Importações.xlsx', arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(20);

    // O card passa a descrever o arquivo carregado.
    const bannerText = document.getElementById('banner-text');
    const banner = document.getElementById('status-banner');
    assert.match(bannerText.innerHTML, /Importações\.xlsx/);
    assert.doesNotMatch(bannerText.innerHTML, /Nenhum arquivo carregado/);
    assert.equal(banner.hidden, false);

    // E some sozinho: primeiro o fade, depois o hidden.
    scheduler.advance(7999);
    assert.equal(banner.hidden, false, 'o card deve permanecer visível durante a contagem');
    scheduler.advance(1);
    assert.equal(banner.classList.contains('is-fading-out'), true);
    scheduler.advance(300);
    assert.equal(banner.hidden, true, 'o card do resumo deve sumir sozinho');

    // O que sumiu do card continua disponível no cabeçalho e no KPI (F9).
    const summary = document.getElementById('dataset-summary');
    assert.match(summary.innerText, /Importações\.xlsx/, 'o resumo do cabeçalho precisa sobreviver ao timer');
    assert.match(summary.innerText, /processo/, 'o resumo do cabeçalho precisa manter a contagem');
    assert.notEqual(document.getElementById('kpi-processos-hint').innerText, '', 'o hint do KPI não pode ficar vazio');

    await flush(20);
  } finally {
    restore();
  }
});

test('resumo do cabeçalho cobre o estado vazio e trata o nome do arquivo como texto (F9)', async () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const scheduler = createScheduler();
  const { document, fileInput, listeners } = createDom();
  const restore = installGlobals({ document, scheduler });

  try {
    new Function(app)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    const summary = document.getElementById('dataset-summary');
    assert.equal(summary.innerText, 'Nenhum arquivo carregado');
    assert.equal(summary.title, 'Nenhum arquivo carregado');
    assert.equal(document.getElementById('kpi-processos-hint').innerText, 'Aguardando carregamento de dados');

    // O nome do arquivo é escrito como texto: um nome com marcação não vira HTML.
    const hostileName = '<img src=x onerror="alert(1)">.xlsx';
    fileInput.files = [{ name: hostileName, arrayBuffer: async () => new ArrayBuffer(8) }];
    fileInput.dispatch('change', { target: fileInput });
    await flush(20);

    assert.match(summary.innerText, /<img src=x onerror="alert\(1\)">\.xlsx/, summary.innerText);
    assert.equal(summary.innerHTML, '', 'o resumo não pode usar innerHTML');
    assert.doesNotMatch(document.getElementById('kpi-processos-hint').innerText, /^$/, 'o hint do KPI não pode ficar vazio');

    await flush(20);
  } finally {
    restore();
  }
});

test('um refresh não apaga a mensagem de erro fatal gravada no banner (B3)', async () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const scheduler = createScheduler();
  // A falha de vínculo acontece no bindEvents(): o init() cai no catch e
  // chama showStatusBannerError(), que escreve em #banner-text.
  const { document, listeners } = createDom({ breakOn: 'table-search' });
  const restore = installGlobals({ document, scheduler });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));

  try {
    new Function(app)();
    const init = listeners.get('DOMContentLoaded')[0];
    init();
    await flush();
    scheduler.advance(0);
    await flush();

    const bannerText = document.getElementById('banner-text');
    assert.match(bannerText.textContent, /Falha simulada/, 'o erro fatal precisa aparecer no banner');
    assert.equal(document.getElementById('status-banner').hidden, false, 'o erro fatal não pode ficar escondido');

    // Um refresh() (mudança do filtro de ano) não pode apagar o erro.
    const year = document.getElementById('monthly-year');
    year.value = 'ALL';
    year.dispatch('change', { target: year });
    await flush();
    assert.match(bannerText.textContent, /Falha simulada/, 'o refresh() apagou a mensagem de erro');
    assert.equal(document.getElementById('status-banner').hidden, false);

    await flush(20);
  } finally {
    console.error = originalError;
    restore();
  }
});
