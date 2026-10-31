"""
Sending takes to a band service (sending/band_service.py), through the Api,
against a fake service (fake_band_service.py) that checks every request
against service/openapi.json, the description the real service makes of
itself.

No sound card: the engine suite's stand-in for sounddevice, and its way of
making an Api that points at temporary folders, are imported from it. The
worker's loop is never started: each check drives `run_next` itself, so
nothing races it.
"""

import sys
import tempfile
import threading
from pathlib import Path

try:
    import openapi_core  # noqa: F401
except ImportError:
    print("pip install openapi-core==0.23.1")
    raise SystemExit(1)

from test_engine import SR, fresh_api, write_wav  # noqa: E402 - stubs sounddevice first

from fake_band_service import FakeBandService  # noqa: E402

from rehearsal_recorder.sending import band_service, service_files  # noqa: E402

problems = []


def ok(label, cond):
    # cp1252 only: CI prints these on Windows.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


BAND = ["Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"]

# Several parts to a file, so a file can be cut short in the middle.
band_service.PART_BYTES = 16 * 1024
# A take that met no internet is tried again at once, not in 30 seconds.
band_service.BandService.RETRY_SEC = 0


class Window:
    """What the module asks of pywebview's window."""

    def __init__(self):
        self.asked = threading.Event()
        self.destroyed = threading.Event()
        self.js = []

    def evaluate_js(self, code):
        self.js.append(code)
        self.asked.set()

    def destroy(self):
        self.destroyed.set()


def main():
    tmp = Path(tempfile.mkdtemp())
    fake = FakeBandService().start()
    try:
        run(tmp, fake)
    finally:
        fake.stop()
    if problems:
        print(f"\n{len(problems)} FAILED")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nAll band service checks passed.")
    return 0


def run(tmp, fake):
    _, api = fresh_api(tmp)

    def service(a=None):
        return (a or api)._sending.get("service")

    def drain(a=None, limit=400):
        for _ in range(limit):
            if not service(a).run_next():
                return

    def entries(a=None, state=None):
        return [e for e in (a or api)._journal.snapshot()
                if e["kind"] == "service" and (state is None or e["state"] == state)]

    takes = {"n": 0}

    def keep(name, seconds=12.0, band=BAND, duration=None, send=None, a=None):
        """A take of the rehearsal in progress, its tracks a tone each."""
        a = a or api
        takes["n"] += 1
        n = takes["n"]
        draft = tmp / "drafts" / f"take {n}"
        tracks = []
        for i, track in enumerate(band):
            write_wav(draft / f"{track}.wav", 800 + 100 * i + n, seconds=seconds)
            tracks.append({"name": track, "file": str(draft / f"{track}.wav")})
        a._session["take_counter"] = n
        kept = a.keep_take(n, str(draft), name, duration or seconds, tracks, [], send)
        assert kept["ok"], kept
        return n

    def uid_of(n, a=None):
        row = (a or api)._lib.service_row(folder(a), n)
        return None if row is None else row["uid"]

    def folder(a=None):
        return (a or api)._session["folder"]

    def take(n, a=None):
        return (a or api)._lib.take(folder(a), n)

    print("\n[1] The key")
    ok("a key in the wrong shape is refused",
       api.set_service_key("nonsense")["ok"] is False)
    ok("and says so", api.set_service_key("nonsense").get("error") == "This is not a band service key")
    res = api.set_service_key(fake.key)
    ok("a key is kept and picks the service",
       res["ok"] and api.get_settings()["send_to"] == "service")
    ok("the settings show the service's address",
       api.get_settings()["service"] == {"address": fake.address, "auto_publish": False})
    ok("automatic sending can be turned on",
       api.set_service_auto_publish(True) == {"ok": True, "auto_publish": True})
    ok("the switch picks only the cloud folder or the service",
       api.set_send_to("nowhere")["ok"] is False and api.get_settings()["send_to"] == "service")

    api.start_rehearsal("Evening", None, SR, [{"name": t, "channel": i + 1} for i, t in enumerate(BAND)], 16)
    api.set_false_start(5)

    print("\n[2] A saved take goes up")
    n1 = keep("Viasna")
    uid1 = uid_of(n1)
    ok("a saved take is waiting for the band service",
       uid1 is not None and [e["state"] for e in entries()] == ["waiting"])
    drain()
    up = fake.names_of(uid1, 1)
    ok("a saved take goes when automatic sending is on",
       sorted(n for n in up if n.endswith(".mp3")) == [f"{i}.mp3" for i in range(1, 7)]
       and sum(n.endswith(".flac") for n in up) == 6 and sum(n.endswith(".peaks") for n in up) == 6)
    first_flac = next(i for i, o in enumerate(fake.order) if o.startswith(f"part {uid1} ") and ".flac" in o)
    ok("MP3s go before any FLAC", fake.order.index(f"ready {uid1} mp3 1") < first_flac)
    ok("the take says it is up, FLAC and all",
       take(n1)["service"] == {"up": True, "flac": True, "error": None})
    meta = fake.takes[uid1]
    ok("its details are the take's",
       meta["name"] == take(n1)["name"] and meta["song"] == "Viasna" and meta["gen"] == 1
       and [t["name"] for t in meta["tracks"]] == BAND
       and meta["tracks"][1]["files"] == ["2.mp3", "2.flac", "2.peaks"])
    ok("a waveform is 1200 numbers", len(__import__("json").loads(up["1.peaks"])["peaks"]) == 1200)
    ok("its line in the list is done", [e["state"] for e in entries()] == ["done"])
    ok("the files made for it are gone from the disk",
       not (band_service.staging_root() / uid1).exists())
    ok("nothing is left to send", api.sending_left() == {"takes": 0, "bytes": 0})

    n_short = keep("Palyn", seconds=2.0)
    ok("a false start stays at home", take(n_short)["service"] is None and uid_of(n_short) is None)

    print("\n[3] Cut short")
    n2 = keep("Kupalle", band=["Drums"])
    uid2 = uid_of(n2)
    fake.drop_after_part = 1
    service().run_next()
    ok("a part that arrived unheard leaves the take running",
       entries(state="running") and entries(state="running")[0]["step"]
       == "No internet: carries on when it is back")
    drain()
    sent = fake.names_of(uid2, 1)
    mp3 = take(n2)["service"]
    ok("part sent twice", fake.count(f"part {uid2} 1.mp3 1") == 2 and mp3["up"] and mp3["flac"])
    ok("and the file is whole", len(sent["1.mp3"]) > band_service.PART_BYTES)

    n3 = keep("Viasna", band=["Drums"])
    uid3 = uid_of(n3)
    fake.drop_after_part = 1
    service().run_next()
    staged = band_service.staging_root() / uid3 / "1"
    before = {p.name: p.read_bytes() for p in staged.iterdir()}
    # The app closes here, and opens again on the same folders.
    made = []
    real_encode = service_files.encode

    def counting(*args, **kwargs):
        made.append(args)
        return real_encode(*args, **kwargs)

    service_files.encode = counting
    _, api2 = fresh_api(tmp)
    ok("waiting takes are back in the list when the app opens",
       [e["title"] for e in entries(api2, "waiting")] == ["“Viasna 2” → band service"])
    api2._session = {**api._session}
    drain(api2)
    service_files.encode = real_encode
    after = fake.names_of(uid3, 1)
    # Only the MP3 and the waveform were made when the app closed: the FLAC
    # is made now, and only it.
    ok("staged file reused",
       set(before) == {"1.mp3", "1.peaks"} and [a[1] for a in made] == ["flac"]
       and after["1.mp3"] == before["1.mp3"] and after["1.peaks"] == before["1.peaks"])
    api = api2

    print("\n[4] No internet, a forgotten upload, a refusal")
    n4 = keep("Kupalle", band=["Drums"])
    fake.drop = 1
    service().run_next()
    entry = entries(state="running")[0] if entries(state="running") else {}
    ok("no internet waits instead of failing",
       entry.get("state") == "running" and entry.get("step") == "No internet: carries on when it is back")
    drain()
    ok("and it goes once it is back", take(n4)["service"]["up"])

    n5 = keep("Palyn", band=["Drums"])
    uid5 = uid_of(n5)
    fake.forget_after_parts = 2
    drain()
    ok("a gone upload starts the file again",
       fake.count(f"start {uid5} 1.mp3") == 2 and take(n5)["service"]["up"]
       and len(fake.names_of(uid5, 1)["1.mp3"]) > band_service.PART_BYTES)

    n6 = keep("Viasna", band=["Drums"])
    fake.refuse = (401, "The band service does not know this key any more")
    service().run_next()
    fake.refuse = None
    failed = entries(state="failed")
    entry = failed[0] if failed else {}
    ok("refused words fail the take in red",
       entry.get("state") == "failed"
       and entry.get("error") == "The band service does not know this key any more")
    ok("the take keeps the words",
       take(n6)["service"]["error"] == "The band service does not know this key any more")
    ok("and is not tried again on its own", service().run_next() is False)
    ok("Retry sends it again", api.retry_cloud(entry.get("id"))["ok"])
    drain()
    ok("and then it is up", take(n6)["service"] == {"up": True, "flac": True, "error": None})

    print("\n[5] What changes in REHA follows")
    starts = fake.count("start ")
    api.rename_take(folder(), n1, "Kupalle")
    drain()
    ok("a rename sends the take's details again, no files",
       fake.takes[uid1]["song"] == "Kupalle" and fake.count("start ") == starts)

    n7 = keep("Viasna", band=["Drums"])
    uid7 = uid_of(n7)
    renamed = []

    def rename_on_part(words):
        if words.startswith(f"part {uid7} 1.mp3 2") and not renamed:
            renamed.append(api.rename_take(folder(), n7, "Pałyn")["ok"])

    fake.on_call = rename_on_part
    drain()
    fake.on_call = None
    ok("a rename while files go up: the upload goes on, the name follows",
       renamed == [True] and fake.count(f"start {uid7} 1.mp3") == 1
       and fake.takes[uid7]["song"] == "Pałyn" and take(n7)["service"]["up"])

    n8 = keep("Kupalle", seconds=14.0, band=["Drums"])
    uid8 = uid_of(n8)
    drain()
    cut = api.crop_take(folder(), n8, 10.0, 14.0)
    drain()
    ok("a crop sends a new generation with cut_start",
       cut["ok"] and fake.takes[uid8]["gen"] == 2 and fake.takes[uid8]["cut_start"] == 10.0)
    ok("its files go again, MP3s first",
       "1.mp3" in fake.names_of(uid8, 2) and fake.count(f"ready {uid8} mp3 2") == 1)
    api.end_trash(cut["undo"])

    n9 = keep("Palyn", band=["Drums"])
    uid9 = uid_of(n9)
    drain()
    gone = api.delete_take(folder(), n9)
    back = api.undo_trash(gone["undo"])
    drain()
    ok("undo keeps it",
       back["ok"] and fake.count(f"delete {uid9}") == 0 and uid_of(n9) == uid9)
    gone = api.delete_take(folder(), n9)
    api.end_trash(gone["undo"])
    drain()
    ok("a deletion whose undo time passed reaches the trash",
       fake.count(f"delete {uid9}") == 1 and fake.takes[uid9]["trashed"])

    res = api.unshare_take(folder(), n1)
    drain()
    ok("remove from the band service sends a delete",
       res["ok"] and fake.takes[uid1]["trashed"] and take(n1)["service"] is None)

    print("\n[6] Closing")
    window = Window()
    api._window = window
    n10 = keep("Viasna", band=["Drums"])
    left = api.sending_left()
    ok("what is left is counted", left["takes"] == 1 and left["bytes"] > 0)
    ok("closing with takes left asks first", api.window_closing() is False)
    ok("by asking the window", window.asked.wait(5)
       and window.js == ["window.__rehaClosing && window.__rehaClosing()"])
    api.close_anyway()
    ok("close anyway closes", window.destroyed.wait(5) and api.window_closing() is True)

    print("\n[7] Disconnect, and the switch")
    ok("disconnect forgets the queue",
       api.disconnect_service() == {"ok": True} and api.sending_left() == {"takes": 0, "bytes": 0}
       and uid_of(n10) is None and not band_service.staging_root().exists()
       and api.get_settings()["service"] is None and api.get_settings()["send_to"] == "cloud")

    api.set_service_key(fake.key)
    api.set_cloud_dir(str(tmp / "Drive"))
    api.set_auto_publish(True, "mix")
    n11 = keep("Kupalle", band=["Drums"])
    ok("the cloud folder sends nothing new while the service is chosen",
       api.session_state()["cloud_queue"] == {} and uid_of(n11) is not None)

    fake.too_old = True
    service().run_next()
    fake.too_old = False
    failed = [e for e in entries(state="failed") if e["take_number"] == n11]
    entry = failed[0] if failed else {}
    ok("an old REHA is told to update",
       entry.get("state") == "failed" and entry.get("error") == "Update РЭХА to send takes here")

    ok("every request matches the service's description", fake.mismatches == [])
    if fake.mismatches:
        print("\n".join("    " + m for m in fake.mismatches[:5]))


if __name__ == "__main__":
    sys.exit(main())
