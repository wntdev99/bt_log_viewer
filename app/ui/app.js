/* ui/app.js — 부트스트랩. 모든 모듈을 엮고 셸을 가동. (script 로드 순서상 가장 마지막) */
(function (BTV) {
  const C = BTV.core, store = BTV.store;
  const $ = id => document.getElementById(id);

  /* ---- 테마 (화이트/블랙, localStorage 영속) ---- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('btv-theme', t); } catch (e) {}
    const btn = $('themeBtn'); if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
    // 미니맵 색은 테마에 맞춰 재구성
    BTV.minimap && BTV.minimap.rebuild && BTV.minimap.rebuild();
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark'); BTV.toast(cur === 'dark' ? '화이트 테마' : '블랙 테마');
  }

  /* ---- 트리 방향 (LR 좌우 / TB 위아래, localStorage 영속) ---- */
  function applyOrient(o, rebuild) {
    store.state.orient = o;
    try { localStorage.setItem('btv-orient', o); } catch (e) {}
    const btn = $('orientBtn'); if (btn) btn.textContent = o === 'TB' ? '↕' : '↔';
    if (rebuild && store.active) { store.setOrient(o); BTV.graph && BTV.graph.fit(); }
  }
  function toggleOrient() {
    const next = (store.state.orient === 'TB') ? 'LR' : 'TB';
    applyOrient(next, true); BTV.toast(next === 'TB' ? '위아래 보기' : '좌우 보기');
  }

  /* ---- 토스트 ---- */
  let toastTimer = null;
  BTV.toast = function (msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  };

  /* ---- 진입 모드 / 실시간 추적 (다중 파일 동시 가능) ---- */
  let liveConns = [];   // [{ es, session, path }] — 파일마다 하나씩, 각각 독립 세션
  function showLanding() {
    $('landing').classList.add('show'); $('liveForm').style.display = 'none';
    document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('sel'));
    // 이미 보고 있는 세션이 있으면 닫기 가능(취소), 없으면 모드 선택 강제
    $('landingClose').style.display = store.state.sessions.length ? '' : 'none';
  }
  function hideLanding() { $('landing').classList.remove('show'); }
  function dismissLanding() { if (store.state.sessions.length) hideLanding(); }
  function closeLive() { liveConns.forEach(c => c.es.close()); liveConns = []; renderLiveConns(); }
  function disconnectLive(path) {
    const i = liveConns.findIndex(c => c.path === path); if (i < 0) return;
    liveConns[i].es.close(); liveConns.splice(i, 1); renderLiveConns(); BTV.toast('연결 해제: ' + path);
  }
  function renderLiveConns() {
    const box = $('liveConns'); if (!box) return;
    box.innerHTML = liveConns.length
      ? '<div class="muted" style="margin:8px 0 4px">연결됨 ' + liveConns.length + '개</div>' + liveConns.map(c =>
          `<div class="row" style="gap:6px;padding:3px 0"><span class="tag fail">●</span><span class="mono" style="flex:1;font-size:11px">${c.path}</span><button class="btn ghost icon sm" data-dc="${encodeURIComponent(c.path)}">✕</button></div>`).join('')
      : '';
    box.querySelectorAll('[data-dc]').forEach(b => b.onclick = () => disconnectLive(decodeURIComponent(b.dataset.dc)));
  }
  function refreshLiveChip() {
    const chip = $('liveChip');
    if (!store.state.live) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    const n = liveConns.length;
    if (store.state.follow) { chip.className = 'live-chip following'; chip.textContent = '● LIVE 추종' + (n > 1 ? ` (${n})` : ''); }
    else { chip.className = 'live-chip paused'; chip.textContent = '⏸ 정지 (스크럽됨)'; }
  }
  function connectLive(path) {
    if (location.protocol === 'file:') {
      $('liveHint').innerHTML = '⚠ 실시간 추적은 로컬 서버가 필요합니다.<br>터미널에서 <code>./serve.sh --watch ' + (path || '/tmp/bt_execution.btlog') + '</code> 실행 후 <b>http://localhost:8777</b> 로 접속하세요.';
      return;
    }
    if (!path) { BTV.toast('파일 경로를 입력하세요'); return; }
    const dup = liveConns.find(c => c.path === path);
    if (dup) {   // 이미 연결됨 → 그 세션으로 전환
      const idx = store.state.sessions.indexOf(dup.session);
      if (idx >= 0) store.setActive(idx);
      hideLanding(); BTV.toast('이미 연결됨: ' + path); return;
    }
    const conn = { es: null, session: null, path };
    const es = new EventSource('/live?path=' + encodeURIComponent(path)); conn.es = es;
    liveConns.push(conn); renderLiveConns();
    BTV.toast('실시간 연결: ' + path);
    es.addEventListener('init', e => {
      const d = JSON.parse(e.data);
      // 파일이 새로 생성될 때마다 init 재수신 → 매 run 을 새 세션으로(이 연결이 활성이면 따라감).
      const wasActive = !conn.session || store.active === conn.session;
      try { conn.session = store.startLiveSession(d.xml, d.firstTs, d.path, wasActive); if (wasActive) BTV.graph && BTV.graph.fit(); }
      catch (err) { BTV.toast('트리 파싱 실패: ' + err.message); }
      renderLiveConns();
    });
    es.addEventListener('append', e => { if (conn.session) store.appendLiveTo(conn.session, JSON.parse(e.data).t); });
    es.addEventListener('status', e => BTV.toast('실시간: ' + JSON.parse(e.data).msg));
    es.onerror = () => { /* EventSource 자동 재연결 */ };
    hideLanding();
  }

  /* ---- 파일 적재 ---- */
  function ingestFile(file) {
    closeLive();                          // 녹화본 적재 시 실시간 연결 종료
    const n = file.name.toLowerCase(), r = new FileReader();
    if (n.endsWith('.btlog')) {
      r.onload = () => { try { store.addSessions([C.sessionFromBtlog(file.name, r.result)]); BTV.toast('불러옴: ' + file.name); } catch (e) { BTV.toast('btlog 파싱 실패: ' + e.message); } };
      r.readAsArrayBuffer(file);
    } else if (n.endsWith('.json')) {
      r.onload = () => { try { store.addSessions(C.sessionsFromJson(JSON.parse(r.result), file.name)); BTV.toast('불러옴: ' + file.name); } catch (e) { BTV.toast('JSON 파싱 실패: ' + e); } };
      r.readAsText(file);
    } else if (n.endsWith('.db3')) {
      BTV.toast('.db3 는 브라우저에서 못 엽니다 — bt_flow_check.py export 또는 .btlog 사용');
    } else BTV.toast('지원하지 않는 형식: ' + file.name);
  }

  /* ---- 세션 선택 ---- */
  function refreshSessions() {
    const sel = $('sessionSel'); sel.innerHTML = '';
    store.state.sessions.forEach((s, i) => {
      const m = s.meta || {}, o = document.createElement('option');
      o.value = i; o.textContent = `${m.tree || '?'} · ${m.count}전이 · ${(m.file || ('s' + m.session))}`;
      sel.appendChild(o);
    });
    sel.value = store.state.activeIndex;
    $('sessionWrap').style.display = store.state.sessions.length ? '' : 'none';
    const nonMerged = store.state.sessions.filter(s => (s.meta || {}).source !== 'merged');
    $('mergeBtn').style.display = nonMerged.length >= 2 ? '' : 'none';
    $('empty').style.display = store.state.sessions.length ? 'none' : '';
  }

  /* ---- 우측 도크 (패널 레지스트리) ---- */
  function buildDock() {
    const tabs = $('dockTabs'), body = $('dockBody');
    tabs.innerHTML = ''; body.innerHTML = '';
    BTV.panels.forEach((p, i) => {
      const tab = document.createElement('button'); tab.className = 'dock-tab'; tab.textContent = (p.icon ? p.icon + ' ' : '') + p.title;
      tab.onclick = () => activatePanel(p.id); tab.dataset.pid = p.id; tabs.appendChild(tab);
      const el = document.createElement('div'); el.className = 'panel scrollbar-thin'; el.dataset.pid = p.id; body.appendChild(el);
      try { p.mount(el, { store, core: C, el }); } catch (e) { console.error('[panel]', p.id, e); el.innerHTML = '패널 오류: ' + e.message; }
    });
    if (BTV.panels.length) activatePanel(BTV.panels[0].id);
  }
  function activatePanel(pid) {
    if ($('dock').classList.contains('collapsed')) $('dock').classList.remove('collapsed');
    document.querySelectorAll('.dock-tab').forEach(t => t.classList.toggle('active', t.dataset.pid === pid));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.pid === pid));
  }

  /* ---- 설정 시트 (기능 토글 레지스트리) ---- */
  function buildSettings() {
    const body = $('settingsBody'); body.innerHTML = '';
    const groups = {};
    BTV.features.forEach(f => { (groups[f.group || '디버그 보조'] = groups[f.group || '디버그 보조'] || []).push(f); });
    Object.entries(groups).forEach(([g, fs]) => {
      const gl = document.createElement('div'); gl.className = 'group-label'; gl.textContent = g; body.appendChild(gl);
      fs.forEach(f => {
        const row = document.createElement('label'); row.className = 'toggle-row';
        row.innerHTML = `<span class="meta"><b>${f.label}</b><span>${f.desc || ''}</span></span>
          <span class="switch"><input type="checkbox" ${store.state.features[f.id] ? 'checked' : ''}><span class="track"></span></span>`;
        row.querySelector('input').onchange = e => { store.setFeature(f.id, e.target.checked); };
        body.appendChild(row);
      });
    });
  }

  /* ---- 명령 팔레트 (⌘K) ---- */
  function actions() {
    const a = [
      { ic: '🏠', label: '시작 화면 (모드 선택)', sub: '녹화본/실시간', run: showLanding },
      { ic: '📂', label: '파일 열기', sub: '.btlog / .session.json', run: () => $('fileInput').click() },
      { ic: '🎯', label: '화면 맞춤(Fit)', sub: 'f', run: () => BTV.graph && BTV.graph.fit() },
      { ic: '⏯', label: '재생 / 일시정지', sub: 'Space', run: () => BTV.transport.play() },
      { ic: '⛓', label: '세션 합쳐보기(병합)', sub: '레이어 통합 타임라인', run: doMerge },
      { ic: '💾', label: '현재 세션 JSON 저장', sub: 'export', run: exportJson },
      { ic: '🖼', label: '트리 SVG 저장', sub: 'snapshot', run: exportSVG },
      { ic: '📸', label: '트리 PNG 저장', sub: '현재 화면', run: exportPNG },
      { ic: '🔀', label: '트리 방향 전환 (좌우/위아래)', sub: 'o', run: toggleOrient },
      { ic: '🌗', label: '화이트/블랙 테마 전환', sub: 't', run: toggleTheme },
      { ic: '⚙', label: '디버그 기능 설정 열기', sub: '토글', run: () => openSheet('settings') },
    ];
    BTV.panels.forEach(p => a.push({ ic: p.icon || '▦', label: '패널: ' + p.title, sub: 'dock', run: () => activatePanel(p.id) }));
    BTV.features.forEach(f => a.push({ ic: store.state.features[f.id] ? '🟢' : '⚪', label: '토글: ' + f.label, sub: f.desc || '', run: () => { store.toggleFeature(f.id); buildSettings(); BTV.toast(f.label + (store.state.features[f.id] ? ' 켜짐' : ' 꺼짐')); } }));
    return a;
  }
  let cmdList = [], cmdActive = 0;
  function openPalette() {
    openSheet('palette'); const inp = $('cmdInput'); inp.value = ''; renderPalette(''); inp.focus();
  }
  function renderPalette(q) {
    q = (q || '').toLowerCase();
    cmdList = actions().filter(a => (a.label + ' ' + a.sub).toLowerCase().includes(q)); cmdActive = 0;
    const body = $('cmdResults');
    body.innerHTML = cmdList.map((a, i) => `<div class="cmd-item ${i === 0 ? 'active' : ''}" data-i="${i}"><span class="ic">${a.ic}</span><span><div>${a.label}</div><div class="sub">${a.sub}</div></span>${a.sub ? `<kbd>${a.sub}</kbd>` : ''}</div>`).join('') || '<div class="empty-hint">결과 없음</div>';
    body.querySelectorAll('.cmd-item').forEach(it => it.onclick = () => runCmd(+it.dataset.i));
  }
  function runCmd(i) { const a = cmdList[i]; if (a) { closeSheets(); a.run(); } }

  /* ---- 시트 열고닫기 ---- */
  function openSheet(which) {
    closeSheets();
    if (which === 'settings') { buildSettings(); $('settingsOverlay').classList.add('show'); }
    else if (which === 'palette') $('paletteOverlay').classList.add('show');
  }
  function closeSheets() { $('settingsOverlay').classList.remove('show'); $('paletteOverlay').classList.remove('show'); }

  /* ---- 병합 / export ---- */
  function doMerge() {
    const base = store.state.sessions.filter(s => (s.meta || {}).source !== 'merged');
    if (base.length < 2) { BTV.toast('합칠 세션이 2개 이상 필요합니다'); return; }
    store.addSessions([C.mergeSessions(base)]); BTV.toast('병합 세션 생성');
  }
  function download(name, text, type) {
    const b = new Blob([text], { type: type || 'application/json' }), u = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u);
  }
  function exportJson() {
    const s = store.active; if (!s) { BTV.toast('세션 없음'); return; }
    download((s.meta.tree || 'session') + '.session.json', JSON.stringify(s), 'application/json'); BTV.toast('JSON 저장');
  }
  const SVG_VARS = ['--surface', '--idle-line', '--running', '--success', '--failure', '--skipped',
    '--running-weak', '--success-weak', '--failure-weak', '--skipped-weak', '--accent', '--accent-weak',
    '--line', '--line-2', '--text', '--text-3'];
  function svgString() {
    const g = BTV.graph; if (!g) return null;
    const clone = g.svg.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // 독립 SVG 에선 var(--x) 가 안 풀리므로 해석된 값을 <style> 로 주입.
    const cs = getComputedStyle(document.documentElement);
    const decl = SVG_VARS.map(v => `${v}:${cs.getPropertyValue(v).trim()}`).join(';');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `svg{${decl}} text{font-family:sans-serif}`;
    clone.insertBefore(style, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
  function exportSVG() {
    const s = svgString(); if (!s) return;
    download((store.active ? store.active.meta.tree : 'tree') + '.svg', s, 'image/svg+xml'); BTV.toast('SVG 저장');
  }
  function exportPNG() {
    const g = BTV.graph; if (!g) return;
    const vb = g.vb, scale = 2, str = svgString();
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = vb.w * scale; cv.height = vb.h * scale;
      const cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = (store.active ? store.active.meta.tree : 'tree') + '.png'; a.click(); URL.revokeObjectURL(u); BTV.toast('PNG 저장'); });
    };
    img.onerror = () => BTV.toast('PNG 변환 실패 (SVG 로 저장하세요)');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  }

  /* ---- 키보드 ---- */
  function onKey(e) {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ($('paletteOverlay').classList.contains('show')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdActive = Math.min(cmdActive + 1, cmdList.length - 1); highlightCmd(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdActive = Math.max(cmdActive - 1, 0); highlightCmd(); }
      else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdActive); }
      else if (e.key === 'Escape') closeSheets();
      return;
    }
    if (e.key === 'Escape') { closeSheets(); dismissLanding(); return; }
    if (typing) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); BTV.transport.stop(); store.stepIdx(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); BTV.transport.stop(); store.stepIdx(-1); }
    else if (e.key === ' ') { e.preventDefault(); BTV.transport.play(); }
    else if (e.key.toLowerCase() === 'f') BTV.graph && BTV.graph.fit();
    else if (e.key.toLowerCase() === 't') toggleTheme();
    else if (e.key.toLowerCase() === 'o') toggleOrient();
    else if (e.key.toLowerCase() === 'b') store.toggleBookmark();
    else if (e.key === '/') { e.preventDefault(); $('searchInput') && $('searchInput').focus(); }
  }
  function highlightCmd() {
    const items = $('cmdResults').querySelectorAll('.cmd-item');
    items.forEach((it, i) => it.classList.toggle('active', i === cmdActive));
    items[cmdActive] && items[cmdActive].scrollIntoView({ block: 'nearest' });
  }

  /* ---- 부팅 ---- */
  function boot() {
    let saved = 'light'; try { saved = localStorage.getItem('btv-theme') || 'light'; } catch (e) {}
    applyTheme(saved);
    let savedOrient = 'LR'; try { savedOrient = localStorage.getItem('btv-orient') || 'LR'; } catch (e) {}
    applyOrient(savedOrient, false);   // 첫 로드 시 build 가 store.state.orient 를 읽음
    BTV.features.forEach(f => { if (!(f.id in store.state.features)) store.state.features[f.id] = f.default; });
    BTV.mountGraph($('svg'));
    BTV.mountMinimap($('minimapSvg'));
    BTV.mountTransport();
    buildDock();

    // 상단바 위젯
    $('fileInput').onchange = e => { Array.from(e.target.files).forEach(ingestFile); e.target.value = ''; };
    $('openBtn').onclick = () => $('fileInput').click();
    $('sessionSel').onchange = e => { BTV.transport.stop(); store.setActive(+e.target.value); };
    $('mergeBtn').onclick = doMerge;
    $('themeBtn').onclick = toggleTheme;
    $('orientBtn').onclick = toggleOrient;
    $('settingsBtn').onclick = () => openSheet('settings');
    $('paletteBtn').onclick = openPalette;
    $('dockToggle').onclick = () => $('dock').classList.toggle('collapsed');
    $('fitBtn').onclick = () => BTV.graph && BTV.graph.fit();
    $('cmdInput').oninput = e => renderPalette(e.target.value);
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheets);
    document.querySelectorAll('.overlay').forEach(o => o.addEventListener('mousedown', e => { if (e.target === o) closeSheets(); }));

    // 메타 칩 갱신
    store.on('load', s => {
      hideLanding();
      $('metaChip').textContent = `${s.meta.tree} · 노드 ${Object.keys(s.nodes).length} · 전이 ${s.meta.count} · ${((s.meta.t1 - s.meta.t0) / 1e6).toFixed(1)}s · ${s.meta.source}`;
      refreshSessions(); refreshLiveChip();
    });
    store.on('grow', s => { $('metaChip').textContent = `${s.meta.tree} · 노드 ${Object.keys(s.nodes).length} · 전이 ${s.meta.count} · ${((s.meta.t1 - s.meta.t0) / 1e6).toFixed(1)}s · live`; });
    store.on('follow', refreshLiveChip);
    store.on('sessions', refreshSessions);

    // 진입 화면 + 실시간 폼
    $('modeRecord').onclick = () => { closeLive(); hideLanding(); $('fileInput').click(); };
    $('modeLive').onclick = () => {
      $('liveForm').style.display = ''; $('modeLive').classList.add('sel'); $('modeRecord').classList.remove('sel');
      if (!$('livePath').value) $('livePath').value = '/tmp/bt_execution.btlog';
      renderLiveConns();
      $('liveHint').innerHTML = location.protocol === 'file:'
        ? '⚠ 실시간 추적은 로컬 서버 필요: <code>./serve.sh --watch &lt;경로&gt;</code> 실행 후 접속'
        : '여러 .btlog 를 추가하면 <b>동시에 각각 추적</b>됩니다. 상단 <b>세션 드롭다운</b>으로 전환하며 보세요. 서버가 각 경로를 tail-follow 합니다.';
    };
    $('liveConnect').onclick = () => connectLive($('livePath').value.trim());
    $('livePath').onkeydown = e => { if (e.key === 'Enter') connectLive($('livePath').value.trim()); };
    $('liveChip').onclick = () => store.setFollow(!store.state.follow);
    $('homeBtn').onclick = showLanding;
    $('landingClose').onclick = dismissLanding;
    $('landing').addEventListener('mousedown', e => { if (e.target === $('landing')) dismissLanding(); });

    // 드래그&드롭
    window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag-over'); });
    window.addEventListener('dragleave', e => { if (e.relatedTarget == null) document.body.classList.remove('drag-over'); });
    window.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drag-over'); Array.from(e.dataTransfer.files).forEach(ingestFile); });
    window.addEventListener('keydown', onKey);

    // URL 자동 로드: ?data= / ?btlog= (녹화본) · ?live=<경로> (실시간)
    const qs = new URLSearchParams(location.search);
    let auto = false;
    if (qs.get('data')) { auto = true; fetch(qs.get('data')).then(r => r.json()).then(j => store.addSessions(C.sessionsFromJson(j, qs.get('data').split('/').pop()))).catch(() => {}); }
    if (qs.get('btlog')) { auto = true; fetch(qs.get('btlog')).then(r => r.arrayBuffer()).then(b => store.addSessions([C.sessionFromBtlog(qs.get('btlog').split('/').pop(), b)])).catch(() => {}); }
    if (qs.get('live')) { auto = true; connectLive(qs.get('live')); }

    refreshSessions();
    if (!auto) showLanding();             // 진입 시 모드 선택
  }
  window.addEventListener('DOMContentLoaded', boot);
})(window.BTV = window.BTV || {});
