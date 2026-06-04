#!/usr/bin/env bash
# bt_log_viewer 로컬 서버. ES module 이 아니라 classic script 라 file:// 더블클릭도 되지만,
# http 로 열면 ?btlog=/?data= 자동 로드와 캐싱이 매끄럽다.
set -e
PORT="${1:-8777}"
cd "$(dirname "$0")"
echo "▶ http://localhost:${PORT}/  (Ctrl+C 종료)"
command -v xdg-open >/dev/null && (sleep 0.6; xdg-open "http://localhost:${PORT}/") >/dev/null 2>&1 &
exec python3 -m http.server "$PORT"
