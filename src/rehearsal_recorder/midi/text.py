"""Bounded ASCII presentation metadata, separate from LCD hardware drivers."""
import unicodedata

from rehearsal_recorder.store.names import UNNAMED_TAKE, split_go


def ascii_row(value):
    text = str(value or "").translate(str.maketrans({"Ł":"L", "ł":"l"}))
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).encode("ascii", "replace").decode("ascii")
    return "".join(c if 32 <= ord(c) <= 126 else " " for c in text)[:32]


def row_frames(index, text):
    chars = [ord(c) for c in ascii_row(text)]
    return [(100,index), (101,len(chars)), *[(102,c) for c in chars], (103,(index+len(chars)+sum(chars))&127)]


def display_rows(state):
    name = state.get("take_name") or state.get("playback_take_name") or state.get("next_take_name") or "Rehearsal recorder"
    # Put selection identity first: long song names must not hide take changes
    # beyond the LCD's 16-character window. It is the take's own number, the
    # one the app shows after a #: "#3 Polyn", or "#47 Take" for a take with
    # no song. Its place in the rehearsal is shown nowhere.
    go = state.get("take_go") if state.get("take_name") else state.get("playback_take_go")
    if go is not None and (state.get("take_name") or state.get("playback_take_name")):
        name = f"#{go} {'Take' if UNNAMED_TAKE.match(name) else name}"
    elif UNNAMED_TAKE.match(name):
        # The next take, nobody named yet, as the name field holds it: "Take 47".
        go = split_go(name)[1]
        if go is not None:
            name = f"#{go} Take"
    status = state["state"].upper()
    elapsed = state.get("elapsed", 0)
    if state["state"] in ("recording", "playing"):
        minutes, seconds = divmod(max(0,int(elapsed)), 60)
        status += f" {minutes:02d}:{seconds:02d}"
    return ascii_row(name), ascii_row(status)
