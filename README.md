# Time Station Simulator

[English](README.md) | [简体中文](README.zh-CN.md)

A browser-based simulator of four shortwave time-signal stations: **BPM**,
**WWV**, **WWVH**, and **RWM**. Audio is scheduled with the Web Audio API; the
time base and DUT1 data come from a self-hosted Time API (any compatible service
can be used).

The page does not contain a built-in backend address. The first time you use
`AUTO`, `SYNC`, or DUT1 `AUTO`, it asks for the Time API base URL and stores it in
the current browser.

## Features

- Four stations running together with independent station volumes:
  - **BPM:** 1 kHz second pulses, UTC/UT1/call periods, optional 125 Hz
    subcarrier BCD time code;
  - **WWV:** 1000 Hz second pulses, 100 Hz BCD, minute tones, voice
    announcements, station identification;
  - **WWVH:** 1200 Hz second pulses, 100 Hz BCD, minute tones, voice
    announcements, station identification;
  - **RWM:** 1 Hz / 10 Hz pulses, DUT1/dUT1 timing, Morse identification, and a
    variable beat-frequency (BF) oscillator for listening to the CW carrier.
- A shared UTC/DUT1 time base with a common look-ahead audio clock.
- Network sync, automatic sync, a sync audit log, and clock traces.
- Per-device audio compensation profiles for headphones, speakers, and other
  output paths.
- NTP health is observed by the backend; the browser never queries NTP directly.
- Single-page static app with no runtime CDN or third-party services other than
  the configured Time API.
- Responsive layout, hidden settings panel, and Zen mode.

## Quick start

### 1. Start the Time API

Use the companion `time-api` project (default `http://localhost:8080`). In its
directory, run:

```bash
docker compose up -d --build
```

See `time-api/README.md` for configuration.

### 2. Serve this directory

The page must be served over HTTP(S); opening `index.html` via `file://` will not
work:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

### 3. Configure the backend

The first `AUTO`, `SYNC`, or DUT1 `AUTO` action opens a backend setup dialog.
Enter the Time API base URL, for example:

```text
http://localhost:8080
```

You can also paste a `/v1/time`, `/v1/time/ntp`, or `/v1/dut1` endpoint; it is
normalized to the base URL. Path prefixes are supported. For a same-origin
deployment, the `⌂` button fills in the current origin.

The backend must allow the page origin through CORS. An HTTPS page cannot call
an HTTP backend (localhost excepted). Production deployments should use HTTPS
for both the page and the API.

The address is stored in the browser's `localStorage`. Change it later from the
sync audit panel's 🔌 button or with `?setup=backend`.

## Browser requirements

- A modern browser with Web Audio support;
- an initial user gesture is required to start audio (drag the master volume);
- a recent desktop or mobile version of Chrome, Edge, Firefox, or Safari is
  recommended.

## Basic operation

- Drag the master volume below the clock to start playback (it starts at zero).
- Click any station's percentage to expand or collapse all station sliders.
- Click the status-bar clock emoji to open clock calibration; click the UT1 time
  to open display settings; click a station status to open station controls.
- Click the hour/minute area of the main clock to enter or exit Zen mode.
- See [MANUAL.md](MANUAL.md) for the full UI and status reference. The Chinese
  version is [MANUAL.zh-CN.md](MANUAL.zh-CN.md).

## Layout

```text
index.html                 page shell
core.js                    configuration, time formatting, settings and state
audio-engine.js            Web Audio scheduler, station buses and effects
time-sync.js               time samples, sync audit, DUT1 and trace data
observability.js           trace charts, NTP details, audit and prompt panels
app.js                     station rows, settings panel, audio controls and startup
styles.css                 custom styles and components
tailwind.css               precompiled Tailwind CSS
tailwind.input.css         Tailwind input
tailwind.config.cjs        Tailwind configuration
audio/                     station audio assets
dseg7-*.woff/.woff2        seven-segment display fonts
tests/                     jsdom test suite
DEPLOY.md                  deployment notes
MANUAL.md                  English user manual
MANUAL.zh-CN.md            Chinese user manual
STATIONS.md                English signal reference
STATIONS.zh-CN.md          Chinese signal reference
THIRD_PARTY.md             third-party material and licenses
```

## Development and build

The page uses classic JavaScript scripts and needs no bundler. After changing
Tailwind utility classes, regenerate the CSS:

```bash
npm install
npm run build:css
```

Tests:

```bash
cd tests
npm install
npm test
```

The tests load the deployable files directly through jsdom. See
[tests/README.md](tests/README.md) for details.

## Time and accuracy

This project is intended to produce broadcast-like background audio and a
convenient page clock for everyday timing. It is not a metrology-grade UTC
reference and is not a substitute for a shortwave receiver.

- The display and audio both depend on the backend time. Upstream time sources,
  network paths, audio output paths, and manual calibration all affect the final
  phase you hear.
- Device profiles absorb differences in the local audio chain. Recalibrate after
  changing headphones, speakers, or system audio settings.
- Audio scheduling uses a monotonic clock and slow audio-rate estimation, so a
  wall-clock step does not directly disturb scheduled audio.

## Scope

- Simulates the signal structure and listening experience of four stations; it
  does not model ionospheric propagation, fading, co-channel interference, or
  receiver tuning.
- No stations other than BPM, WWV, WWVH, and RWM.
- No traceable UTC calibration service. Use dedicated timing equipment when
  strict traceability or metrology-grade accuracy is required.

## Third-party material and license

WWV/WWVH audio assets are derived from
[kalafut/wwv](https://github.com/kalafut/wwv) under the MIT License. DSEG7 fonts
use the SIL Open Font License 1.1. See [THIRD_PARTY.md](THIRD_PARTY.md),
`THIRD_PARTY_WWV_LICENSE.txt`, `DSEG7-LICENSE.txt`, and
`DSEG7-MINI-LICENSE.txt`.

The project code is MIT licensed; see [LICENSE](LICENSE).

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
