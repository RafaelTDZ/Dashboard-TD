import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

function loadScript(file, extras = {}) {
  const context = Object.assign({ console }, extras);
  context.globalThis = context;
  vm.runInNewContext(readFileSync(file, 'utf8'), context, { filename: fileURLToPath(file) });
  return context;
}

// vendor/xlsx.full.min.js é um build de browser (UMD/CJS). Como a raiz do projeto
// declara "type": "module" no package.json, um require() desse arquivo retornaria um
// namespace ESM vazio. Carregamos exatamente como o navegador faz: executando o bundle
// em um contexto com globalThis próprio e lendo o XLSX global que ele publica.
const XLSX = loadScript(new URL('../vendor/xlsx.full.min.js', import.meta.url)).XLSX;

const etlContext = loadScript(new URL('../assets/js/etl.js', import.meta.url), { XLSX });
const ETL = etlContext.ETL;
const uiContext = loadScript(new URL('../assets/js/ui.js', import.meta.url));
const UI = uiContext.UI;
const stateContext = loadScript(new URL('../assets/js/state.js', import.meta.url));
const DashboardState = stateContext.DashboardState;

test('versiona o parser após a normalização de moedas', () => {
  assert.equal(ETL.PARSER_VERSION, 8);
});

test('normaliza agentes com grafias diferentes para o mesmo agrupamento', () => {
  assert.equal(ETL.normalizeAgentKey('MAERSK'), ETL.normalizeAgentKey('Maersk'));
  assert.equal(ETL.normalizeAgentKey('ASIA'), ETL.normalizeAgentKey('Asia'));
  assert.equal(ETL.normalizeAgentKey('  Maersk  '), 'maersk');
  const records = [{ agente: 'Maersk' }, { agente: 'MAERSK' }, { agente: 'Asia' }, { agente: 'ASIA' }, { agente: 'N/A' }];
  ETL.canonicalizeAgents(records);
  assert.equal(records[0].agente, records[1].agente);
  assert.equal(records[2].agente, records[3].agente);
});

test('mescla apelidos confirmados de agente (Asia Shipping e Línea Logistics)', () => {
  assert.equal(ETL.resolveAgentAlias('ASIA'), 'Asia Shipping');
  assert.equal(ETL.resolveAgentAlias('Asia'), 'Asia Shipping');
  assert.equal(ETL.resolveAgentAlias('Linea'), 'Línea Logistics');
  assert.equal(ETL.resolveAgentAlias('LÍNEA'), 'Línea Logistics');
  assert.equal(ETL.resolveAgentAlias('Línea Logistics'), null);
  assert.equal(ETL.resolveAgentAlias('Maersk'), null);
  assert.equal(ETL.resolveAgentAlias('N/A'), null);
  const records = [
    { agente: 'ASIA' }, { agente: 'Asia Shipping' },
    { agente: 'Linea' }, { agente: 'Línea Logistics' },
    { agente: 'N/A' }
  ];
  ETL.canonicalizeAgents(records);
  assert.equal(records[0].agente, 'Asia Shipping');
  assert.equal(records[1].agente, 'Asia Shipping');
  assert.equal(records[2].agente, 'Línea Logistics');
  assert.equal(records[3].agente, 'Línea Logistics');
  assert.equal(records[4].agente, 'N/A');
});

test('mescla apelidos de despachante (MKP Assessoria vira MKP)', () => {
  assert.equal(ETL.DISPATCHER_ALIASES['mkp assessoria'], 'MKP');
  assert.equal(ETL.DISPATCHER_ALIASES['sea despacho'], 'SEA');
  const records = [{ despachante: 'MKP' }, { despachante: 'MKP Assessoria' }, { despachante: 'mkp assessoria' }];
  ETL.canonicalizeField(records, 'despachante');
  assert.deepEqual(records.map((record) => record.despachante), ['MKP', 'MKP', 'MKP']);
  const sea = [{ despachante: 'SEA' }, { despachante: 'Sea despacho' }, { despachante: 'SEA DESPACHO' }];
  ETL.canonicalizeField(sea, 'despachante');
  assert.deepEqual(sea.map((record) => record.despachante), ['SEA', 'SEA', 'SEA']);
});

test('normaliza origem/destino/mercadoria para os cards', () => {
  const origem = [{ origem: 'Ningbo' }, { origem: 'NINGBO' }, { origem: 'Qingdao' }];
  ETL.canonicalizeField(origem, 'origem');
  assert.equal(origem[0].origem, origem[1].origem);
  const destino = [{ destino: 'Itajaí' }, { destino: 'Itajai' }];
  ETL.canonicalizeField(destino, 'destino');
  assert.equal(destino[0].destino, destino[1].destino);
  const merc = [{ mercadoria: 'Cadeiras' }, { mercadoria: 'CADEIRAS' }];
  ETL.canonicalizeField(merc, 'mercadoria');
  assert.equal(merc[0].mercadoria, merc[1].mercadoria);
});

function dateParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
}

test('classifica estados concluídos, arquivados e negados', () => {
  assert.equal(ETL.isConcluida({ situacao: 'Concluída, arquivar' }), true);
  assert.equal(ETL.isConcluida({ situacao: 'Operação concluída' }), true);
  assert.equal(ETL.isConcluida({ situacao: 'Arquivado' }), true);
  assert.equal(ETL.isConcluida({ situacao: 'Não concluída' }), false);
  assert.equal(ETL.isConcluida({ situacao: 'Não arquivado' }), false);
  assert.equal(ETL.isConcluida({ situacao: 'Aguardando arquivamento' }), false);
  assert.equal(ETL.isConcluida({ situacao: 'Em andamento' }), false);
  assert.equal(ETL.isCancelada({ situacao: 'Operação cancelada' }), true);
  assert.equal(ETL.isCancelada({ situacao: 'Cancelado' }), true);
  assert.equal(ETL.isCancelada({ situacao: 'Operação concluída' }), false);
  assert.equal(ETL.isCancelada({ situacao: 'Em andamento' }), false);
});

test('rejeita datas inválidas sem fazer rollover silencioso', () => {
  assert.deepEqual(dateParts(ETL.parseExcelDate('29/02/2024')), [2024, 2, 29, 0, 0, 0]);
  assert.deepEqual(dateParts(ETL.parseExcelDate('2024-02-29 23:59:59')), [2024, 2, 29, 23, 59, 59]);
  assert.deepEqual(dateParts(ETL.parseExcelDate(45292)), [2024, 1, 1, 0, 0, 0]);
  assert.equal(ETL.parseExcelDate('31/02/2024'), null);
  assert.equal(ETL.parseExcelDate('01/13/2024'), null);
  assert.equal(ETL.parseExcelDate('2024-13-01'), null);
  assert.equal(ETL.parseExcelDate('2024-02-30'), null);
  assert.equal(ETL.parseExcelDate('10/01/2024 24:00'), null);
});

test('rejeita textos numéricos puros em vez de interpretar como data', () => {
  assert.equal(ETL.parseExcelDate('0'), null);
  assert.equal(ETL.parseExcelDate('00'), null);
  assert.equal(ETL.parseExcelDate('1'), null);
  assert.equal(ETL.parseExcelDate('45292'), null);
  assert.equal(ETL.parseExcelDate('20260930'), null);
});

test('parseExcelDate só aceita seriais do Excel em faixa plausível (B8)', () => {
  // Uma célula numérica que não é data (um código, por exemplo) não pode
  // virar 13/06/1905: 2025 está fora da faixa plausível de serial.
  assert.equal(ETL.parseExcelDate(2025), null);
  assert.equal(ETL.parseExcelDate(0), null);
  assert.equal(ETL.parseExcelDate(19999), null);
  assert.equal(ETL.parseExcelDate(80001), null);
  assert.equal(ETL.parseExcelDate(NaN), null);
  assert.equal(ETL.parseExcelDate(Infinity), null);

  // 45.660 é um serial válido: 03/01/2025.
  const date = ETL.parseExcelDate(45660);
  assert.ok(date && typeof date.getFullYear === 'function', 'o serial dentro da faixa precisa virar data');
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth() + 1, 1);
  assert.equal(date.getDate(), 3);

  // A faixa é explícita no código (20.000 ≈ 1954, 80.000 ≈ 2119).
  const source = readFileSync(new URL('../assets/js/etl.js', import.meta.url), 'utf8');
  assert.match(source, /const EXCEL_SERIAL_MIN = 20000;/);
  assert.match(source, /const EXCEL_SERIAL_MAX = 80000;/);
  assert.match(source, /if \(wholeDays < EXCEL_SERIAL_MIN \|\| wholeDays > EXCEL_SERIAL_MAX\) return null;/);
});

test('lê Pack Month como serial Excel e não trata Container como LCL/FCL', () => {
  assert.equal(ETL.monthFromValue(45292), 1);
  assert.equal(ETL.monthFromValue(3), 3);

  const sheet = XLSX.utils.aoa_to_sheet([
    ['Operação', 'Situação', 'Pack Month', 'Container'],
    ['A-1', 'Em andamento', 45292, 'MSCU1234567']
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Importações');
  const result = ETL.parseWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

  assert.equal(result.records[0].month, 1);
  assert.equal(result.records[0].container, 'MSCU1234567');
  assert.equal(result.records[0].modal, 'N/A');
  assert.equal(result.records[0].modalCategory, 'N/A');
});

test('mantém o parsing de números pt-BR e US', () => {
  const cases = [
    ['1.234,56', 1234.56],
    ['R$ 9.293,58', 9293.58],
    ['1,234.56', 1234.56],
    ['12,5', 12.5],
    ['0.25', 0.25],
    ['(100,00)', -100],
    ['-1.234,56', -1234.56],
    ['1.234', 1234]
  ];
  cases.forEach(([raw, expected]) => assert.equal(ETL.parseNumber(raw), expected, raw));
  assert.equal(ETL.parseNumber(''), null);
  assert.equal(ETL.parseNumber('não informado'), null);
});

test('detecta moedas no prefixo/símbolo sem perder o valor numérico', () => {
  const cases = [
    ['USD 29.179,20', 'USD', 29179.2],
    ['$1,234.56', 'USD', 1234.56],
    ['元43,874.76', 'CNY', 43874.76],
    ['¥103,488.00', 'CNY', 103488],
    ['R$ 1.234,56', 'BRL', 1234.56]
  ];
  cases.forEach(([raw, currency, amount]) => {
    const parsed = ETL.parseCurrencyValue(raw, 'USD');
    assert.equal(parsed.currency, currency, raw);
    assert.equal(parsed.amount, amount, raw);
  });
  const numeric = ETL.parseCurrencyValue(1234.5, 'USD');
  assert.equal(numeric.amount, 1234.5);
  assert.equal(numeric.currency, 'USD');
  assert.match(UI.formatCurrencyFull(43874.76, 'CNY'), /CNY/);
});

test('extrai a sigla inicial da operação para agrupamento', () => {
  const cases = [
    ['OYH019', 'OYH'],
    ['IMP-2024-001', 'IMP'],
    ['op-17', 'OP'],
    ['N/A', 'N/A'],
    ['', 'N/A'],
    ['12345', 'N/A']
  ];
  cases.forEach(([raw, expected]) => assert.equal(ETL.extractOperationAcronym(raw), expected, raw));
});

test('mapeia e importa uma planilha com cabeçalho deslocado', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Relatório de importações'],
    ['Mês', 'Operação', 'Analista', 'Situação', 'Reg DI', 'Valor USD', 'Peso (kg)'],
    [3, 'ABC-1', 'Ana', 'Operação concluída', '10/03/2024', '1.234,56', '2500'],
    [4, 'ABC-2', 'Bruno', 'Em andamento', '', '2.000,00', '1000']
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Importações');
  const result = ETL.parseWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

  assert.equal(result.sheetName, 'Importações');
  assert.equal(result.headerRowNumber, 2);
  assert.equal(result.totalRows, 2);
  assert.equal(result.records[0].month, 3);
  assert.equal(result.records[0].valor, 1234.56);
  assert.equal(result.records[0].peso, 2500);
  assert.equal(result.records[1].regDi, '');
  assert.equal(result.mapping.unmapped.length, 0);
});

test('preserva a moeda de células formatadas e não converte CNY para USD', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Operação', 'Situação', 'Valor USD'],
    ['USD-1', 'Em andamento', 'USD 29.179,20'],
    ['CNY-1', 'Em andamento', 43874.76]
  ]);
  sheet.C3.z = '[$元-804]#,##0.00;\\-[$元-804]#,##0.00';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Importações');
  const result = ETL.parseWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

  assert.equal(result.records[0].valorMoeda, 'USD');
  assert.equal(result.records[0].valorUSD, 29179.2);
  assert.equal(result.records[1].valorMoeda, 'CNY');
  assert.equal(result.records[1].valor, 43874.76);
  assert.equal(result.records[1].valorUSD, null);
  assert.equal(result.currencyCounts.USD, 1);
  assert.equal(result.currencyCounts.CNY, 1);
});

test('prioriza LCL/FCL, classifica o modal e ignora linhas sem campos operacionais', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Pack Month', 'Operação', 'Situação', 'Modalidade', 'LCL/ FCL', 'Reg DI', 'Valor USD', 'Peso (kg)', 'Faturada', 'Arquivado', 'ETA', 'Estimativa Emb', 'Estimativa Atr', 'Atracado', 'RIC'],
    [1, 'ABC-1', 'Operação concluída', 'Conta e ordem', 'FCL 40HQ', '10/03/2024', '1000', '2000', true, false, '20/03/2024', true, true, true, 45680],
    ['#INVALID DATA TYPE', '', '', '', '', '', '', '', '', '', '']
  ]);
  const comments = XLSX.utils.aoa_to_sheet([
    ['Linha 2', 'Observação de teste', 'Ana', '01/01/2024']
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Importações');
  XLSX.utils.book_append_sheet(workbook, comments, 'Comments');
  const result = ETL.parseWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

  assert.equal(result.totalRows, 1);
  assert.equal(result.ignoredRows, 1);
  assert.equal(result.mapping.mapped.find((entry) => entry.field === 'modal').header, 'LCL/ FCL');
  assert.equal(result.records[0].modal, 'FCL 40HQ');
  assert.equal(result.records[0].modalCategory, 'FCL');
  assert.equal(result.records[0].eta, '20/03/2024');
  assert.equal(result.records[0].etaMonth, 3);
  assert.equal(result.records[0].etaYear, 2024);
  assert.equal(result.records[0].modalidade, 'Conta e ordem');
  assert.equal(result.records[0].estimativaEmb, true);
  assert.equal(result.records[0].estimativaAtr, true);
  assert.equal(result.records[0].atracado, true);
  assert.equal(result.records[0].ric, '23/01/2025');
  assert.equal(result.commentCount, 1);
  assert.equal(result.records[0].comments[0].text, 'Observação de teste');
  assert.equal(ETL.isFaturada(result.records[0]), true);
  assert.equal(ETL.isArquivado(result.records[0]), false);
  assert.equal(ETL.classifyModal('1X40HC'), 'FCL');
  assert.equal(ETL.classifyModal('Aéreo'), 'OUTROS');
  assert.equal(ETL.classifyModal('LCL'), 'LCL');
});

test('usa ETS como fallback mensal e ignora processos sem ETA e ETS', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Operação', 'Situação', 'ETA', 'ETS'],
    ['ETS-ONLY', 'Em andamento', '', '26/08/2026'],
    ['NO-SCHEDULE', 'Em andamento', '', '']
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Importações');
  const result = ETL.parseWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));

  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].monthlyReference.month, 8);
  assert.equal(result.records[0].monthlyReference.year, 2026);
  assert.equal(result.records[0].monthlyReference.source, 'ETS');
  assert.equal(result.records[0].etsMonth, 8);
  assert.equal(result.records[0].etsYear, 2026);
  assert.equal(result.records[1].monthlyReference.month, null);
  assert.equal(result.records[1].monthlyReference.year, null);
  assert.equal(result.records[1].monthlyReference.source, null);
});

test('rejeita cabeçalho sem campos operacionais reconhecidos', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Valor USD', 'Peso'],
    ['1.234,56', '100']
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Dados');
  assert.throws(() => ETL.parseWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })), /Não foi possível reconhecer/);
});

test('escapa conteúdo HTML externo antes de renderização', () => {
  assert.equal(UI.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(UI.escapeHtml('" & \' < >'), '&quot; &amp; &#39; &lt; &gt;');
});

test('a planilha real continua sendo importada pelo SheetJS vendorizado (M4)', () => {
  // O bundle vendorizado (0.20.3) precisa ler a planilha de verdade: é o
  // checklist do item M4 do ANALISE.md.
  const bytes = readFileSync(new URL('../data/Importaes-63cc10.xlsx', import.meta.url));
  const result = ETL.parseWorkbook(bytes);

  assert.equal(result.sheetName, '!Importações');
  assert.equal(result.headerRowNumber, 1);
  assert.equal(result.totalRows, 1898);
  assert.equal(result.ignoredRows, 0);
  assert.equal(result.commentCount, 3);
  assert.equal(result.mapping.unmapped.length, 0, 'nenhuma coluna pode ficar sem mapeamento');
  // CNY continua preservado (sem conversão para USD).
  assert.equal(result.currencyCounts.USD, 1873);
  assert.equal(result.currencyCounts.CNY, 25);
  assert.equal(result.records[0].operacao, 'BRP018 - URU-0006-24');
  assert.equal(result.records[0].mercadoria, 'Ácido Fosfórico');
  assert.equal(result.records[0].valorMoeda, 'USD');
});

test('valida snapshots e normaliza filtros restaurados', () => {
  const valid = {
    version: 1,
    records: [{ operacao: 'ABC-1' }],
    meta: { name: 'arquivo.xlsx', sheetName: 'Importações', rowCount: 1, loadedAt: '2024-01-01T00:00:00.000Z' }
  };
  assert.equal(DashboardState.isValidSnapshot(valid), true);
  assert.equal(DashboardState.isValidSnapshot({ ...valid, version: 2 }), false);
  assert.equal(DashboardState.isValidSnapshot({ ...valid, records: [null] }), false);
  assert.equal(DashboardState.isValidSnapshot({ ...valid, meta: { ...valid.meta, loadedAt: '2024-13-01' } }), false);

  const filters = DashboardState.normalizeFilters(
    { ano: '2099', mes: '99', analista: 'Ana', situacao: 'Concluida', operacao: 42 },
    { ano: ['ALL', '2025'], mes: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], analista: ['ALL', 'Ana'], situacao: ['ALL', 'Concluida', 'Andamento'] }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(filters)), {
    operacao: '',
    ano: 'ALL',
    mes: [],
    analista: 'Ana',
    situacao: 'Concluida',
    regDi: 'ALL',
    mercadoria: 'ALL',
    modal: 'ALL',
    incoterm: 'ALL',
    despachante: 'ALL'
  });

  // Snapshots antigos guardavam 'LATEST'; a normalização converte para 'ALL'.
  const legacy = DashboardState.normalizeFilters({ ano: 'LATEST' }, { ano: ['ALL', '2025'] });
  assert.equal(legacy.ano, 'ALL');

  // Filtro de mês multi-seleção: aceita a lista nova, migra os formatos antigos
  // ('ALL' / '7') e descarta valores inválidos ou fora dos meses carregados.
  // (O roundtrip JSON normaliza os arrays vindos do contexto `vm`.)
  const mes = (value, available) => JSON.parse(JSON.stringify(DashboardState.normalizeFilters(value, available).mes));
  assert.deepEqual(mes({}), []);
  assert.deepEqual(mes({ mes: 'ALL' }), []);
  assert.deepEqual(mes({ mes: '7' }), ['7']);
  assert.deepEqual(mes({ mes: ['3', '3', '99'] }), ['3']);
  assert.deepEqual(mes({ mes: ['3', '9'] }, { mes: ['3', '9'] }), ['3', '9']);
  assert.deepEqual(mes({ mes: ['3', '9'] }, { mes: ['3'] }), ['3']);
  // 'NONE' (nenhum mês marcado) sobrevive à validação: com a lista vazia de verdade,
  // o dashboard fica vazio em vez de "voltar" para todos os meses.
  assert.equal(mes({ mes: 'NONE' }), 'NONE');
  assert.equal(mes({ mes: 'NONE' }, { mes: ['3'] }), 'NONE');

  // Sem filtros salvos, o padrão do ano é o corrente; se ele não existir nos
  // dados carregados, a normalização cai para "Todos os anos".
  const anoCorrente = String(new Date().getFullYear());
  assert.equal(DashboardState.normalizeFilters({}).ano, anoCorrente);
  assert.equal(DashboardState.normalizeFilters({}, { ano: ['ALL', anoCorrente] }).ano, anoCorrente);
  assert.equal(DashboardState.normalizeFilters({}, { ano: ['ALL', '1900'] }).ano, 'ALL');
});
