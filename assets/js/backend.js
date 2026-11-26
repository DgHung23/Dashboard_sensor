/* =========================================================
   Backend link
   - Docker / server version: sensor on/off state lives on the server,
     every open screen gets changes instantly (Server-Sent Events).
   - GitHub Pages (no server): falls back to the static mode,
     state kept in this browser only (same behaviour as before).
   ========================================================= */
(function () {
  const { Sensors, Store } = window.AQData;
  // api/ sits at the site root, next to assets/ (works from / and from /control/, and under a sub-path)
  const API = (() => {
    try { return new URL('../../api/', document.currentScript.src).pathname; } catch (e) { return 'api/'; }
  })();
  let es = null;
  const listeners = new Set();

  const Backend = {
    mode: 'static',          // 'static' | 'server'
    authed: false,
    connected: false,
    log: [],
    ready: null,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async request(path, opts = {}) {
      const res = await fetch(API + path, {
        method: opts.method || 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aquasense' },
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) { const err = new Error((data && data.error) || res.statusText); err.status = res.status; err.data = data; throw err; }
      return data;
    },

    async setSensor(sensor, on) {
      if (this.mode !== 'server') { Sensors.set(sensor, on); return { local: true }; }
      const data = await this.request('sensors/' + sensor, { method: 'POST', body: { on } });
      applyState(data.state, false);
      return data;
    },
    async login(pin) {
      const d = await this.request('login', { method: 'POST', body: { pin, device: deviceName() } });
      this.authed = true; applyState(d.state, false);
      connectEvents();               // reopen the stream as a signed-in client (gets the control log)
      return d;
    },
    async logout() { await this.request('logout', { method: 'POST' }); this.authed = false; connectEvents(); emit({ type: 'auth' }); },
    deviceName
  };

  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Thiết bị';
    const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return br ? `${os} · ${br}` : os;
  }

  function emit(ev) { listeners.forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } }); }

  // apply a state snapshot from the server; `initial` = first load (no toasts)
  function applyState(state, initial) {
    if (!state) return;
    const before = { ph: Sensors.isOn('ph'), sal: Sensors.isOn('sal') };
    const from = Sensors.replace(state.intervals);
    if (typeof state.authed === 'boolean') Backend.authed = state.authed;
    if (Array.isArray(state.log)) Backend.log = state.log;
    if (Store.slots.length && isFinite(from)) Store.remaskFrom(from);
    const changes = ['ph', 'sal'].filter(k => Sensors.isOn(k) !== before[k]).map(k => ({ sensor: k, on: Sensors.isOn(k) }));
    emit({ type: 'state', initial, changes, state });
  }

  function connectEvents() {
    if (!window.EventSource) return;
    if (es) es.close();
    es = new EventSource(API + 'events');
    es.addEventListener('state', e => {
      try { applyState(JSON.parse(e.data), false); } catch (err) { console.error(err); }
    });
    es.onopen = () => { Backend.connected = true; emit({ type: 'connection', connected: true }); };
    es.onerror = () => { Backend.connected = false; emit({ type: 'connection', connected: false }); }; // EventSource retries by itself
  }

  async function detect() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    try {
      const res = await fetch(API + 'state', { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.server !== 'aquasense') return;
      Backend.mode = 'server';
      Sensors.remote = true;
      applyState(data, true);
      connectEvents();
    } catch (e) { /* static hosting (GitHub Pages) or offline */ }
    finally { clearTimeout(timer); }
  }

  Backend.ready = detect();
  window.AQBackend = Backend;
})();
