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

import contextlib
import io
import json
import struct
import sys
import tempfile
import threading
import time
import wave
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


def write_stereo(path, tones, seconds=2.0):
    """A stereo WAV: each (left, right) of `tones` in turn, a flat tone on
    each side for `seconds`, at 16-bit scale."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        for left, right in tones:
            w.writeframes(struct.pack("<hh", left, right) * int(SR * seconds))


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

    def keep(name, seconds=12.0, band=BAND, duration=None, send=None, a=None, stereo=(), backing=False):
        """A take of the rehearsal in progress, its tracks a tone each; one
        named in `stereo` a tone on each side, and with `backing`, the song's
        backing track after them."""
        a = a or api
        takes["n"] += 1
        n = takes["n"]
        draft = tmp / "drafts" / f"take {n}"
        tracks = []
        for i, track in enumerate(band):
            if track in stereo:
                write_stereo(draft / f"{track}.wav", [(800 + 100 * i + n, 3000 + n)], seconds=seconds)
            else:
                write_wav(draft / f"{track}.wav", 800 + 100 * i + n, seconds=seconds)
            tracks.append({"name": track, "file": str(draft / f"{track}.wav")})
        if backing:
            write_wav(draft / "Backing.wav", 500 + n, seconds=seconds)
            tracks.append({"name": "Backing", "file": str(draft / "Backing.wav"), "kind": "backing"})
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
       [e["title"] for e in entries(api2, "waiting")] == ["“Viasna\u00a0#2” → band service"])
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
    go9 = take(n9)["go"]
    gone = api.delete_take(folder(), n9)
    api.end_trash(gone["undo"])
    ok("its line in the list names the take as the app shows it",
       f"“Palyn\u00a0#{go9}” → band service trash" in [e["title"] for e in entries()])
    drain()
    ok("a deletion whose undo time passed reaches the trash",
       fake.count(f"delete {uid9}") == 1 and fake.takes[uid9]["trashed"])
    # Deleted before the upgrade gave takes with no song a go, its Undo passed after.
    before = "00000000-0000-4000-8000-000000000015"
    service().deleted([{"service_copy": {"uid": before, "removed": False},
                        "take": {"id": None, "go": None, "take_number": 7}, "song": None}])
    ok("one with no song and no go yet is “Take” in its line, not its place in the rehearsal",
       "“Take” → band service trash" in [e["title"] for e in entries()])
    drain()
    ok("and goes to the trash all the same", fake.count(f"delete {before}") == 1)

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
        ok("and what REHA keeps of them for itself stays here",
           not {"sides", "kind", "tempo"} & set(fake.takes[uid14]))
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
    held_after_stop(api, fake, service, drain, entries, keep, uid_of, take, folder)
    stereo_and_backing(api, fake, service, drain, entries, keep, uid_of, take, folder)
    peaks(api, fake, service, drain, entries, keep, uid_of, take, folder)

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

    # A tempo the service had from takes, before songs had signatures there.
    fake.song_called("Hušča").update(tempo=150, signature=None, meter_by="Vik")
    check()
    check()
    ok("a tempo there with no signature is 4/4 here, said once",
       (song("Hušča")["tempo"], song("Hušča")["signature"]) == (150, "4/4")
       and lines().count(("Hušča: 150 bpm · 4/4", "Vik changed the tempo in the band service")) == 1)

    # A refusal that says nothing of the change (the key, here) leaves it
    # owed: the next check sends it, and does not take the service's back.
    fake.refuse = (401, "This key does not work")
    api.set_song_tempo(lib.song_id("Hušča"), 112, "4/4")
    drain()
    fake.refuse = None
    service()._later.pop("songs", None)
    check()
    ok("a change turned down for the key goes once the key works",
       fake.song_called("Hušča")["tempo"] == 112 and song("Hušča")["tempo"] == 112)

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
       and ("Hušča\u00a0#2 → Rečka\u00a0#1", "Ivan moved it in the band service") in lines())
    ok("and sent with its new song and name, which ends the wait there",
       uid_m not in fake.moved and fake.takes[uid_m]["name"] == "Rečka 1"
       and fake.takes[uid_m]["song_id"] == number("Rečka"))

    # Moved there while its FLAC still went, and the connection dropped.
    n_f = keep("Hušča", band=["Drums"], seconds=6.0)
    uid_f = uid_of(n_f)

    def move_at_flac(words):
        if words.startswith(f"part {uid_f} 1.flac") and uid_f not in fake.moved and not fake.drop:
            fake.move_in_service(uid_f, "Rečka")
            fake.drop = 1

    fake.on_call = move_at_flac
    drain()
    fake.on_call = None
    ok("a take moved there while its files went stays moved when they go again",
       fake.takes[uid_f]["song"] == "Rečka" and uid_f in fake.moved and take(n_f)["service"]["flac"])
    check()
    ok("and is then renamed here", take(n_f)["song"] == "Rečka" and uid_f not in fake.moved)

    # Renamed here, not sent yet, when the band moves it there.
    n_r = keep("Hušča", band=["Drums"])
    drain()
    uid_r = uid_of(n_r)
    fake.move_in_service(uid_r, "Rečka")
    api.rename_take(folder(), n_r, "Lipa")
    service()._next_check = 0
    service().run_next()  # the check, before the take's new name goes
    ok("a take renamed here before the band moved it keeps REHA's name",
       take(n_r)["song"] == "Lipa")
    drain()
    ok("which goes and wins there", fake.takes[uid_r]["song"] == "Lipa" and uid_r not in fake.moved)

    # A jam the band took out of its song there: Not named.
    n_j = keep("Hušča", band=["Drums"])
    drain()
    uid_j = uid_of(n_j)
    # As the list writes it: "Hušča #3".
    was = f"{take(n_j)['song']}\u00a0#{take(n_j)['go']}"
    go_j = lib.next_unnamed_go()
    fake.move_in_service(uid_j, None)
    check()
    ok("a take moved out of its song there is no song here, at the next go of the takes "
       "with no song, not its place in the rehearsal",
       not take(n_j)["song"] and go_j != n_j
       and (take(n_j)["name"], take(n_j)["go"]) == (f"Take {go_j}", go_j)
       and (f"{was} → Take\u00a0#{go_j}", "Ivan moved it in the band service") in lines())
    ok("and sent with no song and that name, which ends the wait there",
       uid_j not in fake.moved and fake.takes[uid_j]["song_id"] is None
       and fake.takes[uid_j]["name"] == f"Take {go_j}")
    ok("its go is used up", lib.next_unnamed_go() == go_j + 1)
    ok("the notice counts the song it left",
       (api.activity().get("news") or {}).get("text") == "Ivan changed 1 song in the band service")

    # A line with no song_id at all is not read as Not named.
    n_x = keep("Hušča", band=["Drums"])
    drain()
    named_x = take(n_x)["name"]
    service().songs._moves([{"uid": uid_of(n_x), "by": "Ivan"}], [])
    ok("a moved line with no song_id leaves the take where it is", take(n_x)["name"] == named_x)

    # The band takes a song's last take out of it and deletes the song.
    n_s = keep("Kalina", band=["Drums"])
    drain()
    fake.move_in_service(uid_of(n_s), None)
    fake.delete_song_in_service("Kalina")
    check()
    ok("its last take taken out and the song deleted there: one check takes both here",
       not take(n_s)["song"] and song("Kalina") is None)

    # Renamed here, not sent yet, when the band takes it out of its song.
    n_k = keep("Hušča", band=["Drums"])
    drain()
    uid_k = uid_of(n_k)
    fake.move_in_service(uid_k, None)
    api.rename_take(folder(), n_k, "Lipa")
    service()._next_check = 0
    service().run_next()  # the check, before the take's new name goes
    ok("a take renamed here before the band took it out of its song keeps REHA's name",
       take(n_k)["song"] == "Lipa")
    drain()
    ok("which goes and wins there too", fake.takes[uid_k]["song"] == "Lipa" and uid_k not in fake.moved)

    # No song here already: moved to a song there, then out of it, before the check.
    n_n = keep("Hušča", band=["Drums"])
    api.rename_take(folder(), n_n, "Take")
    drain()
    uid_n = uid_of(n_n)
    named_n = take(n_n)["name"]
    fake.move_in_service(uid_n, "Hušča")
    fake.move_in_service(uid_n, None)
    check()
    ok("a take with no song here, taken out of its song there, only goes again, its go kept",
       not take(n_n)["song"] and named_n.startswith("Take ") and take(n_n)["name"] == named_n
       and uid_n not in fake.moved and fake.takes[uid_n]["name"] == named_n)

    # Numbered afresh by migration 0015 before the check: what went last is
    # its old name, its place in the rehearsal, and the band moved it.
    n_o = keep("Take", band=["Drums"])
    drain()
    uid_o = uid_of(n_o)
    row_o = lib.service_row_by_uid(uid_o)
    old_name = f"Take {take(n_o)['go'] + 100}"
    lib.change_service_row(row_o["take_id"], lambda c: {"sent": {**c["sent"], "name": old_name}})
    fake.move_in_service(uid_o, "Rečka")
    check()
    ok("a take with no song whose number changed only by the upgrade takes the band's move",
       take(n_o)["song"] == "Rečka" and uid_o not in fake.moved)

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

    api.add_song("Viasna nanova")
    api.add_song("Dudka")
    drain()
    fake.delete_song_in_service("Viasna nanova", by="Ira")
    check()
    gone_here = song("Viasna nanova") is None
    api.add_song("Viasna nanova")
    drain()
    check()
    ok("a song made here again, its title in the Trash there, brings that one back and stays",
       gone_here and song("Viasna nanova") is not None and not fake.song_called("Viasna nanova")["trashed"])

    # Gone from the service for good while its takes keep it here.
    rečka = number("Rečka")
    fake.songs.pop(rečka)
    check()
    drain()
    ok("a song gone there for good, with takes here, gets no new number",
       number("Rečka") is None and fake.song_called("Rečka") is None
       and all(x["title"] != "Rečka" for x in lib.songs_without_number()))

    # The band gives a song the title somebody gives a new song here.
    fake.rename_in_service("Dudka", "Dudka nočču", by="Ivan")
    dudka = number("Dudka")
    api.add_song("Dudka nočču")
    drain()
    ok("a new song here does not take the number of the song the band renamed to its title",
       number("Dudka") == dudka and any(x["title"] == "Dudka nočču" for x in lib.songs_without_number()))
    check()
    check()
    ok("the clash is said once, with what to do",
       [e for e in lines("failed") if e[0] == "Renaming Dudka to Dudka nočču"]
       == [("Renaming Dudka to Dudka nočču", "Ivan renamed it in the band service, and “Dudka nočču” is "
            "another song here. Rename song merges them if they are one song.")])

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


def held_after_stop(api, fake, service, drain, entries, keep, uid_of, take, folder):
    """The take saved by the last Stop is held: neither the band service nor
    the cloud folder sends it until the hold ends (listening-apart spec,
    Sending). The Stop itself is the transport's, in test_transport.py; here
    each take is held as it holds one, and no worker thread runs to race it."""
    print("\n[11] A take held after Stop")
    from unittest import mock
    from rehearsal_recorder import api as apimod

    def calls(uid):
        """What the service was asked about a take, but a delete."""
        return [o for o in fake.order if uid in o and not o.startswith("delete ")]

    def hold(n):
        api._hold_take(folder(), n)
        return n

    up = {"up": True, "flac": True, "error": None}
    drain()
    n_held = hold(keep("Viasna", band=["Drums"]))
    uid_held = uid_of(n_held)
    drain()
    ok("a held take waits for the band service, its line waiting",
       uid_held is not None and calls(uid_held) == []
       and take(n_held)["service"] == {"up": False, "flac": False, "error": None}
       and [e["state"] for e in entries() if e["take_number"] == n_held] == ["waiting"]
       and api.session_state()["service_queue"] == {n_held: "queued"}
       and api.session_state()["held_take"] == n_held)
    n_after = keep("Kupalle", band=["Drums"])
    drain()
    ok("a take saved after it goes meanwhile",
       take(n_after)["service"] == up and calls(uid_held) == [])

    left = api.sending_left()
    ok("a held take counts as still to send", left["takes"] == 1 and left["bytes"] > 0)
    window = Window()
    api._window = window
    service()._closing_anyway = False
    ok("so closing the window asks first, and lets the held take go",
       api.window_closing() is False and window.asked.wait(5)
       and api.session_state()["held_take"] is None)
    drain()
    ok("released, it goes", take(n_held)["service"] == up
       and api.sending_left() == {"takes": 0, "bytes": 0} and api.window_closing() is True)
    ok("release_take with nothing held answers ok", api.release_take() == {"ok": True})

    n_late = hold(keep("Viasna", band=["Drums"]))
    drain()
    ok("held, it waits", calls(uid_of(n_late)) == [])
    real = time.monotonic
    with mock.patch.object(apimod.time, "monotonic", lambda: real() + apimod.HOLD_SEC + 1):
        drain()
    ok("ten minutes after Stop it goes on its own", take(n_late)["service"] == up)

    n_out = hold(keep("Viasna", band=["Drums"]))
    uid_out = uid_of(n_out)
    res = api.unshare_take(folder(), n_out)
    drain()
    api.release_take()
    drain()
    ok("a held take unticked never goes, once released too",
       res["ok"] and calls(uid_out) == [] and take(n_out)["service"] is None
       and api.session_state()["service_queue"] == {})
    ok("nor goes to the service's trash, which never had it",
       not [o for o in fake.order if uid_out in o]
       and not [e for e in entries() if "band service trash" in e["title"]])

    n_false = hold(keep("Palyn", seconds=2.0, band=["Drums"]))
    ok("a held false start stays at home", uid_of(n_false) is None)
    sent = api.share_take(folder(), n_false)
    drain()
    ok("ticked, it is queued and still waits",
       sent["ok"] and calls(uid_of(n_false)) == []
       and api.session_state()["service_queue"] == {n_false: "queued"})
    api.release_take()
    drain()
    ok("and goes once released", take(n_false)["service"] == up)

    # The same with the cloud folder chosen (tmp/Drive, sending on, from [8]).
    cloud = api._sending.get("cloud")
    api.set_send_to("cloud")
    while cloud.queue.run_next():
        pass

    def waiting_cloud(n):
        return [e for e in api._journal.snapshot() if e["kind"] == "cloud"
                and e["take_number"] == n and e["state"] == "waiting"]

    n_c = hold(keep("Viasna", band=["Drums"]))
    ok("a held take waits for the cloud folder",
       cloud.queue.run_next() is False and api.session_state()["cloud_queue"] == {n_c: "queued"}
       and not take(n_c)["cloud"] and waiting_cloud(n_c) != [])
    n_c2 = keep("Kupalle", band=["Drums"])
    ok("a take saved after it is copied meanwhile",
       cloud.queue.run_next() is True and Path(take(n_c2)["cloud"].get("mix", "")).exists()
       and api.session_state()["cloud_queue"] == {n_c: "queued"})
    res = api.unshare_take(folder(), n_c)
    ok("unticking a held take takes its copy off the queue, and is not refused",
       res["ok"] and api.session_state()["cloud_queue"] == {} and waiting_cloud(n_c) == [])
    api.add_take_marker(folder(), n_c, 1.0)
    api.set_take_star(folder(), n_c, True)
    ok("a mark or a star after does not tick it again",
       api.session_state()["cloud_queue"] == {} and take(n_c)["cloud_skip"])
    api.release_take()
    ok("and it stays at home once released", cloud.queue.run_next() is False and not take(n_c)["cloud"])
    sent = api.share_take(folder(), n_c)
    ok("ticked again by hand, it goes, and is left to the setting after",
       sent["ok"] and cloud.queue.run_next() is True and take(n_c)["cloud"]
       and not take(n_c)["cloud_skip"])
    n_c3 = keep("Viasna", band=["Drums"])
    res = api.unshare_take(folder(), n_c3)
    ok("a copy of a take not held is taken off the queue too while it waits",
       res["ok"] and api.session_state()["cloud_queue"] == {} and not take(n_c3)["cloud"])
    while cloud.queue.run_next():
        pass
    n_c4 = hold(keep("Viasna", band=["Drums"]))
    ok("held, a copy waits", cloud.queue.run_next() is False and not take(n_c4)["cloud"])
    jobs = json.loads(api._cloud_jobs_path().read_text(encoding="utf-8"))
    ok("and is written down while it waits", [str(folder()), n_c4, None] in jobs)
    from rehearsal_recorder.sending.cloud_folder import CloudFolder
    again = CloudFolder(api)
    again.resume()
    ok("the app opened again queues it again",
       again.queue.states(str(folder())) == {n_c4: "queued"})
    api.release_take(str(folder()), n_c4 + 1)
    ok("release_take of another take leaves it held", api.session_state()["held_take"] == n_c4)
    api.release_take(str(folder()), n_c4)
    ok("released, it is made", cloud.queue.run_next() is True
       and Path(take(n_c4)["cloud"].get("mix", "")).exists())
    ok("and nothing is left written down", not api._cloud_jobs_path().exists())
    api.set_send_to("service")


def stereo_and_backing(api, fake, service, drain, entries, keep, uid_of, take, folder):
    """Both sides of a stereo track's wave, and the Backing track marked
    among a take's tracks (stereo-in-the-service spec): sent with a take, and
    to takes up from before by a pass of their own, after the tempo's."""
    print("\n[12] Both sides of a stereo wave, and the Backing track")
    tmp = Path(tempfile.mkdtemp())
    write_stereo(tmp / "two.wav", [(9000, 1000), (1000, 20000)])
    write_wav(tmp / "one.wav", 9000)
    service_files.make({"name": "1.peaks", "kind": "peaks", "source": str(tmp / "two.wav")}, tmp / "1.peaks")
    service_files.make({"name": "2.peaks", "kind": "peaks", "source": str(tmp / "one.wav")}, tmp / "2.peaks")
    two = json.loads((tmp / "1.peaks").read_text(encoding="utf-8"))
    one = json.loads((tmp / "2.peaks").read_text(encoding="utf-8"))
    sides = two.get("sides") or []
    ok("a stereo track's waveform has a row per side, each as long as its peaks",
       len(sides) == 2 and len(sides[0]) == len(sides[1]) == len(two["peaks"]) == service_files.PEAKS)

    def near(a, b):
        return abs(a - b) < 0.001

    ok("left then right, its peaks the louder side at each moment",
       near(sides[0][0], 9000 / 32768) and near(sides[1][0], 1000 / 32768)
       and near(sides[0][-1], 1000 / 32768) and near(sides[1][-1], 20000 / 32768)
       and two["peaks"] == [max(a, b) for a, b in zip(*sides)])
    ok("a mono track's waveform is as it was", set(one) == {"peaks"} and len(one["peaks"]) == service_files.PEAKS)
    backed = {"take_number": 4, "name": "Lieta 2", "song": "Lieta", "duration_sec": 30, "starred": False,
              "tracks": [{"name": "Bass", "file": "b.wav", "icon": "bass"},
                         {"name": "Backing", "file": "k.wav", "icon": None, "kind": "backing"}]}
    tracks = service_files.meta(backed, {"id": 1, "created_at": "2026-11-11", "name": "Thursday"}, [], {}, 1, 0)["tracks"]
    ok("a take's details mark its Backing track, and no other",
       tracks[1].get("kind") == "backing" and "kind" not in tracks[0])

    def row_of(n):
        return api._lib.service_row(folder(), n)

    def marks(n):
        sent = row_of(n)["sent"] or {}
        return sent.get("sides"), sent.get("kind")

    def kinds(uid):
        return [t.get("kind") for t in fake.takes[uid]["tracks"]]

    def look():
        """The next look at the service, and what comes of it."""
        service()._next_check = 0
        drain()

    def from_before(n):
        """The take as an older REHA left it: its waves one row each, and its
        tracks with no mark, here and there."""
        uid = uid_of(n)
        api._lib.change_service_row(row_of(n)["take_id"], lambda r: {"sent": {
            **{k: v for k, v in r["sent"].items() if k not in ("sides", "kind")},
            "tracks": [{k: v for k, v in t.items() if k != "kind"} for t in r["sent"]["tracks"]]}})
        for name, data in list(fake.files.items()):
            if name.startswith(f"{uid}/") and name.endswith(".peaks"):
                fake.files[name] = json.dumps({"peaks": json.loads(data)["peaks"]}).encode()
        for t in fake.takes[uid]["tracks"]:
            t.pop("kind", None)
        return uid, row_of(n)["take_id"]

    drain()
    n1 = keep("Viasna", band=["Drums", "Bass"], stereo=("Drums",), backing=True)
    drain()
    uid1 = uid_of(n1)
    up = fake.names_of(uid1, 1)
    ok("a take sent now sends both sides of its stereo track's wave, and one row of a mono track's",
       len(json.loads(up["1.peaks"]).get("sides") or []) == 2
       and "sides" not in json.loads(up["2.peaks"]) and "sides" not in json.loads(up["3.peaks"]))
    ok("its details mark its Backing track", kinds(uid1) == [None, None, "backing"])
    ok("and its row keeps both marks, which never go to the service",
       marks(n1) == (True, True) and not {"sides", "kind", "tempo"} & set(fake.takes[uid1]))

    # Up from before: a stereo track and Backing.
    uid1, id1 = from_before(n1)
    lines = len(entries())
    files, puts = fake.count(f"file {uid1} "), fake.count(f"put {uid1}")
    balance = dict(fake.takes[uid1]["balance"])
    volumes = api._config.setdefault("volumes", {})
    volumes_before = dict(volumes)
    volumes["Drums"] = 0.3
    look()
    ok("a take up from before gets both sides of its stereo wave after the next look, with no line in the list",
       fake.count(f"file {uid1} ") == files + 1 and fake.count(f"file {uid1} 1.peaks") == 2
       and len(json.loads(fake.files[f"{uid1}/1/1.peaks"]).get("sides") or []) == 2 and len(entries()) == lines)
    ok("and its details once, Backing marked, the band's levels as they were sent",
       fake.count(f"put {uid1}") == puts + 1 and kinds(uid1) == [None, None, "backing"]
       and fake.takes[uid1]["balance"] == balance and not {"sides", "kind", "tempo"} & set(fake.takes[uid1]))
    ok("its row keeps both marks, and what was made for it is gone from the disk",
       marks(n1) == (True, True) and not (band_service.staging_root() / uid1).exists()
       and api._lib.service_files(id1, 1) == {})
    volumes.clear()
    volumes.update(volumes_before)
    look()
    ok("and the next look sends it nothing more",
       fake.count(f"file {uid1} ") == files + 1 and fake.count(f"put {uid1}") == puts + 1)

    # Up from before, all mono, no Backing.
    n2 = keep("Viasna", band=["Drums", "Bass"])
    drain()
    uid2, _ = from_before(n2)
    calls = len([o for o in fake.order if uid2 in o])
    look()
    ok("an all-mono take with no Backing is sent nothing, and is marked all the same",
       len([o for o in fake.order if uid2 in o]) == calls and marks(n2) == (True, True))

    # Up from before, its stereo WAV gone from the computer.
    n3 = keep("Viasna", band=["Drums"], stereo=("Drums",), backing=True)
    drain()
    uid3, _ = from_before(n3)
    wav = Path(take(n3)["tracks"][0]["file"])
    away = wav.with_name("away.wav")
    wav.rename(away)
    starts, puts = fake.count(f"start {uid3} "), fake.count(f"put {uid3}")
    look()
    away.rename(wav)
    ok("a take whose files are gone sends no waves, and is marked all the same",
       fake.count(f"start {uid3} ") == starts and marks(n3)[0] is True)
    ok("its details go all the same, Backing marked",
       fake.count(f"put {uid3}") == puts + 1 and kinds(uid3) == [None, "backing"] and marks(n3)[1] is True)

    # A service from before Backing's mark.
    fake.keeps_kind = False
    n4 = keep("Viasna", band=["Drums"], backing=True)
    drain()
    uid4, id4 = uid_of(n4), row_of(n4)["take_id"]
    ok("a service from before Backing's mark takes the take all the same, and it is not marked",
       take(n4)["service"]["up"] and marks(n4) == (True, None) and kinds(uid4) == [None, None])
    puts = fake.count(f"put {uid4}")
    look()
    ok("its details go again after the next look, and it stays unmarked",
       fake.count(f"put {uid4}") == puts + 1 and marks(n4) == (True, None) and id4 not in service()._owed_marks)
    drain()
    ok("and they go no more until the look after", fake.count(f"put {uid4}") == puts + 1)
    fake.keeps_kind = True
    look()
    ok("once the service keeps the mark, the next look marks the take",
       fake.count(f"put {uid4}") == puts + 2 and kinds(uid4) == [None, "backing"] and marks(n4) == (True, True))
    look()
    ok("and asks no more", fake.count(f"put {uid4}") == puts + 2)

    # Sound playing.
    from rehearsal_recorder.audio.player import TakePlayer
    n5 = keep("Viasna", band=["Drums"], stereo=("Drums",))
    drain()
    uid5, id5 = from_before(n5)
    service()._compare()
    service()._next_check = time.monotonic() + 3600
    player_before = api._player
    listened = TakePlayer([{"name": "Drums", "file": take(n5)["tracks"][0]["file"]}])
    api._player = listened
    listened.play()
    ok("nothing goes while sound plays",
       service().run_next() is False and fake.count(f"start {uid5} 1.peaks") == 1 and id5 in service()._owed_marks)
    listened.pause()

    def play_on_start(words):
        if words == f"start {uid5} 1.peaks" and not listened.playing:
            listened.play()

    fake.on_call = play_on_start
    service().run_next()
    fake.on_call = None
    ok("Play stops it before the wave's part goes, and it waits",
       fake.count(f"start {uid5} 1.peaks") == 2 and fake.count(f"file {uid5} 1.peaks") == 1
       and id5 in service()._owed_marks and service().run_next() is False)
    listened.pause()
    drain()
    ok("and it goes once the sound stops",
       fake.count(f"file {uid5} 1.peaks") == 2 and marks(n5) == (True, True))
    listened.close()
    api._player = player_before

    # No internet.
    n6 = keep("Viasna", band=["Drums"], stereo=("Drums",))
    drain()
    uid6, id6 = from_before(n6)
    service()._compare()
    service()._next_check = time.monotonic() + 3600
    fake.drop = 1
    service().run_next()
    ok("with no internet, its waves wait and are tried again",
       fake.count(f"file {uid6} 1.peaks") == 1 and id6 in service()._owed_marks
       and ("marks", id6) in service()._later and marks(n6) == (None, None))
    service()._later.clear()
    drain()
    ok("and go once it is back", fake.count(f"file {uid6} 1.peaks") == 2 and marks(n6) == (True, True))

    # Turned down.
    n7 = keep("Viasna", band=["Drums"], stereo=("Drums",))
    drain()
    uid7, id7 = from_before(n7)
    service()._compare()
    service()._next_check = time.monotonic() + 3600
    fake.refuse = (400, "Not now")
    said = io.StringIO()
    with contextlib.redirect_stderr(said):
        service().run_next()
    fake.refuse = None
    ok("a take whose waves are turned down says so in one line, and is set aside",
       said.getvalue().count("\n") == 1 and "stereo waves, Backing mark or peak" in said.getvalue()
       and id7 in service()._marks_aside and id7 not in service()._owed_marks)
    look()
    ok("and is not tried again in this run", fake.count(f"start {uid7} 1.peaks") == 1 and marks(n7) == (None, None))
    ok("nothing of it is a line in the list, nor left to send",
       not [e for e in entries() if e["take_number"] in (n1, n2, n3, n5, n6, n7) and e["state"] != "done"]
       and api.sending_left() == {"takes": 0, "bytes": 0})

    # A take whose MP3s were cut short under an older REHA: its stereo wave
    # is sent again only as that REHA made it, with one row.
    drain()
    service()._next_check = time.monotonic() + 3600
    n8 = keep("Viasna", band=["Drums"], stereo=("Drums",))
    uid8, id8 = uid_of(n8), row_of(n8)["take_id"]

    def drop_first_file(words):
        if words == f"put {uid8}":
            fake.drop = 1

    fake.on_call = drop_first_file
    service().run_next()
    fake.on_call = None
    staged = band_service.staging_root() / uid8 / "1" / "1.peaks"
    old = json.dumps({"peaks": json.loads(staged.read_text(encoding="utf-8"))["peaks"]})
    staged.write_text(old, encoding="utf-8")
    api._lib.drop_service_file(id8, 1, "1.peaks")
    api._lib.add_service_file(id8, 1, "1.peaks", f"{uid8}/1/1.peaks", staged.stat().st_size)
    service()._later.clear()
    drain()
    ok("a wave an older REHA made, sent now, leaves the take without the mark of both sides",
       take(n8)["service"]["up"] and "sides" not in json.loads(fake.files[f"{uid8}/1/1.peaks"])
       and marks(n8) == (None, True))
    look()
    ok("and the next look sends it with both sides, and marks it",
       len(json.loads(fake.files[f"{uid8}/1/1.peaks"]).get("sides") or []) == 2 and marks(n8) == (True, True))

    # Cropped while its marks go: left to its own send.
    n9 = keep("Viasna", band=["Drums"], stereo=("Drums",), backing=True)
    drain()
    uid9, id9 = from_before(n9)
    service()._compare()
    service()._next_check = time.monotonic() + 3600
    puts = fake.count(f"put {uid9}")
    cropped = []

    def crop_on_start(words):
        if words == f"start {uid9} 1.peaks" and not cropped:
            cropped.append(api.crop_take(folder(), n9, 2.0, 10.0))

    fake.on_call = crop_on_start
    service().run_next()
    fake.on_call = None
    ok("a take cropped while its marks go stops there, and is no longer owed them",
       cropped and cropped[0]["ok"] and id9 not in service()._owed_marks
       and fake.count(f"file {uid9} 1.peaks") == 1 and fake.count(f"put {uid9}") == puts
       and row_of(n9)["due"] and marks(n9) == (None, None))
    drain()
    ok("its own send takes the new generation up with both marks",
       fake.takes[uid9]["gen"] == 2 and kinds(uid9) == [None, "backing"] and marks(n9) == (True, True)
       and len(json.loads(fake.files[f"{uid9}/2/1.peaks"]).get("sides") or []) == 2)
    api.end_trash(cropped[0]["undo"])

    # Taken out while it is owed its marks.
    n10 = keep("Viasna", band=["Drums"], stereo=("Drums",))
    drain()
    uid10, id10 = from_before(n10)
    service()._compare()
    service()._next_check = time.monotonic() + 3600
    owed = id10 in service()._owed_marks
    starts = fake.count(f"start {uid10} 1.peaks")
    api.unshare_take(folder(), n10)
    ok("a take taken out of the service is no longer owed its marks", owed and id10 not in service()._owed_marks)
    drain()
    ok("and nothing of them goes", fake.count(f"start {uid10} 1.peaks") == starts)

    # A service from before Backing's mark, a take with no Backing.
    fake.keeps_kind = False
    n11 = keep("Viasna", band=["Drums"])
    drain()
    puts = fake.count(f"put {uid_of(n11)}")
    look()
    ok("a take with no Backing sent to a service from before the mark is marked, and asked nothing more",
       marks(n11) == (True, True) and fake.count(f"put {uid_of(n11)}") == puts)
    fake.keeps_kind = True



def peaks(api, fake, service, drain, entries, keep, uid_of, take, folder):
    """A take's peak, which the band service turns it up by (louder takes
    spec): sent with its details, and to takes up from before by the pass
    of their marks."""
    print("\n[13] A take's peak for the band service")

    def row_of(n):
        return api._lib.service_row(folder(), n)

    def look():
        service()._next_check = 0
        drain()

    counted = []
    real_peak = band_service.mix_peak

    def counting_peak(files, stop=None):
        counted.append(list(files))
        return real_peak(files, stop=stop)

    band_service.mix_peak = counting_peak
    try:
        drain()
        n1 = keep("Viasna", band=["Drums", "Bass"], stereo=("Drums",), backing=True)
        drain()
        uid1 = uid_of(n1)
        # Drums (800+n, 3000+n), Bass 900+n and Backing 500+n, flat: the right side adds up loudest.
        loudest = (4400 + 3 * n1) / 32768
        ok("a new take's details carry its peak: its tracks added at full level, Backing among them",
           abs((fake.takes[uid1].get("peak") or 0) - loudest) < 1e-5 and fake.peaks[uid1]["gen"] == 1
           and len(counted) == 1 and len(counted[0]) == 3)
        ok("and its row keeps the peak sent", row_of(n1)["sent"].get("peak") == fake.takes[uid1]["peak"])
        api.set_take_star(folder(), n1, True)
        drain()
        ok("a star sends the same peak again, counted once",
           fake.takes[uid1]["starred"] and fake.takes[uid1].get("peak") == row_of(n1)["sent"]["peak"]
           and len(counted) == 1)
        cropped = api.crop_take(folder(), n1, 2.0, 10.0)
        drain()
        ok("a crop counts the new generation's peak and sends it with it",
           cropped["ok"] and fake.takes[uid1]["gen"] == 2 and fake.peaks[uid1]["gen"] == 2 and len(counted) == 2)
        api.end_trash(cropped["undo"])

        # Up from before РЭХА sent the peak.
        n2 = keep("Viasna", band=["Drums", "Bass"])
        drain()
        uid2, id2 = uid_of(n2), row_of(n2)["take_id"]
        api._lib.change_service_row(id2, lambda r: {"sent": {k: v for k, v in r["sent"].items() if k != "peak"}})
        fake.takes[uid2].pop("peak", None)
        fake.peaks.pop(uid2, None)
        lines, files, puts = len(entries()), fake.count(f"start {uid2} "), fake.count(f"put {uid2}")
        look()
        ok("a take up from before gets its peak after the next look, its details once, no files, no line in the list",
           fake.peaks.get(uid2, {}).get("gen") == 1 and fake.count(f"put {uid2}") == puts + 1
           and fake.count(f"start {uid2} ") == files and len(entries()) == lines
           and row_of(n2)["sent"].get("peak") == fake.takes[uid2]["peak"] and id2 not in service()._owed_peaks)
        look()
        ok("and the next look sends it nothing more", fake.count(f"put {uid2}") == puts + 1)

        # Up from before, its WAVs gone from the computer.
        n3 = keep("Viasna", band=["Drums"])
        drain()
        uid3, id3 = uid_of(n3), row_of(n3)["take_id"]
        api._lib.change_service_row(id3, lambda r: {"sent": {k: v for k, v in r["sent"].items() if k != "peak"}})
        fake.takes[uid3].pop("peak", None)
        fake.peaks.pop(uid3, None)
        wav = Path(take(n3)["tracks"][0]["file"])
        away = wav.with_name("away.wav")
        wav.rename(away)
        puts = fake.count(f"put {uid3}")
        look()
        ok("a take whose WAVs are gone sends no peak, and is let be until the next look",
           fake.count(f"put {uid3}") == puts and uid3 not in fake.peaks and id3 not in service()._owed_peaks)
        away.rename(wav)
        look()
        ok("the next look, its WAVs back, sends it", fake.peaks.get(uid3, {}).get("gen") == 1)

        # A service from before the peak.
        fake.keeps_peak = False
        n4 = keep("Viasna", band=["Drums"])
        drain()
        uid4, id4 = uid_of(n4), row_of(n4)["take_id"]
        puts = fake.count(f"put {uid4}")
        look()
        ok("a service from before the peak takes the take, and is not asked to keep it after a look",
           take(n4)["service"]["up"] and fake.count(f"put {uid4}") == puts and id4 not in service()._owed_peaks)
        fake.keeps_peak = True

        # Sound playing while the peak of a new take is counted.
        from rehearsal_recorder.audio.player import TakePlayer
        service()._next_check = time.monotonic() + 3600
        n5 = keep("Viasna", band=["Drums"])
        uid5 = uid_of(n5)
        player_before = api._player
        listened = TakePlayer([{"name": "Drums", "file": take(n5)["tracks"][0]["file"]}])
        api._player = listened
        stops = {"asked": 0}

        def play_midway(files, stop=None):
            def stop_and_play():
                stops["asked"] += 1
                if stops["asked"] == 1:
                    listened.play()
                return bool(stop and stop())
            return real_peak(files, stop=stop_and_play)

        band_service.mix_peak = play_midway
        service().run_next()
        ok("Play stops the count, and the take waits with no details sent",
           fake.count(f"put {uid5}") == 0 and row_of(n5)["due"]
           and [e["step"] for e in entries() if e["take_number"] == n5] == [band_service.PLAYING_STEP])
        listened.pause()
        band_service.mix_peak = counting_peak
        drain()
        ok("and it goes with its peak once the sound stops",
           take(n5)["service"]["up"] and fake.peaks.get(uid5, {}).get("gen") == 1)
        listened.close()
        api._player = player_before
    finally:
        band_service.mix_peak = real_peak
        fake.keeps_peak = True


if __name__ == "__main__":
    sys.exit(main())
