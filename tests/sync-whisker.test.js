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
  const faint = allRects.every(rect => Number(rect.getAttribute('fill-opacity')) <= 0.2);
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
  assert.ok(faint, 'sync bands must stay faint (fill-opacity <= 0.2)');
  assert.ok(noOldLines, 'old vertical whisker lines must be replaced by bands');
  assert.ok(anchored, 'sync band must start at the matching trace sample x');
  assert.ok(syncInfo && syncInfo.uncertaintyMs === 2.5 && syncInfo.jitterMs === 3,
    `unexpected sync band data: ${JSON.stringify(syncInfo)}`);
  assert.ok(tooltip.includes('sync') && tooltip.includes('±2.5ms') && tooltip.includes('Δ3.0ms'),
    `tooltip must describe sync quality: ${tooltip}`);
  console.log(JSON.stringify({
    bands: bands.length,
    jitterBands: jitterBands.length,
    uncertaintyBands: uncertaintyBands.length,
    filled,
    faint,
    anchored,
    syncInfo,
    tooltipHasQuality: true,
    errors,
  }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
