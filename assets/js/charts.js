(function (global) {
  'use strict';

  const COLOR_PALETTES = {
    classic: {
      brand: '#3b82f6',
      brandSoft: 'rgba(59,130,246,0.15)',
      emerald: '#10b981',
      emeraldSoft: 'rgba(16,185,129,0.12)',
      teal: '#0d9488',
      amber: '#f59e0b',
      purple: '#8b5cf6',
      slate: '#64748b',
      text: '#94a3b8',
      grid: 'rgba(51,65,85,0.55)',
      tooltip: 'rgba(15,23,42,0.96)',
      tooltipBorder: 'rgba(52,211,153,0.35)',
      tooltipTitle: '#d1fae5',
      tooltipBody: '#e2e8f0'
    },
    modern: {
      brand: '#2563eb',
      brandSoft: 'rgba(37,99,235,0.10)',
      emerald: '#059669',
      emeraldSoft: 'rgba(5,150,105,0.10)',
      teal: '#0d9488',
      amber: '#d97706',
      purple: '#7c3aed',
      slate: '#71717a',
      text: '#71717a',
      grid: 'rgba(113,113,122,0.15)',
      tooltip: 'rgba(24,24,27,0.96)',
      tooltipBorder: 'rgba(255,255,255,0.10)',
      tooltipTitle: '#fafafa',
      tooltipBody: '#d4d4d8'
    }
  };

  let currentStyle = 'classic';
  let COLORS = Object.assign({}, COLOR_PALETTES.classic);
  const charts = {};

  const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const CANVAS_IDS = ['chart-analistas', 'chart-mensal', 'chart-origem', 'chart-destino', 'chart-incoterm', 'chart-agentes', 'chart-operacao-siglas'];
  const SUMMARY_IDS = CANVAS_IDS.map(function (id) { return id + '-summary'; });

  function axisTick(value) {
    return global.UI.formatCompactUSD(value);
  }

  function baseOptions(extra) {
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: true, mode: 'index' },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.55)' }, ticks: { color: '#94a3b8', font: { size: 10 } } }
      }
    }, extra || {});
  }

  function createMonthlyFill(canvas) {
    const context = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!context) return COLORS.emeraldSoft;
    const gradient = context.createLinearGradient(0, 0, 0, 260);
    if (currentStyle === 'modern') {
      gradient.addColorStop(0, 'rgba(5,150,105,0.22)');
      gradient.addColorStop(1, 'rgba(5,150,105,0.03)');
    } else {
      gradient.addColorStop(0, 'rgba(16,185,129,0.28)');
      gradient.addColorStop(1, 'rgba(16,185,129,0.02)');
    }
    return gradient;
  }

  function chartAxisText(key, axisKey) {
    if (currentStyle === 'modern') return COLORS.text;
    if ((key === 'agentes' || key === 'operacaoSiglas') && axisKey === 'y') return '#cbd5e1';
    return '#94a3b8';
  }

  function chartLegendText(key) {
    if (currentStyle === 'modern') return COLORS.text;
    return key === 'incoterm' ? '#cbd5e1' : '#94a3b8';
  }

  function updateChartTheme() {
    if (typeof Chart !== 'undefined') {
      Chart.defaults.color = COLORS.text;
      Chart.defaults.borderColor = COLORS.grid;
    }
    if (!charts.mensal) return;

    const monthlyCanvas = document.getElementById('chart-mensal');
    if (charts.analistas) charts.analistas.data.datasets[0].backgroundColor = COLORS.brand;
    if (charts.origem) charts.origem.data.datasets[0].backgroundColor = COLORS.teal;
    if (charts.destino) charts.destino.data.datasets[0].backgroundColor = COLORS.amber;
    if (charts.agentes) charts.agentes.data.datasets[0].backgroundColor = COLORS.purple;
    if (charts.operacaoSiglas) charts.operacaoSiglas.data.datasets[0].backgroundColor = COLORS.brand;
    if (charts.incoterm) {
      charts.incoterm.data.datasets[0].backgroundColor = [COLORS.brand, COLORS.emerald, COLORS.amber, COLORS.purple, COLORS.slate];
    }
    if (charts.mensal) {
      const processDataset = charts.mensal.data.datasets[0];
      const averageDataset = charts.mensal.data.datasets[1];
      processDataset.borderColor = COLORS.emerald;
      processDataset.backgroundColor = createMonthlyFill(monthlyCanvas);
      processDataset.pointBackgroundColor = processDataset.pointBackgroundColor.map(function (color, index) {
        return processDataset.data[index] > 0 && processDataset.data[index] === Math.max.apply(null, processDataset.data) ? COLORS.amber : COLORS.emerald;
      });
      if (averageDataset) averageDataset.borderColor = currentStyle === 'modern' ? COLORS.text : 'rgba(148,163,184,0.85)';
    }

    Object.keys(charts).forEach(function (key) {
      const chart = charts[key];
      if (!chart || !chart.options) return;
      const scales = chart.options.scales || {};
      Object.keys(scales).forEach(function (axisKey) {
        const scale = scales[axisKey];
        if (!scale) return;
        if (scale.ticks) scale.ticks.color = chartAxisText(key, axisKey);
        if (scale.grid) scale.grid.color = COLORS.grid;
        if (scale.border) scale.border.color = COLORS.grid;
      });
      const plugins = chart.options.plugins || {};
      if (plugins.legend && plugins.legend.labels) plugins.legend.labels.color = chartLegendText(key);
      if (plugins.tooltip) {
        plugins.tooltip.backgroundColor = COLORS.tooltip;
        plugins.tooltip.borderColor = COLORS.tooltipBorder;
        if (COLORS.tooltipTitle) plugins.tooltip.titleColor = COLORS.tooltipTitle;
        if (COLORS.tooltipBody) plugins.tooltip.bodyColor = COLORS.tooltipBody;
      }
      if (typeof chart.update === 'function') chart.update('none');
    });
  }

  function setStyle(style) {
    const nextStyle = style === 'modern' ? 'modern' : 'classic';
    if (nextStyle === currentStyle && Object.keys(charts).length) return;
    currentStyle = nextStyle;
    COLORS = Object.assign({}, COLOR_PALETTES[currentStyle]);
    updateChartTheme();
  }

  function destroyAll() {
    Object.keys(charts).forEach(function (key) {
      if (charts[key] && typeof charts[key].destroy === 'function') charts[key].destroy();
      delete charts[key];
    });
  }

  function init() {
    if (typeof Chart === 'undefined') return false;
    if (CANVAS_IDS.some(function (id) { return !document.getElementById(id); })) return false;
    try {
      return createCharts();
    } catch (error) {
      console.error('Falha ao inicializar os gráficos.', error);
      destroyAll();
      return false;
    }
  }

  function createCharts() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(51,65,85,0.55)';
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.font.size = 11;

    charts.analistas = new Chart(document.getElementById('chart-analistas'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Volume USD', data: [], backgroundColor: COLORS.brand, borderRadius: 8, maxBarThickness: 46 }] },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ' ' + global.UI.formatUSDFull(ctx.parsed.y); } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.55)' }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: axisTick } }
        }
      })
    });

    const monthlyCanvas = document.getElementById('chart-mensal');
    const monthlyFill = createMonthlyFill(monthlyCanvas);

    charts.mensal = new Chart(monthlyCanvas, {
      type: 'line',
      data: {
        labels: MONTH_NAMES,
        datasets: [{
          label: 'Processos',
          data: Array(12).fill(0),
          borderColor: COLORS.emerald,
          backgroundColor: monthlyFill,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: Array(12).fill(0),
          pointHoverRadius: Array(12).fill(5),
          pointBackgroundColor: Array(12).fill(COLORS.emerald),
          pointBorderColor: Array(12).fill('#0f172a'),
          pointBorderWidth: 2,
          clip: 8
        }, {
          label: 'Média 12m',
          data: Array(12).fill(0),
          borderColor: 'rgba(148,163,184,0.85)',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          clip: 8
        }]
      },
      options: baseOptions({
        interaction: { intersect: true, mode: 'index' },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12, boxHeight: 2, usePointStyle: true, pointStyle: 'line' }
          },
          tooltip: {
            displayColors: false,
            backgroundColor: 'rgba(15,23,42,0.96)',
            borderColor: 'rgba(52,211,153,0.35)',
            borderWidth: 1,
            padding: 10,
            titleColor: '#d1fae5',
            bodyColor: '#e2e8f0',
            callbacks: {
              title: function (items) { return items.length ? MONTH_NAMES[items[0].dataIndex] : ''; },
              label: function (ctx) {
                if (ctx.dataset.label === 'Média 12m') return ' Média 12m: ' + global.UI.formatNumber(ctx.parsed.y, 1) + '/mês';
                return ' ' + formatCount(ctx.parsed.y, 'processo', 'processos');
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: '#94a3b8',
              font: { size: 9 },
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 12,
              padding: 4,
              callback: function (_, index) { return MONTH_NAMES[index] || ''; }
            }
          },
          y: {
            beginAtZero: true,
            suggestedMax: 1,
            border: { display: false },
            grid: { color: 'rgba(51,65,85,0.55)' },
            ticks: {
              color: '#94a3b8',
              font: { size: 10 },
              precision: 0,
              maxTicksLimit: 6,
              padding: 8,
              callback: function (value) { return global.UI.formatNumber(value); }
            }
          }
        }
      })
    });

    charts.origem = new Chart(document.getElementById('chart-origem'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Processos', data: [], backgroundColor: COLORS.teal, borderRadius: 6, maxBarThickness: 26 }] },
      options: baseOptions({
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ' ' + global.UI.formatNumber(ctx.parsed.x) + ' processo(s)'; } } }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.55)' }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
        }
      })
    });

    charts.destino = new Chart(document.getElementById('chart-destino'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Processos', data: [], backgroundColor: COLORS.amber, borderRadius: 6, maxBarThickness: 46 }] },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ' ' + global.UI.formatNumber(ctx.parsed.y) + ' processo(s)'; } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.55)' }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } }
        }
      })
    });

    charts.incoterm = new Chart(document.getElementById('chart-incoterm'), {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [COLORS.brand, COLORS.emerald, COLORS.amber, COLORS.purple, COLORS.slate],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12, boxHeight: 12 } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const total = ctx.dataset.data.reduce(function (acc, value) { return acc + value; }, 0) || 1;
                const share = (ctx.parsed / total) * 100;
                return ' ' + global.UI.formatNumber(ctx.parsed) + ' processos (' + global.UI.formatPercent(share) + ')';
              }
            }
          }
        }
      }
    });

    charts.agentes = new Chart(document.getElementById('chart-agentes'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Processos', data: [], backgroundColor: COLORS.purple, borderRadius: 6, maxBarThickness: 30 }] },
      options: baseOptions({
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ' ' + global.UI.formatNumber(ctx.parsed.x) + ' processo(s)'; } } }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.55)' }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: '#cbd5e1', font: { size: 10 } } }
        }
      })
    });

    charts.operacaoSiglas = new Chart(document.getElementById('chart-operacao-siglas'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Processos', data: [], backgroundColor: COLORS.brand, borderRadius: 6, maxBarThickness: 30 }] },
      options: baseOptions({
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ' ' + global.UI.formatNumber(ctx.parsed.x) + ' processo(s)'; } } }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.55)' }, ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: '#cbd5e1', font: { size: 10 } } }
        }
      })
    });

    updateChartTheme();
    return true;
  }

  function normalizeKeyChart(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || /^N\/A$/i.test(raw)) return 'n/a';
    return raw.replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  const NORMALIZED_KEYS = { agente: true, origem: true, destino: true, mercadoria: true, analista: true };

  function countBy(data, key) {
    if (!NORMALIZED_KEYS[key]) {
      const map = {};
      data.forEach(function (item) {
        const value = String(item[key] == null || item[key] === '' ? 'N/A' : item[key]).trim() || 'N/A';
        map[value] = (map[value] || 0) + 1;
      });
      return map;
    }
    const groups = {};
    data.forEach(function (item) {
      const base = String(item[key] == null || item[key] === '' ? 'N/A' : item[key]).trim() || 'N/A';
      let raw = base;
      if (key === 'agente' && global.ETL && typeof global.ETL.resolveAgentAlias === 'function') {
        const alias = global.ETL.resolveAgentAlias(base);
        if (alias) raw = alias;
      }
      const norm = normalizeKeyChart(raw);
      if (!groups[norm]) groups[norm] = { displays: {}, total: 0 };
      groups[norm].total += 1;
      groups[norm].displays[raw] = (groups[norm].displays[raw] || 0) + 1;
    });
    const map = {};
    Object.keys(groups).forEach(function (norm) {
      let best = null;
      let bestCount = -1;
      Object.keys(groups[norm].displays).forEach(function (display) {
        const count = groups[norm].displays[display];
        if (count > bestCount) {
          bestCount = count;
          best = display;
        }
      });
      const label = norm === 'n/a' ? 'N/A' : best;
      map[label] = groups[norm].total;
    });
    return map;
  }

  function sumBy(data, key, valueKey) {
    if (!NORMALIZED_KEYS[key]) {
      const map = {};
      data.forEach(function (item) {
        const value = String(item[key] == null || item[key] === '' ? 'N/A' : item[key]).trim() || 'N/A';
        map[value] = (map[value] || 0) + (global.UI.toNumber(item[valueKey]));
      });
      return map;
    }
    const groups = {};
    data.forEach(function (item) {
      const raw = String(item[key] == null || item[key] === '' ? 'N/A' : item[key]).trim() || 'N/A';
      const norm = normalizeKeyChart(raw);
      if (!groups[norm]) groups[norm] = { displays: {}, total: 0 };
      groups[norm].total += global.UI.toNumber(item[valueKey]);
      groups[norm].displays[raw] = (groups[norm].displays[raw] || 0) + 1;
    });
    const map = {};
    Object.keys(groups).forEach(function (norm) {
      let best = null;
      let bestCount = -1;
      Object.keys(groups[norm].displays).forEach(function (display) {
        const count = groups[norm].displays[display];
        if (count > bestCount) {
          bestCount = count;
          best = display;
        }
      });
      const label = norm === 'n/a' ? 'N/A' : best;
      map[label] = groups[norm].total;
    });
    return map;
  }

  function topEntries(map, limit) {
    return Object.entries(map)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, limit || 8);
  }

  function setEmpty(data) {
    const empty = !data || !data.length;
    global.UI.setChartEmpty('chart-analistas', empty);
    global.UI.setChartEmpty('chart-mensal', empty);
    global.UI.setChartEmpty('chart-origem', empty);
    global.UI.setChartEmpty('chart-destino', empty);
    global.UI.setChartEmpty('chart-incoterm', empty);
    global.UI.setChartEmpty('chart-agentes', empty);
    global.UI.setChartEmpty('chart-operacao-siglas', empty);
    SUMMARY_IDS.forEach(function (id) {
      const summary = document.getElementById(id);
      if (summary) summary.textContent = empty ? 'Sem dados para os filtros selecionados.' : '';
    });
  }

  function setSummary(id, text) {
    const summary = document.getElementById(id);
    if (summary) summary.textContent = text;
  }

  function formatCount(value, singular, plural) {
    return global.UI.formatNumber(value) + ' ' + (value === 1 ? singular : plural);
  }

  function updateMonthlyPresentation(byMonth, context) {
    context = context || {};
    const dataset = charts.mensal.data.datasets[0];
    const averageDataset = charts.mensal.data.datasets[1];
    const total = byMonth.reduce(function (sum, value) { return sum + value; }, 0);
    const activeMonths = byMonth.filter(function (value) { return value > 0; }).length;
    const peak = Math.max.apply(null, byMonth);
    const peakIndex = byMonth.indexOf(peak);
    const hasMonths = peak > 0;
    const average = context.trailingAverage != null
      ? context.trailingAverage
      : (hasMonths ? total / 12 : 0);

    dataset.data = byMonth;
    dataset.pointRadius = byMonth.map(function (value) {
      return value > 0 ? (value === peak ? 5 : 3) : 0;
    });
    dataset.pointHoverRadius = byMonth.map(function (value) {
      return value > 0 ? (value === peak ? 7 : 5) : 0;
    });
    dataset.pointBackgroundColor = byMonth.map(function (value) {
      return value > 0 && value === peak ? COLORS.amber : COLORS.emerald;
    });
    if (averageDataset) averageDataset.data = Array(12).fill(hasMonths ? Math.round(average * 10) / 10 : 0);
    charts.mensal.options.scales.y.suggestedMax = hasMonths ? Math.max(peak + 1, Math.ceil(Math.max(peak, average) * 1.15)) : 1;

    const insight = document.getElementById('monthly-insight');
    if (insight) {
      const scope = context.year != null
        ? 'ETA/ETS ' + context.year
        : (context.usesScheduleDate ? 'ETA/ETS — todos os anos' : 'mês importado');
      const missingText = context.missingCount
        ? ' · ' + global.UI.formatNumber(context.missingCount) + ' sem ETA/ETS'
        : '';
      const averageText = hasMonths ? ' · média 12m: ' + global.UI.formatNumber(average, 1) + '/mês' : '';
      insight.textContent = hasMonths
        ? scope + ' · ' + formatCount(total, 'processo', 'processos') + ' · pico: ' + MONTH_NAMES[peakIndex] + ' (' + global.UI.formatNumber(peak) + ')' + averageText + missingText
        : scope + ' · sem meses identificados' + missingText;
      insight.className = hasMonths
        ? 'block text-[11px] font-semibold text-emerald-300'
        : 'block text-[11px] font-semibold text-slate-400';
    }

    return { total: total, activeMonths: activeMonths, peak: peak, peakIndex: peakIndex, hasMonths: hasMonths, average: average, missingCount: context.missingCount || 0 };
  }

  function summarizeEntries(prefix, entries, formatter) {
    if (!entries.length) return prefix + ': sem dados.';
    return prefix + ': ' + entries.map(function (entry) {
      return entry[0] + ' (' + formatter(entry[1]) + ')';
    }).join('; ') + '.';
  }

  function render(data, options) {
    if (options && options.uiStyle) setStyle(options.uiStyle);
    if (!charts.analistas) return;
    setEmpty(data);
    if (!data || !data.length) {
      charts.analistas.data.labels = [];
      charts.analistas.data.datasets[0].data = [];
      updateMonthlyPresentation(Array(12).fill(0), { usesScheduleDate: false });
      charts.origem.data.labels = [];
      charts.origem.data.datasets[0].data = [];
      charts.destino.data.labels = [];
      charts.destino.data.datasets[0].data = [];
      charts.incoterm.data.labels = ['Sem dados'];
      charts.incoterm.data.datasets[0].data = [1];
      charts.agentes.data.labels = [];
      charts.agentes.data.datasets[0].data = [];
      charts.operacaoSiglas.data.labels = [];
      charts.operacaoSiglas.data.datasets[0].data = [];
      Object.keys(charts).forEach(function (key) { charts[key].update(); });
      return;
    }

    const byAnalista = topEntries(sumBy(data, 'analista', 'valorUSD'), 10);
    charts.analistas.data.labels = byAnalista.map(function (entry) { return entry[0]; });
    charts.analistas.data.datasets[0].data = byAnalista.map(function (entry) { return entry[1]; });
    setSummary('chart-analistas-summary', summarizeEntries('Valor por analista', byAnalista, global.UI.formatUSDFull));

    const requestedYear = options && options.monthlyYear ? String(options.monthlyYear) : 'LATEST';
    const scheduleRows = data.filter(function (item) {
      const reference = item.monthlyReference;
      return reference && (reference.source === 'ETA' || reference.source === 'ETS') &&
        Number.isInteger(Number(reference.month)) && Number(reference.month) >= 1 && Number(reference.month) <= 12 &&
        Number.isInteger(Number(reference.year)) && Number(reference.year) >= 1900 && Number(reference.year) <= 2100;
    });
    const usesScheduleDate = scheduleRows.length > 0 || (options && options.isDemo === false);
    const availableYears = Array.from(new Set(scheduleRows.map(function (item) { return Number(item.monthlyReference.year); }))).sort(function (a, b) { return a - b; });
    let targetYear = null;
    if (usesScheduleDate && requestedYear !== 'ALL') {
      targetYear = requestedYear === 'LATEST' ? availableYears[availableYears.length - 1] : Number(requestedYear);
      if (!Number.isInteger(targetYear) || availableYears.indexOf(targetYear) === -1) targetYear = availableYears[availableYears.length - 1];
    }
    const monthlyRows = usesScheduleDate
      ? scheduleRows.filter(function (item) { return targetYear == null || Number(item.monthlyReference.year) === targetYear; })
      : data;
    const byMonth = Array(12).fill(0);
    monthlyRows.forEach(function (item) {
      const month = usesScheduleDate ? Number(item.monthlyReference.month) : Number(item.month);
      if (month >= 1 && month <= 12) byMonth[month - 1] += 1;
    });
    const missingCount = usesScheduleDate ? data.length - scheduleRows.length : 0;
    const now = new Date();
    const currentMonthIndex = now.getFullYear() * 12 + now.getMonth();
    const windowStartIndex = currentMonthIndex - 11;
    let trailingTotal = 0;
    if (usesScheduleDate) {
      scheduleRows.forEach(function (item) {
        const reference = item.monthlyReference;
        const absolute = Number(reference.year) * 12 + (Number(reference.month) - 1);
        if (absolute >= windowStartIndex && absolute <= currentMonthIndex) trailingTotal += 1;
      });
    }
    const trailingAverage = usesScheduleDate ? trailingTotal / 12 : null;
    const monthlyStats = updateMonthlyPresentation(byMonth, {
      year: targetYear,
      usesScheduleDate: usesScheduleDate,
      missingCount: missingCount,
      trailingAverage: trailingAverage
    });
    const monthlyScope = usesScheduleDate
      ? (targetYear == null ? 'ETA/ETS em todos os anos' : 'ETA/ETS em ' + targetYear)
      : 'mês importado';
    const trailingSummary = trailingAverage != null
      ? ' Média dos últimos 12 meses (' + MONTH_NAMES[windowStartIndex % 12] + ' ' +
        Math.floor(windowStartIndex / 12) + '–' + MONTH_NAMES[currentMonthIndex % 12] + ' ' +
        Math.floor(currentMonthIndex / 12) + '): ' + global.UI.formatNumber(trailingAverage, 1) + ' processo(s)/mês.'
      : '';
    setSummary('chart-mensal-summary', 'Processos por ' + monthlyScope + ': ' + byMonth.map(function (value, index) {
      return value ? MONTH_NAMES[index] + ' (' + global.UI.formatNumber(value) + ')' : null;
    }).filter(Boolean).join('; ') + (monthlyStats.hasMonths
      ? '. Total de ' + formatCount(monthlyStats.total, 'processo', 'processos') + ' em ' + formatCount(monthlyStats.activeMonths, 'mês', 'meses') + '; pico em ' + MONTH_NAMES[monthlyStats.peakIndex] + '.'
      : 'sem meses identificados.') + trailingSummary);

    const byOrigem = topEntries(countBy(data, 'origem'), 5);
    charts.origem.data.labels = byOrigem.map(function (entry) { return entry[0]; });
    charts.origem.data.datasets[0].data = byOrigem.map(function (entry) { return entry[1]; });
    setSummary('chart-origem-summary', summarizeEntries('Principais origens', byOrigem, global.UI.formatNumber));

    const byDestino = topEntries(countBy(data, 'destino'), 5);
    charts.destino.data.labels = byDestino.map(function (entry) { return entry[0]; });
    charts.destino.data.datasets[0].data = byDestino.map(function (entry) { return entry[1]; });
    setSummary('chart-destino-summary', summarizeEntries('Principais destinos', byDestino, global.UI.formatNumber));

    const byIncoterm = countBy(data, 'incoterm');
    const known = ['CFR', 'FOB', 'CIF', 'EXW'];
    const labels = [];
    const values = [];
    let outros = 0;
    known.forEach(function (key) {
      if (byIncoterm[key]) {
        labels.push(key);
        values.push(byIncoterm[key]);
      }
    });
    Object.keys(byIncoterm).forEach(function (key) {
      if (known.indexOf(key) === -1) outros += byIncoterm[key];
    });
    if (outros > 0) {
      labels.push('Outros');
      values.push(outros);
    }
    charts.incoterm.data.labels = labels;
    charts.incoterm.data.datasets[0].data = values;
    setSummary('chart-incoterm-summary', summarizeEntries('Incoterms', labels.map(function (label, index) { return [label, values[index]]; }), global.UI.formatNumber));

    const byAgente = topEntries(countBy(data, 'agente'), 10);
    charts.agentes.data.labels = byAgente.map(function (entry) { return entry[0]; });
    charts.agentes.data.datasets[0].data = byAgente.map(function (entry) { return entry[1]; });
    setSummary('chart-agentes-summary', summarizeEntries('Quantidade por agente', byAgente, global.UI.formatNumber));

    const byOperacaoSigla = topEntries(countBy(data, 'operacaoSigla'), 10);
    charts.operacaoSiglas.data.labels = byOperacaoSigla.map(function (entry) { return entry[0]; });
    charts.operacaoSiglas.data.datasets[0].data = byOperacaoSigla.map(function (entry) { return entry[1]; });
    setSummary('chart-operacao-siglas-summary', summarizeEntries('Quantidade por sigla da operação', byOperacaoSigla, global.UI.formatNumber));

    Object.keys(charts).forEach(function (key) { charts[key].update(); });
  }

  global.Charts = { init: init, render: render, setStyle: setStyle };
})(typeof globalThis !== 'undefined' ? globalThis : this);
