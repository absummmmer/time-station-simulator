const assert = require('assert');
const { boot, wait } = require('./dom-harness');

const MIN = 60 * 1000;

function syntheticPoints(now, options = {}) {
  const count = options.count || 9;
  const gapMin = options.gapMin || 30;
  const ppm = options.ppm === undefined ? -1.5 : options.ppm;
  const noiseMs = options.noiseMs || 0;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const at = now - (count - 1 - i) * gapMin * MIN;
    const elapsedSec = (at - (now - (count - 1) * gapMin * MIN)) / 1000;
    const offsetMs = -20 + ppm * 1e-6 * elapsedSec * 1000 + ((i % 3) - 1) * noiseMs;
    points.push({ at, offsetMs });
  }
  return points;
}

(async () => {
  const { window, errors } = await boot();
  const now = Date.now();

  const stable = window.eval(`clockServoEstimate(${JSON.stringify(syntheticPoints(now))}, ${now})`);
  assert.strictEqual(stable.quality, 'stable');
  assert.ok(Math.abs(stable.ppm - (-1.5)) < 0.2, `expected -1.5ppm, got ${stable.ppm}`);
  assert.ok(stable.madPpm < 3.5);

  const noisy = window.eval(`clockServoEstimate(${JSON.stringify(syntheticPoints(now, { noiseMs: 0.6 }))}, ${now})`);
  assert.strictEqual(noisy.quality, 'stable', 'small measurement noise should stay stable');

  const unstable = window.eval(`clockServoEstimate(${JSON.stringify(syntheticPoints(now, { ppm: 0, noiseMs: 12 }))}, ${now})`);
  assert.notStrictEqual(unstable.quality, 'stable', 'large inconsistent offsets must not enable trim');

  const stepPoints = syntheticPoints(now);
  stepPoints[4].offsetMs += 12;
  const step = window.eval(`clockServoEstimate(${JSON.stringify(stepPoints)}, ${now})`);
  assert.notStrictEqual(step.quality, 'stable', 'a reference step must hold the trim');

  const stale = window.eval(`clockServoEstimate(${JSON.stringify(syntheticPoints(now - 5 * 60 * MIN))}, ${now})`);
  assert.strictEqual(stale.quality, 'idle', 'stale sync history must not enable trim');

  // Wire a stable synthetic audit history into the live servo state.
  const history = syntheticPoints(now).map(point => ({
    at: new Date(point.at).toISOString(),
    ok: true,
    offsetMs: point.offsetMs,
  }));
  for (const row of history) {
    window.eval(`recordSyncAudit(${JSON.stringify(row)})`);
  }
  const updated = window.eval(`updateClockServo(${now}, null)`);
  assert.strictEqual(updated.state, 'stable');
  assert.ok(Math.abs(updated.appliedPpm - (-1.5)) < 0.2);

  const fields = window.eval('clockServoAuditFields(0)');
  assert.strictEqual(fields.clockServoState, 'stable');
  assert.ok(Number.isFinite(fields.clockServoPpm));

  const before = window.eval('getClockServoState()').appliedMs;
  await wait(120);
  window.eval('applyClockServoTrim()');
  const afterState = window.eval('getClockServoState()');
  assert.strictEqual(afterState.quality, 'stable');
  assert.ok(afterState.appliedMs < before, 'negative servo ppm must trim localOffset downward');
  assert.ok(afterState.appliedMs !== 0, 'servo trim must accumulate applied milliseconds');

  const status = window.eval(`formatLastSyncStatus(${JSON.stringify({
    at: new Date(now).toISOString(),
    ok: true,
    uncertaintyMs: 4.0,
    spreadMs: 1.0,
    kept: 5,
    samples: 7,
    rttMs: 8,
    clockServoState: 'stable',
    clockServoPpm: -1.5,
    clockServoAppliedMs: -2.1,
    clockServoPoints: 8,
  })})`);
  assert.ok(status.includes('TRIM -1.50ppm'), `status must show trim, got: ${status}`);
  assert.ok(status.includes('±4.0ms'), `status must keep sync metrics, got: ${status}`);

  const holdStatus = window.eval(`formatLastSyncStatus(${JSON.stringify({
    at: new Date(now).toISOString(),
    ok: true,
    clockServoState: 'unstable',
  })})`);
  assert.ok(holdStatus.includes('TRIM HOLD'), `unstable history must show hold, got: ${holdStatus}`);

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({
    stablePpm: Number(stable.ppm.toFixed(2)),
    stableMadPpm: Number(stable.madPpm.toFixed(2)),
    noisyQuality: noisy.quality,
    unstableQuality: unstable.quality,
    staleQuality: stale.quality,
    appliedTrimMs: Number(afterState.appliedMs.toFixed(5)),
    status,
    holdStatus,
    errors,
  }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
