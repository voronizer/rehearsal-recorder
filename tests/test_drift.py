"""
Where the band drifted (drift spec Part 2): the beat tracker in audio/tempo.py,
audio/drift.py's tempo of every bar, and Api.take_drift, on synthetic takes.

The takes are made as the research made them (tempo-drift/research/run.py):
a tempo for every bar, changing over two bars, drum hits on its beats with 8
ms of jitter and a fill every eighth bar, the band's bass, guitar and voice
bleeding into the drums' mic, noise under all of it. Each bar's true tempo is
known, so every answer here has a truth to be within 2% of. Real rehearsals
are not here: the spec's list says they are tried by hand.

No sound card, no browser, no MIDI port: WAVs and .mid files in a temporary
folder, given to the counter by their paths.
"""

import os
import tempfile
import threading
import time
from pathlib import Path

# The engine suite's stand-in for the sound card library and its Api, then
# the tempo suite's drums: importing either runs no suite.
from test_engine import fresh_api, np  # noqa: F401  (the stand-ins come with it)
from test_tempo import hit, write_drums_mid, write_wav

from rehearsal_recorder.audio import drift, tempo

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


SR = 44100
rng = np.random.default_rng(1)


def song(*sections):
    """A tempo for each bar, from (bars, tempo) pairs."""
    return np.concatenate([np.full(n, float(v)) for n, v in sections])


def beat_times(bar_tempos, per_bar, start=1.0, ramp=2):
    """When each beat is played: each bar's tempo, moved to over `ramp` bars,
    the first beat at `start` seconds."""
    target = np.repeat(bar_tempos, per_bar)
    k = np.ones(ramp * per_bar) / (ramp * per_bar)
    bpm = np.convolve(np.pad(target, (len(k) - 1, 0), mode="edge"), k, "valid")
    return start + np.concatenate([[0.0], np.cumsum(60.0 / bpm)])


def truth(t, per_bar):
    """Each bar's tempo as played: its beats over its length."""
    return np.array([60.0 * per_bar / (t[(b + 1) * per_bar] - t[b * per_bar])
                     for b in range((len(t) - 1) // per_bar)])


def hits(t, per_bar, style, jitter=0.008):
    """The drums on beats `t`, as (seconds, kind, velocity)."""
    out = []
    for i in range(len(t) - 1):
        a, d = t[i], t[i + 1] - t[i]
        pos, bar = i % per_bar, i // per_bar
        j = lambda x: max(0.0, x + rng.normal(0, jitter))
        if style == "rock":
            out += [(j(a), "h", .6), (j(a + d / 2), "h", .5), (j(a), "k" if pos in (0, 2) else "s", 1.0)]
            if pos == 2:
                out.append((j(a + d / 2), "k", .7))
            if bar % 8 == 7 and pos == 3:
                out += [(j(a + q * d / 4), "s", .8) for q in range(4)]
        elif style == "ballad":
            out += [(j(a + q * d / 4), "h", .45) for q in range(4)]
            out.append((j(a), "k" if pos in (0, 2) else "s", 1.0))
        elif style == "waltz":
            out += [(j(a), "h", .5), (j(a + d / 2), "h", .4), (j(a), "k" if pos == 0 else "s", 1.0 if pos == 0 else .8)]
        elif style == "six8":  # t counts eighths
            out.append((j(a), "h", .5))
            if pos in (0, 3):
                out.append((j(a), "k" if pos == 0 else "s", 1.0))
    return sorted(out)


def drums(events, seconds):
    y = np.zeros(int(seconds * SR) + SR)
    n = int(0.4 * SR)
    for at, kind, vel in events:
        i = int(at * SR)
        y[i:i + n] += vel * hit(rng, SR, kind, n)[: len(y) - i]
    return y[: int(seconds * SR)]


def band(t, per_bar, seconds):
    """The bass and guitar strummed on the grid's eighths, a voice, and noise."""
    y = np.zeros(int(seconds * SR) + SR)
    roots = [55.0, 73.4, 61.7, 49.0]
    for i in range(len(t) - 1):
        a, d = t[i], t[i + 1] - t[i]
        f = roots[(i // (2 * per_bar)) % 4]
        for s in (a, a + d / 2):
            i0, n = int(s * SR), int(d / 2 * SR)
            tt = np.arange(n) / SR
            g = sum(np.sin(2 * np.pi * f * 2 * h * tt) / h for h in range(1, 9)) * np.exp(-tt * 4) * 0.25
            b = np.sin(2 * np.pi * f * tt) * (1 - np.exp(-tt * 60)) * 0.5
            y[i0:i0 + n] += (g + b)[: len(y) - i0]
    tt = np.arange(len(y)) / SR
    y += 0.15 * np.sin(2 * np.pi * 220 * tt + 3 * np.sin(2 * np.pi * 5 * tt)) * (np.sin(2 * np.pi * tt / 7) > 0)
    return (y + 0.02 * rng.standard_normal(len(y)))[: int(seconds * SR)]


def loud(y):
    return y * (0.8 / np.abs(y).max())


class Take:
    """A take made in `folder`: the drums' WAV with the band bleeding in, the
    band's own WAV, the drums' .mid, and the truth of every bar."""

    def __init__(self, folder, name, bar_tempos, per_bar=4, style="rock", start=1.0, drums_from=0, stop=None):
        self.t = beat_times(bar_tempos, per_bar, start)
        self.truth = truth(self.t, per_bar)
        seconds = self.t[-1] + 2
        played = hits(self.t, per_bar, style)
        if drums_from:
            played = [h for h in played if h[0] >= self.t[drums_from * per_bar] - 0.05]
        if stop:
            a, b = self.t[stop[0] * per_bar] - 0.05, self.t[stop[1] * per_bar] - 0.05
            played = [h for h in played if not a <= h[0] < b]
        kit = drums(played, seconds)
        others = band(self.t, per_bar, seconds)
        if stop:
            others[int(self.t[stop[0] * per_bar] * SR):int(self.t[stop[1] * per_bar] * SR)] *= 0.01
        folder = Path(folder)
        self.drums = str(write_wav(folder / f"{name} Drums.wav", loud(kit + 0.25 * others)))
        self.band = str(write_wav(folder / f"{name} Band.wav", loud(others)))
        self.mid = str(write_drums_mid(folder / f"{name} Drums.mid", played))
        self.played = played


def runs(tempos, aim, tol=0.02):
    """Stretches as the interface finds them (lib/drift.ts): two bars or more
    in a row, more than `tol` off the same way, joined across two bars or
    fewer; as (first bar index, last, sign)."""
    sign = [0 if x is None or abs(x / aim - 1) <= tol else (1 if x > aim else -1) for x in tempos]
    out, i = [], 0
    while i < len(sign):
        if not sign[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(sign) and sign[j + 1] == sign[i]:
            j += 1
        if j - i + 1 >= 2:
            if out and out[-1][2] == sign[i] and i - out[-1][1] - 1 <= 2:
                out[-1][1] = j
            else:
                out.append([i, j, sign[i]])
        i = j + 1
    return [tuple(r) for r in out]


def close(found, take, aim, label, within=0.02, first_bar=0):
    """Every bar within `within` of the truth, and the same stretches."""
    bars = found.get("bars") or []
    got = [b["tempo"] for b in bars]
    want = list(take.truth[first_bar:first_bar + len(got)])
    n = min(len(got), len(want))
    err = [abs(g / w - 1) for g, w in zip(got[:n], want[:n]) if g is not None]
    worst = max(err) if err else 1.0
    ok(f"{label}: {n} bars, each within {within:.0%} of the truth (worst {worst:.2%})",
       found.get("ok") and n >= len(take.truth) - first_bar - 2 and worst <= within)
    # A bar on the way to a new tempo can sit right at the tolerance, so an
    # end may land a bar either way.
    played, heard = runs(want[:n], aim), runs(got[:n], aim)
    same = len(played) == len(heard) and all(
        p[2] == h[2] and abs(p[0] - h[0]) <= 1 and abs(p[1] - h[1]) <= 1 for p, h in zip(played, heard))
    ok(f"{label}: the stretches found are the ones played, to a bar ({heard}; {played})", same)


PALYN = song((4, 128), (16, 128), (8, 133), (16, 128.5), (8, 133), (8, 135), (8, 133), (8, 123))


def main():
    folder = Path(tempfile.mkdtemp())
    signal = lambda: False

    print("\n[1] A bar's tempo, from each source")
    palyn = Take(folder, "palyn", PALYN)
    started = time.perf_counter()
    found = drift.count(drums=[palyn.drums], mix=[palyn.drums, palyn.band], tempo=128, stop=signal)
    took = time.perf_counter() - started
    ok("the drums' WAV is the source", found.get("source") == "drums")
    close(found, palyn, 128, "Palyn-like, drums with bleed")
    ok(f"2.4 minutes of one track counted in {took:.2f} s, under 5", took < 5)
    found = drift.count(drums_mid=[palyn.mid], drums=[palyn.drums], tempo=128)
    ok("a drums .mid comes before their WAV", found.get("source") == "drums-mid")
    close(found, palyn, 128, "Palyn-like, drums .mid")
    found = drift.count(mix=[palyn.band, palyn.drums], tempo=128)
    ok("with no drums icon the take's tracks are summed", found.get("source") == "mix")
    close(found, palyn, 128, "Palyn-like, the mix")
    found = drift.count(drums=[palyn.drums], tempo=None)
    ok(f"with no tempo the middle is the take's own ({found.get('middle', 0):.1f})",
       found.get("ok") and abs(found["middle"] - np.median(palyn.truth)) < 1.5)
    close(found, palyn, found.get("middle", 1), "Palyn-like, no tempo")

    waltz = Take(folder, "waltz", song((4, 96), (24, 96), (8, 101), (16, 96)), per_bar=3, style="waltz")
    close(drift.count(drums=[waltz.drums], tempo=96, signature="3/4"), waltz, 96, "a waltz in 3/4 at 96")
    six = Take(folder, "six", song((4, 198), (16, 198), (8, 204), (8, 212), (8, 198)), per_bar=6, style="six8")
    found = drift.count(drums=[six.drums], tempo=198, signature="6/8")
    ok("6/8 counts six eighths a bar", found.get("per_bar") == 6)
    close(found, six, 198, "6/8 at 198 eighths, audio")
    close(drift.count(drums_mid=[six.mid], tempo=198, signature="6/8"), six, 198, "6/8 at 198 eighths, .mid", within=0.025)
    ballad = Take(folder, "ballad", song((4, 72), (16, 72), (8, 74), (8, 72), (6, 66)), style="ballad")
    close(drift.count(drums=[ballad.drums], tempo=72), ballad, 72, "a ballad at 72 with sixteenth hats")

    print("\n[2] No drift where there is none")
    steady = Take(folder, "steady", np.full(60, 128.0))
    found = drift.count(drums=[steady.drums], tempo=128)
    ok("a steady take has no stretch", found.get("ok") and not runs([b["tempo"] for b in found["bars"]], 128))
    wander = Take(folder, "wander", 128 * (1 + np.cumsum(rng.normal(0, 0.002, 60)).clip(-0.012, 0.012)))
    found = drift.count(drums=[wander.drums], tempo=128)
    ok("one wandering by 1.2% has none either", found.get("ok") and not runs([b["tempo"] for b in found["bars"]], 128))

    print("\n[3] Where bar 1 is, and where the line breaks")
    # Two bars of the click's count-in, which is not in the files: the band
    # comes in on the grid's third bar.
    count_in = 2 * 4 * 60 / 128
    clicked = Take(folder, "clicked", song((28, 128), (10, 124), (20, 128)), start=count_in)
    found = drift.count(drums=[clicked.drums], tempo=128, click=True)
    ok(f"on a click take bar 1 starts where the band came in, past a two-bar count-in "
       f"({(found.get('bars') or [{}])[0].get('start', 0):.2f} s, {count_in:.2f})",
       found.get("ok") and abs(found["bars"][0]["start"] - count_in) < 0.03)
    close(found, clicked, 128, "a click take that drags 4 for 10 bars")
    late = Take(folder, "late", np.full(40, 128.0), drums_from=8)
    found = drift.count(drums=[late.drums], tempo=128)
    came = late.t[8 * 4]
    ok(f"drums coming in after eight bars of guitar: bar 1 is where they start "
       f"({(found.get('bars') or [{}])[0].get('start', 0):.2f} s, {came:.2f})",
       found.get("ok") and abs(found["bars"][0]["start"] - came) < 0.03)
    stopped = Take(folder, "stopped", np.full(40, 128.0), stop=(20, 22))
    found = drift.count(drums=[stopped.drums], tempo=128)
    gap = [b["tempo"] for b in found.get("bars", []) if stopped.t[80] - 0.1 <= b["start"] < stopped.t[88] - 0.1]
    ok(f"a two-bar stop has no tempo, so the line breaks there ({gap})", len(gap) == 2 and gap == [None, None])

    print("\n[4] The sources")
    kick = [h for h in palyn.played if h[1] == "k"]
    rest = [h for h in palyn.played if h[1] != "k"]
    seconds = palyn.t[-1] + 2
    split = [str(write_wav(folder / "kick.wav", loud(drums(kick, seconds)))),
             str(write_wav(folder / "over.wav", loud(drums(rest, seconds))))]
    found = drift.count(drums=split, tempo=128)
    close(found, palyn, 128, "a kick mic and overheads, summed")
    silent = str(write_wav(folder / "silent.wav", np.zeros(int(seconds * SR))))
    found = drift.count(drums=[silent], mix=[silent, palyn.band, palyn.drums], tempo=128)
    ok("silent drums give the counting to the mix", found.get("source") == "mix")
    ok("a take under 4 bars is too short",
       drift.count(drums=[write_wav(folder / "short.wav", loud(drums(hits(beat_times(np.full(3, 128.0), 4), 4, "rock"), 6.0)))],
                   tempo=128) == {"ok": False, "why": "short"})
    # A false start: two bars of count-in and three played, then "again".
    false_start = write_wav(folder / "false-start.wav",
                            loud(drums(hits(beat_times(np.full(3, 128.0), 4, start=3.75), 4, "rock"), 9.4)))
    ok("a false start after a count-in is too short too",
       drift.count(drums=[false_start], mix=[false_start], tempo=128, click=True) == {"ok": False, "why": "short"})
    tt = np.arange(30 * SR) / SR
    chord = sum(np.sin(2 * np.pi * f * tt) for f in (110, 138.6, 164.8, 220)) * np.exp(-tt / 20) * 0.2
    held = str(write_wav(folder / "chord.wav", loud(chord + 0.01 * rng.standard_normal(len(tt)))))
    ok("a held chord has no steady beat", drift.count(mix=[held], tempo=128) == {"ok": False, "why": "no-beat"})
    ok("nor does it without a tempo", drift.count(mix=[held]) == {"ok": False, "why": "no-beat"})

    print("\n[5] Stopping")
    asked = []

    def stop_soon():
        asked.append(1)
        return len(asked) > 3
    try:
        drift.count(drums=[palyn.drums], tempo=128, stop=stop_soon)
        stopped = False
    except tempo.Cancelled:
        stopped = True
    ok("a count stops when it is told to", stopped)

    print("\n[6] Api.take_drift: the aim, the sources by icon, the memory")
    api_folder = Path(tempfile.mkdtemp())
    apimod, api = fresh_api(api_folder)
    api._config["tracks"] = [{"name": "Drums", "channel": 1, "icon": "drums"},
                             {"name": "Bass", "channel": 2, "icon": "bass"},
                             {"name": "Minus", "channel": 3, "icon": "backing"}]
    api._lib.song_tempos = lambda: {"Pałyn": (128, "4/4"), "Ahoń": (None, None)}
    # The take's own icons find the sources; the band's above find none (lineups spec, Part 3).
    kit = [{"name": "Drums", "file": palyn.drums, "icon": "drums"}, {"name": "Bass", "file": palyn.band, "icon": "bass"}]
    notes = [{"name": "Drums", "file": palyn.mid, "icon": "drums"}]
    found = api.take_drift(kit, notes, {"tempo": 128, "signature": "4/4", "click": True, "song": "Pałyn"})
    ok("a click take aims at its click", found.get("aim") == {"tempo": 128, "signature": "4/4", "from": "click", "song": None})
    ok("the drums' .mid is found by the drums icon", found.get("source") == "drums-mid")
    ok("the answer has the bars and their middle", len(found.get("bars", [])) > 70 and found.get("per_bar") == 4
       and set(found) == {"ok", "source", "per_bar", "middle", "aim", "bars"})
    found = api.take_drift(kit, [], {"tempo": 128, "signature": "4/4", "click": False, "song": "Pałyn"})
    ok("a take with a tempo and no click aims at that tempo", found.get("aim", {}).get("from") == "take")
    ok("with no .mid the drums' WAV is the source", found.get("source") == "drums")
    found = api.take_drift(kit, [], {"tempo": None, "signature": None, "click": False, "song": "pałyn"})
    ok("an older take of a song with a tempo aims at the song's, named as the song is",
       found.get("aim") == {"tempo": 128, "signature": "4/4", "from": "song", "song": "Pałyn"})
    found = api.take_drift(kit, [], {"tempo": None, "signature": None, "click": False, "song": "Ahoń"})
    ok(f"a song with no tempo aims at the take's middle, in 4/4 ({found.get('aim')})",
       found.get("aim", {}).get("from") == "middle" and found["aim"]["signature"] == "4/4"
       and found["aim"]["tempo"] == round(found["middle"]))
    found = api.take_drift([{"name": "Guitar", "file": palyn.drums}], [], {})
    ok("a take with no drums icon is counted from the mix", found.get("source") == "mix")
    found = api.take_drift([{"name": "Drums", "file": palyn.drums}], [{"name": "Drums", "file": palyn.mid}], {})
    ok("and so is one whose Drums the band gives the icon and the take does not", found.get("source") == "mix")
    minus = str(write_wav(folder / "minus.wav", loud(np.sin(2 * np.pi * 220 * np.arange(int(20 * SR)) / SR))))
    seen = []
    real = drift.count
    drift.count = lambda **kw: seen.append(kw["mix"]) or {"ok": False, "why": "no-beat"}
    try:
        api.take_drift([{"name": "Bass", "file": palyn.band}, {"name": "Minus", "file": minus, "icon": "backing"}], [], {})
    finally:
        drift.count = real
    ok("a backing track is left out of the mix", seen == [[palyn.band]])
    ok("a file not on disk is missing",
       api.take_drift([{"name": "Drums", "file": str(folder / "gone.wav")}], [], {}) == {"ok": False, "why": "missing"})
    ok("a take with no files is missing", api.take_drift([], [], {}) == {"ok": False, "why": "missing"})

    meter = {"tempo": 128, "signature": "4/4", "click": False}
    first = api.take_drift(kit, [], meter)
    ok("the same take again is the same answer, not counted again", api.take_drift(kit, [], meter) is first)
    stamp = Path(palyn.band).stat().st_mtime_ns
    os.utime(palyn.band, ns=(stamp + 10 ** 9, stamp + 10 ** 9))
    ok("a file rewritten since is counted afresh", api.take_drift(kit, [], meter) is not first)
    counted = []
    drift.count = lambda **kw: counted.append(1) or {"ok": False, "why": "no-beat"}
    try:
        for t in range(apimod.DRIFTS_KEPT + 1):
            api.take_drift(kit, [], {"tempo": 200 + t, "signature": "4/4"})
        api.take_drift(kit, [], {"tempo": 200, "signature": "4/4"})
    finally:
        drift.count = real
    ok(f"{apimod.DRIFTS_KEPT} answers are kept: the oldest is counted again after one more",
       len(counted) == apimod.DRIFTS_KEPT + 2)
    counted, both = [], []
    drift.count = lambda **kw: counted.append(1) or time.sleep(0.3) or {"ok": False, "why": "no-beat"}
    try:
        asks = [threading.Thread(target=lambda: both.append(api.take_drift(kit, [], {"tempo": 97, "signature": "4/4"})))
                for _ in range(2)]
        for a in asks:
            a.start()
        for a in asks:
            a.join(5)
    finally:
        drift.count = real
    ok("two asks for one take at once count it once, and both get the answer",
       counted == [1] and both == [{"ok": False, "why": "no-beat"}] * 2)

    print("\n[7] Record stops a count, and the tolerance")
    entered, results = threading.Event(), []

    def waits(**kw):
        entered.set()
        give_up = time.monotonic() + 5
        while time.monotonic() < give_up:
            if kw["stop"]():
                raise tempo.Cancelled()
            time.sleep(0.01)
        return {"ok": False, "why": "no-beat"}
    drift.count = waits
    try:
        ok("a rehearsal starts", api.start_rehearsal("Drift", 0, 48000, [{"name": "Guitar", "channel": 1}])["ok"])
        worker = threading.Thread(target=lambda: results.append(api.take_drift(kit, [], {"tempo": 99, "signature": "4/4"})))
        worker.start()
        ok("the count has begun", entered.wait(5))
        ok("Record starts a take", api.start_take()["ok"])
        worker.join(5)
    finally:
        drift.count = real
    ok("Record stops a count in progress, which says so", results == [{"ok": False, "why": "recording"}])
    ok("and none is counted while a take records",
       api.take_drift(kit, [], meter) == {"ok": False, "why": "recording"})
    api.stop_take()
    give_up = time.monotonic() + 10
    while api._stopping and time.monotonic() < give_up:
        time.sleep(0.05)

    class Refused:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            raise RuntimeError("The interface is gone")
    released, results = threading.Event(), []
    entered.clear()

    def holds(**kw):
        entered.set()
        while not released.wait(0.01):
            if kw["stop"]():
                raise tempo.Cancelled()
        return {"ok": False, "why": "no-beat"}
    recorder, apimod.AudioRecorder, drift.count = apimod.AudioRecorder, Refused, holds
    try:
        worker = threading.Thread(target=lambda: results.append(api.take_drift(kit, [], {"tempo": 98, "signature": "4/4"})))
        worker.start()
        ok("another count has begun", entered.wait(5))
        ok("a Record that cannot start says why", api.start_take().get("error") == "The interface is gone")
        # Long enough for the count to see a stop, were it told to.
        time.sleep(0.2)
        released.set()
        worker.join(5)
    finally:
        apimod.AudioRecorder, drift.count = recorder, real
    ok("and leaves the count to finish", results == [{"ok": False, "why": "no-beat"}])

    ok("the tolerance is 2% until it is changed", api.get_settings()["drift_tolerance"] == 0.02)
    ok("3% is kept", api.set_metronome_setting("drift_tolerance", 0.03)["ok"]
       and api.get_settings()["drift_tolerance"] == 0.03)
    ok("4% is refused, and 3% stays", not api.set_metronome_setting("drift_tolerance", 0.04)["ok"]
       and api.get_settings()["drift_tolerance"] == 0.03)

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("Where the band drifted: every check passes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
