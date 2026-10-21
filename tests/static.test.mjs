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
const table = readFileSync(join(root, 'assets', 'js', 'table.js'), 'utf8');
const bannerSource = readFileSync(join(root, 'assets', 'js', 'banner.js'), 'utf8');

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
  assert.match(table, /Comentários;Linha Excel/);
  assert.match(table, /Valor informado;Moeda;Valor USD/);
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

test('filtro de ano usa o ano corrente como padrão e não oculta registros sem ETA/ETS', () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const state = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
  assert.match(app, /selectedYear != null && getMonthlyReferenceYear/);
  assert.doesNotMatch(app, /if \(!state\.isDemo\) return false/);
  // "Ano mais recente" (LATEST) foi removido: o padrão do filtro é o ano corrente.
  assert.doesNotMatch(app, /'LATEST'/);
  assert.doesNotMatch(html, /value="LATEST"/);
  assert.match(state, /ano: String\(new Date\(\)\.getFullYear\(\)\)/);
  // Se o ano corrente não existir nos dados, o filtro cai para "Todos os anos".
  assert.match(app, /values\.indexOf\(String\(current\)\) > -1 \? String\(current\) : 'ALL'/);
});

test('filtros dimensionam pelo conteúdo (sem largura fixa que corta texto)', () => {
  const styles = readFileSync(join(root, 'assets', 'css', 'styles.css'), 'utf8');
  // Os controles fluem em flex e cada um acompanha o próprio conteúdo.
  assert.match(styles, /\.ui-filter-panel > \.flex-grow \{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
  // Chrome/Edge dimensionam o select pela opção selecionada e o input pelo texto.
  assert.match(styles, /field-sizing: content/);
  // Nenhuma regra volta a esticar os filtros para uma coluna de largura fixa.
  assert.doesNotMatch(styles, /\.ui-filter-panel (input|select)[^{]*\{[^}]*width: 100%/);
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
  // Multi-seleção: o registro passa quando o mês dele está entre os marcados.
  assert.match(app, /selectedMonths\.length && selectedMonths\.indexOf\(String\(getMonthlyReferenceMonth\(item\)\)\) === -1/);
  assert.doesNotMatch(app, /String\(item\.month\) !== filters\.mes/);
  assert.match(table, /monthName\(getMonthlyReferenceMonth\(item\)\)/);
});

test('filtro de mês permite marcar vários meses (multi-seleção)', () => {
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const state = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
  const styles = readFileSync(join(root, 'assets', 'css', 'styles.css'), 'utf8');
  // Botão abre um menu de caixinhas, com "Todos os Meses" + lista de meses.
  assert.match(html, /id="filter-mes-toggle"[^>]+aria-expanded="false"/);
  assert.match(html, /id="filter-mes-menu"[^>]*\shidden[\s>]/);
  assert.match(html, /id="filter-mes-list"/);
  assert.match(app, /function toggleMonth/);
  assert.match(app, /function toggleAllMonths/);
  assert.match(app, /state\.filters\.mes = effective\.length === 0 \? 'NONE' : \(effective\.length === available\.length \? \[\] : effective\)/);
  // Nenhum mês marcado = dashboard vazio; o interruptor alterna tudo/nenhum.
  assert.match(app, /getMonthFilterMode\(\) === 'none'/);
  assert.match(app, /Selecionar meses/);
  // O estado guarda a lista marcada; lista vazia = todos os meses.
  assert.match(state, /mes: \[\]/);
  assert.match(state, /Array\.isArray\(value\)/);
  // O menu tem estilo nos dois temas.
  assert.match(styles, /\.ui-month-menu \{/);
  assert.match(styles, /body\[data-ui-style="modern"\] \.ui-month-menu/);
  // O menu cabe os 12 meses + "Todos os Meses" sem rolagem (o teto de 100vh
  // só evita estourar a janela em telas muito baixas).
  assert.match(styles, /max-height: min\(22\.5rem, calc\(100vh - 7rem\)\)/);
  // Sem espaço abaixo do botão, o menu abre para cima em vez de sair da tela.
  assert.match(app, /ui-month-menu-up/);
  assert.match(styles, /\.ui-month-menu-up \{[\s\S]*?bottom: calc\(100% \+ 0\.35rem\)/);
  // As caixinhas do menu não herdam a largura/flex dos selects do painel.
  assert.match(styles, /\.ui-filter-panel input:not\(\[type="checkbox"\]\)/);
});

test('listas dos selects abrem no estilo do menu de mês (sem azul nativo)', () => {
  const styles = readFileSync(join(root, 'assets', 'css', 'styles.css'), 'utf8');
  // Chrome/Edge atual: a lista suspensa inteira é estilizável via base-select.
  assert.match(styles, /@supports \(appearance: base-select\)/);
  assert.match(styles, /select,\s*::picker\(select\) \{\s*appearance: base-select;/);
  assert.match(styles, /::picker\(select\) \{\s*margin-top: 0\.35rem;[\s\S]*?background: #0f172a;/);
  // O destaque da opção selecionada/sob o cursor é cinza-ardósia, não o azul do sistema.
  assert.match(styles, /option:hover,[\s\S]*?background: #1e293b;/);
  assert.match(styles, /option:checked \{\s*background: #1e293b;/);
  // Navegadores sem suporte ainda perdem o fundo branco do popup nativo.
  assert.match(styles, /@supports not \(appearance: base-select\)/);
  assert.match(styles, /select option:checked \{\s*background-color: #334155;/);
  // Tema claro (Novo) tem a versão dele, igual à do menu de mês.
  assert.match(styles, /body\[data-ui-style="modern"\] ::picker\(select\)/);
  assert.match(styles, /body\[data-ui-style="modern"\] option:checked \{\s*background: #f4f4f5;/);
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
test('card de status é transitório com arquivo e persistente no estado vazio', () => {
  const styles = readFileSync(join(root, 'assets', 'css', 'styles.css'), 'utf8');
  const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');

  // Começa escondido: o card não pode ficar visível antes de o app decidir.
  assert.match(html, /id="status-banner"[^>]*\shidden[\s>]/);

  // A classe `flex` do Tailwind sobrescrevia o `display: none` do atributo `hidden`,
  // então o card continuava visível mesmo depois do timer de fechamento.
  assert.match(styles, /#status-banner\[hidden\]\s*\{\s*display:\s*none !important;/);
  assert.match(styles, /#status-banner\.is-fading-out\s*\{[^}]*opacity: 0;/);

  // refresh()/restoreState() atualizam o texto do card, mas nunca a visibilidade.
  const updateBanner = bannerSource.match(/function updateBanner\(\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.doesNotMatch(updateBanner, /hidden|classList/);

  // O texto do resumo mora no #banner-text (o próprio card de status).
  assert.match(bannerSource, /function setBannerText\(html\)/);
  const setBannerText = bannerSource.match(/function setBannerText\(html\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.match(setBannerText, /els\['banner-text'\]/);

  // A importação revela o card em modo transitório.
  const revealCallSites = [...app.matchAll(/^\s+showTransientUpdateBanner\(\);/gm)];
  assert.equal(revealCallSites.length, 1);
  const upload = app.match(/function handleFileUpload\(event\)\s*\{([\s\S]*?)\r?\n  \}\r?\n/)[1];
  const applyImport = app.match(/function applyImportedDataset\([^)]*\)\s*\{([\s\S]*?)\r?\n  \}\r?\n/)[1];
  assert.ok(
    /showTransientUpdateBanner\(\);/.test(upload) || /showTransientUpdateBanner\(\);/.test(applyImport),
    'o fluxo de upload deve revelar o card de status'
  );

  // E ele volta a se esconder sozinho, fechando de verdade via hideStatusBanner().
  assert.match(bannerSource, /var STATUS_BANNER_VISIBLE_MS = \d+;/);
  const show = bannerSource.match(/function showStatusBanner\(transient\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.match(show, /setTimeout/);
  assert.match(show, /hideStatusBanner\(\)/);
  assert.match(show, /if \(!transient\) return;/, 'sem timer quando o card deve ficar visível');
  const hide = bannerSource.match(/function hideStatusBanner\(\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.match(hide, /clearStatusBannerTimers\(banner\)/);
  assert.match(hide, /banner\.hidden = true/);

  // Falha fatal de init mostra o card sem destruir os filhos usados por updateBanner().
  assert.match(bannerSource, /function showStatusBannerError\(message\)/);
  assert.doesNotMatch(bannerSource, /banner\.textContent = error\.message/);
});


test('migrations espelham o histórico remoto e mantêm um único snapshot', () => {
  const migrationsDir = join(root, 'supabase', 'migrations');
  const baseline = readFileSync(join(migrationsDir, '20261009142126_create_excel_imports.sql'), 'utf8');
  const migration = readFileSync(join(migrationsDir, '20261019141213_excel_imports_single_latest.sql'), 'utf8');

  assert.match(baseline, /create table if not exists public\.excel_imports/);
  assert.match(baseline, /enable row level security/);
  assert.match(baseline, /grant select, insert on table public\.excel_imports to anon;/);

  assert.match(migration, /create or replace function public\.excel_imports_enforce_single_latest\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /before insert on public\.excel_imports/);
  assert.match(migration, /SNAPSHOT_MISSING_RECORDS/);
  assert.match(migration, /SNAPSHOT_DUPLICATE_KEYS/);
  assert.match(migration, /delete from public\.excel_imports/);

  const versions = readdirSync(migrationsDir)
    .map((name) => name.match(/^(\d{14})_/))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.deepEqual(versions, ['20261009142126', '20261019141213', '20261020120000']);
});

test('migração de endurecimento fecha o bypass de privilégios e o DELETE sem WHERE', () => {
  // A1 — o papel `anon` não pode mais truncar a tabela (a RLS não cobre TRUNCATE).
  const harden = readFileSync(join(root, 'supabase', 'migrations', '20261020120000_harden_excel_imports.sql'), 'utf8');
  assert.match(harden, /revoke all on table public\.excel_imports from anon, authenticated;/);
  assert.match(harden, /grant select, insert on table public\.excel_imports to anon;/);

  // A4 (REGRESSÃO CRÍTICA) — o trigger precisa de WHERE no DELETE.
  // O papel `authenticator` do projeto carrega `safeupdate`
  // (session_preload_libraries = supautils, safeupdate) e recusa qualquer
  // DELETE sem cláusula WHERE. O `delete from public.excel_imports;` sem WHERE
  // (migration 20261019141213) fazia TODA importação falhar em produção com
  // "DELETE requires a WHERE clause" (SQLSTATE 21000). A migration nova
  // corrige isso com `where id in (select id from public.excel_imports)`,
  // que apaga exatamente as mesmas linhas.
  // Os comentários são removidos antes da varredura: o SQL documenta o
  // comando antigo no texto e não pode ser confundido com código executável.
  const sqlCode = (source) => source
    // Normaliza o fim de linha antes de remover comentários: no Windows o
    // checkout pode vir em CRLF e `--.*$` não casaria com o `\r` residual,
    // deixando o `delete ...;` comentado passar como código executável.
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const deletesWithoutWhere = (source) => [...sqlCode(source).matchAll(/delete\s+from\s+public\.excel_imports([\s\S]*?);/gi)]
    .filter((match) => !/\bwhere\b/i.test(match[1]));
  assert.equal(deletesWithoutWhere(harden).length, 0, 'a migration nova não pode ter DELETE sem WHERE');
  assert.match(harden, /delete from public\.excel_imports\s+where id in \(select id from public\.excel_imports\);/i);

  // A migração antiga é a que tem o bug — e a nova é a que corrige.
  const buggy = readFileSync(join(root, 'supabase', 'migrations', '20261019141213_excel_imports_single_latest.sql'), 'utf8');
  assert.equal(deletesWithoutWhere(buggy).length, 1, 'a migration antiga tem o DELETE sem WHERE (o bug corrigido depois)');
  assert.match(buggy, /delete from public\.excel_imports;/);

  // M2 — os timestamps são do servidor; o que o cliente envia é ignorado.
  assert.match(harden, /new\.created_at := now\(\);/);
  assert.match(harden, /new\.updated_at := now\(\);/);

  // M3 — a invariante "uma única linha" não depende só do trigger.
  assert.match(harden, /create unique index if not exists excel_imports_singleton\s+on public\.excel_imports \(\(true\)\);/);
  assert.match(harden, /add constraint excel_imports_records_is_array\s+check \(jsonb_typeof\(records\) = 'array' and jsonb_array_length\(records\) > 0\);/);

  // M6 — a função SECURITY DEFINER sai do alcance do cliente.
  assert.match(harden, /revoke execute on function public\.excel_imports_enforce_single_latest\(\)\s+from public, anon, authenticated;/);

  // M8 — search_path restrito (a versão antiga usava `public, pg_temp`).
  assert.match(harden, /set search_path = ''/);
  assert.doesNotMatch(harden, /search_path = public, pg_temp/);

  // B7 — `updated_at` passa a ser mantida por um trigger de UPDATE.
  assert.match(harden, /create or replace function public\.touch_updated_at\(\)/);
  assert.match(harden, /new\.updated_at := now\(\);/);
  assert.match(harden, /create trigger excel_imports_touch_updated_at\s+before update on public\.excel_imports/);
});
