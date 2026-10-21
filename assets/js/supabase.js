(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://bsczvemaqvladupmdpgl.supabase.co';
  var SUPABASE_KEY = 'sb_publishable__yjnKEx9-sdsKj1d89JpnA_fVj7al9N';
  var TABLE = 'excel_imports';

  function request(path, options) {
    var requestOptions = options || {};
    requestOptions.headers = Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    }, requestOptions.headers || {});

    return fetch(SUPABASE_URL + '/rest/v1/' + path, requestOptions).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (body) {
          var payload = null;
          try { payload = body ? JSON.parse(body) : null; } catch (error) { payload = null; }
          var detail = payload && payload.message ? payload.message : body;
          var failure = new Error('Supabase retornou ' + response.status + (detail ? ': ' + detail : ''));
          failure.status = response.status;
          if (payload) {
            failure.code = payload.code;
            failure.details = payload.details;
            failure.hint = payload.hint;
          }
          throw failure;
        });
      }
      // 201/204 podem chegar sem corpo (return=minimal ou proxy antigo);
      // chamar response.json() nesses casos acusava falha mesmo com o dado salvo.
      return response.text().then(function (body) {
        if (!body) return null;
        try {
          return JSON.parse(body);
        } catch (error) {
          return null;
        }
      });
    });
  }

  // A linha do banco é a fonte do snapshot. `created_at` (relógio do servidor)
  // é o único valor usado para ordenar nuvem x cache e para "Última leitura";
  // o `loadedAt` enviado pelo cliente fica só como diagnóstico (F2).
  function rowToSnapshot(row) {
    var metadata = row.metadata || {};
    var snapshot = {
      version: global.DashboardState.SNAPSHOT_VERSION,
      records: row.records,
      meta: Object.assign({}, metadata, {
        name: row.file_name,
        sheetName: row.sheet_name,
        loadedAt: row.created_at
      })
    };
    if (metadata.loadedAt) snapshot.meta.clientLoadedAt = metadata.loadedAt;
    return snapshot;
  }

  function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.meta || !Array.isArray(snapshot.records)) return Promise.resolve(false);
    return request(TABLE, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        file_name: snapshot.meta.name,
        sheet_name: snapshot.meta.sheetName || '',
        records: snapshot.records,
        metadata: snapshot.meta
      })
    }).then(function (body) {
      // Com return=representation o PostgREST devolve a linha inserida (array
      // com um item) e o app já conhece o created_at do servidor. Corpo vazio
      // (ex.: proxy antigo) continua sendo sucesso, só sem o horário oficial.
      var row = Array.isArray(body) ? body[0] : body;
      if (!row || typeof row !== 'object' || !Array.isArray(row.records) || !row.created_at) return true;
      return rowToSnapshot(row);
    });
  }

  function getLatestSnapshot() {
    return request(TABLE + '?select=file_name,sheet_name,records,metadata,created_at&order=created_at.desc,id.desc&limit=1')
      .then(function (rows) {
        if (!rows || !rows.length) return null;
        return rowToSnapshot(rows[0]);
      });
  }

  global.SupabaseStorage = {
    saveSnapshot: saveSnapshot,
    getLatestSnapshot: getLatestSnapshot
  };
})(globalThis);
