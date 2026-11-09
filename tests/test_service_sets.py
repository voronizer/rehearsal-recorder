"""
Sets kept the same in REHA and the band service (sending/service_sets.py),
through the Api, against the fake service (fake_band_service.py) that
checks every request against service/openapi.json.

A set is a name and songs in an order, with one number on both sides. Its
name and songs go both ways: what REHA changes goes at once, after the
songs and before any take, and what the band changes there comes at the
check. Each section is one test of the plan
(docs/superpowers/plans/2026-11-09-gig-sets.md, Task 3).

No sound card: the engine suite's stand-in for sounddevice, and its way of
making an Api that points at temporary folders, are imported from it. The
worker's loop is never started: each check drives `run_next` itself.
"""

import sys
import tempfile
import time
from pathlib import Path

try:
    import openapi_core  # noqa: F401
except ImportError:
    print("pip install openapi-core==0.23.1")
    raise SystemExit(1)

from test_engine import SR, fresh_api, write_wav  # noqa: E402 - stubs sounddevice first

from fake_band_service import FakeBandService  # noqa: E402

from rehearsal_recorder.sending import band_service  # noqa: E402

problems = []


def ok(label, cond):
    # cp1252 only: CI prints these on Windows.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


band_service.BandService.RETRY_SEC = 0

GIG = "Club gig, 13 December"


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
    print("\nAll checks of sets in the band service passed.")
    return 0


def run(tmp, fake):
    _, api = fresh_api(tmp)
    lib = api._lib

    def service():
        return api._sending.get("service")

    def drain(limit=400):
        for _ in range(limit):
            if not service().run_next():
                return

    def check():
        service()._next_check = 0
        drain()

    def lines(state="done"):
        return [(e["title"], e["detail"] if state == "done" else e["error"])
                for e in api._journal.snapshot() if e["kind"] == "service" and e["state"] == state]

    def here(name):
        """The titles of a set here, or None for no such set."""
        st = next((s for s in lib.sets() if s["name"] == name), None)
        return None if st is None else [x["title"] for x in st["songs"]]

    def set_id(name):
        return next((s["id"] for s in lib.sets() if s["name"] == name), None)

    def row(name):
        """What the two sides last agreed on for the set here called `name`."""
        sid = set_id(name)
        return next((r for r in lib.service_sets() if r["set_id"] == sid), None) if sid else None

    def news():
        return api.activity().get("news") or {}

    for title in ("Pałyn", "Viasna", "Kupalle", "Dym", "Ahoń"):
        api.add_song(title)
    api.add_set(GIG, ["Pałyn", "Viasna"])
    api.add_set("Rehearsal", ["Dym"])
    fake.new_in_service("Hušča", by="Ivan")
    # A set the band made there before REHA knew of sets, and one named as
    # a set here.
    fake.new_set_in_service("Festival", ["Hušča"], by="Ivan")
    fake.new_set_in_service("club gig, 13 december", ["Hušča"], by="Ivan")

    print("\n[1] test_sets_link_on_first_check")
    ok("a key picks the service", api.set_service_key(fake.key)["ok"])
    drain()
    ok("the first check links the sets, once",
       fake.count("link sets ") == 1 and fake.count("set ") == 0)
    ok("a set with the same name there, whatever its case, is that set, with REHA's spelling and songs",
       fake.set_called(GIG)["name"] == GIG and fake.songs_of_set(GIG) == ["Pałyn", "Viasna"]
       and row(GIG)["sid"] == fake.set_called(GIG)["id"])
    ok("a set only here is made there", fake.songs_of_set("Rehearsal") == ["Dym"] and row("Rehearsal") is not None)
    ok("a set only there is made here, with its songs",
       here("Festival") == ["Hušča"] and row("Festival")["sid"] == fake.set_called("Festival")["id"])
    ok("its line says who made it",
       ("Festival", "New set from Ivan in the band service") in lines())
    puts = len(fake.order)
    drain()
    check()
    ok("a check after it sends nothing", fake.order[puts:] == ["songs", "sets", "list"])

    print("\n[2] test_set_made_here_goes_after_its_songs")
    api.start_rehearsal("Evening", None, SR, [{"name": "Drums", "channel": 1}], 16)
    draft = tmp / "drafts" / "take 1"
    write_wav(draft / "Drums.wav", 900, seconds=12.0)
    api._session["take_counter"] = 1
    api.add_song("Lieta")
    api.add_set("Summer", ["Lieta"])
    kept = api.keep_take(1, str(draft), "Lieta", 12.0, [{"name": "Drums", "file": str(draft / "Drums.wav")}], [], True)
    ok("a take is kept", kept["ok"])
    start = len(fake.order)
    drain()
    order = fake.order[start:]
    put = next((i for i, o in enumerate(order) if o.startswith("put ")), None)
    ok("the song goes first, then the set, then the take",
       "song Lieta" in order and "set Summer" in order and put is not None
       and order.index("song Lieta") < order.index("set Summer") < put)
    ok("the set there has the song's number",
       fake.set_called("Summer")["songs"] == [fake.song_called("Lieta")["id"]])

    print("\n[3] test_title_with_no_song_is_made_a_song_first")
    def summer():
        return next(s for s in lib.sets() if s["name"] == "Summer")["songs"]

    api.update_set(set_id("Summer"), None, ["Lieta", "Novaja pieśnia"])
    ok("a title nobody has played is no song yet", summer()[1]["new"])
    drain()
    ok("it is made a song here, as New song makes one",
       lib.song_id("Novaja pieśnia") is not None and not summer()[1]["new"])
    ok("and there, before its set",
       fake.song_called("Novaja pieśnia") is not None
       and fake.songs_of_set("Summer") == ["Lieta", "Novaja pieśnia"]
       and fake.order.index("song Novaja pieśnia") < fake.order.index("change set Summer"))

    print("\n[4] test_rename_and_reorder_go_both_ways")
    api.update_set(set_id("Rehearsal"), "Thursday", ["Kupalle", "Dym"])
    drain()
    ok("a rename and new songs made here go at once, in one call",
       fake.set_called("Thursday") is not None and fake.songs_of_set("Thursday") == ["Kupalle", "Dym"]
       and fake.count("change set Thursday") == 1 and row("Thursday")["name"] == "Thursday")
    fake.change_set_in_service(GIG, to="Club gig, 14 December", titles=["Viasna", "Pałyn", "Ahoń"], by="Ivan")
    check()
    ok("a rename and reorder there are done here",
       here("Club gig, 14 December") == ["Viasna", "Pałyn", "Ahoń"] and here(GIG) is None)
    ok("in one line, saying who",
       lines().count(("Club gig, 14 December", "Ivan changed it in the band service")) == 1)
    ok("and agreed, so nothing goes back",
       fake.count("change set Club gig, 14 December") == 0
       and row("Club gig, 14 December")["name"] == "Club gig, 14 December")

    print("\n[5] test_both_changed_reha_wins")
    # No internet for the sets: REHA's change waits, and the band changes the same set.
    service()._later["sets"] = time.monotonic() + 3600
    api.update_set(set_id("Thursday"), "Thursday rehearsal", ["Dym", "Kupalle"])
    drain()
    ok("REHA's change waits while the sets wait", fake.set_called("Thursday") is not None)
    fake.change_set_in_service("Thursday", to="Thursday, late", titles=["Kupalle"], by="Vik")
    service()._later.pop("sets")
    check()
    ok("changed on both sides: REHA's change goes, and wins",
       here("Thursday rehearsal") == ["Dym", "Kupalle"]
       and fake.songs_of_set("Thursday rehearsal") == ["Dym", "Kupalle"]
       and fake.set_called("Thursday, late") is None)

    print("\n[6] test_set_deleted_here_goes_to_trash_there")
    sid = row("Thursday rehearsal")["sid"]
    fake.drop = 1
    api.delete_set(set_id("Thursday rehearsal"))
    drain()
    ok("deleted here, it keeps its number until the service has the delete",
       here("Thursday rehearsal") is None and not fake.sets[sid]["trashed"]
       and [r["set_id"] for r in lib.service_sets() if r["sid"] == sid] == [None])
    drain()
    ok("it goes to the Trash there, and its number goes",
       fake.sets[sid]["trashed"] and fake.sets[sid]["trashed_by"] is None
       and all(r["sid"] != sid for r in lib.service_sets()))
    api.add_set("Spare", ["Dym"])
    drain()
    spare = row("Spare")["sid"]
    fake.sets.pop(spare)  # gone there for good
    api.delete_set(set_id("Spare"))
    drain()
    ok("one the service no longer has is done with too",
       all(r["sid"] != spare for r in lib.service_sets()) and fake.count("delete set") == 1)

    print("\n[7] test_set_deleted_there_goes_here_and_restore_brings_it")
    festival = row("Festival")["sid"]
    fake.delete_set_in_service("Festival", by="Ira")
    check()
    ok("a set deleted there goes here", here("Festival") is None
       and all(r["sid"] != festival for r in lib.service_sets()))
    ok("its line says who", ("Festival", "Ira deleted it in the band service") in lines())
    ok("and nothing goes back", fake.count("delete set Festival") == 0)
    fake.restore_set_in_service(festival)
    check()
    ok("Restore there brings it back here, with its songs and its number",
       here("Festival") == ["Hušča"] and row("Festival")["sid"] == festival)

    print("\n[8] test_same_name_both_sides_gets_2")
    fake.new_set_in_service("Wedding", ["Dym"], by="Ivan")
    api.add_set("wedding", ["Pałyn", "Viasna"])
    drain()
    ok("a set made here with a name a set has there is that set, with REHA's songs",
       row("wedding")["sid"] == fake.set_called("Wedding")["id"]
       and fake.set_called("wedding")["name"] == "wedding"
       and fake.songs_of_set("wedding") == ["Pałyn", "Viasna"])
    fake.new_set_in_service("Club", ["Dym"], by="Ivan")
    api.update_set(set_id("Summer"), "Club", None)
    drain()
    ok("renamed here to a name another set has there, it is renamed Club 2 here and there",
       here("Club 2") is not None and here("Club") is None
       and fake.set_called("Club 2")["id"] == row("Club 2")["sid"] and row("Club 2")["name"] == "Club 2")
    calls = fake.count("change set")
    check()
    check()
    ok("nothing loops", fake.count("change set") == calls)
    ok("and the band's Club comes here as a set of its own",
       here("Club") == ["Dym"] and row("Club")["sid"] == fake.set_called("Club")["id"])
    # The band swaps two sets' names there, by way of a third.
    fake.change_set_in_service("wedding", to="Swap", by="Ivan")
    fake.change_set_in_service("Festival", to="wedding", by="Ivan")
    fake.change_set_in_service("Swap", to="Festival", by="Ivan")
    check()
    ok("names swapped there are swapped here, with no 2 after either",
       here("wedding") == ["Hušča"] and here("Festival") == ["Pałyn", "Viasna"]
       and fake.count("change set") == calls)
    # The band deletes a set and gives its name to another.
    fake.delete_set_in_service("Club", by="Ira")
    fake.change_set_in_service("Club 2", to="Club", by="Ivan")
    check()
    ok("a name freed there by a delete is taken here",
       here("Club") == ["Lieta", "Novaja pieśnia"] and here("Club 2") is None
       and fake.count("change set") == calls)

    print("\n[9] test_song_deleted_in_service_leaves_sets")
    api.add_set("Autumn", ["Ahoń", "Kupalle", "Dym"])
    drain()
    fake.delete_song_in_service("Kupalle", by="Ira")
    start = len(fake.order)
    check()
    ok("a song deleted there with no takes here goes here",
       lib.song_id("Kupalle") is None and ("Kupalle", "Ira deleted it in the band service") in lines())
    ok("and leaves the sets here", here("Autumn") == ["Ahoń", "Dym"])
    ok("and what was agreed", fake.song_called("Kupalle")["id"] not in row("Autumn")["songs"])
    drain()
    check()
    ok("the next push makes the song again nowhere",
       not [o for o in fake.order[start:] if o in ("song Kupalle", "change set Autumn")]
       and lib.song_id("Kupalle") is None)
    # A song with takes here stays when it is deleted there: its sets keep it
    # here while there it is left out, and nothing goes either way for it.
    api.update_set(set_id("Autumn"), None, ["Ahoń", "Lieta", "Dym"])
    drain()
    fake.delete_song_in_service("Lieta", by="Ira")
    start = len(fake.order)
    check()
    check()
    ok("a song in the Trash there with takes here stays in its sets here",
       here("Autumn") == ["Ahoń", "Lieta", "Dym"] and fake.songs_of_set("Autumn") == ["Ahoń", "Dym"]
       and "change set Autumn" not in fake.order[start:])
    fake.change_set_in_service("Autumn", titles=["Dym", "Ahoń"], by="Vik")
    check()
    ok("the band's order there keeps it in its place here",
       here("Autumn") == ["Dym", "Lieta", "Ahoń"])
    fake.songs[fake.song_called("Lieta")["id"]].update(trashed=False, trashed_by=None)
    check()
    ok("restored there, it is where it was on both sides",
       fake.songs_of_set("Autumn") == ["Dym", "Lieta", "Ahoń"] and here("Autumn") == ["Dym", "Lieta", "Ahoń"])

    print("\n[10] test_news_counts_songs_and_sets")
    for title, to in (("Pałyn", "Pałyn nanova"), ("Viasna", "Viasna nanova"), ("Dym", "Dym nad vadoj"),
                      ("Ahoń", "Ahoń i vada")):
        fake.rename_in_service(title, to, by="Ivan")
    fake.change_set_in_service("Autumn", titles=["Ahoń i vada", "Lieta", "Dym nad vadoj"], by="Ivan")
    check()
    api._names_pass.run_queued()
    ok("the notice counts songs and sets",
       news().get("text") == "Ivan changed 4 songs and 1 set in the band service")
    ok("the set follows its songs' new titles here, in the band's order",
       here("Autumn") == ["Ahoń i vada", "Lieta", "Dym nad vadoj"])
    fake.change_set_in_service("Autumn", to="Autumn tour", by="Vik")
    check()
    ok("a set alone is counted alone", news().get("text") == "Vik changed 1 set in the band service")

    print("\n[11] test_button_with_nothing_new_says_so")
    said = news().get("id")
    check()
    ok("a check with nothing new says nothing", news().get("id") == said)
    ok("Check the band service is a call", api.check_band_service() == {"ok": True})
    drain()
    ok("pressed with nothing new, it says so, with nothing to see",
       news().get("id") != said and news().get("text") == "Nothing new in the band service."
       and news().get("see") is False)
    said = news().get("id")
    fake.change_set_in_service("Autumn tour", to="Autumn", by="Vik")
    api.check_band_service()
    drain()
    ok("pressed with something new, it gives the check's own notice",
       news().get("id") != said and news().get("text") == "Vik changed 1 set in the band service"
       and "see" not in news())
    api._recorder = object()
    try:
        api.check_band_service()
        ok("while a take records, it waits", service().run_next() is False)
    finally:
        api._recorder = None
    said = news().get("id")
    drain()
    ok("and checks right after", news().get("id") != said)
    said = news().get("id")
    fake.refuse = (401, "This key does not work")
    api.check_band_service()
    drain()
    fake.refuse = None
    ok("a check the service turned down does not say nothing is new", news().get("id") == said)
    api.disconnect_service()
    ok("with no key, it says so", api.check_band_service()["ok"] is False)
    api.set_service_key(fake.key)

    print("\n[12] test_new_key_forgets_sets")
    drain()
    names = sorted(s["name"] for s in lib.sets())
    fake2 = FakeBandService().start()
    try:
        api.disconnect_service()
        api.set_service_key(fake2.key)
        ok("a key to another service forgets the sets' numbers, and keeps the sets",
           lib.service_sets() == [] and sorted(s["name"] for s in lib.sets()) == names)
        drain()
        ok("the first check there links them",
           fake2.count("link sets ") == 1 and sorted(s["name"] for s in fake2.sets.values()) == names
           and len(lib.service_sets()) == len(names))
        ok("every request to it matches the service's description", fake2.mismatches == [])
    finally:
        api.disconnect_service()
        fake2.stop()

    ok("every request matches the service's description", fake.mismatches == [])
    if fake.mismatches:
        print("\n".join("    " + m for m in fake.mismatches[:5]))


if __name__ == "__main__":
    sys.exit(main())
