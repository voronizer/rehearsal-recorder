"""
A probe for the skips fix, not part of the app: plays one take through a real
sound card's driver the way the app plays now ("now") and through rtmixer
with a reserve the mixing keeps ahead ("rt"), each under the same load in
this process, while a separate process records what came out of a loopback
device. The recording is the judge: analyse.py counts gaps and slips in it.

Track T0 is a steady 997 Hz tone, the one the recording is read by. Track T1
is a 1499 Hz tone whose M is pressed and released every half second, so the
rt engine re-mixes its reserve all through (way 1); the tone at 997 Hz must
go on without a break or a jump in its phase.

    python probe.py --out-device FlexASIO --out-api ASIO \
        --loop-device "CABLE Output" --label asio1024 --results results.jsonl
"""

import argparse
import json
import os
import random
import subprocess
import sys
import threading
import time
from pathlib import Path

import rehearsal_recorder  # noqa: F401  (ASIO on before sounddevice loads)

import numpy as np
import sounddevice as sd
import soundfile as sf

from rehearsal_recorder.audio.devices import close_stream, open_stream, output_latency
from rehearsal_recorder.audio.player import TakePlayer

import analyse

HERE = Path(__file__).resolve().parent
RATE = 48000
BLOCK = 1024


def make_tracks(folder, secs):
    folder.mkdir(parents=True, exist_ok=True)
    n = RATE * secs
    t = np.arange(n) / RATE
    paths = []
    for i in range(5):
        p = folder / f"T{i}.wav"
        if not p.exists():
            if i == 0:
                x = 0.5 * np.sin(2 * np.pi * analyse.TONE * t)
            elif i == 1:
                x = 0.25 * np.sin(2 * np.pi * analyse.OTHER * t)
            else:
                x = np.zeros(n)
            sf.write(p, x, RATE, subtype="PCM_24")
        paths.append(p)
    return [{"name": f"T{i}", "file": str(p)} for i, p in enumerate(paths)]


def find(part, api, kind):
    key = "max_output_channels" if kind == "output" else "max_input_channels"
    for i, d in enumerate(sd.query_devices()):
        host = sd.query_hostapis(d["hostapi"])["name"]
        if d[key] > 0 and part.lower() in d["name"].lower() and (not api or host.startswith(api)):
            return i, f"{d['name']} ({host})"
    raise SystemExit(f"no {kind} like {part!r} on {api!r}")


# ---------------- loads, in this process ----------------

def calibrate_sort(target_ms):
    n = 50000
    while True:
        data = [random.random() for _ in range(n)]
        t = time.perf_counter()
        sorted(data)
        took = (time.perf_counter() - t) * 1000
        if took >= target_ms:
            return n
        n = int(n * max(1.2, target_ms / max(took, 0.1)))


def start_load(kind, stop):
    """heavy: Python always busy and held ~150 ms once a second;
    applike: held ~60 ms once a second and five short polls a second."""
    holds = []
    n = calibrate_sort(150 if kind == "heavy" else 60)
    data = [random.random() for _ in range(n)]

    def busy():
        while not stop.is_set():
            sum(i * i for i in range(2000))

    def holder():
        while not stop.is_set():
            time.sleep(1.0)
            t = time.perf_counter()
            sorted(data)  # sorting a list never lets go of Python's lock
            holds.append((time.perf_counter() - t) * 1000)

    def poller():
        while not stop.is_set():
            time.sleep(0.2)
            sum(i * i for i in range(20000))

    for f in ((busy, holder) if kind == "heavy" else (holder, poller)):
        threading.Thread(target=f, daemon=True).start()
    return holds


# ---------------- the rt engine (way 1, as tested on JACK) ----------------

class Engine:
    """One worker thread mixes for the ring: it tops the reserve up first
    when it runs low, re-mixes what the card has not reached after a change
    (a newer change starts the re-mix again), and otherwise keeps the
    reserve full. If the ring runs dry, rtmixer drops it; the worker starts
    a new one from where the mixing got to, and counts it."""

    def __init__(self, player, mixer, reserve, block=BLOCK):
        import rtmixer
        self.rtmixer = rtmixer
        self.block = block
        self.player = player
        self.mixer = mixer
        size = block
        while size < int(reserve * RATE * 1.5):
            size *= 2
        self.size = size
        self.floats = np.zeros((block, 2), dtype=np.float32)
        self.target = int(reserve * RATE)
        self.low = int(reserve * 0.6 * RATE)
        # Where the card may be reading inside its current call is not
        # known, only that it is less than the stream's latency ahead.
        self.unsafe = int(mixer.latency * RATE) + 256
        self.guard = self.unsafe + block
        self.asked = None
        self.lock = threading.Lock()
        self.leads = []
        self.ran_dry = 0
        self.lowest = self.target
        self.skipped_blocks = 0
        self.stop = threading.Event()
        self._new_ring(None)

    def _new_ring(self, state):
        rt = self.rtmixer
        self.ring = rt.RingBuffer(elementsize=8, size=self.size)
        ptr = self.ring._ptr
        self.data = np.frombuffer(rt._ffi.buffer(ptr.buffer, self.size * 8),
                                  dtype=np.float32).reshape(self.size, 2)
        self.written = 0
        self.states = {}
        self.end_state = state
        self.cursor = None
        self.action = None

    def card_at(self):
        return self.written - self.ring.read_available

    def _state(self):
        p = self.player
        return (p._pos, [t.current_gain for t in p.tracks], p._master_gain,
                p._click_until, p._playing, p._finished)

    def _restore(self, s):
        p = self.player
        p._pos, gains, p._master_gain, p._click_until, p._playing, p._finished = s
        for t, g in zip(p.tracks, gains):
            t.current_gain = g

    def _mix_from(self, state):
        with self.player._lock:
            if state is not None:
                self._restore(state)
            mix = self.player._render(self.block)
            np.multiply(mix, 1.0 / 32768.0, out=self.floats, casting="unsafe")
            return self.floats, self._state()

    def _add(self):
        self.states[self.written] = self.end_state or self._state()
        block, self.end_state = self._mix_from(self.end_state)
        self.ring.write(block)
        self.written += self.block

    def _remix_one(self):
        at, state = self.cursor
        if at >= self.written:
            self.end_state = state
            self.cursor = None
            return
        self.states[at] = state
        block, state = self._mix_from(state)
        if at >= self.card_at() + self.unsafe:
            slot = at % self.size
            self.data[slot:slot + self.block] = block
            if self.first is None:
                self.first = at
                self.leads.append(at - self.card0)
        else:
            self.skipped_blocks += 1
        self.cursor = (at + self.block, state)

    def change(self, apply):
        with self.lock:
            apply()
            self.asked = self.card_at()

    def fill_first(self):
        while self.ring.read_available + self.block <= self.target:
            self._add()

    def run(self):
        self.action = self.mixer.play_ringbuffer(self.ring)
        while not self.stop.is_set():
            if self.action is not None and self.action not in self.mixer.actions:
                self.ran_dry += 1
                self._new_ring(self.end_state)
                while self.ring.read_available < self.low:
                    self._add()
                self.action = self.mixer.play_ringbuffer(self.ring)
                continue
            have = self.ring.read_available
            self.lowest = min(self.lowest, have)
            with self.lock:
                asked, self.asked = self.asked, None
            if asked is not None:
                at = -(-(self.card_at() + self.guard) // self.block) * self.block
                if at < self.written and at in self.states:
                    self.cursor = (at, self.states[at])
                    self.card0, self.first = asked, None
            if have < self.low and self.ring.write_available >= self.block:
                self._add()
            elif self.cursor is not None:
                self._remix_one()
            elif have + self.block <= self.target and self.ring.write_available >= self.block:
                self._add()
            else:
                card = self.card_at()
                for at in [a for a in self.states if a < card - self.block]:
                    del self.states[at]
                time.sleep(0.005)
        self.mixer.cancel(self.action)


# ---------------- one case ----------------

def toggles(apply, secs):
    t_end = time.perf_counter() + secs
    muted = False
    n = 0
    while time.perf_counter() < t_end:
        time.sleep(0.5)
        muted = not muted
        apply(muted)
        n += 1
    return n


def case(engine, load, tracks, out_index, loop, secs, reserve, wav):
    rec = subprocess.Popen([sys.executable, str(HERE / "recorder.py"), "--device", loop[0],
                            "--api", loop[1], "--secs", str(secs + 4), "--out", str(wav)],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    line = rec.stdout.readline().strip()  # "recording ..." once its stream runs
    stop = threading.Event()
    holds = start_load(load, stop)
    time.sleep(0.5)
    info = {}
    player = TakePlayer(tracks)
    if engine == "now":
        complaint = player.open_output(out_index, channels=(1, 2))
        if complaint:
            info["complaint"] = complaint
        time.sleep(0.3)
        player.play()
        info["changes"] = toggles(lambda m: player.set_muted("T1", m), secs)
        player.pause()
        heard, short, late, latest = player.skips()
        info.update(log_short=short, log_late=late, log_latest_ms=round(latest * 1000))
        player.close()
    else:
        import rtmixer
        mixer = open_stream(rtmixer.Mixer, device=out_index, channels=2, samplerate=RATE,
                            latency=output_latency(sd, out_index))
        try:
            player.play()
            eng = Engine(player, mixer, reserve, block=4096 if engine == "rt4k" else BLOCK)
            eng.fill_first()
            worker = threading.Thread(target=eng.run, daemon=True)
            worker.start()
            info["changes"] = toggles(lambda m: eng.change(lambda: player.set_muted("T1", m)), secs)
            eng.stop.set()
            worker.join()
            time.sleep(0.2)
        finally:
            close_stream(mixer)
        heard = sorted(round((l / RATE + mixer.latency) * 1000) for l in eng.leads)
        info.update(stream_latency_ms=round(mixer.latency * 1000), ran_dry=eng.ran_dry,
                    lowest_reserve_ms=round(eng.lowest / RATE * 1000),
                    remix_blocks_too_late=eng.skipped_blocks,
                    heard_after_ms_median_p90_max=[heard[len(heard) // 2], heard[int(len(heard) * 0.9)], heard[-1]] if heard else None,
                    card_underflows=int(mixer.stats.output_underflows))
    player.close()
    stop.set()
    tail, _ = rec.communicate(timeout=60)
    info["hold_ms_median"] = round(sorted(holds)[len(holds) // 2]) if holds else None
    info["recorder"] = (line + " | " + tail.strip())[-300:]
    info.update(analyse.judge(wav))
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-device", required=True)
    ap.add_argument("--out-api", default="")
    ap.add_argument("--loop-device", required=True)
    ap.add_argument("--loop-api", default="")
    ap.add_argument("--label", required=True)
    ap.add_argument("--secs", type=int, default=30)
    ap.add_argument("--reserve", type=float, default=1.0)
    ap.add_argument("--cases", default="now:heavy,rt:heavy,rt4k:heavy,now:applike,rt:applike")
    ap.add_argument("--results", required=True)
    a = ap.parse_args()
    sys.setswitchinterval(0.001)  # as the app does
    tracks = make_tracks(HERE / "tracks", a.secs + 30)
    out_index, out_name = find(a.out_device, a.out_api, "output")
    print(f"output: {out_name}, latency asked {output_latency(sd, out_index) * 1000:.0f} ms", flush=True)
    for spec in a.cases.split(","):
        engine, load = spec.split(":")
        wav = HERE / f"{a.label}_{engine}_{load}.wav"
        t = time.perf_counter()
        info = case(engine, load, tracks, out_index, (a.loop_device, a.loop_api), a.secs, a.reserve, wav)
        row = {"label": a.label, "platform": sys.platform, "output": out_name,
               "engine": engine, "load": load, "took_s": round(time.perf_counter() - t), **info}
        print(json.dumps(row), flush=True)
        with open(a.results, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        time.sleep(1.0)


if __name__ == "__main__":
    main()
