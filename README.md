# bt_log_viewer

BehaviorTree.CPP `SqliteLogger`(`.db3`) 로그를 **사후에 정량 검증·시각 재생**하는 독립 도구.
표준 라이브러리 + 브라우저만 사용 — 외부 의존성 0.

대상: BT.CPP 4.x `SqliteLogger` 가 생성한 `.db3`
- 스키마: `Definitions(session_id,date,xml_tree)` / `Nodes(session_id,fullpath,node_uid)` /
  `Transitions(timestamp,session_id,node_uid,duration,state,extra_data)`
- `state`: `IDLE=0 RUNNING=1 SUCCESS=2 FAILURE=3 SKIPPED=4`
- `timestamp`: `TimestampType::absolute` = epoch-µs (wall-clock) → 다층 로그 병합 가능

## 구성

| 파일 | 역할 |
|---|---|
| `bt_flow_check.py` | db3 조회·검증·export CLI (파이썬 표준 라이브러리만) |
| `bt_flow_viewer.html` | 트리 시각화 + 시간축 재생 뷰어 (vanilla JS+SVG, 더블클릭 실행) |

## bt_flow_check.py

```bash
python3 bt_flow_check.py sessions <db>                  # 회차(session) 목록
python3 bt_flow_check.py dump     <db> [--session N]     # 전이 트레이스 (시간순)
python3 bt_flow_check.py check    <db> <spec.json>       # 불변식 검증 (통과 exit 0 / 실패 1)
python3 bt_flow_check.py merge    <db1> <db2> ...         # 여러 db 를 wall-clock 으로 병합
python3 bt_flow_check.py export   <db> [--out f.json]     # 뷰어용 session.json 생성
```

### 불변식 spec (check)

비결정 실 환경에서는 "정확한 카운트" 대신 불변식으로 단정한다.

```json
{
  "invariants": [
    {"name": "Nav 최소 1회 SUCCESS", "node": "%ComputePathToPose%", "state": "SUCCESS", "count": ">=1"},
    {"name": "회복 분기 미진입",       "node": "%Recovery%", "state": "ANY", "count": "==0"},
    {"name": "경로계산 먼저 → 추종 나중", "type": "happens_before",
     "before": {"node": "%ComputePathToPose%", "state": "SUCCESS"},
     "after":  {"node": "%FollowPath%", "state": "RUNNING"}}
  ]
}
```

- `node`: `fullpath` 에 대한 SQL `LIKE` 패턴 (`%` 와일드카드)
- `state`: `IDLE/RUNNING/SUCCESS/FAILURE/SKIPPED/ANY`
- `count` 연산자: `>=` `<=` `==` `!=` `>` `<`

### 다층 병합 (merge)

중첩 BT(예: 레이어1 MoveTree + 레이어2 NavSingle 내부)의 두 `.db3` 를 같은 시간축으로 병합.
같은 머신의 두 프로세스는 동일 epoch-µs 시간축을 공유한다(분산 환경이면 NTP 동기화 전제).

```bash
python3 bt_flow_check.py merge bt_execution.db3 nav_single_internal.db3 --labels movetree,nav_single
```

## bt_flow_viewer.html

```bash
# 1) export 로 session.json 생성
python3 bt_flow_check.py export ~/nav_single_internal.db3 --out nav_single.session.json

# 2-A) bt_flow_viewer.html 더블클릭 → 생성된 .session.json 을 드래그앤드롭
# 2-B) 또는 자동 로드:
python3 -m http.server 8000
#   → http://localhost:8000/bt_flow_viewer.html?data=nav_single.session.json
```

조작: 휠=줌, 드래그=이동, 노드 클릭=전이 이력, 하단 스크러버/재생으로 시점별 상태 색 재생
(RUNNING 노랑 / SUCCESS 초록 / FAILURE 빨강 / SKIPPED 회색 / IDLE 어두움).

## 아키텍처 (확장 지점)

- `session.json` 스키마에 `expected` 슬롯이 비어 있다 — 기대 흐름 spec 을 주입하는 자리.
- 뷰어는 CORE(`stateAt` 등 순수 로직) / VIEW(렌더) 로 분리 — "예상 vs 실제 비교" 오버레이를
  CORE 의 `diff()` 함수 + VIEW 의 오버레이 레이어로 얹는 후속 확장을 전제로 한다.

## 참고

검증 방법론 전체: `dev-behavior-tree/develop_bt/guide/08_testing/flow_verification.md`
