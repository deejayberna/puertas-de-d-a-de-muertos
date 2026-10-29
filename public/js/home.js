/* Página principal: puertas, votación, ranking */
(function () {
  'use strict';
  const { $, $$, esc, api, toast } = PDM;
  const state = { doors: [], settings: { votingOpen: true, showResults: true }, totalVotes: 0, votedDoorId: null, gridKey: '' };

  /* ---------- Intro ---------- */
  const intro = $('#intro');
  let seen = false;
  try { seen = sessionStorage.getItem('pdm_intro') === '1'; } catch { /* */ }
  if (seen || PDM.reduceMotion) intro.classList.add('gone');
  $('#enterBtn').addEventListener('click', () => {
    PDM.sound.set(true);
    intro.classList.add('opening');
    setTimeout(() => PDM.lightning(), 500);
    try { sessionStorage.setItem('pdm_intro', '1'); } catch { /* */ }
    setTimeout(() => intro.classList.add('gone'), 2700);
  });

  PDM.papelPicado($('#papelPicado'));
  let ppTimer;
  window.addEventListener('resize', () => { clearTimeout(ppTimer); ppTimer = setTimeout(() => PDM.papelPicado($('#papelPicado')), 300); });

  /* Título 3D que sigue al cursor */
  const title = $('#title3d');
  if (!PDM.reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      title.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 14}deg)`;
    }, { passive: true });
  }

  if (new URLSearchParams(location.search).get('nf')) {
    toast('Esa puerta ya no existe… o nunca existió 👻', 'warn');
    history.replaceState(null, '', '/');
  }

  /* ---------- Render ---------- */
  function renderStatus() {
    const el = $('#voteStatus');
    const voted = state.doors.find((d) => d.id === state.votedDoorId);
    if (state.votedDoorId) {
      el.innerHTML = `<span class="pill pill-ok">🕯️ Ya votaste por <strong>${esc(voted ? voted.name : 'una puerta')}</strong>. ¡Gracias!</span>`;
    } else if (!state.settings.votingOpen) {
      el.innerHTML = '<span class="pill pill-closed">⛓️ La votación está cerrada</span>';
    } else {
      el.innerHTML = '<span class="pill">💀 Tienes <strong>&nbsp;1 voto&nbsp;</strong> — úsalo con sabiduría</span>';
    }
    const tv = $('#thanksVote');
    if (voted) {
      tv.hidden = false;
      tv.innerHTML = `Tu voto fue para <strong>${esc(voted.name)}</strong>. Que las ánimas te lo agradezcan. 🕯️`;
    } else tv.hidden = true;
  }

  function leaderIds() {
    if (!state.settings.showResults) return [];
    const max = Math.max(0, ...state.doors.map((d) => d.votes || 0));
    return max > 0 ? state.doors.filter((d) => d.votes === max).map((d) => d.id) : [];
  }

  function voteLabel(d) {
    if (state.votedDoorId === d.id) return '🕯️ Votaste aquí';
    if (state.votedDoorId) return 'Ya votaste';
    if (!state.settings.votingOpen) return 'Votación cerrada';
    return '💀 Votar';
  }

  function doorCard(d, i, leaders) {
    const photo = d.photos[0];
    const mine = state.votedDoorId === d.id;
    const canVote = state.settings.votingOpen && !state.votedDoorId;
    return `<article class="door-card ${mine ? 'voted-for' : ''}" data-id="${esc(d.id)}">
      <div class="door-tilt">
        ${mine ? '<div class="voted-badge">🕯️ Tu voto</div>' : ''}
        ${leaders.includes(d.id) ? '<div class="leader-badge">👑 Va ganando</div>' : ''}
        <div class="door-frame" tabindex="0" role="button" aria-label="Abrir la puerta ${esc(d.name)}">
          <div class="door-arch"><span>💀</span></div>
          <div class="door-inside">${photo ? `<img src="${esc(photo)}" alt="Puerta ${esc(d.name)}" loading="lazy">` : '<div class="no-photo">👁️ 👁️</div>'}</div>
          <div class="leaf leaf-l"><span class="handle"></span></div>
          <div class="leaf leaf-r"><span class="handle"></span></div>
          <span class="door-num">Puerta ${i + 1}</span>
        </div>
        <div class="door-info">
          ${d.team ? `<p class="team">${esc(d.team)}</p>` : ''}
          <h3>${esc(d.name)}</h3>
          ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}
          ${state.settings.showResults ? `<p class="door-votes" data-votes="${esc(d.id)}">🔥 ${d.votes} ${d.votes === 1 ? 'voto' : 'votos'}</p>` : ''}
          <div class="door-actions">
            <a class="btn btn-ghost btn-sm" href="${esc(d.url)}">Ver puerta</a>
            <button class="btn btn-blood btn-sm vote-btn" type="button" data-id="${esc(d.id)}" ${canVote ? '' : 'disabled'}>${voteLabel(d)}</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  let io;
  function renderGrid() {
    const grid = $('#doorsGrid');
    if (!state.doors.length) {
      grid.innerHTML = '<div class="empty">🕸️ Todavía no hay puertas registradas.<br>Vuelve pronto: los equipos siguen decorando.</div>';
      return;
    }
    const leaders = leaderIds();
    grid.innerHTML = state.doors.map((d, i) => doorCard(d, i, leaders)).join('');
    $$('.door-tilt', grid).forEach((el) => PDM.tilt(el, 12));
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    $$('.door-card', grid).forEach((c, i) => {
      c.style.transitionDelay = (i % 3) * 120 + 'ms';
      io.observe(c);
    });
  }

  function updateCounts() {
    state.doors.forEach((d) => {
      const el = document.querySelector(`[data-votes="${CSS.escape(d.id)}"]`);
      if (el) el.textContent = `🔥 ${d.votes} ${d.votes === 1 ? 'voto' : 'votos'}`;
    });
  }

  function render() {
    const key = [state.doors.map((d) => d.id + d.name + d.photos.join()).join(), state.votedDoorId, state.settings.votingOpen, state.settings.showResults, leaderIds().join()].join('#');
    if (key !== state.gridKey) { state.gridKey = key; renderGrid(); } else updateCounts();
    PDM.renderRanking($('#rankingList'), state);
    renderStatus();
    PDM.animateNumber($('#statDoors'), state.doors.length);
    $('#statVotesWrap').hidden = !state.settings.showResults;
    if (state.settings.showResults) PDM.animateNumber($('#statVotes'), state.totalVotes || 0);
    tickCountdown();
  }

  /* ---------- Datos ---------- */
  async function loadStatus() {
    try {
      const r = await api('/api/status', { method: 'POST', body: JSON.stringify({ fp: await PDM.fingerprint(), ls: PDM.token() }) });
      state.votedDoorId = r.voted ? r.doorId : null;
    } catch { /* */ }
  }
  async function refresh() {
    try {
      const r = await api('/api/doors');
      state.doors = r.doors;
      state.settings = r.settings;
      state.totalVotes = r.totalVotes;
      render();
    } catch (e) {
      if (!state.doors.length) $('#doorsGrid').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
    }
  }

  /* ---------- Votar ---------- */
  async function vote(id, btn) {
    const d = state.doors.find((x) => x.id === id);
    if (!d) return;
    if (state.votedDoorId) return toast('Ya usaste tu único voto 💀', 'warn');
    const ok = await PDM.confirm({
      title: '¿Le das tu único voto?',
      html: `Vas a votar por <strong>${esc(d.name)}</strong>${d.team ? ` del equipo <strong>${esc(d.team)}</strong>` : ''}.<br><br>Esta decisión no se puede deshacer… como la muerte.`,
      ok: 'Sí, mi voto es suyo',
      cancel: 'Seguir viendo',
      icon: '🗳️'
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await api('/api/vote', { method: 'POST', body: JSON.stringify({ doorId: id, fp: await PDM.fingerprint(), ls: PDM.token() }) });
      state.votedDoorId = id;
      const r = btn.getBoundingClientRect();
      PDM.celebrate(r.left + r.width / 2, r.top);
      toast('¡Tu voto quedó grabado en piedra! 🕯️ Gracias por participar', 'ok');
      await refresh();
      setTimeout(() => $('#ranking').scrollIntoView({ behavior: 'smooth' }), 1400);
    } catch (e) {
      if (e.status === 409 && e.data.doorId) state.votedDoorId = e.data.doorId;
      toast(e.message, 'err');
      await refresh();
    }
  }

  const grid = $('#doorsGrid');
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.vote-btn');
    if (btn) return vote(btn.dataset.id, btn);
    const frame = e.target.closest('.door-frame');
    if (frame) frame.classList.toggle('open');
  });
  grid.addEventListener('keydown', (e) => {
    const frame = e.target.closest('.door-frame');
    if (frame && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); frame.classList.toggle('open'); }
  });

  /* ---------- Cuenta regresiva ---------- */
  let wasOpen = null;
  function tickCountdown() {
    const c = state.settings.closesAt;
    const wrap = $('#countdownWrap');
    if (!c) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const ms = Date.parse(c) - Date.now();
    const el = $('#countdown');
    if (ms <= 0) {
      el.textContent = '¡Cerrada!';
      if (wasOpen) { wasOpen = false; refresh(); }
      return;
    }
    wasOpen = true;
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
    const p = (n) => String(n).padStart(2, '0');
    el.textContent = d ? `${d}d ${h}h ${m}m` : `${p(h)}:${p(m)}:${p(s)}`;
  }
  setInterval(tickCountdown, 1000);

  $('#shareMain').addEventListener('click', () => PDM.share({
    title: 'Puertas de Día de Muertos',
    text: '💀 ¡Entra y vota por tu puerta favorita de Día de Muertos! Solo tienes 1 voto 🕯️',
    url: location.origin + '/'
  }));

  (async () => {
    await loadStatus();
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 8000);
  })();
})();
