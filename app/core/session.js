/* core/session.js — 세션 모델: btlog/json 적재, 병합. (parse 외 순수) */
(function (BTV) {
  const C = BTV.core;

  function pad2(x) { return x < 10 ? '0' + x : '' + x; }
  function utcDate(usec) {
    const d = new Date(usec / 1000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' +
           pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }

  // .btlog ArrayBuffer → 세션 객체 (bt_flow_check.py cmd_export btlog 분기와 동일 스키마).
  function sessionFromBtlog(name, buf) {
    const { xmlText, firstTs, timeline } = C.parseBtlog(buf);
    const { tree, treeName } = C.buildTreeFromXml(xmlText);
    const t0 = timeline.length ? timeline[0][0] : 0;
    const t1 = timeline.length ? timeline[timeline.length - 1][0] : 0;
    return { meta: { tree: treeName, session: 1, date: utcDate(firstTs), source: 'btlog',
                     t0, t1, count: timeline.length, file: name },
             tree, nodes: C.buildNodesMap(tree), timeline, expected: null };
  }

  // json 파일 한 개 → 세션 배열(단일 {meta,..} 또는 멀티 {sessions:[..]}).
  function sessionsFromJson(json, fname) {
    const list = Array.isArray(json.sessions) ? json.sessions : [json];
    list.forEach(s => { if (s.meta && !s.meta.file) s.meta.file = fname; });
    return list;
  }

  // 여러 세션 → 통합 세션. uid 를 "L{i}:{uid}" 네임스페이싱(충돌 제거), 합성 super-root.
  function mergeSessions(sessions) {
    const layerRoots = [], nodes = {}; let timeline = [];
    sessions.forEach((s, li) => {
      const ns = u => `L${li}:${u}`;
      const clone = n => ({ ...n, uid: n.uid != null ? ns(n.uid) : null,
                            children: (n.children || []).map(clone) });
      const troot = s.tree ? clone(s.tree) : null;
      layerRoots.push({ uid: null, name: `▼ L${li} · ${s.meta.tree}`, type: '(layer)',
                        children: troot ? [troot] : [] });
      Object.entries(s.nodes).forEach(([u, fp]) => { nodes[ns(u)] = `L${li}/${fp}`; });
      s.timeline.forEach(tr => timeline.push([tr[0], ns(tr[1]), ...tr.slice(2)]));
    });
    timeline.sort((a, b) => a[0] - b[0]);
    const superRoot = { uid: null, type: '(merged)',
                        name: 'MERGED ' + sessions.map(s => s.meta.tree).join(' + '),
                        children: layerRoots };
    const t0 = timeline.length ? timeline[0][0] : 0;
    const t1 = timeline.length ? timeline[timeline.length - 1][0] : 0;
    return { meta: { tree: sessions.map(s => s.meta.tree).join('+'), session: 'merged',
                     date: sessions[0].meta.date, source: 'merged', t0, t1, count: timeline.length,
                     file: '⛓ ' + sessions.map(s => s.meta.file || ('s' + s.meta.session)).join(' + ') },
             tree: superRoot, nodes, timeline, expected: null };
  }

  Object.assign(BTV.core, { sessionFromBtlog, sessionsFromJson, mergeSessions, utcDate });
})(window.BTV = window.BTV || {});
