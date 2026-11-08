const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const compPlus = d.querySelector('[data-offset="comp"][data-delta="1"]');
  const devicePlus = d.querySelector('[data-device-delta="1"]');
  compPlus.click();
  compPlus.click();
  compPlus.click();
  await wait(2850);
  const firstCal = window.bpmClockTrace.entries.filter(entry => entry.reason === 'CALIBRATION');
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(firstCal.length, 1);
  assert.strictEqual(firstCal[0].calibrationSteps, 3);
  assert.strictEqual(firstCal[0].networkCompBeforeMs, 0);
  assert.strictEqual(firstCal[0].networkCompMs, 3);
  assert.ok(Number.isFinite(firstCal[0].calibrationDurationMs));

  devicePlus.click();
  devicePlus.click();
  await wait(2850);
  const allCal = window.bpmClockTrace.entries.filter(entry => entry.reason === 'CALIBRATION');
  assert.strictEqual(allCal.length, 2);
  assert.strictEqual(allCal[1].calibrationSteps, 2);
  assert.strictEqual(allCal[1].deviceExtraBeforeMs, 0);
  assert.strictEqual(allCal[1].deviceExtraMs, 2);
  console.log(JSON.stringify({ calibrations: allCal.map(entry => ({
    steps: entry.calibrationSteps,
    durationMs: Math.round(entry.calibrationDurationMs),
    networkCompBefore: entry.networkCompBeforeMs,
    networkComp: entry.networkCompMs,
    deviceExtraBefore: entry.deviceExtraBeforeMs,
    deviceExtra: entry.deviceExtraMs,
  })), errors }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
