"""
Opening and closing audio streams, safely and with useful errors.

Two things live here.

The lock: PortAudio is happy to run several streams at once, but creating and
destroying them from two threads at the same time is not safe. In this app
that is easy to hit — the interface can ask Python to open a player while the
previous one is still closing, and each of those calls arrives on its own
thread. Every stream in this app is opened and closed under STREAM_LOCK.

The check: device indices are not stable. Unplug the interface, reboot, add a
pair of AirPods, and the index saved in the config points somewhere else. Used
blindly it produces `PaMacCore (AUHAL) Error ... err='-50'`, which tells the
person nothing. So the saved device is checked first, and if it cannot do the
job we fall back to the system output and say why in plain words. To survive
changes to the device list, a saved choice is kept as the device's name and
audio system beside its index, and found again by those.
"""

import sys
import threading

import sounddevice as sd

from rehearsal_recorder.audio.format import SUPPORTED_DEPTHS, capture_dtype

STREAM_LOCK = threading.RLock()

# What the interface offers. 88.2 is left out on purpose: nobody records a
# rehearsal at it, and a shorter list is a better list.
OFFERED_RATES = (44100, 48000, 96000)


def recording_formats(device_index, channels):
    """
    Which sample rate and bit depth combinations this input actually accepts.

    Asked before the choice is offered, rather than after it fails: a card
    that cannot do 96 kHz should not have 96 kHz on screen at all.

    Returns {"44100": [16, 24], ...} — rates with no working depth are left
    out entirely.
    """
    check = getattr(sd, "check_input_settings", None)
    result = {}

    # Asking an ASIO card is not free the way it is elsewhere: PortAudio
    # answers each question by loading the driver, initialising it, asking,
    # and unloading it again — a full cycle per call, and ASIO drivers are
    # famously touchy about being cycled. It is also a question it answers
    # without ever looking at the sample format: the ASIO backend checks the
    # channel count and asks ASIOCanSampleRate, then hands the conversion to
    # PortAudio's own buffer adapter, which does every standard format. So on
    # ASIO each rate is asked about once, and the answer stands for both
    # depths — half as much wear for exactly the same information.
    asio = _is_asio(device_index)

    for rate in OFFERED_RATES:
        if check is None:
            result[str(rate)] = list(SUPPORTED_DEPTHS)  # cannot ask; assume
            continue

        depths = []
        for depth in (SUPPORTED_DEPTHS[:1] if asio else SUPPORTED_DEPTHS):
            try:
                check(
                    device=device_index,
                    channels=channels,
                    samplerate=rate,
                    dtype=capture_dtype(depth),
                )
                depths.append(depth)
            except Exception:
                pass
        if asio and depths:
            depths = list(SUPPORTED_DEPTHS)
        if depths:
            result[str(rate)] = depths

    return result


def _is_asio(device_index):
    """Whether this device is reached through ASIO — which changes what
    asking it anything costs. Unknown devices are treated as not."""
    try:
        return _host_api_name(sd.query_devices(device_index)) == "ASIO"
    except Exception:
        return False


def usable_output(device_index, samplerate, channels=2):
    """
    Returns (index_to_use, complaint). index_to_use is None for the system
    default. complaint is None when the asked-for device was fine, and a
    sentence for the person when it was not.
    """
    if device_index is None:
        return None, None

    try:
        info = sd.query_devices(device_index)
    except Exception:
        return None, "That playback device is gone — using the system output."

    name = (info or {}).get("name", "the chosen device")
    if (info or {}).get("max_output_channels", 0) < channels:
        return None, f"“{name}” has no stereo output — using the system output."

    # An ASIO card is not asked in advance. The question costs a full load,
    # initialise and unload of the driver — on every take, since this runs
    # each time a player opens — and it cannot answer better than the opening
    # itself: while our own recording holds the driver, the question comes
    # back "unavailable" whatever the rate. So the opening is left to decide,
    # and player.py falls back to the system output if it refuses.
    check = getattr(sd, "check_output_settings", None)
    if check is not None and not _is_asio(device_index):
        try:
            check(
                device=device_index,
                channels=channels,
                samplerate=samplerate,
                dtype="int16",
            )
        except Exception as e:
            # This asked one question — will you take this format — so an
            # answer with no code of its own is an answer about the format.
            return None, output_complaint(name, e, samplerate, fallback="rate")

    return device_index, None


# From portaudio.h, where the codes count down from paNotInitialized =
# -10000. These are the two this app can say something better about than
# PortAudio's own wording.
PA_INVALID_SAMPLE_RATE = -9997
PA_DEVICE_UNAVAILABLE = -9985


def _pa_code(error):
    """The PaErrorCode inside a sounddevice PortAudioError. Anything else —
    a plain OSError, a ValueError — has none, and gets the general answer."""
    args = getattr(error, "args", ())
    if len(args) > 1 and isinstance(args[1], int):
        return args[1]
    return None


def _rate_holder(platform):
    """Where this system shows what is holding a card at which rate."""
    if platform == "darwin":
        return "Audio MIDI Setup shows which"
    if platform == "win32":
        return "the card's own control panel shows which"
    return "the system's sound settings show which"


def output_complaint(name, error, samplerate, platform=sys.platform,
                     fallback="open"):
    """
    Why a playback device could not be used, in words that fit the reason.

    Every refusal used to be reported as the card not taking the rate, and
    pointed at Audio MIDI Setup — a program only macOS has. The commonest
    refusal is not about the rate at all: a card reached through ASIO plays
    through one program at a time, so while this app records through it, it
    answers "unavailable" to everything.

    `fallback` is what to say when the error carries no code to go on, and
    depends on what was being done. "rate" belongs to asking a card whether
    it takes a format, where a refusal can only be about the format; "open"
    belongs to opening the stream, where it could be anything, so the
    driver's own words are worth more than a guess.
    """
    code = _pa_code(error)

    if code == PA_DEVICE_UNAVAILABLE:
        return (
            f"“{name}” is already in use — using the system output. Something "
            "else has it: this app's own recording through the same card, or "
            "another program. A card reached through ASIO allows only one at "
            "a time."
        )
    if code == PA_INVALID_SAMPLE_RATE or (code is None and fallback == "rate"):
        return (
            f"“{name}” will not take {int(samplerate)} Hz right now — using "
            "the system output. Another app may be holding it at a different "
            f"rate; {_rate_holder(platform)}."
        )
    return (
        f"“{name}” would not open — using the system output. The driver said: "
        f"{error}"
    )


def _host_api_name(device):
    try:
        return sd.query_hostapis()[device["hostapi"]]["name"]
    except Exception:
        return ""


def device_identity(index):
    """What a device is, rather than where it happens to be in the list:
    {"name": ..., "host_api": ...}, or None for no device or an unknown one."""
    if index is None:
        return None
    try:
        info = sd.query_devices(index)
    except Exception:
        return None
    return {"name": info["name"], "host_api": _host_api_name(info)}


def saved_device(config, key, want_input, platform=sys.platform):
    """
    The index a saved choice means now, or None when nothing usable is saved.

    `key` names the choice: "device" for recording, "output_device" for
    playback, each stored as `<key>_index` plus `<key>` = its identity.

    An index with no identity is from before identities were saved. Off
    Windows it is still right. On Windows it is not trusted: turning ASIO on
    inserted a host API mid-list and moved every later index, and recording
    from the wrong card without a word is worse than asking again.
    """
    index = config.get(f"{key}_index")
    identity = config.get(key)

    if not identity:
        return None if platform == "win32" else index

    direction = "max_input_channels" if want_input else "max_output_channels"
    try:
        devices = list(sd.query_devices())
    except Exception:
        return None

    matches = [
        i for i, d in enumerate(devices)
        if d.get(direction, 0) > 0
        and d["name"] == identity.get("name")
        and _host_api_name(d) == identity.get("host_api")
    ]
    if index in matches:
        return index
    return matches[0] if matches else None
