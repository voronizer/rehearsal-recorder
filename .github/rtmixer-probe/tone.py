"""Plays a steady 997 Hz tone into a device, in its own process, so nothing
loads it. Prints one line once it plays."""

import argparse
import time

import numpy as np
import sounddevice as sd

import analyse

ap = argparse.ArgumentParser()
ap.add_argument("--device", required=True)
ap.add_argument("--api", default="")
ap.add_argument("--secs", type=float, required=True)
a = ap.parse_args()

index = None
for i, d in enumerate(sd.query_devices()):
    host = sd.query_hostapis(d["hostapi"])["name"]
    if d["max_output_channels"] > 0 and a.device.lower() in d["name"].lower() and (not a.api or host.startswith(a.api)):
        index, name = i, f"{d['name']} ({host})"
        break
if index is None:
    raise SystemExit(f"no output like {a.device!r}")

pos = [0]
step = 2 * np.pi * analyse.TONE / 48000


def cb(outdata, frames, t, status):
    n = np.arange(pos[0], pos[0] + frames)
    outdata[:, 0] = 0.5 * np.sin(step * n)
    if outdata.shape[1] > 1:
        outdata[:, 1] = outdata[:, 0]
    pos[0] += frames


with sd.OutputStream(device=index, channels=2, samplerate=48000, dtype="float32",
                     latency="high", callback=cb):
    print(f"tone into {name}", flush=True)
    time.sleep(a.secs)
