# Update and Restart now: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update gets the new version ready beside the app, and Restart now swaps it in and opens it, on macOS and Windows.

**Architecture:** `platform_support.py` gets the parts that differ by system: where the app's place is, unpacking, clearing marks, the swap script and starting it detached. `updates.py`'s `UpdateChecker` drives it: a hidden staging folder beside the app, the new copy's `--selftest`, a ready note, `update.json` for the next start. `api.py` exposes `update_now` and `restart_to_update` and runs the first-start step. The Updates group in `UnderTheHood.tsx` shows the states of the spec's table.

**Tech Stack:** Python 3.12 (stdlib `zipfile`, `subprocess`, `ctypes`), `ditto`/`xattr` on macOS, `cmd.exe` on Windows, React + TypeScript, Playwright on the fake bridge.

**Spec:** `docs/superpowers/specs/2026-10-25-self-update-design.md` (ok'd by Alex 2026-10-25 09:49Z). Its Part numbers are cited below.

## Global Constraints

- The zips' names never change: `ASSETS` in `updates.py` stays `RehearsalRecorder-windows.zip` / `RehearsalRecorder-macos.zip`.
- Every `sys.platform` branch goes in `platform_support.py` (`docs/development.md`, "Platform differences go in platform_support.py"). Other modules take a `system` argument and pass it on.
- Nothing downloads or installs without a press; nothing happens during a take; no dialog (U1).
- Run from source, nothing is checked, offered or swapped (`api.py:1363`).
- The app's words are English, British spelling, buttons in sentence case (design system F7); Finder or Explorer through `words(useSystem())` (P2).
- Test labels in Python and Playwright use cp1252 characters only (Windows CI prints cp1252).
- The swap script is ASCII; every path reaches it through an environment variable.
- While developing, run only the tests a change touches, once each; the full suites run once on CI.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and no `Claude-Session:` line.

## Review Focus

1. **A path with spaces and Cyrillic** (`C:\Users\Алесь\Музыка\Reha`, `~/Музыка/Reha 2.app`): the swap keeps the place's own name and works. Test in Task 1 (the swap run) and Task 2 (the old copy's name).
2. **The app closed in the middle of getting ready**: a staging folder with no ready note is left behind. The next start removes it and offers Update again. Test in Task 2.
3. **No room on the disk, or a zip that will not unpack**: Getting it ready fails with words, the staging folder is removed, this copy is untouched. Test in Task 2.
4. **A ready copy that is out of date**: a newer release came out, or this copy was updated by hand. The ready copy is removed (Part 5). Test in Task 2.
5. **Restart now pressed twice**, or pressed with nothing ready: the second press is refused and starts no second script. Test in Task 2.

---

### Task 1: The parts that differ by system

**Files:**
- Modify: `src/rehearsal_recorder/platform_support.py` (new functions after `open_in_file_manager`, line 409)
- Test: `tests/test_platform.py` (new sections before the final `print("\n" + "=" * 60)`)

**Interfaces:**
- Produces:
  - `app_place(system=sys.platform, executable=None, frozen=None) -> Path | None`: frozen only. Mac: `Path(executable).parents[2]` when it ends in `.app`; Windows: `Path(executable).parent`; otherwise `None`.
  - `can_write_beside(place: Path) -> bool`: creates and deletes `.reha-write-test-<pid>` in `place.parent`; any `OSError` is `False`.
  - `staging_folder(place: Path, system=sys.platform) -> Path`: `place.parent / ".reha-update"` on a Mac, `place.parent / "Reha-update"` elsewhere.
  - `hide_folder(path: Path, system=sys.platform, kernel32=None) -> None`: Windows sets `FILE_ATTRIBUTE_HIDDEN` (0x2) with `SetFileAttributesW`; elsewhere nothing.
  - `unpack_app(archive: Path, into: Path, system=sys.platform, run=subprocess.run) -> Path`: Mac `run(["ditto", "-x", "-k", archive, into], check=True)`; elsewhere `zipfile.ZipFile.extractall`. Returns `into / "Reha.app"` (Mac) or `into / "Reha"`; raises `FileNotFoundError` when it is not there.
  - `clear_download_marks(copy: Path, system=sys.platform, run=subprocess.run) -> None`: Mac `run(["xattr", "-dr", "com.apple.quarantine", copy])`, failure ignored; Windows removes `<file>:Zone.Identifier` from every file under `copy` where it exists; elsewhere nothing.
  - `selftest_command(copy: Path, system=sys.platform) -> list[str]`: `[copy/"Contents/MacOS/Reha", "--selftest"]` or `[copy/"Reha.exe", "--selftest"]`.
  - `swap_script(system=sys.platform) -> tuple[str, str]`: `("reha-swap.sh", text)` or `("reha-swap.cmd", text)`, ASCII.
  - `run_detached(argv: list[str], env: dict, system=sys.platform, popen=subprocess.Popen) -> None`: POSIX `start_new_session=True`; Windows `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`; stdin, stdout and stderr to `DEVNULL`.
  - `script_command(script: Path, system=sys.platform) -> list[str]`: `["/bin/sh", script]` or `["cmd.exe", "/d", "/c", script]`.
  - `asks_for_microphone_again(system=sys.platform) -> bool`: `True` on a Mac only (spec Part 4, TN3127).
  - `send_to_trash(path: Path) -> bool`: the real Trash only (`send2trash`, then the system Trash folder), the first two steps of `move_to_trash`, which now calls it. No `_deleted` fallback: that would leave a 200 MB folder beside the app in Applications. `False` means the old copy stays for the next start (spec Part 4).
  - `SWAP_RESULTS = {"placed", "not-closed", "not-moved"}`: what the script writes.

The script reads `REHA_PID`, `REHA_PLACE`, `REHA_OLD`, `REHA_NEW`, `REHA_RESULT` and, for tests, `REHA_OPEN` (a command run instead of opening the app; unset in the app). It does, in order (spec Part 3): wait for `REHA_PID` to exit, at most 60 s (Mac `kill -0`; Windows `tasklist /FI "PID eq %REHA_PID%" /NH | find "%REHA_PID%"`, sleeping with `ping -n 2 127.0.0.1 >nul`, since `timeout` refuses to run without a console); if still running, write `not-closed` to `REHA_RESULT` and stop without opening anything. Then, retrying for 10 s: move `REHA_PLACE` to `REHA_OLD`, then `REHA_NEW` to `REHA_PLACE`. If the second move fails, move `REHA_OLD` back. Write `placed` or `not-moved`, then open `REHA_PLACE` (Mac `open "$REHA_PLACE"`, Windows `start "" "%REHA_PLACE%\Reha.exe"`), or run `REHA_OPEN` when set.

- [ ] **Step 1: Write the failing tests** in `tests/test_platform.py`, sections `[update-place]`, `[update-unpack]`, `[update-swap]`:

```python
print("\n[update-place] Where the app is, and whether it can change itself there")
ok("a Mac build's place is its .app",
   ps.app_place("darwin", "/Apps/Reha.app/Contents/MacOS/Reha", True) == Path("/Apps/Reha.app"))
ok("a Windows build's place is its folder",
   ps.app_place("win32", r"C:\Tools\Reha\Reha.exe", True) == Path(r"C:\Tools\Reha"))
ok("run from source there is none", ps.app_place("darwin", "/usr/bin/python3", False) is None)
ok("a folder it may write to says yes", ps.can_write_beside(tmp / "Reha") is True)
# read-only parent: chmod 0o555 on POSIX; on Windows a path under a missing drive
ok("a folder it may not write to says no", ps.can_write_beside(locked / "Reha") is False)
ok("and leaves nothing behind", list((tmp).glob(".reha-write-test-*")) == [])

print("\n[update-unpack] A new copy unpacked whole")
# a zip made here with Reha.app/Contents/MacOS/Reha (mode 0o755) and a symlink,
# or Reha/Reha.exe on Windows
ok("the new copy is where the zip put it", copy.name == ("Reha.app" if mac else "Reha"))
ok("on a Mac its executable can still run", (not mac) or os.access(exe, os.X_OK))
ok("on a Mac its symlink is still a link", (not mac) or link.is_symlink())
ok("a zip without the app in it is refused", raises(FileNotFoundError, ps.unpack_app, empty_zip, into))
# Windows: write exe's ":Zone.Identifier" stream, then clear_download_marks(copy)
ok("a Windows mark on an unpacked file is cleared",
   sys.platform != "win32" or not Path(str(exe) + ":Zone.Identifier").exists())
ok("the self-test is asked of the new copy's own program",
   ps.selftest_command(Path("/x/Reha.app"), "darwin")[-1] == "--selftest")

print("\n[update-swap] The swap, run for real on this system")
# stand-in place "Моя музыка/Reha" (a folder with a file "v" holding "old"),
# a staged copy holding "new"; REHA_PID of a process that has already exited;
# REHA_OPEN writes "opened" into a file. Waits for REHA_RESULT, at most 30 s.
ok("the script is plain ASCII", all(ord(c) < 128 for c in ps.swap_script()[1]))
ok("the new copy is in the place, under its name", (place / "v").read_text() == "new")
ok("the old copy waits beside it", (old / "v").read_text() == "old")
ok("it says it worked", result.read_text().strip() == "placed")
ok("and opens the app", opened.exists())
# Windows only: a file in the place held open (open(..., "r") kept) so the move fails
ok("a swap that cannot move a file puts the old copy back", (place / "v").read_text() == "old")
ok("and says so", result.read_text().strip() == "not-moved")
# a REHA_PID that stays alive (this test's own child, sleeping 90 s): not run, too slow;
# instead the script's wait limit is read from its text
ok("it waits at most 60 seconds for the app to close", "60" in ps.swap_script()[1])
ok("the real Trash only: a path that is not there is refused", ps.send_to_trash(tmp / "gone") is False)
```

- [ ] **Step 2: Run them and see them fail**

Run: `python tests/test_platform.py`
Expected: FAIL at `[update-place]` with `AttributeError: module 'rehearsal_recorder.platform_support' has no attribute 'app_place'`.

- [ ] **Step 3: Implement the functions listed under Interfaces** in `platform_support.py`, each with a docstring in the file's manner (what and why, the system's own reason).

- [ ] **Step 4: Run them and see them pass**

Run: `python tests/test_platform.py`
Expected: `Platform differences: every branch behaves.` (the Windows-only checks pass trivially here; Windows CI runs them for real).

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/platform_support.py tests/test_platform.py
git commit -m "Platform: where the app is, unpacking a new copy, and the swap script"
```

### Task 2: Getting it ready, Restart now, and the first start

**Files:**
- Modify: `src/rehearsal_recorder/updates.py` (docstring lines 1-21, `fetch_latest`, `UpdateChecker`)
- Modify: `src/rehearsal_recorder/api.py:905-909` (the checker's construction), `:1354-1393` (`start_update_checks` and the update calls)
- Test: `tests/test_engine.py` (new sections after `[86]`: `[87] Getting a new copy ready`, `[88] Restart now and the first start`)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces (Task 3 relies on the shape of `status()`):
  - `fetch_latest(opener=..., system=sys.platform, tag=None)`: with `tag`, asks `.../releases/tags/{tag}` and accepts a pre-release.
  - `UpdateChecker.__init__(..., place=app_place, state=Path.home()/".rehearsal-recorder"/"update.json", run=subprocess.run, spawn=run_detached, trash=send_to_trash, system=sys.platform, pid=None, tag=os.environ.get("REHA_UPDATE_TAG"))`. `place` is a callable with no arguments that returns the app's place or `None`; `pid=None` means `os.getpid()`. With `tag` set, the release found is offered whatever its number.
  - `status()` adds three keys: `"replace": bool` (the write test's answer at the last check; `False` with no place), `"install": None | {"state": "downloading" | "preparing" | "ready" | "failed" | "place_failed", "version": str, "fraction"?: float, "error"?: str}`, `"updated": str | None` (the version this run was updated to).
  - `start_update() -> {"ok": bool, "error"?: str}`: refused while a take records (`"Not while a take is recording"`), with nothing newer (`"There is no newer version to download"`), when the copy cannot replace itself (`"This copy can't replace itself where it is"`), and while one is already under way (returns ok, starts nothing).
  - `prepare_now() -> None`: the thread's body (spec Part 2): staging folder, hidden; the zip downloaded there as `saved_name(release)` with `.part` and `verify`; `unpack_app`; zip deleted; `clear_download_marks`; waits while `busy()`; `run(selftest_command(copy), timeout=SELFTEST_TIMEOUT_SEC, capture_output=True)`, exit 0 only; writes `ready.json` `{"version": ...}` in the staging folder. Any failure removes the staging folder and sets `install` to `failed` with one of: the download's own words (as today), `"The download could not be unpacked"`, `"The new copy did not start here"`, `"The new copy took too long to start"`, `"There is no room for it on the disk"` (`OSError` with `errno.ENOSPC`).
  - `SELFTEST_TIMEOUT_SEC = 120`.
  - `restart() -> {"ok": bool, "error"?: str}`: only with `install` `ready` or `place_failed` (Try again) and no take; writes `update.json` `{"from", "to", "old"}` where `old` is `place.with_name(f"{place.stem} {current}{place.suffix}")`, passed through `unique_path`; writes the script into the staging folder; `spawn(script_command(script), env)` with the `REHA_*` variables and `REHA_RESULT` = staging folder / `result`; marks itself restarting so a second press is refused (`"Already restarting"`).
  - `after_start() -> {"updated": bool, "failed": bool}`: reads `update.json` and the result. `placed` and this version equal to `to`: `updated` is `to`, the old copy goes through `trash`; if that returns `False`, `update.json` keeps only `old` for the next start, otherwise it is removed with the staging folder. Removing the staging folder ignores errors (on Windows the finished script may hold it for a moment); a later start removes what is left. `not-moved` or `not-closed`: `install` becomes `place_failed` with `"A file in the app's folder was in use"` or `"The app did not close in time"`, the ready copy is kept, `update.json` removed. A staging folder with no `ready.json`, or a `ready.json` whose version is not newer than this copy, is removed; one that is newer becomes `install` `ready`.
  - In `check_now()`: the write test runs each time (`replace`), and a ready copy older than the newest release found is removed (Part 5).
  - `Api.update_now() -> dict` → `start_update()`; `Api.restart_to_update() -> dict` → `restart()`, and when ok, `self._window.destroy()` after 0.3 s on a timer so the answer reaches the interface first.
  - `Api.start_update_checks()`: frozen only, as now; calls `after_start()` first; when `updated` and `asks_for_microphone_again()`, a thread opens `sounddevice.InputStream(device=saved_device(self._config, "device", True), channels=1)` for 0.5 s and closes it, every error ignored.

- [ ] **Step 1: Write the failing tests** in `tests/test_engine.py`. Build on `[50]`'s zip and `serving()`; the checker gets `place=lambda: place`, a `run` stand-in for `ditto`/self-test (records argv, returns `returncode` 0, 1 or raises `subprocess.TimeoutExpired`) and a `spawn` stand-in that records argv and env.

```python
print("\n[87] Getting a new copy ready")
ok("Update starts getting it ready", c.start_update()["ok"] is True)
ok("downloaded, unpacked and checked beside the app, not in Downloads",
   (staging / "ready.json").is_file() and not any(downloads.iterdir()))
ok("the zip is gone once unpacked", not list(staging.glob("*.zip")))
ok("said to be ready", c.status()["install"] == {"state": "ready", "version": "0.9.0"})
ok("the new copy's own self-test was run", ran[-1][-1] == "--selftest")
ok("a self-test that fails leaves nothing and says why",
   failing.status()["install"]["error"] == "The new copy did not start here"
   and not staging.exists())
ok("one that hangs is given up", hanging.status()["install"]["error"] == "The new copy took too long to start")
ok("a zip that will not unpack says so", broken.status()["install"]["error"] == "The download could not be unpacked")
ok("a full disk says so", full.status()["install"]["error"] == "There is no room for it on the disk")
ok("refused while a take records", busy.start_update()["error"] == "Not while a take is recording")
ok("refused where the copy cannot replace itself",
   stuck.status()["replace"] is False
   and stuck.start_update()["error"] == "This copy can't replace itself where it is")
ok("a half-made copy left by a closed app is removed at the next start",
   (fresh.after_start(), not staging.exists())[1])
ok("a ready copy older than the newest release is removed", not old_staging.exists())
ok("a ready copy no newer than this one is removed", not same_staging.exists())
ok("REHA_UPDATE_TAG offers that release, pre-release or not",
   tagged.status()["latest"] == {"version": "0.9.0rc2"})

print("\n[88] Restart now and the first start")
ok("Restart now starts the swap script with the paths in its environment",
   spawned[0][1]["REHA_PLACE"] == str(place) and spawned[0][1]["REHA_PID"] == str(pid))
ok("the old copy will be named after its version, beside the new one",
   Path(spawned[0][1]["REHA_OLD"]).name == "Reha 0.8.0")
ok("a name with spaces and Cyrillic keeps its own name",
   Path(cyr_spawned[0][1]["REHA_OLD"]).name == "Музыка Reha 0.8.0")
ok("a second press starts no second script",
   c.restart()["error"] == "Already restarting" and len(spawned) == 1)
ok("nothing ready, nothing to restart into", idle.restart()["ok"] is False)
ok("the new copy reads that it was put in place", after["updated"] is True
   and new.status()["updated"] == "0.9.0")
ok("and puts the old copy in the Trash", trashed == [old])
ok("a Trash that refuses keeps the old copy for the next start",
   json.loads(state.read_text())["old"] == str(old))
ok("a swap that failed says why, and keeps the ready copy",
   failed.status()["install"] == {"state": "place_failed", "version": "0.9.0",
                                  "error": "A file in the app's folder was in use"})
ok("the Api closes the window once the script is started", destroyed == [True])
ok("on a Mac the new copy opens the input for a moment", opened_streams == [saved_index])
ok("and on Windows it does not", win_streams == [])
ok("run from source, nothing of this happens", a.start_update_checks() is False and not state.exists())
```

- [ ] **Step 2: Run them and see them fail**

Run: `python tests/test_engine.py`
Expected: FAIL at `[87]` with `AttributeError: 'UpdateChecker' object has no attribute 'start_update'`. The suite takes about two minutes; run it once here and once in Step 4.

- [ ] **Step 3: Implement** the interfaces above in `updates.py` and `api.py`. Rewrite `updates.py`'s docstring paragraph "Asked to, it fetches…" for Update and Restart now (spec, Docs). `start_download` and `download_now` stay as they are: they are the fallback Download (U4).

- [ ] **Step 4: Run them and see them pass**

Run: `python tests/test_engine.py && python tests/test_platform.py`
Expected: both end without `PROBLEMS:`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/updates.py src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Update gets the new copy ready beside the app; Restart now swaps it in"
```

### Task 3: The Updates group, the notices, and the fake bridge

**Files:**
- Modify: `ui/src/lib/api.ts:1714-1731` (`UpdateStatus`, new `UpdateInstall`), `:1387-1393` (bridge methods)
- Modify: `ui/src/lib/update.ts`
- Modify: `ui/src/components/UnderTheHood.tsx:137-246` (`Updates`)
- Modify: `ui/e2e/fake-bridge.js:2776-2790`
- Test: `ui/e2e/settings.spec.ts` (the `"a newer version"` describe, from line 1411)

**Interfaces:**
- Consumes: Task 2's `status()` shape, `update_now`, `restart_to_update`.
- Produces:
  - `UpdateStatus` gains `replace?: boolean`, `install?: UpdateInstall | null`, `updated?: string | null`; `UpdateInstall = { state: "downloading" | "preparing" | "ready" | "failed" | "place_failed"; version: string; fraction?: number; error?: string }`.
  - Bridge: `update_now(): Promise<Ok>`, `restart_to_update(): Promise<Ok>`.
  - `update.ts`: `startUpdate(): Promise<void>`, `restartNow(): Promise<void>`. Polls every second while `install.state` is `downloading` or `preparing`. The first time in this run it sees `updated`, it calls `notify({ key: "update", kind: "done", text: \`Updated to ${updated}\` })` (U3). The first time it sees `place_failed`, `notify({ key: "update", kind: "warning", text: \`Could not put ${version} in place\` })`.
  - Fake bridge: `update_status` returns `replace: window.__REPLACE__ ?? true`, `install: window.__INSTALL__ || null`, `updated: window.__UPDATED__ || null`. `update_now` sets `__INSTALL__ = {state: 'downloading', version, fraction: 0.45}`. `restart_to_update` is tracked and returns `{ok: true}`.

The Updates group's rows, words exact (spec Part 6, mockups q1 and q3):

| State | Title · line | Buttons |
|-------|--------------|---------|
| out, `replace` | **Version {v} is out** · You have {ours} | **Update** (default variant), **What's new** |
| out, not `replace` | the same, then an `Alert` (variant `default`, size `box`) with the `Info` icon: "This copy can't replace itself where it is. {fix}" | **Download** (outline), **What's new** |
| `downloading` | **Downloading {v}…**, `Progress`, per cent | none |
| `preparing` | `Spinner`, **Getting {v} ready…** · Unpacking it beside this copy and checking that it starts | none |
| `ready` | **{v} is ready** · The app closes and opens again as {v}, in a few seconds. | **Restart now** (default variant), **What's new** |
| `failed` | **Could not get {v} ready** · {error} in `text-destructive` | **Try again** (outline, runs `startUpdate`), **What's new** |
| `place_failed` | **Could not put {v} in place** · {error} in `text-destructive` | **Try again** (outline, runs `restartNow`), **What's new** |

`{fix}` on a Mac: "Move the app to Applications in {fileManager}, open it from there, and the Update button appears." On Windows: "Move the app's folder to Documents in {fileManager}, open it from there, and the Update button appears." `{fileManager}` is `words(useSystem()).fileManager`. The rows of the fallback Download (`download` running, done, failed) stay as they are now. The words under the checkbox end "…and downloads a new version only when you ask."

- [ ] **Step 1: Write the failing tests** in `settings.spec.ts`, inside `"a newer version"`:
  - `"Update gets it ready, then Restart now restarts into it"`: `__LATEST__ = {version: '0.3.0'}`, press **Update**; expect "Downloading 0.3.0…"; set `__INSTALL__` to preparing, expect "Getting 0.3.0 ready…"; set ready, expect "0.3.0 is ready" and the button **Restart now**; press it; expect `restart_to_update` tracked once.
  - `"where it cannot replace itself, it says how to fix it, and Download stays"`: `__REPLACE__ = false`; expect no **Update**, a **Download** button, and the Mac words with "Finder"; the same page with `navigator.platform` Win32 says "Documents in Explorer".
  - `"says why getting it ready failed, and tries again"`: `__INSTALL__ = {state:'failed', version:'0.3.0', error:'The new copy did not start here'}`; expect the title, the error, **Try again** calls `update_now`.
  - `"after a swap that failed, says why, and Try again restarts"`: `place_failed`; expect the warning notice "Could not put 0.3.0 in place" once and **Try again** calling `restart_to_update`.
  - `"after an update the start screen says Updated to, once"`: `__UPDATED__ = '0.3.0'`, no `__LATEST__`; expect the notice "Updated to 0.3.0" on the start screen; open Settings and back; expect no second notice.
  - Update the existing test `"is fetched into Downloads when asked, and shown there"` to set `__REPLACE__ = false`, since Download is now the fallback.

- [ ] **Step 2: Run them and see them fail**

Run: `cd ui && npx playwright test e2e/settings.spec.ts -g "a newer version"`
Expected: the new tests FAIL (no **Update** button).

- [ ] **Step 3: Implement** `api.ts`, `update.ts`, `Updates` in `UnderTheHood.tsx` and the fake bridge as listed. The group keeps its height steady between states where it can (layout jumps are bugs).

- [ ] **Step 4: Run them and see them pass**

Run: `cd ui && npx tsc -b && npx playwright test e2e/settings.spec.ts -g "a newer version"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/api.ts ui/src/lib/update.ts ui/src/components/UnderTheHood.tsx ui/e2e/fake-bridge.js ui/e2e/settings.spec.ts
git commit -m "Under the hood: Update, Restart now, and Updated to after the restart"
```

### Task 4: Words for musicians, and reha.stream

**Files:**
- Modify: `README.md` ("Get it", the paragraph from "When a newer version is out")
- Modify: `docs/using-it.md` ("A new version", from line 1647)
- Modify: `docs/design-notes.md` ("Asking whether a newer version is out", the bullet "It fetches, and hands over; it does not replace", line 550)
- Modify: `docs/development.md` (the file map: a line for `updates.py` after `diagnostics.py`; a short paragraph on testing an update by hand with two pre-releases and `REHA_UPDATE_TAG`, spec Testing)
- Modify: `CHANGELOG.md` (Unreleased)
- Modify: `site/content/faq.md` ("Does it need the internet?")

**Interfaces:**
- Consumes: the words of Task 3's table.

- [ ] **Step 1: Write the texts.** The guide says first what to do (press **Update**, then **Restart now**), then what happens (the old copy waits beside it and goes to the Trash, the recordings and settings are not touched, on a Mac macOS asks for the microphone right away and why), then what the line means when the copy cannot replace itself. CHANGELOG item starts bold, e.g. "- **Update, then Restart now, puts a new version in place.** …". The FAQ answer is the spec's text exactly:

> No. It records, plays and keeps its history with no internet in the room. It asks GitHub which version is the latest when it starts and once a day, and sends nothing else. It downloads a new version only when you press Update. Settings › Under the hood switches the asking off.

Rules: curly double quotes, straight apostrophes, button names in bold, British spelling, one word per thing (CLAUDE.md, Writing). Check the longer texts with the humanizer skill.

- [ ] **Step 2: Run the checks the texts touch**

Run: `cd site && npx vitest run src/content` (the news line reads the first CHANGELOG item)
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/using-it.md docs/design-notes.md docs/development.md CHANGELOG.md site/content/faq.md
git commit -m "Docs and the site's FAQ: Update and Restart now"
```

- [ ] **Step 4: Show Alex the FAQ on the PR's Vercel preview** before the merge (it touches `site/`, so the preview is built), and post a comment on issue #6 after the merge: step 3 is in, and why signing was not needed for it.
