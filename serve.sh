#!/usr/bin/env bash
# bt_log_viewer 로컬 서버.
#   ./serve.sh [PORT] [--watch /tmp/bt_execution.btlog]
# 정적 파일 + 실시간 추적용 /live SSE 엔드포인트(live_server.py)를 함께 제공.
# (classic script 라 file:// 더블클릭도 되지만, 실시간 추적은 이 서버가 필요하다.)
set -e
cd "$(dirname "$0")"
PORT="8777"; ARGS=()
for a in "$@"; do
  case "$a" in
    [0-9]*) PORT="$a" ;;
    *) ARGS+=("$a") ;;
  esac
done
echo "▶ http://localhost:${PORT}/   (Ctrl+C 종료)"
command -v xdg-open >/dev/null && (sleep 0.6; xdg-open "http://localhost:${PORT}/") >/dev/null 2>&1 &
exec python3 live_server.py "$PORT" "${ARGS[@]}"
