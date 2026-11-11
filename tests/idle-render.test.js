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

  // Milliseconds off must hide the dot entirely (not just the digits).
  const showMs = d.getElementById('show_ms');
  showMs.checked = false;
  window.eval('updateTimeDisplay()');
  assert.strictEqual(d.getElementById('ms_display').style.display, 'none',
    'millisecond dot must be hidden when show_ms is off');
  showMs.checked = true;
  window.eval('updateTimeDisplay()');
  assert.notStrictEqual(d.getElementById('ms_display').style.display, 'none',
    'millisecond dot must return when show_ms is on');

  // A hidden page must skip the render path entirely.
  const before = timeEl.textContent;
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => 'hidden' });
  window.eval('updateTimeDisplay()');
  assert.strictEqual(timeEl.textContent, before, 'hidden update must not touch the clock DOM');
  delete d.hidden;
  delete d.visibilityState;

  // The main loop and the stale-frame watchdog must exist.
  assert.strictEqual(window.eval('typeof startClockLoopAndWatchdog'), 'function');
  assert.strictEqual(window.eval('typeof startClockLoop'), 'function');
  assert.strictEqual(window.eval('typeof stopClockLoop'), 'function');
  assert.strictEqual(window.eval('typeof setClockStaleHidden'), 'function');

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({
    coreReused: true,
    digitsReused: true,
    msDotHidden: true,
    hiddenNoop: true,
    mainLoop: true,
    staleWatchdog: true,
    errors,
  }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
