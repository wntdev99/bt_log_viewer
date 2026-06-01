#!/usr/bin/env python3
# Copyright 2026 WATT
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# =============================================================================
# bt_flow_check.py — SqliteLogger(.db3) 기반 BT 실행 흐름 사후 자동 검증.
#
# 표준 라이브러리만 사용 (sqlite3, json, argparse). 외부 의존 없음.
#
# 검증 대상 스키마 (BehaviorTree.CPP SqliteLogger, bt_sqlite_logger.h:12-32):
#   Definitions(session_id, date, xml_tree)
#   Nodes(session_id, fullpath, node_uid)
#   Transitions(timestamp, session_id, node_uid, duration, state, extra_data)
#   state: 0=IDLE 1=RUNNING 2=SUCCESS 3=FAILURE 4=SKIPPED
#
# 사용법:
#   세션 목록:    bt_flow_check.py sessions   <db>
#   트레이스 덤프: bt_flow_check.py dump       <db> [--session N]
#   불변식 검증:   bt_flow_check.py check      <db> <spec.json> [--session N]
#   다층 병합:     bt_flow_check.py merge      <db1> <db2> ... [--labels a,b]
#
# merge: 여러 .db3(예: MoveTree 레이어1 + NavSingle 내부 레이어2)의 전이를
#   wall-clock timestamp 기준으로 정렬해 하나의 통합 타임라인으로 출력한다.
#   근거: SqliteLogger 는 TimestampType::absolute = time_since_epoch() 를 기록하고
#   (abstract_logger.h:71), libstdc++ 에서 high_resolution_clock == system_clock 이라
#   같은 머신의 두 프로세스 로그가 동일한 epoch-us 시간축을 공유한다.
#   (주의: 분산 환경이면 두 머신의 NTP 동기화 필요)
#
# 불변식 spec (JSON) — 자세한 예시는 develop_bt/guide/08_testing/flow_verification.md §5.3:
#   {
#     "invariants": [
#       {"name": "Nav 최소 1회 SUCCESS",  "node": "NavSingleAction", "state": "SUCCESS", "count": ">=1"},
#       {"name": "회복 분기 미진입",       "node": "RecoveryFallback%", "state": "ANY", "count": "==0"},
#       {"name": "Dock 먼저",  "type": "happens_before",
#        "before": {"node": "DockAction", "state": "SUCCESS"},
#        "after":  {"node": "UndockAction", "state": "RUNNING"}}
#     ]
#   }
#
# check 는 모든 불변식 통과 시 exit 0, 하나라도 실패 시 exit 1 (CI 연동).
# =============================================================================

import argparse
import datetime
import json
import operator
import os
import sqlite3
import sys
import xml.etree.ElementTree as ET

STATE_NAME = {0: "IDLE", 1: "RUNNING", 2: "SUCCESS", 3: "FAILURE", 4: "SKIPPED"}
STATE_CODE = {v: k for k, v in STATE_NAME.items()}

_OPS = [(">=", operator.ge), ("<=", operator.le), ("==", operator.eq),
        ("!=", operator.ne), (">", operator.gt), ("<", operator.lt)]


def resolve_session(con, session):
    """session=None 이면 최신(MAX), 정수면 그대로. 존재 검증."""
    if session is None:
        row = con.execute("SELECT MAX(session_id) FROM Definitions").fetchone()
        if row is None or row[0] is None:
            sys.exit("오류: DB 에 세션이 없습니다 (트리를 한 번도 실행 안 함).")
        return int(row[0])
    cnt = con.execute(
        "SELECT COUNT(*) FROM Definitions WHERE session_id=?", (session,)).fetchone()[0]
    if cnt == 0:
        sys.exit(f"오류: session_id={session} 가 DB 에 없습니다.")
    return int(session)


def cmd_sessions(con, _args):
    rows = con.execute(
        "SELECT session_id, date FROM Definitions ORDER BY session_id").fetchall()
    if not rows:
        print("(세션 없음)")
        return
    print(f"{'session_id':>10}  date")
    for sid, date in rows:
        n = con.execute(
            "SELECT COUNT(*) FROM Transitions WHERE session_id=?", (sid,)).fetchone()[0]
        print(f"{sid:>10}  {date}  (전이 {n}건)")


def cmd_dump(con, args):
    sid = resolve_session(con, args.session)
    rows = con.execute(
        "SELECT t.timestamp, n.fullpath, t.state, t.duration, t.extra_data "
        "FROM Transitions t JOIN Nodes n "
        "  ON t.node_uid=n.node_uid AND t.session_id=n.session_id "
        "WHERE t.session_id=? ORDER BY t.timestamp", (sid,)).fetchall()
    print(f"=== session {sid} 전이 트레이스 ({len(rows)}건) ===")
    print(f"{'t(us)':>14}  {'status':<8}  {'dur(us)':>9}  node  [extra]")
    for ts, path, state, dur, extra in rows:
        line = (f"{ts:>14}  {STATE_NAME.get(state, state):<8}  "
                f"{(dur if dur is not None else ''):>9}  {path}")
        if extra:
            line += f"  [{extra}]"
        print(line)


def _count(con, sid, node_like, state):
    """node fullpath LIKE node_like + (state 지정 시) 해당 전이 횟수."""
    q = ("SELECT COUNT(*) FROM Transitions t JOIN Nodes n "
         "  ON t.node_uid=n.node_uid AND t.session_id=n.session_id "
         "WHERE t.session_id=? AND n.fullpath LIKE ?")
    params = [sid, node_like]
    if state and state.upper() != "ANY":
        q += " AND t.state=?"
        params.append(STATE_CODE[state.upper()])
    return con.execute(q, params).fetchone()[0]


def _first_ts(con, sid, node_like, state):
    """조건에 맞는 첫(최소 timestamp) 전이 시각. 없으면 None."""
    q = ("SELECT MIN(t.timestamp) FROM Transitions t JOIN Nodes n "
         "  ON t.node_uid=n.node_uid AND t.session_id=n.session_id "
         "WHERE t.session_id=? AND n.fullpath LIKE ?")
    params = [sid, node_like]
    if state and state.upper() != "ANY":
        q += " AND t.state=?"
        params.append(STATE_CODE[state.upper()])
    return con.execute(q, params).fetchone()[0]


def _check_count_expr(actual, expr):
    """expr 예: '>=1', '==0', '>0'. (통과여부, 연산자문자열) 반환."""
    expr = expr.strip()
    for sym, fn in _OPS:
        if expr.startswith(sym):
            return fn(actual, int(expr[len(sym):].strip())), expr
    # 연산자 없으면 정확히 일치
    return actual == int(expr), f"=={expr}"


def _session_transitions(con, sid, label):
    """한 세션의 전이를 (timestamp, label, fullpath, state, extra) 튜플 리스트로."""
    rows = con.execute(
        "SELECT t.timestamp, n.fullpath, t.state, t.extra_data "
        "FROM Transitions t JOIN Nodes n "
        "  ON t.node_uid=n.node_uid AND t.session_id=n.session_id "
        "WHERE t.session_id=? ORDER BY t.timestamp", (sid,)).fetchall()
    return [(ts, label, path, state, extra) for ts, path, state, extra in rows]


def cmd_merge(args):
    dbs = args.dbs
    labels = args.labels.split(",") if args.labels else None
    if labels and len(labels) != len(dbs):
        sys.exit(f"오류: --labels 개수({len(labels)})가 db 개수({len(dbs)})와 다릅니다.")

    merged = []
    for i, db in enumerate(dbs):
        label = labels[i] if labels else os.path.splitext(os.path.basename(db))[0]
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            sid = resolve_session(con, None)  # 각 db 최신 세션
            merged.extend(_session_transitions(con, sid, label))
        finally:
            con.close()

    merged.sort(key=lambda r: r[0])  # wall-clock epoch-us 기준 정렬
    print(f"=== 통합 타임라인 ({len(dbs)} 소스, {len(merged)}건) ===")
    print(f"{'wall-clock':<23}  {'t(us)':>16}  {'source':<14}  {'status':<8}  node")
    for ts, label, path, state, extra in merged:
        wc = datetime.datetime.fromtimestamp(
            ts / 1e6, datetime.timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        line = (f"{wc:<23}  {ts:>16}  {label:<14}  "
                f"{STATE_NAME.get(state, state):<8}  {path}")
        if extra:
            line += f"  [{extra}]"
        print(line)


def _build_tree(xml_text):
    """xml_tree 를 파싱해 SubTree 를 펼친 노드 트리(dict)로 변환.
    각 노드는 _uid 를 보유 → Transitions.node_uid 와 1:1 매칭."""
    root = ET.fromstring(xml_text)
    defs = {bt.get("ID"): bt for bt in root.findall("BehaviorTree")}

    def node_of(el):
        uid = el.get("_uid")
        tag = el.tag
        name = el.get("name", tag)
        if tag == "SubTree":
            subid = el.get("ID")
            children = []
            d = defs.get(subid)
            if d is not None:  # 정의의 루트 노드(들)를 SubTree 의 자식으로 펼침
                children = [node_of(c) for c in list(d) if c.get("_uid") is not None]
            return {"uid": int(uid) if uid else None,
                    "name": name, "type": "SubTree", "subtree": subid, "children": children}
        children = [node_of(c) for c in list(el) if c.get("_uid") is not None]
        return {"uid": int(uid) if uid else None,
                "name": name, "type": tag, "children": children}

    main = root.find("BehaviorTree")  # BTCPP4: 첫 BehaviorTree = main
    root_node = next((c for c in list(main) if c.get("_uid") is not None), None)
    return node_of(root_node) if root_node is not None else None, main.get("ID")


def cmd_export(con, args):
    sid = resolve_session(con, args.session)
    row = con.execute(
        "SELECT date, xml_tree FROM Definitions WHERE session_id=?", (sid,)).fetchone()
    date, xml_text = row
    tree, tree_name = _build_tree(xml_text)

    nodes = {str(uid): path for path, uid in con.execute(
        "SELECT fullpath, node_uid FROM Nodes WHERE session_id=?", (sid,))}

    rows = con.execute(
        "SELECT timestamp, node_uid, state, duration, extra_data "
        "FROM Transitions WHERE session_id=? ORDER BY timestamp", (sid,)).fetchall()
    timeline = [[ts, uid, st, dur or 0] + ([extra] if extra else [])
                for ts, uid, st, dur, extra in rows]
    t0 = rows[0][0] if rows else 0
    t1 = rows[-1][0] if rows else 0

    out = {
        "meta": {"tree": tree_name, "session": sid, "date": date,
                 "t0": t0, "t1": t1, "count": len(rows)},
        "tree": tree,
        "nodes": nodes,
        "timeline": timeline,
        # 확장 슬롯 — 기대 흐름(spec) 을 나중에 채워 actual 과 비교 (diff 레이어).
        "expected": None,
    }
    path = args.out or (os.path.splitext(args.db)[0] + ".session.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"export 완료: {path}")
    print(f"  tree={tree_name}  노드={len(nodes)}  전이={len(timeline)}  "
          f"기간={(t1 - t0) / 1e6:.1f}s")


def cmd_check(con, args):
    sid = resolve_session(con, args.session)
    with open(args.spec, encoding="utf-8") as f:
        spec = json.load(f)
    invariants = spec.get("invariants", [])
    if not invariants:
        sys.exit("오류: spec 에 invariants 가 없습니다.")

    print(f"=== session {sid} 불변식 검증 ({len(invariants)}개) ===")
    failures = 0
    for inv in invariants:
        name = inv.get("name", "(이름없음)")
        kind = inv.get("type", "count")

        if kind == "count":
            actual = _count(con, sid, inv["node"], inv.get("state", "ANY"))
            ok, expr = _check_count_expr(actual, inv["count"])
            detail = f"{inv['node']} [{inv.get('state', 'ANY')}] = {actual}, 기대 {expr}"
        elif kind == "happens_before":
            b, a = inv["before"], inv["after"]
            t_b = _first_ts(con, sid, b["node"], b.get("state", "ANY"))
            t_a = _first_ts(con, sid, a["node"], a.get("state", "ANY"))
            if t_b is None or t_a is None:
                ok = False
                detail = (f"before({b['node']})={t_b}, after({a['node']})={t_a} "
                          f"— 한쪽이 발생 안 함")
            else:
                ok = t_b < t_a
                detail = f"before t={t_b} < after t={t_a}"
        else:
            ok = False
            detail = f"알 수 없는 type: {kind}"

        mark = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{mark}] {name}  —  {detail}")

    print(f"--- 결과: {len(invariants) - failures}/{len(invariants)} 통과 ---")
    sys.exit(1 if failures else 0)


def main():
    p = argparse.ArgumentParser(description="SqliteLogger(.db3) BT 흐름 사후 검증")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("sessions", help="세션 목록")
    sp.add_argument("db")
    sp.set_defaults(func=cmd_sessions)

    dp = sub.add_parser("dump", help="세션 전이 트레이스 출력")
    dp.add_argument("db")
    dp.add_argument("--session", type=int, default=None, help="기본=최신")
    dp.set_defaults(func=cmd_dump)

    cp = sub.add_parser("check", help="JSON spec 불변식 검증")
    cp.add_argument("db")
    cp.add_argument("spec")
    cp.add_argument("--session", type=int, default=None, help="기본=최신")
    cp.set_defaults(func=cmd_check)

    ep = sub.add_parser("export", help="세션을 시각화 뷰어용 session.json 으로 export")
    ep.add_argument("db")
    ep.add_argument("--out", default=None, help="출력 경로 (기본=<db>.session.json)")
    ep.add_argument("--session", type=int, default=None, help="기본=최신")
    ep.set_defaults(func=cmd_export)

    mp = sub.add_parser("merge", help="여러 .db3 를 wall-clock 으로 병합한 통합 타임라인")
    mp.add_argument("dbs", nargs="+", help="병합할 .db3 경로들 (각 db 최신 세션 사용)")
    mp.add_argument("--labels", default=None, help="소스 라벨 (콤마 구분, db 개수와 일치)")
    mp.set_defaults(func=cmd_merge, multi=True)

    args = p.parse_args()
    if getattr(args, "multi", False):
        # 여러 db 를 다루는 커맨드(merge)는 자체적으로 연결을 관리.
        args.func(args)
    else:
        con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
        try:
            args.func(con, args)
        finally:
            con.close()


if __name__ == "__main__":
    main()
