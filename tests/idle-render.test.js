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

  // Fractional-second precision must control both the dot and digit count.
  const precision = d.getElementById('time_decimals');
  assert.strictEqual(precision.value, '2', 'new installs default to 0.01 s precision');
  assert.strictEqual(timeEl.querySelector('.ms-digits').textContent.length, 2,
    'default precision must render two fractional digits');
  precision.value = '0';
  window.eval('updateTimeDisplay()');
  assert.strictEqual(d.getElementById('ms_display').style.display, 'none',
    'the decimal dot must be hidden when precision is zero');
  precision.value = '1';
  window.eval('updateTimeDisplay()');
  assert.notStrictEqual(d.getElementById('ms_display').style.display, 'none',
    'the decimal dot must return when precision is non-zero');
  assert.strictEqual(timeEl.querySelector('.ms-digits').textContent.length, 1,
    'one decimal place must render one digit');
  precision.value = '2';
  window.eval('updateTimeDisplay()');
  assert.strictEqual(timeEl.querySelector('.ms-digits').textContent.length, 2,
    'two decimal places must render two digits');
  precision.value = '3';
  window.eval('updateTimeDisplay()');
  assert.strictEqual(timeEl.querySelector('.ms-digits').textContent.length, 3,
    'three decimal places must render three digits');

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
