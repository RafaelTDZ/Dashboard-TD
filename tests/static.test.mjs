import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');

function jsFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(directory, entry.name));
}

test('todos os scripts JavaScript têm sintaxe válida', () => {
  const files = jsFiles(join(root, 'assets', 'js'));
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
});

test('servidor local e manifesto de dependências são válidos', () => {
  const serve = join(root, 'tools', 'serve.mjs');
  const result = spawnSync(process.execPath, ['--check', serve], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(readFileSync(join(root, 'vendor', 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.libraries) && manifest.libraries.length >= 4);
  for (const library of manifest.libraries) {
    assert.equal(existsSync(join(root, library.entry)), true, library.entry);
    const hash = createHash('sha256').update(readFileSync(join(root, library.entry))).digest('hex').toUpperCase();
    assert.equal(hash, library.sha256, library.entry);
    assert.match(library.origin, /^https:\/\//);
  }
});

test('referências locais do HTML existem', () => {
  const references = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith('data:') && !/^https?:\/\//.test(reference));
  assert.ok(references.length > 0);
  for (const reference of references) assert.equal(existsSync(join(root, reference)), true, reference);
});

test('IDs literais usados pelo JavaScript existem no HTML', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const references = jsFiles(join(root, 'assets', 'js'))
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]));
  assert.deepEqual([...new Set(references)].filter((id) => !ids.has(id)), []);
});

test('Worker e carregamento sob demanda apontam para bibliotecas locais', () => {
  const worker = readFileSync(join(root, 'assets', 'js', 'worker.js'), 'utf8');
  assert.equal(existsSync(resolve(root, 'assets', 'js', '../../vendor/xlsx.full.min.js')), true);
  assert.match(worker, /importScripts\('\.\.\/\.\.\/vendor\/xlsx\.full\.min\.js', 'etl\.js'\)/);
  assert.match(readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8'), /vendor\/xlsx\.full\.min\.js/);
  assert.doesNotMatch(html, /<script[^>]+vendor\/xlsx\.full\.min\.js/);
});

test('importador preserva campos auxiliares e observações da planilha', () => {
  const etl = readFileSync(join(root, 'assets', 'js', 'etl.js'), 'utf8');
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.match(etl, /parseCommentsSheet/);
  assert.match(etl, /estimativaEmb/);
  assert.match(etl, /modalidade/);
  assert.match(etl, /commentCount/);
  assert.match(etl, /resolveMonthlyReference/);
  assert.match(etl, /source: 'ETS'/);
  assert.match(etl, /parseCurrencyValue/);
  assert.match(etl, /valorMoeda/);
  assert.match(etl, /extractOperationAcronym/);
  assert.match(etl, /raw: false/);
  assert.match(app, /commentCount/);
  assert.match(app, /Comentários;Linha Excel/);
  assert.match(app, /Valor informado;Moeda;Valor USD/);
  assert.match(app, /valorUSD/);
  assert.match(readFileSync(join(root, 'assets', 'js', 'ui.js'), 'utf8'), /formatCurrencyFull/);
});

test('configuração inline e estrutura de acessibilidade permanecem válidas', () => {
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const source of inlineScripts) assert.doesNotThrow(() => new Function(source));
  assert.match(html, /role="tablist"[^>]+aria-orientation="horizontal"/);
  assert.match(html, /id="modal"[^>]+aria-hidden="true"/);
  assert.match(html, /id="monthly-insight"[^>]+aria-live="polite"/);
  assert.match(html, /id="monthly-year"[^>]+aria-label="Filtrar todo o dashboard por ano"/);
  assert.doesNotMatch(html, /id="monthly-insight"[\s\S]*?id="monthly-year"/);
  const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');
  assert.match(charts, /'Janeiro'.*'Fevereiro'.*'Março'/s);
  assert.match(charts, /MONTH_NAMES\[index\]/);
  assert.match(charts, /monthlyReference/);
  assert.match(charts, /source === 'ETA' \|\| reference\.source === 'ETS'/);
  assert.match(charts, /sem ETA\/ETS/);
  assert.match(charts, /options\.isDemo === false/);
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /isDemo: state\.isDemo/);
  assert.match(app, /'monthly-year': 'ano'/);
  assert.match(app, /filters\.ano/);
  assert.match(app, /getMonthlyReferenceYear/);
  assert.match(charts, /monthlyYear/);
  assert.match(html, /id="monthly-year"/);
  for (const chart of ['analistas', 'mensal', 'origem', 'destino', 'incoterm', 'agentes', 'operacao-siglas']) {
    assert.match(html, new RegExp(`id="chart-${chart}-summary"`));
  }
  assert.match(charts, /countBy\(data, 'agente'\)/);
  assert.match(charts, /countBy\(data, 'operacaoSigla'\)/);
});

test('filtro de ano não oculta registros sem ETA/ETS quando não há anos datados', () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /selectedYear != null && getMonthlyReferenceYear/);
  assert.doesNotMatch(app, /if \(!state\.isDemo\) return false/);
});

test('tooltips exibem o nome da categoria uma única vez e só sob o cursor', () => {
  const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');
  assert.doesNotMatch(charts, /return ' ' \+ ctx\.label \+ ':'/);
  assert.match(charts, /interaction: \{ intersect: true, mode: 'index' \}/);
});

test('filtro de mês exibe o nome do mês em vez do número', () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /global\.ETL\.monthName\(month\)/);
  assert.doesNotMatch(app, /'Mês ' \+ month/);
  const etl = readFileSync(join(root, 'assets', 'js', 'etl.js'), 'utf8');
  assert.match(etl, /'Novembro'/);
  assert.match(etl, /monthName: monthName/);
});

test('filtro e coluna de mês usam a mesma referência de data (ETA/ETS)', () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /function getMonthlyReferenceMonth/);
  assert.match(app, /state\.dataset\.map\(getMonthlyReferenceMonth\)/);
  assert.match(app, /String\(getMonthlyReferenceMonth\(item\)\) !== filters\.mes/);
  assert.doesNotMatch(app, /String\(item\.month\) !== filters\.mes/);
  assert.match(app, /monthName\(getMonthlyReferenceMonth\(item\)\)/);
});

test('coluna Reg DI ordena por data cronológica e não por texto', () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.match(app, /case 'regDi':/);
  assert.match(app, /regDiMatch\[3\]\) \* 10000 \+ Number\(regDiMatch\[2\]\) \* 100 \+ Number\(regDiMatch\[1\]\)/);
  assert.doesNotMatch(app, /case 'regDi': return String\(item\.regDi/);
});

test('média mensal usa janela móvel de 12 meses até o mês atual', () => {
  const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');
  assert.match(charts, /const currentMonthIndex = now\.getFullYear\(\) \* 12 \+ now\.getMonth\(\)/);
  assert.match(charts, /const windowStartIndex = currentMonthIndex - 11/);
  assert.match(charts, /absolute >= windowStartIndex && absolute <= currentMonthIndex/);
  assert.match(charts, /trailingAverage = usesScheduleDate \? trailingTotal \/ 12 : null/);
  assert.match(charts, /context\.trailingAverage != null/);
  assert.match(charts, /label: 'Média 12m'/);
  assert.match(charts, /média 12m:/);
});

test('cards de agente aplicam apelidos confirmados além da caixa/acento', () => {
  const etl = readFileSync(join(root, 'assets', 'js', 'etl.js'), 'utf8');
  const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');
  assert.match(etl, /AGENT_ALIASES/);
  assert.match(etl, /'asia': 'Asia Shipping'/);
  assert.match(etl, /'linea': 'Línea Logistics'/);
  assert.match(etl, /resolveAgentAlias/);
  assert.match(charts, /global\.ETL\.resolveAgentAlias/);
});

test('seletor de estilo permite alternar entre o visual novo e o antigo', () => {
  const styles = readFileSync(join(root, 'assets', 'css', 'styles.css'), 'utf8');
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');
  assert.match(html, /<body data-ui-style="classic"/);
  assert.match(html, /id="style-switcher"[^>]*role="group"[^>]*aria-label="Escolher estilo visual"/);
  assert.match(html, /id="style-option-modern"[^>]*data-ui-style-option="modern"[^>]*aria-pressed="false"/);
  assert.match(html, /id="style-option-classic"[^>]*data-ui-style-option="classic"[^>]*aria-pressed="true"/);
  assert.match(styles, /body\[data-ui-style="modern"\]/);
  assert.match(styles, /color-scheme: light/);
  assert.match(styles, /background-color: #fafafa/);
  assert.match(styles, /border-color: #e4e4e7/);
  assert.match(styles, /background: #18181b/);
  assert.doesNotMatch(styles, /#070b18/);
  assert.match(app, /uiStyle: 'classic'/);
  assert.match(app, /function applyVisualStyle/);
  assert.match(app, /global\.Charts\.setStyle/);
  assert.match(charts, /COLOR_PALETTES/);
  assert.match(charts, /classic: \{\s+brand: '#3b82f6'/);
  assert.match(charts, /text: '#71717a'/);
  assert.match(charts, /global\.Charts = \{ init: init, render: render, setStyle: setStyle \}/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});
