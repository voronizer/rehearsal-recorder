"""
The places where the three operating systems differ.

Kept in one file on purpose. Scattering `if sys.platform` through the app is
how it ends up macOS-only again without anyone noticing — which is exactly
what happened here: the crash log reached for a signal Windows does not have,
and deleting a take reached for a folder only macOS has.

Nothing here is guesswork about behaviour that cannot be checked: each
function picks by what is actually present on the machine it is running on,
and says which way it went, so the interface can tell the truth rather than
promising a Trash that is not there.
"""

import os
import re
import shutil
import sys
from pathlib import Path

# Where deleted things go when the system offers no recycle bin we can reach.
# Inside the user's own folder, never hidden away somewhere they would not
# think to look.
FALLBACK_TRASH = "_deleted"

WINDOWS = sys.platform == "win32"
MACOS = sys.platform == "darwin"


# This file is src/rehearsal_recorder/platform_support.py, so the folder that
# holds ui/ is two levels up. Named here rather than computed by searching,
# because a search would quietly find the wrong folder; if the package is
# ever moved, this is the line that has to move with it.
_SOURCE_ROOT = Path(__file__).resolve().parents[2]


def app_root():
    """
    Where the app's own files live — the built interface, above all.

    Running from source that is the repository root, which is where ui/dist
    is built. Frozen into an executable it is the temporary folder PyInstaller
    unpacks into, which is what sys._MEIPASS points at; `__file__` there
    points somewhere that does not contain ui/dist, so it has to be asked for
    explicitly.
    """
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return Path(bundled)
    return _SOURCE_ROOT


def _send2trash():
    """The proper recycle bin, if the package is installed. Optional on
    purpose: without it the fallback below still never destroys anything."""
    try:
        from send2trash import send2trash as fn
    except Exception:
        return None
    return fn


def _system_trash_dir():
    """A trash folder we can move into directly, or None."""
    if MACOS:
        trash = Path.home() / ".Trash"
        return trash if trash.is_dir() else None
    if not WINDOWS:
        trash = Path.home() / ".local" / "share" / "Trash" / "files"
        return trash if trash.is_dir() else None
    # Windows has a recycle bin, but nothing a plain move can reach. That is
    # what send2trash is for; without it we use the fallback folder.
    return None


def trash_kind():
    """
    "system" — deleting reaches the real Trash or Recycle Bin.
    "folder" — it moves to a _deleted folder instead.

    The interface asks so that a confirmation can say what will actually
    happen, rather than promising a Trash this machine does not have.
    """
    if _send2trash() is not None or _system_trash_dir() is not None:
        return "system"
    return "folder"


def unique_path(path):
    """`name`, `name (2)`, `name (3)` — never overwrites what is there."""
    path = Path(path)
    if not path.exists():
        return path
    stem, suffix, parent = path.stem, path.suffix, path.parent
    n = 2
    while True:
        candidate = parent / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def move_to_trash(path, fallback_root=None):
    """
    Deleting is never destruction. A rehearsal recording cannot be made again,
    so this only ever moves things: to the system Trash when that is reachable,
    and otherwise into a _deleted folder the person can empty themselves.

    fallback_root: where that folder lives — normally the recordings folder,
    so deleted takes do not clutter the rehearsal they came from.

    Returns {"ok", "trashed", "location"}. trashed is True only for the real
    Trash, so nothing tells the person their file is somewhere it is not.
    """
    path = Path(path)
    if not path.exists():
        return {"ok": False, "error": "It is not there any more"}

    fn = _send2trash()
    if fn is not None:
        try:
            fn(str(path))
            return {"ok": True, "trashed": True, "location": None}
        except Exception as e:
            print(f"[trash] send2trash: {e}")

    system = _system_trash_dir()
    if system is not None:
        try:
            dest = unique_path(system / path.name)
            shutil.move(str(path), str(dest))
            return {"ok": True, "trashed": True, "location": str(dest)}
        except OSError as e:
            print(f"[trash] system trash: {e}")

    root = Path(fallback_root) if fallback_root else path.parent
    keep = root / FALLBACK_TRASH
    try:
        keep.mkdir(parents=True, exist_ok=True)
        dest = unique_path(keep / path.name)
        shutil.move(str(path), str(dest))
    except OSError as e:
        return {"ok": False, "error": f"Could not remove it: {e}"}
    return {"ok": True, "trashed": False, "location": str(dest)}


# Windows will not have a file or folder by these names, whatever the
# extension, and a name ending in a dot or a space is refused as well. Someone
# calling a song "AUX" or "Con" is unlikely but not impossible, and the failure
# would be baffling.
_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def safe_filename(name, fallback="untitled"):
    """
    A name that is legal on all three systems.

    Everything outside letters, digits, space, dash, underscore and brackets
    becomes an underscore — that covers the characters Windows forbids
    (\\ / : * ? " < > |) as well as the slash that would break a path anywhere.

    Then the tidying, which matters more than it looks. Runs of underscores
    collapse, so `So:ng<1>` becomes `So_ng_1` rather than `So_ng_1__`. Leading
    and trailing dots, spaces and underscores go — Windows refuses a name
    ending in a dot or a space, and a name made of nothing but punctuation
    would otherwise become a folder called `___`, which helps nobody find it.
    """
    keep = "".join(c if c.isalnum() or c in " -_()" else "_" for c in name)
    keep = re.sub(r"_{2,}", "_", keep)
    keep = keep.strip(" ._")
    if not keep:
        return fallback
    if keep.upper() in _RESERVED:
        keep = f"{keep}_"
    return keep


def describe_path_limit(path):
    """
    Windows refuses paths past 260 characters unless long paths are enabled.
    Deep rehearsal folders with long track names can reach that, and the error
    when they do says nothing useful, so it is worth checking up front.

    Returns a sentence when the path is close to the limit, otherwise None.
    """
    if not WINDOWS:
        return None
    length = len(str(Path(path).absolute()))
    if length < 200:
        return None
    return (
        f"This folder's path is already {length} characters. Windows stops at "
        "260, and take and track names are added on top — a shorter "
        "recordings folder would be safer."
    )


def open_in_file_manager(path):
    """Shows a folder in Finder, Explorer or whatever the desktop uses."""
    path = str(path)
    try:
        if MACOS:
            os.system(f'open "{path}"')
        elif WINDOWS:
            os.startfile(path)  # noqa: S606 - the platform's own opener
        else:
            os.system(f'xdg-open "{path}"')
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
