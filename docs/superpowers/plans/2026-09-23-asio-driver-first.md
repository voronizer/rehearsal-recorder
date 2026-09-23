# ASIO and driver-first device choice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ASIO available on Windows, store device choices by identity so they survive renumbering, and let Settings choose a driver before a device, for recording and for playback.

**Architecture:** `SD_ENABLE_ASIO` is set in the package `__init__` before any `sounddevice` import. `audio/devices.py` gains two pure helpers — one that describes a device as `{name, host_api}`, one that turns a saved choice back into the current index — and `api.py` uses them wherever a choice is saved or read. The interface keeps talking in indices; a new `DevicePicker` component groups them by driver.

**Tech Stack:** Python 3.12, sounddevice 0.5.x, pywebview; React + TypeScript + Radix Select (shadcn); tests are plain scripts (`tests/run_all.py`), the interface suite drives `ui/dist` through Playwright against a mocked bridge.

**Spec:** `docs/superpowers/specs/2026-09-23-asio-driver-first-design.md`

## Global Constraints

- `SD_ENABLE_ASIO` is set only on `win32`, with `os.environ.setdefault`, before any import of `sounddevice`.
- No setting for ASIO; no restart prompt.
- Config keys: `device_index` + `device` (recording), `output_device_index` + `output_device` (playback). Identity shape: `{"name": str, "host_api": str}`.
- A config with only an index is treated as not chosen on Windows, used as-is elsewhere.
- The driver select appears only when more than one driver has a device for that direction.
- The duplicates note is replaced by exactly: "Each driver can offer a different number of inputs. If your interface shows fewer than it has, try another driver — ASIO, where there is one, usually offers all of them." — shown only with several drivers, recording only.
- `#input-device` and `#output-device` remain the ids of the device selects; driver selects are `#input-device-driver` and `#output-device-driver`.
- Commits end with the attribution lines from the session; the PR says `Refs #3`, never `Closes #3`.

---

### Task 0: Test environment

No venv, no `ui/node_modules`, no Playwright on this machine. Put the venv in the session scratchpad, not the repo.

- [ ] **Step 1: Python dependencies**

```bash
SCRATCH=/c/Users/voronische/AppData/Local/Temp/claude/C--Users-voronische-Documents-GitHub-voronizer-rehearsal-recorder/f811f0cd-b619-493c-b010-f7baaff62ac4/scratchpad
$SCRATCH/venv/Scripts/python -m pip install -q -r requirements.txt playwright
$SCRATCH/venv/Scripts/python -m playwright install chromium
```

- [ ] **Step 2: Interface build**

```bash
cd ui && npm ci && npm run build
```

- [ ] **Step 3: Baseline — every suite green before any change**

```bash
$SCRATCH/venv/Scripts/python tests/run_all.py
```

Expected: all three suites pass. If not, stop and report; do not fix unrelated failures inside this plan.

---

### Task 1: ASIO on Windows, and the self-test checks it

**Files:**
- Modify: `src/rehearsal_recorder/__init__.py`
- Modify: `src/rehearsal_recorder/app.py` (`selftest`, after `check("audio engine", audio)`)
- Test: `tests/test_platform.py`

**Interfaces:**
- Produces: `rehearsal_recorder.enable_asio(platform: str, environ: MutableMapping[str, str]) -> None`

- [ ] **Step 1: Failing test** — append a section to `main()` in `tests/test_platform.py`, before the final summary, numbered after the last existing section:

```python
    print("\n[N] ASIO is switched on where it exists")
    from rehearsal_recorder import enable_asio

    env = {}
    enable_asio("win32", env)
    ok("on Windows the ASIO build of PortAudio is asked for",
       env.get("SD_ENABLE_ASIO") == "1")

    env = {}
    enable_asio("darwin", env)
    ok("elsewhere nothing is set — there is no ASIO there",
       "SD_ENABLE_ASIO" not in env)

    env = {"SD_ENABLE_ASIO": "0"}
    enable_asio("win32", env)
    ok("a value someone set by hand is left alone",
       env["SD_ENABLE_ASIO"] == "0")
```

- [ ] **Step 2: Run, expect FAIL** — `python tests/test_platform.py` → ImportError on `enable_asio`.

- [ ] **Step 3: Implement** — in `src/rehearsal_recorder/__init__.py`, after the docstring and before the version `try`:

```python
import os
import sys


def enable_asio(platform, environ):
    """
    Ask sounddevice for its PortAudio built with ASIO, on Windows.

    The pip wheel ships two PortAudio DLLs on Windows and loads the one
    without ASIO unless SD_ENABLE_ASIO is set before `sounddevice` is first
    imported. Without ASIO a multichannel mixer is offered through MME or
    WASAPI with a fraction of its inputs (#3). This module is the one place
    that runs before that import for every way of starting the app.

    Worth knowing before touching it:
      - it only works with the pip-installed PortAudio; conda-forge's has no
        ASIO at all, so do not "simplify" the build onto conda;
      - a custom portaudio.dll on %PATH% defeats it without a word;
      - the cost is accepted on purpose: with the ASIO DLL, importing
        sounddevice briefly interrupts whatever else is playing when the
        output has exclusive mode on (python-sounddevice #496). That lands
        once, at launch, in an app people open in order to record.
    """
    if platform == "win32":
        environ.setdefault("SD_ENABLE_ASIO", "1")


enable_asio(sys.platform, os.environ)
```

- [ ] **Step 4: Self-test check** — in `app.py` `selftest`, define beside `audio()`:

```python
    def asio():
        import sounddevice as sd

        names = [h["name"] for h in sd.query_hostapis()]
        if "ASIO" not in names:
            raise RuntimeError(
                "PortAudio without ASIO — multichannel interfaces will be "
                f"offered with too few inputs (found: {', '.join(names)})"
            )
        return "present"
```

and after `check("audio engine", audio)`:

```python
    # Checks the ASIO DLL reached the bundle. It needs no ASIO driver on the
    # machine: the host API is listed, with no devices, even without one.
    if sys.platform == "win32":
        check("ASIO", asio)
```

- [ ] **Step 5: Run** — `python tests/test_platform.py` → PASS. Then on this Windows machine, from the scratch venv, `python -m rehearsal_recorder --selftest` → an `ok   ASIO — present` line (needs `pip install -e .` into the venv or `PYTHONPATH=src`).

- [ ] **Step 6: Commit** — `git add src/rehearsal_recorder/__init__.py src/rehearsal_recorder/app.py tests/test_platform.py` — message: "Load the ASIO build of PortAudio on Windows" + body "Refs #3" + attribution.

---

### Task 2: Device identity and resolving a saved choice

**Files:**
- Modify: `src/rehearsal_recorder/audio/devices.py`
- Test: `tests/test_engine.py` (new section after `[4c]`)

**Interfaces:**
- Produces:
  - `device_identity(index: int | None) -> dict | None` — `{"name", "host_api"}` of that device, `None` for `None` or an index PortAudio does not know.
  - `saved_device(config: dict, key: str, want_input: bool, platform: str = sys.platform) -> int | None` — reads `config[key + "_index"]` and `config[key]`.

- [ ] **Step 1: Failing test** — add after `[4c]` in `tests/test_engine.py`:

```python
    print("\n[4d] A saved device is found again after the list moves")
    from rehearsal_recorder.audio.devices import device_identity, saved_device

    # The shape Windows takes once ASIO is loaded: the same mixer through
    # three systems, ASIO inserted in the middle so later indices shift.
    win_apis = [{"name": "MME"}, {"name": "ASIO"}, {"name": "Windows WASAPI"}]
    win_devices = [
        {"name": "X32", "hostapi": 0, "max_input_channels": 2,
         "max_output_channels": 2, "default_samplerate": 48000},
        {"name": "X32", "hostapi": 1, "max_input_channels": 16,
         "max_output_channels": 16, "default_samplerate": 48000},
        {"name": "X32", "hostapi": 2, "max_input_channels": 8,
         "max_output_channels": 2, "default_samplerate": 48000},
        {"name": "X32", "hostapi": 2, "max_input_channels": 8,
         "max_output_channels": 2, "default_samplerate": 48000},
    ]
    real_q, real_h = _sd.query_devices, _sd.query_hostapis
    _sd.query_hostapis = lambda: win_apis
    _sd.query_devices = (
        lambda index=None, kind=None:
        win_devices if index is None else win_devices[index]
    )
    try:
        ok("a device is described by name and audio system",
           device_identity(2) == {"name": "X32", "host_api": "Windows WASAPI"})
        ok("nothing chosen describes as nothing", device_identity(None) is None)
        ok("an unknown index describes as nothing", device_identity(99) is None)

        # Saved as WASAPI when it was index 1, before ASIO pushed it along.
        cfg = {"device_index": 1,
               "device": {"name": "X32", "host_api": "Windows WASAPI"}}
        ok("it is found by name and system, not by the old index",
           saved_device(cfg, "device", True, "win32") == 2)

        cfg = {"device_index": 3,
               "device": {"name": "X32", "host_api": "Windows WASAPI"}}
        ok("of two identical cards the stored index still picks one",
           saved_device(cfg, "device", True, "win32") == 3)

        cfg = {"device_index": 0,
               "device": {"name": "Behringer", "host_api": "ASIO"}}
        ok("a card that is not plugged in is not chosen",
           saved_device(cfg, "device", True, "win32") is None)

        ok("on Windows an index with no name is not trusted",
           saved_device({"device_index": 2}, "device", True, "win32") is None)
        ok("elsewhere it is used as before",
           saved_device({"device_index": 2}, "device", True, "darwin") == 2)
        ok("nothing saved is nothing chosen",
           saved_device({}, "device", True, "win32") is None)
        ok("the output is read from its own keys",
           saved_device({"output_device_index": 5,
                         "output_device": {"name": "X32", "host_api": "ASIO"}},
                        "output_device", False, "win32") == 1)
    finally:
        _sd.query_devices, _sd.query_hostapis = real_q, real_h
```

- [ ] **Step 2: Run, expect FAIL** — `python tests/test_engine.py` → ImportError on `device_identity`.

- [ ] **Step 3: Implement** — in `audio/devices.py`, add `import sys` to the imports, extend the module docstring's second paragraph with one sentence ("…so a saved choice is kept as the device's name and audio system beside its index, and found again by those."), and add:

```python
def _host_api_name(device):
    try:
        return sd.query_hostapis()[device["hostapi"]]["name"]
    except Exception:
        return ""


def device_identity(index):
    """What a device is, rather than where it happens to be in the list:
    {"name": ..., "host_api": ...}, or None for no device or an unknown one."""
    if index is None:
        return None
    try:
        info = sd.query_devices(index)
    except Exception:
        return None
    return {"name": info["name"], "host_api": _host_api_name(info)}


def saved_device(config, key, want_input, platform=sys.platform):
    """
    The index a saved choice means now, or None when nothing usable is saved.

    `key` names the choice: "device" for recording, "output_device" for
    playback, each stored as `<key>_index` plus `<key>` = its identity.

    An index with no identity is from before identities were saved. Off
    Windows it is still right. On Windows it is not trusted: turning ASIO on
    inserted a host API mid-list and moved every later index, and recording
    from the wrong card without a word is worse than asking again.
    """
    index = config.get(f"{key}_index")
    identity = config.get(key)

    if not identity:
        return None if platform == "win32" else index

    direction = "max_input_channels" if want_input else "max_output_channels"
    try:
        devices = list(sd.query_devices())
    except Exception:
        return None

    matches = [
        i for i, d in enumerate(devices)
        if d.get(direction, 0) > 0
        and d["name"] == identity.get("name")
        and _host_api_name(d) == identity.get("host_api")
    ]
    if index in matches:
        return index
    return matches[0] if matches else None
```

- [ ] **Step 4: Run** — `python tests/test_engine.py` → PASS, including every earlier section.

- [ ] **Step 5: Commit** — `git add src/rehearsal_recorder/audio/devices.py tests/test_engine.py` — "Remember a device by what it is, not where it is listed" + "Refs #3" + attribution.

---

### Task 3: The API saves identities and reads them back

**Files:**
- Modify: `src/rehearsal_recorder/api.py` — `get_settings` (~line 298), `_host_api_names`/`_describe_devices` (~442–475), `set_recording_format` (~480), `load_default_tracks` (~511), `save_default_tracks` (~521), `player_open` (~1462), `set_output_device` (~1547); import line 45.
- Test: `tests/test_engine.py` (new section after `[4d]`)

**Interfaces:**
- Consumes: `device_identity`, `saved_device` from Task 2.
- Produces: `Api._remember_device(key: str, index: int | None) -> None`; `get_settings()["device_index"]` / `["output_device_index"]` and `load_default_tracks()["device_index"]` are resolved indices; every device from `list_input_devices`/`list_output_devices` has a non-empty `host_api` when PortAudio names one.

- [ ] **Step 1: Failing test** — after `[4d]`:

```python
    print("\n[4e] Settings save what the device is and read it back")
    apimod, a = fresh_api(tmp / "devices")
    a.set_recording_format(0, 48000, 24)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("the recording interface is saved by name and system",
       saved.get("device") == {"name": "Interface", "host_api": "CoreAudio"})
    a.set_output_device(2)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("so is the playback output",
       saved.get("output_device") == {"name": "Fussy DAC", "host_api": "CoreAudio"})
    a.set_output_device(None)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("the system output leaves no name behind",
       saved.get("output_device") is None
       and saved.get("output_device_index") is None)

    a.save_default_tracks({"device_index": 1, "tracks": [{"name": "V", "channel": 1}]})
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("the setup screen's template saves it the same way",
       saved.get("device") == {"name": "Podcast mic", "host_api": "CoreAudio"})

    # The card moved: identity says index 0 now, the stored index says 1.
    a._config["device_index"] = 1
    a._config["device"] = {"name": "Interface", "host_api": "CoreAudio"}
    ok("settings report where the card is now",
       a.get_settings()["device_index"] == 0)
    ok("and so does the template the setup screen loads",
       a.load_default_tracks()["device_index"] == 0)
    ok("every device says which system it came through, even alone",
       all(d["host_api"] == "CoreAudio" for d in a.list_input_devices()))
```

- [ ] **Step 2: Run, expect FAIL** — the identity checks fail (`saved.get("device")` is None).

- [ ] **Step 3: Implement**

Import (line 45):

```python
from rehearsal_recorder.audio.devices import (
    device_identity,
    recording_formats,
    saved_device,
)
```

New method in the settings section, after `_write_config`:

```python
    def _remember_device(self, key, index):
        """Saves a device choice as its index and what it is. `key` is
        "device" or "output_device"; see audio.devices.saved_device."""
        self._config[f"{key}_index"] = index
        self._config[key] = device_identity(index)
```

`get_settings`: replace the two device lines with

```python
            "device_index": saved_device(self._config, "device", True),
            ...
            "output_device_index": saved_device(
                self._config, "output_device", False
            ),
```

`set_recording_format`: replace `self._config["device_index"] = device_index` with `self._remember_device("device", device_index)`.

`load_default_tracks`: `"device_index": saved_device(self._config, "device", True),`

`save_default_tracks`:

```python
    def save_default_tracks(self, config):
        if "device_index" in config:
            self._remember_device("device", config["device_index"])
        for key in ("samplerate", "bit_depth", "tracks"):
            if key in config:
                self._config[key] = config[key]
        self._write_config()
        return {"ok": True}
```

`player_open`: `player.open_output(saved_device(self._config, "output_device", False))`.

`set_output_device`: replace `self._config["output_device_index"] = device_index` with `self._remember_device("output_device", device_index)`.

`_host_api_names` docstring: replace its last two sentences with "The interface groups devices by it, so it is reported everywhere; on a Mac there is only one and the interface does not show it." `_describe_devices`: delete `many = len(apis) > 1` and set `"host_api": api,`.

- [ ] **Step 4: Run** — `python tests/test_engine.py` → PASS.

- [ ] **Step 5: Commit** — `git add src/rehearsal_recorder/api.py tests/test_engine.py` — "Save device choices by identity and resolve them on read" + "Refs #3" + attribution.

---

### Task 4: Settings chooses the driver, then the device

**Files:**
- Create: `ui/src/components/DevicePicker.tsx`
- Modify: `ui/src/screens/Settings.tsx` (the two device `<Select>`s, ~lines 337–381 and 448–482)
- Modify: `ui/src/lib/api.ts` (`Device.host_api` doc comment)
- Test: `tests/test_interface.py` (mock ~lines 115–128, `[12b]` ~1281, `[12d]` ~1368)

**Interfaces:**
- Consumes: `Device` from `@/lib/api`; `get_settings().device_index` resolved (Task 3).
- Produces: `DevicePicker` props `{ id: string; devices: Device[]; value: number | null; onChange: (index: number | null) => void; placeholder: string; systemDefault?: boolean; detail?: (d: Device) => string }`.

- [ ] **Step 1: Failing test — mock.** In `tests/test_interface.py` replace `list_input_devices` and `list_output_devices` in `__MAKE_API__` with:

```js
  // With a host API named, this is the Windows shape once ASIO is loaded:
  // one mixer through three systems with three different input counts.
  list_input_devices: async () => (window.__HOST_API__ ? [
    {index:0, name:'X32 USB', host_api:'MME',
     max_input_channels:2, max_output_channels:0, default_samplerate:48000},
    {index:3, name:'X32 USB', host_api:'ASIO',
     max_input_channels:16, max_output_channels:16, default_samplerate:48000},
    {index:5, name:'X32 USB', host_api:window.__HOST_API__,
     max_input_channels:8, max_output_channels:0, default_samplerate:48000}] : [
    {index:0, name:'Universal Audio Thunderbolt', host_api:'Core Audio',
     max_input_channels:18, max_output_channels:0, default_samplerate:48000}]),
  list_output_devices: async () => (window.__HOST_API__ ? [
    {index:1, name:'Speakers', host_api:'MME', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000},
    {index:3, name:'X32 USB', host_api:'ASIO', max_input_channels:16,
     max_output_channels:16, default_samplerate:48000}] : [
    {index:0, name:'UA Monitors', host_api:'Core Audio', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000},
    {index:1, name:'MacBook Speakers', host_api:'Core Audio', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000}]),
```

The Windows page's saved `recording.device_index` is 0 (MME), which exists in that list.

- [ ] **Step 2: Failing test — Mac shape.** In `[12b]`, replace the "nothing is said about duplicates" check with:

```python
        # One audio system: choosing it would be a question with one answer.
        ok("there is no driver to choose on a Mac",
           page.locator("#input-device-driver").count() == 0
           and page.locator("#output-device-driver").count() == 0)
        ok("and nothing is said about drivers",
           page.locator("text=Each driver can offer").count() == 0)
```

- [ ] **Step 3: Failing test — Windows shape.** In `[12d]`, replace the two checks after `win.wait_for_selector("#input-device")` ("the audio system is shown…", "a card listed twice…") with:

```python
        ok("the driver is chosen first",
           win.locator("#input-device-driver").count() == 1)
        ok("starting from the one the saved card is on",
           "MME" in win.inner_text("#input-device-driver"))
        ok("and the card itself no longer repeats it",
           "(MME)" not in win.inner_text("#input-device"))
        ok("with a line on why the driver matters",
           win.locator("text=Each driver can offer").count() == 1)

        win.click("#input-device-driver")
        drivers = win.get_by_role("option").all_inner_texts()
        ok("every driver with an input is offered, once each",
           sorted(drivers) == ["ASIO", "MME", "Windows WASAPI"])
        win.get_by_role("option", name="ASIO").click()
        win.wait_for_timeout(200)
        ok("changing the driver saves nothing on its own",
           not any(c["args"][0] == 3 for c in calls("set_recording_format")))
        win.click("#input-device")
        ok("its devices are what is offered",
           win.get_by_role("option").all_inner_texts() == ["X32 USB · up to 16 ch"])
        win.get_by_role("option").first.click()
        win.wait_for_timeout(300)
        ok("and picking one saves it",
           calls("set_recording_format")[-1]["args"][0] == 3)

        ok("playback is chosen the same way",
           win.locator("#output-device-driver").count() == 1)
        win.click("#output-device-driver")
        ok("offering only drivers with an output",
           sorted(win.get_by_role("option").all_inner_texts()) == ["ASIO", "MME"])
        win.get_by_role("option", name="ASIO").click()
        win.click("#output-device")
        ok("the system output is still there under any driver",
           win.get_by_role("option").all_inner_texts()
           == ["System output", "X32 USB"])
        win.get_by_role("option", name="X32 USB").click()
        win.wait_for_timeout(300)
        ok("and picking a card switches to it",
           calls("set_output_device")[-1]["args"][0] == 3)
```

If `calls()` records args differently for these methods, read the existing `track(...)` helper near the top of the mock and adjust to its shape — do not change the helper.

- [ ] **Step 4: Run, expect FAIL** — `cd ui && npm run build && cd .. && python tests/test_interface.py` → the new driver checks fail.

- [ ] **Step 5: Implement `DevicePicker`** — `ui/src/components/DevicePicker.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Device } from "@/lib/api"

const SYSTEM = "default"

/**
 * A device, chosen through its driver when there is more than one.
 *
 * On Windows one card appears once per audio system — MME, WASAPI, ASIO —
 * with the same name and a different number of channels each time. In one
 * flat list that reads as copies of one card, and the useful copy is lost
 * among them. So the driver is chosen first, as in every other audio
 * program, and the devices under it are then all different things. With one
 * driver (every Mac) there is nothing to choose and only the devices show.
 *
 * Changing the driver saves nothing: nothing is chosen until a device is.
 */
export function DevicePicker({
  id,
  devices,
  value,
  onChange,
  placeholder,
  systemDefault = false,
  detail,
}: {
  id: string
  devices: Device[]
  value: number | null
  onChange: (index: number | null) => void
  placeholder: string
  /** Offer "System output" first, under any driver. */
  systemDefault?: boolean
  detail?: (d: Device) => string
}) {
  const drivers = useMemo(
    () => [...new Set(devices.map((d) => d.host_api))],
    [devices]
  )
  const current = devices.find((d) => d.index === value)
  const [driver, setDriver] = useState<string | null>(null)

  // Follow the saved device until the person picks a driver themselves.
  useEffect(() => {
    if (driver === null && drivers.length) {
      setDriver(current?.host_api ?? drivers[0])
    }
  }, [driver, drivers, current])

  const several = drivers.length > 1
  const shown = several ? devices.filter((d) => d.host_api === driver) : devices
  const selected =
    value === null
      ? systemDefault
        ? SYSTEM
        : ""
      : shown.some((d) => d.index === value)
        ? String(value)
        : ""

  return (
    <div className="flex flex-col gap-2">
      {several && (
        <Select value={driver ?? ""} onValueChange={setDriver}>
          <SelectTrigger
            id={`${id}-driver`}
            aria-label="Driver"
            className="w-full"
          >
            <SelectValue placeholder="Pick a driver" />
          </SelectTrigger>
          <SelectContent>
            {drivers.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={selected}
        onValueChange={(v) => onChange(v === SYSTEM ? null : Number(v))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {systemDefault && <SelectItem value={SYSTEM}>System output</SelectItem>}
          {shown.map((d) => (
            <SelectItem key={d.index} value={String(d.index)}>
              {d.name}
              {detail ? detail(d) : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 6: Use it in Settings.** Replace the recording `<Select>…</Select>` and the duplicates note after it with:

```tsx
          <DevicePicker
            id="input-device"
            devices={inputs}
            value={settings?.device_index ?? null}
            placeholder="Pick an interface"
            detail={(d) => ` · up to ${d.max_input_channels} ch`}
            onChange={(index) =>
              void applyRecording(
                index,
                settings?.samplerate ?? 44100,
                settings?.bit_depth ?? 24
              )
            }
          />

          {/* Only where there is a choice to make. Somebody who knows their
              desk has sixteen inputs and is offered eight has no way to guess
              that another driver sees the same desk whole. */}
          {new Set(inputs.map((d) => d.host_api)).size > 1 && (
            <p className="text-xs text-muted-foreground">
              Each driver can offer a different number of inputs. If your
              interface shows fewer than it has, try another driver — ASIO,
              where there is one, usually offers all of them.
            </p>
          )}
```

Replace the output `<Select>…</Select>` with:

```tsx
          <DevicePicker
            id="output-device"
            devices={outputs}
            value={settings?.output_device_index ?? null}
            placeholder="System output"
            systemDefault
            onChange={async (idx) => {
              const res = await api().set_output_device(idx)
              if (!res.ok) {
                setError(res.error ?? "Could not switch the output")
                return
              }
              setSettings(await api().get_settings())
            }}
          />
```

Add `import { DevicePicker } from "@/components/DevicePicker"`. Remove the `Select*` import from Settings.tsx only if nothing else in the file still uses it (grep first).

In `ui/src/lib/api.ts` change the `host_api` comment to: `/** Which audio system (driver) it came through. Settings groups by it and only shows it when there is more than one. */`

- [ ] **Step 7: Build and run** — `cd ui && npm run build && npx oxlint && cd .. && python tests/test_interface.py` → PASS. Then `python tests/run_all.py` → all green. Look at `tests/screenshots/56-settings.png` and `57-windows-shaped.png`; the driver select must sit above the device select with the label spacing of the rest of the section.

- [ ] **Step 8: Commit** — `git add ui/src tests/test_interface.py` — "Choose the driver before the device in Settings" + "Refs #3" + attribution. (`ui/dist` is gitignored — check with `git status` that no build output is staged.)

---

### Task 5: Documentation and changelog

**Files:**
- Modify: `docs/design-notes.md` ("Picking an interface" paragraph)
- Modify: `docs/using-it.md` (the Settings → Audio bullet)
- Modify: `CHANGELOG.md` (new `## Unreleased` above `## 0.6.1`)

- [ ] **Step 1: design-notes.md** — replace the "Picking an interface" paragraph with:

```markdown
**Picking an interface.** On Windows one card appears once per audio system —
MME, DirectSound, WASAPI, WDM-KS, ASIO — with the same name each time and a
different number of channels. Settings therefore asks for the driver first and
then the device, as every audio program does; with one driver, as on a Mac,
only the device is asked. ASIO is there because `SD_ENABLE_ASIO` is set before
`sounddevice` is imported, which makes the pip wheel load its PortAudio built
with ASIO. It is on unconditionally: as a setting it would need a restart, and
as one entry in the driver list it needs nothing. For multitrack, ASIO if the
interface has a driver, otherwise WASAPI; MME is the default and the worst.

Turning ASIO on moved every later device index, so a choice is saved as the
device's name and audio system beside its index and found again by those. An
index saved before that is not trusted on Windows: the person is asked to
choose again rather than recorded from the wrong card.
```

- [ ] **Step 2: using-it.md** — in the Settings bullet change `**Audio** (the recording interface, rate and depth; the card used for playback)` to `**Audio** (the recording interface, rate and depth; the card used for playback — on Windows each through its driver first, since one card offers a different number of inputs through each)`.

- [ ] **Step 3: CHANGELOG.md** — insert above `## 0.6.1`:

```markdown
## Unreleased

- On Windows, ASIO is offered. A 16-channel mixer was listed with 2 or 8
  inputs because the PortAudio loaded by default has no ASIO; the one with
  ASIO ships in the same package and is now loaded instead. Starting the app
  can briefly interrupt other sound playing through a device in exclusive
  mode — once, at launch.
- The recording interface and the playback output are chosen through their
  driver first when there is more than one, instead of one list with the
  same card in it four or five times. On a Mac nothing changes.
- Device choices are remembered by name and driver, not only by position in
  the list, so plugging something in no longer moves them. On Windows a
  choice saved by an older version has to be made once more.
- The self-test fails a Windows build that lacks ASIO.
```

- [ ] **Step 4: Commit** — `git add docs/design-notes.md docs/using-it.md CHANGELOG.md` — "Document ASIO and the driver-first choice" + "Refs #3" + attribution.

---

### Task 6: Pull request

- [ ] **Step 1:** `python tests/run_all.py` → all green; paste the tail of the output into the PR.
- [ ] **Step 2:** `git push -u origin asio-driver-first`, then `gh pr create` using `.github/pull_request_template.md`. Body: what changed, `Refs #3`, and an explicit "Not verified" list: 16 tracks recorded at the rehearsal space; `recording_formats` through ASIO; exclusive access when another program holds the card; the ASIO DLL in the bundle (the Windows selftest in CI answers this one). End with the PR attribution lines.
- [ ] **Step 3:** Comment on #3 with the PR link and what still has to be checked in the room, starting with the device dump the issue asks for.
