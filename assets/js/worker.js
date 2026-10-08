importScripts('../../vendor/xlsx.full.min.js', 'etl.js');

self.onmessage = function (event) {
  var buffer = event.data && event.data.buffer;
  try {
    var result = self.ETL.parseWorkbook(buffer);
    self.postMessage({ ok: true, result: result });
  } catch (error) {
    self.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
  }
};
