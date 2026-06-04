/* features/debug_features.js — 디버깅 최적화 토글 (on/off). 레지스트리 패턴 예시:
 *   "registerFeature 한 번 = 설정시트·명령팔레트에 자동 노출 + 매 render 훅".
 * ctx = { store, core, graph, idx, prevIdx, on, NS, el }. graph 로 노드 DOM 에 오버레이. */
(function (BTV) {
  const reg = BTV.registerFeature;

  // 공통: flashLayer 에 일회성 링 추가(애니메이션 끝나면 자가 제거)
  function flash(graph, node, variant) {
    if (!node || node.uid == null) return;
    const r = graph.el('rect', { class: 'flash ' + variant, x: node._x - 3, y: node._y - graph.NH / 2 - 3,
      width: graph.NW + 6, height: graph.NH + 6 });
    graph.flashLayer().appendChild(r);
    r.addEventListener('animationend', () => r.remove());
  }
  const advanced = ctx => ctx.idx !== ctx.prevIdx;   // 시점이 실제로 이동했는가

  /* F1 — 같은 색 재진입 펄스 (사용자 요청 예시). 현재 전이의 새 상태가 직전 상태와
   *      같아(=색 변화 없음) 놓치기 쉬운 재진입을 "툭" 보이게. 기본 ON. */
  reg({
    id: 'reentry_pulse', label: '재진입 펄스', group: '하이라이트', default: true,
    desc: '색이 안 바뀌는 재진입(예: SUCC→RUN→SUCC)을 플래시로 표시',
    onRender(ctx) {
      if (!ctx.on || !advanced(ctx)) return;
      const tr = ctx.store.active.timeline[ctx.idx]; if (!tr) return;
      const uid = String(tr[1]), st = tr[2];
      const prev = ctx.core.stateAt(ctx.store.state.seq, uid, ctx.idx - 1);
      if (st === prev) { const o = ctx.graph.rectByUid.get(uid); o && flash(ctx.graph, o.node, 'reentry'); }
    },
  });

  /* F2 — 현재 전이 노드 링: 모든 전이 순간을 링으로(전이별 재생 시 흐름 추적). */
  reg({
    id: 'transition_ring', label: '전이 링', group: '하이라이트', default: false,
    desc: '현재 시점에 전이가 일어난 노드를 매번 링으로 표시',
    onRender(ctx) {
      if (!ctx.on || !advanced(ctx)) return;
      const tr = ctx.store.active.timeline[ctx.idx]; const o = tr && ctx.graph.rectByUid.get(String(tr[1]));
      o && flash(ctx.graph, o.node, 'trans');
    },
  });

  /* F6 — 직전 시점 대비 상태가 바뀐 노드 깜빡(어떤 노드들이 이번 스텝에 변했나). */
  reg({
    id: 'changed_blink', label: '변경 노드 깜빡', group: '하이라이트', default: false,
    desc: '직전 시점 대비 상태가 달라진 모든 노드를 깜빡',
    onRender(ctx) {
      if (!ctx.on || !advanced(ctx)) return;
      const seq = ctx.store.state.seq;
      ctx.graph.rectByUid.forEach((o, uid) => {
        if (ctx.core.stateAt(seq, uid, ctx.idx) !== ctx.core.stateAt(seq, uid, ctx.prevIdx)) flash(ctx.graph, o.node, 'changed');
      });
    },
  });

  /* F3 — RUNNING 글로우(숨쉬기). 클래스 force 토글이라 재시작 jitter 없음. */
  reg({
    id: 'running_glow', label: 'RUNNING 글로우', group: '상태 강조', default: false,
    desc: '현재 RUNNING 인 노드를 은은하게 맥동',
    onRender(ctx) { ctx.graph.rectByUid.forEach(o => o.g.classList.toggle('glow-on', ctx.on && o._state === 1)); },
  });

  /* F4 — 실패 잔상(sticky): 한 번이라도 FAILURE 였던 노드를 점선 테두리로 유지. */
  let c4 = { s: null, ff: {} };
  reg({
    id: 'sticky_fail', label: '실패 잔상', group: '상태 강조', default: false,
    desc: '한 번 FAILURE 였던 노드를 이후에도 점선으로 표식',
    onRender(ctx) {
      const g = ctx.graph;
      if (!ctx.on) { g.rectByUid.forEach(o => o.g.classList.remove('sticky-fail')); return; }
      if (c4.s !== ctx.store.active) { c4.s = ctx.store.active; c4.ff = {}; ctx.store.state.seq.forEach((arr, uid) => { const f = arr.find(x => x[1] === 3); if (f) c4.ff[uid] = f[0]; }); }
      g.rectByUid.forEach((o, uid) => { const ff = c4.ff[uid]; o.g.classList.toggle('sticky-fail', ff != null && ff <= ctx.idx && o._state !== 3); });
    },
  });

  /* F5 — 활성 경로: 루트→현재 전이 노드 경로의 노드/엣지 강조. */
  reg({
    id: 'active_path', label: '활성 경로', group: '상태 강조', default: false,
    desc: '루트에서 현재 전이 노드까지의 경로를 강조',
    onRender(ctx) {
      const g = ctx.graph;
      g.rectByUid.forEach(o => o.g.classList.remove('on-path'));
      const edges = g.edgesLayer().childNodes;
      const tr = ctx.on && ctx.store.active.timeline[ctx.idx];
      const set = tr ? new Set(ctx.core.pathToRoot(ctx.store.active.tree, tr[1]).map(n => String(n.uid))) : new Set();
      set.forEach(uid => { const o = g.rectByUid.get(uid); o && o.g.classList.add('on-path'); });
      edges.forEach(p => p.classList && p.classList.toggle('on-path', !!(p._from && p._to && set.has(String(p._from.uid)) && set.has(String(p._to.uid)))));
    },
  });

  /* F7 — 자동 따라가기: 현재 전이 노드로 카메라 팬. */
  reg({
    id: 'follow_cam', label: '자동 따라가기', group: '카메라', default: false,
    desc: '재생 중 현재 전이 노드로 화면을 이동',
    onRender(ctx) { if (ctx.on && advanced(ctx)) { const tr = ctx.store.active.timeline[ctx.idx]; tr && ctx.graph.panToUid(tr[1]); } },
  });

  /* F8 — 미진입 노드 흐리게: 세션 동안 한 번도 전이 없던 노드 dim. */
  reg({
    id: 'dim_unentered', label: '미진입 노드 흐리게', group: '필터', default: false,
    desc: '세션 내내 한 번도 실행되지 않은 노드를 흐리게',
    onRender(ctx) { const st = ctx.store.state.stats || {}; ctx.graph.rectByUid.forEach((o, uid) => o.g.classList.toggle('dim', ctx.on && !st[uid])); },
  });

  /* F9 — 실패 카운트 배지: fail>0 노드 우상단에 ✕N. */
  reg({
    id: 'fail_badge', label: '실패 배지', group: '주석', default: false,
    desc: 'FAILURE 횟수>0 인 노드에 ✕N 배지',
    onRender(ctx) {
      if (!ctx.on) return; const g = ctx.graph, st = ctx.store.state.stats || {}, layer = g.stateLayer();
      g.rectByUid.forEach((o, uid) => { const s = st[uid]; if (!s || !s.fail) return;
        const t = g.el('text', { class: 'badge', x: o.node._x + g.NW - 6, y: o.node._y - g.NH / 2 + 9, fill: 'var(--failure)', 'text-anchor': 'end' });
        t.textContent = '✕' + s.fail; layer.appendChild(t); });
    },
  });

  /* F10 — duration 히트맵: 최장 실행시간 비례로 테두리 강조. */
  let c10 = { s: null, max: 1 };
  reg({
    id: 'dur_heat', label: 'duration 히트맵', group: '주석', default: false,
    desc: '실행시간(duration)이 긴 노드일수록 테두리를 붉고 굵게',
    onRender(ctx) {
      if (!ctx.on) return; const st = ctx.store.state.stats || {};
      if (c10.s !== ctx.store.active) { c10.s = ctx.store.active; c10.max = Math.max(1, ...Object.values(st).map(s => s.durMax || 0)); }
      ctx.graph.rectByUid.forEach((o, uid) => { const s = st[uid]; if (!s || !s.durMax) return; const f = s.durMax / c10.max;
        if (f > 0.12) { o.box.setAttribute('stroke', `rgba(240,68,82,${(0.3 + 0.7 * f).toFixed(2)})`); o.box.setAttribute('stroke-width', (1.4 + 2.6 * f).toFixed(1)); } });
    },
  });
})(window.BTV = window.BTV || {});
