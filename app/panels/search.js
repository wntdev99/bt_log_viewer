/* panels/search.js — 노드 검색(이름/타입/uid) + 결과 목록 + 순회 점프. */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  BTV.registerPanel({
    id: 'search', title: '검색', icon: '🔎',
    mount(el) {
      el.innerHTML = `
        <div class="row" style="gap:6px;margin-bottom:8px">
          <input class="input" id="searchInput" placeholder="이름 · 타입 · #uid …" style="flex:1">
          <button class="btn icon sm" id="sPrev" title="이전(Shift+Enter)">↑</button>
          <button class="btn icon sm" id="sNext" title="다음(Enter)">↓</button></div>
        <div id="sres"></div>`;
      const inp = el.querySelector('#searchInput'), res = el.querySelector('#sres');
      function render() {
        const s = store.active; if (!s) { res.innerHTML = '<div class="empty-hint">세션 없음</div>'; return; }
        const hits = store.state.searchHits;
        if (!store.state.search) { res.innerHTML = '<div class="empty-hint">노드를 검색하세요.<br><span class="muted">트리에서 일치 노드가 점선 테두리로 표시됩니다.</span></div>'; return; }
        res.innerHTML = `<div class="muted" style="margin-bottom:6px">${hits.length}개 일치</div>
          <table class="grid"><tbody>${hits.map(uid => {
            const node = C.flatten(s.tree).find(n => String(n.uid) === uid) || {};
            return `<tr class="clk" data-uid="${uid}"><td><b>${node.name || node.type}</b> <span class="muted">${node.type}</span><div class="mono muted" style="font-size:10px">#${uid}</div></td></tr>`;
          }).join('')}</tbody></table>`;
        res.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => { store.select(tr.dataset.uid); BTV.graph && BTV.graph.panToUid(tr.dataset.uid); });
      }
      inp.oninput = () => store.setSearch(inp.value);
      inp.onkeydown = e => { if (e.key === 'Enter') { const uid = store.searchNext(e.shiftKey ? -1 : 1); uid && BTV.graph.panToUid(uid); } };
      el.querySelector('#sNext').onclick = () => { const uid = store.searchNext(1); uid && BTV.graph.panToUid(uid); };
      el.querySelector('#sPrev').onclick = () => { const uid = store.searchNext(-1); uid && BTV.graph.panToUid(uid); };
      store.on('search', render); store.on('load', () => { inp.value = store.state.search; render(); });
      render();
    },
  });
})(window.BTV = window.BTV || {});
