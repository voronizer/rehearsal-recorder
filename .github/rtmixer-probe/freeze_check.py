"""Frozen by PyInstaller in the probe: does rtmixer's compiled part make it
into a bundle, and does its C callback play through the bundled PortAudio?
Plays half a second of tone as one buffer and half a second through a ring,
and checks the card took every frame of both. Then the same from a second
process of the bundle, the way a separate sound process would run."""

import multiprocessing
import sys
import time


def play(part, api):
    import rehearsal_recorder  # noqa: F401  (ASIO on before sounddevice loads)

    import numpy as np
    import rtmixer
    import sounddevice as sd

    from rehearsal_recorder.audio.devices import close_stream, open_stream, output_latency

    index = None
    for i, d in enumerate(sd.query_devices()):
        host = sd.query_hostapis(d["hostapi"])["name"]
        if d["max_output_channels"] > 0 and part.lower() in d["name"].lower() and host.startswith(api):
            index, name = i, f"{d['name']} ({host})"
            break
    if index is None:
        return f"FAIL no output like {part!r} on {api!r}"
    rate = 48000
    tone = (0.3 * np.sin(2 * np.pi * 440 * np.arange(rate // 2) / rate)).astype(np.float32)
    stereo = np.column_stack([tone, tone])
    mixer = open_stream(rtmixer.Mixer, device=index, channels=2, samplerate=rate,
                        latency=output_latency(sd, index))
    try:
        one = mixer.play_buffer(stereo, channels=2)
        mixer.wait(one, sleeptime=10)
        ring = rtmixer.RingBuffer(elementsize=8, size=2 ** 15)
        ring.write(stereo)
        two = mixer.play_ringbuffer(ring)
        t = time.perf_counter()
        while ring.read_available and time.perf_counter() - t < 3:
            time.sleep(0.02)
        left = ring.read_available
        time.sleep(0.2)
    finally:
        close_stream(mixer)
    line = (f"frozen={getattr(sys, 'frozen', False)} rtmixer {rtmixer.__version__} on {name}: "
            f"buffer {one.done_frames} of {len(stereo)} frames, ring {len(stereo) - left} of {len(stereo)}")
    if one.done_frames != len(stereo) or left:
        return "FAIL " + line
    return line


def child(part, api, conn):
    conn.send(play(part, api))


if __name__ == "__main__":
    multiprocessing.freeze_support()  # a frozen app starts its other processes through this
    part, api = sys.argv[1], sys.argv[2]
    first = play(part, api)
    print("this process:", first, flush=True)
    ctx = multiprocessing.get_context("spawn")
    here, there = ctx.Pipe()
    proc = ctx.Process(target=child, args=(part, api, there))
    t = time.perf_counter()
    proc.start()
    second = here.recv() if here.poll(60) else "FAIL no answer from the second process"
    proc.join(10)
    print(f"second process (answered after {time.perf_counter() - t:.1f} s):", second, flush=True)
    if first.startswith("FAIL") or second.startswith("FAIL"):
        sys.exit(1)
    print("ok")
