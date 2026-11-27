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
  assert.ok(window.eval('buildSettingsShareUrl({ obs: true })').includes('obs=1'));
  assert.ok(!window.eval('buildSettingsShareUrl({ obs: true })').includes('interactive=1'));
  window.eval('openSettingsSharePanel()');
  const css = q('settings_share_css').value;
  assert.ok(css.includes('#time_display'), 'CSS template must expose clock colour selector');
  assert.ok(!/font-size\s*:/i.test(css), 'CSS template must not expose font-size');
  window.eval('closeSettingsSharePanel();');

  const interactive = await boot({
    url: 'http://localhost/time-station-simulator/?obs=1&interactive=1',
  });
  assert.deepStrictEqual(interactive.errors, []);
  assert.ok(interactive.window.document.documentElement.classList.contains('obs-interactive'));
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
