const assert = require('assert');
const { boot } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const now = Date.now();
  window.eval("recordClockTrace('SYNC_START')");
  window.eval(`recordSyncAudit(${JSON.stringify({
    at: new Date(now).toISOString(),
    reason: 'manual',
    ok: true,
    offsetBeforeMs: 0,
    offsetMs: 1.2,
    uncertaintyMs: 2.5,
    rttMs: 40,
    spreadMs: 3,
    samples: 8,
    kept: 5,
    durationMs: 400,
  })})`);
  window.eval("recordClockTrace('SYNC_OK')");
  window.eval('renderClockTraceView()');

  const chart = d.getElementById('clock_trace_offset_chart');
  const whiskers = [...chart.querySelectorAll('.trace-sync-whisker')];
  const uncertaintyBars = [...chart.querySelectorAll('.trace-sync-uncertainty')];
  const jitterBars = [...chart.querySelectorAll('.trace-sync-jitter')];
  const data = chart._traceData || {};
  const syncInfo = (data.syncWhiskers || [])[0];
  const vertical = whiskers.every(line => line.getAttribute('x1') === line.getAttribute('x2'));
  const faint = whiskers.every(line => Number(line.getAttribute('stroke-opacity')) <= 0.5);
  const syncPoint = syncInfo && (data.points || []).find(point => point.sampleIndex === syncInfo.sampleIndex);
  const tooltip = syncPoint ? data.tooltip(syncPoint) : '';

  assert.deepStrictEqual(errors, []);
  assert.ok(whiskers.length >= 2, `expected sync whiskers, got ${whiskers.length}`);
  assert.ok(uncertaintyBars.length >= 1, 'expected an uncertainty bar');
  assert.ok(jitterBars.length >= 1, 'expected a jitter bar');
  assert.ok(vertical, 'sync whiskers must be vertical lines without end caps');
  assert.ok(faint, 'sync whiskers must be faint (stroke-opacity <= 0.5)');
  assert.ok(syncInfo && syncInfo.uncertaintyMs === 2.5 && syncInfo.jitterMs === 3,
    `unexpected sync whisker data: ${JSON.stringify(syncInfo)}`);
  assert.ok(tooltip.includes('sync') && tooltip.includes('±2.5ms') && tooltip.includes('Δ3.0ms'),
    `tooltip must describe sync quality: ${tooltip}`);
  console.log(JSON.stringify({
    whiskers: whiskers.length,
    uncertaintyBars: uncertaintyBars.length,
    jitterBars: jitterBars.length,
    vertical,
    faint,
    syncInfo,
    tooltipHasQuality: true,
    errors,
  }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
