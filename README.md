# bt_log_viewer

BehaviorTree.CPP 실행 로그(`.btlog` / `.db3`)를 **사후에 정량 검증·시각 재생·디버깅**하는 독립 도구.
외부 의존성 0 — 파이썬 표준 라이브러리 + 브라우저(vanilla JS)만 사용.

대상 로거:
- **FileLogger2 (`.btlog`)** — 고속 전이도 무손실(권장). 뷰어가 직접 파싱.
- **SqliteLogger (`.db3`)** — `bt_flow_check.py export` 로 `session.json` 변환 후 사용.
- `state`: `IDLE=0 RUNNING=1 SUCCESS=2 FAILURE=3 SKIPPED=4`
- `timestamp`: `TimestampType::absolute` = epoch-µs(wall-clock) → 다층 로그 병합 가능

---

## 1. 뷰어 (web app) — `index.html`

진입 시 두 가지 모드를 고른다:

- **📁 녹화본 재생** — 저장된 `.btlog`/`.session.json` 을 열어 시간축으로 되감아 분석.
- **🔴 실시간 추적** — 로컬에서 기록 중인 `.btlog` 경로를 지정해 자라나는 전이를 실시간 추종.

```bash
# 녹화본만: 더블클릭(의존성 0, file:// 동작) 또는 정적 서버
xdg-open index.html

# 실시간 추적: tail 서버 필요 (브라우저는 로컬 파일경로를 직접 못 읽으므로 SSE 로 스트리밍)
./serve.sh --watch /tmp/bt_execution.btlog      # → http://localhost:8777
#   진입화면 "실시간 추적" → 경로 입력 → 연결.  (?live=/tmp/bt_execution.btlog 로 자동연결도 가능)
```

> 실시간 추적 메커니즘: `live_server.py` 가 지정 `.btlog` 를 tail-follow 하여 헤더(트리)와
> 새 전이를 SSE 로 보내고, 뷰어는 받는 즉시 타임라인에 누적·색칠한다. `● LIVE` 칩으로
> 최신 추종 on/off. FileLogger2 는 async writer + 버퍼라 디스크 반영이 청크 단위(거의 실시간)이며,
> 파일은 goal 1회마다 새로 생성되므로 새 세션은 자동으로 다시 잡힌다.

사용(녹화본):
1. `.btlog`(또는 `.session.json`)를 화면에 **끌어다 놓거나** `📂 열기`로 선택.
2. 여러 개를 올린 뒤 **⛓ 합쳐보기** → 레이어(예: MoveTree + NavSingle)를 한 타임라인으로 병합.
3. 하단 **방식(전이별/실시간)·배속**으로 재생, `◀ ▶`·`←→`로 한 전이씩, 밀도바 클릭으로 점프.
4. `⌘K` 명령 팔레트, `↔`/`↕`(또는 `o`) 좌우↔위아래 방향 전환, `🌗`(또는 `t`) 화이트/블랙 테마, `⚙` 디버그 기능 토글.

> 노드는 상태색으로 **전체 채움**(IDLE 회색 · RUNNING 주황 · SUCCESS 초록 · FAILURE 빨강 · SKIPPED 회색),
> 텍스트는 대비색으로 자동 조정. 테마는 `localStorage` 에 저장된다.

### 패널 (우측 도크)
| 패널 | 내용 |
|---|---|
| 🔍 노드 | 선택 노드 상태·S/F/R/K 카운트·duration·최근 전이 |
| 📊 통계 | 트리 요약 + 핫스팟(최다 실패/실행/최장 duration) 랭킹 |
| 📜 이벤트 | 전이 로그(필터·검색·현재시점 추적·클릭 점프) |
| 🗂 BB/extra | `extra_data` 시점별 표시 |
| 🔎 검색 | 노드 검색(이름·타입·#uid) + 순회 |
| ✅ 검증 | 불변식 spec(JSON) 평가 + 세션 A↔B 비교 |

### 디버그 토글 (⚙, 필요할 때만 on/off)
재진입 펄스(기본 ON, `SUCC→RUN→SUCC` 같은 색 재진입을 플래시) · 전이 링 · 변경 깜빡 ·
RUNNING 글로우 · 실패 잔상 · 활성 경로 · 자동 따라가기 · 미진입 흐리게 · 실패 배지 · duration 히트맵.

---

## 2. 데이터 파이프라인 (CLI) — `bt_flow_check.py`

```bash
python3 bt_flow_check.py sessions <db>                      # 회차 목록
python3 bt_flow_check.py dump     <db> [--session N]         # 전이 트레이스
python3 bt_flow_check.py check    <db> <spec.json>           # 불변식 검증(통과 0/실패 1)
python3 bt_flow_check.py merge    <db1> <db2> ...            # wall-clock 병합
python3 bt_flow_check.py export   <file.btlog|file.db3> [--out f.json] [--all-sessions]
```

`export` 는 `.btlog`/`.db3` 모두 받아 뷰어용 `session.json` 생성(`--all-sessions` = .db3 다회차 묶음).

---

## 3. 아키텍처 — "Groot2 보다 확장 가능"

의존성 0, classic `<script>` + 전역 `BTV` 네임스페이스. **기능 추가 = 파일 1개 + 등록 1줄.**

```
app/
├─ core/   btlog tree timeline session diff store   (DOM 무관 순수 로직 + 단일 상태 스토어)
├─ ui/     registry graph minimap timeline_ui app    (렌더·재생·셸)
├─ panels/ *.js   → BTV.registerPanel({id,title,icon,mount,update})
└─ features/ *.js → BTV.registerFeature({id,label,desc,default,onRender})
```

- **store** 가 단일 진실(sessions/idx/selection/toggles…). 모든 패널·기능은 `store.on('render'|'load'|'select', …)` 구독만으로 자동 동기화.
- 새 **패널**: `app/panels/foo.js` 에 `BTV.registerPanel({...})` → 도크 탭·명령 팔레트에 자동 등장.
- 새 **디버그 토글**: `app/features/foo.js` 에 `BTV.registerFeature({...})` → 설정 시트·팔레트에 자동 등장.
- `session.json` 의 `expected` 슬롯에 기대 흐름 spec 주입 → ✅검증 패널이 자동 평가.

> 검증: headless Chromium(Playwright)으로 313노드/26,324전이 로드·색칠·병합·전 기능 토글 무에러 확인.
> 테스트는 `node .playwright-test/test.mjs` (개발 의존성 `playwright`, `npm i` 후).

## 참고
검증 방법론 전체: `dev-behavior-tree/develop_bt/guide/08_testing/flow_verification.md`
