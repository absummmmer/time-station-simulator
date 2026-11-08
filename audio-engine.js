// Web Audio engine: look-ahead event scheduling, station buses, voice assets and noise.
    // ===== Buffered / look-ahead audio engine =====
    // Pure event generator. Exposed globally so it can be unit-tested without
    // starting Web Audio.
    function buildNextAudioEvents(fromUtcMs, toUtcMs, options = {}) {
      const forceOnly = (options.forceUtcOnly !== undefined) ? options.forceUtcOnly : forceUtcOnly;
      const dut1 = (options.dut1 !== undefined) ? options.dut1 : window.bpmDUT1;
      const events = [];
      const PULSE_ADVANCE_MS = 20;
      if (!(toUtcMs > fromUtcMs)) return events;

      // UTC + time-code seconds.
      // BPM's 1 kHz second pulse is emitted 20 ms before the timestamp; the
      // 125 Hz UTC time code stays aligned to the timestamp. The first pulse
      // after a non-UTC period stays at the exact boundary, matching the
      // original broadcast timing behaviour.
      const firstSec = Math.floor((fromUtcMs - PULSE_ADVANCE_MS) / 1000) - 1;
      const lastSec = Math.ceil((toUtcMs + PULSE_ADVANCE_MS) / 1000) + 1;
      for (let sec = firstSec; sec <= lastSec; sec += 1) {
        const utcMs = sec * 1000;
        const d = new Date(utcMs);
        const minute = d.getUTCMinutes();
        const second = d.getUTCSeconds();
        const period = forceOnly ? 'utc' : getPeriodType(minute, second, 0);
        if (period === 'utc') {
          const earlyMs = utcMs - PULSE_ADVANCE_MS;
          const earlyD = new Date(earlyMs);
          const earlyPeriod = forceOnly ? 'utc' : getPeriodType(
            earlyD.getUTCMinutes(), earlyD.getUTCSeconds(), earlyD.getUTCMilliseconds(),
          );
          let pulseMs = null;
          if (earlyPeriod === 'utc') {
            pulseMs = earlyMs;
          } else if (second === 0) {
            // First pulse after carrier/call: start at the exact boundary.
            pulseMs = utcMs;
          }
          if (pulseMs !== null && pulseMs >= fromUtcMs && pulseMs < toUtcMs) {
            events.push({
              utcMs: pulseMs,
              buffer: second === 0 ? 'pulse300' : 'pulse10',
              bus: 'pulse',
            });
          }
        }
        // Behaviour at the UTC -> UT1 boundary: the last UTC tick is
        // still emitted 20 ms before 24:59 / 54:59, then the first UT1 pulse
        // starts exactly at the boundary. Keep this crossover pulse.
        if (period !== 'utc' && second === 59) {
          const earlyMs = utcMs - PULSE_ADVANCE_MS;
          const earlyD = new Date(earlyMs);
          const earlyPeriod = forceOnly ? 'utc' : getPeriodType(
            earlyD.getUTCMinutes(), earlyD.getUTCSeconds(), earlyD.getUTCMilliseconds(),
          );
          if (earlyPeriod === 'utc' && earlyMs >= fromUtcMs && earlyMs < toUtcMs) {
            events.push({ utcMs: earlyMs, buffer: 'pulse10', bus: 'pulse' });
          }
        }
        // Match the original broadcast rule: the 125 Hz code is sent in
        // time-code minutes and is not suppressed during the one boundary
        // second where the UT1 period has already started (24:59 / 54:59).
        if (second > 0 &&
          isInTimeCodePeriod(minute, forceOnly) &&
          period === 'utc' &&
          utcMs >= fromUtcMs && utcMs < toUtcMs) {
          const bits = generateTimeCode(d, dut1);
          const bit = bits[second];
          const buffer = bit === 0 ? 'sub200' : (bit === 1 ? 'sub480' : 'sub800');
          events.push({ utcMs, buffer, bus: 'sub' });
        }
      }

      // UT1 is broadcast continuously inside fixed UTC windows:
      //   24:59:00–29:00:00 and 54:59:00–59:00:00.
      // The mode switch is hard: a UT1 pulse that would have started before the
      // window is resumed at the switch with only its remaining part, and a
      // pulse that would extend past the window is cut at the switch.
      if (!forceOnly) {
        const UT1_WINDOWS = [[24 * 60 + 59, 29 * 60], [54 * 60 + 59, 59 * 60]];
        const firstHour = Math.floor((fromUtcMs - 3600000) / 3600000);
        const lastHour = Math.floor((toUtcMs + 3600000) / 3600000);
        for (let h = firstHour; h <= lastHour; h += 1) {
          const hourStart = h * 3600000;
          for (const [startSec, endSec] of UT1_WINDOWS) {
            const t0 = hourStart + startSec * 1000;
            const t1 = hourStart + endSec * 1000;
            if (t1 <= fromUtcMs || t0 >= toUtcMs) continue;
            const nStart = Math.floor((t0 + dut1) / 1000) - 2;
            const nEnd = Math.ceil((t1 + dut1) / 1000) + 2;
            for (let n = nStart; n <= nEnd; n += 1) {
              const nominalMs = n * 1000 - dut1;
              const startMs = nominalMs - PULSE_ADVANCE_MS;
              const minuteTick = ((n % 60) + 60) % 60 === 0;
              const durationMs = minuteTick ? 300 : 100;
              const endMs = startMs + durationMs;
              if (endMs <= t0 || startMs >= t1) continue;
              const playStart = Math.max(startMs, t0);
              const playEnd = Math.min(endMs, t1);
              if (playEnd <= playStart) continue;
              if (playStart < fromUtcMs || playStart >= toUtcMs) continue;
              const buffer = minuteTick ? 'pulse300' : 'pulse100';
              const event = { utcMs: playStart, buffer, bus: 'pulse' };
              if (playStart > startMs + 0.0001) event.offsetMs = playStart - startMs;
              if (playEnd < endMs - 0.0001) event.durationMs = playEnd - playStart;
              events.push(event);
            }
          }
        }
      }

      // Morse station ID. Voice is handled separately so it can start with
      // an offset when the page is opened in the middle of the announcement.
      const firstMinute = Math.floor(fromUtcMs / 60000);
      const lastMinute = Math.ceil(toUtcMs / 60000) - 1;
      for (let m = firstMinute; m <= lastMinute; m += 1) {
        const minuteStart = m * 60000;
        const d = new Date(minuteStart);
        const period = forceOnly ? 'utc' : getPeriodType(d.getUTCMinutes(), 0, 0);
        if (period !== 'call') continue;
        const morseEnd = minuteStart + 40000;
        for (let cycle = 0; cycle < 10; cycle += 1) {
          let t = minuteStart + MORSE_START_DELAY + cycle * MORSE_CYCLE;
          if (t >= morseEnd) break;
          for (const item of morseSequence) {
            if (t >= morseEnd) break;
            if (item.type !== 'space' && t >= fromUtcMs && t < toUtcMs) {
              events.push({
                utcMs: t,
                buffer: item.type === 'dash' ? 'pulse300' : 'pulse100',
                bus: 'morse',
              });
            }
            t += item.duration;
          }
        }
      }

      events.push(...buildWWVEvents(fromUtcMs, toUtcMs));
      events.push(...buildRWMEvents(fromUtcMs, toUtcMs));
      events.sort((a, b) => a.utcMs - b.utcMs);
      return events;
    }

    const NextAudio = (() => {
      const SAMPLE_RATE = 48000;
      const LOOKAHEAD_MS = 10000;
      const PUMP_MS = 250;
      const START_LEAD_SEC = 0.15;
      const GUARD_SEC = 0.05;
      const WALL_JUMP_MS = 80;
      const SKEW_REANCHOR_MS = 120;
      const REANCHOR_COOLDOWN_MS = 1500;
      const AUDIO_STALL_MS = 500;
      const START_CLOCK_WAIT_MS = 2500;

      let ctx = null;
      let masterGain = null;
      let limiterNode = null;
      let bpmGain = null;
      let wwvGain = null;
      let wwvhGain = null;
      let rwmGain = null;
      let wwvAdjustNodes = null;
      let rwmAdjustNodes = null;
      let pulseGain = null;
      let morseGain = null;
      let subGain = null;
      let voiceGain = null;
      let voiceEQInput = null;
      let noiseSource = null;
      let noiseSource2 = null;
      let noiseGain = null;
      let buffers = null;
      let wwvBuffers = null;
      let wwvSpriteBuffer = null;
      let wwvIdentBuffers = { h: null, v: null };
      let wwvLoadPromise = null;
      const wwvVoiceCatchup = { wwv: false, wwvh: false };
      let running = false;
      let playbackStarted = false;
      let sessionToken = 0;
      let pumpTimer = null;
      let worker = null;
      let workerUrl = null;
      let audioAnchor = 0;
      let utcAnchor = 0;
      let audioAnchorMonoMs = 0;
      let audioTimeScale = 1;
      let audioSkewPpm = 0;
      let lastAudioRateUpdateMonoMs = 0;
      const AUDIO_SKEW_MIN_SAMPLE_MS = 180000;
      const AUDIO_SKEW_UPDATE_MS = 60000;
      const AUDIO_SKEW_LIMIT_PPM = 200;
      const AUDIO_SKEW_GAIN = 0.2;
      let scheduledUntil = 0;
      const scheduled = new Set();
      let voiceSource = null;
      let voiceMinute = -1;
      let rescheduleTimer = null;
      let timingDirty = false;
      let lastTimingKey = '';
      let lastWallSampleMs = 0;
      let lastMonoSampleMs = 0;
      let lastAudioClockSec = 0;
      let lastAudioSampleMonoMs = 0;
      let lastReanchorMonoMs = 0;
      let lastReanchorReason = 'start';
      let lastPumpMonoMs = 0;
      let lastOutputLatencyMs = null;

      function utcToAudioTime(utcMs) {
        return audioAnchor + ((utcMs - utcAnchor) / 1000) * audioTimeScale;
      }

      function audioToUtcMs(audioSec) {
        return utcAnchor + ((audioSec - audioAnchor) / audioTimeScale) * 1000;
      }

      function totalOffsetMs() {
        return localOffset + networkCompensation + deviceExtraMs + GLOBAL_OFFSET_MS;
      }

      function timingKey() {
        return `${localOffset}|${networkCompensation}|${deviceExtraMs}|${GLOBAL_OFFSET_MS}|${window.bpmDUT1}|${window.otherDUT1}|${forceUtcOnly}|${rwmLockMode}`;
      }

      function makeToneBuffer(freq, durationMs, amplitude) {
        const sr = ctx.sampleRate;
        const n = Math.max(2, Math.round((sr * durationMs) / 1000));
        const buffer = ctx.createBuffer(1, n, sr);
        const data = buffer.getChannelData(0);
        const fade = Math.max(1, Math.min(Math.round(sr * 0.0005), Math.floor(n / 4)));
        for (let i = 0; i < n; i += 1) {
          let env = 1;
          if (i < fade) env = i / fade;
          else if (i >= n - fade) env = (n - 1 - i) / fade;
          data[i] = amplitude * env * Math.sin((2 * Math.PI * freq * i) / sr);
        }
        return buffer;
      }

      function makeSteadyToneBuffer(freq, amplitude) {
        const sr = ctx.sampleRate;
        const n = sr;
        const buffer = ctx.createBuffer(1, n, sr);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < n; i += 1) {
          data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sr);
        }
        return buffer;
      }

      function buildRwmBuffers() {
        if (!buffers) return;
        buffers.rwmPulse20 = makeToneBuffer(rwmBeatHz, 20, BPM_PULSE_AMPLITUDE);
        buffers.rwmPulse40 = makeToneBuffer(rwmBeatHz, 40, BPM_PULSE_AMPLITUDE);
        buffers.rwmPulse100 = makeToneBuffer(rwmBeatHz, 100, BPM_PULSE_AMPLITUDE);
        buffers.rwmPulse500 = makeToneBuffer(rwmBeatHz, 500, BPM_PULSE_AMPLITUDE);
        buffers.rwmMorseDot = makeToneBuffer(rwmBeatHz, 70, BPM_PULSE_AMPLITUDE);
        buffers.rwmMorseDash = makeToneBuffer(rwmBeatHz, 210, BPM_PULSE_AMPLITUDE);
      }

      function buildBuffers() {
        // Six short PCM blocks. Morse dots/dashes reuse the 100/300 ms pulse
        // blocks, so the total tone memory is only ~354 KiB at 48 kHz.
        buffers = {
          pulse10: makeToneBuffer(1000, 10, BPM_PULSE_AMPLITUDE),
          pulse100: makeToneBuffer(1000, 100, BPM_PULSE_AMPLITUDE),
          pulse300: makeToneBuffer(1000, 300, BPM_PULSE_AMPLITUDE),
          sub200: makeToneBuffer(125, 200, BPM_TIMECODE_AMPLITUDE),
          sub480: makeToneBuffer(125, 480, BPM_TIMECODE_AMPLITUDE),
          sub800: makeToneBuffer(125, 800, BPM_TIMECODE_AMPLITUDE),
        };
        buildRwmBuffers();
        wwvBuffers = {
          tone440: makeSteadyToneBuffer(440, WWV_LEVELS.tone),
          tone500: makeSteadyToneBuffer(500, WWV_LEVELS.tone),
          tone600: makeSteadyToneBuffer(600, WWV_LEVELS.tone),
          pulse1000: makeToneBuffer(1000, 5, WWV_LEVELS.pulse),
          pulse1200: makeToneBuffer(1200, 5, WWV_LEVELS.pulse),
          marker1000: makeToneBuffer(1000, 800, WWV_LEVELS.pulse),
          marker1200: makeToneBuffer(1200, 800, WWV_LEVELS.pulse),
          marker1500: makeToneBuffer(1500, 800, WWV_LEVELS.pulse),
        };
      }

      function buildGraph() {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) throw new Error('Web Audio is not supported');
        try {
          ctx = new Ctor({ sampleRate: SAMPLE_RATE });
        } catch (e) {
          // Some older/embedded browsers reject an explicit sample rate.
          ctx = new Ctor();
        }
        ctx.onstatechange = () => {
          if (!running) return;
          if (ctx.state !== 'running') {
            // Once the OS suspends the output, discard sources that were
            // queued for the old timeline. Otherwise they all fire together
            // when the context resumes, which sounds like a burst of clicks.
            for (const rec of Array.from(scheduled)) {
              try { rec.src.stop(); } catch (e) { }
              scheduled.delete(rec);
            }
            if (voiceSource) {
              try { voiceSource.stop(); } catch (e) { }
              voiceSource = null;
              voiceMinute = -1;
            }
            scheduledUntil = 0;
            timingDirty = true;
            return;
          }
          if (!playbackStarted) return;
          reportOutputLatency();
          timingDirty = true;
          const token = sessionToken;
          afterAudioClockRunning(() => {
            if (token === sessionToken && running && playbackStarted && ctx) reschedule();
          }, token);
        };
        masterGain = ctx.createGain();
        masterGain.gain.value = Math.pow(masterVolume, 3);
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.1;
        limiterNode = limiter;
        masterGain.connect(limiter);
        limiter.connect(ctx.destination);
        bpmGain = ctx.createGain();
        bpmGain.gain.value = stationVolumes.bpm;
        bpmGain.connect(masterGain);
        wwvGain = ctx.createGain();
        wwvGain.gain.value = stationVolumes.wwv;
        wwvGain.connect(masterGain);
        wwvhGain = ctx.createGain();
        wwvhGain.gain.value = stationVolumes.wwvh;
        wwvhGain.connect(masterGain);
        rwmGain = ctx.createGain();
        rwmGain.gain.value = stationVolumes.rwm;
        rwmGain.connect(masterGain);
        rwmAdjustNodes = {
          pulse10: ctx.createGain(),
          morse: ctx.createGain(),
        };
        rwmAdjustNodes.pulse10.gain.value = rwmAdjustments.pulse10;
        rwmAdjustNodes.morse.gain.value = rwmAdjustments.morse;
        rwmAdjustNodes.pulse10.connect(rwmGain);
        rwmAdjustNodes.morse.connect(rwmGain);
        wwvAdjustNodes = { wwv: {}, wwvh: {} };
        for (const station of ['wwv', 'wwvh']) {
          const parent = station === 'wwv' ? wwvGain : wwvhGain;
          for (const kind of ['tone', 'code', 'voice']) {
            const node = ctx.createGain();
            node.gain.value = wwvAdjustments[station][kind];
            node.connect(parent);
            wwvAdjustNodes[station][kind] = node;
          }
        }
        pulseGain = ctx.createGain();
        pulseGain.gain.value = 1;
        pulseGain.connect(bpmGain);
        morseGain = ctx.createGain();
        morseGain.gain.value = BPM_MORSE_BASE_GAIN * bpmMorseAdjust;
        morseGain.connect(pulseGain);
        subGain = ctx.createGain();
        subGain.gain.value = lowFreqVolume;
        subGain.connect(bpmGain);
        voiceGain = ctx.createGain();
        voiceGain.gain.value = BPM_VOICE_BASE_GAIN * bpmVoiceAdjust;
        voiceGain.connect(bpmGain);
        const voiceEQ = createVoiceEQ(ctx);
        voiceEQInput = voiceEQ.input;
        voiceEQ.output.connect(voiceGain);
      }

      function decodeAudioBuffer(arrayBuffer) {
        return new Promise((resolve, reject) => {
          const result = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
          if (result && typeof result.then === 'function') {
            result.then(resolve, reject);
          }
        });
      }

      async function loadWWVAssets() {
        if (!ctx || wwvSpriteBuffer) return;
        if (wwvLoadPromise) return wwvLoadPromise;
        wwvLoadPromise = (async () => {
          const [spriteResponse, hResponse, vResponse] = await Promise.all([
            fetch('audio/wwv/output.mp3', { cache: 'force-cache' }),
            fetch('audio/wwv/h_ident.mp3', { cache: 'force-cache' }),
            fetch('audio/wwv/v_ident.mp3', { cache: 'force-cache' }),
          ]);
          if (!spriteResponse.ok || !hResponse.ok || !vResponse.ok) {
            throw new Error('WWV audio assets failed to load');
          }
          const [spriteData, hData, vData] = await Promise.all([
            spriteResponse.arrayBuffer(),
            hResponse.arrayBuffer(),
            vResponse.arrayBuffer(),
          ]);
          const [spriteBuffer, hBuffer, vBuffer] = await Promise.all([
            decodeAudioBuffer(spriteData),
            decodeAudioBuffer(hData),
            decodeAudioBuffer(vData),
          ]);
          if (!ctx) return;
          wwvSpriteBuffer = spriteBuffer;
          wwvPeakCache.clear();
          wwvIdentBuffers = { h: hBuffer, v: vBuffer };
          wwvIdentDurations.h = hBuffer.duration * 1000;
          wwvIdentDurations.v = vBuffer.duration * 1000;
          console.info('WWV/WWVH audio assets loaded');
          if (running && playbackStarted) reschedule();
        })().catch((error) => {
          console.error('WWV/WWVH audio assets failed:', error);
          wwvLoadPromise = null;
        });
        return wwvLoadPromise;
      }

      function effectiveNoiseGain() {
        return Math.pow(Math.min(masterVolume, noiseVolume), 3);
      }

      function buildNoise() {
        const sr = ctx.sampleRate;
        const makeNoiseBuffer = (seconds) => {
          const length = Math.round(sr * seconds);
          const buffer = ctx.createBuffer(1, length, sr);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.7071;
          return buffer;
        };
        const src = ctx.createBufferSource();
        src.buffer = makeNoiseBuffer(5.3);
        src.loop = true;
        const src2 = ctx.createBufferSource();
        src2.buffer = makeNoiseBuffer(8.9);
        src2.loop = true;
        const f1 = ctx.createBiquadFilter();
        f1.type = 'lowpass';
        f1.frequency.value = 1500;
        f1.Q.value = 0.7;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'lowpass';
        f2.frequency.value = 1500;
        f2.Q.value = 0.7;
        noiseGain = ctx.createGain();
        noiseGain.gain.value = effectiveNoiseGain();
        src.connect(f1);
        src2.connect(f1);
        f1.connect(f2);
        f2.connect(noiseGain);
        noiseGain.connect(limiterNode || ctx.destination);
        const startAt = ctx.currentTime;
        src.start(startAt, Math.random() * src.buffer.duration);
        src2.start(startAt, Math.random() * src2.buffer.duration);
        noiseSource = src;
        noiseSource2 = src2;
      }

      function anchor() {
        const nowUtc = Date.now() + totalOffsetMs();
        audioAnchor = ctx.currentTime + START_LEAD_SEC;
        utcAnchor = nowUtc + START_LEAD_SEC * 1000;
        audioAnchorMonoMs = performance.now();
        // Build the event window from the true current UTC time; utcAnchor
        // itself corresponds to the slightly later audioAnchor.
        scheduledUntil = nowUtc;
        lastTimingKey = timingKey();
        timingDirty = false;
        // Reset the clock-jump samples so a fresh anchor is not mistaken for
        // a wall-clock jump or for the audio clock stalling.
        const mono = performance.now();
        lastWallSampleMs = Date.now();
        lastMonoSampleMs = mono;
        lastAudioClockSec = ctx.currentTime;
        lastAudioSampleMonoMs = mono;
        lastPumpMonoMs = mono;
      }

      function reportOutputLatency() {
        if (!ctx) return;
        const ms = Number(ctx.outputLatency);
        if (!Number.isFinite(ms)) return;
        if (lastOutputLatencyMs === null || Math.abs(ms - lastOutputLatencyMs) > 1) {
          console.info(`BPM outputLatency: ${ms.toFixed(1)} ms`);
          lastOutputLatencyMs = ms;
        }
      }

      function wallClockJumped() {
        const wall = Date.now();
        const mono = performance.now();
        if (!lastWallSampleMs) {
          lastWallSampleMs = wall;
          lastMonoSampleMs = mono;
          return false;
        }
        const wallDelta = wall - lastWallSampleMs;
        const monoDelta = mono - lastMonoSampleMs;
        const jumped = Math.abs(wallDelta - monoDelta) > WALL_JUMP_MS;
        if (!jumped) {
          // Keep the pre-jump baseline when a jump is detected. If the
          // re-anchor is currently in its cooldown, the next pump must still
          // see the jump instead of silently accepting the new phase.
          lastWallSampleMs = wall;
          lastMonoSampleMs = mono;
        }
        return jumped;
      }

      function audioClockStalled() {
        const mono = performance.now();
        if (!lastAudioSampleMonoMs) {
          lastAudioSampleMonoMs = mono;
          lastAudioClockSec = ctx.currentTime;
          return false;
        }
        const monoDelta = mono - lastAudioSampleMonoMs;
        const audioDelta = ctx.currentTime - lastAudioClockSec;
        lastAudioSampleMonoMs = mono;
        lastAudioClockSec = ctx.currentTime;
        return monoDelta > AUDIO_STALL_MS && audioDelta < 0.02;
      }

      // Estimate the audio sample clock's rate relative to UTC and feed a very
      // slow correction into the UTC-to-audio mapping. The display clock is
      // not touched. This is intentionally rate-limited and clamped: a short
      // noisy sample must not be able to bend the audio timeline.
      function updateAudioRate(actualUtc, expectedUtc) {
        const mono = performance.now();
        if (!audioAnchorMonoMs) return;
        const elapsedSec = (mono - audioAnchorMonoMs) / 1000;
        if (elapsedSec < AUDIO_SKEW_MIN_SAMPLE_MS / 1000) return;
        if (mono - lastAudioRateUpdateMonoMs < AUDIO_SKEW_UPDATE_MS) return;
        const residualPpm = ((actualUtc - expectedUtc) / elapsedSec) * 1000;
        if (!Number.isFinite(residualPpm) || Math.abs(residualPpm) > 1000) return;
        audioSkewPpm = Math.max(
          -AUDIO_SKEW_LIMIT_PPM,
          Math.min(AUDIO_SKEW_LIMIT_PPM, audioSkewPpm - residualPpm * AUDIO_SKEW_GAIN),
        );
        audioTimeScale = 1 + audioSkewPpm * 1e-6;
        lastAudioRateUpdateMonoMs = mono;
      }

      function tryReanchor(reason) {
        const now = performance.now();
        if (now - lastReanchorMonoMs < REANCHOR_COOLDOWN_MS) return false;
        lastReanchorMonoMs = now;
        lastReanchorReason = reason;
        console.info(`BPM scheduler re-anchor: ${reason}`);
        reschedule();
        return true;
      }

      // Force a fresh audio timeline anchor. This is used after a successful
      // clock sync even when the displayed offset did not change: the audio
      // scheduler must not be allowed to keep an old phase while the display
      // clock has moved.
      function reanchor(reason = 'manual') {
        if (!running || !playbackStarted || !ctx) return false;
        lastReanchorReason = reason;
        console.info(`BPM scheduler re-anchor: ${reason}`);
        reschedule();
        return true;
      }

      function getTimingDiagnostics() {
        if (!ctx || !playbackStarted) return null;
        const displayUtc = Date.now() + localOffset + GLOBAL_OFFSET_MS;
        const audioUtc = audioToUtcMs(ctx.currentTime);
        const compensationMs = networkCompensation + deviceExtraMs;
        const baseLatencyMs = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency * 1000 : null;
        const outputLatencyMs = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency * 1000 : null;
        return {
          audioClockSec: ctx.currentTime,
          audioTimelineDeltaMs: audioUtc - (displayUtc + compensationMs),
          audioContextSession: sessionToken,
          audioSampleRate: ctx.sampleRate,
          audioBaseLatencyMs: baseLatencyMs,
          audioOutputLatencyMs: outputLatencyMs,
          audioContextState: ctx.state || '',
          audioSinkId: typeof ctx.sinkId === 'string' ? ctx.sinkId : '',
          audioSkewPpm,
          audioTimeScale,
          deviceExtraMs,
          reanchorReason: lastReanchorReason,
        };
      }

      const wwvPeakCache = new Map();

      function bufferPeak(buffer) {
        if (!buffer || typeof buffer.getChannelData !== 'function') return 0;
        const data = buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          const abs = Math.abs(data[i]);
          if (abs > peak) peak = abs;
        }
        return peak;
      }

      function wwvSpritePeak(key) {
        if (wwvPeakCache.has(key)) return wwvPeakCache.get(key);
        const entry = wwvSpriteEntry(key);
        let peak = 0;
        if (entry && wwvSpriteBuffer && typeof wwvSpriteBuffer.getChannelData === 'function') {
          const data = wwvSpriteBuffer.getChannelData(0);
          const start = Math.max(0, Math.round((entry[0] / 1000) * wwvSpriteBuffer.sampleRate));
          const end = Math.min(data.length, start + Math.round((entry[1] / 1000) * wwvSpriteBuffer.sampleRate));
          for (let i = start; i < end; i += 1) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
          }
        }
        wwvPeakCache.set(key, peak);
        return peak;
      }

      function scheduleWWVBuffered(station, buffer, when, offset, duration, gain = 1, category = null) {
        if (!ctx || !buffer || !Number.isFinite(when) || when < ctx.currentTime + 0.005) return;
        const stationGain = station === 'wwv' ? wwvGain : wwvhGain;
        const destination = category && wwvAdjustNodes && wwvAdjustNodes[station]
          ? wwvAdjustNodes[station][category]
          : stationGain;
        if (!destination || duration <= 0) return;
        const level = Number.isFinite(gain) && gain > 0 ? gain : 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const levelGain = ctx.createGain();
        levelGain.gain.value = level;
        src.connect(levelGain);
        levelGain.connect(destination);
        src.start(when, Math.max(0, offset), duration);
        const rec = { src, when };
        scheduled.add(rec);
        src.onended = () => { scheduled.delete(rec); };
      }

      function scheduleWWVEvent(ev) {
        if (!ctx || !playbackStarted) return;
        const config = WWV_STATIONS[ev.station];
        if (!config) return;
        const when = utcToAudioTime(ev.utcMs);
        if (!Number.isFinite(when) || when < ctx.currentTime + 0.005) return;

        let buffer = null;
        let offset = 0;
        let duration = 0;
        let gain = 1;
        let category = null;
        if (ev.generatedTone) {
          buffer = wwvBuffers && wwvBuffers[`tone${ev.generatedTone}`];
          duration = (ev.durationMs || 0) / 1000;
          category = 'tone';
        } else if (ev.generatedPulse) {
          buffer = wwvBuffers && wwvBuffers[ev.generatedPulse];
          duration = buffer ? buffer.duration : 0;
        } else if (ev.ident) {
          buffer = wwvIdentBuffers[config.prefix];
          duration = (ev.durationMs || (buffer ? buffer.duration * 1000 : 0)) / 1000;
          gain = WWV_LEVELS.voice / Math.max(0.01, bufferPeak(buffer));
          category = 'voice';
        } else {
          if (!wwvSpriteBuffer) return;
          const entry = wwvSpriteEntry(ev.spriteKey);
          if (!entry) return;
          buffer = wwvSpriteBuffer;
          offset = entry[0] / 1000;
          duration = entry[1] / 1000;
          const isCode = ev.spriteKey.startsWith('digital_');
          category = isCode ? 'code' : 'voice';
          const target = isCode ? WWV_LEVELS.code : WWV_LEVELS.voice;
          gain = target / Math.max(0.01, wwvSpritePeak(ev.spriteKey));
        }
        scheduleWWVBuffered(ev.station, buffer, when, offset, duration, gain, category);
      }

      function ensureWWVVoices() {
        if (!ctx || !wwvSpriteBuffer || !playbackStarted) return;
        const nowUtc = Date.now() + totalOffsetMs();
        const minuteStart = Math.floor(nowUtc / 60000) * 60000;
        for (const [stationId, config] of Object.entries(WWV_STATIONS)) {
          if (wwvVoiceCatchup[stationId]) continue;
          const nowDate = new Date(nowUtc);
          const base = WWV_TONE_SCHEDULE[nowDate.getUTCMinutes()][config.toneIndex];
          const identDuration = base === 'ident'
            ? (wwvIdentDurations[config.prefix] || 0)
            : 0;
          const minuteElapsed = nowUtc - minuteStart;
          const identStart = 1000;
          if (
            base === 'ident'
            && identDuration > 0
            && minuteElapsed >= identStart + 50
            && minuteElapsed < identStart + identDuration
          ) {
            const identBuffer = wwvIdentBuffers[config.prefix];
            if (identBuffer) {
              const identElapsed = minuteElapsed - identStart;
              const offset = identElapsed / 1000;
              const duration = (identDuration - identElapsed) / 1000;
              if (duration > 0.02) {
                scheduleWWVBuffered(
                  stationId,
                  identBuffer,
                  ctx.currentTime + 0.05,
                  offset,
                  duration,
                  WWV_LEVELS.voice / Math.max(0.01, bufferPeak(identBuffer)),
                  'voice',
                );
              }
            }
          }
          const clips = buildWWVVoiceClips(config, minuteStart);
          const active = clips.find((clip) => {
            const start = minuteStart + clip.startMs;
            return nowUtc >= start && nowUtc < start + clip.durationMs;
          });
          if (active) {
            const start = minuteStart + active.startMs;
            const offset = (nowUtc - start) / 1000;
            const duration = (active.durationMs / 1000) - offset;
            if (duration > 0.02) {
              scheduleWWVBuffered(
                stationId,
                wwvSpriteBuffer,
                ctx.currentTime + 0.05,
                wwvSpriteEntry(active.key)[0] / 1000 + offset,
                duration,
                WWV_LEVELS.voice / Math.max(0.01, wwvSpritePeak(active.key)),
                'voice',
              );
            }
          }
          wwvVoiceCatchup[stationId] = true;
        }
      }

      function scheduleEvent(ev) {
        if (ev.station === 'wwv' || ev.station === 'wwvh') {
          scheduleWWVEvent(ev);
          return;
        }
        if (ev.station === 'rwm') {
          if (!buffers || !buffers[ev.buffer] || !rwmGain) return;
          const when = utcToAudioTime(ev.utcMs);
          if (!Number.isFinite(when) || when < ctx.currentTime + 0.005) return;
          const destination = ev.category && rwmAdjustNodes
            ? (rwmAdjustNodes[ev.category] || rwmGain)
            : rwmGain;
          const src = ctx.createBufferSource();
          src.buffer = buffers[ev.buffer];
          src.connect(destination);
          src.start(when);
          if (Number.isFinite(ev.durationMs)) {
            src.stop(when + Math.max(0, ev.durationMs) / 1000);
          }
          const rec = { src, when };
          scheduled.add(rec);
          src.onended = () => { scheduled.delete(rec); };
          return;
        }
        if (!buffers || !buffers[ev.buffer]) return;
        const when = utcToAudioTime(ev.utcMs);
        if (!Number.isFinite(when) || when < ctx.currentTime + 0.005) return;
        const src = ctx.createBufferSource();
        src.buffer = buffers[ev.buffer];
        const bus = ev.bus === 'sub' ? subGain : (ev.bus === 'morse' ? (morseGain || pulseGain) : pulseGain);
        const offset = (ev.offsetMs || 0) / 1000;
        const requestedDuration = (ev.durationMs !== undefined && ev.durationMs !== null)
          ? ev.durationMs / 1000
          : null;
        const fullDuration = src.buffer.duration || (src.buffer.length / src.buffer.sampleRate);
        const playDuration = requestedDuration !== null ? requestedDuration : fullDuration - offset;
        const needsGain = offset > 0.0001 || (requestedDuration !== null && playDuration < fullDuration - 0.0001);
        let stopAt = null;
        if (needsGain) {
          const gainNode = ctx.createGain();
          const fade = Math.min(0.001, Math.max(0.0002, playDuration / 4));
          if (offset > 0.0001) {
            gainNode.gain.setValueAtTime(0, when);
            gainNode.gain.linearRampToValueAtTime(1, when + fade);
          } else {
            gainNode.gain.setValueAtTime(1, when);
          }
          if (requestedDuration !== null) {
            const endAt = when + playDuration;
            const fadeStart = Math.max(when + fade, endAt - fade);
            gainNode.gain.setValueAtTime(1, fadeStart);
            gainNode.gain.linearRampToValueAtTime(0, endAt);
            stopAt = endAt + 0.002;
          }
          src.connect(gainNode);
          gainNode.connect(bus);
        } else {
          src.connect(bus);
        }
        src.start(when, offset);
        if (stopAt !== null) src.stop(stopAt);
        const rec = { src, when };
        scheduled.add(rec);
        src.onended = () => { scheduled.delete(rec); };
      }

      function ensureVoice() {
        if (!running || !playbackStarted || !voiceBuffer || forceUtcOnly || !ctx) return;
        const nowUtc = Date.now() + totalOffsetMs();
        const d = new Date(nowUtc);
        const period = getPeriodType(d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
        if (period !== 'call') return;
        const minuteStart = Math.floor(nowUtc / 60000) * 60000;
        if (voiceMinute === minuteStart) return;
        const voiceStart = minuteStart + 40000;
        const secOfMinute = (nowUtc - minuteStart) / 1000;
        if (secOfMinute < 39.5 || secOfMinute >= 60) return;
        const offset = secOfMinute >= 40 ? (nowUtc - voiceStart) / 1000 : 0;
        if (offset >= 20) return;
        const when = secOfMinute < 40
          ? utcToAudioTime(voiceStart)
          : ctx.currentTime + 0.05;
        if (when < ctx.currentTime + 0.005) return;
        const src = ctx.createBufferSource();
        src.buffer = voiceBuffer;
        src.connect(voiceEQInput || voiceGain);
        src.start(when, offset);
        voiceMinute = minuteStart;
        voiceSource = src;
        src.onended = () => {
          if (voiceSource === src) voiceSource = null;
        };
      }

      function pump() {
        if (!running || !playbackStarted || !ctx) return;
        const mono = performance.now();
        lastPumpMonoMs = mono;
        if (ctx.state !== 'running') {
          // Never schedule against a suspended/frozen audio clock. The
          // pending sources would all fire in a burst when it resumes.
          const resumed = ctx.resume();
          if (resumed && typeof resumed.catch === 'function') resumed.catch(() => { });
          return;
        }
        // A running AudioContext can still have a frozen currentTime for a
        // while after device resume. Do not turn that into a scheduling loop.
        reportOutputLatency();
        if (audioClockStalled()) return;
        if (wallClockJumped()) {
          handleSystemClockJump();
          tryReanchor('wall clock jump');
          return;
        }
        const expectedUtc = audioToUtcMs(ctx.currentTime);
        const actualUtc = Date.now() + totalOffsetMs();
        if (Math.abs(actualUtc - expectedUtc) > SKEW_REANCHOR_MS) {
          // NTP/manual clock steps or a stale audio anchor. Re-anchor instead
          // of keeping the wrong UTC phase for the rest of the look-ahead.
          tryReanchor('wall/audio skew');
          return;
        }
        updateAudioRate(actualUtc, expectedUtc);
        const nowUtc = Date.now() + totalOffsetMs();
        const target = nowUtc + LOOKAHEAD_MS;
        if (target <= scheduledUntil) {
          ensureVoice();
          ensureWWVVoices();
          return;
        }
        const from = Math.max(scheduledUntil, nowUtc - 1000);
        const events = buildNextAudioEvents(from, target);
        for (const ev of events) scheduleEvent(ev);
        scheduledUntil = target;
        ensureVoice();
        ensureWWVVoices();
      }

      function startPump() {
        stopPump();
        pumpTimer = setInterval(pump, PUMP_MS);
        startWorker();
      }

      function stopPump() {
        if (pumpTimer) {
          clearInterval(pumpTimer);
          pumpTimer = null;
        }
        if (rescheduleTimer) {
          clearTimeout(rescheduleTimer);
          rescheduleTimer = null;
        }
        stopWorker();
      }

      function startWorker() {
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return;
        try {
          workerUrl = URL.createObjectURL(new Blob(
            ['setInterval(function(){postMessage(0);},250);'],
            { type: 'text/javascript' },
          ));
          worker = new Worker(workerUrl);
          worker.onmessage = () => pump();
        } catch (e) {
          stopWorker();
        }
      }

      function stopWorker() {
        if (worker) {
          try { worker.terminate(); } catch (e) { }
          worker = null;
        }
        if (workerUrl) {
          try { URL.revokeObjectURL(workerUrl); } catch (e) { }
          workerUrl = null;
        }
      }

      function afterAudioClockRunning(callback, token) {
        if (!ctx) return;
        const baseTime = ctx.currentTime;
        const startedAt = performance.now();
        const tick = () => {
          if (token !== sessionToken || !running || !ctx) return;
          // Wait until the audio clock has actually advanced after resume.
          // Anchoring at a frozen currentTime makes the whole schedule late by
          // the (variable) device startup delay on every play.
          if (ctx.state === 'running' && ctx.currentTime > baseTime + 0.05) {
            callback();
            return;
          }
          const elapsed = performance.now() - startedAt;
          if (elapsed > START_CLOCK_WAIT_MS && ctx.currentTime > baseTime + 0.001) {
            // Some mobile outputs take much longer than the old 300 ms
            // fallback. Give them time, but never anchor on a completely
            // frozen audio clock.
            console.warn('BPM audio clock started late; anchoring after resume');
            callback();
            return;
          }
          setTimeout(tick, 10);
        };
        tick();
      }

      function start(onReady, onError) {
        if (running) {
          if (typeof onReady === 'function') onReady();
          return;
        }
        running = true;        playbackStarted = false;
        audioTimeScale = 1;
        audioSkewPpm = 0;
        lastAudioRateUpdateMonoMs = 0;
        const token = ++sessionToken;
        let readyCalled = false;
        const markReady = () => {
          if (readyCalled) return;
          readyCalled = true;
          if (typeof onReady === 'function') onReady();
        };
        try {
          if (!ctx || ctx.state === 'closed' || !masterGain || !buffers) {
            if (ctx && ctx.state !== 'closed') {
              try { ctx.close(); } catch (e) { }
            }
            buildGraph();
            buildBuffers();
            loadWWVAssets();
          }
          loadWWVAssets();
          buildNoise();
          const baseLatency = Number.isFinite(ctx.baseLatency) ? `${(ctx.baseLatency * 1000).toFixed(1)}ms` : '?';
          const outputLatency = Number.isFinite(ctx.outputLatency) ? `${(ctx.outputLatency * 1000).toFixed(1)}ms` : '?';
          console.info(`BPM buffered engine: ${ctx.sampleRate} Hz, ${LOOKAHEAD_MS / 1000}s look-ahead, baseLatency ${baseLatency}, outputLatency ${outputLatency}`);
          const begin = () => {
            if (token !== sessionToken || !running || !ctx) return;
            playbackStarted = true;
            anchor();
            pump();
            startPump();
            markReady();
            try {
              const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
              if (!OfflineCtor) throw new Error('OfflineAudioContext unavailable');
              const offline = new OfflineCtor(1, 1, 8000);
              preloadVoiceAudio(offline, () => { if (running && playbackStarted) ensureVoice(); });
            } catch (e) {
              preloadVoiceAudio(ctx, () => { if (running && playbackStarted) ensureVoice(); });
            }
          };
          const resumeThenBegin = () => {
            if (token !== sessionToken || !running || !ctx) return;
            let resumed;
            try {
              resumed = ctx.resume();
            } catch (e) {
              console.error('BPM audio resume failed:', e);
              if (typeof onError === 'function') onError(e);
              if (running) stop();
              return;
            }
            if (resumed && typeof resumed.then === 'function') {
              resumed.then(() => {
                if (token !== sessionToken || !running || !ctx) return;
                afterAudioClockRunning(begin, token);
              }).catch((e) => {
                console.error('BPM audio resume failed:', e);
                if (typeof onError === 'function') onError(e);
                if (running) stop();
              });
            } else {
              afterAudioClockRunning(begin, token);
            }
          };
          resumeThenBegin();
        } catch (e) {
          stop();
          throw e;
        }
      }

      function stopVoice() {
        if (!voiceSource) return;
        try { voiceSource.stop(); } catch (e) { }
        voiceSource = null;
        voiceMinute = -1;
      }

      function stop() {
        sessionToken += 1;
        running = false;
        playbackStarted = false;
        timingDirty = false;
        stopPump();
        for (const rec of scheduled) {
          try { rec.src.stop(); } catch (e) { }
        }
        scheduled.clear();
        stopVoice();
        wwvVoiceCatchup.wwv = false;
        wwvVoiceCatchup.wwvh = false;
        if (noiseSource) {
          try { noiseSource.stop(); } catch (e) { }
          try { noiseSource.disconnect(); } catch (e) { }
        }
        noiseSource = null;
        if (noiseSource2) {
          try { noiseSource2.stop(); } catch (e) { }
          try { noiseSource2.disconnect(); } catch (e) { }
        }
        noiseSource2 = null;
        if (noiseGain) {
          try { noiseGain.disconnect(); } catch (e) { }
        }
        noiseGain = null;
        // Do not suspend or close the context on pause. Keeping the running
        // context/output pipeline alive makes the audio device startup delay
        // identical for the first and every subsequent play.
      }

      function resetOutput(onReady, onError) {
        const wasRunning = running;
        stop();
        if (ctx) {
          const oldCtx = ctx;
          ctx = null;
          try {
            const closing = oldCtx.close();
            if (closing && typeof closing.catch === 'function') closing.catch(() => { });
          } catch (e) { }
        }
        masterGain = null;
        limiterNode = null;
        bpmGain = null;
        wwvGain = null;
        wwvhGain = null;
        rwmGain = null;
        wwvAdjustNodes = null;
        rwmAdjustNodes = null;
        pulseGain = null;
        morseGain = null;
        subGain = null;
        voiceGain = null;
        voiceEQInput = null;
        noiseSource = null;
        noiseSource2 = null;
        noiseGain = null;
        buffers = null;
        wwvBuffers = null;
        wwvSpriteBuffer = null;
        wwvIdentBuffers = { h: null, v: null };
        wwvIdentDurations.h = 0;
        wwvIdentDurations.v = 0;
        wwvLoadPromise = null;
        lastOutputLatencyMs = null;
        if (!wasRunning) {
          if (typeof onReady === 'function') onReady();
          return true;
        }
        try {
          start(onReady, onError);
          return true;
        } catch (e) {
          console.error('BPM audio output reset failed:', e);
          running = false;
          if (typeof onError === 'function') onError(e);
          return false;
        }
      }

      function reschedule() {
        if (!running || !playbackStarted || !ctx) return;
        if (ctx.state !== 'running') {
          // Keep the request pending; onVisible/start will resume and retry.
          timingDirty = true;
          return;
        }
        if (audioClockStalled()) {
          timingDirty = true;
          return;
        }
        timingDirty = false;
        lastReanchorMonoMs = performance.now();
        if (rescheduleTimer) {
          clearTimeout(rescheduleTimer);
          rescheduleTimer = null;
        }
        const now = ctx.currentTime;
        for (const rec of Array.from(scheduled)) {
          if (rec.when >= now + GUARD_SEC) {
            try { rec.src.stop(); } catch (e) { }
            scheduled.delete(rec);
          }
        }
        anchor();
        // Keep the already-scheduled events inside the guard window; start the
        // new schedule after them to avoid double-triggering.
        scheduledUntil = Date.now() + totalOffsetMs() + GUARD_SEC * 1000;
        pump();
      }

      function onTimingChanged() {
        if (!running || !playbackStarted) return;
        if (forceUtcOnly) stopVoice();
        // DUT1 AUTO refreshes every 10 minutes even when the value did not
        // change; do not disturb the schedule in that case.
        if (timingKey() === lastTimingKey) return;
        timingDirty = true;
        if (rescheduleTimer) clearTimeout(rescheduleTimer);
        rescheduleTimer = setTimeout(() => {
          rescheduleTimer = null;
          reschedule();
        }, 30);
      }

      function onVisible() {
        if (!running || !playbackStarted || !ctx) return;
        const wasAway = performance.now() - lastPumpMonoMs > 1500;
        if (ctx.state !== 'running') {
          const token = sessionToken;
          const resumed = ctx.resume();
          if (resumed && typeof resumed.then === 'function') {
            resumed.then(() => {
              if (token !== sessionToken || !running || !playbackStarted || !ctx) return;
              afterAudioClockRunning(() => {
                if (token === sessionToken && running && playbackStarted && ctx) reschedule();
              }, token);
            }).catch((e) => {
              console.error('BPM audio resume failed:', e);
            });
          } else {
            afterAudioClockRunning(() => {
              if (token === sessionToken && running && playbackStarted && ctx) reschedule();
            }, token);
          }
          return;
        }
        if (timingDirty || wasAway) {
          // After a long lock/background period, wait for the audio clock to
          // advance again before re-anchoring. Otherwise the first schedule
          // after unlock is late by the output-resume latency.
          const token = sessionToken;
          afterAudioClockRunning(() => {
            if (token === sessionToken && running && playbackStarted && ctx) reschedule();
          }, token);
        } else {
          pump();
        }
      }

      function setVolume(value) {
        if (masterGain && ctx) masterGain.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      }

      function setStationVolume(station, value) {
        const gain = station === 'wwv'
          ? wwvGain
          : (station === 'wwvh' ? wwvhGain : (station === 'rwm' ? rwmGain : bpmGain));
        if (gain && ctx) gain.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      }

      function setMasterVolume(value) {
        if (masterGain && ctx) masterGain.gain.setTargetAtTime(Math.pow(value, 3), ctx.currentTime, 0.01);
        if (noiseGain && ctx) {
          noiseGain.gain.setTargetAtTime(Math.pow(Math.min(value, noiseVolume), 3), ctx.currentTime, 0.01);
        }
      }

      function setLowFreqVolume(value) {
        if (subGain && ctx) subGain.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      }

      function setBpmMorseAdjust(value) {
        if (morseGain && ctx) {
          morseGain.gain.setTargetAtTime(BPM_MORSE_BASE_GAIN * value, ctx.currentTime, 0.01);
        }
      }

      function setBpmVoiceAdjust(value) {
        if (voiceGain && ctx) {
          voiceGain.gain.setTargetAtTime(BPM_VOICE_BASE_GAIN * value, ctx.currentTime, 0.01);
        }
      }

      function setWWVAdjustment(station, kind, value) {
        if (!wwvAdjustNodes || !wwvAdjustNodes[station] || !wwvAdjustNodes[station][kind]) return;
        wwvAdjustNodes[station][kind].gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      }

      function setRWMAdjustment(kind, value) {
        if (!rwmAdjustNodes || !rwmAdjustNodes[kind] || !ctx) return;
        rwmAdjustNodes[kind].gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      }

      function setRwmBeatFrequency(value) {
        rwmBeatHz = clampRwmBeatHz(value);
        if (!ctx || !buffers) return;
        try {
          buildRwmBuffers();
        } catch (e) {
          console.error('RWM beat frequency rebuild failed:', e);
        }
      }

      function setNoiseVolume(value) {
        if (noiseGain && ctx) {
          noiseGain.gain.setTargetAtTime(Math.pow(Math.min(masterVolume, value), 3), ctx.currentTime, 0.01);
        }
      }

      function wake() {
        if (!ctx || ctx.state !== 'suspended') return Promise.resolve();
        try {
          return ctx.resume();
        } catch (e) {
          return Promise.reject(e);
        }
      }

      function getScheduleRemainingMs() {
        if (!running || !playbackStarted || !scheduledUntil) return 0;
        const nowUtc = Date.now() + totalOffsetMs();
        return Math.max(0, scheduledUntil - nowUtc);
      }

      return {
        start,
        stop,
        wake,
        resetOutput,
        getScheduleRemainingMs,
        stopVoice,
        reschedule,
        onTimingChanged,
        reanchor,
        getTimingDiagnostics,
        onVisible,
        setVolume,
        setStationVolume,
        setMasterVolume,
        setLowFreqVolume,
        setBpmMorseAdjust,
        setBpmVoiceAdjust,
        setWWVAdjustment,
        setRWMAdjustment,
        setRwmBeatFrequency,
        setNoiseVolume,
        isRunning: () => running,
      };
    })();

