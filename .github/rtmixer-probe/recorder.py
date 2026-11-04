"""Records one channel of a loopback input to a WAV file, in its own process
so the load beside the playback never touches it. Prints one line once the
stream runs, and one at the end."""

import argparse
import queue
import sys

import sounddevice as sd
import soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("--device", required=True)
ap.add_argument("--api", default="")
ap.add_argument("--secs", type=float, required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args()

index = None
for i, d in enumerate(sd.query_devices()):
    host = sd.query_hostapis(d["hostapi"])["name"]
    if d["max_input_channels"] > 0 and a.device.lower() in d["name"].lower() and (not a.api or host.startswith(a.api)):
        index, name = i, f"{d['name']} ({host})"
        break
if index is None:
    print(f"no input like {a.device!r}", flush=True)
    sys.exit(1)

q = queue.Queue()
over = [0]


def cb(indata, frames, t, status):
    if status.input_overflow:
        over[0] += 1
    q.put(indata[:, 0].copy())


total = int(a.secs * 48000)
got = 0
with sf.SoundFile(a.out, "w", samplerate=48000, channels=1, subtype="FLOAT") as f:
    with sd.InputStream(device=index, channels=1, samplerate=48000, dtype="float32",
                        latency="high", callback=cb):
        print(f"recording {name}", flush=True)
        while got < total:
            x = q.get()
            f.write(x)
            got += len(x)
print(f"recorded {got / 48000:.1f} s, input overflows {over[0]}", flush=True)
