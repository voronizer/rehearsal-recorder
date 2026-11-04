"""Where a click written to the output comes back in the input, on a duplex
stream looped back (a cable, or JACK): today's way (sounddevice callback, the
click of input frame s written at output frame s - round trip, from the
driver's times) against rtmixer's (a play ring and a record ring started at the
same requested time; the shift from their actual times). Prints each one's
miss: landed - predicted, in frames. Equal misses: the new way puts the click
where today's does.

usage: landing.py MODE DEVICE-SUBSTRING HOSTAPI [src]   (MODE: today | rtmixer)"""
import sys, time, json
sys.path.insert(0, sys.argv[4] if len(sys.argv) > 4 else "src")
import numpy as np, sounddevice as sd, rtmixer
from rehearsal_recorder.audio.click_timing import round_trip_frames

RATE, BLOCK = 48000, 1024
MODE, NAME, API = sys.argv[1], sys.argv[2], sys.argv[3]
apis = [h["name"] for h in sd.query_hostapis()]
dev = [i for i, d in enumerate(sd.query_devices())
       if NAME.lower() in d["name"].lower() and API.lower() in apis[d["hostapi"]].lower()
       and d["max_input_channels"] > 0 and d["max_output_channels"] > 0][0]
CLICKS = [RATE * 2 + 333 + k * 12007 for k in range(8)]   # output frames, off the block grid

def landed(rec):
    hits = np.flatnonzero(np.abs(rec) > 0.3)
    out, last = [], -10 ** 9
    for h in hits:
        if h - last > 4000: out.append(int(h))
        last = h
    return out

if MODE == "today":
    rec = np.zeros(RATE * 7, dtype=np.float32); pos = [0]; rt = []
    def cb(indata, outdata, frames, ti, status):
        outdata.fill(0); p = pos[0]
        r = round_trip_frames(ti, None, RATE)
        if r is not None: rt.append(r)
        for c in CLICKS:
            if p <= c < p + frames: outdata[c - p, 0] = 0.9
        n = min(frames, len(rec) - p)
        if n > 0: rec[p:p + n] = indata[:n, 0]
        pos[0] += frames
    with sd.Stream(device=(dev, dev), channels=1, samplerate=RATE, blocksize=BLOCK, latency="low", callback=cb) as st:
        lat = st.latency; time.sleep(6.8)
    shift = int(np.median(rt)) if rt else round((lat[0] + lat[1]) * RATE)
    got = landed(rec)
    print(json.dumps({"mode": MODE, "device": sd.query_devices(dev)["name"], "round_trip_frames": sorted(set(rt))[:5],
                      "latency_ms": [round(x * 1000, 2) for x in lat],
                      "landed_minus_predicted": [g - (c + shift) for g, c in zip(got, CLICKS)]}))
else:
    m = rtmixer.MixerAndRecorder(device=dev, channels=1, samplerate=RATE, blocksize=BLOCK, latency="low")
    m.start()
    out = np.zeros(RATE * 7, dtype=np.float32)
    for c in CLICKS: out[c] = 0.9
    rec = np.zeros(RATE * 7, dtype=np.float32)
    play = rtmixer.RingBuffer(elementsize=4, size=2 ** 19); play.write(out)
    ring = rtmixer.RingBuffer(elementsize=4, size=2 ** 19)
    time.sleep(1.0)
    at = m.time + 0.3
    pa = m.play_ringbuffer(play, start=at, allow_belated=False)
    ra = m.record_ringbuffer(ring, start=at, allow_belated=False)
    time.sleep(6.8)
    n = ring.readinto(rec)
    m.cancel(pa); m.cancel(ra); time.sleep(0.2); m.stop()
    P0, R0 = pa.actual_time, ra.actual_time
    shift = round((P0 - R0) * RATE)
    got = landed(rec[:n])
    print(json.dumps({"mode": MODE, "device": sd.query_devices(dev)["name"], "requested": round(at, 4), "P0": round(P0, 4), "R0": round(R0, 4),
                      "shift_frames": shift, "latency_ms": [round(x * 1000, 2) for x in m.latency],
                      "landed_minus_predicted": [g - (c + shift) for g, c in zip(got, CLICKS)]}))
    m.close()
