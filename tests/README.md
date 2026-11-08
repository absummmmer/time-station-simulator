# Tests

The suite reads the deployable `index.html`, `core.js`, `audio-engine.js`,
`time-sync.js`, `observability.js` and `app.js` directly; it does not keep a
copied application bundle.

```bash
cd time-station-simulator/tests
npm install
npm test
```

`jsdom` is only a development dependency.

| File | Purpose |
| --- | --- |
| `dom-harness.js` | builds the page, loads all classic scripts in order, provides a fake AudioContext |
| `startup.test.js` | loading spinner, first audio start, settings wiring |
| `backend-config.test.js` | backend URL normalization, first-AUTO/SYNC/DUT1 prompt, audit-panel entry and migration path |
| `smoke.test.js` | settings sections, station strips, sprite/assets |
| `regression.test.js` | UTC lock, UT1 clock, DUT1 split rules, WWV/RWM encodings, RWM timing, NTP chart, beat frequency, audio timeline diagnostics |
| `sync-reanchor.test.js` | successful sync forces a fresh audio timeline anchor even without an offset change |
| `audio-marker.test.js` | manual/system audio-output markers render on both trace charts |
| `calibration.test.js` | repeated delay-button clicks collapse into one idle-ended CALIBRATION row |
| `rwm-lock.test.js` | RWM OFF/1Hz/10Hz lock overrides the schedule and status lock comes first |
| `prompts.test.js` | six analysis prompts stay compact, self-contained, and keep NTP/audio constraints |
| `simple-export.test.js` | 6-hour reduced-column sync/trace exports and single-file combined export |

Audio output, autoplay policy, touch gestures and mobile background behavior are
checked manually in a real browser.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
