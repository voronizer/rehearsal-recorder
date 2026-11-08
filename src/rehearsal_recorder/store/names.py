"""
What a take is called, and what an old name meant.

A take is a go at a song, or at nothing (models.Take). Its name is not
stored but follows from the two: the song's title and its go, "Polyn 3" —
the go always there, from 1 — or "Take N", N being the take's own number,
for a take with no song. take_name() is that rule, and the only place it is
written. This is the name as plain text, which folders, cloud copies and the
band service carry.

A person reads it with a # before the go, "Polyn #3", so that a title which
ends in a number reads apart from it: "Opus 5 #3". The interface draws it so,
and shown_name() writes it so in the words this side puts on screen itself,
such as a take's line in the list of background work.

Naming a take goes the other way, from what was typed or clicked to a song
and a go. That needs the songs already in the library, so it is in
library.py (Library._resolve), using split_go from here, which reads a go
typed either way.

legacy_song() is how names were read before songs were stored: a trailing
number was the go, the rest was the song. Migration 0002 and the import of
old session.json files read old names with it, so the two cannot differ. It
describes data that already exists, so it must not change when the rule for
new names does.
"""

import re

# A take nobody named, as the app names it.
UNNAMED_TAKE = re.compile(r"^Take \d+$")
# What older versions called a rescued draft nobody named. It read as a song
# called "Recovered take"; it is a take nobody named, like any other.
_RECOVERED_TAKE = re.compile(r"^Recovered take \d+$")
# A trailing number: "Polyn 3" -> "Polyn", "3". How old names are read
# (legacy_song).
_TRAILING_NUMBER = re.compile(r"^(.*?)\s+(\d+)$")
# A go typed after a title: "Polyn 3", or "Polyn #3" and "Polyn#3" as the
# interface writes it.
_TYPED_GO = re.compile(r"^(.*?)(?:\s*#\s*|\s+)(\d+)$")
# Between a title and its go as a person reads it: a no-break space, so the
# go never starts a line of its own.
_NO_BREAK = "\u00a0"


def take_name(title, go, take_number):
    """'Polyn 1', 'Polyn 3', or 'Take 7' for a take with no song."""
    if title is None:
        return f"Take {take_number}"
    return f"{title} {go or 1}"


def shown_name(title, go, take_number):
    """'Polyn #3' as a person reads it, or 'Take 7' for a take with no
    song. Only for words on screen: what is stored and named on disk is
    take_name()."""
    if title is None:
        return f"Take {take_number}"
    return f"{title}{_NO_BREAK}#{go or 1}"


def shown_from_name(name):
    """A name take_name() wrote, as shown_name() would write it: 'Polyn 3'
    -> 'Polyn #3'. 'Take 7', and a name with no number at its end, stay as
    they are. For a line that has kept only the name, such as a take on its
    way to the band service's trash."""
    name = name or ""
    if UNNAMED_TAKE.match(name):
        return name
    title, go = _split(_TRAILING_NUMBER, name)
    return name if go is None else shown_name(title, go, None)


def _split(pattern, name):
    name = (name or "").strip()
    match = pattern.match(name)
    if match and match.group(1).strip():
        return match.group(1).strip(), int(match.group(2))
    return name, None


def split_go(name):
    """'Polyn 3', 'Polyn #3' -> ('Polyn', 3); 'Polyn' -> ('Polyn', None).
    Trimmed."""
    return _split(_TYPED_GO, name)


def legacy_song(name):
    """
    The song an old take name was a go at, or None for a take nobody named.
    "Song 2" is a go at "Song" whether or not a song by that title was ever
    played: the old rule could not tell, and reading it any other way would
    change what old rehearsals say. The old number is not kept: goes are
    numbered afresh across the library.
    """
    name = (name or "").strip()
    if not name or UNNAMED_TAKE.match(name) or _RECOVERED_TAKE.match(name):
        return None
    return _split(_TRAILING_NUMBER, name)[0]
