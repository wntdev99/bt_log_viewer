# bt_log_viewer — 개발 TODO 체크리스트

> BT `SqliteLogger`(.db3) 로그를 사후 정량 검증·시각 재생하는 도구의 잔여 작업.
> 상태 표기: `[x]` 완료 · `[~]` 부분 · `[ ]` 미착수
> 최종 갱신: 2026-06-01

---

## 완료된 토대 (참고)

- [x] `bt_flow_check.py` — `sessions` / `dump` / `check`(불변식, exit code) / `merge`(wall-clock 병합) / `export`(session.json)
- [x] `bt_flow_viewer.html` — MVP 재생 뷰어 (트리 렌더 + 스크러버 + 재생 + 노드 패널), CORE/VIEW 분리
- [x] 런타임 로깅 부착 — 레이어1(`bt_execution_server`) + 레이어2(`nav_single_navigator`, nav2 무수정 `getTree()`)
- [x] CORE 로직 검증 (node) — layout 노드 누락 0, `stateAt` 정확성 db 집계와 교차검증
- [x] timestamp 병합 가능성 입증 — `TimestampType::absolute` = epoch-µs, 두 프로세스 동일 시간축

---

## P0 — 최우선 (원래 목표: 예상 vs 실제 비교)

- [ ] **브라우저 실렌더 확인** *(선행 게이트)*
  - [ ] `bt_flow_viewer.html` 을 실제 브라우저에서 열어 트리/색/스크러버/재생 동작 확인
  - [ ] 313노드 대형 트리 레이아웃·줌·팬 사용성 점검 → 필요 시 조정
- [ ] **예상 vs 실제 비교 (`expected` + `diff`)** — 핵심 기능
  - [ ] spec 포맷 확정 (기대 전이 시퀀스 / 노드별 기대 상태 / 불변식)
  - [ ] CORE 에 `diff(actual, expected)` 순수 함수 추가 (일치 / 위반 / 예상외-미진입 / 누락)
  - [ ] `session.json` 의 `expected` 슬롯 주입 경로 (export `--expected spec.json`)
  - [ ] VIEW 에 비교 오버레이 레이어 — 노드 테두리(✅/⚠️/⬚) + 타임라인 위반 마커
  - [ ] 비교 요약 패널 (위반 N건 목록 → 클릭 시 해당 시점 점프)

## P1 — 검증 자동화 토대

- [ ] **실제 흐름 검증 테스트(.cpp) 작성** — 문서 템플릿을 동작 코드로
  - [ ] MoveTree 단독 2계층 (Substitution + TreeObserver) 골든패스 GTest
  - [ ] NavSingle.xml 단독 2계층 — recovery 분기 미진입 단정
  - [ ] 순서 검증 — `StatusChangeLogger` 서브클래스 기반
  - [ ] `colcon test` 통과 확인
- [ ] **두 레이어 session 연결** — 다층 분석 정확도
  - [ ] MoveTree goal_id 를 `extra_data` 에 주입 (레이어1)
  - [ ] nav_single 세션과 goal_id 매칭 (현재 wall-clock 추정 → 정확 매칭)

## P2 — 뷰어 다층/심화

- [ ] **다층(merge) 통합 재생** — 레이어1+레이어2 를 한 타임라인에 겹쳐 재생 (현재 merge 는 CLI dump 만)
- [ ] 검증 결과 오버레이 — `check` 불변식 위반 지점을 타임라인 마커로
- [ ] Blackboard 패널 — `extra_data`(BB 변수) 시점별 표시
- [ ] 전이 밀도 히스토그램 — 타임라인에 tick 밀집 구간 시각화
- [ ] 노드 검색·필터·SubTree 접기 — 대형 트리 탐색 보조

## P3 — CLI/통합 확장

- [ ] **골든 세션 비교 (`diff` 커맨드)** — 정상 세션 대비 진입 노드/카운트 자동 diff (방법론 §5.5)
- [ ] 불변식 타입 확장 — duration 임계, 순서 시퀀스 등 (현재 count / happens_before)
- [ ] **NavMulti navigator 로깅 부착** — 현재 `nav_single` 만, 동일 패턴 적용
- [ ] CI 파이프라인 — sim 주행 → export → check → exit code 자동화

---

## 의존성 / 진행 순서 메모

```text
브라우저 실렌더 확인 (P0 게이트)
        └─> 예상 vs 실제 비교 (P0)  ──┐
실제 흐름 검증 테스트(.cpp) (P1) ──────┤
두 레이어 session 연결 (P1) ──> 다층 통합 재생 (P2)
                                       └─> CI 파이프라인 (P3)
```

- **비교 기능(P0)을 얹기 전에 브라우저 실렌더 확인이 선행**되어야 토대가 흔들리지 않는다.
- 다층 통합 재생(P2)은 두 레이어 session 연결(P1)이 정확해야 의미가 산다.

---

## 미해결 / 확인 필요

- [ ] 런타임 `.db3` 종단 검증 — 레이어2는 실생성 확인. 레이어1(MoveTree) `~/bt_execution.db3` 도 동일 파이프라인 재확인
- [ ] `bt_log_viewer` 는 별도 git 저장소 — 커밋 정책/원격 결정 필요
- [ ] `temporary_utils/scripts/nav_single.session.json` (원위치 잔여 파일) 처리 — bt_log_viewer 로 이동할지
