"""
What a track's mode means, as functions over plain dictionaries.

A track records *audio*, *both* or *midi* (docs/superpowers/specs/
2026-10-08-midi-recording-design.md). Everything that asks what a track does
asks it here, so the words mean one thing from the band's saved config to the
database to the take on screen. This module opens no port and reads no file,
and imports neither the MIDI library nor mido: the suites that block them
import it freely.

A track with no mode, or a mode nobody here knows, records audio. That is how
every band, template and rehearsal saved before MIDI reads, so none of them
changes meaning.
"""

MODES = ("audio", "both", "midi")

# What a saved port may keep of the OS's description of it, name first
# (ports.PortInfo.saved).
_PORT_FIELDS = ("name", "device", "maker", "id")


def mode_of(track):
    """The track's mode: "audio", "both" or "midi". "audio" when it has none
    or one that is not a mode."""
    mode = track.get("mode")
    return mode if mode in MODES else "audio"


def records_audio(track):
    """Whether the track's input goes to a WAV: audio and both."""
    return mode_of(track) != "midi"


def records_notes(track):
    """Whether the track's port goes to a .mid: both and midi."""
    return mode_of(track) != "audio"


def port_ref(value):
    """
    A saved port as it is kept: a dict of the fields that say something, from
    `name`, `device`, `maker` and `id`. A bare string is a name. None for
    anything else, and for a port with no name, which finds nothing.
    """
    if isinstance(value, str):
        value = {"name": value}
    if not isinstance(value, dict):
        return None
    kept = {key: value[key] for key in _PORT_FIELDS
            if isinstance(value.get(key), str) and value[key].strip()}
    return kept if "name" in kept else None


def lane_after(band, audio_names, name):
    """
    The audio lane the notes lane of the track `name` follows in the player:
    its own when it has one (a Both track's notes sit under its sound),
    else the nearest lane before it in the band, else None for a lane that
    goes first. `band` is the tracks in order and `audio_names` the names of
    those with an audio file in the take.
    """
    if name in audio_names:
        return name
    names = [member["name"] for member in band]
    if name not in names:
        return None
    for earlier in reversed(names[:names.index(name)]):
        if earlier in audio_names:
            return earlier
    return None
