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
const charts = readFileSync(join(root, 'assets', 'js', 'charts.js'), 'utf8');

function tagOf(source, id) {
  const match = source.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'));
  assert.ok(match, 'a tag #' + id + ' não existe no HTML');
  return match[0];
}

function bodyOf(source, signature) {
  const match = source.match(new RegExp(signature + '\\s*\\{([\\s\\S]*?)\\n  \\}'));
  assert.ok(match, 'a função ' + signature + ' não foi encontrada');
  return match[1];
}

// ---------------------------------------------------------------------------
// A2 — o resumo do dataset é persistente; o banner de status é transitório
// ---------------------------------------------------------------------------

test('card de resumo do dataset é sempre visível e o banner de status continua transitório', () => {
  const summary = tagOf(html, 'dataset-summary');
  assert.doesNotMatch(summary, /\shidden[\s>]/, 'o card de resumo não pode nascer escondido');
  assert.doesNotMatch(summary, /class="[^"]*\bhidden\b/, 'o card de resumo não pode usar a classe hidden');
  assert.match(summary, /role="status"/);
  assert.match(summary, /aria-live="polite"/);

  assert.ok(html.includes('id="dataset-summary-text"'));
  assert.ok(html.includes('id="dataset-summary-time"'));

  // O texto inicial convida a carregar a planilha (estado vazio observável).
  assert.match(html, /id="dataset-summary-text"[^>]*>Nenhum arquivo carregado\./);

  // O banner continua começando escondido: ele é só o aviso transitório.
  const banner = tagOf(html, 'status-banner');
  assert.match(banner, /\shidden[\s>]/);
});

test('updateBanner escreve no card de resumo e o erro fatal escreve no banner', () => {
  const update = bodyOf(app, 'function updateBanner\\(\\)');
  assert.match(update, /setDatasetSummary\(/, 'o resumo persistente precisa ser atualizado');
  assert.doesNotMatch(update, /banner-text/, 'updateBanner não pode escrever no banner transitório');
  assert.doesNotMatch(update, /last-update-time/);

  // O erro fatal (sem timer) fica no banner; o card de resumo não é apagado.
  const fatal = bodyOf(app, 'function showStatusBannerError\\(message\\)');
  assert.match(fatal, /els\['banner-text'\]/);
  assert.doesNotMatch(fatal, /setDatasetSummary\(/);

  // O banner transitório também escreve no #banner-text (é o dono do campo).
  const transient = bodyOf(app, 'function showTransientUpdateBanner\\(\\)');
  assert.match(transient, /els\['banner-text'\]/);
  assert.doesNotMatch(transient, /setDatasetSummary\(/);
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
  assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /worker-src 'self'/);
  // 'unsafe-inline' é obrigatório por causa do tailwind.config inline.
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.match(csp, /font-src 'self' data:/);
  assert.match(csp, /img-src 'self' data:/);
  assert.match(csp, /form-action 'self'/);
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
  assert.match(app, /function toPersistedRecord\(record\)/);
  assert.match(app, /if \(key === '_search'\) return;/, 'o índice derivado não pode ser persistido');
  assert.match(app, /records: state\.dataset\.map\(toPersistedRecord\)/);
  // O mesmo recorte vale para o cache local (persistLocal usa buildSnapshot).
  assert.match(app, /function persistLocal\(\)\s*\{[\s\S]*?var snapshot = buildSnapshot\(\);/);
});

// ---------------------------------------------------------------------------
// B4 — schedulePersist não se reagenda indefinidamente
// ---------------------------------------------------------------------------

test('persistência local tem limite de tentativas', () => {
  const limit = app.match(/var PERSIST_RETRY_LIMIT = (\d+);/);
  assert.ok(limit, 'PERSIST_RETRY_LIMIT não existe (a persistência se reagenda para sempre)');
  assert.ok(Number(limit[1]) > 0 && Number.isFinite(Number(limit[1])), 'o limite precisa ser um número finito');
  assert.match(app, /if \(persistRetryCount < PERSIST_RETRY_LIMIT\)/);
  // Com a validação pendente, o timer para de reagendar ao atingir o limite.
  const scheduled = bodyOf(app, 'function runScheduledPersist\\(\\)');
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

  // app.js não passa mais parâmetro para schedulePersist.
  const appCode = stripJsComments(app);
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
  const render = bodyOf(app, 'function renderTable\\(\\)');
  assert.match(render, /var datasetTotal = state\.dataset\.length;/);
  assert.match(render, /' de ' \+ global\.UI\.formatNumber\(datasetTotal\)/);
  assert.match(render, /els\['table-count'\]\.innerText/);
  assert.match(render, /els\['table-count'\]\.title/);
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
  const fallback = app.match(/var parseOnMainThread = function \(\) \{([\s\S]*?)\n      \};/);
  assert.ok(fallback, 'parseOnMainThread não foi encontrado');
  const guards = fallback[1].match(/if \(settled\) return;/g) || [];
  assert.equal(guards.length, 2, 'a guarda `settled` precisa existir antes e dentro do parse assíncrono');
  // O caminho do Worker que falha também passa pela função com a guarda.
  assert.match(app, /worker\.onerror = function \(event\) \{[\s\S]*?parseOnMainThread\(\);/);
});
