// Importação de planilhas Excel: carregamento sob demanda do SheetJS, parse no
// Worker (com fallback para a thread principal), comparação com o snapshot do
// banco e feedback da importação. O app injeta estado e helpers e mantém
// wrappers curtos para os call sites existentes. O index.html carrega este
// módulo antes de app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var prepareRecord = deps.prepareRecord;
    var canonicalizeDataset = deps.canonicalizeDataset;
    var buildSearchIndex = deps.buildSearchIndex;
    var populateFilterOptions = deps.populateFilterOptions;
    var resetFilters = deps.resetFilters;
    var refresh = deps.refresh;
    var showTransientUpdateBanner = deps.showTransientUpdateBanner;
    var buildSnapshot = deps.buildSnapshot;
    var restoreState = deps.restoreState;
    var presentSnapshot = deps.presentSnapshot;
    var beginSnapshotValidation = deps.beginSnapshotValidation;
    var endSnapshotValidation = deps.endSnapshotValidation;
    var persistNow = deps.persistNow;

    // Versão da biblioteca SheetJS vendorizada. Entra na URL do <script> para
    // invalidar o cache do navegador quando a lib for trocada: a query string
    // muda, o navegador baixa o arquivo de novo em vez de reaproveitar uma
    // versão antiga (ou truncada) que ficou no cache. Mantida em sincronia com
    // vendor/manifest.json pelo teste tests/vendor.test.mjs.
    const XLSX_LIB_VERSION = '0.20.3';

    let xlsxLoadPromise = null;

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

    return {
      handleFileUpload: handleFileUpload,
      handleRejectedSnapshot: handleRejectedSnapshot
    };
  }

  global.DashboardImport = { create: create };
})(globalThis);
