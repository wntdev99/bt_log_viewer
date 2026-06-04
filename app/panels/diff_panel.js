/* panels/diff_panel.js — 검증/비교:
 *  ① 불변식 spec(JSON) 평가 → PASS/FAIL (bt_flow_check.py check 와 동일 포맷)
 *  ② 세션 A vs B 비교(골든 diff) — 진입/카운트 차이
 *  expected 슬롯이 세션에 있으면 자동 로드. */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  const SAMPLE = `{
  "invariants": [
    {"name": "Nav 1회 이상 SUCCESS", "node": "%NavSingleAction%", "state": "SUCCESS", "count": ">=1"},
    {"name": "회복분기 미진입", "node": "%Recovery%", "state": "ANY", "count": "==0"}
  ]
}`;
  BTV.registerPanel({
    id: 'diff', title: '검증', icon: '✅',
    mount(el) {
      el.innerHTML = `
        <div class="card"><h3>불변식 검증 (expected)</h3>
          <textarea class="input" id="spec" style="width:100%;height:120px;font-family:var(--mono);font-size:11px;padding:8px" spellcheck="false"></textarea>
          <div class="row" style="margin-top:8px;gap:6px"><button class="btn sm primary" id="runChk">검증 실행</button>
            <button class="btn sm" id="loadSample">예시</button></div>
          <div id="chkres" style="margin-top:8px"></div></div>
        <div class="card"><h3>세션 비교 (A=현재)</h3>
          <div class="row" style="gap:6px"><span class="muted">B 세션</span>
            <select class="select" id="cmpSel" style="flex:1"></select>
            <button class="btn sm" id="runCmp">비교</button></div>
          <div id="cmpres" style="margin-top:8px"></div></div>`;
      const spec = el.querySelector('#spec'), chkres = el.querySelector('#chkres'), cmpres = el.querySelector('#cmpres'), cmpSel = el.querySelector('#cmpSel');

      function runCheck() {
        const s = store.active; if (!s) return;
        let spc; try { spc = JSON.parse(spec.value); } catch (e) { chkres.innerHTML = `<div class="tag fail">JSON 오류: ${e.message}</div>`; return; }
        const results = C.evalInvariants(s, spc);
        const pass = results.filter(r => r.ok).length;
        chkres.innerHTML = `<div style="margin-bottom:6px"><b>${pass}/${results.length} 통과</b></div>` +
          results.map(r => `<div class="row" style="gap:6px;padding:4px 0;border-bottom:1px solid var(--line)">
            <span class="tag ${r.ok ? 'succ' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'}</span>
            <span style="flex:1"><b>${r.name}</b><div class="muted mono" style="font-size:10px">${r.detail}</div></span></div>`).join('');
      }
      function fillCmp() {
        cmpSel.innerHTML = store.state.sessions.map((s, i) => `<option value="${i}" ${i === store.state.activeIndex ? 'disabled' : ''}>${s.meta.tree} · ${s.meta.file || ('s' + s.meta.session)}</option>`).join('');
      }
      function runCompare() {
        const a = store.active, b = store.state.sessions[+cmpSel.value]; if (!a || !b || a === b) { cmpres.innerHTML = '<div class="muted">다른 세션을 고르세요</div>'; return; }
        const rows = C.diffSessions(a, b).filter(r => r.status !== 'same');
        if (!rows.length) { cmpres.innerHTML = '<div class="tag succ">동일 (진입/카운트 차이 없음)</div>'; return; }
        const badge = { 'only-a': '<span class="tag run">A만</span>', 'only-b': '<span class="tag skip">B만</span>', 'changed': '<span class="tag fail">변경</span>' };
        cmpres.innerHTML = `<div class="muted" style="margin-bottom:6px">차이 ${rows.length}건</div><table class="grid"><tbody>${
          rows.slice(0, 200).map(r => `<tr><td><div class="mono" style="font-size:10px">${r.path}</div></td><td style="text-align:right">${badge[r.status]}
            <div class="muted" style="font-size:10px">A:${r.a ? r.a.total : 0} / B:${r.b ? r.b.total : 0}</div></td></tr>`).join('')
          }</tbody></table>`;
      }
      el.querySelector('#runChk').onclick = runCheck;
      el.querySelector('#loadSample').onclick = () => { spec.value = SAMPLE; };
      el.querySelector('#runCmp').onclick = runCompare;
      store.on('load', s => { if (s && s.expected) spec.value = JSON.stringify(s.expected, null, 2); else if (!spec.value) spec.value = SAMPLE; fillCmp(); });
      store.on('sessions', fillCmp);
      spec.value = SAMPLE; fillCmp();
    },
  });
})(window.BTV = window.BTV || {});
