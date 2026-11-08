// App UI/startup: station rows, settings panels, audio controls, media session and DOM startup wiring.
    let backendSetupMode = 'edit';
    let backendSetupAfterSave = null;
    let backendSetupAfterCancel = null;
    let backendSetupFocus = null;
    let backendMigrationPending = false;

    function bindSyncAuditUI() {
      const openBtn = getUi('sync_log_btn');
      if (openBtn) openBtn.addEventListener('click', openSyncAuditLog);
      const closeBtn = getUi('sync_log_close');
      if (closeBtn) closeBtn.addEventListener('click', closeSyncAuditLog);
      const exportBtn = getUi('sync_log_export');
      if (exportBtn) exportBtn.addEventListener('click', exportSyncAuditCsv);
      const traceExportBtn = getUi('clock_trace_export');
      if (traceExportBtn) traceExportBtn.addEventListener('click', exportClockTraceCsv);
      const traceClearBtn = getUi('clock_trace_clear');
      if (traceClearBtn) traceClearBtn.addEventListener('click', clearClockTrace);
      const syncTab = getUi('audit_tab_sync');
      if (syncTab) syncTab.addEventListener('click', () => setAuditTab('sync'));
      const traceTab = getUi('audit_tab_trace');
      if (traceTab) traceTab.addEventListener('click', () => setAuditTab('trace'));
      const traceSummary = getUi('clock_trace_summary');
      if (traceSummary) {
        traceSummary.addEventListener('click', toggleTraceSummaryDiagnostics);
        traceSummary.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleTraceSummaryDiagnostics();
        });
      }
      const clearBtn = getUi('sync_log_clear');
      if (clearBtn) clearBtn.addEventListener('click', clearSyncAuditLog);
      const promptBtn = getUi('sync_prompt_btn');
      if (promptBtn) promptBtn.addEventListener('click', () => openSyncPromptPanel('sync'));
      const tracePromptBtn = getUi('trace_prompt_btn');
      if (tracePromptBtn) tracePromptBtn.addEventListener('click', () => openSyncPromptPanel('trace'));
      const promptCloseBtn = getUi('sync_prompt_close');
      if (promptCloseBtn) promptCloseBtn.addEventListener('click', closeSyncPromptPanel);
      const promptSimpleExport = getUi('sync_prompt_simple_export');
      if (promptSimpleExport) promptSimpleExport.addEventListener('click', exportActivePromptCsv);
      ['zh', 'en'].forEach(lang => {
        const tab = getUi(`sync_prompt_tab_${lang}`);
        if (tab) tab.addEventListener('click', () => setPromptLang(lang));
      });
      const promptEntries = getUi('sync_prompt_entries');
      if (promptEntries) {
        promptEntries.addEventListener('click', (e) => {
          const button = e.target.closest('[data-prompt-copy]');
          if (!button) return;
          copyPrompt(Number(button.dataset.promptCopy), button);
        });
      }
      const combinedButton = getUi('combined_prompt_btn');
      if (combinedButton) combinedButton.addEventListener('click', openCombinedPromptPanel);
      const combinedClose = getUi('combined_prompt_close');
      if (combinedClose) combinedClose.addEventListener('click', closeCombinedPromptPanel);
      const combinedSimpleExport = getUi('combined_prompt_simple_export');
      if (combinedSimpleExport) combinedSimpleExport.addEventListener('click', exportCombinedSimpleCsv);
      ['zh', 'en'].forEach(lang => {
        const tab = getUi(`combined_prompt_tab_${lang}`);
        if (tab) tab.addEventListener('click', () => setCombinedPromptLang(lang));
      });
      const combinedEntries = getUi('combined_prompt_entries');
      if (combinedEntries) {
        combinedEntries.addEventListener('click', (e) => {
          const button = e.target.closest('[data-combined-copy]');
          if (!button) return;
          copyCombinedPrompt(Number(button.dataset.combinedCopy), button);
        });
      }
      const combinedPanel = getUi('combined_prompt_panel');
      if (combinedPanel) {
        combinedPanel.addEventListener('click', (e) => {
          if (e.target === combinedPanel) closeCombinedPromptPanel();
        });
      }
      const syncEntries = getUi('sync_log_entries');
      if (syncEntries) {
        const openEntryDetails = (target) => {
          const cell = target && target.closest ? target.closest('[data-ntp-at]') : null;
          if (!cell) return;
          const entry = syncAuditLog.find(item => item.at === cell.dataset.ntpAt);
          if (entry) openNtpDetailPanel(entry);
        };
        syncEntries.addEventListener('click', (e) => openEntryDetails(e.target));
        syncEntries.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (!e.target || !e.target.closest || !e.target.closest('[data-ntp-at]')) return;
          e.preventDefault();
          openEntryDetails(e.target);
        });
      }
      const ntpDetailClose = getUi('ntp_detail_close');
      if (ntpDetailClose) ntpDetailClose.addEventListener('click', closeNtpDetailPanel);
      const ntpDetailPanel = getUi('ntp_detail_panel');
      if (ntpDetailPanel) {
        ntpDetailPanel.addEventListener('click', (e) => {
          if (e.target === ntpDetailPanel) closeNtpDetailPanel();
        });
      }
      const panel = getUi('sync_log_panel');
      if (panel) {
        panel.addEventListener('click', (e) => {
          if (e.target === panel) closeSyncAuditLog();
        });
      }
      const promptPanel = getUi('sync_prompt_panel');
      if (promptPanel) {
        promptPanel.addEventListener('click', (e) => {
          if (e.target === promptPanel) closeSyncPromptPanel();
        });
      }
      const backendPanel = getUi('backend_config_panel');
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (backendPanel && !backendPanel.classList.contains('hidden')) {
          closeBackendSetup();
        } else if (ntpDetailPanel && !ntpDetailPanel.classList.contains('hidden')) {
          closeNtpDetailPanel();
        } else if (combinedPanel && !combinedPanel.classList.contains('hidden')) {
          closeCombinedPromptPanel();
        } else if (promptPanel && !promptPanel.classList.contains('hidden')) {
          closeSyncPromptPanel();
        } else if (panel && !panel.classList.contains('hidden')) {
          closeSyncAuditLog();
        }
      });
    }

    window.bpmSyncAudit = {
      entries: syncAuditLog,
      exportCsv: exportSyncAuditCsv,
      clear: clearSyncAuditLog,
    };

    function backendSetupErrorMessage(code) {
      const zh = language === 'zh';
      const messages = {
        empty: zh ? '请输入时间 API 地址。' : 'Enter the Time API URL.',
        scheme: zh ? '地址需要以 http:// 或 https:// 开头。' : 'Include http:// or https://.',
        invalid: zh ? '地址格式无效。' : 'Invalid URL.',
        credentials: zh ? '不要在地址中包含用户名或密码。' : 'Do not include a username or password.',
        query: zh ? '只填基地址，不要带查询参数或片段。' : 'Use a base URL without query or fragment.',
        mixed: zh ? 'HTTPS 页面不能访问 HTTP 后端（localhost 除外）。' : 'An HTTPS page cannot call an HTTP backend (localhost is allowed).',
        storage: zh ? '无法写入本浏览器存储。' : 'Could not save to this browser.',
      };
      return messages[code] || (zh ? '地址无法使用。' : 'That URL cannot be used.');
    }

    function updateBackendSetupCopy(mode) {
      const zh = language === 'zh';
      const notes = {
        migration: zh
          ? '此浏览器此前使用内置后端，请填写你自己的时间 API 地址。'
          : 'This browser used the old built-in backend. Enter your own Time API address.',
        auto: zh ? '启用 AUTO 前请先设置后端地址。' : 'Set the backend before enabling AUTO.',
        sync: zh ? 'SYNC 需要先设置后端地址。' : 'SYNC needs the backend URL first.',
        dut1: zh ? 'DUT1 AUTO 使用同一个后端地址。' : 'DUT1 AUTO uses the same backend URL.',
        edit: zh ? '修改本页使用的时间 API 后端。' : 'Change the Time API backend used by this page.',
      };
      const titleEl = getUi('backend_config_title');
      const labelEl = getUi('backend_config_label');
      const noteEl = getUi('backend_config_note');
      const hintEl = getUi('backend_config_hint');
      const cancelBtn = getUi('backend_config_cancel');
      const saveBtn = getUi('backend_config_save');
      if (titleEl) titleEl.textContent = '\u{1F50C} ' + (zh ? '后端' : 'BACKEND');
      if (labelEl) labelEl.textContent = zh ? '时间 API 基地址' : 'Time API base URL';
      if (noteEl) noteEl.textContent = notes[mode] || notes.edit;
      if (hintEl) {
        hintEl.textContent = zh
          ? '用于时钟同步和 DUT1；仅保存在本浏览器。自动追加 /v1/*，后端需允许 CORS。'
          : 'Used for clock sync and DUT1; stored in this browser. /v1/* is appended; backend must allow CORS.';
      }
      if (cancelBtn) cancelBtn.textContent = zh ? '稍后' : 'LATER';
      if (saveBtn) saveBtn.textContent = zh ? '保存' : 'SAVE';
    }

    function setBackendSetupError(text) {
      const error = getUi('backend_config_error');
      const input = getUi('backend_config_url');
      if (error) {
        error.textContent = text || '';
        error.classList.toggle('hidden', !text);
      }
      if (input) input.setAttribute('aria-invalid', text ? 'true' : 'false');
    }

    function updateBackendConfigIndicators() {
      const configured = isTimeApiConfigured();
      const button = getUi('backend_config_btn');
      if (button) {
        button.classList.toggle('text-yellow-300', !configured);
        button.classList.toggle('text-gray-300', configured);
        button.classList.toggle('backend-plugin-missing', !configured);
        button.setAttribute('aria-label', configured ? 'Time API backend configured' : 'Time API backend required');
      }
      const syncError = getUi('sync_error');
      if (syncError) {
        const backendHint = !configured && syncError.textContent.trim();
        syncError.classList.toggle('cursor-pointer', !!backendHint);
        if (backendHint) {
          syncError.setAttribute('role', 'button');
          syncError.setAttribute('tabindex', '0');
          syncError.setAttribute('aria-label', language === 'zh' ? '设置时间 API 后端' : 'Set Time API backend');
        } else {
          syncError.removeAttribute('role');
          syncError.removeAttribute('tabindex');
          syncError.removeAttribute('aria-label');
        }
      }
    }

    function openBackendSetup(options = {}) {
      const panel = getUi('backend_config_panel');
      if (!panel) return false;
      const input = getUi('backend_config_url');
      if (!panel.classList.contains('hidden')) {
        if (input) {
          input.focus();
          input.select();
        }
        return true;
      }
      backendSetupMode = options.mode || 'edit';
      backendSetupAfterSave = typeof options.afterSave === 'function' ? options.afterSave : null;
      backendSetupAfterCancel = typeof options.afterCancel === 'function' ? options.afterCancel : null;
      backendSetupFocus = document.activeElement;
      let prefill = options.prefill;
      if (prefill === undefined) {
        prefill = getTimeApiBase();
      }
      if (input) input.value = prefill || '';
      setBackendSetupError('');
      updateBackendSetupCopy(backendSetupMode);
      const originButton = getUi('backend_config_origin');
      if (originButton) {
        const canUseOrigin = location.protocol === 'http:' || location.protocol === 'https:';
        originButton.classList.toggle('hidden', !canUseOrigin);
      }
      panel.classList.remove('hidden');
      if (input) {
        setTimeout(() => {
          if (panel.classList.contains('hidden')) return;
          input.focus();
          input.select();
        }, 0);
      }
      return true;
    }

    function closeBackendSetup(options = {}) {
      const panel = getUi('backend_config_panel');
      if (!panel || panel.classList.contains('hidden')) return;
      panel.classList.add('hidden');
      const afterCancel = backendSetupAfterCancel;
      const focus = backendSetupFocus;
      backendSetupAfterSave = null;
      backendSetupAfterCancel = null;
      backendSetupFocus = null;
      backendSetupMode = 'edit';
      setBackendSetupError('');
      if (focus && typeof focus.focus === 'function') {
        try { focus.focus(); } catch (e) { }
      }
      if (!options.skipCancel && afterCancel) afterCancel();
    }

    function handleBackendSetupSubmit(event) {
      if (event) event.preventDefault();
      const input = getUi('backend_config_url');
      const result = setTimeApiBase(input ? input.value : '');
      if (!result.ok) {
        setBackendSetupError(backendSetupErrorMessage(result.code));
        if (input) input.focus();
        return;
      }
      const afterSave = backendSetupAfterSave;
      const mode = backendSetupMode;
      closeBackendSetup({ skipCancel: true });
      const syncError = getUi('sync_error');
      if (syncError) {
        syncError.textContent = '';
        syncError.title = '';
        syncError.classList.remove('text-red-400', 'text-yellow-400');
      }
      updateBackendConfigIndicators();
      if (afterSave) afterSave(result.base, mode);
    }

    function bindBackendSetupUI() {
      const panel = getUi('backend_config_panel');
      if (!panel) return;
      const form = getUi('backend_config_form');
      if (form) form.addEventListener('submit', handleBackendSetupSubmit);
      const closeBtn = getUi('backend_config_close');
      if (closeBtn) closeBtn.addEventListener('click', () => closeBackendSetup());
      const cancelBtn = getUi('backend_config_cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeBackendSetup());
      const input = getUi('backend_config_url');
      if (input) input.addEventListener('input', () => setBackendSetupError(''));
      const originButton = getUi('backend_config_origin');
      if (originButton) {
        originButton.addEventListener('click', () => {
          if (!input) return;
          input.value = location.origin;
          setBackendSetupError('');
          input.focus();
          input.select();
        });
      }
      panel.addEventListener('click', (event) => {
        if (event.target === panel) closeBackendSetup();
      });
      const auditButton = getUi('backend_config_btn');
      if (auditButton) {
        auditButton.addEventListener('click', () => openBackendSetup({
          mode: 'edit',
          afterSave: startBackendDependentFeatures,
        }));
      }
      const syncError = getUi('sync_error');
      if (syncError) {
        const openFromError = () => {
          if (!isTimeApiConfigured()) openBackendSetup({ mode: 'sync' });
        };
        syncError.addEventListener('click', openFromError);
        syncError.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (isTimeApiConfigured()) return;
          event.preventDefault();
          openFromError();
        });
      }
      updateBackendConfigIndicators();
    }

    function startBackendDependentFeatures() {
      updateBackendConfigIndicators();
      if (!isTimeApiConfigured()) return;
      if (dut1AutoMode) startDut1Auto();
      if (autoSyncMode) {
        triggerSyncButtonClick('backend-config');
        startAutoSync();
      }
    }

    async function autoSyncTime() {
      markCurrentCarrierHandled();
      if (!isTimeApiConfigured()) {
        openBackendSetup({
          mode: 'sync',
          afterSave: () => autoSyncTime(),
          afterCancel: showBackendMissingHint,
        });
        return;
      }
      if (syncController.inFlight) return;
      if (syncController.afterDoneTimer) {
        clearTimeout(syncController.afterDoneTimer);
        syncController.afterDoneTimer = null;
      }
      const auditReason = pendingSyncReason || 'manual';
      pendingSyncReason = 'manual';
      const auditOffsetBefore = localOffset;
      const auditStartedAt = performance.now();
      // Keep the audit timeline in practical corrected UTC: raw system time
      // plus the offset that was already in force when this sync started.
      const auditStartedAtIso = new Date(Date.now() + auditOffsetBefore).toISOString();
      syncController.inFlight = true;
      recordClockTrace('SYNC_START');
      const syncBtn = document.getElementById('sync_btn');
      const syncError = document.getElementById('sync_error');
      syncError.textContent = '';
      syncError.title = '';
      syncError.classList.remove('text-red-400', 'text-yellow-400');
      syncBtn.disabled = true;
      syncBtn.textContent = 'SYNCING...';
      const samples = [];
      try {
        for (let i = 0; i < SYNC_SAMPLE_COUNT; i += 1) {
          try {
            samples.push(await fetchTimeSample());
          } catch (e) {
            console.warn('Time sync sample failed:', e);
          }
          if (i < SYNC_SAMPLE_COUNT - 1) {
            await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 80));
          }
        }
        if (samples.length < SYNC_MIN_SAMPLES) {
          throw new Error(`only ${samples.length} time samples`);
        }

        // Lowest-RTT samples are least likely to be distorted by queuing.
        const sorted = [...samples].sort((a, b) => a.rtt - b.rtt);
        const keepCount = Math.max(SYNC_MIN_SAMPLES, Math.ceil(sorted.length * 0.6));
        const kept = sorted.slice(0, keepCount);
        const offsets = kept.map((s) => s.offset).sort((a, b) => a - b);
        const mid = Math.floor(offsets.length / 2);
        const median = offsets.length % 2
          ? offsets[mid]
          : (offsets[mid - 1] + offsets[mid]) / 2;
        const bestRtt = sorted[0].rtt;
        const spread = offsets[offsets.length - 1] - offsets[0];

        localOffset = Math.round(median * 10) / 10;
        updateOffsetDisplay();
        // Rebuild the audio timeline from the same offset that the display now
        // uses. This is intentionally unconditional: a sync that leaves the
        // rounded offset unchanged can still need a fresh audio anchor.
        NextAudio.reanchor('sync');
        // A completed sync always ends the warning state. If a jump was
        // detected during the sync, the retry still runs in finally, but the
        // clock face no longer needs a separate "recalibrating" presentation.
        clearClockUncertain();
        const n = offsets.length;
        const meanOffset = offsets.reduce((sum, value) => sum + value, 0) / n;
        const variance = n > 1
          ? offsets.reduce((sum, value) => sum + (value - meanOffset) ** 2, 0) / (n - 1)
          : 0;
        const sampleSd = Math.sqrt(variance);
        // The median's standard error is ~1.253 * sigma / sqrt(n) for
        // independent samples. Combine it in quadrature with the RTT/2 path
        // asymmetry estimate; this is a heuristic combined uncertainty, not a
        // traceable confidence interval.
        const medianStandardError = n > 0 ? (1.253 * sampleSd) / Math.sqrt(n) : 0;
        const errorMs = Math.hypot(bestRtt / 2, medianStandardError);
        const backendHealth = backendHealthAuditFields(sorted[0] && sorted[0].clockHealth);
        const backendCorrection = backendCorrectionAuditFields(sorted[0]);
        const firstServerTime = new Date(samples[0].serverMs).toISOString();
        markTrustedServerTime(samples[0].serverMs);
        recordSyncAudit({
          at: auditStartedAtIso,
          reason: auditReason,
          ok: true,
          offsetBeforeMs: auditOffsetBefore,
          offsetMs: localOffset,
          uncertaintyMs: errorMs,
          rttMs: bestRtt,
          spreadMs: spread,
          samples: samples.length,
          kept: kept.length,
          durationMs: performance.now() - auditStartedAt,
          serverTime: firstServerTime,
          ...backendHealth,
          ...backendCorrection,
        });
        recordClockTrace('SYNC_OK');
        syncBtn.textContent = 'DONE!';
        // While DONE! is visible the button stays disabled, so re-checking
        // AUTO during this window cannot immediately trigger another sync.
        setTimeout(() => {
          if (!syncController.inFlight) {
            syncBtn.textContent = 'SYNC';
            syncBtn.disabled = false;
          }
        }, 3000);
      } catch (e) {
        console.error('Sync failed:', e);
        // Keep the clock face live and rely on the warning badge; a retry may
        // still be queued when a jump landed during this sync.
        setClockWarningVisible(true);
        updateTimeDisplay();
        recordSyncAudit({
          at: auditStartedAtIso,
          reason: auditReason,
          ok: false,
          offsetBeforeMs: auditOffsetBefore,
          offsetMs: localOffset,
          samples: samples.length,
          durationMs: performance.now() - auditStartedAt,
          error: e.message || String(e),
          ...backendHealthAuditFields((samples.find(sample => sample.clockHealth) || {}).clockHealth),
          ...backendCorrectionAuditFields(samples[0]),
        });
        recordClockTrace('SYNC_FAIL');
        syncBtn.textContent = 'SYNC';
        syncBtn.disabled = false;
      } finally {
        syncController.inFlight = false;
        if (syncController.pendingClockResync) {
          syncController.pendingClockResync = false;
          if (autoSyncMode) {
            syncController.lastResyncMonoMs = performance.now();
            if (!triggerSyncButtonClick('clock-jump-retry')) scheduleSyncAfterDone('clock-jump-retry');
          } else {
            updateTimeDisplay();
          }
        }
      }
    }

    function setClockWarningVisible(visible) {
      clockWarningVisible = visible;
      const el = document.getElementById('clock_warning');
      if (el) el.classList.toggle('hidden', !visible);
    }
    function markClockUncertain() {
      setClockWarningVisible(true);
    }
    function clearClockUncertain() {
      setClockWarningVisible(false);
      updateTimeDisplay();
    }
    function dismissClockWarning() {
      // Acknowledge only the visual warning. This deliberately does not touch
      // syncController.inFlight, syncController.pendingClockResync, or the in-flight fetch request.
      setClockWarningVisible(false);
      updateTimeDisplay();
    }
    // After pause + screen lock, the OS may step or slew the wall clock while
    // the page is hidden. The old localOffset is then invalid even though the
    // audio scheduler re-anchors itself. AUTO is the hard gate for all
    // automatic backend requests: when it is off, only warn.
    const RESUME_SYNC_MIN_HIDDEN_MS = 15000;
    const RESUME_SYNC_JUMP_MS = 30;
    let resumeHiddenWallMs = 0;
    let resumeHiddenMonoMs = 0;
    let resumeSyncRetryTimer = null;

    function notePageHiddenForResumeSync() {
      resumeHiddenWallMs = Date.now();
      resumeHiddenMonoMs = performance.now();
    }

    function triggerResumeSync(attempt = 0) {
      if (!autoSyncMode) {
        markClockUncertain();
        console.info('Page resumed after a long hidden period; AUTO is off, waiting for manual sync');
        return false;
      }
      if (attempt > 2) return false;
      if (syncController.inFlight) {
        if (resumeSyncRetryTimer) return false;
        resumeSyncRetryTimer = setTimeout(() => {
          resumeSyncRetryTimer = null;
          if (document.visibilityState === 'visible' && autoSyncMode) triggerResumeSync(attempt + 1);
        }, 1200);
        return false;
      }
      markClockUncertain();
      console.info('Page resumed after a long hidden period; refreshing time offset');
      if (!triggerSyncButtonClick('resume')) {
        if (resumeSyncRetryTimer) return false;
        resumeSyncRetryTimer = setTimeout(() => {
          resumeSyncRetryTimer = null;
          if (document.visibilityState === 'visible' && autoSyncMode) triggerResumeSync(attempt + 1);
        }, 1200);
        return false;
      }
      return true;
    }

    function maybeResyncAfterResume() {
      if (!resumeHiddenWallMs) return false;
      const wallDelta = Date.now() - resumeHiddenWallMs;
      const monoDelta = performance.now() - resumeHiddenMonoMs;
      resumeHiddenWallMs = 0;
      resumeHiddenMonoMs = 0;
      const hiddenMs = Math.max(wallDelta, monoDelta);
      const clockResidual = Math.abs(wallDelta - monoDelta);
      if (hiddenMs < RESUME_SYNC_MIN_HIDDEN_MS && clockResidual < RESUME_SYNC_JUMP_MS) return false;
      console.info(`Resume clock check: hidden=${Math.round(hiddenMs)}ms residual=${Math.round(clockResidual)}ms`);
      triggerResumeSync();
      return true;
    }

    function handleSystemClockJump() {
      markClockUncertain();
      if (!autoSyncMode) return;
      if (syncController.inFlight) {
        // Treat two detectors firing for the same jump as one event, but keep
        // a retry pending if a genuinely new jump lands during a long sync.
        if (performance.now() - syncController.lastResyncMonoMs > 1000) syncController.pendingClockResync = true;
        return;
      }
      syncController.lastResyncMonoMs = performance.now();
      console.info('System clock jump detected; refreshing network time offset');
      if (!triggerSyncButtonClick('clock-jump')) scheduleSyncAfterDone('clock-jump-deferred');
    }

    function monitorSystemClock() {
      const wall = Date.now();
      const mono = performance.now();
      if (!syncController.lastWallSampleMs) {
        syncController.lastWallSampleMs = wall;
        syncController.lastMonoSampleMs = mono;
        return;
      }
      const wallDelta = wall - syncController.lastWallSampleMs;
      const monoDelta = mono - syncController.lastMonoSampleMs;
      syncController.lastWallSampleMs = wall;
      syncController.lastMonoSampleMs = mono;
      // A backgrounded/locked page can have its timers and performance clock
      // frozen independently. The first sample after resume then looks like a
      // wall-clock step even though nothing changed. Re-baseline instead of
      // triggering a spurious network sync.
      if (document.hidden || wallDelta > 1500 || monoDelta > 1500) return;
      if (Math.abs(wallDelta - monoDelta) > SYSTEM_CLOCK_JUMP_MS) {
        // A wall-clock step invalidates localOffset even though the audio
        // scheduler can re-anchor itself. Take fresh network samples so the
        // displayed UTC and the audio UTC use the new device clock.
        handleSystemClockJump();
      }
    }

    async function requestWakeLock() {
      if (wakeLockSentinel !== null) return;

      if (!wakeLockSupported && 'wakeLock' in navigator) {
        wakeLockSupported = true;
      }

      if (wakeLockSupported) {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
          console.log('wakeLock activated');

          wakeLockSentinel.addEventListener('release', () => {
            console.log('wakeLock released automatically');
            wakeLockSentinel = null;
          });
        } catch (err) {
          console.error(`wakeLock failed: ${err.name}, ${err.message}`);
        }
      }
    }

    function releaseWakeLock() {
      if (wakeLockSentinel !== null) {
        wakeLockSentinel.release().then(() => {
          console.log('wakeLock released manually');
          wakeLockSentinel = null;
        }).catch((err) => {
          console.error('wakeLock release manually failed:', err);
        });
      }
    }

    // Start/Stop
    function start() {
      if (isRunning && NextAudio.isRunning()) {
        NextAudio.wake();
        return;
      }
      if (isRunning) {
        isRunning = false;
        try { NextAudio.stop(); } catch (e) { }
      }
      setMasterLoading(true);
      const finishStart = () => setMasterLoading(false);
      const failStart = () => { };
      try {
        isRunning = true;
        applyZenLayout();
        updateZenOffsetBadge();
        recordClockTrace('AUDIO_START');
        NextAudio.start(finishStart, failStart);
        if (document.hidden) {
          startBackgroundKeepAlive();
        }
        if (zenModeActive) {
          requestWakeLock();
        }
      } catch (e) {
        isRunning = false;
        applyZenLayout();
        updateZenOffsetBadge();
        try { NextAudio.stop(); } catch (stopError) { }
        alert('Start failed: ' + e.message);
      }
    }

    function stop() {
      isRunning = false;
      recordClockTrace('AUDIO_STOP');
      try { NextAudio.stop(); } catch (e) { }
      stopBackgroundKeepAlive();
      releaseWakeLock();
      if (zenModeActive) {
        applyZenLayout();
      }
      updateZenOffsetBadge();
    }

    function startBackgroundKeepAlive() {
      if (audioHeartbeat) return;

      const keepAliveCtx = new AudioContext();
      window.keepAliveCtx = keepAliveCtx;
      const gainNode = keepAliveCtx.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(keepAliveCtx.destination);

      const buffer = keepAliveCtx.createBuffer(1, 1, 22050);
      const source = keepAliveCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
      source.loop = true;
      source.start();

      audioHeartbeat = source;
    }

    function stopBackgroundKeepAlive() {
      if (audioHeartbeat) {
        audioHeartbeat.stop();
        audioHeartbeat = null;
      }
      if (window.keepAliveCtx) {
        window.keepAliveCtx.close().catch(e => console.warn('keepAliveCtx close failed', e));
        window.keepAliveCtx = null;
      }
    }

    function setupSettingsSections() {
      const clock = document.getElementById('settings_section_clock');
      const display = document.getElementById('settings_section_display');
      const stations = document.getElementById('settings_section_stations');
      const noise = document.getElementById('settings_section_noise');
      const offset = document.getElementById('clock_offset_section');
      const device = document.getElementById('device_profile_section');
      const dut1 = document.getElementById('dut1_section');
      const forceUtc = document.getElementById('force_utc_row');
      const noiseRow = document.getElementById('noise_section');
      if (clock) {
        [offset, device, dut1].forEach((element) => {
          if (element) clock.appendChild(element);
        });
      }
      if (stations && forceUtc) {
        const topRow = document.getElementById('bpm_top_row');
        if (topRow) topRow.prepend(forceUtc);
        else stations.appendChild(forceUtc);
      }
      if (noise && noiseRow) noise.appendChild(noiseRow);

      const tabs = {
        clock: document.querySelector('[data-settings-tab="clock"]'),
        display: document.querySelector('[data-settings-tab="display"]'),
        stations: document.querySelector('[data-settings-tab="stations"]'),
        noise: document.querySelector('[data-settings-tab="noise"]'),
      };
      const sections = { clock, display, stations, noise };
      const selectTab = (name) => {
        for (const [key, section] of Object.entries(sections)) {
          if (section) section.classList.toggle('hidden', key !== name);
          if (tabs[key]) tabs[key].classList.toggle('active', key === name);
        }
        saveSettings();
      };
      for (const [name, button] of Object.entries(tabs)) {
        if (button) button.addEventListener('click', () => selectTab(name));
      }
      selectTab('clock');

      const languageSelect = document.getElementById('language_select');
      if (languageSelect) {
        languageSelect.value = language;
        languageSelect.addEventListener('change', function () {
          language = this.value === 'zh' ? 'zh' : 'en';
          saveSettings();
          applyLanguage();
        });
      }
      applyLanguage();
    }

    function applyLanguage() {
      document.documentElement.lang = language;
      const labels = language === 'zh'
        ? {
          clock: '时钟校准', display: '页面展示', stations: '电台控制', noise: '噪声',
          bpm: 'BPM 授时台', wwv: 'WWV 授时台', wwvh: 'WWVH 授时台', rwm: 'RWM 授时台',
          volume: '音量',
        }
        : {
          clock: 'Clock calibration', display: 'Display', stations: 'Station controls', noise: 'Noise',
          bpm: 'BPM time station', wwv: 'WWV time station', wwvh: 'WWVH time station', rwm: 'RWM time station',
          volume: 'Volume',
        };
      const tabTitles = {
        clock: labels.clock,
        display: labels.display,
        stations: labels.stations,
        noise: labels.noise,
      };
      for (const [key, title] of Object.entries(tabTitles)) {
        const button = document.querySelector(`[data-settings-tab="${key}"]`);
        if (button) button.setAttribute('aria-label', title);
      }
      for (const key of ['bpm', 'wwv', 'wwvh', 'rwm']) {
        const item = document.querySelector(`.station-item[data-station="${key}"]`);
        if (item) item.setAttribute('aria-label', labels[key]);
      }
      document.querySelectorAll('[data-station-volume]').forEach((slider) => {
        slider.setAttribute('aria-label', labels.volume);
      });
    }

    function bindCoreControls() {
      let clockPointerStart = null;
      document.addEventListener('pointerdown', (event) => {
        if (event.target && event.target.closest && event.target.closest('#time_display')) {
          clockPointerStart = { x: event.clientX, y: event.clientY };
        } else {
          clockPointerStart = null;
        }
      }, true);
      document.addEventListener('pointerup', (event) => {
        if (!clockPointerStart) return;
        const dx = event.clientX - clockPointerStart.x;
        const dy = event.clientY - clockPointerStart.y;
        const onClock = event.target && event.target.closest && event.target.closest('#time_display');
        clockPointerStart = null;
        if (onClock && dx * dx + dy * dy < 100) handleTimeDisplayHotzone(event);
      }, true);
      document.addEventListener('pointerdown', () => {
        // A new gesture means the in-flight exit click is already over (or
        // never happened); never swallow an intentional click.
        zenExitClickGuardUntil = 0;
      }, true);
      document.addEventListener('click', (event) => {
        if (performance.now() >= zenExitClickGuardUntil) return;
        zenExitClickGuardUntil = 0;
        // The pointerup that exited Zen also restores the normal layout
        // before the click is dispatched. Consume that whole click so it
        // cannot press a newly revealed button or move a slider.
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      document.addEventListener('fullscreenchange', onFullscreenChange);
      const coarsePointer = window.matchMedia
        && window.matchMedia('(pointer: coarse)').matches;
      if (coarsePointer) {
        const unlockAudioFromGesture = () => {
          if (isRunning && NextAudio.isRunning()) {
            NextAudio.wake();
            return;
          }
          start();
        };
        document.addEventListener('touchstart', unlockAudioFromGesture, { capture: true, passive: true });
        document.addEventListener('touchend', unlockAudioFromGesture, { capture: true, passive: true });
        document.addEventListener('click', unlockAudioFromGesture, true);
      }
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      document.addEventListener('mozfullscreenchange', onFullscreenChange);
      document.getElementById('show_ms').addEventListener('change', function () {
        updateTimeDisplay();
        saveSettings();
      });
      document.getElementById('ut1_detail_mode').addEventListener('change', function () {
        ut1DetailMode = this.checked;
        saveSettings();
        updateTimeDisplay();
      });

      const lowFreqSlider = document.getElementById('low_freq_volume');
      lowFreqSlider.value = lowFreqVolume * 100;
      const lowFreqLabel = document.getElementById('low_freq_label');
      if (lowFreqLabel) lowFreqLabel.textContent = formatTcLabel(lowFreqVolume);
      lowFreqSlider.addEventListener('input', function () {
        lowFreqVolume = Math.min(2, Math.max(0, this.value / 100));
        if (lowFreqLabel) lowFreqLabel.textContent = formatTcLabel(lowFreqVolume);
        NextAudio.setLowFreqVolume(lowFreqVolume);
        saveSettings();
        updateTimeDisplay();
      });

      const adjustLabel = (letter, value) =>
        `${letter}(${String(Math.round(value * 100)).padStart(3, ' ')}%)`;
      const syncAdjustControl = (sliderId, labelId, letter, value) => {
        const slider = document.getElementById(sliderId);
        const label = document.getElementById(labelId);
        if (slider) slider.value = String(Math.round(value * 100));
        if (label) label.textContent = adjustLabel(letter, value);
      };
      const bindAdjust = (sliderId, labelId, letter, apply) => {
        const slider = document.getElementById(sliderId);
        const label = document.getElementById(labelId);
        if (!slider) return;
        const current = apply.get();
        syncAdjustControl(sliderId, labelId, letter, current);
        slider.addEventListener('input', function () {
          const max = parseFloat(this.max) / 100;
          const value = Math.min(max, Math.max(0, this.value / 100));
          if (label) label.textContent = adjustLabel(letter, value);
          apply.set(value);
          saveSettings();
        });
      };
      bindAdjust('bpm_morse_volume', 'bpm_morse_label', 'MCid', {
        get: () => bpmMorseAdjust,
        set: (value) => {
          bpmMorseAdjust = value;
          NextAudio.setBpmMorseAdjust(value);
        },
      });
      bindAdjust('bpm_voice_volume', 'bpm_voice_label', '\u{1F5E3}', {
        get: () => bpmVoiceAdjust,
        set: (value) => {
          bpmVoiceAdjust = value;
          NextAudio.setBpmVoiceAdjust(value);
        },
      });
      for (const station of ['wwv', 'wwvh']) {
        for (const kind of ['tone', 'code', 'voice']) {
          const letter = kind === 'tone' ? '\u266A' : (kind === 'code' ? 'BCD' : '\u{1F5E3}');
          bindAdjust(`${station}_${kind}_volume`, `${station}_${kind}_label`, letter, {
            get: () => wwvAdjustments[station][kind],
            set: (value) => {
              wwvAdjustments[station][kind] = value;
              NextAudio.setWWVAdjustment(station, kind, value);
            },
          });
        }
      }
      bindAdjust('rwm_pulse10_volume', 'rwm_pulse10_label', '10Hz_ds', {
        get: () => rwmAdjustments.pulse10,
        set: (value) => {
          rwmAdjustments.pulse10 = value;
          NextAudio.setRWMAdjustment('pulse10', value);
        },
      });
      bindAdjust('rwm_morse_volume', 'rwm_morse_label', 'MCid', {
        get: () => rwmAdjustments.morse,
        set: (value) => {
          rwmAdjustments.morse = value;
          NextAudio.setRWMAdjustment('morse', value);
        },
      });
      const rwmBeatSlider = document.getElementById('rwm_beat_hz');
      const rwmBeatLabel = document.getElementById('rwm_beat_label');
      const rwmBeatPending = document.getElementById('rwm_beat_pending');
      let rwmBeatPendingTimer = null;
      const hideRwmBeatPending = () => {
        if (rwmBeatPendingTimer) {
          clearTimeout(rwmBeatPendingTimer);
          rwmBeatPendingTimer = null;
        }
        if (rwmBeatPending) rwmBeatPending.classList.add('hidden');
      };
      const scheduleRwmBeatPending = () => {
        hideRwmBeatPending();
        if (!isRunning || !rwmBeatPending) return;
        const remaining = NextAudio.getScheduleRemainingMs();
        if (remaining <= 200) return;
        rwmBeatPending.classList.remove('hidden');
        rwmBeatPendingTimer = setTimeout(() => {
          rwmBeatPendingTimer = null;
          rwmBeatPending.classList.add('hidden');
        }, remaining);
      };
      const syncRwmBeatControl = () => {
        if (rwmBeatSlider) rwmBeatSlider.value = String(rwmBeatToSliderPosition(rwmBeatHz));
        if (rwmBeatLabel) rwmBeatLabel.textContent = formatRwmBeatLabel(rwmBeatHz);
      };
      const applyRwmBeatFrequency = (value) => {
        rwmBeatHz = clampRwmBeatHz(value);
        syncRwmBeatControl();
        NextAudio.setRwmBeatFrequency(rwmBeatHz);
        scheduleRwmBeatPending();
      };
      syncRwmBeatControl();
      if (rwmBeatSlider) {
        rwmBeatSlider.addEventListener('input', function () {
          rwmBeatHz = rwmSliderToBeatHz(this.value);
          if (rwmBeatLabel) rwmBeatLabel.textContent = formatRwmBeatLabel(rwmBeatHz);
          saveSettings();
        });
        rwmBeatSlider.addEventListener('change', function () {
          applyRwmBeatFrequency(rwmSliderToBeatHz(this.value));
          saveSettings();
        });
      }
      if (rwmBeatPending) {
        rwmBeatPending.addEventListener('click', () => {
          hideRwmBeatPending();
          if (isRunning) refreshAudioOutputForDeviceChange();
        });
      }

      const resetStationConfig = (station) => {
        if (station === 'bpm') {
          lowFreqVolume = 0;
          bpmMorseAdjust = 1;
          bpmVoiceAdjust = 1;
          forceUtcOnly = false;
          const forceCheckbox = document.getElementById('force_utc_mode');
          if (forceCheckbox) forceCheckbox.checked = false;
          syncForceUtcUI();
          NextAudio.onTimingChanged();
          const lowSlider = document.getElementById('low_freq_volume');
          const lowLabel = document.getElementById('low_freq_label');
          if (lowSlider) lowSlider.value = '0';
          if (lowLabel) lowLabel.textContent = formatTcLabel(0);
          NextAudio.setLowFreqVolume(0);
          NextAudio.setBpmMorseAdjust(1);
          NextAudio.setBpmVoiceAdjust(1);
          syncAdjustControl('bpm_morse_volume', 'bpm_morse_label', 'MCid', 1);
          syncAdjustControl('bpm_voice_volume', 'bpm_voice_label', '\u{1F5E3}', 1);
        } else if (station === 'wwv' || station === 'wwvh') {
          for (const kind of ['tone', 'code', 'voice']) {
            const letter = kind === 'tone' ? '\u266A' : (kind === 'code' ? 'BCD' : '\u{1F5E3}');
            wwvAdjustments[station][kind] = 1;
            NextAudio.setWWVAdjustment(station, kind, 1);
            syncAdjustControl(`${station}_${kind}_volume`, `${station}_${kind}_label`, letter, 1);
          }
        } else if (station === 'rwm') {
          rwmAdjustments.pulse10 = 1;
          rwmAdjustments.morse = 1;
          rwmLockMode = 'off';
          syncRwmLockUI();
          applyRwmBeatFrequency(RWM_BEAT_DEFAULT_HZ);
          NextAudio.setRWMAdjustment('pulse10', 1);
          NextAudio.setRWMAdjustment('morse', 1);
          syncAdjustControl('rwm_pulse10_volume', 'rwm_pulse10_label', '10Hz_ds', 1);
          syncAdjustControl('rwm_morse_volume', 'rwm_morse_label', 'MCid', 1);
          NextAudio.onTimingChanged();
        }
        invalidateTimeRender();
        updateTimeDisplay();
        saveSettings();
      };
      document.querySelectorAll('[data-station-reset]').forEach((button) => {
        button.addEventListener('click', () => resetStationConfig(button.dataset.stationReset));
      });

      const masterSlider = document.getElementById('master_volume');
      if (masterSlider) {
        masterVolume = 0;
        updateMasterVolumeDisplay();
        const armAudioFromMaster = () => {
          if (isRunning && NextAudio.isRunning()) {
            NextAudio.wake();
            return;
          }
          start();
        };
        const applyMasterFromSlider = function () {
          masterVolume = Math.max(0, Math.min(1, parseFloat(this.value) || 0));
          updateMasterVolumeDisplay();
          NextAudio.setMasterVolume(masterVolume);
          if (!isRunning || !NextAudio.isRunning()) start();
          else NextAudio.wake();
          if (zenModeActive) {
            applyZenLayout();
            updateZenOffsetBadge();
          }
          saveSettings();
        };
        const setMasterFromClientX = (clientX) => {
          const rect = masterSlider.getBoundingClientRect();
          if (!rect.width) return;
          const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          masterVolume = ratio;
          masterSlider.value = String(ratio);
          updateMasterVolumeDisplay();
          NextAudio.setMasterVolume(masterVolume);
          if (!isRunning || !NextAudio.isRunning()) start();
          else NextAudio.wake();
          if (zenModeActive) {
            applyZenLayout();
            updateZenOffsetBadge();
          }
          saveSettings();
        };
        let masterTouchActive = false;
        if (!coarsePointer) {
          masterSlider.addEventListener('pointerdown', armAudioFromMaster);
          masterSlider.addEventListener('mousedown', armAudioFromMaster);
        }
        masterSlider.addEventListener('touchstart', function (event) {
          const touch = event.touches && event.touches[0];
          if (!touch) return;
          event.preventDefault();
          masterTouchActive = true;
          armAudioFromMaster();
          setMasterFromClientX(touch.clientX);
        }, { passive: false });
        masterSlider.addEventListener('touchmove', function (event) {
          if (!masterTouchActive) return;
          const touch = event.touches && event.touches[0];
          if (!touch) return;
          event.preventDefault();
          setMasterFromClientX(touch.clientX);
        }, { passive: false });
        masterSlider.addEventListener('touchend', function (event) {
          if (!masterTouchActive) return;
          event.preventDefault();
          masterTouchActive = false;
        }, { passive: false });
        masterSlider.addEventListener('touchcancel', function () {
          masterTouchActive = false;
        });
        masterSlider.addEventListener('input', applyMasterFromSlider);
        masterSlider.addEventListener('change', applyMasterFromSlider);
        masterSlider.addEventListener('pointerup', applyMasterFromSlider);
      }

      const stationIds = ['bpm', 'wwv', 'wwvh', 'rwm'];
      const allStationVolumesSilent = stationIds.every(
        station => (Number(stationVolumes[station]) || 0) < 0.01
      );
      if (allStationVolumesSilent) stationVolumes.bpm = 0.01;
      const syncStationVolumeControl = (station) => {
        const value = stationVolumes[station] ?? 0;
        const slider = document.querySelector(`[data-station-volume="${station}"]`);
        const toggle = document.querySelector(`[data-station-toggle="${station}"]`);
        if (slider) slider.value = String(value);
        if (toggle) toggle.textContent = `${Math.round(value * 100)}%`;
      };
      const toggleAllStationPanels = () => {
        if (zenModeActive) return;
        const items = [...document.querySelectorAll('.station-item')];
        if (!items.length) return;
        const allExpanded = items.every(item => item.classList.contains('expanded'));
        const willExpand = !allExpanded;
        for (const item of items) {
          item.classList.toggle('expanded', willExpand);
          const station = item.dataset.station;
          const toggle = document.querySelector(`[data-station-toggle="${station}"]`);
          if (toggle) toggle.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
          if (willExpand) syncStationVolumeControl(station);
        }
        if (willExpand && typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            for (const item of items) syncStationVolumeControl(item.dataset.station);
          });
        }
      };
      document.querySelectorAll('[data-station-toggle]').forEach((toggle) => {
        const station = toggle.dataset.stationToggle;
        toggle.textContent = `${Math.round((stationVolumes[station] ?? 0) * 100)}%`;
        toggle.onclick = toggleAllStationPanels;
      });
      document.querySelectorAll('[data-station-volume]').forEach((slider) => {
        const station = slider.dataset.stationVolume;
        syncStationVolumeControl(station);
        slider.addEventListener('input', function () {
          let value = Math.max(0, Math.min(1, parseFloat(this.value) || 0));
          const otherHasVolume = stationIds.some(
            id => id !== station && (Number(stationVolumes[id]) || 0) >= 0.01
          );
          if (value < 0.01 && !otherHasVolume) {
            value = 0.01;
            this.value = '0.01';
          }
          stationVolumes[station] = value;
          const toggle = document.querySelector(`[data-station-toggle="${station}"]`);
          if (toggle) toggle.textContent = `${Math.round(value * 100)}%`;
          NextAudio.setStationVolume(station, value);
          updateZenStationVisibility();
          saveSettings();
        });
        slider.addEventListener('change', () => {
          syncStationVolumeControl(station);
        });
      });
      updateZenStationVisibility();
      if (allStationVolumesSilent) saveSettings();
    }

    function openSettingsTab(tab = 'clock') {
      if (zenModeActive) exitZenMode();
      const panel = document.getElementById('settings_panel');
      if (!panel) return;
      panel.classList.remove('hidden');
      const button = document.querySelector(`[data-settings-tab="${tab}"]`);
      if (button) button.click();
      hideOffsetAdjustRows();
      if (typeof panel.scrollIntoView === 'function') {
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function closeSettingsPanel() {
      const panel = document.getElementById('settings_panel');
      if (!panel) return;
      panel.classList.add('hidden');
      closeDeviceMenu();
      hideOffsetAdjustRows();
      saveSettings();
    }

    function bindPanelControls() {
      const closeButton = document.getElementById('settings_close');
      if (closeButton) closeButton.addEventListener('click', closeSettingsPanel);
      const openers = [
        ['clock_emoji', 'clock'],
        ['ut1_time', 'display'],
        ['ut1_indicator', 'display'],
        ['global_offset_indicator', 'clock'],
      ];
      for (const [id, tab] of openers) {
        const element = document.getElementById(id);
        if (!element) continue;
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          openSettingsTab(tab);
        });
      }
      const isTextHit = (element, event) => {
        if (!document.createRange || typeof element.getClientRects !== 'function') return true;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        return rects.some((rect) => (
          event.clientX >= rect.left
          && event.clientX <= rect.right
          && event.clientY >= rect.top
          && event.clientY <= rect.bottom
        ));
      };
      document.querySelectorAll('.station-status').forEach((status) => {
        status.addEventListener('click', (event) => {
          if (!isTextHit(status, event)) return;
          event.stopPropagation();
          openSettingsTab('stations');
        });
      });
      const networkCompEl = document.getElementById('network_comp_val');
      if (networkCompEl) {
        networkCompEl.addEventListener('click', (e) => {
          e.stopPropagation();
          setOffsetAdjustRowVisible('base_comp_controls', true);
        });
      }
      document.getElementById('sync_btn').onclick = autoSyncTime;
      const clockWarningBtn = document.getElementById('clock_warning');
      if (clockWarningBtn) {
        clockWarningBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openSettingsTab('clock');
          dismissClockWarning();
          if (autoSyncMode) triggerSyncButtonClick('clock-warning');
        });
      }
      const noiseSlider = document.getElementById('noise_volume');
      if (noiseSlider) {
        noiseSlider.value = noiseVolume;
        noiseSlider.addEventListener('input', function (e) {
          updateNoiseVolume(parseFloat(e.target.value));
        });
      }
    }

    function bindAutoSyncControl() {
      const autoCheckbox = document.getElementById('auto_sync_mode');
      if (!autoCheckbox) return;
      autoCheckbox.addEventListener('change', function (e) {
        if (e.target.checked && !isTimeApiConfigured()) {
          e.target.checked = false;
          autoSyncMode = false;
          updateAutoSyncUI();
          saveSettings();
          openBackendSetup({
            mode: 'auto',
            afterSave: () => {
              if (!autoCheckbox.checked) {
                autoCheckbox.checked = true;
                autoCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
              }
            },
          });
          return;
        }
        autoSyncMode = e.target.checked;
        saveSettings();
        if (autoSyncMode) {
          triggerSyncButtonClick('auto-toggle');
          startAutoSync();
        } else {
          stopAutoSync();
          updateTimeDisplay();
        }
        updateAutoSyncUI();
      });
    }

    function bindAutoDut1Control() {
      const autoDut1Checkbox = document.getElementById('auto_dut1_mode');
      if (!autoDut1Checkbox) return;
      autoDut1Checkbox.addEventListener('change', function (e) {
        if (e.target.checked && !isTimeApiConfigured()) {
          e.target.checked = false;
          dut1AutoMode = false;
          updateDut1AutoUI();
          saveSettings();
          openBackendSetup({
            mode: 'dut1',
            afterSave: () => {
              if (!autoDut1Checkbox.checked) {
                autoDut1Checkbox.checked = true;
                autoDut1Checkbox.dispatchEvent(new Event('change', { bubbles: true }));
              }
            },
          });
          return;
        }
        dut1AutoMode = e.target.checked;
        saveSettings();
        updateDut1AutoUI();
        if (dut1AutoMode) {
          // The API series supersedes any manually uploaded EOP file.
          window.eopData = null;
          window.isAutoDUT1 = false;
          window.currentDataSource = null;
          dut1AutoData = null;
          dut1AutoSeriesBySource = { ntsc: null, iers: null };
          dut1AutoPrimaryKey = '';
          dut1AutoAlternateKey = '';
          dut1SplitActive = false;
          const eopFile = document.getElementById('eop_file');
          if (eopFile) eopFile.value = '';
          startDut1Auto();
        } else {
          stopDut1Auto();
          setCommonDut1(window.ut1DUT1);
          dut1AutoData = null;
          dut1AutoSeriesBySource = { ntsc: null, iers: null };
          dut1AutoPrimaryKey = '';
          dut1AutoAlternateKey = '';
          dut1SplitActive = false;
          dut1AutoLastFetch = 0;
          dut1AutoLastError = '';
          window.isAutoDUT1 = false;
          window.eopData = null;
          window.currentDataSource = null;
          setEopStatus('', 'text-gray-500');
          updateOffsetDisplay();
          updateTimeDisplay();
        }
      });
      const eopStatus = document.getElementById('eop_status');
      if (eopStatus) eopStatus.addEventListener('click', handleDut1StatusClick);
    }

    function bindOffsetControls() {
      document.querySelectorAll('[data-offset]').forEach(btn => {
        btn.addEventListener('click', function () {
          const type = this.dataset.offset, deltaStr = this.dataset.delta;
          if (type === 'dut1' && dut1AutoMode) return;
          if (type === 'comp') noteDelayCalibration();
          if (deltaStr === 'reset') {
            if (type === 'local') {
              localOffset = 0;
              document.getElementById('sync_error').textContent = '';
              clearClockUncertain();
            } else if (type === 'comp') {
              networkCompensation = 0;
            } else if (type === 'dut1') {
              setCommonDut1(0);
              const eopStatus = document.getElementById('eop_status');
              eopStatus.textContent = '';
              eopStatus.classList.remove('text-green-400', 'text-red-400', 'text-yellow-400');
              eopStatus.classList.add('text-gray-500');
              document.getElementById('eop_file').value = '';
              window.isAutoDUT1 = false;
            }
          } else {
            const delta = parseInt(deltaStr);
            if (!isNaN(delta)) {
              if (type === 'local') {
                localOffset += delta;
                document.getElementById('sync_error').textContent = '';
                clearClockUncertain();
              } else if (type === 'comp') {
                networkCompensation += delta;
                networkCompensation = Math.max(0, networkCompensation);
              } else if (type === 'dut1') {
                setCommonDut1(window.bpmDUT1 + delta);
                const eopStatus = document.getElementById('eop_status');
                eopStatus.textContent = '';
                eopStatus.classList.remove('text-green-400', 'text-red-400', 'text-yellow-400');
                eopStatus.classList.add('text-gray-500');
                document.getElementById('eop_file').value = '';
                window.isAutoDUT1 = false;
              }
            }
          }
          updateOffsetDisplay();
        });
      });
    }

    function syncRwmLockUI() {
      document.querySelectorAll('input[name="rwm_lock_mode"]').forEach((input) => {
        input.checked = input.value === rwmLockMode;
      });
    }

    function setRwmLockMode(mode) {
      if (mode !== 'off' && mode !== 'pulse1' && mode !== 'pulse10') return;
      if (rwmLockMode === mode) return;
      rwmLockMode = mode;
      syncRwmLockUI();
      saveSettings();
      invalidateTimeRender();
      updateTimeDisplay();
      NextAudio.onTimingChanged();
    }

    function bindRwmLockControls() {
      const inputs = [...document.querySelectorAll('input[name="rwm_lock_mode"]')];
      if (!inputs.length) return;
      syncRwmLockUI();
      inputs.forEach((input) => {
        input.addEventListener('change', function () {
          if (this.checked) setRwmLockMode(this.value);
        });
      });
    }

    function bindForceLocalControls() {
      const forceCheckbox = document.getElementById('force_utc_mode');
      if (forceCheckbox) {
        forceCheckbox.addEventListener('change', function (e) {
          forceUtcOnly = e.target.checked;
          if (forceUtcOnly) {
            cancelScheduledCarrierSync();
            NextAudio.stopVoice();
          }
          saveSettings();
          syncForceUtcUI();
          updateTimeDisplay();
          NextAudio.onTimingChanged();
        });
      }
      syncForceUtcUI();

      const localTimeCheckbox = document.getElementById('local_time_mode');
      if (localTimeCheckbox) {
        localTimeCheckbox.addEventListener('change', function (e) {
          showLocalTime = e.target.checked;
          saveSettings();
          updateTimeDisplay();
        });
      }
    }

    function bindEopUpload() {
      // EOP file upload (supports both NTSC and IERS)
      document.getElementById('eop_file').addEventListener('change', function (e) {
        if (dut1AutoMode) {
          e.target.value = '';
          return;
        }
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (event) {
          try {
            const content = event.target.result;
            let eopMap = null;
            let sourceType = '';
            // Try NTSC format first
            const ntscMap = parseNtscEop(content);
            if (ntscMap.size > 0) {
              eopMap = ntscMap;
              sourceType = 'NTSC';
            } else {
              // Try IERS Bulletin A format
              const iersMap = parseIersBulletinA(content);
              if (iersMap.size > 0) {
                eopMap = iersMap;
                sourceType = 'IERS';
              }
            }
            if (!eopMap || eopMap.size === 0) {
              document.getElementById('eop_status').textContent = 'Err: Unrecognized format';
              document.getElementById('eop_status').classList.remove('text-green-400', 'text-yellow-400');
              document.getElementById('eop_status').classList.add('text-red-400');
              return;
            }
            // Store as milliseconds for internal use (convert from seconds)
            const eopDataMs = new Map();
            for (const [key, value] of eopMap.entries()) {
              eopDataMs.set(key, value * 1000);
            }
            window.eopData = eopDataMs;
            window.isAutoDUT1 = true;
            window.currentDataSource = sourceType;
            const now = new Date();
            const displayOffset = localOffset + GLOBAL_OFFSET_MS;
            const utcNow = new Date(now.getTime() + displayOffset);
            const currentKey = `${utcNow.getUTCFullYear().toString().padStart(4, '0')}${(utcNow.getUTCMonth() + 1).toString().padStart(2, '0')}${utcNow.getUTCDate().toString().padStart(2, '0')}`;
            if (eopDataMs.has(currentKey)) {
              setCommonDut1(eopDataMs.get(currentKey));
              updateOffsetDisplay();
              document.getElementById('eop_status').textContent = `${sourceType} @ ${currentKey}`;
              document.getElementById('eop_status').classList.remove('text-red-400', 'text-yellow-400');
              document.getElementById('eop_status').classList.add('text-green-400');
            } else {
              document.getElementById('eop_status').textContent = `${sourceType}: no data for today`;
              document.getElementById('eop_status').classList.remove('text-green-400', 'text-red-400');
              document.getElementById('eop_status').classList.add('text-yellow-400');
            }
          } catch (err) {
            console.error('Parse error:', err);
            document.getElementById('eop_status').textContent = 'Err';
            document.getElementById('eop_status').classList.remove('text-green-400', 'text-yellow-400');
            document.getElementById('eop_status').classList.add('text-red-400');
          }
        };
        reader.readAsText(file);
      });
    }

    function initMediaSession() {
      if (!navigator.mediaSession) return;
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      } catch (e) { }
    }

    function showBackendMissingHint() {
      if (isTimeApiConfigured()) return;
      const syncError = getUi('sync_error');
      if (syncError && !syncError.textContent) {
        syncError.textContent = language === 'zh' ? '需要后端地址' : 'BACKEND URL REQUIRED';
        syncError.classList.add('text-yellow-400');
      }
      updateBackendConfigIndicators();
    }

    // A startup prompt is the one-time migration step. If it is dismissed,
    // leave AUTO/DUT1 AUTO off rather than keeping a checked switch that can
    // never run without a backend.
    function cancelStartupBackendSetup() {
      let changed = false;
      if (autoSyncMode) {
        autoSyncMode = false;
        const autoCheckbox = getUi('auto_sync_mode');
        if (autoCheckbox) autoCheckbox.checked = false;
        stopAutoSync();
        updateAutoSyncUI();
        changed = true;
      }
      if (dut1AutoMode) {
        dut1AutoMode = false;
        const dut1Checkbox = getUi('auto_dut1_mode');
        if (dut1Checkbox) dut1Checkbox.checked = false;
        stopDut1Auto();
        updateDut1AutoUI();
        changed = true;
      }
      if (changed) saveSettings();
      showBackendMissingHint();
    }

    function finishAppStartup() {
      loadPersistedSyncAudit();
      loadPersistedClockTrace();
      startClockTrace();
      bindSyncAuditUI();
      bindBackendSetupUI();
      renderLastSyncStatus();
      updateDut1AutoUI();
      if (dut1AutoMode && isTimeApiConfigured()) {
        startDut1Auto();
      }
      initDeviceProfileUI();
      updateGlobalOffsetIndicator();
      updateOffsetDisplay();
      updateTimeDisplay();
      if (document.fonts && document.fonts.load) {
        document.fonts.load('700 60px "BPM Seven Segment"').then(() => {
          sevenSegReady = document.fonts.check('700 60px "BPM Seven Segment"');
          opticalMetricsKey = '';
          invalidateTimeRender();
          updateTimeDisplay();
        }).catch(() => { });
      }
      window.addEventListener('resize', () => {
        opticalMetricsKey = '';
        invalidateTimeRender();
        updateTimeDisplay();
      });
      updateAutoSyncUI();
      if (autoSyncMode && isTimeApiConfigured()) {
        triggerSyncButtonClick('startup-auto');
        startAutoSync();
      }
      updateBackendConfigIndicators();
      if (!isTimeApiConfigured()) {
        if (backendMigrationPending) {
          openBackendSetup({
            mode: 'migration',
            afterSave: startBackendDependentFeatures,
            afterCancel: cancelStartupBackendSetup,
          });
        } else if (autoSyncMode || dut1AutoMode) {
          openBackendSetup({
            mode: 'edit',
            afterSave: startBackendDependentFeatures,
            afterCancel: cancelStartupBackendSetup,
          });
        }
      }
    }

    // DOMContentLoaded
    let appInitialized = false;
    document.addEventListener('DOMContentLoaded', function () {
      if (appInitialized) return;
      appInitialized = true;
      loadSettings();
      loadDeviceProfiles();
      loadTimeApiBase();
      backendMigrationPending = detectLegacyBackendInstall() && !isTimeApiConfigured();
      initMediaSession();
      setupSettingsSections();
      setDriftlessInterval(updateTimeDisplay, 5);

      bindCoreControls();
      bindPanelControls();
      bindAutoSyncControl();
      bindAutoDut1Control();
      bindOffsetControls();
      bindRwmLockControls();
      bindForceLocalControls();
      bindEopUpload();
      bindAudioOutputChanges();
      finishAppStartup();
      const urlParams = new URLSearchParams(location.search);
      const requestedSettings = urlParams.get('settings');
      if (requestedSettings && ['clock', 'display', 'stations', 'noise'].includes(requestedSettings)) {
        openSettingsTab(requestedSettings);
      }
      if (urlParams.get('setup') === 'backend') {
        openBackendSetup({ mode: 'edit' });
      }
    });
    document.addEventListener('visibilitychange', () => {
      recordVisibilityTrace();
      if (document.visibilityState === 'hidden') {
        notePageHiddenForResumeSync();
      }
      if (document.visibilityState === 'visible' && zenModeActive) {
        requestWakeLock();
      } else if (document.visibilityState === 'hidden') {
        releaseWakeLock();
      }
      if (document.visibilityState === 'visible' && dut1AutoMode) {
        dut1AutoTick();
      }
      if (document.visibilityState === 'visible' && autoSyncMode) {
        scheduleAutoSync();
      }
      if (document.visibilityState === 'visible') {
        maybeResyncAfterResume();
        NextAudio.onVisible();
      }
      if (document.hidden && isRunning) {
        startBackgroundKeepAlive();
      } else {
        stopBackgroundKeepAlive();
      }
    });
