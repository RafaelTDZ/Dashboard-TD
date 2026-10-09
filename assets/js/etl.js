(function (global) {
  'use strict';

  const FIELD_ALIASES = {
    month: ['Pack Month', 'Mês', 'Mes', 'Month', 'PackMonth', 'Mês Pack'],
    analista: ['Analista', 'Analyst', 'Responsável', 'Responsavel'],
    operacao: ['Operação', 'Operacao', 'Processo', 'Ref', 'Nº Processo', 'N Processo', 'Numero Processo', 'Nº Operação', 'N Operação'],
    situacao: ['Situação', 'Situacao', 'Status'],
    regDi: ['Reg DI', 'Data Reg. DI', 'Data Reg DI', 'Data Registro DI', 'Data DI', 'Registro DI', 'Data Registro'],
    mercadoria: ['Mercadoria', 'Descrição', 'Descricao', 'Produto', 'Item', 'Commodity'],
    modal: ['LCL/ FCL', 'LCL/FCL', 'LCL / FCL', 'Modal', 'Tipo Carga'],
    origem: ['Origem', 'Porto Origem', 'Origin'],
    destino: ['Destino', 'Porto Destino', 'Destination'],
    incoterm: ['Incoterm', 'Incoterms'],
    valor: ['Valor USD', 'ValorUSD', 'Valor US$', 'USD', 'Valor', 'Valor Total'],
    peso: ['Peso (kg)', 'Peso(kg)', 'Peso', 'Peso kg', 'Weight', 'Peso Bruto'],
    eta: ['ETA', 'Est Atr', 'Data Chegada', 'Data Atracação', 'Data Atracacao', 'ATA'],
    sla: ['Dias Registro DI', 'SLA Reg. DI', 'SLA Reg DI', 'SLA Registro DI', 'SLA DI', 'Dias Reg. DI', 'Dias DI'],
    despachante: ['Despachante', 'Despacho'],
    faturada: ['Faturada', 'Faturado', 'Invoiced'],
    arquivado: ['Arquivado', 'Archived'],
    estimativaEmb: ['Estimativa Emb', 'Estimativa de Emb.'],
    estimativaAtr: ['Estimativa Atr'],
    atracado: ['Atracado', 'Atracada'],
    modalidade: ['Modalidade', 'Tipo de Modalidade'],
    ric: ['RIC', 'Data RIC'],
    ets: ['ETS', 'Estimated Time of Sailing'],
    estEmb: ['Est Emb', 'Estimativa de Embarque'],
    estAtr: ['Est Atr', 'Estimativa de Atracação', 'Estimativa de Atracacao'],
    fech: ['Fech', 'Fechamento'],
    numeroDi: ['Número DI', 'Numero DI', 'Nº DI', 'N DI'],
    protocoloDi: ['Protocolo DI', 'Protocolo'],
    transportadora: ['Transportadora', 'Carrier'],
    freeTime: ['Free time', 'FreeTime'],
    freeTimeData: ['Free time data', 'Data Free Time'],
    diasDevCntr: ['Dias p/ Dev. CNTR', 'Dias para Dev CNTR'],
    diasDemurrage: ['Dias p/ Demurrage', 'Dias para Demurrage'],
    exportador: ['Exportador', 'Exporter'],
    agente: ['Agente', 'Agent'],
    conhecimento: ['Conhecimento', 'Bill of Lading', 'AWB'],
    container: ['Container', 'Contêiner', 'Conteiner'],
    invoice: ['Invoice', 'Fatura'],
    navio: ['Navio', 'Vessel'],
    prontidao: ['Prontidão', 'Prontidao'],
    li: ['LI ?', 'LI'],
    liOk: ['LI OK'],
    dumping: ['Dumping'],
    cntrDevolvido: ['Cntr devolvido', 'Container devolvido'],
    remocao: ['Remoção', 'Remocao'],
    desovar: ['Desovar'],
    invoicePl: ['Invoice e PL'],
    blAwb: ['BL/AWB'],
    adqEnc: ['Adq/Enc', 'Adquirente', 'Encomendante'],
    op: ['OP'],
    importador: ['Imp', 'Importador']
  };

  const FIELD_LABELS = {
    month: 'Mês',
    analista: 'Analista',
    operacao: 'Operação',
    situacao: 'Situação',
    regDi: 'Reg. DI',
    mercadoria: 'Mercadoria',
    modal: 'LCL / FCL',
    origem: 'Origem',
    destino: 'Destino',
    incoterm: 'Incoterm',
    valor: 'Valor USD',
    peso: 'Peso',
    eta: 'ETA',
    sla: 'SLA Reg. DI',
    despachante: 'Despachante',
    faturada: 'Faturada',
    arquivado: 'Arquivado',
    estimativaEmb: 'Estimativa de embarque',
    estimativaAtr: 'Estimativa de atracação',
    atracado: 'Atracado',
    modalidade: 'Modalidade',
    ric: 'RIC',
    ets: 'ETS',
    estEmb: 'Est. Emb.',
    estAtr: 'Est. Atr.',
    fech: 'Fechamento',
    numeroDi: 'Número DI',
    protocoloDi: 'Protocolo DI',
    transportadora: 'Transportadora',
    freeTime: 'Free time',
    freeTimeData: 'Data Free time',
    diasDevCntr: 'Dias p/ devolver CNTR',
    diasDemurrage: 'Dias p/ demurrage',
    exportador: 'Exportador',
    agente: 'Agente',
    conhecimento: 'Conhecimento',
    container: 'Container',
    invoice: 'Invoice',
    navio: 'Navio',
    prontidao: 'Prontidão',
    li: 'LI',
    liOk: 'LI OK',
    dumping: 'Dumping',
    cntrDevolvido: 'Container devolvido',
    remocao: 'Remoção',
    desovar: 'Desovar',
    invoicePl: 'Invoice e PL',
    blAwb: 'BL/AWB',
    adqEnc: 'Adq/Enc',
    op: 'OP',
    importador: 'Importador'
  };

  const PARSER_VERSION = 8;

  const AGENT_ALIASES = {
    'asia': 'Asia Shipping',
    'linea': 'Línea Logistics'
  };

  const DISPATCHER_ALIASES = {
    'mkp assessoria': 'MKP',
    'sea despacho': 'SEA'
  };

  const CANONICAL_ALIASES = {
    agente: AGENT_ALIASES,
    despachante: DISPATCHER_ALIASES
  };

  function resolveAgentAlias(value) {
    const key = normalizeAgentKey(value);
    return AGENT_ALIASES[key] || null;
  }

  const HEADER_ALIAS_SET = new Set(
    Object.keys(FIELD_ALIASES)
      .reduce(function (acc, key) { return acc.concat(FIELD_ALIASES[key]); }, [])
      .map(normalizeHeader)
      .filter(Boolean)
  );

  function normalizeHeader(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function hasValue(value) {
    return value != null && String(value).trim() !== '';
  }

  function parseFlag(value) {
    if (!hasValue(value)) return null;
    if (value === true || value === false) return value;
    const normalized = normalizeHeader(value);
    if (/^(true|sim|s|yes|y|1)$/.test(normalized)) return true;
    if (/^(false|nao|n|no|0)$/.test(normalized)) return false;
    return String(value).trim();
  }

  function resolveColumn(keys, candidates) {
    const list = Array.isArray(keys) ? keys : [];
    let i;
    for (i = 0; i < candidates.length; i++) {
      const exact = list.find(function (k) { return k === candidates[i]; });
      if (exact != null) return exact;
    }
    for (i = 0; i < candidates.length; i++) {
      const lower = String(candidates[i]).trim().toLowerCase();
      const soft = list.find(function (k) { return String(k).trim().toLowerCase() === lower; });
      if (soft != null) return soft;
    }
    for (i = 0; i < candidates.length; i++) {
      const wanted = normalizeHeader(candidates[i]);
      const normalized = list.find(function (k) { return normalizeHeader(k) === wanted; });
      if (normalized != null) return normalized;
    }
    return null;
  }

  function getCell(row, candidates) {
    const key = resolveColumn(Object.keys(row || {}), candidates);
    if (key == null) return undefined;
    const value = row[key];
    return hasValue(value) ? value : undefined;
  }

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null) return null;
    let text = String(value).trim();
    if (!text) return null;
    let negative = false;
    if (/^\(.*\)$/.test(text)) negative = true;
    text = text.replace(/[^\d.,-]/g, '');
    if (!text || /^[.,-]+$/.test(text)) return null;
    if (text.indexOf('-') > 0) text = text.replace(/-/g, '');
    if (text.charAt(0) === '-') { negative = true; text = text.slice(1); }
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    let normalized;
    if (lastDot > -1 && lastComma > -1) {
      normalized = lastDot > lastComma
        ? text.replace(/,/g, '')
        : text.replace(/\./g, '').replace(/,/g, '.');
    } else if (lastComma > -1) {
      const parts = text.split(',');
      if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
        normalized = parts[0].replace(/\./g, '') + '.' + parts[1];
      } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
        normalized = parts[0] + parts[1];
      } else {
        normalized = text.replace(/,/g, '');
      }
    } else if (lastDot > -1) {
      const parts = text.split('.');
      if (parts.length > 2) {
        normalized = text.replace(/\./g, '');
      } else if (parts[1].length === 3 && parts[0].length <= 3) {
        normalized = parts[0] + parts[1];
      } else {
        normalized = text;
      }
    } else {
      normalized = text;
    }
    const number = parseFloat(normalized);
    if (!Number.isFinite(number)) return null;
    return negative ? -number : number;
  }

  function normalizeCurrency(value, fallback) {
    const normalized = String(value == null ? '' : value).trim().toUpperCase();
    if (normalized === 'USD' || normalized === '$' || normalized === 'US$' || normalized === 'U$') return 'USD';
    if (normalized === 'CNY' || normalized === 'CNH' || normalized === 'RMB' || normalized === '元' || normalized === '¥' || normalized === '￥') return 'CNY';
    if (normalized === 'BRL' || normalized === 'R$') return 'BRL';
    if (normalized === 'EUR' || normalized === '€') return 'EUR';
    if (normalized === 'GBP' || normalized === '£') return 'GBP';
    if (normalized === 'JPY') return 'JPY';
    return fallback || 'USD';
  }

  function detectCurrency(value, fallback) {
    if (!hasValue(value)) return normalizeCurrency('', fallback);
    const text = String(value).trim();
    if (/(?:元|人民币|RMB|CNY|CNH|¥|￥)/i.test(text)) return 'CNY';
    if (/(?:R\$|BRL)/i.test(text)) return 'BRL';
    if (/(?:USD|US\$|U\$|\$)/i.test(text)) return 'USD';
    if (/(?:EUR|€)/i.test(text)) return 'EUR';
    if (/(?:GBP|£)/i.test(text)) return 'GBP';
    if (/(?:JPY)/i.test(text)) return 'JPY';
    return normalizeCurrency(fallback, 'USD');
  }

  function parseCurrencyValue(value, fallbackCurrency) {
    return {
      amount: parseNumber(value),
      currency: detectCurrency(value, fallbackCurrency || 'USD')
    };
  }

  function extractOperationAcronym(value) {
    const text = String(value == null ? '' : value).trim().toUpperCase();
    if (!text || /^(?:N\/A|NA|NÃO INFORMADO|SEM OPERAÇÃO|[-—])$/.test(text)) return 'N/A';
    const match = text.match(/^[A-ZÀ-ÖØ-Ý]+/);
    return match ? match[0] : 'N/A';
  }

  function normalizeAgentKey(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || /^N\/A$/i.test(raw)) return 'n/a';
    return raw.replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function canonicalizeAgents(records) {
    return canonicalizeField(records, 'agente');
  }

  function canonicalizeField(records, field) {
    const displayFor = function (value) {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return 'N/A';
      const aliasMap = CANONICAL_ALIASES[field];
      if (aliasMap) {
        const alias = aliasMap[normalizeAgentKey(raw)];
        if (alias) return alias;
      }
      return raw;
    };
    const groups = {};
    records.forEach(function (record) {
      const display = displayFor(record[field]);
      const key = normalizeAgentKey(display);
      if (!groups[key]) groups[key] = { counts: {}, total: 0 };
      groups[key].counts[display] = (groups[key].counts[display] || 0) + 1;
      groups[key].total += 1;
    });
    const canonicalByKey = {};
    Object.keys(groups).forEach(function (key) {
      if (key === 'n/a') {
        canonicalByKey[key] = 'N/A';
        return;
      }
      let best = null;
      let bestCount = -1;
      Object.keys(groups[key].counts).forEach(function (display) {
        const count = groups[key].counts[display];
        if (count > bestCount) {
          bestCount = count;
          best = display;
        }
      });
      canonicalByKey[key] = best;
    });
    records.forEach(function (record) {
      const display = displayFor(record[field]);
      const key = normalizeAgentKey(display);
      if (canonicalByKey[key]) record[field] = canonicalByKey[key];
    });
    return canonicalByKey;
  }

  function buildDate(year, month, day, hour, minute, second) {
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    if (![year, month, day, hour, minute, second].every(Number.isInteger)) return null;
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

    const date = new Date(year, month - 1, day, hour, minute, second);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
    return date;
  }

  function parseExcelDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return null;
      const wholeDays = Math.floor(value);
      const fraction = value - wholeDays;
      const date = new Date(1899, 11, 30 + wholeDays);
      if (fraction) date.setMilliseconds(Math.round(fraction * 86400000));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return null;
    const br = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (br) {
      let year = Number(br[3]);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      return buildDate(year, Number(br[2]), Number(br[1]), Number(br[4] || 0), Number(br[5] || 0), Number(br[6] || 0));
    }
    const iso = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
      return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0), Number(iso[6] || 0));
    }
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  function formatDateBR(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR');
  }

  function formatMappedDate(value) {
    const date = parseExcelDate(value);
    return date ? formatDateBR(date) : (hasValue(value) ? String(value).trim() : '');
  }

  const MONTH_NAMES = [
    ['janeiro', 'january'], ['fevereiro', 'february'], ['marco', 'march'],
    ['abril', 'april'], ['maio', 'may'], ['junho', 'june'],
    ['julho', 'july'], ['agosto', 'august'], ['setembro', 'september'],
    ['outubro', 'october'], ['novembro', 'november'], ['dezembro', 'december']
  ];

  const MONTH_LABELS = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  function monthName(value) {
    const month = Number(value);
    if (Number.isInteger(month) && month >= 1 && month <= 12) return MONTH_LABELS[month - 1];
    return value == null || value === '' ? '—' : String(value);
  }

  function monthFromValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
      if (value >= 1 && value <= 12) return Math.trunc(value);
      const serialDate = parseExcelDate(value);
      return serialDate ? serialDate.getMonth() + 1 : null;
    }
    const text = String(value).trim();
    if (/^\d{1,2}$/.test(text)) {
      const number = Number(text);
      return number >= 1 && number <= 12 ? number : null;
    }
    const normalized = normalizeHeader(text);
    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (normalized.includes(MONTH_NAMES[i][0]) || normalized.includes(MONTH_NAMES[i][1])) return i + 1;
    }
    const monthYear = text.match(/^(\d{1,2})[\/\-.](\d{4})$/);
    if (monthYear) {
      const month = Number(monthYear[1]);
      return month >= 1 && month <= 12 ? month : null;
    }
    const yearMonth = text.match(/^(\d{4})[\/\-.](\d{1,2})$/);
    if (yearMonth) {
      const month = Number(yearMonth[2]);
      return month >= 1 && month <= 12 ? month : null;
    }
    const date = parseExcelDate(value);
    return date ? date.getMonth() + 1 : null;
  }

  function classifyModal(value) {
    const normalized = normalizeHeader(value);
    if (!normalized || normalized === 'n a') return 'N/A';
    if (/\blcl\b/.test(normalized)) return 'LCL';
    if (/\bfcl\b/.test(normalized) || /\b\d+\s*x\s*\d+/.test(normalized) || /\b\d+\s*(?:hc|hq|dc|nor)\b/.test(normalized)) return 'FCL';
    return 'OUTROS';
  }

  function isFlagged(record, field) {
    return parseFlag(record && record[field]) === true;
  }

  function isFaturada(record) {
    return isFlagged(record, 'faturada');
  }

  function isArquivado(record) {
    return isFlagged(record, 'arquivado');
  }

  function resolveSlaDias(row) {
    const direct = getCell(row, FIELD_ALIASES.sla);
    if (hasValue(direct)) {
      const number = parseNumber(direct);
      if (number != null && number >= 0 && number <= 365) return Math.round(number * 10) / 10;
      return null;
    }
    const start = parseExcelDate(getCell(row, FIELD_ALIASES.eta));
    const end = parseExcelDate(getCell(row, FIELD_ALIASES.regDi));
    if (!start || !end) return null;
    const diff = (end.getTime() - start.getTime()) / 86400000;
    if (!Number.isFinite(diff) || diff < 0 || diff > 365) return null;
    return Math.round(diff * 10) / 10;
  }

  function isDiRegistered(record) {
    if (!record || !hasValue(record.regDi)) return false;
    return !/^(n\/?a|na|-|—|pendente|sem\s*di)$/i.test(String(record.regDi).trim());
  }

  function isConcluida(record) {
    const status = normalizeHeader(record && record.situacao);
    if (!status || /\bnao\b.*\b(?:conclu\w*|arquiv\w*)\b/.test(status)) return false;
    return /\bconclu\w*/.test(status) || /\barquiv(?:ado|ada|ados|adas)\b/.test(status);
  }

  function isCancelada(record) {
    const status = normalizeHeader(record && record.situacao);
    if (!status) return false;
    return /\bcancel\w*/.test(status);
  }

  function resolveMonth(row) {
    const raw = getCell(row, FIELD_ALIASES.month);
    if (hasValue(raw)) {
      const month = monthFromValue(raw);
      if (month) return month;
    }
    const dateRaw = getCell(row, FIELD_ALIASES.regDi) || getCell(row, FIELD_ALIASES.eta);
    const date = parseExcelDate(dateRaw);
    return date ? date.getMonth() + 1 : null;
  }

  function resolveMonthYear(row) {
    const eta = parseExcelDate(getCell(row, FIELD_ALIASES.eta));
    if (eta) return eta.getFullYear();
    const regDi = parseExcelDate(getCell(row, FIELD_ALIASES.regDi));
    return regDi ? regDi.getFullYear() : null;
  }

  function resolveEtaMonth(row) {
    const eta = parseExcelDate(getCell(row, FIELD_ALIASES.eta));
    return eta ? eta.getMonth() + 1 : null;
  }

  function resolveEtaYear(row) {
    const eta = parseExcelDate(getCell(row, FIELD_ALIASES.eta));
    return eta ? eta.getFullYear() : null;
  }

  function resolveEtsMonth(row) {
    const ets = parseExcelDate(getCell(row, FIELD_ALIASES.ets));
    return ets ? ets.getMonth() + 1 : null;
  }

  function resolveEtsYear(row) {
    const ets = parseExcelDate(getCell(row, FIELD_ALIASES.ets));
    return ets ? ets.getFullYear() : null;
  }

  function resolveMonthlyReference(row) {
    const eta = parseExcelDate(getCell(row, FIELD_ALIASES.eta));
    if (eta) return { month: eta.getMonth() + 1, year: eta.getFullYear(), source: 'ETA' };
    const ets = parseExcelDate(getCell(row, FIELD_ALIASES.ets));
    if (ets) return { month: ets.getMonth() + 1, year: ets.getFullYear(), source: 'ETS' };
    return { month: null, year: null, source: null };
  }

  function mapRowToRecord(row, index, displayRow) {
    const regDiRaw = getCell(row, FIELD_ALIASES.regDi);
    const regDiDate = parseExcelDate(regDiRaw);
    const regDiText = regDiDate ? formatDateBR(regDiDate) : (hasValue(regDiRaw) ? String(regDiRaw).trim() : '');
    const modal = String(getCell(row, FIELD_ALIASES.modal) || 'N/A').trim();
    const etaRaw = getCell(row, FIELD_ALIASES.eta);
    const operacao = String(getCell(row, FIELD_ALIASES.operacao) || ('PROC-' + (index + 1))).trim();
    const valorRaw = getCell(row, FIELD_ALIASES.valor);
    const valorDisplay = displayRow ? getCell(displayRow, FIELD_ALIASES.valor) : undefined;
    const valorInput = hasValue(valorDisplay) ? valorDisplay : valorRaw;
    const valorInfo = parseCurrencyValue(valorInput, 'USD');
    const valor = valorInfo.amount == null ? 0 : valorInfo.amount;
    return {
      month: resolveMonth(row),
      monthYear: resolveMonthYear(row),
      etaMonth: resolveEtaMonth(row),
      etaYear: resolveEtaYear(row),
      etsMonth: resolveEtsMonth(row),
      etsYear: resolveEtsYear(row),
      monthlyReference: resolveMonthlyReference(row),
      analista: String(getCell(row, FIELD_ALIASES.analista) || 'N/A').trim(),
      operacao: operacao,
      operacaoSigla: extractOperationAcronym(operacao),
      situacao: String(getCell(row, FIELD_ALIASES.situacao) || 'Em Andamento').trim(),
      regDi: regDiText,
      mercadoria: String(getCell(row, FIELD_ALIASES.mercadoria) || 'N/A').trim(),
      modal: modal ? modal.toUpperCase() : 'N/A',
      modalCategory: classifyModal(modal),
      origem: String(getCell(row, FIELD_ALIASES.origem) || 'N/A').trim(),
      destino: String(getCell(row, FIELD_ALIASES.destino) || 'N/A').trim(),
      incoterm: String(getCell(row, FIELD_ALIASES.incoterm) || 'N/A').trim().toUpperCase(),
      valor: valor,
      valorMoeda: valorInfo.currency,
      valorOriginal: hasValue(valorInput) ? String(valorInput).trim() : '',
      valorUSD: valorInfo.currency === 'USD' && valorInfo.amount != null ? valorInfo.amount : null,
      peso: parseNumber(getCell(row, FIELD_ALIASES.peso)) || 0,
      slaDias: resolveSlaDias(row),
      despachante: String(getCell(row, FIELD_ALIASES.despachante) || 'N/A').trim(),
      eta: formatMappedDate(etaRaw),
      faturada: parseFlag(getCell(row, FIELD_ALIASES.faturada)),
      arquivado: parseFlag(getCell(row, FIELD_ALIASES.arquivado)),
      estimativaEmb: parseFlag(getCell(row, FIELD_ALIASES.estimativaEmb)),
      estimativaAtr: parseFlag(getCell(row, FIELD_ALIASES.estimativaAtr)),
      atracado: parseFlag(getCell(row, FIELD_ALIASES.atracado)),
      modalidade: String(getCell(row, FIELD_ALIASES.modalidade) || '').trim(),
      ric: formatMappedDate(getCell(row, FIELD_ALIASES.ric)),
      ets: formatMappedDate(getCell(row, FIELD_ALIASES.ets)),
      estEmb: formatMappedDate(getCell(row, FIELD_ALIASES.estEmb)),
      estAtr: formatMappedDate(getCell(row, FIELD_ALIASES.estAtr)),
      fech: formatMappedDate(getCell(row, FIELD_ALIASES.fech)),
      numeroDi: String(getCell(row, FIELD_ALIASES.numeroDi) || '').trim(),
      protocoloDi: String(getCell(row, FIELD_ALIASES.protocoloDi) || '').trim(),
      transportadora: String(getCell(row, FIELD_ALIASES.transportadora) || '').trim(),
      freeTime: parseNumber(getCell(row, FIELD_ALIASES.freeTime)),
      freeTimeData: formatMappedDate(getCell(row, FIELD_ALIASES.freeTimeData)),
      diasDevCntr: parseNumber(getCell(row, FIELD_ALIASES.diasDevCntr)),
      diasDemurrage: parseNumber(getCell(row, FIELD_ALIASES.diasDemurrage)),
      exportador: String(getCell(row, FIELD_ALIASES.exportador) || '').trim(),
      agente: String(getCell(row, FIELD_ALIASES.agente) || '').trim(),
      conhecimento: String(getCell(row, FIELD_ALIASES.conhecimento) || '').trim(),
      container: String(getCell(row, FIELD_ALIASES.container) || '').trim(),
      invoice: String(getCell(row, FIELD_ALIASES.invoice) || '').trim(),
      navio: String(getCell(row, FIELD_ALIASES.navio) || '').trim(),
      prontidao: String(getCell(row, FIELD_ALIASES.prontidao) || '').trim(),
      li: parseFlag(getCell(row, FIELD_ALIASES.li)),
      liOk: parseFlag(getCell(row, FIELD_ALIASES.liOk)),
      dumping: parseFlag(getCell(row, FIELD_ALIASES.dumping)),
      cntrDevolvido: parseFlag(getCell(row, FIELD_ALIASES.cntrDevolvido)),
      remocao: String(getCell(row, FIELD_ALIASES.remocao) || '').trim(),
      desovar: parseFlag(getCell(row, FIELD_ALIASES.desovar)),
      invoicePl: String(getCell(row, FIELD_ALIASES.invoicePl) || '').trim(),
      blAwb: String(getCell(row, FIELD_ALIASES.blAwb) || '').trim(),
      adqEnc: String(getCell(row, FIELD_ALIASES.adqEnc) || '').trim(),
      op: String(getCell(row, FIELD_ALIASES.op) || '').trim(),
      importador: String(getCell(row, FIELD_ALIASES.importador) || '').trim()
    };
  }

  function scoreHeaderRow(row) {
    if (!Array.isArray(row)) return 0;
    let score = 0;
    for (let i = 0; i < row.length; i++) {
      if (!hasValue(row[i])) continue;
      if (HEADER_ALIAS_SET.has(normalizeHeader(row[i]))) score++;
    }
    return score;
  }

  function detectHeaderRowIndex(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const limit = Math.min(list.length, 15);
    let bestIndex = 0;
    let bestScore = scoreHeaderRow(list[0] || []);
    for (let i = 1; i < limit; i++) {
      const score = scoreHeaderRow(list[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestScore >= 2 ? bestIndex : 0;
  }

  function buildMappingReport(headers) {
    const used = new Set();
    const mapped = [];
    Object.keys(FIELD_ALIASES).forEach(function (field) {
      const header = resolveColumn(headers, FIELD_ALIASES[field]);
      if (header != null) {
        mapped.push({ field: field, label: FIELD_LABELS[field] || field, header: header });
        used.add(header);
      }
    });
    const unmapped = (headers || []).filter(function (header) {
      return hasValue(header) && !used.has(header);
    });
    return { mapped: mapped, unmapped: unmapped };
  }

  function parseCommentsSheet(workbook) {
    const sheetName = (workbook.SheetNames || []).find(function (name) {
      return normalizeHeader(name) === 'comments' || normalizeHeader(name).indexOf('comment') > -1;
    });
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
    return rows.map(function (row) {
      const reference = String(row[0] == null ? '' : row[0]).trim();
      const match = reference.match(/(\d+)/);
      return {
        sourceRowNumber: match ? Number(match[1]) : null,
        reference: reference,
        text: String(row[1] == null ? '' : row[1]).trim(),
        author: String(row[2] == null ? '' : row[2]).trim(),
        date: String(row[3] == null ? '' : row[3]).trim()
      };
    }).filter(function (comment) {
      return comment.reference || comment.text || comment.author || comment.date;
    });
  }

  function parseWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Biblioteca XLSX não carregada.');
    }
    const bytes = arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : arrayBuffer;
    const workbook = XLSX.read(bytes, { type: 'array' });
    if (!workbook.SheetNames || !workbook.SheetNames.length) {
      throw new Error('O arquivo não contém planilhas.');
    }
    const sheetName = workbook.SheetNames.find(function (name) {
      return normalizeHeader(name).indexOf('importa') > -1;
    }) || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
    const headerRowIndex = detectHeaderRowIndex(rows);
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, range: headerRowIndex });
    const displayJson = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, range: headerRowIndex });
    if (!json.length) {
      throw new Error('A planilha não contém linhas de dados após o cabeçalho.');
    }
    const headers = Object.keys(json[0] || {});
    const mapping = buildMappingReport(headers);
    const operationalFields = ['operacao', 'analista', 'situacao', 'regDi', 'mercadoria', 'origem', 'destino'];
    const hasOperationalField = mapping.mapped.some(function (entry) { return operationalFields.indexOf(entry.field) > -1; });
    if (mapping.mapped.length < 2 || !hasOperationalField) {
      throw new Error('Não foi possível reconhecer as colunas da planilha. Verifique se a linha de cabeçalho contém campos como "Operação", "Analista", "Valor USD" ou "Situação".');
    }
    const operationalHeaders = mapping.mapped
      .filter(function (entry) { return operationalFields.indexOf(entry.field) > -1; })
      .map(function (entry) { return entry.header; });
    const indexedRows = json.map(function (row, index) {
      return { row: row, displayRow: displayJson[index] || {}, index: index, sourceRowNumber: headerRowIndex + index + 2 };
    });
    const dataRows = indexedRows.filter(function (entry) {
      return operationalHeaders.some(function (header) { return hasValue(entry.row[header]); });
    });
    if (!dataRows.length) {
      throw new Error('Nenhum registro preenchido foi encontrado na planilha.');
    }
    const comments = parseCommentsSheet(workbook);
    const records = dataRows.map(function (entry) {
      const record = mapRowToRecord(entry.row, entry.index, entry.displayRow);
      record.sourceRowNumber = entry.sourceRowNumber;
      record.comments = comments.filter(function (comment) {
        return comment.sourceRowNumber === entry.sourceRowNumber;
      });
      return record;
    });
    canonicalizeAgents(records);
    ['origem', 'destino', 'mercadoria', 'analista', 'despachante'].forEach(function (field) {
      canonicalizeField(records, field);
    });
    const currencyCounts = records.reduce(function (counts, record) {
      const currency = record.valorMoeda || 'USD';
      counts[currency] = (counts[currency] || 0) + 1;
      return counts;
    }, {});
    return {
      records: records,
      sheetName: sheetName,
      headerRowNumber: headerRowIndex + 1,
      totalRows: records.length,
      ignoredRows: Math.max(0, json.length - dataRows.length),
      mapping: mapping,
      comments: comments,
      commentCount: comments.length,
      currencyCounts: currencyCounts
    };
  }

  global.ETL = {
    FIELD_ALIASES: FIELD_ALIASES,
    FIELD_LABELS: FIELD_LABELS,
    normalizeHeader: normalizeHeader,
    hasValue: hasValue,
    resolveColumn: resolveColumn,
    getCell: getCell,
    parseNumber: parseNumber,
    normalizeCurrency: normalizeCurrency,
    detectCurrency: detectCurrency,
    parseCurrencyValue: parseCurrencyValue,
    extractOperationAcronym: extractOperationAcronym,
    buildDate: buildDate,
    parseExcelDate: parseExcelDate,
    formatDateBR: formatDateBR,
    monthName: monthName,
    MONTH_LABELS: MONTH_LABELS,
    monthFromValue: monthFromValue,
    resolveMonthYear: resolveMonthYear,
    resolveEtaMonth: resolveEtaMonth,
    resolveEtaYear: resolveEtaYear,
    resolveEtsMonth: resolveEtsMonth,
    resolveEtsYear: resolveEtsYear,
    resolveMonthlyReference: resolveMonthlyReference,
    classifyModal: classifyModal,
    parseFlag: parseFlag,
    resolveSlaDias: resolveSlaDias,
    isDiRegistered: isDiRegistered,
    isConcluida: isConcluida,
    isCancelada: isCancelada,
    isFaturada: isFaturada,
    isArquivado: isArquivado,
    normalizeAgentKey: normalizeAgentKey,
    AGENT_ALIASES: AGENT_ALIASES,
    DISPATCHER_ALIASES: DISPATCHER_ALIASES,
    resolveAgentAlias: resolveAgentAlias,
    canonicalizeAgents: canonicalizeAgents,
    canonicalizeField: canonicalizeField,
    mapRowToRecord: mapRowToRecord,
    detectHeaderRowIndex: detectHeaderRowIndex,
    buildMappingReport: buildMappingReport,
    parseWorkbook: parseWorkbook,
    PARSER_VERSION: PARSER_VERSION
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
