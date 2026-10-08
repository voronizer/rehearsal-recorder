# Marks Across the Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third History view, *Marks*: the labels down the left, every mark of the chosen label from every rehearsal on the right, newest first, grouped by rehearsal, by song or in one list as the band picks; ▶ plays from 5 s before a mark, a click opens the take there. reha.stream's story shows it in step 4, and every story step is told in three lines that light up as the app beside them gets to each.

**Architecture:** Python gains `Library.marks_of` behind `Api.list_marks`, two more aggregates in `Library.labels()`, "marks" as a History view and a kept grouping. The interface adds pure grouping and wording in `lib/marks.ts`, two components (`LabelList` on the left, `MarksPage` on the right) and wires them into `HistoryScreen` beside the Songs view, reusing its one `useTakeStripPlayer` (`cueAt` for ▶, `openGo` for a click). The fake bridge answers the new calls from its `libraryNow()`, so the band's evenings feed the site and the docs pictures.

**Tech Stack:** Python 3.12 (pywebview bridge, SQLAlchemy library), React 19 + TypeScript + Tailwind v4, Vitest, Playwright, the fake bridge `ui/e2e/fake-bridge.js` and demo band `ui/e2e/band.js`.

**Spec:** `docs/superpowers/specs/2026-10-04-marks-across-the-library-design.md` (rewritten 8 Oct 2026 after the discussion with Alex). Mockups: https://claude.ai/artifact/NLduPwfdjF9NKzbBCFBN7e (the view), https://claude.ai/artifact/AigUuiwEuxkwkXBbaKSmyB (where it goes on reha.stream), https://claude.ai/artifact/Thti1fesgMHJe4RqSaaMLM (the story's words, variant C).

## Global Constraints

- ▶ plays from `max(0, at - 5)` seconds; again on the same row pauses.
- Order everywhere: the newest rehearsal first (`created_at` desc, then rehearsal id), then `take_number`, then `at`.
- Groupings, as stored and as shown: `"rehearsal"` **By rehearsal**, `"song"` **By song**, `"list"` **One list**; caption **Group by**; default `"rehearsal"`.
- Copy, exactly: left second line `3 rehearsals · last 22 Sep` (`1 rehearsal`), empty `no marks yet`; head line `5 marks in 3 rehearsals · last 22 Sep` (`1 mark in 1 rehearsal`), empty `No marks yet`; empty pane `Marks given the label Solo in the player gather here, from every rehearsal.`; headings `Tuesday jam · Tue 22 Sep · 3 marks`, `Pałyn · 2 marks`, `Not named · 1 mark`; row second lines `Pałyn 4 · 1:51`, by song `Pałyn 4 · 1:51 · Tuesday jam, 22 Sep`, one list `Pałyn 4 · 1:51 · Tuesday jam, 22 Sep` with the song a link; a missing rehearsal's row says `not on disk`.
- Dates: `formatDayIn` in headings, `formatDate` in "last …" and in row lines.
- Bars: width `round(duration / longest * 120)` px, `longest` the label's longest take on screen.
- History views: `"rehearsals" | "songs" | "marks"`, kept by `save_history_view`.
- Windows CI prints in cp1252: Python check labels and test titles in Latin script, no ★ or ▶.
- Lint: no new oxlint warnings per file against `scratchpad/lint-baseline.txt` (take it from `npx oxlint` on main before Task 2).

## Review Focus

1. A mark edited, relabelled or deleted in the player, then Escape: the row, the head's counts and the left counts are fresh; a label left empty shows its empty pane; the chosen label stays chosen.
2. Two marks on one take: ▶ on the second while the first plays moves the playing take there (no reload), and only the second row shows Pause.
3. The chosen label deleted in Settings, or History opened on Marks in another recordings folder: the first label is chosen, nothing blank or stuck.
4. By song with takes of no song, a song with marks only in a rehearsal not on disk, and a song renamed since: "Not named" last; the missing rows greyed; the new title used.
5. A 960 px window with a 40-character label name: the head wraps the switch under the name, nothing scrolls sideways (mockup shot x7).

---

### Task 1: Python: `list_marks`, the labels' two figures, the view and the grouping

**Files:**
- Modify: `src/rehearsal_recorder/store/library.py` (`labels()`, new `marks_of`), `src/rehearsal_recorder/api.py` (`HISTORY_VIEWS`, `get_settings`, new `list_marks`, `save_marks_grouping`)
- Test: `tests/test_engine.py` (new section `[60] Marks across the library`)

**Interfaces:**
- Produces: `Library.marks_of(label_id) -> list[dict] | None`; `Api.list_marks(label_id) -> {"ok": True, "marks": [{"folder", "rehearsal", "created_at", "missing", "take", "at", "note"}]} | {"ok": False, "error": "Label not found"}`; `labels()` items gain `"rehearsals": int`, `"last_marked": str | None`; `get_settings()["marks_grouping"] -> "rehearsal" | "song" | "list"`; `save_marks_grouping(grouping) -> {"ok": True} | {"ok": False, "error": "Unknown grouping"}`; `save_history_view("marks") -> {"ok": True}`.

- [ ] **Step 1: Write the failing checks** in `[60]`, built like `[56]` (`rehearsal56`-style helper writing old `session.json`s with markers, then `import_all`):
  - three rehearsals, marks with label 3 on a song's take and on a "Take 4", one with label 1: `[(folder, take_number, at)]` of `list_marks(3)["marks"]` is newest rehearsal first, then take, then moment;
  - each item's `take` has the take's `name`, `song`, `tracks`, `markers`; `rehearsal` and `created_at` are the rehearsal's; `note` is the mark's;
  - the label-1 mark is not in `list_marks(3)`; `list_marks(999) == {"ok": False, "error": "Label not found"}`;
  - with one rehearsal's folder moved away: its marks are still listed, `missing` True, the others False;
  - `delete_label(3, 1)` then `list_marks(1)` holds the moved marks;
  - the number of SELECTs for `list_marks` (counted as `[56]` counts them) is the same with 2 marks and with 20;
  - `list_labels()` gives `rehearsals` 2 and `last_marked` the newest such rehearsal's `created_at` for label 3, and `0`, `None` for a label with none;
  - `get_settings()["marks_grouping"] == "rehearsal"`; `save_marks_grouping("song")` then a fresh Api reads `"song"`; `save_marks_grouping("album")` is refused and changes nothing; a hand-written `3` reads as `"rehearsal"`;
  - `save_history_view("marks") == {"ok": True}` and `get_settings()["history_view"] == "marks"` after a restart.
- [ ] **Step 2: Run** `venv/bin/python tests/run_all.py 2>&1 | tail -20`. Expected: `[60]` fails on the missing methods and keys.
- [ ] **Step 3: Implement.** `marks_of`: one select of `(Marker.take_id, Marker.at, Marker.note)` joined to `Take` and `Rehearsal`, `where(Marker.label_id == label_id)`, `order_by(*_GO_ORDER, Marker.at)`; the takes once through `_goes(db, Take.id.in_(ids))` (keyed by folder and take number), `_take_out`, and `missing` per folder as `goes_of` does; `None` when `db.get(Label, label_id)` is None. `labels()`: outer joins `Marker → Take → Rehearsal`, `func.count(Take.rehearsal_id.distinct())` and `func.max(Rehearsal.created_at)`. `HISTORY_VIEWS` gains "marks"; `MARKS_GROUPINGS = ("rehearsal", "song", "list")` beside it.
- [ ] **Step 4: Run** the same command. Expected: all sections pass.
- [ ] **Step 5: Measure (spec A3), not committed:** a scratch script builds a Library of 300 rehearsals × 20 takes × 5 marks over the four labels and times `marks_of` for the biggest label. Ledger the time. Over 100 ms: stop and ask Alex about paging.
- [ ] **Step 6: Commit** `git commit -m "Python: every mark with a label, from every rehearsal"`.

### Task 2: The interface's types, wording and grouping

**Files:**
- Create: `ui/src/lib/marks.ts`, `ui/src/lib/marks.test.ts`
- Modify: `ui/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 1's answers.
- Produces: `type MarkHit = { folder: string; rehearsal: string; created_at: string; missing: boolean; take: Take; at: number; note: string }`; `type MarksAnswer = Ok<{ marks?: MarkHit[] }>`; `type MarksGrouping = "rehearsal" | "song" | "list"`; `HistoryView` gains `"marks"`; `Label` gains `rehearsals?: number; last_marked?: string | null`; `Settings.marks_grouping?: MarksGrouping`; `api().list_marks(labelId: number): Promise<MarksAnswer>`, `api().save_marks_grouping(g: MarksGrouping): Promise<Ok>`. In `marks.ts`: `MARK_LEAD_SEC = 5`; `playFrom(at: number): number`; `markKey(m: MarkHit): string` (`folder#take_number@at`); `type MarkGroup = { key: string; kind: "rehearsal" | "song" | "list"; title: string; folder?: string; song?: string | null; marks: MarkHit[] }`; `groupMarks(marks: MarkHit[], g: MarksGrouping, now?: Date): MarkGroup[]`; `labelLine(label: Label, now?: Date): string`; `headLine(marks: MarkHit[], now?: Date): string`; `rowLine(m: MarkHit, g: MarksGrouping, now?: Date): { song: string | null; rest: string }`.

- [ ] **Step 1: Write the failing Vitest cases** in `marks.test.ts` on four hand-made `MarkHit`s (two rehearsals, a song's take and a "Take 11"):
  - `groupMarks(.., "rehearsal")`: one group per rehearsal in input order, titles `Tuesday jam · Tue 22 Sep · 3 marks`;
  - `"song"`: songs in the order of their newest mark, `Not named · 1 mark` last, `song` null on it;
  - `"list"`: one group, `title` empty, every mark;
  - `labelLine` for 3 rehearsals, for 1, and `no marks yet` for `marks: 0`;
  - `headLine` `5 marks in 3 rehearsals · last 22 Sep`, `1 mark in 1 rehearsal · last 22 Sep`, `No marks yet`;
  - `rowLine`: rehearsal gives `{song: "Pałyn", rest: " 4 · 1:51"}`, song gives `{song: null, rest: "Pałyn 4 · 1:51 · Tuesday jam, 22 Sep"}`, list gives the song plus `" 4 · 1:51 · Tuesday jam, 22 Sep"`, a take with no song `{song: null, rest: "Take 11 · 0:42"}`;
  - `playFrom(3) === 0`, `playFrom(111) === 106`.
- [ ] **Step 2: Run** `cd ui && npm test`. Expected: the new file fails to import.
- [ ] **Step 3: Implement** `marks.ts` and the `api.ts` types and methods (`list_marks` answers `{ok}`, so it stays out of `ANSWERS_WITH_A_VALUE`).
- [ ] **Step 4: Run** `cd ui && npx tsc -b && npm test`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Interface: marks grouped by rehearsal, by song or in one list"`.

### Task 3: The fake bridge answers for marks

**Files:**
- Modify: `ui/e2e/fake-bridge.js`

**Interfaces:**
- Consumes: Task 2's types.
- Produces (fake): `list_marks(labelId)` from `libraryNow()` in the spec's order, `missing` from the rehearsal, `labelIdOf` applied so moved marks follow; `list_labels()` and every label change answer with `marks`, `rehearsals`, `last_marked` counted over the session's takes and the library (the last `libraryNow()` read, or `/rec/old` before the first); `save_history_view("marks")`; `save_marks_grouping` writing `marks_grouping` to the fake's config, read back by `get_settings` (default `"rehearsal"`); `window.__MORE_MARKS__ = true` adds marks for the tests: First rehearsal's Daroha 2 at 30 s, label 3, no comment; Missing jam's Pałyn 8 at 60 s, label 3, "late again"; Wednesday jam's Take 1 at 120 s, label 1, "the riff".

- [ ] **Step 1:** No test of its own: Task 4's Playwright tests are its tests. Make the change.
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/labels.spec.ts e2e/songs.spec.ts`. Expected: green, as before (the counts they check are unchanged without `__MORE_MARKS__`).
- [ ] **Step 3: Commit** `git commit -m "The fake bridge: marks by label, and the grouping kept"`.

### Task 4: History's Marks view

**Files:**
- Create: `ui/src/components/LabelList.tsx`, `ui/src/components/MarksPage.tsx`, `ui/e2e/marks.spec.ts`
- Modify: `ui/src/components/HistorySwitch.tsx`, `ui/src/screens/HistoryScreen.tsx`

**Interfaces:**
- Consumes: Tasks 2 and 3; `useTakeStripPlayer`'s `cueAt`, `openAt`, `player`; `loadLabels`/`useLabels` from `lib/labels.ts`.
- Produces: `LabelList({ labels, current, onChoose })`, each label a `button[data-label=<id>]` with `aria-current` on the chosen; `MarksPage({ label, marks, grouping, onGrouping, playing, onPlay, onOpen, onOpenSong, onOpenRehearsal })`, a `section` labelled with the label's name, rows `[data-mark="<folder>#<take>@<at>"]` with a ▶ `aria-label="Play <take name> from <m:ss>"` (Pause while playing), the switch `role="group" aria-label="Group marks"`, headings as buttons.

- [ ] **Step 1: Write the failing Playwright tests** in `marks.spec.ts`, with `__FULL_EVENING__` and `__MORE_MARKS__` (titles in Latin):
  - "the switch has three views, and history opens on the one used last" (Marks chosen, History closed and opened again);
  - "the labels show their counts and rehearsals, and a label with none is dimmed" (`Went wrong` 3 and `3 rehearsals · last 10 Sep`; `Do again` `no marks yet`);
  - "a label's marks come newest first, under a heading per rehearsal";
  - "by song and one list, and the choice is kept" (`save_marks_grouping` called; reopened History shows By song pressed);
  - "play starts 5 s before the mark, and again pauses" (`player_open` then the seek to `at - 5` in the fake's calls; Pause shown on that row only);
  - "a second mark of the same take moves the playing take there";
  - "a click opens the take at the mark, and Escape comes back scrolled where it was";
  - "a mark with no comment shows its label's name";
  - "a rehearsal not on disk keeps its marks greyed, with nothing to play";
  - "a heading opens the rehearsal, a song opens its page";
  - "a mark relabelled in the player leaves the list after Escape, and the counts follow";
  - "up and down go through the labels";
  - "the switch is off for a label with no marks, which says where its marks will come from";
  - "a 960 px window with a long label name scrolls nothing sideways" (`__LABELS__` with a 40-character name).
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/marks.spec.ts`. Expected: all fail (no Marks button).
- [ ] **Step 3: Implement.**
  - `HistorySwitch`: a third view, Marks; buttons `px-2` so three fit in `w-64`.
  - `LabelList`: as the mockup's left list (`mk-item`: dot, name truncated, count right in `tnum`, `labelLine` under it; dimmed with no marks).
  - `MarksPage`: head (big dot, `h2` truncated, `headLine`, then **Group by** and three buttons drawn as `HistorySwitch`'s, `flex-wrap` so they go under the name when narrow, disabled with no marks); groups from `groupMarks`; a row: ▶ (`size-8` round outline, as the overview's), two lines (`truncate`, the comment's `title` the whole comment), the bar in a `120px` cell with the tick (`labelLook(colour).dot`) at `at / duration` and the playhead while playing, the length; missing rows `opacity-55`, ▶ disabled, `not on disk` after the length, no click.
  - `HistoryScreen`: `view === "marks"` beside songs; `chosenLabel` (kept across views, falling back to the first label); `marks` read with a ticket like the song page; `marksShown` ref so `changed()`, `addMarker`, `saveMarker`, `removeMarker`, the share dialog's `onDone` read marks and `loadLabels()` again when it is set; ▶ is `cueAt(placed(folder, take), playFrom(at))`, or `player.toggle()` when `playingMark === markKey(m)`; a click is `openGo(placed(folder, take), m.at)`; `songSection`/`songScroll` become `pane`/`paneScroll`, shared by the Songs and Marks sections; ↑ ↓ step through `labels`; the saved grouping read from `get_settings`, changed with `save_marks_grouping`; `get_settings().history_view === "marks"` opens on Marks.
- [ ] **Step 4: Run** `npx tsc -b && npx oxlint && npx playwright test`. Expected: green, the earlier tests included; no new lint warnings.
- [ ] **Step 5: Commit** `git commit -m "History: the Marks view"`.

### Task 5: The band's marks, and reha.stream's step 4

**Files:**
- Modify: `ui/e2e/band.js`, `site/src/stage/Story.tsx`, `site/e2e/stage.spec.ts`

**Interfaces:**
- Consumes: Task 4's view (`HistorySwitch` button **Marks**, the left list's label buttons by name, `section[aria-label=<label>]`, the song link in a row).
- Produces: `Story.history` going History, Marks, Went wrong, Pałyn's page; Task 6 adds its lines to it.

- [ ] **Step 1: Change the test first:** `stage.spec.ts` step 3: the `section[aria-label="Went wrong"]` is visible, then Pałyn's page as now; step 4 unchanged.
- [ ] **Step 2: Run** `cd site && npm test && npm run build && npx playwright test`. Expected: step 3 fails (no Marks shown).
- [ ] **Step 3: Implement.** Band `PAST` marks, on its four labels: Tuesday jam Take 11 at 42 "bass riff after the count-in" (1); New songs Dym 3 at 130 "tempo drops in the second verse" (3), Ptuška 2 at 75 "half-time groove in the bridge" (1); the 15 Sep Tuesday jam Viasna 2 at 210 "guitar drifts here again" (3), Ahoń 2 at 20 "drum intro, 4 bars alone" (1), Sonca at 150 with no comment (4); Soundcheck Take 2 at 65 "the riff we jammed while setting up" (1). Went wrong then has 5 marks in 3 rehearsals. `Story.history`: History, Marks, Went wrong (the left list starts on *Note*, so it is clicked), 1.8 s, then a click on the song link "Pałyn" in the first row (tonight's Pałyn, "lost the count"), then the rung as now. The words wait for Task 6.
- [ ] **Step 4: Run** the same commands. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "reha.stream: Find it later shows the marks, then the song"`.

### Task 6: reha.stream: every step told in three lines, lit as the app goes

**Files:**
- Modify: `site/content/story.md`, `site/src/content/markdown.ts`, `site/src/content/markdown.test.ts`, `site/src/content/index.test.ts`, `site/src/frame.ts`, `site/src/page/LiveFrame.tsx`, `site/src/page/Story.tsx`, `site/src/page/page.css`, `site/src/stage/drive.ts`, `site/src/stage/Story.tsx`, `site/e2e/stage.spec.ts`, `site/e2e/page.spec.ts`

**Interfaces:**
- Consumes: Task 5's `Story.history`.
- Produces:
  - `leadAndBeats(body: string): { lead: string[]; beats: string[] }` in `markdown.ts`: the body's paragraphs before its list as HTML (as `paragraphs` gives them), and each `- ` line of the list as HTML (as `inline` gives it).
  - `FromStage = { type: "rr-ready" } | { type: "rr-beat"; step: number; beat: number }`; `isFromStage` accepts both, and `rr-beat` only with integer `step` and `beat`.
  - `LiveFrame` prop `onBeat?: (step: number, beat: number) => void`; `onReady` still fires only on `rr-ready`.
  - `key(name: string): void` in `drive.ts`: a `keydown` with that `key` dispatched on `window`.

- [ ] **Step 1: Write the failing tests.**
  - `markdown.test.ts`, `leadAndBeats`: `"One line.\n\n- first\n- **Marks**: second\n- third"` gives `{ lead: ["One line."], beats: ["first", "<strong>Marks</strong>: second", "third"] }`; a body with no list gives `beats: []`; a `- ` line that wraps onto the next line is one beat.
  - `index.test.ts`, "every step has one line and three lines under it": for each of the five steps, `lead.length === 1` and `beats.length === 3`.
  - `stage.spec.ts`, "the story tells the page each line as it gets to it": an init script collects `rr-beat` messages into `window.__beats` (the stage is top-level here, so it posts to itself); go to step 4 from the start; poll until 15 arrived; they are exactly `[0,0] [0,1] [0,2] [1,0] … [4,2]`, in that order.
  - `stage.spec.ts`, the five-steps test: step 4 now ends on Pałyn 7 (the open tab's line starts with "7").
  - `page.spec.ts`, "the step on screen lights the line the app is on": scroll step 4 (`#how .step` nth 3) to the centre; poll `.step.on .beats li.now` until it reads "Marks: every Went wrong, …", then "A click on Pałyn: …"; `.step:not(.on) .beats li.now` has count 0 throughout; then scroll the first step (nth 0) to the centre and `.step.on .beats li.now` has count 0 until the frame, started again, gets to "Name the rehearsal, or keep the date."
- [ ] **Step 2: Run** `cd site && npm test && npm run build && npx playwright test`. Expected: the new tests fail (no `leadAndBeats`, no beats, no `li.now`); the rest pass.
- [ ] **Step 3: Implement.**
  - `story.md`: each step's body is its line, a blank line, and its three lines as a `- ` list, the words exactly as below. The comment at the top also says to keep each step's three lines in the order the app does them.

```markdown
## Set up the tracks. {#setup}

One track per musician, filled in from last time.

- Name the rehearsal, or keep the date.
- A track per musician: a name, an icon, the input it comes in on.
- Check signal: everyone plays, and each bar moves for its own player.

## Hear last week, then record. {#record}

Hear how the song went last week, then play it.

- Pick Pałyn under Next take.
- Its best go from last week plays right beside it.
- Record: the take's name over a big clock, and a tile per track that turns red when it clips.

## Keep the good ones. {#keep}

Stop, listen, keep it. The evening sorts itself while everyone remembers.

- Stop, and the take opens to listen to. Save it.
- A take nobody named: one click on Sonca names it.
- False starts are grey, and Send starred puts the ★ takes in the band's folder.

## Find it later. {#history}

Every rehearsal, every mark and every song, in History.

- History opens on the newest rehearsal.
- Marks: every Went wrong, from every rehearsal. ▶ plays from just before it.
- A click on Pałyn: its page, every go at it, one line an evening.

## Compare goes. {#compare}

Loop the bridge, then hear it in the next go.

- Open Pałyn 5 and loop its bridge.
- Step to Pałyn 6: it starts at the same bar, still looping.
- ↑ and ↓ do the same, through every rehearsal.
```

  - Stage `Story.tsx`: each `FORWARD` step gets `beat(n)`, which posts `{ type: "rr-beat", step, beat: n }` to `window.parent` (`"*"`, as `rr-ready` is); `startStory` makes it for the step it runs. `BEAT_MS = 1500`. Where each line is told:
    - setup: 0 once the name is filled, `BEAT_MS`; 1, `BEAT_MS`; 2 once Check signal is pressed.
    - record: 0 once Pałyn is picked under Next take; 1 once Play Pałyn 7 is pressed; 2 once the Recording screen shows Stop.
    - keep: 0 once the take is open (`#take-name`); 1 once the Sonca pill is in view; 2 after it is named, with `bringIntoView(button("Send starred"))`.
    - history: 0 once History shows, `BEAT_MS`; 1 once Went wrong's marks show; 2 once Pałyn's page is open.
    - compare: 0 once the loop plays; 1 once Pałyn 6 is open; then 2.5 s of it looping, `key("ArrowDown")`, wait for the open tab's line to start with "7", and 2.
  - Page `Story.tsx`: `lit: { step: number; beat: number } | null`, set by `LiveFrame`'s `onBeat`; each step renders its `lead` as `<p>`s and its beats as `<ol className="beats">`, the one `li` with `i === active && lit?.step === i && lit.beat === k` getting `className="now"` and `aria-current="true"`.
  - `page.css`, from the mockup: `.beats { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 2px; max-width: 27rem; counter-reset: b; font-size: 0.94rem; }`, `.beats li { counter-increment: b; display: grid; grid-template-columns: 22px 1fr; gap: 6px; padding: 8px 12px; margin-left: -12px; border-radius: 10px; color: var(--page-muted); transition: background-color 0.3s ease, color 0.3s ease; }`, `.beats li::before { content: counter(b); font-family: var(--page-mono); font-size: 0.78rem; padding-top: 0.2em; }`, `.beats li.now { background: var(--page-tile); color: var(--page-fg); }`; the reduced-motion rule drops the transition too.
- [ ] **Step 4: Run** the same commands, and look at the five steps on `npm run preview` at 1280 and 390 wide. Expected: green; each step's lines light one after the other; nothing jumps when a line lights (same padding lit or not).
- [ ] **Step 5: Commit** `git commit -m "reha.stream: every step told in three lines, lit as the app goes"`.

### Task 7: Docs, the pictures, the changelog

**Files:**
- Modify: `docs/using-it.md` (History), `CHANGELOG.md`, `tests/docs_screenshots.py`, `docs/screenshots/history.png`, `docs/screenshots/history-songs.png`, new `docs/screenshots/history-marks.png`

- [ ] **Step 1:** `docs_screenshots.py`: `COUNTED` adds `rehearsals` and `last_marked` from `PAST`; a `history-marks` shot (History, Marks, Went wrong) with `HEIGHT["history-marks"] = 820`. Run it; look at all three History pictures.
- [ ] **Step 2:** `using-it.md`: History has three views; a **Marks** part after Songs: the labels, the head and its switch, a row, ▶ from 5 s before, a click and Esc, headings, a rehearsal not on disk; the picture. `## Keyboard`: ↑ ↓ go through labels too.
- [ ] **Step 3:** `CHANGELOG.md`, first under Unreleased: "**Every mark by its label.** History has a third view, *Marks*: …" (the lead the site's ribbon shows at the release).
- [ ] **Step 4: Run** `venv/bin/python tests/run_all.py && (cd ui && npm test) && (cd site && npm test)`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Docs: History's Marks view"`.

## Claude's calls in this plan (for Alex)

- **Marks of a rehearsal not on disk stay in the list, greyed** (spec D6). The first spec left them out, but the counts on the left come from the whole library, so the list and the count would disagree; a song's page keeps such goes the same way.
- **The demo band gets seven more marks on its own four labels**, not *Idea* and *Solo* as in the mockup: Settings › Marks in the docs shows "the four labels a library starts with", and new labels would make that untrue.
- **The changelog entry goes first**, as the newest; at the release the site's ribbon would read "New in … Every mark by its label."
- **Only the step on screen has a lit line, and only once the app has got to it.** After a jump back the app starts again from the first step, so the line stays dark until it catches up instead of showing a line the frame is not on.
- **Each line stays at least 1.5 s** where the app would otherwise do two things at once (setup, the opening of History), so it can be read; the waits already in the story (last week's go for 3 s, the take, the 1.8 s on Went wrong) are kept.
- **Compare goes gains ↓ to Pałyn 7** at its end, so its third line has something to show.
- **The 300-rehearsal timing is measured once**, written in the PR, and is not a CI test: a time limit in CI fails on a slow runner.
