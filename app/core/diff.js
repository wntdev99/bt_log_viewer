/* core/diff.js — 검증/비교 순수 로직: 불변식 평가, 세션 간 비교. */
(function (BTV) {
  const C = BTV.core;
  const STATE_CODE = { IDLE: 0, RUNNING: 1, SUCCESS: 2, FAILURE: 3, SKIPPED: 4 };

  function likeToRe(like) {                       // SQL LIKE(%,_) → 정규식
    const esc = like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + esc.replace(/%/g, '.*').replace(/_/g, '.') + '$');
  }
  // node 패턴(fullpath LIKE) + state 에 맞는 전이 수.
  function countMatching(timeline, nodesMap, nodeLike, state) {
    const re = likeToRe(nodeLike), sc = (state && state !== 'ANY') ? STATE_CODE[state] : null;
    let c = 0;
    for (const tr of timeline) {
      const path = nodesMap[tr[1]] || ('#' + tr[1]);
      if (re.test(path) && (sc === null || tr[2] === sc)) c++;
    }
    return c;
  }
  function firstTs(timeline, nodesMap, nodeLike, state) {
    const re = likeToRe(nodeLike), sc = (state && state !== 'ANY') ? STATE_CODE[state] : null;
    for (const tr of timeline) {
      const path = nodesMap[tr[1]] || ('#' + tr[1]);
      if (re.test(path) && (sc === null || tr[2] === sc)) return tr[0];
    }
    return null;
  }
  const OPS = [['>=', (a, b) => a >= b], ['<=', (a, b) => a <= b], ['==', (a, b) => a === b],
               ['!=', (a, b) => a !== b], ['>', (a, b) => a > b], ['<', (a, b) => a < b]];
  function checkCount(actual, expr) {
    expr = String(expr).trim();
    for (const [sym, fn] of OPS) if (expr.startsWith(sym)) return { ok: fn(actual, +expr.slice(sym.length).trim()), expr };
    return { ok: actual === +expr, expr: '==' + expr };
  }

  // 불변식 spec(bt_flow_check.py 와 동일 포맷) 평가 → 결과 배열.
  function evalInvariants(session, spec) {
    const tl = session.timeline, nm = session.nodes;
    return (spec.invariants || []).map(inv => {
      const name = inv.name || '(이름없음)', kind = inv.type || 'count';
      if (kind === 'count') {
        const actual = countMatching(tl, nm, inv.node, inv.state || 'ANY');
        const r = checkCount(actual, inv.count);
        return { name, kind, ok: r.ok, node: inv.node, state: inv.state || 'ANY',
                 detail: `${inv.node} [${inv.state || 'ANY'}] = ${actual}, 기대 ${r.expr}` };
      }
      if (kind === 'happens_before') {
        const b = inv.before, a = inv.after;
        const tb = firstTs(tl, nm, b.node, b.state || 'ANY'), ta = firstTs(tl, nm, a.node, a.state || 'ANY');
        const ok = tb != null && ta != null && tb < ta;
        return { name, kind, ok, node: b.node,
                 detail: tb == null || ta == null ? `before=${tb}, after=${ta} — 한쪽 미발생` : `before t=${tb} < after t=${ta}` };
      }
      return { name, kind, ok: false, detail: '알 수 없는 type: ' + kind };
    });
  }

  // 두 세션 비교(같은 트리 가정, fullpath 기준). 반환: [{path,a{...},b{...},status}]
  function diffSessions(sa, sb) {
    const stA = C.nodeStats(sa.timeline), stB = C.nodeStats(sb.timeline);
    const pathOf = (s, uid) => s.nodes[uid] || ('#' + uid);
    const byPath = (s, st) => { const m = {}; for (const uid in st) m[pathOf(s, uid)] = st[uid]; return m; };
    const A = byPath(sa, stA), B = byPath(sb, stB);
    const paths = new Set([...Object.keys(A), ...Object.keys(B)]);
    const rows = [];
    for (const p of paths) {
      const a = A[p], b = B[p];
      let status;
      if (a && !b) status = 'only-a'; else if (!a && b) status = 'only-b';
      else status = (a.total === b.total && a.succ === b.succ && a.fail === b.fail) ? 'same' : 'changed';
      rows.push({ path: p, a, b, status });
    }
    rows.sort((x, y) => x.path.localeCompare(y.path));
    return rows;
  }

  Object.assign(BTV.core, { evalInvariants, diffSessions, countMatching, STATE_CODE });
})(window.BTV = window.BTV || {});
