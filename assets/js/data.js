/* =========================================================
   Data layer
   ---------------------------------------------------------
   Each reading is a pure function of its timestamp slot, so every
   visitor / reload sees exactly the same history and the same
   "latest" value. To connect real sensors later, replace
   `sample(slot)` and `Store.init` / `Store.poll` with a fetch
   to your API – the rest of the dashboard does not change.
   ========================================================= */
(function () {
  const C = window.AQ_CONFIG;
  const STEP = C.sampleMinutes * 60 * 1000;          // 5 min
  const TZ = C.timezoneOffsetHours * 3600 * 1000;     // local time offset (UTC+7)
  const DAY = 86400000;

  // ---------- deterministic hashing / noise ----------
  function hash(n, seed) {
    let h = (n | 0) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0,1)
  }
  const smooth = f => f * f * (3 - 2 * f);
  function vnoise(x, seed) { // value noise in [-1,1]
    const i = Math.floor(x), f = x - i;
    const a = hash(i, seed) * 2 - 1, b = hash(i + 1, seed) * 2 - 1;
    return a + (b - a) * smooth(f);
  }
  function gauss(n, seed) { // approx N(0,1) from 3 uniforms
    return (hash(n, seed) + hash(n, seed + 7) + hash(n, seed + 13) - 1.5) * 2;
  }

  // ---------- helpers ----------
  const localHour = t => (((t + TZ) % DAY) + DAY) % DAY / 3600000;
  const localDayIndex = t => Math.floor((t + TZ) / DAY);
  // fast day-of-year (smooth seasonal curves only need ~1 day precision)
  const dayOfYear = t => (((t + TZ) / DAY) % 365.2425 + 365.2425) % 365.2425;

  // ---------- weather: rain events (season dependent) ----------
  const rainCache = new Map();
  function rainOfDay(di) {
    if (rainCache.has(di)) return rainCache.get(di);
    const t = di * DAY - TZ;
    const month = new Date(t + TZ + 12 * 3600000).getUTCMonth(); // 0..11
    const p = C.sim.rainProbabilityByMonth[month];
    let ev = null;
    if (hash(di, 501) < p) {
      const startH = 13 + hash(di, 502) * 6;              // 13:00–19:00 afternoon showers
      const intensity = .35 + Math.pow(hash(di, 503), 1.6) * .9; // 0.35 – 1.25
      ev = { start: t + startH * 3600000, intensity, duration: (1 + hash(di, 504) * 2.5) * 3600000 };
    }
    rainCache.set(di, ev);
    return ev;
  }
  // cumulative rain impulse response (0..~1.5) at time t, with recovery time constant tau (hours)
  function rainImpact(t, tauH) {
    const di = localDayIndex(t);
    let sum = 0;
    for (let d = di - 6; d <= di; d++) {
      const ev = rainOfDay(d);
      if (!ev || t < ev.start) continue;
      const dt = t - ev.start;
      const ramp = Math.min(1, dt / ev.duration);         // dilution builds during the shower
      const decay = Math.exp(-Math.max(0, dt - ev.duration) / (tauH * 3600000));
      sum += ev.intensity * ramp * decay;
    }
    return sum;
  }
  function isRaining(t) {
    const ev = rainOfDay(localDayIndex(t));
    return !!ev && t >= ev.start && t <= ev.start + ev.duration;
  }

  // ---------- the physical models ----------
  const S = C.sim;

  function temperature(t) {
    const doy = dayOfYear(t);
    const h = localHour(t);
    const di = localDayIndex(t);
    const seasonal = S.temp.mean + S.temp.seasonalAmp * Math.cos(2 * Math.PI * (doy - S.temp.peakDoy) / 365);
    const cloud = .55 + .45 * hash(di, 77);              // sunny day → bigger swing
    const diurnal = S.temp.diurnalAmp * cloud * Math.cos(2 * Math.PI * (h - 15.5) / 24);
    const drift = .5 * vnoise(t / (36 * 3600000), 31);
    return seasonal + diurnal + drift - 1.6 * rainImpact(t, 8);
  }

  function salinity(t) {
    const doy = dayOfYear(t);
    // seasonal saline-intrusion curve: low at the end of the wet season, peak in the late dry season
    const seasonal = S.sal.mean + S.sal.seasonalAmp * Math.cos(2 * Math.PI * (doy - S.sal.peakDoy) / 365);
    const tide = S.sal.tidalAmp * Math.sin(2 * Math.PI * t / (12.42 * 3600000))
               + S.sal.tidalAmp * .35 * Math.sin(2 * Math.PI * t / (24 * 3600000 * 14.77) + 1); // spring–neap
    const h = localHour(t);
    const evap = S.sal.evapAmp * Math.max(0, Math.sin(Math.PI * (h - 9) / 12)); // midday evaporation
    const drift = S.sal.driftAmp * (vnoise(t / (5 * DAY), 11) + .5 * vnoise(t / (1.3 * DAY), 12));
    const rain = S.sal.rainDrop * rainImpact(t, S.sal.rainRecoveryH);
    return Math.max(.2, seasonal + tide + evap + drift - rain);
  }

  function ph(t, salNow) {
    const h = localHour(t);
    const di = localDayIndex(t);
    const sunny = .45 + .55 * hash(di, 88);
    // photosynthesis: min near dawn (~06:00), max mid-afternoon (~15:00) – asymmetric shape
    const phase = 2 * Math.PI * (h - 15) / 24;
    const diurnal = S.ph.diurnalAmp * sunny * (Math.cos(phase) + .25 * Math.cos(2 * phase - .6));
    const drift = S.ph.driftAmp * (vnoise(t / (4 * DAY), 21) + .6 * vnoise(t / (16 * 3600000), 22));
    const rain = S.ph.rainDrop * rainImpact(t, S.ph.rainRecoveryH);
    // brackish water buffers better: tiny coupling with salinity
    const buffer = .012 * ((salNow ?? salinity(t)) - S.sal.mean);
    return S.ph.mean + diurnal + drift - rain + buffer;
  }

  // one 5-minute sample (with small measurement noise, rounded to sensor resolution)
  function sample(slot) {
    const t = slot * STEP;
    const temp = temperature(t) + .04 * gauss(slot, 3);
    const salTrue = salinity(t);
    const sal = salTrue + S.sal.noise * gauss(slot, 4);
    const p = ph(t, salTrue) + S.ph.noise * gauss(slot, 5);
    const salR = Math.max(0, Math.round(sal * 100) / 100);
    return {
      t,
      ph: Math.round(p * 100) / 100,
      sal: salR,
      temp: Math.round(temp * 10) / 10,
      ec: Math.round(salToEC(salR) * 100) / 100,
      rain: isRaining(t)
    };
  }

  // Salinity (‰) → EC (mS/cm @25 °C), empirical: S ≈ 0.4665·EC^1.0878  ⇒  EC ≈ (S/0.4665)^0.919
  function salToEC(s) {
    return s <= 0 ? 0 : Math.pow(s / 0.4665, 0.919);
  }

  // ---------- sensor availability (operator on/off, persisted in this browser) ----------
  // Each sensor keeps a list of offline intervals [offAt, dataResumesAt, reconnectedAt].
  // Slots with offAt <= t < dataResumesAt have no reading for that sensor (gaps in history).
  const SENSORS = ['ph', 'sal'];
  const LS_KEY = 'aq-sensor-intervals';
  const Sensors = {
    intervals: { ph: [], sal: [] },
    load() {
      try {
        const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (v) SENSORS.forEach(k => { this.intervals[k] = Array.isArray(v[k]) ? v[k].filter(x => Array.isArray(x) && typeof x[0] === 'number') : []; });
      } catch (e) {}
      const min = Date.now() - C.historyDays * DAY;
      SENSORS.forEach(k => { this.intervals[k] = this.intervals[k].filter(x => x[1] == null || x[1] > min || (x[2] ?? 0) > min); });
    },
    save() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.intervals)); } catch (e) {} },
    last(k) { const iv = this.intervals[k]; return iv[iv.length - 1]; },
    isOn(k) { const l = this.last(k); return !l || l[1] != null; },
    offSince(k) { return this.isOn(k) ? null : this.last(k)[0]; },
    offAt(k, t) {
      const iv = this.intervals[k];
      for (let i = iv.length - 1; i >= 0; i--) { const [a, b] = iv[i]; if (t >= a && t < (b ?? Infinity)) return true; }
      return false;
    },
    set(k, on) {
      if (!SENSORS.includes(k) || this.isOn(k) === on) return false;
      const now = Date.now();
      if (!on) this.intervals[k].push([now, null, null]);
      else {
        const l = this.last(k);
        // the reading taken at reconnection is kept (so data appears immediately)
        l[1] = Math.max(l[0], Math.floor(now / STEP) * STEP);
        l[2] = now;
        Store.refreshLatest();
      }
      this.save();
      return true;
    },
    toggle(k) { this.set(k, !this.isOn(k)); return this.isOn(k); }
  };
  Sensors.load();

  // a sample as received by the gateway: readings of offline sensors are missing (null)
  function measure(slot) {
    const s = sample(slot);
    const offPh = Sensors.offAt('ph', s.t), offSal = Sensors.offAt('sal', s.t);
    if (offPh) s.ph = null;
    if (offSal) { s.sal = null; s.ec = null; }
    if (offPh && offSal) s.temp = null;   // water temperature comes from either probe
    return s;
  }

  // ---------- store: rolling window of the last N days ----------
  const Store = {
    slots: [],      // array of sample objects, oldest → newest
    lastSlot: 0,

    init(days) {
      const now = Date.now();
      this.lastSlot = Math.floor(now / STEP);
      const first = this.lastSlot - Math.ceil(days * DAY / STEP) + 1;
      this.slots = new Array(this.lastSlot - first + 1);
      for (let s = first, i = 0; s <= this.lastSlot; s++, i++) this.slots[i] = measure(s);
      this.maxLen = this.slots.length;
    },

    // returns new samples since last poll (normally 0 or 1)
    poll() {
      const cur = Math.floor(Date.now() / STEP);
      const added = [];
      while (this.lastSlot < cur) {
        this.lastSlot++;
        const s = measure(this.lastSlot);
        this.slots.push(s); added.push(s);
        if (this.slots.length > this.maxLen) this.slots.shift();
      }
      return added;
    },
    refreshLatest() {
      if (this.slots.length) this.slots[this.slots.length - 1] = measure(this.lastSlot);
    },
    // most recent sample that has a reading for metric k
    lastValid(k) {
      for (let i = this.slots.length - 1; i >= 0; i--) if (this.slots[i][k] != null) return this.slots[i];
      return null;
    },

    latest() { return this.slots[this.slots.length - 1]; },
    since(ms) {
      const from = this.latest().t - ms;
      let i = this.slots.length - 1;
      while (i > 0 && this.slots[i - 1].t >= from) i--;
      return this.slots.slice(i);
    },
    at(t) {
      const idx = this.slots.length - 1 - Math.round((this.latest().t - t) / STEP);
      return this.slots[Math.max(0, Math.min(this.slots.length - 1, idx))];
    },

    // aggregate into buckets (ms) – returns {t, avg, min, max} per metric
    aggregate(ms, bucketMs) {
      const src = this.since(ms);
      const out = [];
      let cur = null;
      for (const s of src) {
        const b = Math.floor((s.t + TZ) / bucketMs) * bucketMs - TZ;
        if (!cur || cur.t !== b) {
          if (cur) out.push(finish(cur));
          cur = { t: b, n: 0, ph: [0, Infinity, -Infinity, 0], sal: [0, Infinity, -Infinity, 0], temp: [0, Infinity, -Infinity, 0] };
        }
        cur.n++;
        for (const k of ['ph', 'sal', 'temp']) {
          const v = s[k], a = cur[k];
          if (v == null) continue;           // sensor offline → no reading
          a[0] += v; a[3]++; if (v < a[1]) a[1] = v; if (v > a[2]) a[2] = v;
        }
      }
      if (cur) out.push(finish(cur));
      return out;
      function finish(c) {
        const r = { t: c.t, n: c.n };
        for (const k of ['ph', 'sal', 'temp']) {
          const a = c[k];
          r[k] = a[3] ? { avg: a[0] / a[3], min: a[1], max: a[2], n: a[3] } : { avg: null, min: null, max: null, n: 0 };
        }
        return r;
      }
    }
  };

  window.AQData = { Store, Sensors, STEP, DAY, TZ, localHour, localDayIndex, rainOfDay, salToEC };
})();
