# Awake During a Take Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a take records, the laptop and its screen stay awake; a low battery shows on the recording screen; a laptop that sleeps anyway ends the take where it slept and says so after waking.

**Architecture:** Three system pieces go into `platform_support.py`, where the app keeps every difference between macOS, Windows and Linux: `KeepAwake` (held from a take's start to the end of Stop), `SleepWatch` (the system's "going to sleep" notice) and `battery_percent()`. `AudioRecorder` learns to fall asleep: it stops writing at that moment and reports the sleep as its error, so the recording screen's existing health poll stops the take and shows the notice. It also notices a sleep for itself, from a gap of more than 10 s in its own signs of life (blocks, and a tick of its own once a second), since the system's notice may not come. `HealthLine` gains the battery line; reha.stream and the docs gain words.

**Tech Stack:** Python 3.12 with PyObjC (Foundation, AppKit, `objc.loadBundleFunctions` for IOKit) on macOS and `ctypes` on Windows; React + TypeScript in `ui/`; the site's Markdown in `site/content/`. No new library.

**Spec:** `docs/superpowers/specs/2026-10-09-awake-during-a-take-design.md`

## Global Constraints

- No new dependency, Python or npm.
- The system pieces live in `src/rehearsal_recorder/platform_support.py`, not in a new `awake.py` as the spec first said: that file's own header says the differences between systems are "kept in one file on purpose". The spec was corrected with this plan.
- Nothing from the system may stop or fail a take: every call into macOS or Windows is caught, printed with a `[awake]`, `[sleep]` or `[battery]` prefix, and the take goes on.
- The lock is held only from a successful `start_take` to the end of `stop_take` (WAVs written, success or not), and let go in `shutdown`.
- Copy, exactly:
  - notice: `The laptop went to sleep at 21:14, so the take ends there. Everything up to that moment is saved.` with the time as `%H:%M`, local.
  - battery line: `Battery 14%: plug the laptop in`
  - macOS activity reason: `Recording a take`; Windows request reason: `РЭХА is recording a take`
- Values: `LOW_BATTERY = 20` (at or under), `SLEPT_GAP_SEC = 10.0`, `TICK_SEC = 1.0`, macOS options `0x00FFFFFF | (1 << 40)` (NSActivityUserInitiated | NSActivityIdleDisplaySleepDisabled), Windows request types 0, 1, 3 (Display, System, Execution), `DEVICE_NOTIFY_CALLBACK = 2`, `PBT_APMSUSPEND = 4`.
- Python check labels are Latin only, no ★: Windows CI prints cp1252. Same for Playwright test titles.
- The Python suites are plain scripts with `ok(label, cond)`, not pytest. New engine checks go in a new section `[63] Awake during a take`; new platform checks in `[awake]`, `[sleep]` and `[battery]`.

## Review Focus

1. **A card unplugged while the screen polls rarely** (a hidden window's timers slowed): after 15 s with no block, the take must say the interface stopped, not that the laptop slept. The take's own tick, on its own thread, goes on while the card is silent, so `problem()` calls a silence sleep only when the tick stopped too (the whole app was frozen); otherwise today's silent-card rule decides. Pinned in Task 4.
2. **The system refuses the lock** (a call raises or returns failure, or Windows already dropped the request at a lid close): the take records and stops as usual. Pinned in Tasks 1 and 5.
3. **The sleep notice comes between takes**, or twice in one take: nothing happens between takes; a second notice changes nothing. Pinned in Task 5.
4. **The battery cannot be read** (no battery, a desktop, IOKit or the call failing): `recording_health` still answers, with `battery_percent` null, and the line is the usual one. Pinned in Tasks 3 and 5.
5. **Stop pressed as the laptop wakes**, at the same moment the screen stops the take on its own: one take, written once, holding only what came before the sleep. Pinned in Task 4.

---

### Task 1: KeepAwake

**Files:**
- Modify: `src/rehearsal_recorder/platform_support.py` (append)
- Test: `tests/test_platform.py` (new section `[awake]` before the final summary)

**Interfaces:**
- Produces:
  - `MAC_AWAKE_OPTIONS: int = 0x00FFFFFF | (1 << 40)`
  - `MAC_AWAKE_REASON = "Recording a take"`, `WINDOWS_AWAKE_REASON = "РЭХА is recording a take"`
  - `class KeepAwake(system=sys.platform, process_info=None, kernel32=None)` with `hold() -> None`, `release() -> None`, `held -> bool` (property). `process_info` stands for `NSProcessInfo.processInfo()`; `kernel32` for `ctypes.WinDLL("kernel32", use_last_error=True)` with argtypes set.
  - `REASON_CONTEXT` ctypes structure: `Version: c_ulong`, `Flags: c_ulong`, `Reason`: a union of `Detailed` (`c_void_p`, `c_ulong`, `c_ulong`, `c_void_p`) and `SimpleReasonString: c_wchar_p`, so it has Windows' size.

- [ ] **Step 1: Write the failing checks** in `[awake]`:

```python
class FakeMac:
    def __init__(self): self.calls = []
    def beginActivityWithOptions_reason_(self, options, reason):
        self.calls.append(("begin", options, reason)); return "token"
    def endActivity_(self, token): self.calls.append(("end", token))

class FakeKernel:
    def __init__(self, fail=False): self.calls, self.fail = [], fail
    def PowerCreateRequest(self, ref):
        self.calls.append(("create", ref._obj.Reason.SimpleReasonString)); return 7
    def PowerSetRequest(self, h, kind):
        if self.fail: raise OSError("refused")
        self.calls.append(("set", h, kind)); return 1
    def PowerClearRequest(self, h, kind): self.calls.append(("clear", h, kind)); return 1
    def CloseHandle(self, h): self.calls.append(("close", h)); return 1
```

Checks (labels as written):
- `"on a Mac a take holds one activity that keeps the system and the screen awake"`: after `hold()`, calls == `[("begin", ps.MAC_AWAKE_OPTIONS, "Recording a take")]`.
- `"holding twice holds once"`: a second `hold()` adds nothing.
- `"letting go ends that activity"`: after `release()`, last call == `("end", "token")` and `held` is False.
- `"letting go with nothing held does nothing"`: a fresh `KeepAwake` on the fake Mac, `release()`, calls == `[]`.
- `"on Windows a take asks for the display, the system and the process"`: calls == `[("create", "РЭХА is recording a take"), ("set", 7, 0), ("set", 7, 1), ("set", 7, 3)]`.
- `"and lets go of all three and the handle"`: after release, the tail is `[("clear", 7, 0), ("clear", 7, 1), ("clear", 7, 3), ("close", 7)]`.
- `"a refusing system does not raise"`: `KeepAwake("win32", kernel32=FakeKernel(fail=True))`, `hold()` then `release()` raise nothing, and the handle is still closed.
- `"on Linux it does nothing"`: `KeepAwake("linux")` hold and release raise nothing and `held` stays False.
- On the real system only: `if sys.platform == "darwin"`: `from Foundation import NSActivityUserInitiated, NSActivityIdleDisplaySleepDisabled`, check `"the Mac's own names add up to the options used"` (their OR equals `MAC_AWAKE_OPTIONS`), and `"a real hold and release on this Mac"` (no exception, `held` True then False). `if sys.platform == "win32"`: `"a real hold and release on this Windows"` likewise.

- [ ] **Step 2: Run, see them fail**

Run: `python tests/test_platform.py`
Expected: FAIL, `module 'rehearsal_recorder.platform_support' has no attribute 'KeepAwake'`.

- [ ] **Step 3: Implement `KeepAwake`** in `platform_support.py`. On a Mac, `process_info` defaults to `Foundation.NSProcessInfo.processInfo()`, imported inside the method. On Windows, `kernel32` defaults to `ctypes.WinDLL("kernel32", use_last_error=True)` with `PowerCreateRequest(POINTER(REASON_CONTEXT)) -> HANDLE`, `PowerSetRequest/PowerClearRequest(HANDLE, c_int) -> BOOL`, `CloseHandle(HANDLE) -> BOOL`; a create that returns `INVALID_HANDLE_VALUE` (-1) or 0 holds nothing. A request is created on each `hold()` and closed on each `release()`, never kept between takes: a lid close ends every request (Microsoft, PowerSetRequest remarks). Keep the `REASON_CONTEXT` and its string alive while held. The class docstring says why each call (Display needs System beside it; Execution keeps a hidden app running), with the Microsoft and Apple names.

- [ ] **Step 4: Run, see them pass**

Run: `python tests/test_platform.py`
Expected: `[awake]` all `ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/platform_support.py tests/test_platform.py
git commit -m "Keep the laptop and its screen awake: the system calls"
```

### Task 2: SleepWatch

**Files:**
- Modify: `src/rehearsal_recorder/platform_support.py` (append)
- Test: `tests/test_platform.py` (section `[sleep]`)

**Interfaces:**
- Produces:
  - `MAC_WILL_SLEEP = "NSWorkspaceWillSleepNotification"`, `DEVICE_NOTIFY_CALLBACK = 2`, `PBT_APMSUSPEND = 4`
  - `class SleepWatch(on_sleep: Callable[[], None], system=sys.platform, center=None, powrprof=None)` with `start() -> bool` (True when the system took the registration) and `stop() -> None`. `center` stands for `NSWorkspace.sharedWorkspace().notificationCenter()`; `powrprof` for `ctypes.WinDLL("powrprof")`.

- [ ] **Step 1: Write the failing checks** in `[sleep]`, with a fake center (`addObserverForName_object_queue_usingBlock_(name, obj, queue, block)` keeps `(name, block)` and returns `"obs"`; `removeObserver_(obs)` records it) and a fake powrprof (`PowerRegisterSuspendResumeNotification(flags, params_ref, handle_ref)` keeps `flags` and `params_ref._obj.Callback`, returns 0; `PowerUnregisterSuspendResumeNotification(handle)` records it, returns 0):
- `"on a Mac it listens for the system going to sleep"`: `start()` is True and the name kept is `"NSWorkspaceWillSleepNotification"`; calling the kept block with `None` calls `on_sleep` once.
- `"and stops listening when asked"`: `stop()` removed `"obs"`.
- `"on Windows it registers a callback for suspend and resume"`: flags kept == 2.
- `"going to sleep reaches the take"`: `callback(None, 4, None)` returns 0 and calls `on_sleep` once.
- `"waking does not"`: `callback(None, 18, None)` and `callback(None, 7, None)` call nothing more.
- `"a failing handler never reaches the system"`: with `on_sleep` raising, `callback(None, 4, None)` returns 0 and raises nothing.
- `"on Linux there is nothing to listen to"`: `SleepWatch(f, "linux").start()` is False.
- Real system: on darwin, `"the Mac's notification is the one listened for"` (`AppKit.NSWorkspaceWillSleepNotification == ps.MAC_WILL_SLEEP`) and `"a real start and stop on this Mac"`; on win32, `"a real start and stop on this Windows"` (start True, stop raises nothing).

- [ ] **Step 2: Run, see them fail**

Run: `python tests/test_platform.py`
Expected: FAIL, no attribute `SleepWatch`.

- [ ] **Step 3: Implement `SleepWatch`**. macOS: `center.addObserverForName_object_queue_usingBlock_(NSWorkspaceWillSleepNotification, None, None, block)`, the block calling `on_sleep` inside try/except; queue `None` runs it on the posting thread, the main one. Windows: `CALLBACK = ctypes.WINFUNCTYPE(c_ulong, c_void_p, c_ulong, c_void_p)`, a `DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS(Callback, Context)` structure passed by reference, the handle as `c_void_p`; keep the callback, the parameters and the handle on `self` while registered (ctypes frees an unreferenced callback). The callback only calls `on_sleep` for `PBT_APMSUSPEND` and always returns 0. Any failure to register prints and returns False.

- [ ] **Step 4: Run, see them pass**

Run: `python tests/test_platform.py`
Expected: `[sleep]` all `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/platform_support.py tests/test_platform.py
git commit -m "Hear the system say it is going to sleep"
```

### Task 3: battery_percent

**Files:**
- Modify: `src/rehearsal_recorder/platform_support.py` (append)
- Test: `tests/test_platform.py` (section `[battery]`)

**Interfaces:**
- Produces:
  - `mac_battery(descriptions: list[dict]) -> int | None`: the first description with `"Type" == "InternalBattery"`; None unless its `"Power Source State" == "Battery Power"`; else `round(Current Capacity * 100 / Max Capacity)`, None when Max Capacity is missing or 0.
  - `windows_battery(ac_line: int, flag: int, percent: int) -> int | None`: None when `ac_line != 0`, `flag == 255`, `flag & 128`, or `percent == 255`; else `percent`.
  - `battery_percent(system=sys.platform) -> int | None`: reads the real system and never raises.

- [ ] **Step 1: Write the failing checks** in `[battery]`:
- `"a Mac on its battery says its charge"`: `mac_battery([{"Type": "InternalBattery", "Power Source State": "Battery Power", "Current Capacity": 14, "Max Capacity": 100}]) == 14`
- `"worked out from the capacity when it is not out of 100"`: Current 2800, Max 4000 gives 70.
- `"a Mac on mains says nothing"`: `"AC Power"` gives None.
- `"nor a Mac with no battery"`: `mac_battery([]) is None`, and a UPS (`"Type": "UPS"`) on battery gives None.
- `"Windows on its battery says its charge"`: `windows_battery(0, 0, 14) == 14`; `windows_battery(0, 2, 64) == 64` (flag 2 is "low").
- `"Windows on mains says nothing"`: `windows_battery(1, 8, 64) is None`.
- `"nor without a battery, or when it cannot tell"`: `(0, 128, 255)`, `(0, 255, 50)`, `(0, 1, 255)` all None.
- `"on Linux there is no answer"`: `battery_percent("linux") is None`.
- Real system: on darwin and win32, `"this machine's answer is a charge or none"`: the result is None or an int in 0..100.

- [ ] **Step 2: Run, see them fail**

Run: `python tests/test_platform.py`
Expected: FAIL, no attribute `mac_battery`.

- [ ] **Step 3: Implement.** macOS: `objc.loadBundleFunctions(NSBundle.bundleWithIdentifier_("com.apple.framework.IOKit"), table, [("IOPSCopyPowerSourcesInfo", b"@", "", {"retval": {"already_cfretained": True}}), ("IOPSCopyPowerSourcesList", b"@@", "", {"retval": {"already_cfretained": True}}), ("IOPSGetPowerSourceDescription", b"@@@")])`, loaded once and kept at module level; the descriptions go through `dict()` into `mac_battery`. Windows: `GetSystemPowerStatus(POINTER(SYSTEM_POWER_STATUS)) -> BOOL` with the structure's six fields (`ACLineStatus`, `BatteryFlag`, `BatteryLifePercent`, `SystemStatusFlag` as `c_ubyte`; `BatteryLifeTime`, `BatteryFullLifeTime` as `c_ulong`) into `windows_battery`. Any exception: print once per process with `[battery]`, return None.

- [ ] **Step 4: Run, see them pass**

Run: `python tests/test_platform.py`
Expected: `[battery]` all `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/platform_support.py tests/test_platform.py
git commit -m "Read the battery's charge on a Mac and on Windows"
```

### Task 4: A take that falls asleep

**Files:**
- Modify: `src/rehearsal_recorder/audio/capture.py` (constants near `STALLED`; `AudioRecorder.__init__`, `start`, `_callback`, `problem`, `_let_go`; new `fell_asleep`, `_seen`, `_tick_loop`)
- Test: `tests/test_engine.py` (new section `[63] Awake during a take`, before the final summary)

**Interfaces:**
- Produces:
  - `SLEPT_GAP_SEC = 10.0`, `TICK_SEC = 1.0`
  - `slept_notice(at: float) -> str`: the notice with `time.strftime("%H:%M", time.localtime(at))`.
  - `AudioRecorder.fell_asleep(at: float) -> None`
  - `AudioRecorder._seen_wall: float | None`: the `time.time()` at which the take last saw itself running (its start, each block, each tick).
  - `AudioRecorder._seen(now: float) -> None`: a sign of life at `now`.

- [ ] **Step 1: Write the failing checks** in `[63]`, in the style of `[36]` (one-channel recorders in a temp folder, `start()` against the suite's fake stream, blocks fed to `_callback`, raw file sizes read from disk):
- `"the notice says when the laptop went to sleep"`: `slept_notice(t) == f"The laptop went to sleep at {time.strftime('%H:%M', time.localtime(t))}, so the take ends there. Everything up to that moment is saved."`
- `"a take told the laptop is going to sleep says so"`: after two 256-frame blocks, `fell_asleep(t)` makes `problem() == slept_notice(t)`.
- `"and writes nothing after it"`: a third block leaves the raw file at 2 x 256 x 2 bytes.
- `"so the take ends where the laptop slept"`: `stop()["duration_sec"] == 512 / SR`.
- `"stopping twice as the laptop wakes writes the take once"` (Review Focus 5): a second `stop()` returns the same result and the WAV holds 512 frames.
- `"two blocks more than ten seconds apart mean the laptop slept between them"`: `_seen_wall -= 12` before a block: `problem() == slept_notice(the earlier _seen_wall)` and that block is not written.
- `"a block soon after the last is just a block"`: `_seen_wall -= 9` before a block: written, `problem() is None`.
- `"a tick after a long gap means the same"`: `_seen_wall -= 12`, then `_seen(time.time())`: the sleep notice.
- `"nothing at all since the laptop woke says it slept, not that the card went"`: `_seen_wall -= 12` and `_heartbeat._last -= 12`: `problem()` is the sleep notice, not `STALLED`.
- `"a card unplugged while nobody asked says the interface, not sleep"` (Review Focus 1): `_heartbeat._last -= 15` with `_seen_wall` fresh, as the tick keeps it: `problem()` contains `"interface"` and not `"sleep"`.
- `"a short silence is the silent card, as today"`: `_seen_wall -= 4` and `_heartbeat._last -= 4`: `problem() == STALLED`.
- `"the take ticks while it records, and stops ticking with it"`: with `capmod.TICK_SEC = 0.05` (put back after), `_seen_wall` moves on within 0.5 s with no block; after `stop()` the tick's thread is not alive.
- `"a card already gone stays gone"`: after `STALLED`, `fell_asleep(t)` leaves `problem()` as it was, and blocks are no longer written.

- [ ] **Step 2: Run, see them fail**

Run: `python tests/test_engine.py`
Expected: FAIL, `cannot import name 'slept_notice'`.

- [ ] **Step 3: Implement.**
  - `fell_asleep(at)`: sets `self._asleep = True`; sets `self.error = slept_notice(at)` only when `self.error is None and not self._stopping`.
  - `_seen(now)`: if `_seen_wall` is set and `now - _seen_wall > SLEPT_GAP_SEC`, `fell_asleep(_seen_wall)`; then `_seen_wall = now`.
  - `_callback`: `self._seen(time.time())` after `self._heartbeat.enter()`; return without writing when `frames == 0 or self._stopping or self._asleep`.
  - `_tick_loop`: `while not self._stop_flush.wait(TICK_SEC): self._seen(time.time())`, on a second daemon thread started in `start()` beside the flush thread and joined beside it in `_let_go`. `start()` sets `_seen_wall = time.time()` before either thread starts.
  - `problem()`, when `self.error is None and not self._stopping`: first, if `time.time() - _seen_wall > SLEPT_GAP_SEC`, `fell_asleep(_seen_wall)`; otherwise the heartbeat rule as today. After waking, whichever runs first, the screen's poll, the tick or a block, reaches the same answer.
  - Comments say why the tick exists: the system's notice may not come (Modern Standby), the card may not come back, and whether the heartbeat's clock counts time asleep differs between systems; a tick that stopped for more than 10 s means the whole app was frozen, which is what sleep does to it. The module docstring gains a paragraph on sleep: what is kept, what is dropped.

- [ ] **Step 4: Run, see them pass**

Run: `python tests/test_engine.py`
Expected: `[63]` all `ok`, and `[36]` still all `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/audio/capture.py tests/test_engine.py
git commit -m "A take ends where the laptop went to sleep, and says so"
```

### Task 5: The take holds the lock, hears the sleep, reads the battery

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`Api.__init__`, `attach_window`, `shutdown`, `start_take`, `stop_take`, `recording_health`; new `_laptop_sleeping`)
- Test: `tests/test_engine.py` (`[63]`, continued)

**Interfaces:**
- Consumes: `KeepAwake`, `SleepWatch`, `battery_percent` (Tasks 1 to 3); `AudioRecorder.fell_asleep` (Task 4).
- Produces: `Api._awake: KeepAwake`, `Api._sleep_watch: SleepWatch`, `Api._laptop_sleeping() -> None`; `recording_health()` gains `"battery_percent": int | None` while recording.

- [ ] **Step 1: Write the failing checks** in `[63]`, with `fresh_api`, a rehearsal started as `[62]` does, `a._awake` replaced by a recorder of calls (`hold`, `release`, optionally raising) and `apimod.battery_percent` patched:
- `"a take that starts holds the laptop awake"`: after `start_take()`, calls == `["hold"]`.
- `"and lets go once it is written"`: after `stop_take()`, calls == `["hold", "release"]`.
- `"even when writing it fails"`: with the recorder's `stop` raising, `stop_take` raises as today and calls still end in `"release"`.
- `"a take that cannot start holds nothing"`: with `apimod.AudioRecorder` patched to one whose `start` raises, `start_take()["ok"] is False` and calls == `[]`.
- `"a lock the system refuses does not stop the take"` (Review Focus 2): with `hold` raising, `start_take()["ok"] is True`.
- `"closing the window lets go"`: `shutdown()` during a take ends calls with `"release"`.
- `"the laptop going to sleep reaches the take being recorded"`: `_laptop_sleeping()` during a take makes `recording_health()["error"]` start with `"The laptop went to sleep at "`.
- `"between takes it changes nothing"` (Review Focus 3): `_laptop_sleeping()` with no take raises nothing, and the next take's `recording_health()["error"] is None`.
- `"the health check says the charge on battery"`: patched to return 14, `recording_health()["battery_percent"] == 14`.
- `"and none on mains"`: patched to return None, the key is there and None.
- `"a battery that cannot be read leaves the health check working"` (Review Focus 4): patched to raise, `recording_health()["battery_percent"] is None` and `"error"` is still there.

- [ ] **Step 2: Run, see them fail**

Run: `python tests/test_engine.py`
Expected: FAIL, `'Api' object has no attribute '_awake'`.

- [ ] **Step 3: Implement.** Import `KeepAwake`, `SleepWatch`, `battery_percent` in the existing `from rehearsal_recorder.platform_support import (...)`. `__init__`: `self._awake = KeepAwake()`, `self._sleep_watch = SleepWatch(self._laptop_sleeping)`. `attach_window`: `self._sleep_watch.start()` (only the real app has a window, as with the cloud worker). `start_take`: after `self._recorder = recorder`, hold inside try/except that prints `[awake]`. `stop_take`: the `_journaled(... recorder.stop ...)` call in `try/finally` releasing. `shutdown`: after the abandon block, release, then `self._sleep_watch.stop()`. `_laptop_sleeping`: `recorder = self._recorder`; if set, `recorder.fell_asleep(time.time())`. `recording_health`: `"battery_percent"` from a `_battery()` helper that returns None on any exception.

- [ ] **Step 4: Run all Python suites**

Run: `python tests/run_all.py`
Expected: `All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Takes keep the laptop awake, hear it sleep and read the battery"
```

### Task 6: The battery line

**Files:**
- Modify: `ui/src/lib/api.ts` (`RecordingHealth`)
- Modify: `ui/src/components/HealthLine.tsx`
- Modify: `ui/e2e/fake-bridge.js` (`recording_health`)
- Test: `ui/e2e/recording.spec.ts`, `ui/e2e/problems.spec.ts`

**Interfaces:**
- Consumes: `recording_health().battery_percent` (Task 5).
- Produces: `RecordingHealth.battery_percent?: number | null`; `export const LOW_BATTERY = 20` in `HealthLine.tsx`; the fake bridge reads `window.__BATTERY__` (number or null, default null).

- [ ] **Step 1: Write the failing e2e tests.**
  - `recording.spec.ts`, after the disk test: `test("a battery running low is said on the status line, and nothing moves", ...)`: `secondGo(page)`; note the bounding-box height of the line's row (the parent of `[data-recording-line]`); `setFake(page, "__BATTERY__", 14)`; expect `page.getByText("Battery 14%: plug the laptop in", { exact: true })` to have count 1 and `page.locator("[data-notice]")` count 0; the row's height unchanged; `setFake(..., 64)` then the usual `Interface connected · room for` line again; `setFake(..., null)` the same.
  - `problems.spec.ts`, beside the unplugged-interface test: `test("a laptop that went to sleep ends the take, and says when", ...)`: as that test, with `__IFACE_GONE__` set to `"The laptop went to sleep at 21:14, so the take ends there. Everything up to that moment is saved."`: `Save take` visible, `stop_take` called once, one warning notice containing `"went to sleep at 21:14"`.

- [ ] **Step 2: Run, see the battery test fail**

Run: `cd ui && npm run build && npx playwright test e2e/recording.spec.ts e2e/problems.spec.ts`
Expected: the battery test FAILS (no such text); the sleep test passes already, since it rides the existing path.

- [ ] **Step 3: Implement.** `api.ts`: the new field with a comment "On battery: its charge, 0 to 100. Null on mains or with no battery." `fake-bridge.js`: `battery_percent: window.__BATTERY__ ?? null` in `recording_health`. `HealthLine.tsx`: after the error and low-space branches, `health.battery_percent != null && health.battery_percent <= LOW_BATTERY` renders `BatteryLow` (lucide-react, `size-3.5 shrink-0`) in place of `HardDrive` and `Battery {n}%: plug the laptop in`, the line in `text-warn`; the doc comment names the battery.

- [ ] **Step 4: Run the interface's tests**

Run: `cd ui && npm test && npm run build && npm run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/api.ts ui/src/components/HealthLine.tsx ui/e2e/fake-bridge.js ui/e2e/recording.spec.ts ui/e2e/problems.spec.ts
git commit -m "The recording screen asks for the charger at 20%"
```

### Task 7: reha.stream, README, the guide, CHANGELOG

**Files:**
- Modify: `site/content/features.md`, `site/content/faq.md`, `site/src/content/index.test.ts:77`
- Modify: `README.md:51-58`, `docs/using-it.md` (*While recording*; new *The laptop goes to sleep during a take* after *The interface goes away during a take*), `CHANGELOG.md` (*Unreleased*)

- [ ] **Step 1: Change the site test first**: `index.test.ts` expects 8 questions (its title says eight), and `content.faq.questions[6].title === "Will the laptop fall asleep in the middle of a take?"`.

- [ ] **Step 2: Run it, see it fail**

Run: `cd site && npx vitest run src/content/index.test.ts`
Expected: FAIL, length 7.

- [ ] **Step 3: Write the words.** `features.md` health tile: `The interface, the disk, the battery, every input: on screen during the take, the only moment anyone would act on it.` `faq.md`, after *What if the laptop dies in the middle of a take?*: the question and answer exactly as in the spec's *On reha.stream*. README: sleep leaves the "you lose seconds" sentence, and *Tells you it is fine* names the battery. `using-it.md`: the screen stays on during a take and the corner turns yellow at 20% on battery; the new section says what is kept, quotes the notice, and that a closed lid always wins. CHANGELOG: one entry led by **The laptop stays awake during a take.**, saying the screen too, the battery line, and what happens if it sleeps anyway.

- [ ] **Step 4: Run the site's tests and build**

Run: `cd site && npm test && npm run build`
Expected: pass; the build's FAQ has eight questions.

- [ ] **Step 5: Commit**

```bash
git add site/content/features.md site/content/faq.md site/src/content/index.test.ts README.md docs/using-it.md CHANGELOG.md
git commit -m "Say it on reha.stream, in the README and in the guide"
```

### Task 8: Review, pull request, and the checks on a laptop

- [ ] **Step 1: Whole-branch review** by a fresh reviewer against the spec and this plan; fix every finding, minor ones included, before the PR (Alex, 2026-10-08: CI should run once).
- [ ] **Step 2: Run everything**: `python tests/run_all.py`; `cd ui && npm test && npm run build && npm run test:e2e`; `cd site && npm test && npm run build`. All pass.
- [ ] **Step 3: Open the PR** from `claude/project-thread-5gbo1m`, watch CI to green (macOS and Windows run the real-system checks from Tasks 1 to 3).
- [ ] **Step 4: Build an app to try.** CI on a PR builds no app, so run the Release workflow by hand on the branch (`workflow_dispatch`; it uploads the zips as the run's artifacts and publishes nothing). Alex downloads the Mac zip and, on a laptop: (1) `pmset -g assertions` during a take lists РЭХА with "Recording a take", and not after Stop; (2) a take left running past the display's sleep time and the screen saver's time: the screen stays on and nothing locks; (3) the lid closed for a minute mid-take: after opening, the notice with the time, and the take ends there; (4) on battery under 20%, the line. The same on a Windows laptop if one is at hand, with `powercfg /requests`.
- [ ] **Step 5: If check 2 shows the screen saver still starting**, stop and bring Alex what does stop it before adding anything (spec, Part 1).
- [ ] **Step 6: Ask Alex before merging.**
