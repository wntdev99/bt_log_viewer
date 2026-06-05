/* ui/graph.js — SVG 트리 렌더러. 스토어 구독으로 자동 동기화.
 * 기능(features)이 노드 DOM 에 오버레이를 얹을 수 있도록 rectByUid/overlay 를 노출한다. */
(function (BTV) {
  const C = BTV.core, store = BTV.store, NS = 'http://www.w3.org/2000/svg';
  const NW = 192, NH = 26;
  // 노드 "전체" 를 상태 solid 색으로 채우고, 그 위 텍스트는 대비색(--on-*)으로.
  const FILL = { 0: 'var(--node-idle-bg)', 1: 'var(--running)', 2: 'var(--success)', 3: 'var(--failure)', 4: 'var(--skipped)' };
  const STROKE = { 0: 'var(--node-idle-line)', 1: 'var(--node-edge)', 2: 'var(--node-edge)', 3: 'var(--node-edge)', 4: 'var(--node-edge)' };
  const TEXT = { 0: 'var(--node-idle-text)', 1: 'var(--on-running)', 2: 'var(--on-success)', 3: 'var(--on-failure)', 4: 'var(--on-skipped)' };

  let svg, gRoot, gEdges, gNodes, gState, gFlash;
  const rectByUid = new Map();          // uid(str) -> {g, box, node}
  let NODES = [], EDGES = [], vb = { x: 0, y: 0, w: 1200, h: 800 }, prevIdx = 0;

  function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function build(session) {
    const orient = store.state.orient || 'LR';
    const lo = C.layout(session.tree, store.state.collapsed, orient);
    const TB = lo.TB;
    NODES = lo.nodes; EDGES = lo.edges;
    rectByUid.clear();
    gEdges.textContent = ''; gNodes.textContent = ''; gState.textContent = ''; gFlash.textContent = '';

    EDGES.forEach(([p, c]) => {
      let d;
      if (TB) {   // 부모 하단중앙 → 자식 상단중앙
        const x1 = p._x + NW / 2, y1 = p._y + NH / 2, x2 = c._x + NW / 2, y2 = c._y - NH / 2, my = (y1 + y2) / 2;
        d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
      } else {    // 부모 우측중앙 → 자식 좌측중앙
        const x1 = p._x + NW, y1 = p._y, x2 = c._x, y2 = c._y, mx = (x1 + x2) / 2;
        d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      }
      const path = el('path', { class: 'edge', d });
      path._from = p; path._to = c; gEdges.appendChild(path);
    });

    NODES.forEach(n => {
      const g = el('g', { class: 'node', transform: `translate(${n._x},${n._y - NH / 2})` });
      const group = n.uid == null;
      const box = el('rect', { class: 'box', width: NW, height: NH, x: 0, y: 0, 'stroke-width': 1.4,
        fill: group ? 'var(--accent-weak)' : 'var(--node-idle-bg)',
        stroke: group ? 'var(--accent)' : 'var(--node-idle-line)' });
      g.appendChild(box);
      const label = n.type === 'SubTree' ? ('▸ ' + (n.subtree || 'SubTree')) : (n.name || n.type);
      const title = el('text', { class: 'title', x: 11, y: NH * 0.38, fill: group ? 'var(--text)' : 'var(--node-idle-text)' });
      title.textContent = label.length > 25 ? label.slice(0, 24) + '…' : label;
      g.appendChild(title);
      const sub = el('text', { class: 'sub', x: 11, y: NH * 0.76, fill: group ? 'var(--text-3)' : 'var(--node-idle-text)' });
      sub.textContent = (n.type === 'SubTree' ? 'SubTree' : n.type) + (n.uid != null ? '  #' + n.uid : '');
      g.appendChild(sub);
      // 접기 토글 (자식 있는 노드)
      let tog = null;
      if ((n.children || []).length) {
        tog = el('text', { class: 'collapse', x: NW - 13, y: NH * 0.62, fill: group ? 'var(--text-3)' : 'var(--node-idle-text)' });
        tog.textContent = n._collapsed ? '⊕' : '⊖';
        tog.addEventListener('click', e => { e.stopPropagation(); store.toggleCollapse(n.uid != null ? n.uid : ('g' + n._x + '_' + n._y)); });
        g.appendChild(tog);
      }
      if (n.uid != null) {
        const uid = String(n.uid);
        rectByUid.set(uid, { g, box, node: n, title, sub, tog });
        g.style.cursor = 'pointer';
        g.addEventListener('click', e => { e.stopPropagation(); store.select(n.uid); });
        g.addEventListener('mouseenter', () => store.hover(n.uid));
      }
      gNodes.appendChild(g);
    });
  }

  function colorAt(idx) {
    const seq = store.state.seq; if (!seq) return;
    rectByUid.forEach((o, uid) => {
      const st = C.stateAt(seq, uid, idx);
      o.box.setAttribute('fill', FILL[st]); o.box.setAttribute('stroke', STROKE[st]);
      o.box.setAttribute('stroke-width', '1.4');
      o.title.setAttribute('fill', TEXT[st]); o.sub.setAttribute('fill', TEXT[st]);
      if (o.tog) o.tog.setAttribute('fill', TEXT[st]);
      o._state = st;
    });
  }

  // 기능 실행: stateLayer 만 매 프레임 비우고(배지/경로선 등 재구성용), flashLayer 는
  //   일회성 애니메이션이 끝까지 살도록 보존. 노드 class 효과는 각 feature 가 전 노드에
  //   대해 set/clear(소유) → graph 는 관여 안 함(디커플).
  function runFeatures(idx) {
    gState.textContent = '';
    const ctx = { store, core: C, graph: BTV.graph, idx, prevIdx, NS, el };
    BTV.features.forEach(f => {
      const on = !!store.state.features[f.id];
      if (f.onRender) { try { f.onRender({ ...ctx, on }); } catch (e) { console.error('[feature]', f.id, e); } }
    });
  }

  function render(idx) {
    if (!store.active) return;
    colorAt(idx);
    runFeatures(idx);
    prevIdx = idx;
    applySearch(store.state.searchHits);
    applySelect(store.state.selectedUid);
  }

  function applySelect(uid) {
    rectByUid.forEach((o, u) => o.g.classList.toggle('sel', uid != null && u === String(uid)));
  }
  function applySearch(hits) {
    const set = new Set((hits || []).map(String));
    rectByUid.forEach((o, u) => o.g.classList.toggle('search-hit', set.has(u)));
  }

  /* ---- 줌/팬 ---- */
  function applyVB() { svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); BTV.minimap && BTV.minimap.update(); }
  function fit() {
    if (!NODES.length) return;
    const xs = NODES.map(n => n._x), ys = NODES.map(n => n._y);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + NW + 40;
    const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
    vb = { x: minX, y: minY, w: Math.max(maxX - minX, 400), h: Math.max(maxY - minY, 300) };
    // 화면 비율 맞춰 보정
    const r = svg.getBoundingClientRect(), ar = r.width / r.height;
    if (vb.w / vb.h < ar) { const w = vb.h * ar; vb.x -= (w - vb.w) / 2; vb.w = w; }
    else { const h = vb.w / ar; vb.y -= (h - vb.h) / 2; vb.h = h; }
    applyVB();
  }
  function panToUid(uid) {
    const o = rectByUid.get(String(uid)); if (!o) return;
    vb.x = o.node._x + NW / 2 - vb.w / 2; vb.y = o.node._y - vb.h / 2; applyVB();
  }
  function zoomAt(cx, cy, f) {
    const r = svg.getBoundingClientRect();
    const mx = vb.x + (cx - r.left) / r.width * vb.w, my = vb.y + (cy - r.top) / r.height * vb.h;
    vb.x = mx - (mx - vb.x) * f; vb.y = my - (my - vb.y) * f; vb.w *= f; vb.h *= f; applyVB();
  }

  function mount(svgEl) {
    svg = svgEl;
    gRoot = el('g', {}); gEdges = el('g', {}); gNodes = el('g', {}); gState = el('g', {}); gFlash = el('g', {});
    gRoot.append(gEdges, gNodes, gState, gFlash); svg.appendChild(gRoot);

    svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
    let pan = null;
    svg.addEventListener('mousedown', e => { if (e.target.closest('.node')) return; pan = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; svg.classList.add('dragging'); });
    window.addEventListener('mousemove', e => { if (!pan) return; const r = svg.getBoundingClientRect(); vb.x = pan.vx - (e.clientX - pan.x) / r.width * vb.w; vb.y = pan.vy - (e.clientY - pan.y) / r.height * vb.h; applyVB(); });
    window.addEventListener('mouseup', () => { pan = null; svg.classList.remove('dragging'); });
    svg.addEventListener('click', e => { if (!e.target.closest('.node')) store.select(null); });

    store.on('load', s => { build(s); fit(); render(store.state.idx); });
    store.on('render', idx => render(idx));
    store.on('select', uid => applySelect(uid));
    store.on('search', hits => applySearch(hits));

    BTV.graph = { rectByUid, get NODES() { return NODES; }, get EDGES() { return EDGES; }, get vb() { return vb; },
      svg, fit, panToUid, render, stateLayer: () => gState, flashLayer: () => gFlash, edgesLayer: () => gEdges,
      NW, NH, FILL, STROKE, el };
  }

  BTV.mountGraph = mount;
})(window.BTV = window.BTV || {});
