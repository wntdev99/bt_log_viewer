/* panels/blackboard.js — extra_data(전이에 부착된 BB/메타) 를 시점별로 표시.
 * SqliteLogger/FileLogger2 의 extra_data 는 timeline[i][4] 에 들어온다. */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  const SCLS = ['idle', 'run', 'succ', 'fail', 'skip'];

  BTV.registerPanel({
    id: 'blackboard', title: 'BB/extra', icon: '🗂',
    mount(el) {
      el.innerHTML = '<div id="bb"></div>';
      const box = el.querySelector('#bb');
      function render() {
        const s = store.active; if (!s) { box.innerHTML = '<div class="empty-hint">세션 없음</div>'; return; }
        // extra_data 가 있는 전이만 수집(현재 idx 이하 = 지금까지 관측된 값)
        const items = [];
        for (let i = 0; i <= store.state.idx; i++) {
          const tr = s.timeline[i];
          if (tr && tr[4]) items.push({ i, t: ((tr[0] - s.meta.t0) / 1e6).toFixed(3), st: tr[2], path: s.nodes[tr[1]] || ('#' + tr[1]), extra: tr[4] });
        }
        const recent = items.slice(-30).reverse();
        if (!items.length) {
          box.innerHTML = `<div class="empty-hint">이 세션엔 extra_data 가 없습니다.<br><span class="muted">
            (SqliteLogger 의 extra_data / BB 스냅샷이 기록된 경우 여기에 시점별로 표시됩니다.)</span></div>`;
          return;
        }
        box.innerHTML = `<div class="card"><h3>extra_data · 현재까지 ${items.length}건</h3>
          <table class="grid"><thead><tr><th>t+s</th><th>상태</th><th>값</th></tr></thead><tbody>
          ${recent.map(r => `<tr class="clk" data-i="${r.i}"><td>${r.t}</td><td><span class="tag ${SCLS[r.st]}">${C.STATE[r.st][0]}</span></td>
            <td><div class="mono" style="font-size:10.5px">${r.extra}</div><div class="muted" style="font-size:9.5px">${r.path}</div></td></tr>`).join('')}
          </tbody></table></div>`;
        box.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => { BTV.transport.stop(); store.setIdx(+tr.dataset.i); });
      }
      store.on('load', render); store.on('render', render); store.on('grow', render);
      render();
    },
  });
})(window.BTV = window.BTV || {});
