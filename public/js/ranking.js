/* Render del ranking (usado en inicio y en la pantalla de resultados) */
(function () {
  'use strict';
  const { esc } = PDM;
  const lastKey = new WeakMap();
  PDM.renderRanking = (list, { doors, totalVotes, showResults, votedDoorId }) => {
    if (!list) return;
    if (!showResults) {
      const k = 'hidden';
      if (lastKey.get(list) === k) return;
      lastKey.set(list, k);
      list.innerHTML = '<li class="rank-hidden">🔮 Los resultados están ocultos por ahora.<br>Se revelarán al final del concurso… las ánimas guardan el secreto.</li>';
      return;
    }
    if (!doors.length) {
      lastKey.set(list, 'empty');
      list.innerHTML = '<li class="rank-hidden">Aún no hay puertas registradas.</li>';
      return;
    }
    const sorted = [...doors].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'es'));
    const key = sorted.map((d) => `${d.id}:${d.votes}:${d.name}:${d.photos[0] || ''}`).join('|') + '#' + votedDoorId;
    if (lastKey.get(list) === key) return;
    const first = !lastKey.has(list) || !String(lastKey.get(list)).includes(':');
    lastKey.set(list, key);
    const max = Math.max(1, sorted[0].votes);
    const total = totalVotes || 0;
    let place = 0, last = null;
    list.innerHTML = sorted.map((d, i) => {
      if (d.votes !== last) { place = i + 1; last = d.votes; }
      const pct = total ? Math.round((d.votes / total) * 100) : 0;
      const crown = place === 1 && d.votes > 0 ? '<span class="rank-crown">👑</span>' : '';
      const cls = place <= 3 && d.votes > 0 ? `rank-${place}` : '';
      return `<li class="rank-item ${cls} ${first ? 'anim' : ''} ${votedDoorId === d.id ? 'mine' : ''}" style="--i:${i}">
        <div class="rank-pos">${crown}${place}</div>
        ${d.photos[0] ? `<img class="rank-thumb" src="${esc(d.photos[0])}" alt="" loading="lazy">` : '<div class="rank-thumb"></div>'}
        <div class="rank-body">
          <a href="${esc(d.url)}" class="rank-name">${esc(d.name)}</a>
          ${d.team ? `<small class="rank-team">${esc(d.team)}</small>` : ''}
          <div class="rank-bar"><i data-w="${((d.votes / max) * 100).toFixed(1)}"></i></div>
        </div>
        <div class="rank-votes">${d.votes}<small>${d.votes === 1 ? 'voto' : 'votos'} · ${pct}%</small></div>
      </li>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      list.querySelectorAll('.rank-bar i').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    }));
  };
})();
