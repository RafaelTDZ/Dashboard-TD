import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Testes das correções de endurecimento que não dependem de DOM real:
// acessibilidade e CSP do index.html, e as garantias do app.js sobre o card
// de resumo, o payload persistido, o agendamento da persistência, o código
// morto, o total exibido na tabela e a guarda do handler do tablist.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const app = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
const normalizeSource = readFileSync(join(root, 'assets', 'js', 'normalize.js'), 'utf8');
const filtersSource = readFileSync(join(root, 'assets', 'js', 'filters.js'), 'utf8');
const viewSource = readFileSync(join(root, 'assets', 'js', 'view.js'), 'utf8');
const snapshotSource = readFileSync(join(root, 'assets', 'js', 'snapshot.js'), 'utf8');
const table = readFileSync(join(root, 'assets', 'js', 'table.js'), 'utf8');
const bannerSource = readFileSync(join(root, 'assets', 'js', 'banner.js'), 'utf8');
const persistence = readFileSync(join(root, 'assets', 'js', 'persistence.js'), 'utf8');
const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');

function tagOf(source, id) {
  const match = source.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'));
  assert.ok(match, 'a tag #' + id + ' não existe no HTML');
  return match[0];
}

function bodyOf(source, signature, indent = 2) {
  const match = source.match(new RegExp(signature + '\\s*\\{([\\s\\S]*?)\\n' + ' '.repeat(indent) + '\\}'));
  assert.ok(match, 'a função ' + signature + ' não foi encontrada');
  return match[1];
}

// ---------------------------------------------------------------------------
// A2 — o card de status tem dois modos: transitório com arquivo, persistente
//       no estado inicial (sem arquivo) e no erro fatal.
// ---------------------------------------------------------------------------

test('o card de status nasce escondido e é revelado pelo app nos dois modos', () => {
  // O HTML começa escondido: quem decide a visibilidade é o app, para o card
  // nunca aparecer antes do dataset ser restaurado.
  const banner = tagOf(html, 'status-banner');
  assert.match(banner, /\shidden[\s>]/);
  assert.match(banner, /aria-live="polite"/);
  assert.ok(html.includes('id="banner-text"'));
  assert.ok(html.includes('id="last-update-time"'));

  // O resumo persistente mora no cabeçalho, FORA do card transitório (F9).
  assert.match(html, /id="dataset-summary"/);
  const header = html.match(/<header\b[\s\S]*?<\/header>/);
  assert.ok(header, 'o <header> não foi encontrado');
  assert.match(header[0], /id="dataset-summary"/, 'o resumo persistente precisa estar no cabeçalho');
  const bannerBlock = html.slice(html.indexOf('id="status-banner"'), html.indexOf('<section id="tab-dashboard"'));
  assert.doesNotMatch(bannerBlock, /id="dataset-summary"/, 'o resumo não pode morar no card de status');

  // O app sabe revelar nos dois modos e sabe esconder de novo.
  const show = bodyOf(bannerSource, 'function showStatusBanner\\(transient\\)', 4);
  assert.match(show, /banner\.hidden = false/, 'o card precisa ser revelado');
  assert.match(show, /STATUS_BANNER_VISIBLE_MS/);

  // O estado inicial (sem arquivo) fica visível; com arquivo, expira. A
  // restauração agora é local-first: o cache pinta a tela em presentSnapshot()
  // e o remoto reconcilia no .then final.
  const init = app.match(/restoreState\(\{[\s\S]*?\}\)\.then\(function \(snapshot\)[\s\S]*?\}\)\.catch/);
  assert.ok(init, 'o init precisa decidir a visibilidade do card');
  assert.match(init[0], /onLocal: function \(cachedSnapshot\)/, 'o cache local precisa ser apresentado antes do remoto');
  assert.match(init[0], /presentSnapshot\(cachedSnapshot\)/, 'o primeiro paint vem do cache');
  assert.match(init[0], /presentSnapshot\(snapshot\)/, 'o remoto reconcilia o que já está na tela');
  const present = bodyOf(snapshotSource, 'function presentSnapshot\\(snapshot, options\\)');
  assert.match(present, /showStatusBanner\(!!snapshot\)/, 'sem dataset o card fica; com dataset ele expira');
});

test('updateBanner escreve o resumo no card e o erro fatal trava a mensagem', () => {
  const update = bodyOf(bannerSource, 'function updateBanner\\(\\)', 4);
  assert.match(update, /setBannerText\(/, 'o resumo precisa ser escrito');
  assert.match(update, /last-update-time/);
  assert.match(update, /Nenhum arquivo carregado/, 'o estado vazio precisa ser observável');

  // O texto mora no #banner-text do próprio card de status.
  const setText = bodyOf(bannerSource, 'function setBannerText\\(html\\)', 4);
  assert.match(setText, /els\['banner-text'\]/);
  assert.match(setText, /statusBannerLocked/, 'setBannerText precisa respeitar o bloqueio de erro');

  // O erro fatal fica no mesmo campo, mas trava o card para que um refresh()
  // posterior não apague a mensagem (B3).
  const fatal = bodyOf(bannerSource, 'function showStatusBannerError\\(message\\)', 4);
  assert.match(fatal, /els\['banner-text'\]/);
  assert.match(fatal, /statusBannerLocked = true/);

  // A importação reabilita o card (o erro deixa de valer).
  const transient = bodyOf(bannerSource, 'function showTransientUpdateBanner\\(\\)', 4);
  assert.match(transient, /statusBannerLocked = false/);
});

// ---------------------------------------------------------------------------
// M7 — Content-Security-Policy
// ---------------------------------------------------------------------------

test('Content-Security-Policy restringe as origens e bloqueia plugins', () => {
  const meta = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/);
  assert.ok(meta, 'a meta de Content-Security-Policy não existe no index.html');
  const content = meta[0].match(/content="([^"]*)"/);
  assert.ok(content, 'a meta de CSP não tem atributo content');
  const csp = content[1];

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/bsczvemaqvladupmdpgl\.supabase\.co/);
  assert.doesNotMatch(csp, /https:\/\/\*\.supabase\.co/, 'connect-src não deve liberar qualquer projeto Supabase');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /worker-src 'self'/);
  // O Tailwind é compilado e não há mais script inline nem eval.
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.match(csp, /font-src 'self' data:/);
  assert.match(csp, /img-src 'self' data:/);
  assert.match(csp, /form-action 'self'/);
});

test('Tailwind é compilado e servido como CSS estático (F7)', () => {
  assert.doesNotMatch(html, /vendor\/tailwind\.js/, 'o Play CDN não deve voltar ao index.html');
  assert.doesNotMatch(html, /tailwind\.config/, 'não deve haver configuração inline do Tailwind');

  const tailwindLink = html.indexOf('href="assets/css/tailwind.css"');
  const stylesLink = html.indexOf('href="assets/css/styles.css"');
  assert.ok(tailwindLink > -1, 'o CSS compilado do Tailwind precisa ser carregado');
  assert.ok(tailwindLink < stylesLink, 'o Tailwind precisa vir antes dos estilos próprios');

  const css = readFileSync(join(root, 'assets', 'css', 'tailwind.css'), 'utf8');
  assert.ok(css.length > 10000, 'o CSS compilado parece incompleto');
  for (const utility of ['.bg-darkbg', '.text-slate-100', '.bg-emerald-600', '.text-slate-400']) {
    assert.ok(css.includes(utility), 'utility ausente no CSS compilado: ' + utility);
  }
});

// ---------------------------------------------------------------------------
// B12 — acessibilidade do menu de mês e do seletor de ano
// ---------------------------------------------------------------------------

test('menu de mês tem papel e controle, e o seletor de ano tem um rótulo só', () => {
  const toggle = tagOf(html, 'filter-mes-toggle');
  assert.match(toggle, /aria-controls="filter-mes-menu"/);
  assert.match(toggle, /aria-haspopup="true"/);
  assert.match(toggle, /aria-expanded="false"/);

  const menu = tagOf(html, 'filter-mes-menu');
  assert.match(menu, /role="group"/);

  // O #monthly-year precisa de UM rótulo no total: o <label for> (sr-only)
  // ou o aria-label. Rótulo duplicado faz o leitor de tela ler duas vezes.
  const yearSelect = tagOf(html, 'monthly-year');
  const ariaLabels = (yearSelect.match(/aria-label/g) || []).length;
  const htmlLabels = (html.match(/<label[^>]*\bfor="monthly-year"/g) || []).length;
  assert.equal(ariaLabels + htmlLabels, 1, 'o #monthly-year precisa de exatamente um rótulo');
});

// ---------------------------------------------------------------------------
// M1 — o payload persistido é a cópia enxuta do registro
// ---------------------------------------------------------------------------

test('snapshot persistido usa a cópia enxuta dos registros', () => {
  assert.match(normalizeSource, /function toPersistedRecord\(record\)/);
  assert.match(normalizeSource, /if \(key === '_search'\) return;/, 'o índice derivado não pode ser persistido');
  // A regra de "vazio" tem uma única implementação (DashboardState.isEmptyValue).
  assert.match(stateSource, /isEmptyValue: isEmptyValue/);
  assert.match(normalizeSource, /var isEmptyValue = deps\.isEmptyValue;/);
  assert.match(normalizeSource, /if \(isEmptyValue\(value\)\) return;/);
  assert.doesNotMatch(normalizeSource, /function isEmptyPersistedValue/);
  assert.match(app, /isEmptyValue: global\.DashboardState\.isEmptyValue/);
  assert.match(persistence, /records: state\.dataset\.map\(toPersistedRecord\)/);
  // O mesmo recorte vale para o cache local (persistLocal usa buildSnapshot).
  assert.match(persistence, /function persistLocal\(\)\s*\{[\s\S]*?var snapshot = buildSnapshot\(\);/);
});

// ---------------------------------------------------------------------------
// B4 — schedulePersist não se reagenda indefinidamente
// ---------------------------------------------------------------------------

test('persistência local tem limite de tentativas', () => {
  const limit = persistence.match(/var PERSIST_RETRY_LIMIT = (\d+);/);
  assert.ok(limit, 'PERSIST_RETRY_LIMIT não existe (a persistência se reagenda para sempre)');
  assert.ok(Number(limit[1]) > 0 && Number.isFinite(Number(limit[1])), 'o limite precisa ser um número finito');
  assert.match(persistence, /if \(persistRetryCount < PERSIST_RETRY_LIMIT\)/);
  // Com a validação pendente, o timer para de reagendar ao atingir o limite.
  const scheduled = bodyOf(persistence, 'function runScheduledPersist\\(\\)');
  assert.match(scheduled, /persistRetryCount < PERSIST_RETRY_LIMIT/);
});

// Remove comentários de linha e de bloco sem tocar nas strings: só o código
// executável interessa quando o teste procura "código morto".
function stripJsComments(source) {
  let out = '';
  let index = 0;
  let mode = 'code';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'code') {
      if (char === '/' && next === '/') { mode = 'line'; index += 2; continue; }
      if (char === '/' && next === '*') { mode = 'block'; index += 2; continue; }
      if (char === "'") { mode = 'single'; out += char; index += 1; continue; }
      if (char === '"') { mode = 'double'; out += char; index += 1; continue; }
      if (char === '`') { mode = 'template'; out += char; index += 1; continue; }
      out += char; index += 1; continue;
    }
    if (mode === 'line') {
      if (char === '\n') { mode = 'code'; out += char; }
      index += 1;
      continue;
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { mode = 'code'; index += 2; continue; }
      index += 1;
      continue;
    }
    out += char; index += 1;
    if (char === '\\') { out += source[index] || ''; index += 1; continue; }
    if ((mode === 'single' && char === "'") || (mode === 'double' && char === '"') || (mode === 'template' && char === '`')) mode = 'code';
  }
  return out;
}

// ---------------------------------------------------------------------------
// B5 — código morto removido
// ---------------------------------------------------------------------------

test('código morto de LATEST, getAnalistaMode e schedulePersist(remote) foi removido', () => {
  // charts.js não conhece mais o ano "LATEST" (o select só tem ALL + anos).
  // Os comentários são removidos antes da busca: o código documenta o valor
  // antigo no texto, mas isso não é código executável.
  const chartsCode = stripJsComments(charts);
  assert.ok(chartsCode.length > charts.length * 0.8, 'o removedor de comentários quebrou o arquivo');
  assert.doesNotMatch(chartsCode, /LATEST/);
  assert.doesNotMatch(chartsCode, /getAnalistaMode/);

  // app.js (com os módulos filters.js e view.js, para onde as chamadas
  // migraram) não passa mais parâmetro para schedulePersist.
  const appCode = stripJsComments(app + '\n' + filtersSource + '\n' + viewSource);
  const calls = [...appCode.matchAll(/schedulePersist\(([^)]*)\)/g)].map((match) => match[1].trim());
  assert.ok(calls.length > 0, 'schedulePersist não é chamado em lugar nenhum');
  for (const argument of calls) {
    assert.equal(argument, '', 'schedulePersist não deve receber parâmetros (o `remote` morreu)');
  }

  // O `isSuperset` do compareRecords continua exposto como API pública do
  // state.js (coberto por tests/compare.test.mjs); o app.js não depende dele
  // para decidir — era esse o "nunca consumido" do item B5.
  const state = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
  assert.match(state, /isSuperset/);
  assert.doesNotMatch(appCode, /isSuperset/);
});

// ---------------------------------------------------------------------------
// B9 — a tabela mostra o total do dataset, não só o filtrado
// ---------------------------------------------------------------------------

test('tabela mostra o total do dataset junto do total filtrado', () => {
  const render = bodyOf(table, 'function renderTable\\(\\)', 4);
  assert.match(render, /var datasetTotal = state\.dataset\.length;/);
  assert.match(render, /' filtrados \(' \+ UI\.formatNumber\(datasetTotal\) \+ ' no total\)'/);
  assert.match(render, /' filtrados de ' \+ UI\.formatNumber\(datasetTotal\) \+ ' registros no dataset\.'/);
  assert.match(render, /els\['table-count'\]\.innerText/);
  assert.match(render, /els\['table-count'\]\.title/);
  assert.doesNotMatch(render, /' de ' \+ UI\.formatNumber\(total\) \+ ' de '/, 'a contagem não repete "de ... de ..."');
});

// ---------------------------------------------------------------------------
// B13 — guarda no handler de teclado do tablist
// ---------------------------------------------------------------------------

test('handler do tablist não quebra quando nenhuma aba está selecionada', () => {
  const start = app.indexOf(".tablist').addEventListener('keydown'");
  assert.ok(start > -1, 'o handler de teclado do tablist não foi encontrado');
  const handler = app.slice(start, app.indexOf('});', start));
  assert.match(handler, /if \(!selected \|\| !selected\.dataset\) return;/);
  assert.match(handler, /if \(active === -1\) return;/);
});

// ---------------------------------------------------------------------------
// M5 — o fallback de parsing não repete o parse na thread principal
// ---------------------------------------------------------------------------

test('fallback de parsing não repete o parse depois que a promessa já resolveu', () => {
  const fallback = importSource.match(/var parseOnMainThread = function \(\) \{([\s\S]*?)\n {8}\};/);
  assert.ok(fallback, 'parseOnMainThread não foi encontrado');
  const guards = fallback[1].match(/if \(settled\) return;/g) || [];
  assert.equal(guards.length, 2, 'a guarda `settled` precisa existir antes e dentro do parse assíncrono');
  // O caminho do Worker que falha também passa pela função com a guarda.
  assert.match(importSource, /worker\.onerror = function \(event\) \{[\s\S]*?parseOnMainThread\(\);/);
});

// ---------------------------------------------------------------------------
// F3 — o HEAD do analytics tem timeout curto e limpa o timer
// ---------------------------------------------------------------------------

test('analytics aplica timeout de 5s ao HEAD e limpa o timer em sucesso e falha', async () => {
  const analytics = readFileSync(join(root, 'assets', 'js', 'analytics.js'), 'utf8');
  const start = analytics.indexOf('const INSIGHTS_PATH');
  const end = analytics.indexOf('// Initialize Vercel Analytics');
  assert.ok(start > -1 && end > start, 'não foi possível isolar a lógica do analytics');
  const code = analytics.slice(start, end);
  assert.match(code, /const INSIGHTS_TIMEOUT_MS = 5000;/, 'o timeout precisa ser explícito e curto');

  // Avalia só o bloco puro (sem o import do vendor) para exercitar o helper
  // com fetch/AbortController controlados.
  const factory = new Function(
    'fetch', 'setTimeout', 'clearTimeout', 'AbortController', 'location',
    '"use strict";\n' + code + '\nreturn { shouldInjectAnalytics: shouldInjectAnalytics };'
  );

  let fetchCall = null;
  let scheduled = null;
  let cleared = null;
  const fakeFetch = (url, options) => {
    fetchCall = { url, options };
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  const api = factory(
    fakeFetch,
    (fn, ms) => { scheduled = { fn, ms, id: 7 }; return 7; },
    (id) => { cleared = id; },
    AbortController,
    { hostname: 'dashboard.exemplo.com' }
  );

  const pending = api.shouldInjectAnalytics();
  assert.equal(fetchCall.url, '/_vercel/insights/script.js');
  assert.equal(fetchCall.options.method, 'HEAD');
  assert.ok(fetchCall.options.signal, 'o HEAD precisa usar AbortController');
  assert.equal(scheduled.ms, 5000, 'o HEAD precisa expirar em 5s');

  scheduled.fn(); // dispara o abort
  assert.equal(await pending, false, 'falha/timeout do HEAD devolve false');
  assert.equal(cleared, 7, 'o timer precisa ser limpo quando o fetch falha');

  // Sucesso: resposta ok, timer limpo e injeção liberada.
  let successful = null;
  const apiOk = factory(
    (url, options) => { successful = { url, options }; return Promise.resolve({ ok: true }); },
    (fn, ms) => { scheduled = { fn, ms, id: 9 }; return 9; },
    (id) => { cleared = id; },
    AbortController,
    { hostname: 'dashboard.exemplo.com' }
  );
  assert.equal(await apiOk.shouldInjectAnalytics(), true, 'HEAD ok libera a injeção');
  assert.equal(successful.options.method, 'HEAD');
  assert.equal(cleared, 9, 'o timer precisa ser limpo quando o fetch resolve');
});
