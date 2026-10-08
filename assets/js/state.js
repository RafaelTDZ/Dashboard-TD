(function (global) {
  'use strict';

  const SNAPSHOT_VERSION = 1;
  const DEFAULT_FILTERS = {
    operacao: '',
    ano: 'LATEST',
    mes: 'ALL',
    analista: 'ALL',
    situacao: 'ALL',
    regDi: 'ALL',
    mercadoria: 'ALL',
    modal: 'ALL',
    incoterm: 'ALL'
  };

  const SELECT_FILTERS = ['ano', 'mes', 'analista', 'situacao', 'regDi', 'mercadoria', 'modal', 'incoterm'];

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function defaultFilters() {
    return Object.assign({}, DEFAULT_FILTERS);
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
    return true;
  }

  global.DashboardState = {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    defaultFilters: defaultFilters,
    normalizeFilters: normalizeFilters,
    isValidSnapshot: isValidSnapshot
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
