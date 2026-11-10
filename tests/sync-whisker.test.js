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
  const bands = [...chart.querySelectorAll('.trace-sync-band')];
  const jitterBands = [...chart.querySelectorAll('.trace-sync-jitter-band')];
  const uncertaintyBands = [...chart.querySelectorAll('.trace-sync-uncertainty-band')];
  const data = chart._traceData || {};
  const syncInfo = (data.syncWhiskers || [])[0];
  const allRects = [...jitterBands, ...uncertaintyBands];
  const filled = allRects.every(rect => rect.getAttribute('fill')
    && Number(rect.getAttribute('width')) > 0
    && Number(rect.getAttribute('height')) > 0);
  const faint = allRects.every(rect => Number(rect.getAttribute('fill-opacity')) <= 0.3);
  const noOldLines = chart.querySelectorAll('.trace-sync-whisker').length === 0;
  const syncPoint = syncInfo && (data.points || []).find(point => point.sampleIndex === syncInfo.sampleIndex);
  const tooltip = syncPoint ? data.tooltip(syncPoint) : '';
  const expectedX = syncInfo && typeof data.xOf === 'function' ? data.xOf(syncInfo.sampleIndex) : null;
  const anchored = expectedX !== null && uncertaintyBands.length > 0
    && Math.abs(Number(uncertaintyBands[0].getAttribute('x')) - expectedX) < 0.01;

  assert.deepStrictEqual(errors, []);
  assert.ok(bands.length >= 1, `expected sync bands, got ${bands.length}`);
  assert.ok(uncertaintyBands.length >= 1, 'expected an uncertainty band');
  assert.ok(jitterBands.length >= 1, 'expected a jitter band');
  assert.ok(filled, 'sync bands must be filled rectangles with width and height');
  assert.ok(faint, 'sync bands must stay faint (fill-opacity <= 0.3)');
  assert.ok(noOldLines, 'old vertical whisker lines must be replaced by bands');
  assert.ok(anchored, 'sync band must start at the matching trace sample x');
  assert.ok(syncInfo && syncInfo.uncertaintyMs === 2.5 && syncInfo.jitterMs === 3,
    `unexpected sync band data: ${JSON.stringify(syncInfo)}`);
  assert.ok(tooltip.includes('sync') && tooltip.includes('±2.5ms') && tooltip.includes('Δ3.0ms'),
    `tooltip must describe sync quality: ${tooltip}`);

  // A sync band must not bridge into another trace series/session: it stops at
  // the last sample of its own segment instead of extending to a later sync.
  const second = await boot();
  const sw = second.window;
  const sd = sw.document;
  const t = Date.now();
  const addTrace = (rawMs, offsetMs, session, reason) => {
    const extra = {
      at: new Date(rawMs).toISOString(),
      rawAt: new Date(rawMs).toISOString(),
      monoMs: rawMs % 100000,
      offsetMs,
      session,
      signal: 'PLAYING',
      visibility: 'VISIBLE',
      wakeLock: 'OFF',
    };
    sw.eval(`recordClockTrace(${JSON.stringify(reason)}, ${JSON.stringify(extra)})`);
  };
  const addSync = (rawMs, offsetMs) => {
    sw.eval(`recordSyncAudit(${JSON.stringify({
      at: new Date(rawMs).toISOString(),
      reason: 'manual',
      ok: true,
      offsetBeforeMs: 0,
      offsetMs,
      uncertaintyMs: 2,
      spreadMs: 2,
      samples: 8,
      kept: 5,
      durationMs: 300,
    })})`);
  };
  addTrace(t - 6000, 1, 'S1', 'HEARTBEAT');
  addTrace(t - 5000, 1, 'S1', 'SYNC_OK');
  addTrace(t - 2000, 5, 'S2', 'HEARTBEAT');
  addTrace(t - 1000, 5, 'S2', 'SYNC_OK');
  addTrace(t - 500, 5, 'S2', 'HEARTBEAT');
  addSync(t - 5000, 1);
  addSync(t - 1000, 5);
  sw.eval('renderClockTraceView()');

  const boundaryChart = sd.getElementById('clock_trace_offset_chart');
  const boundaryBands = [...boundaryChart.querySelectorAll('.trace-sync-band')];
  const bandWidths = boundaryBands.map(band => Number(band.querySelector('rect').getAttribute('width')));
  assert.deepStrictEqual(second.errors, []);
  assert.strictEqual(boundaryBands.length, 2, `expected two boundary bands, got ${boundaryBands.length}`);
  assert.ok(bandWidths[0] < 10, `first band must stop at the session boundary: ${bandWidths[0]}`);
  assert.ok(bandWidths[1] > 100, `second band should extend within its session: ${bandWidths[1]}`);

  console.log(JSON.stringify({
    bands: bands.length,
    jitterBands: jitterBands.length,
    uncertaintyBands: uncertaintyBands.length,
    filled,
    faint,
    anchored,
    syncInfo,
    tooltipHasQuality: true,
    boundaryBands: boundaryBands.length,
    bandWidths,
    errors,
  }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
