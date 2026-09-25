"""
Asking a card why it will not open.

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

This is a diagnostic, not part of recording. Nothing here is called while a
rehearsal is running — every attempt opens and closes a stream, which an ASIO
driver only tolerates when it is otherwise idle.
"""

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
        "It opens now, with the settings in force.",
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

    `results` is one {"label", "opened", "error"} per attempt.
    """
    opened = {r["label"] for r in results if r.get("opened")}

    if AS_CONFIGURED in opened:
        cause = "none"
    elif not opened:
        cause = "driver"
    elif opened == {WITH_OUTPUTS}:
        cause = "input_only"
    else:
        # Order matters: a card that opens both with fewer channels and at
        # another rate is short of channels first — that is the one the person
        # can act on.
        for candidate in ("channels", "samplerate", "bit_depth", "blocksize"):
            if LABEL_FOR[candidate] in opened:
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


def try_attempt(sd, device_index, attempt):
    """Open and immediately close one attempt. Returns its result row."""
    params = attempt["params"]
    common = {
        "samplerate": params["samplerate"],
        "dtype": params["dtype"],
        "blocksize": params["blocksize"],
    }
    stream = None
    try:
        if params["kind"] == "duplex":
            stream = sd.Stream(
                device=(device_index, device_index),
                channels=(params["channels"], 2),
                **common,
            )
        else:
            stream = sd.InputStream(
                device=device_index, channels=params["channels"], **common
            )
        stream.start()
        stream.stop()
        return {"label": attempt["label"], "opened": True, "error": None}
    except Exception as e:  # noqa: BLE001 — every failure is a data point
        return {"label": attempt["label"], "opened": False,
                "error": describe(e)}
    finally:
        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass


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

    Returns 0 when the card opened with the settings in force, 1 otherwise —
    so it can be run from a script as well as read.
    """
    import sounddevice as sd

    from rehearsal_recorder.audio.devices import saved_device

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
    tracks = config.get("tracks") or []
    channels = max((t["channel"] for t in tracks), default=2)

    print(f"\nAsking [{device_index}] {info['name']} — "
          f"{channels} channels, {samplerate} Hz, {depth} bits")

    plan = attempts(
        samplerate=samplerate,
        channels=channels,
        bit_depth=depth,
        driver_samplerate=int(info["default_samplerate"]),
        has_outputs=info.get("max_output_channels", 0) > 0,
    )

    results = []
    for attempt in plan:
        result = try_attempt(sd, device_index, attempt)
        results.append(result)
        mark = "ok  " if result["opened"] else "no  "
        print(f"  {mark} {attempt['label']}")
        if result["error"]:
            print(f"       {result['error']}")

    answer = verdict(results)
    print(f"\n{answer['headline']}\n{answer['advice']}")
    return 0 if answer["cause"] == "none" else 1
