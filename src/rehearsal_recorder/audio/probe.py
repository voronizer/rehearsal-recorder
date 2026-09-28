"""
Asking a card why it will not open, or will not send.

When an ASIO stream is refused, PortAudio almost always answers -9999,
paUnanticipatedHostError. That code carries no meaning of its own: it means
"the driver said no and PortAudio has nothing to add". The driver's own words
come back with it, but ASIO drivers routinely leave that text empty, and then
the whole diagnosis is a number.

So the card is asked again, several times, each time with exactly one thing
changed, and the diagnosis is read off the pattern of what opened and what did
not. Two channels open but four do not: the tracks are assigned past the
card's inputs. Nothing opens on its own but the duplex attempt does: this
driver refuses to hand over the inputs without the outputs — a known habit of
several ASIO drivers, and something the app can work around. Nothing opens at
all: another program is holding the card, and no parameter will help.

Opening is not the whole of it. A card can take the stream and then never
deliver — Realtek's ASIO driver sends one block and nothing after — so an
attempt that opens is listened to: for as long as the app itself waits for
a first block (heartbeat.FIRST_BLOCK_SEC), then a second more, counting what
arrives. And it is opened the way the app opens a card, on the audio thread
with a callback. From the main thread in blocking mode, the probe could not
see a card that refuses any other thread, and that same Realtek driver
crashed under it.

This is a diagnostic, not part of recording. Nothing here is called while a
rehearsal is running — every attempt opens and closes a stream, which an ASIO
driver only tolerates when it is otherwise idle.
"""

import threading
import time

import numpy as np

from rehearsal_recorder.audio import heartbeat
from rehearsal_recorder.audio.format import capture_dtype, normalize_depth

# The attempts, by name. Each name is also how the report refers to it, so
# they read as sentences rather than as identifiers.
AS_CONFIGURED = "the settings in force"
FEWER_CHANNELS = "the first two channels only"
DRIVER_RATE = "the rate the driver is already at"
SIXTEEN_BIT = "16 bits instead of 24"
DRIVER_BLOCKS = "the block size left to the driver"
WITH_OUTPUTS = "the outputs opened alongside the inputs"

# What each attempt would prove by succeeding. The first proves nothing on its
# own — it is there so a card that opens fine now says so plainly.
CAUSE_OF = {
    AS_CONFIGURED: None,
    FEWER_CHANNELS: "channels",
    DRIVER_RATE: "samplerate",
    SIXTEEN_BIT: "bit_depth",
    DRIVER_BLOCKS: "blocksize",
    WITH_OUTPUTS: "input_only",
}
LABEL_FOR = {cause: label for label, cause in CAUSE_OF.items() if cause}

# The block size recording uses. Kept here rather than imported from capture.py
# so the probe reports what the app actually asks for even if that changes.
BLOCK_FRAMES = 1024

# How long an attempt listens once its first block is in. The settings in
# force listen longest: which inputs have signal is read off them.
LISTEN_SEC = 1.0
LISTEN_FIRST_SEC = 3.0

# Less than half the frames the listening should have brought, and the card
# is not delivering. Realtek's driver sends one block in ~47.
FLOWING_SHARE = 0.5

# Where the meters draw the line between signal and silence (QUIET_THRESHOLD
# in ui/src/lib/levels.ts), so "silent" here means what it does on screen.
SIGNAL_PEAK = 0.02


def attempts(samplerate, channels, bit_depth, driver_samplerate,
             has_outputs=True):
    """
    The openings to try, in order, each differing from the first in one way.

    An attempt that would be identical to the first — asking for two channels
    when two is already the count — is left out: it would prove nothing and
    would cost another load of the driver.
    """
    depth = normalize_depth(bit_depth)
    samplerate = int(samplerate)
    channels = int(channels)

    def entry(label, **params):
        return {
            "label": label,
            "cause": CAUSE_OF[label],
            "params": {
                "kind": "duplex" if label == WITH_OUTPUTS else "input",
                "channels": channels,
                "samplerate": samplerate,
                "dtype": capture_dtype(depth),
                "blocksize": BLOCK_FRAMES,
                **params,
            },
        }

    plan = [entry(AS_CONFIGURED)]

    if channels > 2:
        plan.append(entry(FEWER_CHANNELS, channels=2))
    if driver_samplerate and int(driver_samplerate) != samplerate:
        plan.append(entry(DRIVER_RATE, samplerate=int(driver_samplerate)))
    if depth != 16:
        plan.append(entry(SIXTEEN_BIT, dtype=capture_dtype(16)))
    plan.append(entry(DRIVER_BLOCKS, blocksize=0))
    if has_outputs:
        plan.append(entry(WITH_OUTPUTS))

    return plan


_VERDICTS = {
    "none": (
        "It works now: the card opens with the settings in force, and sound "
        "arrives.",
        "Whatever refused was not the settings. Almost always that means "
        "something else had the card at that moment — a DAW, the card's own "
        "mixer, or a second copy of this app. Open the check again and it "
        "should work.",
    ),
    "driver": (
        "The driver would not open the card at all.",
        "No combination of settings got in, so this is not about the rate, "
        "the depth or the channels. An ASIO card belongs to one program at a "
        "time: close anything else that uses it — a DAW, the card's control "
        "panel or mixer, a second copy of this app — and try again. If "
        "nothing else is running, the card is unplugged or its driver needs "
        "reinstalling.",
    ),
    "no_sound": (
        "The card opens, but sends no sound.",
        "The driver takes the stream and then delivers little or nothing, "
        "whatever the settings — the Realtek ASIO driver that comes with some "
        "laptops does exactly this. Close the card's control panel and "
        "anything else that uses it, unplug the card and plug it back in, and "
        "run this again. If it still sends nothing, its driver wants "
        "reinstalling; until then, record through WASAPI, where the same card "
        "is listed too.",
    ),
    "input_only": (
        "The driver hands over the inputs only when the outputs go with them.",
        "Several ASIO drivers work this way: an input-only stream is refused, "
        "the same stream with the outputs attached opens. Until the app opens "
        "both together, record through WASAPI instead — the same card is "
        "listed there as well, with fewer inputs but no such condition.",
    ),
    "channels": (
        "The card opened with two channels but not with the number the tracks "
        "ask for.",
        "The tracks are assigned to inputs this driver is not exposing. Check "
        "what the card's own control panel has switched on, then set the "
        "tracks to channels within that.",
    ),
    "samplerate": (
        "The card opened at the rate it was already running, but not at the "
        "rate the app asked for.",
        "An ASIO card changes rate only when nothing else is using it, and "
        "will not change at all while locked to an external clock. Either set "
        "the app to the rate the card is on, or change the card's rate in its "
        "own control panel first.",
    ),
    "bit_depth": (
        "The card opened at 16 bits but not at 24.",
        "Unusual, and worth reporting. Record at 16 bits for now — the "
        "rehearsal is worth more than the headroom.",
    ),
    "blocksize": (
        "The card opened when the driver chose its own block size.",
        "The driver will not take the block size the app asks for. This is a "
        "bug in the app, not a setting you can change — please report it "
        "with this report attached.",
    ),
    "unclear": (
        "Something opened and something did not, with no clear pattern.",
        "Please send this report: the combination that refused is not one the "
        "app knows how to explain yet.",
    ),
}


def verdict(results):
    """
    What the pattern of successes and failures says, as
    {"cause", "headline", "advice"}.

    `results` is one {"label", "opened", "flowing", "error"} per attempt
    tried. What counts is what worked: opened, and sound arrived.
    """
    opened = {r["label"] for r in results if r.get("opened")}
    working = {r["label"] for r in results if r.get("opened") and r.get("flowing")}

    if AS_CONFIGURED in working:
        cause = "none"
    elif not opened:
        cause = "driver"
    elif not working:
        cause = "no_sound"
    elif working == {WITH_OUTPUTS}:
        cause = "input_only"
    else:
        # Order matters: a card that works both with fewer channels and at
        # another rate is short of channels first — that is the one the person
        # can act on.
        for candidate in ("channels", "samplerate", "bit_depth", "blocksize"):
            if LABEL_FOR[candidate] in working:
                cause = candidate
                break
        else:
            cause = "unclear"

    headline, advice = _VERDICTS[cause]
    return {"cause": cause, "headline": headline, "advice": advice}


def describe(exc):
    """A PortAudio exception as one line, keeping the code and whatever the
    driver itself said — which is the part worth having."""
    return f"{type(exc).__name__}: {exc}"


def tracks_for(config, identity, max_inputs):
    """The tracks the setup screen would put on this card: the band from
    `tracks`, on the inputs this card's entry in `layouts` gives them — the
    app's own layouts.for_device(), on a config migrated the app's way."""
    from rehearsal_recorder import layouts

    config = layouts.migrate(dict(config))
    return layouts.for_device(
        config["tracks"], config["layouts"], identity, max_inputs
    )


def channels_for(tracks):
    """The channels a stream has to open to reach every track — a stereo
    track's second half included, a track left without an input not counted.
    Two when there is nothing to reach."""
    return max(
        (t["channel"] + (1 if t.get("stereo") else 0)
         for t in tracks if t.get("channel") is not None),
        default=2,
    )


def signal_line(peaks):
    """Which inputs had signal, numbered from 1 the way the tracks number
    them, as one line."""
    loud = [i + 1 for i, p in enumerate(peaks) if p > SIGNAL_PEAK]
    if not loud:
        return (
            "sound arrives, but every input is silent — play into them, or "
            "check what the card's own routing sends, and run it again"
        )
    if len(loud) == len(peaks):
        return "signal on every input"
    which = (
        f"input {loud[0]}" if len(loud) == 1
        else "inputs " + ", ".join(str(n) for n in loud)
    )
    return f"signal on {which}; the rest silent"


def probe(sd, device_index, plan, first_seconds=LISTEN_FIRST_SEC,
          seconds=LISTEN_SEC, first_block=None, report=None):
    """
    Tries the plan in order and returns a row per attempt tried.

    The settings in force come first and listen longest. When sound arrives
    with them, that is the answer and nothing else is tried: every other
    attempt could only cost another load of the driver. `report(attempt,
    row)` hears of each row as it comes, for a person watching.
    """
    rows = []
    for i, attempt in enumerate(plan):
        row = try_attempt(sd, device_index, attempt,
                          seconds=first_seconds if i == 0 else seconds,
                          first_block=first_block)
        rows.append(row)
        if report is not None:
            report(attempt, row)
        if i == 0 and row["flowing"]:
            break
    return rows


def try_attempt(sd, device_index, attempt, seconds=LISTEN_SEC, first_block=None):
    """
    Opens one attempt the way the app opens a card — on the audio thread,
    with a callback — and listens: up to `first_block` seconds for its first
    block (heartbeat.FIRST_BLOCK_SEC when not given), then `seconds` more.

    Returns its row: "opened"; "flowing", when at least FLOWING_SHARE of the
    frames `seconds` should bring arrived after the first block; "frames" and
    "expected", those two counts; "peaks", each input's loudest moment from
    0 to 1; and "error", the driver's words when it refused.
    """
    from rehearsal_recorder.audio.devices import close_stream, open_stream

    if first_block is None:
        first_block = heartbeat.FIRST_BLOCK_SEC
    params = attempt["params"]
    channels = params["channels"]
    row = {
        "label": attempt["label"], "opened": False, "flowing": False,
        "error": None, "frames": 0,
        "expected": int(seconds * params["samplerate"]),
        "peaks": [0.0] * channels,
    }
    arrived = {"frames": 0}
    loudest = np.zeros(channels)
    first = threading.Event()

    # The audio thread. Allocating here is fine for a diagnostic that never
    # runs beside a take.
    def heard(indata, frames):
        arrived["frames"] += frames
        scale = np.iinfo(indata.dtype).max + 1 if indata.dtype.kind == "i" else 1
        peaks = np.abs(indata[:frames].astype(np.float64)).max(axis=0) / scale
        np.maximum(loudest, peaks[:channels], out=loudest)
        first.set()

    def on_input(indata, frames, time_info, status):
        heard(indata, frames)

    def on_duplex(indata, outdata, frames, time_info, status):
        outdata.fill(0)
        heard(indata, frames)

    common = {
        "samplerate": params["samplerate"],
        "dtype": params["dtype"],
        "blocksize": params["blocksize"],
    }
    try:
        if params["kind"] == "duplex":
            stream = open_stream(
                sd.Stream, device=(device_index, device_index),
                channels=(channels, 2), callback=on_duplex, **common,
            )
        else:
            stream = open_stream(
                sd.InputStream, device=device_index, channels=channels,
                callback=on_input, **common,
            )
    except Exception as e:  # noqa: BLE001 — every failure is a data point
        row["error"] = describe(e)
        return row

    row["opened"] = True
    try:
        if first.wait(first_block):
            before = arrived["frames"]
            time.sleep(seconds)
            row["frames"] = arrived["frames"] - before
    finally:
        try:
            close_stream(stream)
        except Exception as e:  # noqa: BLE001 — a driver that will not let go
            row["error"] = describe(e)
    row["flowing"] = row["frames"] >= FLOWING_SHARE * row["expected"]
    row["peaks"] = [float(p) for p in loudest]
    return row


def _saved_config():
    """The app's settings, read without starting the app — constructing Api
    would open a web server, which a diagnostic has no business doing."""
    import json

    from rehearsal_recorder.api import CONFIG_PATH
    from rehearsal_recorder.store.importer import read_text

    try:
        data = json.loads(read_text(CONFIG_PATH))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def run(device_index=None):
    """
    Print a report for the saved recording device, or the one named.

        RehearsalRecorder --audio-probe [index]

    Returns 0 when the card opened with the settings in force and sound
    arrived, 1 otherwise — so it can be run from a script as well as read.
    """
    import sounddevice as sd

    from rehearsal_recorder.audio.devices import device_identity, saved_device

    print(f"PortAudio {sd.get_portaudio_version()[1]}")
    try:
        apis = [h["name"] for h in sd.query_hostapis()]
    except Exception as e:
        print(f"  cannot list the audio systems: {describe(e)}")
        return 1
    print(f"  audio systems: {', '.join(apis) or 'none'}")

    devices = list(sd.query_devices())
    print("\nInputs:")
    for i, d in enumerate(devices):
        if d.get("max_input_channels", 0) <= 0:
            continue
        api = apis[d["hostapi"]] if d.get("hostapi", -1) < len(apis) else "?"
        print(f"  [{i}] {d['name']} — {api}, "
              f"{d['max_input_channels']} in, {d.get('max_output_channels', 0)} out, "
              f"{int(d['default_samplerate'])} Hz")

    config = _saved_config()
    if device_index is None:
        device_index = saved_device(config, "device", True)
    if device_index is None:
        print("\nNo recording device is saved and none was named — "
              "run it again with the index from the list above.")
        return 1

    info = sd.query_devices(device_index)
    samplerate = int(config.get("samplerate") or info["default_samplerate"])
    depth = normalize_depth(config.get("bit_depth"))
    channels = channels_for(tracks_for(
        config, device_identity(device_index), info["max_input_channels"]
    ))

    print(f"\nAsking [{device_index}] {info['name']} — "
          f"{channels} channels, {samplerate} Hz, {depth} bits")
    print("Play or talk into the inputs while it listens.")

    plan = attempts(
        samplerate=samplerate,
        channels=channels,
        bit_depth=depth,
        driver_samplerate=int(info["default_samplerate"]),
        has_outputs=info.get("max_output_channels", 0) > 0,
    )

    def say(attempt, row):
        if row["flowing"]:
            print(f"  ok   {attempt['label']} — sound arrives")
        elif row["opened"]:
            print(f"  no   {attempt['label']} — opens, but sent {row['frames']} "
                  f"of ~{row['expected']} frames")
        else:
            print(f"  no   {attempt['label']}")
        if row["error"]:
            print(f"       {row['error']}")

    results = probe(sd, device_index, plan, report=say)
    if results[0]["flowing"]:
        print(f"       {signal_line(results[0]['peaks'])}")

    answer = verdict(results)
    print(f"\n{answer['headline']}\n{answer['advice']}")
    return 0 if answer["cause"] == "none" else 1
