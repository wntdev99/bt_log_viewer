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
    setActive(i) {
      if (i < 0 || i >= state.sessions.length) return;
      state.activeIndex = i;
      state.live = !!state.sessions[i]._live;
      const s = state.sessions[i];
      state.collapsed = new Set();
      state.seq = C.buildSeq(s.timeline);
      state.stats = C.nodeStats(s.timeline);
      state.density = C.densityBuckets(s.timeline, 160);
      state.selectedUid = null; state.loopAB = null; state.bookmarks = [];
      state.idx = 0;
      emit('load', s);
      emit('render', 0);
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
    startLiveSession(xml, firstTs, file) {
      const { tree, treeName } = C.buildTreeFromXml(xml);
      const s = { _live: true,
        meta: { tree: treeName, session: 'live', date: C.utcDate(firstTs), source: 'live',
                t0: firstTs, t1: firstTs, count: 0, file: '🔴 ' + (file || 'live') },
        tree, nodes: C.buildNodesMap(tree), timeline: [], expected: null };
      state.sessions.push(s); state.activeIndex = state.sessions.length - 1;
      state.live = true; state.follow = true;
      state.collapsed = new Set(); state.seq = new Map(); state.stats = {}; state.density = [];
      state.selectedUid = null; state.loopAB = null; state.bookmarks = []; state.idx = 0;
      emit('sessions', state.sessions); emit('load', s); emit('render', 0);
    },
    appendLive(trs) {
      const s = this.active; if (!s || !trs || !trs.length) return;
      const base = s.timeline.length;
      trs.forEach((tr, k) => {
        const i = base + k; s.timeline.push([tr[0], tr[1], tr[2], 0]);
        const uid = String(tr[1]);
        if (!state.seq.has(uid)) state.seq.set(uid, []);
        state.seq.get(uid).push([i, tr[2]]);
        const st = state.stats[uid] || (state.stats[uid] = { run: 0, succ: 0, fail: 0, skip: 0, total: 0, durSum: 0, durMax: 0, durCnt: 0 });
        st.total++; if (tr[2] === 1) st.run++; else if (tr[2] === 2) st.succ++; else if (tr[2] === 3) st.fail++; else if (tr[2] === 4) st.skip++;
      });
      s.meta.count = s.timeline.length; s.meta.t1 = s.timeline[s.timeline.length - 1][0];
      if (!growTimer) growTimer = setTimeout(() => { growTimer = null; this.commitGrow(); }, 160);
    },
    commitGrow() {
      const s = this.active; if (!s) return;
      state.density = C.densityBuckets(s.timeline, 160);
      emit('grow', s);
      if (state.follow) this.setIdx(s.timeline.length - 1); else emit('render', state.idx);
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
