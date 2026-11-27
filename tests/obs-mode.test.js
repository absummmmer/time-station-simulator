const assert = require('assert');
const { boot } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot({
    url: 'http://localhost/time-station-simulator/?obs=1&scale=1.5',
  });
  const d = window.document;
  const q = id => d.getElementById(id);
  assert.deepStrictEqual(errors, []);
  assert.ok(d.documentElement.classList.contains('obs-mode'), 'OBS class must be applied');
  assert.ok(!d.documentElement.classList.contains('obs-interactive'), 'OBS is non-interactive by default');
  assert.strictEqual(d.documentElement.style.getPropertyValue('--obs-scale'), '1.5');
  assert.ok(!q('obs_audio_overlay').classList.contains('hidden'), 'audio overlay must be visible');
  assert.strictEqual(q('master_volume').value, '1');
  assert.strictEqual(q('master_volume').disabled, true, 'master slider must be locked');
  const obsUrl = window.eval('buildSettingsShareUrl({ obs: true })');
  assert.ok(obsUrl.includes('obs=1'));
  assert.ok(obsUrl.includes('scale=1'));
  assert.ok(obsUrl.indexOf('cfg=') < obsUrl.indexOf('obs=1'), 'OBS knobs must follow cfg');
  assert.ok(obsUrl.indexOf('obs=1') < obsUrl.indexOf('scale=1'), 'scale must follow obs');
  assert.ok(!obsUrl.includes('interactive=1'));
  const hideUrl = window.eval('buildSettingsShareUrl({ obs: true, hideStations: true })');
  assert.ok(hideUrl.includes('hide=stations'), 'hide parameter must be available');
  assert.ok(hideUrl.indexOf('scale=1') < hideUrl.indexOf('hide=stations'), 'hide must be the last OBS knob');
  window.eval('openSettingsSharePanel()');
  const css = q('settings_share_css').value;
  assert.ok(css.includes('#time_display'), 'CSS template must expose clock colour selector');
  for (const variable of [
    '--obs-clock-color', '--obs-decimal-color', '--obs-timezone-color',
    '--obs-station-name-color', '--obs-station-status-color', '--obs-station-ratio-color',
    '--obs-warning-color', '--obs-offset-color', '--obs-ut1-color',
  ]) {
    assert.ok(css.includes(variable), `CSS template must expose ${variable}`);
  }
  assert.ok(css.includes('#bpm_dut1') && css.includes('.status-dut1-value'),
    'UT1 colour must also cover station DUT1 values');
  assert.ok(!/font-size\s*:/i.test(css), 'CSS template must not expose font-size');
  assert.ok(q('settings_share_hide_stations'), 'share window must expose the hide-stations option');
  window.eval('closeSettingsSharePanel();');

  const interactive = await boot({
    url: 'http://localhost/time-station-simulator/?obs=1&interactive=1&hide=stations',
  });
  assert.deepStrictEqual(interactive.errors, []);
  assert.ok(interactive.window.document.documentElement.classList.contains('obs-interactive'));
  assert.ok(interactive.window.document.documentElement.classList.contains('hide-stations'));
  assert.strictEqual(
    interactive.window.document.documentElement.style.getPropertyValue('--obs-scale'),
    '1',
  );
  interactive.window.close();
  window.close();
  console.log(JSON.stringify({
    errors,
    obs: true,
    interactive: true,
    scale: 1.5,
    overlayVisible: true,
    masterLocked: true,
    cssColorsOnly: true,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
