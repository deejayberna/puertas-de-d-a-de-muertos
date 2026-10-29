/* Página individual de una puerta: carrusel 3D, voto y compartir */
(function () {
  'use strict';
  const { $, esc, api, toast } = PDM;
  const id = document.body.dataset.doorId;
  const shareUrl = document.body.dataset.shareUrl || location.href;
  const state = { door: null, doors: [], settings: {}, totalVotes: 0, votedDoorId: null };

  /* ---------- Compartir ---------- */
  function setupShare(name) {
    const text = `💀 ¡Vota por la puerta "${name}" en Puertas de Día de Muertos! 🕯️`;
    const u = encodeURIComponent(shareUrl);
    const t = encodeURIComponent(text);
    $('#shWa').href = `https://wa.me/?text=${encodeURIComponent(text + ' ' + shareUrl)}`;
    $('#shFb').href = `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    $('#shTg').href = `https://t.me/share/url?url=${u}&text=${t}`;
    $('#shX').href = `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    $('#shCopy').onclick = async () => {
      if (navigator.share && window.matchMedia('(hover: none)').matches) return PDM.share({ title: name, text, url: shareUrl });
      if (await PDM.copy(shareUrl)) toast('Link copiado 📋', 'ok');
      else window.prompt('Copia este link:', shareUrl);
    };
    $('#qrImg').src = `/qr/${encodeURIComponent(id)}.png`;
  }

  /* ---------- Carrusel 3D ---------- */
  let rot = 0, n = 0, timer = null, items = [];
  function buildCarousel(photos) {
    const track = $('#track');
    n = photos.length;
    track.innerHTML = photos.map((p, i) => `<figure class="carousel-item" data-i="${i}"><img src="${esc(p)}" alt="Foto ${i + 1} de la puerta"></figure>`).join('');
    items = Array.from(track.children);
    $('#dots').innerHTML = photos.map((_, i) => `<button type="button" aria-label="Foto ${i + 1}" data-i="${i}"></button>`).join('');
    $('#carouselControls').hidden = n < 2;
    layout();
    if (n > 1 && !PDM.reduceMotion) autoplay();
  }
  function layout() {
    const w = $('#carousel').clientWidth;
    const track = $('#track');
    if (n < 2) {
      if (items[0]) items[0].style.transform = 'none';
      return;
    }
    const r = Math.round(w / 2 / Math.tan(Math.PI / n)) + 24;
    items.forEach((it, i) => { it.style.transform = `rotateY(${(i * 360) / n}deg) translateZ(${r}px)`; });
    track.style.transform = `translateZ(${-r}px) rotateY(${(-rot * 360) / n}deg)`;
    const active = ((rot % n) + n) % n;
    Array.from($('#dots').children).forEach((d, i) => d.classList.toggle('on', i === active));
  }
  function go(delta) { rot += delta; layout(); }
  function autoplay() {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) go(1); }, 4500);
  }
  $('#prevBtn').addEventListener('click', () => { go(-1); autoplay(); });
  $('#nextBtn').addEventListener('click', () => { go(1); autoplay(); });
  $('#dots').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const target = Number(b.dataset.i);
    const cur = ((rot % n) + n) % n;
    let delta = target - cur;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    go(delta);
    autoplay();
  });
  const car = $('#carousel');
  let sx = null, moved = false;
  car.addEventListener('pointerdown', (e) => { sx = e.clientX; moved = false; });
  car.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 40 && n > 1) { moved = true; go(dx < 0 ? 1 : -1); autoplay(); }
  });
  car.addEventListener('click', (e) => {
    if (moved) return;
    const fig = e.target.closest('.carousel-item');
    if (!fig) return;
    const active = n ? ((rot % n) + n) % n : 0;
    const img = items[active] && items[active].querySelector('img');
    if (img) PDM.lightbox(img.src, img.alt);
  });
  window.addEventListener('resize', layout);
  PDM.tilt(car, 8);

  /* ---------- Render ---------- */
  function render() {
    const d = state.door;
    $('#doorName').textContent = d.name;
    $('#doorTeam').textContent = d.team || '';
    $('#doorDesc').textContent = d.description || '';
    document.title = `${d.name} · Puertas de Día de Muertos`;

    if (state.settings.showResults) {
      const sorted = [...state.doors].sort((a, b) => b.votes - a.votes);
      const place = sorted.findIndex((x) => x.votes === d.votes) + 1;
      const medal = place === 1 && d.votes > 0 ? '👑' : place === 2 && d.votes > 0 ? '🥈' : place === 3 && d.votes > 0 ? '🥉' : '🔥';
      $('#rankChip').innerHTML = `<span class="rank-chip">${medal} Lugar ${place} de ${state.doors.length} · ${d.votes} ${d.votes === 1 ? 'voto' : 'votos'}</span>`;
    } else $('#rankChip').innerHTML = '';

    const btn = $('#voteBtn');
    const hint = $('#voteHint');
    if (state.votedDoorId === d.id) {
      btn.disabled = true; btn.classList.remove('btn-pulse'); btn.textContent = '🕯️ Votaste por esta puerta';
      hint.textContent = '¡Gracias! Comparte el link para que más gente la vea.';
    } else if (state.votedDoorId) {
      const other = state.doors.find((x) => x.id === state.votedDoorId);
      btn.disabled = true; btn.classList.remove('btn-pulse'); btn.textContent = 'Ya usaste tu voto';
      hint.textContent = other ? `Tu voto fue para "${other.name}".` : 'Este dispositivo ya votó.';
    } else if (!state.settings.votingOpen) {
      btn.disabled = true; btn.classList.remove('btn-pulse'); btn.textContent = 'Votación cerrada';
      hint.textContent = 'Gracias por tu interés. Revisa los resultados en la página principal.';
    } else {
      btn.disabled = false; btn.textContent = '💀 Votar por esta puerta';
      hint.textContent = 'Recuerda: solo tienes 1 voto en total. ¿Ya viste las demás?';
    }

    const others = state.doors.filter((x) => x.id !== d.id);
    $('#othersWrap').hidden = !others.length;
    $('#others').innerHTML = others.map((o) => `<a class="other" href="${esc(o.url)}">${o.photos[0] ? `<img src="${esc(o.photos[0])}" alt="" loading="lazy">` : ''}<span>${esc(o.name)}</span></a>`).join('');
  }

  async function refresh(first) {
    const r = await api('/api/doors');
    state.doors = r.doors;
    state.settings = r.settings;
    state.totalVotes = r.totalVotes;
    const d = r.doors.find((x) => x.id === id);
    if (!d) { location.href = '/?nf=1'; return; }
    const photosChanged = !state.door || state.door.photos.join() !== d.photos.join();
    state.door = d;
    if (first || photosChanged) { buildCarousel(d.photos); setupShare(d.name); }
    render();
  }

  $('#voteBtn').addEventListener('click', async (e) => {
    const d = state.door;
    const ok = await PDM.confirm({
      title: '¿Le das tu único voto?',
      html: `Vas a votar por <strong>${esc(d.name)}</strong>${d.team ? ` del equipo <strong>${esc(d.team)}</strong>` : ''}.<br><br>Ya no podrás votar por ninguna otra puerta.`,
      ok: 'Sí, mi voto es suyo',
      cancel: 'Todavía no',
      icon: '🗳️'
    });
    if (!ok) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('/api/vote', { method: 'POST', body: JSON.stringify({ doorId: d.id, fp: await PDM.fingerprint(), ls: PDM.token() }) });
      state.votedDoorId = d.id;
      const r = btn.getBoundingClientRect();
      PDM.celebrate(r.left + r.width / 2, r.top);
      toast('¡Tu voto quedó grabado en piedra! 🕯️', 'ok');
    } catch (err) {
      if (err.status === 409 && err.data.doorId) state.votedDoorId = err.data.doorId;
      toast(err.message, 'err');
    }
    await refresh();
  });

  (async () => {
    try {
      const s = await api('/api/status', { method: 'POST', body: JSON.stringify({ fp: await PDM.fingerprint(), ls: PDM.token() }) });
      state.votedDoorId = s.voted ? s.doorId : null;
    } catch { /* */ }
    try { await refresh(true); } catch (e) { toast(e.message, 'err'); }
    setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 10000);
  })();
})();
