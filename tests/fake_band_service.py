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
old. A test can delete a take as someone in the band does, and press
Restore on it. It can be a service from before the tempo along Master,
which neither keeps a take's tempo nor says which it has.

It keeps songs by number as the service does (service/worker/songs/sync.ts),
and a test can rename one, give it a tempo, make one, delete one or move a
take to another, as someone in the band does there.

It keeps sets by number as the service does (service/worker/sets/store.ts),
and a test can make one, rename it, give it songs, delete it and press
Restore on it, as someone in the band does there.
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
        # uid: the TakeMeta as last sent, with "trashed", and "trashed_by"
        # (who deleted it in the service; None when РЭХА removed it).
        self.takes = {}
        # uid: {"mp3": gen, "flac": gen}, the generations whose files are up.
        self.gens = {}
        # uid: {"gen", "drift"}, the band's tempo through the take as sent.
        self.drifts = {}
        # False: a service from before the tempo along Master.
        self.keeps_tempo = True
        # upload_id: {"uid", "gen", "name", "size", "parts": {number: bytes}}
        self.uploads = {}
        # "uid/gen/name": the file's bytes, once its upload is done.
        self.files = {}
        # What came, in order: "put <uid>", "start <uid> <name>", "part <uid>
        # <name> <number>", "file <uid> <name>", "ready <uid> <what>",
        # "drift <uid> <gen>", "delete <uid>", "list".
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
        # (status, words) a take's tempo is refused with, until set back to None.
        self.refuse_drift = None
        # Every call answered 426, until set back to False.
        self.too_old = False
        # Called with the call's words ("part <uid> <name> <n>") just before
        # it is answered: a test does something while РЭХА waits.
        self.on_call = None
        # id: {"id", "title", "tempo", "signature", "trashed", "title_by",
        # "meter_by", "made_by", "trashed_by"}, as GET /api/reha/songs has them.
        self.songs = {}
        self._next_song = 1
        # uid: {"song_id", "by"}, a take moved to another song here and not
        # numbered by РЭХА yet.
        self.moved = {}
        # id: {"id", "name", "songs", "trashed", "made_by", "changed_by",
        # "trashed_by"}, in the order made. "songs" holds songs in the Trash
        # too, in their places; GET /api/reha/sets leaves them out.
        self.sets = {}
        self._next_set = 1
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

            do_GET = do_PUT = do_POST = do_DELETE = do_PATCH = _any

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

    def delete_in_service(self, uid):
        """Someone in the band presses Delete take."""
        with self._lock:
            self.takes[uid].update(trashed=True, trashed_by="Ira")

    def restore_in_service(self, uid):
        """Someone in the band presses Restore in the Trash."""
        with self._lock:
            self.takes[uid].update(trashed=False, trashed_by=None)

    # ---------- songs, as the band changes them there ----------

    def song_called(self, title):
        with self._lock:
            return self._find_song(title)

    def _find_song(self, title):
        key = (title or "").casefold()
        return next((x for x in self.songs.values() if x["title"].casefold() == key), None)

    def _make_song(self, title, tempo=None, signature=None, by=None):
        song = {"id": self._next_song, "title": title, "tempo": tempo, "signature": signature, "trashed": False,
                "title_by": None, "meter_by": None, "made_by": by, "trashed_by": None}
        self._next_song += 1
        self.songs[song["id"]] = song
        return song

    def _rename_song(self, song, title, by):
        old = song["title"]
        for t in self.takes.values():
            if t.get("song_id") == song["id"]:
                name = t.get("name") or ""
                t["name"] = title if name == old else title + name[len(old):] if name.startswith(old + " ") else name
                t["song"] = title
        song.update(title=title, title_by=by)

    def rename_in_service(self, title, to, by="Ivan"):
        with self._lock:
            self._rename_song(self._find_song(title), to, by)

    def tempo_in_service(self, title, tempo, signature, by="Ivan"):
        with self._lock:
            self._find_song(title).update(tempo=tempo, signature=signature, meter_by=by)

    def new_in_service(self, title, by="Ivan"):
        with self._lock:
            return self._make_song(title, by=by)["id"]

    def delete_song_in_service(self, title, by="Ira"):
        with self._lock:
            self._find_song(title).update(trashed=True, trashed_by=by)

    def move_in_service(self, uid, title, by="Ivan"):
        """⋯ › Move to song on a take: named by the song's title until
        РЭХА gives it its number. A title of None is Not named: the take
        is named Take until РЭХА gives it its number among the takes with
        no song."""
        with self._lock:
            if title is None:
                take = self.takes[uid]
                if take.get("song_id") is None:
                    return  # no song already: the service changes nothing
                take.update(song_id=None, song=None, name="Take")
                self.moved[uid] = {"song_id": None, "by": by}
                return
            song = self._find_song(title)
            self.takes[uid].update(song_id=song["id"], song=song["title"], name=song["title"])
            self.moved[uid] = {"song_id": song["id"], "by": by}

    # ---------- sets, as the band changes them there ----------

    def set_called(self, name):
        """The set in use with this name, whatever its case, or None."""
        with self._lock:
            return self._set_in_use(name)

    def _set_in_use(self, name, but=None):
        key = (name or "").strip().casefold()
        return next((s for s in self.sets.values()
                     if not s["trashed"] and s["id"] != but and s["name"].casefold() == key), None)

    def _make_set(self, name, songs, by=None):
        made = {"id": self._next_set, "name": name, "songs": list(dict.fromkeys(songs)), "trashed": False,
                "made_by": by, "changed_by": by, "trashed_by": None}
        self._next_set += 1
        self.sets[made["id"]] = made
        return made

    def _set_songs(self, s, wanted):
        """As the service gives a set new songs (store.ts newSongs): one in
        the Trash that `wanted` leaves out keeps its place among the others.
        Whether they changed."""
        wanted = list(dict.fromkeys(wanted))
        hidden = {x for x in s["songs"] if self.songs[x]["trashed"] and x not in wanted}
        queue, out = list(wanted), []
        for x in s["songs"]:
            if x in hidden:
                out.append(x)
            elif queue:
                out.append(queue.pop(0))
        out += queue
        if out == s["songs"]:
            return False
        s["songs"] = out
        return True

    def _change_set(self, s, name, songs, by):
        """As store.ts changeSet: a rename, new songs or both, by `by`; who
        changed it last stays when nothing changed. A name another set in
        use has is turned down whole, unless the set is in the Trash: the
        service's words for that, or None."""
        renamed = name is not None and name != s["name"]
        if renamed and not s["trashed"]:
            other = self._set_in_use(name, but=s["id"])
            if other is not None:
                return f"There is already a set called {other['name']}."
        changed = songs is not None and self._set_songs(s, songs)
        if renamed:
            s["name"] = name
        if renamed or changed:
            s["changed_by"] = by
        return None

    def _ids(self, titles):
        return [self._find_song(t)["id"] for t in titles]

    def new_set_in_service(self, name, titles=(), by="Ivan"):
        """New set, then songs added to it."""
        with self._lock:
            return self._make_set(name, self._ids(titles), by)["id"]

    def change_set_in_service(self, name, to=None, titles=None, by="Ivan"):
        """A rename, songs added, taken out or moved, or both. ValueError,
        with the service's words, for a name another set has."""
        with self._lock:
            refused = self._change_set(self._set_in_use(name), to,
                                       None if titles is None else self._ids(titles), by)
            if refused:
                raise ValueError(refused)

    def delete_set_in_service(self, name, by="Ira"):
        with self._lock:
            self._set_in_use(name).update(trashed=True, trashed_by=by)

    def restore_set_in_service(self, sid):
        """Restore in the Trash. ValueError, with the service's words, while
        a set in use has its name."""
        with self._lock:
            other = self._set_in_use(self.sets[sid]["name"])
            if other is not None:
                raise ValueError(f"There is already a set called {other['name']}.")
            self.sets[sid].update(trashed=False, trashed_by=None)

    def songs_of_set(self, name):
        """The titles of a set in use, as the band sees them: songs in the
        Trash left out."""
        with self._lock:
            s = self._set_in_use(name)
            return None if s is None else [self.songs[x]["title"] for x in s["songs"]
                                           if not self.songs[x]["trashed"]]

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
        if parts[:1] == ["songs"]:
            return self._songs_route(method, parts[1:], body)
        if parts[:1] == ["sets"]:
            return self._sets_route(method, parts[1:], body)
        if method == "GET" and parts == ["takes"]:
            with self._lock:
                listed = [{"uid": uid, "trashed": t["trashed"], "mp3_gen": self.gens.get(uid, {}).get("mp3"),
                           "flac_gen": self.gens.get(uid, {}).get("flac"), **self._drift_gen(uid)}
                          for uid, t in self.takes.items()]
            self._said("list")
            return 200, listed
        if parts[:1] != ["takes"] or len(parts) < 2:
            return 404, {"error": "No such call"}
        uid = parts[1]
        rest = parts[2:]
        if method == "PUT" and not rest:
            meta = json.loads(body)
            with self._lock:
                was = self.takes.get(uid) or {}
                if "song_id" in meta or "song" in meta:
                    # РЭХА names the take's song: by its number, or its title.
                    if meta.get("song_id") is not None:
                        song = self.songs.get(meta["song_id"])
                        if song is None:
                            return 409, {"error": "No such song"}
                    elif meta.get("song"):
                        song = self._find_song(meta["song"]) or self._make_song(meta["song"])
                    else:
                        song = None
                    meta = {**meta, "song_id": song and song["id"], "song": song and song["title"]}
                    self.moved.pop(uid, None)
                else:
                    # Left out: the take keeps its song and name.
                    meta = {**meta, **{k: was[k] for k in ("song", "song_id", "name") if k in was}}
                # One the band deleted comes out of the trash only when sent by hand.
                stays = was.get("trashed") and was.get("trashed_by") and not meta.get("by_hand")
                self.takes[uid] = {**meta, "trashed": bool(stays), "trashed_by": was.get("trashed_by") if stays else None}
                gen = self._drift_gen(uid)
            self._said(f"put {uid}")
            return 200, {"ok": True, "in_trash": bool(stays), "song_id": meta.get("song_id"), **gen}
        if method == "PUT" and rest == ["drift"] and self.keeps_tempo:
            data = json.loads(body)
            if self.refuse_drift is not None:
                self._said(f"refused drift {uid}")
                status, words = self.refuse_drift
                return status, {"error": words}
            with self._lock:
                if uid not in self.takes:
                    return 404, {"error": "No such take"}
                if data["gen"] == self.takes[uid]["gen"]:
                    self.drifts[uid] = data
            self._said(f"drift {uid} {data['gen']}")
            return 200, {"ok": True}
        if method == "DELETE" and not rest:
            with self._lock:
                if uid in self.takes:
                    self.takes[uid]["trashed"] = True
            self._said(f"delete {uid}")
            return 200, {"ok": True}
        if method == "POST" and rest == ["ready"]:
            data = json.loads(body)
            with self._lock:
                self.gens.setdefault(uid, {})[data["what"]] = data["gen"]
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

    def _songs_route(self, method, rest, body):
        data = json.loads(body) if body else {}
        with self._lock:
            if method == "GET" and not rest:
                self.order.append("songs")
                return 200, {"songs": [dict(x) for x in self.songs.values()],
                             "moved": [{"uid": uid, **m} for uid, m in self.moved.items()]}
            if method == "POST" and rest == ["link"]:
                ids = []
                for x in data["songs"]:
                    song = self._find_song(x["title"])
                    if song is not None and song["title"] != x["title"]:
                        self._rename_song(song, x["title"], None)  # РЭХА's spelling
                    if song is None:
                        old = next((self._find_song(n) for n in x["old_names"] if self._find_song(n)), None)
                        if old is not None:
                            self._rename_song(old, x["title"], None)
                            song = old
                    if song is None:
                        song = self._make_song(x["title"])
                    if x["tempo"] is not None:
                        song.update(tempo=x["tempo"], signature=x["signature"], meter_by=None)
                    ids.append(song["id"])
                self.order.append(f"link {len(ids)}")
                return 200, {"ids": ids}
            if method == "POST" and not rest:
                song = self._find_song(data["title"])
                if song is None:
                    song = self._make_song(data["title"], data["tempo"], data["signature"])
                else:
                    # Made in РЭХА, the later change: out of the Trash, its spelling.
                    song.update(trashed=False, trashed_by=None)
                    if song["title"] != data["title"]:
                        self._rename_song(song, data["title"], None)
                    if data["tempo"] is not None:
                        song.update(tempo=data["tempo"], signature=data["signature"], meter_by=None)
                self.order.append(f"song {data['title']}")
                return 200, {"id": song["id"]}
            song = self.songs.get(int(rest[0])) if rest and rest[0].isdigit() else None
            if method == "PATCH" and len(rest) == 1:
                if song is None:
                    return 404, {"error": "No such song"}
                if "title" in data and data["title"] != song["title"]:
                    other = self._find_song(data["title"])
                    if other is not None and other is not song:
                        return 409, {"error": f"“{other['title']}” is another song in the band service now. "
                                              "Merge them in РЭХА if they are one song."}
                if "tempo" in data:
                    song.update(tempo=data["tempo"], signature=data["signature"], meter_by=None)
                if "title" in data and data["title"] != song["title"]:
                    self._rename_song(song, data["title"], None)
                self.order.append(f"change {song['title']}")
                return 200, {"ok": True}
            if method == "POST" and rest[1:] == ["merge"]:
                into = self.songs.get(data["into"])
                if into is None:
                    return 404, {"error": "No such song"}
                if song is not None:
                    for t in self.takes.values():
                        if t.get("song_id") == song["id"]:
                            t.update(song_id=into["id"], song=into["title"])
                    if into["tempo"] is None:
                        into.update(tempo=song["tempo"], signature=song["signature"])
                    # As sync.ts mergeSong: in a set that has both, `into`
                    # keeps its place; in one that has only `song`, `into`
                    # takes its place.
                    for st in self.sets.values():
                        if into["id"] in st["songs"]:
                            st["songs"] = [x for x in st["songs"] if x != song["id"]]
                        else:
                            st["songs"] = [into["id"] if x == song["id"] else x for x in st["songs"]]
                    del self.songs[song["id"]]
                self.order.append(f"merge into {into['title']}")
                return 200, {"ok": True}
        return 404, {"error": "No such call"}

    def _sets_route(self, method, rest, body):
        data = json.loads(body) if body else {}
        with self._lock:
            if method == "GET" and not rest:
                self.order.append("sets")
                return 200, {"sets": [{**s, "songs": [x for x in s["songs"] if not self.songs[x]["trashed"]]}
                                      for s in self.sets.values()]}
            sent = data.get("sets", [data]) if method == "POST" else [data]
            unknown = next((x for s in sent for x in s.get("songs") or [] if x not in self.songs), None)
            if unknown is not None:
                return 400, {"error": f"No such song: {unknown}"}
            if method == "POST" and rest == ["link"]:
                names = [s["name"].casefold() for s in data["sets"]]
                twice = next((s["name"] for i, s in enumerate(data["sets"]) if s["name"].casefold() in names[i + 1:]),
                             None)
                if twice is not None:
                    return 400, {"error": f"Two of the sets are called {twice}"}
                ids = [self._reha_set(s) for s in data["sets"]]
                self.order.append(f"link sets {len(ids)}")
                return 200, {"ids": ids}
            if method == "POST" and not rest:
                sid = self._reha_set(data)
                self.order.append(f"set {data['name']}")
                return 200, {"id": sid}
            s = self.sets.get(int(rest[0])) if len(rest) == 1 and rest[0].isdigit() else None
            if method in ("PATCH", "DELETE") and s is None:
                return 404, {"error": "No such set"}
            if method == "PATCH":
                refused = self._change_set(s, data.get("name"), data.get("songs"), None)
                if refused:
                    return 409, {"error": refused}
                self.order.append(f"change set {s['name']}")
                return 200, {"ok": True}
            if method == "DELETE":
                if not s["trashed"]:
                    s.update(trashed=True, trashed_by=None)
                self.order.append(f"delete set {s['name']}")
                return 200, {"ok": True}
        return 404, {"error": "No such call"}

    def _reha_set(self, sent):
        """A set РЭХА made: the set in use with its name, which takes its
        spelling and songs, or a new one."""
        s = self._set_in_use(sent["name"])
        if s is None:
            return self._make_set(sent["name"], sent["songs"])["id"]
        self._change_set(s, sent["name"], sent["songs"], None)
        return s["id"]

    def _drift_gen(self, uid):
        """The generation whose tempo the service has, as it says it; a
        service from before the tempo says nothing."""
        if not self.keeps_tempo:
            return {}
        return {"drift_gen": (self.drifts.get(uid) or {}).get("gen")}

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
