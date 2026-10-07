# Last time while rehearsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rehearsal screen gets a panel on the right with the Next take field, its songs and the named song's earlier go, playable in place; the recording screen measures a song's first go of the evening against it; reha.stream tells it as a new story step.

**Architecture:** Python adds the earlier goes to `session_state` (`before_tonight`), so the card always matches the field. The rehearsal screen moves its name field out of the footer into a `Shell` side panel. An earlier go is a `PlacedTake` (`lib/songs.ts`) cued in the screen's one `useTakeStripPlayer`, which tells it from tonight's takes with `byPlace`.

**Tech Stack:** Python 3 + SQLAlchemy store (`src/rehearsal_recorder`), React 19 + TypeScript + Tailwind v4 (`ui/`), Playwright e2e on `ui/e2e/fake-bridge.js`, the site in `site/` (Vite, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-02-last-time-while-rehearsing-design.md`

## Global Constraints

- Never run anything against the real `~/RehearsalRecordings`; Python tests use `fresh_api(tmp)`.
- Test titles in Latin script (Windows CI cannot print Cyrillic).
- No new packages.
- Panel widths: `26rem` at a window of 1100 px or more, `22.5rem` below; the app's narrowest window is 960×680.
- The panel uses the app's panel colour (`bg-panel`) with `border-l`, as `Setup.tsx`'s Last time column.
- Copy, exactly:
  - card heading `{song}` + ` — before tonight`; its section's accessible name `{song} before tonight`;
  - toggle `{n} more` / `Fewer`;
  - empty lines: `Name the next take after a song to see how it went before.`, `No goes at {song} before tonight. Tonight's are in the overview.`, `No goes at {song} before tonight.`;
  - recording line `Took {m:ss} on {formatDate(created_at)}`, e.g. `Took 4:00 on 25 Aug`.
- A note plays from `Math.max(0, at - 3)` seconds.
- "N more" covers the 3 latest earlier rehearsals on disk that have a go at the song.
- Every check before a push:
  - `venv/bin/python tests/run_all.py`;
  - `cd ui && npx tsc -b && npm test && npm run lint && npm run build && npm run test:e2e`, lint compared against the baseline in the session scratchpad;
  - `cd site && npm test && npm run build && npx playwright test`.
- Playwright browsers: `PLAYWRIGHT_BROWSERS_PATH=<scratchpad>/pw-browsers`.

## Review Focus

1. **Another song picked while an earlier go plays.** The go stops, and the new song's card shows nothing playing. Test in Task 4.
2. **Opening one of tonight's takes in the player.** The card hides, the field does not move, and closing the take brings the card back. Test in Task 3.
3. **A very long song title.** The card's heading is cut with «…» and whole on hover, and the panel never scrolls sideways at 960 px. Test in Task 3.
4. **Tonight's take 2 beside an earlier take 2.** Playing one never lights the other: take numbers repeat across rehearsals. Test in Task 4.
5. **Tonight's own goes, and a rehearsal not on disk.** The live rehearsal's goes never appear as "before tonight", and goes from a rehearsal whose folder is gone are skipped. They do not count toward the 3 rehearsals either. Test in Task 1.

---

### Task 1: Python: earlier goes in the session state

**Files:**
- Modify: `src/rehearsal_recorder/store/library.py` (after `resolve_name`, ~line 311)
- Modify: `src/rehearsal_recorder/api.py` (`_last_attempt` ~283, new `_before_tonight` beside `_plays_of` ~261, `session_state` ~1436)
- Test: `tests/test_engine.py`, new section `[58]` after `[57]`

**Interfaces:**
- Produces:
  - `Library.song_id(title: str) -> int | None`: casefolded lookup through `_songs_by_key`.
  - `api._before_tonight(title: str, goes: list[dict], folder: str) -> dict | None`: `{"song": title, "first": go, "more": [go, ...]}`, each go `{"folder", "rehearsal", "created_at", "take"}` (no `"missing"`).
  - `api._last_attempt(takes, song, before=None) -> dict | None`: `{"song", "duration_sec"}` from tonight, else `{"song", "duration_sec", "created_at"}` from `before["first"]`.
  - `session_state()["before_tonight"]`: the above or None.

- [ ] **Step 1: Write the failing tests (section [58])**

Set up four rehearsals with `rehearsal58(name, created_at, takes)`, built like `rehearsal56` but with `(name, seconds)` pairs so lengths differ:
- A "First" `2026-08-25T19:00:00`: Polyn 180, Polyn 2 190, Doroga 200.
- B "Middle" `2026-09-10T19:00:00`: Polyn 210, Vesna 220.
- C "Tuesday" `2026-09-15T19:00:00`: Polyn 230, Polyn 2 240, Vesna 250.
- D "Last" `2026-09-22T19:00:00`: Vesna 260, Polyn 270.

Then `s58.start_rehearsal("Live", 0, SR, [{"name": "Gtr", "channel": 1}])` and a `keep58(number, name)` helper copied from section [8]'s `keep`. `pick(go) = (go["folder"], go["take"]["take_number"])`.

```python
s58.set_next_take_name("Polyn")
b = s58.session_state()["before_tonight"]
ok("with no star, the last go of the latest rehearsal is shown", pick(b["first"]) == (D, 2))
ok("more is the last go of each of three rehearsals, less the one shown",
   [pick(g) for g in b["more"]] == [(C, 2), (B, 1)])
ok("the song is the library's title", b["song"] == "Polyn")
ok("a go is in _go_at's shape", set(b["first"]) == {"folder", "rehearsal", "created_at", "take"})
s58.set_take_star(C, 1, True)
b = s58.session_state()["before_tonight"]
ok("the newest starred go is shown", pick(b["first"]) == (C, 1))
ok("then all three rehearsals' last goes", [pick(g) for g in b["more"]] == [(D, 2), (C, 2), (B, 1)])
s58.set_take_star(C, 1, False)
s58.set_next_take_name("polyn")
ok("a title in another case finds its song", s58.session_state()["before_tonight"]["song"] == "Polyn")
la = s58.session_state()["last_attempt"]
ok("the first go tonight is measured against the go shown",
   la["duration_sec"] == 270 and la["created_at"].startswith("2026-09-22"))
keep58(1, "Polyn")
st = s58.session_state()
ok("tonight's go is never before tonight",
   all(g["folder"] != str(live58) for g in [st["before_tonight"]["first"], *st["before_tonight"]["more"]]))
ok("with a go tonight, last time is tonight's", "created_at" not in st["last_attempt"])
# D's folder moved away; first and more read from session_state()["before_tonight"]
ok("a rehearsal not on disk is skipped and not counted",
   pick(first) == (C, 2) and [pick(g) for g in more] == [(B, 1), (A, 2)])
# D's folder moved back
keep58(2, "Sonca")
ok("a song played only tonight has none", s58.session_state()["before_tonight"] is None)
s58.set_next_take_name("Take 3")
ok("Take N has none", s58.session_state()["before_tonight"] is None
   and s58.session_state()["last_attempt"] is None)
s58.set_next_take_name("Nothing yet")
ok("a new song has none", s58.session_state()["before_tonight"] is None)
s58.finish_rehearsal()
```

Move D's folder with `shutil.move` to a sibling and back, as section [57] does.

- [ ] **Step 2: Run them and see them fail**

Run: `venv/bin/python tests/test_engine.py 2>&1 | tail -20`
Expected: `KeyError: 'before_tonight'` (or the [58] checks listed under PROBLEMS).

- [ ] **Step 3: Implement `Library.song_id`, `_before_tonight`, the `_last_attempt` fallback and `session_state["before_tonight"]`**

`_before_tonight`:
1. Drop the goes whose `Path(folder) == Path(live folder)` and the `missing` ones.
2. `first = _plays_of(kept)`, or None when nothing is left.
3. `more` = the last go of each of the first 3 distinct folders in `kept` (already newest first), less `first` (same folder and take number), each without `"missing"`.

In `session_state`, call `goes_of(song_id)` only when `song_id(coming["song"])` is not None, never with None: that is Not named's takes.

- [ ] **Step 4: Run them and see them pass**

Run: `venv/bin/python tests/run_all.py 2>&1 | tail -5`
Expected: `Python side: all checks passed.` and the other suites green.

- [ ] **Step 5: Commit**

`git commit -m "The session says the next song's goes from before tonight"` with `tests/test_engine.py`, `api.py`, `library.py`.

### Task 2: The panel: the Next take field moves right of the overview

**Files:**
- Modify: `ui/src/components/Shell.tsx`: a new `aside` prop.
- Modify: `ui/src/components/TakeNameField.tsx:120`: a new `onPanel` prop.
- Modify: `ui/src/screens/Rehearsal.tsx:316-358`: the field leaves `FooterRow` for the aside.
- Modify: `ui/src/components/FooterRow.tsx`: its comment no longer promises the rehearsal-to-review place.
- Modify: `ui/src/lib/api.ts:154-190`: the types below.
- Modify: `ui/e2e/fake-bridge.js`: `before_tonight` and the `last_attempt` fallback.
- Create: `ui/e2e/before.spec.ts`
- Modify: `ui/e2e/naming.spec.ts:461`

**Interfaces:**
- Consumes: `session_state().before_tonight` (Task 1).
- Produces:
  - `export type BeforeTonight = { song: string; first: SongPlays; more: SongPlays[] }`.
  - `SessionState.before_tonight?: BeforeTonight | null`.
  - `LastAttempt.created_at?: string | null`.
  - `Shell` prop `aside?: ReactNode`: rendered right of `<main>` in a `flex min-h-0 flex-1` row. With no aside the markup stays as it is now, so `main` remains the scrolling element and `page.locator("main")` in goes.spec and naming.spec keeps working.
  - `TakeNameField` prop `onPanel?: boolean`: the field box is `bg-card` instead of `bg-muted/45`.
  - In Rehearsal, `<aside aria-label="Next take" data-next-take-panel className="flex w-[22.5rem] shrink-0 flex-col gap-5 overflow-y-auto border-l bg-panel px-5 py-6 min-[1100px]:w-[26rem]">`.

- [ ] **Step 1: Teach the fake `before_tonight`**

In `session_state`, `before_tonight: await beforeTonight(nextTake().song)`, mirroring Task 1's rule over `libraryNow()`:
- leave out `session.folder` and missing rehearsals;
- `first` from `songPlays`;
- `more` from the 3 latest folders;
- set `fileDurations[file] = take.duration_sec` for every track of every go, as `get_song` does.

`lastAttempt(takes, song, before)` falls back to `{song, duration_sec, created_at}` from `before.first`.

- [ ] **Step 2: Write the failing layout tests in `before.spec.ts`**

`test("the Next take field and its songs sit in a panel right of the overview")`, at 1180×820 after `startRehearsal`:
- the `complementary` landmark "Next take" contains the textbox "Next take" and the group "Next take";
- the panel's box left ≥ `main`'s right, width 416 ± 1, top = header's bottom, bottom = footer's top;
- `footer` has no textbox;
- the panel's computed `backgroundColor` ≠ `main`'s.

Then at 960×680: width 360 ± 1, and `panel.scrollWidth <= panel.clientWidth`.

In `naming.spec.ts:461`, rename to "after Stop: the name carries over to the save screen's field, and ✕ puts back the one it would have had" and drop the two position asserts. The value, rule and ✕ asserts stay.

- [ ] **Step 3: Run them and see them fail**

Run: `cd ui && npx playwright test e2e/before.spec.ts e2e/naming.spec.ts 2>&1 | tail -15`
Expected: the panel test fails (no complementary "Next take"); naming passes.

- [ ] **Step 4: Implement the types, `Shell.aside`, `TakeNameField.onPanel` and the move in Rehearsal**

`FooterRow` keeps `error`; drop `rule` and `left` from the rehearsal's call.

- [ ] **Step 5: Run them and see them pass, with the footer and naming suites**

Run: `cd ui && npx tsc -b && npx playwright test e2e/before.spec.ts e2e/naming.spec.ts e2e/footer.spec.ts e2e/goes.spec.ts 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 6: Commit**

`git commit -m "The Next take field moves into a panel right of the rehearsal"`

### Task 3: The card: the song's go from before tonight

**Files:**
- Create: `ui/src/components/BeforeTonightCard.tsx`
- Modify: `ui/src/components/RehearsalOverview.tsx:205-300`: `TakeRow.onOpen` becomes optional.
- Modify: `ui/src/screens/Rehearsal.tsx`: renders the card in the aside under the field.
- Test: `ui/e2e/before.spec.ts`

**Interfaces:**
- Consumes: `BeforeTonight`, `SessionState.before_tonight` (Task 2); `PlacedTake`, `PlacedPlayback`, `placed`, `hereFor` from `ui/src/lib/songs.ts`; `formatDate` from `ui/src/lib/format.ts`.
- Produces:
  - `BeforeTonightCard({ before, song, playedTonight, playback, onPlay, onPlayAt }: { before: BeforeTonight | null; song: string | null; playedTonight: boolean; playback: PlacedPlayback | null; onPlay: (take: PlacedTake) => void; onPlayAt: (take: PlacedTake, at: number) => void })`.
  - `song` is `session.next_take_go != null ? session.next_take_name : null`.
  - `playedTonight` is whether `session.songs` has that song.
  - `TakeRow`'s `onOpen?`: when left out, the row and the bar play (`onPlay`), and the bar's title is "Play it here".

- [ ] **Step 1: Write the failing tests**

All on the plain fake unless said:
- `"a fresh rehearsal's card says how to see goes from before"`: the text `Name the next take after a song to see how it went before.` inside the panel.
- `"a song pill brings its last go from before tonight"`: click the `Daroha` pill.
  - Region `Daroha before tonight` has one row: button `Play Daroha 2`, `4:00`, `25 Aug`.
  - No `more` button.
  - The missing rehearsal's `Daroha 9` is not in it.
- `"the newest starred go is shown, and more opens the rest under it"` (openBandApp, then `startRehearsal`):
  - pick `Pałyn`: the first row is `Pałyn 7` with `22 Sep`, and the toggle reads `1 more` with `aria-expanded="false"`;
  - click it: rows `Pałyn 7`, `Pałyn 3` (`15 Sep`), the first row's box unmoved (±1 px), and the toggle reads `Fewer`;
  - pick `Viasna`, then `Pałyn` again: the toggle reads `1 more`, folded.
- `"a song played only tonight says its goes are in the overview"`: record and save `Sonca`, so the next take is Sonca 2. The text is `No goes at Sonca before tonight. Tonight's are in the overview.`
- `"a new song says it has no goes before tonight"`: type `Brand new`, then Enter. The text is `No goes at Brand new before tonight.`
- `"a take open in the player hides the card, and the field stays where it was"`, with `__FULL_EVENING__`:
  - record a take, pick `Pałyn`, and note the field's box;
  - open tonight's take: the region `Pałyn before tonight` is gone, and the field's box is unchanged;
  - Escape brings the region back.
- `"a long title is cut short in the card's heading, whole on hover"`: `__EXTRA_SONGS__ = ['A very long song title that goes on and on past the panel']`; type the title, then Enter.
  - The heading's title span has `scrollWidth > clientWidth`, and its `title` attribute is the full title.
  - At 960×680, `panel.scrollWidth <= panel.clientWidth`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd ui && npx playwright test e2e/before.spec.ts 2>&1 | tail -15`
Expected: the card tests fail on the missing text and regions; Task 2's test passes.

- [ ] **Step 3: Implement `BeforeTonightCard` and wire it**

- **The card:** `rounded-xl border bg-card px-4 pt-3.5 pb-4`, as LastTime's card.
- **The heading:** an `h2`, the title in a `truncate` span with `title`, then ` — before tonight` in muted text.
- **The toggle:** sits right of the heading with `aria-expanded`. It is local state, and Rehearsal mounts the card with `key={before?.song ?? song ?? ""}` so a new song folds it back.
- **The slide-in:** `motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 duration-200` on that keyed element. It plays on a new song only, never on a refresh.
- **The rows:** `TakeRow` with
  - `take={go.take}` and `unnamed={false}`;
  - `longest` the longest of `first` and `more` together, both folded and opened;
  - `where={formatDate(go.created_at)}`;
  - `here={hereFor(playback, go.folder, go.take)}`;
  - `onPlay={(t) => onPlay(placed(go.folder, t))}` and `onOpenAt={(t, at) => onPlayAt(placed(go.folder, t), at)}`;
  - no `onOpen`, `onStar`, `onRename`, `onShare` or `onDelete`.
- **While a take is open:** Rehearsal leaves the card out (`selected !== null`).

For now, Rehearsal passes `playback={null}` and no-op handlers. Task 4 wires them.

- [ ] **Step 4: Run them and see them pass**

Run: `cd ui && npx tsc -b && npx playwright test e2e/before.spec.ts e2e/history.spec.ts e2e/songs.spec.ts 2>&1 | tail -5`
Expected: all pass. TakeRow's other users still open takes.

- [ ] **Step 5: Commit**

`git commit -m "The rehearsal panel shows the next song's go from before tonight"`

### Task 4: Playing an earlier go in place

**Files:**
- Modify: `ui/src/hooks/useTakeStripPlayer.ts`: adds `cueAt`.
- Modify: `ui/src/screens/Rehearsal.tsx`: `byPlace`, the card's playback, and the overview ignoring a placed cue.
- Test: `ui/e2e/before.spec.ts`

**Interfaces:**
- Consumes: `BeforeTonightCard`'s `onPlay`/`onPlayAt`/`playback` (Task 3); `byPlace` from `ui/src/lib/songs.ts`.
- Produces:
  - `useTakeStripPlayer` returns `cueAt(take: T, at: number): void`. It plays `take` in place from `at`: when it is the take loaded, `seek(at)` then `play()`; otherwise it is cued with `whenOpen({ at, play: true })`.
  - Rehearsal calls `useTakeStripPlayer(byPlace)`. A cued take with a `folder` is an earlier go: the overview's `playback` is null for it, and the card's is `{ take: cued as PlacedTake, playing, loading, position, duration }`.

- [ ] **Step 1: Write the failing tests**

All on the plain fake, with the `Daroha` pill picked unless said:
- `"play starts an earlier go in place, with no player"`: click `Play Daroha 2`.
  - `Pause Daroha 2` shows, and the "Take timeline" group does not.
  - The last `player_open` call's first track file is `/rec/older/d2.wav`.
- `"an earlier take 2 and tonight's take 2 are told apart"`: record and save two takes, then play `Daroha 2`.
  - Tonight's overview row `[data-take='2']` has no `Pause` button.
  - Play tonight's take 2 in the overview: `Play Daroha 2` shows in the card again.
- `"a note plays its go from 3 s before"` (`__FULL_EVENING__`): pick `Pałyn` (its go is `Pałyn 2`, note at 72 s). Click the note: the last `player_seek` call's argument is `69`, and `Pause Pałyn 2` shows.
- `"Space pauses and plays it, Escape puts it away"`: play it. Space shows `Play Daroha 2`, Space again `Pause Daroha 2`, and Escape leaves no `Pause` in the card. `finish_rehearsal` is never called.
- `"Record stops an earlier go before the take starts"`: play it, then click Record. When `start_take` is called, the fake's player is not playing: wrap `start_take` in an `after` script that records `(await window.pywebview.api.player_state()).playing`.
- `"picking another song stops the earlier go"`: play it, then click the `Pałyn` pill. No `Pause` button in the panel, and `player_state().playing` is false.

- [ ] **Step 2: Run them and see them fail**

Run: `cd ui && npx playwright test e2e/before.spec.ts 2>&1 | tail -15`
Expected: the six new tests fail (nothing plays); Tasks 2-3's pass.

- [ ] **Step 3: Implement `cueAt` and wire the card**

- `onPlay` is `playInOverview` and `onPlayAt` is `(t, at) => cueAt(t, Math.max(0, at - 3))`.
- A new song stops the go: an effect on `session.before_tonight?.song ?? null` calls `uncue()` when the cued take has a `folder`.

- [ ] **Step 4: Run them and see them pass, with the player suites**

Run: `cd ui && npx tsc -b && npm test && npx playwright test e2e/before.spec.ts e2e/history.spec.ts e2e/goes.spec.ts e2e/player.spec.ts 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 5: Commit**

`git commit -m "An earlier go plays in place on the rehearsal screen"`

### Task 5: The recording screen measures against before tonight

**Files:**
- Modify: `ui/src/screens/Recording.tsx:245`
- Test: `ui/e2e/before.spec.ts`

**Interfaces:**
- Consumes: `LastAttempt.created_at` (Task 2).

- [ ] **Step 1: Write the failing test**

`test("the first take of a song tonight is measured against its go before tonight")`: start, click the `Daroha` pill, then click Record. The text is `Took 4:00 on 25 Aug`, and the progressbar "Against the last go" has `aria-valuemax="240"`.

- [ ] **Step 2: Run it and see it fail**

Run: `cd ui && npx playwright test e2e/before.spec.ts -g "measured" 2>&1 | tail -8`
Expected: FAIL. The text reads `Took 4:00 last time`.

- [ ] **Step 3: Implement: `on ${formatDate(lastAttempt.created_at)}` when `created_at` is set, `last time` otherwise**

- [ ] **Step 4: Run it and the recording suite and see them pass**

Run: `cd ui && npx playwright test e2e/before.spec.ts e2e/recording.spec.ts 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 5: Commit**

`git commit -m "A song's first take tonight is measured against its go before"`

### Task 6: reha.stream: "Hear last week first"

**Files:**
- Modify: `site/content/story.md`: a new section after `{#setup}`, plus the comment "six" → "seven".
- Modify: `site/src/content/index.ts:33`: STEPS.
- Modify: `site/src/stage/Story.tsx`: STORY, a `before` scene, FORWARD.before, and FORWARD.record starting from it.
- Modify: `site/src/page/Story.tsx:12`: the comment "six" → "seven".
- Modify: `ui/e2e/band.js:212`: the band's rehearsal is `2026-09-29 19-00`, so its last week is 22 Sep.
- Test: `site/src/content/index.test.ts:21`, `site/e2e/stage.spec.ts:51`, `site/e2e/page.spec.ts:86`

**Interfaces:**
- Consumes: the rehearsal screen with the panel and the card (Tasks 2-4); `startHeroRehearsal` from `site/src/stage/Hero.tsx`.
- Produces: `STORY = ["setup", "before", "record", "review", "history", "song", "compare"]`.

- [ ] **Step 1: Write the failing tests**

- `index.test.ts`: "has the seven steps, in order", with `"before"` second.
- `page.spec.ts:86`: the scenes list gets `"before"` second.
- `stage.spec.ts`: "the story goes through its seven steps".
  - Step 1 is `before`: the region `Pałyn before tonight` is visible and the button `Pause Pałyn 7` shows.
  - Step 2 is `record`: the h1 contains `/Pałyn\s*3/`.
  - Every later index moves up by one.

- [ ] **Step 2: Run them and see them fail**

Run: `cd site && npm test 2>&1 | tail -8 && npx playwright test 2>&1 | tail -8`
Expected: the three changed tests fail.

- [ ] **Step 3: Implement**

The `story.md` section, exactly:

```markdown
## Hear last week first. {#before}

Name the next take after a song, and its best go from before sits right
beside it.
```

- **FORWARD.before:**
  1. press Stop checking;
  2. start the band's rehearsal as `FORWARD.record` does now, and `show({ step: "before", session })`;
  3. click the `Pałyn` song pill;
  4. click `Play Pałyn 7` and wait for `Pause Pałyn 7`.

  The scene renders `<Rehearsal>` as `Hero` does, refreshing `session_state` on `onChanged`.
- **FORWARD.record:** no longer starts the rehearsal. It reads `session_state` (next take Pałyn 3), calls `start_take` and shows the record scene as before.

- [ ] **Step 4: Run them and see them pass; look at both frames**

Run: `cd site && npm test && npm run build && npx playwright test 2>&1 | tail -5`
Expected: all pass.

Then screenshot `stage.html#hero` and `stage.html#story-1` at 1180 px wide. Check by eye that the panel and the card read well in the light page.

- [ ] **Step 5: Commit**

`git commit -m "reha.stream: a story step for hearing last week first"`

### Task 7: Docs and changelog

**Files:**
- Modify: `docs/using-it.md:90-145`
  - the rehearsal screen: the panel, the card, playing in place;
  - "Left of the button is **Next take**" becomes the panel's text;
  - the recording screen: `Took 3:20 on 22 Sep` for the first go of the evening.
- Modify: `CHANGELOG.md`: one Unreleased bullet, "**Hear last time before you play it.**", in the voice of the bullets there.
- Modify: `docs/screenshots/rehearsal.png`, `player.png`, `zoom.png`, retaken.

- [ ] **Step 1: Retake the pictures**

Python Playwright is not in the venv, so use the session's Node stand-in for `tests/docs_screenshots.py` (scratchpad `shots/`). It follows the same steps and sizes (`HEIGHT`): `rehearsal` 770, `player` and `zoom` 1040, at the script's `VIEWPORT` width. Look at each picture before keeping it.

- [ ] **Step 2: Write the docs and changelog text**

- [ ] **Step 3: Run every check (Global Constraints)**

Expected: everything green, and lint no worse than the baseline.

- [ ] **Step 4: Commit**

`git commit -m "Docs: earlier goes on the rehearsal screen"`
