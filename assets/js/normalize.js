// Normalização dos registros importados: índice de busca, cópia enxuta para
// persistência, canonicalização de campos e referência mensal (ETA/ETS). O app
// injeta o ETL e mantém o módulo no padrão IIFE/global, sem build.
(function (global) {
  'use strict';

  function create(deps) {
    var ETL = deps.ETL;

    // Normaliza texto para a busca: sem acentos e em minúsculas. Só o índice
    // (_search) e as comparações usam essa forma — o texto exibido na tabela e
    // exportado no CSV continua com os acentos.
    function normalizeSearchText(value) {
      return String(value == null ? '' : value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    }

    // Valor "vazio" para efeito de persistência e de comparação de snapshots:
    // null, '' e arrays vazios não mudam o resultado e apenas inflam o payload.
    // A mesma regra vale em state.js (recordFingerprint) — as duas precisam
    // descartar exatamente os mesmos campos.
    function isEmptyPersistedValue(value) {
      if (value === null || value === undefined || value === '') return true;
      return Array.isArray(value) && !value.length;
    }

    // Cópia enxuta do registro para o que é persistido (Supabase e cache local):
    // sem o índice derivado (_search), sem campos vazios e sem arrays vazios.
    // Os dados em memória (state.dataset) continuam completos — a busca depende
    // do _search, que é recalculado por prepareRecord() ao restaurar.
    function toPersistedRecord(record) {
      var copy = {};
      Object.keys(record || {}).forEach(function (key) {
        if (key === '_search') return;
        var value = record[key];
        if (isEmptyPersistedValue(value)) return;
        copy[key] = value;
      });
      return copy;
    }

    // Monta o índice de busca do registro (normalizado, sem acentos). Fica em
    // uma função própria porque o índice precisa ser recalculado depois da
    // canonicalização dos campos (ver B1): canonicalizar depois de indexar
    // deixaria a busca procurando valores antigos.
    function buildSearchIndex(record) {
      record._search = normalizeSearchText([
        record.operacao, record.analista, record.mercadoria, record.situacao,
        record.origem, record.destino, record.incoterm, record.regDi, record.despachante,
        record.eta, record.numeroDi, record.protocoloDi, record.transportadora,
        record.exportador, record.agente, record.container, record.modalidade, record.ric,
        record.valorOriginal, record.valorMoeda,
        record.comments.map(function (comment) { return [comment.reference, comment.text, comment.author, comment.date].join(' '); }).join(' ')
      ].join(' '));
      return record;
    }

    function prepareRecord(record) {
      record.month = record.month == null || record.month === '' ? null : Number(record.month);
      if (!Number.isFinite(record.month)) record.month = null;
      record.valor = Number(record.valor) || 0;
      record.valorMoeda = ETL && typeof ETL.normalizeCurrency === 'function'
        ? ETL.normalizeCurrency(record.valorMoeda, 'USD')
        : (record.valorMoeda || 'USD');
      record.valorOriginal = record.valorOriginal || (record.valor ? String(record.valor) : '');
      var storedValorUSD = record.valorUSD == null || record.valorUSD === '' ? null : Number(record.valorUSD);
      record.valorUSD = Number.isFinite(storedValorUSD)
        ? storedValorUSD
        : (record.valorMoeda === 'USD' ? record.valor : null);
      record.peso = Number(record.peso) || 0;
      record.slaDias = Number.isFinite(Number(record.slaDias)) && record.slaDias !== null && record.slaDias !== '' ? Number(record.slaDias) : null;
      record.analista = record.analista || 'N/A';
      record.operacao = record.operacao || 'N/A';
      record.operacaoSigla = ETL && typeof ETL.extractOperationAcronym === 'function'
        ? ETL.extractOperationAcronym(record.operacao)
        : (record.operacaoSigla || 'N/A');
      record.situacao = record.situacao || 'Em Andamento';
      record.mercadoria = record.mercadoria || 'N/A';
      record.modal = record.modal || 'N/A';
      record.modalCategory = record.modalCategory || ETL.classifyModal(record.modal);
      record.origem = record.origem || 'N/A';
      record.destino = record.destino || 'N/A';
      record.incoterm = record.incoterm || 'N/A';
      record.regDi = record.regDi || '';
      record.despachante = record.despachante || 'N/A';
      record.eta = record.eta || '';
      var etaDate = record.eta && ETL && typeof ETL.parseExcelDate === 'function'
        ? ETL.parseExcelDate(record.eta)
        : null;
      var etsDate = record.ets && ETL && typeof ETL.parseExcelDate === 'function'
        ? ETL.parseExcelDate(record.ets)
        : null;
      record.etaMonth = record.etaMonth == null || record.etaMonth === '' ? null : Number(record.etaMonth);
      if (record.etaMonth == null && etaDate) record.etaMonth = etaDate.getMonth() + 1;
      if (!Number.isInteger(record.etaMonth) || record.etaMonth < 1 || record.etaMonth > 12) record.etaMonth = null;
      record.etaYear = record.etaYear == null || record.etaYear === '' ? null : Number(record.etaYear);
      if (record.etaYear == null && etaDate) record.etaYear = etaDate.getFullYear();
      if (!Number.isInteger(record.etaYear) || record.etaYear < 1900 || record.etaYear > 2100) record.etaYear = null;
      record.etsMonth = record.etsMonth == null || record.etsMonth === '' ? null : Number(record.etsMonth);
      if (record.etsMonth == null && etsDate) record.etsMonth = etsDate.getMonth() + 1;
      if (!Number.isInteger(record.etsMonth) || record.etsMonth < 1 || record.etsMonth > 12) record.etsMonth = null;
      record.etsYear = record.etsYear == null || record.etsYear === '' ? null : Number(record.etsYear);
      if (record.etsYear == null && etsDate) record.etsYear = etsDate.getFullYear();
      if (!Number.isInteger(record.etsYear) || record.etsYear < 1900 || record.etsYear > 2100) record.etsYear = null;
      var monthlyReference = record.monthlyReference && typeof record.monthlyReference === 'object'
        ? record.monthlyReference
        : null;
      if (!monthlyReference || !['ETA', 'ETS'].includes(monthlyReference.source)) {
        monthlyReference = etaDate
          ? { month: etaDate.getMonth() + 1, year: etaDate.getFullYear(), source: 'ETA' }
          : (etsDate ? { month: etsDate.getMonth() + 1, year: etsDate.getFullYear(), source: 'ETS' } : null);
      }
      if (monthlyReference) {
        monthlyReference.month = Number(monthlyReference.month);
        monthlyReference.year = Number(monthlyReference.year);
        if (!Number.isInteger(monthlyReference.month) || monthlyReference.month < 1 || monthlyReference.month > 12 ||
            !Number.isInteger(monthlyReference.year) || monthlyReference.year < 1900 || monthlyReference.year > 2100) {
          monthlyReference = null;
        }
      }
      record.monthlyReference = monthlyReference;
      if (!Object.prototype.hasOwnProperty.call(record, 'faturada')) record.faturada = null;
      if (!Object.prototype.hasOwnProperty.call(record, 'arquivado')) record.arquivado = null;
      if (!Object.prototype.hasOwnProperty.call(record, 'estimativaEmb')) record.estimativaEmb = null;
      if (!Object.prototype.hasOwnProperty.call(record, 'estimativaAtr')) record.estimativaAtr = null;
      if (!Object.prototype.hasOwnProperty.call(record, 'atracado')) record.atracado = null;
      record.modalidade = record.modalidade || '';
      record.ric = record.ric || '';
      record.ets = record.ets || '';
      record.estEmb = record.estEmb || '';
      record.estAtr = record.estAtr || '';
      record.fech = record.fech || '';
      record.numeroDi = record.numeroDi || '';
      record.protocoloDi = record.protocoloDi || '';
      record.transportadora = record.transportadora || '';
      record.exportador = record.exportador || '';
      record.agente = record.agente || '';
      record.container = record.container || '';
      record.comments = Array.isArray(record.comments) ? record.comments.filter(function (comment) {
        return comment && typeof comment === 'object' && (comment.text || comment.author || comment.date || comment.reference);
      }) : [];
      record.sourceRowNumber = Number.isFinite(Number(record.sourceRowNumber)) ? Number(record.sourceRowNumber) : null;
      buildSearchIndex(record);
      return record;
    }

    function canonicalizeDataset(records) {
      if (!Array.isArray(records)) return;
      if (ETL && typeof ETL.canonicalizeField === 'function') {
        ['agente', 'origem', 'destino', 'mercadoria', 'analista', 'despachante'].forEach(function (field) {
          ETL.canonicalizeField(records, field);
        });
      } else if (ETL && typeof ETL.canonicalizeAgents === 'function') {
        ETL.canonicalizeAgents(records);
      }
    }

    function getMonthlyReferenceYear(item) {
      var reference = item && item.monthlyReference;
      var year = reference && (reference.source === 'ETA' || reference.source === 'ETS')
        ? Number(reference.year)
        : null;
      return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
    }

    function getMonthlyReferenceMonth(item) {
      var reference = item && item.monthlyReference;
      var month = reference && (reference.source === 'ETA' || reference.source === 'ETS')
        ? Number(reference.month)
        : null;
      return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
    }

    return {
      normalizeSearchText: normalizeSearchText,
      toPersistedRecord: toPersistedRecord,
      buildSearchIndex: buildSearchIndex,
      prepareRecord: prepareRecord,
      canonicalizeDataset: canonicalizeDataset,
      getMonthlyReferenceYear: getMonthlyReferenceYear,
      getMonthlyReferenceMonth: getMonthlyReferenceMonth
    };
  }

  global.DashboardNormalize = { create: create };
})(globalThis);
