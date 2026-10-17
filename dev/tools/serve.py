"""public/ をローカルで配信する（Cloudflare Pages の _headers をまねて付ける）。確認用。
    python3 dev/tools/serve.py [ポート]   → http://127.0.0.1:8787/
"""
import http.server, socketserver, sys, functools
from pathlib import Path
PUB = Path(__file__).resolve().parent.parent.parent / 'public'
HEADERS = []
for line in (PUB / '_headers').read_text(encoding='utf-8').splitlines():
    if line.startswith('  ') and ':' in line:
        k, v = line.strip().split(':', 1); HEADERS.append((k.strip(), v.strip()))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HEADERS: self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass
H.extensions_map.update({'.js': 'text/javascript', '.svg': 'image/svg+xml'})
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), functools.partial(H, directory=str(PUB))) as s:
    print(f'http://127.0.0.1:{port}/', flush=True); s.serve_forever()
