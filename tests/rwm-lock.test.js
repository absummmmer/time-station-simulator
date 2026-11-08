const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const radios = [...d.querySelectorAll('input[name="rwm_lock_mode"]')];
  const selected = () => radios.filter(input => input.checked).map(input => input.value);
  assert.deepStrictEqual(selected(), ['off']);
  assert.strictEqual(d.querySelector('input[name="rwm_lock_mode"][value="off"]').closest('label').textContent.trim(), 'NORMAL');
  assert.ok(d.getElementById('rwm_pulse10_label').textContent.startsWith('10Hz_ds('));

  const eventCount = (fromUtc, toUtc) => window.eval(
    `buildNextAudioEvents(${fromUtc},${toUtc},{dut1:0}).filter(event => event.station === 'rwm').length`
  );

  const base = Date.UTC(2026, 0, 1, 0, 8, 0); // normally RWM is off this minute
  assert.strictEqual(eventCount(base, base + 3000), 0);

  d.querySelector('input[name="rwm_lock_mode"][value="pulse1"]').click();
  await wait(20);
  assert.deepStrictEqual(selected(), ['pulse1']);
  assert.ok(d.getElementById('rwm_status').innerHTML.startsWith('<span class="status-lock"'));
  assert.strictEqual(window.eval('buildNextAudioEvents' + `(${base},${base + 3000},{dut1:0}).filter(event => event.station === 'rwm').length`), 3);
  assert.strictEqual(JSON.parse(window.localStorage.getItem('bpm_simulator_settings')).rwmLockMode, 'pulse1');
  window.otherDUT1 = 100;
  const dut1Pulses = window.eval(
    `buildNextAudioEvents(${base + 1000},${base + 1300},{dut1:100}).filter(event => event.station === 'rwm').map(event => event.utcMs - ${base})`
  );
  assert.deepStrictEqual(Array.from(dut1Pulses), [1000, 1200]);
  window.otherDUT1 = 0;

  d.querySelector('input[name="rwm_lock_mode"][value="pulse10"]').click();
  await wait(20);
  assert.deepStrictEqual(selected(), ['pulse10']);
  const pulse10Status = d.getElementById('rwm_status').innerHTML;
  assert.ok(pulse10Status.startsWith('<span class="status-lock"') && pulse10Status.includes('10Hz'), pulse10Status);
  assert.strictEqual(window.eval('buildNextAudioEvents' + `(${base},${base + 3000},{dut1:0}).filter(event => event.station === 'rwm').length`), 26);

  d.querySelector('input[name="rwm_lock_mode"][value="off"]').click();
  await wait(20);
  assert.deepStrictEqual(selected(), ['off']);
  assert.ok(!d.getElementById('rwm_status').innerHTML.includes('status-lock'));
  assert.strictEqual(eventCount(base, base + 3000), 0);

  d.getElementById('force_utc_mode').click();
  await wait(20);
  const bpmStatus = d.getElementById('bpm_status');
  assert.strictEqual(bpmStatus.firstElementChild.id, 'bpm_utc_lock');
  assert.ok(!bpmStatus.firstElementChild.classList.contains('hidden'));

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({ lockModes: ['off', 'pulse1', 'pulse10'], events: { off: 0, p1: 3, p10: 26 }, bpmLockFirst: true, errors }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
