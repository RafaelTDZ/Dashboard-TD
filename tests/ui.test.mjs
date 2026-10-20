import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Exercício real do ui.js (T4). O arquivo só era testado por stubs; agora
// roda no sandbox com o DOM mínimo necessário para o modal.

const uiUrl = new URL('../assets/js/ui.js', import.meta.url);
const uiSource = readFileSync(uiUrl, 'utf8');

function loadUi(extras = {}) {
  const context = Object.assign({ console }, extras);
  context.globalThis = context;
  vm.runInNewContext(uiSource, context, { filename: fileURLToPath(uiUrl) });
  // O sandbox tem os seus próprios intrínsecos: uma Date criada no realm do
  // teste não é `instanceof Date` dentro do ui.js. Pegamos o construtor Date
  // do próprio sandbox para construir as datas.
  return { UI: context.UI, Date: vm.runInNewContext('Date', context) };
}

function createModalDom() {
  const focusLog = [];
  const classLog = [];
  const listeners = [];

  function makeElement(id) {
    return {
      id,
      innerHTML: '',
      hidden: false,
      isConnected: true,
      attributes: {},
      classList: {
        add: (name) => classLog.push('+' + name),
        remove: (name) => classLog.push('-' + name),
        contains: () => false
      },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus() { focusLog.push(id); },
      querySelector: () => null,
      querySelectorAll: () => []
    };
  }

  const elements = new Map();
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
    removeEventListener(type, handler) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.handler === handler);
      if (index > -1) listeners.splice(index, 1);
    }
  };

  return { document, get, focusLog, classLog, listeners };
}

test('escapeHtml escapa os cinco caracteres perigosos e não deixa script passar', () => {
  const { UI } = loadUi();
  assert.equal(UI.escapeHtml('&'), '&amp;');
  assert.equal(UI.escapeHtml('<'), '&lt;');
  assert.equal(UI.escapeHtml('>'), '&gt;');
  assert.equal(UI.escapeHtml('"'), '&quot;');
  assert.equal(UI.escapeHtml("'"), '&#39;');
  assert.equal(UI.escapeHtml('& < > " \''), '&amp; &lt; &gt; &quot; &#39;');

  const script = UI.escapeHtml('<script>alert("xss")</script>');
  assert.doesNotMatch(script, /<script>/);
  assert.doesNotMatch(script, /<\/script>/);
  assert.equal(script, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

  // Valores nulos viram string vazia (nunca "null" na tela).
  assert.equal(UI.escapeHtml(null), '');
  assert.equal(UI.escapeHtml(undefined), '');
});

test('toNumber transforma texto em número e devolve 0 para o que não é número', () => {
  const { UI } = loadUi();
  assert.equal(UI.toNumber(null), 0);
  assert.equal(UI.toNumber(undefined), 0);
  assert.equal(UI.toNumber(''), 0);
  assert.equal(UI.toNumber('abc'), 0);
  assert.equal(UI.toNumber(NaN), 0);
  assert.equal(UI.toNumber(Infinity), 0);
  assert.equal(UI.toNumber(42), 42);
  assert.equal(UI.toNumber('1234.5'), 1234.5);
  assert.equal(UI.toNumber('0'), 0);
  assert.equal(UI.toNumber(-17.5), -17.5);
});

test('formatCompactUSD compacta milhares, milhões e bilhões', () => {
  const { UI } = loadUi();
  assert.equal(UI.formatCompactUSD(0), '$0');
  assert.equal(UI.formatCompactUSD(999), '$999');
  assert.equal(UI.formatCompactUSD(1234), '$1,2K');
  assert.equal(UI.formatCompactUSD(1500000), '$1,5M');
  assert.equal(UI.formatCompactUSD(2500000000), '$2,5B');
  assert.equal(UI.formatCompactUSD(null), '$0');
});

test('formatNumber e formatPercent usam o padrão pt-BR', () => {
  const { UI } = loadUi();
  assert.equal(UI.formatNumber(1234567), '1.234.567');
  assert.equal(UI.formatNumber(1234.5, 1), '1.234,5');
  assert.equal(UI.formatNumber(1234.567, 2), '1.234,57');
  assert.equal(UI.formatNumber(null), '0');
  assert.equal(UI.formatPercent(45.67), '45,7%');
  assert.equal(UI.formatPercent(0), '0,0%');
  assert.equal(UI.formatPercent(100), '100,0%');
});

test('formatCurrencyFull respeita CNY, BRL e o fallback para USD', () => {
  const { UI } = loadUi();
  const cny = UI.formatCurrencyFull(43874.76, 'CNY');
  assert.match(cny, /CNY/);
  assert.match(cny, /43,874\.76/);

  const brl = UI.formatCurrencyFull(1234.56, 'BRL');
  assert.match(brl, /R\$/);
  assert.match(brl, /1\.234,56/);

  const usd = UI.formatCurrencyFull(1234.56, 'USD');
  assert.match(usd, /^\$/);
  assert.match(usd, /1,234\.56/);

  // Moeda desconhecida (ou ausente) cai para USD.
  assert.equal(UI.formatCurrencyFull(1234.56, 'XYZ'), UI.formatCurrencyFull(1234.56, 'USD'));
  assert.equal(UI.formatCurrencyFull(1234.56), UI.formatCurrencyFull(1234.56, 'USD'));
});

test('formatDateTime devolve o travessão para datas inválidas', () => {
  const { UI, Date: SandboxDate } = loadUi();
  assert.equal(UI.formatDateTime(null), '—');
  assert.equal(UI.formatDateTime(new SandboxDate('nope')), '—');
  assert.match(UI.formatDateTime(new SandboxDate(2026, 0, 2, 3, 4)), /02\/01\/2026/);
});

test('openModal mostra o modal, foca o botão de fechar e devolve o foco ao fechar', () => {
  const { document, get, focusLog, classLog, listeners } = createModalDom();
  const { UI } = loadUi({ document });

  const trigger = { isConnected: true, focus: () => focusLog.push('trigger') };
  document.activeElement = trigger;

  UI.openModal({ title: '<b>Título</b>', html: '<p>corpo</p>' });

  const modal = get('modal');
  assert.equal(modal.hidden, false, 'o modal precisa ficar visível');
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.equal(get('modal-title').innerHTML, '&lt;b&gt;Título&lt;/b&gt;', 'o título é escapado');
  assert.equal(get('modal-body').innerHTML, '<p>corpo</p>', 'o corpo vem pronto do app.js');
  assert.ok(focusLog.includes('modal-close-button'), 'o foco vai para o botão de fechar');
  assert.ok(classLog.includes('-hidden'), 'a classe hidden é removida ao abrir');
  assert.ok(listeners.some((entry) => entry.type === 'keydown'), 'o modal prende o Tab');

  UI.closeModal();
  assert.equal(modal.hidden, true, 'o modal fecha');
  assert.ok(classLog.includes('+hidden'), 'a classe hidden volta ao fechar');
  assert.ok(focusLog.includes('trigger'), 'o foco volta para quem abriu o modal');
  assert.equal(listeners.filter((entry) => entry.type === 'keydown').length, 0, 'o handler do Tab é removido');
});
