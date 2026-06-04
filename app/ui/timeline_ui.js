/* ui/timeline_ui.js — 하단 트랜스포트: 재생엔진 + 스크러버 + 밀도 히스토그램 + 구간반복 + 북마크. */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  const FRAME = 50, TICKMS = 140;        // 전이별 1× = ~7전이/초
  let timer = null, $ = {}, loopPending = null;
  const DBINS = 160;

  function $id(id) { return document.getElementById(id); }
  function stop() { if (timer) clearInterval(timer); timer = null; store.state.playing = false; $.play.innerHTML = '▶'; $.play.title = '재생 (Space)'; }
  function play() {
    if (timer) { stop(); return; }
    const s = store.active; if (!s || !s.timeline.length) return;
    store.state.playing = true; $.play.innerHTML = '⏸'; $.play.title = '일시정지 (Space)';
    const mode = store.state.mode, speed = store.state.speed, max = s.timeline.length - 1;
    if (mode === 'tick') {
      const iv = Math.max(8, Math.round(TICKMS / speed));   // 전이 생략 없이 1개씩, 간격만 조절
      timer = setInterval(() => {
        let v = store.state.idx; if (v >= max) { stop(); return; }
        let nx = v + 1;
        if (store.state.loopAB && nx > store.state.loopAB[1]) nx = store.state.loopAB[0];
        store.setIdx(nx);
      }, iv);
    } else {                                                // 실시간 비례(밀집 구간 건너뜀)
      let clock = s.timeline[store.state.idx][0];
      timer = setInterval(() => {
        let v = store.state.idx; if (v >= max) { stop(); return; }
        clock += speed * FRAME * 1000; let idx = C.idxAtTime(s.timeline, clock);
        if (idx <= v) idx = v + 1;
        if (store.state.loopAB && idx > store.state.loopAB[1]) { idx = store.state.loopAB[0]; clock = s.timeline[idx][0]; }
        store.setIdx(idx);
      }, FRAME);
    }
  }

  function fmtTime(s, idx) {
    const tr = s.timeline[idx]; if (!tr) return '0';
    return ((tr[0] - s.meta.t0) / 1e6).toFixed(3);
  }
  function updateReadout(idx) {
    const s = store.active; if (!s) return;
    $.scrub.value = idx;
    $.tl.textContent = `${idx} / ${s.timeline.length - 1}   ·   t+${fmtTime(s, idx)}s`;
    const tr = s.timeline[idx];
    if (tr) {
      const path = s.nodes[tr[1]] || ('#' + tr[1]);
      const extra = tr[4] ? `  [${tr[4]}]` : '';
      $.readout.textContent = `${C.STATE[tr[2]]}  ·  ${path}${extra}`;
    }
    updatePlayLine(idx);
  }

  /* ---- 밀도 히스토그램 ---- */
  function renderDensity() {
    const s = store.active; if (!s) { $.densitySvg.textContent = ''; return; }
    const d = store.state.density || []; const max = Math.max(1, ...d);
    const W = 1000, H = 40; let bars = '';
    d.forEach((v, i) => {
      const h = (v / max) * (H - 2), x = i / d.length * W, w = W / d.length + 0.5;
      bars += `<rect class="bar-d" x="${x.toFixed(2)}" y="${(H - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"/>`;
    });
    $.densitySvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    $.densitySvg.setAttribute('preserveAspectRatio', 'none');
    $.densitySvg.innerHTML = `<g id="dband"></g>${bars}<g id="dbm"></g><line class="play-line" id="pline" y1="0" y2="${H}"/>`;
    renderLoopBand(); renderBookmarks(); updatePlayLine(store.state.idx);
  }
  function timeFrac(idx) {
    const s = store.active; if (!s) return 0;
    const span = Math.max(1, s.meta.t1 - s.meta.t0);
    return (s.timeline[idx][0] - s.meta.t0) / span;
  }
  function updatePlayLine(idx) {
    const pl = $.densitySvg.querySelector('#pline'); if (!pl) return;
    const x = timeFrac(idx) * 1000; pl.setAttribute('x1', x); pl.setAttribute('x2', x);
  }
  function renderLoopBand() {
    const g = $.densitySvg.querySelector('#dband'); if (!g) return;
    if (!store.state.loopAB) { g.innerHTML = ''; return; }
    const [a, b] = store.state.loopAB, x1 = timeFrac(a) * 1000, x2 = timeFrac(b) * 1000;
    g.innerHTML = `<rect class="loop-band" x="${x1}" y="0" width="${Math.max(1, x2 - x1)}" height="40"/>`;
  }
  function renderBookmarks() {
    const g = $.densitySvg.querySelector('#dbm'); if (!g) return;
    g.innerHTML = store.state.bookmarks.map(i => `<rect class="bm" x="${(timeFrac(i) * 1000 - 1).toFixed(1)}" y="0" width="2" height="40"/>`).join('');
  }
  function seekFromDensity(clientX) {
    const s = store.active; if (!s) return;
    const r = $.density.getBoundingClientRect(), frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const t = s.meta.t0 + frac * (s.meta.t1 - s.meta.t0);
    stop(); store.setIdx(C.idxAtTime(s.timeline, t));
  }

  /* ---- 구간 반복 ---- */
  function cycleLoop() {
    if (!store.active) return;
    if (!store.state.loopAB && loopPending == null) { loopPending = store.state.idx; BTV.toast(`구간 시작 A = ${loopPending}. 끝 지점에서 다시 누르세요`); }
    else if (loopPending != null) {
      const a = Math.min(loopPending, store.state.idx), b = Math.max(loopPending, store.state.idx);
      loopPending = null; store.setLoop([a, b]); BTV.toast(`구간 반복 ${a}–${b} 설정`);
    } else { store.setLoop(null); BTV.toast('구간 반복 해제'); }
    $.loop.setAttribute('aria-pressed', !!store.state.loopAB);
    renderLoopBand();
  }

  function mount() {
    $ = { play: $id('playBtn'), rew: $id('rewBtn'), stepb: $id('stepBack'), stepf: $id('stepFwd'),
      scrub: $id('scrubber'), tl: $id('tl'), readout: $id('tickReadout'),
      mode: $id('modeSel'), speed: $id('speedSel'), loop: $id('loopBtn'), bm: $id('bmBtn'),
      density: $id('density'), densitySvg: $id('densitySvg') };

    $.play.onclick = play;
    $.rew.onclick = () => { stop(); store.setIdx(0); };
    $.stepb.onclick = () => { stop(); store.stepIdx(-1); };
    $.stepf.onclick = () => { stop(); store.stepIdx(1); };
    $.scrub.oninput = () => { stop(); store.setIdx(+$.scrub.value); };
    $.mode.onchange = () => { store.setMode($.mode.value); if (timer) { stop(); play(); } };
    $.speed.onchange = () => { store.setSpeed($.speed.value); if (timer) { stop(); play(); } };
    $.loop.onclick = cycleLoop;
    $.bm.onclick = () => { store.toggleBookmark(); renderBookmarks(); BTV.toast('북마크 토글 @ ' + store.state.idx); };
    $.density.onclick = e => seekFromDensity(e.clientX);

    store.on('load', s => { $.scrub.max = Math.max(0, s.timeline.length - 1); renderDensity(); updateReadout(0); });
    store.on('render', idx => updateReadout(idx));
    store.on('loop', () => { renderLoopBand(); $.loop.setAttribute('aria-pressed', !!store.state.loopAB); });
    store.on('bookmarks', renderBookmarks);

    BTV.transport = { play, stop, isPlaying: () => !!timer };
  }
  BTV.mountTransport = mount;
})(window.BTV = window.BTV || {});
