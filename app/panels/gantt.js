/* panels/gantt.js — 노드별 상태 타임라인(스윔레인/간트). 활동 많은 노드 상위 N개를
 * 시간축에 가로 막대로. 현재 시점 플레이헤드 동기화, 행 클릭 → 노드 선택. */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  const COL = { 1: 'var(--running)', 2: 'var(--success)', 3: 'var(--failure)', 4: 'var(--skipped)' };
  const CAP = 60, RH = 15, W = 1000;

  BTV.registerPanel({
    id: 'gantt', title: '간트', icon: '📈',
    mount(el) {
      el.innerHTML = `<div class="muted" style="margin-bottom:6px" id="gnote"></div><div id="gwrap" style="overflow:auto"></div>`;
      const wrap = el.querySelector('#gwrap'), note = el.querySelector('#gnote');
      function build() {
        const s = store.active; if (!s) { wrap.innerHTML = '<div class="empty-hint">세션 없음</div>'; note.textContent = ''; return; }
        const st = store.state.stats || {}, t0 = s.meta.t0, span = Math.max(1, s.meta.t1 - t0);
        // 활동(전이수) 상위 노드
        const uids = Object.keys(st).sort((a, b) => st[b].total - st[a].total).slice(0, CAP);
        note.textContent = `활동 상위 ${uids.length}개 노드 / 전체 ${Object.keys(st).length} · 행 클릭=선택`;
        const H = uids.length * RH;
        let rows = '';
        uids.forEach((uid, r) => {
          const arr = store.state.seq.get(uid) || [];
          let segs = '';
          for (let k = 0; k < arr.length; k++) {
            const stt = arr[k][1]; if (!COL[stt]) continue;
            const tA = s.timeline[arr[k][0]][0];
            const tB = (k + 1 < arr.length) ? s.timeline[arr[k + 1][0]][0] : s.meta.t1;
            const x = (tA - t0) / span * W, w = Math.max(1.2, (tB - tA) / span * W);
            segs += `<rect x="${x.toFixed(2)}" y="${r * RH + 2}" width="${w.toFixed(2)}" height="${RH - 4}" rx="2" fill="${COL[stt]}"/>`;
          }
          rows += segs;
        });
        const labels = uids.map((uid, r) => {
          const p = (s.nodes[uid] || ('#' + uid)).split('/').pop();
          return `<div class="grow" data-uid="${uid}" style="height:${RH}px;line-height:${RH}px;font-size:9.5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${s.nodes[uid] || uid}">${p}</div>`;
        }).join('');
        wrap.innerHTML = `<div style="display:flex;gap:6px">
          <div style="width:96px;flex:none" id="glabels">${labels}</div>
          <svg id="gsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="flex:1;height:${H}px;background:var(--surface-2);border-radius:6px">
            ${rows}<line class="play-line" id="gph" y1="0" y2="${H}" style="stroke:var(--failure);stroke-width:2"/></svg>`;
        wrap.querySelectorAll('.grow').forEach(d => d.onclick = () => { store.select(d.dataset.uid); BTV.graph && BTV.graph.panToUid(d.dataset.uid); });
        movePlayhead(store.state.idx);
      }
      function movePlayhead(idx) {
        const s = store.active, ph = wrap.querySelector('#gph'); if (!s || !ph || !s.timeline.length || !s.timeline[idx]) return;
        const x = (s.timeline[idx][0] - s.meta.t0) / Math.max(1, s.meta.t1 - s.meta.t0) * W;
        ph.setAttribute('x1', x); ph.setAttribute('x2', x);
      }
      store.on('load', build); store.on('grow', build); store.on('render', movePlayhead);
      build();
    },
  });
})(window.BTV = window.BTV || {});
