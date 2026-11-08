const assert = require('assert');
const { boot, wait } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const master = d.getElementById('master_volume');
  master.value = '0.5';
  master.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(500);

  window.fetch = async () => {
    const now = Date.now();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        server_received_unix_us: now * 1000,
        server_sent_unix_us: now * 1000,
        server_received_ms: now,
        server_sent_ms: now,
        clock_correction_applied: false,
        clock_correction_mode: 'first',
        clock_correction_source: 'test.invalid',
        clock_correction_reason: 'fallback_source',
        clock_health: {
          reachable: true, synchronized: false, holdover: false, fallback: true,
          offset_ok: false, quality_ok: true, offset_ms: 0, uncertainty_ms: 10,
          rtt_ms: 10, stratum: 2, leap: 0, age_s: 30, server: 'test.invalid',
          sources: [], servers: ['test.invalid'], resolved_ip: '192.0.2.1',
        },
        date: new Date(now).toISOString().slice(0, 10),
        time: new Date(now).toISOString().slice(11, 26),
      }),
    };
  };

  window.eval('setTimeApiBase("https://sync.test")');
  await window.eval('autoSyncTime()');
  await wait(300);
  const trace = window.bpmClockTrace.entries;
  const last = trace[trace.length - 1];
  const sync = window.bpmSyncAudit.entries[window.bpmSyncAudit.entries.length - 1];
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(sync.ok, true);
  assert.strictEqual(last.reason, 'SYNC_OK');
  assert.strictEqual(last.reanchorReason, 'sync');
  assert.ok(Number.isFinite(last.audioTimelineDeltaMs));
  console.log(JSON.stringify({ syncOk: sync.ok, traceReason: last.reason, reanchor: last.reanchorReason, audioDelta: last.audioTimelineDeltaMs, errors }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
