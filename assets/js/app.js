(function () {
  'use strict';

  var global = globalThis;

  const DEMO_FILE = 'Nenhum arquivo carregado';
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
    monthlyAverageWindow: null,
    filters: global.DashboardState.defaultFilters(),
    search: '',
    sort: { key: 'month', dir: 1 },
    page: 1,
    pageSize: 50
  };

  const els = {};

  // Normalização de registros e referência mensal vivem em normalize.js.
  var normalize = global.DashboardNormalize.create({
    ETL: global.ETL,
    isEmptyValue: global.DashboardState.isEmptyValue
  });

  // Filtros, busca e ordenação vivem em filters.js. O app injeta o estado, os
  // elementos e os helpers e mantém wrappers curtos para os call sites.
  var filters = global.DashboardFilters.create({
    state: state,
    els: els,
    UI: global.UI,
    ETL: global.ETL,
    DashboardState: global.DashboardState,
    normalizeSearchText: normalize.normalizeSearchText,
    getMonthlyReferenceYear: normalize.getMonthlyReferenceYear,
    getMonthlyReferenceMonth: normalize.getMonthlyReferenceMonth,
    refresh: refresh,
    schedulePersist: schedulePersist
  });

  // Estilo visual, modo analista e abas vivem em view.js.
  var view = global.DashboardView.create({
    state: state,
    els: els,
    Charts: global.Charts,
    refresh: refresh,
    schedulePersist: schedulePersist,
    renderTable: renderTable
  });

  // Restauração de snapshots vive em snapshot.js.
  var snapshotView = global.DashboardSnapshot.create({
    state: state,
    DEMO_FILE: DEMO_FILE,
    normalize: normalize,
    view: view,
    filters: filters,
    DashboardState: global.DashboardState,
    refresh: refresh,
    showStatusBanner: showStatusBanner
  });

  // Tabela e exportação CSV vivem em table.js. O app injeta o estado e os
  // helpers e mantém wrappers curtos para os call sites existentes.
  var table = global.DashboardTable.create({
    state: state,
    els: els,
    UI: global.UI,
    ETL: global.ETL,
    getSortedData: filters.getSortedData,
    getMonthlyReferenceMonth: normalize.getMonthlyReferenceMonth
  });

  // Card de status e KPIs vivem em banner.js. O app injeta o estado e os
  // helpers e mantém wrappers curtos para os call sites existentes.
  var banner = global.DashboardBanner.create({
    state: state,
    els: els,
    UI: global.UI,
    ETL: global.ETL,
    getSelectedYear: filters.getSelectedYear
  });

  // Persistência (Supabase + IndexedDB) vive em persistence.js. O app injeta o
  // estado, os helpers e os callbacks de UI e mantém wrappers curtos para os
  // call sites existentes.
  var persistence = global.DashboardPersistence.create({
    state: state,
    toPersistedRecord: normalize.toPersistedRecord,
    DashboardState: global.DashboardState,
    SupabaseStorage: global.SupabaseStorage,
    ETL: global.ETL,
    UI: global.UI,
    onLoadedAtChanged: function () { updateBanner(); }
  });

  // Importação de planilhas Excel vive em import.js. O app injeta o estado e
  // os helpers e mantém wrappers curtos para os call sites existentes.
  var importer = global.DashboardImport.create({
    state: state,
    prepareRecord: normalize.prepareRecord,
    // A cópia enxuta é usada para medir o payload antes de enviar (F6).
    toPersistedRecord: normalize.toPersistedRecord,
    canonicalizeDataset: normalize.canonicalizeDataset,
    buildSearchIndex: normalize.buildSearchIndex,
    populateFilterOptions: filters.populateFilterOptions,
    resetFilters: filters.resetFilters,
    refresh: refresh,
    showTransientUpdateBanner: showTransientUpdateBanner,
    buildSnapshot: buildSnapshot,
    restoreState: restoreState,
    presentSnapshot: presentSnapshot,
    beginSnapshotValidation: beginSnapshotValidation,
    endSnapshotValidation: endSnapshotValidation,
    persistNow: persistNow
  });

  function renderTable() { table.renderTable(); }
  function exportCsv() { table.exportCsv(); }

  function updateBanner() { banner.updateBanner(); }
  function updateKPIs(data) { banner.updateKPIs(data); }
  function showStatusBanner(transient) { banner.showStatusBanner(transient); }
  function hideStatusBanner() { banner.hideStatusBanner(); }
  function showTransientUpdateBanner() { banner.showTransientUpdateBanner(); }
  function showStatusBannerError(message) { banner.showStatusBannerError(message); }

  function schedulePersist() { persistence.schedulePersist(); }
  function persistNow() { return persistence.persistNow(); }
  function buildSnapshot() { return persistence.buildSnapshot(); }
  function restoreState(options) { return persistence.restoreState(options); }
  function beginSnapshotValidation(context) { persistence.beginSnapshotValidation(context); }
  function endSnapshotValidation(context) { persistence.endSnapshotValidation(context); }

  function handleFileUpload(event) { return importer.handleFileUpload(event); }

  function presentSnapshot(snapshot, options) { return snapshotView.presentSnapshot(snapshot, options); }
  function applyVisualStyle(style, refreshCharts) { view.applyVisualStyle(style, refreshCharts); }
  function applyAnalistaModeUI() { view.applyAnalistaModeUI(); }
  function setAnalistaMode(mode) { view.setAnalistaMode(mode); }
  function applyMonthlyAverageUI() { view.applyMonthlyAverageUI(); }
  function setMonthlyAverageWindow(value) { view.setMonthlyAverageWindow(value); }
  function switchTab(tabName) { view.switchTab(tabName); }

  function setMonthMenuOpen(open) { filters.setMonthMenuOpen(open); }
  function toggleAllMonths() { filters.toggleAllMonths(); }
  function populateFilterOptions() { filters.populateFilterOptions(); }
  function normalizeFilterState() { filters.normalizeFilterState(); }
  function applyFilterStateToInputs() { filters.applyFilterStateToInputs(); }
  function resetFilters(options) { filters.resetFilters(options); }
  function getSelectedYear() { return filters.getSelectedYear(); }
  function getVisibleData() { return filters.getVisibleData(); }
  function getSortedData() { return filters.getSortedData(); }

  function cacheElements() {
    REQUIRED_ELEMENT_IDS.forEach(function (id) {
      els[id] = document.getElementById(id);
    });
    const missing = REQUIRED_ELEMENT_IDS.filter(function (id) { return !els[id]; });
    if (missing.length) throw new Error('Estrutura do dashboard incompleta. Elementos ausentes: ' + missing.join(', '));
  }

  function init() {
    try {
      cacheElements();
      bindEvents();
      applyVisualStyle('classic', false);
      applyAnalistaModeUI();
      applyMonthlyAverageUI();
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
      snapshotView.resetToDemoState();
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

    document.querySelectorAll('[data-monthly-avg]').forEach(function (button) {
      button.addEventListener('click', function () { setMonthlyAverageWindow(button.dataset.monthlyAvg); });
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

    var selectMap = filters.selectFilterKeys;
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

  function refresh() {
    state.filtered = getVisibleData();
    updateBanner();
    updateKPIs(state.filtered);
    if (global.Charts) {
      try { global.Charts.render(state.filtered, { monthlyYear: state.filters.ano, isDemo: state.isDemo, uiStyle: state.uiStyle, analistaMode: state.analistaMode, monthlyAverageWindow: state.monthlyAverageWindow }); }
      catch (error) {
        console.error('Falha ao atualizar os gráficos.', error);
        global.UI.toast('Os dados foram atualizados, mas um gráfico não pôde ser redesenhado.', 'warning', 'Visualização parcial');
      }
    }
    renderTable();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
