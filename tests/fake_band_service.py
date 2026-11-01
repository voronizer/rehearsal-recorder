"""
A band service for test_sending.py: an http.server on a thread of its own
that answers the calls РЭХА makes (the shared contract in
docs/superpowers/plans/2026-10-31-band-service-part-1.md) and keeps takes,
uploads and their parts in memory.

Every request is checked against service/openapi.json, the description the
real service makes from the same schemas it checks requests with. One that
does not match is answered 400 with what did not match, and the line is
kept in `mismatches`, so a test can say that РЭХА asked for nothing the
service would not take.

It can be told to drop the connection unanswered, to keep a part and then
drop it, to forget its uploads, to refuse with words, or to say РЭХА is too
old.
"""

import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from openapi_core import OpenAPI
from openapi_core.datatypes import RequestParameters
from werkzeug.datastructures import Headers, ImmutableMultiDict

SPEC = Path(__file__).resolve().parent.parent / "service" / "openapi.json"
SECRET = "reha_test_secret"
UPDATE_REHA = "Update РЭХА to send takes here"


class _Checked:
    """A request as openapi-core reads one (its Request protocol)."""

    def __init__(self, host_url, method, path, query, headers, body):
        self.host_url = host_url
        self.path = path
        self.method = method.lower()
        self.parameters = RequestParameters(
            query=ImmutableMultiDict(query), header=Headers(headers),
            cookie=ImmutableMultiDict(), path={})
        self.content_type = (headers.get("Content-Type") or "").lower()
        self.body = body or None


class FakeBandService:
    def __init__(self):
        self._spec = OpenAPI.from_file_path(str(SPEC))
        self._lock = threading.Lock()
        # uid: the TakeMeta as last sent, with "trashed".
        self.takes = {}
        # upload_id: {"uid", "gen", "name", "size", "parts": {number: bytes}}
        self.uploads = {}
        # "uid/gen/name": the file's bytes, once its upload is done.
        self.files = {}
        # What came, in order: "put <uid>", "start <uid> <name>", "part <uid>
        # <name> <number>", "file <uid> <name>", "ready <uid> <what>",
        # "delete <uid>".
        self.order = []
        self.mismatches = []
        # Every User-Agent a request came with.
        self.user_agents = set()
        # The next N calls are dropped unanswered.
        self.drop = 0
        # The next N parts are kept, then their connection dropped
        # unanswered: the part is up, and РЭХА never hears its etag.
        self.drop_after_part = 0
        # Once this many more parts have arrived, every upload is forgotten,
        # as R2 forgets one left a week.
        self.forget_after_parts = None
        # (status, words) every call is refused with, until set back to None.
        self.refuse = None
        # Every call answered 426, until set back to False.
        self.too_old = False
        # Called with the call's words ("part <uid> <name> <n>") just before
        # it is answered: a test does something while РЭХА waits.
        self.on_call = None
        self._server = None

    # ---------- running it ----------

    def start(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _any(self):
                fake._answer(self)

            do_GET = do_PUT = do_POST = do_DELETE = _any

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()

    @property
    def address(self):
        return f"127.0.0.1:{self._server.server_address[1]}"

    @property
    def key(self):
        return f"{self.address}:{SECRET}"

    # ---------- what a test reads ----------

    def count(self, prefix):
        with self._lock:
            return sum(1 for o in self.order if o.startswith(prefix))

    def names_of(self, uid, gen=None):
        """The files of a take that are up, by name: of its generation
        `gen`, or of every one."""
        with self._lock:
            out = {}
            for key, data in self.files.items():
                u, g, name = key.split("/", 2)
                if u == uid and (gen is None or int(g) == gen):
                    out[name] = data
            return out

    # ---------- answering ----------

    def _answer(self, h):
        length = int(h.headers.get("Content-Length") or 0)
        body = h.rfile.read(length) if length else b""
        url = urlsplit(h.path)
        query = parse_qsl(url.query)
        headers = {k: v for k, v in h.headers.items()}

        with self._lock:
            self.user_agents.add(h.headers.get("User-Agent"))
            if self.drop > 0:
                self.drop -= 1
                return self._hang_up(h)
        try:
            self._spec.validate_request(_Checked(
                f"http://{self.address}", h.command, url.path, query, headers, body))
        except Exception as e:  # noqa: BLE001 - every mismatch is said
            line = f"{h.command} {url.path}: {e}"
            with self._lock:
                self.mismatches.append(line)
            return self._send(h, 400, {"error": line})
        if self.too_old:
            return self._send(h, 426, {"error": UPDATE_REHA})
        if self.refuse is not None:
            status, words = self.refuse
            return self._send(h, status, {"error": words})
        if h.headers.get("x-api-key") != SECRET:
            return self._send(h, 401, {"error": "This key does not work"})

        parts = [p for p in url.path.split("/") if p][2:]  # after /api/reha
        q = dict(query)
        try:
            status, answer = self._route(h.command, parts, q, body)
        except _HangUp:
            return self._hang_up(h)
        return self._send(h, status, answer)

    def _said(self, words):
        with self._lock:
            self.order.append(words)
        if self.on_call is not None:
            self.on_call(words)

    def _route(self, method, parts, q, body):
        if method == "GET" and parts == ["hello"]:
            return 200, {"ok": True}
        if parts[:1] != ["takes"] or len(parts) < 2:
            return 404, {"error": "No such call"}
        uid = parts[1]
        rest = parts[2:]
        if method == "PUT" and not rest:
            meta = json.loads(body)
            with self._lock:
                self.takes[uid] = {**meta, "trashed": False}
            self._said(f"put {uid}")
            return 200, {"ok": True}
        if method == "DELETE" and not rest:
            with self._lock:
                if uid in self.takes:
                    self.takes[uid]["trashed"] = True
            self._said(f"delete {uid}")
            return 200, {"ok": True}
        if method == "POST" and rest == ["ready"]:
            data = json.loads(body)
            self._said(f"ready {uid} {data['what']} {data['gen']}")
            return 200, {"ok": True}
        if method == "POST" and rest == ["files"]:
            data = json.loads(body)
            upload_id = uuid.uuid4().hex
            with self._lock:
                self.uploads[upload_id] = {"uid": uid, "gen": data["gen"], "name": data["name"],
                                           "size": data["size"], "parts": {}}
            self._said(f"start {uid} {data['name']}")
            return 200, {"upload_id": upload_id}
        if method == "PUT" and len(rest) == 3 and rest[0] == "files":
            upload_id, number = rest[1], int(rest[2])
            with self._lock:
                upload = self.uploads.get(upload_id)
            if upload is None:
                return 404, {"error": "This upload is gone: send the file again from the start",
                             "gone": True}
            with self._lock:
                upload["parts"][number] = body
                dropping = self.drop_after_part > 0
                if dropping:
                    self.drop_after_part -= 1
                if self.forget_after_parts is not None:
                    self.forget_after_parts -= 1
                    if self.forget_after_parts <= 0:
                        self.forget_after_parts = None
                        self.uploads.clear()
            self._said(f"part {uid} {upload['name']} {number}")
            if dropping:
                raise _HangUp()
            return 200, {"etag": f"etag-{number}-{len(body)}"}
        if method == "POST" and len(rest) == 3 and rest[0] == "files" and rest[2] == "done":
            upload_id = rest[1]
            data = json.loads(body)
            with self._lock:
                upload = self.uploads.pop(upload_id, None)
            if upload is None:
                return 404, {"error": "This upload is gone: send the file again from the start",
                             "gone": True}
            numbers = [n for n, _ in data["parts"]]
            whole = b"".join(upload["parts"][n] for n in sorted(numbers))
            with self._lock:
                self.files[f"{uid}/{upload['gen']}/{upload['name']}"] = whole
            self._said(f"file {uid} {upload['name']}")
            return 200, {"ok": True}
        return 404, {"error": "No such call"}

    @staticmethod
    def _send(h, status, answer):
        data = json.dumps(answer).encode()
        h.send_response(status)
        h.send_header("Content-Type", "application/json")
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        h.wfile.write(data)

    @staticmethod
    def _hang_up(h):
        """No answer at all: the connection closes under РЭХА."""
        h.close_connection = True
        try:
            h.connection.shutdown(2)
        except OSError:
            pass


class _HangUp(Exception):
    pass
