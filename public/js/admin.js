/* Panel de administración */
(function () {
  'use strict';
  const { $, esc, api, toast } = PDM;
  let data = null;
  let editingId = null;
  let slots = [null, null, null]; // {type:'keep', name, url} | {type:'new', file, url}
  let pickIndex = 0;

  function show(view) {
    $('#loginView').hidden = view !== 'login';
    $('#dashView').hidden = view !== 'dash';
    $('#logoutBtn').hidden = view !== 'dash';
  }

  async function init() {
    try {
      const me = await api('/api/admin/me');
      $('#pwWarn').hidden = !me.defaultPassword;
      show('dash');
      await load();
    } catch {
      show('login');
      $('#pw').focus();
    }
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
      $('#pw').value = '';
      $('#pwWarn').hidden = !r.defaultPassword;
      show('dash');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    show('login');
  });

  function handleAuth(err) {
    if (err.status === 401) { show('login'); toast('Tu sesión expiró, vuelve a entrar', 'warn'); return true; }
    return false;
  }

  /* ---------- Cargar datos ---------- */
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  async function load() {
    try {
      data = await api('/api/admin/data');
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'err');
      return;
    }
    const s = data.settings;
    $('#setOpen').checked = !!s.votingOpen;
    $('#setShow').checked = !!s.showResults;
    $('#setStrict').checked = s.strictMode !== false;
    $('#setClose').value = toLocalInput(s.closesAt);
    $('#liveState').textContent = s.votingOpenNow ? '🟢 Abierta: la gente puede votar' : '🔴 Cerrada: nadie puede votar';
    $('#totalInfo').textContent = `${data.totalVotes} votos en total · ${data.doors.length} puertas`;
    renderDoors();
  }

  function renderDoors() {
    const list = $('#doorList');
    if (!data.doors.length) {
      list.innerHTML = '<p class="hint">Aún no hay puertas. Agrega la primera con el formulario de arriba. 👆</p>';
      return;
    }
    const sorted = [...data.doors].sort((a, b) => b.votes - a.votes);
    list.innerHTML = sorted.map((d) => `
      <div class="admin-door">
        ${d.photos[0] ? `<img src="${esc(d.photos[0])}" alt="">` : '<div></div>'}
        <div class="meta">
          <strong>${esc(d.name)}</strong>
          <small>${esc(d.team || 'Sin equipo')} · ${d.photos.length} foto(s) · <b style="color:var(--marigold2)">${d.votes} votos</b></small><br>
          <small style="word-break:break-all">${esc(data.baseUrl + d.url)}</small>
        </div>
        <div class="acts">
          <button type="button" data-act="copy" data-id="${esc(d.id)}">🔗 Copiar link</button>
          <a href="${esc(d.url)}" target="_blank">👁️ Ver</a>
          <a href="/qr/${esc(d.id)}.png" target="_blank" download="qr-${esc(d.id)}.png">▦ QR</a>
          <button type="button" data-act="edit" data-id="${esc(d.id)}">✏️ Editar</button>
          <button type="button" class="del" data-act="del" data-id="${esc(d.id)}">🗑️ Borrar</button>
        </div>
      </div>`).join('');
  }

  $('#doorList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = data.doors.find((x) => x.id === b.dataset.id);
    if (!d) return;
    if (b.dataset.act === 'copy') {
      if (await PDM.copy(data.baseUrl + d.url)) toast('Link copiado 📋', 'ok');
    } else if (b.dataset.act === 'edit') {
      startEdit(d);
    } else if (b.dataset.act === 'del') {
      const ok = await PDM.confirm({ title: '¿Borrar esta puerta?', html: `Se eliminará <strong>${esc(d.name)}</strong>, sus fotos y sus <strong>${d.votes} votos</strong>. No se puede deshacer.`, ok: 'Sí, borrar', icon: '🗑️' });
      if (!ok) return;
      try {
        await api('/api/admin/doors/' + d.id, { method: 'DELETE' });
        toast('Puerta eliminada', 'ok');
        if (editingId === d.id) resetForm();
        load();
      } catch (err) { if (!handleAuth(err)) toast(err.message, 'err'); }
    }
  });

  /* ---------- Ajustes ---------- */
  $('#saveSettings').addEventListener('click', async () => {
    const v = $('#setClose').value;
    try {
      await api('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ votingOpen: $('#setOpen').checked, showResults: $('#setShow').checked, strictMode: $('#setStrict').checked, closesAt: v ? new Date(v).toISOString() : null })
      });
      toast('Ajustes guardados ✔️', 'ok');
      load();
    } catch (err) { if (!handleAuth(err)) toast(err.message, 'err'); }
  });
  $('#resetVotes').addEventListener('click', async () => {
    const ok = await PDM.confirm({ title: '¿Borrar TODOS los votos?', html: `Se eliminarán los <strong>${data ? data.totalVotes : 0} votos</strong> registrados y todos podrán votar otra vez. Úsalo solo para reiniciar después de hacer pruebas.`, ok: 'Borrar votos', icon: '⚠️' });
    if (!ok) return;
    try {
      await api('/api/admin/reset-votes', { method: 'POST' });
      toast('Votos reiniciados', 'ok');
      load();
    } catch (err) { if (!handleAuth(err)) toast(err.message, 'err'); }
  });

  /* ---------- Formulario de puerta ---------- */
  function renderSlots() {
    $('#slots').innerHTML = slots.map((s, i) => s
      ? `<div class="slot" data-i="${i}"><img src="${esc(s.url)}" alt=""><span class="num">${i === 0 ? 'Portada' : 'Foto ' + (i + 1)}</span><button type="button" class="rm" data-rm="${i}" aria-label="Quitar foto">✕</button></div>`
      : `<div class="slot" data-i="${i}">📷<br>Agregar foto ${i + 1}</div>`
    ).join('');
  }
  $('#slots').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const i = Number(rm.dataset.rm);
      if (slots[i] && slots[i].type === 'new') URL.revokeObjectURL(slots[i].url);
      slots[i] = null;
      slots = [...slots.filter(Boolean), null, null, null].slice(0, 3);
      renderSlots();
      return;
    }
    const slot = e.target.closest('.slot');
    if (!slot) return;
    pickIndex = Number(slot.dataset.i);
    $('#fileInput').click();
  });
  $('#fileInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    let i = pickIndex;
    for (const f of files) {
      if (slots[i] && slots[i].type === 'new') URL.revokeObjectURL(slots[i].url);
      slots[i] = { type: 'new', file: f, url: URL.createObjectURL(f) };
      i = slots.findIndex((s, k) => !s && k !== i);
      if (i < 0) break;
    }
    slots = [...slots.filter(Boolean), null, null, null].slice(0, 3);
    renderSlots();
  });
  $('#fDesc').addEventListener('input', () => { $('#descCount').textContent = $('#fDesc').value.length; });

  async function compress(file, max = 1600, quality = 0.8) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 350 * 1024 && file.type === 'image/jpeg') return file;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      const x = c.getContext('2d');
      x.fillStyle = '#0d0412';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(bmp, 0, 0, c.width, c.height);
      let blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size > 3.8 * 1024 * 1024) {
        // Si aun así se pasa de 3.8 MB, re-comprime más fuerte
        const c2 = document.createElement('canvas');
        const k2 = Math.min(1, 1200 / Math.max(c.width, c.height));
        c2.width = Math.round(c.width * k2);
        c2.height = Math.round(c.height * k2);
        const x2 = c2.getContext('2d');
        x2.drawImage(c, 0, 0, c2.width, c2.height);
        blob = await new Promise((r) => c2.toBlob(r, 'image/jpeg', 0.7)) || blob;
      }
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch {
      return file;
    }
  }

  function resetForm() {
    editingId = null;
    slots.forEach((s) => { if (s && s.type === 'new') URL.revokeObjectURL(s.url); });
    slots = [null, null, null];
    $('#doorForm').reset();
    $('#descCount').textContent = '0';
    $('#formTitle').textContent = '➕ Agregar una puerta';
    $('#submitBtn').textContent = 'Guardar puerta';
    $('#cancelEdit').hidden = true;
    renderSlots();
  }
  function startEdit(d) {
    resetForm();
    editingId = d.id;
    $('#fName').value = d.name;
    $('#fTeam').value = d.team || '';
    $('#fDesc').value = d.description || '';
    $('#descCount').textContent = $('#fDesc').value.length;
    slots = [0, 1, 2].map((i) => (d.files[i] ? { type: 'keep', name: d.files[i], url: d.photos[i] } : null));
    $('#formTitle').textContent = `✏️ Editando: ${d.name}`;
    $('#submitBtn').textContent = 'Guardar cambios';
    $('#cancelEdit').hidden = false;
    renderSlots();
    $('#formCard').scrollIntoView({ behavior: 'smooth' });
  }
  $('#cancelEdit').addEventListener('click', resetForm);

  $('#doorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const filled = slots.filter(Boolean);
    if (!filled.length) return toast('Agrega al menos 1 foto', 'warn');
    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = 'Subiendo… 👻';
    try {
      const name = $('#fName').value;
      const team = $('#fTeam').value;
      const description = $('#fDesc').value;

      // Prepara y comprime fotos
      const preparedSlots = [];
      let totalNewBytes = 0;
      let newCount = 0;
      for (const s of filled) {
        if (s.type === 'keep') {
          preparedSlots.push({ type: 'keep', name: s.name });
        } else {
          const comp = await compress(s.file, 1600, 0.8);
          totalNewBytes += comp.size;
          preparedSlots.push({ type: 'new', file: comp, index: newCount++ });
        }
      }

      // Si el tamaño total de nuevas fotos supera 3.8 MB y hay más de 1 foto nueva,
      // se suben una por una para no rebasar el límite de 4.5 MB de Vercel.
      const shouldUploadOneByOne = newCount > 1 && totalNewBytes > 3.8 * 1024 * 1024;

      if (!shouldUploadOneByOne) {
        const fd = new FormData();
        fd.append('name', name);
        fd.append('team', team);
        fd.append('description', description);
        const order = [];
        let n = 0;
        for (const s of preparedSlots) {
          if (s.type === 'keep') order.push('keep:' + s.name);
          else { order.push('new:' + n++); fd.append('photos', s.file); }
        }
        fd.append('order', JSON.stringify(order));
        const url = editingId ? '/api/admin/doors/' + editingId : '/api/admin/doors';
        const r = await api(url, { method: editingId ? 'PUT' : 'POST', body: fd });
        toast(editingId ? 'Cambios guardados ✔️' : `Puerta "${r.door.name}" creada 🎉`, 'ok');
      } else {
        // Subida secuencial foto por foto
        let currentDoorId = editingId;
        const currentKept = preparedSlots.filter((s) => s.type === 'keep').map((s) => s.name);
        const newItems = preparedSlots.filter((s) => s.type === 'new');

        if (!currentDoorId) {
          // Crear puerta con la primera foto
          const first = newItems[0];
          const fd = new FormData();
          fd.append('name', name);
          fd.append('team', team);
          fd.append('description', description);
          fd.append('order', JSON.stringify(['new:0']));
          fd.append('photos', first.file);
          const r = await api('/api/admin/doors', { method: 'POST', body: fd });
          currentDoorId = r.door.id;
          currentKept.push(r.door.files ? r.door.files[0] : (r.door.photos ? r.door.photos[0] : ''));
          newItems.shift();
        }

        // Subir las fotos restantes una a una vía PUT
        for (const item of newItems) {
          const fd = new FormData();
          fd.append('name', name);
          fd.append('team', team);
          fd.append('description', description);
          const order = currentKept.map((f) => 'keep:' + f);
          order.push('new:0');
          fd.append('order', JSON.stringify(order));
          fd.append('photos', item.file);
          const r = await api('/api/admin/doors/' + currentDoorId, { method: 'PUT', body: fd });
          const newFile = (r.door.files || r.door.photos || []).find((f) => !currentKept.includes(f));
          if (newFile) currentKept.push(newFile);
        }
        toast(editingId ? 'Cambios guardados ✔️' : 'Puerta creada 🎉', 'ok');
      }

      resetForm();
      await load();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = editingId ? 'Guardar cambios' : 'Guardar puerta';
    }
  });

  renderSlots();
  init();
})();
