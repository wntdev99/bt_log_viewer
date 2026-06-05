/* panels/events.js — 전이 이벤트 로그(필터·검색 가능, 현재 시점 자동 추적, 클릭 점프). */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  const SCLS = ['idle', 'run', 'succ', 'fail', 'skip'];

  BTV.registerPanel({
    id: 'events', title: '이벤트', icon: '📜',
    mount(el) {
      el.innerHTML = `
        <div class="row" style="gap:6px;margin-bottom:8px">
          <input class="input" id="evq" placeholder="노드 경로 검색…" style="flex:1">
          <select class="select" id="evs">
            <option value="">전체</option><option value="1">RUNNING</option>
            <option value="2">SUCCESS</option><option value="3">FAILURE</option><option value="4">SKIPPED</option></select>
        </div>
        <label class="row" style="gap:6px;margin-bottom:8px;color:var(--text-3)">
          <input type="checkbox" id="evfollow" checked> 현재 시점 자동 추적</label>
        <div id="evlist" style="max-height:calc(100vh - 320px);overflow:auto"></div>`;
      const q = el.querySelector('#evq'), sf = el.querySelector('#evs'), follow = el.querySelector('#evfollow'), list = el.querySelector('#evlist');
      let rows = [];
      function rebuild() {
        const s = store.active; if (!s) { list.innerHTML = '<div class="empty-hint">세션 없음</div>'; rows = []; return; }
        const ql = q.value.toLowerCase(), sfv = sf.value;
        rows = [];
        s.timeline.forEach((tr, i) => {
          if (sfv && tr[2] !== +sfv) return;
          const path = s.nodes[tr[1]] || ('#' + tr[1]);
          if (ql && !path.toLowerCase().includes(ql)) return;
          rows.push({ i, t: ((tr[0] - s.meta.t0) / 1e6).toFixed(3), st: tr[2], path, extra: tr[4] || '' });
        });
        // 대형 로그 보호: 최대 4000행
        const cap = rows.length > 4000;
        const view = cap ? rows.slice(0, 4000) : rows;
        list.innerHTML = `<table class="grid"><thead><tr><th>t+s</th><th>상태</th><th>노드</th></tr></thead><tbody>${
          view.map(r => `<tr class="clk" data-i="${r.i}"><td>${r.t}</td><td><span class="tag ${SCLS[r.st]}">${C.STATE[r.st][0]}</span></td>
            <td><div class="mono" style="font-size:10px">${r.path}${r.extra ? ` <span class="muted">[${r.extra}]</span>` : ''}</div></td></tr>`).join('')
          }</tbody></table>${cap ? `<div class="muted" style="padding:8px">…총 ${rows.length}건 중 4000건 표시 (필터로 좁히세요)</div>` : ''}`;
        list.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => { BTV.transport.stop(); store.setIdx(+tr.dataset.i); store.select(store.active.timeline[+tr.dataset.i][1]); });
      }
      function highlight(idx) {
        if (!follow.checked) return;
        const trs = list.querySelectorAll('tr.clk'); let target = null;
        for (const tr of trs) { if (+tr.dataset.i <= idx) target = tr; else break; }
        trs.forEach(t => t.style.background = '');
        if (target) { target.style.background = 'var(--accent-weak)'; target.scrollIntoView({ block: 'nearest' }); }
      }
      q.oninput = rebuild; sf.onchange = rebuild;
      store.on('load', rebuild); store.on('grow', rebuild); store.on('render', highlight);
      rebuild();
    },
  });
})(window.BTV = window.BTV || {});
