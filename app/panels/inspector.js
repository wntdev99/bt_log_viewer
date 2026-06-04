/* panels/inspector.js — 선택 노드 상세: 상태/카운트/duration/전이 이력. */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  function us(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'ms' : v + 'µs'; }

  BTV.registerPanel({
    id: 'inspector', title: '노드', icon: '🔍',
    mount(el) {
      el.innerHTML = '<div id="insp"></div>';
      const box = el.querySelector('#insp');
      function render() {
        const s = store.active, uid = store.state.selectedUid;
        if (!s) { box.innerHTML = '<div class="empty-hint">세션을 불러오세요.</div>'; return; }
        if (uid == null) { box.innerHTML = '<div class="empty-hint">트리에서 노드를 클릭하면<br>상세 정보가 표시됩니다.</div>'; return; }
        const key = String(uid), path = s.nodes[key] || ('#' + key);
        const st = C.stateAt(store.state.seq, key, store.state.idx);
        const stat = (store.state.stats || {})[key] || { run: 0, succ: 0, fail: 0, skip: 0, total: 0, durSum: 0, durMax: 0, durCnt: 0 };
        const tagCls = ['idle', 'run', 'succ', 'fail', 'skip'][st];
        const node = C.flatten(s.tree).find(n => String(n.uid) === key) || {};
        // 최근 전이 이력(최대 12개, 현재 idx 이하)
        const seqArr = store.state.seq.get(key) || [];
        const hist = seqArr.filter(([i]) => i <= store.state.idx).slice(-12).reverse();
        box.innerHTML = `
          <div class="card">
            <h3>노드</h3>
            <div class="row" style="justify-content:space-between"><b>${node.name || node.type || path}</b>
              <span class="tag ${tagCls}">${C.STATE[st]}</span></div>
            <div class="mono muted" style="margin-top:6px">${path}</div>
            <div class="kv" style="margin-top:8px"><span class="k">타입</span><span class="v">${node.type || '-'}</span></div>
            ${node.subtree ? `<div class="kv"><span class="k">SubTree</span><span class="v">${node.subtree}</span></div>` : ''}
            <div class="kv"><span class="k">uid</span><span class="v">${uid}</span></div>
          </div>
          <div class="card">
            <h3>전이 카운트</h3>
            <div class="row" style="gap:6px;flex-wrap:wrap">
              <span class="tag succ">S ${stat.succ}</span><span class="tag fail">F ${stat.fail}</span>
              <span class="tag run">R ${stat.run}</span><span class="tag skip">K ${stat.skip}</span>
              <span class="tag idle">총 ${stat.total}</span></div>
          </div>
          ${stat.durCnt ? `<div class="card"><h3>실행시간(duration)</h3>
            <div class="kv"><span class="k">최대</span><span class="v">${us(stat.durMax)}</span></div>
            <div class="kv"><span class="k">평균</span><span class="v">${us(Math.round(stat.durSum / stat.durCnt))}</span></div>
            <div class="kv"><span class="k">합계</span><span class="v">${us(stat.durSum)}</span></div></div>` : ''}
          <div class="card"><h3>최근 전이 (≤ 현재시점)</h3>
            <table class="grid"><thead><tr><th>idx</th><th>상태</th></tr></thead><tbody>
            ${hist.map(([i, stt]) => `<tr class="clk" data-i="${i}"><td>${i}</td><td><span class="tag ${['idle', 'run', 'succ', 'fail', 'skip'][stt]}">${C.STATE[stt]}</span></td></tr>`).join('') || '<tr><td colspan=2 class="muted">없음</td></tr>'}
            </tbody></table></div>`;
        box.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => { BTV.transport.stop(); store.setIdx(+tr.dataset.i); });
      }
      store.on('select', render); store.on('render', render); store.on('load', render);
      render();
    },
  });
})(window.BTV = window.BTV || {});
