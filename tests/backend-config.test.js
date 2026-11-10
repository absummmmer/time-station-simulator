const assert = require('assert');
const { boot, wait } = require('./dom-harness');

function syncFetch() {
  return async () => {
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
}

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const q = id => d.getElementById(id);
  const check = (name, condition, detail = '') => {
    if (!condition) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  };

  check('fresh page has no backend', window.eval('isTimeApiConfigured()') === false);
  check('setup hidden initially', q('backend_config_panel').classList.contains('hidden'));
  check('fresh settings include backend marker',
    JSON.parse(window.localStorage.getItem('bpm_simulator_settings')).backendConfigVersion === 1);

  const normalized = JSON.parse(window.eval(`JSON.stringify([
    normalizeTimeApiBase('https://time-api.example'),
    normalizeTimeApiBase('https://time-api.example/'),
    normalizeTimeApiBase('https://time-api.example/v1/time?timezone=UTC'),
    normalizeTimeApiBase('https://time-api.example/v1/dut1'),
    normalizeTimeApiBase('https://time-api.example/api/v1/time/ntp'),
    normalizeTimeApiBase('time-api.example'),
    normalizeTimeApiBase('ftp://time-api.example'),
    normalizeTimeApiBase('https://time-api.example?source=x')
  ])`));
  check('normalizes base URL', normalized[0].ok && normalized[0].base === 'https://time-api.example');
  check('normalizes trailing slash', normalized[1].ok && normalized[1].base === 'https://time-api.example');
  check('accepts pasted time endpoint', normalized[2].ok && normalized[2].base === 'https://time-api.example');
  check('accepts pasted dut1 endpoint', normalized[3].ok && normalized[3].base === 'https://time-api.example');
  check('preserves path prefix', normalized[4].ok && normalized[4].base === 'https://time-api.example/api');
  check('rejects missing scheme', !normalized[5].ok && normalized[5].code === 'scheme');
  check('rejects non-http scheme', !normalized[6].ok && normalized[6].code === 'scheme');
  check('rejects query strings', !normalized[7].ok && normalized[7].code === 'query');

  const auto = q('auto_sync_mode');
  auto.checked = true;
  auto.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('first AUTO opens backend setup', !q('backend_config_panel').classList.contains('hidden'));
  check('AUTO remains off until configured', !auto.checked);
  check('AUTO prompt mentions AUTO', q('backend_config_note').textContent.includes('AUTO'));
  const docsLink = q('backend_config_docs') && q('backend_config_docs').querySelector('a');
  check('backend setup links to deployment docs', !!(docsLink
    && docsLink.getAttribute('href') === 'https://github.com/absummmmer/time-station-simulator/blob/main/DEPLOY.md'
    && docsLink.getAttribute('target') === '_blank'
    && docsLink.getAttribute('rel').includes('noopener')));

  q('backend_config_url').value = 'not a url';
  q('backend_config_form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  check('invalid URL shows error', !q('backend_config_error').classList.contains('hidden'));
  check('invalid URL keeps setup open', !q('backend_config_panel').classList.contains('hidden'));

  window.fetch = syncFetch();
  q('backend_config_url').value = 'https://time-api.example/v1/time?timezone=UTC';
  q('backend_config_form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  check('save closes setup', q('backend_config_panel').classList.contains('hidden'));
  check('save persists normalized URL',
    window.localStorage.getItem('time_station_time_api_base_v1') === 'https://time-api.example');
  check('save re-enables AUTO', auto.checked);
  await wait(1200);
  check('configured backend syncs', (window.bpmSyncAudit.entries || []).some(entry => entry.ok));

  const second = await boot();
  const d2 = second.window.document;
  const q2 = id => d2.getElementById(id);
  q2('sync_btn').click();
  check('manual SYNC opens setup', !q2('backend_config_panel').classList.contains('hidden'));
  check('SYNC prompt mentions SYNC', q2('backend_config_note').textContent.includes('SYNC'));
  q2('backend_config_cancel').click();
  check('cancel closes setup', q2('backend_config_panel').classList.contains('hidden'));
  check('cancel keeps backend unconfigured', second.window.eval('isTimeApiConfigured()') === false);

  q2('auto_dut1_mode').checked = true;
  q2('auto_dut1_mode').dispatchEvent(new second.window.Event('change', { bubbles: true }));
  check('DUT1 AUTO opens setup', !q2('backend_config_panel').classList.contains('hidden'));
  check('DUT1 prompt mentions DUT1', q2('backend_config_note').textContent.includes('DUT1'));
  q2('backend_config_cancel').click();
  check('DUT1 cancel leaves AUTO off', !q2('auto_dut1_mode').checked);

  q2('sync_log_btn').click();
  q2('backend_config_btn').click();
  check('audit panel can reopen setup', !q2('backend_config_panel').classList.contains('hidden'));
  q2('backend_config_close').click();
  check('audit setup closes', q2('backend_config_panel').classList.contains('hidden'));

  const legacySettings = {
    balanceVersion: 3,
    autoSyncMode: false,
    dut1AutoMode: false,
  };
  const third = await boot({
    localStorage: { bpm_simulator_settings: JSON.stringify(legacySettings) },
  });
  const d3 = third.window.document;
  const q3 = id => d3.getElementById(id);
  check('legacy install gets migration prompt',
    !q3('backend_config_panel').classList.contains('hidden'));
  check('migration prompt is shown', q3('backend_config_note').textContent.includes('old built-in'));
  check('migration does not prefill any backend', q3('backend_config_url').value === '');
  q3('backend_config_url').value = 'https://time-api.example';
  q3('backend_config_form').dispatchEvent(new third.window.Event('submit', { bubbles: true, cancelable: true }));
  check('migration saves backend',
    third.window.localStorage.getItem('time_station_time_api_base_v1') === 'https://time-api.example');
  check('migration setup closes', q3('backend_config_panel').classList.contains('hidden'));

  const fourth = await boot({
    localStorage: {
      bpm_simulator_settings: JSON.stringify({
        balanceVersion: 3,
        autoSyncMode: true,
        dut1AutoMode: false,
      }),
    },
  });
  const q4 = id => fourth.window.document.getElementById(id);
  check('legacy AUTO install gets prompt', !q4('backend_config_panel').classList.contains('hidden'));
  q4('backend_config_cancel').click();
  check('dismissing startup setup turns AUTO off',
    !q4('auto_sync_mode').checked);
  const afterCancelSettings = fourth.window.localStorage.getItem('bpm_simulator_settings');
  const fifth = await boot({
    localStorage: { bpm_simulator_settings: afterCancelSettings },
  });
  check('dismissed migration prompt is one-time',
    fifth.window.document.getElementById('backend_config_panel').classList.contains('hidden'));

  const sixth = await boot({
    fetch: syncFetch(),
    localStorage: {
      bpm_simulator_settings: JSON.stringify({
        balanceVersion: 3,
        autoSyncMode: true,
        dut1AutoMode: false,
      }),
    },
  });
  const q6 = id => sixth.window.document.getElementById(id);
  check('legacy AUTO install gets prompt to migrate', !q6('backend_config_panel').classList.contains('hidden'));
  q6('backend_config_url').value = 'https://time-api.example';
  q6('backend_config_form').dispatchEvent(new sixth.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);
  check('legacy AUTO resumes after migration',
    q6('auto_sync_mode').checked && (sixth.window.bpmSyncAudit.entries || []).some(entry => entry.ok));

  check('no page errors', errors.length === 0 && second.errors.length === 0 &&
    third.errors.length === 0 && fourth.errors.length === 0 &&
    fifth.errors.length === 0 && sixth.errors.length === 0,
    JSON.stringify([...errors, ...second.errors, ...third.errors, ...fourth.errors, ...fifth.errors, ...sixth.errors]));

  console.log(JSON.stringify({
    normalized: normalized.map(item => item.ok ? item.base : item.code),
    configured: second.window.eval('isTimeApiConfigured()'),
    migrated: third.window.eval('getTimeApiBase()'),
    syncs: window.bpmSyncAudit.entries.length,
    errors: [...errors, ...second.errors, ...third.errors],
  }, null, 2));
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
