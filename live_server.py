#!/usr/bin/env python3
# live_server.py — 정적 파일 서빙 + /live SSE 로 .btlog 를 tail-follow 스트리밍.
#
#   python3 live_server.py [PORT] [--watch /tmp/bt_execution.btlog]
#
# 브라우저(실시간 추적 모드)가 GET /live?path=<절대경로> 로 접속하면:
#   1) 파일 헤더(magic+xml+first_ts)를 읽어 event:init 로 보냄(트리 1회)
#   2) 파일이 자라면 새 9바이트 전이 레코드를 event:append 로 스트리밍
#   3) 파일이 줄거나(새 세션) 사라지면 헤더부터 다시 읽어 init 재전송
#
# FileLogger2 는 async writer + ofstream 버퍼라 디스크 반영이 청크 단위(거의 실시간)다.
import http.server, socketserver, os, sys, json, time, struct, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
WATCH = None
MAGIC = b"BTCPP4-FileLogger2"
HEAD0 = len(MAGIC) + 1 + 4   # magic + protocol(1) + xml_size(int32)


def read_header(path):
    """(xml_text, first_ts, header_size) 또는 None(아직 불완전)."""
    with open(path, "rb") as f:
        head = f.read(HEAD0)
        if len(head) < HEAD0:
            return None
        if head[:len(MAGIC)] != MAGIC:
            raise ValueError("FileLogger2(.btlog) 형식이 아닙니다")
        xml_size = struct.unpack("<i", head[len(MAGIC) + 1:HEAD0])[0]
        need = HEAD0 + xml_size + 8
        f.seek(0)
        buf = f.read(need)
        if len(buf) < need:
            return None
        p = HEAD0
        xml = buf[p:p + xml_size].decode("utf-8", "replace"); p += xml_size
        first_ts = struct.unpack("<q", buf[p:p + 8])[0]
        return xml, first_ts, need


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/live":
            return self.handle_live(urllib.parse.parse_qs(u.query))
        return super().do_GET()

    def sse(self, event, data):
        self.wfile.write(f"event: {event}\n".encode())
        self.wfile.write(("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def handle_live(self, q):
        path = (q.get("path", [None])[0]) or WATCH
        if not path:
            self.send_response(400); self.end_headers(); self.wfile.write(b"no path"); return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.stream(path)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def stream(self, path):
        header_ok = False; offset = 0; first_ts = 0
        last_ping = time.time()
        self.sse("status", {"msg": "파일 대기 중", "path": path})
        while True:
            try:
                exists = os.path.exists(path)
                size = os.path.getsize(path) if exists else 0
                if not exists or size < HEAD0:
                    header_ok = False
                elif (not header_ok) or size < offset:
                    h = read_header(path)
                    if h is not None:
                        xml, first_ts, hsize = h
                        header_ok = True; offset = hsize
                        self.sse("init", {"xml": xml, "firstTs": first_ts, "path": os.path.basename(path)})
                if header_ok and size > offset:
                    with open(path, "rb") as f:
                        f.seek(offset)
                        data = f.read(size - offset)
                    n = len(data) // 9
                    if n > 0:
                        trs = []
                        for k in range(n):
                            o = k * 9
                            ts_rel = int.from_bytes(data[o:o + 6], "little")
                            uid = int.from_bytes(data[o + 6:o + 8], "little")
                            trs.append([first_ts + ts_rel, uid, data[o + 8]])
                        offset += n * 9
                        self.sse("append", {"t": trs})
            except ValueError as e:
                self.sse("status", {"msg": str(e), "path": path})
                time.sleep(1.0)
            now = time.time()
            if now - last_ping > 12:
                self.sse("ping", {}); last_ping = now
            time.sleep(0.15)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    global WATCH
    port = 8777; rest = []; i = 0; args = sys.argv[1:]
    while i < len(args):
        if args[i] == "--watch":
            WATCH = args[i + 1]; i += 2
        else:
            rest.append(args[i]); i += 1
    if rest:
        port = int(rest[0])
    srv = Server(("", port), Handler)
    print(f"▶ http://localhost:{port}/   (실시간 watch: {WATCH or '브라우저에서 ?path= 지정'})")
    print("  Ctrl+C 로 종료")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
