/* =========================================================
   Keyboard controls (no visible switches on the page)
   - shortcuts turn each sensor on/off
   - a hidden shortcut opens the key-binding dialog
   - bindings are saved in this browser (localStorage)
   - recovery: open the page with #phim-tat in the URL to show the dialog
   ========================================================= */
(function () {
  const C = window.AQ_CONFIG;
  const { Sensors } = window.AQData;
  const LS_KEY = 'aq-keybinds';
  const HASH = '#phim-tat';

  const ACTIONS = [
    { id: 'toggle-ph',  label: 'Bật / tắt cảm biến pH',      sensor: 'ph' },
    { id: 'toggle-sal', label: 'Bật / tắt cảm biến độ mặn',  sensor: 'sal' },
    { id: 'open-binder', label: 'Mở hộp thoại cài đặt phím', required: true }
  ];

  // ---------- parsing / formatting ----------
  const NAMED = {
    '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
    ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', SPACE: 'Space', ENTER: 'Enter',
    UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', HOME: 'Home', END: 'End',
    PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', INSERT: 'Insert', DELETE: 'Delete'
  };
  const LABEL = Object.fromEntries(Object.entries(NAMED).map(([k, v]) => [v, k.length > 1 ? k[0] + k.slice(1).toLowerCase() : k]));
  Object.assign(LABEL, { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn' });

  function parse(str) { // "Ctrl+Alt+K" → binding
    if (!str) return null;
    const parts = String(str).split('+').map(s => s.trim()).filter(Boolean);
    const b = { ctrl: false, alt: false, shift: false, meta: false, code: '' };
    parts.forEach(p => {
      const u = p.toUpperCase();
      if (u === 'CTRL' || u === 'CONTROL') b.ctrl = true;
      else if (u === 'ALT' || u === 'OPTION') b.alt = true;
      else if (u === 'SHIFT') b.shift = true;
      else if (u === 'META' || u === 'WIN' || u === 'CMD') b.meta = true;
      else if (/^[0-9]$/.test(p)) b.code = 'Digit' + p;
      else if (/^[A-Z]$/i.test(p)) b.code = 'Key' + u;
      else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(p)) b.code = u;
      else if (/^NUM ?[0-9]$/i.test(p)) b.code = 'Numpad' + p.slice(-1);
      else b.code = NAMED[u] || NAMED[p] || p;
    });
    return b.code ? b : null;
  }
  function codeLabel(code) {
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
    return LABEL[code] || code;
  }
  function label(b) {
    if (!b) return 'Chưa gán';
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    return [b.ctrl && 'Ctrl', b.alt && (isMac ? 'Option' : 'Alt'), b.shift && 'Shift', b.meta && (isMac ? '⌘' : 'Win'), codeLabel(b.code)].filter(Boolean).join(' + ');
  }
  const same = (a, b) => !!a && !!b && a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
  const fromEvent = e => ({ code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  const hasMod = b => b.ctrl || b.alt || b.meta;
  const isFKey = code => /^F\d+$/.test(code);

  // combos the browser / OS keeps for itself – they never reach the page
  const RESERVED = ['Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+F4', 'Ctrl+Q', 'Ctrl+Shift+Q', 'Win+L', 'Win+D'].map(parse);

  // ---------- state ----------
  const DEFAULTS = Object.fromEntries(ACTIONS.map(a => [a.id, parse((C.shortcuts || {})[a.id])]));
  let binds = load();
  function load() {
    const out = { ...DEFAULTS };
    try {
      const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (v) ACTIONS.forEach(a => { if (a.id in v) out[a.id] = v[a.id] && v[a.id].code ? v[a.id] : (a.required ? out[a.id] : null); });
    } catch (e) {}
    return out;
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(binds)); } catch (e) {} }

  // ---------- actions ----------
  function toggleSensor(k) {
    const on = Sensors.toggle(k);
    const sc = C.sensors[k];
    const name = k === 'ph' ? 'pH' : 'độ mặn';
    toast(on ? 'info' : 'critical',
      on ? `Cảm biến ${name} đã kết nối lại` : `Mất kết nối cảm biến ${name}`,
      `${sc.model} · Modbus ID ${String(sc.address).padStart(2, '0')}`);
    window.dispatchEvent(new CustomEvent('aq:sensors', { detail: { sensor: k, on } }));
    if (dialog && !dialog.hidden) renderList();
  }
  function run(id) {
    const a = ACTIONS.find(x => x.id === id);
    if (!a) return;
    if (a.sensor) toggleSensor(a.sensor);
    else if (id === 'open-binder') openDialog();
  }

  // ---------- toasts ----------
  let stack;
  function toast(level, title, desc) {
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
    const color = { critical: '--critical', warn: '--warn', info: '--good' }[level] || '--text-3';
    const icon = { critical: '✕', warn: '!', info: '✓' }[level] || 'i';
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--badge', `var(${color})`);
    t.innerHTML = `<span class="status-icon">${icon}</span><div><b></b><p></p></div>`;
    t.querySelector('b').textContent = title;
    t.querySelector('p').textContent = desc;
    stack.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3800);
  }

  // ---------- dialog ----------
  let dialog, listEl, msgEl, capturing = null, lastFocus = null;
  function build() {
    dialog = document.createElement('div');
    dialog.className = 'kb-backdrop';
    dialog.hidden = true;
    dialog.innerHTML = `
      <div class="kb-dialog" role="dialog" aria-modal="true" aria-labelledby="kbTitle">
        <div class="kb-head">
          <div><div class="eyebrow">Cài đặt vận hành</div><h2 id="kbTitle">Phím tắt điều khiển cảm biến</h2></div>
          <button class="icon-btn" data-kb-close aria-label="Đóng">✕</button>
        </div>
        <p class="kb-hint">Chọn <b>Đổi phím</b> rồi nhấn tổ hợp mới. <kbd>Esc</kbd> để huỷ, <kbd>Backspace</kbd> để bỏ gán. Phím được lưu trên trình duyệt này.</p>
        <ul class="kb-list"></ul>
        <div class="kb-msg" role="status" aria-live="polite"></div>
        <div class="kb-foot">
          <button class="btn" data-kb-reset>Khôi phục mặc định</button>
          <button class="btn btn--primary" data-kb-close>Xong</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    listEl = dialog.querySelector('.kb-list');
    msgEl = dialog.querySelector('.kb-msg');
    dialog.addEventListener('click', e => {
      if (e.target === dialog || e.target.closest('[data-kb-close]')) return closeDialog();
      if (e.target.closest('[data-kb-reset]')) { binds = { ...DEFAULTS }; save(); stopCapture(); renderList(); return msg('ok', 'Đã khôi phục phím mặc định.'); }
      const rb = e.target.closest('[data-rebind]');
      if (rb) startCapture(rb.dataset.rebind);
    });
  }
  function renderList() {
    listEl.innerHTML = ACTIONS.map(a => {
      const st = a.sensor ? (Sensors.isOn(a.sensor) ? '<span class="kb-state on">Đang hoạt động</span>' : '<span class="kb-state off">Đang tắt</span>') : '<span class="kb-state">Phím ẩn</span>';
      const listening = capturing === a.id;
      return `<li class="kb-row${listening ? ' is-listening' : ''}">
        <div class="kb-row__text"><b>${a.label}</b>${st}</div>
        <kbd class="kb-key${binds[a.id] ? '' : ' is-empty'}">${listening ? 'Nhấn tổ hợp phím…' : label(binds[a.id])}</kbd>
        <button class="btn btn--sm" data-rebind="${a.id}">${listening ? 'Đang chờ…' : 'Đổi phím'}</button>
      </li>`;
    }).join('');
  }
  function msg(type, text) { msgEl.className = 'kb-msg ' + (type || ''); msgEl.textContent = text || ''; }
  function openDialog() {
    if (!dialog) build();
    if (!dialog.hidden) return;
    lastFocus = document.activeElement;
    capturing = null; msg('', '');
    renderList();
    dialog.hidden = false;
    requestAnimationFrame(() => dialog.classList.add('show'));
    dialog.querySelector('[data-kb-close]').focus();
  }
  function closeDialog() {
    stopCapture();
    dialog.classList.remove('show');
    setTimeout(() => { dialog.hidden = true; }, 200);
    if (location.hash === HASH) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function startCapture(id) { capturing = id; msg('', 'Nhấn tổ hợp phím mới cho: ' + ACTIONS.find(a => a.id === id).label); renderList(); }
  function stopCapture() { capturing = null; if (listEl) renderList(); }

  function handleCapture(e) {
    e.preventDefault(); e.stopPropagation();
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return; // wait for the main key
    const a = ACTIONS.find(x => x.id === capturing);
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (plain && e.code === 'Escape') { stopCapture(); return msg('', 'Đã huỷ.'); }
    if (plain && (e.code === 'Backspace' || e.code === 'Delete')) {
      if (a.required) return msg('err', 'Phím mở hộp thoại không thể để trống.');
      binds[a.id] = null; save(); stopCapture(); return msg('ok', `Đã bỏ gán phím cho "${a.label}".`);
    }
    const b = fromEvent(e);
    if (['Tab', 'Enter', 'Escape'].includes(b.code) && !hasMod(b)) return msg('err', 'Phím này dùng để điều hướng, hãy chọn tổ hợp khác.');
    if (RESERVED.some(r => same(r, b))) return msg('err', `${label(b)} do trình duyệt/hệ điều hành giữ lại, hãy chọn tổ hợp khác.`);
    const clash = ACTIONS.find(x => x.id !== a.id && same(binds[x.id], b));
    if (clash) return msg('err', `${label(b)} đang dùng cho "${clash.label}".`);
    binds[a.id] = b; save(); stopCapture();
    msg(hasMod(b) || isFKey(b.code) ? 'ok' : 'warn',
      `Đã gán ${label(b)} cho "${a.label}".` + (hasMod(b) || isFKey(b.code) ? '' : ' Lưu ý: phím đơn dễ bị bấm nhầm, nên dùng kèm Ctrl/Alt.'));
  }

  // ---------- global listener ----------
  document.addEventListener('keydown', e => {
    if (capturing && dialog && !dialog.hidden) return handleCapture(e);
    if (dialog && !dialog.hidden && e.key === 'Escape') { e.preventDefault(); return closeDialog(); }
    if (e.repeat || e.isComposing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const hit = ACTIONS.find(a => same(binds[a.id], fromEvent(e)));
    if (hit) { e.preventDefault(); e.stopPropagation(); run(hit.id); }
  }, true);

  // keep focus inside the dialog while it is open
  document.addEventListener('focusin', e => {
    if (dialog && !dialog.hidden && !dialog.contains(e.target)) dialog.querySelector('[data-kb-close]').focus();
  });

  // recovery path: page.html#phim-tat
  const checkHash = () => { if (location.hash === HASH) openDialog(); };
  window.addEventListener('hashchange', checkHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkHash); else checkHash();

  window.AQControls = { open: openDialog, label: () => Object.fromEntries(ACTIONS.map(a => [a.id, label(binds[a.id])])) };
})();
