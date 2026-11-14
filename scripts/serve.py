"""Local preview server for web/ that tells the browser not to cache files,
so every reload shows the latest version. Usage: python scripts/serve.py [port]"""
import http.server
import socketserver
import sys
from functools import partial
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), partial(NoCache, directory=str(WEB))) as httpd:
    print(f"Serving {WEB} at http://localhost:{PORT}/ (no cache)")
    httpd.serve_forever()
