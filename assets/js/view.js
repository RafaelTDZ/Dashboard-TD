// Estilo visual (clássico/novo), modo analista (USD/QTD) e troca de abas. O
// app injeta estado, elementos e helpers para a camada de apresentação
// continuar no padrão IIFE/global, sem build e sem depender da ordem interna do
// app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var els = deps.els;
    var Charts = deps.Charts;
    var refresh = deps.refresh;
    var schedulePersist = deps.schedulePersist;
    var renderTable = deps.renderTable;

    function applyVisualStyle(style, refreshCharts) {
      var nextStyle = style === 'modern' ? 'modern' : 'classic';
      state.uiStyle = nextStyle;
      document.body.dataset.uiStyle = nextStyle;
      ['modern', 'classic'].forEach(function (option) {
        var button = els['style-option-' + option];
        if (!button) return;
        button.setAttribute('aria-pressed', option === nextStyle ? 'true' : 'false');
      });
      if (refreshCharts !== false && Charts && typeof Charts.setStyle === 'function') {
        Charts.setStyle(nextStyle);
        Charts.render(state.filtered, {
          monthlyYear: state.filters.ano,
          isDemo: state.isDemo,
          uiStyle: nextStyle,
          analistaMode: state.analistaMode,
          monthlyAverageWindow: state.monthlyAverageWindow
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

    function applyMonthlyAverageUI() {
      ['3', '6', '12'].forEach(function (scale) {
        var button = document.getElementById('monthly-avg-' + scale);
        if (!button) return;
        var active = state.monthlyAverageWindow === Number(scale);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('bg-brand-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('shadow', active);
        button.classList.toggle('text-slate-400', !active);
        button.classList.toggle('hover:text-white', !active);
      });
    }

    function setMonthlyAverageWindow(value) {
      var requested = Number(value);
      requested = (requested === 3 || requested === 6 || requested === 12) ? requested : null;
      // No máximo uma média ativa: escolher outra janela troca direto;
      // repetir a janela ativa desliga (fica sem média no gráfico).
      var next = (requested !== null && requested === state.monthlyAverageWindow) ? null : requested;
      if (state.monthlyAverageWindow === next) return;
      state.monthlyAverageWindow = next;
      applyMonthlyAverageUI();
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

    return {
      applyVisualStyle: applyVisualStyle,
      applyAnalistaModeUI: applyAnalistaModeUI,
      setAnalistaMode: setAnalistaMode,
      applyMonthlyAverageUI: applyMonthlyAverageUI,
      setMonthlyAverageWindow: setMonthlyAverageWindow,
      switchTab: switchTab
    };
  }

  global.DashboardView = { create: create };
})(globalThis);
