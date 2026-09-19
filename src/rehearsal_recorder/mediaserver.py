"""
The app's local HTTP server (127.0.0.1 only, on a random free port).

It serves three things:
  /            -> the built interface (ui/dist)
  /media/...   -> .wav files from the recordings folder
  /api/...     -> the handful of read-only calls the interface polls

Why not file://. In WKWebView (the engine pywebview uses on macOS) a page
opened as file:// can neither load audio from another folder nor pull in the
ES modules the React interface is built from. Over http://127.0.0.1 neither
limit applies, and the server is not reachable from outside this machine.

Why /api exists at all, when there is already a bridge to Python. pywebview
starts a fresh OS thread for every single call that crosses that bridge, and
that thread then waits on the main thread to hand the answer back to
JavaScript. For a button press that is nothing. For the meters, which ask
fourteen times a second while recording, it is thousands of threads created
and destroyed during one rehearsal, all of it churning through the main
thread. Polling over http goes through the webview's own network stack
instead and never touches the bridge. Commands still go over the bridge,
where they belong: they are rare and they need to be ordered.
"""

import http.server
import json
import threading
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

MEDIA_PREFIX = "/media/"
API_PREFIX = "/api/"

# Only these, and only because they take no arguments, change nothing, and are
# asked for many times a second. Anything that acts on the world stays on the
# bridge.
POLLABLE = (
    "player_state",
    "get_levels",
    "monitor_levels",
    "recording_health",
    "session_state",
)


class _Handler(http.server.SimpleHTTPRequestHandler):
    ui_root: Path
    media_root: Path
    api = None

    def log_message(self, format, *args):
        pass  # no console spam for every audio chunk

    def _serve_api(self, name):
        """One of the POLLABLE calls, as JSON. Anything else is a 404."""
        if self.api is None or name not in POLLABLE:
            self.send_error(404)
            return
        try:
            payload = json.dumps(getattr(self.api, name)())
        except Exception as e:
            payload = json.dumps({"ok": False, "error": str(e)})
        body = payload.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path):
        raw = unquote(urlsplit(path).path, errors="surrogatepass")

        if raw.startswith(MEDIA_PREFIX):
            root = self.media_root
            rel = raw[len(MEDIA_PREFIX):]
        else:
            root = self.ui_root
            rel = raw

        # "." and ".." segments are dropped entirely, so no crafted path can
        # escape the root.
        parts = [p for p in rel.split("/") if p and p not in (".", "..")]
        full = root.joinpath(*parts)
        if full.is_dir():
            full = full / "index.html"
        return str(full)

    def end_headers(self):
        # The interface gets rebuilt — don't let the webview show a stale bundle.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        """A normal GET, plus /api and Range support.

        Without Range a player cannot seek in a stream: it asks for a slice
        from the middle of the file and the stock handler always returns the
        whole thing with status 200.
        """
        raw_path = urlsplit(self.path).path
        if raw_path.startswith(API_PREFIX):
            return self._serve_api(raw_path[len(API_PREFIX):].strip("/"))

        range_header = self.headers.get("Range")
        if not range_header:
            return super().do_GET()

        path = Path(self.translate_path(self.path))
        if not path.is_file():
            return super().do_GET()

        size = path.stat().st_size
        parsed = _parse_range(range_header, size)
        if parsed is None:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        start, end = parsed
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def _parse_range(header, size):
    """'bytes=0-1023' -> (0, 1023). None if it cannot be parsed."""
    if not header.startswith("bytes="):
        return None
    spec = header[len("bytes="):].split(",")[0].strip()
    first, _, last = spec.partition("-")
    try:
        if not first:  # suffix form: the last N bytes
            n = int(last)
            if n <= 0:
                return None
            return max(0, size - n), size - 1
        start = int(first)
        end = int(last) if last else size - 1
    except ValueError:
        return None
    if start >= size or start > end:
        return None
    return start, min(end, size - 1)


class AppServer:
    def __init__(self, ui_dir, media_dir, api=None, port=0):
        """
        port: 0 picks a free one, which is what the app does normally. A fixed
        port is for development, where Vite's dev server has to be told in
        advance where to forward /api and /media — see docs/development.md.
        """
        self.ui_root = Path(ui_dir)
        self.media_root = Path(media_dir)
        self.media_root.mkdir(parents=True, exist_ok=True)

        self._handler_class = type(
            "_BoundHandler",
            (_Handler,),
            {"ui_root": self.ui_root, "media_root": self.media_root, "api": api},
        )
        self._httpd = http.server.ThreadingHTTPServer(
            ("127.0.0.1", port), self._handler_class
        )
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.port}/"

    def set_media_root(self, media_dir):
        """The recordings folder can be changed in Settings — the server has to
        serve from it immediately, without restarting the app."""
        self.media_root = Path(media_dir)
        self.media_root.mkdir(parents=True, exist_ok=True)
        self._handler_class.media_root = self.media_root

    @property
    def ui_available(self):
        return (self.ui_root / "index.html").exists()

    def media_url(self, abs_path):
        """URL for the player. abs_path must live inside the recordings
        folder — otherwise the server physically cannot serve it, and we
        return None instead of pretending."""
        try:
            rel = Path(abs_path).resolve().relative_to(self.media_root.resolve())
        except ValueError:
            return None
        parts = [quote(part) for part in rel.parts]
        return self.base_url + "media/" + "/".join(parts)
