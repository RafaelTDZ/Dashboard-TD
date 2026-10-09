(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://bsczvemaqvladupmdpgl.supabase.co';
  var SUPABASE_KEY = 'sb_publishable__yjnKEx9-sdsKj1d89JpnA_fVj7al9N';
  var TABLE = 'excel_imports';

  function request(path, options) {
    return fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json'
      }
    }, options || {})).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (body) {
          throw new Error('Supabase retornou ' + response.status + (body ? ': ' + body : ''));
        });
      }
      return response.status === 204 ? null : response.json();
    });
  }

  function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.meta || !Array.isArray(snapshot.records)) return Promise.resolve(false);
    return request(TABLE, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        file_name: snapshot.meta.name,
        sheet_name: snapshot.meta.sheetName || '',
        records: snapshot.records,
        metadata: snapshot.meta
      })
    }).then(function () { return true; });
  }

  function getLatestSnapshot() {
    return request(TABLE + '?select=file_name,sheet_name,records,metadata,created_at&order=created_at.desc&limit=1')
      .then(function (rows) {
        if (!rows || !rows.length) return null;
        var row = rows[0];
        return {
          version: global.DashboardState.SNAPSHOT_VERSION,
          records: row.records,
          meta: Object.assign({}, row.metadata || {}, {
            name: row.file_name,
            sheetName: row.sheet_name,
            loadedAt: (row.metadata && row.metadata.loadedAt) || row.created_at
          })
        };
      });
  }

  global.SupabaseStorage = {
    saveSnapshot: saveSnapshot,
    getLatestSnapshot: getLatestSnapshot
  };
})(globalThis);
