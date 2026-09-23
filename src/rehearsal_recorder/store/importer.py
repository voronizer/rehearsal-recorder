"""
Bringing session.json files into the database.

Up to this version every rehearsal folder described itself in a session.json.
Each one is read once, put into the database in one transaction and then
deleted. It runs every time a recordings folder is opened, not just the
first, so a rehearsal copied in from a machine still on an older version is
picked up as well.

This is the only place that still has to guess at old shapes: fields added
over the years are filled in here with what they meant before they existed,
and everything past it reads complete rows.
"""

import json
import logging
import sys
from pathlib import Path

from rehearsal_recorder.audio.format import LEGACY_DEPTH
from rehearsal_recorder.store.library import as_marker

SESSION_FILE = "session.json"

log = logging.getLogger(__name__)


def read_text(path):
    """
    A JSON file of ours, as text. Written as UTF-8 now; an older version wrote
    whatever the system's code page was, which on Windows is cp1252 — so a
    file that is not UTF-8 is read that way rather than taken for damaged.
    Read as damaged, a rehearsal with a "Café" in it would simply vanish from
    History.
    """
    raw = Path(path).read_bytes()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def _inside(path, root):
    try:
        return Path(path).resolve().relative_to(Path(root).resolve())
    except ValueError:
        return None


def _track_file(folder, stored):
    """
    Where a take's track is now. Paths were stored absolute, so a folder
    renamed or moved by hand left them pointing at where it used to be; the
    take's own folder and the file's name are still right, so it is found
    again from those.
    """
    stored = Path(stored)
    if _inside(stored, folder) is not None:
        return str(stored)
    return str(Path(folder) / stored.parent.name / stored.name)


def _cloud(record, cloud_dir):
    """An old take["cloud"], or None when it cannot be kept: no cloud folder
    is set, or the copy is not inside the one that is."""
    if not record or cloud_dir is None:
        return None
    for key in ("mix", "tracks"):
        if record.get(key) and _inside(record[key], cloud_dir) is None:
            return None
    if not (record.get("mix") or record.get("tracks")):
        return None
    source = dict(record.get("source") or {})
    if source.get("dir"):
        # The absolute destination became the rehearsal's subfolder.
        source["dir"] = Path(source["dir"]).name
    return {**record, "source": source}


def _take(folder, take):
    return {
        "take_number": int(take.get("take_number", 0)),
        "name": take.get("name") or f"Take {take.get('take_number', 0)}",
        "duration_sec": float(take.get("duration_sec") or 0.0),
        "tracks": [
            {"name": t.get("name", ""), "file": _track_file(folder, t["file"])}
            for t in take.get("tracks", [])
            if t.get("file")
        ],
        "markers": [as_marker(m) for m in take.get("markers", [])],
        "cloud_skip": bool(take.get("cloud_skip")),
        "cloud_send": bool(take.get("cloud_send")),
    }


def import_folder(library, folder, cloud_dir):
    """
    One rehearsal folder's session.json into the database. Returns "imported",
    "cleaned" (it was already in: the app died before deleting the file, or
    could not delete it),
    "absent", or raises for a file that cannot be read — which is left where
    it is.
    """
    folder = Path(folder)
    path = folder / SESSION_FILE
    if not path.exists():
        return "absent"
    if library.has(folder):
        _remove_after_import(folder)
        return "cleaned"

    meta = json.loads(read_text(path))
    takes = [t for t in meta.get("takes", []) if isinstance(t, dict)]
    library.import_rehearsal(
        folder,
        name=meta.get("name") or folder.name,
        created_at=meta.get("created_at", ""),
        samplerate=int(meta.get("samplerate") or 48000),
        bit_depth=int(meta.get("bit_depth") or LEGACY_DEPTH),
        tracks=[
            {"name": t.get("name", ""), "channel": int(t.get("channel", 1))}
            for t in meta.get("tracks", [])
        ],
        takes=[_take(folder, t) for t in takes],
        cloud={
            int(t.get("take_number", 0)): c
            for t in takes
            if (c := _cloud(t.get("cloud"), cloud_dir)) is not None
        },
        cloud_errors={
            int(t.get("take_number", 0)): t["cloud_error"]
            for t in takes
            if t.get("cloud_error")
        },
        cloud_dir=cloud_dir,
    )
    _remove_after_import(folder)
    return "imported"


def _remove(folder):
    for name in (SESSION_FILE, SESSION_FILE + ".writing"):
        (Path(folder) / name).unlink(missing_ok=True)


def _remove_after_import(folder):
    """
    The file once its rehearsal is in the database. Failing to delete it (a
    sync client or a virus scanner holding it, say) is not a failed import:
    the history is in, and the next pass finds it there and deletes the file
    then — so it is a warning, not the "could not read" the interface shows.
    """
    try:
        _remove(folder)
    except OSError as e:
        log.warning(
            "imported %s, but could not remove its %s (%s); it will be removed "
            "next time", folder, SESSION_FILE, e,
        )


def import_all(library, cloud_dir, report=None):
    """
    Every session.json directly under the recordings folder. A file that
    cannot be read is left in place for next time and passed to
    report(folder, error); the rest still go in.
    """
    root = library.recordings_dir
    if not root.is_dir():
        return {"imported": 0, "failed": 0}
    imported = failed = 0
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        try:
            if import_folder(library, folder, cloud_dir) == "imported":
                imported += 1
        except Exception as e:
            failed += 1
            print(f"[import] {folder}: {type(e).__name__}: {e}", file=sys.stderr)
            if report is not None:
                report(folder, e)
    return {"imported": imported, "failed": failed}
