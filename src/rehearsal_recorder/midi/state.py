"""
What a port has set, and what it is holding (spec F6 and F7).

A rehearsal is longer than its takes, and a port keeps playing between them:
the keyboard's sound is picked, the hi-hat pedal goes down, a key is pressed
while the take is being started. A .mid that began at the take's first note
would play in a DAW with the DAW's own patch and an open hi-hat, and a key
held when the take stopped would never get its note-off and ring until the
end of the project. A PortState follows one port's messages and says both:
what the take's file should begin with, and what it should end with.

It is pure Python over raw bytes: no mido, no MIDI library. Each `feed` is one
whole message as the port sent it. A channel message changes the state; a
SysEx, a realtime or system message is not a channel's and is ignored, and so
is a message that is cut short, run on, or has a data byte of 0x80 or more.
Nothing here raises for what a port sends.

It keeps only what arrived. Nothing is made up and nothing is interpreted: an
"all notes off" or "reset all controllers" is a command, not a value, and is
neither kept nor applied. So a key stays held through an all-notes-off and is
let go at the end all the same: a note-off too many costs nothing, one too few
rings for ever. And a pedal that was down when a reset-all-controllers arrived
is still recorded as down, so the next take starts with it down until the
player moves it.

A PortState has a lock of its own, taken by `feed` (while it changes the
state), `copy`, `start_messages` and `releases`, so a port's thread can feed it
while another thread copies it or reads it. Each call is one step; two calls in a row are
not, and a caller that needs two to follow each other (a copy, then the next
message) holds a lock of its own around both.
"""

import threading

# Never kept as a value, because none is a state (F6): 120-127 are commands
# (all sound off, reset all controllers, local control, all notes off, the modes),
# 88 only adds precision to the next note's velocity, and 6, 38 and 96-101
# (data entry, increment, decrement, the NRPN and RPN numbers) mean something only
# inside the sequence that set them, so repeating one on its own would write
# into whatever parameter was last selected.
_NEVER_KEPT = frozenset({6, 38, 88, *range(96, 102), *range(120, 128)})

# The bank is chosen before the program, as an instrument expects (F6).
_BANK_MSB, _BANK_LSB = 0, 32

# Sustain, sostenuto and soft: down from 64, and let up at the end (F7).
_PEDALS = (64, 66, 67)

_NOTE_OFF, _NOTE_ON, _CONTROL, _PROGRAM, _PRESSURE, _BEND = 0x80, 0x90, 0xB0, 0xC0, 0xD0, 0xE0


class PortState:
    """
    One port's state: per channel the last value of every controller worth
    keeping, the program, the pitch bend and the channel pressure, and which
    keys are held.

    `start_messages` is what a take's .mid begins with, `releases` what it ends
    with. Neither changes the state, so a take can ask for them at any time,
    and both give a new list each call. A `copy` is its own: a rig keeps one
    PortState per track through the whole rehearsal and hands each take a copy
    to carry on from, without the take's notes reaching back into the rig's.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._controllers = {}  # (channel, number) -> value
        self._program = {}  # channel -> program
        self._bend = {}  # channel -> (low byte, high byte)
        self._pressure = {}  # channel -> value
        self._held = {}  # (channel, note) -> None, in the order first pressed

    def feed(self, data) -> None:
        """
        Takes one message from the port: bytes, a bytearray or a memoryview,
        or a list or tuple of ints. Anything else, other buffers included,
        is ignored without being turned into bytes, a number included: bytes(5)
        is five zero bytes, and bytes(10**9) would be a gigabyte of them.

        A note-on at velocity 0 is a note-off. Key pressure (0xA0) is about a
        key and not a state, and is not kept.
        """
        if not isinstance(data, (bytes, bytearray, memoryview, list, tuple)):
            return
        try:
            data = bytes(data)
        except (TypeError, ValueError, OverflowError):
            return
        if not data:
            return
        status = data[0]
        if not 0x80 <= status <= 0xEF:
            return  # SysEx, realtime and system messages, and bytes with no status
        # A program change and a channel pressure (0xC0-0xDF) have one data byte, the rest two.
        # The same rule as smf.storable, which is not imported here: it would bring in mido.
        size = 2 if (status & 0xE0) == 0xC0 else 3
        if len(data) != size or max(data[1:]) >= 0x80:
            return
        kind, channel = status & 0xF0, status & 0x0F
        with self._lock:
            if kind == _NOTE_ON and data[2]:
                # A key struck again while still down keeps its place in the line.
                self._held.setdefault((channel, data[1]), None)
            elif kind in (_NOTE_ON, _NOTE_OFF):
                self._held.pop((channel, data[1]), None)
            elif kind == _CONTROL:
                if data[1] not in _NEVER_KEPT:
                    self._controllers[channel, data[1]] = data[2]
            elif kind == _PROGRAM:
                self._program[channel] = data[1]
            elif kind == _PRESSURE:
                self._pressure[channel] = data[1]
            elif kind == _BEND:
                self._bend[channel] = (data[1], data[2])

    def start_messages(self) -> list[bytes]:
        """
        The messages that put an instrument where this port has it, only for
        what has arrived. Channels ascending; on each the bank (controller 0,
        then 32), the program, the other controllers by number, the pitch bend
        and the channel pressure. The bank comes before the program, as an
        instrument expects. A pedal is one of the controllers, with its last
        value, up or down. No key is in it, held or not: a key already down
        when the take starts is not in the file, nor its release (F6).
        """
        with self._lock:
            channels = ({channel for channel, _ in self._controllers}
                        | self._program.keys() | self._bend.keys() | self._pressure.keys())
            messages = []
            for channel in sorted(channels):
                numbers = sorted(number for ch, number in self._controllers if ch == channel)
                for number in [n for n in (_BANK_MSB, _BANK_LSB) if n in numbers]:
                    messages.append(self._control(channel, number))
                if channel in self._program:
                    messages.append(bytes((_PROGRAM | channel, self._program[channel])))
                for number in numbers:
                    if number not in (_BANK_MSB, _BANK_LSB):
                        messages.append(self._control(channel, number))
                if channel in self._bend:
                    messages.append(bytes((_BEND | channel, *self._bend[channel])))
                if channel in self._pressure:
                    messages.append(bytes((_PRESSURE | channel, self._pressure[channel])))
            return messages

    def releases(self) -> list[bytes]:
        """
        What to write when a take stops, or its port is gone, so nothing is
        left hanging (F7): a note-off for every key held, then every sustain,
        sostenuto and soft pedal that is down let up.

        The keys are let go in the order they were pressed, across channels
        (a key struck twice and not let go is one, at the place it was first
        struck). The pedals follow, channels ascending and on each 64, 66, 67;
        one is down from the value 64 up.
        """
        with self._lock:
            messages = [bytes((_NOTE_OFF | channel, note, 0)) for channel, note in self._held]
            for channel in sorted({channel for channel, _ in self._controllers}):
                for number in _PEDALS:
                    if self._controllers.get((channel, number), 0) >= 64:
                        messages.append(bytes((_CONTROL | channel, number, 0)))
            return messages

    def copy(self) -> "PortState":
        """
        A PortState of its own, with a lock of its own, that starts where this
        one is: feeding either leaves the other as it was.

        The keys held are copied too, though a take's file has neither a key
        that was already down when it began nor that key's release (F6). So the
        `releases` that end a take are the ones of a state fed with the take's
        own messages, which hold only the keys the take pressed, and not those
        of the copy that carried the port's state to the take's start.
        """
        other = PortState()
        with self._lock:
            other._controllers = dict(self._controllers)
            other._program = dict(self._program)
            other._bend = dict(self._bend)
            other._pressure = dict(self._pressure)
            other._held = dict(self._held)
        return other

    def _control(self, channel: int, number: int) -> bytes:
        return bytes((_CONTROL | channel, number, self._controllers[channel, number]))
