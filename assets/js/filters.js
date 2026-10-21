// Filtros, busca e ordenação do dashboard. O app injeta estado, elementos e
// helpers para os filtros continuarem no padrão IIFE/global, sem build e sem
// depender da ordem interna do app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var els = deps.els;
    var UI = deps.UI;
    var ETL = deps.ETL;
    var DashboardState = deps.DashboardState;
    var normalizeSearchText = deps.normalizeSearchText;
    var getMonthlyReferenceYear = deps.getMonthlyReferenceYear;
    var getMonthlyReferenceMonth = deps.getMonthlyReferenceMonth;
    var refresh = deps.refresh;
    var schedulePersist = deps.schedulePersist;

    var monthOptionInputs = [];

    // Mapa dos <select> do painel para as chaves de state.filters. O app usa
    // este mapa no bindEvents para não duplicar a lista de filtros.
    var selectFilterKeys = {
      'monthly-year': 'ano',
      'filter-analista': 'analista',
      'filter-situacao': 'situacao',
      'filter-reg-di': 'regDi',
      'filter-mercadoria': 'mercadoria',
      'filter-modal': 'modal',
      'filter-incoterm': 'incoterm',
      'filter-despachante': 'despachante'
    };

    function fillSelect(select, values, allLabel, labelFn) {
      if (!select) return;
      var current = select.value;
      var unique = Array.from(new Set(values.filter(function (value) {
        return value != null && String(value).trim() !== '';
      }))).sort(function (a, b) {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b), 'pt-BR');
      });
      var html = '<option value="ALL">' + UI.escapeHtml(allLabel) + '</option>';
      unique.forEach(function (value) {
        html += '<option value="' + UI.escapeHtml(value) + '">' +
          UI.escapeHtml(labelFn ? labelFn(value) : value) + '</option>';
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
      return selected.map(function (month) { return ETL.monthName(Number(month)); }).join(', ');
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
        text.textContent = ETL.monthName(month);
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
      state.filters = DashboardState.normalizeFilters(state.filters, availableValues);
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
      state.filters = DashboardState.defaultFilters();
      state.search = '';
      state.page = 1;
      applyFilterStateToInputs();
      if (settings.skipRefresh !== true) refresh();
      schedulePersist();
      if (settings.silent !== true) UI.toast('Filtros limpos.', 'info');
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
        var done = ETL.isConcluida(item);
        var cancelled = typeof ETL.isCancelada === 'function' ? ETL.isCancelada(item) : false;
        if (filters.situacao === 'Concluida' && !done) return false;
        if (filters.situacao === 'Cancelada' && !cancelled) return false;
        if (filters.situacao === 'Andamento' && (done || cancelled)) return false;
      }
      if (filters.regDi !== 'ALL') {
        var registered = ETL.isDiRegistered(item);
        if (filters.regDi === 'REGISTRADA' && !registered) return false;
        if (filters.regDi === 'PENDENTE' && registered) return false;
      }
      if (filters.mercadoria !== 'ALL' && item.mercadoria !== filters.mercadoria) return false;
      if (filters.modal !== 'ALL') {
        var modalCategory = item.modalCategory || ETL.classifyModal(item.modal);
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

    return {
      selectFilterKeys: selectFilterKeys,
      setMonthMenuOpen: setMonthMenuOpen,
      toggleMonth: toggleMonth,
      toggleAllMonths: toggleAllMonths,
      populateFilterOptions: populateFilterOptions,
      normalizeFilterState: normalizeFilterState,
      applyFilterStateToInputs: applyFilterStateToInputs,
      resetFilters: resetFilters,
      getSelectedYear: getSelectedYear,
      getVisibleData: getVisibleData,
      getSortedData: getSortedData
    };
  }

  global.DashboardFilters = { create: create };
})(globalThis);
