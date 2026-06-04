/* ui/minimap.js — 트리 전체 축소 미니맵 + 현재 뷰포트 표시. 클릭/드래그로 이동. */
(function (BTV) {
  const store = BTV.store, NS = 'http://www.w3.org/2000/svg';
  let svg, vpRect, bounds = null;

  function compute() {
    const g = BTV.graph; if (!g || !g.NODES.length) { bounds = null; return; }
    const xs = g.NODES.map(n => n._x), ys = g.NODES.map(n => n._y);
    bounds = { x: Math.min(...xs) - 20, y: Math.min(...ys) - 20,
      w: (Math.max(...xs) - Math.min(...xs)) + g.NW + 40, h: (Math.max(...ys) - Math.min(...ys)) + 40 };
  }
  function build() {
    const g = BTV.graph; compute(); if (!bounds) { svg.innerHTML = ''; return; }
    svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    let dots = '';
    g.NODES.forEach(n => {
      const st = (g.rectByUid.get(String(n.uid)) || {})._state || 0;
      const c = ['#C4CAD2', '#FF9500', '#15B886', '#F04452', '#B0B8C1'][st] || '#C4CAD2';
      dots += `<rect x="${n._x}" y="${n._y - 8}" width="${g.NW}" height="16" rx="4" fill="${c}" opacity="${n.uid == null ? .25 : .8}"/>`;
    });
    svg.innerHTML = dots + `<rect class="vp" id="vp"/>`;
    vpRect = svg.querySelector('#vp'); update();
  }
  function update() {
    const g = BTV.graph; if (!g || !vpRect) return;
    const vb = g.vb; vpRect.setAttribute('x', vb.x); vpRect.setAttribute('y', vb.y);
    vpRect.setAttribute('width', vb.w); vpRect.setAttribute('height', vb.h);
  }
  function seek(e) {
    const g = BTV.graph; if (!g || !bounds) return;
    const r = svg.getBoundingClientRect();
    // viewBox 가 meet 이므로 스케일/오프셋 보정
    const sc = Math.min(r.width / bounds.w, r.height / bounds.h);
    const offx = (r.width - bounds.w * sc) / 2, offy = (r.height - bounds.h * sc) / 2;
    const mx = bounds.x + (e.clientX - r.left - offx) / sc, my = bounds.y + (e.clientY - r.top - offy) / sc;
    g.vb.x = mx - g.vb.w / 2; g.vb.y = my - g.vb.h / 2; g.svg.setAttribute('viewBox', `${g.vb.x} ${g.vb.y} ${g.vb.w} ${g.vb.h}`); update();
  }
  function mount(svgEl) {
    svg = svgEl; let drag = false;
    svg.addEventListener('mousedown', e => { drag = true; seek(e); });
    window.addEventListener('mousemove', e => { if (drag) seek(e); });
    window.addEventListener('mouseup', () => drag = false);
    store.on('load', () => setTimeout(build, 0));
    store.on('render', () => { /* 색 갱신은 비용↑ → 생략, 위치만 */ });
    BTV.minimap = { update, rebuild: build };
  }
  BTV.mountMinimap = mount;
})(window.BTV = window.BTV || {});
