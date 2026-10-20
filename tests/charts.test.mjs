import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Exercício real do charts.js (T4). Até aqui o arquivo só era testado por
// stubs de DOM; agora ele roda no sandbox com o ui.js e o etl.js de verdade,
// um DOM mínimo e um Chart.js falso que registra as séries desenhadas.
//
// O que fica coberto:
//   - countBy/sumBy deduplicam variantes de caixa e acento e elegem a
//     grafia mais frequente como rótulo;
//   - topEntries ordena por valor decrescente e respeita o limite;
//   - a série mensal zera os meses sem processos;
//   - a média do ano corrente divide só pelos meses que já passaram e a de
//     ano fechado divide por 12.

function loadScript(file, context) {
  vm.runInNewContext(readFileSync(file, 'utf8'), context, { filename: fileURLToPath(file) });
  return context;
}

function createElement(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    title: '',
    className: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => null,
    closest: () => null,
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

function createDom() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  return {
    document: {
      getElementById: get,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      body: { classList: { add() {}, remove() {} }, dataset: {} },
      createElement: () => createElement('temp')
    },
    get
  };
}

function createCharts() {
  const { document, get } = createDom();
  const instances = [];

  class FakeChart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.data = config.data;
      this.options = config.options;
      this.updates = 0;
      instances.push(this);
    }
    update() { this.updates += 1; }
    destroy() {}
  }
  FakeChart.defaults = { color: '', borderColor: '', font: { family: '', size: 11 } };

  // ui.js, etl.js e charts.js precisam compartilhar o mesmo global: o charts.js
  // chama global.UI e global.ETL em tempo de execução.
  const context = { console, document, Chart: FakeChart };
  context.globalThis = context;
  loadScript(new URL('../assets/js/ui.js', import.meta.url), context);
  loadScript(new URL('../assets/js/etl.js', import.meta.url), context);
  loadScript(new URL('../assets/js/charts.js', import.meta.url), context);

  const chartByCanvas = (canvasId) => instances.find((instance) => instance.canvas && instance.canvas.id === canvasId);

  return {
    Charts: context.Charts,
    document,
    get,
    chartByCanvas,
    instances
  };
}

function record(overrides) {
  return Object.assign({
    operacao: 'IMP-1',
    operacaoSigla: 'IMP',
    analista: 'Ana',
    mercadoria: 'Café',
    origem: 'Shanghai',
    destino: 'Santos',
    incoterm: 'FOB',
    agente: 'Maersk',
    despachante: 'MKP',
    valor: 1000,
    valorUSD: 1000,
    monthlyReference: { source: 'ETA', year: 2026, month: 1 }
  }, overrides);
}

// Os arrays nascem dentro do sandbox (vm) e, portanto, têm outro prototype:
// o deepEqual estrito do Node reclama de "mesma estrutura, não a mesma
// referência". Normalizar para o realm do teste resolve.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('countBy deduplica caixa e acento e elege a grafia mais frequente', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  const data = [
    record({ agente: 'Maersk', origem: 'Ningbo', destino: 'Itajaí' }),
    record({ agente: 'MAERSK', origem: 'NINGBO', destino: 'Itajai' }),
    record({ agente: 'maersk', origem: 'Ningbo', destino: 'Itajaí' })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: 'ALL' });

  const agentes = chartByCanvas('chart-agentes');
  assert.deepEqual(plain(agentes.data.labels), ['Maersk'], 'as três grafias viram uma entrada só');
  assert.deepEqual(plain(agentes.data.datasets[0].data), [3]);

  const origem = chartByCanvas('chart-origem');
  assert.deepEqual(plain(origem.data.labels), ['Ningbo'], 'NINGBO e Ningbo viram uma entrada só');
  assert.deepEqual(plain(origem.data.datasets[0].data), [3]);

  const destino = chartByCanvas('chart-destino');
  assert.deepEqual(plain(destino.data.labels), ['Itajaí'], 'a variante mais frequente vira o rótulo');
  assert.deepEqual(plain(destino.data.datasets[0].data), [3]);
});

test('sumBy deduplica o analista e soma os valores das variantes', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  const data = [
    record({ analista: 'Ana Souza', valorUSD: 100 }),
    record({ analista: 'ANA SOUZA', valorUSD: 200 }),
    record({ analista: 'Ana Souza', valorUSD: 50 })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: 'ALL' });

  const analistas = chartByCanvas('chart-analistas');
  assert.deepEqual(plain(analistas.data.labels), ['Ana Souza']);
  assert.deepEqual(plain(analistas.data.datasets[0].data), [350], 'as três grafias somam em uma entrada só');
  assert.equal(analistas.data.datasets[0].label, 'Volume USD');
});

test('topEntries ordena por valor decrescente e respeita o limite', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  const origens = [
    ['Shanghai', 7], ['Ningbo', 6], ['Qingdao', 5], ['Yantian', 4],
    ['Xiamen', 3], ['Shenzhen', 2], ['Tianjin', 1]
  ];
  const data = origens.map(([origem, count]) => {
    const list = [];
    for (let index = 0; index < count; index += 1) list.push(record({ origem }));
    return list;
  }).flat();

  Charts.render(data, { isDemo: false, monthlyYear: 'ALL' });

  const origem = chartByCanvas('chart-origem');
  assert.deepEqual(plain(origem.data.labels), ['Shanghai', 'Ningbo', 'Qingdao', 'Yantian', 'Xiamen']);
  assert.deepEqual(plain(origem.data.datasets[0].data), [7, 6, 5, 4, 3]);
  assert.equal(origem.data.labels.length, 5, 'o gráfico de origem mostra no máximo 5 entradas');
});

test('a série mensal zera os meses sem processos', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  const data = [
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 2 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 2 } }),
    record({ monthlyReference: { source: 'ETS', year: 2020, month: 7 } })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: '2020' });

  const mensal = chartByCanvas('chart-mensal');
  assert.deepEqual(plain(mensal.data.datasets[0].data), [0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  // Os meses sem processo não viram ponto no gráfico; o pico ganha o raio maior.
  assert.deepEqual(plain(mensal.data.datasets[0].pointRadius), [0, 5, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0]);
});

test('a média do ano corrente divide só pelos meses que já passaram', () => {
  const { Charts, chartByCanvas, get } = createCharts();
  assert.equal(Charts.init(), true);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const data = [
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 1 } }),
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 2 } }),
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 2 } })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: String(currentYear) });

  const mensal = chartByCanvas('chart-mensal');
  const expectedAverage = Math.round((3 / currentMonth) * 10) / 10;
  assert.equal(mensal.data.datasets[1].data[0], expectedAverage, 'a média usa o divisor "mês atual"');
  assert.equal(mensal.data.datasets[1].label, currentMonth === 12 ? 'Média 12m' : 'Média ' + currentMonth + 'm');
  const insight = get('monthly-insight').textContent;
  assert.ok(insight.includes(currentMonth === 12 ? 'média' : 'média ' + currentMonth + 'm'), insight);
});

test('a média de um ano fechado divide por 12', () => {
  const { Charts, chartByCanvas, get } = createCharts();
  assert.equal(Charts.init(), true);

  const data = [
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 1 } }),
    record({ monthlyReference: { source: 'ETS', year: 2020, month: 6 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 12 } })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: '2020' });

  const mensal = chartByCanvas('chart-mensal');
  assert.equal(mensal.data.datasets[1].data[0], 0.3, 'a média de ano fechado divide por 12');
  assert.equal(mensal.data.datasets[1].label, 'Média 12m');
  assert.ok(get('monthly-insight').textContent.includes('média'), get('monthly-insight').textContent);
});

test('render sem dados zera todas as séries', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  Charts.render([], { isDemo: false, monthlyYear: 'ALL' });

  const mensal = chartByCanvas('chart-mensal');
  assert.deepEqual(plain(mensal.data.datasets[0].data), Array(12).fill(0));
  assert.deepEqual(plain(mensal.data.datasets[1].data), Array(12).fill(0));
  const origem = chartByCanvas('chart-origem');
  assert.deepEqual(plain(origem.data.labels), []);
  assert.deepEqual(plain(origem.data.datasets[0].data), []);
});
