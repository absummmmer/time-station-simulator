const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'time-sync.js'), 'utf8');
const bodies = [...source.matchAll(/body(Zh|En): `([\s\S]*?)`,/g)].map(match => ({
  lang: match[1],
  text: match[2],
}));

assert.strictEqual(bodies.length, 6, 'expected six prompt bodies');
const [combinedZh, combinedEn, syncZh, syncEn, traceZh, traceEn] = bodies;
const limits = [
  ['combined zh', combinedZh, 2500],
  ['combined en', combinedEn, 4500],
  ['sync zh', syncZh, 1500],
  ['sync en', syncEn, 2500],
  ['trace zh', traceZh, 2500],
  ['trace en', traceEn, 4000],
];
for (const [name, body, limit] of limits) {
  assert.ok(body.text.length <= limit, `${name} prompt is ${body.text.length} chars, limit ${limit}`);
  assert.ok(body.text.includes('never invent') || body.text.includes('不编造') || body.text.includes('不要编造'), `${name} must forbid invented data`);
}

for (const body of [combinedZh, combinedEn, traceZh, traceEn]) {
  assert.ok(body.text.includes('audioTimelineDelta'), `${body.lang} prompt must describe audio timeline`);
  assert.ok(body.text.includes('CALIBRATION'), `${body.lang} prompt must describe calibration events`);
}
for (const body of [combinedZh, combinedEn]) {
  assert.ok(body.text.includes('kind=sync') || body.text.includes('kind=sync|trace'), `${body.lang} combined prompt must accept kind column`);
}
for (const body of bodies) {
  assert.ok(body.text.includes('6 小时') || body.text.includes('6小时') || body.text.includes('6 hours') || body.text.includes('6h'), `${body.lang} prompt must mention simplified window`);
}
for (const body of [combinedZh, combinedEn, syncZh, syncEn]) {
  assert.ok(body.text.includes('backendNtpCorrectionApplied'), `${body.lang} prompt must gate NTP participation`);
  assert.ok(body.text.includes('backendNtpOffsetMs'), `${body.lang} prompt must separate backend NTP offset`);
}
for (const body of [traceZh, traceEn]) {
  assert.ok(body.text.includes('audioSkewPpm'), `${body.lang} trace prompt must describe audio skew`);
  assert.ok(body.text.includes('calibrationSteps'), `${body.lang} trace prompt must list calibration fields`);
}
for (const body of [combinedZh, combinedEn, traceZh, traceEn]) {
  assert.ok(body.text.includes('audioTimelineDelta'), `${body.lang} chart rules must include audio timeline`);
}

assert.ok(!source.includes('trace: trace:'), 'duplicated trace header');
assert.ok(!source.includes('图上分别画亮线') && !source.includes('bright/dim lines'), 'stale marker wording');

console.log(JSON.stringify({
  bodies: bodies.map(body => ({ lang: body.lang, chars: body.text.length })),
  limits: limits.map(([name, body, limit]) => ({ name, chars: body.text.length, limit })),
}, null, 2));
