(function (global) {
  'use strict';

  const SNAPSHOT_VERSION = 1;
  // Padrão do filtro de ano: o ano corrente. Se esse ano não existir nos dados
  // carregados (ou não houver dataset), a normalização com as opções do select
  // cai automaticamente para "Todos os anos" (ALL).
  const DEFAULT_FILTERS = {
    operacao: '',
    ano: String(new Date().getFullYear()),
    // `mes` guarda a lista de meses marcados (ex.: ['1', '10']); lista vazia = todos os meses.
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

  // Meses marcados no filtro multi-seleção. Aceita a lista nova e migra os
  // formatos antigos ('ALL' = todos; '7' = um único mês) e descarta valores
  // inválidos ou que não existam nos dados carregados.
  function normalizeMonthSelection(value, availableMonths) {
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
    isValidSnapshot: isValidSnapshot
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
