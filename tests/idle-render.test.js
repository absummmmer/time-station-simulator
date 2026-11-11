const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const timeEl = d.getElementById('time_display');
  const initialCore = timeEl.querySelector('#time_core');
  const initialHm = timeEl.querySelector('.main-hm');
  assert.ok(initialCore && initialHm, 'clock face must render during boot');

  window.eval('updateTimeDisplay()');
  await wait(20);
  window.eval('updateTimeDisplay()');
  assert.strictEqual(timeEl.querySelector('#time_core'), initialCore,
    'clock face container must be reused instead of rebuilt');
  assert.strictEqual(timeEl.querySelector('.main-hm'), initialHm,
    'clock digits must be updated in place');

  // A hidden page must skip the render path entirely.
  const before = timeEl.textContent;
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => 'hidden' });
  window.eval('updateTimeDisplay()');
  assert.strictEqual(timeEl.textContent, before, 'hidden update must not touch the clock DOM');
  delete d.hidden;
  delete d.visibilityState;

  // The visibility helper must exist and the adaptive loop must be wired.
  assert.strictEqual(window.eval('typeof restartClockFaceTicks'), 'function');
  assert.strictEqual(window.eval('typeof clockFaceDelayMs'), 'function');

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({
    coreReused: true,
    digitsReused: true,
    hiddenNoop: true,
    adaptiveLoop: true,
    errors,
  }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
