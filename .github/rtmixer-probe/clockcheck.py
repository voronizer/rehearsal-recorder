"""Notes' clock with the take recorded through rtmixer, against today's.

A, today: a sounddevice callback marks AudioClock with the driver's age.
B, new: a thread watches an rtmixer record ring every 2 ms and marks a block
when it sees it arrive (midpoint of the two polls), its age learned in the
first second from the record action's ADC time (actual_time).

usage: clockcheck.py SECS DEVICE-SUBSTRING HOSTAPI MODE   (MODE: both | a | b)
both: A and B at once on one device (CoreAudio, JACK); then B's line is checked
against A's at A's block starts, which are block starts of B's too.
a or b alone (ASIO allows one stream a process): their ages and jitter."""
import sys, threading, time, json
sys.path.insert(0, sys.argv[5] if len(sys.argv) > 5 else "src")
import numpy as np, sounddevice as sd, rtmixer
from rehearsal_recorder.midi.clock import AudioClock
from rehearsal_recorder.audio.capture import _block_age

RATE, BLOCK, POLL = 48000, 1024, 0.002
LIMIT = int(1.5 * POLL * 1e9) + 1_000_000
SECS, NAME, API, MODE = float(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
apis = [h["name"] for h in sd.query_hostapis()]
dev = [i for i, d in enumerate(sd.query_devices())
       if NAME.lower() in d["name"].lower() and API.lower() in apis[d["hostapi"]].lower() and d["max_input_channels"] > 0][0]
out = {"device": sd.query_devices(dev)["name"], "api": API, "mode": MODE}

a = AudioClock(RATE); a_raw = []; a_frames = [0]; a_cur = []
def cb(indata, frames, ti, status):
    now = time.perf_counter_ns(); a_frames[0] += frames
    age = _block_age(ti); a.mark(now, a_frames[0], frames, age); a_raw.append((now, a_frames[0], frames, age))
    try: a_cur.append((now, ti.currentTime))
    except Exception: pass
s = None
if MODE in ("both", "a"):
    s = sd.InputStream(device=dev, channels=1, samplerate=RATE, blocksize=BLOCK, latency="low", callback=cb)
    s.start(); a.latency_sec = s.latency; out["a_latency_ms"] = round(s.latency * 1000, 2)

b = AudioClock(RATE); b_raw = []; gaps = []; offs = []; learned = [None]; early = []
stop = threading.Event()
if MODE in ("both", "b"):
    m = rtmixer.Recorder(device=dev, channels=1, samplerate=RATE, blocksize=BLOCK, latency="low")
    m.start(); out["b_latency_ms"] = round(m.latency * 1000, 2)
    rec = rtmixer.RingBuffer(elementsize=4, size=2 ** 17); buf = np.zeros(2 ** 17, dtype=np.float32)
    def watch():
        total = 0; last = time.perf_counter_ns()
        while not stop.is_set():
            now = time.perf_counter_ns(); have = rec.read_available
            if have:
                k = rec.readinto(buf[:have]); total += k; gap = now - last; gaps.append(gap / 1e6)
                t1 = time.perf_counter_ns(); st = m.time; t2 = time.perf_counter_ns()
                offs.append(t1 - int(st * 1e9))     # the stream's clock may count coarsely: its lowest is the truest
                if gap < LIMIT:
                    mid = (now + last) // 2
                    if learned[0] is None:
                        r0 = ra.actual_time
                        if r0 > 0 and len(offs) >= 20:
                            cap = min(offs) + int((r0 + (total - k) / RATE) * 1e9)
                            early.append((mid - cap) / 1e9)
                            if len(early) >= 40: learned[0] = float(np.median(early))
                    if learned[0] is not None:
                        b.mark(mid, total, k, learned[0]); b_raw.append((mid, total, k))
            last = now; time.sleep(POLL)
    ra = m.record_ringbuffer(rec)
    t = threading.Thread(target=watch, daemon=True); t.start()
# A's stream clock against perf, from this thread: for A's dispatch delay
a_offs = []
t_end = time.perf_counter() + SECS
while time.perf_counter() < t_end:
    if s is not None:
        t1 = time.perf_counter_ns(); st = s.time; a_offs.append(t1 - int(st * 1e9))
    time.sleep(0.01)
stop.set()
if MODE in ("both", "b"):
    t.join(); m.cancel(ra); time.sleep(0.1); m.stop(); m.close()
if s is not None: s.stop(); s.close()

def pct(v, qs=(50, 99)): return [round(float(np.percentile(v, q)), 2) for q in qs]
if a_raw:
    ages = [r[3] for r in a_raw if r[3] is not None]
    out["a_age_given"] = f"{len(ages)}/{len(a_raw)}"
    if ages: out["a_age_ms_p1_p50_p99"] = [round(float(np.percentile(ages, q)) * 1000, 2) for q in (1, 50, 99)]
    if a_cur and a_offs:
        # how late the callback ran after the driver's own time for its block
        off = min(a_offs); d = [(n - (off + int(c * 1e9))) / 1e6 for n, c in a_cur[20:] if c]
        if d: out["a_dispatch_ms_p1_p50_p99"] = [round(float(np.percentile(d, q)), 2) for q in (1, 50, 99)]
        out["a_stream_clock_step_ms"] = round(float(np.percentile(np.diff(sorted(set(a_offs))), 50)) / 1e6, 3) if len(set(a_offs)) > 2 else None
if b_raw:
    out["b_learned_age_ms"] = round(learned[0] * 1000, 2)
    out["b_marked_of_seen"] = f"{len(b_raw)}/{len(gaps)}"
    out["b_poll_gap_ms_p50_p99"] = pct(gaps)
    res = [(r[0] - int(learned[0] * 1e9) - b.ns_at(r[1] - r[2])) / 1e6 for r in b_raw]
    out["b_jitter_ms_p50_p99"] = pct(np.abs(res))
    out["b_offset_spread_ms"] = round((np.percentile(offs, 50) - min(offs)) / 1e6, 3)
if MODE == "both" and a_raw and b_raw:
    errs = []
    for ns, f in a.marks()[2:]:
        fb = b.frame_at(ns)
        if fb is not None: errs.append((((fb + BLOCK / 2) % BLOCK) - BLOCK / 2) / RATE * 1000)
    out["b_minus_a_ms_min_median_max"] = [round(float(min(errs)), 2), round(float(np.median(errs)), 2), round(float(max(errs)), 2)]
print(json.dumps(out))
