// Persistência do dataset: Supabase (fonte compartilhada) e IndexedDB
// (cache local/offline). O app injeta estado, helpers e callbacks para a
// persistência continuar no padrão IIFE/global, sem build e sem depender da
// ordem interna do app.js.
(function (global) {
  'use strict';

  function create(deps) {
    var state = deps.state;
    var toPersistedRecord = deps.toPersistedRecord;
    var DashboardState = deps.DashboardState;
    var SupabaseStorage = deps.SupabaseStorage;
    var ETL = deps.ETL;
    var UI = deps.UI;
    var onLoadedAtChanged = deps.onLoadedAtChanged;

    const DB_NAME = 'bi_hub';
    const DB_VERSION = 1;
    const DB_STORE = 'kv';
    const SNAPSHOT_KEY = 'snapshot';

    let persistTimer = null;
    let persistenceWarningShown = false;
    let pendingSnapshotValidations = 0;
    let persistPending = false;
    let persistRetryCount = 0;

    // Enquanto houver importação remota em andamento, o cache local fica
    // congelado para que um snapshot ainda não aceito pelo banco não seja gravado.
    function beginSnapshotValidation(context) {
      if (context.validationOpen) return;
      context.validationOpen = true;
      pendingSnapshotValidations += 1;
    }

    function endSnapshotValidation(context) {
      if (!context.validationOpen) return;
      context.validationOpen = false;
      pendingSnapshotValidations = Math.max(0, pendingSnapshotValidations - 1);
      if (pendingSnapshotValidations === 0 && persistPending) {
        // A importação terminou: retoma a persistência que ficou pendente em
        // vez de reagendar o timer indefinidamente (B4).
        persistPending = false;
        persistRetryCount = 0;
        schedulePersist();
      }
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

    // Recusas do banco (F11): chaves ausentes/duplicadas, superset violado,
    // payload acima do teto de 6 MB e cooldown entre duas escritas. Todas
    // significam "o snapshot novo NÃO foi gravado" — o cache local não pode
    // ser gravado, senão o que o banco recusou venceria o banco no próximo
    // carregamento.
    function isSnapshotRejected(error) {
      return !!error && /SNAPSHOT_(MISSING_RECORDS|INVALID_KEYS|DUPLICATE_KEYS|INVALID|TOO_LARGE|COOLDOWN)/.test(String(error.message || ''));
    }

    // Agendamento da persistência local (cache IndexedDB). O intervalo de
    // 600 ms evita gravar a cada tecla digitada.
    //
    // Se houver uma validação de snapshot em andamento (importação em curso), o
    // cache local fica congelado: gravar agora poderia salvar um snapshot que o
    // banco ainda vai recusar. A persistência é retomada quando a validação
    // termina (endSnapshotValidation), com um limite de tentativas para nunca
    // reagendar indefinidamente (B4).
    var PERSIST_RETRY_LIMIT = 10;

    function schedulePersist() {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(runScheduledPersist, 600);
    }

    function runScheduledPersist() {
      persistTimer = null;
      if (pendingSnapshotValidations > 0) {
        persistPending = true;
        if (persistRetryCount < PERSIST_RETRY_LIMIT) {
          persistRetryCount += 1;
          persistTimer = setTimeout(runScheduledPersist, 600);
        }
        return;
      }
      persistPending = false;
      persistRetryCount = 0;
      persistLocal().then(function (result) {
        var saved = result === true || (result && result.saved === true);
        if (saved) {
          persistenceWarningShown = false;
          return;
        }
        // O cache local é sempre gravado aqui (persistLocal é local-only), então
        // este caminho nunca é uma recusa do banco: a recusa chega pelo
        // `validationError` devolvido por persistNow(), que é o que o fluxo de
        // importação consome. O antigo `onRejectedSnapshot` era um ramo morto.
        if (!state.isDemo && !persistenceWarningShown) {
          persistenceWarningShown = true;
          UI.toast('O dataset atual não pôde ser salvo neste navegador.', 'warning', 'Persistência indisponível');
        }
      }).catch(function (error) {
        console.error('Falha ao persistir o dataset.', error);
        if (!persistenceWarningShown) {
          persistenceWarningShown = true;
          UI.toast('O dataset atual não pôde ser salvo nesta sessão.', 'warning', 'Persistência indisponível');
        }
      });
    }

    // Importação precisa saber se o banco aceitou o snapshot antes de mostrar
    // sucesso; interações de UI continuam usando o debounce de schedulePersist().
    function persistNow() {
      clearTimeout(persistTimer);
      persistTimer = null;
      return persistState();
    }

    function buildSnapshot() {
      if (state.isDemo) return null;
      return {
        version: DashboardState.SNAPSHOT_VERSION,
        // O que é persistido é enxuto: sem o índice de busca derivado (_search) e
        // sem campos vazios (null, '' e arrays vazios). O _search é recalculado
        // por prepareRecord() quando o snapshot é restaurado, então a busca
        // continua funcionando (M1).
        records: state.dataset.map(toPersistedRecord),
        meta: {
          name: state.meta.name,
          sheetName: state.meta.sheetName,
          headerRow: state.meta.headerRow,
          rowCount: state.meta.rowCount,
          ignoredRows: state.meta.ignoredRows || 0,
          commentCount: state.meta.commentCount || 0,
          parserVersion: state.meta.parserVersion || ETL.PARSER_VERSION,
          loadedAt: state.meta.loadedAt.toISOString()
        },
        filters: state.filters,
        search: state.search,
        analistaMode: state.analistaMode,
        uiStyle: state.uiStyle
      };
    }

    // Mudanças de visualização (filtros, busca, estilo, USD/QTD) salvam somente no
    // IndexedDB. Reenviar o dataset ao Supabase a cada interação deixava uma aba
    // antiga sobrescrever o último arquivo importado com dados velhos.
    function persistLocal() {
      var snapshot = buildSnapshot();
      if (!snapshot) return Promise.resolve(false);
      return idbSet(SNAPSHOT_KEY, snapshot);
    }

    // Chamado apenas ao importar um arquivo: o Supabase é a fonte compartilhada e
    // guarda só o dataset (records + meta). Filtros, busca e seletor USD/QTD ficam
    // só no navegador (IndexedDB), nunca no remoto.
    function persistState() {
      var snapshot = buildSnapshot();
      if (!snapshot) return Promise.resolve({ saved: false, remote: false, validationError: null });
      var remoteSnapshot = {
        version: snapshot.version,
        records: snapshot.records,
        meta: snapshot.meta
      };
      var remoteSave = SupabaseStorage && SupabaseStorage.saveSnapshot
        ? SupabaseStorage.saveSnapshot(remoteSnapshot)
        : Promise.resolve(false);

      return remoteSave.then(function (savedRemotely) {
        // O save pode devolver `true` (sem representação) ou o snapshot já
        // normalizado com o created_at do servidor (F2).
        var savedSnapshot = savedRemotely && typeof savedRemotely === 'object' ? savedRemotely : null;
        var serverLoadedAt = savedSnapshot && savedSnapshot.meta ? new Date(savedSnapshot.meta.loadedAt) : null;
        var hasServerLoadedAt = serverLoadedAt !== null && !Number.isNaN(serverLoadedAt.getTime());
        var remoteSaved = savedRemotely === true || !!(savedSnapshot && savedSnapshot.meta && hasServerLoadedAt);
        var loadedAtChanged = false;

        if (hasServerLoadedAt) {
          // O loadedAt original foi o que enviamos ao banco; guarda-o apenas para
          // diagnóstico. A ordenação e a "Última leitura" usam created_at.
          snapshot.meta.clientLoadedAt = savedSnapshot.meta.clientLoadedAt || snapshot.meta.loadedAt;
          snapshot.meta.loadedAt = serverLoadedAt.toISOString();
          if (state.meta) {
            var previousLoadedAt = new Date(state.meta.loadedAt).getTime();
            state.meta.loadedAt = serverLoadedAt;
            loadedAtChanged = !Number.isFinite(previousLoadedAt) || previousLoadedAt !== serverLoadedAt.getTime();
          }
        }

        // O IndexedDB permanece apenas como cache offline; o Supabase é a fonte principal.
        return idbSet(SNAPSHOT_KEY, snapshot).then(function () {
          // Só o texto de "Última leitura" muda aqui; os gráficos não são
          // redesenhados porque o dataset é o mesmo.
          if (loadedAtChanged) onLoadedAtChanged();
          return {
            saved: remoteSaved,
            remote: remoteSaved,
            validationError: null
          };
        });
      }).catch(function (error) {
        if (isSnapshotRejected(error)) {
          console.error('[BI Hub] Snapshot recusado pelo banco.', error);
          // Não grava no cache local: o snapshot recusado não pode vencer o banco
          // no próximo carregamento. O snapshot anterior continua no IndexedDB.
          return { saved: false, remote: false, validationError: error };
        }
        console.error('[BI Hub] Falha ao salvar no Supabase.', error);
        return idbSet(SNAPSHOT_KEY, snapshot).then(function () {
          return { saved: false, remote: false, error: error };
        });
      });
    }

    function restoreState(options) {
      var onLocal = options && typeof options.onLocal === 'function' ? options.onLocal : null;
      // As duas leituras começam em paralelo. O remoto pode ser lento (ou estar
      // pendurado até o timeout de 15 s do supabase.js); o cache local não pode
      // ficar esperando por ele para pintar a primeira tela.
      var remoteRestore = SupabaseStorage && SupabaseStorage.getLatestSnapshot
        ? SupabaseStorage.getLatestSnapshot().catch(function (error) {
          console.error('[BI Hub] Falha ao restaurar do Supabase.', error);
          return null;
        })
        : Promise.resolve(null);

      var localRestore = idbGet(SNAPSHOT_KEY)
        .then(function (cachedSnapshot) {
          return DashboardState.isValidSnapshot(cachedSnapshot) ? cachedSnapshot : null;
        })
        .catch(function () { return null; });

      return localRestore.then(function (cachedSnapshot) {
        // Primeiro paint: entrega o cache válido assim que o IndexedDB responde,
        // sem aguardar o Supabase. O remoto reconcilia logo abaixo.
        if (onLocal && cachedSnapshot) onLocal(cachedSnapshot);
        return remoteRestore.then(function (remoteSnapshot) {
          var remoteOk = DashboardState.isValidSnapshot(remoteSnapshot);
          var cacheOk = cachedSnapshot !== null;
          if (!remoteOk && !cacheOk) return null;

          var chosen = remoteOk ? remoteSnapshot : cachedSnapshot;
          if (remoteOk && cacheOk) {
            // Se um cliente antigo sobrescreveu o remoto com um dataset velho,
            // vence o mais recente: quem foi importado por último manda.
            var remoteLoadedAt = new Date(remoteSnapshot.meta.loadedAt).getTime();
            var cacheLoadedAt = new Date(cachedSnapshot.meta.loadedAt).getTime();
            if (Number.isFinite(cacheLoadedAt) && (!Number.isFinite(remoteLoadedAt) || cacheLoadedAt > remoteLoadedAt)) {
              chosen = cachedSnapshot;
            }
          }

          if (chosen === remoteSnapshot) {
            // O remoto traz só o dataset. Preserva filtros/busca/seletor do cache
            // local para não zerar a UI a cada recarregamento.
            if (cacheOk) {
              if (cachedSnapshot.filters) chosen.filters = cachedSnapshot.filters;
              if (typeof cachedSnapshot.search === 'string') chosen.search = cachedSnapshot.search;
              if (cachedSnapshot.analistaMode != null) chosen.analistaMode = cachedSnapshot.analistaMode;
              if (cachedSnapshot.uiStyle != null) chosen.uiStyle = cachedSnapshot.uiStyle;
            }
            // Mantém o cache local alinhado com o que foi restaurado.
            idbSet(SNAPSHOT_KEY, chosen).catch(function () { /* cache opcional */ });
          }
          return chosen;
        });
      }).catch(function () {
        return idbGet(SNAPSHOT_KEY).then(function (cachedSnapshot) {
          return DashboardState.isValidSnapshot(cachedSnapshot) ? cachedSnapshot : null;
        });
      });
    }

    return {
      schedulePersist: schedulePersist,
      persistNow: persistNow,
      buildSnapshot: buildSnapshot,
      restoreState: restoreState,
      beginSnapshotValidation: beginSnapshotValidation,
      endSnapshotValidation: endSnapshotValidation
    };
  }

  global.DashboardPersistence = { create: create };
})(globalThis);
