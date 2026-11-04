"""Sound in a process of its own, with a take being recorded: the second
process opens one rtmixer stream that plays a ring it keeps 1 s ahead (a
steady 997 Hz tone) and records the
card's input into a ring a thread drains to a file. It publishes where the
card is and a level for that place (rising and falling every 2 s) through
shared memory; this process polls it
five times a second, as the screen does, under heavy load. A loopback (JACK
here, BlackHole on Mac, VB-CABLE on Windows) brings the output back to the
input, so one recording judges both ways.

    python proc_duplex.py out.wav 30 BlackHole "Core Audio"
"""
import multiprocessing as mp
import sys, threading, time
from pathlib import Path

RATE, BLOCK = 48000, 1024


def level_at(frame):
    return 0.1 + 0.4 * abs(((frame / RATE) % 2.0) - 1.0)  # 0.1 .. 0.5 .. 0.1


def find(part, api):
    import sounddevice as sd
    for i, d in enumerate(sd.query_devices()):
        host = sd.query_hostapis(d["hostapi"])["name"]
        if (d["max_input_channels"] > 0 and d["max_output_channels"] > 0
                and part.lower() in d["name"].lower() and (not api or host.startswith(api))):
            return i
    raise SystemExit(f"no duplex device like {part!r} on {api!r}")


def child(out, secs, shared, ready, part, api):
    import rehearsal_recorder  # noqa: F401  (ASIO on before sounddevice loads)
    import numpy as np, soundfile as sf, sounddevice as sd, rtmixer
    dev = find(part, api)
    m = rtmixer.MixerAndRecorder(device=dev, channels=1, samplerate=RATE, latency=0.05)
    m.start()
    play = rtmixer.RingBuffer(elementsize=4, size=2 ** 16)
    rec = rtmixer.RingBuffer(elementsize=4, size=2 ** 17)
    pos = [0]
    stop = threading.Event()

    def block():
        n = np.arange(pos[0], pos[0] + BLOCK)
        pos[0] += BLOCK
        return (0.5 * np.sin(2 * np.pi * 997 * n / RATE)).astype(np.float32)

    while play.write_available >= BLOCK and pos[0] < RATE:
        play.write(block())
    lowest = [play.read_available]

    def feeder():
        while not stop.is_set():
            lowest[0] = min(lowest[0], play.read_available)
            if play.write_available >= BLOCK and play.read_available < RATE:
                play.write(block())
            else:
                time.sleep(0.005)

    buf = np.zeros(2 ** 17, dtype=np.float32)
    done = threading.Event()

    def drain(f):
        while True:
            have = rec.read_available
            if have:
                k = rec.readinto(buf[:have])
                f.write(buf[:k])
            elif done.is_set():
                return
            time.sleep(0.02)

    with sf.SoundFile(out, "w", samplerate=RATE, channels=1, subtype="PCM_24") as f:
        ra = m.record_ringbuffer(rec)
        pa = m.play_ringbuffer(play)
        threading.Thread(target=feeder, daemon=True).start()
        d = threading.Thread(target=drain, args=(f,), daemon=True)
        d.start()
        ready.set()
        t_end = time.perf_counter() + secs
        dry = full = 0
        while time.perf_counter() < t_end:
            time.sleep(0.01)
            if pa not in m.actions:
                dry += 1
                pa = m.play_ringbuffer(play)
            if ra not in m.actions:
                full += 1
                ra = m.record_ringbuffer(rec)
            if pa.actual_time > 0:
                heard = (m.time - pa.actual_time) * RATE  # the frame the card plays now
                seq = shared[0] + 1
                shared[0] = seq  # odd: being written
                shared[1], shared[2], shared[3] = heard, level_at(heard), time.perf_counter()
                shared[0] = seq + 1
        m.cancel(pa)
        m.cancel(ra)
        time.sleep(0.2)
        done.set()
        d.join()
    stop.set()
    m.stop()
    m.close()
    shared[4], shared[5], shared[6] = dry, full, lowest[0] / RATE * 1000


if __name__ == "__main__":
    from probe import start_load
    import analyse
    out, secs = Path(sys.argv[1]), int(sys.argv[2])
    part, api = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else ("system", "")
    ctx = mp.get_context("spawn")
    shared = ctx.RawArray("d", 8)
    ready = ctx.Event()
    stop = threading.Event()
    holds = start_load("heavy", stop)
    p = ctx.Process(target=child, args=(str(out), secs, shared, ready, part, api))
    p.start()
    ready.wait(30)
    polls, stale, wrong, torn, back = 0, [], 0, 0, 0
    last = -1
    t_end = time.perf_counter() + secs - 0.5
    while time.perf_counter() < t_end:
        time.sleep(0.2)  # the screen asks five times a second
        a = shared[0]
        frame, level, at = shared[1], shared[2], shared[3]
        if a != shared[0] or int(a) % 2:
            torn += 1
            continue
        polls += 1
        stale.append((time.perf_counter() - at) * 1000)
        if abs(level - level_at(frame)) > 1e-9:
            wrong += 1
        if frame < last:
            back += 1
        last = frame
    p.join(30)
    stop.set()
    stale.sort()
    r = {"play_ran_dry": int(shared[4]), "rec_ring_overflowed": int(shared[5]),
         "lowest_play_reserve_ms": round(shared[6]), "polls": polls, "torn_reads": torn,
         "playhead_age_ms_median_max": [round(stale[len(stale) // 2], 1), round(stale[-1], 1)] if stale else None,
         "level_mismatch": wrong, "playhead_went_back": back,
         "hold_ms_median": round(sorted(holds)[len(holds) // 2]) if holds else None}
    r.update(analyse.judge(out))
    print(r)
