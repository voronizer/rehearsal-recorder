"""
The band is one list; where each of them is plugged in belongs to the card.

A saved track used to carry two facts welded into one record: `{"name":
"Guitar", "channel": 3}`. The name belongs to the band and is the same
wherever they play. The number belongs to the card — input 3 on an
eighteen-input desk is somebody's guitar, and on a two-input box it does not
exist. Kept as one record, changing the interface left the band pointing at
inputs belonging to a different card.

So the two are stored apart. `tracks` is the band: one entry per member, in order, the same whatever is
plugged in. An entry is a name and whether that instrument is stereo — a
keyboard has two outputs wherever it is plugged in, so being stereo belongs
to the band and not to any card. `layouts` holds one entry per interface, and each
entry maps a name to the input that person uses on that card. Switching
cards keeps everyone and swaps the numbers.

The interface is identified by name and audio system rather than by its
position in PortAudio's list, which moves — see audio/devices.py.

Everything here is a pure function over plain dictionaries: no sound card is
touched, which is what makes the cases in for_device() testable without one.
"""

# What a fresh install starts with, when there is no band yet.
DEFAULT_BAND = ({"name": "Guitar 1"}, {"name": "Vocals"})


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
        if t.get("channel") is not None:
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
    app's.
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
        width = wants(member)
        channel = known.get(member["name"])
        if fits(channel, width, taken):
            placed[member["name"]] = channel
            taken.update(range(channel, channel + width))

    out = []
    for member in members:
        width = wants(member)
        channel = placed.get(member["name"])
        if channel is None:
            channel = next(
                (c for c in range(1, max_inputs + 1) if fits(c, width, taken)),
                None,
            )
            if channel is not None:
                taken.update(range(channel, channel + width))
        out.append({
            "name": member["name"],
            "channel": channel,
            "stereo": bool(member.get("stereo")),
        })
    return out
