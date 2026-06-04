# bt_log_viewer v2 — 기능 리스트업 & 구현 계획

> 목표: 녹화된 BT 실행 로그(`.btlog`/`.db3`→`session.json`)를 **토스 수준으로 친화적인 UI**로
> 보여주고, **Groot2·Blackboard 패널보다 훨씬 확장 가능한 구조**로 디버깅 기능을 무한 증식.
> 최종 갱신: 2026-06-04

---

## 0. 설계 원칙 (확장성의 근거)

1. **의존성 0 / 더블클릭 실행 유지** — npm·번들러 없음. classic `<script src>` + 전역
   `BTV` 네임스페이스(ES module 아님 → `file://` 더블클릭도 동작). `serve.sh` 도 제공.
2. **Core / UI 완전 분리** — 순수 로직(파싱·통계·diff)은 DOM 무관, 단위 테스트 가능(node).
3. **레지스트리 패턴** — 기능 추가 = "파일 1개 + 등록 1줄". Groot2 는 패널이 고정이지만
   여기는 **패널 레지스트리**와 **디버그 토글 레지스트리**로 누구나 끼워넣기 가능.
   - `BTV.registerPanel({id,title,icon,mount,update})` — 우측 도크 패널
   - `BTV.registerFeature({id,label,desc,default,onRender,onLoad})` — on/off 디버그 보조
4. **단일 상태 스토어 + 이벤트 버스** — `store`(sessions/idx/selection/toggles…)가 단일 진실,
   `store.on('render'|'load'|'select', cb)`. 모든 패널·기능은 구독만 하면 자동 동기화.
5. **토스 디자인 시스템** — 라이트 테마, 넉넉한 여백, 둥근 모서리(12–16px), 은은한 그림자,
   강조색 1개(Toss Blue #3182F6), 명료한 타이포(Pretendard), 부드러운 모션.

```
bt_log_viewer/
├─ index.html              # 앱 셸 (script 태그로 아래 모듈 로드)
├─ app/
│  ├─ style.css            # 디자인 시스템 토큰 + 컴포넌트
│  ├─ core/   btlog.js tree.js timeline.js session.js diff.js store.js
│  ├─ ui/     registry.js graph.js timeline_ui.js app.js
│  ├─ panels/ inspector.js stats.js events.js blackboard.js search.js diff_panel.js
│  └─ features/ (디버그 토글들: reentry_pulse.js, active_path.js, ...)
├─ serve.sh
└─ bt_flow_check.py        # (기존) 데이터 파이프라인: .db3/.btlog → session.json
```

---

## 1. 목표 ①: UI/UX (토스 스타일 + 확장 구조)

- [x] 레지스트리 기반 아키텍처(패널/기능) — 위 0.3
- [x] 단일 상태 스토어 + 이벤트 버스 — 위 0.4
- [x] 토스 디자인 시스템(라이트, 카드, 둥근, 모션)
- [x] 앱 셸: 상단 바(로드·세션·검색·설정) / 좌 캔버스 / 우 도크(탭) / 하단 재생바
- [x] 명령 팔레트(⌘K) — 모든 액션/패널/토글 검색 실행
- [x] 반응형·접이식 도크, 빈 상태(empty state) 안내

## 2. 목표 ②: 녹화 데이터로 할 수 있는 "모든" 기능

### A. 시각화 / 탐색
- [x] A1 트리 그래프(상태색) · 줌/팬/핏
- [x] A2 SubTree 접기/펼치기
- [x] A3 노드 검색(이름·타입·uid) + 하이라이트 + 결과 순회
- [x] A4 상태/서브트리 필터
- [x] A5 미니맵(대형 트리 네비게이션)
- [x] A6 노드 경로(루트 체인) 강조

### B. 재생 / 타임라인
- [x] B1 스크러버 + 재생/일시정지
- [x] B2 전이별/실시간 배속 + 단일 스텝 + 키보드
- [x] B3 전이 밀도 히스토그램(타임라인 미니맵)
- [x] B4 구간 반복(A–B 루프)
- [x] B5 이벤트→시점 점프, 북마크

### C. 분석 / 통계
- [x] C1 노드별 전이 통계(S/F/R/K, 총 tick)
- [x] C2 duration 분포(최대·평균·합)
- [x] C3 전이 이벤트 로그(필터·검색 테이블)
- [x] C4 상태 타임라인(노드별 스윔레인/간트)
- [x] C5 핫스팟 랭킹(최다 실패·실행·최장 duration)
- [x] C6 트리 요약 카드

### D. 비교 / 검증
- [x] D1 기대 흐름(expected) vs 실제 diff 오버레이
- [x] D2 세션 A vs B 비교(골든 diff)
- [x] D3 불변식(check spec) 결과 표시
- [x] D4 두 레이어 병합 통합 재생

### E. 입출력 / 공유
- [x] E1 .btlog 직접 로드 · E2 session.json(단일/멀티)
- [x] E3 현재 세션/상태 export(json) · E4 SVG/PNG 스냅샷
- [x] E5 공유 URL(?btlog=, ?data=)
- [x] E6 blackboard(extra_data) 시점별 표시

## 3. 목표 ③: 디버깅 최적화 토글 (on/off, 필요할 때만)

> 모두 설정 시트(⚙)와 명령 팔레트에서 즉시 on/off. 기본값은 "방해되지 않게" 보수적으로.

- [x] F1 **같은 색 재진입 펄스 플래시** (예: SUCC→RUN→SUCC) — 사용자 요청 예시
- [x] F2 현재 전이 노드 링 하이라이트
- [x] F3 RUNNING 노드 숨쉬기 글로우
- [x] F4 실패 노드 잔상(sticky failure) — 한 번 FAILURE면 표식 유지
- [x] F5 활성 경로(루트→현재 노드) 강조
- [x] F6 직전 idx 대비 "상태 바뀐 노드"만 깜빡
- [x] F7 자동 따라가기(현재 전이 노드로 카메라 팬)
- [x] F8 미진입 노드 흐리게(dim) — 한 번도 안 탄 노드
- [x] F9 카운트 배지(노드 위 S/F 수)
- [x] F10 duration 히트맵(오래 걸린 노드 강조)

---

## 4. 구현 순서 (Phase)

1. **P1 토대** — 디자인 시스템(css) + store/registry + core 이식(btlog/tree/timeline/session/diff)
2. **P2 셸+그래프+재생** — app shell, graph 렌더(토스풍), timeline/재생바, 미니맵
3. **P3 패널** — inspector, stats, events, blackboard, search, diff
4. **P4 디버그 토글** — features/* + 설정 시트 + 명령 팔레트
5. **P5 입출력** — export(json/svg/png), 공유 URL, 멀티세션/병합 UI
6. **검증** — 기존 `/tmp/*.btlog`(레이어1+2)로 전 기능 동작·회귀 확인, 단계별 로컬 커밋

> 각 Phase 끝마다 node 단위 테스트(core 순수함수) + 브라우저 수동 확인 + 커밋.

---

## 5. 구현·검증 결과 (2026-06-04, v2)

headless Chromium(Playwright)으로 실제 `nav_single_internal.btlog`(313노드/26,324전이) +
`bt_execution.btlog`(MoveTree)로 검증. **전 항목 콘솔 에러 0.**

| 검증 | 결과 |
|---|---|
| 적재(file:// & http) | 313노드 렌더, 패널6→7, 기능10, core23 로드 |
| 상태 색칠 | mid 시점 RUNNING11/SUCCESS4/FAILURE1 → 박스색 정확 일치 |
| 접기/펼치기 | 상위노드 접기 시 317→10 노드 |
| 병합 | MoveTree+NavSingle 통합 26,327전이, namespaced 경로 표시 |
| 간트 | 상위 60노드 13,186 상태 세그먼트 + 플레이헤드 |
| 구간반복 | A=100,B=500 설정 정상 |
| 검증 패널 | 불변식 평가(2/2 PASS) + 행클릭→그래프 2노드 하이라이트 |
| 디버그 토글 F1~F10 | glow14·경로5·dim218·sticky35→52·badge52·flash누적 모두 동작 |
| export | SVG/PNG 다운로드(CSS변수 해석 주입) |
| 명령 팔레트 ⌘K | 액션·패널·토글 검색 실행 |

**미세 보완 메모(후속 여지):** 그래프 자체의 "상태별 필터"는 이벤트 패널 필터로 대체(노드
숨김은 미구현). diff 의 위반-노드 표시는 검증패널 행클릭→search-hit 하이라이트로 연결.
