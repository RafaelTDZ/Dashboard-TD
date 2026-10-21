(function () {
  'use strict';

  var global = globalThis;

  const DEMO_FILE = 'Nenhum arquivo carregado';
  // Versão da biblioteca SheetJS vendorizada. Entra na URL do <script> para
  // invalidar o cache do navegador quando a lib for trocada: a query string
  // muda, o navegador baixa o arquivo de novo em vez de reaproveitar uma
  // versão antiga (ou truncada) que ficou no cache. Mantida em sincronia com
  // vendor/manifest.json pelo teste tests/vendor.test.mjs.
  const XLSX_LIB_VERSION = '0.20.3';
  const REQUIRED_ELEMENT_IDS = [
    'tab-btn-dashboard', 'tab-btn-data', 'tab-btn-integration',
    'tab-dashboard', 'tab-data', 'tab-integration',
    'style-switcher', 'style-option-modern', 'style-option-classic',
    'banner-text', 'last-update-time', 'last-read-header', 'dataset-summary',
    'kpi-volume', 'kpi-volume-hint', 'kpi-processos', 'kpi-processos-hint', 'kpi-peso', 'kpi-ticket', 'kpi-conclusao', 'kpi-sla', 'kpi-sla-hint',
    'filter-operacao', 'filter-mes-toggle', 'filter-mes-label', 'filter-mes-menu', 'filter-mes-all', 'filter-mes-list',
    'filter-analista', 'filter-situacao', 'filter-reg-di',
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
  // Tabela e exportação CSV vivem em table.js. O app injeta o estado e os
  // helpers e mantém wrappers curtos para os call sites existentes.
  var table = global.DashboardTable.create({
    state: state,
    els: els,
    UI: global.UI,
    ETL: global.ETL,
    getSortedData: getSortedData,
    getMonthlyReferenceMonth: getMonthlyReferenceMonth
  });

  function renderTable() { table.renderTable(); }
  function exportCsv() { table.exportCsv(); }

  // Card de status e KPIs vivem em banner.js. O app injeta o estado e os
  // helpers e mantém wrappers curtos para os call sites existentes.
  var banner = global.DashboardBanner.create({
    state: state,
    els: els,
    UI: global.UI,
    ETL: global.ETL,
    getSelectedYear: getSelectedYear
  });

  function updateBanner() { banner.updateBanner(); }
  function updateKPIs(data) { banner.updateKPIs(data); }
  function showStatusBanner(transient) { banner.showStatusBanner(transient); }
  function hideStatusBanner() { banner.hideStatusBanner(); }
  function showTransientUpdateBanner() { banner.showTransientUpdateBanner(); }
  function showStatusBannerError(message) { banner.showStatusBannerError(message); }

  // Persistência (Supabase + IndexedDB) vive em persistence.js. O app injeta o
  // estado, os helpers e os callbacks de UI e mantém wrappers curtos para os
  // call sites existentes.
  var persistence = global.DashboardPersistence.create({
    state: state,
    toPersistedRecord: toPersistedRecord,
    DashboardState: global.DashboardState,
    SupabaseStorage: global.SupabaseStorage,
    ETL: global.ETL,
    UI: global.UI,
    onRejectedSnapshot: function (error) { handleRejectedSnapshot(error, null); },
    onLoadedAtChanged: function () { updateBanner(); }
  });

  function schedulePersist() { persistence.schedulePersist(); }
  function persistNow() { return persistence.persistNow(); }
  function buildSnapshot() { return persistence.buildSnapshot(); }
  function restoreState(options) { return persistence.restoreState(options); }
  function beginSnapshotValidation(context) { persistence.beginSnapshotValidation(context); }
  function endSnapshotValidation(context) { persistence.endSnapshotValidation(context); }

  var monthOptionInputs = [];
  let xlsxLoadPromise = null;

  function cacheElements() {
    REQUIRED_ELEMENT_IDS.forEach(function (id) {
      els[id] = document.getElementById(id);
    });
    const missing = REQUIRED_ELEMENT_IDS.filter(function (id) { return !els[id]; });
    if (missing.length) throw new Error('Estrutura do dashboard incompleta. Elementos ausentes: ' + missing.join(', '));
  }

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
    buildSearchIndex(record);
    return record;
  }

  function canonicalizeDataset(records) {
    if (!Array.isArray(records)) return;
    if (global.ETL && typeof global.ETL.canonicalizeField === 'function') {
      ['agente', 'origem', 'destino', 'mercadoria', 'analista', 'despachante'].forEach(function (field) {
        global.ETL.canonicalizeField(records, field);
      });
    } else if (global.ETL && typeof global.ETL.canonicalizeAgents === 'function') {
      global.ETL.canonicalizeAgents(records);
    }
  }

  function applySnapshotToState(snapshot) {
    state.dataset = snapshot.records.map(prepareRecord);
    canonicalizeDataset(state.dataset);
    // A canonicalização altera os campos indexados: o _search é refeito depois
    // dela para que a busca use sempre os valores finais (B1).
    state.dataset.forEach(buildSearchIndex);
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
    state.page = 1;
    if (snapshot.filters) Object.assign(state.filters, snapshot.filters);
    if (typeof snapshot.search === 'string') state.search = snapshot.search;
    if (snapshot.analistaMode != null) {
      state.analistaMode = global.DashboardState.normalizeAnalistaMode(snapshot.analistaMode);
    }
    if (snapshot.uiStyle != null) {
      state.uiStyle = global.DashboardState.normalizeUiStyle(snapshot.uiStyle);
      applyVisualStyle(state.uiStyle, false);
    }
    applyAnalistaModeUI();
  }

  function resetToDemoState() {
    state.dataset = [];
    state.meta = { name: DEMO_FILE, sheetName: '', headerRow: null, rowCount: 0, loadedAt: new Date() };
    state.isDemo = true;
    state.page = 1;
  }

  // Pinta um snapshot (ou o estado vazio) na interface inteira. É o único
  // caminho de render da restauração: o cache local e o resultado final usam o
  // mesmo bloco, sem duplicar populate/normalize/apply/refresh em cada ramo.
  // `skipBanner` existe para o fluxo de importação, que já controla o card.
  function presentSnapshot(snapshot, options) {
    var settings = options || {};
    if (snapshot) applySnapshotToState(snapshot);
    else resetToDemoState();
    populateFilterOptions();
    normalizeFilterState();
    applyFilterStateToInputs();
    refresh();
    if (settings.skipBanner !== true) {
      // Com dataset o card mostra o que foi carregado e some sozinho; sem
      // dataset ele fica visível com a orientação de como começar.
      showStatusBanner(!!snapshot);
    }
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
    // Guarda o snapshot já pintado pelo cache local. Se o remoto devolver o
    // mesmo objeto, o segundo render é desnecessário (só restam os toasts).
    var presentedSnapshot = null;
    restoreState({
      // Local-first: o cache vai para a tela assim que o IndexedDB responde,
      // sem esperar o Supabase. O remoto reconcilia depois, se for mais novo.
      onLocal: function (cachedSnapshot) {
        presentedSnapshot = cachedSnapshot;
        presentSnapshot(cachedSnapshot);
      }
    }).then(function (snapshot) {
      if (snapshot) {
        if (snapshot !== presentedSnapshot) presentSnapshot(snapshot);
        global.UI.toast('Último arquivo carregado restaurado: ' + snapshot.meta.name, 'info', 'Sessão restaurada');
        if (state.meta.parserVersion !== global.ETL.PARSER_VERSION) {
          global.UI.toast('Os dados salvos foram mantidos. Reimporte o Excel para aplicar as correções do importador.', 'warning', 'Reimportação recomendada');
        }
      } else if (!presentedSnapshot) {
        // Sem snapshot e sem cache válido: estado vazio persistente.
        presentSnapshot(null);
      }
    }).catch(function (error) {
      console.error('Falha ao inicializar o dataset.', error);
      resetToDemoState();
      populateFilterOptions();
      normalizeFilterState();
      applyFilterStateToInputs();
      refresh();
      showStatusBanner(false);
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
      // Guarda: sem nenhum aba selecionado não há posição atual para mover.
      var selected = document.querySelector('.tablist [aria-selected="true"]');
      if (!selected || !selected.dataset) return;
      var active = tabs.indexOf(selected.dataset.tab);
      if (active === -1) return;
      var next = event.key === 'Home' ? 0 : (event.key === 'End' ? tabs.length - 1 : (event.key === 'ArrowRight' ? (active + 1) % tabs.length : (active + tabs.length - 1) % tabs.length));
      switchTab(tabs[next]);
      document.getElementById('tab-btn-' + tabs[next]).focus();
    });

    var selectMap = {
      'monthly-year': 'ano',
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

    els['filter-mes-toggle'].addEventListener('click', function (event) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      setMonthMenuOpen(els['filter-mes-menu'].hidden);
    });
    els['filter-mes-menu'].addEventListener('click', function (event) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    });
    els['filter-mes-all'].addEventListener('change', function () { toggleAllMonths(); });
    document.addEventListener('click', function () { setMonthMenuOpen(false); });

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
      if (event.key === 'Escape') {
        setMonthMenuOpen(false);
        global.UI.closeModal();
      }
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

  function getAvailableMonths() {
    return Array.from(new Set(state.dataset.map(getMonthlyReferenceMonth).filter(function (month) {
      return month != null;
    }))).sort(function (a, b) { return a - b; });
  }

  // Modo do filtro de mês: 'all' = sem filtro; 'none' = nenhum mês marcado
  // (o dashboard fica vazio); 'some' = subconjunto de meses marcado.
  function getMonthFilterMode() {
    if (state.filters.mes === 'NONE') return 'none';
    return getSelectedMonths().length ? 'some' : 'all';
  }

  function getSelectedMonths() {
    var selected = state.filters.mes;
    if (Array.isArray(selected)) {
      return selected.map(String).filter(function (month) {
        return /^(1[0-2]|[1-9])$/.test(month);
      });
    }
    // Formatos antigos de snapshot: 'ALL' = todos; '7' = um único mês; 'NONE' = nenhum.
    return typeof selected === 'string' && selected !== 'ALL' && selected !== 'NONE' ? [selected] : [];
  }

  function monthSummary(mode, selected) {
    if (mode === 'none') return 'Selecionar meses';
    if (mode === 'all') return 'Todos os Meses';
    if (selected.length > 3) return selected.length + ' meses selecionados';
    return selected.map(function (month) { return global.ETL.monthName(Number(month)); }).join(', ');
  }

  function updateMonthFilterUi() {
    var mode = getMonthFilterMode();
    var selected = getSelectedMonths();
    els['filter-mes-all'].checked = mode === 'all';
    els['filter-mes-all'].indeterminate = mode === 'some';
    els['filter-mes-toggle'].setAttribute('aria-expanded', els['filter-mes-menu'].hidden ? 'false' : 'true');
    monthOptionInputs.forEach(function (entry) {
      entry.input.checked = mode === 'all' || (mode === 'some' && selected.indexOf(entry.value) > -1);
    });
    els['filter-mes-label'].textContent = monthSummary(mode, selected);
  }

  function populateMonthOptions() {
    var list = els['filter-mes-list'];
    list.textContent = '';
    monthOptionInputs = getAvailableMonths().map(function (value) {
      var month = Number(value);
      var option = document.createElement('label');
      option.className = 'ui-month-option';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(month);
      input.className = 'ui-month-check';
      input.addEventListener('change', function () { toggleMonth(String(month), input.checked); });
      var text = document.createElement('span');
      text.textContent = global.ETL.monthName(month);
      option.appendChild(input);
      option.appendChild(text);
      list.appendChild(option);
      return { value: String(month), input: input };
    });
    updateMonthFilterUi();
  }

  function setMonthMenuOpen(open) {
    var menu = els['filter-mes-menu'];
    var toggle = els['filter-mes-toggle'];
    menu.hidden = !open;
    if (open && typeof toggle.getBoundingClientRect === 'function' && menu.classList) {
      // Sem espaço abaixo do botão, o menu abre para cima (cabe inteiro na tela).
      menu.classList.remove('ui-month-menu-up');
      var toggleRect = toggle.getBoundingClientRect();
      var spaceBelow = global.innerHeight - toggleRect.bottom;
      if (menu.offsetHeight + 16 > spaceBelow && toggleRect.top > spaceBelow) {
        menu.classList.add('ui-month-menu-up');
      }
    }
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleMonth(monthValue, checked) {
    var available = getAvailableMonths().map(String);
    var mode = getMonthFilterMode();
    // Partimos do conjunto efetivo: em "todos" a lista inteira está marcada;
    // em "nenhum" ela começa vazia.
    var effective = mode === 'all' ? available.slice() : getSelectedMonths().slice();
    var index = effective.indexOf(String(monthValue));
    if (checked && index === -1) effective.push(String(monthValue));
    if (!checked && index > -1) effective.splice(index, 1);
    effective.sort(function (a, b) { return Number(a) - Number(b); });
    // Marcar todos = sem filtro (lista vazia); desmarcar todos = 'NONE' (vazio).
    state.filters.mes = effective.length === 0 ? 'NONE' : (effective.length === available.length ? [] : effective);
    state.page = 1;
    updateMonthFilterUi();
    refresh();
    schedulePersist();
  }

  // Interruptor geral do menu: acende todas as caixinhas e, de novo, apaga todas.
  function toggleAllMonths() {
    state.filters.mes = getMonthFilterMode() === 'all' ? 'NONE' : [];
    state.page = 1;
    updateMonthFilterUi();
    refresh();
    schedulePersist();
  }

  function populateFilterOptions() {
    populateMonthOptions();
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
    var current = state.filters.ano || 'ALL';
    var html = '<option value="ALL">Todos os anos</option>';
    years.forEach(function (year) {
      html += '<option value="' + year + '">' + year + '</option>';
    });
    els['monthly-year'].innerHTML = html;
    var values = ['ALL'].concat(years.map(String));
    state.filters.ano = values.indexOf(String(current)) > -1 ? String(current) : 'ALL';
    els['monthly-year'].value = state.filters.ano;
  }

  function normalizeFilterState() {
    var availableValues = {
      mes: getAvailableMonths().map(String),
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
  }

  function applyFilterStateToInputs() {
    normalizeFilterState();
    els['filter-operacao'].value = state.filters.operacao;
    els['monthly-year'].value = state.filters.ano;
    updateMonthFilterUi();
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
    var selected = String(state.filters.ano || 'ALL');
    if (selected === 'ALL') return null;
    var year = Number(selected);
    return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
  }

  function matchesFilters(item, selectedYear, operacaoFilter, searchQuery) {
    var filters = state.filters;
    // Os filtros de operação e de busca comparam a forma normalizada
    // (sem acentos): digitar "acido" encontra "Ácido" (A3).
    var normalizedOperacao = operacaoFilter != null ? operacaoFilter : normalizeSearchText(filters.operacao);
    var normalizedSearch = searchQuery != null ? searchQuery : normalizeSearchText(state.search);
    if (filters.ano !== 'ALL' && selectedYear != null && getMonthlyReferenceYear(item) !== selectedYear) return false;
    if (normalizedOperacao && normalizeSearchText(item.operacao).indexOf(normalizedOperacao) === -1) return false;
    if (getMonthFilterMode() === 'none') return false;
    var selectedMonths = getSelectedMonths();
    if (selectedMonths.length && selectedMonths.indexOf(String(getMonthlyReferenceMonth(item))) === -1) return false;
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
    if (normalizedSearch && String(item._search || '').indexOf(normalizedSearch) === -1) return false;
    return true;
  }

  function getVisibleData() {
    var selectedYear = getSelectedYear();
    // Normaliza uma única vez: a busca e o filtro são aplicados a cada
    // registro do dataset.
    var operacaoFilter = normalizeSearchText(state.filters.operacao);
    var searchQuery = normalizeSearchText(state.search);
    return state.dataset.filter(function (item) {
      return matchesFilters(item, selectedYear, operacaoFilter, searchQuery);
    });
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

  // Carrega a biblioteca SheetJS sob demanda. A URL leva a versão da lib
  // (?v=) para nunca reaproveitar uma resposta antiga do cache do navegador;
  // no retry usa um carimbo de tempo para escapar de uma resposta truncada
  // que tenha ficado guardada.
  function loadXlsxLibrary(forceReload) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var url = 'vendor/xlsx.full.min.js?v=' + encodeURIComponent(XLSX_LIB_VERSION);
      if (forceReload) url += '&t=' + Date.now();
      script.src = url;
      script.onload = function () {
        if (typeof global.XLSX !== 'undefined') resolve(global.XLSX);
        else reject(new Error('A biblioteca XLSX foi carregada, mas não ficou disponível.'));
      };
      script.onerror = function () {
        reject(new Error('Não foi possível carregar a biblioteca de importação Excel (vendor/xlsx.full.min.js). ' +
          'Verifique a conexão e recarregue a página com Ctrl+Shift+R antes de tentar de novo.'));
      };
      document.head.appendChild(script);
    });
  }

  function ensureXlsxLoaded() {
    if (typeof global.XLSX !== 'undefined') return Promise.resolve(global.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;
    xlsxLoadPromise = loadXlsxLibrary(false).catch(function (error) {
      // Uma segunda tentativa sem cache: pode ser uma resposta truncada que o
      // navegador guardou enquanto o arquivo era substituído.
      return loadXlsxLibrary(true).catch(function () {
        xlsxLoadPromise = null;
        throw error;
      });
    });
    return xlsxLoadPromise;
  }

  function setUploadLoading(input, loading) {
    var label = input.closest('.upload-label');
    if (label) label.classList.toggle('is-loading', loading);
    input.disabled = loading;
  }

  // Executa a tarefa no próximo momento ocioso do navegador (ou no próximo
  // tick). Serve para o parse na thread principal não começar antes de a
  // interface pintar o aviso de "Processando…" (M5).
  function runWhenIdle(task) {
    if (typeof global.requestIdleCallback === 'function') {
      return global.requestIdleCallback(task, { timeout: 2000 });
    }
    return setTimeout(task, 0);
  }

  function parseBuffer(buffer) {
    return new Promise(function (resolve) {
      var worker = null;
      try {
        worker = new Worker('assets/js/worker.js');
      } catch (error) {
        worker = null;
      }
      var settled = false;
      var finish = function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (error) { /* noop */ }
        resolve(result);
      };
      // Parse na thread principal. Só acontece quando o Worker não existe ou
      // falha. `settled` impede repetir o trabalho depois que a promessa já
      // foi resolvida (por exemplo, quando o timeout de 90 s disparou): sem
      // essa guarda a aba travava processando um arquivo que já deu timeout
      // (M5).
      var parseOnMainThread = function () {
        if (settled) return;
        runWhenIdle(function () {
          if (settled) return;
          try { finish(global.ETL.parseWorkbook(buffer)); }
          catch (error) { finish({ error: error }); }
        });
      };
      var timer = setTimeout(function () {
        finish({ error: new Error('Tempo excedido ao processar o arquivo.') });
      }, 90000);
      if (!worker) {
        // Sem Worker: o parse roda na thread principal. O timeout acima
        // garante que a promessa sempre resolva e impede que o parse comece
        // depois que o prazo estourou.
        parseOnMainThread();
        return;
      }
      worker.onmessage = function (event) {
        if (event.data && event.data.ok) finish(event.data.result);
        else finish({ error: new Error((event.data && event.data.error) || 'Falha ao processar a planilha.') });
      };
      worker.onerror = function (event) {
        console.error('Falha no Worker de importação; usando o processamento principal.', event);
        // Se o timeout já disparou, `settled` é true e o parse não é refeito.
        parseOnMainThread();
      };
      try {
        worker.postMessage({ buffer: buffer });
      } catch (error) {
        parseOnMainThread();
      }
    });
  }

  function fetchComparisonSnapshot() {
    if (!global.SupabaseStorage || typeof global.SupabaseStorage.getLatestSnapshot !== 'function') {
      return Promise.resolve({ available: false, snapshot: null });
    }
    return global.SupabaseStorage.getLatestSnapshot().then(function (snapshot) {
      return { available: true, snapshot: snapshot || null };
    }).catch(function (error) {
      console.warn('[BI Hub] Não foi possível comparar com o banco antes da importação; o trigger do Supabase fará a validação.', error);
      return { available: false, snapshot: null };
    });
  }

  function comparisonList(keys) {
    var visible = (keys || []).slice(0, 20).map(function (key) {
      return '<li class="py-1 font-mono text-xs text-amber-300">' + global.UI.escapeHtml(key) + '</li>';
    }).join('');
    var remaining = keys && keys.length > 20
      ? '<p class="mt-2 text-xs text-slate-500">... e mais ' + global.UI.formatNumber(keys.length - 20) + ' processo(s).</p>'
      : '';
    return '<ul class="max-h-48 overflow-y-auto custom-scrollbar">' + visible + '</ul>' + remaining;
  }

  function showBlockedImport(file, comparison) {
    var missing = comparison.removed || [];
    var html = '<p class="mb-3 text-slate-300">O arquivo <strong class="text-slate-200">' + global.UI.escapeHtml(file.name) +
      '</strong> não contém <strong class="text-amber-300">' + global.UI.formatNumber(missing.length) +
      ' processo(s)</strong> que já estão no banco:</p>' +
      comparisonList(missing) +
      '<p class="mt-4 text-sm text-slate-400">Nada foi alterado. O snapshot anterior foi mantido. ' +
      'Reimporte uma planilha que contenha todos esses processos.</p>';
    global.UI.openModal({ title: 'Importação bloqueada', html: html });
    global.UI.toast('"' + file.name + '" não foi importado: o arquivo não contém todos os processos do banco.', 'error', 'Arquivo incompleto');
  }

  function showInvalidImport(file, comparison) {
    var reason = comparison.nextReason === 'duplicate'
      ? 'A Operação <strong class="font-mono text-amber-300">' + global.UI.escapeHtml(comparison.nextInvalidKey) + '</strong> aparece mais de uma vez.'
      : (comparison.nextReason === 'empty'
        ? 'A linha <strong class="text-slate-200">' + global.UI.formatNumber(comparison.nextInvalidIndex) + '</strong> está sem Operação.'
        : 'Não foi possível identificar a Operação dos registros.');
    var html = '<p class="mb-3 text-slate-300">O arquivo <strong class="text-slate-200">' + global.UI.escapeHtml(file.name) +
      '</strong> não pode ser comparado com o banco.</p><p class="mb-3 text-slate-400">' + reason +
      ' A importação foi bloqueada para não comprometer a comparação dos processos.</p>';
    global.UI.openModal({ title: 'Importação bloqueada', html: html });
    global.UI.toast('"' + file.name + '" não foi importado: Operação ausente ou duplicada.', 'error', 'Arquivo inválido');
  }

  function formatComparisonSummary(comparison, remoteCompared) {
    if (!remoteCompared || !comparison || !comparison.comparable) return '';
    if (!comparison.previousCount) {
      return ' Primeiro snapshot do banco (' + global.UI.formatNumber(comparison.nextCount) + ' processos).';
    }
    var parts = [];
    if (comparison.addedCount) parts.push(global.UI.formatNumber(comparison.addedCount) + ' novo(s)');
    if (comparison.updatedCount) parts.push(global.UI.formatNumber(comparison.updatedCount) + ' atualizado(s)');
    if (comparison.removedCount) parts.push(global.UI.formatNumber(comparison.removedCount) + ' removido(s)');
    return parts.length
      ? ' Comparação com o banco: ' + parts.join(', ') + '.'
      : ' Sem alterações em relação ao banco.';
  }

  function applyImportedDataset(result, records) {
    state.dataset = records;
    state.meta = {
      name: result.fileName,
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
    refresh();
    showTransientUpdateBanner();
  }

  function showImportSuccess(file, result, comparison, remoteCompared, persistence) {
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
    var comparisonMessage = formatComparisonSummary(comparison, remoteCompared);
    // Se o POST estourou o timeout de 15 s, o arquivo não chegou ao banco, mas
    // o cache local foi atualizado em persistState(). A mensagem diz isso de
    // forma explícita em vez do genérico "salvo apenas neste navegador".
    var persistenceMessage = persistence && persistence.saved
      ? ''
      : (persistence && persistence.error && persistence.error.timeout
        ? ' O banco não respondeu em 15s; o arquivo ficou salvo apenas neste navegador.'
        : ' O arquivo ficou salvo apenas neste navegador.');
    global.UI.toast('"' + file.name + '" importado: ' + global.UI.formatNumber(result.totalRows) +
      ' processo(s) na guia "' + result.sheetName + '".' + ignoredMessage + commentMessage + foreignCurrencyMessage +
      comparisonMessage + persistenceMessage,
      persistence && persistence.saved ? 'success' : 'warning', 'Excel carregado');
  }

  function restorePreviousSnapshot(snapshot) {
    // Prefere o snapshot mais recente da nuvem/cache (outra aba pode ter
    // importado enquanto este arquivo era enviado); o snapshot capturado antes
    // do upload é apenas a reserva quando a restauração não encontra nada.
    return restoreState().then(function (chosen) {
      // O fluxo de importação já controla o card de status: não o reexibe aqui.
      presentSnapshot(chosen || snapshot, { skipBanner: true });
    });
  }

  function handleRejectedSnapshot(error, previousSnapshot) {
    var message = String(error && error.message || '');
    var missingMatch = message.match(/SNAPSHOT_MISSING_RECORDS:\s*([0-9.,]+)/);
    var missingCount = missingMatch ? missingMatch[1] : '';
    var details = typeof error.details === 'string' ? error.details.trim() : '';
    var detailHtml = details
      ? '<ul class="max-h-40 overflow-y-auto custom-scrollbar">' + details.split(',').slice(0, 20).map(function (key) {
        return '<li class="py-1 font-mono text-xs text-amber-300">' + global.UI.escapeHtml(key.trim()) + '</li>';
      }).join('') + '</ul>'
      : '';
    var html = (missingCount
      ? '<p class="mb-3 text-slate-300">O banco recusou o arquivo porque ele não contém <strong class="text-amber-300">' +
        global.UI.escapeHtml(missingCount) + ' processo(s)</strong> que já estavam salvos.</p>'
      : '<p class="mb-3 text-slate-300">O banco recusou o arquivo. Nenhum dado foi substituído.</p>') +
      detailHtml +
      '<p class="mt-4 text-sm text-slate-400">O snapshot anterior foi restaurado neste navegador.</p>';
    global.UI.openModal({ title: 'Importação recusada pelo banco', html: html });
    global.UI.toast('O arquivo não foi salvo no banco. O snapshot anterior foi mantido.', 'error', 'Importação recusada');
    return restorePreviousSnapshot(previousSnapshot);
  }

  function handleFileUpload(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    var previousSnapshot = buildSnapshot();
    var validationContext = { validationOpen: false };
    setUploadLoading(input, true);
    global.UI.toast('Processando "' + file.name + '"...', 'info');
    ensureXlsxLoaded().then(function () {
      return file.arrayBuffer();
    }).then(function (buffer) {
      return parseBuffer(buffer);
    }).then(function (result) {
      if (result.error) throw result.error;
      var nextRecords = result.records.map(prepareRecord);
      canonicalizeDataset(nextRecords);
      // Reindexa depois da canonicalização (B1): o _search precisa refletir os
      // valores finais dos campos.
      nextRecords.forEach(buildSearchIndex);
      result.fileName = file.name;
      return fetchComparisonSnapshot().then(function (comparisonSource) {
        var remoteCompared = comparisonSource.available;
        var previousRecords = remoteCompared
          ? (comparisonSource.snapshot && Array.isArray(comparisonSource.snapshot.records) ? comparisonSource.snapshot.records : [])
          : (!state.isDemo && Array.isArray(state.dataset) ? state.dataset : []);
        var comparison = global.DashboardState.compareRecords(previousRecords, nextRecords);

        if (!comparison.nextValid) {
          showInvalidImport(file, comparison);
          return null;
        }
        if (remoteCompared && comparison.comparable && comparison.removedCount > 0) {
          showBlockedImport(file, comparison);
          return null;
        }

        beginSnapshotValidation(validationContext);
        applyImportedDataset(result, nextRecords);
        return persistNow().then(function (persistence) {
          if (persistence && persistence.validationError) {
            return handleRejectedSnapshot(persistence.validationError, previousSnapshot).then(function () {
              endSnapshotValidation(validationContext);
              return null;
            });
          }
          endSnapshotValidation(validationContext);
          showImportSuccess(file, result, comparison, remoteCompared, persistence);
          if (result.mapping.unmapped.length || result.commentCount) {
            showMappingReport(result, comparison, remoteCompared);
          }
          return result;
        }).catch(function (error) {
          endSnapshotValidation(validationContext);
          throw error;
        });
      });
    }).catch(function (error) {
      endSnapshotValidation(validationContext);
      console.error('[BI Hub] Falha na importação.', error && error.message ? error.message : error);
      global.UI.toast(error && error.message ? error.message : 'Falha ao processar o arquivo Excel.', 'error', 'Erro na importação');
    }).then(function () {
      input.value = '';
      setUploadLoading(input, false);
    });
  }

  function showMappingReport(result, comparison, remoteCompared) {
    var mapped = result.mapping.mapped.map(function (entry) {
      return '<li class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800">' +
        '<span class="text-slate-400">' + global.UI.escapeHtml(entry.label) + '</span>' +
        '<span class="font-mono text-emerald-400">' + global.UI.escapeHtml(entry.header) + '</span></li>';
    }).join('');
    var unmapped = result.mapping.unmapped.map(function (header) {
      return '<li class="py-1 font-mono text-slate-300">' + global.UI.escapeHtml(header) + '</li>';
    }).join('');
    var comparisonHtml = '';
    if (remoteCompared && comparison && comparison.comparable) {
      comparisonHtml = comparison.previousCount
        ? '<p class="mb-3 text-slate-400">Comparação com o banco: <strong class="text-emerald-400">' +
          global.UI.formatNumber(comparison.addedCount) + '</strong> novo(s), <strong class="text-amber-300">' +
          global.UI.formatNumber(comparison.updatedCount) + '</strong> atualizado(s), <strong class="text-slate-200">' +
          global.UI.formatNumber(comparison.unchangedCount) + '</strong> sem alteração.</p>'
        : '<p class="mb-3 text-slate-400">Primeiro snapshot do banco: <strong class="text-emerald-400">' +
          global.UI.formatNumber(comparison.nextCount) + '</strong> processo(s).</p>';
    }
    var html = '<p class="mb-3 text-slate-400">Guia <strong class="text-slate-200">' + global.UI.escapeHtml(result.sheetName) +
      '</strong>, cabeçalho na linha <strong class="text-slate-200">' + result.headerRowNumber + '</strong>, ' +
      global.UI.formatNumber(result.totalRows) + ' registros lidos.' +
      (result.ignoredRows ? ' ' + global.UI.formatNumber(result.ignoredRows) + ' linha(s) sem campos operacionais foram ignoradas.' : '') +
      (result.commentCount ? ' A aba <strong class="text-slate-200">Comments</strong> trouxe ' + global.UI.formatNumber(result.commentCount) + ' observação(ões), associada(s) pela linha do Excel e exportada(s) no CSV.' : '') + '</p>' +
      comparisonHtml +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<div><h4 class="font-bold text-emerald-400 mb-2 text-[11px] uppercase tracking-wide">Colunas reconhecidas</h4>' +
      '<ul>' + (mapped || '<li class="text-slate-500">Nenhuma</li>') + '</ul></div>' +
      '<div><h4 class="font-bold text-amber-400 mb-2 text-[11px] uppercase tracking-wide">Colunas ignoradas</h4>' +
      '<ul class="max-h-56 overflow-y-auto custom-scrollbar">' + (unmapped || '<li class="text-slate-500">Nenhuma</li>') + '</ul></div>' +
      '</div>';
    global.UI.openModal({ title: 'Relatório de importação', html: html });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
