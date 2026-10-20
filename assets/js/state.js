(function (global) {
  'use strict';

  const SNAPSHOT_VERSION = 1;
  // Padrão do filtro de ano: o ano corrente. Se esse ano não existir nos dados
  // carregados (ou não houver dataset), a normalização com as opções do select
  // cai automaticamente para "Todos os anos" (ALL).
  const DEFAULT_FILTERS = {
    operacao: '',
    ano: String(new Date().getFullYear()),
    // `mes` guarda a lista de meses marcados (ex.: ['1', '10']); lista vazia = todos
    // os meses e 'NONE' = nenhum mês marcado (o dashboard fica vazio).
    mes: [],
    analista: 'ALL',
    situacao: 'ALL',
    regDi: 'ALL',
    mercadoria: 'ALL',
    modal: 'ALL',
    incoterm: 'ALL',
    despachante: 'ALL'
  };

  const SELECT_FILTERS = ['ano', 'analista', 'situacao', 'regDi', 'mercadoria', 'modal', 'incoterm', 'despachante'];

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function defaultFilters() {
    const filters = Object.assign({}, DEFAULT_FILTERS);
    filters.mes = [];
    return filters;
  }

  function normalizeAnalistaMode(mode) {
    return mode === 'qtd' ? 'qtd' : 'valor';
  }

  function normalizeUiStyle(style) {
    return style === 'modern' ? 'modern' : 'classic';
  }

  // Meses marcados no filtro multi-seleção. Aceita a lista nova, mantém o estado
  // 'NONE' (nenhum mês marcado) e migra os formatos antigos ('ALL' = todos;
  // '7' = um único mês); descarta valores inválidos ou fora dos dados carregados.
  function normalizeMonthSelection(value, availableMonths) {
    if (value === 'NONE') return 'NONE';
    const source = Array.isArray(value)
      ? value
      : (typeof value === 'string' && value !== 'ALL' ? [value] : []);
    const options = availableMonths && Array.isArray(availableMonths) ? availableMonths.map(String) : null;
    const selected = [];
    source.forEach(function (entry) {
      const month = String(entry);
      if (!/^(1[0-2]|[1-9])$/.test(month)) return;
      if (options && options.indexOf(month) === -1) return;
      if (selected.indexOf(month) === -1) selected.push(month);
    });
    return selected;
  }

  function normalizeFilters(filters, availableValues) {
    const source = isObject(filters) ? filters : {};
    const normalized = Object.assign(defaultFilters(), source);
    if (typeof normalized.operacao !== 'string') normalized.operacao = '';

    SELECT_FILTERS.forEach(function (key) {
      if (typeof normalized[key] !== 'string') normalized[key] = 'ALL';
      const options = availableValues && Array.isArray(availableValues[key]) ? availableValues[key].map(String) : null;
      if (options && normalized[key] !== 'ALL' && options.indexOf(normalized[key]) === -1) normalized[key] = 'ALL';
    });

    normalized.mes = normalizeMonthSelection(source.mes, availableValues && availableValues.mes);

    return normalized;
  }

  // Chave usada para comparar snapshots. `operacao` identifica o processo e já é
  // única nos arquivos atuais; normalizamos caixa/espaços para que uma mudança
  // apenas de grafia não pareça um processo removido.
  function normalizeRecordKey(value) {
    return String(value == null ? '' : value).trim().toUpperCase();
  }

  function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') {
      const encoded = JSON.stringify(value);
      return encoded === undefined ? 'null' : encoded;
    }
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) {
      return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }

  // Valor "vazio" para efeito de comparação: null, '' e arrays vazios não
  // mudam o resultado da comparação e apenas inflam o payload. A mesma regra
  // vale em app.js (toPersistedRecord) — as duas precisam descartar
  // exatamente os mesmos campos, senão toda linha vira "atualizada".
  function isEmptyValue(value) {
    if (value === null || value === undefined || value === '') return true;
    return Array.isArray(value) && !value.length;
  }

  // Impressão digital do registro, usada para saber se um processo mudou.
  // Ignora o índice derivado (_search), a linha de origem (sourceRowNumber) e
  // os campos vazios — assim a linha antiga do banco (que ainda tem esses
  // campos) e o registro novo do arquivo continuam sendo comparáveis (B6).
  function recordFingerprint(record) {
    const copy = {};
    Object.keys(record || {}).forEach(function (key) {
      if (key === '_search' || key === 'sourceRowNumber') return;
      const value = record[key];
      if (isEmptyValue(value)) return;
      copy[key] = key === 'operacao' ? normalizeRecordKey(value) : value;
    });
    return stableStringify(copy);
  }

  function indexRecords(records) {
    if (!Array.isArray(records)) return { valid: false, reason: 'invalid', map: null, keys: [] };
    const map = Object.create(null);
    const keys = [];
    for (let index = 0; index < records.length; index += 1) {
      const key = normalizeRecordKey(records[index] && records[index].operacao);
      if (!key) return { valid: false, reason: 'empty', index: index + 1, map: null, keys: [] };
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        return { valid: false, reason: 'duplicate', key: key, map: null, keys: [] };
      }
      map[key] = records[index];
      keys.push(key);
    }
    return { valid: true, map: map, keys: keys };
  }

  // Compara o snapshot atual (banco/cache) com o arquivo novo. A substituição
  // só é liberada quando todos os processos atuais reaparecem no novo arquivo;
  // valores alterados do mesmo processo são atualizações, não remoções.
  function compareRecords(previousRecords, nextRecords) {
    const previous = indexRecords(previousRecords || []);
    const next = indexRecords(nextRecords || []);
    const result = {
      comparable: previous.valid && next.valid,
      previousValid: previous.valid,
      nextValid: next.valid,
      previousReason: previous.reason || null,
      nextReason: next.reason || null,
      nextInvalidKey: next.key || '',
      nextInvalidIndex: next.index || null,
      previousCount: previous.valid ? previous.keys.length : 0,
      nextCount: next.valid ? next.keys.length : 0,
      added: [],
      updated: [],
      removed: [],
      unchanged: [],
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      // `isSuperset` faz parte da API pública de compareRecords (usada pelos
      // testes e por integrações): indica que o arquivo novo contém todos os
      // processos do snapshot anterior.
      isSuperset: false
    };

    if (!previous.valid || !next.valid) return result;

    next.keys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(previous.map, key)) result.added.push(key);
    });
    previous.keys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(next.map, key)) result.removed.push(key);
    });
    next.keys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(previous.map, key)) return;
      if (recordFingerprint(previous.map[key]) === recordFingerprint(next.map[key])) {
        result.unchanged.push(key);
      } else {
        result.updated.push(key);
      }
    });

    result.addedCount = result.added.length;
    result.updatedCount = result.updated.length;
    result.removedCount = result.removed.length;
    result.unchangedCount = result.unchanged.length;
    result.isSuperset = result.removedCount === 0;
    return result;
  }

  function isValidSnapshot(snapshot) {
    if (!isObject(snapshot)) return false;
    if (snapshot.version != null && snapshot.version !== SNAPSHOT_VERSION) return false;
    if (!Array.isArray(snapshot.records) || !snapshot.records.length) return false;
    if (!snapshot.records.every(isObject)) return false;
    if (!isObject(snapshot.meta)) return false;
    if (typeof snapshot.meta.name !== 'string' || !snapshot.meta.name.trim()) return false;
    if (typeof snapshot.meta.sheetName !== 'string' || !snapshot.meta.sheetName.trim()) return false;
    if (snapshot.meta.rowCount != null && (!Number.isFinite(Number(snapshot.meta.rowCount)) || Number(snapshot.meta.rowCount) < 0)) return false;
    if (snapshot.meta.ignoredRows != null && (!Number.isFinite(Number(snapshot.meta.ignoredRows)) || Number(snapshot.meta.ignoredRows) < 0)) return false;
    if (snapshot.meta.commentCount != null && (!Number.isFinite(Number(snapshot.meta.commentCount)) || Number(snapshot.meta.commentCount) < 0)) return false;
    if (snapshot.meta.parserVersion != null && (!Number.isFinite(Number(snapshot.meta.parserVersion)) || Number(snapshot.meta.parserVersion) < 1)) return false;
    if (snapshot.meta.loadedAt != null && Number.isNaN(new Date(snapshot.meta.loadedAt).getTime())) return false;
    if (snapshot.analistaMode != null && snapshot.analistaMode !== 'valor' && snapshot.analistaMode !== 'qtd') return false;
    if (snapshot.uiStyle != null && snapshot.uiStyle !== 'classic' && snapshot.uiStyle !== 'modern') return false;
    return true;
  }

  global.DashboardState = {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    defaultFilters: defaultFilters,
    normalizeFilters: normalizeFilters,
    normalizeAnalistaMode: normalizeAnalistaMode,
    normalizeUiStyle: normalizeUiStyle,
    isValidSnapshot: isValidSnapshot,
    normalizeRecordKey: normalizeRecordKey,
    compareRecords: compareRecords
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
