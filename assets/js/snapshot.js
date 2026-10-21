// Restauração de snapshots: pinta o dataset restaurado (ou o estado vazio) na
// interface inteira. O app injeta estado, módulos e helpers para o snapshot
// continuar no padrão IIFE/global, sem build e sem depender da ordem interna do
// app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var DEMO_FILE = deps.DEMO_FILE;
    var normalize = deps.normalize;
    var view = deps.view;
    var filters = deps.filters;
    var DashboardState = deps.DashboardState;
    var refresh = deps.refresh;
    var showStatusBanner = deps.showStatusBanner;

    function applySnapshotToState(snapshot) {
      state.dataset = snapshot.records.map(normalize.prepareRecord);
      normalize.canonicalizeDataset(state.dataset);
      // A canonicalização altera os campos indexados: o _search é refeito depois
      // dela para que a busca use sempre os valores finais (B1).
      state.dataset.forEach(normalize.buildSearchIndex);
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
        state.analistaMode = DashboardState.normalizeAnalistaMode(snapshot.analistaMode);
      }
      if (snapshot.uiStyle != null) {
        state.uiStyle = DashboardState.normalizeUiStyle(snapshot.uiStyle);
        view.applyVisualStyle(state.uiStyle, false);
      }
      view.applyAnalistaModeUI();
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
      filters.populateFilterOptions();
      filters.normalizeFilterState();
      filters.applyFilterStateToInputs();
      refresh();
      if (settings.skipBanner !== true) {
        // Com dataset o card mostra o que foi carregado e some sozinho; sem
        // dataset ele fica visível com a orientação de como começar.
        showStatusBanner(!!snapshot);
      }
    }

    return {
      applySnapshotToState: applySnapshotToState,
      resetToDemoState: resetToDemoState,
      presentSnapshot: presentSnapshot
    };
  }

  global.DashboardSnapshot = { create: create };
})(globalThis);
