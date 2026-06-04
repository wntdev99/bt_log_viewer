/* core/store.js — 단일 상태 스토어 + 이벤트 버스.
 * 이벤트: 'sessions'(목록변경) 'load'(활성세션/레이아웃 재구성) 'render'(idx·기능 변경→재색칠)
 *         'select'(선택 노드) 'feature'(토글) 'search'(검색어) 'loop'/'bookmarks'(타임라인 표식)
 * 모든 패널/기능은 store.on(...) 구독만으로 자동 동기화된다. */
(function (BTV) {
  const C = BTV.core;
  const listeners = {};
  const state = {
    sessions: [], activeIndex: -1,
    idx: 0, playing: false, mode: 'tick', speed: 1,
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
