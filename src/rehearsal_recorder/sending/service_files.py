"""
What a take is made into for the band service: its details, as the
service's TakeMeta has them, and its files. Each track goes as an MP3, which
the band's pages play, a FLAC, the original to download, and a waveform the
pages draw without decoding anything; each .mid goes as it is. No mix: the
pages mix the tracks with the take's balance.

The names are the service's: `<position>.mp3`, `.flac` and `.peaks` for the
audio tracks, numbered from 1 in the take's order, then `<position>.mid` for
its notes, numbered on from there.
"""

import json
import math
import os
import shutil
import uuid
from pathlib import Path

from rehearsal_recorder.audio.encode import encode
from rehearsal_recorder.audio.waveform import wav_peaks

# How many numbers a waveform has: the same for a take of a minute or of
# ten, which the pages stretch to their width.
PEAKS = 1200

# The signatures the service takes, as the metronome has them.
# The most bars the service keeps for a take: an hour at 240 a minute is 3600 of 4/4.
MAX_BARS = 20000
SIGNATURES = ("4/4", "3/4", "2/4", "6/8")


class CannotMake(Exception):
    """A file of the take could not be made; the words say why."""


class Stopped(Exception):
    """`stop` said so while an MP3 or FLAC was being made: nothing of it is
    left, and it is made again from its start next time."""


def rehearsal_uid(ref):
    """
    What the service knows a rehearsal by, from when it was made and its
    row's id (Library.rehearsal_ref): the same every time it is asked, so it
    needs no table of its own, and an Undo that brings the rehearsal back
    brings back the same one.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"reha-rehearsal:{ref['created_at']}:{ref['id']}"))


def _audio(take):
    return [t for t in take.get("tracks") or [] if t.get("file")]


def _notes(take):
    return [n for n in take.get("notes") or [] if n.get("file")]


def names(take):
    """
    Where each part of the take goes, as `plan` names its files:
    {"tracks": {name: position}, "notes": {name: "<position>.mid"}}. A track
    with no file has no position, and nothing of it goes.
    """
    audio = _audio(take)
    return {"tracks": {t["name"]: i for i, t in enumerate(audio, 1)},
            "notes": {n["name"]: f"{len(audio) + i}.mid" for i, n in enumerate(_notes(take), 1)}}


def plan(take, kinds):
    """
    The take's files of the kinds asked for, in the order they go up: every
    MP3, then every waveform, then each .mid, then every FLAC.
    [{"name", "kind", "source"}], `source` the WAV or .mid it is made from.
    """
    audio = _audio(take)
    out = []
    for kind in ("mp3", "peaks", "mid", "flac"):
        if kind not in kinds:
            continue
        if kind == "mid":
            out += [{"name": f"{len(audio) + i}.mid", "kind": kind, "source": n["file"]}
                    for i, n in enumerate(_notes(take), 1)]
        else:
            out += [{"name": f"{i}.{kind}", "kind": kind, "source": t["file"]}
                    for i, t in enumerate(audio, 1)]
    return out


def meta(take, rehearsal, labels, volumes, gen, cut_start, tempo=None):
    """
    The take's details as PUT /api/reha/takes/:uid takes them. `rehearsal`
    is {"id", "created_at", "name"}; `labels` the labels by id, for the
    marks' words and colours; `volumes` the faders by track name, which are
    the balance the band hears the take at; `tempo` the song's tempo, None
    when it has none.
    """
    audio = _audio(take)
    by_id = {label["id"]: label for label in labels}
    marks = []
    for m in take.get("markers") or []:
        label = by_id.get(m.get("label_id")) or {}
        marks.append({"at": round(float(m["at"]), 2), "label": label.get("name") or "",
                      "colour": label.get("colour") or "grey", "note": m.get("note") or ""})
    return {
        "rehearsal": {"uid": rehearsal_uid(rehearsal), "name": rehearsal["name"],
                      "date": str(rehearsal["created_at"])[:10]},
        "number": int(take["take_number"]),
        "name": take["name"],
        "song": take.get("song") or None,
        "duration_sec": round(float(take.get("duration_sec") or 0), 2),
        "gen": int(gen),
        # Below 0 when a crop was undone and the start put back.
        "cut_start": round(float(cut_start or 0), 2),
        "starred": bool(take.get("starred")),
        "balance": {t["name"]: float(volumes.get(t["name"], 1.0)) for t in audio},
        "tracks": [{"position": i, "name": t["name"], "icon": t.get("icon"),
                    "files": [f"{i}.mp3", f"{i}.flac", f"{i}.peaks"]}
                   for i, t in enumerate(audio, 1)],
        "notes": [{"position": len(audio) + i, "name": n["name"], "file": f"{len(audio) + i}.mid",
                   "icon": n.get("icon")}
                  for i, n in enumerate(_notes(take), 1)],
        "marks": marks,
        "tempo": None if tempo is None else float(tempo),
        "meter": meter(take),
    }


def meter(take):
    """The take's click as the service keeps it, for the stripes along
    Master's lane: its tempo and signature, or neither, and whether it was
    recorded to the click."""
    tempo, signature = take.get("tempo"), take.get("signature")
    if (isinstance(tempo, bool) or not isinstance(tempo, (int, float)) or not 0 < tempo <= 999
            or signature not in SIGNATURES):
        tempo = signature = None
    return {"tempo": None if tempo is None else float(tempo), "signature": signature,
            "click": bool(take.get("click")) and tempo is not None}


def drift(answer):
    """
    The band's tempo through a take as Api.take_drift answered it, the way
    the service keeps it: the times to a millisecond and the tempos to a
    hundredth, so an hour's bars stay small. None for an answer that is not
    the take's to keep: a count Record stopped, one that could not read the
    take's files (they may be back later), or one the service would not take.
    """
    if not isinstance(answer, dict):
        return None
    if not answer.get("ok"):
        why = answer.get("why")
        return {"ok": False, "why": why} if why in ("short", "no-beat") else None

    def tempo(t):
        return round(float(t), 2) if t is not None and math.isfinite(t) and t > 0 else None

    def time(t):
        t = float(t)
        if not math.isfinite(t) or t < 0:
            raise ValueError(t)
        return round(t, 3)

    try:
        aim = answer["aim"]
        middle, aimed = float(answer["middle"]), float(aim["tempo"])
        bars = answer["bars"]
        if not (math.isfinite(middle) and middle > 0 and math.isfinite(aimed) and aimed > 0) or len(bars) > MAX_BARS:
            return None
        return {
            "ok": True,
            "source": answer["source"],
            "per_bar": answer["per_bar"],
            "middle": round(middle, 2),
            "aim": {"tempo": aimed, "signature": aim["signature"], "from": aim["from"], "song": aim.get("song")},
            "bars": [{"n": int(b["n"]), "start": time(b["start"]), "end": time(b["end"]), "tempo": tempo(b["tempo"])}
                     for b in bars],
        }
    except (KeyError, TypeError, ValueError, OverflowError):
        return None


def make(item, dst, stop=None):
    """
    One file of the plan, written at `dst`. The WAV it is made from stays
    as it is: the encoder removes what it encodes, so it is handed a copy.
    Raises CannotMake when the file cannot be made as the service needs it.

    `stop()`, when given, is asked between blocks of an MP3 or FLAC: true,
    and the file is given up and Stopped raised. A waveform or a .mid is
    made at once and not asked.
    """
    source = Path(item["source"])
    if not source.exists():
        raise CannotMake(f"A file of the take is missing: {source.name}")
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    kind = item["kind"]
    if kind == "mid":
        shutil.copyfile(source, dst)
        return
    if kind == "peaks":
        rows, _, _ = wav_peaks(source, buckets=PEAKS)
        peaks = [round(float(max(column)), 3) for column in zip(*rows)] if rows else [0.0] * PEAKS
        writing = dst.with_name(dst.name + ".writing")
        writing.write_text(json.dumps({"peaks": peaks}), encoding="utf-8")
        os.replace(writing, dst)
        return
    copy = dst.with_name(dst.name + ".wav")
    shutil.copyfile(source, copy)
    done = encode(copy, kind, dst, stop=stop)
    if done.get("stopped"):
        copy.unlink(missing_ok=True)
        raise Stopped()
    if done.get("format") != kind:
        copy.unlink(missing_ok=True)
        raise CannotMake(done.get("note") or f"Could not make the {kind.upper()}")
