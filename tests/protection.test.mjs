import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// F11 — proteção da escrita pública.
//
// A escrita do snapshot é pública (a chave publishable do Supabase escreve em
// public.excel_imports). A proteção mora em dois lugares:
//
//   1. no banco — a migration 20261021150000_protect_public_write.sql, com o
//      teto de payload (6.291.456 bytes), o cooldown de 30 s entre duas
//      escritas e a janela de retenção do histórico (5 últimas versões);
//   2. no cliente — o módulo de persistência reconhece as recusas novas
//      (SNAPSHOT_TOO_LARGE / SNAPSHOT_COOLDOWN) e NÃO grava no cache local o
//      snapshot que o banco recusou; a importação mostra uma mensagem
//      específica para cada limite, em vez do modal genérico.
//
// O que este arquivo cobre:
//   1. a migration tem as três guardas e o cooldown é checado DEPOIS do
//      pg_advisory_xact_lock (o lock serializa importações concorrentes);
//   2. o limite do servidor é exatamente o mesmo número do cliente;
//   3. a recusa por cooldown/payload é reconhecida e não grava no IndexedDB;
//   4. handleRejectedSnapshot mostra "Importação adiada" (cooldown) ou
//      "Arquivo grande demais" (payload) em vez de "Importação recusada pelo
//      banco", que continua aparecendo para os demais casos.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const migrationPath = join(root, 'supabase', 'migrations', '20261021150000_protect_public_write.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');

const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
const normalizeSource = readFileSync(join(root, 'assets', 'js', 'normalize.js'), 'utf8');
const persistenceSource = readFileSync(join(root, 'assets', 'js', 'persistence.js'), 'utf8');
const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');

// Os módulos são IIFEs que publicam globals (o index.html os carrega antes do
// app.js); aqui eles são avaliados no realm principal para que leiam o mesmo
// globalThis que o teste controla.
new Function(stateSource)();
new Function(normalizeSource)();
new Function(persistenceSource)();
new Function(importSource)();

const DashboardState = globalThis.DashboardState;
const DashboardImport = globalThis.DashboardImport;
const DashboardPersistence = globalThis.DashboardPersistence;
const normalize = globalThis.DashboardNormalize.create({
  ETL: null,
  isEmptyValue: DashboardState.isEmptyValue
});

// O número que precisa ser o mesmo no banco e no cliente.
const PRODUCTION_LIMIT_BYTES = 6 * 1024 * 1024; // 6.291.456
const COOLDOWN_SECONDS = 30;
const HISTORY_KEEP = 5;

const COOLDOWN_MESSAGE = 'SNAPSHOT_COOLDOWN: aguarde 12 s antes de gravar outro snapshot';
const TOO_LARGE_MESSAGE = 'SNAPSHOT_TOO_LARGE: 7000038 bytes excedem o limite de 6291456 bytes';
const MISSING_RECORDS_MESSAGE = 'SNAPSHOT_MISSING_RECORDS: 3 processo(s) do banco não estão no arquivo novo';

function installGlobals(overrides) {
  const saved = {};
  Object.entries(overrides).forEach(([key, value]) => {
    saved[key] = globalThis[key];
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  });
  return function restore() {
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  };
}

// Silencia o console.error do módulo durante o teste (a recusa é esperada) e
// devolve o console original.
function silenceConsoleError() {
  const original = console.error;
  console.error = () => {};
  return function restore() { console.error = original; };
}

// UI de mentira: registra os modais e os toasts.
function createUiStub() {
  const toasts = [];
  const modals = [];
  return {
    toasts: toasts,
    modals: modals,
    toast(message, type, title) {
      toasts.push({ message: String(message), type: type, title: title || null });
    },
    openModal(payload) { modals.push(payload); },
    closeModal() {},
    copyText() {},
    downloadFile() {},
    escapeHtml: (value) => String(value == null ? '' : value),
    formatNumber: (value) => String(value),
    formatCompactUSD: () => '$0',
    formatUSDFull: () => '$0',
    formatPercent: () => '0%',
    formatCurrencyFull: () => '$0',
    formatDateTime: () => ''
  };
}

// IndexedDB de mentira que REGISTRA as escritas: o teste precisa provar que o
// snapshot recusado não chegou ao cache local.
function createIndexedDb() {
  const writes = [];
  return {
    writes: writes,
    open() {
      const request = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      request.result = {
        close() {},
        transaction() {
          const tx = { oncomplete: null, onerror: null, onabort: null };
          tx.objectStore = () => ({
            get(key) {
              const getRequest = { result: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                getRequest.result = null;
                if (getRequest.onsuccess) getRequest.onsuccess();
              });
              return getRequest;
            },
            put(value, key) {
              writes.push({ key: key, value: value });
              queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
              return {};
            }
          });
          return tx;
        }
      };
      queueMicrotask(() => { if (request.onsuccess) request.onsuccess(); });
      return request;
    }
  };
}

// Estado mínimo para o buildSnapshot do módulo de persistência.
function createState() {
  return {
    isDemo: false,
    dataset: [{ operacao: 'IMP-1', mercadoria: 'Café Torrado', valor: 1000 }],
    meta: {
      name: 'Importações.xlsx',
      sheetName: '!Importações',
      headerRow: 1,
      rowCount: 1,
      loadedAt: new Date('2026-10-21T12:00:00.000Z'),
      parserVersion: 7
    },
    filters: {},
    search: '',
    analistaMode: 'valor',
    uiStyle: 'classic'
  };
}

// Harness da persistência: o Supabase recusa o snapshot e o teste observa o
// que o módulo faz (retorno, callback de recusa e cache local).
async function runPersistenceWithRejection(message) {
  const indexedDB = createIndexedDb();
  const rejections = [];
  const error = new Error(message);
  const state = createState();

  const persistence = DashboardPersistence.create({
    state: state,
    toPersistedRecord: normalize.toPersistedRecord,
    DashboardState: DashboardState,
    SupabaseStorage: {
      saveSnapshot: () => Promise.reject(error),
      getLatestSnapshot: () => Promise.resolve(null)
    },
    ETL: { PARSER_VERSION: 7 },
    UI: createUiStub(),
    onRejectedSnapshot: (rejected) => { rejections.push(rejected); },
    onLoadedAtChanged: () => {}
  });

  const restoreGlobals = installGlobals({ indexedDB: indexedDB });
  const restoreConsole = silenceConsoleError();
  try {
    const result = await persistence.persistNow();
    return { result: result, error: error, rejections: rejections, indexedDB: indexedDB };
  } finally {
    restoreConsole();
    restoreGlobals();
  }
}

// Harness da importação: cria o módulo com uma UI de mentira e devolve o que
// a interface mostrou.
async function runRejectedSnapshot(message) {
  const UI = createUiStub();
  const restoreGlobals = installGlobals({ UI: UI });

  const api = DashboardImport.create({
    state: { dataset: [], meta: {}, isDemo: false, filters: {}, search: '' },
    prepareRecord: (record) => record,
    toPersistedRecord: normalize.toPersistedRecord,
    canonicalizeDataset: () => {},
    buildSearchIndex: () => {},
    populateFilterOptions: () => {},
    resetFilters: () => {},
    refresh: () => {},
    showTransientUpdateBanner: () => {},
    buildSnapshot: () => null,
    restoreState: () => Promise.resolve(null),
    presentSnapshot: () => {},
    beginSnapshotValidation: () => {},
    endSnapshotValidation: () => {},
    persistNow: () => Promise.resolve({ saved: true })
  });

  try {
    await api.handleRejectedSnapshot(new Error(message), null);
    return { toasts: UI.toasts, modals: UI.modals };
  } finally {
    restoreGlobals();
  }
}

// ---------------------------------------------------------------------------
// 1 — a migration contém as três guardas
// ---------------------------------------------------------------------------

test('F11: a migration de proteção da escrita pública tem as três guardas', () => {
  assert.match(migrationSql, /SNAPSHOT_TOO_LARGE/, 'falta o teto de payload');
  assert.match(migrationSql, /SNAPSHOT_COOLDOWN/, 'falta o cooldown entre escritas');
  assert.match(migrationSql, /6291456/, 'falta o limite de 6.291.456 bytes');
  assert.ok(
    migrationSql.includes(`interval '${COOLDOWN_SECONDS} seconds'`),
    'falta a janela de 30 s do cooldown'
  );
  assert.match(
    migrationSql,
    new RegExp('limit\\s+' + HISTORY_KEEP + '\\b'),
    'falta a janela de retenção de 5 versões'
  );

  // As recusas precisam chegar ao cliente com o código recognizable.
  assert.match(migrationSql, /raise exception 'SNAPSHOT_TOO_LARGE/, 'a recusa de payload precisa ser lançada com o código');
  assert.match(migrationSql, /raise exception 'SNAPSHOT_COOLDOWN/, 'a recusa de cooldown precisa ser lançada com o código');
});

test('F11: o cooldown é checado depois do pg_advisory_xact_lock', () => {
  const lockIndex = migrationSql.indexOf('pg_advisory_xact_lock');
  const cooldownIndex = migrationSql.indexOf(`interval '${COOLDOWN_SECONDS} seconds'`);

  assert.ok(lockIndex > -1, 'a migration precisa usar o lock de serialização');
  assert.ok(cooldownIndex > -1, 'a migration precisa do cooldown de 30 s');
  assert.ok(
    lockIndex < cooldownIndex,
    'o cooldown precisa ser checado depois do lock: com o lock antes, duas importações simultâneas não passam as duas pelo teste'
  );
});

test('F11: a retenção do histórico fica dentro do trigger de arquivamento', () => {
  const archiveIndex = migrationSql.indexOf('excel_imports_archive_history');
  const limitIndex = migrationSql.search(new RegExp('limit\\s+' + HISTORY_KEEP + '\\b'));

  assert.ok(archiveIndex > -1, 'falta o trigger de arquivamento do histórico');
  assert.ok(limitIndex > -1, 'falta a janela de retenção do histórico');
  assert.ok(
    archiveIndex < limitIndex,
    'a janela de retenção (limit 5) precisa estar no trigger de arquivamento, que é quem poda o histórico'
  );
});

// ---------------------------------------------------------------------------
// 2 — o limite do servidor é o mesmo do cliente
// ---------------------------------------------------------------------------

test('F11: o limite de payload do servidor é o mesmo número do cliente', () => {
  assert.equal(DashboardImport.MAX_SNAPSHOT_BYTES, PRODUCTION_LIMIT_BYTES);
  assert.equal(DashboardImport.MAX_SNAPSHOT_BYTES, 6291456);
  assert.match(
    migrationSql,
    /6291456/,
    'a migration precisa usar exatamente o mesmo limite publicado pelo cliente'
  );
});

// ---------------------------------------------------------------------------
// 3 — a recusa é reconhecida e não grava no cache local
// ---------------------------------------------------------------------------

test('F11: a recusa por cooldown é reconhecida e não grava o snapshot no cache local', async () => {
  const run = await runPersistenceWithRejection(COOLDOWN_MESSAGE);
  const result = run.result;

  assert.equal(result.saved, false, 'o snapshot recusado não pode ser considerado salvo');
  assert.equal(result.remote, false, 'o banco não aceitou o snapshot');
  assert.equal(
    result.validationError,
    run.error,
    'a recusa precisa ser reportada ao chamador com o erro original do banco'
  );

  // O módulo reporta a recusa por dois canais: o retorno de persistNow (usado
  // pelo fluxo de importação) e a rede de segurança onRejectedSnapshot. Os dois
  // precisam trazer o erro original do banco.
  const reported = run.rejections.length > 0 ? run.rejections[0] : result.validationError;
  assert.equal(reported, run.error, 'a recusa precisa ser reportada com o erro original do banco');

  assert.equal(
    run.indexedDB.writes.length,
    0,
    'o snapshot recusado por cooldown não pode ser gravado no IndexedDB: ele venceria o banco no próximo carregamento'
  );
});

test('F11: a recusa por payload grande é reconhecida e não grava o snapshot no cache local', async () => {
  const run = await runPersistenceWithRejection(TOO_LARGE_MESSAGE);
  const result = run.result;

  assert.equal(result.saved, false, 'o snapshot recusado não pode ser considerado salvo');
  assert.equal(result.remote, false, 'o banco não aceitou o snapshot');
  assert.equal(
    result.validationError,
    run.error,
    'a recusa precisa ser reportada ao chamador com o erro original do banco'
  );

  const reported = run.rejections.length > 0 ? run.rejections[0] : result.validationError;
  assert.equal(reported, run.error, 'a recusa precisa ser reportada com o erro original do banco');

  assert.equal(
    run.indexedDB.writes.length,
    0,
    'o snapshot recusado por payload grande não pode ser gravado no IndexedDB'
  );
});

test('F11: uma falha que não é recusa do banco continua gravando o cache local', async () => {
  // O contrário da guarda: a proteção do F11 só pode valer para as recusas do
  // banco. Uma falha de rede (o banco não respondeu) não pode apagar o cache
  // local — o arquivo continua salvo no navegador.
  const run = await runPersistenceWithRejection('Failed to fetch');
  assert.equal(run.result.saved, false);
  assert.equal(run.result.validationError, undefined, 'uma falha de rede não é uma recusa do banco');
  assert.equal(
    run.indexedDB.writes.length,
    1,
    'sem recusa do banco, o snapshot precisa ser gravado no cache local'
  );
});

// ---------------------------------------------------------------------------
// 4 — a importação mostra a mensagem específica de cada limite
// ---------------------------------------------------------------------------

test('F11: a recusa por cooldown mostra "Importação adiada" (toast de aviso)', async () => {
  const { toasts, modals } = await runRejectedSnapshot(COOLDOWN_MESSAGE);

  assert.equal(modals.length, 1, 'a recusa precisa abrir exatamente um modal');
  assert.equal(modals[0].title, 'Importação adiada');
  assert.match(modals[0].html, /12 s/, 'o modal precisa informar quantos segundos esperar');

  const toast = toasts.find((entry) => entry.type === 'warning');
  assert.ok(toast, 'o cooldown é um aviso, não um erro');
  assert.match(toast.message, /12 s/);

  assert.ok(
    !modals.some((entry) => entry.title === 'Importação recusada pelo banco'),
    'o modal genérico não pode aparecer no cooldown'
  );
  assert.ok(
    !toasts.some((entry) => entry.type === 'error'),
    'o cooldown não pode gerar toast de erro'
  );
});

test('F11: a recusa por payload grande mostra "Arquivo grande demais" (toast de erro)', async () => {
  const { toasts, modals } = await runRejectedSnapshot(TOO_LARGE_MESSAGE);

  assert.equal(modals.length, 1, 'a recusa precisa abrir exatamente um modal');
  assert.equal(modals[0].title, 'Arquivo grande demais');
  assert.match(modals[0].html, /MB/, 'o modal precisa informar o tamanho');

  const toast = toasts.find((entry) => entry.type === 'error');
  assert.ok(toast, 'o payload grande demais é um erro');
  assert.match(toast.message, /6 MB/, 'o toast precisa informar o limite aceito');

  assert.ok(
    !modals.some((entry) => entry.title === 'Importação recusada pelo banco'),
    'o modal genérico não pode aparecer no payload grande demais'
  );
});

test('F11: a recusa do banco chega à UI pelo canal que existe (validationError)', async () => {
  // O caminho percorrido: persistNow() devolve { saved:false, validationError } e
  // o fluxo de importação chama handleRejectedSnapshot com esse erro. O antigo
  // callback `onRejectedSnapshot` era um ramo morto (só `runScheduledPersist` o
  // chamava, e esse caminho é local-only) — foi removido.
  const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
  assert.match(
    importSource,
    /persistence\.validationError/,
    'o fluxo de importação precisa ler o validationError devolvido pelo persistNow'
  );
  assert.match(
    importSource,
    /handleRejectedSnapshot\(persistence\.validationError/,
    'o fluxo de importação precisa tratar a recusa devolvida pelo banco'
  );

  const persistenceSource = readFileSync(join(root, 'assets', 'js', 'persistence.js'), 'utf8');
  assert.doesNotMatch(
    persistenceSource,
    /deps\.onRejectedSnapshot|onRejectedSnapshot\(/,
    'o callback onRejectedSnapshot era um ramo morto e não pode voltar'
  );
  const appSource = readFileSync(join(root, 'assets', 'js', 'app.js'), 'utf8');
  assert.doesNotMatch(
    appSource,
    /onRejectedSnapshot\s*:/,
    'o app não precisa mais injetar o callback morto'
  );
});

test('F11: as demais recusas continuam usando o modal genérico do banco', async () => {
  const { toasts, modals } = await runRejectedSnapshot(MISSING_RECORDS_MESSAGE);

  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, 'Importação recusada pelo banco');
  assert.match(modals[0].html, /3 processo\(s\)/, 'o modal precisa informar quantos processos faltam');

  const toast = toasts.find((entry) => entry.type === 'error');
  assert.ok(toast, 'a recusa do banco precisa gerar um aviso de erro');
});
