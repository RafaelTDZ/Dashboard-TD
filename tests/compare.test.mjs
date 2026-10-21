import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stateSource = readFileSync(join(root, 'assets', 'js', 'state.js'), 'utf8');
const normalizeSource = readFileSync(join(root, 'assets', 'js', 'normalize.js'), 'utf8');

new Function(stateSource)();
new Function(normalizeSource)();

const compare = globalThis.DashboardState.compareRecords;
const normalizeKey = globalThis.DashboardState.normalizeRecordKey;
const isEmptyValue = globalThis.DashboardState.isEmptyValue;
const normalize = globalThis.DashboardNormalize.create({
  ETL: null,
  isEmptyValue: globalThis.DashboardState.isEmptyValue
});

test('isEmptyValue é a fonte única para persistência e comparação', () => {
  assert.equal(isEmptyValue(null), true);
  assert.equal(isEmptyValue(undefined), true);
  assert.equal(isEmptyValue(''), true);
  assert.equal(isEmptyValue([]), true);
  assert.equal(isEmptyValue(0), false);
  assert.equal(isEmptyValue(false), false);
  assert.equal(isEmptyValue('0'), false);
  assert.equal(isEmptyValue([0]), false);
});

test('toPersistedRecord usa a mesma regra de vazio e remove só o índice derivado', () => {
  assert.deepEqual(
    normalize.toPersistedRecord({
      operacao: 'IMP-1',
      valor: 0,
      vazio: '',
      nulo: null,
      lista: [],
      _search: 'imp-1'
    }),
    { operacao: 'IMP-1', valor: 0 }
  );
});

test('compara snapshots por Operação e libera somente quando o novo arquivo é superset', () => {
  const previous = [
    { operacao: 'IMP-1', valor: 10, situacao: 'Em Andamento' },
    { operacao: 'IMP-2', valor: 20, situacao: 'Em Andamento' }
  ];
  const next = [
    { operacao: 'IMP-1', valor: 15, situacao: 'Concluída' },
    { operacao: 'IMP-2', valor: 20, situacao: 'Em Andamento' },
    { operacao: 'IMP-3', valor: 30, situacao: 'Em Andamento' }
  ];

  const result = compare(previous, next);
  assert.equal(result.comparable, true);
  assert.equal(result.isSuperset, true);
  assert.equal(result.previousCount, 2);
  assert.equal(result.nextCount, 3);
  assert.equal(result.addedCount, 1);
  assert.deepEqual(result.added, ['IMP-3']);
  assert.equal(result.updatedCount, 1);
  assert.deepEqual(result.updated, ['IMP-1']);
  assert.equal(result.removedCount, 0);
  assert.equal(result.unchangedCount, 1);
  assert.deepEqual(result.unchanged, ['IMP-2']);
});

test('bloqueia quando o arquivo novo não contém todos os processos do snapshot atual', () => {
  const previous = [
    { operacao: 'IMP-1', valor: 10 },
    { operacao: 'IMP-REMOVIDO', valor: 20 }
  ];
  const next = [{ operacao: 'IMP-1', valor: 10 }];

  const result = compare(previous, next);
  assert.equal(result.comparable, true);
  assert.equal(result.isSuperset, false);
  assert.equal(result.removedCount, 1);
  assert.deepEqual(result.removed, ['IMP-REMOVIDO']);
});

test('normaliza caixa e espaços da Operação para comparar', () => {
  const previous = [{ operacao: ' imp-1 ', valor: 10 }];
  const next = [{ operacao: 'IMP-1', valor: 10 }];

  assert.equal(normalizeKey(' imp-1 '), 'IMP-1');
  const result = compare(previous, next);
  assert.equal(result.comparable, true);
  assert.equal(result.removedCount, 0);
  assert.equal(result.unchangedCount, 1);
});

test('ignora campos derivados/efêmeros ao detectar alterações', () => {
  const previous = [{ operacao: 'IMP-1', valor: 10, _search: 'antes', sourceRowNumber: 2 }];
  const next = [{ operacao: 'IMP-1', valor: 10, _search: 'depois', sourceRowNumber: 99 }];

  const result = compare(previous, next);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.unchangedCount, 1);
});

test('recusa Operação vazia ou duplicada no arquivo novo', () => {
  const empty = compare([{ operacao: 'IMP-1' }], [{ operacao: '  ' }]);
  assert.equal(empty.nextValid, false);
  assert.equal(empty.nextReason, 'empty');
  assert.equal(empty.nextInvalidIndex, 1);

  const duplicate = compare([], [{ operacao: 'IMP-1' }, { operacao: 'imp-1' }]);
  assert.equal(duplicate.nextValid, false);
  assert.equal(duplicate.nextReason, 'duplicate');
  assert.equal(duplicate.nextInvalidKey, 'IMP-1');
});

test('primeiro snapshot do banco considera todos os processos como novos', () => {
  const result = compare([], [{ operacao: 'IMP-1' }, { operacao: 'IMP-2' }]);
  assert.equal(result.comparable, true);
  assert.equal(result.previousCount, 0);
  assert.equal(result.addedCount, 2);
  assert.equal(result.removedCount, 0);
  assert.equal(result.isSuperset, true);
});
