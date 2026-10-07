# Goes in the Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The take strip becomes a tab per song that opens into columns of goes; another go at the open song keeps the place (position, loop, Repeat, zoom, playing), by click or ↑ ↓, across rehearsals from a song's page; the window's header carries the evening's facts and a button to its folder; reha.stream gets a sixth story step.

**Architecture:**
- Python:
  - `open_in_file_manager` starts the system's opener with a list of arguments, never through a shell.
  - `Api.show_rehearsal_folder(folder)` opens a known rehearsal's folder.
  - `session_state` carries `disk_bytes`.
- Interface:
  - Pure functions in `ui/src/lib/songTabs.ts` and `ui/src/lib/evening.ts` work out the tabs, a song's goes by time and the evening's facts.
  - `useMultitrackPlayer` gains `spot()` and `restore(spot)`; `useTakeStripPlayer` gains `move(take)` and the columns' open state.
  - `TakeStrip` is rewritten around `SongTab`. A new `EveningFacts` sits in the header through a new `Shell` slot.
  - History hands the strip a song's goes from its page and opens a go of another rehearsal with the place kept.
- The fake bridge, the band and the site learn what they need.

**Tech Stack:** Python 3.12, pywebview; React 19 + TypeScript + Tailwind v4, lucide-react; Vitest; Playwright against `ui/e2e/fake-bridge.js`; the site in `site/`.

**Spec:** `docs/superpowers/specs/2026-10-02-goes-in-the-player-design.md`. The mockup it names (version 12) is the copy and the look for anything this plan does not spell out.

## Global Constraints

- No new dependencies, and no migration.
- Copy is English, as the app is. Test titles and `ok()` labels stay in Latin script (Windows CI cannot print Cyrillic); test data can be any script.
- Python tests are scripts: `ok(label, cond)` under `print("\n[N] …")`. The next section of `tests/test_engine.py` is `[57]`. Run `venv/bin/python tests/test_engine.py` and `venv/bin/python tests/test_platform.py`.
- Interface checks: `cd ui && npx tsc -b`, `npm test`, `npm run lint` (no new warnings), `npm run build && npx playwright test e2e/<file>`.
- Site checks: `cd site && npm test`, `npm run build && npx playwright test`.
- Full suites once, in Task 9: `venv/bin/python tests/run_all.py`, `cd ui && npm run build && npm run test:e2e`, the site's both.
- Changing an existing test: only the tests this plan names, only as it says. Any other failing test is stopped on and reported, not edited.
- Comments say why, in plain sentences, like the code around them.
- Commits end with the session's attribution lines. Nothing is pushed until Task 9.
- Never run against the real `~/RehearsalRecordings`.

## Decisions made while planning

1. **The DOM the tests rely on:**
   - the strip: `role="group" aria-label="Take strip"`, as now;
   - the toggle: a button named "Songs" with `aria-expanded`;
   - a tab: `[data-tab="<key>"]`, the key being the song's title or `take:<n>`; the open one has `aria-current="true"`;
   - a tab's visible second line: `[data-tab-line]`;
   - a shut tab is one button, named `"<title>, go <n>, <m:ss>"` (`"Take 3, 1:30"` with no song), `", starred"` added when its go is;
   - the open go's number, when the song has more than one go: a button named `"Every go at <song>"` with `aria-expanded`;
   - a column: `[data-column="<key>"]`; its rows `button[data-go-row]`, named by `takeButtonLabel` as the pills were ("Take 2 Pałyn 2"), with `aria-current="true"` on the open go; a day heading `[data-day]`.
   - The unseen copies that hold a tab's width carry `aria-hidden`, no buttons and no `data-*` attributes.
2. **Where the facts sit:** a new `Shell` prop, `facts?: ReactNode`, drawn after the title and before the activity button, with a rule between it and the speaker, as in the mockup.
3. **The facts are counted from the takes on screen** (`evening.ts`), so they follow a delete or a copy at once. Only the size on disk comes from Python: History's `RehearsalSummary.disk_bytes`, and the session's new `disk_bytes`.
4. **Length under a minute** reads "<1 min"; otherwise `formatDuration`.
5. **The folder button's words:** "Show in Finder" on a Mac, "Show in Explorer" on Windows, "Open folder" elsewhere (`FOLDER_BUTTON` in `lib/platform.ts`). It opens the folder itself, as Alex asked for "a button to open" it.
6. **A region kept** must still be at least 0.5 s once clamped, or it is dropped with Repeat. The zoom goes through `setView`, which already clamps and keeps the least span.
7. **Opening a go of another rehearsal from inside the player** does not touch where the song's page was scrolled: that is remembered only when the player is opened from the page.
8. **The fake's `get_rehearsal('/rec/older')` includes `__EXTRA_SONGS__`,** as its library does, so a song's goes from two rehearsals on disk can be gone through in the tests.
9. **↑ and ↓ live in `TakeStrip`,** which is on screen exactly while a take is open there; `PlayerKeys` lists them when given `goKeys`.

## Review Focus

1. A rename, a crop or a delete of the open go while the columns are open: the strip must not lose the open tab or show a stale column.
2. ↑ or ↓ pressed again before the next go has opened: one move at a time, and the place carried is the first one's.
3. A cloud copy finishing ("Waiting for the cloud" going away) while a tab is shown: the line changes, but no tab may jump for a click.
4. The live rehearsal screen: a take saved while another is open must land in its song's tab without moving the open one.
5. Esc with the columns open and a dialog (rename, keys list) open on top: the dialog goes first, then the columns, then the take.

---

### Task 1: Python: a rehearsal's folder opened, and the session's size on disk

**Files:**
- Modify: `src/rehearsal_recorder/platform_support.py` (`open_in_file_manager`)
- Modify: `src/rehearsal_recorder/api.py` (import, `show_rehearsal_folder` beside `show_file`, `session_state`)
- Modify: `ui/src/lib/api.ts` (`SessionState.disk_bytes?`, `PyApi.show_rehearsal_folder`)
- Modify: `ui/e2e/fake-bridge.js` (`show_rehearsal_folder`, `session_state.disk_bytes`)
- Test: `tests/test_platform.py`, `tests/test_engine.py`

**Interfaces:**
- Produces: `open_in_file_manager(path, system=sys.platform, run=None) -> {"ok": bool, "error"?: str}`; `Api.show_rehearsal_folder(folder) -> {"ok": bool, "error"?: str}`; `session_state()["disk_bytes"]: int`; TS `show_rehearsal_folder(folder: string): Promise<Ok>`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/test_platform.py`, a new section after `[reveal]`, `print("\n[open] A folder opens in the system's file manager")`:
    - `ps.open_in_file_manager("/Users/a/Rec/Jam", system="darwin", run=ran.append)` → `ran[-1] == ["open", "/Users/a/Rec/Jam"]`;
    - `system="linux"` → `["xdg-open", "/home/a/Rec/Jam"]`;
    - `system="win32"` → `["explorer", r"C:\Rec\Jam"]`;
    - a name with a quote and `$(…)` in it, on darwin, reaches `run` as one list item, unchanged;
    - a `run` that raises → `{"ok": False, ...}`, not raised.
  - `tests/test_engine.py`, `[57] A rehearsal's folder, shown; the session's size on disk`:
    - with `apimod.open_in_file_manager` replaced by a recorder: `show_rehearsal_folder(folder)` of a rehearsal from an old `session.json` (as `[56]` makes them) opens that folder and answers `{"ok": True}`;
    - a folder the library does not know is refused (`ok` False, nothing opened);
    - a known rehearsal whose folder is gone is refused with "The rehearsal's folder is not on disk";
    - after `start_rehearsal`, `show_rehearsal_folder(session folder)` opens it;
    - `session_state()["disk_bytes"]` is an int and equals `_folder_bytes(folder)` after a file is written into the session folder.
- [ ] **Step 2: Run them.** Expected: FAIL (the commands are shell strings; `show_rehearsal_folder` and `disk_bytes` do not exist).
- [ ] **Step 3: Implement.**
  - `open_in_file_manager(path, system=sys.platform, run=None)`: `["explorer", path]` on win32, `["open", path]` on darwin, `["xdg-open", path]` elsewhere; `run` defaults to `subprocess.Popen`; any exception → `{"ok": False, "error": str(e)}`. Its docstring says why it is a list.
  - `Api.show_rehearsal_folder(folder)`: `self._lib.has(folder)` or refuse ("Rehearsal not found"); `Path(folder).is_dir()` or refuse ("The rehearsal's folder is not on disk"); then `open_in_file_manager(folder)`. Import it in `api.py` beside `reveal_in_file_manager`.
  - `session_state`: `"disk_bytes": _folder_bytes(s["folder"])`.
  - `api.ts`: the type and the call; `show_rehearsal_folder` answers `{ok, error}`, so it is not in `ANSWERS_WITH_A_VALUE`.
  - The fake: `show_rehearsal_folder: track(..., async () => ({ok: true}))`; `session_state` adds `disk_bytes: 48000000 * session.takes.length`.
- [ ] **Step 4: Run** both Python scripts and `cd ui && npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** "A rehearsal's folder opens from the app, and the session knows its size".

### Task 2: The tabs and the evening, worked out

**Files:**
- Create: `ui/src/lib/songTabs.ts`, `ui/src/lib/songTabs.test.ts`
- Create: `ui/src/lib/evening.ts`, `ui/src/lib/evening.test.ts`
- Modify: `ui/src/lib/platform.ts` (`IS_WINDOWS`, `FOLDER_BUTTON`)

**Interfaces:**
- Produces:
  - `type SongTab = { key: string; song: string | null; takes: Take[] }`
  - `songTabs(takes: Take[]): SongTab[]`
  - `lastPlayed(tab: SongTab): Take`
  - `goesByTime(goes: SongGo[]): SongGo[]`
  - `neighbour<T>(list: T[], at: number, dir: -1 | 1): T | null`
  - `type EveningFacts = { seconds: number; takes: number; songs: number; inCloud: number }`
  - `eveningOf(takes: Take[]): EveningFacts`
  - `lengthLabel(seconds: number): string`, `takesLine(f: EveningFacts): string`
  - `IS_WINDOWS: boolean`, `FOLDER_BUTTON: string`

- [ ] **Step 1: Write the failing tests** (Vitest, Take objects built with a small `take(n, song, go)` helper in each file):
  - `songTabs`: [Pałyn 1, Take 2, Viasna 1, Pałyn 2, Take 5] → keys `["Pałyn", "take:2", "Viasna", "take:5"]`, Pałyn's takes 1 and 4 in that order; `[]` → `[]`.
  - `lastPlayed`: Pałyn's tab above → take 4.
  - `goesByTime`: goes given newest rehearsal first (as `get_song` sends them) come back oldest rehearsal first, played order within one; goes with `missing: true` are left out.
  - `neighbour([a, b, c], 1, -1) === a`, `(…, 1, 1) === c`, `(…, 0, -1) === null`, `(…, 2, 1) === null`, `(…, -1, 1) === null`.
  - `eveningOf`: three takes of 60, 90, 30 s, two with a song (one song), one with `cloud.mix` → `{seconds: 180, takes: 3, songs: 1, inCloud: 1}`.
  - `lengthLabel(0) === "0 min"`, `lengthLabel(20) === "<1 min"`, `lengthLabel(2700) === "45 min"`.
  - `takesLine({takes: 11, songs: 4, …}) === "11, 4 songs"`; one song → `"2, 1 song"`; no song → `"2"`.
- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/songTabs.test.ts src/lib/evening.test.ts`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** the functions in the two files, and in `platform.ts`: `IS_WINDOWS = /Win/.test(navigator.platform)` (guarded as `IS_MAC` is) and `FOLDER_BUTTON` per Decision 5.
- [ ] **Step 4: Run** the same command and `npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** "The strip's tabs and an evening's facts, worked out from its takes".

### Task 3: The strip of song tabs, and its columns

**Files:**
- Create: `ui/src/components/SongTab.tsx`
- Modify: `ui/src/components/TakeStrip.tsx` (the `TakeStrip` component; `liveTake`, `takeCloudStatus`, `takeButtonLabel` stay)
- Modify: `ui/src/hooks/useTakeStripPlayer.ts` (`expanded`, `setExpanded`, closed on `select(null)` and `close()`)
- Modify: `ui/src/screens/HistoryScreen.tsx`, `ui/src/screens/Rehearsal.tsx` (new props; Escape)
- Create: `ui/e2e/goes.spec.ts`
- Modify (named tests only): `ui/e2e/player.spec.ts`, `ui/e2e/stars.spec.ts`, `ui/e2e/songs.spec.ts`

**Interfaces:**
- Consumes: Task 2's `songTabs`, `lastPlayed`.
- Produces: `TakeStrip` props `{ takes, selected, folder?, across?: SongGo[], expanded, onExpandedChange, onSelect, onGo: (take: Take, folder?: string) => void, onRename?, onShare?, onDelete?, onStar?, cloudStates?, emptyHint? }`; `useTakeStripPlayer` returns `expanded: boolean`, `setExpanded: (open: boolean) => void`.

- [ ] **Step 1: Write the failing tests** in `ui/e2e/goes.spec.ts`, on History's full evening (`window.__FULL_EVENING__ = true`, Tuesday jam: Pałyn 1, Pałyn 2, Take 3, Viasna 1), the player opened from the overview's "Take 2 Pałyn 2":
  - "one tab per song, in the order first played": `[data-tab]` keys are `Pałyn`, `take:3`, `Viasna`; the open tab is Pałyn and its `[data-tab-line]` starts with "2"; Viasna's shut tab is the button "Viasna, go 1, 4:10".
  - "another song's tab opens its last go from the start": click Viasna's tab → `player_open` gets `/rec/old/v1.wav`, the open tab is Viasna, and no `player_seek` past 0 follows.
  - "a tab keeps its size when it is opened": the boxes of all `[data-tab]` measured, Viasna's tab clicked, measured again → every width the same to the pixel.
  - "Songs opens the tabs into columns, and the number too": "Songs" → `aria-expanded="true"`, three `[data-column]`, Pałyn's with rows "Take 1 Pałyn 1" and "Take 2 Pałyn 2", the second `aria-current`; "Songs" again closes them; "Every go at Pałyn" opens them as well.
  - "Escape closes the columns first, then the take, and a take opened again starts with them closed": columns open, Escape → no `[data-column]` and the timeline still there; Escape → overview; "Take 1 Pałyn 1" opened → "Songs" has `aria-expanded="false"`.
  - "a go in another song's column starts from the start": columns open, at 0:30 (a click on the timeline), the row "Take 4 Viasna 1" → opens `v1.wav`, position 0.
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/goes.spec.ts`. Expected: FAIL (pills, no tabs).
- [ ] **Step 3: Implement.**
  - `SongTab` draws one tab: the name (16 px, `data-text` and an unseen bold copy for its width); the second line in a one-cell grid, the shown go's line on top of an unseen copy per other go (Decision 1); the number as the "Every go at …" button on the open tab when there is more than one go; under it, when `expanded`, the column. Its line has the go's number (mono, semibold), length, ★ (`data-starred`), the marks' colours and count, and `takeCloudStatus` when there is one.
  - `TakeStrip`: the "Songs" toggle with ▾/▴, the tabs in a row that scrolls sideways and keeps the open tab in view (as the pills did), the tools as now. The open tab's goes are `across` when given, else its takes; a row of the open song calls `onGo(take, go.folder)`, a row or tab of another `onSelect(take)`. The shut tab's go is `lastPlayed(tab)`.
  - `useTakeStripPlayer`: `expanded` state, false again on `select(null)` and `close()`.
  - Screens: pass `expanded`/`onExpandedChange`; `onGo` for now is `select` (Task 4 makes it keep the place); Escape closes the columns first (`selected && expanded ? setExpanded(false) : …`).
  - The tests named below change as written here, and no others:
    - `player.spec.ts` "opens in the player below its pill…": the `aria-current` check becomes `strip.locator("[data-tab='Pałyn'][aria-current='true'] [data-tab-line]")` toContainText "2".
    - `player.spec.ts` "still opens when the chosen output is gone…": take 1 is opened by "Songs" then the row `button[aria-label^='Take 1 Pałyn']`, its `aria-current` checked on that row; take 2 by its row.
    - `player.spec.ts` "one master turns the whole take down…" and "drops the region's times once the view has nothing to do with it": the switch to take 1 goes through "Songs" and the row, and the `aria-current` check is on the row.
    - `stars.spec.ts` "in the player, ★ is beside the open take, and its pill carries it" → title "in the player, ★ is beside the open take, and its tab carries it"; the `^Take 2 Pałyn 2, starred` button check becomes the open tab's `[data-tab-line] [data-starred]` count 1.
    - `stars.spec.ts` "every starred pill carries ★, not only the open one" → "a tab carries the ★ of its go, and the columns every starred go": with Viasna 1 open, Take 3's tab line has ★ and Pałyn's has none (it shows Pałyn 2); "Songs" → rows "Take 1 Pałyn 1, starred" and "Take 3 Take 3, starred" visible.
    - `songs.spec.ts` "a go opened from a song's page, and Escape back…": the `button[aria-current='true']` check becomes the open tab `[data-tab='Pałyn']` with line starting "2".
    - `songs.spec.ts` "a go of another rehearsal than the one chosen…": `^Take 2 Daroha 2` becomes the tab `[data-tab='Daroha']` being open, and "Songs" showing the row "Take 2 Daroha 2".
- [ ] **Step 4: Run** `goes.spec.ts`, `player.spec.ts`, `stars.spec.ts`, `songs.spec.ts`, `history.spec.ts`, `cloud.spec.ts`, `background.spec.ts`, `naming.spec.ts`, plus `npx tsc -b` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** "A tab per song on the strip, opening into columns of its goes".

### Task 4: Another go at the song, at the same place

**Files:**
- Modify: `ui/src/hooks/useMultitrackPlayer.ts` (`Spot`, `spot()`, `restore(spot)`)
- Modify: `ui/src/hooks/useTakeStripPlayer.ts` (`move(take)`; `pending.spot`)
- Modify: `ui/src/components/TakeStrip.tsx` (↑ ↓ through `useKey`)
- Modify: `ui/src/components/PlayerKeys.tsx`, `ui/src/components/TakePlayer.tsx` (`goKeys`)
- Modify: `ui/src/screens/HistoryScreen.tsx`, `ui/src/screens/Rehearsal.tsx` (`onGo` → `move`; `goKeys`)
- Test: `ui/e2e/goes.spec.ts`

**Interfaces:**
- Consumes: Task 2's `neighbour`; Task 3's `onGo`.
- Produces: `type Spot = { position: number; region: { a: number; b: number } | null; looping: boolean; view: { from: number; to: number } | null; playing: boolean }`; `player.spot(): Spot`; `player.restore(spot: Spot): void`; `useTakeStripPlayer().move(take: T): void`.

- [ ] **Step 1: Write the failing tests** in `goes.spec.ts` (full evening; Pałyn 1 is 192 s, Pałyn 2 178 s):
  - "the place is kept going to another go at the song": Pałyn 1 open, a region dragged over 0.25–0.5, Repeat on, zoomed in (Ctrl and the wheel), Space to play; then "Songs" and the row "Take 2 Pałyn 2" → after it: `player_set_loop` last args ≈ [48, 96] (±0.5), Repeat `aria-pressed="true"`, "Whole take" visible, and of the calls after the click the last `player_seek` comes before the last `player_play`.
  - "↓ and ↑ go through the song's goes, and do nothing at the ends": Pałyn 1 open → ↓ opens `p2.wav`; ↓ again opens nothing new (`player_open` count unchanged); ↑ opens `p1.wav`; with Take 3 open, ↑ and ↓ open nothing.
  - "a place past the end of a shorter go is clamped": Pałyn 1 at 185 s (a click at 185/192 of the timeline) → ↓ → the last `player_seek` arg ≤ 178.
  - "the keys list says ↑ and ↓" with a take open on the strip, and the review screen's list does not.
  - "the place is not carried by a tab": Pałyn 1 at 0:30 → Viasna's tab → position 0, no region.
- [ ] **Step 2: Run** `npx playwright test e2e/goes.spec.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `spot()` reads the state as it is; `restore(spot)` clamps every second to the open take's `duration`, keeps the region only if it is still ≥ 0.5 s (Decision 6), sets it and Repeat (`applyLoop(region, true)`), sets the view through `setView`, then `seek`, then `play` if it was playing.
  - `move(take)`: a go already loaded does nothing; otherwise `whenOpen({at: null, play: false, spot: player.spot()})` and selects it. The pending effect calls `restore(pending.spot)` when there is one, and lists `restore` among its dependencies.
  - `TakeStrip`: `useKey("ArrowUp" | "ArrowDown")`, enabled while a take is open, calling `onGo` with `neighbour` of the open go in the open song's goes.
  - `PlayerKeys({ spaceKey, goKeys })` lists `[["↑", "↓"], "Previous / next go at this song"]` after Home when `goKeys`; `TakePlayer` passes it on; History and Rehearsal set it.
  - Screens: `onGo` → `move(here(take))` / `move(take)`.
- [ ] **Step 4: Run** `goes.spec.ts` and `player.spec.ts`, `tsc`, `lint`. Expected: PASS.
- [ ] **Step 5: Commit** "Another go at the song opens at the same place, by its row or ↑ ↓".

### Task 5: The evening in the header

**Files:**
- Create: `ui/src/components/EveningFacts.tsx`
- Modify: `ui/src/components/Shell.tsx` (`facts` prop)
- Modify: `ui/src/screens/HistoryScreen.tsx` (player: facts in; folder line out)
- Modify: `ui/src/screens/Rehearsal.tsx` (facts in; badge and folder line out)
- Test: `ui/e2e/goes.spec.ts`

**Interfaces:**
- Consumes: Task 1's `show_rehearsal_folder`, `disk_bytes`; Task 2's `eveningOf`, `lengthLabel`, `takesLine`, `FOLDER_BUTTON`.
- Produces: `EveningFacts({ takes: Take[]; bytes: number | null; folder: string })`.

- [ ] **Step 1: Write the failing tests:**
  - "the player's header says what the evening was, and opens its folder": History, "Take 2 Pałyn 2" open → the header has "Length" "11 min", "Takes" "4, 2 songs", "In the cloud" "1 of 4", "On disk" "1.2 GB"; no `/rec/old` text on screen; the button "Open folder" → `show_rehearsal_folder` called with `/rec/old`.
  - "the rehearsal screen has the same header": two takes recorded and saved → "Takes" "2, 1 song"; no "2 takes" badge; no folder line.
  - "on Windows the button says Explorer" (platform faked as the docs do).
  - "a narrow window keeps the length, the takes and the button": viewport 1000 wide → "In the cloud" hidden, "Length" and the button visible.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `EveningFacts` (each fact a small label over its value; In the cloud and On disk `hidden xl:flex`, Decision H4 of the spec; the button with a folder icon and `FOLDER_BUTTON`, its failure said through `notify`), the `Shell` slot (Decision 2), and the two screens. History's bytes come from the list's summary of the open go's rehearsal; the rehearsal screen's from `session.disk_bytes`.
- [ ] **Step 4: Run** `goes.spec.ts`, `history.spec.ts`, `recording.spec.ts`, `player.spec.ts`, `tsc`, `lint`. Expected: PASS.
- [ ] **Step 5: Commit** "The evening's facts and its folder in the window's header".

### Task 6: From a song's page, through every go by time

**Files:**
- Modify: `ui/src/screens/HistoryScreen.tsx` (`across`, `folder`, `onGo` across rehearsals, `openGo(take, at | "keep")`)
- Modify: `ui/src/components/SongTab.tsx` (day headings)
- Modify: `ui/e2e/fake-bridge.js` (Decision 8)
- Test: `ui/e2e/songs.spec.ts`

**Interfaces:**
- Consumes: Task 2's `goesByTime`; Task 4's `move`.

- [ ] **Step 1: Write the failing tests** in `songs.spec.ts` (`__FULL_EVENING__` and `__EXTRA_SONGS__ = ["Pałyn", "Pałyn"]`, so Pałyn has goes in First rehearsal, 25 Aug, and Tuesday jam, 10 Sep, and two in Missing jam):
  - "from a song's page, the column has every go by time, with its days": "Take 2 Pałyn 2" of `/rec/old` opened from the page, "Songs" → Pałyn's column has `[data-day]` "Tue 25 Aug" then "Thu 10 Sep", four rows, none from `/rec/gone`.
  - "↑ goes on into the rehearsal before, with the place kept": at 0:30 → ↑ (Pałyn 1 of Tuesday jam) → ↑ → `get_rehearsal('/rec/older')`, the heading "First rehearsal", tabs Daroha and Pałyn, `player_open` with `/rec/older/x4.wav`, the last `player_seek` ≈ 30; Escape → the song's page, scrolled where it was.
  - "another song picked there goes through that evening's goes only": in First rehearsal, Daroha's tab, then "Songs" → Daroha's column has no `[data-day]` and two rows.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `across` is `goesByTime(pageShown.goes)` while the Songs view shows the page of the open go's song; `folder` is the open go's rehearsal; `onGo(take, folder)` moves within it, or calls `openGo(placed(folder, take), "keep")`, which reads that rehearsal and `move`s, keeping the page's scroll as it was (Decision 7). The column groups rows under `formatDayIn(created_at)` when its goes come from more than one rehearsal. The fake per Decision 8.
- [ ] **Step 4: Run** `songs.spec.ts`, `goes.spec.ts`, `history.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** "From a song's page, every go at it by time, across rehearsals".

### Task 7: reha.stream: Compare goes

**Files:**
- Modify: `site/content/story.md`, `site/src/content/index.ts` (`STEPS`), `site/src/content/index.test.ts`
- Modify: `site/src/stage/Story.tsx` (`STORY`, `FORWARD.compare`), `site/src/page/Story.tsx` (its comment's count)
- Modify: `site/e2e/stage.spec.ts`, `site/e2e/page.spec.ts`

- [ ] **Step 1: Write the failing tests:** the content test expects the ids `setup, record, review, history, song, compare`; `stage.spec.ts` "the story goes through its six steps" ends on scene `compare` with the open tab Pałyn, `[data-column]` visible and a `[data-region-span]`; `page.spec.ts`'s scene list gains `compare`.
- [ ] **Step 2: Run** `cd site && npm test` and the two e2e files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `story.md`, after "Find a song":

    ```markdown
    ## Compare goes. {#compare}

    Loop the chorus, then step to the next go: it starts at the same bar,
    still looping. ↑ and ↓ do the same.
    ```
  - `FORWARD.compare`: from the song step, open Pałyn 5 on the open rung, drag a region across its bridge (`__SONG__`-free: fractions 0.55–0.7), Repeat, play, "Songs", then the row of Pałyn 6; wait for the open tab's line to start with "6".
- [ ] **Step 4: Run** the site's unit and e2e tests. Expected: PASS.
- [ ] **Step 5: Commit** "reha.stream: a sixth step, comparing goes".

### Task 8: The guide, the changelog and the pictures

**Files:**
- Modify: `docs/using-it.md` (The rehearsal screen, Listening back, Keyboard), `CHANGELOG.md` (Unreleased)
- Modify: `docs/screenshots/rehearsal.png`, `player.png`, `zoom.png` (taken again)

- [ ] **Step 1:** The guide: the header's facts and folder button; the tabs, their columns, "the same place" and ↑ ↓; the Keyboard table gains "↑ and ↓ | the previous or next go at the open song, at the same place". CHANGELOG, under Unreleased: one entry for the tabs and the kept place, one for the header.
- [ ] **Step 2:** The three pictures taken again the way `tests/docs_screenshots.py` takes them (Node Playwright stand-in, as for step 4, since the Python one is not installed); look at each.
- [ ] **Step 3: Commit** "Docs: goes in the player".

### Task 9: Whole suites, review, PR

- [ ] **Step 1:** `venv/bin/python tests/run_all.py`; `cd ui && npx tsc -b && npm test && npm run lint && npm run build && npm run test:e2e`; `cd site && npm test && npm run build && npx playwright test`. Expected: all green; anything else is reported, not edited.
- [ ] **Step 2:** A fresh reviewer on the whole branch, the Review Focus above handed over; Critical and Important fixed with a failing test first.
- [ ] **Step 3:** Push `claude/project-thread-6mqr6n`, open the PR, subscribe to it, drive CI green. Do not merge without asking Alex.
