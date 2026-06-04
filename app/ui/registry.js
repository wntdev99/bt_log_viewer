/* ui/registry.js — 확장 지점. 패널/기능을 "파일 1개 + 등록 1줄"로 추가.
 *
 * 패널 추가:
 *   BTV.registerPanel({ id, title, icon, mount(el, ctx), update(ctx)? })
 *     - mount: 패널이 처음 우측 도크에 붙을 때 1회. el 에 DOM 구성.
 *     - ctx = { store, core, el }
 *
 * 디버그 토글 추가:
 *   BTV.registerFeature({ id, label, desc, group?, default?, onRender(ctx)?, onLoad(ctx)?, onToggle(ctx,on)? })
 *     - onRender: 매 render(idx/기능 변경)마다. ctx.graph 로 노드 DOM 접근해 오버레이.
 *     - 켜져 있을 때만 onRender 가 호출된다.
 *     - ctx = { store, core, graph, idx, prevIdx, on } */
(function (BTV) {
  BTV.panels = [];
  BTV.features = [];
  BTV.registerPanel = function (p) { BTV.panels.push(p); return p; };
  BTV.registerFeature = function (f) {
    f.default = !!f.default; BTV.features.push(f); return f;
  };
})(window.BTV = window.BTV || {});
