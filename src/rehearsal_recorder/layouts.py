"""
The band is one list; where each of them is plugged in belongs to the card.

A saved track used to carry two facts welded into one record: `{"name":
"Guitar", "channel": 3}`. The name belongs to the band and is the same
wherever they play. The number belongs to the card — input 3 on an
eighteen-input desk is somebody's guitar, and on a two-input box it does not
exist. Kept as one record, changing the interface left the band pointing at
inputs belonging to a different card.

So the two are stored apart. `tracks` is the band: one entry per member, in order, the same whatever is
plugged in. An entry is a name, whether that instrument is stereo — a
keyboard has two outputs wherever it is plugged in, so being stereo belongs
to the band and not to any card — and the icon chosen for it on the setup
screen, for the same reason. So are what it records, audio, both or MIDI
(`mode`), and the MIDI port it plays into (`midi_port`): the e-kit goes with
the drummer, whatever interface is on the desk. An audio member saves neither,
so a band saved before MIDI reads as it did. `layouts` holds one entry per
interface, and each entry maps a name to the input that person uses on that
card. Switching cards keeps everyone and swaps the numbers. A member who
records only MIDI is plugged into no input, and holds none.

The interface is identified by name and audio system rather than by its
position in PortAudio's list, which moves — see audio/devices.py.

Everything here is a pure function over plain dictionaries: no sound card is
touched, which is what makes the cases in for_device() testable without one.
"""

from rehearsal_recorder.midi import rules

# What a fresh install starts with, when there is no band yet.
DEFAULT_BAND = ({"name": "Guitar 1"}, {"name": "Vocals"})


def band_member(track):
    """The band's entry for a track on screen: its name, and stereo and its
    icon when it has them, and when it records MIDI its mode and its port.
    The input is the card's, not the band's.

    The icon is whatever name the interface gave it; this side only keeps
    it. One it does not know is drawn as the neutral one there."""
    icon = track.get("icon")
    mode = rules.mode_of(track)
    port = rules.port_of(track)
    return {
        "name": track["name"],
        **({"stereo": True} if track.get("stereo") else {}),
        **({"icon": icon} if isinstance(icon, str) and icon else {}),
        **({"mode": mode} if rules.records_notes(track) else {}),
        **({"midi_port": port} if port else {}),
    }


def icons(band):
    """Each member's icon by name, for those that have one."""
    return {m["name"]: m["icon"] for m in band or [] if m.get("icon")}


def _identity(entry):
    return entry.get("device")


def _same(a, b):
    """Whether two identities name the same interface. An absent identity
    matches nothing, so an entry belonging to no card is never mistaken for
    a card's own."""
    if not a or not b:
        return False
    return a.get("name") == b.get("name") and a.get("host_api") == b.get("host_api")


def migrate(config):
    """
    The same config with `tracks` as a list of names and `layouts` as one
    input map per interface.

    Running this on a config already in that shape changes nothing, so it is
    safe on every read.
    """
    config.setdefault("layouts", [])
    old_tracks = config.get("tracks") or []

    # A band of bare names is the shape before a member could be stereo.
    if old_tracks and isinstance(old_tracks[0], str):
        config["tracks"] = [{"name": n} for n in old_tracks]
        old_tracks = []

    # A list of records carrying a channel is the shape before the band and
    # the inputs were stored apart: one flat list, whose numbers belonged to
    # whichever card was chosen at the time. A band member is a record too,
    # so the channel is what tells the two apart — without it, converting a
    # second time would read the band as a flat list and invent an entry for
    # a card that was never there.
    if old_tracks and isinstance(old_tracks[0], dict) and "channel" in old_tracks[0]:
        config["tracks"] = [{"name": t["name"]} for t in old_tracks]
        config["layouts"] = [
            {
                "device": config.get("device"),
                "inputs": {t["name"]: t["channel"] for t in old_tracks
                           if t.get("channel") is not None},
            }
        ] + config["layouts"]

    # An entry holding whole records rather than an input map is the shape
    # where each card carried its own band. The names of everyone who
    # appeared on any card make up the band, most recently used first, so
    # that reading such a config loses nobody.
    if any("tracks" in e for e in config["layouts"]):
        band = list(config.get("tracks") or [])
        seen = {m["name"] for m in band}
        converted = []
        for entry in config["layouts"]:
            records = entry.pop("tracks", None)
            if records is not None:
                entry["inputs"] = {
                    t["name"]: t["channel"] for t in records
                    if t.get("channel") is not None
                }
                for t in records:
                    if t["name"] not in seen:
                        band.append({"name": t["name"]})
                        seen.add(t["name"])
            converted.append(entry)
        config["layouts"] = converted
        config["tracks"] = band

    config.setdefault("tracks", [])
    return config


def find(layouts, identity):
    """This interface's own entry, or None."""
    for entry in layouts or []:
        if _same(_identity(entry), identity):
            return entry
    return None


def inputs_for(layouts, identity):
    """Which input each name uses on this interface. Empty for one never
    used before."""
    entry = find(layouts, identity)
    return dict(entry.get("inputs") or {}) if entry else {}


def remember(layouts, identity, tracks):
    """
    `layouts` with this interface's input map updated from `tracks`, at the
    front of the list.

    Names not in `tracks` keep whatever input they had on this card: somebody
    dropped from the band and later brought back plugs into the same socket.

    Saving with no interface in hand keeps the map against no card at all, in
    the single slot such an entry occupies. It is never loaded as a card's
    own — find() will not match it — but it is kept rather than discarded,
    because there is no reason to forget where people were plugged in.
    """
    keep = dict(inputs_for(layouts, identity))
    if not identity:
        for entry in layouts or []:
            if not _identity(entry):
                keep = dict(entry.get("inputs") or {})
                break
    for t in tracks:
        if t.get("channel") is not None and rules.records_audio(t):
            keep[t["name"]] = t["channel"]

    rest = [
        e for e in (layouts or [])
        if not (_same(_identity(e), identity)
                or (not _identity(e) and not identity))
    ]
    return [{"device": identity or None, "inputs": keep}] + rest


def for_device(band, layouts, identity, max_inputs):
    """
    The tracks to put on the setup screen: every name in the band, with the
    input that name uses on this interface.

    A name this card has never seen takes the lowest input nobody else is
    on. When the inputs run out the remaining names arrive with none, rather
    than being dropped: which musicians sit out is the band's answer, not the
    app's. A member who records only MIDI arrives with none on purpose, is not
    stereo, and is not counted as waiting for an input: it takes none from
    anybody.

    Every track says its mode, and its port when it has one.
    """
    max_inputs = max(int(max_inputs or 0), 1)
    members = list(band) or list(DEFAULT_BAND)
    known = inputs_for(layouts, identity)

    def wants(member):
        return 2 if member.get("stereo") else 1

    def fits(channel, width, taken):
        if channel is None or channel < 1 or channel + width - 1 > max_inputs:
            return False
        return all(c not in taken for c in range(channel, channel + width))

    placed = {}
    taken = set()
    for member in members:
        if not rules.records_audio(member):
            continue
        width = wants(member)
        channel = known.get(member["name"])
        if fits(channel, width, taken):
            placed[member["name"]] = channel
            taken.update(range(channel, channel + width))

    out = []
    for member in members:
        takes_input = rules.records_audio(member)
        width = wants(member)
        channel = None
        if takes_input:
            channel = placed.get(member["name"])
            if channel is None:
                channel = next(
                    (c for c in range(1, max_inputs + 1) if fits(c, width, taken)),
                    None,
                )
                if channel is not None:
                    taken.update(range(channel, channel + width))
        port = rules.port_of(member)
        out.append({
            "name": member["name"],
            "channel": channel,
            "stereo": bool(member.get("stereo")) and takes_input,
            "mode": rules.mode_of(member),
            **({"icon": member["icon"]} if member.get("icon") else {}),
            **({"midi_port": port} if port else {}),
        })
    return out
