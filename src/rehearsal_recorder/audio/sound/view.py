"""
PortAudio as the main process sees it beside a sound process: the device
list the sound process last made, and its answers to the questions that
need a card. audio/devices.py's `sd` is this module there, so the code that
reads the list (Settings › Audio, saved_device, channels_available) reads
it as before without PortAudio loaded here: loading it would load every
ASIO driver again while the sound process plays through one.

The list is made as the sound process starts, again after each rescan, and
again when the sound process is started again.
"""

from rehearsal_recorder.audio import sound
from rehearsal_recorder.audio.sound import PortAudioError, SoundUnavailable

# rescan() counts PortAudio's starts here; over there it does its own.
_initialized = 1


def _list():
    from rehearsal_recorder.audio.sound.link import DOWN

    link = sound.apart()
    if link is None:
        raise SoundUnavailable("РЭХА's sound is not running.")
    if not link.alive:
        raise SoundUnavailable(DOWN)
    listed = link.devices
    if listed is None:
        link.wait_started()
        listed = link.devices
    if listed is None:
        raise SoundUnavailable(DOWN if not link.alive else "РЭХА's sound did not start.")
    return listed


def query_devices(device=None, kind=None):
    """sounddevice.query_devices: the list, one device, or the default of
    `kind` ("input" or "output")."""
    listed = _list()
    devices = listed["devices"]
    if device is None and kind is not None:
        device = listed["default"][0 if kind == "input" else 1]
        if device is None or device < 0:
            raise PortAudioError(f"No default {kind} device")
    if device is None:
        return [dict(d) for d in devices]
    if isinstance(device, str):
        found = [d for d in devices if device.lower() in d["name"].lower()]
        if len(found) != 1:
            raise ValueError(f"No single device matches {device!r}")
        info = found[0]
    else:
        if not 0 <= int(device) < len(devices):
            raise PortAudioError(f"Error querying device {device}")
        info = devices[int(device)]
    if kind == "input" and info.get("max_input_channels", 0) <= 0:
        raise ValueError(f"Not an input device: {info['name']!r}")
    if kind == "output" and info.get("max_output_channels", 0) <= 0:
        raise ValueError(f"Not an output device: {info['name']!r}")
    return dict(info)


def query_hostapis(index=None):
    apis = _list()["hostapis"]
    if index is None:
        return [dict(h) for h in apis]
    return dict(apis[index])


def check_input_settings(**kw):
    return sound.function("devices.check_input_settings", **kw)


def check_output_settings(**kw):
    return sound.function("devices.check_output_settings", **kw)


def get_portaudio_version():
    return 0, sound.function("portaudio_version")


def rescan():
    """PortAudio started again in the sound process, and its new list kept
    here. None, or a sentence when it could not (devices.rescan)."""
    trouble, listed = sound.function("devices.rescan")
    link = sound.apart()
    # None when PortAudio did not start again there: the list before stays,
    # and `trouble` says to restart.
    if link is not None and listed is not None:
        link.devices = listed
    return trouble


def _stays_there(*args, **kw):
    raise RuntimeError("A stream to a card is only opened in РЭХА's sound process")


InputStream = OutputStream = Stream = _stays_there
