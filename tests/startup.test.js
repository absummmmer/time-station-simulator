const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const q = id => d.getElementById(id);
  assert.ok(q('master_loading') && !q('master_loading').classList.contains('hidden'));
  assert.ok(q('master_icon').classList.contains('hidden'));
  const master = q('master_volume');
  master.value = '0.5';
  master.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(700);
  const trace = (window.bpmClockTrace && window.bpmClockTrace.entries) || [];
  const result = {
    errors,
    running: trace.some(entry => entry.reason === 'AUDIO_START'),
    master: master.value,
    loadingHidden: q('master_loading').classList.contains('hidden'),
    iconHidden: q('master_icon').classList.contains('hidden'),
    bpm: q('bpm_status').textContent,
    wwv: q('wwv_status').textContent,
  };
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(result.running, true);
  assert.strictEqual(result.master, '0.5');
  assert.strictEqual(result.loadingHidden, true);
  assert.strictEqual(result.iconHidden, false);
  assert.ok(result.bpm && result.wwv);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
