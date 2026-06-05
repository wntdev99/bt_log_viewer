/* core/store.js — 단일 상태 스토어 + 이벤트 버스.
 * 이벤트: 'sessions'(목록변경) 'load'(활성세션/레이아웃 재구성) 'render'(idx·기능 변경→재색칠)
 *         'select'(선택 노드) 'feature'(토글) 'search'(검색어) 'loop'/'bookmarks'(타임라인 표식)
 * 모든 패널/기능은 store.on(...) 구독만으로 자동 동기화된다. */
(function (BTV) {
  const C = BTV.core;
  const listeners = {};
  let growTimer = null;                  // 실시간 append 커밋 throttle
  const state = {
    sessions: [], activeIndex: -1,
    idx: 0, playing: false, mode: 'tick', speed: 1, orient: 'LR',
    live: false, follow: true,           // 실시간 추적 모드 / 최신 시점 자동 추종
    followZoom: 1300,                    // 자동 따라가기(F7) 줌 레벨 = viewBox 폭(world px)
    selectedUid: null, hoverUid: null,
    collapsed: new Set(),          // 접힌 SubTree uid 문자열
    features: {},                  // featureId -> bool
    search: '', searchHits: [], searchPos: 0,
    loopAB: null,                  // [a,b] 또는 null
    bookmarks: [],                 // [idx,...]
    // 활성 세션 파생 캐시 (load 시 재계산)
    seq: null, stats: null, density: null,
  };
  function emit(ev, payload) { (listeners[ev] || []).forEach(cb => { try { cb(payload, state); } catch (e) { console.error('[store]', ev, e); } }); }

  const store = {
    state,
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return () => { listeners[ev] = listeners[ev].filter(f => f !== cb); }; },
    emit,
    get active() { return state.activeIndex >= 0 ? state.sessions[state.activeIndex] : null; },

    addSessions(list) {
      if (!list || !list.length) return;
      const first = state.activeIndex < 0;
      const base = state.sessions.length;
      state.sessions.push(...list);
      emit('sessions', state.sessions);
      this.setActive(first ? 0 : base);          // 새로 추가된 첫 세션으로
    },
    // 파생 캐시(seq/stats/density)는 세션 객체에 보관 → 여러 라이브 세션이 동시에
    // 백그라운드로 독립 누적될 수 있다. 활성 세션의 캐시를 state.* 로 가리킨다.
    ensureDerived(s) {
      if (!s._seq) {
        s._seq = C.buildSeq(s.timeline);
        s._stats = C.nodeStats(s.timeline);
        s._density = C.densityBuckets(s.timeline, 160);
      }
      return s;
    },
    setActive(i) {
      if (i < 0 || i >= state.sessions.length) return;
      state.activeIndex = i;
      const s = state.sessions[i];
      state.live = !!s._live;
      if (s._liveMerge) this.rebuildMerged(s);       // 통합 라이브: 레이어 버퍼로 재구성
      else { this.ensureDerived(s); if (s._live) s._density = C.densityBuckets(s.timeline, 160); }
      state.seq = s._seq; state.stats = s._stats; state.density = s._density;
      state.collapsed = new Set();
      state.selectedUid = null; state.loopAB = null; state.bookmarks = [];
      state.idx = s._live && state.follow ? Math.max(0, s.timeline.length - 1) : 0;
      emit('load', s);
      emit('render', state.idx);
    },
    setIdx(i) {
      const s = this.active; if (!s) return;
      i = Math.max(0, Math.min(i | 0, s.timeline.length - 1));
      state.idx = i; emit('render', i);
    },
    stepIdx(d) { this.setIdx(state.idx + d); },
    select(uid) { state.selectedUid = uid; emit('select', uid); },
    hover(uid) { state.hoverUid = uid; },

    setMode(m) { state.mode = m; emit('config'); },
    setSpeed(s) { state.speed = +s; emit('config'); },
    setOrient(o) { state.orient = o; if (this.active) { emit('load', this.active); emit('render', state.idx); } },
    setFollowZoom(w) { state.followZoom = +w; emit('config'); },

    toggleCollapse(uid) {
      uid = String(uid);
      if (state.collapsed.has(uid)) state.collapsed.delete(uid); else state.collapsed.add(uid);
      emit('load', this.active);                 // 레이아웃 재구성 필요
      emit('render', state.idx);
    },
    setFeature(id, on) { state.features[id] = !!on; emit('feature', { id, on: !!on }); emit('render', state.idx); },
    toggleFeature(id) { this.setFeature(id, !state.features[id]); },

    setSearch(q) {
      state.search = q || ''; state.searchHits = []; state.searchPos = 0;
      const s = this.active;
      if (s && state.search) {
        const ql = state.search.toLowerCase();
        for (const n of C.flatten(s.tree)) {
          if (n.uid == null) continue;
          const hay = ((n.name || '') + ' ' + (n.type || '') + ' ' + (n.subtree || '') + ' #' + n.uid).toLowerCase();
          if (hay.includes(ql)) state.searchHits.push(String(n.uid));
        }
      }
      emit('search', state.searchHits);
    },
    searchNext(d) {
      if (!state.searchHits.length) return null;
      state.searchPos = (state.searchPos + (d || 1) + state.searchHits.length) % state.searchHits.length;
      const uid = state.searchHits[state.searchPos];
      this.select(+uid || uid);
      return uid;
    },

    /* ---- 실시간 추적 ---- */
    // 새 실시간 세션 시작 (.btlog 헤더의 xml + first_ts). 트리는 한 번만 빌드(구조 고정),
    // 전이는 appendLive 로 스트리밍. 같은 트리면 그래프는 1회만 build 된다.
    // 새 실시간 세션을 만들고 세션 객체를 반환(연결마다 1개). 여러 개 동시 가능.
    // makeActive=true 면 새로 만든 세션으로 전환(보통 새 연결 시 보여줌).
    startLiveSession(xml, firstTs, file, makeActive) {
      const { tree, treeName } = C.buildTreeFromXml(xml);
      const s = { _live: true, _seq: new Map(), _stats: {}, _density: [],
        meta: { tree: treeName, session: 'live', date: C.utcDate(firstTs), source: 'live',
                t0: firstTs, t1: firstTs, count: 0, file: '🔴 ' + (file || 'live') },
        tree, nodes: C.buildNodesMap(tree), timeline: [], expected: null };
      state.sessions.push(s);
      emit('sessions', state.sessions);
      if (makeActive !== false) { state.follow = true; this.setActive(state.sessions.length - 1); }
      return s;
    },
    // 특정 세션(s)에 전이 누적. s 가 비활성이어도 자체 캐시에 쌓이고, 활성일 때만 UI 갱신.
    appendLiveTo(s, trs) {
      if (!s || !trs || !trs.length) return;
      const base = s.timeline.length;
      trs.forEach((tr, k) => {
        const i = base + k; s.timeline.push([tr[0], tr[1], tr[2], 0]);
        const uid = String(tr[1]);
        if (!s._seq.has(uid)) s._seq.set(uid, []);
        s._seq.get(uid).push([i, tr[2]]);
        const st = s._stats[uid] || (s._stats[uid] = { run: 0, succ: 0, fail: 0, skip: 0, total: 0, durSum: 0, durMax: 0, durCnt: 0 });
        st.total++; if (tr[2] === 1) st.run++; else if (tr[2] === 2) st.succ++; else if (tr[2] === 3) st.fail++; else if (tr[2] === 4) st.skip++;
      });
      s.meta.count = s.timeline.length; s.meta.t1 = s.timeline[s.timeline.length - 1][0];
      if (s === this.active && !growTimer) growTimer = setTimeout(() => { growTimer = null; this.commitGrow(); }, 160);
    },
    commitGrow() {
      const s = this.active; if (!s) return;
      if (s._liveMerge) { this.rebuildMerged(s); state.seq = s._seq; state.stats = s._stats; state.density = s._density; }
      else { s._density = state.density = C.densityBuckets(s.timeline, 160); }
      emit('grow', s);
      if (state.follow) this.setIdx(s.timeline.length - 1); else emit('render', state.idx);
    },

    /* ---- 통합 실시간(여러 .btlog 를 한 타임라인으로) ---- */
    // 항상 정확: 레이어별 버퍼(rows)를 concat+sort 로 통째 재구성 → 인덱스 꼬임 0.
    rebuildMerged(m) {
      let tl = [];
      m._layers.forEach(L => { if (L.rows.length) tl = tl.concat(L.rows); });
      tl.sort((a, b) => a[0] - b[0]);
      m.timeline = tl;
      m._seq = C.buildSeq(tl); m._stats = C.nodeStats(tl); m._density = C.densityBuckets(tl, 160);
      m.meta.count = tl.length;
      if (tl.length) { m.meta.t0 = tl[0][0]; m.meta.t1 = tl[tl.length - 1][0]; }
    },
    startLiveMerge(paths) {
      const m = { _live: true, _liveMerge: true,
        _layers: paths.map(p => ({ path: p, treeName: null, tree: null, nodes: {}, rows: [] })),
        _seq: new Map(), _stats: {}, _density: [],
        meta: { tree: 'MERGED', session: 'live-merge', date: '', source: 'live', t0: 0, t1: 0, count: 0,
                file: '⛓🔴 ' + paths.map(p => p.split('/').pop()).join(' + ') },
        tree: { uid: null, type: '(merged)', name: 'MERGED (실시간)', children: [] }, nodes: {}, timeline: [], expected: null };
      state.sessions.push(m); emit('sessions', state.sessions);
      state.follow = true; this.setActive(state.sessions.length - 1);
      return m;
    },
    liveMergeInit(m, i, xml, firstTs, path) {
      const { tree, treeName } = C.buildTreeFromXml(xml);
      const ns = u => `L${i}:${u}`;
      const clone = n => ({ ...n, uid: n.uid != null ? ns(n.uid) : null, children: (n.children || []).map(clone) });
      const L = m._layers[i];
      L.treeName = treeName; L.tree = tree ? clone(tree) : null; L.rows = [];   // 새 run → 레이어 리셋
      L.nodes = {}; Object.entries(C.buildNodesMap(tree)).forEach(([u, fp]) => { L.nodes[ns(u)] = `L${i}/${fp}`; });
      m.nodes = {}; m._layers.forEach(x => Object.assign(m.nodes, x.nodes));
      m.tree.children = m._layers.map((x, li) => ({ uid: null, type: '(layer)',
        name: `▼ L${li} · ${x.treeName || x.path.split('/').pop()}`, children: x.tree ? [x.tree] : [] }));
      if (!m.meta.t0) m.meta.t0 = firstTs;
      if (!m.meta.date) m.meta.date = C.utcDate(firstTs);
      m.meta.tree = m._layers.map(x => x.treeName).filter(Boolean).join('+') || 'MERGED';
      if (m === this.active) { this.rebuildMerged(m); state.seq = m._seq; state.stats = m._stats; state.density = m._density;
        emit('load', m); emit('render', state.idx); }
    },
    liveMergeAppend(m, i, trs) {
      if (!trs || !trs.length) return;
      const L = m._layers[i], ns = u => `L${i}:${u}`;
      trs.forEach(tr => L.rows.push([tr[0], ns(tr[1]), tr[2], 0]));
      if (m === this.active && !growTimer) growTimer = setTimeout(() => { growTimer = null; this.commitGrow(); }, 200);
    },
    setFollow(b) { state.follow = !!b; emit('follow', state.follow); if (b) this.setIdx((this.active ? this.active.timeline.length - 1 : 0)); },

    setLoop(ab) { state.loopAB = ab; emit('loop', ab); },
    toggleBookmark(i) {
      i = (i == null) ? state.idx : i;
      const k = state.bookmarks.indexOf(i);
      if (k >= 0) state.bookmarks.splice(k, 1); else { state.bookmarks.push(i); state.bookmarks.sort((a, b) => a - b); }
      emit('bookmarks', state.bookmarks);
    },
  };

  BTV.store = store;
})(window.BTV = window.BTV || {});
