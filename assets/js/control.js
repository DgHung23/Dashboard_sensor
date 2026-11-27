/* =========================================================
   AquaSense – mobile control page (/control/)
   Visible switches live here only; the dashboard itself has none.
   ========================================================= */
(function () {
  const C = window.AQ_CONFIG;
  const { Store, Sensors, SENSORS, STEP, TZ } = window.AQData;
  const B = window.AQBackend;
  const $ = id => document.getElementById(id);
  const pad2 = n => String(n).padStart(2, '0');
  const L = t => new Date(t + TZ);
  const fmtHM = t => { const d = L(t); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
  const fmtDM = t => { const d = L(t); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`; };
  function fmtDur(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m} phút`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} giờ ${m % 60} phút`;
    return `${Math.floor(h / 24)} ngày ${h % 24} giờ`;
  }

  const SENSOR = {
    ph:  { name: 'Cảm biến pH',      short: 'pH',     unit: 'pH', dec: 2, key: 'ph',
           icon: '<path d="M9 2h6M10 2v6.5L5.2 17a3 3 0 0 0 2.6 4.5h8.4a3 3 0 0 0 2.6-4.5L14 8.5V2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7.2 15h9.6" stroke="currentColor" stroke-width="1.8"/>' },
    sal: { name: 'Cảm biến độ mặn',  short: 'độ mặn', unit: '‰',  dec: 2, key: 'sal',
           icon: '<path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><g fill="currentColor"><rect x="9" y="13" width="2.2" height="2.2" rx=".4"/><rect x="12.6" y="15.6" width="2.2" height="2.2" rx=".4"/><rect x="12.2" y="11.4" width="1.8" height="1.8" rx=".4"/></g>' },
    soil: { name: 'Cảm biến đất 7 trong 1', short: 'đất', unit: '% ẩm', dec: 1, key: 'moist',
           icon: '<path d="M3 10.5h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 10.5V6m0 0c0-2 1.6-3.4 3.6-3.4C15.6 4.6 14 6 12 6Zm0 0C12 4.3 10.6 3 8.8 3 8.8 4.7 10.2 6 12 6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.5 10.5v8.2M12 10.5v9.8M15.5 10.5v8.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' }
  };
  const pending = new Set();

  function show(id) {
    ['viewLoading', 'viewStatic', 'viewLogin', 'viewPanel'].forEach(v => { $(v).hidden = v !== id; });
  }
  function setConn(state, text) {
    const c = $('conn');
    c.dataset.state = state;
    c.querySelector('span').textContent = text;
  }
  const haptic = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  // ---------- tiles ----------
  function buildTiles() {
    $('tiles').innerHTML = SENSORS.map(k => {
      const s = SENSOR[k], cfg = C.sensors[k];
      return `<article class="ctl-card tile" id="tile-${k}" data-sensor="${k}">
        <div class="tile__head">
          <span class="tile__icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">${s.icon}</svg></span>
          <div class="tile__name"><strong>${s.name}</strong><span>${cfg.model} · Modbus ID ${pad2(cfg.address)}</span></div>
        </div>
        <div class="tile__reading">
          <span class="tile__value" data-role="value">—</span><span class="tile__unit">${s.unit}</span>
        </div>
        <p class="tile__meta" data-role="meta"></p>
        <div class="tile__switch">
          <div><b data-role="state">—</b><span data-role="hint"></span></div>
          <button class="switch" type="button" role="switch" aria-checked="false" data-role="switch" aria-label="${s.name}">
            <span class="switch__thumb"></span>
          </button>
        </div>
      </article>`;
    }).join('');
    document.querySelectorAll('[data-role="switch"]').forEach(btn => {
      btn.addEventListener('click', () => toggle(btn.closest('.tile').dataset.sensor));
    });
  }

  function render() {
    Store.poll();
    const s = Store.latest();
    let offCount = 0;
    SENSORS.forEach(k => {
      const tile = $('tile-' + k), on = Sensors.isOn(k), sw = tile.querySelector('[data-role="switch"]');
      if (!on) offCount++;
      tile.classList.toggle('is-off', !on);
      tile.classList.toggle('is-pending', pending.has(k));
      sw.setAttribute('aria-checked', String(on));
      sw.disabled = pending.has(k);
      tile.querySelector('[data-role="state"]').textContent = on ? 'Đang hoạt động' : 'Đã tắt';
      tile.querySelector('[data-role="hint"]').textContent = pending.has(k) ? 'Đang gửi lệnh…' : on ? 'Gạt để ngắt cảm biến' : 'Gạt để bật lại';
      const v = s && s[SENSOR[k].key];
      tile.querySelector('[data-role="value"]').textContent = on && v != null ? v.toFixed(SENSOR[k].dec) : '—';
      const since = Sensors.offSince(k);
      tile.querySelector('[data-role="meta"]').textContent = on
        ? (s ? (k === 'soil' && s.soilPh != null ? `pH đất ${s.soilPh.toFixed(2)} · EC ${String(s.soilEc).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} µS/cm · ${fmtHM(s.t)}` : `Lần đo ${fmtHM(s.t)} · chu kỳ ${C.sampleMinutes} phút`) : '')
        : `Ngắt lúc ${fmtHM(since)} · ${fmtDM(since)} — ${fmtDur(Date.now() - since)}`;
    });
    const total = SENSORS.length;
    $('summary').textContent = offCount === 0 ? `Cả ${total} cảm biến đang hoạt động` : offCount === total ? `Cả ${total} cảm biến đã tắt` : `${offCount} cảm biến đang tắt`;
    $('allOn').hidden = offCount === 0;
    renderLog();
  }

  function renderLog() {
    const log = B.log || [];
    $('logCount').textContent = log.length ? `${log.length} gần nhất` : '';
    $('logList').innerHTML = log.length ? log.slice(0, 15).map(e => `
      <li class="${e.on ? 'on' : 'off'}">
        <i aria-hidden="true"></i>
        <div><b>${e.on ? 'Bật' : 'Tắt'} ${SENSOR[e.sensor] ? SENSOR[e.sensor].short : e.sensor}</b><span>${escapeHtml(e.by || '')}</span></div>
        <time>${fmtHM(e.t)}<br>${fmtDM(e.t)}</time>
      </li>`).join('') : '<li class="empty">Chưa có thao tác nào.</li>';
  }
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- actions ----------
  let undoTimer = null;
  async function setSensor(k, on, { undo = true } = {}) {
    if (pending.has(k)) return;
    pending.add(k); haptic(12); render();
    try {
      await B.setSensor(k, on);
      if (undo) snack(`${on ? 'Đã bật' : 'Đã tắt'} cảm biến ${SENSOR[k].short}`, () => setSensor(k, !on, { undo: false }));
    } catch (e) {
      if (e.status === 401) { show('viewLogin'); $('loginError').textContent = 'Phiên đăng nhập đã hết hạn, vui lòng nhập lại PIN.'; }
      else snack(`Không gửi được lệnh: ${e.message || 'lỗi mạng'}`);
      haptic([30, 40, 30]);
    } finally {
      pending.delete(k); render();
    }
  }
  const toggle = k => setSensor(k, !Sensors.isOn(k));

  function snack(text, undoFn) {
    const el = $('snack');
    $('snackText').textContent = text;
    const btn = $('snackUndo');
    btn.hidden = !undoFn;
    btn.onclick = () => { el.hidden = true; clearTimeout(undoTimer); undoFn && undoFn(); };
    el.hidden = false;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // ---------- boot ----------
  async function boot() {
    $('stationName').textContent = C.station.name;
    await B.ready;
    if (B.mode !== 'server') { setConn('off', 'Bản tĩnh'); show('viewStatic'); return; }
    Store.init(1);
    buildTiles();
    B.on(ev => {
      if (ev.type === 'connection') setConn(ev.connected ? 'on' : 'wait', ev.connected ? 'Trực tuyến' : 'Đang kết nối lại…');
      if (ev.type === 'state' && !$('viewPanel').hidden) render();
    });
    setConn('on', 'Trực tuyến');
    if (B.authed) { show('viewPanel'); render(); } else { show('viewLogin'); setTimeout(() => $('pin').focus(), 50); }
    setInterval(() => { if (!$('viewPanel').hidden) render(); }, 15000);
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = $('pin').value.trim();
    if (!pin) { $('loginError').textContent = 'Vui lòng nhập mã PIN.'; return; }
    $('loginBtn').disabled = true; $('loginBtn').textContent = 'Đang kiểm tra…'; $('loginError').textContent = '';
    try {
      await B.login(pin);
      $('pin').value = '';
      show('viewPanel'); render(); haptic(10);
    } catch (err) {
      $('loginError').textContent = err.message || 'Không đăng nhập được';
      $('pin').select(); haptic([30, 40, 30]);
    } finally {
      $('loginBtn').disabled = false; $('loginBtn').textContent = 'Đăng nhập';
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    try { await B.logout(); } catch (e) {}
    show('viewLogin');
  });
  $('allOn').addEventListener('click', () => SENSORS.forEach(k => { if (!Sensors.isOn(k)) setSensor(k, true, { undo: false }); }));
  $('themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('aq-theme', next); } catch (e) {}
    document.querySelector('meta[name="theme-color"]').setAttribute('content', next === 'dark' ? '#16202a' : '#ffffff');
  });

  boot();
})();
