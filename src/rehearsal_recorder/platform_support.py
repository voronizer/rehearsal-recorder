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

# Where the app writes what every thread was doing if it dies hard — see
# app._arm_crash_log. Here so the window can say where it is too.
CRASH_LOG = Path.home() / ".rehearsal-recorder" / "crash.log"


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


# Who the app is to the Windows taskbar, when it is not an .exe of its own.
APP_ID = "Voronizer.RehearsalRecorder"


def claim_taskbar_identity(system=sys.platform, frozen=None, shell32=None):
    """
    Run from source, the program is python.exe, and the taskbar groups the
    window under it with Python's icon, whatever the window's own icon says.
    Saying the process is an app of its own makes the taskbar use the
    window's icon. Before any window is made, or the taskbar has already
    decided. A built app is its own .exe with its own icon already, and
    giving it an id would part it from a pinned shortcut to it.
    """
    if frozen is None:
        frozen = bool(getattr(sys, "_MEIPASS", None))
    if system != "win32" or frozen:
        return None
    try:
        if shell32 is None:
            import ctypes

            shell32 = ctypes.windll.shell32
        shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
        return APP_ID
    except Exception as e:  # noqa: BLE001 — a Python icon is no reason not to start
        print(f"[taskbar] {e}")
        return None


def window_icon(system=sys.platform, frozen=None):
    """
    The icon to give the window, or None to leave it to the toolkit.

    A built app needs none: the window takes its .exe's icon, which the build
    set. Run from source on Windows, the program is python.exe, so without
    this the taskbar shows the Python logo; the .ico beside the build spec is
    the app's own. Elsewhere the toolkit does not use what it is given here.
    """
    if frozen is None:
        frozen = bool(getattr(sys, "_MEIPASS", None))
    if system != "win32" or frozen:
        return None
    icon = _SOURCE_ROOT / "packaging" / "icon.ico"
    return str(icon) if icon.exists() else None


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


def reveal_in_file_manager(path, system=sys.platform, run=None):
    """
    Opens the folder a file is in, with the file picked out — Explorer's
    /select, Finder's reveal — so "send me the crash log" is one step. Where
    the desktop has no such thing, the folder it is in.

    `run` takes the command; by default it is started and not waited for.
    """
    import subprocess

    path = str(path)
    if system == "win32":
        # A string, not a list: Explorer wants /select,"path" as it stands,
        # and a list would have Python quote the whole argument instead.
        command = f'explorer /select,"{path}"'
    elif system == "darwin":
        command = ["open", "-R", path]
    else:
        command = ["xdg-open", os.path.dirname(path)]
    try:
        (run or subprocess.Popen)(command)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


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


# CoInitializeEx's mode for a single-threaded apartment, from objbase.h.
COINIT_APARTMENTTHREADED = 0x2


def enter_com_apartment(platform=sys.platform, ole32=None):
    """
    Joins the calling thread to a COM single-threaded apartment, on Windows.
    Returns None, or a sentence when it could not. Never raises: the thread
    that calls it is the one every card is opened from, and a thread that
    died here would leave every later opening waiting for it.

    An ASIO driver is a COM object, and PortAudio loads it on whichever
    thread asks for a stream — but a thread that has not joined an apartment
    cannot load one, and all PortAudio says then is "Failed to load ASIO
    driver". It joins one itself only for the thread that starts it, and
    leaves the rest to the caller. pywebview answers every interface call on
    a fresh thread that has joined nothing, so no ASIO stream opened from the
    app at all. The main thread would not show it, being the one PortAudio
    joined when it started, which is why `--audio-probe` opens through the
    audio thread like everything else.

    Single-threaded, not multithreaded, on purpose: ASIO drivers register as
    apartment-threaded, and one created from a multithreaded apartment is put
    in another thread and handed back through a proxy that ASIO's interface
    has no way to make. It is the apartment PortAudio itself picks.

    Already being in one (S_FALSE) is as good as joining. There is no
    matching CoUninitialize: the thread lives as long as the app, and leaving
    the apartment would unload the driver of any stream still open.
    """
    if platform != "win32":
        return None
    try:
        if ole32 is None:
            import ctypes

            ole32 = ctypes.windll.ole32
        result = ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
    except Exception as e:
        return f"COM could not be reached, so ASIO cards will not open: {e}"
    if result < 0:
        return (
            "This thread could not join a COM apartment "
            f"(0x{result & 0xFFFFFFFF:08X}), so ASIO cards will not open."
        )
    return None
