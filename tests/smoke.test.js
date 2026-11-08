const assert = require('assert');
const { boot } = require('./dom-harness');

(async () => {
  const { window, errors } = await boot();
  const d = window.document;
  const q = id => d.getElementById(id);
  const result = {
    errors,
    logs: [],
    tabs: [...d.querySelectorAll('[data-settings-tab]')].map(el => el.dataset.settingsTab),
    sections: ['clock', 'display', 'stations', 'noise'].map(name => ({
      name,
      hidden: q(`settings_section_${name}`).classList.contains('hidden'),
      children: q(`settings_section_${name}`).children.length,
    })),
    strips: ['bpm', 'wwv', 'wwvh', 'rwm'].map(station => ({
      station,
      status: q(`${station}_status`).textContent,
      slider: q(`station_${station}_volume`).id,
    })),
    hasClock: !!q('main_hm') || !!d.querySelector('.main-hm'),
    hasUt1: !!q('ut1_time'),
    hasLowFreq: !!q('low_freq_volume'),
    hasLanguage: !!q('language_row'),
    hasSprite: !!window.WWV_SPRITE,
  };
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(result.tabs, ['clock', 'display', 'stations', 'noise']);
  assert.strictEqual(result.sections.find(s => s.name === 'clock').children, 3);
  assert.strictEqual(result.sections.find(s => s.name === 'stations').children, 11);
  assert.strictEqual(result.strips.length, 4);
  assert.ok(result.strips.every(s => s.status && s.slider));
  assert.ok(result.hasClock && result.hasUt1 && result.hasLowFreq && result.hasLanguage && result.hasSprite);
  assert.strictEqual(window.getComputedStyle(q('master_icon')).display, 'none');
  assert.notStrictEqual(window.getComputedStyle(q('master_loading')).display, 'none');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
