"""
Recording under load, the other half of the probe: a separate process plays
a steady tone into a loopback device; this one records it the way the app
records a take now ("now": AudioRecorder, the card's call answered in
Python) and through rtmixer ("rt": the card's call answered in C into a
ring, which a Python thread empties to disk), each under the same load.
analyse.py then reads the files for gaps and slips.

    python rec_probe.py --in-device FlexASIO --in-api ASIO \
        --tone-device "CABLE Input" --tone-api MME --label asio1024 --results rec.jsonl
"""

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import rehearsal_recorder  # noqa: F401  (ASIO on before sounddevice loads)

import numpy as np
import sounddevice as sd
import soundfile as sf

from rehearsal_recorder.audio.capture import AudioRecorder
from rehearsal_recorder.audio.devices import close_stream, input_latency, open_stream

import analyse
from probe import find, start_load

HERE = Path(__file__).resolve().parent
RATE = 48000


def record_now(index, secs, folder):
    rec = AudioRecorder(index, RATE, [{"name": "T", "channel": 1, "stereo": False}], folder, bit_depth=24)
    rec.start()
    time.sleep(secs)
    status = rec.last_status
    result = rec.stop()
    return Path(result["tracks"][0]["file"]), {"last_status": status}


def record_rt(index, secs, folder):
    import rtmixer
    wav = folder / "T.wav"
    ring = rtmixer.RingBuffer(elementsize=4, size=2 ** 17)  # 2.7 s
    recorder = open_stream(rtmixer.Recorder, device=index, channels=1, samplerate=RATE,
                           latency=input_latency(sd, index))
    fullest = [0]
    lost = [0]
    stop = threading.Event()
    buf = np.zeros(2 ** 17, dtype=np.float32)

    def drain(f):
        while True:
            have = ring.read_available
            fullest[0] = max(fullest[0], have)
            if have:
                n = ring.readinto(buf[:have])
                f.write(buf[:n])
            elif stop.is_set():
                return
            time.sleep(0.02)

    with sf.SoundFile(wav, "w", samplerate=RATE, channels=1, subtype="PCM_24") as f:
        try:
            action = recorder.record_ringbuffer(ring)
            t = threading.Thread(target=drain, args=(f,), daemon=True)
            t.start()
            end = time.perf_counter() + secs
            while time.perf_counter() < end:
                time.sleep(0.1)
                if action not in recorder.actions:
                    lost[0] += 1  # the ring overflowed and rtmixer dropped it
                    action = recorder.record_ringbuffer(ring)
            recorder.cancel(action)
            time.sleep(0.2)
            stop.set()
            t.join()
        finally:
            close_stream(recorder)
    return wav, {"ring_fullest_ms": round(fullest[0] / RATE * 1000), "ring_overflowed": lost[0],
                 "card_overflows": int(recorder.stats.input_overflows)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-device", required=True)
    ap.add_argument("--in-api", default="")
    ap.add_argument("--tone-device", required=True)
    ap.add_argument("--tone-api", default="")
    ap.add_argument("--label", required=True)
    ap.add_argument("--secs", type=int, default=30)
    ap.add_argument("--cases", default="now:heavy,rt:heavy,now:applike,rt:applike")
    ap.add_argument("--results", required=True)
    a = ap.parse_args()
    sys.setswitchinterval(0.001)
    index, name = find(a.in_device, a.in_api, "input")
    print(f"input: {name}", flush=True)
    for spec in a.cases.split(","):
        engine, load = spec.split(":")
        folder = HERE / f"rec_{a.label}_{engine}_{load}"
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir()
        tone = subprocess.Popen([sys.executable, str(HERE / "tone.py"), "--device", a.tone_device,
                                 "--api", a.tone_api, "--secs", str(a.secs + 8)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        said = tone.stdout.readline().strip()
        time.sleep(1.0)
        stop = threading.Event()
        holds = start_load(load, stop)
        time.sleep(0.5)
        try:
            wav, info = (record_now if engine == "now" else record_rt)(index, a.secs, folder)
            info.update(analyse.judge(wav))
        except Exception as e:
            info = {"error": f"{type(e).__name__}: {e}"}
        stop.set()
        tone.kill()
        row = {"label": a.label, "platform": sys.platform, "input": name, "engine": engine,
               "load": load, "recording": True, "tone": said,
               "hold_ms_median": round(sorted(holds)[len(holds) // 2]) if holds else None, **info}
        print(json.dumps(row), flush=True)
        with open(a.results, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        time.sleep(1.0)


if __name__ == "__main__":
    main()
