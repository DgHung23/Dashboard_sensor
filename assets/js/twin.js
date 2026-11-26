/* =========================================================
   Digital twin – animated cross-section of the monitored pond
   - water colour follows pH (indicator-like hue)
   - salt particle density follows salinity
   - data packets travel probe → gateway → cloud on every sample
   ========================================================= */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 900, H = 400;
  const WATER_TOP = 150, WATER_BOTTOM = 372, TANK_L = 40, TANK_R = 560;

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  const Twin = {
    svg: null, particles: [], bubbles: [], t: 0,
    state: { ph: 7.8, sal: 15, temp: 29, phColor: '#2bb5a0', salColor: '#1f9bd1' },

    mount(host) {
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Mô hình mô phỏng bể quan trắc với hai đầu dò pH và độ mặn' });
      host.appendChild(svg);
      this.svg = svg;

      const defs = el('defs', {}, svg);
      defs.innerHTML = `
        <linearGradient id="tw-water" x1="0" y1="0" x2="0" y2="1">
          <stop id="tw-w1" offset="0" stop-color="#2bb5a0" stop-opacity=".85"/>
          <stop id="tw-w2" offset="1" stop-color="#173a52" stop-opacity=".95"/>
        </linearGradient>
        <linearGradient id="tw-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--sal-color)" stop-opacity=".10"/>
          <stop offset="1" stop-color="var(--sal-color)" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="tw-glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity=".18"/>
          <stop offset=".08" stop-color="#fff" stop-opacity=".02"/>
          <stop offset=".92" stop-color="#fff" stop-opacity=".02"/>
          <stop offset="1" stop-color="#fff" stop-opacity=".14"/>
        </linearGradient>
        <radialGradient id="tw-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" stop-opacity=".9"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
        <clipPath id="tw-clip"><rect x="${TANK_L}" y="40" width="${TANK_R - TANK_L}" height="${WATER_BOTTOM - 40}" rx="6"/></clipPath>
        <filter id="tw-soft"><feGaussianBlur stdDeviation="1.2"/></filter>
      `;

      // backdrop
      el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#tw-sky)' }, svg);

      // ---- Tank / pond ----
      const tank = el('g', {}, svg);
      el('rect', { x: TANK_L - 6, y: 70, width: TANK_R - TANK_L + 12, height: WATER_BOTTOM - 64, rx: 12, fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 2 }, tank);
      const waterG = el('g', { 'clip-path': 'url(#tw-clip)' }, tank);
      this.waterBack = el('path', { fill: 'url(#tw-water)', opacity: .55 }, waterG);
      this.waterFront = el('path', { fill: 'url(#tw-water)' }, waterG);
      // sediment
      el('path', { d: `M${TANK_L} ${WATER_BOTTOM - 16} Q 150 ${WATER_BOTTOM - 30} 260 ${WATER_BOTTOM - 18} T 560 ${WATER_BOTTOM - 20} V ${WATER_BOTTOM} H ${TANK_L} Z`, fill: '#6b5a3e', opacity: .55 }, waterG);
      // particles layer
      this.saltG = el('g', {}, waterG);
      this.bubbleG = el('g', {}, waterG);
      // light rays
      for (let i = 0; i < 4; i++) {
        el('path', { d: `M${120 + i * 110} ${WATER_TOP} l 40 220 h 26 l -40 -220 z`, fill: '#fff', opacity: .035 }, waterG);
      }
      el('rect', { x: TANK_L, y: 70, width: TANK_R - TANK_L, height: WATER_BOTTOM - 70, fill: 'url(#tw-glass)', rx: 6 }, tank);

      // Depth ruler
      const ruler = el('g', { 'font-size': 10, fill: 'var(--text-3)', 'font-family': 'IBM Plex Sans, sans-serif' }, svg);
      for (let i = 0; i <= 4; i++) {
        const y = WATER_TOP + i * ((WATER_BOTTOM - WATER_TOP - 20) / 4);
        el('line', { x1: 20, x2: 30, y1: y, y2: y, stroke: 'var(--text-3)', 'stroke-width': 1 }, ruler);
        el('text', { x: 4, y: y + 3 }, ruler).textContent = (i * 0.4).toFixed(1);
      }
      el('text', { x: 4, y: WATER_TOP - 12 }, ruler).textContent = 'm';

      // ---- Probes ----
      this.probePh = this.probe(svg, 210, 'pH', 'var(--series-ph)');
      this.probeSal = this.probe(svg, 390, 'EC', 'var(--series-sal)');

      // ---- Cables to gateway ----
      const cab = el('g', { fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
      this.cablePh = el('path', { d: 'M210 92 C 210 40, 600 40, 660 150', stroke: 'var(--text-3)', opacity: .55 }, cab);
      this.cableSal = el('path', { d: 'M390 92 C 390 60, 600 70, 660 160', stroke: 'var(--text-3)', opacity: .55 }, cab);
      this.cableUp = el('path', { d: 'M712 120 C 730 70, 770 60, 800 70', stroke: 'var(--text-3)', opacity: .35, 'stroke-dasharray': '4 6' }, cab);

      // ---- Gateway box ----
      const gw = el('g', { transform: 'translate(640 120)' }, svg);
      el('rect', { x: 0, y: 0, width: 104, height: 88, rx: 12, fill: 'var(--surface-solid)', stroke: 'var(--border-strong)', 'stroke-width': 1.5 }, gw);
      el('rect', { x: 10, y: 12, width: 84, height: 30, rx: 6, fill: 'var(--bg)', stroke: 'var(--border)' }, gw);
      this.gwText = el('text', { x: 52, y: 32, 'text-anchor': 'middle', 'font-size': 11, 'font-family': 'IBM Plex Sans, sans-serif', fill: 'var(--good)' }, gw);
      this.gwText.textContent = 'RS485 OK';
      this.gwLeds = [0, 1, 2].map(i => el('circle', { cx: 22 + i * 14, cy: 60, r: 4, fill: 'var(--good)', opacity: .4 }, gw));
      el('text', { x: 52, y: 80, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-2)', 'font-weight': 600 }, gw).textContent = 'GATEWAY';
      // antenna
      el('line', { x1: 90, y1: 0, x2: 98, y2: -22, stroke: 'var(--text-3)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, gw);
      this.waves = [0, 1, 2].map(i => el('path', { d: `M${104 + i * 6} ${-30 - i * 5} a ${8 + i * 7} ${8 + i * 7} 0 0 1 0 ${16 + i * 14}`, fill: 'none', stroke: 'var(--sal-color)', 'stroke-width': 2, opacity: 0, transform: 'rotate(-60 98 -22)' }, gw));

      // ---- Cloud / dashboard ----
      const cloud = el('g', { transform: 'translate(790 40)' }, svg);
      el('path', { d: 'M18 52 a 18 18 0 0 1 4 -35 a 24 24 0 0 1 44 6 a 16 16 0 0 1 6 29 z', fill: 'var(--surface-solid)', stroke: 'var(--border-strong)', 'stroke-width': 1.5 }, cloud);
      el('text', { x: 44, y: 42, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-2)', 'font-weight': 700 }, cloud).textContent = 'CLOUD';

      // ---- Readout tags near probes ----
      this.tagPh = this.tag(svg, 120, 108, 'var(--series-ph)');
      this.tagSal = this.tag(svg, 300, 108, 'var(--series-sal)');

      // ---- Thermometer label ----
      this.tempText = el('text', { x: TANK_R - 6, y: 62, 'text-anchor': 'end', 'font-size': 12, 'font-family': 'IBM Plex Sans, sans-serif', fill: 'var(--text-2)' }, svg);

      // Packets
      this.packetG = el('g', {}, svg);

      // seed particles
      for (let i = 0; i < 160; i++) {
        const c = el('rect', { width: 2.6, height: 2.6, rx: .6, fill: '#fff', opacity: 0 }, this.saltG);
        this.particles.push({ n: c, x: TANK_L + Math.random() * (TANK_R - TANK_L), y: WATER_TOP + 10 + Math.random() * (WATER_BOTTOM - WATER_TOP - 30), vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .12, ph: Math.random() * 6.28 });
      }
      for (let i = 0; i < 14; i++) {
        const b = el('circle', { r: 1.5 + Math.random() * 2.5, fill: 'none', stroke: '#fff', 'stroke-width': 1, opacity: .5 }, this.bubbleG);
        this.bubbles.push({ n: b, x: 0, y: 0, s: .3 + Math.random() * .6, reset: true });
      }

      this.raf = requestAnimationFrame(this.loop.bind(this));
    },

    probe(svg, x, label, color) {
      const g = el('g', {}, svg);
      el('rect', { x: x - 9, y: 78, width: 18, height: 28, rx: 4, fill: 'var(--surface-solid)', stroke: 'var(--border-strong)' }, g);
      el('rect', { x: x - 5, y: 104, width: 10, height: 170, rx: 5, fill: 'var(--surface-solid)', stroke: color, 'stroke-width': 1.5 }, g);
      el('rect', { x: x - 3, y: 250, width: 6, height: 22, rx: 3, fill: color, opacity: .9 }, g);
      const glow = el('circle', { cx: x, cy: 266, r: 18, fill: 'url(#tw-glow)', opacity: 0 }, g);
      el('text', { x, y: 96, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 800, fill: color }, g).textContent = label;
      return { g, glow, x };
    },

    tag(svg, x, y, color) {
      const g = el('g', { transform: `translate(${x} ${y})` }, svg);
      el('rect', { x: 0, y: 0, width: 78, height: 30, rx: 8, fill: 'var(--surface-solid)', stroke: color, 'stroke-width': 1.2, opacity: .95 }, g);
      const t = el('text', { x: 39, y: 20, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, 'font-family': 'IBM Plex Sans, sans-serif', fill: 'var(--text)' }, g);
      return t;
    },

    update(s) {
      Object.assign(this.state, s);
      const st = this.state;
      document.getElementById('tw-w1')?.setAttribute('stop-color', st.phColor);
      const on = st.online || { ph: true, sal: true };
      this.tagPh.textContent = on.ph && st.ph != null ? `${st.ph.toFixed(2)} pH` : 'OFFLINE';
      this.tagSal.textContent = on.sal && st.sal != null ? `${st.sal.toFixed(1)} ‰` : 'OFFLINE';
      this.tempText.textContent = st.temp != null ? `Nhiệt độ ${st.temp.toFixed(1)} °C` : 'Nhiệt độ -- °C';
      // offline probes fade out, their cable goes dark
      this.probePh.g.style.transition = this.probeSal.g.style.transition = 'opacity .8s';
      this.probePh.g.style.opacity = on.ph ? 1 : .3;
      this.probeSal.g.style.opacity = on.sal ? 1 : .3;
      this.cablePh.setAttribute('stroke-dasharray', on.ph ? '' : '3 7');
      this.cableSal.setAttribute('stroke-dasharray', on.sal ? '' : '3 7');
      const n = (on.ph ? 1 : 0) + (on.sal ? 1 : 0);
      this.gwText.textContent = n === 2 ? 'RS485 OK' : n === 1 ? 'RS485 1/2' : 'NO SIGNAL';
      this.gwText.setAttribute('fill', n === 2 ? 'var(--good)' : n === 1 ? 'var(--warn)' : 'var(--critical)');
      // salt particle count proportional to salinity (0–40‰ → 0–160); unknown salinity keeps the last state
      if (on.sal && st.sal != null) this.saltVisible = Math.round(Math.max(0, Math.min(1, st.sal / 40)) * this.particles.length);
    },

    pulse(online) {
      const on = online || this.state.online || { ph: true, sal: true };
      if (!on.ph && !on.sal) return;
      // light probes, then send packets along cables
      [[this.probePh, on.ph], [this.probeSal, on.sal]].forEach(([p, ok], i) => {
        if (ok) p.glow.animate([{ opacity: 0 }, { opacity: .9 }, { opacity: 0 }], { duration: 1200, delay: i * 150, easing: 'ease-out' });
      });
      if (on.ph) this.sendPacket(this.cablePh, 'var(--series-ph)', 200);
      if (on.sal) this.sendPacket(this.cableSal, 'var(--series-sal)', 350);
      setTimeout(() => {
        this.gwLeds.forEach((l, i) => l.animate([{ opacity: .4 }, { opacity: 1 }, { opacity: .4 }], { duration: 400, delay: i * 120, iterations: 2 }));
        this.waves.forEach((w, i) => w.animate([{ opacity: 0 }, { opacity: .9 }, { opacity: 0 }], { duration: 900, delay: i * 160 }));
        this.sendPacket(this.cableUp, 'var(--sal-color)', 0);
      }, 1500);
    },

    sendPacket(path, color, delay) {
      const len = path.getTotalLength();
      const dot = el('circle', { r: 5, fill: color, opacity: 0 }, this.packetG);
      const halo = el('circle', { r: 10, fill: color, opacity: 0 }, this.packetG);
      const start = performance.now() + delay, dur = 1300;
      const step = (now) => {
        const k = (now - start) / dur;
        if (k < 0) return requestAnimationFrame(step);
        if (k > 1) { dot.remove(); halo.remove(); return; }
        const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const p = path.getPointAtLength(e * len);
        dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('opacity', 1);
        halo.setAttribute('cx', p.x); halo.setAttribute('cy', p.y); halo.setAttribute('opacity', .25 * (1 - k));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    wavePath(t, amp, freq, phase, offset) {
      let d = `M${TANK_L} ${WATER_BOTTOM} L${TANK_L} ${WATER_TOP}`;
      for (let x = TANK_L; x <= TANK_R; x += 10) {
        const y = WATER_TOP + offset + Math.sin(x * freq + t * 1.4 + phase) * amp + Math.sin(x * freq * 2.3 + t * .9) * amp * .35;
        d += ` L${x} ${y.toFixed(1)}`;
      }
      return d + ` L${TANK_R} ${WATER_BOTTOM} Z`;
    },

    loop(now) {
      const t = now / 1000;
      this.waterBack.setAttribute('d', this.wavePath(t, 4, .018, 1.7, -4));
      this.waterFront.setAttribute('d', this.wavePath(t, 3.2, .022, 0, 2));

      const vis = this.saltVisible ?? 60;
      this.particles.forEach((p, i) => {
        p.x += p.vx + Math.sin(t * .6 + p.ph) * .08;
        p.y += p.vy + Math.cos(t * .5 + p.ph) * .05;
        if (p.x < TANK_L) p.x = TANK_R; if (p.x > TANK_R) p.x = TANK_L;
        if (p.y < WATER_TOP + 12) p.vy = Math.abs(p.vy); if (p.y > WATER_BOTTOM - 24) p.vy = -Math.abs(p.vy);
        p.n.setAttribute('x', p.x.toFixed(1)); p.n.setAttribute('y', p.y.toFixed(1));
        const target = i < vis ? .55 + .3 * Math.sin(t * 2 + p.ph) : 0;
        p.o = (p.o ?? 0) + (target - (p.o ?? 0)) * .04;
        p.n.setAttribute('opacity', p.o.toFixed(2));
      });

      this.bubbles.forEach((b, i) => {
        if (b.reset) { b.x = (i % 2 ? 210 : 390) + (Math.random() - .5) * 14; b.y = 270 + Math.random() * 20; b.reset = false; }
        b.y -= b.s; b.x += Math.sin(t * 3 + i) * .2;
        if (b.y < WATER_TOP + 4) b.reset = true;
        b.n.setAttribute('cx', b.x.toFixed(1)); b.n.setAttribute('cy', b.y.toFixed(1));
      });

      this.raf = requestAnimationFrame(this.loop.bind(this));
    }
  };

  window.Twin = Twin;
})();
