// Core: utilities, persisted configuration, time formatting, settings, sync and DUT1 state.
// Application layout:
    //   1. Polyfills and small utilities
    //   2. Configuration, feature detection, and persisted state
    //   3. Clock formatting / rendering helpers
    //   4. Settings, sync, DUT1, and device-profile controllers
    //   5. Audio engine (NextAudio)
    //   6. DOM event wiring
    const uiCache = new Map();
    function getUi(id) {
      let el = uiCache.get(id);
      if (!el) {
        el = document.getElementById(id);
        if (el) uiCache.set(id, el);
      }
      return el;
    }
    // Present polyfill for high resolution time
    function present() {
      if (window.performance && window.performance.now) {
        return window.performance.now();
      }
      return Date.now();
    }
    // Driftless implementation from https://github.com/dbkaplun/driftless
    const DEFAULT_THRESHOLD_MS = 1;
    const DEFAULT_AGGRESSION = 1.1;
    const DEFAULT_NOW_FN = (...args) => present(...args);
    const DEFAULT_SET_TIMEOUT = (...args) => setTimeout(...args);
    const DEFAULT_CLEAR_TIMEOUT = (...args) => clearTimeout(...args);
    const timerHandles = {};
    let nextId = 0;
    function tryDriftless(id, opts) {
      const {
        atMs,
        fn,
        thresholdMs = DEFAULT_THRESHOLD_MS,
        aggression = DEFAULT_AGGRESSION,
        customNow = DEFAULT_NOW_FN,
        customSetTimeout = DEFAULT_SET_TIMEOUT,
      } = opts;
      const delayMs = atMs - customNow();
      const handle = delayMs > thresholdMs
        ? (
          customSetTimeout(() => {
            tryDriftless.apply(this, arguments);
          }, delayMs / aggression)
        )
        : (
          customSetTimeout(() => {
            fn();
          }, 0)
        );
      timerHandles[id] = handle;
    }
    function setDriftless(opts) {
      const id = nextId;
      nextId += 1;
      tryDriftless(id, opts);
      return id;
    }
    function clearDriftless(id, opts = {}) {
      const {
        customClearTimeout = DEFAULT_CLEAR_TIMEOUT,
      } = opts;
      customClearTimeout(timerHandles[id]);
    }
    function clearDriftlessInterval(id, opts = {}) {
      clearDriftless(id, opts);
    }
    function castToFn(fn) {
      return typeof fn === 'function'
        ? fn
        : new Function(fn);
    }
    function setDriftlessTimeout(fn, delayMs, ...params) {
      const callFn = castToFn(fn);
      return setDriftless({
        atMs: DEFAULT_NOW_FN() + delayMs,
        fn(...args) {
          return callFn.call(this, ...args, ...params);
        },
      });
    }
    function setDriftlessInterval(fn, delayMs, ...params) {
      const callFn = castToFn(fn);
      let id;
      const opts = {
        atMs: DEFAULT_NOW_FN() + delayMs,
        fn(...args) {
          opts.atMs += delayMs;
          tryDriftless(id, opts);
          return callFn.call(this, ...args, ...params);
        },
      };
      id = setDriftless(opts);
      return id;
    }
    // Global variables
    let wakeLockSentinel = null;
    let wakeLockSupported = false;
    let audioHeartbeat = null;
    let voiceBuffer = null;
    // Legacy BPM balance: 0.28 is exactly half the 0.56 pulse peak.
    const BPM_PULSE_AMPLITUDE = 0.56;
    const BPM_TIMECODE_AMPLITUDE = 0.28;
    const BPM_TIMECODE_DEFAULT = 0.0;
    const BPM_MORSE_BASE_GAIN = 1.0;
    const BPM_VOICE_BASE_GAIN = 0.5;
    let lowFreqVolume = BPM_TIMECODE_DEFAULT;
    let bpmMorseAdjust = 1.0;
    let bpmVoiceAdjust = 1.0;
    let masterVolume = 0;
    let noiseVolume = 0.0;
    let language = 'en';
    const stationVolumes = { bpm: 1, wwv: 0, wwvh: 0, rwm: 0 };
    const wwvAdjustments = {
      wwv: { tone: 1, code: 1, voice: 1 },
      wwvh: { tone: 1, code: 1, voice: 1 },
    };
    const rwmAdjustments = { pulse10: 1, morse: 1 };
    let rwmLockMode = 'off';
    const RWM_BEAT_MIN_HZ = 100;
    const RWM_BEAT_MAX_HZ = 4000;
    const RWM_BEAT_DEFAULT_HZ = 4000;
    const RWM_BEAT_STEP_HZ = 10;
    let rwmBeatHz = RWM_BEAT_DEFAULT_HZ;

    function clampRwmBeatHz(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return RWM_BEAT_DEFAULT_HZ;
      const stepped = Math.round(number / RWM_BEAT_STEP_HZ) * RWM_BEAT_STEP_HZ;
      return Math.max(RWM_BEAT_MIN_HZ, Math.min(RWM_BEAT_MAX_HZ, stepped));
    }

    function rwmBeatToSliderPosition(value) {
      const hz = clampRwmBeatHz(value);
      return Math.log(hz / RWM_BEAT_MIN_HZ) / Math.log(RWM_BEAT_MAX_HZ / RWM_BEAT_MIN_HZ);
    }

    function rwmSliderToBeatHz(value) {
      const position = Math.max(0, Math.min(1, Number(value) || 0));
      return clampRwmBeatHz(RWM_BEAT_MIN_HZ * Math.pow(RWM_BEAT_MAX_HZ / RWM_BEAT_MIN_HZ, position));
    }

    function formatRwmBeatLabel(hz) {
      return `BF(${String(clampRwmBeatHz(hz)).padStart(4, ' ')}Hz)`;
    }
    const wwvIdentDurations = { h: 0, v: 0 };
    const wwvIdentFallbackDurations = { h: 38269, v: 33306 };
    let ut1DetailMode = false;
    let isRunning = false;
    let localOffset = 0;
    let networkCompensation = 0;
    const DEVICE_PROFILES_KEY = 'bpm_simulator_device_profiles_v1';
    const DEVICE_DEFAULT_NAME = 'default';
    const DEVICE_ACCENT_COLOR = '#e879f9';
    let deviceProfiles = {
      version: 1,
      active: DEVICE_DEFAULT_NAME,
      profiles: { [DEVICE_DEFAULT_NAME]: { offsetMs: 0 } },
    };
    let activeDeviceName = DEVICE_DEFAULT_NAME;
    let deviceExtraMs = 0;
    let deviceNameEditing = false;
    let deviceAudioResetTimer = null;
    let pendingAudioOutputSource = 'manual';
    const DELAY_CALIBRATION_IDLE_MS = 2500;
    let delayCalibrationTimer = null;
    let delayCalibrationStart = null;
    let delayCalibrationLastAt = 0;
    let delayCalibrationSteps = 0;

    // Metric data from DSEG7 Classic Bold, in em units: advance, ink-left,
    // ink-right. Text-align centers advances, but "1" and "-" have their ink
    // toward the right of the advance; use actual ink bounds for optics.
    const SEG_GLYPH_METRICS = {
      '0': { a: 0.816, l: 0.099, r: 0.717 },
      '1': { a: 0.816, l: 0.593, r: 0.717 },
      '2': { a: 0.816, l: 0.099, r: 0.717 },
      '3': { a: 0.816, l: 0.144, r: 0.717 },
      '4': { a: 0.816, l: 0.099, r: 0.717 },
      '5': { a: 0.816, l: 0.099, r: 0.717 },
      '6': { a: 0.816, l: 0.099, r: 0.717 },
      '7': { a: 0.816, l: 0.099, r: 0.717 },
      '8': { a: 0.816, l: 0.099, r: 0.717 },
      '9': { a: 0.816, l: 0.099, r: 0.717 },
      ':': { a: 0.200, l: 0.038, r: 0.162 },
      '.': { a: 0.000, l: -0.062, r: 0.062 },
      '-': { a: 0.816, l: 0.175, r: 0.640 },
    };
    let sevenSegReady = false;
    let opticalMetricsKey = '';
    let opticalSecRatio = 0.8;

    function opticalDriftEm(parts) {
      let cursor = 0;
      let minInk = Infinity;
      let maxInk = -Infinity;
      for (const [text, scale] of parts) {
        for (const ch of text) {
          const m = SEG_GLYPH_METRICS[ch];
          if (!m) continue;
          minInk = Math.min(minInk, cursor + m.l * scale);
          maxInk = Math.max(maxInk, cursor + m.r * scale);
          cursor += m.a * scale;
        }
      }
      if (!Number.isFinite(minInk)) return 0;
      return (minInk + maxInk) / 2 - cursor / 2;
    }

    function applyOpticalCentering(el, mainText, secText) {
      if (!sevenSegReady) {
        el.style.transform = '';
        return;
      }
      const key = `${window.innerWidth}:${window.innerHeight}`;
      if (key !== opticalMetricsKey) {
        const mainSize = parseFloat(getComputedStyle(el).fontSize) || 0;
        const secEl = el.querySelector('.main-sec');
        if (mainSize > 0 && secEl) {
          opticalSecRatio = parseFloat(getComputedStyle(secEl).fontSize) / mainSize;
        }
        opticalMetricsKey = key;
      }
      const drift = opticalDriftEm([[mainText, 1], [secText, opticalSecRatio]]);
      const transform = `translateX(${(-drift).toFixed(4)}em)`;
      if (el.style.transform !== transform) el.style.transform = transform;
    }

    function getLocalTimeInfo(utcNow) {
      const zoneOffsetMinutes = -new Date(utcNow.getTime()).getTimezoneOffset();
      const localNow = new Date(utcNow.getTime() + zoneOffsetMinutes * 60000);
      const absMinutes = Math.abs(zoneOffsetMinutes);
      const zoneText = `${zoneOffsetMinutes < 0 ? '-' : '+'}${String(Math.floor(absMinutes / 60)).padStart(2, '0')}:${String(absMinutes % 60).padStart(2, '0')}`;
      return { localNow, zoneOffsetMinutes, zoneText };
    }

    function formatZoneLabel(info) {
      if (!info) return '';
      const hours = info.zoneText.slice(0, 3);
      if (info.zoneOffsetMinutes % 60 === 0) return hours;
      return `${hours}<br>:${info.zoneText.slice(4)}`;
    }

    function updateLocalTimeHint() {
      const hintEl = getUi('local_time_hint');
      if (!hintEl) return;
      const text = getLocalTimeInfo(new Date()).zoneText;
      if (hintEl.textContent !== text) hintEl.textContent = text;
    }

    let forceUtcOnly = false;
    let showLocalTime = false;
    let lastLocalHintStamp = -1;
    let lastTimeRenderKey = null;
    let lastUt1StatusRenderKey = null;
    let lastStationStatusRefreshAt = -Infinity;
    let lastAntiBurnMinute = null;

    const syncController = {
      inFlight: false,
      pendingClockResync: false,
      lastResyncMonoMs: 0,
      afterDoneTimer: null,
      lastWallSampleMs: 0,
      lastMonoSampleMs: 0,
      autoTimer: null,
      autoTimeout: null,
      autoScheduled: false,
      autoScheduledKey: 0,
      lastAutoSegment: -1,
    };
    let pendingSyncReason = 'manual';
    let clockWarningVisible = false;
    let autoSyncMode = false;
    let zenModeActive = false;
    let zenFullscreenObserved = false;
    let zenExitClickGuardUntil = 0;
    let antiBurnActive = false;
    let mainContainer = null;
    let dut1AutoMode = false;
    let dut1SourceMode = 'auto';
    let dut1AutoTimer = null;
    let dut1AutoFetchTimer = null;
    let dut1AutoScheduledDate = '';
    let dut1AutoSuccessDate = '';
    let dut1AutoLastSeenDate = '';
    let dut1AutoBusy = false;
    let dut1AutoAbortController = null;
    let dut1AutoLastFetch = 0;
    let dut1AutoLastError = '';
    let dut1AutoData = null;
    let dut1AutoLastData = null;
    window.bpmDUT1 = 0;
    window.otherDUT1 = 0;
    window.ut1DUT1 = 0;
    let dut1AutoSeriesBySource = { ntsc: null, iers: null };
    let dut1SplitActive = false;
    let dut1AutoPrimaryKey = '';
    let dut1AutoAlternateKey = '';
    window.eopData = null;
    window.isAutoDUT1 = false;
    window.currentDataSource = null;

    // Self-hosted Time API used for clock synchronisation and DUT1 updates.
    // The endpoint is deliberately not shipped in the application: each browser
    // confirms it once, and a deployment can point at any compatible time-api.
    const TIME_API_STORAGE_KEY = 'time_station_time_api_base_v1';
    const TIME_API_CONFIG_VERSION = 1;
    const TIME_API_ENDPOINT_SUFFIXES = ['/v1/time/ntp', '/v1/time', '/v1/dut1', '/v1'];
    let timeApiBase = '';

    function isLoopbackTimeApiHost(hostname) {
      const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
      return host === 'localhost' || host.endsWith('.localhost') ||
        host === '127.0.0.1' || host === '::1';
    }

    // Accept either a base URL or a pasted endpoint; always store an origin with
    // an optional path prefix. Query strings are rejected so a stray cached URL
    // cannot silently redirect every request.
    function normalizeTimeApiBase(raw) {
      const text = String(raw == null ? '' : raw).trim();
      if (!text) return { ok: false, code: 'empty' };
      if (!/^https?:\/\//i.test(text)) return { ok: false, code: 'scheme' };
      let url;
      try {
        url = new URL(text);
      } catch (e) {
        return { ok: false, code: 'invalid' };
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, code: 'scheme' };
      }
      if (url.username || url.password) return { ok: false, code: 'credentials' };
      if (url.hash) return { ok: false, code: 'query' };
      const pastedTimeEndpoint = /\/v1\/time\/?$/i.test(url.pathname);
      if (url.search && !(pastedTimeEndpoint && url.search === '?timezone=UTC')) {
        return { ok: false, code: 'query' };
      }
      let pathname = url.pathname.replace(/\/+$/, '');
      for (const suffix of TIME_API_ENDPOINT_SUFFIXES) {
        if (pathname.toLowerCase().endsWith(suffix)) {
          pathname = pathname.slice(0, -suffix.length).replace(/\/+$/, '');
          break;
        }
      }
      if (location.protocol === 'https:' && url.protocol === 'http:' &&
        !isLoopbackTimeApiHost(url.hostname)) {
        return { ok: false, code: 'mixed' };
      }
      return { ok: true, base: `${url.origin}${pathname}` };
    }

    function loadTimeApiBase() {
      try {
        const saved = localStorage.getItem(TIME_API_STORAGE_KEY);
        if (saved) {
          const normalized = normalizeTimeApiBase(saved);
          if (normalized.ok) {
            timeApiBase = normalized.base;
            return true;
          }
          localStorage.removeItem(TIME_API_STORAGE_KEY);
        }
      } catch (e) {
        // localStorage may be unavailable; keep the page running unconfigured.
      }
      timeApiBase = '';
      return false;
    }

    function isTimeApiConfigured() {
      return !!timeApiBase;
    }

    function getTimeApiBase() {
      return timeApiBase;
    }

    function setTimeApiBase(raw, options = {}) {
      const normalized = normalizeTimeApiBase(raw);
      if (!normalized.ok) return normalized;
      if (options.persist !== false) {
        try {
          localStorage.setItem(TIME_API_STORAGE_KEY, normalized.base);
        } catch (e) {
          return { ok: false, code: 'storage' };
        }
      }
      timeApiBase = normalized.base;
      // Writes the settings marker as well, so a fresh install is not mistaken
      // for a legacy install on the next page load.
      if (typeof saveSettings === 'function') saveSettings();
      return { ok: true, base: timeApiBase };
    }

    function timeApiUrl(pathname, params) {
      if (!timeApiBase) throw new Error('Backend URL not configured');
      const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
      const url = new URL(`${timeApiBase}${path}`);
      if (params) {
        Object.keys(params).forEach((key) => {
          const value = params[key];
          if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
        });
      }
      return url.toString();
    }

    // A settings blob saved by a pre-backend-config build lacks this marker.
    function detectLegacyBackendInstall() {
      try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object') return false;
        return saved.backendConfigVersion !== TIME_API_CONFIG_VERSION;
      } catch (e) {
        return false;
      }
    }

    window.bpmBackend = {
      get base() { return timeApiBase; },
      configured: isTimeApiConfigured,
      normalize: normalizeTimeApiBase,
      set: setTimeApiBase,
      url: timeApiUrl,
      open: () => openBackendSetup({ mode: 'edit' }),
    };
    const DUT1_SOURCE_MODES = ['auto', 'ntsc', 'iers'];
    const DUT1_SOURCE_MODE_LABELS = { auto: 'AUTO', ntsc: 'NTSC', iers: 'IERS' };
    const DUT1_AUTO_CHECK_MS = 30 * 1000;
    const DUT1_AUTO_INITIAL_WINDOW_MS = 60 * 60 * 1000;
    const DUT1_AUTO_RETRY_MIN_MS = 60 * 1000;
    const DUT1_AUTO_RETRY_MAX_MS = 60 * 60 * 1000;

    // Optional global time offset in whole minutes, e.g. ?offset=2 or
    // ?offset=-3. Positive values advance both the displayed UTC and the audio
    // timeline; network clock synchronisation continues to use the unshifted
    // device clock.
    const GLOBAL_OFFSET_MINUTES = (() => {
      try {
        const raw = new URLSearchParams(location.search).get('offset');
        if (raw === null) return 0;
        const text = raw.trim();
        if (!/^[+-]?\d+$/.test(text)) return 0;
        const value = Number(text);
        if (!Number.isInteger(value)) return 0;
        return Math.max(-1440, Math.min(1440, value));
      } catch (e) {
        return 0;
      }
    })();
    const GLOBAL_OFFSET_MS = GLOBAL_OFFSET_MINUTES * 60000;

    // Morse code sequence for BPM
    const morseSequence = [
      { type: 'dash', duration: 300 },
      { type: 'space', duration: 100 },
      { type: 'dot', duration: 100 },
      { type: 'space', duration: 100 },
      { type: 'dot', duration: 100 },
      { type: 'space', duration: 100 },
      { type: 'dot', duration: 100 },
      { type: 'space', duration: 300 },
      { type: 'dot', duration: 100 },
      { type: 'space', duration: 100 },
      { type: 'dash', duration: 300 },
      { type: 'space', duration: 100 },
      { type: 'dash', duration: 300 },
      { type: 'space', duration: 100 },
      { type: 'dot', duration: 100 },
      { type: 'space', duration: 300 },
      { type: 'dash', duration: 300 },
      { type: 'space', duration: 100 },
      { type: 'dash', duration: 300 },
    ];
    const MORSE_CYCLE = 4000;
    const MORSE_START_DELAY = 380; // Morse starts at 29:00.380

    const WWV_TONE_SCHEDULE = {
      0: ['ident', '0'],
      1: ['600', '440'],
      2: ['440', '600'],
      3: ['600', '500'],
      4: ['500', '600'],
      5: ['600', '500'],
      6: ['500', '600'],
      7: ['600', '500'],
      8: ['500', '0'],
      9: ['600', '0'],
      10: ['500', '0'],
      11: ['600', '0'],
      12: ['500', '600'],
      13: ['600', '500'],
      14: ['500', '0'],
      15: ['600', '0'],
      16: ['500', '0'],
      17: ['600', '0'],
      18: ['500', '0'],
      19: ['600', '0'],
      20: ['500', '600'],
      21: ['600', '500'],
      22: ['500', '600'],
      23: ['600', '500'],
      24: ['500', '600'],
      25: ['600', '500'],
      26: ['500', '600'],
      27: ['600', '500'],
      28: ['500', '600'],
      29: ['0', 'ident'],
      30: ['ident', '0'],
      31: ['600', '500'],
      32: ['500', '600'],
      33: ['600', '500'],
      34: ['500', '600'],
      35: ['600', '500'],
      36: ['500', '600'],
      37: ['600', '500'],
      38: ['500', '600'],
      39: ['600', '500'],
      40: ['500', '600'],
      41: ['600', '500'],
      42: ['500', '600'],
      43: ['0', '500'],
      44: ['0', '600'],
      45: ['0', '500'],
      46: ['0', '600'],
      47: ['0', '500'],
      48: ['0', '600'],
      49: ['0', '500'],
      50: ['0', '600'],
      51: ['0', '500'],
      52: ['0', '600'],
      53: ['600', '500'],
      54: ['500', '600'],
      55: ['600', '500'],
      56: ['500', '600'],
      57: ['600', '500'],
      58: ['500', '600'],
      59: ['0', 'ident'],
    };

    const WWV_STATIONS = {
      wwv: {
        prefix: 'v',
        label: 'WWV',
        voiceStartMs: 53500,
        atTheToneMs: 52500,
        toneIndex: 0,
        pulseHz: 1000,
      },
      wwvh: {
        prefix: 'h',
        label: 'WWVH',
        voiceStartMs: 46500,
        atTheToneMs: 45500,
        toneIndex: 1,
        pulseHz: 1200,
      },
    };

    // NIST SP 432 p.42 (100/50/50/75 relative to the 1 kHz pulse).
    // The pulse reference matches BPM's 0.56 peak so both stations align.
    const WWV_LEVELS = {
      pulse: 0.56,
      tone: 0.28,
      code: 0.28,
      voice: 0.42,
    };

    const SETTINGS_STORAGE_KEY = 'bpm_simulator_settings';
    const SettingsStore = {
      save() {
        const settings = {
          balanceVersion: 3,
          backendConfigVersion: TIME_API_CONFIG_VERSION,
          show_ms: document.getElementById('show_ms').checked,
          low_freq_volume: lowFreqVolume,
          bpmMorseAdjust: bpmMorseAdjust,
          bpmVoiceAdjust: bpmVoiceAdjust,
          wwvAdjustments: {
            wwv: { ...wwvAdjustments.wwv },
            wwvh: { ...wwvAdjustments.wwvh },
          },
          rwmAdjustments: { ...rwmAdjustments },
          rwmBeatHz: rwmBeatHz,
          rwmLockMode: rwmLockMode,
          masterVolume: masterVolume,
          noiseVolume: noiseVolume,
          ut1DetailMode: ut1DetailMode,
          localOffset: localOffset,
          networkCompensation: networkCompensation,
          dut1: window.bpmDUT1,
          forceUtcOnly: forceUtcOnly,
          showLocalTime: showLocalTime,
          autoSyncMode: autoSyncMode,
          dut1AutoMode: dut1AutoMode,
          dut1SourceMode: dut1SourceMode,
          stationVolumes: { ...stationVolumes },
          language: language,
        };
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
          // Ignore if localStorage is not available
        }
      },
      load() {
        try {
          const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
          if (!saved) return;
          SettingsStore.apply(JSON.parse(saved));
        } catch (e) {
          console.log('Failed to load settings, using defaults:', e);
        }
      },
      apply(settings) {
        if (typeof settings.show_ms === 'boolean') {
          document.getElementById('show_ms').checked = settings.show_ms;
        }
        if (typeof settings.ut1DetailMode === 'boolean') {
          ut1DetailMode = settings.ut1DetailMode;
        }
        if (settings.balanceVersion >= 3 && typeof settings.low_freq_volume === 'number') {
          lowFreqVolume = Math.min(2, Math.max(0, settings.low_freq_volume));
          const lowFreqSlider = document.getElementById('low_freq_volume');
          if (lowFreqSlider) lowFreqSlider.value = lowFreqVolume * 100;
          const lowFreqLabel = document.getElementById('low_freq_label');
          if (lowFreqLabel) lowFreqLabel.textContent = formatTcLabel(lowFreqVolume);
        }
        if (settings.balanceVersion >= 2 && typeof settings.bpmMorseAdjust === 'number') {
          bpmMorseAdjust = Math.min(1, Math.max(0, settings.bpmMorseAdjust));
        }
        if (settings.balanceVersion >= 2 && typeof settings.bpmVoiceAdjust === 'number') {
          bpmVoiceAdjust = Math.min(1, Math.max(0, settings.bpmVoiceAdjust));
        }
        if (settings.balanceVersion >= 2 && settings.wwvAdjustments && typeof settings.wwvAdjustments === 'object') {
          for (const station of ['wwv', 'wwvh']) {
            const saved = settings.wwvAdjustments[station];
            if (!saved || typeof saved !== 'object') continue;
            if (typeof saved.tone === 'number') {
              wwvAdjustments[station].tone = Math.min(1, Math.max(0, saved.tone));
            }
            if (typeof saved.code === 'number') {
              wwvAdjustments[station].code = Math.min(2, Math.max(0, saved.code));
            }
            if (typeof saved.voice === 'number') {
              wwvAdjustments[station].voice = Math.min(1, Math.max(0, saved.voice));
            }
          }
        }
        if (settings.balanceVersion >= 2 && settings.rwmAdjustments && typeof settings.rwmAdjustments === 'object') {
          if (typeof settings.rwmAdjustments.pulse10 === 'number') {
            rwmAdjustments.pulse10 = Math.min(1, Math.max(0, settings.rwmAdjustments.pulse10));
          }
          if (typeof settings.rwmAdjustments.morse === 'number') {
            rwmAdjustments.morse = Math.min(1, Math.max(0, settings.rwmAdjustments.morse));
          }
        }
        if (typeof settings.rwmBeatHz === 'number') {
          rwmBeatHz = clampRwmBeatHz(settings.rwmBeatHz);
        }
        if (settings.rwmLockMode === 'off' || settings.rwmLockMode === 'pulse1' || settings.rwmLockMode === 'pulse10') {
          rwmLockMode = settings.rwmLockMode;
        }
        if (typeof settings.noiseVolume === 'number') {
          noiseVolume = Math.min(1, Math.max(0, settings.noiseVolume));
          const noiseSlider = document.getElementById('noise_volume');
          if (noiseSlider) noiseSlider.value = noiseVolume;
          updateNoisePercentDisplay(noiseVolume);
        }
        if (typeof settings.localOffset === 'number') {
          localOffset = settings.localOffset;
        }
        if (typeof settings.networkCompensation === 'number') {
          networkCompensation = settings.networkCompensation;
          networkCompensation = Math.max(0, networkCompensation);
        }
        if (typeof settings.dut1 === 'number') {
          setCommonDut1(settings.dut1);
        }
        if (typeof settings.forceUtcOnly === 'boolean') {
          forceUtcOnly = settings.forceUtcOnly;
          document.getElementById('force_utc_mode').checked = forceUtcOnly;
        }
        if (typeof settings.showLocalTime === 'boolean') {
          showLocalTime = settings.showLocalTime;
          const localTimeCheckbox = document.getElementById('local_time_mode');
          if (localTimeCheckbox) localTimeCheckbox.checked = showLocalTime;
        }
        if (typeof settings.autoSyncMode === 'boolean') {
          autoSyncMode = settings.autoSyncMode;
          const autoCheckbox = document.getElementById('auto_sync_mode');
          if (autoCheckbox) autoCheckbox.checked = autoSyncMode;
        }
        if (typeof settings.dut1AutoMode === 'boolean') {
          dut1AutoMode = settings.dut1AutoMode;
          const autoDut1Checkbox = document.getElementById('auto_dut1_mode');
          if (autoDut1Checkbox) autoDut1Checkbox.checked = dut1AutoMode;
        }
        if (typeof settings.dut1SourceMode === 'string' && DUT1_SOURCE_MODES.includes(settings.dut1SourceMode)) {
          dut1SourceMode = settings.dut1SourceMode;
        }
        if (settings.stationVolumes && typeof settings.stationVolumes === 'object') {
          for (const station of ['bpm', 'wwv', 'wwvh', 'rwm']) {
            if (typeof settings.stationVolumes[station] === 'number') {
              stationVolumes[station] = Math.max(0, Math.min(1, settings.stationVolumes[station]));
            }
          }
        }
        if (settings.language === 'zh' || settings.language === 'en') {
          language = settings.language;
        }
      },
    };
    function saveSettings() {
      SettingsStore.save();
    }
    function loadSettings() {
      SettingsStore.load();
    }
    // Time code bit definition (fully implemented according to paper's BCD rule)
    function generateTimeCode(date, dut1Ms = window.bpmDUT1) {
      const bits = new Array(60).fill(0);
      const dut1InSeconds = dut1Ms / 1000;
      const dut1ForCode = Math.round(dut1InSeconds * 10) / 10;
      const minute = date.getUTCMinutes();
      const min_unit = minute % 10;
      const min_tens = Math.floor(minute / 10);
      bits[1] = (min_unit & 1) ? 1 : 0;
      bits[2] = (min_unit & 2) ? 1 : 0;
      bits[3] = (min_unit & 4) ? 1 : 0;
      bits[4] = (min_unit & 8) ? 1 : 0;
      bits[6] = (min_tens & 1) ? 1 : 0;
      bits[7] = (min_tens & 2) ? 1 : 0;
      bits[8] = (min_tens & 4) ? 1 : 0;
      bits[9] = 2;
      const hour = date.getUTCHours();
      const hour_unit = hour % 10;
      const hour_tens = Math.floor(hour / 10);
      bits[10] = (hour_unit & 1) ? 1 : 0;
      bits[11] = (hour_unit & 2) ? 1 : 0;
      bits[12] = (hour_unit & 4) ? 1 : 0;
      bits[13] = (hour_unit & 8) ? 1 : 0;
      bits[15] = (hour_tens & 1) ? 1 : 0;
      bits[16] = (hour_tens & 2) ? 1 : 0;
      bits[19] = 2;
      const day = date.getUTCDate();
      const day_unit = day % 10;
      const day_tens = Math.floor(day / 10);
      bits[20] = (day_unit & 1) ? 1 : 0;
      bits[21] = (day_unit & 2) ? 1 : 0;
      bits[22] = (day_unit & 4) ? 1 : 0;
      bits[23] = (day_unit & 8) ? 1 : 0;
      bits[25] = (day_tens & 1) ? 1 : 0;
      bits[26] = (day_tens & 2) ? 1 : 0;
      bits[29] = 2;
      const month = date.getUTCMonth() + 1;
      const month_unit = month % 10;
      const month_tens = Math.floor(month / 10);
      bits[30] = (month_unit & 1) ? 1 : 0;
      bits[31] = (month_unit & 2) ? 1 : 0;
      bits[32] = (month_unit & 4) ? 1 : 0;
      bits[33] = (month_unit & 8) ? 1 : 0;
      bits[35] = (month_tens & 1) ? 1 : 0;
      bits[39] = 2;
      const year = date.getUTCFullYear() % 100;
      const year_unit = year % 10;
      const year_tens = Math.floor(year / 10);
      bits[40] = (year_unit & 1) ? 1 : 0;
      bits[41] = (year_unit & 2) ? 1 : 0;
      bits[42] = (year_unit & 4) ? 1 : 0;
      bits[43] = (year_unit & 8) ? 1 : 0;
      bits[45] = (year_tens & 1) ? 1 : 0;
      bits[46] = (year_tens & 2) ? 1 : 0;
      bits[47] = (year_tens & 4) ? 1 : 0;
      bits[48] = (year_tens & 8) ? 1 : 0;
      bits[49] = 2;
      bits[50] = dut1ForCode > 0 ? 1 : 0;
      const absDut1 = Math.abs(dut1ForCode);
      const dut1_unit = Math.round(absDut1 * 10);
      bits[51] = (dut1_unit & 1) ? 1 : 0;
      bits[52] = (dut1_unit & 2) ? 1 : 0;
      bits[53] = (dut1_unit & 4) ? 1 : 0;
      bits[54] = (dut1_unit & 8) ? 1 : 0;
      bits[57] = 0;
      bits[59] = 2;
      return bits;
    }
    function isInTimeCodePeriod(minute, forceOnly = forceUtcOnly) {
      return forceOnly ? true : (minute >= 0 && minute < 10) ||
        (minute >= 15 && minute < 25) ||
        (minute >= 30 && minute < 40) ||
        (minute >= 45 && minute < 55);
    }
    function getPeriodType(utcMinute, utcSecond, utcMs) {
      const secondOfHour = utcMinute * 60 + utcSecond + utcMs / 1000;
      if (utcMinute == 29 || utcMinute == 59) {
        return 'call';
      }
      if ((utcMinute >= 10 && utcMinute < 15) ||
        (utcMinute >= 40 && utcMinute < 45)) {
        return 'carrier';
      }
      if ((secondOfHour >= 24 * 60 + 59 && secondOfHour < 29 * 60) ||
        (secondOfHour >= 54 * 60 + 59 && secondOfHour < 59 * 60)) {
        return 'ut1';
      }
      return 'utc';
    }
    // Preload the BPM voice announcement from its audio file.
    // decodeContext can be an OfflineAudioContext (8 kHz) to keep the voice
    // buffer small.
    function preloadVoiceAudio(decodeContext, onReady = null) {
      if (!decodeContext) return;
      if (voiceBuffer) {
        if (onReady) onReady();
        return;
      }
      const voiceUrl = 'audio/bpm/voice.mp3';
      fetch(voiceUrl, { cache: 'force-cache' })
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => decodeContext.decodeAudioData(arrayBuffer, (buffer) => {
          voiceBuffer = buffer;
          console.log('Voice audio loaded from URL');
          if (onReady) onReady();
        }, (e) => {
          console.log('Voice audio decode failed:', e);
        }))
        .catch(e => console.log('Voice audio fetch failed:', e));
    }
    // Gentle de-harsh EQ for the 8 kHz voice announcement. The clip itself has
    // no filter; this tames the 2–4 kHz presence region without touching the
    // 1 kHz time pulses or Morse. Adjust these two stages if it is still sharp.
    const VOICE_EQ_PEAK = Object.freeze({ frequency: 2800, Q: 0.8, gain: -3 });
    const VOICE_EQ_LOWPASS = Object.freeze({ frequency: 3800, Q: 0.7 });
    function createVoiceEQ(context) {
      const peak = context.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = VOICE_EQ_PEAK.frequency;
      peak.Q.value = VOICE_EQ_PEAK.Q;
      peak.gain.value = VOICE_EQ_PEAK.gain;
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = VOICE_EQ_LOWPASS.frequency;
      lowpass.Q.value = VOICE_EQ_LOWPASS.Q;
      peak.connect(lowpass);
      return { input: peak, output: lowpass };
    }
    // Update time display and signal type text
    function formatDut1Display(dut1Ms) {
      if (dut1Ms === 0) return '=';
      const dut1Sec = dut1Ms / 1000;
      return `${dut1Sec > 0 ? '+' : ''}${dut1Sec.toFixed(3)}`;
    }

    function clampDut1Ms(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(-999, Math.min(999, number)) : 0;
    }

    function setDut1Values(bpm, other, ut1) {
      window.bpmDUT1 = clampDut1Ms(bpm);
      window.otherDUT1 = clampDut1Ms(other);
      window.ut1DUT1 = clampDut1Ms(ut1);
    }

    function setCommonDut1(value) {
      const common = clampDut1Ms(value);
      setDut1Values(common, common, common);
      dut1SplitActive = false;
    }

    function formatUt1TimeHtml(ut1Now, showMs) {
      const ut1Text = showMs
        ? ut1Now.toISOString().substr(11, 12)
        : ut1Now.toISOString().substr(11, 8);
      const dotAt = ut1Text.indexOf('.');
      const baseText = dotAt >= 0 ? ut1Text.slice(0, dotAt) : ut1Text;
      const secStart = Math.max(0, baseText.length - 3);
      let html = `${baseText.slice(0, secStart)}<span class="ut1-sec">${baseText.slice(secStart)}</span>`;
      if (dotAt >= 0) {
        html += `<span class="ut1-ms"><span class="seg-dot">.</span>${ut1Text.slice(dotAt + 1)}</span>`;
      }
      return html;
    }

    let clockFaceNodes = null;

    function buildClockFaceNodes(timeEl) {
      const core = document.createElement('span');
      core.id = 'time_core';
      const hm = document.createElement('span');
      hm.className = 'main-hm';
      const sec = document.createElement('span');
      sec.className = 'main-sec text-4xl sm:text-5xl';
      const ms = document.createElement('span');
      ms.id = 'ms_display';
      ms.className = 'text-gray-400';
      const dot = document.createElement('span');
      dot.className = 'seg-dot';
      dot.textContent = '.';
      const digits = document.createElement('span');
      digits.className = 'ms-digits';
      ms.append(dot, digits);
      const tz = document.createElement('span');
      tz.id = 'timezone_offset';
      tz.style.display = 'none';
      core.append(hm, sec, ms, tz);
      timeEl.replaceChildren(core);
      return { timeEl, hm, sec, ms, digits, tz };
    }

    // Update the clock text in place. Rebuilding the span tree on every tick was
    // the largest source of DOM churn during long unattended sessions. Explicit
    // display values are used instead of a CSS class: #ms_display has an ID rule
    // that would otherwise override .hidden and leave the millisecond dot visible.
    function renderClockFace({ showMs, zoneLabelHtml, hours, mins, secs, msStr }) {
      const timeEl = getUi('time_display');
      if (!clockFaceNodes || clockFaceNodes.timeEl !== timeEl) {
        clockFaceNodes = buildClockFaceNodes(timeEl);
      }
      const nodes = clockFaceNodes;
      const hmText = `${hours}:${mins}`;
      const secText = `:${secs}`;
      if (nodes.hm.textContent !== hmText) nodes.hm.textContent = hmText;
      if (nodes.sec.textContent !== secText) nodes.sec.textContent = secText;
      const msDisplay = showMs ? 'inline-block' : 'none';
      if (nodes.ms.style.display !== msDisplay) nodes.ms.style.display = msDisplay;
      if (showMs && nodes.digits.textContent !== msStr) nodes.digits.textContent = msStr;
      const tzDisplay = zoneLabelHtml ? 'inline-block' : 'none';
      if (nodes.tz.style.display !== tzDisplay) nodes.tz.style.display = tzDisplay;
      if (zoneLabelHtml) {
        if (nodes.tz.innerHTML !== zoneLabelHtml) nodes.tz.innerHTML = zoneLabelHtml;
      } else if (nodes.tz.innerHTML) {
        nodes.tz.innerHTML = '';
      }
      applyOpticalCentering(timeEl, hmText, secText);
    }

    function customPercent(value) {
      return Math.round(value * 100);
    }

    function statusSubPercent(percent) {
      return `<span class="status-sub">${percent}<span class="status-subsub">%</span></span>`;
    }

    function formatTcLabel(value) {
      return `BCD(${String(Math.round(value * 100)).padStart(3, ' ')}%)`;
    }

    function bpmPeriodStatusHtml(period, second) {
      if (period === 'utc') {
        const percent = customPercent(lowFreqVolume);
        return percent > 0 ? `+BCD${statusSubPercent(percent)}` : '—';
      }
      if (period === 'carrier') return '∅';
      if (period === 'ut1') return 'UT1';
      if (period === 'call') {
        if (second < 40) {
          const percent = customPercent(bpmMorseAdjust);
          const percentPart = percent === 100 || percent === 0 ? '' : statusSubPercent(percent);
          const core = `MCid${percentPart} <span class="status-mono">-··· ·--· --</span>`;
          return percent === 0 ? `<span class="status-strike">${core}</span>` : core;
        }
        const percent = customPercent(bpmVoiceAdjust);
        const content = '标准时间\u200b标准频率\u200b发播台';
        if (percent === 0) {
          return `<span class="status-strike">\u{1F5E3} ${content}</span>`;
        }
        const percentPart = percent === 100 ? '' : statusSubPercent(percent);
        return percent === 100
          ? `\u{1F5E3} ${content}`
          : `\u{1F5E3}${percentPart}${content}`;
      }
      return '';
    }

    function selectedDut1SourceKey() {
      if (!dut1AutoMode || !dut1SplitActive) return '';
      if (dut1SourceMode === 'ntsc' || dut1SourceMode === 'iers') return dut1SourceMode;
      if (dut1SourceMode === 'auto') return dut1AutoPrimaryKey || '';
      return '';
    }

    function shouldShowBpmDut1Status() {
      if (!ut1DetailMode) return true;
      return selectedDut1SourceKey() === 'iers'
        && Math.round(window.bpmDUT1) !== Math.round(window.ut1DUT1);
    }

    function renderPeriodStatus({ period, second }) {
      const periodEl = getUi('current_period');
      if (forceUtcOnly) {
        const bcd = bpmPeriodStatusHtml('utc', second);
        periodEl.innerHTML = `UTC${bcd === '—' ? '' : bcd}`;
      } else {
        periodEl.innerHTML = bpmPeriodStatusHtml(period, second);
      }
      const lockEl = getUi('bpm_utc_lock');
      if (lockEl) lockEl.classList.toggle('hidden', !forceUtcOnly);
      const dut1El = getUi('bpm_dut1');
      if (dut1El) {
        const showDut1 = !forceUtcOnly && period === 'ut1' && shouldShowBpmDut1Status();
        dut1El.textContent = showDut1 ? formatDut1Display(window.bpmDUT1) : '';
        dut1El.classList.toggle('hidden', !showDut1);
      }
    }

    function wwvDut1PulseStatus(second, dut1Ms) {
      const tenths = Math.min(8, Math.round(Math.abs(Number(dut1Ms) || 0) / 100));
      if (!tenths) return '';
      const negative = Number(dut1Ms) < 0;
      const start = negative ? 9 : 1;
      if (second < start || second >= start + tenths) return '';
      const count = second - start + 1;
      const sign = negative ? '\u2212' : '+';
      return `${sign}0.${count}`;
    }

    function shouldShowOtherStationDut1Value() {
      if (!ut1DetailMode) return true;
      return Math.round(window.ut1DUT1) !== Math.round(window.otherDUT1);
    }

    function renderWWVStationStatuses(utcNow) {
      const minute = utcNow.getUTCMinutes();
      const second = utcNow.getUTCSeconds();
      const nowMs = utcNow.getTime();
      const minuteStart = Math.floor(nowMs / 60000) * 60000;
      for (const [stationId, config] of Object.entries(WWV_STATIONS)) {
        const statusEl = getUi(`${stationId}_status`);
        if (!statusEl) continue;
        const base = WWV_TONE_SCHEDULE[minute][config.toneIndex];
        const clips = buildWWVVoiceClips(config, minuteStart);
        const voiceStart = clips.length ? clips[0].startMs : Infinity;
        const lastClip = clips[clips.length - 1];
        const voiceEnd = lastClip ? lastClip.startMs + lastClip.durationMs : -Infinity;
        const offsetMs = nowMs - minuteStart;
        const voiceActive = offsetMs >= voiceStart && offsetMs < voiceEnd;
        const identDuration = wwvIdentDurations[config.prefix]
          || wwvIdentFallbackDurations[config.prefix]
          || 0;
        const identStartMs = 1000;
        const identActive = identDuration > 0 && base === 'ident' && (
          offsetMs >= identStartMs && offsetMs < identStartMs + identDuration
        );
        let html = '';
        const adjust = wwvAdjustments[stationId];
        const codePercent = customPercent(adjust.code);
        const tonePercent = customPercent(adjust.tone);
        const voicePercent = customPercent(adjust.voice);
        if (codePercent === 0) {
          html = '<span class="status-strike">BCD</span>';
        } else {
          html = `BCD${codePercent === 100 ? '' : statusSubPercent(codePercent)}`;
        }
        if (identActive) {
          const content = 'StationIntroduction';
          if (voicePercent === 0) {
            html += '+<span class="status-strike">\u{1F5E3} ' + content + '</span>';
          } else if (voicePercent === 100) {
            html += `+\u{1F5E3} ${content}`;
          } else {
            html += `+\u{1F5E3}${statusSubPercent(voicePercent)}${content}`;
          }
        } else if (voiceActive) {
          const announced = new Date(minuteStart + 60000);
          const hh = String(announced.getUTCHours()).padStart(2, '0');
          const mm = String(announced.getUTCMinutes()).padStart(2, '0');
          const content = `${hh}:${mm} UTC`;
          if (voicePercent === 0) {
            html += '+<span class="status-strike">\u{1F5E3} ' + content + '</span>';
          } else if (voicePercent === 100) {
            html += `+\u{1F5E3} ${content}`;
          } else {
            html += `+\u{1F5E3}${statusSubPercent(voicePercent)}${content}`;
          }
        } else if (base !== '0' && /^\d+$/.test(base) && second > 0 && second <= 44) {
          if (tonePercent === 0) {
            html += `+<span class="status-strike">♪${base}</span>`;
          } else if (tonePercent === 100) {
            html += `+♪${base}`;
          } else {
            html += `+♪${statusSubPercent(tonePercent)}${base}`;
          }
        }
        const dut1Pulse = wwvDut1PulseStatus(second, window.otherDUT1);
        if (dut1Pulse) {
          html += '<span class="status-dut1-label">+DUT1</span>';
          if (shouldShowOtherStationDut1Value()) {
            html += `<span class="status-dut1-value">${dut1Pulse}</span>`;
          }
        }
        if (statusEl.innerHTML !== html) statusEl.innerHTML = html;
      }
    }

    function rwmModeForMinute(minute, lockMode = rwmLockMode) {
      if (lockMode === 'pulse1') return 'pulse1';
      if (lockMode === 'pulse10') return 'pulse10';
      const m = minute % 30;
      if (m < 8) return 'carrier';
      if (m === 8) return 'off';
      if (m === 9) return 'ident';
      if (m < 20) return 'pulse1';
      return 'pulse10';
    }

    function rwmPulseTailSecond(minute, second, lockMode = rwmLockMode) {
      if (lockMode === 'pulse1' || lockMode === 'pulse10') return false;
      const m = minute % 30;
      return second >= 55 && (m === 19 || m === 29);
    }

    function rwmDut1State(dut1Ms) {
      const doubleSeconds = [];
      const extraSeconds = [];
      const tenths = Math.max(-8, Math.min(8, Math.round(dut1Ms / 100)));
      if (tenths > 0) {
        for (let i = 1; i <= tenths; i += 1) doubleSeconds.push(i);
      } else if (tenths < 0) {
        for (let i = 1; i <= Math.abs(tenths); i += 1) doubleSeconds.push(8 + i);
      }
      const residual = dut1Ms - tenths * 100;
      const steps = Math.max(-4, Math.min(4, Math.round(residual / 20)));
      if (steps > 0) {
        for (let i = 1; i <= steps; i += 1) extraSeconds.push(20 + i);
      } else if (steps < 0) {
        for (let i = 1; i <= Math.abs(steps); i += 1) extraSeconds.push(30 + i);
      }
      return {
        doubleSeconds,
        extraSeconds,
        dut1Sign: tenths > 0 ? 1 : (tenths < 0 ? -1 : 0),
        dSign: steps > 0 ? 1 : (steps < 0 ? -1 : 0),
      };
    }

    function rwmDut1PulseStatus(second, dut1Ms) {
      const state = rwmDut1State(dut1Ms);
      const tenths = Math.max(-8, Math.min(8, Math.round(Number(dut1Ms) / 100)));
      if (state.doubleSeconds.includes(second)) {
        const count = state.doubleSeconds.indexOf(second) + 1;
        const sign = state.dut1Sign > 0 ? '+' : '\u2212';
        return {
          label: `D${sign}`,
          value: `${sign}${(count / 10).toFixed(1)}`,
        };
      }
      if (state.extraSeconds.includes(second)) {
        const count = state.extraSeconds.indexOf(second) + 1;
        const pulseSign = state.dSign > 0 ? '+' : '\u2212';
        const total = tenths * 0.1 + state.dSign * count * 0.02;
        const sign = total < 0 ? '\u2212' : '+';
        return {
          label: `d${pulseSign}`,
          value: `${sign}${Math.abs(total).toFixed(2)}`,
        };
      }
      return null;
    }

    function renderRWMStatus(utcNow) {
      const statusEl = getUi('rwm_status');
      if (!statusEl) return;
      const minute = utcNow.getUTCMinutes();
      const second = utcNow.getUTCSeconds();
      const mode = rwmModeForMinute(minute);
      let html = mode === 'off' ? '×' : '∅';
      if (mode === 'ident') {
        if (second < 55) {
          const percent = customPercent(rwmAdjustments.morse);
          const percentPart = percent === 100 || percent === 0 ? '' : statusSubPercent(percent);
          const core = `MCid${percentPart} <span class="status-mono">·-· ·-- --</span>`;
          html = percent === 0 ? `<span class="status-strike">${core}</span>` : core;
        } else {
          html = '∅';
        }
      } else if (mode === 'pulse1') {
        if (rwmPulseTailSecond(minute, second)) {
          html = '∅';
        } else {
          const pulseStatus = rwmDut1PulseStatus(second, window.otherDUT1);
          html = pulseStatus
            ? `<span class="status-rwm-pulse-label">${pulseStatus.label}</span>${shouldShowOtherStationDut1Value()
              ? `<span class="status-rwm-pulse-value">${pulseStatus.value}</span>`
              : ''}`
            : '—';
        }
      } else if (mode === 'pulse10') {
        if (!rwmPulseTailSecond(minute, second)) {
          const percent = customPercent(rwmAdjustments.pulse10);
          if (percent === 0) {
            html = '1_Hz';
          } else if (percent === 100) {
            html = '10Hz';
          } else {
            html = `10Hz<span class="status-sub">${percent}<span class="status-subsub">%</span>·ds</span>`;
          }
        } else {
          html = '∅';
        }
      }
      if (rwmLockMode !== 'off') {
        html = `<span class="status-lock">&#128274;</span>${html}`;
      }
      if (statusEl.innerHTML !== html) statusEl.innerHTML = html;
    }

    function renderUt1Status({ utcNow, period, showMs }) {
      const ut1TimeEl = getUi('ut1_time');
      const ut1IndicatorEl = getUi('ut1_indicator');
      const ut1CheckboxEl = getUi('ut1_detail_mode');
      if (ut1CheckboxEl) ut1CheckboxEl.checked = ut1DetailMode;
      ut1TimeEl.classList.remove('seven-seg');
      if (ut1IndicatorEl) ut1IndicatorEl.classList.add('hidden');
      ut1TimeEl.classList.remove('text-yellow-400', 'text-gray-400');
      ut1TimeEl.classList.add('text-green-400');

      if (ut1DetailMode) {
        // The switch means "show UT1 time" continuously, regardless of
        // whether the current UTC segment is an UT1 broadcast window.
        const ut1Now = new Date(utcNow.getTime() + window.ut1DUT1);
        ut1TimeEl.innerHTML = formatUt1TimeHtml(ut1Now, showMs);
        ut1TimeEl.classList.add('seven-seg');
        if (ut1IndicatorEl) ut1IndicatorEl.classList.remove('hidden');
      } else {
        ut1TimeEl.textContent = '';
      }
    }

    function syncAutoDut1ForDate(utcNow) {
      if (!window.isAutoDUT1 || !dut1AutoSeriesBySource) return;
      const currentKey = dut1DateKey(utcNow);
      if (!applyDut1ForDate(utcNow)) return;
      updateOffsetDisplay();
      if (dut1AutoMode) {
        if (dut1AutoLastData) {
          setDut1CompactStatus(dut1AutoLastData, currentKey);
        } else {
          setEopStatus(`API@${currentKey}`, 'text-green-400', 'DUT1 value switched for the new UTC date');
        }
      } else {
        const status = getUi('eop_status');
        status.textContent = `${window.currentDataSource ?? 'Auto'} @ ${currentKey}`;
        status.classList.remove('text-red-400', 'text-yellow-400');
        status.classList.add('text-green-400');
      }
    }

    function invalidateTimeRender() {
      lastTimeRenderKey = null;
      lastUt1StatusRenderKey = null;
    }

    function applyAntiBurnIfNeeded(minute) {
      if (!zenModeActive || !antiBurnActive || minute === lastAntiBurnMinute) return;
      lastAntiBurnMinute = minute;
      applyAntiBurnShift(minute);
    }

    function clockEmojiFor(date) {
      const hour = date.getUTCHours() % 12 || 12;
      const halfHour = date.getUTCMinutes() >= 30 ? 1 : 0;
      const index = halfHour ? 12 + (hour - 1) : hour - 1;
      return String.fromCodePoint(0x1F550 + index);
    }

    function updateClockEmoji(clockNow) {
      const el = getUi('clock_emoji');
      if (!el) return;
      const emoji = clockEmojiFor(clockNow);
      if (el.textContent !== emoji) el.textContent = emoji;
    }

    let lastTimeStatusRenderKey = null;

    // Split the clock into a cheap per-tick face update and status blocks that
    // only need to change once per second (or when their state actually changes).
    function updateTimeDisplay() {
      // A hidden tab renders nothing; the visibility handler restarts this loop
      // with a fresh frame when the page becomes visible again.
      if (document.hidden) return;
      monitorSystemClock();
      const hintSecond = Math.floor(Date.now() / 1000);
      if (hintSecond !== lastLocalHintStamp) {
        lastLocalHintStamp = hintSecond;
        updateLocalTimeHint();
      }
      const now = new Date();
      const displayOffset = localOffset + GLOBAL_OFFSET_MS;
      const utcNow = new Date(now.getTime() + displayOffset);
      const localInfo = showLocalTime ? getLocalTimeInfo(utcNow) : null;
      const clockNow = localInfo ? localInfo.localNow : utcNow;
      const hours = String(clockNow.getUTCHours()).padStart(2, '0');
      const mins = String(clockNow.getUTCMinutes()).padStart(2, '0');
      const secs = String(clockNow.getUTCSeconds()).padStart(2, '0');
      const msStr = String(clockNow.getUTCMilliseconds()).padStart(3, '0');
      const zoneLabelHtml = localInfo ? formatZoneLabel(localInfo) : '';
      const showMs = getUi('show_ms').checked;
      const second = utcNow.getUTCSeconds();
      const minute = utcNow.getUTCMinutes();
      const period = forceUtcOnly ? 'utc' : getPeriodType(minute, second, utcNow.getUTCMilliseconds());
      const statusKey = [
        forceUtcOnly ? 'force' : 'broadcast',
        localInfo ? localInfo.zoneText : '',
        hours, mins, secs,
        period, second,
        Math.round(lowFreqVolume * 100),
        Math.round(bpmMorseAdjust * 100), Math.round(bpmVoiceAdjust * 100),
        JSON.stringify(wwvAdjustments),
        JSON.stringify(rwmAdjustments),
        rwmLockMode,
        ut1DetailMode ? 'ut1-detail' : 'ut1-auto',
        window.bpmDUT1, window.otherDUT1, window.ut1DUT1,
        dut1SplitActive ? 'dut1-split' : 'dut1-common',
      ].join('|');
      renderClockFace({ showMs, zoneLabelHtml, hours, mins, secs, msStr });
      if (statusKey !== lastTimeStatusRenderKey) {
        lastTimeStatusRenderKey = statusKey;
        updateClockEmoji(utcNow);
        renderPeriodStatus({ period, second });
        renderWWVStationStatuses(utcNow);
        renderRWMStatus(utcNow);
        renderUt1Status({ utcNow, period, showMs });
        lastStationStatusRefreshAt = utcNow.getTime();
        syncAutoDut1ForDate(utcNow);
      } else if (ut1DetailMode) {
        renderUt1Status({ utcNow, period, showMs });
      }
      applyAntiBurnIfNeeded(minute);
    }

    function masterIconForVolume(value) {
      if (value <= 0.001) return '\u{1F507}';
      if (value < 0.34) return '\u{1F508}';
      if (value < 0.67) return '\u{1F509}';
      return '\u{1F50A}';
    }

    function setMasterLoading(active) {
      const icon = getUi('master_icon');
      const spinner = getUi('master_loading');
      if (!icon || !spinner) return;
      if (active) {
        icon.classList.add('hidden');
        spinner.classList.remove('hidden');
        return;
      }
      spinner.classList.add('hidden');
      icon.classList.remove('hidden');
      updateMasterVolumeDisplay();
    }

    function updateMasterVolumeDisplay() {
      const slider = getUi('master_volume');
      const icon = getUi('master_icon');
      if (slider) slider.value = String(masterVolume);
      if (icon) icon.textContent = masterIconForVolume(masterVolume);
    }

    function updateNoiseVolume(value) {
      noiseVolume = value;
      NextAudio.setNoiseVolume(value);
      updateNoisePercentDisplay(value);
      saveSettings();
    }
    function updateNoisePercentDisplay(value) {
      const percentSpan = document.getElementById('noise_volume_percent');
      if (percentSpan) {
        const percent = Math.round(value * 100);
        percentSpan.textContent = percent.toString().padStart(3, '');
      }
    }

    function displayUtcNowMs() {
      return Date.now() + localOffset + GLOBAL_OFFSET_MS;
    }
    function getCarrierWindow(nowMs) {
      const d = new Date(nowMs);
      const minute = d.getUTCMinutes();
      let startMinute = null;
      if (minute >= 10 && minute < 15) startMinute = 10;
      else if (minute >= 40 && minute < 45) startMinute = 40;
      if (startMinute === null) return null;
      const startMs = Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
        d.getUTCHours(), startMinute, 0, 0,
      );
      return { startMs, endMs: startMs + 5 * 60000, key: startMs };
    }
    function cancelScheduledCarrierSync() {
      if (syncController.autoTimeout) {
        clearTimeout(syncController.autoTimeout);
        syncController.autoTimeout = null;
      }
      syncController.autoScheduled = false;
      syncController.autoScheduledKey = 0;
    }
    function markCurrentCarrierHandled() {
      if (forceUtcOnly) return;
      const win = getCarrierWindow(displayUtcNowMs());
      if (!win) return;
      syncController.lastAutoSegment = win.key;
      if (syncController.autoScheduled && syncController.autoScheduledKey === win.key) {
        cancelScheduledCarrierSync();
      }
    }
    function scheduleAutoSync() {
      if (!autoSyncMode || forceUtcOnly) return;
      const nowMs = displayUtcNowMs();
      const win = getCarrierWindow(nowMs);
      if (!win) return;
      if (syncController.lastAutoSegment === win.key) return;
      if (syncController.autoScheduled && syncController.autoScheduledKey === win.key) return;
      const latest = win.endMs - 60000;
      if (nowMs >= latest) return;
      if (syncController.autoScheduled) cancelScheduledCarrierSync();
      const delay = Math.max(0, (latest - nowMs) * Math.random());
      syncController.autoScheduled = true;
      syncController.autoScheduledKey = win.key;
      syncController.autoTimeout = setTimeout(() => {
        syncController.autoTimeout = null;
        syncController.autoScheduled = false;
        syncController.autoScheduledKey = 0;
        if (!autoSyncMode || forceUtcOnly) return;
        const currentWin = getCarrierWindow(displayUtcNowMs());
        if (!currentWin || currentWin.key !== win.key) return;
        triggerSyncButtonClick('carrier');
      }, delay);
    }
    function startAutoSync() {
      if (!autoSyncMode) return;
      if (syncController.autoTimer) clearInterval(syncController.autoTimer);
      syncController.autoTimer = setInterval(() => {
        if (autoSyncMode) scheduleAutoSync();
      }, 1000);
      scheduleAutoSync();
    }
    function stopAutoSync() {
      if (syncController.autoTimer) {
        clearInterval(syncController.autoTimer);
        syncController.autoTimer = null;
      }
      cancelScheduledCarrierSync();
      if (syncController.afterDoneTimer) {
        clearTimeout(syncController.afterDoneTimer);
        syncController.afterDoneTimer = null;
      }
      syncController.lastAutoSegment = -1;
    }
    function updateZenStationVisibility() {
      document.querySelectorAll('.station-item').forEach((item) => {
        const station = item.dataset.station;
        const percent = Math.round((Number(stationVolumes[station]) || 0) * 100);
        item.classList.toggle('zen-muted-station', percent <= 0);
        item.classList.toggle('station-zero', percent <= 0);
      });
    }

    function applyZenLayout() {
      const mixer = document.getElementById('station_mixer');
      const statusBar = document.getElementById('status_bar');
      if (!mixer || !statusBar) return;
      if (!zenModeActive) {
        mixer.classList.remove('zen-hidden', 'zen-stations');
        statusBar.classList.remove('zen-hidden');
        updateZenStationVisibility();
        return;
      }
      const paused = !(isRunning && masterVolume > 0);
      document.querySelectorAll('.station-item.expanded').forEach((item) => {
        item.classList.remove('expanded');
      });
      document.querySelectorAll('[data-station-toggle]').forEach((toggle) => {
        toggle.setAttribute('aria-expanded', 'false');
      });
      mixer.classList.toggle('zen-hidden', paused);
      statusBar.classList.toggle('zen-hidden', paused);
      mixer.classList.toggle('zen-stations', !paused);
      updateZenStationVisibility();
    }

    function enterZenMode() {
      if (zenModeActive) return;
      const controls = [
        document.getElementById('master_control'),
        document.getElementById('settings_panel')
      ];
      controls.forEach(el => {
        if (el) el.classList.add('zen-hidden');
      });
      if (document.getElementById('settings_panel') && !document.getElementById('settings_panel').classList.contains('hidden')) {
        document.getElementById('settings_panel').classList.add('hidden');
        closeDeviceMenu();
        hideOffsetAdjustRows();
      }
      zenModeActive = true;
      zenFullscreenObserved = !!(
        document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
      );
      applyZenLayout();
      updateZenOffsetBadge();
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(err => console.warn('Enter fullscreen failed:', err));
      }
      requestWakeLock();
      startAntiBurnShift();
    }
    function exitZenMode() {
      if (!zenModeActive) return;
      const controls = [
        document.getElementById('master_control'),
        document.getElementById('settings_panel')
      ];
      controls.forEach(el => {
        if (el) el.classList.remove('zen-hidden');
      });
      zenModeActive = false;
      zenFullscreenObserved = false;
      applyZenLayout();
      updateZenOffsetBadge();
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn('Exit fullscreen failed:', err));
      }
      releaseWakeLock();
      stopAntiBurnShift();
    }
    let lastZenActivation = 0;
    function activateZenModeFromClick() {
      const now = Date.now();
      if (now - lastZenActivation < 400) return;
      lastZenActivation = now;
      toggleZenMode();
    }
    function toggleZenMode() {
      if (zenModeActive) {
        exitZenMode();
      } else {
        enterZenMode();
      }
    }
    function onFullscreenChange() {
      const isFullscreen = !!(
        document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
      );
      if (isFullscreen) {
        if (zenModeActive) zenFullscreenObserved = true;
        return;
      }
      if (zenModeActive && zenFullscreenObserved) {
        zenFullscreenObserved = false;
        exitZenMode();
      }
    }

    function clockContentRect(el) {
      if (!el) return null;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) return rect;
      } catch (e) { }
      return el.getBoundingClientRect();
    }

    function clockRectHit(rect, x, y, padX = 2, padY = 4) {
      if (!rect) return false;
      return x >= rect.left - padX && x <= rect.right + padX
        && y >= rect.top - padY && y <= rect.bottom + padY;
    }

    function timeDisplayRegionAt(x, y) {
      const display = getUi('time_display');
      if (!display) return '';
      const offsetEl = display.querySelector('#timezone_offset');
      if (offsetEl && !offsetEl.classList.contains('hidden')
        && clockRectHit(clockContentRect(offsetEl), x, y, 4, 4)) {
        return 'offset';
      }
      const msEl = display.querySelector('#ms_display');
      if (msEl && clockRectHit(clockContentRect(msEl), x, y, 3, 4)) {
        return 'ms';
      }
      const secEl = display.querySelector('.main-sec');
      if (secEl && clockRectHit(clockContentRect(secEl), x, y, 2, 4)) {
        return 'seconds';
      }
      const hmEl = display.querySelector('.main-hm');
      if (hmEl && clockRectHit(clockContentRect(hmEl), x, y, 2, 4)) {
        return 'hm';
      }
      return '';
    }

    let lastClockHotzoneRegion = '';
    let lastClockHotzoneAt = 0;
    function handleTimeDisplayHotzone(event) {
      if (!event || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
      const region = timeDisplayRegionAt(event.clientX, event.clientY);
      if (!region) return;
      const now = Date.now();
      if (region === lastClockHotzoneRegion && now - lastClockHotzoneAt < 350) return;
      lastClockHotzoneRegion = region;
      lastClockHotzoneAt = now;
      if (zenModeActive && event.type === 'pointerup') {
        // This pointerup is about to restore the normal layout while the same
        // gesture's click is still in flight. Arm a one-click shield so that
        // click cannot activate whatever control appears under the pointer.
        zenExitClickGuardUntil = performance.now() + 700;
      }
      if (region === 'hm') {
        activateZenModeFromClick();
      } else {
        openSettingsTab('display');
      }
    }
    function calcShiftPercent(utcMinute) {
      const factor = 1.5;
      let minute = utcMinute % 60;
      if (minute <= 30) {
        return (-15 + minute) * factor;
      } else {
        return (15 - (minute - 30)) * factor;
      }
    }

    function applyAntiBurnShift(minute) {
      if (!antiBurnActive || !zenModeActive) return;
      if (!mainContainer) mainContainer = document.querySelector('.max-w-3xl');
      if (!mainContainer) return;
      const shiftPercent = calcShiftPercent(minute);
      if (typeof shiftPercent !== 'number') return;
      mainContainer.style.transform = `translateY(${shiftPercent}vh)`;
    }

    function startAntiBurnShift() {
      if (antiBurnActive) return;
      antiBurnActive = true;
      lastAntiBurnMinute = null;
    }

    function stopAntiBurnShift() {
      antiBurnActive = false;
      lastAntiBurnMinute = null;
      if (mainContainer) mainContainer.style.transform = '';
    }
    function updateAutoSyncUI() {
      const localOffsetDiv = document.getElementById('clock_offset_section');
      if (!localOffsetDiv) return;
      const allButtons = localOffsetDiv.querySelectorAll('button');
      allButtons.forEach(btn => {
        if (btn.id === 'sync_log_btn') return;
        if (btn.getAttribute('data-offset') !== 'comp') {
          btn.style.display = autoSyncMode ? 'none' : '';
        }
      });
      const syncBtn = document.getElementById('sync_btn');
      if (syncBtn) syncBtn.style.display = autoSyncMode ? 'none' : '';
    }

    function triggerSyncButtonClick(reason = 'manual') {
      const syncBtn = document.getElementById('sync_btn');
      if (!syncBtn || syncBtn.disabled) return false;
      pendingSyncReason = reason;
      syncBtn.click();
      return true;
    }

    function scheduleSyncAfterDone(reason = 'deferred') {
      if (syncController.afterDoneTimer) return;
      syncController.afterDoneTimer = setTimeout(() => {
        syncController.afterDoneTimer = null;
        if (!autoSyncMode) return;
        if (!triggerSyncButtonClick(reason)) scheduleSyncAfterDone(reason);
      }, 3200);
    }
    function updateOffsetDisplay() {
      const localSec = localOffset / 1000;
      const dut1Sec = window.ut1DUT1 / 1000;
      document.getElementById('local_offset_val').textContent = (localSec > 0 ? '+' : '') + localSec.toFixed(3);
      const compEl = document.getElementById('network_comp_val');
      if (compEl) {
        const sign = deviceExtraMs > 0 ? '+' : '';
        const devicePart = deviceExtraMs
          ? `<span style="color:${DEVICE_ACCENT_COLOR};font-weight:700;">${sign}${deviceExtraMs}</span>`
          : '';
        compEl.innerHTML = `(+${networkCompensation}${devicePart}ms)`;
      }
      document.getElementById('dut1_val').textContent = (dut1Sec > 0 ? '+' : '') + dut1Sec.toFixed(3);
      saveSettings();
      NextAudio.onTimingChanged();
    }
    function formatGlobalOffsetLabel(minutes) {
      if (!minutes) return '';
      const sign = minutes > 0 ? '+' : '-';
      const absMinutes = Math.abs(minutes);
      const hours = Math.floor(absMinutes / 60);
      const remainder = absMinutes % 60;
      if (hours === 0) return `${sign}${remainder}min`;
      if (remainder === 0) return `${sign}${hours}h`;
      return `${sign}${hours}h${remainder}min`;
    }

    function updateGlobalOffsetIndicator() {
      const el = getUi('global_offset_indicator');
      if (!el) return;
      const label = formatGlobalOffsetLabel(GLOBAL_OFFSET_MINUTES);
      if (!label) {
        el.textContent = '';
        el.classList.add('hidden');
        return;
      }
      el.textContent = label;
      el.classList.remove('hidden');
    }

    function updateZenOffsetBadge() {
      const badge = getUi('zen_offset_badge');
      if (!badge) return;
      const label = formatGlobalOffsetLabel(GLOBAL_OFFSET_MINUTES);
      // While playing at a non-zero master volume, the normal status bar is
      // still visible. The badge fills in when Zen is effectively silent.
      if (!zenModeActive || (isRunning && masterVolume > 0) || !label) {
        badge.classList.add('hidden');
        return;
      }
      badge.textContent = label;
      badge.classList.remove('hidden');
    }
    function setOffsetAdjustRowVisible(id, visible) {
      const row = document.getElementById(id);
      if (!row) return;
      row.classList.toggle('hidden', !visible);
      row.classList.toggle('grid', visible);
      row.classList.toggle('grid-cols-5', visible);
    }
    function setDeviceDeleteVisible(visible) {
      const deleteBtn = document.getElementById('device_delete_btn');
      if (deleteBtn) deleteBtn.classList.toggle('hidden', !visible);
    }
    function hideOffsetAdjustRows() {
      setOffsetAdjustRowVisible('base_comp_controls', false);
      setOffsetAdjustRowVisible('device_adjust_controls', false);
      setDeviceDeleteVisible(false);
    }

    // ===== Device profiles: base compensation + per-device extra =====
    function normalizeDeviceName(name) {
      return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    }
    function clampDeviceOffset(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(-9999, Math.min(9999, Math.round(n)));
    }
    function sortedDeviceNames() {
      return Object.keys(deviceProfiles.profiles).sort((a, b) => {
        const offsetDiff = deviceProfiles.profiles[a].offsetMs - deviceProfiles.profiles[b].offsetMs;
        if (offsetDiff !== 0) return offsetDiff;
        return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      });
    }
    function formatDeviceOffset(ms) {
      return `${ms > 0 ? '+' : ''}${ms}ms`;
    }
    function loadDeviceProfiles() {
      let parsed = null;
      try {
        const raw = localStorage.getItem(DEVICE_PROFILES_KEY);
        if (raw) parsed = JSON.parse(raw);
      } catch (e) { }
      const profiles = {};
      if (parsed && parsed.version === 1 && parsed.profiles && typeof parsed.profiles === 'object') {
        for (const [rawName, entry] of Object.entries(parsed.profiles)) {
          const name = normalizeDeviceName(rawName);
          if (!name || profiles[name]) continue;
          const offset = Number(entry && entry.offsetMs);
          if (!Number.isFinite(offset)) continue;
          profiles[name] = { offsetMs: clampDeviceOffset(offset) };
        }
      }
      if (Object.keys(profiles).length === 0) {
        profiles[DEVICE_DEFAULT_NAME] = { offsetMs: 0 };
      }
      let active = parsed && typeof parsed.active === 'string'
        ? normalizeDeviceName(parsed.active)
        : DEVICE_DEFAULT_NAME;
      if (!profiles[active]) {
        active = profiles[DEVICE_DEFAULT_NAME]
          ? DEVICE_DEFAULT_NAME
          : Object.keys(profiles).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))[0];
      }
      deviceProfiles = { version: 1, active, profiles };
      activeDeviceName = active;
      deviceExtraMs = profiles[active].offsetMs;
    }
    function saveDeviceProfiles() {
      try {
        localStorage.setItem(DEVICE_PROFILES_KEY, JSON.stringify({
          version: 1,
          active: activeDeviceName,
          profiles: deviceProfiles.profiles,
        }));
      } catch (e) { }
    }
    function closeDeviceMenu() {
      const menu = document.getElementById('device_menu');
      if (menu) menu.classList.add('hidden');
    }
    function renderDeviceMenu() {
      const menu = document.getElementById('device_menu');
      if (!menu) return;
      menu.innerHTML = '';
      for (const name of sortedDeviceNames()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.deviceName = name;
        item.className = 'w-full flex items-center justify-between gap-2 px-2 py-1 rounded font-sans text-sm text-gray-300 hover:bg-dark-600 transition';
        if (name === activeDeviceName) {
          item.style.color = DEVICE_ACCENT_COLOR;
          item.style.fontWeight = '700';
        }
        const label = document.createElement('span');
        label.className = 'truncate min-w-0';
        label.textContent = name;
        const value = document.createElement('span');
        value.className = 'font-mono text-xs text-fuchsia-400 whitespace-nowrap';
        value.textContent = formatDeviceOffset(deviceProfiles.profiles[name].offsetMs);
        item.appendChild(label);
        item.appendChild(value);
        menu.appendChild(item);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.dataset.deviceAdd = '1';
      add.className = 'w-full text-left px-2 py-1 rounded font-mono text-sm text-gray-400 hover:bg-dark-600 transition';
      add.textContent = '+';
      add.setAttribute('aria-label', 'Add device');
      menu.appendChild(add);
    }
    function renderDeviceProfileUI() {
      const nameText = document.getElementById('device_name_text');
      if (nameText) nameText.textContent = activeDeviceName;
      const nameBtn = document.getElementById('device_name_btn');
      if (nameBtn) nameBtn.setAttribute('aria-label', `${activeDeviceName} · Device Profile`);
      const offsetEl = document.getElementById('device_offset_val');
      if (offsetEl) offsetEl.textContent = formatDeviceOffset(deviceExtraMs);
      renderDeviceMenu();
    }
    function flushDelayCalibration() {
      if (delayCalibrationTimer) {
        clearTimeout(delayCalibrationTimer);
        delayCalibrationTimer = null;
      }
      if (!delayCalibrationStart) return;
      const start = delayCalibrationStart;
      const steps = delayCalibrationSteps;
      const durationMs = Math.max(0, delayCalibrationLastAt - start.at);
      delayCalibrationStart = null;
      delayCalibrationLastAt = 0;
      delayCalibrationSteps = 0;
      if (typeof recordClockTrace !== 'function') return;
      recordClockTrace('CALIBRATION', {
        networkCompMs: networkCompensation,
        deviceExtraMs,
        calibrationSteps: steps,
        calibrationDurationMs: durationMs,
        networkCompBeforeMs: start.networkCompensation,
        deviceExtraBeforeMs: start.deviceExtraMs,
      });
    }

    function noteDelayCalibration() {
      const now = Date.now();
      if (!delayCalibrationStart) {
        delayCalibrationStart = {
          at: now,
          networkCompensation,
          deviceExtraMs,
        };
        delayCalibrationSteps = 0;
      }
      delayCalibrationSteps += 1;
      delayCalibrationLastAt = now;
      if (delayCalibrationTimer) clearTimeout(delayCalibrationTimer);
      delayCalibrationTimer = setTimeout(() => {
        delayCalibrationTimer = null;
        flushDelayCalibration();
      }, DELAY_CALIBRATION_IDLE_MS);
    }

    function setActiveDevice(name) {
      const key = normalizeDeviceName(name);
      if (!key || !deviceProfiles.profiles[key]) {
        renderDeviceProfileUI();
        return;
      }
      flushDelayCalibration();
      activeDeviceName = key;
      deviceExtraMs = clampDeviceOffset(deviceProfiles.profiles[key].offsetMs);
      deviceProfiles.profiles[key].offsetMs = deviceExtraMs;
      closeDeviceMenu();
      saveDeviceProfiles();
      renderDeviceProfileUI();
      updateOffsetDisplay();
      setOffsetAdjustRowVisible('device_adjust_controls', true);
      setDeviceDeleteVisible(true);
      refreshAudioOutputForDeviceChange();
    }

    function refreshAudioOutputForDeviceChange(source = 'manual') {
      if (typeof recordClockTrace === 'function') {
        recordClockTrace(source === 'system' ? 'AUDIO_OUTPUT_SYSTEM' : 'AUDIO_OUTPUT_MANUAL');
      }
      if (deviceAudioResetTimer) {
        clearTimeout(deviceAudioResetTimer);
        deviceAudioResetTimer = null;
      }
      const wasRunning = isRunning;
      const keepAliveWasActive = Boolean(audioHeartbeat);
      if (keepAliveWasActive) stopBackgroundKeepAlive();
      if (wasRunning) setMasterLoading(true);
      const ok = NextAudio.resetOutput(
        wasRunning ? () => setMasterLoading(false) : null,
        wasRunning ? () => { } : null
      );
      if (wasRunning && !ok) {
        stop();
        return;
      }
      if (keepAliveWasActive && document.hidden && isRunning) startBackgroundKeepAlive();
    }

    function scheduleAudioOutputReset(delayMs = 300, source = 'manual') {
      pendingAudioOutputSource = source;
      if (deviceAudioResetTimer) clearTimeout(deviceAudioResetTimer);
      deviceAudioResetTimer = setTimeout(() => {
        deviceAudioResetTimer = null;
        refreshAudioOutputForDeviceChange(pendingAudioOutputSource);
      }, delayMs);
    }

    function bindAudioOutputChanges() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;
        navigator.mediaDevices.addEventListener('devicechange', () => {
          scheduleAudioOutputReset(700, 'system');
        });
      } catch (e) {
        console.warn('Audio device change listener unavailable:', e);
      }
    }
    function changeDeviceOffset(delta) {
      const profile = deviceProfiles.profiles[activeDeviceName];
      if (!profile) return;
      noteDelayCalibration();
      if (delta === 'reset') {
        profile.offsetMs = 0;
      } else {
        profile.offsetMs = clampDeviceOffset(profile.offsetMs + Number(delta));
      }
      deviceExtraMs = profile.offsetMs;
      saveDeviceProfiles();
      renderDeviceProfileUI();
      updateOffsetDisplay();
    }
    function addOrSelectDevice(name) {
      const key = normalizeDeviceName(name);
      if (!key) {
        renderDeviceProfileUI();
        return;
      }
      if (deviceProfiles.profiles[key]) {
        setActiveDevice(key);
        return;
      }
      flushDelayCalibration();
      deviceProfiles.profiles[key] = { offsetMs: 0 };
      activeDeviceName = key;
      deviceExtraMs = 0;
      closeDeviceMenu();
      saveDeviceProfiles();
      renderDeviceProfileUI();
      updateOffsetDisplay();
      setOffsetAdjustRowVisible('device_adjust_controls', true);
      setDeviceDeleteVisible(true);
      refreshAudioOutputForDeviceChange();
    }
    function resetDeviceToDefault() {
      if (deviceProfiles.profiles[DEVICE_DEFAULT_NAME]) {
        setActiveDevice(DEVICE_DEFAULT_NAME);
      } else {
        addOrSelectDevice(DEVICE_DEFAULT_NAME);
      }
    }
    function deleteActiveDevice() {
      if (!deviceProfiles.profiles[activeDeviceName]) return;
      if (!window.confirm(`\uD83D\uDDD1“${activeDeviceName}”?`)) return;
      flushDelayCalibration();
      delete deviceProfiles.profiles[activeDeviceName];
      let names = sortedDeviceNames();
      if (names.length === 0) {
        deviceProfiles.profiles[DEVICE_DEFAULT_NAME] = { offsetMs: 0 };
        names = [DEVICE_DEFAULT_NAME];
      }
      const next = deviceProfiles.profiles[DEVICE_DEFAULT_NAME] ? DEVICE_DEFAULT_NAME : names[0];
      activeDeviceName = next;
      deviceExtraMs = deviceProfiles.profiles[next].offsetMs;
      closeDeviceMenu();
      saveDeviceProfiles();
      renderDeviceProfileUI();
      updateOffsetDisplay();
      setOffsetAdjustRowVisible('device_adjust_controls', false);
      setDeviceDeleteVisible(false);
    }
    function beginDeviceNameEdit() {
      if (deviceNameEditing) return;
      closeDeviceMenu();
      const btn = document.getElementById('device_name_btn');
      const input = document.getElementById('device_name_input');
      if (!btn || !input) return;
      deviceNameEditing = true;
      btn.classList.add('hidden');
      input.classList.remove('hidden');
      input.value = '';
      input.focus();
    }
    function finishDeviceNameEdit(commit) {
      if (!deviceNameEditing) return;
      const input = document.getElementById('device_name_input');
      const btn = document.getElementById('device_name_btn');
      const value = input ? input.value : '';
      deviceNameEditing = false;
      if (input) {
        input.classList.add('hidden');
        input.value = '';
      }
      if (btn) btn.classList.remove('hidden');
      if (commit) addOrSelectDevice(value);
      else renderDeviceProfileUI();
    }
    function initDeviceProfileUI() {
      renderDeviceProfileUI();
      const nameBtn = document.getElementById('device_name_btn');
      const menu = document.getElementById('device_menu');
      const input = document.getElementById('device_name_input');
      const deleteBtn = document.getElementById('device_delete_btn');
      const resetBtn = document.getElementById('device_reset_btn');
      if (nameBtn && menu) {
        nameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (deviceNameEditing) return;
          if (menu.classList.contains('hidden')) {
            renderDeviceMenu();
            menu.classList.remove('hidden');
          } else {
            menu.classList.add('hidden');
          }
        });
      }
      if (menu) {
        menu.addEventListener('click', (e) => {
          const add = e.target.closest('[data-device-add]');
          if (add) {
            closeDeviceMenu();
            beginDeviceNameEdit();
            return;
          }
          const item = e.target.closest('[data-device-name]');
          if (item) setActiveDevice(item.dataset.deviceName);
        });
      }
      if (deleteBtn) deleteBtn.addEventListener('click', deleteActiveDevice);
      if (resetBtn) resetBtn.addEventListener('click', resetDeviceToDefault);
      document.querySelectorAll('[data-device-delta]').forEach((btn) => {
        btn.addEventListener('click', () => changeDeviceOffset(btn.dataset.deviceDelta));
      });
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finishDeviceNameEdit(false);
            input.blur();
          }
        });
        input.addEventListener('blur', () => finishDeviceNameEdit(true));
      }
      document.addEventListener('click', (e) => {
        if (!menu || menu.classList.contains('hidden')) return;
        if (menu.contains(e.target) || (nameBtn && nameBtn.contains(e.target))) return;
        closeDeviceMenu();
      });
    }

    const DIGITAL_ONE = 'one';
    const DIGITAL_ZERO = 'zero';
    const DIGITAL_MARKER = 'marker';

    function encodeBinary(value, length) {
      const sequence = new Array(length).fill(DIGITAL_ZERO);
      let remaining = value;
      let index = 0;
      while (remaining > 0) {
        sequence[index] = remaining % 2 === 0 ? DIGITAL_ZERO : DIGITAL_ONE;
        index += 1;
        remaining = Math.floor(remaining / 2);
      }
      return sequence;
    }

    function getDigitAtPlace(number, place) {
      return Math.floor((number / (10 ** place)) % 10);
    }

    function getUtcJulianDayOfYear(date) {
      const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const startOfYear = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
      return Math.ceil((utcDate - startOfYear) / 86400000) + 1;
    }

    function findDate(year, month, dayOfWeek, weekOfMonth) {
      const firstOfMonth = new Date(Date.UTC(year, month, 1 + (weekOfMonth - 1) * 7));
      const day = firstOfMonth.getUTCDay();
      const diff = (dayOfWeek + 7 - day) % 7;
      return new Date(Date.UTC(year, month, firstOfMonth.getUTCDate() + diff));
    }

    function getDstStartUtc(year) {
      return findDate(year, 2, 0, 2);
    }

    function getDstEndUtc(year) {
      return findDate(year, 10, 0, 1);
    }

    function getDstBits(date) {
      const year = date.getUTCFullYear();
      const dst1Start = getDstStartUtc(year);
      const dst1End = getDstEndUtc(year);
      const dst2Start = new Date(dst1Start);
      dst2Start.setUTCHours(24);
      const dst2End = new Date(dst1End);
      dst2End.setUTCHours(24);
      return [
        date >= dst1Start && date < dst1End ? DIGITAL_ONE : DIGITAL_ZERO,
        date >= dst2Start && date < dst2End ? DIGITAL_ONE : DIGITAL_ZERO,
      ];
    }

    function getWWVDigitalCode(date, dut1Ms = window.otherDUT1) {
      const year = date.getUTCFullYear();
      const minute = date.getUTCMinutes();
      const hour = date.getUTCHours();
      const dayOfYear = getUtcJulianDayOfYear(date);
      const [dst1, dst2] = getDstBits(date);
      const bits = [
        DIGITAL_ZERO,
        dst1,
        DIGITAL_ZERO,
        ...encodeBinary(getDigitAtPlace(year, 0), 4),
        DIGITAL_ZERO,
        DIGITAL_MARKER,
        ...encodeBinary(getDigitAtPlace(minute, 0), 4),
        DIGITAL_ZERO,
        ...encodeBinary(getDigitAtPlace(minute, 1), 3),
        DIGITAL_ZERO,
        DIGITAL_MARKER,
        ...encodeBinary(getDigitAtPlace(hour, 0), 4),
        DIGITAL_ZERO,
        ...encodeBinary(getDigitAtPlace(hour, 1), 2),
        DIGITAL_ZERO,
        DIGITAL_ZERO,
        DIGITAL_MARKER,
        ...encodeBinary(getDigitAtPlace(dayOfYear, 0), 4),
        DIGITAL_ZERO,
        ...encodeBinary(getDigitAtPlace(dayOfYear, 1), 4),
        DIGITAL_MARKER,
        ...encodeBinary(getDigitAtPlace(dayOfYear, 2), 2),
        ...new Array(7).fill(DIGITAL_ZERO),
        DIGITAL_MARKER,
        DIGITAL_ONE,
        ...encodeBinary(getDigitAtPlace(year, 1), 4),
        dst2,
        ...new Array(3).fill(DIGITAL_ZERO),
        DIGITAL_MARKER,
      ];
      // WWV/WWVH: sign at second 50, 0.1/0.2/0.4 s magnitude at 56/57/58.
      const dut1Tenths = Math.max(0, Math.min(7, Math.round(Math.abs(Number(dut1Ms) || 0) / 100)));
      bits[49] = dut1Tenths > 0 && Number(dut1Ms) < 0 ? DIGITAL_ZERO : (dut1Tenths > 0 ? DIGITAL_ONE : DIGITAL_ZERO);
      bits[55] = (dut1Tenths & 1) ? DIGITAL_ONE : DIGITAL_ZERO;
      bits[56] = (dut1Tenths & 2) ? DIGITAL_ONE : DIGITAL_ZERO;
      bits[57] = (dut1Tenths & 4) ? DIGITAL_ONE : DIGITAL_ZERO;
      return bits;
    }

    function wwvSpriteEntry(key) {
      const sprite = window.WWV_SPRITE && window.WWV_SPRITE.sprite;
      return sprite && sprite[key] ? sprite[key] : null;
    }

    function wwvSpriteDurationMs(key) {
      const entry = wwvSpriteEntry(key);
      return entry ? Number(entry[1]) : 0;
    }

    function pushWWVEvent(events, station, spriteKey, utcMs, extra = {}) {
      if (!wwvSpriteEntry(spriteKey)) return;
      events.push({ station, spriteKey, utcMs, ...extra });
    }

    function buildWWVVoiceClips(config, minuteStart) {
      const date = new Date(minuteStart);
      let nextMinute = date.getUTCMinutes() + 1;
      let nextHour = date.getUTCHours();
      if (nextMinute > 59) {
        nextMinute = 0;
        nextHour = (nextHour + 1) % 24;
      }
      const prefix = config.prefix;
      const clips = [];
      const pushClip = (key, startMs, durationMs = wwvSpriteDurationMs(`${prefix}_${key}`)) => {
        clips.push({ key: `${prefix}_${key}`, startMs, durationMs });
      };
      pushClip('at_the_tone', config.atTheToneMs);
      let offset = config.voiceStartMs;
      const addVoice = (key, gapMs) => {
        const durationMs = wwvSpriteDurationMs(`${prefix}_${key}`);
        pushClip(key, offset, durationMs);
        offset += durationMs + gapMs;
      };
      addVoice(String(nextHour), 100);
      addVoice(pluralizeWord('hour', nextHour), 400);
      addVoice(String(nextMinute), 100);
      addVoice(pluralizeWord('minute', nextMinute), 400);
      pushClip('utc', offset);
      return clips;
    }

    function pluralizeWord(word, amount) {
      return amount === 1 ? word : `${word}s`;
    }

    function pushWWVTone(events, station, hz, utcMs, durationMs) {
      events.push({ station, generatedTone: Number(hz), utcMs, durationMs });
    }

    function pushWWVPulse(events, station, pulseBuffer, utcMs) {
      events.push({ station, generatedPulse: pulseBuffer, utcMs });
    }

    function buildWWVEvents(fromUtcMs, toUtcMs) {
      if (!window.WWV_SPRITE) return [];
      const events = [];
      const firstMinute = Math.floor(fromUtcMs / 60000);
      const lastMinute = Math.ceil(toUtcMs / 60000);
      for (let minuteIndex = firstMinute; minuteIndex <= lastMinute; minuteIndex += 1) {
        const minuteStart = minuteIndex * 60000;
        const date = new Date(minuteStart);
        const minute = date.getUTCMinutes();
        const hour = date.getUTCHours();
        const digitalCode = getWWVDigitalCode(date);
        const dut1Ms = Number(window.otherDUT1) || 0;
        const dut1Tenths = Math.min(8, Math.round(Math.abs(dut1Ms) / 100));
        const doubledSeconds = new Set();
        if (dut1Tenths > 0) {
          for (let i = 1; i <= dut1Tenths; i += 1) {
            doubledSeconds.add(dut1Ms > 0 ? i : 8 + i);
          }
        }

        for (const [stationId, config] of Object.entries(WWV_STATIONS)) {
          const prefix = config.prefix;
          let base = WWV_TONE_SCHEDULE[minute][config.toneIndex];
          if (hour === 0 && base === '440') {
            base = WWV_TONE_SCHEDULE[(minute + 2) % 60][config.toneIndex];
          }
          const identDuration = base === 'ident'
            ? (wwvIdentDurations[prefix] || 0)
            : 0;
          const voiceClips = buildWWVVoiceClips(config, minuteStart);
          const voiceStart = voiceClips.length ? voiceClips[0].startMs : Infinity;
          const lastVoiceClip = voiceClips[voiceClips.length - 1];
          const voiceEnd = lastVoiceClip
            ? lastVoiceClip.startMs + lastVoiceClip.durationMs
            : -Infinity;

          if (base === 'ident' && identDuration > 0) {
            events.push({
              station: stationId,
              ident: true,
              utcMs: minuteStart + 1000,
              durationMs: identDuration,
            });
          }

          if (identDuration <= 0) {
            const marker = minute === 0 ? 'marker1500' : `marker${config.pulseHz}`;
            pushWWVPulse(events, stationId, marker, minuteStart);
          }

          for (let second = 1; second < 60; second += 1) {
            if (second * 1000 < identDuration) continue;
            if (second !== 29 && second !== 59) {
              pushWWVPulse(events, stationId, `pulse${config.pulseHz}`, minuteStart + second * 1000);
              if (doubledSeconds.has(second)) {
                pushWWVPulse(events, stationId, `pulse${config.pulseHz}`, minuteStart + second * 1000 + 100);
              }
            }
            if (base !== '0' && base !== 'ident' && second <= 44) {
              const toneStart = second * 1000 + 35;
              if (toneStart < voiceStart || toneStart >= voiceEnd) {
                pushWWVTone(events, stationId, base, minuteStart + toneStart, 965);
              }
            }
          }

          for (let second = 1; second < 60; second += 1) {
            const kind = digitalCode[second - 1];
            if (!kind) continue;
            pushWWVEvent(events, stationId, `digital_${kind}`, minuteStart + second * 1000);
          }

          for (const clip of voiceClips) {
            pushWWVEvent(events, stationId, clip.key, minuteStart + clip.startMs);
          }
        }
      }
      events.sort((a, b) => a.utcMs - b.utcMs);
      return events.filter(event => event.utcMs >= fromUtcMs && event.utcMs < toUtcMs);
    }

    function buildRWMEvents(fromUtcMs, toUtcMs) {
      const events = [];
      const firstSecond = Math.floor(fromUtcMs / 1000) - 1;
      const lastSecond = Math.ceil(toUtcMs / 1000) + 1;
      const dut1State = rwmDut1State(window.otherDUT1);
      const doubleSeconds = new Set([
        ...dut1State.doubleSeconds,
        ...dut1State.extraSeconds,
      ]);
      const pushMorseIdent = (minuteStart) => {
        const morse = {
          R: ['dot', 'dash', 'dot'],
          W: ['dot', 'dash', 'dash'],
          M: ['dash', 'dash'],
        };
        const elementMs = { dot: 70, dash: 210 };
        const gapIntra = 70;
        const gapLetter = 210;
        const gapWord = 630;
        let offset = 0;
        while (offset < 55000) {
          for (const letter of ['R', 'W', 'M']) {
            for (const element of morse[letter]) {
              if (offset >= 55000) break;
              const duration = elementMs[element];
              events.push({
                station: 'rwm',
                buffer: element === 'dot' ? 'rwmMorseDot' : 'rwmMorseDash',
                category: 'morse',
                utcMs: minuteStart + offset,
                durationMs: Math.min(duration, 55000 - offset),
              });
              offset += duration + gapIntra;
            }
            offset += gapLetter;
          }
          offset += gapWord;
        }
      };
      const identMinutes = new Set();
      for (let sec = firstSecond; sec <= lastSecond; sec += 1) {
        const utcMs = sec * 1000;
        const date = new Date(utcMs);
        const minute = date.getUTCMinutes();
        const second = date.getUTCSeconds();
        const mode = rwmModeForMinute(minute);
        if (mode === 'ident') {
          const minuteStart = Math.floor(utcMs / 60000) * 60000;
          if (!identMinutes.has(minuteStart)) {
            identMinutes.add(minuteStart);
            pushMorseIdent(minuteStart);
          }
          continue;
        }
        if (mode === 'pulse1') {
          if (rwmPulseTailSecond(minute, second)) continue;
          const buffer = second === 0 ? 'rwmPulse500' : 'rwmPulse100';
          events.push({ station: 'rwm', buffer, utcMs });
          if (doubleSeconds.has(second)) {
            events.push({ station: 'rwm', buffer: 'rwmPulse100', utcMs: utcMs + 200 });
          }
          continue;
        }
        if (mode === 'pulse10') {
          if (rwmPulseTailSecond(minute, second)) continue;
          for (let pulse = 0; pulse < 10; pulse += 1) {
            // The 500 ms minute pulse already covers offsets 0–500 ms;
            // suppress the overlapped 100–400 ms ticks, then continue with
            // the 20 ms pulse at +500 ms for a seamless 520 ms first pulse.
            if (second === 0 && pulse >= 1 && pulse <= 4) continue;
            const buffer = pulse === 0
              ? (second === 0 ? 'rwmPulse500' : 'rwmPulse40')
              : 'rwmPulse20';
            events.push({
              station: 'rwm',
              buffer,
              category: pulse === 0 ? undefined : 'pulse10',
              utcMs: utcMs + pulse * 100,
            });
          }
        }
      }
      return events.filter(event => event.utcMs >= fromUtcMs && event.utcMs < toUtcMs);
    }

