// Card de status (#status-banner) e KPIs do topo. O app injeta estado,
// elementos e helpers para o banner continuar no padrão IIFE/global, sem build
// e sem depender da ordem interna do app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var els = deps.els;
    var UI = deps.UI;
    var ETL = deps.ETL;
    var getSelectedYear = deps.getSelectedYear;

    // O card de status (#status-banner) tem dois modos:
    //   - com dataset  -> mostra o que está carregado e some sozinho (transitório);
    //   - sem dataset  -> mostra o que fazer para carregar e fica visível.
    // A visibilidade NUNCA é mexida por refresh(): só a restauração, a
    // importação e o erro de inicialização decidem, para o card não reaparecer a
    // cada tecla digitada.
    var lastBannerHtml = '';
    // Enquanto o card mostra um erro fatal de inicialização, o refresh() não pode
    // sobrescrever a mensagem (B3).
    var statusBannerLocked = false;

    function setBannerText(html) {
      var element = els['banner-text'];
      if (!element) return;
      if (statusBannerLocked) return;
      // O card é uma região ao vivo (aria-live): reescrever o mesmo texto a cada
      // refresh() faria o leitor de tela repetir a leitura a cada tecla digitada.
      if (lastBannerHtml === html) return;
      lastBannerHtml = html;
      element.innerHTML = html;
    }

    function updateBanner() {
      var meta = state.meta || {};
      var isEmpty = state.isDemo || !state.dataset.length;
      var datasetTotal = state.dataset.length;
      var filteredTotal = Array.isArray(state.filtered) ? state.filtered.length : datasetTotal;
      var lastReadText = isEmpty
        ? 'Última leitura: aguardando arquivo'
        : 'Última leitura: ' + UI.formatDateTime(meta.loadedAt);
      els['last-read-header'].innerText = lastReadText;

      // O resumo do cabeçalho é o único lugar que sobrevive ao timer do card de
      // status (F9): nome do arquivo + total filtrado/total do dataset.
      var summary = els['dataset-summary'];
      if (isEmpty) {
        if (summary) {
          summary.innerText = 'Nenhum arquivo carregado';
          summary.title = 'Nenhum arquivo carregado';
        }
        setBannerText('Nenhum arquivo carregado. Clique em <strong>Carregar Excel Atualizado</strong> para selecionar a planilha <strong>!Importações.xlsx</strong>.');
        els['last-update-time'].innerText = 'Aguardando arquivo';
        return;
      }

      if (summary) {
        var summaryCounts = filteredTotal === datasetTotal
          ? UI.formatNumber(datasetTotal) + ' ' + (datasetTotal === 1 ? 'processo' : 'processos')
          : UI.formatNumber(filteredTotal) + ' de ' + UI.formatNumber(datasetTotal) + ' processos';
        summary.innerText = meta.name + ' · ' + summaryCounts;
        summary.title = meta.name + ' · ' + UI.formatNumber(filteredTotal) + ' filtrados de ' +
          UI.formatNumber(datasetTotal) + ' processos · ' + lastReadText;
      }

      var ignoredText = meta.ignoredRows ? ' &bull; ' + UI.formatNumber(meta.ignoredRows) + ' linha(s) ignorada(s)' : '';
      var commentsText = meta.commentCount ? ' &bull; ' + UI.formatNumber(meta.commentCount) + ' comentário(s)' : '';
      setBannerText('<strong>' + UI.escapeHtml(meta.name) + '</strong>' +
        ' &bull; Guia ' + UI.escapeHtml(meta.sheetName || '—') +
        ' &bull; ' + UI.formatNumber(meta.rowCount || state.dataset.length) + ' processos' +
        (meta.headerRow ? ' &bull; Cabeçalho na linha ' + meta.headerRow : '') + ignoredText + commentsText);
      els['last-update-time'].innerText = 'Última leitura: ' + UI.formatDateTime(meta.loadedAt);
    }

    var STATUS_BANNER_VISIBLE_MS = 8000;
    var STATUS_BANNER_FADE_MS = 300;

    function clearStatusBannerTimers(banner) {
      if (banner._hideTimer) { clearTimeout(banner._hideTimer); banner._hideTimer = null; }
      if (banner._fadeTimer) { clearTimeout(banner._fadeTimer); banner._fadeTimer = null; }
    }

    function hideStatusBanner() {
      var banner = document.getElementById('status-banner');
      if (!banner) return;
      clearStatusBannerTimers(banner);
      banner.classList.remove('is-fading-out');
      banner.hidden = true;
    }

    // Revela o card de status. Com `transient` = true ele some sozinho depois
    // de STATUS_BANNER_VISIBLE_MS (padrão); com false fica visível (estado
    // inicial sem arquivo e erro fatal de inicialização).
    function showStatusBanner(transient) {
      var banner = document.getElementById('status-banner');
      if (!banner) return;
      clearStatusBannerTimers(banner);
      banner.classList.remove('is-fading-out');
      banner.hidden = false;
      if (!transient) return;
      banner._hideTimer = setTimeout(function () {
        banner._hideTimer = null;
        banner.classList.add('is-fading-out');
        banner._fadeTimer = setTimeout(function () {
          banner._fadeTimer = null;
          hideStatusBanner();
        }, STATUS_BANNER_FADE_MS);
      }, STATUS_BANNER_VISIBLE_MS);
    }

    function showTransientUpdateBanner() {
      statusBannerLocked = false;
      showStatusBanner(true);
    }

    // Falhas fatais de inicialização precisam ficar visíveis (sem timer). O
    // erro trava o card: um refresh() posterior não pode sobrescrever a
    // mensagem (B3).
    function showStatusBannerError(message) {
      statusBannerLocked = true;
      if (els['banner-text']) {
        els['banner-text'].textContent = message;
        lastBannerHtml = '';
      }
      if (els['last-update-time']) els['last-update-time'].innerText = 'Falha na inicialização';
      showStatusBanner(false);
    }

    function updateKPIs(data) {
      var totalValor = data.reduce(function (acc, item) { return acc + (Number(item.valorUSD) || 0); }, 0);
      var totalPeso = data.reduce(function (acc, item) { return acc + (item.peso || 0); }, 0);
      var concluidos = data.filter(ETL.isConcluida).length;
      var valorValues = data.map(function (item) { return Number(item.valorUSD); }).filter(function (value) {
        return Number.isFinite(value) && value !== 0;
      });
      var foreignCurrencyCount = data.filter(function (item) {
        return item.valorMoeda && item.valorMoeda !== 'USD' && Number(item.valor) !== 0;
      }).length;
      var slaValues = data.map(function (item) { return item.slaDias; }).filter(function (value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0;
      });

      els['kpi-volume'].innerText = UI.formatCompactUSD(totalValor);
      els['kpi-volume-hint'].innerText = UI.formatUSDFull(totalValor) + (foreignCurrencyCount
        ? ' · ' + UI.formatNumber(foreignCurrencyCount) + ' valor(es) fora do USD'
        : '');
      els['kpi-processos'].innerText = UI.formatNumber(data.length);
      var datasetTotal = state.dataset.length;
      var selectedYear = getSelectedYear();
      if (!datasetTotal) {
        els['kpi-processos-hint'].innerText = 'Aguardando carregamento de dados';
      } else if (data.length < datasetTotal) {
        els['kpi-processos-hint'].innerText = UI.formatNumber(data.length) + ' de ' +
          UI.formatNumber(datasetTotal) + (selectedYear != null ? ' · filtro ' + selectedYear : ' · filtro ativo');
      } else {
        els['kpi-processos-hint'].innerText = UI.formatNumber(datasetTotal) + ' registros no dataset';
      }
      els['kpi-peso'].innerText = UI.formatNumber(totalPeso / 1000, 0) + ' t';
      els['kpi-ticket'].innerText = valorValues.length ? UI.formatCompactUSD(totalValor / valorValues.length) : '$0';
      els['kpi-conclusao'].innerText = data.length ? UI.formatPercent((concluidos / data.length) * 100) : '0%';

      if (slaValues.length) {
        var media = slaValues.reduce(function (acc, value) { return acc + value; }, 0) / slaValues.length;
        els['kpi-sla'].innerText = UI.formatNumber(media, 1) + ' dias';
        els['kpi-sla-hint'].innerText = 'Média de ' + UI.formatNumber(slaValues.length) + ' processo(s) com SLA';
      } else {
        els['kpi-sla'].innerText = '—';
        els['kpi-sla-hint'].innerText = state.dataset.length ? 'Sem dados de SLA para os filtros atuais' : 'Aguardando carregamento de dados';
      }
    }

    return {
      setBannerText: setBannerText,
      updateBanner: updateBanner,
      hideStatusBanner: hideStatusBanner,
      showStatusBanner: showStatusBanner,
      showTransientUpdateBanner: showTransientUpdateBanner,
      showStatusBannerError: showStatusBannerError,
      updateKPIs: updateKPIs
    };
  }

  global.DashboardBanner = { create: create };
})(globalThis);
