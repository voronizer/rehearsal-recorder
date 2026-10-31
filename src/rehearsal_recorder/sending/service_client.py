"""
The calls РЭХА makes to a band service, over HTTPS, and what their answers
mean to the sending (band_service.py).

The service is a Cloudflare Worker a band runs for itself (service/ in this
repository). Its key, as the band's owner copies it from the service's
Members page, is `<address>:<secret>`: where the service is, and the secret
it knows РЭХА by. Every call carries the secret and РЭХА's version, so a
service that needs a newer РЭХА can say so.
"""

import http.client
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from rehearsal_recorder import __version__
from rehearsal_recorder.updates import _tls

# A call that has had no answer for this long is taken as no internet.
TIMEOUT_SEC = 60

NOT_A_KEY = "This is not a band service key"
NO_INTERNET = "No internet: carries on when it is back"
NOT_ANSWERING = "The band service is not answering: carries on when it is back"

_HOST = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$")
_LOCAL = ("localhost", "127.0.0.1")


class Offline(Exception):
    """No answer: no internet, a timeout, or a service that is down. The
    take waits and is tried again; `step` is what its line says meanwhile."""

    def __init__(self, step=NO_INTERNET):
        super().__init__(step)
        self.step = step


class Gone(Exception):
    """The upload is no longer there (R2 drops one left a week): the file
    starts again."""


class Refused(Exception):
    """The service turned the call down; `words` say why, to a musician."""

    def __init__(self, words):
        super().__init__(words)
        self.words = words


def parse_key(key):
    """
    (base_url, secret) from a key as pasted, or None when it is not one.

    The key is split at its last ":", since the address can carry a port and
    the secret has no ":" of its own. The service is reached over HTTPS, or
    plain HTTP on this computer itself (the tests, and `wrangler dev`).
    """
    key = (key or "").strip()
    address, colon, secret = key.rpartition(":")
    if not colon or not secret or not address or any(c.isspace() for c in key):
        return None
    if not _HOST.match(address):
        return None
    host = address.split(":")[0].lower()
    scheme = "http" if host in _LOCAL else "https"
    return f"{scheme}://{address}", secret


def address_of(key):
    """The address part of a key, as the settings show it."""
    parsed = parse_key(key)
    return None if parsed is None else urllib.parse.urlsplit(parsed[0]).netloc


class ServiceClient:
    def __init__(self, base_url, secret, opener=urllib.request.urlopen):
        self._base = base_url.rstrip("/")
        self._secret = secret
        self._opener = opener

    def hello(self):
        return self._call("GET", "/api/reha/hello")

    def put_take(self, uid, meta):
        return self._call("PUT", f"/api/reha/takes/{uid}", meta)

    def start_file(self, uid, gen, name, size):
        """A new upload for one file: its upload id."""
        answer = self._call("POST", f"/api/reha/takes/{uid}/files",
                            {"gen": gen, "name": name, "size": int(size)})
        return answer["upload_id"]

    def put_part(self, uid, upload_id, number, gen, name, data):
        """One part of a file: its etag, which finish_file names it by."""
        query = urllib.parse.urlencode({"gen": gen, "name": name})
        answer = self._call("PUT", f"/api/reha/takes/{uid}/files/{upload_id}/{int(number)}?{query}",
                            raw=data)
        return answer["etag"]

    def finish_file(self, uid, upload_id, gen, name, parts):
        return self._call("POST", f"/api/reha/takes/{uid}/files/{upload_id}/done",
                          {"gen": gen, "name": name, "parts": [[int(n), e] for n, e in parts]})

    def ready(self, uid, gen, what):
        return self._call("POST", f"/api/reha/takes/{uid}/ready", {"gen": gen, "what": what})

    def delete_take(self, uid):
        return self._call("DELETE", f"/api/reha/takes/{uid}")

    def _call(self, method, path, body=None, raw=None):
        headers = {"x-api-key": self._secret, "X-Reha-Version": __version__,
                   "Accept": "application/json"}
        data = None
        if raw is not None:
            data = bytes(raw)
            headers["Content-Type"] = "application/octet-stream"
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self._base + path, data=data, method=method,
                                         headers=headers)
        try:
            with self._opener(request, timeout=TIMEOUT_SEC, context=_tls()) as answer:
                return _json(answer.read())
        except urllib.error.HTTPError as e:
            try:
                said = _json(_read(e))
            except ValueError:  # a page of HTML from a proxy, say
                said = {}
            words = said.get("error") if isinstance(said.get("error"), str) else None
            if e.code == 404 and said.get("gone"):
                raise Gone(words or "This upload is gone") from None
            if e.code >= 500:
                raise Offline(NOT_ANSWERING) from None
            raise Refused(words or f"The band service said no ({e.code})") from None
        except (OSError, http.client.HTTPException, ValueError):
            # URLError, a reset or dropped connection, a timeout, an answer
            # cut off or garbled: nothing to go on but trying again.
            raise Offline() from None


def _read(error):
    try:
        return error.read()
    except Exception:  # noqa: BLE001 - an error with no body says nothing
        return b""


def _json(data):
    if not data:
        return {}
    answer = json.loads(data)
    return answer if isinstance(answer, dict) else {}
