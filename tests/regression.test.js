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

  const bpmVolume = q('station_bpm_volume');
  const bpmBalance = q('bpm_balance');
  bpmVolume.value = '0.5';
  bpmVolume.dispatchEvent(new window.Event('input', { bubbles: true }));
  bpmBalance.value = '-55';
  bpmBalance.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('station PAN shows with volume',
    q('bpm_balance_label').textContent === 'PAN(L  50)'
      && q('station_bpm_volume').closest('.station-item').querySelector('[data-station-toggle]').textContent === '50%·L50',
    q('station_bpm_volume').closest('.station-item').querySelector('[data-station-toggle]').textContent);
  bpmBalance.value = '4';
  bpmBalance.dispatchEvent(new window.Event('input', { bubbles: true }));
  bpmBalance.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('station PAN centre detent',
    bpmBalance.value === '0'
      && q('bpm_balance_label').textContent === 'PAN(  0  )'
      && q('station_bpm_volume').closest('.station-item').querySelector('[data-station-toggle]').textContent === '50%',
    `${bpmBalance.value}/${q('bpm_balance_label').textContent}`);
  bpmBalance.value = '-6';
  bpmBalance.dispatchEvent(new window.Event('input', { bubbles: true }));
  bpmBalance.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('station PAN reaches L1',
    q('bpm_balance_label').textContent === 'PAN(L   1)',
    q('bpm_balance_label').textContent);
  bpmBalance.value = '55';
  bpmBalance.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('station PAN shows right side',
    q('bpm_balance_label').textContent === 'PAN(R  50)'
      && q('station_bpm_volume').closest('.station-item').querySelector('[data-station-toggle]').textContent === '50%·R50',
    q('station_bpm_volume').closest('.station-item').querySelector('[data-station-toggle]').textContent);
  q('settings_section_stations').querySelector('[data-station-reset="bpm"]').click();
  check('station reset clears PAN',
    bpmBalance.value === '0' && q('bpm_balance_label').textContent === 'PAN(  0  )',
    `${bpmBalance.value}/${q('bpm_balance_label').textContent}`);
  bpmVolume.value = '1';
  bpmVolume.dispatchEvent(new window.Event('input', { bubbles: true }));

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
  check('RWM correction steps', rwmPos[0].correctionStep === 0.1 && rwmPos[2].correctionStep === 0.02,
    JSON.stringify(rwmPos));
  const iersStationValues = json(window.eval('JSON.stringify(dut1StationValues(-66.0106, -74.47, "iers"))'));
  const ntscStationValues = json(window.eval('JSON.stringify(dut1StationValues(-66.0106, -74.47, "ntsc"))'));
  check('DUT1 source assignment keeps BPM on NTSC',
    iersStationValues.bpmValue === -66.0106
      && iersStationValues.otherValue === -74.47
      && iersStationValues.selectedValue === -74.47
      && ntscStationValues.bpmValue === -66.0106
      && ntscStationValues.otherValue === -66.0106
      && ntscStationValues.selectedValue === -66.0106,
    `${JSON.stringify(iersStationValues)} ${JSON.stringify(ntscStationValues)}`);
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
    clockServoPpm: 5.54, clockServoState: 'stable', clockServoAppliedMs: 0.2,
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
    server: 'ntp.test', resolved_ip: '192.0.2.1', selected: true, reachable: true,
    offset_ms: 1.5, uncertainty_ms: 2.5, rtt_ms: 20, stratum: 2,
    last_success_at: new Date().toISOString(), age_s: 12,
    reach: 255, reach_octal: '0377', offset_ok: true, quality_ok: true,
    root_delay_ms: 10, root_dispersion_ms: 2, leap: 0
  },{
    server: 'stale.test', resolved_ip: '192.0.2.2', reachable: false,
    offset_ms: 2, rtt_ms: 30, stratum: 2,
    last_success_at: new Date(Date.now() - 1200000).toISOString(), age_s: 1200,
    reach: 1, reach_octal: '001', offset_ok: true, quality_ok: true,
    root_delay_ms: 2, root_dispersion_ms: 3, leap: 0
  },{
    server: 'failed.test', resolved_ip: '192.0.2.3', reachable: false,
    offset_ms: 1, rtt_ms: 10, stratum: 2,
    last_success_at: new Date(Date.now() - 3600000).toISOString(), age_s: 3600,
    reach: 0, reach_octal: '000', offset_ok: true, quality_ok: true,
    root_delay_ms: 3, root_dispersion_ms: 4, leap: 0
  },{
    server: 'down.test', reachable: false, offset_ms: 0, rtt_ms: 0, stratum: 0,
    reach: 0, reach_octal: '000', offset_ok: false, quality_ok: false,
    root_delay_ms: 0, root_dispersion_ms: 0, leap: 3
  }]})`);
  check('NTP source chrony table', sourceTable.includes('Last sample')
    && sourceTable.includes('Rt delay/disp')
    && sourceTable.includes('+1500us')
    && sourceTable.includes('±')
    && sourceTable.includes('7000us')
    && sourceTable.includes('>10ms</td>')
    && sourceTable.includes('>2000us</td>')
    && sourceTable.includes('ntp.test/192.0.2.1')
    && sourceTable.includes('>12</td>')
    && sourceTable.includes('>377</td>')
    && sourceTable.includes('>OQ</td>')
    && !sourceTable.includes('ntp-source-legend')
    && !sourceTable.includes('>unc</th>'), sourceTable);
  check('NTP source rows stay at eleven cells',
    (sourceTable.match(/<tr class=/g) || []).length === 4
      && (sourceTable.match(/<td/g) || []).length === 44, sourceTable);
  check('NTP source integer units and octal reach',
    !/\d+\.\d+(?:ms|us|s)/.test(sourceTable) && !sourceTable.includes('0377'), sourceTable);
  check('NTP source keeps last sample while reach remains',
    sourceTable.includes('>stale.test/192.0.2.2</td>')
      && /stale\.test\/192\.0\.2\.2[\s\S]*?\+2000us[\s\S]*?±/.test(sourceTable)
      && sourceTable.includes('>20m</td>')
      && (() => {
        const staleRow = (sourceTable.match(/<tr class="ntp-source-stale"[\s\S]*?<\/tr>/) || [''])[0];
        return !staleRow.includes('>30ms</td>') && staleRow.includes('>--</td>');
      })(), sourceTable);
  check('NTP source unreachable rows use chrony defaults',
    (() => {
      const unknownRows = [...sourceTable.matchAll(/<tr class="ntp-source-unknown"[\s\S]*?<\/tr>/g)]
        .map(match => match[0]);
      return unknownRows.length === 2 && unknownRows.every(row =>
        row.includes('>?</td>')
          && row.includes('>0</td>')
          && row.includes('+0us')
          && row.includes('±')
          && row.includes('0us'));
    })(), sourceTable);
  check('NTP source reserves x for falsetickers',
    !sourceTable.includes('>x</td>') && !sourceTable.includes('ntp-source-down'), sourceTable);
  check('NTP source table has no redundant tooltips',
    !sourceTable.includes('title=')
      && sourceTable.includes('ntp-last-sample-header'), sourceTable);
  const zeroTable = window.eval(`formatNtpSourceTable({sources:[{
    server: 'zero.test', reachable: true, offset_ms: 0, rtt_ms: 0, stratum: 1,
    last_success_at: new Date().toISOString(), age_s: 5,
    reach: 255, reach_octal: '377', offset_ok: true, quality_ok: true,
    root_delay_ms: 0, root_dispersion_ms: 0, leap: 0
  }]})`);
  check('NTP source zero values keep units',
    zeroTable.includes('>0us</td>')
      && zeroTable.includes('+0us')
      && zeroTable.includes('0us'), zeroTable);
  check('NTP source supplement column order',
    (() => {
      const sample = sourceTable.indexOf('>Last sample</th>');
      const oq = sourceTable.indexOf('>OQ</th>');
      const root = sourceTable.indexOf('Rt delay/disp');
      const leap = sourceTable.indexOf('>leap</th>');
      return sample >= 0 && sample < oq && oq < root && root < leap
        && sourceTable.includes('ntp-supplement');
    })(), sourceTable);
  check('NTP leap encoding',
    window.eval('formatNtpLeap(0, true)') === 'N'
      && window.eval('formatNtpLeap(1, true)') === '+'
      && window.eval('formatNtpLeap(2, true)') === '-'
      && window.eval('formatNtpLeap(3, true)') === '?'
      && window.eval('formatNtpLeap(0, false)') === '?');
  check('audit trim formatting',
    window.eval('formatAuditTrim({clockServoState:"stable",clockServoPpm:5.54})') === '+5.54ppm'
      && window.eval('formatAuditTrim({clockServoState:"unstable"})') === 'HOLD'
      && window.eval('formatAuditTrim({clockServoState:"idle"})') === '—');
  const holdAssessment = window.eval('syncHoldAssessment(29.1,321.2,331.1,95.3)');
  const normalAssessment = window.eval('syncHoldAssessment(316.3,314.5,9.9,7.5)');
  check('sync hold catches the bad network batch',
    holdAssessment.suspicious
      && holdAssessment.reasons.includes('spread')
      && holdAssessment.reasons.includes('unc')
      && holdAssessment.reasons.includes('jump')
      && !normalAssessment.suspicious,
    JSON.stringify({ holdAssessment, normalAssessment }));
  check('held sync status is distinct from failure',
    window.eval('formatLastSyncStatus({at:new Date().toISOString(),ok:false,syncDecision:"held",uncertaintyMs:95.3,spreadMs:331.1})')
      .startsWith('SYNC HELD'));
  window.eval('openSyncAuditLog()');
  check('sync status has no redundant tooltip', !q('sync_error').hasAttribute('title'));
  window.eval('setClockWarningHeld(true); setClockWarningVisible(true);');
  check('held warning guides confirmation',
    q('clock_warning').classList.contains('clock-warning-held')
      && q('clock_warning').getAttribute('aria-label').includes('confirmation'));
  window.eval('setClockWarningHeld(false); setClockWarningVisible(false);');
  check('audit externals use uncertainty not RTT',
    (() => {
      const headers = [...q('sync_log_entries').querySelectorAll('th')].map(th => th.textContent.trim());
      return headers.includes('UNC') && !headers.includes('RTT')
        && q('sync_log_entries').querySelector('td.c-unc').textContent.includes('±2ms');
    })(),
    q('sync_log_entries').textContent.slice(0, 300));
  const auditRow = q('sync_log_entries').querySelector('tbody tr');
  if (auditRow) auditRow.click();
  check('audit row opens merged details',
    !!auditRow
      && !q('ntp_detail_panel').classList.contains('hidden')
      && q('ntp_detail_content').textContent.includes('+5.54ppm')
      && q('ntp_detail_content').textContent.toLowerCase().includes('sync'),
    q('ntp_detail_content').textContent.slice(0, 300));
  window.eval('closeNtpDetailPanel(); openNtpDetailPanel();');
  check('NTP chart re-renders after reopen', !!q('ntp_history_chart').querySelector('svg'));
  window.eval('closeNtpDetailPanel(); closeSyncAuditLog();');

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

  check('signed millisecond format hides zero sign',
    window.eval('formatSignedMs3(-0.4)') === '0.000'
      && window.eval('formatSignedMs3(0)') === '0.000'
      && window.eval('formatSignedMs3(-1.4)') === '-0.001',
    window.eval('[formatSignedMs3(-0.4), formatSignedMs3(0), formatSignedMs3(-1.4)].join(",")'));
  check('manual offset snapping rounds to displayed ms',
    window.eval('roundManualOffsetMs(-0.4)') === 0
      && window.eval('roundManualOffsetMs(-1.4)') === -1
      && window.eval('formatDut1CompactSeconds(-0.0004)') === '0.000');
  window.bpmDUT1 = -0.4;
  window.otherDUT1 = -0.4;
  window.ut1DUT1 = -0.4;
  window.eval('updateOffsetDisplay()');
  check('DUT1 zero display has no sign', q('dut1_val').textContent === '0.000', q('dut1_val').textContent);
  q('dut1_section').querySelector('[data-offset="dut1"][data-delta="1"]').click();
  check('manual +1ms snaps from displayed zero',
    window.bpmDUT1 === 1 && q('dut1_val').textContent === '+0.001',
    `${window.bpmDUT1}/${q('dut1_val').textContent}`);
  window.bpmDUT1 = -0.4;
  window.otherDUT1 = -0.4;
  window.ut1DUT1 = -0.4;
  window.eval('updateOffsetDisplay()');
  q('dut1_section').querySelector('[data-offset="dut1"][data-delta="-1"]').click();
  check('manual -1ms snaps from displayed zero',
    window.bpmDUT1 === -1 && q('dut1_val').textContent === '-0.001',
    `${window.bpmDUT1}/${q('dut1_val').textContent}`);
  window.eval('setCommonDut1(0)');
  window.eval('updateOffsetDisplay()');

  check('DUT1 high-precision display',
    window.eval('formatDut1Display(-74.47)') === '-0.07447'
      && window.eval('formatDut1Display(-74)') === '-0.074'
      && window.eval('formatDut1Display(-0.00004)') === '0.00000',
    window.eval('[formatDut1Display(-74.47), formatDut1Display(-74), formatDut1Display(-0.00004)].join(",")'));
  check('DUT1 correction visibility follows display precision',
    window.eval('ut1CanRevealCorrection(0.1, 1, true, false, -76.55)') === false
      && window.eval('ut1CanRevealCorrection(0.1, 2, true, false, -76.55)') === true
      && window.eval('ut1CanRevealCorrection(0.1, 2, true, false, -46.55)') === false
      && window.eval('ut1CanRevealCorrection(0.02, 2, true, false, -76.55)') === false
      && window.eval('ut1CanRevealCorrection(0.02, 3, true, false, -76.55)') === true
      && window.eval('ut1CanRevealCorrection(0.02, 3, true, false, -90)') === false
      && window.eval('ut1CanRevealCorrection(0.1, 3, false, false)') === false
      && window.eval('ut1CanRevealCorrection(0.1, 3, true, true, -76.55)') === true
      && window.eval('ut1CanRevealCorrection(0.1, 3, true, true, -49.5)') === false);
  check('signed-zero formatting respects displayed precision',
    window.eval('formatSignedFixed(-0.04, 1)') === '0.0'
      && window.eval('formatSignedFixed(0.04, 1)') === '0.0'
      && window.eval('formatSignedNtpMs(-0.04, 1)') === '0.0ms'
      && window.eval('formatServoStatus({clockServoState:"stable", clockServoPpm:-0.004})') === '');
  const ut1Toggle = q('ut1_detail_mode');
  ut1Toggle.checked = true;
  ut1Toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  const forceUtc = q('force_utc_mode');
  const previousForceUtc = forceUtc.checked;
  forceUtc.checked = false;
  forceUtc.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.bpmDUT1 = -74.47;
  window.eval("renderPeriodStatus({ period: 'ut1', second: 1 })");
  check('BPM DUT1 stays visible with sample-level precision',
    q('bpm_dut1').textContent === '-0.07447', q('bpm_dut1').textContent);
  forceUtc.checked = previousForceUtc;
  forceUtc.dispatchEvent(new window.Event('change', { bubbles: true }));
  ut1Toggle.checked = false;
  ut1Toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.eval('setCommonDut1(0)');
  window.eval('updateOffsetDisplay()');

  const compactData = {
    date: '2026-11-19',
    source: 'IERS Bulletin A',
    source_key: 'iers',
    updated_at: '2026-11-20T00:00:00Z',
    published_at: '2026-11-12',
    bulletin: 'Vol. XXXIX No. 046',
    current: { date: '2026-11-20', value: -0.07447, type: 'predicted' },
    alternate: {
      source: 'NTSC EOP',
      source_key: 'ntsc',
      stale: false,
      published_at: '2026-11-19',
      bulletin: 'NTSC_EOP_20261119',
      current: { date: '2026-11-19', value: -0.0660106, type: 'final' },
    },
  };
  window.eval(`setDut1CompactStatus(${JSON.stringify(compactData)}, '20261120')`);
  check('DUT1 compact status shows relative publication ages',
    q('eop_status').textContent === 'IERS@-8d|NTSC@-1d=-0.066',
    q('eop_status').textContent);
  check('DUT1 compact title keeps publication dates and bulletins',
    q('eop_status').title.includes('published 2026-11-12')
      && q('eop_status').title.includes('Vol. XXXIX No. 046')
      && q('eop_status').title.includes('published 2026-11-19')
      && q('eop_status').title.includes('NTSC_EOP_20261119'),
    q('eop_status').title);
  const autoDut1Pacing = window.eval(`(function () {
    const at = (hour, minute) => Date.UTC(2026, 10, 20, hour, minute);
    const ntscBefore = { source_key: 'ntsc', published_at: '2026-11-19', stale: false };
    const ntscLate = { source_key: 'ntsc', published_at: '2026-11-19', stale: false };
    const ntscFresh = { source_key: 'ntsc', published_at: '2026-11-20', stale: false };
    const iersFresh = { source_key: 'iers', published_at: '2026-11-19', stale: false };
    const iersStale = { source_key: 'iers', published_at: '2026-11-05', stale: false };
    dut1AutoPublicationAttempt = 0;
    const before = dut1NextPublicationDelay(ntscBefore, at(7, 35));
    dut1AutoPublicationAttempt = 0;
    const late = dut1NextPublicationDelay(ntscLate, at(8, 0));
    dut1AutoPublicationAttempt = 0;
    const fresh = dut1NextPublicationDelay(ntscFresh, at(8, 0));
    dut1AutoPublicationAttempt = 0;
    const weekly = dut1NextPublicationDelay(iersFresh, at(0, 0));
    dut1AutoPublicationAttempt = 0;
    const stale = dut1NextPublicationDelay(iersStale, at(0, 0));
    const backoff = (() => {
      // Let the helper reset its own backoff counter via fresh data.
      dut1NextPublicationDelay(ntscFresh, at(8, 0));
      return [dut1NextPublicationDelay(ntscLate, at(8, 0)),
        dut1NextPublicationDelay(ntscLate, at(8, 0))];
    })();
    return { before, late, fresh, weekly, stale, backoff };
  })()`);
  check('frontend DUT1 polling follows publication windows',
    autoDut1Pacing.before === 5 * 60 * 1000
      && autoDut1Pacing.late === 10 * 60 * 1000
      && autoDut1Pacing.fresh === 6 * 60 * 60 * 1000
      && autoDut1Pacing.weekly === 6 * 60 * 60 * 1000
      && autoDut1Pacing.stale === 10 * 60 * 1000
      && autoDut1Pacing.backoff[0] === 10 * 60 * 1000
      && autoDut1Pacing.backoff[1] === 20 * 60 * 1000,
    JSON.stringify(autoDut1Pacing));

  window.eval("setEopStatus('', 'text-gray-500')");

  // The status-bar emoji is an actual-UTC anchor: it must ignore ?offset=,
  // while the main clock and audio keep the URL shift.
  const baseEmoji = q('clock_emoji');
  check('emoji UTC tooltip', /^\d{2}:\d{2} UTC$/.test(baseEmoji.title),
    baseEmoji.title);
  const shifted = await boot({ url: 'http://localhost/time-station-simulator/?offset=-240' });
  const shiftedDoc = shifted.window.document;
  const shiftedEmoji = shiftedDoc.getElementById('clock_emoji');
  const expectedActual = shifted.window.eval('clockEmojiFor(new Date())');
  const expectedShifted = shifted.window.eval('clockEmojiFor(new Date(Date.now() - 240 * 60000))');
  check('emoji ignores ?offset=', shiftedEmoji.textContent === expectedActual && expectedActual !== expectedShifted,
    `${shiftedEmoji.textContent} vs actual ${expectedActual}, shifted ${expectedShifted}`);
  const offsetBadge = shiftedDoc.getElementById('global_offset_indicator');
  check('offset marker still applied', offsetBadge.textContent === '-4h' && !offsetBadge.classList.contains('hidden'),
    offsetBadge.textContent);
  check('shifted page has no errors', shifted.errors.length === 0, shifted.errors.join('; '));

  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({ checks: checks.length, errors }, null, 2));
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
