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

  // Display controls: timezone offset first, then fractional seconds, then UT1,
  // separated by a divider between the timezone group and the other controls.
  assert.ok(d.getElementById('display_separator'), 'display controls need a separator');
  const displayOrder = [...d.querySelectorAll('#settings_section_display input, #settings_section_display select')]
    .map(el => el.id);
  assert.ok(displayOrder.indexOf('local_time_mode') < displayOrder.indexOf('time_decimals'),
    'local time must come before fractional precision');
  assert.ok(displayOrder.indexOf('time_decimals') < displayOrder.indexOf('ut1_detail_mode'),
    'fractional precision must come before UT1 display');

  // The pin label prefers the IANA zone name; the clock annotation still shows
  // the complete two-line ±HH:MM offset, including the :00 minute line.
  const localHint = d.getElementById('local_time_hint');
  let zoneName = '';
  try {
    zoneName = new window.Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    zoneName = '';
  }
  if (zoneName) {
    assert.strictEqual(localHint.textContent, zoneName, 'pin label must show the IANA zone name');
  } else {
    assert.match(localHint.textContent, /^[+-]\d{2}:\d{2}$/, 'pin label falls back to the numeric offset');
  }
  // The label must follow a live timezone change, not keep a cached first value.
  const originalDateTimeFormat = window.Intl.DateTimeFormat;
  let fakeZone = 'Asia/Shanghai';
  window.Intl.DateTimeFormat = function FakeDateTimeFormat() {
    return { resolvedOptions: () => ({ timeZone: fakeZone }) };
  };
  try {
    window.eval('updateLocalTimeHint()');
    assert.strictEqual(localHint.textContent, 'Asia/Shanghai', 'pin label must react to timezone selection');
    fakeZone = 'Europe/Berlin';
    window.eval('updateLocalTimeHint()');
    assert.strictEqual(localHint.textContent, 'Europe/Berlin', 'pin label must follow a timezone change');
  } finally {
    window.Intl.DateTimeFormat = originalDateTimeFormat;
    window.eval('updateLocalTimeHint()');
  }
  const localToggle = d.getElementById('local_time_mode');
  localToggle.checked = true;
  localToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.eval('updateTimeDisplay()');
  const timezoneOffset = d.getElementById('timezone_offset');
  assert.notStrictEqual(timezoneOffset.style.display, 'none', 'local time must show the zone annotation');
  assert.ok(timezoneOffset.innerHTML.includes('<br>'), 'zone annotation must use two lines');
  assert.match(timezoneOffset.textContent, /^[+-]\d{2}:\d{2}$/, 'zone annotation must include hours and minutes');

  // Fractional-second precision must control both the dot and digit count.
  const precision = d.getElementById('time_decimals');
  assert.deepStrictEqual([...precision.options].map(option => option.textContent.trim()),
    ['×1000', '×100', '×10', '×1'], 'precision options must show the display step in milliseconds');
  assert.strictEqual(precision.value, '2', 'new installs default to 10 ms precision');
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

  // The status-bar UT1 clock follows the same fractional precision.
  const ut1Toggle = d.getElementById('ut1_detail_mode');
  ut1Toggle.checked = true;
  ut1Toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  const ut1Fraction = () => {
    const el = d.querySelector('#ut1_time .ut1-ms');
    return el && el.style.display !== 'none' ? el.textContent.replace('.', '').length : 0;
  };
  precision.value = '2';
  window.eval('updateTimeDisplay()');
  assert.strictEqual(ut1Fraction(), 2, 'UT1 time must use two fractional digits');
  const ut1SecNode = d.querySelector('#ut1_time .ut1-sec');
  const ut1MsNode = d.querySelector('#ut1_time .ut1-ms');
  window.eval('updateTimeDisplay()');
  assert.strictEqual(d.querySelector('#ut1_time .ut1-sec'), ut1SecNode,
    'UT1 seconds must update in place');
  assert.strictEqual(d.querySelector('#ut1_time .ut1-ms'), ut1MsNode,
    'UT1 milliseconds must update in place');
  window.eval("renderUt1Time(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 987)), 1)");
  assert.strictEqual(ut1MsNode.textContent, '.9', 'one-decimal UT1 must update to .9');
  window.eval("renderUt1Time(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 123)), 1)");
  assert.strictEqual(ut1MsNode.textContent, '.1', 'one-decimal UT1 must update to .1');
  assert.strictEqual(d.querySelector('#ut1_time .ut1-ms'), ut1MsNode,
    'low-precision UT1 updates must reuse the same node');
  window.eval("renderUt1Time(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 987)), 3)");
  assert.strictEqual(ut1MsNode.textContent, '.987', 'three-decimal UT1 must update to .987');
  d.querySelector('#ut1_time .ut1-sec').click();
  assert.ok(!d.getElementById('settings_panel').classList.contains('hidden'),
    'clicking the UT1 seconds must open display settings');
  d.getElementById('settings_close').click();
  precision.value = '0';
  window.eval('updateTimeDisplay()');
  assert.strictEqual(ut1Fraction(), 0, 'UT1 time must hide its decimal point at zero precision');
  precision.value = '3';
  window.eval('updateTimeDisplay()');
  assert.strictEqual(ut1Fraction(), 3, 'UT1 time must use three fractional digits');

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
