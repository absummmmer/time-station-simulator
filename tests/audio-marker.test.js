const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const master = d.getElementById('master_volume');
  master.value = '0.5';
  master.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(500);
  window.eval('recordClockTrace("CALIBRATION", {networkCompMs: 1, deviceExtraMs: 0, calibrationSteps: 1, calibrationDurationMs: 1, networkCompBeforeMs: 0, deviceExtraBeforeMs: 0})');
  window.eval('recordClockTrace("AUDIO_OUTPUT_MANUAL")');
  window.eval('recordClockTrace("AUDIO_OUTPUT_SYSTEM")');
  window.eval('renderClockTraceView()');

  const offsetMarkers = d.querySelectorAll('#clock_trace_offset_chart .trace-audio-change-line, #clock_trace_offset_chart .trace-calibration-line').length;
  const residualMarkers = d.querySelectorAll('#clock_trace_chart .trace-audio-change-line, #clock_trace_chart .trace-calibration-line').length;
  const audioManual = d.querySelectorAll('#clock_trace_audio_chart .trace-audio-change-line.manual').length;
  const audioSystem = d.querySelectorAll('#clock_trace_audio_chart .trace-audio-change-line.system').length;
  const audioCalibration = d.querySelectorAll('#clock_trace_audio_chart .trace-calibration-line').length;
  const markerClasses = [...d.querySelectorAll('#clock_trace_audio_chart .trace-audio-change-line, #clock_trace_audio_chart .trace-calibration-line')]
    .map(el => el.classList.contains('trace-calibration-line') ? 'calibration' : (el.classList.contains('manual') ? 'manual' : 'system'));
  const audioEl = d.getElementById('clock_trace_audio_chart');
  const ad = audioEl && audioEl._traceData;
  const last = ad && ad.points[ad.points.length - 1];
  const picked = ad && last ? ad.pickPoint(last.sampleIndex) : null;
  const pickOk = !!(picked && picked.sampleIndex === last.sampleIndex);

  assert.deepStrictEqual(errors, []);
  assert.strictEqual(offsetMarkers, 0);
  assert.strictEqual(residualMarkers, 0);
  assert.strictEqual(audioManual, 1);
  assert.strictEqual(audioSystem, 1);
  assert.strictEqual(audioCalibration, 1);
  assert.deepStrictEqual(markerClasses, ['calibration', 'manual', 'system']);
  assert.ok(pickOk);
  console.log(JSON.stringify({ offsetMarkers, residualMarkers, audioManual, audioSystem, audioCalibration, markerClasses, pickOk, errors }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
