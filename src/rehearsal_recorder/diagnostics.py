"""
What Settings › Under the hood says about the machine, and the text its Copy
details button puts on the clipboard.

Everything here is asked of the machine as it is at that moment rather than
remembered: the page is opened when something has gone wrong, and a report
that describes how things were at start-up would be describing a different
machine from the one in trouble.
"""

import platform as _platform

from rehearsal_recorder.audio.probe import SIGNAL_PEAK
from rehearsal_recorder.platform_support import APP_NAME

# Windows' own names for its editions, as its About box says them.
_EDITIONS = {"Professional": "Pro", "Core": "Home", "CoreSingleLanguage": "Home"}
_MACHINES = {"AMD64": "x64", "x86_64": "x64", "ARM64": "ARM64", "arm64": "arm64"}


def system_line(pf=_platform):
    """The system in one line: "Windows 11 Pro 10.0.26200, x64",
    "macOS 15.1, arm64"."""
    try:
        machine = pf.machine()
        arch = _MACHINES.get(machine, machine)
        name = pf.system()
        if name == "Windows":
            release, version = pf.win32_ver()[:2]
            edition = pf.win32_edition() or ""
            edition = _EDITIONS.get(edition, edition)
            parts = [p for p in ("Windows", release, edition, version) if p]
            return f"{' '.join(parts)}, {arch}"
        if name == "Darwin":
            return f"macOS {pf.mac_ver()[0]}, {arch}"
        return f"{pf.platform()}, {arch}"
    except Exception as e:  # noqa: BLE001 — a page that says too little beats none
        return f"unknown ({e})"


def engine_line(sd):
    """PortAudio's own name for itself, less the "revision unknown" that
    every wheel's build carries and nobody can act on."""
    try:
        text = sd.get_portaudio_version()[1]
    except Exception:  # noqa: BLE001
        return None
    return text.replace(", revision unknown", "")


def audio_systems(host_apis, devices):
    """Each audio system PortAudio found, in its order, with how many devices
    it lists — inputs and outputs both, since that is what "is ASIO even
    there" is asking."""
    counts = [0] * len(host_apis)
    for d in devices:
        api = d.get("hostapi", -1)
        if 0 <= api < len(counts):
            counts[api] += 1
    return [{"name": h["name"], "devices": n} for h, n in zip(host_apis, counts)]


def tracks_line(tracks):
    """ "Drums on input 1, Keys on inputs 4–5 (stereo)". The input is said
    in words: a track called "Guitar 1" on input 1 read as "Guitar 1 1"."""
    said = []
    for t in tracks:
        channel = t.get("channel")
        if channel is None:
            said.append(f"{t['name']} on no input")
        elif t.get("stereo"):
            said.append(f"{t['name']} on inputs {channel}–{channel + 1} (stereo)")
        else:
            said.append(f"{t['name']} on input {channel}")
    return ", ".join(said) or "none"


def check_line(check):
    """The last check of the interface, in a line, or None if there was none."""
    if not check or check.get("running") or not check.get("checked_at"):
        return None
    when = check["checked_at"][11:16]
    if check.get("stopped"):
        return f"Last check of the interface, {when}: stopped before it finished"
    verdict = check.get("verdict") or {}
    if verdict.get("cause") == "none":
        if not any(p > SIGNAL_PEAK for p in check.get("peaks") or []):
            # The card is fine and the band is not in it: nothing plugged
            # in, or the card's routing sends the inputs somewhere else.
            return (f"Last check of the interface, {when}: opens and sends, but "
                    f"every input was silent")
        return f"Last check of the interface, {when}: works; {check.get('signal')}"
    return f"Last check of the interface, {when}: {verdict.get('headline', 'did not work')}"


def deleting_line(hood):
    """Where a deleted take goes on this machine, by its own name for it."""
    if hood.get("deleting") != "system":
        return f"the {hood.get('fallback_trash', '_deleted')} folder in the recordings"
    return "the Recycle Bin" if hood.get("system", "").startswith("Windows") else "the Trash"


def report_text(hood, tracks, cloud, check):
    """
    The text for a bug report, from what under_the_hood() said, the band on
    the card's inputs, a line about the cloud, and the last check. Plain
    lines, so it survives being pasted anywhere.
    """
    audio = hood["audio"]
    rec = audio.get("recording")
    running = "the built app" if hood["running_as"] == "built" else "run from source"
    lines = [
        f"{APP_NAME} {hood['version']}, {running}",
        hood["system"],
        "",
    ]
    if rec:
        lines.append(
            f"Recording with: {rec['name']} — {rec['host_api']}, {rec['inputs']} "
            f"inputs, {rec['samplerate']} Hz, {rec['bit_depth']} bit"
            + (" (not plugged in)" if rec.get("missing") else ""))
    else:
        lines.append("Recording with: nothing chosen")
    lines.append(f"Tracks: {tracks_line(tracks)}")
    lines.append(f"Playback: {audio.get('playback') or 'System output'}")
    lines.append(f"Audio engine: {audio.get('engine') or 'unknown'}")
    systems = ", ".join(f"{s['name']} ({s['devices']})" for s in audio.get("systems", []))
    lines.append(f"Audio systems: {systems or 'none found'}")
    said = check_line(check)
    if said:
        lines += ["", said]
    lines += [
        "",
        f"Cloud: {cloud}",
        "Deleting: " + deleting_line(hood),
        "",
    ]
    names = {"settings": "Settings", "history": "History", "crash_log": "Crash log"}
    for f in hood.get("files", []):
        where = f["path"] + ("" if f.get("exists") else " (not there)")
        lines.append(f"{names.get(f['key'], f['key'])}: {where}")
    return "\n".join(lines) + "\n"
