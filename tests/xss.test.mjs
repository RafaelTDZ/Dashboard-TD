import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Cobertura por sink de HTML (F10/T4).
//
// Cada teste injeta um payload malicioso no dado de entrada e inspeciona o HTML
// que o módulo real produz. A regra é simples: dado dinâmico nunca pode virar
// tag; no pior caso ele aparece escapado (`&lt;img`, `&quot;`).
//
// Sinks cobertos:
//   - DashboardTable.renderTable -> els['table-body'].innerHTML
//   - DashboardBanner.updateBanner -> els['banner-text'].innerHTML e
//     els['dataset-summary'].innerText
//   - DashboardFilters.populateFilterOptions -> innerHTML dos <select>
//   - UI.toast -> card.innerHTML
//   - UI.openModal -> título escapado (o corpo é HTML cru por design)
//
// O corpo do modal é HTML de propósito: os chamadores de import.js montam os
// fragmentos e precisam escapar cada dado dinâmico. Por isso o último teste é
// estático e verifica exatamente esses chamadores, tolerando reformatação.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readSource = (name) => readFileSync(join(root, 'assets', 'js', name), 'utf8');

const uiSource = readSource('ui.js');
const tableSource = readSource('table.js');
const bannerSource = readSource('banner.js');
const filtersSource = readSource('filters.js');
const importSource = readSource('import.js');

const IMG_PAYLOAD = '<img src=x onerror="alert(1)">';
const SCRIPT_PAYLOAD = '"><script>alert(1)</script>';

function loadInSandbox(sources, extras = {}) {
  const context = Object.assign({ console }, extras);
  // Mesmo padrão de tests/ui.test.mjs: o módulo escreve em globalThis e o
  // teste lê o que ele publicou.
  context.globalThis = context;
  sources.forEach(([filename, source]) => {
    vm.runInNewContext(source, context, { filename });
  });
  return context;
}

function loadDashboardModule(moduleSource, moduleFile, extras = {}) {
  return loadInSandbox([
    ['ui.js', uiSource],
    [moduleFile, moduleSource]
  ], extras);
}

function assertNoRawMarkup(html, label) {
  assert.doesNotMatch(html, /<img\b/i, label + ': um <img> cru chegou ao HTML');
  assert.doesNotMatch(html, /<script\b/i, label + ': um <script> cru chegou ao HTML');
  assert.doesNotMatch(html, /<\/script>/i, label + ': um </script> cru chegou ao HTML');
}

function createFakeElement(tagName = 'div') {
  return {
    tagName: String(tagName).toUpperCase(),
    className: '',
    type: '',
    value: '',
    checked: false,
    hidden: false,
    textContent: '',
    innerText: '',
    innerHTML: '',
    children: [],
    addEventListener() {},
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    }
  };
}

// ---------------------------------------------------------------------------
// Tabela: operacao/analista/mercadoria/modal/regDi/origem/destino/incoterm/
// valorMoeda/comments
// ---------------------------------------------------------------------------

test('tabela escapa todos os campos dinâmicos da linha', () => {
  const sandbox = loadDashboardModule(tableSource, 'table.js');
  const UI = sandbox.UI;

  const comment = { text: '<img src=x onerror="alert(\'comment\')">', reference: 'REF-1' };
  const record = {
    operacao: IMG_PAYLOAD,
    analista: SCRIPT_PAYLOAD,
    mercadoria: '<img src=x onerror="alert(2)">',
    modal: SCRIPT_PAYLOAD,
    modalCategory: 'FCL',
    regDi: IMG_PAYLOAD,
    situacao: 'Em andamento',
    origem: IMG_PAYLOAD,
    destino: SCRIPT_PAYLOAD,
    incoterm: IMG_PAYLOAD,
    valor: 1234.56,
    valorMoeda: IMG_PAYLOAD,
    comments: [comment],
    atracado: false
  };

  const records = [record];
  const state = {
    page: 1,
    pageSize: 50,
    dataset: records,
    filtered: records,
    sort: { key: 'valor', dir: 1 }
  };
  const els = {
    'table-body': { innerHTML: '' },
    'table-count': { innerText: '', title: '' },
    'page-info': { innerText: '' },
    'page-prev': { disabled: false },
    'page-next': { disabled: false },
    'table-head': { querySelectorAll: () => [] }
  };

  const table = sandbox.DashboardTable.create({
    state,
    els,
    UI,
    ETL: {
      monthName: () => 'Janeiro',
      classifyModal: () => 'FCL',
      isDiRegistered: () => true,
      isConcluida: () => false,
      isFaturada: () => true,
      isArquivado: () => false
    },
    getSortedData: () => records,
    getMonthlyReferenceMonth: () => 1
  });

  table.renderTable();
  const html = els['table-body'].innerHTML;

  assertNoRawMarkup(html, 'tabela');
  assert.ok(html.includes(UI.escapeHtml(IMG_PAYLOAD)), 'o <img> de operacao precisa aparecer escapado');
  assert.ok(html.includes(UI.escapeHtml(SCRIPT_PAYLOAD)), 'o payload de analista precisa aparecer escapado');
  assert.ok(html.includes(UI.escapeHtml(record.mercadoria)), 'a mercadoria precisa aparecer escapada');
  assert.ok(html.includes(UI.escapeHtml(record.regDi)), 'o regDi precisa aparecer escapado');
  assert.ok(html.includes(UI.escapeHtml(record.origem)), 'a origem precisa aparecer escapada');
  assert.ok(html.includes(UI.escapeHtml(record.destino)), 'o destino precisa aparecer escapado');
  assert.ok(html.includes(UI.escapeHtml(record.incoterm)), 'o incoterm precisa aparecer escapado');
  assert.ok(html.includes(UI.escapeHtml(record.valorMoeda)), 'a moeda no title precisa aparecer escapada');
  assert.ok(html.includes(UI.escapeHtml(comment.text)), 'o comentário no title precisa aparecer escapado');
  assert.match(html, /&lt;img/i, 'o HTML precisa conter a versão escapada &lt;img');
});

// ---------------------------------------------------------------------------
// Banner: nome do arquivo e nome da guia
// ---------------------------------------------------------------------------

test('banner escapa nome do arquivo e guia e escreve o resumo como texto', () => {
  const sandbox = loadDashboardModule(bannerSource, 'banner.js');
  const UI = sandbox.UI;
  const fileName = IMG_PAYLOAD + '.xlsx';
  const sheetName = SCRIPT_PAYLOAD;

  const state = {
    isDemo: false,
    dataset: [{}],
    filtered: [{}],
    meta: {
      name: fileName,
      sheetName,
      rowCount: 1,
      loadedAt: null
    }
  };
  const els = {
    'banner-text': { innerHTML: '' },
    'last-read-header': { innerText: '' },
    'dataset-summary': { innerText: '', title: '', innerHTML: '' },
    'last-update-time': { innerText: '' }
  };

  const banner = sandbox.DashboardBanner.create({
    state,
    els,
    UI,
    ETL: {},
    getSelectedYear: () => null
  });

  banner.updateBanner();
  const html = els['banner-text'].innerHTML;

  assertNoRawMarkup(html, 'banner');
  assert.ok(html.includes(UI.escapeHtml(fileName)), 'o nome do arquivo precisa aparecer escapado');
  assert.ok(html.includes(UI.escapeHtml(sheetName)), 'o nome da guia precisa aparecer escapado');
  assert.match(html, /&lt;img/i, 'o banner precisa conter &lt;img');

  // O resumo do cabeçalho é texto puro: o payload aparece inteiro no innerText
  // e nada é atribuído ao innerHTML.
  const summary = els['dataset-summary'];
  assert.ok(summary.innerText.includes(fileName), 'o resumo precisa receber o nome como texto');
  assert.equal(summary.innerHTML, '', 'o resumo não pode usar innerHTML');
  assert.ok(summary.title.includes(fileName), 'o title do resumo também é texto');
});

// ---------------------------------------------------------------------------
// Selects: analista, mercadoria, incoterm e despachante
// ---------------------------------------------------------------------------

test('selects de filtro escapam valores, rótulos e o atributo value', () => {
  const documentStub = { createElement: (tagName) => createFakeElement(tagName) };
  const sandbox = loadDashboardModule(filtersSource, 'filters.js', { document: documentStub });
  const UI = sandbox.UI;

  const values = {
    analista: IMG_PAYLOAD,
    mercadoria: SCRIPT_PAYLOAD,
    incoterm: '<img src=x onerror="alert(3)">',
    despachante: '"><img src=x onerror="alert(4)">'
  };
  const records = [{
    analista: values.analista,
    mercadoria: values.mercadoria,
    incoterm: values.incoterm,
    despachante: values.despachante
  }];

  const makeSelect = () => ({ value: '', innerHTML: '' });
  const els = {
    'filter-mes-list': { textContent: '', appendChild() {} },
    'filter-mes-all': { checked: false, indeterminate: false },
    'filter-mes-toggle': { setAttribute() {} },
    'filter-mes-menu': { hidden: true },
    'filter-mes-label': { textContent: '' },
    'filter-analista': makeSelect(),
    'filter-mercadoria': makeSelect(),
    'filter-incoterm': makeSelect(),
    'filter-despachante': makeSelect(),
    'monthly-year': makeSelect()
  };

  const filters = sandbox.DashboardFilters.create({
    state: {
      dataset: records,
      filters: {
        ano: 'ALL',
        mes: 'ALL',
        analista: 'ALL',
        situacao: 'ALL',
        regDi: 'ALL',
        mercadoria: 'ALL',
        modal: 'ALL',
        incoterm: 'ALL',
        despachante: 'ALL'
      }
    },
    els,
    UI,
    ETL: { monthName: () => 'Janeiro' },
    DashboardState: {},
    normalizeSearchText: (value) => String(value == null ? '' : value).toLowerCase(),
    getMonthlyReferenceYear: () => 2025,
    getMonthlyReferenceMonth: () => 1,
    refresh: () => {},
    schedulePersist: () => {}
  });

  filters.populateFilterOptions();

  const expected = {
    'filter-analista': values.analista,
    'filter-mercadoria': values.mercadoria,
    'filter-incoterm': values.incoterm,
    'filter-despachante': values.despachante
  };
  Object.entries(expected).forEach(([id, raw]) => {
    const html = els[id].innerHTML;
    assertNoRawMarkup(html, id);
    assert.ok(html.includes('value="' + UI.escapeHtml(raw) + '"'), id + ': o value precisa ser escapado');
  });

  // O payload de despachante começa com aspas: se o atributo não fosse
  // escapado, a aspa fecharia o value e criaria um atributo novo.
  assert.match(els['filter-despachante'].innerHTML, /value="&quot;&gt;&lt;img/);
  assert.match(els['filter-despachante'].innerHTML, /&quot;/, 'as aspas precisam virar &quot;');

  // Os anos são numéricos, mas passam pelo mesmo innerHTML: nada de tag.
  const yearHtml = els['monthly-year'].innerHTML;
  assertNoRawMarkup(yearHtml, 'monthly-year');
  assert.ok(yearHtml.includes('<option value="2025">2025</option>'));
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function createToastDom() {
  const cards = [];
  const closeButton = { addEventListener() {} };
  const container = {
    appendChild(card) {
      cards.push(card);
      return card;
    }
  };

  const document = {
    getElementById(id) {
      return id === 'toast-container' ? container : null;
    },
    createElement() {
      const card = {
        className: '',
        _innerHTML: '',
        classList: { add() {}, remove() {} },
        setAttribute() {},
        querySelector(selector) {
          return selector === '[data-toast-close]' ? closeButton : null;
        },
        remove() {}
      };
      Object.defineProperty(card, 'innerHTML', {
        get() { return this._innerHTML; },
        set(value) { this._innerHTML = String(value); }
      });
      return card;
    }
  };

  return { document, cards };
}

test('toast escapa título e mensagem', () => {
  const { document, cards } = createToastDom();
  const sandbox = loadInSandbox([['ui.js', uiSource]], {
    document,
    requestAnimationFrame: (callback) => callback(),
    setTimeout: () => 0
  });

  const card = sandbox.UI.toast(SCRIPT_PAYLOAD, 'error', IMG_PAYLOAD);
  assert.equal(cards.length, 1, 'o toast precisa ser anexado ao container');
  assert.equal(card, cards[0]);

  const html = card.innerHTML;
  assertNoRawMarkup(html, 'toast');
  assert.ok(html.includes(sandbox.UI.escapeHtml(IMG_PAYLOAD)), 'o título precisa aparecer escapado');
  assert.ok(html.includes(sandbox.UI.escapeHtml(SCRIPT_PAYLOAD)), 'a mensagem precisa aparecer escapada');
  assert.match(html, /&lt;img/i);
});

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function createModalDom() {
  const elements = new Map();
  const listeners = [];

  function makeElement(id) {
    return {
      id,
      innerHTML: '',
      hidden: false,
      isConnected: true,
      attributes: {},
      classList: { add() {}, remove() {}, contains: () => false },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) {
        return this.attributes[name] === undefined ? null : this.attributes[name];
      },
      focus() {},
      querySelector: () => null,
      querySelectorAll: () => []
    };
  }

  const get = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const closeButton = makeElement('modal-close-button');
  const modal = get('modal');
  modal.querySelector = (selector) => (selector === '[data-modal-close-button]' ? closeButton : null);
  modal.querySelectorAll = () => [];

  const document = {
    activeElement: null,
    body: { classList: { add() {}, remove() {} } },
    getElementById: get,
    addEventListener(type, handler) { listeners.push({ type, handler }); },
    removeEventListener() {}
  };

  return { document, get, listeners };
}

test('modal escapa o título e mantém o corpo como HTML montado pelo chamador', () => {
  const { document, get } = createModalDom();
  const sandbox = loadInSandbox([['ui.js', uiSource]], { document });

  sandbox.UI.openModal({ title: IMG_PAYLOAD, html: '<p>corpo</p>' });

  const titleHtml = get('modal-title').innerHTML;
  assertNoRawMarkup(titleHtml, 'modal-title');
  assert.equal(titleHtml, sandbox.UI.escapeHtml(IMG_PAYLOAD), 'o título precisa ser escapado por inteiro');
  assert.equal(get('modal-body').innerHTML, '<p>corpo</p>', 'o corpo continua sendo HTML cru por design');
});

// ---------------------------------------------------------------------------
// Chamadores do corpo do modal (import.js)
// ---------------------------------------------------------------------------

// Extrai o corpo de uma função balanceando chaves e ignorando strings/comentários.
// Assim o teste não depende de indentação nem de quebra de linha.
function extractFunctionBody(source, name) {
  const signature = new RegExp('function\\s+' + name + '\\s*\\(');
  const match = signature.exec(source);
  assert.ok(match, 'função ' + name + ' não encontrada em import.js');

  const openBrace = source.indexOf('{', match.index);
  assert.ok(openBrace > -1, 'corpo da função ' + name + ' não encontrado');

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index);
      if (index === -1) break;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      if (index === -1) break;
      index += 1;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }

  assert.fail('não foi possível balancear as chaves de ' + name);
}

function findEscapedCallSpans(code) {
  const spans = [];
  const wrapper = /global\.UI\.(?:escapeHtml|formatNumber)\s*\(/g;
  let match;

  while ((match = wrapper.exec(code)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    let quote = null;
    let escaped = false;

    while (index < code.length && depth > 0) {
      const char = code[index];

      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }

      index += 1;
    }

    spans.push({ start: match.index, end: index });
  }

  return spans;
}

// Declarações (`function (header)`, `header =>`, `var header =`) não são
// interpolação: só as leituras do valor precisam estar dentro de escape.
function isDeclaration(code, index, token) {
  const before = code.slice(Math.max(0, index - 40), index);
  const after = code.slice(index + token.length, index + token.length + 40);
  return (/(?:function\s*)?\(\s*$/.test(before) && /^\s*\)\s*(?:=>|\{)/.test(after)) ||
    /^\s*=>/.test(after) ||
    (/(?:var|let|const)\s+$/.test(before) && /^\s*=/.test(after));
}

function assertTokenEscaped(segment, token, functionName) {
  const pattern = new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  const spans = findEscapedCallSpans(segment);
  let match;

  while ((match = pattern.exec(segment)) !== null) {
    if (isDeclaration(segment, match.index, match[0])) continue;

    const start = match.index;
    const end = start + match[0].length;
    const wrapped = spans.some((span) => start >= span.start && end <= span.end);
    const context = segment.slice(Math.max(0, start - 60), end + 60).replace(/\s+/g, ' ');
    assert.ok(wrapped, functionName + ': "' + token + '" sem escape em: ' + context);
  }
}

test('chamadores do modal em import.js escapam file.name, chaves, rótulos e guia', () => {
  const functions = {
    showBlockedImport: ['file.name'],
    showInvalidImport: ['file.name', 'comparison.nextInvalidKey'],
    handleRejectedSnapshot: [],
    showMappingReport: ['entry.label', 'entry.header', 'header', 'result.sheetName']
  };

  Object.entries(functions).forEach(([name, tokens]) => {
    const body = extractFunctionBody(importSource, name);
    const openModal = body.indexOf('global.UI.openModal');
    assert.ok(openModal > -1, name + ' precisa abrir o modal');

    // Só o trecho que monta o HTML: o toast depois do openModal recebe texto
    // (e escapa por conta própria), então não entra nesta checagem.
    const segment = body.slice(0, openModal);
    assert.match(segment, /global\.UI\.(?:escapeHtml|formatNumber)\(/, name + ' precisa escapar os dados do modal');

    tokens.forEach((token) => assertTokenEscaped(segment, token, name));
  });

  const comparisonList = extractFunctionBody(importSource, 'comparisonList');
  assert.match(comparisonList, /global\.UI\.escapeHtml\(\s*key\s*\)/, 'comparisonList precisa escapar a chave');
  assert.match(comparisonList, /global\.UI\.formatNumber\(/, 'comparisonList precisa formatar a contagem');

  const rejected = extractFunctionBody(importSource, 'handleRejectedSnapshot');
  assert.match(rejected, /global\.UI\.escapeHtml\(\s*key\.trim\(\)\s*\)/, 'os detalhes recusados precisam ser escapados');
  assert.match(rejected, /global\.UI\.escapeHtml\(\s*missingCount\s*\)/, 'a contagem da recusa precisa ser escapada');
});
