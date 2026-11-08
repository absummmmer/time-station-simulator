// Time synchronization: DUT1 API refresh, time samples, sync audit and trace data stores.
// UI and startup: clock rendering, stations, charts, panels and DOM wiring.
    // --- Automatic DUT1 updates from the self-hosted Time API ---
    function dut1DateKey(date) {
      return `${date.getUTCFullYear().toString().padStart(4, '0')}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date.getUTCDate().toString().padStart(2, '0')}`;
    }

    function setEopStatus(text, colorClass, title) {
      const status = document.getElementById('eop_status');
      if (!status) return;
      status.textContent = text;
      status.classList.remove('text-green-400', 'text-red-400', 'text-yellow-400', 'text-gray-500');
      status.classList.add(colorClass || 'text-gray-500');
      status.title = title || '';
    }

    function normalizeDut1SourceKey(info, fallback = '') {
      const key = info && info.source_key;
      if (key === 'ntsc' || key === 'iers') return key;
      const name = String((info && info.source) || '');
      if (name.includes('NTSC')) return 'ntsc';
      if (name.includes('IERS')) return 'iers';
      return fallback;
    }

    function dut1PointForDate(series, key) {
      if (!series || !series.has(key)) return null;
      const value = series.get(key);
      return Number.isFinite(value) ? value : null;
    }

    function applyDut1ForDate(date) {
      if (!dut1AutoMode) {
        if (!window.isAutoDUT1 || !window.eopData) return false;
        const utcNow = new Date(date.getTime() + localOffset + GLOBAL_OFFSET_MS);
        const key = dut1DateKey(utcNow);
        if (!window.eopData.has(key)) return false;
        const value = clampDut1Ms(window.eopData.get(key));
        if (window.bpmDUT1 === value && window.otherDUT1 === value && window.ut1DUT1 === value) return false;
        setCommonDut1(value);
        return true;
      }
      if (!dut1AutoSeriesBySource) return false;
      // Match updateTimeDisplay(): the displayed UTC date includes localOffset.
      const utcNow = new Date(date.getTime() + localOffset + GLOBAL_OFFSET_MS);
      const key = dut1DateKey(utcNow);
      const ntsc = dut1PointForDate(dut1AutoSeriesBySource.ntsc, key);
      const iers = dut1PointForDate(dut1AutoSeriesBySource.iers, key);
      if (ntsc == null && iers == null) return false;

      const bpmValue = ntsc != null ? ntsc : iers;
      const otherValue = iers != null ? iers : ntsc;
      let selectedKey = dut1SourceMode;
      if (selectedKey === 'auto') {
        selectedKey = dut1AutoPrimaryKey || (ntsc != null ? 'ntsc' : 'iers');
      }
      const selectedValue = selectedKey === 'ntsc'
        ? (ntsc != null ? ntsc : iers)
        : (iers != null ? iers : ntsc);
      const nextSplit = ntsc != null && iers != null;
      const changed = window.bpmDUT1 !== bpmValue
        || window.otherDUT1 !== otherValue
        || window.ut1DUT1 !== selectedValue
        || dut1SplitActive !== nextSplit;
      window.bpmDUT1 = clampDut1Ms(bpmValue);
      window.otherDUT1 = clampDut1Ms(otherValue);
      window.ut1DUT1 = clampDut1Ms(selectedValue);
      dut1SplitActive = nextSplit;
      return changed;
    }

    function updateDut1AutoUI() {
      const checkbox = document.getElementById('auto_dut1_mode');
      if (checkbox) checkbox.checked = dut1AutoMode;
      const manual = document.getElementById('dut1_manual_controls');
      if (manual) manual.style.display = dut1AutoMode ? 'none' : '';
      const fileControls = document.getElementById('dut1_file_controls');
      if (fileControls) fileControls.style.display = dut1AutoMode ? 'none' : '';
      const sourceLinks = document.getElementById('dut1_source_links');
      if (sourceLinks) sourceLinks.style.display = dut1AutoMode ? 'none' : '';
      const resetBtn = document.querySelector('[data-offset="dut1"][data-delta="reset"]');
      if (resetBtn) resetBtn.style.display = dut1AutoMode ? 'none' : '';
    }

    async function fetchDut1Payload(signal) {
      const source = dut1SourceMode;
      const resp = await fetch(timeApiUrl('/v1/dut1', { source, _: Date.now() }), {
        cache: 'no-store',
        signal,
      });
      if (resp.ok) return resp.json();
      // Older reverse-proxy rules may only forward /v1/time. That endpoint
      // carries the same DUT1 object, so fall back to it on 404/405.
      if (resp.status === 404 || resp.status === 405) {
        const timeResp = await fetch(timeApiUrl('/v1/time', { timezone: 'UTC', _: Date.now() }), {
          cache: 'no-store',
          signal,
        });
        if (!timeResp.ok) throw new Error(`HTTP ${timeResp.status}`);
        const timeData = await timeResp.json();
        return timeData.dut1;
      }
      throw new Error(`HTTP ${resp.status}`);
    }

    function displayDut1DateKey() {
      return dut1DateKey(new Date(displayUtcNowMs()));
    }

    function clearDut1FetchTimer() {
      if (dut1AutoFetchTimer) {
        clearTimeout(dut1AutoFetchTimer);
        dut1AutoFetchTimer = null;
      }
      dut1AutoScheduledDate = '';
    }

    function scheduleDut1FetchIn(delayMs, dateKey) {
      clearDut1FetchTimer();
      dut1AutoScheduledDate = dateKey;
      dut1AutoFetchTimer = setTimeout(() => {
        const scheduled = dut1AutoScheduledDate;
        dut1AutoFetchTimer = null;
        dut1AutoScheduledDate = '';
        if (!dut1AutoMode) return;
        if (scheduled !== dateKey || displayDut1DateKey() !== dateKey) {
          // A date change invalidates the old date's pending fetch/retry.
          dut1AutoTick();
          return;
        }
        refreshDut1Auto();
      }, Math.max(0, delayMs));
    }

    function scheduleDut1InitialFetch(dateKey) {
      if (!dut1AutoMode || dut1AutoBusy) return;
      if (dut1AutoSuccessDate === dateKey) return;
      if (dut1AutoFetchTimer && dut1AutoScheduledDate === dateKey) return;
      if (displayDut1DateKey() !== dateKey) return;
      const now = displayUtcNowMs();
      const d = new Date(now);
      const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const end = midnight + DUT1_AUTO_INITIAL_WINDOW_MS;
      const delay = now < end ? Math.random() * (end - now) : 0;
      scheduleDut1FetchIn(delay, dateKey);
    }

    function scheduleDut1Retry(dateKey) {
      if (!dut1AutoMode) return;
      if (displayDut1DateKey() !== dateKey) {
        dut1AutoTick();
        return;
      }
      const range = DUT1_AUTO_RETRY_MAX_MS - DUT1_AUTO_RETRY_MIN_MS;
      const delay = DUT1_AUTO_RETRY_MIN_MS + Math.random() * range;
      scheduleDut1FetchIn(delay, dateKey);
    }

    function dut1SourceShortName(sourceKey, sourceName) {
      if (sourceKey === 'ntsc') return 'NTSC';
      if (sourceKey === 'iers') return 'IERS';
      const name = String(sourceName || '');
      if (name.includes('NTSC')) return 'NTSC';
      if (name.includes('IERS')) return 'IERS';
      return name || 'API';
    }

    function formatDut1CompactSeconds(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return `${number >= 0 ? '+' : ''}${number.toFixed(3)}`;
    }

    function dut1SourceSeries(info) {
      const series = new Map();
      for (const name of ['previous', 'current', 'next']) {
        const point = info && info[name];
        if (point && point.date && typeof point.value === 'number') {
          series.set(point.date.replace(/-/g, ''), point.value * 1000);
        }
      }
      return series;
    }

    function setDut1CompactStatus(data, dateKey) {
      const activeKey = data.source_key || (String(data.source || '').includes('NTSC') ? 'ntsc' : 'iers');
      const activeLabel = dut1SourceShortName(activeKey, data.source);
      const other = data.alternate || null;
      const otherKey = other && other.source_key
        ? other.source_key
        : (activeKey === 'ntsc' ? 'iers' : 'ntsc');
      const otherLabel = dut1SourceShortName(otherKey, other && other.source);
      const pickPoint = (info, key) => {
        if (!info || !key) return null;
        for (const name of ['current', 'previous', 'next']) {
          const point = info[name];
          if (point && point.date && point.date.replace(/-/g, '') === key) return point;
        }
        return null;
      };
      const key = dateKey || (data.current && data.current.date
        ? data.current.date.replace(/-/g, '')
        : '');
      const activePoint = pickPoint(data, key) || data.current || null;
      const otherPoint = pickPoint(other, key) || (other && other.current) || null;
      const otherValue = otherPoint && Number.isFinite(Number(otherPoint.value))
        ? formatDut1CompactSeconds(otherPoint.value)
        : '—';
      const date = activePoint && activePoint.date
        ? activePoint.date.replace(/-/g, '')
        : (key || '—');
      const title = [
        `${data.source || 'Time API'} ${activePoint ? activePoint.date : '—'} UT1-UTC ${activePoint ? Number(activePoint.value).toFixed(6) : '—'} s (${activePoint ? activePoint.type : 'unknown'})`,
        otherPoint
          ? `${other.source || otherKey} ${otherPoint.date} UT1-UTC ${Number(otherPoint.value).toFixed(6)} s (${otherPoint.type || 'unknown'}${other.stale ? ', stale' : ''})`
          : `${otherLabel} value unavailable`,
        otherPoint && otherKey !== activeKey ? `Click to switch to ${otherLabel}` : '',
        `updated ${data.updated_at || 'unknown'}`,
      ].filter(Boolean).join('\n');
      setEopStatus(`${activeLabel}@${date}|${otherLabel}=${otherValue}`, 'text-green-400', title);
    }

    function applyDut1AutoPayload(data, fetchDateKey) {
      const primaryKey = normalizeDut1SourceKey(
        data,
        (dut1SourceMode === 'ntsc' || dut1SourceMode === 'iers') ? dut1SourceMode : '',
      );
      const series = dut1SourceSeries(data);
      if (!series.size) return false;
      const alternate = data.alternate || null;
      let alternateKey = alternate ? normalizeDut1SourceKey(alternate) : '';
      if (!alternateKey && alternate && primaryKey) {
        alternateKey = primaryKey === 'ntsc' ? 'iers' : 'ntsc';
      }
      const alternateSeries = alternate ? dut1SourceSeries(alternate) : null;
      dut1AutoSeriesBySource = { ntsc: null, iers: null };
      if (primaryKey === 'ntsc' || primaryKey === 'iers') {
        dut1AutoSeriesBySource[primaryKey] = series;
      }
      if (alternateKey === 'ntsc' || alternateKey === 'iers') {
        if (alternateSeries && alternateSeries.size) {
          dut1AutoSeriesBySource[alternateKey] = alternateSeries;
        }
      }
      dut1AutoPrimaryKey = primaryKey;
      dut1AutoAlternateKey = alternateKey;
      dut1AutoData = series;
      dut1AutoLastData = data;
      dut1AutoLastFetch = Date.now();
      dut1AutoLastError = '';
      dut1AutoSuccessDate = fetchDateKey;
      if (dut1AutoScheduledDate === fetchDateKey) clearDut1FetchTimer();
      window.eopData = series;
      window.isAutoDUT1 = true;
      window.currentDataSource = dut1SourceShortName(primaryKey, data.source);
      applyDut1ForDate(new Date());
      updateOffsetDisplay();
      updateTimeDisplay();
      setDut1CompactStatus(data, fetchDateKey);
      return true;
    }

    function switchDut1SourceToAlternate() {
      if (!dut1AutoMode) return;
      const data = dut1AutoLastData;
      const other = data && data.alternate;
      if (!other || !other.source_key || !other.current) return;
      const targetKey = other.source_key;
      if (targetKey === data.source_key) return;
      dut1SourceMode = targetKey;
      saveSettings();
      const targetData = {
        date: data.date,
        source: other.source,
        source_key: other.source_key,
        source_mode: targetKey,
        updated_at: other.updated_at,
        stale: other.stale,
        available: other.available,
        previous: other.previous,
        current: other.current,
        next: other.next,
        alternate: {
          source: data.source,
          source_key: data.source_key,
          updated_at: data.updated_at,
          stale: data.stale,
          available: data.available,
          previous: data.previous,
          current: data.current,
          next: data.next,
        },
      };
      if (!targetData.available || !applyDut1AutoPayload(targetData, displayDut1DateKey())) {
        setEopStatus(`switch→${dut1SourceShortName(targetKey, other.source)}`, 'text-gray-500', 'Switching DUT1 source');
      }
      startDut1Auto();
    }

    function handleDut1StatusClick() {
      if (!dut1AutoMode) return;
      const data = dut1AutoLastData;
      if (!data || !data.alternate || !data.alternate.source_key) return;
      switchDut1SourceToAlternate();
    }

    function dut1AutoTick() {
      if (!dut1AutoMode) return;
      const key = displayDut1DateKey();
      if (key !== dut1AutoLastSeenDate) {
        dut1AutoLastSeenDate = key;
        clearDut1FetchTimer();
        if (dut1AutoSuccessDate !== key && !dut1AutoBusy) {
          scheduleDut1InitialFetch(key);
        }
        return;
      }
      if (!dut1AutoBusy && dut1AutoSuccessDate !== key &&
        !dut1AutoFetchTimer && !dut1AutoScheduledDate) {
        scheduleDut1InitialFetch(key);
      }
    }

    async function refreshDut1Auto() {
      if (!dut1AutoMode || dut1AutoBusy) return;
      const fetchDateKey = displayDut1DateKey();
      dut1AutoBusy = true;
      if (!dut1AutoLastFetch) {
        const modeLabel = DUT1_SOURCE_MODE_LABELS[dut1SourceMode] || 'AUTO';
        setEopStatus(`API syncing… · ${modeLabel}`, 'text-gray-500', `Fetching DUT1 from the Time API (${modeLabel})`);
      }
      const controller = new AbortController();
      dut1AutoAbortController = controller;
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const data = await fetchDut1Payload(controller.signal);
        if (!data || data.available === false || !data.current || typeof data.current.value !== 'number') {
          throw new Error((data && data.error) ? data.error : 'no DUT1 data for today');
        }

        const series = dut1SourceSeries(data);
        if (series.size === 0) throw new Error('empty DUT1 series');
        if (!dut1AutoMode || dut1AutoAbortController !== controller) return;
        if (!applyDut1AutoPayload(data, fetchDateKey)) throw new Error('empty DUT1 series');
        if (displayDut1DateKey() !== fetchDateKey) setTimeout(dut1AutoTick, 0);
      } catch (e) {
        console.error('DUT1 auto update failed:', e);
        dut1AutoLastError = e && e.message ? e.message : String(e);
        if (dut1AutoMode && dut1AutoAbortController === controller) {
          const modeLabel = DUT1_SOURCE_MODE_LABELS[dut1SourceMode] || 'AUTO';
          setEopStatus(`API error · ${modeLabel}`, 'text-red-400', dut1AutoLastError);
          if (displayDut1DateKey() === fetchDateKey) {
            scheduleDut1Retry(fetchDateKey);
          } else {
            setTimeout(dut1AutoTick, 0);
          }
        }
      } finally {
        clearTimeout(timeoutId);
        if (dut1AutoAbortController === controller) {
          dut1AutoAbortController = null;
          dut1AutoBusy = false;
        }
      }
    }

    function startDut1Auto() {
      stopDut1Auto();
      if (!dut1AutoMode) return;
      if (!isTimeApiConfigured()) {
        setEopStatus('API · no URL', 'text-yellow-400', 'Time API backend is not configured');
        return;
      }
      const key = displayDut1DateKey();
      dut1AutoLastSeenDate = key;
      // One fetch on page refresh / enabling DUT1 AUTO.
      refreshDut1Auto();
      dut1AutoTimer = setInterval(() => {
        if (dut1AutoMode) dut1AutoTick();
      }, DUT1_AUTO_CHECK_MS);
    }

    function stopDut1Auto() {
      if (dut1AutoAbortController) {
        dut1AutoAbortController.abort();
        dut1AutoAbortController = null;
      }
      dut1AutoBusy = false;
      if (dut1AutoTimer) {
        clearInterval(dut1AutoTimer);
        dut1AutoTimer = null;
      }
      clearDut1FetchTimer();
      dut1AutoScheduledDate = '';
      dut1AutoSuccessDate = '';
      dut1AutoLastSeenDate = '';
    }

    function syncForceUtcUI() {
      const dut1Section = document.getElementById('dut1_section');
      if (dut1Section) dut1Section.style.display = 'block';
    }

    // NTSC and IERS parsers
    function parseNtscEop(content) {
      const lines = content.split('\n');
      const eopMap = new Map();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 16) continue;
        const year = parseInt(parts[0]), month = parseInt(parts[1]), day = parseInt(parts[2]);
        const ut1utc = parseFloat(parts[6]);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day) && !isNaN(ut1utc)) {
          const key = `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
          eopMap.set(key, ut1utc);
        }
      }
      return eopMap;
    }
    function parseIersBulletinA(content) {
      const lines = content.split('\n');
      const eopMap = new Map();
      let inObs = false;
      let inPred = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (line.includes('COMBINED EARTH ORIENTATION PARAMETERS')) {
          inObs = true;
          inPred = false;
          continue;
        }
        if (line.includes('PREDICTIONS')) {
          inObs = false;
          inPred = true;
          continue;
        }

        if (trimmed.startsWith('MJD') || trimmed.startsWith('_____') || trimmed.startsWith('---')) {
          continue;
        }

        if (inObs) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 9) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const day = parseInt(parts[2]);
            const ut1utc = parseFloat(parts[8]);
            if (!isNaN(year) && !isNaN(month) && !isNaN(day) && !isNaN(ut1utc)) {
              const fullYear = year < 100 ? 2000 + year : year;
              const key = `${fullYear.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
              eopMap.set(key, ut1utc);
            }
          }
        }

        if (inPred) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 7) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const day = parseInt(parts[2]);
            const ut1utc = parseFloat(parts[6]);
            if (!isNaN(year) && !isNaN(month) && !isNaN(day) && !isNaN(ut1utc)) {
              const key = `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
              if (!eopMap.has(key)) {
                eopMap.set(key, ut1utc);
              }
            }
          }
        }
      }

      return eopMap;
    }

    // Network sync: take several samples, discard the slowest ones, and use
    // the median offset. The server timestamp is generated before the body is
    // sent, so t4 must be taken after response.json() has consumed the body.
    const SYNC_SAMPLE_COUNT = 7;
    const SYNC_MIN_SAMPLES = 3;
    const SYSTEM_CLOCK_JUMP_MS = 80;

    async function fetchTimeSample() {
      const t1 = Date.now();
      const ntpUrl = timeApiUrl('/v1/time/ntp', { _: t1 });
      const timeUrl = timeApiUrl('/v1/time', { timezone: 'UTC', _: t1 });
      let controller = null;
      let timeout = null;
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 8000);
      }
      const requestOptions = {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      };
      try {
        let response;
        try {
          response = await fetch(ntpUrl, requestOptions);
        } catch (e) {
          // Fall back only for the transport/proxy failure of the new route.
          // An HTTP error from a reachable backend is handled below.
          response = await fetch(timeUrl, requestOptions);
        }
        // Older time-api deployments only have /v1/time. Keep the page usable
        // while the backend is being upgraded, but prefer the compact endpoint.
        if (response.status === 404 || response.status === 405) {
          response = await fetch(timeUrl, requestOptions);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const t4 = Date.now();
        let t2 = Number(data.server_received_unix_us) / 1000;
        let t3 = Number(data.server_sent_unix_us) / 1000;
        let serverMs;
        if (Number.isFinite(t2) && Number.isFinite(t3) && t3 >= t2) {
          serverMs = t2;
        } else {
          t2 = Number(data.server_received_ms);
          t3 = Number(data.server_sent_ms);
          serverMs = Date.parse(`${data.date}T${data.time}Z`);
          if (!Number.isFinite(serverMs)) throw new Error('Invalid server time');
        }
        let offset;
        let rtt;
        if (Number.isFinite(t2) && Number.isFinite(t3) && t3 >= t2) {
          // NTP-style four-timestamp estimate: remove the server processing
          // time from the path delay and use both directions for the offset.
          offset = ((t2 - t1) + (t3 - t4)) / 2;
          rtt = Math.max(0, (t4 - t1) - (t3 - t2));
        } else {
          // Compatibility with an older time-api without server timestamps.
          offset = serverMs - (t1 + t4) / 2;
          rtt = t4 - t1;
        }
        if (!(rtt >= 0)) throw new Error('Invalid RTT');
        return {
          offset,
          rtt,
          serverMs,
          clockHealth: data.clock_health || null,
          clockCorrectionApplied: data.clock_correction_applied === true,
          clockCorrectionMs: Number(data.clock_correction_ms),
          clockCorrectionUncertaintyMs: Number(data.clock_correction_uncertainty_ms),
          clockCorrectionEligible: data.clock_correction_eligible === true,
          clockCorrectionMode: data.clock_correction_mode || '',
          clockCorrectionSource: data.clock_correction_source || '',
          clockCorrectionReason: data.clock_correction_reason || '',
          clockSource: data.clock_source || '',
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    const LOG_RETENTION_MS = 48 * 60 * 60 * 1000;
    const LOG_EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
    const SIMPLE_EXPORT_WINDOW_MS = 6 * 60 * 60 * 1000;
    const SIMPLE_TRACE_HEADERS = [
      'at', 'rawAt', 'monoMs', 'offsetMs', 'reason', 'visibility', 'session',
      'deviceProfile', 'audioTimelineDeltaMs', 'audioContextSession', 'audioSkewPpm',
      'reanchorReason', 'calibrationSteps', 'networkCompMs', 'deviceExtraMs',
    ];
    const SYNC_AUDIT_MAX_ENTRIES = 1000;
    const SYNC_AUDIT_WINDOW_MS = LOG_RETENTION_MS;
    const SYNC_AUDIT_STORAGE_KEY = 'bpm_sync_audit_v2';
    const syncAuditLog = [];
    const CLOCK_TRACE_MAX_ENTRIES = 12000;
    const CLOCK_TRACE_WINDOW_MS = LOG_RETENTION_MS;
    const CLOCK_TRACE_INTERVAL_MS = 2 * 60 * 1000;
    const CLOCK_TRACE_STORAGE_KEY = 'bpm_clock_trace_v1';
    const clockTraceLog = [];
    const trustedServerClock = { serverMs: 0, perfMs: 0 };

    function markTrustedServerTime(serverMs) {
      const value = Number(serverMs);
      if (!Number.isFinite(value) || value <= 0) return;
      trustedServerClock.serverMs = value;
      trustedServerClock.perfMs = typeof performance !== 'undefined' ? performance.now() : 0;
    }

    function latestEntryTime(log, key) {
      for (let i = log.length - 1; i >= 0; i -= 1) {
        const value = Date.parse(log[i] && log[i][key]);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    }

    function getLogNowMs() {
      let trusted = 0;
      if (trustedServerClock.serverMs) {
        const elapsed = typeof performance !== 'undefined'
          ? performance.now() - trustedServerClock.perfMs
          : 0;
        trusted = trustedServerClock.serverMs + Math.max(0, elapsed);
      }
      if (!trusted) trusted = latestEntryTime(syncAuditLog, 'serverTime');
      if (!trusted) trusted = latestEntryTime(syncAuditLog, 'at');
      if (!trusted) trusted = latestEntryTime(clockTraceLog, 'at');
      if (!trusted) return Date.now();
      // A forward wall-clock jump must not be able to age out the whole log.
      return Math.min(Date.now(), trusted);
    }
    let clockTraceTimer = null;
    let lastClockTraceVisibilityMonoMs = 0;
    let activeAuditTab = 'sync';
    const SYNC_REASON_META = {
      'manual': { icon: '✋', label: 'MANUAL' },
      'carrier': { icon: '📡', label: 'CARRIER' },
      'auto-toggle': { icon: '🔁', label: 'AUTO_TOGGLE' },
      'utc-lock': { icon: '🔒', label: 'UTC_LOCK' },
      'clock-warning': { icon: '⚠', label: 'CLOCK_WARNING' },
      'clock-jump': { icon: '⏱', label: 'CLOCK_JUMP' },
      'clock-jump-deferred': { icon: '🕒', label: 'CLOCK_JUMP_DEFERRED' },
      'clock-jump-retry': { icon: '🔁', label: 'CLOCK_JUMP_RETRY' },
      'startup-auto': { icon: '🚀', label: 'STARTUP_AUTO' },
      'backend-config': { icon: '🔌', label: 'BACKEND_CONFIG' },
      'resume': { icon: '🔄', label: 'RESUME' },
      'deferred': { icon: '🕒', label: 'DEFERRED' },
    };

    const CLOCK_ANALYSIS_PROMPTS = [
      {
        title: 'Time-station clock audit analyst',
        titleZh: '授时台时钟审计分析',
        bodyZh: `你是授时/时钟趋势分析工程师。输入是由同一台 Time Station Simulator（BPM / WWV / WWVH / RWM）导出的一个或两个 CSV：sync audit、clock trace。先按表头识别文件，只分析实际提供的数据；文件可能很长，先给趋势，不要逐行复述或编造缺失行。

简化导出可能只含最近 6 小时和精简列；组合表可能用 kind=sync|trace 区分两类行，按 kind 拆分并套用对应语义。缺失列不是错误，不要推断未提供的数据。

字段语义：
- sync：offsetBeforeMs → offsetMs 是本次同步前后的页面校正量，不是原始晶振频偏；uncertaintyMs / rttMs / spreadMs / samples / kept 描述采样质量；serverTime / error / ok 是结果元数据。
- trace：rawAt 是未校正墙钟；monoMs 是页面单调时钟（START 重置）；offsetMs 是当前校正量。只有同一连续 session 内 rawAt−monoMs 的变化才能估计原始漂移或候选 step；跨 session 断裂可能只是 mono 重置。
- trace 音频：audioTimelineDeltaMs = 音频调度时间轴 −（显示 UTC + 设备补偿），不是扬声器物理延迟；audioSkewPpm / audioTimeScale 是调度器当前音频时钟偏差与倍率（样本不足可能为 0/1）；deviceProfile / audioContextSession 定义可比范围；audioClockSec、采样率、latency、state、sink 是环境信息。
- reason=AUDIO_OUTPUT_MANUAL/SYSTEM 表示音频输出切换；CALIBRATION 是连续延迟调整停止 2.5s 后汇总的一行，带 calibrationSteps/Duration 和 before 值；networkCompMs 是历史命名的设备音频基准延迟，不是网络延迟，仅 CALIBRATION 行有；deviceExtraMs 是档案额外延迟；reanchorReason 是最近音频重锚原因。音频事件只画在 audioTimelineDelta 图：CALIBRATION 暗、manual 亮 fuchsia、system 亮青最上层；offset 和 raw residual 图不画。
- backendNtp* 是后端上游观测，不是页面墙钟；backendNtpOffsetMs ≠ offsetMs；只有 backendNtpCorrectionApplied=true 才表示 NTP 实际参与服务时间/本地 offset；first 模式只允许第一源在 synchronized 且非 fallback 时纠正；未应用时只当观测。源列表、JSON、IP 只在解释具体重锁/失败时引用，不展开健康总表。

可选图表对应：
1. offset：X 为 trace sample order，Y 为 offsetMs；彩线按 session/visibility/long gap/slope 分段；背景=HIDDEN；相邻≤10min 且 Δoffset≥5/50ms 画细/亮竖线，表示校正变化；last=最后 offset。
2. raw wall−mono：按 session/visibility/raw gap>5min/|Δraw−Δmono|>500ms/slope 分段；段内 residual=(raw−baseRaw)−(mono−baseMono)；段内斜率≈原始漂移，ppm 需跨度≥120s 且≥5点；跨段断裂可能只是 mono 重置。
3. audioTimelineDelta：只取有效值；0 线是 sync/reanchor 目标；彩线按 device/session/long gap 分段；不要把它的漂移当作 offset 或 raw wall。

只有 sync 时没有 trace 图；不能从 sync offset 推断 raw residual、ppm 或 audio Δ。

回答：
- 3–5 句摘要，先结论；
- 最多 5 条趋势：校正量重锁、原始漂移、session/visibility 断裂、候选 step；有音频则区分 reanchor、校准、输出切换和纯音频漂移；
- 最多 3–5 个关键台阶：at、reason、修正量；
- 2–3 句边界：校正量≠原始频偏，缺 trace 不能推断，量化/采样限制；
- 可选最多 1 条继续看。
约 500–800 中文字。不要全量健康表、逐行时间线、逐类触发或大段 backend NTP；不要编造未提供的数据。`,
        bodyEn: `You are a clock-trend analyst. Input is one or both CSVs exported by the Time Station Simulator (BPM / WWV / WWVH / RWM): sync audit and/or clock trace. Identify files by header, analyze only supplied data, and summarize rather than restating rows. If data is truncated, say what was analyzed; never invent missing rows.

A simplified export may contain only the last 6 hours and reduced columns. A combined table may identify rows with kind=sync|trace; split by kind and apply the matching semantics. Missing columns are not errors; do not infer absent data.

Semantics:
- sync: offsetBeforeMs → offsetMs is the page correction before/after this sync, not raw oscillator error; uncertainty/rtt/spread/samples/kept describe quality; serverTime/error/ok are result metadata.
- trace: rawAt is uncorrected wall time; monoMs is page monotonic time (resets on START); offsetMs is the current correction. Only within-session changes in rawAt−monoMs estimate drift or candidate steps; breaks may be mono resets.
- audio: audioTimelineDeltaMs = audio scheduling timeline − (display UTC + device compensation), not speaker latency. audioSkewPpm/audioTimeScale are the scheduler's current audio-clock skew/rate (0/1 until learned). deviceProfile/audioContextSession define comparable scope; audioClockSec, sample rate, latencies, state, sink are environment info.
- reason=AUDIO_OUTPUT_MANUAL/SYSTEM marks output switches; CALIBRATION is one delay-adjustment session after 2.5s idle with steps/duration/before values; networkCompMs is legacy device audio baseline delay, not network, only on CALIBRATION rows; deviceExtraMs is profile extra; reanchorReason is the last audio re-anchor. Audio events appear only on the audioTimelineDelta chart: CALIBRATION dim, manual bright fuchsia, system bright cyan on top; offset/residual charts have no audio markers.
- backendNtp* are upstream observations, not the page wall clock; backendNtpOffsetMs ≠ offsetMs. Only backendNtpCorrectionApplied=true means NTP actually affected served time/local offset; first mode only allows the first source when synchronized and not fallback; otherwise it is observation. Cite source/IP/JSON only for a specific resync/failure; never dump a health table.

Optional chart mapping:
1. offset: X = trace sample order, Y = offsetMs; colored lines split by session/visibility/long gap/slope; background = HIDDEN; adjacent samples ≤10min apart with |Δoffset|≥5/50ms get fine/bright lines marking correction changes; last = final offset.
2. raw wall−mono: split by session/visibility/raw gap>5min/|Δraw−Δmono|>500ms/slope; residual=(raw−baseRaw)−(mono−baseMono) within a segment; slope≈raw drift, ppm needs span≥120s and ≥5 points; breaks may be mono resets.
3. audioTimelineDelta: finite values only; zero = sync/reanchor target; colored lines split by device/session/long gap; do not read its drift as offset or raw wall.

With sync only there are no trace charts; do not infer residual/ppm/audio Δ from sync offsets.

Output:
- 3–5 sentence summary, conclusion first;
- at most 5 trend bullets: correction resyncs, raw drift, session/visibility breaks, candidate steps, and audio resets/calibration/output events if present;
- at most 3–5 key steps: at, reason, correction size;
- 2–3 boundary sentences: correction ≠ raw frequency error, missing trace cannot be inferred, quantization/sampling limits;
- optional at most one next check.
About 350–500 English words. No full health table, row-by-row timeline, every trigger category, or backend NTP dump. Never invent missing data.`,
      },
    ];

    const SYNC_ONLY_PROMPTS = [
      {
        title: 'Sync audit report',
        titleZh: '同步审计报告',
        bodyZh: `你是同步审计分析工程师。输入是单个 sync audit CSV；按表头识别，可能很长，只分析提供的数据并概括趋势，不逐行复述或编造缺失行。简化导出可能只含最近6小时和精简列；缺失列不是错误。

字段：at=同步发起；reason=触发；ok/error=结果；durationMs；offsetBeforeMs→offsetMs=本次同步前后页面校正量，不是原始晶振频偏；uncertaintyMs/rttMs/spreadMs/samples/kept=采样质量；serverTime=服务端时间。
backendNtp*=后端上游NTP观测，不是页面 offset：backendNtpOffsetMs≠offsetMs；backendNtpCorrectionApplied=true 才表示 NTP 实际参与服务时间/本地校准；first 模式只允许第一源在 synchronized 且非 fallback 时纠正；reason 说明未应用原因。源列表/JSON/IP 只在解释具体重锁、失败或补同步时引用，不展开健康总表。

回答：3–5 句摘要先结论；最多5条趋势（平台、台阶、重锁、失败/补同步）；最多3–5个关键台阶（at/reason/修正量）；2–3句边界（校正量≠频偏；无 trace 不能推断 raw residual 或 ppm）；可选1条继续看。约400–600中文字。不要逐行、不列全量源、不写建议清单，不编造缺失数据。`,
        bodyEn: `You are a sync-audit analyst. Input is one sync audit CSV; identify it by header, analyze only supplied data, and summarize rather than restating rows. If truncated, say what was analyzed; never invent rows. Simplified exports may contain only the last 6 hours and reduced columns; missing columns are not errors.

Fields: at = sync start; reason = trigger; ok/error = result; durationMs; offsetBeforeMs → offsetMs = page correction before/after this sync, not raw oscillator error; uncertaintyMs/rttMs/spreadMs/samples/kept = quality; serverTime = server timestamp.
backendNtp* are upstream observations, not page offset: backendNtpOffsetMs ≠ offsetMs; backendNtpCorrectionApplied=true is required before saying NTP actually affected served time/local calibration; first mode only allows the first source when synchronized and not fallback; reason explains why not applied. Cite source/IP/JSON only for a specific resync/failure/catch-up; never expand into a health table.

Output: 3–5 sentence summary first; at most 5 trend bullets (plateaus, steps, resyncs, failures/catch-up); at most 3–5 key steps (at/reason/correction); 2–3 boundary sentences (correction ≠ frequency error; without trace, residual/ppm cannot be inferred); optional at most one next check. About 250–350 English words. No row-by-row dump, full source list, or recommendation checklist; never invent missing data.`,
      },
    ];

    const TRACE_ONLY_PROMPTS = [
      {
        title: 'Clock trace report',
        titleZh: '时钟轨迹分析报告',
        bodyZh: `你是时钟 trace 分析工程师。输入是单个 clock trace CSV；按表头识别，只分析实际数据；可能很长，先概括趋势，不逐行复述或编造缺失行。简化导出可能只含最近6小时和精简列；缺失列不是错误。

字段：rawAt=未校正墙钟；monoMs=页面单调时钟（START 重置）；offsetMs=当前校正量。只有同一连续 session 内 rawAt−monoMs 的变化才能估计原始漂移或候选 step；跨 session 断裂可能只是 mono 重置。signal/visibility/wakeLock/session 是运行状态。
音频：audioTimelineDeltaMs=音频调度时间轴−（显示 UTC+设备补偿），不是扬声器延迟；audioSkewPpm/audioTimeScale 是调度器当前音频时钟偏差/倍率（样本不足可 0/1）；deviceProfile/audioContextSession 定义可比范围；audioClockSec/采样率/latency/state/sink 是环境信息。
reason=AUDIO_OUTPUT_MANUAL/SYSTEM=音频输出切换；CALIBRATION=连续延迟调整停止2.5s后的一行，含 steps/duration/before 值；networkCompMs 是历史命名的设备音频基准延迟，不是网络延迟，仅 CALIBRATION 行；deviceExtraMs 是档案额外延迟；reanchorReason 是最近音频重锚原因。音频事件只画在 audioTimelineDelta 图：CALIBRATION 暗、manual 亮 fuchsia、system 亮青最上层；offset/residual 不画。

可选图表对应：
1. offset：X=sample order，Y=offsetMs；彩线按 session/visibility/long gap/slope 分段；背景=HIDDEN；相邻≤10min 且 Δoffset≥5/50ms 画细/亮竖线，表示校正变化；last=最后 offset。
2. raw wall−mono：按 session/visibility/raw gap>5min/|Δraw−Δmono|>500ms/slope 分段；段内 residual=(raw−baseRaw)−(mono−baseMono)；段内斜率≈原始漂移，ppm 需跨度≥120s且≥5点；跨段断裂可能只是 mono 重置。
3. audioTimelineDelta：只取有效值；0 线是 sync/reanchor 目标；彩线按 device/session/long gap 分段；不要把它的漂移当作 offset 或 raw wall。

回答：3–5句摘要；最多5条趋势（漂移方向/量级、session/visibility 断裂、候选 step、音频 Δ 归零/校准/输出切换）；2–3句边界（mono 重置、量化、仅 trace 不能推断外源校正）；可选1条；约400–600中文字。不要逐行、不列全状态、不写建议清单，不编造缺失数据。

CSV 字段：at,rawAt,monoMs,offsetMs,session,visibility,signal,wakeLock,reason,deviceProfile,audioClockSec,audioTimelineDeltaMs,audioContextSession,audioSampleRate,audioBaseLatencyMs,audioOutputLatencyMs,audioContextState,audioSinkId,audioSkewPpm,audioTimeScale,networkCompMs,deviceExtraMs,reanchorReason,calibrationSteps,calibrationDurationMs,networkCompBeforeMs,deviceExtraBeforeMs.`,
        bodyEn: `You are a clock-trace analyst. Input is one clock trace CSV; identify it by header, analyze only supplied data, and summarize rather than restating rows. If truncated, say what was analyzed; never invent rows. Simplified exports may contain only the last 6 hours and reduced columns; missing columns are not errors.

Fields: rawAt = uncorrected wall time; monoMs = page monotonic time (resets on START); offsetMs = current correction. Only within-session changes in rawAt−monoMs estimate raw drift or candidate steps; breaks between sessions may be mono resets. signal/visibility/wakeLock/session describe runtime state.
Audio: audioTimelineDeltaMs = audio scheduling timeline − (display UTC + device compensation), not speaker latency; audioSkewPpm/audioTimeScale are the scheduler's current audio-clock skew/rate (0/1 until learned); deviceProfile/audioContextSession define comparable scope; audioClockSec/sample rate/latencies/state/sink are environment info.
reason=AUDIO_OUTPUT_MANUAL/SYSTEM = audio-output switch; CALIBRATION = one delay-adjustment session after 2.5s idle with steps/duration/before values; networkCompMs is legacy device audio baseline delay, not network, only on CALIBRATION rows; deviceExtraMs is profile extra; reanchorReason is the last audio re-anchor. Audio events appear only on the audioTimelineDelta chart: CALIBRATION dim, manual bright fuchsia, system bright cyan on top; offset/residual charts have none.

Optional chart mapping:
1. offset: X=sample order, Y=offsetMs; colored lines split by session/visibility/long gap/slope; background=HIDDEN; adjacent samples ≤10min apart with |Δoffset|≥5/50ms get fine/bright lines marking correction changes; last=final offset.
2. raw wall−mono: split by session/visibility/raw gap>5min/|Δraw−Δmono|>500ms/slope; residual=(raw−baseRaw)−(mono−baseMono) within a segment; slope≈raw drift, ppm needs span≥120s and ≥5 points; breaks may be mono resets.
3. audioTimelineDelta: finite values only; zero = sync/reanchor target; colored lines split by device/session/long gap; do not read its drift as offset or raw wall.

Output: 3–5 sentence summary first; at most 5 trend bullets (drift direction/magnitude, session/visibility breaks, candidate steps, audio reset/calibration/output events); 2–3 boundary sentences (mono resets, quantization, trace alone cannot establish external correction); optional at most one next check. About 250–350 English words. No row-by-row dump, full state table, or recommendation checklist; never invent missing data.

CSV fields: at,rawAt,monoMs,offsetMs,session,visibility,signal,wakeLock,reason,deviceProfile,audioClockSec,audioTimelineDeltaMs,audioContextSession,audioSampleRate,audioBaseLatencyMs,audioOutputLatencyMs,audioContextState,audioSinkId,audioSkewPpm,audioTimeScale,networkCompMs,deviceExtraMs,reanchorReason,calibrationSteps,calibrationDurationMs,networkCompBeforeMs,deviceExtraBeforeMs.`,
      },
    ];

    function pruneSyncAudit(now = getLogNowMs()) {
      while (syncAuditLog.length > SYNC_AUDIT_MAX_ENTRIES) syncAuditLog.shift();
      while (syncAuditLog.length && now - Date.parse(syncAuditLog[0].at) > SYNC_AUDIT_WINDOW_MS) {
        syncAuditLog.shift();
      }
    }

    function persistSyncAudit() {
      try {
        localStorage.setItem(SYNC_AUDIT_STORAGE_KEY, JSON.stringify(syncAuditLog));
      } catch (e) {
        // Storage can be unavailable or full; audit remains in memory.
      }
    }

    function loadPersistedSyncAudit() {
      try {
        const raw = localStorage.getItem(SYNC_AUDIT_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved)) return;
        syncAuditLog.length = 0;
        for (const entry of saved) {
          if (entry && typeof entry.at === 'string') syncAuditLog.push(entry);
        }
        pruneSyncAudit();
      } catch (e) {
        console.log('Failed to load sync audit:', e);
      }
    }

    const CLOCK_TRACE_SESSION_START_ISO = new Date().toISOString();

    function pruneClockTrace(now = getLogNowMs()) {
      while (clockTraceLog.length > CLOCK_TRACE_MAX_ENTRIES) clockTraceLog.shift();
      while (clockTraceLog.length && now - Date.parse(clockTraceLog[0].at) > CLOCK_TRACE_WINDOW_MS) {
        clockTraceLog.shift();
      }
    }

    function persistClockTrace() {
      try {
        localStorage.setItem(CLOCK_TRACE_STORAGE_KEY, JSON.stringify(clockTraceLog));
      } catch (e) {
        // Keep the in-memory trace if storage is unavailable or full.
      }
    }

    function loadPersistedClockTrace() {
      try {
        const raw = localStorage.getItem(CLOCK_TRACE_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved)) return;
        clockTraceLog.length = 0;
        for (const entry of saved) {
          if (entry && typeof entry.at === 'string' && typeof entry.rawAt === 'string') {
            clockTraceLog.push(entry);
          }
        }
        pruneClockTrace();
      } catch (e) {
        console.log('Failed to load clock trace:', e);
      }
    }

    function recordClockTrace(reason = 'HEARTBEAT', extra = {}) {
      const wallMs = Date.now();
      const monoMs = performance.now();
      const audioDiagnostics = typeof NextAudio !== 'undefined'
        && NextAudio.getTimingDiagnostics
        ? NextAudio.getTimingDiagnostics()
        : null;
      clockTraceLog.push({
        at: new Date(wallMs + localOffset).toISOString(),
        rawAt: new Date(wallMs).toISOString(),
        monoMs: Math.round(monoMs * 1000) / 1000,
        offsetMs: localOffset,
        signal: isRunning ? 'PLAYING' : 'PAUSED',
        visibility: document.visibilityState === 'hidden' ? 'HIDDEN' : 'VISIBLE',
        wakeLock: wakeLockSentinel ? 'ON' : 'OFF',
        session: CLOCK_TRACE_SESSION_START_ISO,
        reason,
        deviceProfile: activeDeviceName,
        ...extra,
        ...(audioDiagnostics || {}),
      });
      pruneClockTrace(wallMs);
      persistClockTrace();
      if (activeAuditTab === 'trace') {
        const panel = getUi('sync_log_panel');
        if (panel && !panel.classList.contains('hidden')) renderClockTraceView();
      }
    }

    function recordVisibilityTrace() {
      const mono = performance.now();
      // Screen-lock toggles can create bursts of visibility events. Keep one
      // boundary sample per two minutes; the next heartbeat still carries the
      // current signal/visibility state.
      if (mono - lastClockTraceVisibilityMonoMs < 120000) return;
      lastClockTraceVisibilityMonoMs = mono;
      recordClockTrace('VISIBILITY');
    }

    function startClockTrace() {
      if (clockTraceTimer) return;
      recordClockTrace('START');
      clockTraceTimer = setInterval(() => recordClockTrace('HEARTBEAT'), CLOCK_TRACE_INTERVAL_MS);
    }

    function exportClockTraceCsv(options = {}) {
      const simple = options && options.simple === true;
      const headers = simple ? SIMPLE_TRACE_HEADERS : [
        'at', 'rawAt', 'monoMs', 'offsetMs',
        'signal', 'visibility', 'wakeLock', 'session', 'reason', 'deviceProfile',
        'audioClockSec', 'audioTimelineDeltaMs', 'audioContextSession',
        'audioSampleRate', 'audioBaseLatencyMs', 'audioOutputLatencyMs',
        'audioContextState', 'audioSinkId', 'audioSkewPpm', 'audioTimeScale',
        'networkCompMs', 'deviceExtraMs', 'reanchorReason',
        'calibrationSteps', 'calibrationDurationMs', 'networkCompBeforeMs', 'deviceExtraBeforeMs',
      ];
      const cutoff = getLogNowMs() - (simple ? SIMPLE_EXPORT_WINDOW_MS : LOG_EXPORT_WINDOW_MS);
      const entries = clockTraceLog.filter((entry) => {
        const timestamp = Date.parse(entry.at);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      });
      const lines = [headers.join(',')];
      for (const entry of entries) {
        lines.push(headers.map(key => csvAuditValue(entry[key])).join(','));
      }
      const lastEntry = entries[entries.length - 1] || clockTraceLog[clockTraceLog.length - 1];
      const stamp = lastEntry ? formatCompactTimestamp(lastEntry.at) : '';
      const filename = simple
        ? (stamp !== '' && stamp !== '—' ? `bpm-clock-trace-simple-6h-${stamp}.csv` : 'bpm-clock-trace-simple-6h.csv')
        : (stamp !== '' && stamp !== '—' ? `bpm-clock-trace-24h-${stamp}.csv` : 'bpm-clock-trace-24h.csv');
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function traceMedian(values) {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
      if (!sorted.length) return null;
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function traceRegressionPpm(points, useResidual) {
      if (!points || points.length < 2) return null;
      const t0 = points[0].raw;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (const point of points) {
        const x = (point.raw - t0) / 1000;
        const y = useResidual ? point.residual : point.raw - point.mono;
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
      }
      const n = points.length;
      const denominator = n * sxx - sx * sx;
      if (denominator <= 0) return null;
      return ((n * sxy - sx * sy) / denominator) * 1000;
    }

    function splitTraceSegmentBySlope(points) {
      if (points.length < 8) return [points];
      const spanSeconds = (points[points.length - 1].raw - points[0].raw) / 1000;
      if (spanSeconds < 10 * 60) return [points];
      const windowMs = 5 * 60 * 1000;
      const local = points.map((point, index) => {
        let start = index;
        let end = index;
        while (start > 0 && point.raw - points[start - 1].raw <= windowMs) start -= 1;
        while (end < points.length - 1 && points[end + 1].raw - point.raw <= windowMs) end += 1;
        const window = points.slice(start, end + 1);
        if (window.length < 5) return null;
        if (window[window.length - 1].raw - window[0].raw < 120 * 1000) return null;
        return traceRegressionPpm(window, false);
      });
      const smooth = local.map((_, index) => traceMedian(local.slice(Math.max(0, index - 2), Math.min(local.length, index + 3))));
      const cuts = [];
      let lastCutRaw = -Infinity;
      for (let index = 3; index < points.length - 3; index += 1) {
        const left = traceMedian(smooth.slice(Math.max(0, index - 3), index));
        const right = traceMedian(smooth.slice(index, Math.min(smooth.length, index + 3)));
        if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
        if (Math.abs(right - left) < 4) continue;
        if (points[index].raw - lastCutRaw < 10 * 60 * 1000) continue;
        cuts.push(index);
        lastCutRaw = points[index].raw;
      }
      if (!cuts.length) return [points];
      const pieces = [];
      let start = 0;
      for (const cut of cuts) {
        pieces.push(points.slice(start, cut));
        start = cut;
      }
      pieces.push(points.slice(start));
      return pieces.filter(piece => piece.length >= 2);
    }

    function buildClockTraceSeries(entries = clockTraceLog) {
      const groups = new Map();
      for (const entry of entries) {
        const raw = Date.parse(entry.rawAt);
        const mono = Number(entry.monoMs);
        if (!Number.isFinite(raw) || !Number.isFinite(mono)) continue;
        const key = entry.session || entry.rawAt;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ raw, mono, entry });
      }
      const initialSegments = [];
      const breakGapMs = 5 * 60 * 1000;
      for (const points of groups.values()) {
        points.sort((a, b) => a.raw - b.raw);
        let segment = [];
        let previous = null;
        for (const point of points) {
          let split = !segment.length;
          if (previous) {
            const rawGap = point.raw - previous.raw;
            const monoGap = point.mono - previous.mono;
            const driftGap = rawGap - monoGap;
            if (rawGap > breakGapMs) split = true;
            if (previous.entry.visibility !== point.entry.visibility) split = true;
            if (Math.abs(driftGap) > 500) split = true;
          }
          if (split && segment.length) {
            initialSegments.push(segment);
            segment = [];
          }
          segment.push(point);
          previous = point;
        }
        if (segment.length) initialSegments.push(segment);
      }
      const series = [];
      for (const segment of initialSegments) {
        for (const piece of splitTraceSegmentBySlope(segment)) series.push(piece);
      }
      for (const segment of series) {
        const base = segment[0];
        for (const point of segment) {
          point.residual = (point.raw - base.raw) - (point.mono - base.mono);
        }
        const spanSeconds = (segment[segment.length - 1].raw - segment[0].raw) / 1000;
        const segmentPpm = spanSeconds >= 120 && segment.length >= 5
          ? traceRegressionPpm(segment, true)
          : null;
        for (let index = 0; index < segment.length; index += 1) {
          const point = segment[index];
          let start = index;
          let end = index;
          const windowMs = 5 * 60 * 1000;
          while (start > 0 && point.raw - segment[start - 1].raw <= windowMs) start -= 1;
          while (end < segment.length - 1 && segment[end + 1].raw - point.raw <= windowMs) end += 1;
          const window = segment.slice(start, end + 1);
          const windowSpan = (window[window.length - 1].raw - window[0].raw) / 1000;
          point.segmentPpm = segmentPpm;
          point.segmentSpanSeconds = spanSeconds;
          point.localPpm = window.length >= 5 && windowSpan >= 120
            ? traceRegressionPpm(window, true)
            : null;
          point.localPpmSpanSeconds = windowSpan;
        }
      }
      return series.sort((a, b) => a[0].raw - b[0].raw);
    }

    function traceBackgroundRects(allSorted, xOf, top, plotH) {
      const bands = [];
      let start = null;
      for (let index = 0; index < allSorted.length; index += 1) {
        const hidden = allSorted[index].entry.visibility === 'HIDDEN';
        if (hidden && start === null) start = index;
        if (!hidden && start !== null) {
          bands.push([start, index]);
          start = null;
        }
      }
      if (start !== null) bands.push([start, allSorted.length - 1]);
      return bands.map(([startIndex, endIndex]) => {
        const x1 = xOf(startIndex);
        const x2 = Math.max(x1 + 2, xOf(Math.max(startIndex + 1, endIndex)));
        return `<rect class="trace-hidden-band" x="${x1.toFixed(2)}" y="${top}"
          width="${Math.max(2, x2 - x1).toFixed(2)}" height="${plotH}"/>`;
      }).join('');
    }

