#!/usr/bin/env node
// F6 — teste de carga reproduzível (lado do cliente).
//
// Mede o custo de preparar e enviar um snapshot em várias escalas do dataset
// de referência (1.944 registros = 1×). O script não faz rede: ele exercita o
// código real de `state.js` (compareRecords) e `normalize.js`
// (toPersistedRecord) e estima o tempo de transferência a partir do tamanho
// do payload.
//
// O lado do banco (custo do INSERT com os triggers) é medido pelo harness
// `tools/loadtest.sql`, que sempre reverte a transação.
//
// Uso:
//   node tools/loadtest.mjs
//   node tools/loadtest.mjs --scale=1,2,5,10 --json
//
// Limites usados na avaliação (medidos em 21/10/2026, ver ANALISE.md/F6):
//   - 3 s     statement_timeout do papel `anon` no Supabase;
//   - 15 s    timeout do POST em assets/js/supabase.js (REQUEST_TIMEOUT_MS);
//   - 3 s     alvo de carga inicial do dashboard;
//   - 10 Mbit/s efetivos (≈1,25 MB/s) como referência de 4G.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
const normalizeSource = readFileSync(join(root, 'assets', 'js', 'normalize.js'), 'utf8');
const importSource = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');

// O limite de escala vem do código de produção (fonte única): o que o
// import.js recusa é exatamente o que este script mede.
const importSandbox = { console };
importSandbox.globalThis = importSandbox;
vm.runInNewContext(importSource, importSandbox, { filename: 'import.js' });
const MAX_SNAPSHOT_BYTES = importSandbox.DashboardImport.MAX_SNAPSHOT_BYTES;

const REFERENCE_RECORDS = 1944;
const LIMITS = {
  dbStatementTimeoutMs: 3000,
  clientUploadTimeoutMs: 15000,
  loadTargetMs: 3000,
  effective4gBytesPerSecond: 1250000,
  maxSnapshotBytes: MAX_SNAPSHOT_BYTES
};

// O state.js e o normalize.js são carregados no mesmo sandbox: o normalize
// recebe o `isEmptyValue` oficial do state (fonte única da regra de vazio).
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.runInNewContext(stateSource, sandbox, { filename: 'state.js' });
vm.runInNewContext(normalizeSource, sandbox, { filename: 'normalize.js' });
const State = sandbox.DashboardState;
const Normalize = sandbox.DashboardNormalize.create({
  ETL: null,
  isEmptyValue: sandbox.DashboardState.isEmptyValue
});

// Registro sintético com o MESMO formato do dataset real (52 campos,
// comprimentos parecidos) para que o tamanho do payload seja representativo.
// Medido no banco: 1.944 registros = 2.440.283 bytes ≈ 1.255 bytes/registro.
const TEMPLATE = {
  li: true, op: 'ENC', eta: '03/01/2025', ets: '16/10/2024', ric: '23/01/2025',
  fech: '03/02/2025', liOk: true, peso: 105600, blAwb: '8- OK', modal: 'FCL 20DC',
  month: 1, regDi: '10/01/2025', valor: 131408.64,
  adqEnc: 'BR PARTNER COMERCIO E IMPORTACAO LTDA', agente: 'ONE',
  estAtr: '19/12/2024', estEmb: '19/12/2024', origem: 'Fangcheng', destino: 'Itapoá',
  etaYear: 2025, etsYear: 2024, invoice: 'URU-0006-24', slaDias: 7,
  analista: 'Rodrigo', atracado: true, etaMonth: 1, etsMonth: 10, faturada: true,
  incoterm: 'CFR', numeroDi: '25/0081003-7', operacao: 'BRP018 - URU-0006-24',
  situacao: 'Concluída, arquivar', valorUSD: 131408.64, arquivado: true,
  container: 'NYKU9706872 / TRHU2401125 / TRHU2628660 / TRHU2658860',
  invoicePl: '5- OK registro', monthYear: 2025,
  exportador: 'FIVE C TRADE COMPANY SAS', importador: 'TDZ',
  mercadoria: 'Ácido Fosfórico', modalidade: 'Encomenda', valorMoeda: 'USD',
  despachante: 'R-one', protocoloDi: '334572880-1', conhecimento: 'ONEYZHOE43500800',
  cntrDevolvido: true, estimativaAtr: true, estimativaEmb: true, modalCategory: 'FCL',
  operacaoSigla: 'BRP', valorOriginal: '131,408.64',
  transportadora: 'Fischer & Rechsteiner', sourceRowNumber: 2,
  monthlyReference: { year: 2025, month: 1, source: 'ETA' }
};

function makeRecords(count) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const record = Object.assign({}, TEMPLATE);
    record.operacao = 'BRP' + String(1000 + index) + ' - URU-' + String(10000 + index) + '-24';
    record.numeroDi = '25/008' + (1000 + index) + '-7';
    record.sourceRowNumber = index + 2;
    records.push(record);
  }
  return records;
}

function measure(scale) {
  const total = REFERENCE_RECORDS * scale;
  const records = makeRecords(total);

  const buildStart = performance.now();
  const persisted = records.map(Normalize.toPersistedRecord);
  const buildMs = performance.now() - buildStart;

  const stringifyStart = performance.now();
  const payload = JSON.stringify(persisted);
  const stringifyMs = performance.now() - stringifyStart;

  // O app compara o arquivo novo com o snapshot do banco antes de gravar.
  // O caso real é "mesmo dataset com Smalltalk changes" — aqui usamos o
  // snapshot anterior (1×) contra o arquivo novo (N×).
  const previous = makeRecords(REFERENCE_RECORDS);
  const compareStart = performance.now();
  const comparison = State.compareRecords(previous, records);
  const compareMs = performance.now() - compareStart;

  const bytes = Buffer.byteLength(payload, 'utf8');
  const transferMs = (bytes / LIMITS.effective4gBytesPerSecond) * 1000;

  return {
    scale: scale,
    registros: total,
    bytes: bytes,
    buildMs: buildMs,
    stringifyMs: stringifyMs,
    compareMs: compareMs,
    transfer4gMs: transferMs,
    adicionados: comparison.addedCount,
    removidos: comparison.removedCount,
    atualizados: comparison.updatedCount,
    dentroDoLimiteDePayload: bytes <= LIMITS.maxSnapshotBytes,
    dentroDoTimeoutDeUpload: transferMs <= LIMITS.clientUploadTimeoutMs,
    dentroDoAlvoDeCarga: transferMs <= LIMITS.loadTargetMs
  };
}

function parseArgs(argv) {
  const args = { scales: [1, 2, 5, 10], json: false };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--scale=')) {
      args.scales = arg.slice('--scale='.length).split(',').map((value) => Number(value)).filter((value) => value > 0);
    } else if (arg === '--json') {
      args.json = true;
    }
  });
  return args;
}

const args = parseArgs(process.argv);
const results = args.scales.map(measure);

if (args.json) {
  console.log(JSON.stringify({ limits: LIMITS, results: results }, null, 2));
} else {
  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  console.log('F6 — teste de carga (lado do cliente, sem rede)');
  console.log('Dataset de referência: ' + REFERENCE_RECORDS + ' registros (1×)');
  console.log('');
  console.log('escala | registros | payload  | montar | JSON  | comparar | 4G      | limite');
  for (const result of results) {
    console.log(
      String(result.scale + 'x').padEnd(7) + '| ' +
      String(result.registros).padEnd(9) + '| ' +
      mb(result.bytes).padEnd(8) + '| ' +
      (result.buildMs.toFixed(0) + ' ms').padEnd(7) + '| ' +
      (result.stringifyMs.toFixed(0) + ' ms').padEnd(6) + '| ' +
      (result.compareMs.toFixed(0) + ' ms').padEnd(9) + '| ' +
      (result.transfer4gMs.toFixed(0) + ' ms').padEnd(8) + '| ' +
      (result.dentroDoLimiteDePayload ? 'ok' : 'ACIMA DO LIMITE')
    );
  }
  console.log('');
  console.log('Limites: payload <= ' + mb(LIMITS.maxSnapshotBytes) +
    ', upload <= ' + (LIMITS.clientUploadTimeoutMs / 1000) + 's, carga inicial <= ' +
    (LIMITS.loadTargetMs / 1000) + 's em 4G.');
  for (const result of results) {
    if (!result.dentroDoLimiteDePayload || !result.dentroDoTimeoutDeUpload) {
      console.log('  ' + result.scale + 'x estouraria o limite de payload ou o timeout de upload.');
    } else if (!result.dentroDoAlvoDeCarga) {
      console.log('  ' + result.scale + 'x passa do alvo de carga inicial (mas cabe no upload).');
    }
  }
}
