const assert = require('assert');
const { boot, wait } = require('./dom-harness');

function json(value) {
  return JSON.parse(value);
}

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const q = id => d.getElementById(id);
  const checks = [];
  const check = (name, condition, detail = '') => {
    if (!condition) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
    checks.push(name);
  };

  check('loading shown initially', !q('master_loading').classList.contains('hidden') && q('master_icon').classList.contains('hidden'));
  const staticHintTargets = [
    q('bpm_utc_lock'),
    q('clock_warning'),
    ...d.querySelectorAll('.rwm-lock-option'),
    ...d.querySelectorAll('.trace-chart'),
  ];
  check('no static hint tooltips', staticHintTargets.every(el => el && !el.hasAttribute('title')));
  check('zero rows marked', [...d.querySelectorAll('.station-item')].filter(x => x.classList.contains('station-zero')).length === 3);

  const master = q('master_volume');
  master.value = '0.5';
  master.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(700);
  check('audio startup clears loading', q('master_loading').classList.contains('hidden') && !q('master_icon').classList.contains('hidden'));

  const toggles = [...d.querySelectorAll('[data-station-toggle]')];
  toggles[0].click();
  check('station panels expand all', [...d.querySelectorAll('.station-item')].every(x => x.classList.contains('expanded')));
  toggles[2].click();
  check('station panels collapse all', [...d.querySelectorAll('.station-item')].every(x => !x.classList.contains('expanded')));

  const ut1 = q('ut1_detail_mode');
  ut1.checked = true;
  ut1.dispatchEvent(new window.Event('change', { bubbles: true }));
  const force = q('force_utc_mode');
  force.checked = true;
  force.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.eval('updateTimeDisplay()');
  check('UTC lock status', q('bpm_status').textContent.includes('UTC') && q('bpm_status').firstElementChild.id === 'bpm_utc_lock' && !q('bpm_utc_lock').classList.contains('hidden'), q('bpm_status').textContent);
  check('UT1 clock independent of lock', q('ut1_time').textContent.length > 0);
  check('DUT1 controls not hidden by lock', q('dut1_section').style.display !== 'none');
  const low = q('low_freq_volume');
  low.value = '50';
  low.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.eval('updateTimeDisplay()');
  check('UTC lock BCD label', q('bpm_status').textContent.includes('BCD'), q('bpm_status').textContent);

  const rwmPos = json(window.eval('JSON.stringify([9,10,21,22].map(s => rwmDut1PulseStatus(s, -160)))'));
  check('RWM cumulative DUT1', rwmPos[0].value === '\u22120.1' && rwmPos[1].value === '\u22120.2'
    && rwmPos[2].value === '\u22120.18' && rwmPos[3].value === '\u22120.16', JSON.stringify(rwmPos));
  const wwvPulse = [1, 2, 3, 4].map(s => window.eval(`wwvDut1PulseStatus(${s}, 300)`));
  check('WWV DUT1 status cumulative', wwvPulse[0] === '+0.1' && wwvPulse[2] === '+0.3' && wwvPulse[3] === '', JSON.stringify(wwvPulse));
  window.eval('renderWWVStationStatuses(new Date(Date.UTC(2026,10,6,12,29,2)))');
  check('WWVH ident uses StationID',
    q('wwvh_status').textContent.includes('StationID')
      && !q('wwvh_status').textContent.includes('StationIntroduction'),
    q('wwvh_status').textContent);
  const code = window.eval('getWWVDigitalCode(new Date(Date.UTC(2026,10,6,12,1,0)), 300)');
  check('WWV BCD DUT1 bits', code[49] === 'one' && code[55] === 'one' && code[56] === 'one' && code[57] === 'zero');

  const base = Date.UTC(2026, 10, 6, 12, 20, 0);
  const evMinute20 = window.eval(`buildRWMEvents(${base}, ${base + 60000})`);
  const second0 = evMinute20.filter(e => e.utcMs >= base && e.utcMs < base + 1000).map(e => e.utcMs - base);
  check('RWM 520ms minute pulse', JSON.stringify(second0) === JSON.stringify([0, 500, 600, 700, 800, 900]), JSON.stringify(second0));
  const base29 = Date.UTC(2026, 10, 6, 12, 29, 0);
  const evMinute29 = window.eval(`buildRWMEvents(${base29}, ${base29 + 60000})`);
  check('RWM tail mute', evMinute29.every(e => e.utcMs < base29 + 55000));

  const audit = {
    at: new Date().toISOString(),
    ok: true, uncertaintyMs: 2, spreadMs: 1, samples: 5, kept: 5, rttMs: 30,
    durationMs: 1200, serverTime: new Date().toISOString(),
    backendNtpSynchronized: true, backendNtpReachable: true, backendNtpHoldover: false,
    backendNtpFallback: false, backendNtpOffsetMs: 1.2, backendNtpUncertaintyMs: 2,
    backendNtpRttMs: 30, backendNtpStratum: 2, backendNtpAgeS: 10,
    backendNtpSource: 'ntp.test', backendNtpCorrectionApplied: true, backendNtpCorrectionMs: 0.4,
    backendNtpLastSuccessAt: new Date(Date.now() - 3600000).toISOString(),
  };
  window.eval(`recordSyncAudit(${JSON.stringify(audit)})`);
  check('NTP inline shown when correction applied', q('sync_error').textContent.includes('NTP_OK'), q('sync_error').textContent);
  const nonAppliedText = window.eval(`formatLastSyncStatus(${JSON.stringify({
    ...audit,
    backendNtpSource: 'ntp.fallback',
    backendNtpFallback: true,
    backendNtpCorrectionApplied: false,
    backendNtpCorrectionMs: 0,
  })})`);
  check('NTP inline hidden when correction not applied', !String(nonAppliedText).includes('NTP_') && String(nonAppliedText).includes('±'), nonAppliedText);
  window.eval('openNtpDetailPanel()');
  check('NTP chart renders', !!q('ntp_history_chart').querySelector('svg'));
  const sourceTable = window.eval(`formatNtpSourceTable({sources:[{
    server: 'ntp.test', reachable: true, offset_ms: 1.5, uncertainty_ms: 2.5,
    rtt_ms: 20, stratum: 2, last_success_at: new Date().toISOString(), age_s: 10,
    reach: 255, offset_ok: true, quality_ok: true, root_delay_ms: 10,
    root_dispersion_ms: 2, leap: 0
  }]})`);
  check('NTP source units', sourceTable.includes('±2.5ms')
    && sourceTable.includes('±ms') && sourceTable.includes('10.0/2.0ms'), sourceTable);

  const correctionFields = json(window.eval(`JSON.stringify(backendCorrectionAuditFields({
    clockCorrectionApplied: false,
    clockCorrectionEligible: false,
    clockCorrectionMode: 'first',
    clockCorrectionSource: 'first.example',
    clockCorrectionReason: 'fallback_source',
    clockSource: 'host'
  }))`));
  check('NTP correction audit fields', correctionFields.backendNtpCorrectionMode === 'first'
    && correctionFields.backendNtpCorrectionSource === 'first.example'
    && correctionFields.backendNtpCorrectionReason === 'fallback_source'
    && correctionFields.backendNtpCorrectionEligible === false
    && correctionFields.backendNtpClockSource === 'host', JSON.stringify(correctionFields));

  const beat = q('rwm_beat_hz');
  const beatMid = window.eval('rwmSliderToBeatHz(0.5)');
  check('RWM BF 10 Hz step', beatMid % 10 === 0 && beatMid >= 100 && beatMid <= 4000, String(beatMid));
  window.eval('recordClockTrace("AUDIO_DIAG_TEST")');
  const traceEntries = window.bpmClockTrace.entries;
  const diagEntry = traceEntries[traceEntries.length - 1];
  check('audio timeline diagnostics', Number.isFinite(diagEntry.audioTimelineDeltaMs)
    && Number.isFinite(diagEntry.audioClockSec) && typeof diagEntry.reanchorReason === 'string', JSON.stringify(diagEntry));
  check('audio rate diagnostics', Number.isFinite(diagEntry.audioSkewPpm)
    && Number.isFinite(diagEntry.audioTimeScale), JSON.stringify(diagEntry));
  check('audio diagnostics bound to device', diagEntry.deviceProfile === 'default'
    && diagEntry.audioContextSession >= 1
    && diagEntry.audioSampleRate === 48000, JSON.stringify(diagEntry));
  beat.value = '0';
  beat.dispatchEvent(new window.Event('input', { bubbles: true }));
  beat.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('RWM beat low frequency', q('rwm_beat_label').textContent === 'BF( 100Hz)', q('rwm_beat_label').textContent);
  beat.value = '1';
  beat.dispatchEvent(new window.Event('input', { bubbles: true }));
  beat.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('RWM beat default frequency', q('rwm_beat_label').textContent === 'BF(4000Hz)', q('rwm_beat_label').textContent);

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({ checks: checks.length, errors }, null, 2));
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
