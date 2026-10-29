/* Utilidades compartidas: API, huella del dispositivo, pétalos, sonido, modales */
(function () {
  'use strict';
  const PDM = (window.PDM = {});
  const $ = (PDM.$ = (s, r = document) => r.querySelector(s));
  PDM.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = (PDM.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  PDM.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  PDM.api = async (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let r;
    try {
      r = await fetch(url, { credentials: 'same-origin', ...opts, headers });
    } catch {
      throw Object.assign(new Error('Sin conexión con el servidor. Revisa tu internet.'), { status: 0, data: {} });
    }
    let data = {};
    try { data = await r.json(); } catch { /* sin json */ }
    if (!r.ok) throw Object.assign(new Error(data.error || 'Ocurrió un error'), { status: r.status, data });
    return data;
  };

  /* ---------- Identidad del dispositivo ---------- */
  function rid() {
    const a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  PDM.token = () => {
    try {
      let t = localStorage.getItem('pdm_token');
      if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) {
        t = rid();
        localStorage.setItem('pdm_token', t);
      }
      return t;
    } catch {
      return '';
    }
  };
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  let fpPromise = null;
  PDM.fingerprint = () =>
    fpPromise ||
    (fpPromise = (async () => {
      const n = navigator;
      const parts = [
        n.userAgent,
        (n.languages || [n.language]).join(','),
        n.platform || '',
        n.hardwareConcurrency || '',
        n.deviceMemory || '',
        n.maxTouchPoints || 0,
        Math.min(screen.width, screen.height) + 'x' + Math.max(screen.width, screen.height) + 'x' + screen.colorDepth,
        window.devicePixelRatio || 1
      ];
      try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* */ }
      try {
        const c = document.createElement('canvas');
        c.width = 260; c.height = 60;
        const x = c.getContext('2d');
        x.textBaseline = 'top';
        x.font = '16px Arial';
        x.fillStyle = '#f60'; x.fillRect(120, 1, 62, 20);
        x.fillStyle = '#069'; x.fillText('Puertas 💀 Día de Muertos', 2, 15);
        x.fillStyle = 'rgba(102,204,0,0.7)'; x.fillText('Puertas 💀 Día de Muertos', 4, 17);
        x.globalCompositeOperation = 'multiply';
        x.fillStyle = 'rgb(255,0,255)'; x.beginPath(); x.arc(50, 30, 30, 0, Math.PI * 2); x.fill();
        parts.push(c.toDataURL());
      } catch { /* */ }
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        if (gl) {
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          parts.push(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      } catch { /* */ }
      const s = parts.join('||');
      return cyrb53(s, 1) + cyrb53(s, 2) + cyrb53(s, 3) + cyrb53(s, 4);
    })());

  /* ---------- Toast ---------- */
  let toastEl, toastTimer;
  PDM.toast = (msg, type = '') => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.className = 'toast ' + type;
    toastEl.textContent = msg;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
  };

  /* ---------- Modal de confirmación ---------- */
  PDM.confirm = ({ title, html, ok = 'Aceptar', cancel = 'Cancelar', icon = '💀' }) =>
    new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-skull">${icon}</div><h3>${title}</h3><p>${html}</p>
        <div class="modal-actions">${cancel ? `<button class="btn btn-ghost" data-r="0">${cancel}</button>` : ''}
        <button class="btn btn-blood" data-r="1">${ok}</button></div></div>`;
      document.body.appendChild(m);
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      function close(v) {
        document.removeEventListener('keydown', onKey);
        m.classList.add('out');
        setTimeout(() => m.remove(), 250);
        resolve(v);
      }
      document.addEventListener('keydown', onKey);
      m.addEventListener('click', (e) => {
        if (e.target === m) return close(false);
        const b = e.target.closest('[data-r]');
        if (b) close(b.dataset.r === '1');
      });
      m.querySelector('[data-r="1"]').focus();
    });

  PDM.lightbox = (src, alt = '') => {
    const l = document.createElement('div');
    l.className = 'lightbox';
    l.innerHTML = `<img src="${PDM.esc(src)}" alt="${PDM.esc(alt)}">`;
    const close = () => { l.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    l.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(l);
  };

  /* ---------- Compartir ---------- */
  PDM.copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* */ }
      t.remove();
      return ok;
    }
  };
  PDM.share = async ({ title, text, url }) => {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (await PDM.copy(url)) PDM.toast('Link copiado 📋 ¡Pégalo donde quieras!', 'ok');
    else window.prompt('Copia este link:', url);
  };

  PDM.animateNumber = (el, to) => {
    if (!el) return;
    const from = parseInt(el.textContent, 10) || 0;
    if (from === to || reduceMotion) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  PDM.tilt = (el, max = 10) => {
    if (!el || reduceMotion || window.matchMedia('(hover: none)').matches) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${x * max}deg) rotateX(${-y * max}deg)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  };

  /* ---------- Papel picado ---------- */
  PDM.papelPicado = (box) => {
    if (!box) return;
    const colors = ['#e0218a', '#ff8a00', '#7a2fb5', '#2ad1c0', '#ffd000', '#ff2244', '#3b82f6'];
    const motifs = ['💀', '✿', '✝', '❀', '☾', '✦'];
    const n = Math.ceil(window.innerWidth / 62) + 1;
    box.innerHTML = Array.from({ length: n }, (_, i) =>
      `<div class="flag" style="background:${colors[i % colors.length]};animation-delay:${(-i * 0.37).toFixed(2)}s">${motifs[i % motifs.length]}</div>`
    ).join('');
  };

  /* ---------- Pétalos de cempasúchil ---------- */
  const pc = $('#petals');
  PDM.burst = () => {};
  if (pc && pc.getContext) {
    const ctx = pc.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const petals = [];
    const colors = ['#ff8a00', '#ffb627', '#ff6a00', '#ffd000', '#e0218a'];
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = pc.width = window.innerWidth * dpr;
      H = pc.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);
    const make = (x, y, burst) => ({
      x: x ?? Math.random() * W,
      y: y ?? -20 * dpr,
      r: (4 + Math.random() * 6) * dpr,
      vx: burst ? (Math.random() - 0.5) * 16 * dpr : (Math.random() - 0.5) * 0.6 * dpr,
      vy: burst ? (-Math.random() * 13 - 3) * dpr : (0.5 + Math.random() * 1.1) * dpr,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.12,
      c: colors[(Math.random() * colors.length) | 0],
      sway: Math.random() * 6.28,
      burst: !!burst,
      life: 1
    });
    const base = reduceMotion ? 0 : window.innerWidth < 700 ? 16 : 36;
    for (let i = 0; i < base; i++) { const p = make(); p.y = Math.random() * H; petals.push(p); }
    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      for (let i = petals.length - 1; i >= 0; i--) {
        const p = petals[i];
        p.sway += 0.02;
        if (p.burst) { p.vy += 0.28 * dpr; p.vx *= 0.985; p.life -= 0.0065; }
        p.x += p.vx + Math.sin(p.sway) * 0.6 * dpr;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > H + 30 * dpr || p.life <= 0) {
          if (p.burst) { petals.splice(i, 1); continue; }
          Object.assign(p, make());
        }
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life) * 0.9;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    PDM.burst = (x = window.innerWidth / 2, y = window.innerHeight / 2, n = 140) => {
      for (let i = 0; i < n; i++) petals.push(make(x * dpr, y * dpr, true));
    };
  }

  /* ---------- Sonido ambiental (generado, sin archivos) ---------- */
  const soundBtn = $('#soundBtn');
  const Sound = (PDM.sound = {
    ctx: null, master: null, on: false, noiseBuf: null,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const master = (this.master = ctx.createGain());
      master.gain.value = 0;
      master.connect(ctx.destination);
      // Dron grave y tenebroso
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 360; lp.connect(master);
      [55, 55.35, 82.4, 110.6].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'sawtooth' : 'triangle';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = i < 2 ? 0.06 : 0.035;
        o.connect(g); g.connect(lp); o.start();
      });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = ctx.createGain(); lfoG.gain.value = 170;
      lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
      // Viento
      const len = ctx.sampleRate * 3;
      const buf = (this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate));
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9;
      const wg = ctx.createGain(); wg.gain.value = 0.06;
      noise.connect(bp); bp.connect(wg); wg.connect(master); noise.start();
      const wl = ctx.createOscillator(); wl.frequency.value = 0.11;
      const wlg = ctx.createGain(); wlg.gain.value = 380;
      wl.connect(wlg); wlg.connect(bp.frequency); wl.start();
      // Campanadas lejanas
      const bell = () => { if (this.on) this.bell(); setTimeout(bell, 15000 + Math.random() * 18000); };
      setTimeout(bell, 7000);
    },
    bell(freq = 174.6) {
      const ctx = this.ctx;
      if (!ctx || !this.on) return;
      const t = ctx.currentTime;
      [1, 2.76, 5.4, 8.93].forEach((m, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16 / (i + 1), t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5 / (i + 1));
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 4.6);
      });
    },
    thunder() {
      const ctx = this.ctx;
      if (!ctx || !this.on) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.6, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      s.connect(lp); lp.connect(g); g.connect(this.master); s.start(t); s.stop(t + 3);
    },
    set(on) {
      this.init();
      if (!this.ctx) return;
      this.on = on;
      if (on) this.ctx.resume();
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(on ? 0.5 : 0, t + 1.2);
      try { localStorage.setItem('pdm_sound', on ? '1' : '0'); } catch { /* */ }
      if (soundBtn) {
        soundBtn.textContent = on ? '🔊' : '🔇';
        soundBtn.classList.toggle('on', on);
        soundBtn.setAttribute('aria-label', on ? 'Silenciar' : 'Activar sonido');
      }
    },
    toggle() { this.set(!this.on); }
  });
  if (soundBtn) soundBtn.addEventListener('click', () => Sound.toggle());
  let wantsSound = false;
  try { wantsSound = localStorage.getItem('pdm_sound') === '1'; } catch { /* */ }
  if (wantsSound && !document.getElementById('intro')) {
    const first = () => { Sound.set(true); window.removeEventListener('pointerdown', first); };
    window.addEventListener('pointerdown', first);
  }

  /* ---------- Relámpagos ---------- */
  const flash = $('#flash');
  PDM.lightning = () => {
    if (!flash || reduceMotion) return;
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    document.dispatchEvent(new CustomEvent('pdm:lightning'));
    setTimeout(() => Sound.thunder(), 250);
  };
  if (flash && !reduceMotion) {
    const loop = () => setTimeout(() => { if (!document.hidden) PDM.lightning(); loop(); }, 20000 + Math.random() * 25000);
    loop();
  }
  PDM.celebrate = (x, y) => {
    PDM.burst(x, y, 160);
    PDM.lightning();
    if (Sound.on) { Sound.bell(261.6); setTimeout(() => Sound.bell(329.6), 350); }
  };

  /* ---------- Luz de vela que sigue al cursor ---------- */
  if (!reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      document.documentElement.style.setProperty('--mx', e.clientX + 'px');
      document.documentElement.style.setProperty('--my', e.clientY + 'px');
    }, { passive: true });
  }
})();
