// Tabela de dados e exportação CSV. O app injeta estado, elementos e helpers
// para a tabela continuar no padrão IIFE/global, sem build e sem depender da
// ordem interna do app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var els = deps.els;
    var UI = deps.UI;
    var ETL = deps.ETL;
    var getSortedData = deps.getSortedData;
    var getMonthlyReferenceMonth = deps.getMonthlyReferenceMonth;

    function renderTable() {
      var sorted = getSortedData();
      var total = sorted.length;
      var pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) state.page = pages;
      var start = (state.page - 1) * state.pageSize;
      var rows = sorted.slice(start, start + state.pageSize);

      var html = '';
      rows.forEach(function (item) {
        var diRegistered = ETL.isDiRegistered(item);
        var concluded = ETL.isConcluida(item);
        var modal = String(item.modal || 'N/A').toUpperCase();
        var modalCategory = item.modalCategory || ETL.classifyModal(modal);
        var modalClass = modalCategory === 'FCL'
          ? 'bg-blue-950 text-blue-400 border border-blue-800'
          : (modalCategory === 'LCL' ? 'bg-purple-950 text-purple-400 border border-purple-800' : 'bg-slate-800 text-slate-300 border border-slate-600');
        var statusFlags = '';
        if (ETL.isFaturada(item)) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">Faturada</span>';
        if (ETL.isArquivado(item)) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-200 border border-slate-600">Arquivado</span>';
        if (item.atracado === true) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">Atracado</span>';
        if (item.comments.length) statusFlags += '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800" title="' + UI.escapeHtml(item.comments.map(function (comment) { return comment.text || comment.reference; }).join(' | ')) + '">Comentário</span>';
        html += '<tr class="hover:bg-slate-700/30 transition">' +
          '<td class="p-3.5 text-slate-400 font-mono">' + UI.escapeHtml(ETL.monthName(getMonthlyReferenceMonth(item))) + '</td>' +
          '<td class="p-3.5 text-slate-200 font-semibold font-mono">' + UI.escapeHtml(item.operacao) + '</td>' +
          '<td class="p-3.5 font-semibold text-white">' + UI.escapeHtml(item.analista) + '</td>' +
          '<td class="p-3.5 text-slate-300 font-medium">' + UI.escapeHtml(item.mercadoria) + '</td>' +
          '<td class="p-3.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold ' + modalClass + '">' + UI.escapeHtml(modal) + '</span></td>' +
          '<td class="p-3.5 font-mono">' + (diRegistered
            ? '<span class="text-emerald-400 font-medium"><i class="fa-solid fa-check text-[10px] mr-1"></i>' + UI.escapeHtml(item.regDi) + '</span>'
            : '<span class="text-slate-500 italic">Pendente</span>') + '</td>' +
          '<td class="p-3.5"><div class="flex flex-wrap items-center gap-1"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' +
            (concluded ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800') + '">' +
            UI.escapeHtml(item.situacao) + '</span>' + statusFlags + '</div></td>' +
          '<td class="p-3.5 text-slate-300">' + UI.escapeHtml(item.origem) + ' &rarr; ' + UI.escapeHtml(item.destino) + '</td>' +
          '<td class="p-3.5 font-bold text-slate-200">' + UI.escapeHtml(item.incoterm) + '</td>' +
          '<td class="p-3.5 text-right font-mono text-emerald-400 font-bold" title="' + UI.escapeHtml(item.valorMoeda || 'USD') + '">' + UI.formatCurrencyFull(item.valor, item.valorMoeda) + '</td>' +
          '</tr>';
      });

      if (!rows.length) {
        html = '<tr><td colspan="10" class="p-10 text-center text-slate-500">' +
          '<i class="fa-solid fa-inbox text-2xl mb-2 block text-slate-600"></i>' +
          'Nenhum registro encontrado para os filtros atuais.</td></tr>';
      }

      els['table-body'].innerHTML = html;
      // O total do dataset aparece junto do total filtrado: o filtro de ano
      // padrão esconde parte dos dados e o usuário precisa enxergar isso (B9).
      var datasetTotal = state.dataset.length;
      var pageEnd = Math.min(start + state.pageSize, total);
      if (total) {
        els['table-count'].innerText = 'Exibindo ' + UI.formatNumber(start + 1) + '–' + UI.formatNumber(pageEnd) +
          ' de ' + UI.formatNumber(total) +
          (total < datasetTotal
            ? ' filtrados (' + UI.formatNumber(datasetTotal) + ' no total)'
            : ' registros');
        els['table-count'].title = total < datasetTotal
          ? UI.formatNumber(total) + ' filtrados de ' + UI.formatNumber(datasetTotal) + ' registros no dataset.'
          : UI.formatNumber(datasetTotal) + ' registros no dataset.';
      } else {
        els['table-count'].innerText = datasetTotal
          ? 'Nenhum registro corresponde aos filtros (' + UI.formatNumber(datasetTotal) + ' no dataset)'
          : 'Nenhum registro';
        els['table-count'].title = datasetTotal
          ? 'Nenhum registro corresponde aos filtros. O dataset tem ' + UI.formatNumber(datasetTotal) + ' registros.'
          : 'Nenhum registro.';
      }
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

    // Proteção contra CSV injection (fórmula): vale apenas para campos de TEXTO.
    // Campos numéricos saem como número puro — sem o prefixo "'" — senão o
    // Excel/Power BI lê "-1234,56" como texto e a agregação quebra (B2).
    var CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
    var CSV_NUMBER_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

    function csvTextCell(value) {
      var text = value == null ? '' : String(value);
      if (CSV_FORMULA_PREFIX.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }

    function csvNumberCell(value) {
      if (value == null || value === '') return '';
      var text = String(value).trim();
      // Valor não numérico (texto inesperado): cai na proteção de fórmula.
      if (!CSV_NUMBER_PATTERN.test(text)) return csvTextCell(value);
      return text;
    }

    function exportCsv() {
      var rows = getSortedData();
      var flagCsv = function (value) { return value === true ? 'Sim' : (value === false ? 'Não' : (value || '')); };
      var lines = ['Mês;Operação;Analista;Mercadoria;LCL/FCL;Modalidade;Reg DI;Situação;Origem;Destino;Incoterm;Valor informado;Moeda;Valor USD;Despachante;ETA;Ano ETA;ETS;Est Emb;Est Atr;Fechamento;Estimativa Emb;Estimativa Atr;Atracado;RIC;Número DI;Protocolo DI;Transportadora;Free time;Data Free time;Dias p/ Dev CNTR;Dias p/ Demurrage;Exportador;Agente;Conhecimento;Container;Invoice;Navio;Faturada;Arquivado;Comentários;Linha Excel'];
      rows.forEach(function (item) {
        lines.push([
          csvNumberCell(getMonthlyReferenceMonth(item) == null ? '' : getMonthlyReferenceMonth(item)),
          csvTextCell(item.operacao),
          csvTextCell(item.analista),
          csvTextCell(item.mercadoria),
          csvTextCell(item.modal),
          csvTextCell(item.modalidade),
          csvTextCell(item.regDi),
          csvTextCell(item.situacao),
          csvTextCell(item.origem),
          csvTextCell(item.destino),
          csvTextCell(item.incoterm),
          csvNumberCell((item.valor || 0).toFixed(2).replace('.', ',')),
          csvTextCell(item.valorMoeda || 'USD'),
          csvNumberCell(item.valorUSD == null ? '' : item.valorUSD.toFixed(2).replace('.', ',')),
          csvTextCell(item.despachante),
          csvTextCell(item.eta),
          csvNumberCell(item.etaYear == null ? '' : item.etaYear),
          csvTextCell(item.ets),
          csvTextCell(item.estEmb),
          csvTextCell(item.estAtr),
          csvTextCell(item.fech),
          csvTextCell(flagCsv(item.estimativaEmb)),
          csvTextCell(flagCsv(item.estimativaAtr)),
          csvTextCell(flagCsv(item.atracado)),
          csvTextCell(item.ric),
          csvTextCell(item.numeroDi),
          csvTextCell(item.protocoloDi),
          csvTextCell(item.transportadora),
          csvNumberCell(item.freeTime == null ? '' : String(item.freeTime).replace('.', ',')),
          csvTextCell(item.freeTimeData),
          csvNumberCell(item.diasDevCntr == null ? '' : String(item.diasDevCntr).replace('.', ',')),
          csvNumberCell(item.diasDemurrage == null ? '' : String(item.diasDemurrage).replace('.', ',')),
          csvTextCell(item.exportador),
          csvTextCell(item.agente),
          csvTextCell(item.conhecimento),
          csvTextCell(item.container),
          csvTextCell(item.invoice),
          csvTextCell(item.navio),
          csvTextCell(ETL.isFaturada(item) ? 'Sim' : ''),
          csvTextCell(ETL.isArquivado(item) ? 'Sim' : ''),
          csvTextCell(item.comments.map(function (comment) {
            return [comment.reference, comment.text, comment.author, comment.date].filter(Boolean).join(' — ');
          }).join(' | ')),
          csvNumberCell(item.sourceRowNumber == null ? '' : item.sourceRowNumber)
        ].join(';'));
      });
      var stamp = new Date().toISOString().slice(0, 10);
      UI.downloadFile('relatorio_importacoes_' + stamp + '.csv', '\uFEFF' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
      UI.toast(UI.formatNumber(rows.length) + ' registro(s) exportado(s) no CSV.', 'success', 'Exportação concluída');
    }

    return { renderTable: renderTable, exportCsv: exportCsv, updateSortIndicators: updateSortIndicators };
  }

  global.DashboardTable = { create: create };
})(globalThis);
