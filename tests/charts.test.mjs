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

test('média móvel: sem janela fica oculta; com janela, do primeiro ao último mês com processos', () => {
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
  // Sem janela (3M/6M/12M desligadas): a linha de média fica vazia e a
  // legenda esconde a entrada; a média do período (texto) segue com o
  // divisor "mês atual" para os meses futuros (zerados) não derrubarem.
  assert.deepEqual(plain(mensal.data.datasets[1].data), Array(12).fill(null), 'sem janela a média não aparece');
  assert.equal(mensal.data.datasets[1].label, 'Média móvel');
  const filterOff = mensal.options.plugins.legend.labels.filter;
  assert.equal(filterOff({ datasetIndex: 1 }), false, 'legenda esconde a média sem janela');
  assert.equal(filterOff({ datasetIndex: 0 }), true, 'legenda mantém Processos');
  assert.ok(get('monthly-insight').textContent.includes(currentMonth === 12 ? 'média' : 'média ' + currentMonth + 'm'), get('monthly-insight').textContent);

  // Janela 12: recorte ao intervalo — o traçado vai do primeiro ao último
  // mês com processos (Jan–Fev). Depois disso fica sem ponto, mesmo sendo
  // meses correntes do ano, porque ali não existe processo.
  Charts.render(data, { isDemo: false, monthlyYear: String(currentYear), monthlyAverageWindow: 12 });

  assert.deepEqual(plain(mensal.data.datasets[1].data), [1, 1.5, null, null, null, null, null, null, null, null, null, null]);
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 12m');
  assert.ok(get('monthly-insight').title.includes('média móvel 12m até Fev: 1,5/mês'), get('monthly-insight').title);
});

test('média móvel em ano fechado cobre os 12 meses', () => {
  const { Charts, chartByCanvas, get } = createCharts();
  assert.equal(Charts.init(), true);

  const data = [
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 1 } }),
    record({ monthlyReference: { source: 'ETS', year: 2020, month: 6 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 12 } })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: '2020', monthlyAverageWindow: 12 });

  const mensal = chartByCanvas('chart-mensal');
  // byMonth = [1,0,0,0,0,1,0,0,0,0,0,1]: a janela 12 é expansiva no início e,
  // no fim, converge para a média do ano (3/12 = 0,3) — ano fechado divide
  // por 12, igual ao modelo anterior.
  assert.equal(mensal.data.datasets[1].data[0], 1, 'no primeiro mês a média móvel é o valor do próprio mês');
  assert.equal(mensal.data.datasets[1].data[5], Math.round((2 / 6) * 10) / 10);
  assert.equal(mensal.data.datasets[1].data[11], Math.round((3 / 12) * 10) / 10);
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 12m');
  assert.ok(get('monthly-insight').textContent.includes('média'), get('monthly-insight').textContent);
});

test('janelas 3/6/12 trocam uma de cada vez pela options.monthlyAverageWindow', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  const data = [
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 2 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 2 } }),
    record({ monthlyReference: { source: 'ETS', year: 2020, month: 7 } })
  ];
  // byMonth = [0,2,0,0,0,0,1,0,0,0,0,0]: o traçado nasce em Fevereiro
  // (primeiro mês com processos) e morre em Julho (último); o resto é null.
  const series = [0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  const expected = (size) => {
    const first = series.findIndex((value) => value > 0);
    const last = series.length - 1 - [...series].reverse().findIndex((value) => value > 0);
    return series.map((_, index) => {
      if (index < first || index > last) return null;
      const start = Math.max(0, index - size + 1);
      const window = series.slice(start, index + 1);
      return Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 10) / 10;
    });
  };

  const mensal = chartByCanvas('chart-mensal');

  Charts.render(data, { isDemo: false, monthlyYear: '2020', monthlyAverageWindow: 3 });
  assert.deepEqual(plain(mensal.data.datasets[1].data), expected(3), 'janela 3');
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 3m');

  Charts.render(data, { isDemo: false, monthlyYear: '2020', monthlyAverageWindow: 6 });
  assert.deepEqual(plain(mensal.data.datasets[1].data), expected(6), 'janela 6 troca a 3 (uma média por vez)');
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 6m');

  Charts.render(data, { isDemo: false, monthlyYear: '2020', monthlyAverageWindow: 12 });
  assert.deepEqual(plain(mensal.data.datasets[1].data), expected(12), 'janela 12 troca a 6 (uma média por vez)');
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 12m');
  assert.equal(mensal.options.plugins.legend.labels.filter({ datasetIndex: 1 }), true, 'com janela ativa a legenda mostra a média');
});

test('a média alcança meses futuros agendados e recorta os meses vazios no fim', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  const currentYear = new Date().getFullYear();
  // Dois processos agendados para Novembro e um ETS para Dezembro: o ano
  // corrente ainda nem chegou lá, mas os meses têm processos — a média
  // segue os dados em vez de parar no mês corrente.
  const data = [
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 11 } }),
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 11 } }),
    record({ monthlyReference: { source: 'ETS', year: currentYear, month: 12 } })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: String(currentYear), monthlyAverageWindow: 3 });

  const mensal = chartByCanvas('chart-mensal');
  const seriesData = mensal.data.datasets[1].data;
  // byMonth = [0,0,0,0,0,0,0,0,0,0,2,1]: traçado só em Nov e Dez (com a
  // janela por calendário: os 3 meses anteriores entram zerados).
  assert.equal(seriesData[10], Math.round((2 / 3) * 10) / 10, 'novembro (janela de 3 meses do calendário)');
  assert.equal(seriesData[11], Math.round((3 / 3) * 10) / 10, 'dezembro');
  assert.ok(seriesData.slice(0, 10).every((value) => value === null), 'jan–out (sem processos) não recebem média');

  Charts.render(data, { isDemo: false, monthlyYear: String(currentYear), monthlyAverageWindow: 6 });
  assert.equal(mensal.data.datasets[1].data[10], Math.round((2 / 6) * 10) / 10, 'janela 6 em novembro (jul–nov, com vazios)');
  assert.equal(mensal.data.datasets[1].data[11], Math.round((3 / 6) * 10) / 10, 'janela 6 em dezembro (ago)–dez');
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 6m');
});

test('média do ano desenha reta na média do ano exibido, sem anos anteriores', () => {
  const { Charts, chartByCanvas, get } = createCharts();
  assert.equal(Charts.init(), true);

  // O processo de Dez/2019 fica fora da conta: a média é só do ano exibido.
  const data = [
    record({ monthlyReference: { source: 'ETA', year: 2019, month: 12 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 1 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 1 } }),
    record({ monthlyReference: { source: 'ETA', year: 2020, month: 6 } })
  ];
  Charts.render(data, { isDemo: false, monthlyYear: '2020', monthlyAverageWindow: 'ano' });

  const mensal = chartByCanvas('chart-mensal');
  // byMonth 2020 = [2,0,0,0,0,1,0,0,0,0,0,0]: ano fechado divide por 12,
  // então a reta fica em 3/12 = 0,3 de Janeiro (primeiro mês com processos)
  // a Junho (último).
  const expected = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, null, null, null, null, null, null];
  assert.deepEqual(plain(mensal.data.datasets[1].data), expected, 'reta de Jan a Jun, sem anos anteriores');
  assert.equal(mensal.data.datasets[1].label, 'Média do ano');
  assert.equal(mensal.options.plugins.legend.labels.filter({ datasetIndex: 1 }), true, 'legenda mostra a média do ano');
  assert.ok(get('monthly-insight').title.includes('média do ano: 0,3/mês (12 meses)'), get('monthly-insight').title);

  // "Todos os anos" não tem um ano concreto: a média do ano não é desenhada.
  Charts.render(data, { isDemo: false, monthlyYear: 'ALL', monthlyAverageWindow: 'ano' });
  assert.deepEqual(plain(mensal.data.datasets[1].data), Array(12).fill(null));
  assert.equal(mensal.options.plugins.legend.labels.filter({ datasetIndex: 1 }), false, 'sem traçado a legenda esconde a média');

  // Ano corrente: mesmo divisor do insight (meses já passados) e recorte que
  // alcança o mês futuro com processo agendado.
  const now = new Date();
  const currentYear = now.getFullYear();
  const monthsElapsed = now.getMonth() + 1;
  const currentData = [
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 2 } }),
    record({ monthlyReference: { source: 'ETA', year: currentYear, month: 11 } })
  ];
  Charts.render(currentData, { isDemo: false, monthlyYear: String(currentYear), monthlyAverageWindow: 'ano' });
  const flat = Math.round((2 / monthsElapsed) * 10) / 10;
  assert.equal(mensal.data.datasets[1].data[1], flat, 'fevereiro (média do ano)');
  assert.equal(mensal.data.datasets[1].data[10], flat, 'novembro agendado também recebe a reta');
  assert.equal(mensal.data.datasets[1].data[0], null, 'janeiro vazio fica fora do recorte');
  assert.equal(mensal.data.datasets[1].label, 'Média do ano');
});

test('render sem dados zera todas as séries', () => {
  const { Charts, chartByCanvas } = createCharts();
  assert.equal(Charts.init(), true);

  Charts.render([], { isDemo: false, monthlyYear: 'ALL' });

  const mensal = chartByCanvas('chart-mensal');
  assert.deepEqual(plain(mensal.data.datasets[0].data), Array(12).fill(0));
  assert.deepEqual(plain(mensal.data.datasets[1].data), Array(12).fill(null), 'sem dados e sem janela ativa a média fica vazia');
  const origem = chartByCanvas('chart-origem');
  assert.deepEqual(plain(origem.data.labels), []);
  assert.deepEqual(plain(origem.data.datasets[0].data), []);

  // Mesmo com janela escolhida, dataset vazio não tem média para desenhar.
  Charts.render([], { isDemo: false, monthlyYear: 'ALL', monthlyAverageWindow: 6 });
  assert.deepEqual(plain(mensal.data.datasets[1].data), Array(12).fill(null), 'dataset vazio não desenha média mesmo com janela');
  assert.equal(mensal.data.datasets[1].label, 'Média móvel 6m');
});
