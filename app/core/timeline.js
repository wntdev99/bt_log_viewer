/* core/timeline.js — 타임라인 순수 로직: 상태조회·통계·밀도·핫스팟 (DOM 무관). */
(function (BTV) {
  const STATE = { 0: 'IDLE', 1: 'RUNNING', 2: 'SUCCESS', 3: 'FAILURE', 4: 'SKIPPED' };

  // uid(String) → [[transitionIndex, state], ...] (stateAt 의 인덱스)
  // ★ 키를 String 으로 통일: 그래프/패널은 String(uid)로 조회, btlog timeline 의 uid 는
  //   숫자라 통일하지 않으면 Map.get 미스(전부 IDLE)된다. 병합 세션은 'L0:1' 처럼 이미 String.
  function buildSeq(timeline) {
    const seq = new Map();
    timeline.forEach((tr, i) => {
      const uid = String(tr[1]), st = tr[2];
      if (!seq.has(uid)) seq.set(uid, []);
      seq.get(uid).push([i, st]);
    });
    return seq;
  }
  // 전이 index idx 시점의 uid 상태(그 이하 마지막 전이). 없으면 IDLE(0).
  function stateAt(seq, uid, idx) {
    const arr = seq.get(String(uid));
    if (!arr) return 0;
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= idx) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans < 0 ? 0 : arr[ans][1];
  }
  // log-time(epoch-us) t 이하 마지막 전이 인덱스(이분). t<t0 면 0.
  function idxAtTime(timeline, t) {
    let lo = 0, hi = timeline.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (timeline[m][0] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  // 노드별 통계: {uid:{run,succ,fail,skip,total,durSum,durMax,durCnt}}
  function nodeStats(timeline) {
    const m = {};
    for (const tr of timeline) {
      const uid = tr[1], st = tr[2], dur = tr[3] || 0;
      const s = m[uid] || (m[uid] = { run: 0, succ: 0, fail: 0, skip: 0, total: 0, durSum: 0, durMax: 0, durCnt: 0 });
      s.total++;
      if (st === 1) s.run++; else if (st === 2) s.succ++; else if (st === 3) s.fail++; else if (st === 4) s.skip++;
      if (dur > 0) { s.durSum += dur; s.durCnt++; if (dur > s.durMax) s.durMax = dur; }
    }
    return m;
  }

  // 타임라인 밀도 히스토그램: bins 개 구간의 전이 수 배열 (시간 균등 분할).
  function densityBuckets(timeline, bins) {
    bins = bins || 120;
    const out = new Array(bins).fill(0);
    if (!timeline.length) return out;
    const t0 = timeline[0][0], t1 = timeline[timeline.length - 1][0], span = Math.max(1, t1 - t0);
    for (const tr of timeline) {
      let b = Math.floor((tr[0] - t0) / span * bins);
      if (b >= bins) b = bins - 1; if (b < 0) b = 0;
      out[b]++;
    }
    return out;
  }

  // 핫스팟 랭킹. nodesMap(uid→path) 로 라벨 부여. kind: 'fail'|'run'|'dur'.
  function hotspots(stats, nodesMap, kind, topN) {
    topN = topN || 8;
    const rows = Object.entries(stats).map(([uid, s]) => ({
      uid, path: (nodesMap && nodesMap[uid]) || ('#' + uid),
      fail: s.fail, run: s.run, succ: s.succ, total: s.total,
      durMax: s.durMax, durAvg: s.durCnt ? s.durSum / s.durCnt : 0,
    }));
    const key = kind === 'fail' ? 'fail' : kind === 'dur' ? 'durMax' : kind === 'run' ? 'run' : 'total';
    return rows.sort((a, b) => b[key] - a[key]).slice(0, topN);
  }

  BTV.core = BTV.core || {};
  Object.assign(BTV.core, { STATE, buildSeq, stateAt, idxAtTime, nodeStats, densityBuckets, hotspots });
})(window.BTV = window.BTV || {});
