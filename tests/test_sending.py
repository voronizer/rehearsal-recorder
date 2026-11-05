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
import time
from pathlib import Path

try:
    import openapi_core  # noqa: F401
except ImportError:
    print("pip install openapi-core==0.23.1")
    raise SystemExit(1)

from test_engine import SR, fresh_api, write_wav  # noqa: E402 - stubs sounddevice first

from fake_band_service import FakeBandService  # noqa: E402

from rehearsal_recorder import __version__  # noqa: E402
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
    """What the module asks of pywebview's window. `answer` is what the page
    gives back: True when it took the question, None when it has no way to
    ask (not loaded yet, or broken)."""

    def __init__(self, answer=True):
        self.asked = threading.Event()
        self.destroyed = threading.Event()
        self.js = []
        self.answer = answer

    def evaluate_js(self, code):
        self.js.append(code)
        self.asked.set()
        return self.answer

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

    print("\n[0] The calls")
    import io
    import urllib.error
    from rehearsal_recorder.sending.service_client import Refused, ServiceClient

    def answers_list(request, timeout=None, context=None):
        raise urllib.error.HTTPError(request.full_url, 400, "Bad", {}, io.BytesIO(b"[1, 2]"))

    try:
        ServiceClient("http://127.0.0.1:9", "s", opener=answers_list).hello()
        said = None
    except Refused as e:
        said = e.words
    except Exception as e:  # noqa: BLE001 - the check is that nothing else escapes
        said = repr(e)
    ok("a refusal whose body is a list still reads as a refusal", said == "The band service said no (400)")

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
    ok("and the rehearsal screen says so",
       api.session_state()["service_queue"] == {n1: "queued"})
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

    ok("a take's details carry no song tempo: the song has its own", "tempo" not in meta)
    ok("the first look at the service gives every song its number",
       fake.count("link ") == 1 and meta["song_id"] == fake.song_called("Viasna")["id"])
    # A song of its own, so the other songs' take numbers stay as they are.
    api._lib.set_song_tempo(api._lib.add_song("Zorka")["id"], 120, "4/4")
    n_tempo = keep("Zorka")
    drain()
    zorka = fake.song_called("Zorka") or {}
    ok("a new song goes with its tempo, before its take, which carries its number",
       zorka.get("tempo") == 120 and fake.takes[uid_of(n_tempo)]["song_id"] == zorka.get("id")
       and fake.order.index("song Zorka") < fake.order.index(f"put {uid_of(n_tempo)}"))

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

    n_lost = keep("Viasna", band=["Drums"])
    uid_lost = uid_of(n_lost)
    fake.drop_after_part = 1
    service().run_next()
    for staged_file in (band_service.staging_root() / uid_lost / "1").iterdir():
        staged_file.unlink()
    drain()
    ok("a staged file gone from the disk is made again",
       take(n_lost)["service"] == {"up": True, "flac": True, "error": None})

    n_fault = keep("Kupalle", band=["Drums"])
    real_make = service_files.make

    def broken(item, dst, stop=None):
        raise RuntimeError("disk on fire")

    service_files.make = broken
    try:
        service().run_next()
        raised = None
    except RuntimeError as e:
        raised = e
    service_files.make = real_make
    failed = [e for e in entries(state="failed") if e["take_number"] == n_fault]
    ok("an unexpected fault fails the take in red, with Retry",
       raised is None and failed and "disk on fire" in failed[0]["error"]
       and take(n_fault)["service"]["error"] is not None)
    n_after = keep("Palyn", band=["Drums"])
    drain()
    ok("and the takes after it still go", take(n_after)["service"]["up"])

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

    n_make = keep("Viasna", band=["Drums", "Bass"])
    uid_make = uid_of(n_make)
    moved, waits = [], []

    def make_then_rename(item, dst, stop=None):
        waits.append(api._names_must_wait())
        real_make(item, dst, stop=stop)
        if not moved:
            moved.append(api.rename_take(folder(), n_make, "Kupalle")["ok"])

    service_files.make = make_then_rename
    drain()
    service_files.make = real_make
    ok("a rename while its files are made: the take still goes, under its new name",
       moved == [True] and take(n_make)["service"] == {"up": True, "flac": True, "error": None}
       and fake.takes[uid_make]["song"] == "Kupalle")
    ok("renaming folders waits while files are made", waits and all(waits))

    n_rec = keep("Palyn", band=["Drums"])
    uid_rec = uid_of(n_rec)
    recording = []

    def record_on_part(words):
        if words.startswith(f"part {uid_rec} 1.mp3 1") and not recording:
            api._recorder = object()
            recording.append(True)

    fake.on_call = record_on_part
    service().run_next()
    fake.on_call = None
    ok("a take starting to record stops the sending at the next part",
       recording == [True] and fake.count(f"part {uid_rec} ") == 1
       and not take(n_rec)["service"]["up"] and service().run_next() is False)
    api._recorder = None
    drain()
    ok("and it carries on after the take", take(n_rec)["service"]["up"])

    # Playing is waited for as recording is: a take, a song's backing track,
    # the click between takes (Api._sound_busy). The take here; the others
    # are the same question, asked in test_engine.py.
    from rehearsal_recorder.audio.player import TakePlayer

    def line_of(n):
        return next((e for e in entries() if e["state"] == "running" and e["take_number"] == n), None)

    n_play = keep("Palyn", band=["Drums"], seconds=6.0)
    uid_play = uid_of(n_play)
    listened = TakePlayer([{"name": "Drums", "file": take(n_play)["tracks"][0]["file"]}])
    api._player = listened
    listened.play()
    ok("nothing goes while a take plays",
       service().run_next() is False and fake.count(f"part {uid_play} ") == 0)
    listened.pause()

    def play_on_part(words):
        if words.startswith(f"part {uid_play} 1.mp3 1") and not listened.playing:
            listened.play()

    fake.on_call = play_on_part
    service().run_next()
    fake.on_call = None
    line = line_of(n_play)
    ok("Play stops the sending at the next part, and its line says why",
       fake.count(f"part {uid_play} ") == 1 and not take(n_play)["service"]["up"]
       and line is not None and line["step"] == band_service.PLAYING_STEP
       and service().run_next() is False)
    listened.pause()
    drain()
    ok("and it carries on once the take is paused", take(n_play)["service"]["up"])

    # Play pressed while an MP3 is being made: it stops between two blocks,
    # leaves nothing behind, and is made again from its start.
    n_block = keep("Palyn", band=["Drums"], seconds=6.0)
    uid_block = uid_of(n_block)
    real_make = service_files.make
    pressed = []

    def play_while_making(item, dst, stop=None):
        if item["kind"] == "mp3" and not pressed:
            pressed.append(dst)
            listened.play()
        return real_make(item, dst, stop=stop)

    service_files.make = play_while_making
    try:
        service().run_next()
    finally:
        service_files.make = real_make
    line = line_of(n_block)
    made = pressed[0] if pressed else None
    ok("Play stops an MP3 being made, and nothing of it is left",
       made is not None and not made.exists() and not made.with_name(made.name + ".wav").exists()
       and fake.count(f"part {uid_block} ") == 0
       and line is not None and line["step"] == band_service.PLAYING_STEP)
    listened.pause()
    drain()
    up = fake.names_of(uid_block, 1)
    ok("and after the pause it is made whole and goes",
       take(n_block)["service"]["up"] and "1.mp3" in up and len(up["1.mp3"]) > 0)
    api._player = None
    listened.close()

    # The rehearsal screen asks only this while takes are on their way
    # (Api.sending_queue), and reads the whole session once it changes. A
    # take's MP3s getting there is the one change its row shows before it
    # leaves the queue, so the answer says it.
    n_up = keep("Palyn", band=["Drums"], seconds=6.0)
    uid_up = uid_of(n_up)
    asked = []

    def ask_at_flac(words):
        if words.startswith(f"part {uid_up} 1.flac") and not asked:
            asked.append(api.sending_queue())

    fake.on_call = ask_at_flac
    drain()
    fake.on_call = None
    during = asked[0] if asked else {}
    after = api.sending_queue()
    ok("the screen's light question names a take whose MP3s are up while its FLAC goes",
       during.get("service_queue", {}).get(n_up) == "working" and n_up in during.get("service_up", []))
    ok("and leaves it out once all of it is up",
       n_up not in after["service_queue"] and n_up not in after["service_up"]
       and {k: api.session_state()[k] for k in after} == after)

    stops = []

    def stop_at_second_block():
        stops.append(True)
        return len(stops) >= 2

    long_item = service_files.plan(take(n_block), {"flac"})[0]
    cut_short = tmp / "cut-short" / "1.flac"
    try:
        service_files.make(long_item, cut_short, stop=stop_at_second_block)
        stopped = False
    except service_files.Stopped:
        stopped = True
    ok("a file being made asks between blocks, and stops when told",
       stopped and len(stops) == 2 and not cut_short.exists()
       and not cut_short.with_name("1.flac.wav").exists())

    lanes = {"take_number": 1, "tracks": [{"name": "Drums", "file": "a.wav"}, {"name": "Click", "file": None},
                                          {"name": "Bass", "file": "b.wav"}],
             "notes": [{"name": "Keys", "file": "k.mid"}]}
    ok("a take's dialog numbers its files as they are sent",
       service_files.names(lanes) == {"tracks": {"Drums": 1, "Bass": 2}, "notes": {"Keys": "3.mid"}}
       and [i["name"] for i in service_files.plan(lanes, {"mid"})] == ["3.mid"])
    undone = service_files.meta({**lanes, "name": "Take 1", "duration_sec": 20.0}, {
        "id": 1, "created_at": "2025-10-30 19:00:00", "name": "Thursday"}, [], {}, 3, -4.0)
    ok("a crop undone sends the start put back as a crop below 0", undone["cut_start"] == -4.0)

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
    puts = fake.count(f"put {uid1}")
    api.rename_take(folder(), n1, "Viasna")
    drain()
    ok("a removed take stays out when it changes",
       fake.count(f"put {uid1}") == puts and take(n1)["service"] is None and fake.takes[uid1]["trashed"])
    again = api.share_take(folder(), n1)
    drain()
    ok("sent again after Remove, it is the same take, out of the trash",
       again["ok"] and uid_of(n1) == uid1 and not fake.takes[uid1]["trashed"]
       and take(n1)["service"] == {"up": True, "flac": True, "error": None})

    print("\n[6] Deleted in the band service")
    n_del = keep("Viasna", band=["Drums"])
    uid_del = uid_of(n_del)
    drain()
    fake.delete_in_service(uid_del)
    starts = fake.count(f"start {uid_del}")
    cropped = api.crop_take(folder(), n_del, 2.0, 12.0)
    drain()
    api.end_trash(cropped["undo"])
    ok("a change of a take deleted in the service marks it taken out",
       cropped["ok"] and take(n_del)["service"] is None and fake.takes[uid_del]["trashed"]
       and fake.count(f"start {uid_del}") == starts)
    ok("and nothing of it is left to send", api.sending_left() == {"takes": 0, "bytes": 0})

    back = api.share_take(folder(), n_del)
    drain()
    ok("the cloud button brings it back, sent by hand",
       back["ok"] and fake.takes[uid_del].get("by_hand") is True and not fake.takes[uid_del]["trashed"]
       and take(n_del)["service"] == {"up": True, "flac": True, "error": None})
    api.rename_take(folder(), n_del, "Kupalle")
    drain()
    ok("a change after that is not by hand",
       fake.takes[uid_del].get("by_hand") is False and fake.takes[uid_del]["song"] == "Kupalle")

    fake.delete_in_service(uid_del)
    puts = fake.count(f"put {uid_del}")
    service()._next_check = 0
    drain()
    ok("the check finds a take deleted in the service",
       take(n_del)["service"] is None and fake.count(f"put {uid_del}") == puts)

    starts = fake.count(f"start {uid_del}")
    fake.restore_in_service(uid_del)
    service()._next_check = 0
    drain()
    ok("the check finds a take restored in the service, and sends no file again",
       take(n_del)["service"] == {"up": True, "flac": True, "error": None}
       and fake.count(f"start {uid_del}") == starts and fake.count(f"put {uid_del}") == puts + 1)

    # Cropped while it was out of the service, then put back there.
    fake.delete_in_service(uid_del)
    service()._next_check = 0
    drain()
    gen = fake.takes[uid_del]["gen"]
    cropped = api.crop_take(folder(), n_del, 1.0, 10.0)
    api.end_trash(cropped["undo"])
    fake.restore_in_service(uid_del)
    service()._next_check = 0
    drain()
    ok("a crop made while it was out goes up as a new generation once it is back",
       cropped["ok"] and fake.takes[uid_del]["gen"] == gen + 1 and fake.takes[uid_del]["cut_start"] == 1.0
       and fake.count(f"ready {uid_del} mp3 {gen + 1}") == 1
       and take(n_del)["service"] == {"up": True, "flac": True, "error": None})

    fake.delete_in_service(uid_del)
    service()._next_check = 0
    drain()
    pressed = []

    def press_while_asked(words):
        if words == "list" and not pressed:
            pressed.append(api.share_take(folder(), n_del)["ok"])

    fake.on_call = press_while_asked
    service()._next_check = 0
    drain()
    fake.on_call = None
    ok("the cloud button pressed while the check asks still sends it",
       pressed == [True] and not fake.takes[uid_del]["trashed"]
       and take(n_del)["service"] == {"up": True, "flac": True, "error": None})

    api.unshare_take(folder(), n_del)
    # Its delete has not reached the service when the check asks.
    service()._later[("delete", uid_del)] = time.monotonic() + 3600
    service()._next_check = 0
    drain()
    ok("the check leaves a take removed here before its delete went",
       take(n_del)["service"] is None and not fake.takes[uid_del]["trashed"])
    service()._later.pop(("delete", uid_del))
    drain()
    ok("and the delete goes after", fake.takes[uid_del]["trashed"])

    n_lack = keep("Viasna", band=["Drums"])
    uid_lack = uid_of(n_lack)
    drain()
    starts = fake.count(f"start {uid_lack}")
    # The service has the take's details but not its files, as when its
    # first check met no internet and a change went to a take deleted for good.
    with fake._lock:
        fake.gens[uid_lack] = {}
    service()._next_check = 0
    drain()
    ok("the check sends again the files the service does not have",
       fake.count(f"start {uid_lack}") > starts and fake.gens[uid_lack].get("mp3") == 1
       and fake.gens[uid_lack].get("flac") == 1 and take(n_lack)["service"] == {"up": True, "flac": True, "error": None})

    n_old = keep("Palyn", band=["Drums"])
    uid_old = uid_of(n_old)
    drain()
    # Deleted for good after 30 days in the trash, while REHA was off.
    with fake._lock:
        fake.takes.pop(uid_old)
    api.rename_take(folder(), n_old, "Kupalle")
    puts = fake.count(f"put {uid_old}")
    _, api3 = fresh_api(tmp)
    api3._session = {**api._session}
    drain(api3)
    ok("a take the service no longer has is marked taken out at start, before any send",
       take(n_old, api3)["service"] is None and fake.count(f"put {uid_old}") == puts
       and uid_old not in fake.takes)
    api = api3

    print("\n[7] Closing")
    window = Window()
    api._window = window
    n10 = keep("Viasna", band=["Drums"])
    left = api.sending_left()
    ok("what is left is counted", left["takes"] == 1 and left["bytes"] > 0)
    ok("closing with takes left asks first", api.window_closing() is False)
    ok("by asking the window", window.asked.wait(5) and window.js == [band_service.CLOSING_JS])
    ok("a page that asks keeps the window", not window.destroyed.wait(0.3))
    quiet = Window(answer=None)
    api._window = quiet
    ok("a page that cannot ask lets the window close",
       api.window_closing() is False and quiet.destroyed.wait(5))
    api._window = window
    api.close_anyway()
    ok("close anyway closes", window.destroyed.wait(5) and api.window_closing() is True)

    print("\n[8] Disconnect, and the switch")
    ok("disconnect keeps what is in the service and sends nothing more",
       api.disconnect_service() == {"ok": True} and api.sending_left() == {"takes": 0, "bytes": 0}
       and uid_of(n10) is not None and uid_of(n_make) == uid_make
       and api.get_settings()["service"] is None and api.get_settings()["send_to"] == "cloud"
       and service().run_next() is False
       and not [e for e in entries() if e["state"] in ("waiting", "running")])
    api.set_service_key(fake.key)
    drain()
    ok("a key for the same service carries on from there",
       take(n10)["service"]["up"] and take(n_make)["service"]["up"] and uid_of(n_make) == uid_make)
    api.disconnect_service()
    other = api.set_service_key("127.0.0.1:9:" + fake.key.rpartition(":")[2])
    ok("a key for another service forgets the old one's takes",
       other["ok"] and uid_of(n10) is None and uid_of(n_make) is None and take(n_make)["service"] is None)
    ok("and the songs' numbers there", api._lib.service_songs() == [])
    api.disconnect_service()

    api.set_service_key(fake.key)
    api.set_cloud_dir(str(tmp / "Drive"))
    api.set_auto_publish(True, "mix")
    n11 = keep("Kupalle", band=["Drums"])
    ok("the cloud folder sends nothing new while the service is chosen",
       api.session_state()["cloud_queue"] == {} and uid_of(n11) is not None)

    fake.too_old = True
    drain()
    fake.too_old = False
    failed = [e for e in entries(state="failed") if e["take_number"] == n11]
    entry = failed[0] if failed else {}
    ok("an old REHA is told to update",
       entry.get("state") == "failed" and entry.get("error") == "Update РЭХА to send takes here")
    # The songs were turned away too, and wait an hour: not now.
    service()._later.pop("songs", None)
    service().reopen()
    drain()
    ok("a take turned away so goes again when REHA starts", take(n11)["service"]["up"])

    print("\n[9] The band's tempo along Master")
    ok("a click take's details carry its tempo, signature and click",
       service_files.meter({"tempo": 96, "signature": "6/8", "click": True})
       == {"tempo": 96.0, "signature": "6/8", "click": True})
    ok("a take recorded with the click off has its tempo and no click",
       service_files.meter({"tempo": 96, "signature": "3/4", "click": False})
       == {"tempo": 96.0, "signature": "3/4", "click": False})
    ok("a take with no tempo, or one the service would not take, sends neither",
       service_files.meter({"tempo": None, "signature": None, "click": True})
       == service_files.meter({"tempo": 120, "signature": "5/4", "click": True})
       == {"tempo": None, "signature": None, "click": False})
    with_notes = {"take_number": 3, "name": "Lieta 1", "song": "Lieta", "duration_sec": 30, "starred": False,
                  "tracks": [{"name": "Bass", "file": "b.wav", "icon": "bass"}],
                  "notes": [{"name": "Drums", "file": "d.mid", "icon": "drums"}, {"name": "Keys", "file": "k.mid"}]}
    ok("each .mid goes with its track's icon",
       service_files.meta(with_notes, {"id": 1, "created_at": "2026-11-03", "name": "Thursday"}, [], {}, 1, 0)["notes"]
       == [{"position": 2, "name": "Drums", "file": "2.mid", "icon": "drums"},
           {"position": 3, "name": "Keys", "file": "3.mid", "icon": None}])
    ok("a count Record stopped is not the take's tempo",
       service_files.drift({"ok": False, "why": "recording"}) is None
       and service_files.drift({"ok": False, "why": "short"}) == {"ok": False, "why": "short"})
    ok("nor one that could not read the files: they may be back",
       service_files.drift({"ok": False, "why": "missing"}) is None)

    bars = {"ok": True, "source": "drums", "per_bar": 4, "tempo": 120.0, "middle": 120.3712,
            "aim": {"tempo": 120, "signature": "4/4", "from": "click", "song": None},
            "bars": [{"n": 1, "start": 0.0004, "end": 2.00049, "tempo": 119.8765},
                     {"n": 2, "start": 2.00049, "end": 4.0, "tempo": None}]}
    sent_bars = {"ok": True, "source": "drums", "per_bar": 4, "middle": 120.37,
                 "aim": {"tempo": 120.0, "signature": "4/4", "from": "click", "song": None},
                 "bars": [{"n": 1, "start": 0.0, "end": 2.0, "tempo": 119.88},
                          {"n": 2, "start": 2.0, "end": 4.0, "tempo": None}]}
    ok("an answer the service would not take is not sent",
       service_files.drift({**bars, "bars": [{"n": 1, "start": 0.0, "end": float("inf"), "tempo": 120.0}]}) is None
       and service_files.drift({**bars, "middle": float("nan")}) is None
       and service_files.drift({**bars, "bars": bars["bars"] * 10001}) is None
       and service_files.drift({"ok": True}) is None)
    counted = []
    answers = [bars]

    def take_drift(tracks, notes, meter):
        counted.append({"tracks": [t["name"] for t in tracks], "meter": meter})
        return answers[0]

    real_drift = api.take_drift
    api.take_drift = take_drift
    try:
        n12 = keep("Lieta", band=["Drums", "Bass"])
        drain()
        uid12 = uid_of(n12)
        ok("a take's tempo goes once its files are up",
           fake.drifts.get(uid12) == {"gen": 1, "drift": sent_bars}
           and fake.order.index(f"drift {uid12} 1") > fake.order.index(f"ready {uid12} flac 1"))
        ok("counted from the take's tracks and its click, as the player counts it",
           counted[-1] == {"tracks": ["Drums", "Bass"],
                           "meter": {"tempo": None, "signature": None, "click": False, "song": "Lieta"}})
        ok("its details carry its click", fake.takes[uid12]["meter"] == {"tempo": None, "signature": None, "click": False})
        before = len(counted)
        service().edited(folder(), n12)
        drain()
        ok("details sent again do not count the tempo again", len(counted) == before and fake.count(f"put {uid12}") == 2)

        answers[0] = {"ok": False, "why": "recording"}
        n13 = keep("Lieta", band=["Drums"])
        for _ in range(40):
            service().run_next()
            if fake.count(f"ready {uid_of(n13)} flac") == 1:
                break
        service().run_next()
        row13 = api._lib.service_row(folder(), n13)
        ok("a count Record stopped leaves the take to go on after the recording",
           uid_of(n13) not in fake.drifts and row13["due"]
           and any(e["take_number"] == n13 and e["step"] == band_service.RECORDING_STEP for e in entries()))
        answers[0] = bars
        drain()
        ok("and it goes then", fake.drifts.get(uid_of(n13), {}).get("gen") == 1)

        fake.keeps_tempo = False
        answers[0] = {"ok": False, "why": "no-beat"}
        n14 = keep("Lieta", band=["Drums"])
        drain()
        uid14 = uid_of(n14)
        ok("a service from before the tempo is not sent it", f"drift {uid14} 1" not in fake.order)
        # As REHA 0.21 sent it: no click in its details.
        id14 = api._lib.service_row(folder(), n14)["take_id"]
        api._lib.change_service_row(id14, lambda r: {"sent": {k: v for k, v in r["sent"].items() if k != "meter"}})
        fake.takes[uid14].pop("meter", None)
        fake.keeps_tempo = True
        lines = len(entries())
        balance = dict(fake.takes[uid14]["balance"])
        volumes = api._config.setdefault("volumes", {})
        volumes_before = dict(volumes)
        volumes["Drums"] = 0.3
        service()._next_check = 0
        drain()
        ok("a take up from before gets its tempo after the next look at the service, with no line in the list",
           fake.drifts.get(uid14) == {"gen": 1, "drift": {"ok": False, "why": "no-beat"}}
           and fake.count(f"put {uid14}") == 2 and len(entries()) == lines)
        ok("its details go again with its click, and the band's levels as they were sent",
           fake.takes[uid14]["meter"] == {"tempo": None, "signature": None, "click": False}
           and fake.takes[uid14]["balance"] == balance)
        volumes.clear()
        volumes.update(volumes_before)
        puts = fake.count("put ")
        service()._next_check = 0
        drain()
        ok("and one that has it is left alone", fake.count("put ") == puts)

        # Up from before, then taken out while it waits for its tempo.
        fake.keeps_tempo = False
        n15 = keep("Lieta", band=["Drums"])
        drain()
        uid15 = uid_of(n15)
        fake.keeps_tempo = True
        service()._compare()
        owed = api._lib.service_row(folder(), n15)["take_id"] in service()._owed
        puts = fake.count(f"put {uid15}")
        service().remove(folder(), n15)
        drain()
        ok("a take taken out while it waits for its tempo stays out",
           owed and fake.takes[uid15]["trashed"] and fake.count(f"put {uid15}") == puts
           and uid15 not in fake.drifts)

        # Up from before; the first try at its tempo meets no internet.
        fake.keeps_tempo = False
        n16 = keep("Lieta", band=["Drums"])
        drain()
        uid16 = uid_of(n16)
        id16 = api._lib.service_row(folder(), n16)["take_id"]
        fake.keeps_tempo = True
        service()._compare()
        fake.drop = 1
        service().run_next()
        ok("with no internet, a take's tempo waits and is tried again",
           uid16 not in fake.drifts and id16 in service()._owed and ("drift", id16) in service()._later)
        service()._later.clear()
        drain()
        ok("and it goes once it is back", fake.drifts.get(uid16, {}).get("gen") == 1)

        # The service turns a take's tempo down.
        fake.refuse_drift = (400, "Too many bars")
        n17 = keep("Lieta", band=["Drums"])
        drain()
        uid17 = uid_of(n17)
        row17 = api._lib.service_row(folder(), n17)
        ok("a tempo the service turns down leaves the take up, not failed",
           fake.count(f"refused drift {uid17}") == 1 and not row17["due"] and row17["error"] is None
           and take(n17)["service"]["up"] and not [e for e in entries(state="failed") if e["take_number"] == n17])
        service()._next_check = 0
        drain()
        ok("and it is not sent again on the next look", fake.count(f"refused drift {uid17}") == 1)
        fake.refuse_drift = None

        # A new song for a take: what its line is measured against moves.
        counts = len(counted)
        api.rename_take(folder(), n12, "Kupalle")
        drain()
        ok("a take named after another song is counted again",
           len(counted) == counts + 1 and counted[-1]["meter"]["song"] == "Kupalle")
    finally:
        api.take_drift = real_drift

    songs_both_ways(api, fake, service, drain, entries, keep, uid_of, take, folder)

    ok("every request matches the service's description", fake.mismatches == [])
    # Cloudflare's Browser Integrity Check turns away Python-urllib/3.x.
    ok("REHA names itself in every request, not as Python",
       fake.user_agents == {f"Reha/{__version__}"})
    if fake.mismatches:
        print("\n".join("    " + m for m in fake.mismatches[:5]))


def songs_both_ways(api, fake, service, drain, entries, keep, uid_of, take, folder):
    """Songs kept the same in REHA and the band service (service_songs.py)."""
    print("\n[10] Songs both ways")
    lib = api._lib

    def song(title):
        sid = lib.song_id(title)
        return None if sid is None else lib.song(sid)

    def number(title):
        return next((r["sid"] for r in lib.service_songs() if r["now"]["title"] == title), None)

    def check():
        service()._next_check = 0
        drain()

    def lines(state="done"):
        """Every line in the list in that state, the names pass's too."""
        return [(e["title"], e["detail"] if state == "done" else e["error"])
                for e in api._journal.snapshot() if e["state"] == state]

    drain()
    ok("every song has its number there, under its title",
       lib.songs_without_number() == []
       and all(fake.songs[r["sid"]]["title"] == r["now"]["title"] for r in lib.service_songs()))

    n_a = keep("Hušča", band=["Drums"])
    drain()
    husca = lib.song_id("Hušča")
    api.rename_song(husca, "Hušča vosień")
    api.set_song_tempo(husca, 132, "4/4")
    drain()
    api._names_pass.run_queued()
    there = fake.songs.get(number("Hušča vosień")) or {}
    ok("a rename and a tempo made here go at once, the takes' names with them",
       there.get("title") == "Hušča vosień" and there.get("tempo") == 132 and there.get("signature") == "4/4"
       and fake.takes[uid_of(n_a)]["name"] == take(n_a)["name"] == "Hušča vosień 1")

    fake.new_in_service("Rečka")
    api.rename_song(husca, "rečka")
    drain()
    api._names_pass.run_queued()
    ok("a rename to another song's title there is put back here, and its line says why",
       song("Hušča vosień") is not None and fake.songs[number("Hušča vosień")]["title"] == "Hušča vosień"
       and ("Renaming Hušča vosień to rečka",
            "“Rečka” is another song in the band service now. Merge them in РЭХА if they are one song.")
       in lines("failed"))

    fake.rename_in_service("Hušča vosień", "Hušča", by="Ivan")
    fake.tempo_in_service("Hušča", 198, "6/8", by="Vik")
    check()
    api._names_pass.run_queued()
    ok("a rename there is done here as Rename song does, its line saying who",
       song("Hušča") is not None and take(n_a)["name"] == "Hušča 1"
       and ("Renaming Hušča vosień to Hušča · 1 take", "Ivan renamed it in the band service") in lines())
    ok("a tempo there is the song's here, its line saying who",
       (song("Hušča") or {}).get("tempo") == 198 and song("Hušča")["signature"] == "6/8"
       and ("Hušča: 198 ♪ · 6/8", "Vik changed the tempo in the band service") in lines())
    ok("a song made there is made here, even with the title an old name had",
       song("Rečka") is not None and ("Rečka", "New song from Ivan in the band service") in lines())
    ok("the check says once who changed how many songs",
       (api.activity().get("news") or {}).get("text") == "Ivan and Vik changed 2 songs in the band service")
    said = api.activity()["news"]["id"]
    check()
    ok("a check with nothing new says nothing new", api.activity()["news"]["id"] == said)

    # With no internet REHA's change waits; meanwhile the band changes the same.
    service()._later["songs"] = time.monotonic() + 3600
    api.set_song_tempo(lib.song_id("Hušča"), 100, "4/4")
    fake.tempo_in_service("Hušča", 140, "4/4", by="Vik")
    service()._later.pop("songs")
    check()
    ok("changed on both sides: the change from REHA goes, and wins",
       fake.song_called("Hušča")["tempo"] == 100 and song("Hušča")["tempo"] == 100)

    n_m = keep("Hušča", band=["Drums"])
    drain()
    uid_m = uid_of(n_m)
    fake.move_in_service(uid_m, "Rečka")
    api.set_take_star(folder(), n_m, True)
    drain()
    ok("a star from REHA leaves a take moved there where it is",
       fake.takes[uid_m]["song"] == "Rečka" and uid_m in fake.moved)
    check()
    ok("a take moved there is renamed here as Rename take does",
       take(n_m)["name"] == "Rečka 1"
       and ("Hušča 2 → Rečka 1", "Ivan moved it in the band service") in lines())
    ok("and sent with its new song and name, which ends the wait there",
       uid_m not in fake.moved and fake.takes[uid_m]["name"] == "Rečka 1"
       and fake.takes[uid_m]["song_id"] == number("Rečka"))

    made = api.add_song("Kalyhanka")
    api.add_song("Kalychanka")
    drain()
    gone = number("Kalychanka")
    api.merge_songs(lib.song_id("Kalychanka"), made["id"])
    drain()
    ok("songs merged here are merged there", gone is not None and gone not in fake.songs
       and lib.service_song_merges() == [] and fake.songs[number("Kalyhanka")]["title"] == "Kalyhanka")

    fake.delete_song_in_service("Kalyhanka", by="Ira")
    fake.delete_song_in_service("Rečka", by="Ira")
    check()
    ok("a song deleted there with no takes here goes here too",
       song("Kalyhanka") is None and ("Kalyhanka", "Ira deleted it in the band service") in lines())
    ok("one with takes here stays", song("Rečka") is not None and take(n_m)["song"] == "Rečka")
    fake.songs[number("Rečka")].update(trashed=False, trashed_by=None)

    # A key to another service: the first look there joins songs renamed
    # here before by the titles they had.
    fake2 = FakeBandService().start()
    try:
        old = fake2.new_in_service("Hušča vosień", by=None)
        api.disconnect_service()
        api.set_service_key(fake2.key)
        drain()
        ok("the first look at another service joins a song by the title it had here",
           fake2.songs[old]["title"] == "Hušča" and number("Hušča") == old and fake2.count("link ") == 1)
        ok("every request to it matches the service's description", fake2.mismatches == [])
    finally:
        api.disconnect_service()
        api.set_service_key(fake.key)
        fake2.stop()


if __name__ == "__main__":
    sys.exit(main())
