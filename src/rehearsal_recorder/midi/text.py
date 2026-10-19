"""Bounded ASCII presentation metadata, separate from LCD hardware drivers."""
import unicodedata


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
    # beyond the LCD's 16-character window.
    number = state.get("take_number") if state.get("take_name") else state.get("playback_take_number")
    if number is not None:
        name = f"T{number} {name}"
    status = state["state"].upper()
    elapsed = state.get("elapsed", 0)
    if state["state"] in ("recording", "playing"):
        minutes, seconds = divmod(max(0,int(elapsed)), 60)
        status += f" {minutes:02d}:{seconds:02d}"
    return ascii_row(name), ascii_row(status)
