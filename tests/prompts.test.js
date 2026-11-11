const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'time-sync.js'), 'utf8');
const bodies = [...source.matchAll(/body(Zh|En): `([\s\S]*?)`,/g)].map(match => ({
  lang: match[1],
  text: match[2],
}));

assert.strictEqual(bodies.length, 2, 'expected the combined analysis prompt only');
const [combinedZh, combinedEn] = bodies;
for (const [name, body] of [['combined zh', combinedZh], ['combined en', combinedEn]]) {
  assert.ok(!source.includes('SYNC_ONLY_PROMPTS') && !source.includes('TRACE_ONLY_PROMPTS'),
    'single-table prompt sets must be removed');
  assert.ok(body.text.includes('kind=sync|trace'), `${name} must accept the combined kind column`);
  assert.ok(body.text.includes('never invent') || body.text.includes('不编造') || body.text.includes('不要编造'),
    `${name} must forbid invented data`);
  assert.ok(body.text.includes('audioTimelineDelta'), `${name} must describe audio timeline`);
  assert.ok(body.text.includes('CALIBRATION'), `${name} must describe calibration events`);
  assert.ok(body.text.includes('backendNtpCorrectionApplied'), `${name} must gate NTP participation`);
  assert.ok(body.text.includes('backendNtpOffsetMs'), `${name} must separate backend NTP offset`);
  assert.ok(body.text.includes('6 小时') || body.text.includes('6小时') || body.text.includes('6 hours') || body.text.includes('6h'),
    `${name} must mention the simplified 6h export`);
  assert.ok(body.text.includes('【结论】') || body.text.includes('[Conclusion]'),
    `${name} must require a conclusion-first template`);
  assert.ok(body.text.includes('抽样') || body.text.includes('抽最多') || body.text.includes('等间隔抽') || body.text.includes('evenly spaced'),
    `${name} must include a row-sampling rule for long CSVs`);
  assert.ok(body.text.includes('中文字') || body.text.includes('English words'),
    `${name} must cap output length`);
  assert.ok(body.text.includes('必须带数字') || body.text.includes('must contain numbers'),
    `${name} must require numeric conclusions`);
}

assert.ok(combinedZh.text.length <= 2500, `combined zh prompt is ${combinedZh.text.length} chars, limit 2500`);
assert.ok(combinedEn.text.length <= 4500, `combined en prompt is ${combinedEn.text.length} chars, limit 4500`);
assert.ok(!source.includes('trace: trace:'), 'duplicated trace header');
assert.ok(!source.includes('图上分别画亮线') && !source.includes('bright/dim lines'), 'stale marker wording');

console.log(JSON.stringify({
  bodies: bodies.map(body => ({ lang: body.lang, chars: body.text.length })),
  limits: [
    { name: 'combined zh', chars: combinedZh.text.length, limit: 2500 },
    { name: 'combined en', chars: combinedEn.text.length, limit: 4500 },
  ],
}, null, 2));
