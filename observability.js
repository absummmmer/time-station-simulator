// Observability UI: clock trace charts, NTP details/history, audit table and prompt panels.
    function formatTraceSpan(ms) {
      const seconds = Math.abs(ms) / 1000;
      if (seconds < 60) return `${seconds.toFixed(0)}s`;
      if (seconds < 3600) return `${(seconds / 60).toFixed(1)}min`;
      if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
      return `${(seconds / 86400).toFixed(2)}d`;
    }

    function formatTraceSigned(value, digits = 1) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}`;
    }

    function traceTooltipRow(key, value, color) {
      return `<div class="trace-tooltip-row"><span class="trace-tooltip-key">${escapeSyncText(key)}</span><span class="trace-tooltip-value"${color ? ` style="color:${color}"` : ''}>${escapeSyncText(value)}</span></div>`;
    }

    function traceChartNearestPoint(chart, clientX) {
      const data = chart && chart._traceData;
      const svg = chart ? chart.querySelector('svg') : null;
      if (!data || !svg || !data.points.length) return null;
      let svgX = null;
      try {
        const point = svg.createSVGPoint();
        point.x = clientX;
        point.y = 0;
        const matrix = svg.getScreenCTM();
        if (matrix) svgX = point.matrixTransform(matrix.inverse()).x;
      } catch (e) { }
      if (!Number.isFinite(svgX)) return null;
      const fraction = (svgX - data.left) / data.plotW;
      const index = Math.max(0, Math.round(fraction * data.sampleSpan));
      if (typeof data.pickPoint === 'function') return data.pickPoint(index);
      return data.points[Math.min(index, data.points.length - 1)];
    }

    function bindTraceChartInteraction(chart) {
      if (!chart || chart.dataset.tracePointerBound === '1') return;
      chart.dataset.tracePointerBound = '1';
      let dragging = false;
      const tooltip = () => chart.querySelector('.trace-tooltip');
      const hide = () => {
        const el = tooltip();
        if (el) el.classList.add('hidden');
        const guide = chart.querySelector('.trace-guide');
        if (guide) guide.classList.add('hidden');
      };
      const showAt = (event) => {
        collapseTraceSummaryDiagnostics();
        const data = chart && chart._traceData;
        const el = tooltip();
        const svg = chart.querySelector('svg');
        if (!data || !el || !svg) return;
        const point = traceChartNearestPoint(chart, event.clientX);
        if (!point) return;
        const html = data.tooltip(point);
        if (!html) return;
        const svgX = data.xOf(point.sampleIndex);
        const guide = chart.querySelector('.trace-guide');
        if (guide) {
          guide.setAttribute('x1', svgX.toFixed(2));
          guide.setAttribute('x2', svgX.toFixed(2));
          guide.classList.remove('hidden');
        }
        el.innerHTML = html;
        const rect = chart.getBoundingClientRect();
        const pointerY = event.clientY - rect.top;
        let pointX = rect.width / 2;
        try {
          const screenPoint = svg.createSVGPoint();
          screenPoint.x = svgX;
          screenPoint.y = 0;
          const screen = screenPoint.matrixTransform(svg.getScreenCTM());
          pointX = screen.x - rect.left;
        } catch (e) { }
        const placeBelow = pointerY < rect.height / 2;
        el.classList.toggle('below', placeBelow);
        el.classList.remove('hidden');
        el.style.maxWidth = 'none';
        const tooltipWidth = el.offsetWidth;
        const tooltipHeight = el.offsetHeight;
        const halfWidth = tooltipWidth / 2;
        const left = tooltipWidth + 8 >= rect.width
          ? rect.width / 2
          : Math.max(halfWidth + 4, Math.min(rect.width - halfWidth - 4, pointX));
        el.style.left = `${left}px`;
        const top = placeBelow
          ? Math.max(4, rect.height - tooltipHeight - 4)
          : Math.min(rect.height - 4, tooltipHeight + 4);
        el.style.top = `${top}px`;
      };
      chart.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' && !dragging) return;
        showAt(event);
      });
      chart.addEventListener('pointerdown', (event) => {
        dragging = true;
        showAt(event);
      });
      chart.addEventListener('pointerup', () => { dragging = false; });
      chart.addEventListener('pointercancel', () => { dragging = false; });
      chart.addEventListener('pointerleave', () => {
        dragging = false;
        hide();
      });
    }

    function traceAudioOutputLines(points, xOf, top, bottom) {
      const priority = { CALIBRATION: 0, AUDIO_OUTPUT_MANUAL: 1, AUDIO_OUTPUT_SYSTEM: 2 };
      return points
        .filter((point) => point.entry && (
          point.entry.reason === 'AUDIO_OUTPUT_MANUAL'
          || point.entry.reason === 'AUDIO_OUTPUT_SYSTEM'
          || point.entry.reason === 'CALIBRATION'
        ))
        .sort((a, b) => (priority[a.entry.reason] - priority[b.entry.reason]) || (a.raw - b.raw))
        .map((point) => {
          const manual = point.entry.reason === 'AUDIO_OUTPUT_MANUAL';
          const calibration = point.entry.reason === 'CALIBRATION';
          const x = xOf(point.sampleIndex).toFixed(2);
          const title = [
            calibration
              ? 'audio delay calibration'
              : (manual ? 'manual audio profile/output switch' : 'system audio output change'),
            formatAuditTimestamp(point.entry.rawAt || point.entry.at),
            point.entry.deviceProfile || '',
            point.entry.audioContextSession !== undefined ? `session ${point.entry.audioContextSession}` : '',
          ].filter(Boolean).join(' · ');
          const className = calibration
            ? 'trace-calibration-line'
            : `trace-audio-change-line${manual ? ' manual' : ' system'}`;
          return `<line class="${className}" x1="${x}" y1="${top}"
            x2="${x}" y2="${bottom}"><title>${escapeSyncText(title)}</title></line>`;
        }).join('');
    }

    function renderClockTraceChart(series) {
      const chartEl = getUi('clock_trace_chart');
      if (!chartEl) return;
      if (!series.length) {
        chartEl.innerHTML = '<div class="trace-empty">NO TRACE SAMPLES</div>';
        return;
      }
      const allPoints = series.flat();
      const allSorted = [...allPoints].sort((a, b) => a.raw - b.raw);
      allSorted.forEach((point, index) => {
        point.sampleIndex = index;
      });
      const sampleSpan = Math.max(1, allSorted.length - 1);
      let yMin = Math.min(0, ...allPoints.map(point => point.residual));
      let yMax = Math.max(0, ...allPoints.map(point => point.residual));
      if (yMax - yMin < 2) {
        const mid = (yMin + yMax) / 2;
        yMin = mid - 1;
        yMax = mid + 1;
      } else {
        const pad = (yMax - yMin) * 0.12;
        yMin -= pad;
        yMax += pad;
      }
      const width = 820;
      const height = 300;
      const left = 58;
      const right = 14;
      const top = 16;
      const bottom = 14;
      const plotW = width - left - right;
      const plotH = height - top - bottom;
      const xOf = sampleIndex => left + (sampleIndex / sampleSpan) * plotW;
      const yOf = value => top + ((yMax - value) / (yMax - yMin)) * plotH;
      const backgroundRects = traceBackgroundRects(allSorted, xOf, top, plotH);
      const colors = ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#facc15', '#fb923c'];
      const grid = [];
      const labels = [];
      for (let i = 0; i <= 4; i += 1) {
        const value = yMin + ((yMax - yMin) * i) / 4;
        const y = yOf(value);
        grid.push(`<line class="trace-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/>`);
        labels.push(`<text class="trace-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${value.toFixed(2)}</text>`);
      }
      const zeroY = yOf(0);
      grid.push(`<line class="trace-zero" x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}"/>`);
      labels.push(`<text class="trace-label" x="${left}" y="${top - 3}" text-anchor="start">raw wall − monotonic (ms) · sample order</text>`);
      const lastPoint = allSorted[allSorted.length - 1];
      const lastPpm = Number.isFinite(lastPoint.segmentPpm)
        ? ` · seg ${formatTraceSigned(lastPoint.segmentPpm, 1)}ppm`
        : ' · seg ppm —';
      labels.push(`<text class="trace-label" x="${width - right}" y="${top - 3}" text-anchor="end">last ${Number(lastPoint.residual).toFixed(1)}ms${lastPpm}</text>`);
      labels.push(`<text class="trace-label" x="${width - right}" y="${zeroY - 4}" text-anchor="end">0</text>`);
      labels.push(`<text class="trace-label" x="${left}" y="${height - 2}" text-anchor="start" style="fill:#64748b">shaded = background</text>`);
      const maxPoints = 1800;
      const totalPoints = allPoints.length;
      const stride = Math.max(1, Math.ceil(totalPoints / maxPoints));
      const paths = series.map((points, seriesIndex) => {
        const sampled = points.filter((point, index) =>
          index % stride === 0 || index === points.length - 1);
        if (!sampled.length) return '';
        const color = colors[seriesIndex % colors.length];
        const coordinates = sampled.map(point => `${xOf(point.sampleIndex).toFixed(2)},${yOf(point.residual).toFixed(2)}`).join(' ');
        const line = sampled.length > 1
          ? `<polyline class="trace-line" points="${coordinates}" style="stroke:${color}"/>`
          : '';
        return line;
      }).join('');
      const residualTooltip = (point) => {
        const entry = point.entry || {};
        const time = formatAuditTimestamp(entry.rawAt || entry.at);
        const span = Number.isFinite(point.segmentSpanSeconds)
          ? formatTraceSpan(point.segmentSpanSeconds * 1000)
          : '—';
        const segmentValue = Number.isFinite(point.segmentPpm)
          ? `${formatTraceSigned(point.segmentPpm, 1)}ppm · ${span}`
          : '—';
        const localValue = Number.isFinite(point.localPpm)
          ? `${formatTraceSigned(point.localPpm, 1)}ppm · ${formatTraceSpan((point.localPpmSpanSeconds || 0) * 1000)}`
          : '—';
        return [
          traceTooltipRow('residual', `${formatTraceSigned(point.residual, 1)} ms`, '#67e8f9'),
          traceTooltipRow('segment', segmentValue),
          traceTooltipRow('local', localValue),
          traceTooltipRow('time', time),
          traceTooltipRow('state', `${entry.visibility || '—'} / ${entry.signal || '—'}`),
        ].join('');
      };
      chartEl.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Clock trace residual chart">
        ${grid.join('')}
        ${backgroundRects}
        <line class="trace-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>
        <line class="trace-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/>
        ${paths}
        <line class="trace-guide hidden" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>
        ${labels.join('')}
      </svg>
      <div class="trace-tooltip hidden"></div>`;
      chartEl._traceData = {
        points: allSorted,
        left,
        plotW,
        sampleSpan,
        tooltip: residualTooltip,
        xOf,
        yOf: point => yOf(point.residual),
      };
      bindTraceChartInteraction(chartEl);
    }

    function renderClockTraceOffsetChart(series) {
      const chartEl = getUi('clock_trace_offset_chart');
      if (!chartEl) return;
      const allPoints = series.flat().filter(point => Number.isFinite(Number(point.entry.offsetMs)));
      if (!allPoints.length) {
        chartEl.innerHTML = '<div class="trace-empty">NO OFFSET SAMPLES</div>';
        return;
      }
      const allSorted = [...allPoints].sort((a, b) => a.raw - b.raw);
      allSorted.forEach((point, index) => {
        point.sampleIndex = index;
      });
      const sampleSpan = Math.max(1, allSorted.length - 1);
      const width = 820;
      const height = 300;
      const left = 58;
      const right = 14;
      const top = 16;
      const bottom = 14;
      const plotW = width - left - right;
      const plotH = height - top - bottom;
      const values = allPoints.map(point => Number(point.entry.offsetMs));
      let yMin = Math.min(...values);
      let yMax = Math.max(...values);
      const valueRange = Math.max(0, yMax - yMin);
      const MINOR_CHANGE_MS = 5;
      const MAJOR_CHANGE_MS = 50;
      const pad = Math.max(1, valueRange * 0.12);
      yMin -= pad;
      yMax += pad;
      const xOf = sampleIndex => left + (sampleIndex / sampleSpan) * plotW;
      const yOf = value => top + ((yMax - value) / (yMax - yMin)) * plotH;
      const backgroundRects = traceBackgroundRects(allSorted, xOf, top, plotH);
      const grid = [];
      const labels = [];
      for (let i = 0; i <= 4; i += 1) {
        const value = yMin + ((yMax - yMin) * i) / 4;
        const y = yOf(value);
        grid.push(`<line class="trace-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/>`);
        labels.push(`<text class="trace-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${value.toFixed(0)}</text>`);
      }
      labels.push(`<text class="trace-label" x="${left}" y="${top - 3}" text-anchor="start">offset (ms) · sample order</text>`);
      const lastOffset = Number(allSorted[allSorted.length - 1].entry.offsetMs);
      labels.push(`<text class="trace-label" x="${width - right}" y="${top - 3}" text-anchor="end" style="fill:#fbbf24">Δ≥5ms · bright≥50ms · last ${lastOffset.toFixed(0)}ms</text>`);
      labels.push(`<text class="trace-label" x="${left}" y="${height - 2}" text-anchor="start" style="fill:#64748b">shaded = background · faint bands = sync ±unc / Δjitter</text>`);
      const colors = ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#facc15', '#fb923c'];
      const colorBySampleIndex = new Map();
      const seriesIndexBySampleIndex = new Map();
      const seriesBounds = [];
      series.forEach((points, seriesIndex) => {
        const seriesColor = colors[seriesIndex % colors.length];
        let firstIndex = Infinity;
        let lastIndex = -Infinity;
        points.forEach((point) => {
          if (Number.isFinite(Number(point.entry && point.entry.offsetMs))) {
            colorBySampleIndex.set(point.sampleIndex, seriesColor);
            seriesIndexBySampleIndex.set(point.sampleIndex, seriesIndex);
            if (point.sampleIndex < firstIndex) firstIndex = point.sampleIndex;
            if (point.sampleIndex > lastIndex) lastIndex = point.sampleIndex;
          }
        });
        seriesBounds.push({ first: firstIndex, last: lastIndex });
      });
      const stride = Math.max(1, Math.ceil(allPoints.length / 1800));
      const lines = series.map((points, seriesIndex) => {
        const valid = points.filter(point => Number.isFinite(Number(point.entry.offsetMs)));
        const sampled = valid.filter((point, index) => index % stride === 0 || index === valid.length - 1);
        if (!sampled.length) return '';
        const coordinates = sampled.map(point => `${xOf(point.sampleIndex).toFixed(2)},${yOf(Number(point.entry.offsetMs)).toFixed(2)}`).join(' ');
        const line = sampled.length > 1
          ? `<polyline class="trace-line" points="${coordinates}" style="stroke:${colors[seriesIndex % colors.length]}"/>`
          : '';
        return line;
      }).join('');
      // Sync quality bands. Uncertainty and jitter are recorded per sync, not
      // per trace sample, so each successful sync owns the interval up to the
      // next sync: a faint translucent rectangle in the sample's series color
      // (outer = spread/jitter, inner = ±uncertainty). Filled areas stay readable
      // for large quality ranges and on small screens where 1px lines vanish.
      const SYNC_WHISKER_MATCH_MS = 10 * 1000;
      const numericOrNull = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      const nearestTraceIndex = (targetRaw) => {
        if (!allSorted.length) return -1;
        let low = 0;
        let high = allSorted.length - 1;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          if (allSorted[mid].raw < targetRaw) low = mid + 1;
          else high = mid;
        }
        const candidates = [low, low - 1].filter(index => index >= 0 && index < allSorted.length);
        candidates.sort((a, b) => Math.abs(allSorted[a].raw - targetRaw) - Math.abs(allSorted[b].raw - targetRaw));
        return candidates.length ? candidates[0] : -1;
      };
      const syncWhiskerByIndex = new Map();
      const syncEntries = (typeof syncAuditLog !== 'undefined' && Array.isArray(syncAuditLog)) ? syncAuditLog : [];
      for (const entry of syncEntries) {
        if (!entry || entry.ok !== true) continue;
        const uncertaintyMs = numericOrNull(entry.uncertaintyMs);
        const jitterMs = numericOrNull(entry.spreadMs);
        const offsetMs = numericOrNull(entry.offsetMs);
        if (offsetMs === null || (uncertaintyMs === null && jitterMs === null)) continue;
        const anchorRaw = Date.parse(entry.at) - (numericOrNull(entry.offsetBeforeMs) || 0);
        if (!Number.isFinite(anchorRaw)) continue;
        let anchorIndex = nearestTraceIndex(anchorRaw);
        if (anchorIndex < 0) continue;
        // Prefer the SYNC_OK sample (post-sync offset) near the recorded sync start.
        for (let distance = 0; distance <= 40; distance += 1) {
          const beforeIndex = anchorIndex - distance;
          const afterIndex = anchorIndex + distance;
          const before = beforeIndex >= 0 ? allSorted[beforeIndex] : null;
          const after = afterIndex < allSorted.length ? allSorted[afterIndex] : null;
          if (before && before.entry.reason === 'SYNC_OK'
            && Math.abs(before.raw - anchorRaw) <= SYNC_WHISKER_MATCH_MS) {
            anchorIndex = beforeIndex;
            break;
          }
          if (after && after.entry.reason === 'SYNC_OK'
            && Math.abs(after.raw - anchorRaw) <= SYNC_WHISKER_MATCH_MS) {
            anchorIndex = afterIndex;
            break;
          }
        }
        const anchorPoint = allSorted[anchorIndex];
        if (!anchorPoint || Math.abs(anchorPoint.raw - anchorRaw) > SYNC_WHISKER_MATCH_MS) continue;
        const plottedOffset = numericOrNull(anchorPoint.entry.offsetMs);
        const center = plottedOffset === null ? offsetMs : plottedOffset;
        const reasonMeta = (typeof SYNC_REASON_META !== 'undefined' && SYNC_REASON_META[entry.reason]) || {};
        syncWhiskerByIndex.set(anchorPoint.sampleIndex, {
          sampleIndex: anchorPoint.sampleIndex,
          center,
          uncertaintyMs,
          jitterMs,
          reason: reasonMeta.label || String(entry.reason || 'sync').toUpperCase(),
          at: entry.at,
          color: colorBySampleIndex.get(anchorPoint.sampleIndex) || colors[0],
        });
      }
      const clampPlotY = value => Math.max(top, Math.min(height - bottom, value));
      const syncBands = [...syncWhiskerByIndex.values()].sort((a, b) => a.sampleIndex - b.sampleIndex);
      const syncBandShapes = syncBands.map((band, index) => {
        const next = syncBands[index + 1];
        const seriesIndex = seriesIndexBySampleIndex.get(band.sampleIndex);
        const bounds = Number.isInteger(seriesIndex) ? seriesBounds[seriesIndex] : null;
        const seriesEndIndex = bounds && Number.isFinite(bounds.last) ? bounds.last : band.sampleIndex;
        const xStart = xOf(band.sampleIndex);
        // Never bridge a session/visibility/gap segment boundary: the offset line
        // is split there, so the band must stop at the last sample of its own
        // series instead of reaching the next sync in a later session.
        const nextX = next ? xOf(next.sampleIndex) : width - right;
        const xEnd = Math.min(nextX, xOf(seriesEndIndex));
        const bandWidth = Math.max(1, xEnd - xStart);
        const rects = [];
        const addBand = (className, dataAttribute, halfSpan, opacity) => {
          if (halfSpan === null || halfSpan <= 0) return;
          const yTop = clampPlotY(yOf(band.center + halfSpan));
          const yBottom = clampPlotY(yOf(band.center - halfSpan));
          const bandHeight = Math.max(1, yBottom - yTop);
          rects.push(`<rect class="${className}" x="${xStart.toFixed(2)}" y="${yTop.toFixed(2)}"
            width="${bandWidth.toFixed(2)}" height="${bandHeight.toFixed(2)}"
            fill="${band.color}" fill-opacity="${opacity}" ${dataAttribute}="${halfSpan}"/>`);
        };
        // Jitter is the full sample spread (max-min); its band spans half the
        // spread above and below the plotted offset, with uncertainty nested.
        addBand('trace-sync-jitter-band', 'data-sync-jitter-ms', band.jitterMs === null ? null : band.jitterMs / 2, 0.12);
        addBand('trace-sync-uncertainty-band', 'data-sync-uncertainty-ms', band.uncertaintyMs, 0.26);
        return rects.length
          ? `<g class="trace-sync-band" data-sync-sample-index="${band.sampleIndex}">${rects.join('')}</g>`
          : '';
      }).join('');
      const changes = [];
      for (let i = 1; i < allSorted.length; i += 1) {
        const prev = allSorted[i - 1];
        const current = allSorted[i];
        if (current.raw - prev.raw > 10 * 60 * 1000) continue;
        const before = Number(prev.entry.offsetMs);
        const after = Number(current.entry.offsetMs);
        const delta = after - before;
        if (Math.abs(delta) >= MINOR_CHANGE_MS) {
          changes.push({ x: xOf(current.sampleIndex), before, after, delta, sampleIndex: current.sampleIndex });
        }
      }
      const changeLines = changes.map(change => {
        const x = change.x;
        const major = Math.abs(change.delta) >= MAJOR_CHANGE_MS;
        return `<line class="trace-change-line${major ? ' major' : ''}" x1="${x.toFixed(2)}" y1="${top}"
          x2="${x.toFixed(2)}" y2="${height - bottom}"/>`;
      }).join('');
      const offsetTooltip = (point) => {
        const entry = point.entry || {};
        const index = Number.isFinite(point.sampleIndex) ? point.sampleIndex : allSorted.indexOf(point);
        const previous = index > 0 ? allSorted[index - 1] : null;
        const sameWindow = previous && (point.raw - previous.raw <= 10 * 60 * 1000);
        const delta = sameWindow ? Number(entry.offsetMs) - Number(previous.entry.offsetMs) : null;
        const sync = syncWhiskerByIndex.get(point.sampleIndex);
        const syncQuality = sync
          ? [
            sync.uncertaintyMs === null ? '' : `±${sync.uncertaintyMs.toFixed(1)}ms`,
            sync.jitterMs === null ? '' : `Δ${sync.jitterMs.toFixed(1)}ms`,
          ].filter(Boolean).join(' · ')
          : '';
        return [
          traceTooltipRow('offset', `${formatTraceSigned(entry.offsetMs, 1)} ms`, '#67e8f9'),
          traceTooltipRow('time', formatAuditTimestamp(entry.rawAt || entry.at)),
          traceTooltipRow('state', `${entry.visibility || '—'} / ${entry.signal || '—'}`),
          sync ? traceTooltipRow('sync', `${sync.reason} · ${syncQuality}`, sync.color) : '',
          traceTooltipRow('delta', Number.isFinite(delta) ? `${formatTraceSigned(delta, 1)} ms` : '—', '#9ca3af'),
        ].join('');
      };
      chartEl.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Clock trace offset chart">
        ${grid.join('')}
        ${backgroundRects}
        ${syncBandShapes}
        <line class="trace-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>
        <line class="trace-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/>
        ${lines}
        ${changeLines}
        <line class="trace-guide hidden" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>
        ${labels.join('')}
      </svg>
      <div class="trace-tooltip hidden"></div>`;
      chartEl._traceData = {
        points: allSorted,
        left,
        plotW,
        sampleSpan,
        tooltip: offsetTooltip,
        xOf,
        yOf: point => yOf(Number(point.entry.offsetMs)),
        syncWhiskers: syncBands,
      };
      bindTraceChartInteraction(chartEl);
    }

    function renderClockTraceAudioChart(series) {
      const chartEl = getUi('clock_trace_audio_chart');
      if (!chartEl) return;
      const allPoints = series.flat();
      if (!allPoints.length) {
        chartEl.innerHTML = '<div class="trace-empty">NO TRACE SAMPLES</div>';
        return;
      }
      const allSorted = [...allPoints].sort((a, b) => a.raw - b.raw);
      allSorted.forEach((point, index) => {
        point.sampleIndex = index;
      });
      const audioPoints = allSorted.filter((point) => {
        const value = Number(point.entry && point.entry.audioTimelineDeltaMs);
        return Number.isFinite(value) && Math.abs(value) <= 2000;
      });
      if (!audioPoints.length) {
        chartEl.innerHTML = '<div class="trace-empty">NO AUDIO TIMELINE SAMPLES</div>';
        return;
      }
      const sampleSpan = Math.max(1, allSorted.length - 1);
      const width = 820;
      const height = 300;
      const left = 58;
      const right = 14;
      const top = 16;
      const bottom = 14;
      const plotW = width - left - right;
      const plotH = height - top - bottom;
      const values = audioPoints.map(point => Number(point.entry.audioTimelineDeltaMs));
      let yMin = Math.min(0, ...values);
      let yMax = Math.max(0, ...values);
      if (yMax - yMin < 2) {
        const mid = (yMin + yMax) / 2;
        yMin = mid - 1;
        yMax = mid + 1;
      } else {
        const pad = (yMax - yMin) * 0.12;
        yMin -= pad;
        yMax += pad;
      }
      const xOf = sampleIndex => left + (sampleIndex / sampleSpan) * plotW;
      const yOf = value => top + ((yMax - value) / (yMax - yMin)) * plotH;
      const backgroundRects = traceBackgroundRects(allSorted, xOf, top, plotH);
      const grid = [];
      const labels = [];
      for (let i = 0; i <= 4; i += 1) {
        const value = yMin + ((yMax - yMin) * i) / 4;
        const y = yOf(value);
        grid.push(`<line class="trace-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/>`);
        labels.push(`<text class="trace-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${value.toFixed(0)}</text>`);
      }
      const zeroY = yOf(0);
      grid.push(`<line class="trace-zero" x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}"/>`);
      labels.push(`<text class="trace-label" x="${left}" y="${top - 3}" text-anchor="start">audio timeline Δ (ms) · sample order</text>`);
      const lastPoint = audioPoints[audioPoints.length - 1];
      const lastDelta = Number(lastPoint.entry.audioTimelineDeltaMs);
      const lastSkew = Number(lastPoint.entry.audioSkewPpm);
      labels.push(`<text class="trace-label" x="${width - right}" y="${top - 3}" text-anchor="end" style="fill:#fbbf24">last ${formatTraceSigned(lastDelta, 1)}ms${Number.isFinite(lastSkew) ? ` · skew ${formatTraceSigned(lastSkew, 1)}ppm` : ''}</text>`);
      labels.push(`<text class="trace-label" x="${left}" y="${height - 2}" text-anchor="start" style="fill:#64748b">0 = sync/reanchor target · shaded = background · dim=cal bright=system</text>`);
      const colors = ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#facc15', '#fb923c'];
      const segments = [];
      let currentSegment = [];
      let lastKey = '';
      let lastRaw = 0;
      for (const point of audioPoints) {
        const entry = point.entry || {};
        const key = `${entry.deviceProfile || ''}|${entry.audioContextSession ?? ''}`;
        if (currentSegment.length && (key !== lastKey || point.raw - lastRaw > 10 * 60 * 1000)) {
          segments.push(currentSegment);
          currentSegment = [];
        }
        currentSegment.push(point);
        lastKey = key;
        lastRaw = point.raw;
      }
      if (currentSegment.length) segments.push(currentSegment);
      const lines = segments.map((segment, index) => {
        if (segment.length < 2) return '';
        const coordinates = segment.map(point => `${xOf(point.sampleIndex).toFixed(2)},${yOf(Number(point.entry.audioTimelineDeltaMs)).toFixed(2)}`).join(' ');
        return `<polyline class="trace-line" points="${coordinates}" style="stroke:${colors[index % colors.length]}"/>`;
      }).join('');
      const audioOutputLines = traceAudioOutputLines(allSorted, xOf, top, height - bottom);
      const tooltip = (point) => {
        const entry = point.entry || {};
        const skew = Number(entry.audioSkewPpm);
        return [
          traceTooltipRow('audio Δ', `${formatTraceSigned(entry.audioTimelineDeltaMs, 1)} ms`, '#fbbf24'),
          traceTooltipRow('skew', Number.isFinite(skew) ? `${formatTraceSigned(skew, 1)} ppm` : '—'),
          traceTooltipRow('device', `${entry.deviceProfile || '—'} · S${entry.audioContextSession ?? '—'}`),
          traceTooltipRow('output', Number.isFinite(Number(entry.audioOutputLatencyMs)) ? `${Number(entry.audioOutputLatencyMs).toFixed(0)} ms` : '—'),
          traceTooltipRow('reanchor', entry.reanchorReason || '—'),
          traceTooltipRow('time', formatAuditTimestamp(entry.rawAt || entry.at)),
        ].join('');
      };
      chartEl.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Audio timeline delta chart">
        ${grid.join('')}
        ${backgroundRects}
        <line class="trace-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>
        <line class="trace-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/>
        ${lines}
        ${audioOutputLines}
        <line class="trace-guide hidden" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"/>
        ${labels.join('')}
      </svg>
      <div class="trace-tooltip hidden"></div>`;
      chartEl._traceData = {
        points: audioPoints,
        left,
        plotW,
        sampleSpan,
        tooltip,
        xOf,
        yOf: point => yOf(Number(point.entry.audioTimelineDeltaMs)),
        pickPoint: (targetIndex) => {
          let low = 0;
          let high = audioPoints.length - 1;
          while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (audioPoints[mid].sampleIndex < targetIndex) low = mid + 1;
            else high = mid;
          }
          const after = audioPoints[low];
          const before = low > 0 ? audioPoints[low - 1] : null;
          if (!before) return after;
          return Math.abs(before.sampleIndex - targetIndex) <= Math.abs(after.sampleIndex - targetIndex)
            ? before
            : after;
        },
      };
      bindTraceChartInteraction(chartEl);
    }

    let traceSummaryCompact = '';
    let traceSummaryDiagnostic = '';
    let traceSummaryExpanded = false;

    function renderTraceSummary() {
      const summary = getUi('clock_trace_summary');
      if (!summary) return;
      summary.textContent = traceSummaryExpanded && traceSummaryDiagnostic
        ? traceSummaryDiagnostic
        : traceSummaryCompact;
      summary.classList.toggle('text-gray-300', traceSummaryExpanded);
    }

    function toggleTraceSummaryDiagnostics() {
      if (!traceSummaryCompact) return;
      if (!traceSummaryExpanded && !traceSummaryDiagnostic) return;
      traceSummaryExpanded = !traceSummaryExpanded;
      renderTraceSummary();
    }

    function collapseTraceSummaryDiagnostics() {
      if (!traceSummaryExpanded) return;
      traceSummaryExpanded = false;
      renderTraceSummary();
    }

    function renderClockTraceView() {
      const summary = getUi('clock_trace_summary');
      if (!summary) return;
      const cutoff = getLogNowMs() - 24 * 60 * 60 * 1000;
      const windowEntries = clockTraceLog.filter(entry => {
        const timestamp = Date.parse(entry.rawAt || entry.at);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      });
      const series = buildClockTraceSeries(windowEntries);
      traceSummaryExpanded = false;
      if (!windowEntries.length) {
        traceSummaryCompact = 'NO TRACE SAMPLES IN LAST 24H';
        traceSummaryDiagnostic = '';
      } else {
        const first = windowEntries[0];
        const last = windowEntries[windowEntries.length - 1];
        const firstMs = Date.parse(first.rawAt || first.at);
        const lastMs = Date.parse(last.rawAt || last.at);
        const span = Math.max(0, lastMs - firstMs);
        const lastAge = Math.max(0, getLogNowMs() - lastMs);
        const sessionCount = new Set(windowEntries.map(entry => entry.session || 'unknown')).size;
        const hiddenCount = windowEntries.filter(entry => entry.visibility === 'HIDDEN').length;
        const visiblePct = Math.round(((windowEntries.length - hiddenCount) / windowEntries.length) * 100);
        const audioEntries = windowEntries.filter(entry => Number.isFinite(Number(entry.audioTimelineDeltaMs)));
        const lastAudio = audioEntries[audioEntries.length - 1];
        const audioCompact = lastAudio
          ? ` · AUDIO ${Number.isFinite(Number(lastAudio.audioSkewPpm)) ? `${formatTraceSigned(lastAudio.audioSkewPpm, 1)}ppm` : '—'} Δ${formatTraceSigned(lastAudio.audioTimelineDeltaMs, 1)}ms`
          : '';
        const audioDiagnostic = lastAudio
          ? ` · AUDIO ${lastAudio.deviceProfile || '—'} S${lastAudio.audioContextSession ?? '—'} · ${Number.isFinite(Number(lastAudio.audioOutputLatencyMs)) ? `${Number(lastAudio.audioOutputLatencyMs).toFixed(0)}ms out` : 'out —'} · ${lastAudio.reanchorReason || '—'}`
          : '';
        traceSummaryCompact = `24H · ${windowEntries.length} SMP · ${formatTraceSpan(span)} · VIS ${visiblePct}% · last ${formatTraceSpan(lastAge)}${audioCompact}`;
        traceSummaryDiagnostic = `${sessionCount} SESS · ${series.length} SEG · HID ${hiddenCount} · ${formatAuditTimestamp(first.rawAt || first.at)} → ${formatAuditTimestamp(last.rawAt || last.at)}${audioDiagnostic}`;
      }
      renderTraceSummary();
      renderClockTraceOffsetChart(series);
      renderClockTraceAudioChart(series);
      renderClockTraceChart(series);
    }

    function clearClockTrace() {
      if (!clockTraceLog.length) return;
      if (!window.confirm('Clear clock trace?')) return;
      clockTraceLog.length = 0;
      try { localStorage.removeItem(CLOCK_TRACE_STORAGE_KEY); } catch (e) { }
      renderClockTraceView();
    }

    function setAuditTab(tab) {
      activeAuditTab = tab === 'trace' ? 'trace' : 'sync';
      const syncView = getUi('sync_audit_view');
      const traceView = getUi('clock_trace_view');
      const syncTab = getUi('audit_tab_sync');
      const traceTab = getUi('audit_tab_trace');
      if (syncView) syncView.classList.toggle('hidden', activeAuditTab !== 'sync');
      if (traceView) traceView.classList.toggle('hidden', activeAuditTab !== 'trace');
      [syncTab, traceTab].forEach(button => {
        if (!button) return;
        const active = button === (activeAuditTab === 'trace' ? traceTab : syncTab);
        button.classList.toggle('bg-blue-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('bg-dark-700', !active);
        button.classList.toggle('text-gray-300', !active);
      });
      if (activeAuditTab === 'trace') renderClockTraceView();
    }

    window.bpmClockTrace = {
      entries: clockTraceLog,
      exportCsv: exportClockTraceCsv,
      clear: clearClockTrace,
    };

    function formatFullTimestamp(iso) {
      return iso || '—';
    }

    function formatCompactTimestamp(iso) {
      const date = new Date(iso);
      if (!Number.isFinite(date.getTime())) return '—';
      return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    }

    function formatAuditTimestamp(iso) {
      const date = new Date(iso);
      if (!Number.isFinite(date.getTime())) return '—';
      const value = date.toISOString();
      return `${value.slice(5, 10)} ${value.slice(11, 23)}Z`;
    }

    function formatSignedOffsetSeconds(value) {
      if (!Number.isFinite(value)) return '—';
      const seconds = value / 1000;
      return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(3)}s`;
    }

    function formatMetricMs(value, digits = 1) {
      if (!Number.isFinite(value)) return '—';
      return `${value.toFixed(digits)}ms`;
    }

    function formatDurationSeconds(value) {
      if (!Number.isFinite(value)) return '—';
      return `${(value / 1000).toFixed(1)}s`;
    }

    const NTP_STATUS_LABELS = {
      ok: 'NTP_OK',
      weak: 'NTP_WK',
      offset: 'NTP_OFST',
      hold: 'NTP_HLD',
      down: 'NTP_LOS',
      unknown: 'NTP_UKN',
    };

    function ntpStatusLabel(view) {
      if (!view) return NTP_STATUS_LABELS.unknown;
      const base = NTP_STATUS_LABELS[view.status] || NTP_STATUS_LABELS.unknown;
      return view.fallback ? `${base}_FB` : base;
    }

    function ntpEntryView(entry) {
      if (!entry || typeof entry.backendNtpSynchronized !== 'boolean') return null;
      const numeric = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value))
        ? Number(value)
        : null;
      let sources = [];
      if (typeof entry.backendNtpSources === 'string' && entry.backendNtpSources.trim()) {
        try {
          const parsed = JSON.parse(entry.backendNtpSources);
          if (Array.isArray(parsed)) sources = parsed;
        } catch (e) { }
      }
      let status = 'unknown';
      if (entry.backendNtpHoldover) status = 'hold';
      else if (entry.backendNtpSynchronized) status = 'ok';
      else if (entry.backendNtpReachable === false) status = 'down';
      else if (entry.backendNtpQualityOk === false) status = 'weak';
      else if (entry.backendNtpOffsetOk === false) status = 'offset';
      return {
        status,
        source: entry.backendNtpSource || '',
        resolvedIp: entry.backendNtpResolvedIp || '',
        sources,
        fallback: entry.backendNtpFallback === true,
        offsetMs: numeric(entry.backendNtpOffsetMs),
        uncertaintyMs: numeric(entry.backendNtpUncertaintyMs),
        rttMs: numeric(entry.backendNtpRttMs),
        stratum: numeric(entry.backendNtpStratum),
        ageS: numeric(entry.backendNtpAgeS),
        correctionApplied: entry.backendNtpCorrectionApplied === true,
        correctionMs: numeric(entry.backendNtpCorrectionMs),
        correctionEligible: entry.backendNtpCorrectionEligible === true,
        correctionMode: entry.backendNtpCorrectionMode || '',
        correctionSource: entry.backendNtpCorrectionSource || '',
        correctionReason: entry.backendNtpCorrectionReason || '',
        clockSource: entry.backendNtpClockSource || '',
        lastSuccessAt: entry.backendNtpLastSuccessAt || '',
        error: entry.backendNtpError || '',
      };
    }

    function formatSignedNtpMs(value, digits = 1) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}ms`;
    }

    function formatNtpDetails(view) {
      if (!view) return '';
      const parts = [];
      if (view.source) parts.push(`${view.source}${view.resolvedIp ? ` [${view.resolvedIp}]` : ''}${view.fallback ? ' (fallback)' : ''}`);
      if (view.offsetMs !== null) parts.push(`offset ${formatSignedNtpMs(view.offsetMs, 2)}`);
      if (view.uncertaintyMs !== null) parts.push(`±${view.uncertaintyMs.toFixed(1)}ms`);
      if (view.rttMs !== null) parts.push(`RTT ${view.rttMs.toFixed(1)}ms`);
      if (view.stratum !== null) parts.push(`S${view.stratum}`);
      if (view.ageS !== null) parts.push(`age ${Math.round(view.ageS)}s`);
      if (view.correctionMode) parts.push(`corr ${view.correctionMode}`);
      if (view.correctionApplied && view.correctionMs !== null) {
        parts.push(`corr ${formatSignedNtpMs(view.correctionMs, 1)}`);
      } else if (view.correctionReason) {
        parts.push(`no corr:${view.correctionReason}`);
      }
      if (view.error) parts.push(`error ${view.error}`);
      return parts.join(' · ');
    }

    function formatNtpInline(entry) {
      const view = ntpEntryView(entry);
      if (!view) return '';
      const pair = formatNtpOffsetPair(view);
      return pair ? `${ntpStatusLabel(view)}:${pair}` : ntpStatusLabel(view);
    }

    function formatNtpOffsetPair(view) {
      if (!view || view.offsetMs === null || view.uncertaintyMs === null) return '';
      return `${formatSignedNtpMs(view.offsetMs, 1)}±${view.uncertaintyMs.toFixed(1)}ms`;
    }

    function formatNtpSourceTable(view) {
      if (!view || !view.sources.length) return '';
      const hasNumber = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
      const rows = view.sources.map(source => {
        if (!source || typeof source !== 'object') return '';
        const reachable = source.reachable === true;
        const marker = source.selected === true ? '●' : reachable ? '○' : '×';
        const rowClass = source.selected === true ? 'ntp-source-selected' : reachable ? '' : 'ntp-source-down';
        const offset = reachable && hasNumber(source.offset_ms)
          ? formatSignedNtpMs(Number(source.offset_ms), 2)
          : '—';
        const uncertainty = reachable && hasNumber(source.uncertainty_ms)
          ? `±${Number(source.uncertainty_ms).toFixed(1)}ms`
          : '—';
        const rtt = reachable && hasNumber(source.rtt_ms)
          ? `${Number(source.rtt_ms).toFixed(1)}ms`
          : '—';
        const stratum = hasNumber(source.stratum) && Number(source.stratum) > 0
          ? `S${Number(source.stratum)}`
          : '—';
        const age = source.last_success_at && hasNumber(source.age_s) ? formatNtpAge(Number(source.age_s)) : '—';
        const reach = source.reach_octal
          || (hasNumber(source.reach) ? Number(source.reach).toString(8).padStart(3, '0') : '—');
        const failures = hasNumber(source.consecutive_failures) ? String(Number(source.consecutive_failures)) : '—';
        const flags = `${source.offset_ok === true ? 'O' : '-'}${source.quality_ok === true ? 'Q' : '-'}`;
        const root = hasNumber(source.root_delay_ms) && hasNumber(source.root_dispersion_ms)
          ? `${Number(source.root_delay_ms).toFixed(1)}/${Number(source.root_dispersion_ms).toFixed(1)}ms`
          : '—';
        const leap = hasNumber(source.leap) ? `L${Number(source.leap)}` : '—';
        const titleParts = [];
        if (source.resolved_ip) titleParts.push(`resolved ${source.resolved_ip}`);
        if (source.last_success_at) titleParts.push(`last success ${formatFullTimestamp(source.last_success_at)}`);
        if (source.last_attempt_at) titleParts.push(`last attempt ${formatFullTimestamp(source.last_attempt_at)}`);
        titleParts.push(`offset_ok=${source.offset_ok === true}`, `quality_ok=${source.quality_ok === true}`);
        if (source.error) titleParts.push(`error ${source.error}`);
        const title = ` title="${escapeSyncText(titleParts.join(' · '))}"`;
        return `<tr class="${rowClass}"${title}>
          <td class="ntp-source-marker">${marker}</td>
          <td>${escapeSyncText(source.server || '—')}</td>
          <td>${stratum}</td>
          <td>${offset}</td>
          <td>${uncertainty}</td>
          <td>${rtt}</td>
          <td>${age}</td>
          <td>${reach}</td>
          <td>${failures}</td>
          <td>${flags}</td>
          <td>${root}</td>
          <td>${leap}</td>
        </tr>`;
      }).join('');
      return `<div class="ntp-sources-wrap"><table class="ntp-sources">
        <thead><tr><th></th><th>source</th><th>S</th><th>offset</th><th>±ms</th><th>RTT</th><th>age</th><th>reach</th><th>fail</th><th>OQ</th><th>root</th><th>LP</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    }

    function formatNtpAge(seconds) {
      if (!Number.isFinite(seconds)) return '—';
      if (seconds < 90) return `${Math.round(seconds)}s`;
      if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
      return `${(seconds / 3600).toFixed(1)} h`;
    }

    let ntpDetailEntryAt = null;

    function renderNtpHistoryChart(selectedAt = null) {
      const chartEl = getUi('ntp_history_chart');
      if (!chartEl) return;
      const cutoff = getLogNowMs() - 24 * 60 * 60 * 1000;
      const rows = syncAuditLog
        .map(entry => {
          const view = ntpEntryView(entry);
          return {
            entry,
            view,
            successTime: Date.parse(view && view.lastSuccessAt),
            syncTime: Date.parse(entry.at),
          };
        })
        .filter(row => row.view && Number.isFinite(row.successTime) && row.successTime >= cutoff)
        .sort((a, b) => a.successTime - b.successTime);
      const bySuccess = new Map();
      for (const row of rows) bySuccess.set(row.successTime, row);
      const points = [...bySuccess.values()].filter(row => Number.isFinite(row.view.offsetMs));
      if (!points.length) {
        chartEl.innerHTML = '<div class="trace-empty">NO NTP TREND IN LAST 24H</div>';
        return;
      }
      const corrections = rows.filter(row =>
        row.view.correctionApplied
        && Number.isFinite(row.view.correctionMs)
        && row.view.correctionMs !== 0
        && Number.isFinite(row.syncTime));
      const outages = rows.filter(row => row.view.status === 'down' && Number.isFinite(row.syncTime));
      const times = [
        ...points.map(row => row.successTime),
        ...corrections.map(row => row.syncTime),
        ...outages.map(row => row.syncTime),
      ];
      const timeMin = Math.min(...times);
      const timeMax = Math.max(...times);
      const timeSpan = Math.max(1, timeMax - timeMin);
      const width = 820;
      const height = 200;
      const left = 22;
      const right = 8;
      const top = 0;
      const bottom = 0;
      const plotW = width - left - right;
      const plotH = height - top - bottom;
      const xOf = time => left + ((time - timeMin) / timeSpan) * plotW;
      const bounds = [0];
      for (const row of points) {
        bounds.push(row.view.offsetMs);
        if (Number.isFinite(row.view.uncertaintyMs)) {
          bounds.push(row.view.offsetMs - row.view.uncertaintyMs);
          bounds.push(row.view.offsetMs + row.view.uncertaintyMs);
        }
      }
      let yMin = Math.min(...bounds);
      let yMax = Math.max(...bounds);
      if (yMax - yMin < 1) {
        const mid = (yMax + yMin) / 2;
        yMin = mid - 0.5;
        yMax = mid + 0.5;
      } else {
        const pad = (yMax - yMin) * 0.15;
        yMin -= pad;
        yMax += pad;
      }
      const yOf = value => top + ((yMax - value) / (yMax - yMin)) * plotH;
      const colorFor = status => ({
        ok: '#4ade80',
        weak: '#facc15',
        offset: '#fb923c',
        hold: '#fb923c',
        down: '#f87171',
        unknown: '#9ca3af',
      }[status] || '#9ca3af');
      const band = points.map((row, index) => {
        if (!Number.isFinite(row.view.uncertaintyMs)) return '';
        const xStart = xOf(row.successTime);
        const endTime = index + 1 < points.length ? points[index + 1].successTime : timeMax;
        const width = Math.max(0, xOf(endTime) - xStart);
        if (width <= 0) return '';
        const yTop = yOf(row.view.offsetMs + row.view.uncertaintyMs);
        const yBottom = yOf(row.view.offsetMs - row.view.uncertaintyMs);
        return `<rect x="${xStart.toFixed(2)}" y="${yTop.toFixed(2)}" width="${width.toFixed(2)}"
          height="${Math.max(0, yBottom - yTop).toFixed(2)}" fill="rgba(34,211,238,0.14)"/>`;
      }).join('');
      let line = '';
      if (points.length) {
        const x0 = xOf(points[0].successTime);
        let path = `M${x0.toFixed(2)} ${yOf(points[0].view.offsetMs).toFixed(2)}`;
        for (let index = 1; index < points.length; index += 1) {
          path += ` H${xOf(points[index].successTime).toFixed(2)} V${yOf(points[index].view.offsetMs).toFixed(2)}`;
        }
        path += ` H${xOf(timeMax).toFixed(2)}`;
        line = `<path d="${path}" fill="none" stroke="rgba(34,211,238,0.65)" stroke-width="1.2"/>`;
      }
      const correctionLines = corrections
        .map(row => `<line x1="${xOf(row.syncTime).toFixed(2)}" y1="${top}" x2="${xOf(row.syncTime).toFixed(2)}" y2="${height - bottom}"
          stroke="#fb923c" stroke-width="1" stroke-opacity="0.2">
          <title>NTP correction ${formatSignedNtpMs(row.view.correctionMs, 1)} · sync ${escapeSyncText(formatFullTimestamp(row.entry.at))}</title>
        </line>`)
        .join('');
      const outageLines = outages
        .map(row => `<line x1="${xOf(row.syncTime).toFixed(2)}" y1="${top}" x2="${xOf(row.syncTime).toFixed(2)}" y2="${height - bottom}"
          stroke="#f87171" stroke-width="1" stroke-opacity="0.5">
          <title>NTP unreachable · sync ${escapeSyncText(formatFullTimestamp(row.entry.at))}</title>
        </line>`)
        .join('');
      const selectedRow = selectedAt
        ? rows.find(row => row.entry.at === selectedAt)
        : null;
      const selectedTime = selectedRow
        ? (Number.isFinite(selectedRow.successTime) ? selectedRow.successTime : selectedRow.syncTime)
        : null;
      const selectedLine = Number.isFinite(selectedTime)
        ? `<line x1="${xOf(selectedTime).toFixed(2)}" y1="${top}" x2="${xOf(selectedTime).toFixed(2)}" y2="${height - bottom}"
            stroke="#f8fafc" stroke-width="2" stroke-opacity="0.8"/>`
        : '';
      const dots = points.map(row => {
        const selected = selectedRow && selectedRow.successTime === row.successTime;
        const title = [
          formatFullTimestamp(row.view.lastSuccessAt),
          ntpStatusLabel(row.view),
          formatSignedNtpMs(row.view.offsetMs, 2),
          Number.isFinite(row.view.uncertaintyMs) ? `±${row.view.uncertaintyMs.toFixed(1)}ms` : '',
          row.view.source,
        ].filter(Boolean).join(' · ');
        return `<circle cx="${xOf(row.successTime).toFixed(2)}" cy="${yOf(row.view.offsetMs).toFixed(2)}" r="${selected ? 5.2 : 3.2}"
          fill="${colorFor(row.view.status)}" stroke="${selected ? '#f8fafc' : '#0f172a'}" stroke-width="${selected ? 2.2 : 0.8}">
          <title>${escapeSyncText(title)}</title>
        </circle>`;
      }).join('');
      const zeroY = yOf(0);
      chartEl.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="NTP reference history chart">
        ${band}
        ${correctionLines}
        ${outageLines}
        ${line}
        ${selectedLine}
        ${dots}
        <line x1="${left}" y1="${zeroY.toFixed(2)}" x2="${width - right}" y2="${zeroY.toFixed(2)}"
          stroke="rgba(148,163,184,0.72)" stroke-width="1.8"/>
      </svg>`;
    }

    function renderNtpDetailPanel(entry) {
      const el = getUi('ntp_detail_content');
      if (!el) return;
      const target = entry || (ntpDetailEntryAt
        ? syncAuditLog.find(item => item.at === ntpDetailEntryAt)
        : syncAuditLog[syncAuditLog.length - 1]);
      renderNtpHistoryChart(target && target.at);
      const view = ntpEntryView(target);
      if (!view) {
        el.innerHTML = '<div class="text-gray-500">NO NTP HEALTH DATA</div>';
        return;
      }
      const reasonLabel = (SYNC_REASON_META[target.reason] || {}).label
        || String(target.reason || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      const metaLine = `<div class="mb-3 text-[10px] text-gray-500 break-words">
        sync @${escapeSyncText(formatCompactTimestamp(target.at))} · ${escapeSyncText(reasonLabel)}
      </div>`;

      const metric = (label, value) => `<div class="min-w-0">
        <div class="text-[10px] uppercase tracking-wide text-gray-500">${escapeSyncText(label)}</div>
        <div class="mt-0.5 text-gray-300 break-words">${escapeSyncText(value)}</div>
      </div>`;
      const sourceLabel = view.source
        ? `${view.source}${view.fallback ? ' (fallback)' : ''}`
        : '—';
      const correction = view.correctionApplied && view.correctionMs !== null
        ? `${formatSignedNtpMs(view.correctionMs, 1)} applied`
        : 'not applied';
      const lastSuccess = view.lastSuccessAt ? formatFullTimestamp(view.lastSuccessAt) : '—';
      const errorBlock = view.error ? `<div class="mt-4 rounded-lg border border-red-900/60 bg-red-950/20 p-2">
        <div class="text-[10px] uppercase tracking-wide text-red-400">error</div>
        <div class="mt-1 whitespace-pre-wrap break-words text-gray-400">${escapeSyncText(view.error)}</div>
      </div>` : '';
      const sourcesBlock = view.sources.length ? `<div class="mt-4">
        <div class="mb-1 text-[10px] uppercase tracking-wide text-gray-500">sources</div>
        ${formatNtpSourceTable(view)}
      </div>` : '';

      el.innerHTML = `${metaLine}<div class="flex flex-wrap items-center gap-2">
        <span class="ntp-badge ntp-${view.status}">${ntpStatusLabel(view)}</span>
        <span class="text-gray-500">measured at last successful NTP sample</span>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        ${metric('source', sourceLabel)}
        ${metric('measured offset', view.offsetMs !== null ? formatSignedNtpMs(view.offsetMs, 2) : '—')}
        ${metric('uncertainty', view.uncertaintyMs !== null ? `±${view.uncertaintyMs.toFixed(1)} ms` : '—')}
        ${metric('rtt', view.rttMs !== null ? `${view.rttMs.toFixed(1)} ms` : '—')}
        ${metric('stratum', view.stratum !== null ? `${view.stratum}` : '—')}
        ${metric('sample age', view.ageS !== null ? `${formatNtpAge(view.ageS)} (${Math.round(view.ageS)}s)` : '—')}
        ${metric('correction', correction)}
        ${metric('last success', lastSuccess)}
      </div>
      ${errorBlock}
      ${sourcesBlock}`;
    }

    function openNtpDetailPanel(entry = null) {
      ntpDetailEntryAt = entry && entry.at ? entry.at : null;
      renderNtpDetailPanel(entry);
      getUi('ntp_detail_panel').classList.remove('hidden');
    }

    function closeNtpDetailPanel() {
      ntpDetailEntryAt = null;
      getUi('ntp_detail_panel').classList.add('hidden');
    }

    function ntpCorrectionParticipated(entry) {
      return !!(entry && entry.backendNtpCorrectionApplied === true);
    }

    function formatServoStatus(entry) {
      if (!entry) return '';
      const ppm = Number(entry.clockServoPpm);
      if (entry.clockServoState === 'stable' && Number.isFinite(ppm) && ppm !== 0) {
        return `TRIM ${ppm > 0 ? '+' : ''}${ppm.toFixed(2)}ppm`;
      }
      if (entry.clockServoState === 'unstable') return 'TRIM HOLD';
      return '';
    }

    function formatServoTitle(entry) {
      if (!entry) return '';
      if (entry.clockServoState === 'stable' && Number.isFinite(Number(entry.clockServoPpm))) {
        const applied = Number(entry.clockServoAppliedMs);
        const appliedText = Number.isFinite(applied) ? ` · applied ${applied.toFixed(2)}ms` : '';
        const points = Number(entry.clockServoPoints);
        const pointsText = Number.isFinite(points) ? ` · ${points} syncs` : '';
        return ` · TRIM ${Number(entry.clockServoPpm).toFixed(2)}ppm${appliedText}${pointsText}`;
      }
      if (entry.clockServoState === 'unstable') return ' · TRIM paused (unstable sync history)';
      return '';
    }

    function currentClockServoInfo() {
      if (typeof getClockServoState !== 'function') return null;
      const state = getClockServoState();
      if (!state || state.quality === 'idle') return null;
      return {
        clockServoState: state.quality,
        clockServoPpm: state.ppm,
        clockServoAppliedMs: state.appliedMs,
        clockServoPoints: state.points,
      };
    }

    function formatLastSyncStatus(entry, servoInfo) {
      if (!entry) return '';
      const stamp = formatCompactTimestamp(entry.at);
      if (!entry.ok) return `SYNC FAILED @${stamp}`;
      const metrics = `±${formatMetricMs(entry.uncertaintyMs)} Δ${formatMetricMs(entry.spreadMs)} ${entry.kept}/${entry.samples} RTT=${formatMetricMs(entry.rttMs, 0)}`;
      const ntp = ntpCorrectionParticipated(entry) ? formatNtpInline(entry) : '';
      const servo = formatServoStatus(servoInfo || entry);
      return `${metrics}${ntp ? ` ${ntp}` : ''}${servo ? ` ${servo}` : ''} @${stamp}`;
    }

    function renderLastSyncStatus() {
      const el = getUi('sync_error');
      if (!el) return;
      const last = syncAuditLog[syncAuditLog.length - 1];
      const view = ntpEntryView(last);
      const servoInfo = currentClockServoInfo();
      el.textContent = formatLastSyncStatus(last, servoInfo);
      el.classList.toggle('text-red-400', !!(last && !last.ok));
      const ntpTitle = last && ntpCorrectionParticipated(last) && view
        ? ` · ${formatNtpDetails(view)}`
        : '';
      const servoTitle = formatServoTitle(servoInfo);
      el.title = last
        ? `${last.ok ? 'Last successful sync' : 'Last sync failed'}${ntpTitle}${servoTitle}`
        : '';
      const panel = getUi('ntp_detail_panel');
      if (panel && !panel.classList.contains('hidden') && ntpDetailEntryAt === null) {
        renderNtpDetailPanel();
      }
    }

    function escapeSyncText(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[ch]));
    }

    function backendHealthAuditFields(health) {
      const h = health && typeof health === 'object' ? health : {};
      const numeric = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : '';
      return {
        backendNtpReachable: h.reachable === undefined ? '' : !!h.reachable,
        backendNtpSynchronized: h.synchronized === undefined ? '' : !!h.synchronized,
        backendNtpHoldover: h.holdover === undefined ? '' : !!h.holdover,
        backendNtpFallback: h.fallback === undefined ? '' : !!h.fallback,
        backendNtpOffsetOk: h.offset_ok === undefined ? '' : !!h.offset_ok,
        backendNtpQualityOk: h.quality_ok === undefined ? '' : !!h.quality_ok,
        backendNtpOffsetMs: numeric(h.offset_ms),
        backendNtpUncertaintyMs: numeric(h.uncertainty_ms),
        backendNtpRttMs: numeric(h.rtt_ms),
        backendNtpStratum: numeric(h.stratum),
        backendNtpLeap: numeric(h.leap),
        backendNtpAgeS: numeric(h.age_s),
        backendNtpSource: h.server || '',
        backendNtpResolvedIp: h.resolved_ip || '',
        backendNtpServers: Array.isArray(h.servers) ? JSON.stringify(h.servers) : '',
        backendNtpSources: Array.isArray(h.sources) ? JSON.stringify(h.sources) : '',
        backendNtpLastSuccessAt: h.last_success_at || '',
        backendNtpError: h.error || '',
      };
    }

    function backendCorrectionAuditFields(sample) {
      const s = sample && typeof sample === 'object' ? sample : {};
      const numeric = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : '';
      return {
        backendNtpCorrectionApplied: s.clockCorrectionApplied === true,
        backendNtpCorrectionMs: numeric(s.clockCorrectionMs),
        backendNtpCorrectionUncertaintyMs: numeric(s.clockCorrectionUncertaintyMs),
        backendNtpCorrectionEligible: s.clockCorrectionEligible === true,
        backendNtpCorrectionMode: s.clockCorrectionMode || '',
        backendNtpCorrectionSource: s.clockCorrectionSource || '',
        backendNtpCorrectionReason: s.clockCorrectionReason || '',
        backendNtpClockSource: s.clockSource || '',
      };
    }

    function recordSyncAudit(entry) {
      const now = Date.now();
      syncAuditLog.push({ at: new Date(now).toISOString(), ...entry });
      pruneSyncAudit(now);
      persistSyncAudit();
      renderLastSyncStatus();
      const panel = getUi('sync_log_panel');
      if (panel && !panel.classList.contains('hidden')) renderSyncAuditLog();
    }

    function renderSyncAuditSummary() {
      const summary = getUi('sync_audit_summary');
      if (!summary) return;
      if (!syncAuditLog.length) {
        summary.textContent = 'NO SYNC SAMPLES';
        return;
      }
      const okCount = syncAuditLog.filter(entry => entry.ok).length;
      const failCount = syncAuditLog.length - okCount;
      const span = Math.max(0, Date.parse(syncAuditLog[syncAuditLog.length - 1].at) - Date.parse(syncAuditLog[0].at));
      summary.textContent = `${syncAuditLog.length} SYNC · ${okCount} OK · ${failCount} ERR · ${formatTraceSpan(span)}`;
    }

    function renderSyncAuditLog() {
      renderSyncAuditSummary();
      const entriesEl = getUi('sync_log_entries');
      if (!entriesEl) return;
      if (!syncAuditLog.length) {
        entriesEl.innerHTML = '<div class="text-gray-500">∅</div>';
        return;
      }
      const head = `<thead><tr>
        <th class="c-state">STATE</th>
        <th class="c-mark center">OK</th>
        <th class="c-timestamp">STARTED</th>
        <th class="c-server">SERVER</th>
        <th class="c-offset num">BEFORE</th>
        <th class="c-arrow"></th>
        <th class="c-offset num">AFTER</th>
        <th class="c-metric num">±</th>
        <th class="c-metric num">Δ</th>
        <th class="c-metric num">RTT</th>
        <th class="c-metric num">SAMPLES</th>
        <th class="c-duration num">TOOK</th>
        <th class="c-ntp">NTP</th>
      </tr></thead>`;
      const rows = syncAuditLog.slice().reverse().map(entry => {
        const meta = SYNC_REASON_META[entry.reason] || {
          icon: '❔',
          label: String(entry.reason || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        };
        const fullStamp = escapeSyncText(formatFullTimestamp(entry.at));
        const stamp = escapeSyncText(formatAuditTimestamp(entry.at));
        const before = formatSignedOffsetSeconds(entry.offsetBeforeMs);
        const after = formatSignedOffsetSeconds(entry.offsetMs);
        const uncertainty = entry.ok ? formatMetricMs(entry.uncertaintyMs) : '—';
        const spread = entry.ok ? formatMetricMs(entry.spreadMs) : '—';
        const rtt = entry.ok ? formatMetricMs(entry.rttMs, 0) : '—';
        const samples = entry.ok ? `${entry.kept}/${entry.samples}` : `${entry.samples ?? 0}/${SYNC_SAMPLE_COUNT}`;
        const duration = formatDurationSeconds(entry.durationMs);
        const fullServer = entry.ok ? escapeSyncText(formatFullTimestamp(entry.serverTime)) : '';
        const server = entry.ok ? escapeSyncText(formatAuditTimestamp(entry.serverTime)) : '—';
        const ntpView = ntpEntryView(entry);
        const ntpPair = formatNtpOffsetPair(ntpView);
        const ntpCell = ntpView
          ? `<span class="ntp-entry-detail">
               <span class="ntp-badge ntp-${ntpView.status}">${ntpStatusLabel(ntpView)}</span>
               ${ntpPair ? `<span class="ntp-entry-meta">${ntpPair}</span>` : ''}
             </span>`
          : '—';
        const ntpCellAttrs = ntpView
          ? ` class="c-ntp ntp-entry-cell" data-label="NTP" data-ntp-at="${escapeSyncText(entry.at)}" role="button" tabindex="0" title="${escapeSyncText(formatNtpDetails(ntpView))}"`
          : ' class="c-ntp" data-label="NTP"';
        const rowTitle = entry.ok ? '' : ` title="ERROR: ${escapeSyncText(entry.error || 'sync failed')}"`;
        return `<tr${rowTitle}>
          <td class="c-state" data-label="STATE">${meta.icon} ${escapeSyncText(meta.label)}</td>
          <td class="c-mark center ${entry.ok ? 'mark-ok' : 'mark-fail'}" data-label="OK">${entry.ok ? '✓' : '✗'}</td>
          <td class="c-timestamp" data-label="STARTED" title="${fullStamp}">${stamp}</td>
          <td class="c-server" data-label="SERVER" title="${fullServer}">${server}</td>
          <td class="c-offset c-before num" data-label="BEFORE">${before}</td>
          <td class="c-arrow">→</td>
          <td class="c-offset c-after num" data-label="AFTER">${after}</td>
          <td class="c-metric num" data-label="±">${uncertainty}</td>
          <td class="c-metric num" data-label="Δ">${spread}</td>
          <td class="c-metric num" data-label="RTT">${rtt}</td>
          <td class="c-metric num" data-label="SAMPLES">${samples}</td>
          <td class="c-duration num" data-label="TOOK">${duration}</td>
          <td${ntpCellAttrs}>${ntpCell}</td>
        </tr>`;
      }).join('');
      entriesEl.innerHTML = `<table class="sync-log-table">${head}<tbody>${rows}</tbody></table>`;
    }

    function openSyncAuditLog() {
      pruneSyncAudit();
      renderLastSyncStatus();
      renderSyncAuditLog();
      setAuditTab(activeAuditTab);
      getUi('sync_log_panel').classList.remove('hidden');
    }

    function closeSyncAuditLog() {
      getUi('sync_log_panel').classList.add('hidden');
    }

    function clearSyncAuditLog() {
      if (!syncAuditLog.length) return;
      if (!window.confirm('Clear sync audit?')) return;
      syncAuditLog.length = 0;
      try { localStorage.removeItem(SYNC_AUDIT_STORAGE_KEY); } catch (e) { }
      renderLastSyncStatus();
      renderSyncAuditLog();
    }

    function csvAuditValue(value) {
      return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    const SIMPLE_SYNC_HEADERS = [
      'at', 'reason', 'ok', 'offsetBeforeMs', 'offsetMs',
      'uncertaintyMs', 'rttMs', 'spreadMs', 'kept', 'samples', 'durationMs',
      'backendNtpSource', 'backendNtpFallback', 'backendNtpCorrectionApplied',
      'backendNtpCorrectionReason',
    ];
    const SIMPLE_COMBINED_HEADERS = [
      'kind', 'at', 'rawAt', 'monoMs', 'offsetBeforeMs', 'offsetMs', 'reason', 'ok',
      'uncertaintyMs', 'rttMs', 'spreadMs', 'kept', 'samples', 'durationMs',
      'visibility', 'session', 'deviceProfile', 'audioTimelineDeltaMs',
      'audioContextSession', 'audioSkewPpm', 'reanchorReason', 'calibrationSteps',
      'networkCompMs', 'deviceExtraMs', 'backendNtpSource', 'backendNtpFallback',
      'backendNtpCorrectionApplied', 'backendNtpCorrectionReason',
    ];

    function exportSyncAuditCsv(options = {}) {
      const simple = options && options.simple === true;
      const headers = simple ? SIMPLE_SYNC_HEADERS : [
        'at', 'reason', 'ok', 'offsetBeforeMs', 'offsetMs',
        'uncertaintyMs', 'rttMs', 'spreadMs', 'samples', 'kept',
        'durationMs', 'serverTime', 'error',
        'backendNtpReachable', 'backendNtpSynchronized', 'backendNtpHoldover',
        'backendNtpFallback', 'backendNtpAgeS', 'backendNtpSource', 'backendNtpError',
        'backendNtpLastSuccessAt',
        'backendNtpCorrectionApplied', 'backendNtpCorrectionMs',
        'backendNtpOffsetOk', 'backendNtpQualityOk', 'backendNtpOffsetMs',
        'backendNtpUncertaintyMs', 'backendNtpRttMs', 'backendNtpStratum', 'backendNtpLeap',
        'backendNtpResolvedIp', 'backendNtpServers', 'backendNtpSources',
        'backendNtpCorrectionUncertaintyMs', 'backendNtpCorrectionEligible',
        'backendNtpCorrectionMode', 'backendNtpCorrectionSource',
        'backendNtpCorrectionReason', 'backendNtpClockSource',
      ];
      const cutoff = getLogNowMs() - (simple ? SIMPLE_EXPORT_WINDOW_MS : LOG_EXPORT_WINDOW_MS);
      const entries = syncAuditLog.filter((entry) => {
        const timestamp = Date.parse(entry.at);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      });
      const lines = [headers.join(',')];
      for (const entry of entries) {
        lines.push(headers.map(key => csvAuditValue(entry[key])).join(','));
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const lastEntry = entries[entries.length - 1] || syncAuditLog[syncAuditLog.length - 1];
      const stamp = lastEntry ? formatCompactTimestamp(lastEntry.at) : '';
      link.download = simple
        ? (stamp && stamp !== '—' ? `bpm-sync-audit-simple-6h-${stamp}.csv` : 'bpm-sync-audit-simple-6h.csv')
        : (stamp && stamp !== '—' ? `bpm-sync-audit-24h-${stamp}.csv` : 'bpm-sync-audit-24h.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportCombinedSimpleCsv() {
      const cutoff = getLogNowMs() - SIMPLE_EXPORT_WINDOW_MS;
      const rows = [];
      for (const entry of syncAuditLog) {
        const timestamp = Date.parse(entry.at);
        if (Number.isFinite(timestamp) && timestamp >= cutoff) rows.push({ kind: 'sync', at: entry.at, entry });
      }
      for (const entry of clockTraceLog) {
        const timestamp = Date.parse(entry.at);
        if (Number.isFinite(timestamp) && timestamp >= cutoff) rows.push({ kind: 'trace', at: entry.at, entry });
      }
      rows.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.kind === 'sync' ? -1 : 1));
      const lines = [SIMPLE_COMBINED_HEADERS.join(',')];
      for (const row of rows) {
        const values = SIMPLE_COMBINED_HEADERS.map(key => {
          if (key === 'kind') return row.kind;
          return row.entry[key];
        });
        lines.push(values.map(value => csvAuditValue(value)).join(','));
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const lastEntry = rows[rows.length - 1];
      const stamp = lastEntry ? formatCompactTimestamp(lastEntry.at) : '';
      link.download = stamp && stamp !== '—'
        ? `bpm-combined-simple-6h-${stamp}.csv`
        : 'bpm-combined-simple-6h.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportActivePromptCsv() {
      if (activePromptSet === 'trace') exportClockTraceCsv({ simple: true });
      else exportSyncAuditCsv({ simple: true });
    }

    let activePromptLang = 'zh';
    let activePromptSet = 'sync';

    function activePromptList() {
      return activePromptSet === 'trace' ? TRACE_ONLY_PROMPTS : SYNC_ONLY_PROMPTS;
    }

    function updatePromptTabs() {
      ['zh', 'en'].forEach(lang => {
        const button = getUi(`sync_prompt_tab_${lang}`);
        if (!button) return;
        const active = activePromptLang === lang;
        button.classList.toggle('bg-blue-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('bg-dark-700', !active);
        button.classList.toggle('text-gray-300', !active);
      });
    }

    function renderSyncPrompts() {
      const entriesEl = getUi('sync_prompt_entries');
      if (!entriesEl) return;
      const isZh = activePromptLang === 'zh';
      const copyLabel = isZh ? '📋 复制' : '📋 COPY';
      entriesEl.innerHTML = activePromptList().map((prompt, index) => `
        <div class="border border-dark-700 rounded-lg p-2 sm:p-3">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span class="text-sm text-gray-300">${escapeSyncText(isZh ? prompt.titleZh : prompt.title)}</span>
            <button type="button" data-prompt-copy="${index}"
              class="px-2 py-1 bg-dark-700 rounded hover:bg-dark-600 transition shrink-0">${copyLabel}</button>
          </div>
          <pre class="whitespace-pre-wrap break-words font-mono text-[10px] sm:text-xs leading-relaxed text-gray-400">${escapeSyncText(isZh ? prompt.bodyZh : prompt.bodyEn)}</pre>
        </div>`).join('');
      updatePromptTabs();
    }

    function setPromptLang(lang) {
      activePromptLang = lang === 'en' ? 'en' : 'zh';
      renderSyncPrompts();
    }

    function openSyncPromptPanel(promptSet = 'sync') {
      activePromptSet = promptSet === 'trace' ? 'trace' : 'sync';
      renderSyncPrompts();
      getUi('sync_prompt_panel').classList.remove('hidden');
    }

    function closeSyncPromptPanel() {
      getUi('sync_prompt_panel').classList.add('hidden');
    }

    function copyTextFallback(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      textarea.remove();
      return ok;
    }

    async function copyPrompt(index, button) {
      const prompt = activePromptList()[index];
      if (!prompt) return;
      const text = activePromptLang === 'zh' ? prompt.bodyZh : prompt.bodyEn;
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else {
          ok = copyTextFallback(text);
        }
      } catch (e) {
        ok = copyTextFallback(text);
      }
      button.textContent = ok ? '✓' : '✕';
      setTimeout(() => {
        button.textContent = activePromptLang === 'zh' ? '📋 复制' : '📋 COPY';
      }, 1200);
    }

    let activeCombinedLang = 'zh';

    function updateCombinedPromptTabs() {
      ['zh', 'en'].forEach(lang => {
        const button = getUi(`combined_prompt_tab_${lang}`);
        if (!button) return;
        const active = activeCombinedLang === lang;
        button.classList.toggle('bg-blue-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('bg-dark-700', !active);
        button.classList.toggle('text-gray-300', !active);
      });
    }

    function renderCombinedPrompt() {
      const entriesEl = getUi('combined_prompt_entries');
      if (!entriesEl) return;
      const isZh = activeCombinedLang === 'zh';
      const copyLabel = isZh ? '📋 复制' : '📋 COPY';
      entriesEl.innerHTML = CLOCK_ANALYSIS_PROMPTS.map((prompt, index) => `
        <div class="border border-dark-700 rounded-lg p-2 sm:p-3">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span class="text-sm text-gray-300">${escapeSyncText(isZh ? prompt.titleZh : prompt.title)}</span>
            <button type="button" data-combined-copy="${index}"
              class="px-2 py-1 bg-dark-700 rounded hover:bg-dark-600 transition shrink-0">${copyLabel}</button>
          </div>
          <pre class="whitespace-pre-wrap break-words font-mono text-[10px] sm:text-xs leading-relaxed text-gray-400">${escapeSyncText(isZh ? prompt.bodyZh : prompt.bodyEn)}</pre>
        </div>`).join('');
      updateCombinedPromptTabs();
    }

    function openCombinedPromptPanel() {
      renderCombinedPrompt();
      getUi('combined_prompt_panel').classList.remove('hidden');
    }

    function closeCombinedPromptPanel() {
      getUi('combined_prompt_panel').classList.add('hidden');
    }

    function setCombinedPromptLang(lang) {
      activeCombinedLang = lang === 'en' ? 'en' : 'zh';
      renderCombinedPrompt();
    }

    async function copyCombinedPrompt(index, button) {
      const prompt = CLOCK_ANALYSIS_PROMPTS[index];
      if (!prompt) return;
      const text = activeCombinedLang === 'zh' ? prompt.bodyZh : prompt.bodyEn;
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else {
          ok = copyTextFallback(text);
        }
      } catch (e) {
        ok = copyTextFallback(text);
      }
      button.textContent = ok ? '✓' : '✕';
      setTimeout(() => {
        button.textContent = activeCombinedLang === 'zh' ? '📋 复制' : '📋 COPY';
      }, 1200);
    }

