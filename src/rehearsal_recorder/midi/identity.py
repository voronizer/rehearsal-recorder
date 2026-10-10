"""
Which port a saved one is, and the order a device's ports are listed in.

These are the two questions the picker and the tracks put to the OS's list of
ports: is this saved port one of them, and in what order do they go. Both are
plain functions over PortInfo, so they run with nothing plugged in. This
imports ports.py for PortInfo and nothing that talks to the MIDI library
(ports.py does not load it until a port's own thread starts), so the suites
that block the library import this freely.

A saved port is found again by what the OS said about it (spec P1): the same
id where the system gives one, then the same name, then the same name with
what Windows adds taken off, on the same device where both name one. A
device's ports are listed with its playing port first; whether a port is a
control port is read from its name with the device's own name taken out, as
"Launch Control XL" is a device's name and not a control port's.
"""

import re

from rehearsal_recorder.midi.ports import PortInfo

# What Windows adds to a port's name: a number at the end ("TD-17 1") and "2- "
# in front of a second device of the same kind.
_NUMBER_IN_FRONT = re.compile(r"^\d+-\s*")
_NUMBER_AT_END = re.compile(r"\s+\d+$")

# The words that mark a port as a control or DAW port, not the one a device
# plays. "MIDIIN2" is how Windows names a device's second MIDI input. "InControl"
# holds "Control", so it is not listed again.
_CONTROL_WORDS = ("daw", "midiin2", "control", "ctrl")


def bare_name(name: str) -> str:
    """
    A port's name without what Windows adds to it: the "2- " in front and the
    number at the end. Both can change when devices are replugged, so a port
    saved as "TD-17 1" can come back as "TD-17 2", or as "2- TD-17". Taking
    them off leaves the name the ports have in common, which is what find_port
    falls back to when the name itself finds nothing. Space around the name is
    taken off first, so a name that is only Windows' numbers has an empty bare
    name, and find_port does not match on that.
    """
    name = name.strip()
    return _NUMBER_AT_END.sub("", _NUMBER_IN_FRONT.sub("", name))


def find_port(saved: dict, ports: list[PortInfo]) -> tuple[PortInfo | None, bool]:
    """
    The port in `ports` that a saved one is, as (port, False). `saved` is a
    dictionary from PortInfo.saved, which keeps only the fields that said
    something when it was saved, so any of them but the name may be missing.

    The tiers are tried in order: a port with the same id, where both have
    one; then the same name; then the same name as bare_name gives it, on the
    same device where both name one (a KeyLab 49 is not a KeyLab 61 for being
    called "KeyLab"). The first tier that finds any ports decides. One port is
    the answer, and two or more alike give (None, True): the caller shows the
    port as not connected and lists them, rather than guess which was meant.
    Nothing found is (None, False), and so is a saved port with no usable name
    and no id.
    """
    name = saved.get("name")
    name = name if isinstance(name, str) and name.strip() else ""
    ident = saved.get("id")
    ident = ident if isinstance(ident, str) else ""
    device = saved.get("device")
    device = device if isinstance(device, str) else ""

    # An id counts only where both have one, so a port with no id never
    # matches by it.
    if ident:
        alike = [p for p in ports if p.id == ident]
        if alike:
            return _one_of(alike)
    if name:
        alike = [p for p in ports if p.name == name]
        if alike:
            return _one_of(alike)
        bare = bare_name(name)
        # An empty bare name would match every port that is only Windows'
        # numbers, so there is nothing to match on then.
        if bare:
            alike = [p for p in ports if bare_name(p.name) == bare and _same_device(p, device)]
            if alike:
                return _one_of(alike)
    return None, False


def in_order(ports: list[PortInfo]) -> list[PortInfo]:
    """
    The ports in the order the picker lists them: a device's ports together,
    the devices in the order the OS lists each one's first port, and within a
    device its playing port first.

    A keyboard such as the Launchkey lists a DAW port and a control port
    beside the MIDI port you play, so a port whose name has one of the control
    words goes after the device's others, in the OS's order among themselves.
    The words are looked for with the device's own name taken out of the
    port's (see _is_control), so a device called "Launch Control XL" does not
    have every one of its ports taken for a control port. Every other port
    keeps the OS's order.

    A port with no device is a group of its own, not lumped with the other
    ports that have none, because two devices that do not say what they are
    are not one device.
    """
    groups: list[list[PortInfo]] = []
    by_device: dict[str, list[PortInfo]] = {}
    for port in ports:
        if not port.device:
            groups.append([port])
        elif port.device in by_device:
            by_device[port.device].append(port)
        else:
            by_device[port.device] = [port]
            groups.append(by_device[port.device])

    ordered: list[PortInfo] = []
    for group in groups:
        ordered.extend(p for p in group if not _is_control(p))
        ordered.extend(p for p in group if _is_control(p))
    return ordered


def _is_control(port: PortInfo) -> bool:
    """
    Whether a port is a device's control or DAW port (see in_order). The
    device's own name is taken out of the port's name first: "Launch Control XL"
    and "Keystation Controller" are names with a control word in them, and their
    playing ports say nothing of the kind. Only where it stands as a word of its
    own: a device called "MIDI" leaves the "midiin2" in "MIDIIN2 (MIDI)".
    """
    name = port.name.lower()
    if port.device:
        device = re.escape(port.device.lower())
        name = re.sub(rf"(?<![a-z0-9]){device}(?![a-z0-9])", " ", name)
    return any(word in name for word in _CONTROL_WORDS)


def _same_device(port: PortInfo, device: str) -> bool:
    """
    Whether a port may be the saved one as far as the device goes: where both
    name a device, it must be the same one. CoreMIDI fills in the device, so a
    KeyLab 49 never binds to a KeyLab 61 by the bare name they share. A port
    that names no device is not held against the saved one.
    """
    return not (port.device and device) or port.device == device


def _one_of(alike: list[PortInfo]) -> tuple[PortInfo | None, bool]:
    """
    The one port that is alike, or (None, True) when there are two or more:
    identical devices that nothing tells apart are not guessed between.
    """
    if len(alike) == 1:
        return alike[0], False
    return None, True
