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

# The modes, as they are stored in the band's config and in the database: the
# words never change.
AUDIO, BOTH, MIDI = "audio", "both", "midi"
MODES = (AUDIO, BOTH, MIDI)

# What a saved port may keep of the OS's description of it, name first
# (ports.PortInfo.saved).
_PORT_FIELDS = ("name", "device", "maker", "id")


def mode_of(track):
    """The track's mode: "audio", "both" or "midi". "audio" when it has none
    or one that is not a mode."""
    mode = track.get("mode")
    return mode if mode in MODES else AUDIO


def records_audio(track):
    """Whether the track's input goes to a WAV: audio and both."""
    return mode_of(track) != MIDI


def records_notes(track):
    """Whether the track's port goes to a .mid: both and midi."""
    return mode_of(track) != AUDIO


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


def port_of(track):
    """The port a track keeps (port_ref of its `midi_port`): only a track that
    records notes has one, whatever an audio track is handed."""
    return port_ref(track.get("midi_port")) if records_notes(track) else None


def notes_problem(tracks):
    """
    None when these tracks can start a rehearsal as far as their notes go, and
    a sentence when they cannot. Asked before the audio card is, so a band
    that cannot record is told so in its own words and not in a number about
    a device. Three things stop Start, said in this order:

    - No track records sound (A1). A take is timed, heard and mixed from its
      audio, so a rehearsal of nothing but MIDI has nothing to play.
    - A track that takes notes has no port picked yet (P3). A port that was
      picked and is not plugged in does not stop it: that waits, like any
      other (D7).
    - Two tracks take notes from one port (P2), as two on one input would.
      Ports are the same when their names are, and a track that only
      records audio takes notes from none, whatever it is handed. The first
      two found, in band order, are named.

    No tracks at all is not this check's to refuse: starting with none is
    refused earlier, with its own words.
    """
    if not tracks:
        return None

    if not any(records_audio(t) for t in tracks):
        return "At least one track has to record sound, so the takes can be heard."

    portless = [t["name"] for t in tracks if records_notes(t) and port_of(t) is None]
    if portless:
        if len(portless) == 1:
            return f"{portless[0]} has no MIDI port yet. Pick one, or set it to Audio."
        return f"{', '.join(portless)} have no MIDI port yet. Pick one, or set them to Audio."

    taken = {}
    for t in tracks:
        port = port_of(t)
        if port is None:
            continue
        if port["name"] in taken:
            return f"{taken[port['name']]} and {t['name']} both take notes from {port['name']}."
        taken[port["name"]] = t["name"]
    return None


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
