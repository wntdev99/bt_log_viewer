/* panels/stats.js — 트리 요약 + 핫스팟 랭킹(최다 실패/실행/최장 duration). */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  function us(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'ms' : v + 'µs'; }

  BTV.registerPanel({
    id: 'stats', title: '통계', icon: '📊',
    mount(el) {
      el.innerHTML = `<div id="sumCard"></div>
        <div class="card"><h3>핫스팟</h3>
          <div class="row" style="gap:6px;margin-bottom:8px">
            <button class="btn sm" data-k="fail" aria-pressed="true">실패순</button>
            <button class="btn sm" data-k="run">실행순</button>
            <button class="btn sm" data-k="dur">최장순</button></div>
          <div id="hot"></div></div>`;
      let kind = 'fail';
      function render() {
        const s = store.active; const sum = el.querySelector('#sumCard'), hot = el.querySelector('#hot');
        if (!s) { sum.innerHTML = '<div class="empty-hint">세션을 불러오세요.</div>'; hot.innerHTML = ''; return; }
        const st = store.state.stats || {};
        let tot = { run: 0, succ: 0, fail: 0, skip: 0 };
        Object.values(st).forEach(x => { tot.run += x.run; tot.succ += x.succ; tot.fail += x.fail; tot.skip += x.skip; });
        sum.innerHTML = `<div class="card"><h3>요약</h3>
          <div class="kv"><span class="k">트리</span><span class="v">${s.meta.tree}</span></div>
          <div class="kv"><span class="k">노드 / 전이</span><span class="v">${Object.keys(s.nodes).length} / ${s.meta.count}</span></div>
          <div class="kv"><span class="k">기간</span><span class="v">${((s.meta.t1 - s.meta.t0) / 1e6).toFixed(2)}s</span></div>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
            <span class="tag succ">S ${tot.succ}</span><span class="tag fail">F ${tot.fail}</span>
            <span class="tag run">R ${tot.run}</span><span class="tag skip">K ${tot.skip}</span></div></div>`;
        const rows = C.hotspots(st, s.nodes, kind, 12);
        const valOf = r => kind === 'fail' ? r.fail : kind === 'run' ? r.run : us(r.durMax);
        const max = Math.max(1, ...rows.map(r => kind === 'dur' ? r.durMax : (kind === 'fail' ? r.fail : r.run)));
        const col = kind === 'fail' ? 'var(--failure)' : kind === 'run' ? 'var(--running)' : 'var(--accent)';
        hot.innerHTML = `<table class="grid"><tbody>${rows.map(r => {
          const v = kind === 'dur' ? r.durMax : (kind === 'fail' ? r.fail : r.run);
          return `<tr class="clk" data-uid="${r.uid}"><td style="max-width:170px"><div class="mono" style="font-size:10.5px">${r.path}</div>
            <div class="bar" style="margin-top:3px"><i style="width:${(v / max * 100).toFixed(0)}%;background:${col}"></i></div></td>
            <td style="text-align:right;white-space:nowrap">${valOf(r)}</td></tr>`;
        }).join('')}</tbody></table>`;
        hot.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => store.select(tr.dataset.uid));
      }
      el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        kind = b.dataset.k; el.querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-pressed', x.dataset.k === kind)); render();
      });
      store.on('load', render); store.on('grow', render);
      render();
    },
  });
})(window.BTV = window.BTV || {});
