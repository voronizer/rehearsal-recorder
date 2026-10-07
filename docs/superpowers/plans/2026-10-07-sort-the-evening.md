# Sort the Evening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort a rehearsal on the rehearsal screen and in History (name unnamed takes with song pills, Send starred, clear false starts), send Finish straight to the start screen, and cut reha.stream's story from seven steps to five.

**Architecture:** Python gains three bridge methods (`send_starred`, `delete_takes`, `set_false_start`) and one setting. The UI adds a pure rule (`isFalseStart`) in `lib/evening.ts`, an `EveningActions` component (the two buttons and the question before clearing) that both screens hand to `RehearsalOverview`, and name pills under unnamed rows inside the overview. The site's staged story merges steps in `site/src/stage/Story.tsx`.

**Tech Stack:** Python 3.12 (pywebview bridge, SQLAlchemy library), React 19 + TypeScript + Tailwind v4, Vitest, Playwright, the fake bridge `ui/e2e/fake-bridge.js` and demo band `ui/e2e/band.js`.

**Spec:** `docs/superpowers/specs/2026-10-02-sort-the-evening-design.md` (rewritten 7 Oct 2026 after the discussion with Alex). Mockup: https://claude.ai/artifact/858GuWkrAFhBk7EJkhs1mz. Alex's rulings: `/mnt/project-files/issue12/step7-rulings.md`.

## Global Constraints

- A false start: `duration_sec < false_start_sec`, not starred, no markers. Default `false_start_sec` 30; Settings accepts 5 to 120 whole seconds.
- Copy, exactly: buttons **Send starred** and **Clear false starts**, each followed by its count; the tag **false start**; the question title `Move N false starts to the Trash?` (`1 false start` for one), using `goPlural()`/`canBePutBack()` from `lib/deletion.ts` for machines with no Trash.
- Send starred sends what Settings' *What gets published* says (`auto_publish_what`), only for ★ takes with no cloud copy and none waiting.
- One row of pills under an unnamed take; the pills are `song_choices` for that take; a click is `rename_take(folder, n, title)`.
- Finish asks as today, then shows the start screen. `ui/src/screens/Finished.tsx` is deleted.
- Windows CI cannot print Cyrillic: test titles in Latin script.
- Lint: no new oxlint warnings per file against `scratchpad/lint-baseline.txt`.

## Review Focus

1. A false start that is also unnamed: it is grey in *Not named* and still gets pills; clearing it removes it from *Not named*, and the group goes when empty.
2. Deleting a take that is open in the player or playing in the overview through Clear false starts: the player must forget it, as 🗑 does (`forget(take)`).
3. A window 960 px wide: the figures row wraps with the buttons on their own line, nothing scrolls sideways.
4. Send starred pressed twice quickly: the second press queues nothing new (Python skips waiting takes), and the count drops as the queue fills.
5. The false-start limit changed in Settings while a rehearsal is open: back on the rehearsal screen the overview uses the new limit.

---

### Task 1: Python: the setting, `send_starred`, `delete_takes`

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`get_settings`, new methods beside `set_auto_publish` and `delete_take`)
- Test: `tests/test_engine.py` (new section `[59] Sorting the evening`)

**Interfaces:**
- Produces: `get_settings()["false_start_sec"] -> int`; `set_false_start(seconds) -> {"ok", "false_start_sec"}`; `send_starred(folder) -> {"ok", "queued": [int]} | {"ok": False, "error", "needs_dir": True}`; `delete_takes(folder, take_numbers) -> {"ok", "deleted": [int], "failed": [{"take_number", "error"}]}`.

- [ ] **Step 1: Write the failing checks** in section `[59]`, in the file's `ok(label, cond)` style:
  - `false_start_sec` is 30 with nothing saved; `set_false_start(45)` saves 45; `set_false_start(2)` gives 5, `set_false_start(500)` gives 120, `set_false_start("x")` is `{"ok": False}`.
  - `send_starred` on a rehearsal with ★ takes 1 and 3, take 2 unstarred, take 3 already with a cloud mix: queues `[1]` only, with `auto_publish_what` "both" (the queue entry's `what` is "both"); a second call while take 1 waits queues `[]`.
  - `send_starred` with no cloud folder: `ok` False, `needs_dir` True, nothing queued.
  - `delete_takes(folder, [1, 2, 99])`: `deleted == [1, 2]`, `failed == [{"take_number": 99, "error": "Take not found"}]`, both take folders gone from the rehearsal folder.
- [ ] **Step 2: Run** `venv/bin/python tests/run_all.py 2>&1 | tail -20`. Expected: section [59] fails on the missing methods.
- [ ] **Step 3: Implement** `set_false_start` (int, clamped, `_write_config`), `false_start_sec` in `get_settings` (default 30), `send_starred` (the rehearsal's takes from `self._lib.rehearsal`, skip `_shape_of(take.cloud)` not None and keys in `self._cloud_entries`, then `share_take(folder, n, what)`), `delete_takes` (calls `delete_take` per number, collects).
- [ ] **Step 4: Run** the same command. Expected: all sections pass.
- [ ] **Step 5: Commit** `git commit -m "Python: send the ★ takes, delete several takes, the false-start limit"`.

### Task 2: The rule and the bridge in the interface

**Files:**
- Modify: `ui/src/lib/evening.ts`, `ui/src/lib/evening.test.ts`, `ui/src/lib/api.ts`, `ui/e2e/fake-bridge.js`, `ui/src/lib/songPills.ts`, `ui/src/lib/songPills.test.ts`

**Interfaces:**
- Consumes: Task 1's methods and `false_start_sec`.
- Produces: `isFalseStart(take: Take, limitSec: number): boolean`; `falseStarts(takes: Take[], limitSec: number): Take[]`; `starredToSend(takes: Take[], waiting?: Record<number, unknown>): Take[]`; `Settings.false_start_sec: number`; `api().send_starred(folder)`, `api().delete_takes(folder, numbers)`, `api().set_false_start(seconds)`; `pillsShown(here, other, width, last, row, gap, rows = 2)`.

- [ ] **Step 1: Write the failing Vitest cases:** `isFalseStart` true for 12 s unstarred unmarked at limit 30; false at exactly 30 s; false with `starred`; false with one marker; false for 12 s at limit 10. `starredToSend` skips a take with `cloud.mix`, one with `cloud.tracks`, and one in `waiting`. `pillsShown(..., 1)` keeps what fits one row.
- [ ] **Step 2: Run** `cd ui && npm test`. Expected: the new cases fail.
- [ ] **Step 3: Implement** the three functions, the `rows` parameter (`fitsInTwoRows` becomes `fitsInRows(widths, last, row, gap, rows)`), the api types and methods, and in the fake: `false_start_sec` in `get_settings` (from `window.__FALSE_START__` or 30), `set_false_start`, `send_starred` (★ takes without `cloud`, marked as in the cloud with the fake's `what`), `delete_takes` (reusing its `delete_take`).
- [ ] **Step 4: Run** `cd ui && npx tsc -b && npm test`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Interface: what a false start is, what Send starred sends"`.

### Task 3: The overview: false starts, name pills, the evening's buttons

**Files:**
- Create: `ui/src/components/EveningActions.tsx`, `ui/e2e/evening.spec.ts`
- Modify: `ui/src/components/RehearsalOverview.tsx`, `ui/src/components/SongPills.tsx`

**Interfaces:**
- Consumes: Task 2.
- Produces: `RehearsalOverview` new optional props `falseStartSec?: number`, `folder?: string`, `onName?: (take: Take, title: string) => void`, `actions?: ReactNode` (drawn on the figures row's right; the legend moves to its own line under it when `actions` is given); `SongPills` prop `rows?: number`; `EveningActions({ folder, takes, falseStartSec, cloudDir, waiting, onChanged, onDeleted })` where `onDeleted(takes: Take[])` lets the screen forget them in its player.

- [ ] **Step 1: Write the failing Playwright tests** in `evening.spec.ts` against the rehearsal screen with the fake (titles in Latin):
  - "a short take with no star or mark is drawn as a false start": the row has `data-false-start`, the text `false start`; a 12 s ★ take and a 12 s take with a mark have neither.
  - "the limit comes from Settings": with `__FALSE_START__ = 10`, the 12 s take is not one.
  - "a pill under an unnamed take names it": `rename_take` called with `(folder, n, "Viasna")`, the row now in the Viasna group.
  - "Send starred sends the starred takes not in the cloud": button text `Send starred 2`; after the click `send_starred` called once and the count gone; disabled with title naming why when none; disabled with "Choose a cloud folder in Settings" when `cloud_dir` is null.
  - "Clear false starts asks first and removes only them": dialog title `Move 2 false starts to the Trash?`, both takes listed with lengths; Cancel changes nothing; confirm calls `delete_takes(folder, [4, 10])` and the rows go.
  - "the buttons sit on their own line in a 960 px window" with no horizontal scroll in the overview.
- [ ] **Step 2: Run** `cd ui && npx playwright test e2e/evening.spec.ts`. Expected: all fail (nothing drawn yet).
- [ ] **Step 3: Implement.** The row's bar gets `border-dashed bg-transparent`, its name and length `text-muted-foreground`, and the tag after the length, when `isFalseStart`. Under an unnamed row a `NamePills` piece (inside RehearsalOverview) uses `useSongChoices(true, folder, take.take_number)` and `SongPills` with `rows={1}`, `onPick={(title) => onName(take, title)}`. `EveningActions` renders the two outline `sm` buttons (CloudUpload, Trash2 icons, count in `tnum text-muted-foreground`), the `ConfirmDialog` with the list as `description`, and reports failures with `notify`.
- [ ] **Step 4: Run** the spec, then the whole `npx playwright test`. Expected: green, 293 earlier tests included.
- [ ] **Step 5: Commit** `git commit -m "The overview: false starts, name pills, Send starred and Clear false starts"`.

### Task 4: Both screens use it

**Files:**
- Modify: `ui/src/screens/Rehearsal.tsx`, `ui/src/screens/HistoryScreen.tsx`
- Test: `ui/e2e/evening.spec.ts` (History cases)

**Interfaces:**
- Consumes: Task 3's props and `EveningActions`.

- [ ] **Step 1: Write the failing tests:** in History, a rehearsal's page shows the false start, the pills and both buttons; a pill renames the take there; clearing a false start that is open in the player closes it.
- [ ] **Step 2: Run** them. Expected: fail.
- [ ] **Step 3: Implement.** Each screen reads `false_start_sec` and `cloud_dir` from `get_settings` on mount; passes `folder`, `falseStartSec`, `onName` (its existing `renameTake`), and `actions={<EveningActions …/>}` with `onDeleted` calling `forget` for each take (History: `placed(folder, take)`).
- [ ] **Step 4: Run** `npx playwright test`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Sort the evening on the rehearsal screen and in History"`.

### Task 5: Finish goes to the start screen

**Files:**
- Delete: `ui/src/screens/Finished.tsx`
- Modify: `ui/src/App.tsx`, `ui/src/components/Shell.tsx` (the comment about Finished), `ui/e2e/setup.spec.ts`, `ui/e2e/footer.spec.ts`, `ui/e2e/background.spec.ts`

- [ ] **Step 1: Change the tests first:** `setup.spec.ts:115` expects the start screen (`#rehearsal-name` visible, Last time showing the evening) after Finish; the footer test for the finished screen goes; `background.spec.ts:165` expects the start screen.
- [ ] **Step 2: Run** them. Expected: fail on "Rehearsal finished" still shown.
- [ ] **Step 3: Implement:** `onFinished` sets `{ name: "setup" }`; the `finished` screen and its import go.
- [ ] **Step 4: Run** `npx tsc -b && npx playwright test`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Finish goes straight to the start screen"`.

### Task 6: Settings

**Files:**
- Modify: `ui/src/screens/Settings.tsx`
- Test: `ui/e2e/settings.spec.ts` (or the spec that covers the Folders page)

- [ ] **Step 1: Write the failing tests:** Folders shows "False starts" with a number field at 30; typing 45 and leaving the field calls `set_false_start(45)`; with a cloud folder and sending off, the *What gets published* buttons are enabled and choosing Tracks calls `set_auto_publish(false, "tracks")`; with no cloud folder they are disabled.
- [ ] **Step 2: Run** them. Expected: fail.
- [ ] **Step 3: Implement:** a section under the recordings folder, label "False starts", text "Takes shorter than [n] seconds, with no ★ and no marks, are marked as false starts on the rehearsal screen." (`Input type="number" min=5 max=120`); *What gets published* `disabled={!settings?.cloud_dir}`, onClick `set_auto_publish(settings.auto_publish, o.id)`, and its hint always the chosen option's.
- [ ] **Step 4: Run** `npx playwright test`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Settings: the false-start limit; what gets published is live with a cloud folder"`.

### Task 7: reha.stream in five steps

**Files:**
- Modify: `ui/e2e/band.js` (tonight's `EARLIER`), `site/content/story.md`, `site/src/stage/Story.tsx`, `site/src/page/Story.tsx` (comment), `site/src/content/index.test.ts`, `site/e2e/page.spec.ts`, `site/e2e/stage.spec.ts`, `tests/docs_screenshots.py` if a picture names a take that moved

**Interfaces:**
- Produces: `STORY = ["setup", "record", "keep", "history", "compare"]`.

- [ ] **Step 1: Change the tests first:** five steps in that order in `index.test.ts` and `page.spec.ts`; `stage.spec.ts` "the story goes through its five steps": `keep` ends with the unnamed take named (its row in the Viasna group) and a `[data-false-start]` row on screen; `history` ends on Pałyn's page.
- [ ] **Step 2: Run** `cd site && npm test && npm run build && npx playwright test`. Expected: fail.
- [ ] **Step 3: Implement.** `EARLIER` gains take 4 "Ahoń", 12 s (a false start) and take 5 "Take 5", 1:48 (unnamed), so the recorded take is take 6. Ahoń, not Pałyn or Viasna, so the docs pictures' Next take (Viasna 2) and the story's recorded go (Pałyn 3) stay as they are. The hero, which is the same rehearsal screen, then shows the false start, the pills and the two buttons too. `record` does today's `before` (Pałyn picked, Pałyn 7 playing) then, after 3 s, today's `record`. `keep` does today's `review` (Stop), then Save take, back to the rehearsal screen (`Hero` with the fresh session), and clicks the Viasna pill under Take 5. `history` finishes, shows History, then today's `song`. Captions in `story.md`:
  - **Hear last week, then record.** "Name the next take after a song, and its best go from before sits right beside it. Then a big clock, and a tile per track that turns red when it clips."
  - **Keep the good ones.** "Stop, save it, and sort the evening as you go: one click names a take, the false starts are grey, and the ★ ones go to the band's folder with one button."
  - **Find it later.** "Every rehearsal, song by song, with the marks you left. A song's page has every go at it, one line an evening."
- [ ] **Step 4: Run** the site suite, and `tests/docs_screenshots.py` step by step as before; look at each picture.
- [ ] **Step 5: Commit** `git commit -m "reha.stream: the story in five steps, sorting the evening in Keep the good ones"`.

### Task 8: Docs

**Files:**
- Modify: `docs/using-it.md` (*The rehearsal screen*, *Names and songs*, *Sending takes to the cloud*, *Keyboard*: Esc finishes and lands on the start screen), `CHANGELOG.md` (Unreleased), `docs/screenshots/rehearsal.png` (re-shot in Task 7)

- [ ] **Step 1:** Write the sections; one CHANGELOG entry "**Sort the evening as it goes.**".
- [ ] **Step 2:** Run `venv/bin/python tests/run_all.py` (docs checks included). Expected: green.
- [ ] **Step 3: Commit** `git commit -m "Docs: sorting the evening"`.
