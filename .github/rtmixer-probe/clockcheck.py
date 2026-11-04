"""Notes' clock with the take recorded through rtmixer, against today's.

A, today: a sounddevice callback marks AudioClock with the driver's age.
B, new: a thread reads an rtmixer record ring every few ms; a read that finds
new frames says they arrived between it and the read before (the midpoint).
Their age is learned in the first second from the record action's ADC time
(actual_time), and one mark a second is the mean of that second's reads, so
a coarse sleep (10 ms on GitHub's Mac) costs no precision.

usage: clockcheck.py SECS DEVICE-SUBSTRING HOSTAPI MODE [src] [poll]   (MODE: both | a | b)
both: A and B at once on one device (CoreAudio, JACK); then B's line is checked
against A's at A's block starts, which are block starts of B's too.
a or b alone (ASIO allows one stream a process): their ages and jitter."""
import sys, threading, time, json
sys.path.insert(0, sys.argv[5] if len(sys.argv) > 5 else "src")
import rehearsal_recorder  # noqa: F401  (ASIO on before sounddevice loads)
import numpy as np, sounddevice as sd, rtmixer
from rehearsal_recorder.midi.clock import AudioClock
from rehearsal_recorder.audio.capture import _block_age

RATE, BLOCK = 48000, 1024
POLL = float(sys.argv[6]) if len(sys.argv) > 6 else 0.002
AGE = sys.argv[7] if len(sys.argv) > 7 else "learn"   # learn | latency
SECS, NAME, API, MODE = float(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
apis = [h["name"] for h in sd.query_hostapis()]
dev = [i for i, d in enumerate(sd.query_devices())
       if NAME.lower() in d["name"].lower() and API.lower() in apis[d["hostapi"]].lower() and d["max_input_channels"] > 0][0]
out = {"device": sd.query_devices(dev)["name"], "api": API, "mode": MODE, "poll_s": POLL, "age": AGE}

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

b = AudioClock(RATE); b_raw = []; gaps = []; offs = []; learned = [None]; early = []; sec = []
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
                mid = (now + last) // 2; first = total - k
                if learned[0] is None and AGE == "latency":
                    learned[0] = float(m.latency)   # as the driver's own times say it on ASIO and Core Audio
                if learned[0] is None:
                    r0 = ra.actual_time
                    if r0 > 0 and len(offs) >= 20:
                        cap = min(offs) + int((r0 + first / RATE) * 1e9)
                        early.append((mid - cap) / 1e9)
                        if len(early) >= 40: learned[0] = float(np.median(early))
                else:
                    sec.append((mid - int(learned[0] * 1e9), first))
                    if first - sec[0][1] >= RATE:
                        mark = (round(sum(x[0] for x in sec) / len(sec)), round(sum(x[1] for x in sec) / len(sec)))
                        b._keep(mark); b_raw.append((mark, len(sec), [x for x in sec]))
                        sec.clear()
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
    out["b_marks_reads_per_mark"] = [len(b_raw), round(float(np.median([r[1] for r in b_raw])))]
    out["b_poll_gap_ms_p50_p99"] = pct(gaps)
    res = [(ns - b.ns_at(f)) / 1e6 for r in b_raw for ns, f in r[2]]
    out["b_read_jitter_ms_p50_p99"] = pct(np.abs(res))
    res = [(r[0][0] - b.ns_at(r[0][1])) / 1e6 for r in b_raw]
    out["b_mark_jitter_ms_p50_p99"] = pct(np.abs(res))
    out["b_offset_spread_ms"] = round((np.percentile(offs, 50) - min(offs)) / 1e6, 3)
if MODE == "both" and a_raw and b_raw:
    errs = []
    for ns, f in a.marks()[2:]:
        fb = b.frame_at(ns)
        if fb is not None: errs.append((((fb + BLOCK / 2) % BLOCK) - BLOCK / 2) / RATE * 1000)
    out["b_minus_a_ms_min_median_max"] = [round(float(min(errs)), 2), round(float(np.median(errs)), 2), round(float(max(errs)), 2)]
print(json.dumps(out))
