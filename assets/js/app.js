/* =========================================================
   AquaSense – UI controller
   ========================================================= */
(function () {
  const C = window.AQ_CONFIG;
  const { Store, Sensors, STEP, DAY, TZ, rainOfDay, localDayIndex } = window.AQData;
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = n => String(n).padStart(2, '0');

  // ---------- time formatting (always station local time, GMT+7) ----------
  const L = t => new Date(t + TZ); // use getUTC* on the result
  const fmtHM = t => { const d = L(t); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
  const fmtHMS = t => { const d = L(t); return `${fmtHM(t)}:${pad2(d.getUTCSeconds())}`; };
  const fmtDM = t => { const d = L(t); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`; };
  const fmtDMY = t => { const d = L(t); return `${fmtDM(t)}/${d.getUTCFullYear()}`; };
  const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const fmtInt = v => Math.round(v).toLocaleString('vi-VN');
  const fx = (v, d, unit = '') => v == null ? '—' : v.toFixed(d) + unit;
  function fmtDur(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m} phút`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} giờ ${m % 60} phút`;
    return `${Math.floor(h / 24)} ngày ${h % 24} giờ`;
  }
  const SENSOR_NAME = { ph: 'pH', sal: 'độ mặn' };

  // ---------- metric metadata ----------
  const METRIC = {
    ph:   { label: 'pH',        unit: 'pH', unitShort: '',   dec: 2, series: '--series-ph' },
    sal:  { label: 'Độ mặn',    unit: '‰',  unitShort: '‰',  dec: 2, series: '--series-sal' },
    temp: { label: 'Nhiệt độ',  unit: '°C', unitShort: '°C', dec: 1, series: '--series-temp' }
  };
  const LEVEL = {
    good:     { label: 'Tối ưu',    icon: '✓', color: '--good',     rank: 0 },
    warn:     { label: 'Cảnh báo',  icon: '!', color: '--warn',     rank: 1 },
    critical: { label: 'Nguy hiểm', icon: '✕', color: '--critical', rank: 2 },
    info:     { label: 'Thông tin', icon: 'i', color: '--text-3',   rank: -1 },
    offline:  { label: 'Ngoại tuyến', icon: '–', color: '--text-3', rank: -2 }
  };

  function classify(metric, v) {
    if (v == null) return 'offline';
    const th = C.thresholds[metric];
    if (v >= th.optimal[0] && v <= th.optimal[1]) return 'good';
    if (v >= th.acceptable[0] && v <= th.acceptable[1]) return 'warn';
    return 'critical';
  }
  // 0–100 sub-index for the WQI
  function subScore(metric, v) {
    const th = C.thresholds[metric];
    const [o0, o1] = th.optimal, [a0, a1] = th.acceptable;
    const c = (o0 + o1) / 2, hw = (o1 - o0) / 2;
    if (v >= o0 && v <= o1) return 100 - 14 * Math.pow(Math.abs(v - c) / hw, 2);
    if (v < o0) return v >= a0 ? 86 - 36 * (o0 - v) / (o0 - a0) : Math.max(0, 50 - 50 * (a0 - v) / (o0 - a0));
    return v <= a1 ? 86 - 36 * (v - o1) / (a1 - o1) : Math.max(0, 50 - 50 * (v - a1) / (a1 - o1));
  }
  // WQI from the sensors that are reporting (weights re-normalised); null when nothing reports
  function wqiOf(s) {
    const parts = [['ph', .45], ['sal', .4], ['temp', .15]].filter(([m]) => s[m] != null);
    if (!parts.length) return null;
    const w = parts.reduce((a, [, x]) => a + x, 0);
    return Math.round(parts.reduce((a, [m, x]) => a + x * subScore(m, s[m]), 0) / w);
  }

  // ---------- data-driven colours ----------
  const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb2hex = a => '#' + a.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  function ramp(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
        const k = (v - v0) / (v1 - v0), a = hex2rgb(c0), b = hex2rgb(c1);
        return rgb2hex(a.map((x, j) => x + (b[j] - x) * k));
      }
    }
    return stops[stops.length - 1][1];
  }
  // pH indicator-like scale (acid → neutral → alkaline)
  // muted, print-like indicator colours (no neon)
  const PH_STOPS = [[0, '#b8342b'], [3, '#c8612a'], [5, '#c49a2c'], [6.3, '#8ea23f'], [7, '#4a9460'], [7.8, '#1f8f86'], [8.6, '#2b6fae'], [10, '#34539c'], [12, '#3b4387'], [14, '#3a3573']];
  const SAL_STOPS = [[0, '#9cc7d1'], [8, '#55a3b6'], [18, '#1f7fa6'], [30, '#1d5a8f'], [40, '#1b3f6e']];
  const phColor = v => ramp(PH_STOPS, v);
  const salColor = v => ramp(SAL_STOPS, v);

  // ---------- animation helpers ----------
  // tween keyed by owner object: a newer tween on the same owner cancels the older one
  function tween(from, to, dur, fn, owner) {
    const s = performance.now();
    const id = owner ? (owner._tw = (owner._tw || 0) + 1) : 0;
    const step = n => {
      if (owner && owner._tw !== id) return;
      // rAF timestamps can be slightly earlier than `s` → clamp, otherwise the ease overshoots
      const k = clamp((n - s) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      fn(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // guarantee the final value even if rAF is throttled (background tab, low-power mode)
    setTimeout(() => { if (!owner || owner._tw === id) fn(to); }, dur + 250);
  }
  function countTo(el, to, dec, dur = 1100) {
    const from = el._shown ?? (to * .6);
    el._v = to;
    tween(from, to, dur, v => { el._shown = v; el.textContent = v.toFixed(dec); }, el);
  }
  function setBadge(el, level, text) {
    const L0 = LEVEL[level];
    el.style.setProperty('--badge', `var(${L0.color})`);
    el.querySelector('.status-icon').textContent = L0.icon;
    el.querySelector('.status-text').textContent = text ?? L0.label;
  }

  // =========================================================
  // GAUGES (custom SVG)
  // =========================================================
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent && parent.appendChild(n);
    return n;
  }
  function makeGauge(host, { metric, colorFn, ticks, minor, label }) {
    const th = C.thresholds[metric];
    const [min, max] = th.scale;
    const cx = 120, cy = 118, r = 88, A0 = 150, SWEEP = 240;
    const ang = v => (A0 + (clamp(v, min, max) - min) / (max - min) * SWEEP) * Math.PI / 180;
    const pt = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    const arcD = (v0, v1, rr) => {
      const a0 = ang(v0), a1 = ang(v1), [x0, y0] = pt(a0, rr), [x1, y1] = pt(a1, rr);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rr} ${rr} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const svg = svgEl('svg', { viewBox: '0 0 240 196', role: 'img', 'aria-label': `Đồng hồ ${label}` }, host);

    // status zones ring (outer, thin)
    const zones = [
      [min, th.acceptable[0], 'critical'], [th.acceptable[0], th.optimal[0], 'warn'],
      [th.optimal[0], th.optimal[1], 'good'], [th.optimal[1], th.acceptable[1], 'warn'], [th.acceptable[1], max, 'critical']
    ];
    zones.forEach(([a, b, lv]) => {
      if (b <= a) return;
      svgEl('path', { d: arcD(a, b, r + 13), fill: 'none', stroke: `var(${LEVEL[lv].color})`, 'stroke-width': 3.5, opacity: lv === 'good' ? 1 : .75 }, svg);
    });
    // colour-scale track (segments)
    const N = 60;
    const segs = [];
    for (let i = 0; i < N; i++) {
      const v0 = min + (max - min) * i / N, v1 = min + (max - min) * (i + 1) / N;
      segs.push(svgEl('path', { d: arcD(v0, v1 + (max - min) * .002, r), fill: 'none', stroke: colorFn((v0 + v1) / 2), 'stroke-width': 14, opacity: .18 }, svg));
    }
    // minor ticks
    for (let v = min; v <= max + 1e-9; v += minor) {
      const a = ang(v), [x0, y0] = pt(a, r - 12), [x1, y1] = pt(a, r - 14.5);
      svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'var(--text-3)', 'stroke-width': 1, opacity: .6 }, svg);
    }
    // major ticks
    ticks.forEach(v => {
      const a = ang(v), [x0, y0] = pt(a, r - 12), [x1, y1] = pt(a, r - 17), [tx, ty] = pt(a, r - 29);
      svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'var(--text-3)', 'stroke-width': 1.4 }, svg);
      const t = svgEl('text', { x: tx, y: ty + 3.5, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-3)', 'font-family': 'IBM Plex Mono, monospace' }, svg);
      t.textContent = v;
    });
    // optimal label
    const [lx, ly] = pt(ang((th.optimal[0] + th.optimal[1]) / 2), r + 24);
    const ol = svgEl('text', { x: lx, y: ly + 3, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 600, fill: 'var(--good)' }, svg);
    ol.textContent = 'Tối ưu';

    // needle
    const needle = svgEl('g', {}, svg);
    svgEl('path', { d: `M${cx - 4} ${cy} L${cx} ${cy - r + 20} L${cx + 4} ${cy} Z`, fill: 'var(--text)' }, needle);
    svgEl('circle', { cx, cy, r: 9, fill: 'var(--surface-solid)', stroke: 'var(--text)', 'stroke-width': 2.5 }, svg);
    const hub = svgEl('circle', { cx, cy, r: 4, fill: colorFn(min) }, svg);
    const cap = svgEl('text', { x: cx, y: cy + 56, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-2)', 'font-weight': 600 }, svg);
    cap.textContent = label;
    const minmax = svgEl('text', { x: cx, y: cy + 72, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--text-3)', 'font-family': 'IBM Plex Mono, monospace' }, svg);

    let cur = min;
    const owner = {};
    const draw = (x, off) => {
      cur = x;
      const deg = A0 + (clamp(x, min, max) - min) / (max - min) * SWEEP + 90;
      needle.setAttribute('transform', `rotate(${deg.toFixed(2)} ${cx} ${cy})`);
      hub.setAttribute('fill', off ? 'var(--text-3)' : colorFn(x));
      segs.forEach((s, i) => s.setAttribute('opacity', !off && (min + (max - min) * (i + .5) / N) <= x ? .95 : .16));
    };
    const range = (lo, hi) => {
      const d = metric === 'ph' ? 2 : 1;
      minmax.textContent = lo != null ? `24h: ${lo.toFixed(d)} – ${hi.toFixed(d)}` : '24h: —';
    };
    return {
      set(v, lo, hi) {
        range(lo, hi);
        tween(cur, v, 1400, x => draw(x, false), owner);
      },
      off(lo, hi) {           // sensor offline: needle drops to zero, scale greys out
        range(lo, hi);
        tween(cur, min, 900, x => draw(x, true), owner);
      }
    };
  }

  // =========================================================
  // CHARTS (ECharts)
  // =========================================================
  const charts = {};
  const X = t => t + TZ; // shift so ECharts (useUTC) shows station local time
  function chart(id) {
    if (!charts[id]) charts[id] = echarts.init($(id), null, { renderer: 'canvas' });
    return charts[id];
  }
  function alpha(hex, a) { const [r, g, b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function theme() {
    return {
      text: css('--text'), text2: css('--text-2'), text3: css('--text-3'), grid: css('--grid'),
      border: css('--border-strong'), surface: css('--surface-solid'),
      good: css('--good'), warn: css('--warn'), critical: css('--critical'),
      ph: css('--series-ph'), sal: css('--series-sal'), temp: css('--series-temp')
    };
  }
  function tooltipBase(T) {
    return {
      trigger: 'axis', confine: true,
      backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, padding: [8, 12],
      textStyle: { color: T.text, fontFamily: 'IBM Plex Sans', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: T.text3, type: 'dashed' } },
      extraCssText: 'border-radius:8px;box-shadow:0 12px 32px -12px rgba(21,32,43,.3);'
    };
  }
  const timeLabel = { year: '{yyyy}', month: 'T{M}/{yyyy}', day: '{dd}/{MM}', hour: '{HH}:{mm}', minute: '{HH}:{mm}' };
  function axes(T, yMin, yMax, dec) {
    return {
      xAxis: { type: 'time', axisLine: { lineStyle: { color: T.border } }, axisTick: { show: false },
        axisLabel: { color: T.text3, hideOverlap: true, formatter: timeLabel, fontSize: 11, fontFamily: 'IBM Plex Sans' }, splitLine: { show: false } },
      yAxis: { type: 'value', min: yMin, max: yMax, splitNumber: 4,
        axisLabel: { color: T.text3, fontSize: 11, fontFamily: 'IBM Plex Sans', formatter: v => v.toFixed(dec) },
        splitLine: { lineStyle: { color: T.grid } } }
    };
  }
  function niceRange(values, metric, padFrac = .18) {
    values = values.filter(v => v != null);
    if (!values.length) values = [...C.thresholds[metric].optimal];
    let lo = Math.min(...values), hi = Math.max(...values);
    const minSpan = { ph: .5, sal: 2, temp: 2 }[metric];
    if (hi - lo < minSpan) { const m = (lo + hi) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
    const p = (hi - lo) * padFrac;
    const step = { ph: .1, sal: .5, temp: .5 }[metric];
    return [Math.floor((lo - p) / step) * step, Math.ceil((hi + p) / step) * step];
  }
  function bandAreas(metric, yMin, yMax, T) {
    const th = C.thresholds[metric];
    const out = [];
    const add = (a, b, color, name) => {
      const lo = clamp(a, yMin, yMax), hi = clamp(b, yMin, yMax);
      if (hi > lo) out.push([{ yAxis: lo, itemStyle: { color }, name }, { yAxis: hi }]);
    };
    add(th.optimal[0], th.optimal[1], alpha(T.good, .09));
    add(-1e9, th.acceptable[0], alpha(T.critical, .07));
    add(th.acceptable[1], 1e9, alpha(T.critical, .07));
    return out;
  }
  function thresholdLines(metric, yMin, yMax, T) {
    const th = C.thresholds[metric];
    return [...th.optimal].filter(v => v > yMin && v < yMax).map(v => ({
      yAxis: v, lineStyle: { color: alpha(T.good, .7), type: 'dashed', width: 1 },
      label: { formatter: String(v), color: T.text3, fontSize: 10, position: 'insideEndTop' }
    }));
  }
  function gradientArea(color) {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: alpha(color, .16) }, { offset: 1, color: alpha(color, 0) }]);
  }

  let rtHours = 24;
  function renderRealtime() {
    const T = theme();
    const pts = Store.since(rtHours * 3600000);
    const rains = rainsBetween(pts[0].t, pts[pts.length - 1].t);
    [['rtPh', 'ph'], ['rtSal', 'sal'], ['rtTemp', 'temp']].forEach(([id, m]) => {
      const vals = pts.map(s => s[m]);
      const [y0, y1] = niceRange(vals, m);
      const color = T[m];
      const marks = bandAreas(m, y0, y1, T);
      rains.forEach(r => marks.push([{ xAxis: X(Math.max(r.start, pts[0].t)), itemStyle: { color: alpha(T.text3, .12) }, label: { show: true, formatter: 'Mưa', color: T.text3, fontSize: 10, position: 'insideTop' } }, { xAxis: X(Math.min(r.end, pts[pts.length - 1].t)) }]));
      offlineSpans(m, pts[0].t, Date.now()).forEach(([a, b]) => marks.push([{ xAxis: X(a), itemStyle: { color: alpha(T.critical, .1) }, label: { show: true, formatter: 'Ngoại tuyến', color: T.critical, fontSize: 10, position: 'insideTop' } }, { xAxis: X(b) }]));
      const lastPt = [...pts].reverse().find(s => s[m] != null);
      chart(id).setOption({
        useUTC: true, animationDuration: 900,
        grid: { left: 46, right: 18, top: 14, bottom: 26 },
        tooltip: { ...tooltipBase(T), formatter: p => {
          const s = Store.at(p[0].value[0] - TZ);
          const head = `<div style="font-size:11px;opacity:.7">${WEEKDAYS[L(s.t).getUTCDay()]}, ${fmtHM(s.t)} · ${fmtDMY(s.t)}</div>`;
          if (s[m] == null) return head + '<div style="margin-top:4px;opacity:.8">Không có dữ liệu · cảm biến ngoại tuyến</div>';
          const lv = classify(m, s[m]);
          return `${head}
            <div style="margin-top:4px"><b style="font-variant-numeric:tabular-nums;font-size:15px">${s[m].toFixed(METRIC[m].dec)}</b> ${METRIC[m].unit}
            <span style="margin-left:8px;color:${T[lv === 'good' ? 'good' : lv]};font-weight:700">${LEVEL[lv].icon} ${LEVEL[lv].label}</span></div>
            ${s.rain ? '<div style="font-size:11px;opacity:.7;margin-top:2px">Đang có mưa</div>' : ''}`;
        } },
        ...axes(T, y0, y1, m === 'ph' ? 1 : 1),
        series: [{
          type: 'line', name: METRIC[m].label, showSymbol: false, smooth: .2, sampling: 'lttb',
          data: pts.map(s => [X(s.t), s[m]]),
          lineStyle: { width: 2, color }, itemStyle: { color }, areaStyle: { color: gradientArea(color) },
          markArea: { silent: true, data: marks },
          markLine: { silent: true, symbol: 'none', data: thresholdLines(m, y0, y1, T) },
          markPoint: { symbol: 'circle', symbolSize: 9, itemStyle: { color, borderColor: T.surface, borderWidth: 2 },
            label: { show: false }, data: lastPt ? [{ coord: [X(lastPt.t), lastPt[m]] }] : [],
            animation: true }
        }]
      }, true);
    });
  }
  // offline intervals affecting a metric, clipped to [t0, t1]
  function offlineSpans(m, t0, t1) {
    const keys = m === 'temp' ? [] : [m];   // temperature keeps coming from the other probe
    const out = [];
    keys.forEach(k => Sensors.intervals[k].forEach(([a, b]) => {
      const end = b == null ? t1 : b;
      if (end > a && end > t0 && a < t1) out.push([Math.max(a, t0), Math.min(end, t1)]);
    }));
    return out;
  }
  function rainsBetween(t0, t1) {
    const out = [];
    for (let d = localDayIndex(t0) - 1; d <= localDayIndex(t1); d++) {
      const ev = rainOfDay(d);
      if (ev && ev.start + ev.duration > t0 && ev.start < t1) out.push({ start: ev.start, end: ev.start + ev.duration, intensity: ev.intensity });
    }
    return out;
  }

  function renderSparks() {
    const T = theme();
    const pts = Store.since(DAY);
    [['sparkPh', 'ph'], ['sparkSal', 'sal']].forEach(([id, m]) => {
      const color = T[m];
      const vals = pts.map(s => s[m]);
      const [y0, y1] = niceRange(vals, m, .1);
      chart(id).setOption({
        useUTC: true, animationDuration: 900,
        grid: { left: 0, right: 0, top: 6, bottom: 0 },
        tooltip: { ...tooltipBase(T), formatter: p => `${fmtHM(p[0].value[0] - TZ)} · ${p[0].value[1] == null ? 'không có dữ liệu' : `<b style="font-family:JetBrains Mono">${p[0].value[1].toFixed(METRIC[m].dec)}</b> ${METRIC[m].unit}`}` },
        xAxis: { type: 'time', show: false }, yAxis: { type: 'value', show: false, min: y0, max: y1 },
        series: [{ type: 'line', showSymbol: false, smooth: .3, data: pts.map(s => [X(s.t), s[m]]),
          lineStyle: { width: 2, color }, areaStyle: { color: gradientArea(color) } }]
      }, true);
    });
  }

  // ---------- History ----------
  let histMetric = 'ph', histDays = 30;
  const BUCKET = { 7: 3600000, 30: 3 * 3600000, 90: 12 * 3600000, 180: DAY };
  function renderHistory() {
    const T = theme();
    const m = histMetric, meta = METRIC[m];
    const ms = histDays * DAY;
    const agg = Store.aggregate(ms, BUCKET[histDays]);
    const raw = Store.since(ms);
    const color = T[m];

    // KPIs from raw 5-minute data
    let sum = 0, n = 0, mn = Infinity, mx = -Infinity, tmn = 0, tmx = 0, good = 0;
    const dayMap = new Set();
    raw.forEach(s => {
      const v = s[m]; if (v == null) return;
      sum += v; n++;
      if (v < mn) { mn = v; tmn = s.t; } if (v > mx) { mx = v; tmx = s.t; }
      if (classify(m, v) === 'good') good++; else dayMap.add(localDayIndex(s.t));
    });
    const dayCount = new Set(raw.map(s => localDayIndex(s.t))).size;
    const missing = raw.length - n;
    $('histKpis').innerHTML = (n ? [
      ['Trung bình', (sum / n).toFixed(meta.dec), meta.unit],
      ['Thấp nhất', mn.toFixed(meta.dec), `${fmtHM(tmn)} · ${fmtDM(tmn)}`],
      ['Cao nhất', mx.toFixed(meta.dec), `${fmtHM(tmx)} · ${fmtDM(tmx)}`],
      ['Thời gian đạt tối ưu', (good / n * 100).toFixed(1) + '%', `${fmtInt(n)} bản ghi${missing ? ` · thiếu ${fmtInt(missing)}` : ''}`],
      ['Ngày có cảnh báo', `${dayMap.size}`, `/ ${dayCount} ngày`]
    ] : [['Trung bình', '—', ''], ['Thấp nhất', '—', ''], ['Cao nhất', '—', ''], ['Thời gian đạt tối ưu', '—', 'không có dữ liệu'], ['Ngày có cảnh báo', '—', '']])
      .map(([k, v, s]) => `<div class="kpi"><span>${k}</span><b>${v}</b> <small>${s}</small></div>`).join('');

    const allVals = agg.flatMap(a => [a[m].min, a[m].max]);
    const [y0, y1] = niceRange(allVals, m, .08);
    const fmtB = histDays >= 180 ? (t => fmtDMY(t)) : (t => `${fmtHM(t)} · ${fmtDM(t)}`);
    chart('histChart').setOption({
      useUTC: true, animationDuration: 1000,
      grid: { left: 48, right: 18, top: 16, bottom: 74 },
      tooltip: { ...tooltipBase(T), formatter: p => {
        const a = agg[p[0].dataIndex]; if (!a) return '';
        if (a[m].avg == null) return `<div style="font-size:11px;opacity:.7">${fmtB(a.t)}</div><div style="margin-top:4px;opacity:.8">Không có dữ liệu · cảm biến ngoại tuyến</div>`;
        const lv = classify(m, a[m].avg);
        return `<div style="font-size:11px;opacity:.7">${fmtB(a.t)}</div>
          <div style="margin-top:4px">TB <b style="font-variant-numeric:tabular-nums;font-size:15px">${a[m].avg.toFixed(meta.dec)}</b> ${meta.unit}
          <span style="margin-left:6px;color:${T[lv === 'good' ? 'good' : lv]};font-weight:700">${LEVEL[lv].icon} ${LEVEL[lv].label}</span></div>
          <div style="font-size:11px;opacity:.75">Thấp nhất ${a[m].min.toFixed(meta.dec)} · Cao nhất ${a[m].max.toFixed(meta.dec)}</div>`;
      } },
      ...axes(T, y0, y1, m === 'ph' ? 1 : 1),
      dataZoom: [
        { type: 'inside', throttle: 30 },
        { type: 'slider', height: 26, bottom: 14, borderColor: T.border, backgroundColor: 'transparent',
          fillerColor: alpha(color, .12), handleStyle: { color: T.surface, borderColor: T.text3 },
          dataBackground: { lineStyle: { color: alpha(color, .6) }, areaStyle: { color: alpha(color, .15) } },
          selectedDataBackground: { lineStyle: { color }, areaStyle: { color: alpha(color, .3) } },
          textStyle: { color: T.text3, fontSize: 10 }, labelFormatter: v => fmtDM(v - TZ), moveHandleSize: 0 }
      ],
      series: [
        { type: 'line', name: 'min', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, data: agg.map(a => [X(a.t), a[m].min]) },
        { type: 'line', name: 'range', stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: alpha(color, .2) }, data: agg.map(a => [X(a.t), a[m].avg == null ? null : a[m].max - a[m].min]) },
        { type: 'line', name: 'avg', symbol: 'none', smooth: .2, lineStyle: { width: 2, color }, itemStyle: { color }, data: agg.map(a => [X(a.t), a[m].avg]),
          markArea: { silent: true, data: bandAreas(m, y0, y1, T) },
          markLine: { silent: true, symbol: 'none', data: thresholdLines(m, y0, y1, T) } }
      ]
    }, true);

    renderCalendar(T);
    renderTable();
  }

  // Calendar: % of time within optimal band each day (whole 6-month archive)
  function renderCalendar(T) {
    const m = histMetric;
    const dark = root.getAttribute('data-theme') !== 'light';
    const RAMP = dark ? ['#1d2a38', '#23405f', '#2f5f93', '#5b8fdc', '#a9c6ee'] : ['#e4e9f0', '#bccde3', '#7fa0cc', '#3f6fae', '#185292'];
    const days = new Map();
    Store.slots.forEach(s => {
      const k = localDayIndex(s.t);
      let d = days.get(k);
      if (!d) days.set(k, d = { n: 0, g: 0, sum: 0, min: Infinity, max: -Infinity, t: s.t });
      const v = s[m]; if (v == null) return;
      d.n++; d.sum += v; if (v < d.min) d.min = v; if (v > d.max) d.max = v;
      if (classify(m, v) === 'good') d.g++;
    });
    const keys = [...days.keys()].sort((a, b) => a - b);
    const first = keys[0], last = keys[keys.length - 1];
    // align to Monday
    const dow = k => (L(k * DAY - TZ + 12 * 3600000).getUTCDay() + 6) % 7; // 0 = Mon
    const start = first - dow(first);
    const host = $('calendar');
    host.style.gridTemplateRows = 'auto repeat(7, 1fr)';
    let html = '<div class="cal-month"></div>' + ['T2', '', 'T4', '', 'T6', '', 'CN'].map(l => `<div class="cal-month" style="height:auto;align-self:center;padding-right:4px">${l}</div>`).join('');
    let lastMonth = -1;
    const binOf = r => r >= .999 ? 4 : r >= .9 ? 3 : r >= .7 ? 2 : r >= .4 ? 1 : 0;
    for (let w = start; w <= last; w += 7) {
      const month = L(w * DAY - TZ + 12 * 3600000 + 6 * DAY).getUTCMonth();
      html += `<div class="cal-month">${month !== lastMonth ? 'T' + (month + 1) : ''}</div>`;
      lastMonth = month;
      for (let k = w; k < w + 7; k++) {
        const d = days.get(k);
        if (!d) { html += '<div class="cal-cell empty"></div>'; continue; }
        if (!d.n) { html += `<div class="cal-cell nodata" data-k="${k}" data-none="1"></div>`; continue; }
        const r = d.g / d.n;
        html += `<div class="cal-cell" style="background:${RAMP[binOf(r)]}" data-k="${k}" data-r="${r.toFixed(3)}" data-a="${(d.sum / d.n).toFixed(METRIC[m].dec)}" data-mn="${d.min.toFixed(METRIC[m].dec)}" data-mx="${d.max.toFixed(METRIC[m].dec)}"></div>`;
      }
    }
    host.innerHTML = html;
    host.scrollLeft = host.scrollWidth; // newest weeks first on narrow screens
    $('calTitle').textContent = `Tỷ lệ thời gian đạt ngưỡng tối ưu mỗi ngày · ${METRIC[m].label} · 6 tháng`;
    $('calLegend').innerHTML = 'Thấp ' + RAMP.map((c, i) => `<i style="background:${c}" title="${['< 40%', '40–70%', '70–90%', '90–99%', '100%'][i]}"></i>`).join('') + ' Cao <span style="margin-left:8px">(&lt;40% · 40–70% · 70–90% · 90–99% · 100%)</span>';
  }

  function renderTable() {
    const rows = Store.aggregate(histDays * DAY, DAY).reverse();
    const cell = (m, v, d) => {
      if (v == null) return '<td style="color:var(--text-3)">—</td>';
      const lv = classify(m, v);
      return `<td>${v.toFixed(d)}${lv !== 'good' ? ` <span title="${LEVEL[lv].label}" style="color:var(${LEVEL[lv].color});font-weight:800">${LEVEL[lv].icon}</span>` : ''}</td>`;
    };
    const rng = (a, d) => a.min == null ? '<td style="color:var(--text-3)">—</td>' : `<td>${a.min.toFixed(d)} – ${a.max.toFixed(d)}</td>`;
    $('dailyTable').querySelector('tbody').innerHTML = rows.map(r => `<tr>
      <td title="${WEEKDAYS[L(r.t + 12 * 3600000).getUTCDay()]}, ${fmtDMY(r.t + 12 * 3600000)}">${['CN','T2','T3','T4','T5','T6','T7'][L(r.t + 12 * 3600000).getUTCDay()]} · ${fmtDM(r.t + 12 * 3600000)}</td>
      ${cell('ph', r.ph.avg, 2)}${rng(r.ph, 2)}
      ${cell('sal', r.sal.avg, 2)}${rng(r.sal, 1)}
      ${cell('temp', r.temp.avg, 1)}</tr>`).join('');
  }

  // =========================================================
  // ALERTS / EVENTS
  // =========================================================
  function buildAlerts() {
    const out = [];
    const span = 14 * DAY;
    const hourly = Store.aggregate(span, 3600000);
    // threshold transitions on hourly means
    ['ph', 'sal', 'temp'].forEach(m => {
      // hysteresis: a new state must persist >= 3 consecutive hours to be logged
      let prev = null;
      hourly.forEach((h, i) => {
        if (h[m].avg == null) return;             // no data in this hour (sensor offline)
        const lv = classify(m, h[m].avg);
        const persists = hourly.slice(i, i + 3).length === 3 && hourly.slice(i, i + 3).every(x => x[m].avg == null || classify(m, x[m].avg) === lv);
        if (prev === null) { prev = lv; return; }
        if (lv !== prev && persists) {
          const th = C.thresholds[m], v = h[m].avg, meta = METRIC[m];
          let title, level = lv;
          if (lv === 'good') { title = `${meta.label} trở lại ngưỡng tối ưu`; level = 'info'; }
          else {
            const below = v < th.optimal[0];
            title = `${meta.label} ${below ? 'thấp hơn' : 'vượt'} ngưỡng ${lv === 'critical' ? 'cho phép' : 'tối ưu'}`;
          }
          out.push({ t: h.t, level, title, desc: `Trung bình giờ: ${v.toFixed(meta.dec)} ${meta.unit} · ngưỡng tối ưu ${th.optimal[0]} – ${th.optimal[1]} ${meta.unit}` });
          prev = lv;
        }
      });
    });
    // rain / dilution events
    const now = Store.latest().t;
    for (let d = localDayIndex(now - span); d <= localDayIndex(now); d++) {
      const ev = rainOfDay(d);
      if (!ev || ev.start > now || ev.start < now - span) continue;
      const before = Store.at(ev.start - 5 * 60000).sal;
      if (before == null) continue;
      let minAfter = before;
      for (let t = ev.start; t <= Math.min(now, ev.start + 12 * 3600000); t += STEP) { const v = Store.at(t).sal; if (v != null) minAfter = Math.min(minAfter, v); }
      const drop = before - minAfter;
      out.push({ t: ev.start, level: drop >= 1.2 ? 'warn' : 'info', title: drop >= 1.2 ? 'Độ mặn giảm nhanh do mưa' : 'Ghi nhận mưa tại khu vực ao',
        desc: `Độ mặn giảm ${drop.toFixed(2)} ‰ trong 12 giờ (${before.toFixed(1)} → ${minAfter.toFixed(1)} ‰)` });
    }
    // daily pH swing (QCVN: ≤ 0.5/ngày)
    Store.aggregate(span, DAY).forEach(dd => {
      if (dd.ph.n < 200) return;
      const sw = dd.ph.max - dd.ph.min;
      if (sw > C.thresholds.ph.dailySwingMax) {
        out.push({ t: dd.t + DAY - 60000 > now ? now : dd.t + 17 * 3600000, level: 'warn', title: 'Biên độ pH trong ngày lớn',
          desc: `Dao động ${sw.toFixed(2)} (${dd.ph.min.toFixed(2)} → ${dd.ph.max.toFixed(2)}), khuyến nghị ≤ ${C.thresholds.ph.dailySwingMax}/ngày` });
      }
    });
    // sensor connection events
    const nowReal = Date.now();
    ['ph', 'sal'].forEach(k => Sensors.intervals[k].forEach(([a, , r]) => {
      const sc = C.sensors[k];
      if (a >= nowReal - span) out.push({ t: a, level: 'critical', title: `Mất kết nối cảm biến ${SENSOR_NAME[k]}`,
        desc: `Không nhận được phản hồi từ ${sc.model} · Modbus ID ${pad2(sc.address)}` });
      if (r != null && r >= nowReal - span) out.push({ t: r, level: 'info', title: `Cảm biến ${SENSOR_NAME[k]} đã kết nối lại`,
        desc: `Gián đoạn ${fmtDur(r - a)} · dữ liệu đồng bộ trở lại` });
    }));
    out.sort((a, b) => b.t - a.t);
    return out.slice(0, 40);
  }
  function renderAlerts() {
    const list = buildAlerts();
    const active = list.filter(a => a.level === 'warn' || a.level === 'critical').length;
    $('alertCount').textContent = `${active} cảnh báo · 14 ngày`;
    $('alertList').innerHTML = list.length ? list.map((a, i) => `
      <li class="alert" style="--badge:var(${LEVEL[a.level].color});animation-delay:${Math.min(i, 10) * 40}ms">
        <span class="status-icon">${LEVEL[a.level].icon}</span>
        <div><b>${a.title}</b><p>${a.desc}</p></div>
        <time>${fmtHM(a.t)}<br>${fmtDM(a.t)}</time>
      </li>`).join('') : '<li class="alert"><span class="status-icon">✓</span><div><b>Không có sự kiện</b><p>Các chỉ số ổn định trong 14 ngày qua.</p></div></li>';
  }

  // =========================================================
  // DEVICES
  // =========================================================
  function renderDevices() {
    const s = Store.latest();
    const installT = Date.parse(C.installDate + 'T00:00:00+07:00');
    const records = Math.floor((s.t - installT) / STEP) + 1;
    $('deviceGrid').innerHTML = ['ph', 'sal'].map(k => {
      const d = C.sensors[k];
      const cal = Date.parse(C.lastCalibration[k] + 'T00:00:00+07:00');
      const daysSince = Math.floor((s.t - cal) / DAY);
      const left = C.calibrationIntervalDays - daysSince;
      const on = Sensors.isOn(k);
      const lastOk = Store.lastValid(k);
      const raw = !on ? '<span style="color:var(--critical)">Không có phản hồi (timeout)</span>'
        : k === 'ph' ? `${s.ph.toFixed(2)} pH · ${s.temp.toFixed(1)} °C` : `${s.sal.toFixed(2)} ‰ · ${s.ec.toFixed(2)} mS/cm`;
      const live = [['Giá trị thô', raw]];
      if (!on) live.push(['Ngoại tuyến từ', `${fmtHM(Sensors.offSince(k))} · ${fmtDM(Sensors.offSince(k))}`]);
      return `<div class="device${on ? '' : ' is-offline'}">
        <div class="device__head"><div><strong>${d.name}</strong><div class="model">${d.model} · Modbus ID ${pad2(d.address)}</div></div><span class="online${on ? '' : ' is-off'}">${on ? 'ONLINE' : 'OFFLINE'}</span></div>
        <dl class="spec">
          ${d.specs.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}
          <dt style="margin-top:6px">Khung gần nhất</dt><dd style="margin-top:6px">${lastOk ? `${fmtHMS(lastOk.t)} · ${fmtDM(lastOk.t)}` : '—'}</dd>
          ${live.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}
          <dt>Hiệu chuẩn</dt><dd>${fmtDMY(cal)} · ${left > 0 ? `còn ${left} ngày` : '<span style="color:var(--warn)">đến hạn</span>'}</dd>
          <dt>Số bản ghi</dt><dd>${fmtInt(records)}</dd>
        </dl></div>`;
    }).join('');
  }

  // =========================================================
  // READOUTS (cards, hero, theme tokens, twin)
  // =========================================================
  const gauges = {};
  let firstPaint = true;
  const OFF_COLOR = '#8b949c';
  const CARD = {
    ph:  { val: 'valPh',  delta: 'deltaPh',  dec: 2, unit: '',   blank: '-.--' },
    sal: { val: 'valSal', delta: 'deltaSal', dec: 2, unit: ' ‰', blank: '--.--' }
  };
  function stat24(day, m) {
    let a = 0, n = 0, lo = Infinity, hi = -Infinity;
    day.forEach(x => { const v = x[m]; if (v == null) return; a += v; n++; if (v < lo) lo = v; if (v > hi) hi = v; });
    return n ? { avg: a / n, lo, hi } : null;
  }
  function renderCard(k, isOn, value, prevVal, st) {
    const c = CARD[k], card = $('card-' + k), valEl = $(c.val), dEl = $(c.delta);
    const badge = document.querySelector(`[data-status="${k}"]`);
    const banner = card.querySelector('.offline-banner');
    card.classList.toggle('is-offline', !isOn);
    if (!isOn || value == null) {
      const since = Sensors.offSince(k), last = Store.lastValid(k);
      valEl._tw = (valEl._tw || 0) + 1; valEl._shown = undefined;   // cancel running count-up
      valEl.textContent = c.blank;
      setBadge(badge, 'offline');
      banner.innerHTML = `<span class="offline-banner__icon" aria-hidden="true">⚠</span><div><b>Cảm biến ngoại tuyến</b><span>Không nhận được dữ liệu từ Modbus ID ${pad2(C.sensors[k].address)}${since ? ` kể từ ${fmtHM(since)} · ${fmtDM(since)}` : ''}</span></div>`;
      dEl.className = 'delta flat';
      dEl.innerHTML = last ? `Giá trị cuối <b>${last[k].toFixed(c.dec)}${c.unit}</b> lúc ${fmtHM(last.t)} · ${fmtDM(last.t)}` : 'Chưa có dữ liệu';
      gauges[k].off(st && st.lo, st && st.hi);
      return;
    }
    banner.innerHTML = '';
    countTo(valEl, value, c.dec);
    gauges[k].set(value, st && st.lo, st && st.hi);
    if (prevVal != null) setDelta(dEl, value - prevVal, c.dec, c.unit);
    else { dEl.className = 'delta flat'; dEl.textContent = 'Đang đồng bộ lại dữ liệu…'; }
    setBadge(badge, classify(k, value));
  }

  function renderReadouts(animateTwin) {
    const s = Store.latest();
    const prevH = Store.at(s.t - 3600000);
    const day = Store.since(DAY);
    const on = { ph: Sensors.isOn('ph'), sal: Sensors.isOn('sal') };
    const P = stat24(day, 'ph'), Sa = stat24(day, 'sal');
    // what the gateway currently reports
    const cur = {
      ph: on.ph ? s.ph : null, sal: on.sal ? s.sal : null, ec: on.sal ? s.ec : null,
      temp: on.ph || on.sal ? s.temp : null
    };
    const offCount = (cur.ph == null ? 1 : 0) + (cur.sal == null ? 1 : 0);

    // theme follows the data (offline sensors turn the palette grey)
    const pc = cur.ph != null ? phColor(cur.ph) : OFF_COLOR, sc = cur.sal != null ? salColor(cur.sal) : OFF_COLOR;
    root.style.setProperty('--ph-color', pc);
    root.style.setProperty('--sal-color', sc);
    const lv = { ph: classify('ph', cur.ph), sal: classify('sal', cur.sal), temp: classify('temp', cur.temp) };
    const quality = ['ph', 'sal', 'temp'].filter(m => cur[m] != null).map(m => lv[m]).sort((a, b) => LEVEL[b].rank - LEVEL[a].rank)[0];
    let overall = quality || 'offline';
    if (offCount && overall === 'good') overall = 'warn';
    root.style.setProperty('--status-color', css(LEVEL[overall].color));
    document.querySelector('meta[name="theme-color"]').setAttribute('content', root.getAttribute('data-theme') === 'dark' ? '#16202a' : '#ffffff');

    // pH card
    renderCard('ph', on.ph, cur.ph, prevH.ph, P);
    if (P) {
      const swing = P.hi - P.lo;
      $('notePh').innerHTML = `Tối ưu <b>${C.thresholds.ph.optimal.join(' – ')}</b> · Biên độ 24h <b style="color:${swing > C.thresholds.ph.dailySwingMax ? 'var(--warn)' : 'inherit'}">${swing.toFixed(2)}</b>`;
    } else $('notePh').innerHTML = `Tối ưu <b>${C.thresholds.ph.optimal.join(' – ')}</b>`;
    $('minPh').textContent = fx(P && P.lo, 2); $('maxPh').textContent = fx(P && P.hi, 2);
    $('avgPh').textContent = fx(P && P.avg, 2); $('tempPh').textContent = on.ph ? fx(cur.temp, 1, ' °C') : '—';

    // salinity card
    renderCard('sal', on.sal, cur.sal, prevH.sal, Sa);
    $('noteSal').innerHTML = `Tối ưu <b>${C.thresholds.sal.optimal.join(' – ')} ‰</b> · Cho phép ${C.thresholds.sal.acceptable.join(' – ')} ‰`;
    $('ecSal').textContent = fx(cur.ec, 2, ' mS/cm');
    $('tdsSal').textContent = cur.ec != null ? fmtInt(cur.ec * 1000 * .64) + ' ppm' : '—';
    $('rangeSal').textContent = Sa ? `${Sa.lo.toFixed(1)} – ${Sa.hi.toFixed(1)} ‰` : '—';
    $('tempSal').textContent = on.sal && cur.temp != null ? (cur.temp + .1 * Math.sin(s.t / 7e6)).toFixed(1) + ' °C' : '—';

    // hero
    const wqi = wqiOf(cur);
    const wEl = $('wqiValue');
    if (wqi == null) { wEl._tw = (wEl._tw || 0) + 1; wEl._shown = 0; wEl.textContent = '--'; }
    else tween(wEl._shown ?? 0, wqi, 1400, v => { wEl._shown = v; wEl.textContent = Math.round(v); }, wEl);
    $('wqiArc').style.strokeDashoffset = (527.8 * (1 - (wqi ?? 0) / 100)).toFixed(1);
    const overallLabel = offCount === 2 ? 'Mất kết nối cảm biến'
      : offCount === 1 ? 'Thiếu dữ liệu cảm biến'
      : { good: 'Nguồn nước tối ưu', warn: 'Cần theo dõi', critical: 'Nguy hiểm – cần xử lý' }[overall];
    setBadge($('overallBadge'), overall, overallLabel);
    $('overallDesc').textContent = describe(cur, lv, on);
    $('lastUpdate').textContent = `${fmtHM(s.t)} · ${fmtDM(s.t)}`;

    // live indicator in the header
    const pill = $('livePill');
    pill.classList.toggle('is-partial', offCount === 1);
    pill.classList.toggle('is-down', offCount === 2);
    pill.querySelector('span:last-child').textContent = offCount === 0 ? 'Trực tuyến' : offCount === 1 ? '1/2 cảm biến' : 'Ngoại tuyến';

    // twin
    Twin.update({ ph: cur.ph, sal: cur.sal, temp: cur.temp, phColor: cur.ph != null ? pc : '#5f7783', salColor: sc, online: on });
    if (animateTwin) Twin.pulse(on);

    if (!firstPaint) ['ph', 'sal'].forEach(k => { if (!on[k]) return; const e = $(CARD[k].val); e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); });
    firstPaint = false;
  }
  function setDelta(el, d, dec, unit) {
    const dir = Math.abs(d) < Math.pow(10, -dec) ? 'flat' : d > 0 ? 'up' : 'down';
    el.className = 'delta ' + dir;
    el.innerHTML = `<span class="arrow">→</span> ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(dec)}${unit} so với 1 giờ trước`;
  }
  function describe(cur, lv, on) {
    const sp = C.station.species;
    const th = C.thresholds;
    const off = ['ph', 'sal'].filter(k => !on[k]);
    if (off.length === 2) return 'Không nhận được dữ liệu từ cả hai cảm biến. Kiểm tra nguồn cấp, cáp RS485 và gateway.';
    const issues = [];
    if (cur.ph != null && lv.ph !== 'good') issues.push(`pH ${cur.ph < th.ph.optimal[0] ? 'thấp' : 'cao'} (${cur.ph.toFixed(2)})`);
    if (cur.sal != null && lv.sal !== 'good') issues.push(`độ mặn ${cur.sal < th.sal.optimal[0] ? 'thấp' : 'cao'} (${cur.sal.toFixed(1)} ‰)`);
    if (cur.temp != null && lv.temp !== 'good') issues.push(`nhiệt độ ${cur.temp < th.temp.optimal[0] ? 'thấp' : 'cao'} (${cur.temp.toFixed(1)} °C)`);
    const offTxt = off.length ? `Cảm biến ${SENSOR_NAME[off[0]]} đang ngoại tuyến – WQI chỉ tính trên dữ liệu còn lại. ` : '';
    if (!issues.length) return offTxt + (off.length ? `Các chỉ số còn lại nằm trong ngưỡng tối ưu.` : `pH, độ mặn và nhiệt độ đều nằm trong ngưỡng tối ưu cho ${sp}.`);
    return `${offTxt}Lưu ý: ${issues.join(', ')} so với ngưỡng tối ưu cho ${sp}.`;
  }

  // =========================================================
  // CLOCK / SYNC LOOP
  // =========================================================
  function tick() {
    const now = Date.now();
    $('clockTime').textContent = fmtHMS(now);
    const d = L(now);
    $('clockDate').textContent = `${WEEKDAYS[d.getUTCDay()]}, ${fmtDMY(now)}`;
    const next = (Store.lastSlot + 1) * STEP;
    const left = Math.max(0, next - now);
    $('nextUpdate').textContent = `${fmtHM(next)} · còn ${pad2(Math.floor(left / 60000))}:${pad2(Math.floor(left / 1000) % 60)}`;
    $('syncProgress').style.width = (100 * (1 - left / STEP)).toFixed(2) + '%';
    if (now >= next) {
      const added = Store.poll();
      if (added.length) onNewData();
    }
  }
  function onNewData() {
    renderReadouts(true);
    renderSparks();
    renderRealtime();
    renderHistory();
    renderAlerts();
    renderDevices();
  }

  // =========================================================
  // CSV export
  // =========================================================
  function exportCsv() {
    const rows = Store.since(histDays * DAY);
    const head = 'Thoi gian (GMT+7),pH,Do man (ppt),EC (mS/cm),Nhiet do (C)';
    const n = (v, d) => v == null ? '' : v.toFixed(d);
    const lines = rows.map(s => { const d = L(s.t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${fmtHM(s.t)},${n(s.ph, 2)},${n(s.sal, 2)},${n(s.ec, 2)},${n(s.temp, 1)}`; });
    const blob = new Blob(['﻿' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const d = L(Date.now());
    a.href = URL.createObjectURL(blob);
    a.download = `AquaSense_${C.station.short.replace(/\s+/g, '-')}_${histDays}ngay_${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // =========================================================
  // WIRING
  // =========================================================
  function segmented(id, attr, cb) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b));
      cb(b.dataset[attr]);
    });
  }
  function rerenderCharts() { renderSparks(); renderRealtime(); renderHistory(); }

  function init() {
    $('stationName').textContent = C.station.name;
    $('year').textContent = L(Date.now()).getUTCFullYear();
    $('arlAbout').textContent = C.brands.arl;
    $('remitAbout').textContent = C.brands.remit;
    document.querySelectorAll('[data-bind]').forEach(n => { const [k, f] = n.dataset.bind.split('.'); n.textContent = C.sensors[k][f]; });

    Store.init(C.historyDays);

    gauges.ph = makeGauge($('gaugePh'), { metric: 'ph', colorFn: phColor, ticks: [0, 2, 4, 6, 8, 10, 12, 14], minor: 1, label: 'Thang pH 0 – 14' });
    gauges.sal = makeGauge($('gaugeSal'), { metric: 'sal', colorFn: salColor, ticks: [0, 10, 20, 30, 40], minor: 5, label: 'Độ mặn 0 – 40 ‰' });
    Twin.mount($('twin'));

    renderReadouts(false);
    rerenderCharts();
    renderAlerts();
    renderDevices();
    setTimeout(() => Twin.pulse(), 900);

    segmented('rtRange', 'h', v => { rtHours = +v; renderRealtime(); });
    segmented('histMetric', 'm', v => { histMetric = v; renderHistory(); });
    segmented('histRange', 'd', v => { histDays = +v; renderHistory(); });
    $('exportCsv').addEventListener('click', exportCsv);

    $('themeToggle').addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('aq-theme', next); } catch (e) {}
      renderReadouts(false);
      rerenderCharts();
    });

    // calendar tooltip
    const tip = $('tip');
    $('calendar').addEventListener('mousemove', e => {
      const c = e.target.closest('.cal-cell:not(.empty)');
      if (!c) { tip.classList.remove('show'); return; }
      const t = +c.dataset.k * DAY - TZ + 12 * 3600000, meta = METRIC[histMetric];
      tip.innerHTML = `<div style="opacity:.7">${WEEKDAYS[L(t).getUTCDay()]}, ${fmtDMY(t)}</div>` + (c.dataset.none
        ? '<div>Không có dữ liệu (cảm biến ngoại tuyến)</div>'
        : `<div>Đạt tối ưu: <b>${(+c.dataset.r * 100).toFixed(0)}%</b> thời gian</div>
        <div>${meta.label} TB <b>${c.dataset.a}</b> ${meta.unit} (${c.dataset.mn} – ${c.dataset.mx})</div>`);
      tip.style.left = Math.min(window.innerWidth - 250, e.clientX + 14) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
      tip.classList.add('show');
    });
    $('calendar').addEventListener('mouseleave', () => tip.classList.remove('show'));

    // sensor switched on/off (keyboard shortcuts, see controls.js)
    window.addEventListener('aq:sensors', e => {
      renderReadouts(false);
      if (e.detail && e.detail.on) Twin.pulse({ ph: e.detail.sensor === 'ph', sal: e.detail.sensor === 'sal' });
      renderSparks(); renderRealtime(); renderHistory(); renderAlerts(); renderDevices();
    });

    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => Object.values(charts).forEach(c => c.resize()), 120); });
    tick(); setInterval(tick, 1000);
  }

  // server version: load the sensor on/off state first so history gaps are right from the first paint
  const boot = () => (window.AQBackend ? window.AQBackend.ready : Promise.resolve()).then(init, init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
