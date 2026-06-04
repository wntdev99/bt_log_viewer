/* core/tree.js — XML→트리, uid맵, 레이아웃 (DOM: DOMParser 만 사용, 나머지 순수).
 * bt_flow_check.py _build_tree / _build_nodes_map 와 1:1. */
(function (BTV) {
  // xml_tree → SubTree 펼친 노드 트리 {uid,name,type,subtree?,children[]}
  function buildTreeFromXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('트리 XML 파싱 실패');
    const root = doc.documentElement;
    const bts = Array.from(root.children).filter(e => e.tagName === 'BehaviorTree');
    const defs = {}; bts.forEach(bt => defs[bt.getAttribute('ID')] = bt);
    const kids = el => Array.from(el.children).filter(c => c.getAttribute('_uid') != null);
    function nodeOf(el) {
      const uid = el.getAttribute('_uid'), tag = el.tagName, name = el.getAttribute('name') || tag;
      if (tag === 'SubTree') {
        const subid = el.getAttribute('ID'), d = defs[subid];
        return { uid: uid != null ? +uid : null, name, type: 'SubTree', subtree: subid,
                 children: d ? kids(d).map(nodeOf) : [] };
      }
      return { uid: uid != null ? +uid : null, name, type: tag, children: kids(el).map(nodeOf) };
    }
    const main = bts[0];
    const rootNode = main ? kids(main)[0] : null;
    return { tree: rootNode ? nodeOf(rootNode) : null, treeName: main && main.getAttribute('ID') };
  }

  // 트리 → uid:fullpath(근사) 맵. SubTree 는 'subid::uid/' prefix.
  function buildNodesMap(tree) {
    const nodes = {};
    (function walk(n, prefix) {
      if (!n) return;
      if (n.uid != null) nodes[String(n.uid)] = `${prefix}${n.name || n.type}::${n.uid}`;
      const np = n.type === 'SubTree' ? `${prefix}${n.subtree || 'SubTree'}::${n.uid}/` : prefix;
      (n.children || []).forEach(c => walk(c, np));
    })(tree, '');
    return nodes;
  }

  // 가로 트리 레이아웃. collapsed(Set of uid 문자열) 에 든 노드는 자식 접음(_collapsed).
  // 반환 노드는 _x,_y,_depth,_collapsed,_hidden 부여.
  const NX = 230, NY = 34;
  function layout(root, collapsed) {
    collapsed = collapsed || new Set();
    let leaf = 0; const nodes = [], edges = [];
    (function walk(n, depth, parent) {
      n._depth = depth; n._collapsed = false; n._hidden = false;
      const isCol = n.uid != null && collapsed.has(String(n.uid));
      const kids = (!isCol && n.children) ? n.children : [];
      n._x = depth * NX;
      if (kids.length === 0) { n._y = (leaf++) * NY; n._collapsed = isCol && (n.children || []).length > 0; }
      else { kids.forEach(c => walk(c, depth + 1, n)); n._y = (kids[0]._y + kids[kids.length - 1]._y) / 2; }
      nodes.push(n);
      if (parent) edges.push([parent, n]);
    })(root, 0, null);
    return { nodes, edges, NX, NY };
  }

  // 트리 전체 노드 평탄화(접힘 무시) — 검색/통계용.
  function flatten(tree) {
    const out = [];
    (function walk(n) { if (!n) return; out.push(n); (n.children || []).forEach(walk); })(tree);
    return out;
  }

  // uid → 루트까지의 부모 체인(자기 포함) 반환. 활성 경로 강조용.
  function pathToRoot(tree, uid) {
    const target = String(uid); let found = null;
    (function walk(n, chain) {
      if (found) return;
      const c = chain.concat(n);
      if (n.uid != null && String(n.uid) === target) { found = c; return; }
      (n.children || []).forEach(k => walk(k, c));
    })(tree, []);
    return found || [];
  }

  BTV.core = BTV.core || {};
  Object.assign(BTV.core, { buildTreeFromXml, buildNodesMap, layout, flatten, pathToRoot, NX, NY });
})(window.BTV = window.BTV || {});
