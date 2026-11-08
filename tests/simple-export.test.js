const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const { document, URL, Blob, HTMLAnchorElement } = window;
  let capturedBlob = null;
  let capturedName = '';
  window.URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:simple-export'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { capturedName = this.download; };

  const now = new Date().toISOString();
  window.eval(`recordSyncAudit(${JSON.stringify({
    at: now, reason: 'manual', ok: true, offsetBeforeMs: 0, offsetMs: 1.2,
    uncertaintyMs: 2, rttMs: 21, spreadMs: 1, samples: 5, kept: 5, durationMs: 900,
    backendNtpSource: 'ntp.test', backendNtpFallback: false,
    backendNtpCorrectionApplied: true, backendNtpCorrectionReason: 'primary_synchronized',
    backendNtpServers: 'full-list-should-not-appear', backendNtpSources: '[{"server":"x"}]',
  })})`);
  window.eval('recordClockTrace("HEARTBEAT")');

  async function exportAndRead(expression) {
    capturedBlob = null;
    capturedName = '';
    window.eval(expression);
    assert.ok(capturedBlob, `no blob for ${expression}`);
    const text = await capturedBlob.text();
    return { name: capturedName, text, lines: text.replace(/^\ufeff/, '').split('\n') };
  }

  const sync = await exportAndRead('exportSyncAuditCsv({simple:true})');
  assert.strictEqual(sync.lines[0].split(',').length, 15);
  assert.ok(sync.lines[0].includes('backendNtpCorrectionApplied'));
  assert.ok(!sync.lines[0].includes('backendNtpSources'));
  assert.ok(sync.name.includes('simple-6h'));

  const trace = await exportAndRead('exportClockTraceCsv({simple:true})');
  const traceHeaders = trace.lines[0].replace(/"/g, '').split(',');
  assert.deepStrictEqual(traceHeaders, ['at', 'rawAt', 'monoMs', 'offsetMs', 'reason', 'visibility', 'session', 'deviceProfile', 'audioTimelineDeltaMs', 'audioContextSession', 'audioSkewPpm', 'reanchorReason', 'calibrationSteps', 'networkCompMs', 'deviceExtraMs']);
  assert.ok(trace.name.includes('trace-simple-6h'));

  const combined = await exportAndRead('exportCombinedSimpleCsv()');
  const combinedHeader = combined.lines[0].replace(/"/g, '').split(',');
  assert.strictEqual(combinedHeader[0], 'kind');
  assert.ok(combinedHeader.includes('audioTimelineDeltaMs'));
  assert.ok(combinedHeader.includes('backendNtpCorrectionApplied'));
  const combinedRows = combined.lines.slice(1).filter(Boolean);
  assert.ok(combinedRows.some(line => line.startsWith('"sync"')));
  assert.ok(combinedRows.some(line => line.startsWith('"trace"')));
  assert.ok(combined.name.includes('combined-simple-6h'));

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({ syncColumns: sync.lines[0].split(',').length, traceColumns: traceHeaders.length, combinedRows: combinedRows.length, filenames: [sync.name, trace.name, combined.name], errors }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
