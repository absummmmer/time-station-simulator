# Time Station Simulator Manual

[English](MANUAL.md) | [简体中文](MANUAL.zh-CN.md)

This manual describes the page's actual behavior, status symbols, and calibration
workflow. The page only synthesizes audio locally. UTC time, NTP health, and DUT1
data are supplied by the Time API you configure.

## 1. Overview

Time Station Simulator simulates four shortwave time-signal stations at the same
time:

- **BPM:** 1 kHz second pulses, UTC/UT1/call periods, optional 125 Hz subcarrier
  BCD time code;
- **WWV:** 1000 Hz second pulses, 100 Hz BCD, minute tones, voice announcements,
  station identification;
- **WWVH:** 1200 Hz second pulses, 100 Hz BCD, minute tones, voice announcements,
  station identification;
- **RWM:** 1 Hz / 10 Hz pulses, DUT1/dUT1, Morse identification; the CW carrier
  is monitored through an adjustable beat-frequency (BF) oscillator.

All four stations share the same UTC/DUT1 time base but generate their own audio.
The page does not simulate shortwave transmission, ionospheric propagation,
fading, co-channel interference, or receiver tuning. It simulates the audio
structure and timing of the time signals.

## 2. Startup and backend

### 2.1 Serve the page

The page must be served over HTTP(S); do not open `index.html` through `file://`.
Serve the project directory as a static site. The runtime file list is in
[DEPLOY.md](DEPLOY.md).

### 2.2 Configure the Time API

The backend is the companion
[`time-api`](https://github.com/absummmmer/time-api) project; its README covers
configuration, NTP health, and self-hosting.

No backend address is embedded in the page. The backend setup dialog appears the
first time you do any of the following:

- enable `AUTO`;
- click `SYNC`;
- enable DUT1 `AUTO`.

Enter the Time API base URL, for example:

```text
https://time-api.example.com
```

You can also paste a `/v1/time`, `/v1/time/ntp`, or `/v1/dut1` endpoint; the page
normalizes it to a base URL. Reverse-proxy path prefixes are supported. For a
same-origin deployment, the `⌂` button fills in the current origin. The address
is stored in the current browser's `localStorage`.

The backend must allow the page origin through CORS. An HTTPS page cannot call an
HTTP backend (localhost excepted). Production deployments should use HTTPS for
both the page and the API.

To change the address later, use the 🔌 button in the sync audit panel or open
`?setup=backend`.

### 2.3 Browser and audio startup

- Use a modern browser with Web Audio support.
- The first playback must be triggered by a user gesture: drag the master volume
  below the clock.
- The page tries to keep a silent audio stream alive while in the background, but
  browsers may still reduce timer precision or throttle audio processing. Keep the
  page in the foreground when timing accuracy matters.
- If audio does not start, drag the master volume again or click the page once.

## 3. Main interface

### 3.1 Main clock

- The clock shows UTC by default. Enabling local time in **Display** switches the
  main clock to local time and shows the zone offset next to the seconds. Audio
  continues to be scheduled in UTC and does not follow the local-time display.
- Milliseconds can be shown or hidden in **Display**; they are shown by default.
- Click the **hour/minute area** of the main clock to enter or exit Zen mode.
- Click the **seconds**, **milliseconds**, or **zone offset label** to open
  **Display** settings. The seconds area remains a display-settings entry point
  when milliseconds are hidden.
- When UT1 display is enabled, the UT1 time and telescope icon appear on the right
  side of the status bar. UT1 is displayed continuously, not only during BPM's UT1
  transmission window.
- The emoji clock on the left side of the status bar always uses UTC and rounds
  down to the nearest half hour. Click it to open clock calibration.
- The global offset marker (for example `+2h`) comes from the `?offset=` URL
  parameter and opens clock calibration when clicked. The yellow warning icon
  indicates that the page detected an uncertain clock or a system clock jump;
  clicking it opens calibration. With `AUTO` enabled it attempts a sync; with
  `AUTO` disabled it only dismisses the warning and waits for a manual sync.

### 3.2 Master volume

The master volume slider is below the main clock, has a fixed width, and starts at
zero:

- Drag it to start audio. There is no separate play/pause button.
- The icon shows muted, low, medium, or high volume.
- A loading spinner appears in the icon position while audio is initializing.
- The spinner appears again when switching device profiles or rebuilding the
  output.
- The master volume is not restored after a page reload; station and component
  volumes are restored.

### 3.3 Station mixer

Each row shows the station icon, call sign, current status, and percentage on the
right:

```text
📻 BPM   —               100%
📻 WWV   BCD             0%
📻 WWVH  BCD             0%
📻 RWM   ∅               0%
```

- Only the percentage text on the right is a hit area. Click any percentage to
  expand all four station sliders; click any percentage again to collapse them.
- When collapsed, stations at 0% are hidden. Expanding shows all four. The page
  always keeps at least one station at 1% or higher.
- Expanding adds only the slider height; it does not change the row spacing. On
  narrow screens the slider appears below the station row.
- Station status rows and the bottom status bar stay on one line and truncate at
  the end when necessary.
- Station volume is saved independently. Changing a station volume does not change
  that station's internal signal-component ratios.

### 3.4 Zen mode

- Click the hour/minute area of the main clock to enter or leave Zen mode.
- Entering attempts to request fullscreen and hides the master control, settings
  panel, and station sliders.
- While playing with master volume above zero, only stations with non-zero volume
  and their percentages are shown; slider controls are not operable.
- With master volume at zero, the page looks paused and only the main clock is
  shown.
- Zen mode slowly shifts the content vertically to reduce burn-in on long static
  displays.
- If the browser entered fullscreen, pressing Esc to leave fullscreen also exits
  Zen mode; otherwise click the hour/minute area again.
- Clicking the seconds, milliseconds, or offset label exits Zen mode and opens
  **Display** settings.

## 4. Status symbols

Status text is mainly English and symbols.

### 4.1 BPM

| Display | Meaning |
| --- | --- |
| `—` | UTC/time-code period with BCD at 0%; only second pulses |
| `+BCD₅₀%` | UTC/time-code period with the 125 Hz BCD subcarrier; subscript is the current ratio |
| `∅` | Carrier period: BPM has no modulation; what you hear depends on noise settings |
| `UT1` | UT1 transmission period; second pulses are shifted by DUT1 |
| `MCid₅₀% -··· ·--· --` | Morse call period; the subscript is the Morse-call volume |
| `🗣 标准时间标准频率发播台` | Voice call period; a subscript appears when the ratio is not 100% |
| `UTC` / `UTC+BCD…` | UTC lock forces UTC + time-code mode |

- The lock icon is always first in the BPM status; with UTC lock it shows as
  `🔒UTC…`.
- When BPM is in a UT1 period and the UT1 clock is hidden, the current DUT1 value
  is appended. When the UT1 clock is visible, the value is shown only if BPM and
  the UT1 display use different DUT1 values.
- BPM call/voice components at 0% are struck through. BPM time code at 0% shows
  `—` rather than a struck-through component. WWV/WWVH BCD, tone, or voice
  components at 0% are struck through.
- Morse percentages of 100% and 0% do not show a subscript.
- BPM's `+BCD` is the optional 125 Hz subcarrier time code added to the normal
  signal; it is different from WWV/WWVH's 100 Hz BCD code.

### 4.2 WWV / WWVH

The status always starts with `BCD` and appends the current tone, voice, or DUT1
double ticks:

| Display | Meaning |
| --- | --- |
| `BCD` | Basic time code; struck through when BCD is 0% |
| `BCD₅₀%+♪₅₀%500` | The current minute has a standard tone; a subscript appears when tone is not 100% |
| `BCD+🗣 12:02 UTC` | Voice announcement; shows the upcoming UTC time |
| `BCD+🗣 StationIntroduction` | Station identification/introduction |
| `+DUT1+0.n` | DUT1 double tick during the first 16 seconds; `+DUT1` is the purple transmission state and the green value is the cumulative value |

- Second-pulse frequency: WWV 1000 Hz, WWVH 1200 Hz.
- Tones are 500, 600, or 440 Hz and rotate on a minute schedule.
- Voice announcements start at about 53.5 seconds for WWV and 46.5 seconds for
  WWVH.
- Station identification: WWV at minutes 0 and 30, WWVH at minutes 29 and 59. The
  introduction voice starts at the first second of the minute.
- DUT1 double ticks during the first 16 seconds: seconds 1–8 are positive, 9–16
  are negative, and each is 0.1 s.
- When the UT1 clock is enabled and its value matches the station DUT1, the green
  DUT1 value is not repeated; only the purple transmission state remains.

Tone, BCD, and voice have independent ratio sliders; components at 0% are struck
through in the status.

### 4.3 RWM

| Display | Meaning |
| --- | --- |
| `∅` | Unmodulated carrier or mode tail |
| `×` | Transmitter off |
| `MCid ·-· ·-- --` | Morse call; subscript when not 100%, struck through at 0% |
| `—` | 1 Hz normal second pulse |
| `D+ +0.1` / `D− −0.1` | DUT1 double-pulse cumulative value; `D±` is the purple state and green is the actual value |
| `d+ −0.18` / `d− +0.18` | dUT1 extra double-pulse cumulative value |
| `10Hz` | 10 Hz pulse mode |
| `10Hz₅₀%·ds` | Non-integer-second pulse ratio in 10 Hz mode |
| `1_Hz` | Degraded state when 10 Hz ratio is 0% |

- Lock modes are `NORMAL`, `1Hz🔒`, and `10Hz🔒`; the lock icon is always first in
  the status.
- `1Hz🔒` / `10Hz🔒` force continuous output of the corresponding pulses across
  carrier, off, Morse, and tail gaps.
- `1Hz🔒` still sends DUT1 double pulses; `10Hz🔒` does not send DUT1.
- When the UT1 clock is enabled and its value matches the DUT1 used by RWM, the
  green cumulative value is hidden and only the `D±` / `d±` purple state remains.
- Locking changes only RWM transmission and does not trigger clock sync.
- At 0% 10 Hz ratio, the non-integer-second ds pulses are zero and the whole-second
  pulses remain, so the status displays `1_Hz`.

## 5. Settings

The settings panel has no permanent entry point. Open it by:

- clicking the status-bar emoji clock → **Clock calibration**;
- clicking the UT1 time or telescope → **Display**;
- clicking any station's status text → **Station controls**;
- clicking the clock warning or global offset marker → **Clock calibration**;
- URL parameter `?settings=clock|display|stations|noise`;
- `?setup=backend` to open backend address settings directly.

The four icons at the top are:

```text
🕒 Clock calibration
🖥️ Display
📻 Station controls
⚡ Noise
```

The ✕ in the top-right corner closes the panel. Settings are saved automatically;
see section 8 for persistence.

### 5.1 Clock calibration

#### 5.1.1 Local offset and SYNC

- `local_offset_val` shows the current local correction in seconds with three
  decimal places.
- Three positive and three negative buttons adjust by `+0.1 / +0.01 / +0.001`
  seconds. The ↺ button resets the local offset to zero.
- `SYNC` requires the Time API address. A sync takes 7 samples, drops the slower
  samples, and uses the median offset of the kept samples. The page's local offset
  is updated to 0.1 ms precision.
- After a sync, the page re-anchors the audio timeline.
- The clock calibration row shows the last sync's uncertainty, kept samples, RTT,
  and sample spread.
- Network sync is random; one sync may not be accurate enough. Repeat until the
  uncertainty and sample spread are stable.
- The local offset affects this page only, not the system clock. It applies to
  both the display clock and the audio timeline.

NTP information in the sync status is shown only when backend correction actually
participated in that served time; otherwise NTP source data remains in the sync
audit and NTP details.

#### 5.1.2 AUTO

- Enabling `AUTO` performs one immediate sync, then another at a random moment in
  each BPM carrier window (UTC minutes 10–15 and 40–45).
- With `AUTO` enabled, manual offset buttons and `SYNC` are hidden. Base audio
  compensation, device compensation, and DUT1 controls remain available.
- Disabling `AUTO` restores manual control.
- Enabling BPM's UTC lock cancels any scheduled automatic sync; no carrier-window
  auto sync occurs while locked.
- After a long time in the background or after screen lock, if a system clock jump
  is detected, the page tries to resync automatically. With `AUTO` disabled it only
  shows a warning and does not contact the backend on its own.

#### 5.1.3 Audio compensation and device profiles

The clock-offset row contains an audio delay compensation display:

```text
(+0ms)
```

The parentheses show the sum of the current base compensation and the current
device extra compensation. It adjusts the **audio scheduling timeline**, not
network latency, and does not move the display clock.

- Click `(+…ms)` to reveal the base compensation buttons: `±10ms`, `±1ms`, and ↺.
  Base compensation is an integer number of milliseconds and cannot be negative.
- Base compensation is shared by the current browser/system audio path and is
  retained when switching device profiles.
- Click the device name next to the headphone icon to open the device profile
  menu. The menu shows each profile's extra compensation, sorted by value.
- Selecting a profile applies its device extra compensation and rebuilds the audio
  output; a loading spinner appears at the master control during the switch. When
  a profile is selected, five buttons appear below the name: `+10ms`, `+1ms`, ↺,
  `-1ms`, and `-10ms`; they change only the current profile's extra compensation.
- The `+` at the bottom of the menu creates a profile. Type a name and press Enter
  or blur to confirm; press Esc to cancel. Names are limited to 24 characters.
- The ↺ to the right of the device row returns to the `default` profile. It does
  not automatically zero the current profile's compensation.
- A delete button ✕ appears when a profile is selected; deletion asks for
  confirmation. Deleting the last profile recreates `default`; otherwise the page
  switches to `default` or the first remaining profile.
- Device extra compensation can be positive or negative, roughly ±9999 ms. The
  current device extra value is highlighted in fuchsia in the compensation
  display.

Device profiles absorb fixed delays in different headphones, sound cards, or
audio output paths. Re-listen and adjust after changing headphones or system audio
settings. When the browser emits `devicechange`, the page automatically rebuilds
the audio output and records a system output event.

After adjusting compensation repeatedly, waiting 2.5 seconds produces one
`CALIBRATION` trace record for the whole burst instead of one record per click.

#### 5.1.4 DUT1

DUT1 is the current UT1−UTC value, shown in seconds. It affects BPM time code and
UT1 transmission, WWV/WWVH BCD and double ticks, and RWM DUT1/dUT1 double pulses.

**Manual mode (AUTO off)**

- Six buttons adjust by `±0.1 / ±0.01 / ±0.001` seconds; ↺ resets the common DUT1
  to zero.
- The `NTSC_EOP_yyyyMMdd.txt` and `IERS/BULLETIN-A` links download EOP files. After
  uploading a file, the page parses NTSC EOP or IERS Bulletin A format and takes
  the current day's UT1−UTC value.
- Manual values and uploaded values are the common DUT1 used by all stations.
- Uploaded files are used only in the current page's memory and are not uploaded
  to a server.

**Automatic mode (AUTO on)**

- With AUTO enabled, the manual DUT1 buttons, file picker, and source links are
  hidden.
- The page fetches DUT1 from the Time API: once immediately when enabled, then for
  the new UTC date after a date change. On failure it keeps the applied value,
  shows an error state, and retries.
- When the backend has both NTSC and IERS data:
  - BPM uses NTSC;
  - WWV, WWVH, and RWM use IERS;
  - the UT1 clock uses the currently selected source; click the compact source
    status on the right side of the DUT1 row to switch the UT1 display between
    NTSC and IERS;
  - the station broadcast source assignment does not change when you switch the
    UT1 display.
- When only one source is available, all stations fall back to that source.

UTC lock changes only BPM transmission. It does not hide DUT1 controls and does not
stop DUT1 from participating in the time code or station signals.

#### 5.1.5 Sync audit, NTP details, and export

The 📋 button at the end of the clock calibration row opens the sync audit panel:

- `📑` sync records: state, time, offset before/after, uncertainty, samples, RTT,
  and backend NTP state for each sync;
- `📈` trace: offset, audio-timeline Δ, and raw wall − monotonic residual charts;
- audit and trace records are kept locally for 48 hours; normal exports cover the
  last 24 hours;
- NTP cells open NTP details and a 24-hour trend;
- the 🤖 button opens analysis prompts in Chinese/English and can export a
  simplified 6-hour CSV;
- sync and trace CSV files contain only local records and are never uploaded
  automatically.

Trace chart order:

1. offset (ms): the page's local correction;
2. audio timeline Δ (ms): audio scheduling timeline relative to display UTC plus
   device compensation;
3. raw wall − monotonic (ms): raw wall-clock drift.

Audio output events are drawn only on the second audio-timeline chart:
`CALIBRATION` is dim amber, manual output/device switching is bright fuchsia, and
system `devicechange` is bright cyan and drawn last, on top. The offset and raw
residual charts do not draw audio events.

In trace/CSV fields, `networkCompMs` is a historical field name for base audio
compensation and is not network latency; `deviceExtraMs` is the active device
profile's extra compensation, `audioSkewPpm`/`audioTimeScale` are the current
audio-clock skew estimate and scheduling multiplier, and `audioTimelineDeltaMs` is
explained above.

### 5.2 Display

- **Milliseconds:** show or hide main-clock milliseconds; does not affect audio.
- **Local time:** show local time in the main clock with a zone offset; audio is
  still scheduled in UTC.
- **UT1 clock:** continuously show UT1 time on the right side of the status bar;
  UT1 affects display only.

### 5.3 Station controls

#### BPM

- `BCD(0%)`: 125 Hz BCD time-code level, 0–200%. At 100% its peak is half the
  second pulse; at 200% it equals the second pulse.
- `MCid(100%)`: Morse call level, 0–100%.
- `🗣(100%)`: voice call level, 0–100%.
- The ↺ to the right of the station title resets BPM time code to 0%, Morse/voice
  to 100%, and turns UTC lock off.
- Station master volume is controlled separately in the mixer; the ↺ does not reset
  it.

BPM's UTC lock control is at the top of the BPM subarea in **Station controls**,
labelled `UTC🔒`. When enabled, BPM transmits only UTC + time code and ignores
carrier, UT1, and call periods; the lock icon appears first in the BPM status. UTC
lock does not move the display clock and does not change other stations.

#### WWV / WWVH

Each station has three independent sliders:

```text
BCD(100%)   100 Hz BCD time code, 0–200%
♪(100%)     standard tones, 0–100%
🗣(100%)     voice announcements/identification, 0–100%
```

The default ratios follow the NIST SP 432 100/50/50/75 relationship relative to
the second pulse. The ↺ to the right of the station title restores BCD, tone, and
voice to 100%.

#### RWM

- Three-state lock on the left: `NORMAL` / `1Hz🔒` / `10Hz🔒`.
- `BF(4000Hz)`: CW beat frequency, 100–4000 Hz, logarithmic slider, 10 Hz steps.
  Releasing the slider rebuilds only the RWM audio buffer. The new BF takes effect
  after the current 10-second look-ahead window; a loading indicator appears next
  to the label. Click the indicator to reload all audio immediately.
- `10Hz_ds(100%)`: controls only the nine non-integer-second pulses in 10 Hz mode,
  0–100%; it does not affect the whole-second 40 ms or minute 500 ms pulses.
- `MCid(100%)`: Morse call level, 0–100%.
- The ↺ to the right of the station title restores NORMAL, 10Hz_ds 100%, MCId
  100%, and BF 4000 Hz.

### 5.4 Noise

- The noise slider is in the **Noise** tab; its percentage is shown below it.
- The noise is low-pass filtered at about 1.5 kHz for a soft band-limited hiss.
- The effective noise level is the smaller of the master volume and the noise
  volume, mapped through a cubic curve; at master volume zero the noise is also
  zero.
- Noise is saved independently of station volumes. It is mainly useful for
  masking BPM carrier/silence periods and for quiet listening environments.

## 6. Transmission schedules

### 6.1 BPM

BPM repeats every half hour. The implementation uses this schedule:

| UTC minute/time | Signal |
| --- | --- |
| 00–10, 30–40 | UTC second pulses + 125 Hz time code |
| 10–15, 40–45 | Unmodulated carrier; BPM itself has no audio |
| 15–25, 45–55 | UTC second pulses + 125 Hz time code |
| 24:59–29:00, 54:59–59:00 | UT1 second pulses: 100 ms normally, 300 ms on the minute; no time code; shifted by DUT1 |
| 29–30, 59–60 | Station call: about 40 seconds Morse, then 20 seconds voice |

The UT1 window starts at `24:59` / `54:59`; the final second of minutes 24 and 54
is already in UT1 mode. At 29:00 / 59:00 the call period begins.

The BPM time code is a 60-bit/minute 125 Hz subcarrier BCD code at 1 bit/s:

- 200 ms pulse = 0;
- 480 ms pulse = 1;
- 800 ms position markers: P1=9, P2=19, P3=29, P4=39, P5=49, P0=59;
- the UT1 correction value is in the 50–54 second field.

Default BCD volume is 0%. Reference frequencies (the page does not tune RF):
2.5 / 5 / 10 / 15 MHz.

### 6.2 WWV / WWVH

- Second pulses: WWV 1000 Hz, WWVH 1200 Hz, 5 ms; 10 ms silence before and 25 ms
  after;
- minute marker: 1000 / 1200 Hz, 800 ms; hour marker: 1500 Hz, 800 ms;
- no second pulse at seconds 29 and 59;
- time code: 100 Hz BCD subcarrier, 1 bit/s;
- tones: 500 / 600 / 440 Hz on a minute schedule;
- calls: WWV at 0/30 minutes, WWVH at 29/59 minutes;
- voice announcements start at about 53.5 s (WWV) and 46.5 s (WWVH);
- DUT1 double ticks during the first 16 seconds: seconds 1–8 positive, 9–16
  negative; BCD also encodes DUT1;
- reference frequencies: WWV 2.5/5/10/15/20 MHz (25 MHz experimental); WWVH
  2.5/5/10/15 MHz.

### 6.3 RWM

RWM repeats every 30 minutes:

| UTC minute | Signal |
| --- | --- |
| 00–08, 30–38 | Unmodulated carrier |
| 08–09, 38–39 | Transmitter off |
| 09–10, 39–40 | Morse call “RWM RWM RWM…”, hard cutoff at 55 s |
| 10–20, 40–50 | 1 Hz pulses |
| 20–30, 50–60 | 10 Hz pulses |

- 1 Hz: 500 ms on the minute, 100 ms otherwise; DUT1/dUT1 double pulses are sent
  during 1 Hz mode.
- DUT1 double pulses: seconds 1–8 are positive, 9–16 negative; the second pulse
  starts 200 ms after the second.
- dUT1: positive at seconds 21–24, negative at 31–34, in 0.02 s steps.
- 10 Hz: 20 ms normal pulses, 40 ms on whole seconds, 500 ms on the minute; the
  first 500 ms minute pulse plus a 20 ms pulse at +500 ms forms a 520 ms
  continuous pulse.
- Each pulse mode's last minute has no pulses at seconds 55–59.
- Reference frequencies: 4.996 / 9.996 / 14.996 MHz.

RWM does not send the time of day; it sends standard intervals and DUT1/dUT1. The
CW carrier itself has no audio, so use the BF beat-frequency control to listen.

## 7. Suggested calibration workflow

1. Configure and sync the Time API so the page's local offset is stable.
2. Start audio and select the usual headphone/sound-card device profile.
3. Use BPM second pulses as a reference and adjust base audio compensation until
   the pulses you hear align with the displayed second.
4. Use separate device profiles for different headphones/sound cards; do not use
   the local clock offset to compensate for audio delay.
5. If audio shifts later, resync the local clock first, then check whether the
   audio output changed.
6. Use trace when needed and confirm that `audioTimelineDeltaMs` does not drift
   continuously while the device profile and AudioContext session remain the same.

Use the local offset for "page clock vs reference time"; use audio compensation
for "audio path delay vs page clock". Do not mix them.

## 8. Data, persistence, and privacy

- Station volumes, component ratios, noise, RWM BF/lock, DUT1, local offset, audio
  compensation, display switches, AUTO states, and device profiles are stored in
  the browser.
- The master volume always starts at zero on page load.
- The Time API address is stored separately in browser `localStorage`.
- Sync audit and trace records are kept locally for 48 hours; exports default to
  the last 24 hours.
- The page contains no analytics or third-party CDNs, and makes no network requests
  other than to the configured Time API.
- The 6-hour simplified and 24-hour full CSV exports are downloaded manually and
  are never uploaded automatically.

## 9. Advanced URL parameters

| Parameter | Effect |
| --- | --- |
| `?settings=clock\|display\|stations\|noise` | Open the settings panel on a specific tab |
| `?setup=backend` | Open the Time API address setup directly |
| `?offset=±integer minutes` | Add a global offset to displayed UTC and audio; does not change the device clock used for network sync |

`?offset` is intended for demonstrations or temporary shifts and is not saved. The
status bar shows the offset marker.

## 10. Accuracy and scope

- This is a time-signal simulator, not a metrology-grade UTC reference or a
  shortwave receiver.
- Absolute time depends on the device clock, the Time API backend, the network
  path, and manual calibration.
- The time at which audio reaches the ear also depends on the browser, operating
  system, and output device.
- The page does not simulate ionospheric propagation, fading, co-channel
  interference, receiver tuning, or RF transmission.
- Only BPM, WWV, WWVH, and RWM are implemented.
- Leap-second insertion and leap-second announcements are not simulated; related
  fixed time-code fields remain at their default values.
- Interface labels are mainly English; this manual is the English reference.

## 11. Deployment and third-party material

See [DEPLOY.md](DEPLOY.md) for the runtime file list, caching, and CORS notes.
WWV/WWVH audio assets are derived from `kalafut/wwv` (MIT); DSEG7 fonts use the SIL
Open Font License 1.1. See [THIRD_PARTY.md](THIRD_PARTY.md) and the license files
included with the project.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
