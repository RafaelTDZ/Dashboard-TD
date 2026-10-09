(function () {
  'use strict';

  var global = globalThis;

  const DB_NAME = 'bi_hub';
  const DB_VERSION = 1;
  const DB_STORE = 'kv';
  const SNAPSHOT_KEY = 'snapshot';
  const DEMO_FILE = 'Nenhum arquivo carregado';
  const REQUIRED_ELEMENT_IDS = [
    'tab-btn-dashboard', 'tab-btn-data', 'tab-btn-integration',
    'tab-dashboard', 'tab-data', 'tab-integration',
    'style-switcher', 'style-option-modern', 'style-option-classic',
    'banner-text', 'last-update-time', 'last-read-header',
    'kpi-volume', 'kpi-volume-hint', 'kpi-processos', 'kpi-peso', 'kpi-ticket', 'kpi-conclusao', 'kpi-sla', 'kpi-sla-hint',
    'filter-operacao', 'filter-mes', 'filter-analista', 'filter-situacao', 'filter-reg-di',
    'filter-mercadoria', 'filter-modal', 'filter-incoterm', 'filter-despachante', 'btn-reset-filters',
    'table-search', 'table-body', 'table-count', 'table-head', 'btn-export-csv',
    'page-size', 'page-prev', 'page-next', 'page-info', 'monthly-year',
    'analistas-title', 'analistas-unit', 'analistas-mode-valor', 'analistas-mode-qtd',
    'excel-file-input', 'modal', 'modal-title', 'modal-body'
  ];

  const DEMO_DATA = [];

  const state = {
    dataset: [],
    filtered: [],
    meta: null,
    isDemo: true,
    uiStyle: 'classic',
    analistaMode: 'valor',
    filters: global.DashboardState.defaultFilters(),
    search: '',
    sort: { key: 'month', dir: 1 },
    page: 1,
    pageSize: 50
  };

  const els = {};
  let persistTimer = null;
  let xlsxLoadPromise = null;
  let persistenceWarningShown = false;

  function cacheElements() {
    REQUIRED_ELEMENT_IDS.forEach(function (id) {
      els[id] = document.getElementById(id);
    });
    const missing = REQUIRED_ELEMENT_IDS.filter(function (id) { return !els[id]; });
    if (missing.length) throw new Error('Estrutura do dashboard incompleta. Elementos ausentes: ' + missing.join(', '));
  }

  function prepareRecord(record) {
    record.month = record.month == null || record.month === '' ? null : Number(record.month);
    if (!Number.isFinite(record.month)) record.month = null;
    record.valor = Number(record.valor) || 0;
    record.valorMoeda = global.ETL && typeof global.ETL.normalizeCurrency === 'function'
      ? global.ETL.normalizeCurrency(record.valorMoeda, 'USD')
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
    record.operacaoSigla = global.ETL && typeof global.ETL.extractOperationAcronym === 'function'
      ? global.ETL.extractOperationAcronym(record.operacao)
      : (record.operacaoSigla || 'N/A');
    record.situacao = record.situacao || 'Em Andamento';
    record.mercadoria = record.mercadoria || 'N/A';
    record.modal = record.modal || 'N/A';
    record.modalCategory = record.modalCategory || global.ETL.classifyModal(record.modal);
    record.origem = record.origem || 'N/A';
    record.destino = record.destino || 'N/A';
    record.incoterm = record.incoterm || 'N/A';
    record.regDi = record.regDi || '';
    record.despachante = record.despachante || 'N/A';
    record.eta = record.eta || '';
    var etaDate = record.eta && global.ETL && typeof global.ETL.parseExcelDate === 'function'
      ? global.ETL.parseExcelDate(record.eta)
      : null;
    var etsDate = record.ets && global.ETL && typeof global.ETL.parseExcelDate === 'function'
      ? global.ETL.parseExcelDate(record.ets)
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
    record._search = [
      record.operacao, record.analista, record.mercadoria, record.situacao,
      record.origem, record.destino, record.incoterm, record.regDi, record.despachante,
      record.eta, record.numeroDi, record.protocoloDi, record.transportadora,
      record.exportador, record.agente, record.container, record.modalidade, record.ric,
      record.valorOriginal, record.valorMoeda,
      record.comments.map(function (comment) { return [comment.reference, comment.text, comment.author, comment.date].join(' '); }).join(' ')
    ].join(' ').toLowerCase();
    return record;
  }

  function init() {
    try {
      cacheElements();
      bindEvents();
      applyVisualStyle('classic', false);
      applyAnalistaModeUI();
      // Garante o estado transitório mesmo se o HTML vier de um cache antigo.
      hideStatusBanner();
    } catch (error) {
      console.error('[BI Hub] Falha ao vincular a interface.', error && error.message ? error.message : error);
      showStatusBannerError(error && error.message ? error.message : 'Falha ao vincular a interface.');
      return;
    }
    var chartsReady = false;
    try { chartsReady = global.Charts.init(); } catch (error) { console.error('[BI Hub] Falha ao inicializar os gráficos.', error && error.message ? error.message : error); }
    if (!chartsReady) global.UI.toast('Chart.js não foi carregado. Os gráficos ficarão indisponíveis.', 'error', 'Falha de dependência');
    restoreState().then(function (snapshot) {
      if (snapshot) {
        state.dataset = snapshot.records.map(prepareRecord);
        if (global.ETL && typeof global.ETL.canonicalizeField === 'function') {
          ['agente', 'origem', 'destino', 'mercadoria', 'analista', 'despachante'].forEach(function (field) {
            global.ETL.canonicalizeField(state.dataset, field);
          });
        } else if (global.ETL && typeof global.ETL.canonicalizeAgents === 'function') {
          global.ETL.canonicalizeAgents(state.dataset);
        }
        state.meta = {
          name: snapshot.meta.name,
          sheetName: snapshot.meta.sheetName,
          headerRow: snapshot.meta.headerRow,
          rowCount: snapshot.meta.rowCount,
          ignoredRows: snapshot.meta.ignoredRows || 0,
          commentCount: snapshot.meta.commentCount || 0,
          parserVersion: snapshot.meta.parserVersion || 1,
          loadedAt: new Date(snapshot.meta.loadedAt)
        };
        state.isDemo = false;
        if (snapshot.filters) Object.assign(state.filters, snapshot.filters);
        if (typeof snapshot.search === 'string') state.search = snapshot.search;
        if (snapshot.analistaMode != null) {
          if (global.DashboardState && typeof global.DashboardState.normalizeAnalistaMode === 'function') {
            state.analistaMode = global.DashboardState.normalizeAnalistaMode(snapshot.analistaMode);
          } else {
            state.analistaMode = snapshot.analistaMode === 'qtd' ? 'qtd' : 'valor';
          }
        }
        if (snapshot.uiStyle != null) {
          if (global.DashboardState && typeof global.DashboardState.normalizeUiStyle === 'function') {
            state.uiStyle = global.DashboardState.normalizeUiStyle(snapshot.uiStyle);
          } else {
            state.uiStyle = snapshot.uiStyle === 'modern' ? 'modern' : 'classic';
          }
          applyVisualStyle(state.uiStyle, false);
        }
        applyAnalistaModeUI();
        global.UI.toast('Último arquivo carregado restaurado: ' + snapshot.meta.name, 'info', 'Sessão restaurada');
        if (state.meta.parserVersion !== global.ETL.PARSER_VERSION) {
          global.UI.toast('Os dados salvos foram mantidos. Reimporte o Excel para aplicar as correções do importador.', 'warning', 'Reimportação recomendada');
        }
      } else {
        state.dataset = [];
        state.meta = { name: DEMO_FILE, sheetName: '', headerRow: null, rowCount: 0, loadedAt: new Date() };
        state.isDemo = true;
      }
      populateFilterOptions();
      normalizeFilterState();
      applyFilterStateToInputs();
      refresh();
    }).catch(function (error) {
      console.error('Falha ao inicializar o dataset.', error);
      state.dataset = [];
      state.meta = { name: DEMO_FILE, sheetName: '', headerRow: null, rowCount: 0, loadedAt: new Date() };
      state.isDemo = true;
      populateFilterOptions();
      normalizeFilterState();
      applyFilterStateToInputs();
      refresh();
    });
  }

  function bindEvents() {
    els['tab-btn-dashboard'].addEventListener('click', function () { switchTab('dashboard'); });
    els['tab-btn-data'].addEventListener('click', function () { switchTab('data'); });
    els['tab-btn-integration'].addEventListener('click', function () { switchTab('integration'); });

    document.querySelectorAll('[data-ui-style-option]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyVisualStyle(button.dataset.uiStyleOption);
        schedulePersist();
        if (typeof button.blur === 'function') button.blur();
      });
    });

    document.querySelectorAll('[data-analista-mode]').forEach(function (button) {
      button.addEventListener('click', function () { setAnalistaMode(button.dataset.analistaMode); });
    });

    document.querySelector('.tablist').addEventListener('keydown', function (event) {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      var tabs = ['dashboard', 'data', 'integration'];
      var active = tabs.indexOf(document.querySelector('.tablist [aria-selected="true"]').dataset.tab);
      var next = event.key === 'Home' ? 0 : (event.key === 'End' ? tabs.length - 1 : (event.key === 'ArrowRight' ? (active + 1) % tabs.length : (active + tabs.length - 1) % tabs.length));
      switchTab(tabs[next]);
      document.getElementById('tab-btn-' + tabs[next]).focus();
    });

    var selectMap = {
      'monthly-year': 'ano',
      'filter-mes': 'mes',
      'filter-analista': 'analista',
      'filter-situacao': 'situacao',
      'filter-reg-di': 'regDi',
      'filter-mercadoria': 'mercadoria',
      'filter-modal': 'modal',
      'filter-incoterm': 'incoterm',
      'filter-despachante': 'despachante'
    };
    Object.keys(selectMap).forEach(function (id) {
      els[id].addEventListener('change', function () {
        state.filters[selectMap[id]] = els[id].value;
        state.page = 1;
        refresh();
        schedulePersist();
      });
    });

    els['filter-operacao'].addEventListener('input', global.UI.debounce(function () {
      state.filters.operacao = els['filter-operacao'].value.trim();
      state.page = 1;
      refresh();
      schedulePersist();
    }, 250));

    els['table-search'].addEventListener('input', global.UI.debounce(function () {
      state.search = els['table-search'].value.trim();
      state.page = 1;
      refresh();
      schedulePersist();
    }, 250));

    els['btn-reset-filters'].addEventListener('click', function () { resetFilters(); });
    els['btn-export-csv'].addEventListener('click', exportCsv);
    els['excel-file-input'].addEventListener('change', handleFileUpload);

    els['page-size'].addEventListener('change', function () {
      state.pageSize = Number(els['page-size'].value) || 50;
      state.page = 1;
      renderTable();
    });
    els['page-prev'].addEventListener('click', function () {
      if (state.page > 1) { state.page -= 1; renderTable(); }
    });
    els['page-next'].addEventListener('click', function () {
      state.page += 1;
      renderTable();
    });

    els['table-head'].addEventListener('click', function (event) {
      var button = event.target.closest('[data-sort]');
      if (!button) return;
      var key = button.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 1 ? -1 : 1;
      } else {
        state.sort = { key: key, dir: 1 };
      }
      state.page = 1;
      renderTable();
    });

    els.modal.addEventListener('click', function (event) {
      if (event.target.closest('[data-modal-close]')) global.UI.closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') global.UI.closeModal();
    });

    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var source = document.getElementById(button.dataset.copy);
        if (!source) return;
        global.UI.copyText(source.innerText).then(function (ok) {
          if (ok) {
            global.UI.toast('Código copiado para a área de transferência.', 'success');
            return;
          }
          try {
            var selection = window.getSelection();
            selection.removeAllRanges();
            selection.selectAllChildren(source);
          } catch (selectionError) { /* noop */ }
          global.UI.toast('Não foi possível copiar automaticamente. O código foi selecionado — pressione Ctrl+C.', 'warning', 'Cópia manual');
        });
      });
    });
  }

  function applyVisualStyle(style, refreshCharts) {
    var nextStyle = style === 'modern' ? 'modern' : 'classic';
    state.uiStyle = nextStyle;
    document.body.dataset.uiStyle = nextStyle;
    ['modern', 'classic'].forEach(function (option) {
      var button = els['style-option-' + option];
      if (!button) return;
      button.setAttribute('aria-pressed', option === nextStyle ? 'true' : 'false');
    });
    if (refreshCharts !== false && global.Charts && typeof global.Charts.setStyle === 'function') {
      global.Charts.setStyle(nextStyle);
      global.Charts.render(state.filtered, {
        monthlyYear: state.filters.ano,
        isDemo: state.isDemo,
        uiStyle: nextStyle,
        analistaMode: state.analistaMode
      });
    }
  }

  function applyAnalistaModeUI() {
    var isCount = state.analistaMode === 'qtd';
    var title = document.getElementById('analistas-title');
    if (title) title.textContent = isCount ? 'Quantidade de Processos por Analista' : 'Valor USD Movimentado por Analista';
    var unit = document.getElementById('analistas-unit');
    if (unit) unit.textContent = isCount ? 'Nº de processos' : 'Valores em USD';
    var canvas = document.getElementById('chart-analistas');
    if (canvas) {
      canvas.setAttribute('aria-label', isCount
        ? 'Gráfico de barras da quantidade de processos por analista'
        : 'Gráfico de barras do valor movimentado por analista');
    }
    ['valor', 'qtd'].forEach(function (mode) {
      var button = document.getElementById('analistas-mode-' + mode);
      if (!button) return;
      var active = (mode === 'qtd') === isCount;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('bg-brand-600', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('shadow', active);
      button.classList.toggle('text-slate-400', !active);
      button.classList.toggle('hover:text-white', !active);
    });
  }

  function setAnalistaMode(mode) {
    var next = mode === 'qtd' ? 'qtd' : 'valor';
    if (state.analistaMode === next) return;
    state.analistaMode = next;
    applyAnalistaModeUI();
    refresh();
    schedulePersist();
  }

  function switchTab(tabName) {
    ['dashboard', 'data', 'integration'].forEach(function (tab) {
      var panel = document.getElementById('tab-' + tab);
      var button = document.getElementById('tab-btn-' + tab);
      var active = tab === tabName;
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      panel.classList.toggle('hidden', !active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
      button.classList.toggle('bg-brand-600', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('shadow', active);
      button.classList.toggle('text-slate-400', !active);
      button.classList.toggle('hover:text-white', !active);
    });
    if (tabName === 'data') renderTable();
  }

  function fillSelect(select, values, allLabel, labelFn) {
    if (!select) return;
    var current = select.value;
    var unique = Array.from(new Set(values.filter(function (value) {
      return value != null && String(value).trim() !== '';
    }))).sort(function (a, b) {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), 'pt-BR');
    });
    var html = '<option value="ALL">' + global.UI.escapeHtml(allLabel) + '</option>';
    unique.forEach(function (value) {
      html += '<option value="' + global.UI.escapeHtml(value) + '">' +
        global.UI.escapeHtml(labelFn ? labelFn(value) : value) + '</option>';
    });
    select.innerHTML = html;
    select.value = unique.map(String).indexOf(String(current)) > -1 ? current : 'ALL';
  }

  function populateFilterOptions() {
    fillSelect(els['filter-mes'], state.dataset.map(getMonthlyReferenceMonth), 'Todos os Meses', function (month) { return global.ETL.monthName(month); });
    fillSelect(els['filter-analista'], state.dataset.map(function (item) { return item.analista; }), 'Todos os Analistas');
    fillSelect(els['filter-mercadoria'], state.dataset.map(function (item) { return item.mercadoria; }), 'Todas as Mercadorias');
    fillSelect(els['filter-incoterm'], state.dataset.map(function (item) { return item.incoterm; }), 'Todos Incoterms');
    fillSelect(els['filter-despachante'], state.dataset.map(function (item) { return item.despachante; }), 'Todos os Despachantes');
    populateMonthlyYearOptions();
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

  function getAvailableMonthlyYears() {
    return Array.from(new Set(state.dataset.map(getMonthlyReferenceYear).filter(function (year) {
      return year != null;
    }))).sort(function (a, b) { return b - a; });
  }

  function populateMonthlyYearOptions() {
    var years = getAvailableMonthlyYears();
    var current = state.filters.ano || 'LATEST';
    var html = '<option value="LATEST">Ano mais recente</option><option value="ALL">Todos os anos</option>';
    years.forEach(function (year) {
      html += '<option value="' + year + '">' + year + '</option>';
    });
    els['monthly-year'].innerHTML = html;
    var values = ['LATEST', 'ALL'].concat(years.map(String));
    state.filters.ano = values.indexOf(String(current)) > -1 ? String(current) : 'LATEST';
    els['monthly-year'].value = state.filters.ano;
  }

  function normalizeFilterState() {
    var availableValues = {
      mes: Array.from(els['filter-mes'].options).map(function (option) { return option.value; }),
      ano: Array.from(els['monthly-year'].options).map(function (option) { return option.value; }),
      analista: Array.from(els['filter-analista'].options).map(function (option) { return option.value; }),
      situacao: Array.from(els['filter-situacao'].options).map(function (option) { return option.value; }),
      regDi: Array.from(els['filter-reg-di'].options).map(function (option) { return option.value; }),
      mercadoria: Array.from(els['filter-mercadoria'].options).map(function (option) { return option.value; }),
      modal: Array.from(els['filter-modal'].options).map(function (option) { return option.value; }),
      incoterm: Array.from(els['filter-incoterm'].options).map(function (option) { return option.value; }),
      despachante: Array.from(els['filter-despachante'].options).map(function (option) { return option.value; })
    };
    state.filters = global.DashboardState.normalizeFilters(state.filters, availableValues);
    var hasYearOption = availableValues.ano.some(function (value) { return /^\d{4}$/.test(String(value)); });
    if (!hasYearOption && state.filters.ano === 'LATEST') state.filters.ano = 'ALL';
  }

  function applyFilterStateToInputs() {
    normalizeFilterState();
    els['filter-operacao'].value = state.filters.operacao;
    els['monthly-year'].value = state.filters.ano;
    els['filter-mes'].value = state.filters.mes;
    els['filter-analista'].value = state.filters.analista;
    els['filter-situacao'].value = state.filters.situacao;
    els['filter-reg-di'].value = state.filters.regDi;
    els['filter-mercadoria'].value = state.filters.mercadoria;
    els['filter-modal'].value = state.filters.modal;
    els['filter-incoterm'].value = state.filters.incoterm;
    els['filter-despachante'].value = state.filters.despachante;
    els['table-search'].value = state.search;
    els['page-size'].value = String(state.pageSize);
  }

  function resetFilters(options) {
    var settings = options || {};
    state.filters = global.DashboardState.defaultFilters();
    state.search = '';
    state.page = 1;
    applyFilterStateToInputs();
    if (settings.skipRefresh !== true) refresh();
    schedulePersist();
    if (settings.silent !== true) global.UI.toast('Filtros limpos.', 'info');
  }

  function getSelectedYear() {
    var selected = String(state.filters.ano || 'LATEST');
    if (selected === 'ALL') return null;
    if (selected === 'LATEST') return getAvailableMonthlyYears()[0] || null;
    var year = Number(selected);
    return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
  }

  function matchesFilters(item, selectedYear) {
    var filters = state.filters;
    if (filters.ano !== 'ALL' && selectedYear != null && getMonthlyReferenceYear(item) !== selectedYear) return false;
    if (filters.operacao && String(item.operacao).toLowerCase().indexOf(filters.operacao.toLowerCase()) === -1) return false;
    if (filters.mes !== 'ALL' && String(getMonthlyReferenceMonth(item)) !== filters.mes) return false;
    if (filters.analista !== 'ALL' && item.analista !== filters.analista) return false;
    if (filters.situacao !== 'ALL') {
      var done = global.ETL.isConcluida(item);
      var cancelled = typeof global.ETL.isCancelada === 'function' ? global.ETL.isCancelada(item) : false;
      if (filters.situacao === 'Concluida' && !done) return false;
      if (filters.situacao === 'Cancelada' && !cancelled) return false;
      if (filters.situacao === 'Andamento' && (done || cancelled)) return false;
    }
    if (filters.regDi !== 'ALL') {
      var registered = global.ETL.isDiRegistered(item);
      if (filters.regDi === 'REGISTRADA' && !registered) return false;
      if (filters.regDi === 'PENDENTE' && registered) return false;
    }
    if (filters.mercadoria !== 'ALL' && item.mercadoria !== filters.mercadoria) return false;
    if (filters.modal !== 'ALL') {
      var modalCategory = item.modalCategory || global.ETL.classifyModal(item.modal);
      if (filters.modal !== modalCategory) return false;
    }
    if (filters.incoterm !== 'ALL' && item.incoterm !== filters.incoterm) return false;
    if (filters.despachante !== 'ALL' && item.despachante !== filters.despachante) return false;
    if (state.search && item._search.indexOf(state.search.toLowerCase()) === -1) return false;
    return true;
  }

  function getVisibleData() {
    var selectedYear = getSelectedYear();
    return state.dataset.filter(function (item) { return matchesFilters(item, selectedYear); });
  }

  function sortValue(item, key) {
    switch (key) {
      case 'month':
        var referenceMonth = getMonthlyReferenceMonth(item);
        if (referenceMonth == null) return -1;
        var referenceYear = getMonthlyReferenceYear(item);
        return (referenceYear == null ? 0 : referenceYear) * 100 + referenceMonth;
      case 'valor': return item.valorUSD != null ? item.valorUSD : (item.valor || 0);
      case 'peso': return item.peso || 0;
      case 'slaDias': return item.slaDias == null ? -1 : item.slaDias;
      case 'rota': return (item.origem + ' ' + item.destino).toLowerCase();
      case 'regDi':
        var regDiText = String(item.regDi || '').trim();
        if (!regDiText) return -1;
        var regDiMatch = regDiText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (regDiMatch) return Number(regDiMatch[3]) * 10000 + Number(regDiMatch[2]) * 100 + Number(regDiMatch[1]);
        return Number.MAX_SAFE_INTEGER;
      default: return String(item[key] == null ? '' : item[key]).toLowerCase();
    }
  }

  function getSortedData() {
    var key = state.sort.key;
    var dir = state.sort.dir;
    return state.filtered.slice().sort(function (a, b) {
      var valueA = sortValue(a, key);
      var valueB = sortValue(b, key);
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return (valueA - valueB) * dir;
      }
      return String(valueA).localeCompare(String(valueB), 'pt-BR') * dir;
    });
  }

  function refresh() {
    state.filtered = getVisibleData();
    updateBanner();
    updateKPIs(state.filtered);
    if (global.Charts) {
      try { global.Charts.render(state.filtered, { monthlyYear: state.filters.ano, isDemo: state.isDemo, uiStyle: state.uiStyle, analistaMode: state.analistaMode }); }
      catch (error) {
        console.error('Falha ao atualizar os gráficos.', error);
        global.UI.toast('Os dados foram atualizados, mas um gráfico não pôde ser redesenhado.', 'warning', 'Visualização parcial');
      }
    }
    renderTable();
  }

  function updateBanner() {
    var meta = state.meta || {};
    var lastReadText = state.isDemo || !state.dataset.length
      ? 'Última leitura: aguardando arquivo'
      : 'Última leitura: ' + global.UI.formatDateTime(meta.loadedAt);
    els['last-read-header'].innerText = lastReadText;
    if (state.isDemo || !state.dataset.length) {
      els['banner-text'].innerHTML = 'Nenhum arquivo carregado. Clique em <strong>Carregar Excel Atualizado</strong> para selecionar a planilha <strong>!Importações.xlsx</strong>.';
      els['last-update-time'].innerText = 'Aguardando arquivo';
      return;
    }
    var ignoredText = meta.ignoredRows ? ' &bull; ' + global.UI.formatNumber(meta.ignoredRows) + ' linha(s) ignorada(s)' : '';
    var commentsText = meta.commentCount ? ' &bull; ' + global.UI.formatNumber(meta.commentCount) + ' comentário(s)' : '';
    els['banner-text'].innerHTML = '<strong>' + global.UI.escapeHtml(meta.name) + '</strong>' +
      ' &bull; Guia ' + global.UI.escapeHtml(meta.sheetName || '—') +
      ' &bull; ' + global.UI.formatNumber(meta.rowCount || state.dataset.length) + ' processos' +
      (meta.headerRow ? ' &bull; Cabeçalho na linha ' + meta.headerRow : '') + ignoredText + commentsText;
    els['last-update-time'].innerText = 'Última leitura: ' + global.UI.formatDateTime(meta.loadedAt);
  }

  var STATUS_BANNER_VISIBLE_MS = 8000;
  var STATUS_BANNER_FADE_MS = 300;

  function clearStatusBannerTimers(banner) {
    if (banner._hideTimer) { clearTimeout(banner._hideTimer); banner._hideTimer = null; }
    if (banner._fadeTimer) { clearTimeout(banner._fadeTimer); banner._fadeTimer = null; }
  }

  // O card de status é transitório: nunca é revelado por refresh(), restoreState()
  // ou mudança de filtro. Só o carregamento de um arquivo chama showTransientUpdateBanner().
  function hideStatusBanner() {
    var banner = document.getElementById('status-banner');
    if (!banner) return;
    clearStatusBannerTimers(banner);
    banner.classList.remove('is-fading-out');
    banner.hidden = true;
  }

  function showTransientUpdateBanner() {
    var banner = document.getElementById('status-banner');
    if (!banner) return;
    clearStatusBannerTimers(banner);
    banner.hidden = false;
    banner.classList.remove('is-fading-out');
    banner._hideTimer = setTimeout(function () {
      banner._hideTimer = null;
      banner.classList.add('is-fading-out');
      banner._fadeTimer = setTimeout(function () {
        banner._fadeTimer = null;
        hideStatusBanner();
      }, STATUS_BANNER_FADE_MS);
    }, STATUS_BANNER_VISIBLE_MS);
  }

  // Falhas fatais de inicialização precisam ficar visíveis (sem timer), mas sem
  // destruir os filhos do card usados por updateBanner().
  function showStatusBannerError(message) {
    var banner = document.getElementById('status-banner');
    if (!banner) return;
    clearStatusBannerTimers(banner);
    banner.classList.remove('is-fading-out');
    var text = banner.querySelector('#banner-text');
    if (text) text.textContent = message;
    banner.hidden = false;
  }

  function updateKPIs(data) {
    var totalValor = data.reduce(function (acc, item) { return acc + (Number(item.valorUSD) || 0); }, 0);
    var totalPeso = data.reduce(function (acc, item) { return acc + (item.peso || 0); }, 0);
    var concluidos = data.filter(global.ETL.isConcluida).length;
    var valorValues = data.map(function (item) { return Number(item.valorUSD); }).filter(function (value) {
      return Number.isFinite(value) && value !== 0;
    });
    var foreignCurrencyCount = data.filter(function (item) {
      return item.valorMoeda && item.valorMoeda !== 'USD' && Number(item.valor) !== 0;
    }).length;
    var slaValues = data.map(function (item) { return item.slaDias; }).filter(function (value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    });

    els['kpi-volume'].innerText = global.UI.formatCompactUSD(totalValor);
    els['kpi-volume-hint'].innerText = global.UI.formatUSDFull(totalValor) + (foreignCurrencyCount
      ? ' · ' + global.UI.formatNumber(foreignCurrencyCount) + ' valor(es) fora do USD'
      : '');
    els['kpi-processos'].innerText = global.UI.formatNumber(data.length);
    els['kpi-peso'].innerText = global.UI.formatNumber(totalPeso / 1000, 0) + ' t';
    els['kpi-ticket'].innerText = valorValues.length ? global.UI.formatCompactUSD(totalValor / valorValues.length) : '$0';
    els['kpi-conclusao'].innerText = data.length ? global.UI.formatPercent((concluidos / data.length) * 100) : '0%';

    if (slaValues.length) {
      var media = slaValues.reduce(function (acc, value) { return acc + value; }, 0) / slaValues.length;
      els['kpi-sla'].innerText = global.UI.formatNumber(media, 1) + ' dias';
      els['kpi-sla-hint'].innerText = 'Média de ' + global.UI.formatNumber(slaValues.length) + ' processo(s) com SLA';
    } else {
      els['kpi-sla'].innerText = '—';
      els['kpi-sla-hint'].innerText = state.dataset.length ? 'Sem dados de SLA para os filtros atuais' : 'Aguardando carregamento de dados';
    }
  }

  function renderTable() {
    var sorted = getSortedData();
    var total = sorted.length;
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * state.pageSize;
    var rows = sorted.slice(start, start + state.pageSize);

    var html = '';
    rows.forEach(function (item) {
      var diRegistered = global.ETL.isDiRegistered(item);
      var concluded = global.ETL.isConcluida(item);
      var modal = String(item.modal || 'N/A').toUpperCase();
      var modalCategory = item.modalCategory || global.ETL.classifyModal(modal);
      var modalClass = modalCategory === 'FCL'
        ? 'bg-blue-950 text-blue-400 border border-blue-800'
        : (modalCategory === 'LCL' ? 'bg-purple-950 text-purple-400 border border-purple-800' : 'bg-slate-800 text-slate-300 border border-slate-600');
      var statusFlags = '';
      if (global.ETL.isFaturada(item)) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">Faturada</span>';
      if (global.ETL.isArquivado(item)) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-200 border border-slate-600">Arquivado</span>';
      if (item.atracado === true) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">Atracado</span>';
      if (item.comments.length) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800" title="' + global.UI.escapeHtml(item.comments.map(function (comment) { return comment.text || comment.reference; }).join(' | ')) + '">Comentário</span>';
      html += '<tr class="hover:bg-slate-700/30 transition">' +
        '<td class="p-3.5 text-slate-400 font-mono">' + global.UI.escapeHtml(global.ETL.monthName(getMonthlyReferenceMonth(item))) + '</td>' +
        '<td class="p-3.5 text-slate-200 font-semibold font-mono">' + global.UI.escapeHtml(item.operacao) + '</td>' +
        '<td class="p-3.5 font-semibold text-white">' + global.UI.escapeHtml(item.analista) + '</td>' +
        '<td class="p-3.5 text-slate-300 font-medium">' + global.UI.escapeHtml(item.mercadoria) + '</td>' +
        '<td class="p-3.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold ' + modalClass + '">' + global.UI.escapeHtml(modal) + '</span></td>' +
        '<td class="p-3.5 font-mono">' + (diRegistered
          ? '<span class="text-emerald-400 font-medium"><i class="fa-solid fa-check text-[10px] mr-1"></i>' + global.UI.escapeHtml(item.regDi) + '</span>'
          : '<span class="text-slate-500 italic">Pendente</span>') + '</td>' +
        '<td class="p-3.5"><div class="flex flex-wrap items-center gap-1"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' +
          (concluded ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800') + '">' +
          global.UI.escapeHtml(item.situacao) + '</span>' + statusFlags + '</div></td>' +
        '<td class="p-3.5 text-slate-300">' + global.UI.escapeHtml(item.origem) + ' &rarr; ' + global.UI.escapeHtml(item.destino) + '</td>' +
        '<td class="p-3.5 font-bold text-slate-200">' + global.UI.escapeHtml(item.incoterm) + '</td>' +
        '<td class="p-3.5 text-right font-mono text-emerald-400 font-bold" title="' + global.UI.escapeHtml(item.valorMoeda || 'USD') + '">' + global.UI.formatCurrencyFull(item.valor, item.valorMoeda) + '</td>' +
        '</tr>';
    });

    if (!rows.length) {
      html = '<tr><td colspan="10" class="p-10 text-center text-slate-500">' +
        '<i class="fa-solid fa-inbox text-2xl mb-2 block text-slate-600"></i>' +
        'Nenhum registro encontrado para os filtros atuais.</td></tr>';
    }

    els['table-body'].innerHTML = html;
    els['table-count'].innerText = total
      ? 'Exibindo ' + global.UI.formatNumber(start + 1) + '–' + global.UI.formatNumber(Math.min(start + state.pageSize, total)) + ' de ' + global.UI.formatNumber(total) + ' registro(s)'
      : 'Nenhum registro';
    els['page-info'].innerText = 'Página ' + state.page + ' de ' + pages;
    els['page-prev'].disabled = state.page <= 1;
    els['page-next'].disabled = state.page >= pages;
    updateSortIndicators();
  }

  function updateSortIndicators() {
    els['table-head'].querySelectorAll('[data-sort]').forEach(function (button) {
      var icon = button.querySelector('i');
      var isActive = button.dataset.sort === state.sort.key;
      var direction = isActive ? state.sort.dir : 0;
      button.closest('th').setAttribute('aria-sort', direction === 1 ? 'ascending' : (direction === -1 ? 'descending' : 'none'));
      button.classList.toggle('text-brand-400', isActive);
      if (icon) {
        icon.className = 'fa-solid text-[10px] ' + (direction === 1 ? 'fa-sort-up' : (direction === -1 ? 'fa-sort-down' : 'fa-sort text-slate-600'));
      }
    });
  }

  function csvCell(value) {
    var text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    var rows = getSortedData();
    var flagCsv = function (value) { return value === true ? 'Sim' : (value === false ? 'Não' : (value || '')); };
    var lines = ['Mês;Operação;Analista;Mercadoria;LCL/FCL;Modalidade;Reg DI;Situação;Origem;Destino;Incoterm;Valor informado;Moeda;Valor USD;Despachante;ETA;Ano ETA;ETS;Est Emb;Est Atr;Fechamento;Estimativa Emb;Estimativa Atr;Atracado;RIC;Número DI;Protocolo DI;Transportadora;Free time;Data Free time;Dias p/ Dev CNTR;Dias p/ Demurrage;Exportador;Agente;Conhecimento;Container;Invoice;Navio;Faturada;Arquivado;Comentários;Linha Excel'];
    rows.forEach(function (item) {
      lines.push([
        csvCell(getMonthlyReferenceMonth(item) == null ? '' : getMonthlyReferenceMonth(item)),
        csvCell(item.operacao),
        csvCell(item.analista),
        csvCell(item.mercadoria),
        csvCell(item.modal),
        csvCell(item.modalidade),
        csvCell(item.regDi),
        csvCell(item.situacao),
        csvCell(item.origem),
        csvCell(item.destino),
        csvCell(item.incoterm),
        csvCell((item.valor || 0).toFixed(2).replace('.', ',')),
        csvCell(item.valorMoeda || 'USD'),
        csvCell(item.valorUSD == null ? '' : item.valorUSD.toFixed(2).replace('.', ',')),
        csvCell(item.despachante),
        csvCell(item.eta),
        csvCell(item.etaYear == null ? '' : item.etaYear),
        csvCell(item.ets),
        csvCell(item.estEmb),
        csvCell(item.estAtr),
        csvCell(item.fech),
        csvCell(flagCsv(item.estimativaEmb)),
        csvCell(flagCsv(item.estimativaAtr)),
        csvCell(flagCsv(item.atracado)),
        csvCell(item.ric),
        csvCell(item.numeroDi),
        csvCell(item.protocoloDi),
        csvCell(item.transportadora),
        csvCell(item.freeTime == null ? '' : String(item.freeTime).replace('.', ',')),
        csvCell(item.freeTimeData),
        csvCell(item.diasDevCntr == null ? '' : String(item.diasDevCntr).replace('.', ',')),
        csvCell(item.diasDemurrage == null ? '' : String(item.diasDemurrage).replace('.', ',')),
        csvCell(item.exportador),
        csvCell(item.agente),
        csvCell(item.conhecimento),
        csvCell(item.container),
        csvCell(item.invoice),
        csvCell(item.navio),
        csvCell(global.ETL.isFaturada(item) ? 'Sim' : ''),
        csvCell(global.ETL.isArquivado(item) ? 'Sim' : ''),
        csvCell(item.comments.map(function (comment) {
          return [comment.reference, comment.text, comment.author, comment.date].filter(Boolean).join(' — ');
        }).join(' | ')),
        csvCell(item.sourceRowNumber == null ? '' : item.sourceRowNumber)
      ].join(';'));
    });
    var stamp = new Date().toISOString().slice(0, 10);
    global.UI.downloadFile('relatorio_importacoes_' + stamp + '.csv', '\uFEFF' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    global.UI.toast(global.UI.formatNumber(rows.length) + ' registro(s) exportado(s) no CSV.', 'success', 'Exportação concluída');
  }

  function ensureXlsxLoaded() {
    if (typeof global.XLSX !== 'undefined') return Promise.resolve(global.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;
    xlsxLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'vendor/xlsx.full.min.js';
      script.onload = function () {
        if (typeof global.XLSX !== 'undefined') resolve(global.XLSX);
        else reject(new Error('A biblioteca XLSX foi carregada, mas não ficou disponível.'));
      };
      script.onerror = function () { reject(new Error('Não foi possível carregar a biblioteca de importação Excel.')); };
      document.head.appendChild(script);
    }).catch(function (error) {
      xlsxLoadPromise = null;
      throw error;
    });
    return xlsxLoadPromise;
  }

  function setUploadLoading(input, loading) {
    var label = input.closest('.upload-label');
    if (label) label.classList.toggle('is-loading', loading);
    input.disabled = loading;
  }

  function parseBuffer(buffer) {
    return new Promise(function (resolve) {
      var worker = null;
      try {
        worker = new Worker('assets/js/worker.js');
      } catch (error) {
        worker = null;
      }
      if (!worker) {
        setTimeout(function () {
          try { resolve(global.ETL.parseWorkbook(buffer)); }
          catch (error) { resolve({ error: error }); }
        }, 0);
        return;
      }
      var settled = false;
      var finish = function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (error) { /* noop */ }
        resolve(result);
      };
      var timer = setTimeout(function () {
        finish({ error: new Error('Tempo excedido ao processar o arquivo.') });
      }, 90000);
      worker.onmessage = function (event) {
        if (event.data && event.data.ok) finish(event.data.result);
        else finish({ error: new Error((event.data && event.data.error) || 'Falha ao processar a planilha.') });
      };
      worker.onerror = function (event) {
        console.error('Falha no Worker de importação; usando o processamento principal.', event);
        try { finish(global.ETL.parseWorkbook(buffer)); }
        catch (error) { finish({ error: error }); }
      };
      try {
        worker.postMessage({ buffer: buffer });
      } catch (error) {
        try { finish(global.ETL.parseWorkbook(buffer)); }
        catch (fallbackError) { finish({ error: fallbackError }); }
      }
    });
  }

  function handleFileUpload(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    setUploadLoading(input, true);
    global.UI.toast('Processando "' + file.name + '"...', 'info');
    ensureXlsxLoaded().then(function () {
      return file.arrayBuffer();
    }).then(function (buffer) {
      return parseBuffer(buffer);
    }).then(function (result) {
      if (result.error) throw result.error;
      state.dataset = result.records.map(prepareRecord);
      if (global.ETL && typeof global.ETL.canonicalizeField === 'function') {
        ['agente', 'origem', 'destino', 'mercadoria', 'analista', 'despachante'].forEach(function (field) {
          global.ETL.canonicalizeField(state.dataset, field);
        });
      } else if (global.ETL && typeof global.ETL.canonicalizeAgents === 'function') {
        global.ETL.canonicalizeAgents(state.dataset);
      }
      state.meta = {
        name: file.name,
        sheetName: result.sheetName,
        headerRow: result.headerRowNumber,
        rowCount: result.totalRows,
        ignoredRows: result.ignoredRows || 0,
        commentCount: result.commentCount || 0,
        parserVersion: global.ETL.PARSER_VERSION,
        loadedAt: new Date()
      };
      state.isDemo = false;
      state.page = 1;
      populateFilterOptions();
      resetFilters({ silent: true, skipRefresh: true });
      schedulePersist();
      refresh();
      showTransientUpdateBanner();
      var ignoredMessage = result.ignoredRows
        ? ' ' + global.UI.formatNumber(result.ignoredRows) + ' linha(s) sem campos operacionais foram ignoradas.'
        : '';
      var commentMessage = result.commentCount
        ? ' ' + global.UI.formatNumber(result.commentCount) + ' comentário(s) da aba Comments foram associados.'
        : '';
      var foreignCurrencyEntries = Object.keys(result.currencyCounts || {}).filter(function (currency) {
        return currency !== 'USD' && result.currencyCounts[currency] > 0;
      });
      var foreignCurrencyMessage = foreignCurrencyEntries.length
        ? ' ' + global.UI.formatNumber(foreignCurrencyEntries.reduce(function (total, currency) { return total + result.currencyCounts[currency]; }, 0)) +
          ' valor(es) em ' + foreignCurrencyEntries.join(', ') + ' foram preservados sem conversão para USD.'
        : '';
      global.UI.toast('"' + file.name + '" importado: ' + global.UI.formatNumber(result.totalRows) +
        ' processo(s) na guia "' + result.sheetName + '".' + ignoredMessage + commentMessage + foreignCurrencyMessage, 'success', 'Excel carregado');
      if (result.mapping.unmapped.length || result.commentCount) showMappingReport(result);
    }).catch(function (error) {
      console.error('[BI Hub] Falha na importação.', error && error.message ? error.message : error);
      global.UI.toast(error && error.message ? error.message : 'Falha ao processar o arquivo Excel.', 'error', 'Erro na importação');
    }).then(function () {
      input.value = '';
      setUploadLoading(input, false);
    });
  }

  function showMappingReport(result) {
    var mapped = result.mapping.mapped.map(function (entry) {
      return '<li class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800">' +
        '<span class="text-slate-400">' + global.UI.escapeHtml(entry.label) + '</span>' +
        '<span class="font-mono text-emerald-400">' + global.UI.escapeHtml(entry.header) + '</span></li>';
    }).join('');
    var unmapped = result.mapping.unmapped.map(function (header) {
      return '<li class="py-1 font-mono text-slate-300">' + global.UI.escapeHtml(header) + '</li>';
    }).join('');
    var html = '<p class="mb-3 text-slate-400">Guia <strong class="text-slate-200">' + global.UI.escapeHtml(result.sheetName) +
      '</strong>, cabeçalho na linha <strong class="text-slate-200">' + result.headerRowNumber + '</strong>, ' +
      global.UI.formatNumber(result.totalRows) + ' registros lidos.' +
      (result.ignoredRows ? ' ' + global.UI.formatNumber(result.ignoredRows) + ' linha(s) sem campos operacionais foram ignoradas.' : '') +
      (result.commentCount ? ' A aba <strong class="text-slate-200">Comments</strong> trouxe ' + global.UI.formatNumber(result.commentCount) + ' observação(ões), associada(s) pela linha do Excel e exportada(s) no CSV.' : '') + '</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<div><h4 class="font-bold text-emerald-400 mb-2 text-[11px] uppercase tracking-wide">Colunas reconhecidas</h4>' +
      '<ul>' + (mapped || '<li class="text-slate-500">Nenhuma</li>') + '</ul></div>' +
      '<div><h4 class="font-bold text-amber-400 mb-2 text-[11px] uppercase tracking-wide">Colunas ignoradas</h4>' +
      '<ul class="max-h-56 overflow-y-auto custom-scrollbar">' + (unmapped || '<li class="text-slate-500">Nenhuma</li>') + '</ul></div>' +
      '</div>';
    global.UI.openModal({ title: 'Relatório de importação', html: html });
  }

  function openDb() {
    return new Promise(function (resolve) {
      try {
        var request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
      } catch (error) {
        resolve(null);
      }
    });
  }

  function idbSet(key, value) {
    return openDb().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        var settled = false;
        var finish = function (result) {
          if (settled) return;
          settled = true;
          try { db.close(); } catch (error) { /* noop */ }
          resolve(result);
        };
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(value, key);
          tx.oncomplete = function () { finish(true); };
          tx.onerror = function () { finish(false); };
          tx.onabort = function () { finish(false); };
        } catch (error) {
          finish(false);
        }
      });
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var settled = false;
        var finish = function (result) {
          if (settled) return;
          settled = true;
          try { db.close(); } catch (error) { /* noop */ }
          resolve(result);
        };
        try {
          var tx = db.transaction(DB_STORE, 'readonly');
          var request = tx.objectStore(DB_STORE).get(key);
          request.onsuccess = function () { finish(request.result || null); };
          request.onerror = function () { finish(null); };
          tx.onerror = function () { finish(null); };
          tx.onabort = function () { finish(null); };
        } catch (error) {
          finish(null);
        }
      });
    });
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      persistState().then(function (saved) {
        if (saved) {
          persistenceWarningShown = false;
          return;
        }
        if (!state.isDemo && !persistenceWarningShown) {
          persistenceWarningShown = true;
          global.UI.toast('O dataset atual não pôde ser salvo nesta sessão.', 'warning', 'Persistência indisponível');
        }
      }).catch(function (error) {
        console.error('Falha ao persistir o dataset.', error);
        if (!persistenceWarningShown) {
          persistenceWarningShown = true;
          global.UI.toast('O dataset atual não pôde ser salvo nesta sessão.', 'warning', 'Persistência indisponível');
        }
      });
    }, 600);
  }

  function persistState() {
    if (state.isDemo) return Promise.resolve(false);
    var snapshot = {
      version: global.DashboardState.SNAPSHOT_VERSION,
      records: state.dataset,
      meta: {
        name: state.meta.name,
        sheetName: state.meta.sheetName,
        headerRow: state.meta.headerRow,
        rowCount: state.meta.rowCount,
        ignoredRows: state.meta.ignoredRows || 0,
        commentCount: state.meta.commentCount || 0,
        parserVersion: state.meta.parserVersion || global.ETL.PARSER_VERSION,
        loadedAt: state.meta.loadedAt.toISOString()
      },
      filters: state.filters,
      search: state.search,
      analistaMode: state.analistaMode,
      uiStyle: state.uiStyle
    };
    // Supabase guarda só o dataset (records + meta). Filtros, busca e seletor
    // USD/QTD ficam só no navegador (IndexedDB), nunca no remoto.
    var remoteSnapshot = {
      version: snapshot.version,
      records: snapshot.records,
      meta: snapshot.meta
    };
    var remoteSave = global.SupabaseStorage && global.SupabaseStorage.saveSnapshot
      ? global.SupabaseStorage.saveSnapshot(remoteSnapshot).catch(function (error) {
        console.error('[BI Hub] Falha ao salvar no Supabase.', error);
        return false;
      })
      : Promise.resolve(false);

    return remoteSave.then(function (savedRemotely) {
      // O IndexedDB permanece apenas como cache offline; o Supabase é a fonte principal.
      return idbSet(SNAPSHOT_KEY, snapshot).then(function () {
        return savedRemotely;
      });
    });
  }

  function persistStateLegacy() {
    if (state.isDemo) return Promise.resolve(false);
    return idbSet(SNAPSHOT_KEY, {
      version: global.DashboardState.SNAPSHOT_VERSION,
      records: state.dataset,
      meta: {
        name: state.meta.name,
        sheetName: state.meta.sheetName,
        headerRow: state.meta.headerRow,
        rowCount: state.meta.rowCount,
        ignoredRows: state.meta.ignoredRows || 0,
        commentCount: state.meta.commentCount || 0,
        parserVersion: state.meta.parserVersion || global.ETL.PARSER_VERSION,
        loadedAt: state.meta.loadedAt.toISOString()
      },
      filters: state.filters,
      search: state.search,
      analistaMode: state.analistaMode,
      uiStyle: state.uiStyle
    });
  }

  function restoreState() {
    var remoteRestore = global.SupabaseStorage && global.SupabaseStorage.getLatestSnapshot
      ? global.SupabaseStorage.getLatestSnapshot().catch(function (error) {
        console.error('[BI Hub] Falha ao restaurar do Supabase.', error);
        return null;
      })
      : Promise.resolve(null);

    return remoteRestore.then(function (remoteSnapshot) {
      if (global.DashboardState.isValidSnapshot(remoteSnapshot)) {
        // O remoto traz só o dataset. Preserva filtros/busca/seletor do cache
        // local para não zerar a UI a cada recarregamento.
        return idbGet(SNAPSHOT_KEY).then(function (cachedSnapshot) {
          var merged = remoteSnapshot;
          if (cachedSnapshot) {
            if (cachedSnapshot.filters) merged.filters = cachedSnapshot.filters;
            if (typeof cachedSnapshot.search === 'string') merged.search = cachedSnapshot.search;
            if (cachedSnapshot.analistaMode != null) merged.analistaMode = cachedSnapshot.analistaMode;
            if (cachedSnapshot.uiStyle != null) merged.uiStyle = cachedSnapshot.uiStyle;
          }
          // Atualiza o cache local apenas depois de aceitar o Supabase como fonte principal.
          idbSet(SNAPSHOT_KEY, merged).catch(function () { /* cache opcional */ });
          return merged;
        }, function () {
          idbSet(SNAPSHOT_KEY, remoteSnapshot).catch(function () { /* cache opcional */ });
          return remoteSnapshot;
        });
      }
      return idbGet(SNAPSHOT_KEY).then(function (cachedSnapshot) {
        return global.DashboardState.isValidSnapshot(cachedSnapshot) ? cachedSnapshot : null;
      });
    }).catch(function () {
      return idbGet(SNAPSHOT_KEY).then(function (cachedSnapshot) {
        return global.DashboardState.isValidSnapshot(cachedSnapshot) ? cachedSnapshot : null;
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
