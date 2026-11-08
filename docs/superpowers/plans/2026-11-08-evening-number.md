# The evening number leaves the screen — plan

Spec (Alex's «ок» 2026-11-08 16:43:45Z): https://claude.ai/artifact/3tfX5XsV8dsNnKM81C7RV8
Mockups: https://claude.ai/artifact/GqQ4rXoVF7pJmQcqsBA3eh (Q1 А),
https://claude.ai/artifact/3kFfSecewZsqMBXYb9Euwz (Q2 Б),
https://claude.ai/artifact/VjjnaTjVb59EGRsZUc8x5D (Q3 keep).
Branch: `claude/project-thread-s5m8ip`, restarted from main 537287e. One PR.

The rule. A take has two numbers: `go`, its number at its song, and
`take_number`, its place in the rehearsal (the evening number). After this
work a person never reads the evening number: not before a row, not on the
Record button, not while recording, not in Review, not from a screen reader.
A take with no song is counted like a song's takes, across the whole
library, and reads "Take #47". Inside, `take_number` stays as it is: the
database key, the order of a rehearsal's takes, the "03 - " at the start of
folder and cloud copy names, the draft folder "take 3", the service's
`number`.

The contract between the tasks (so 1, 2 and 3 can run at once):
- Python sends a take with no song as `song: null`, `go: 47`,
  `name: "Take 47"` (stored, no #). Every take with no song has a go once
  migration 0015 has run.
- The next take, unnamed: `{"song": None, "go": <next>, "name": "Take <next>"}`;
  `take_go` in the recording state is that go.
- The interface reads a take with no song as the title "Take" and its go,
  drawn exactly as a song's take: «Take #47», the number muted.
- The band service gets the name "Take 47" and song null, as now.

Tests while developing: only the tests a change touches, once each; full
suites run once on CI. Python with `python -I -m pytest <file>`; ui with the
touched specs only.

## Task 1 — РЭХА storage and Python (`src/rehearsal_recorder`)

- Migration `store/migrations/versions/0015_unnamed_goes.py`: a one-row
  table holding `last_unnamed_go`; every take with `song_id` NULL gets a go,
  in the order of its rehearsal's `created_at`, then `take_number`; the
  count is set to the last one; the service rows (`service_copy`) of those
  takes are marked due, so their new names go to the band service when the
  app opens (`BandService.reopen` → `_tidy`). Model in `store/models.py`.
- `store/names.py`: `take_name(None, go, n)` = "Take {go}"; `shown_name`
  = "Take #{go}"; `UNNAMED_TAKE` also matches "Take #47" and
  "Take#47"; `shown_from_name("Take 47")` = "Take #47". Docstring updated.
- `store/library.py` `_resolve` / `_song_row`: a name that is empty or
  "Take N" / "Take #N" is no song, with the take's own go if it already has
  no song, else one past the count, which moves on (never given
  twice, like `Song.last_go`). A take given a song keeps nothing of its old
  go. `next_goes` (or a sibling) also answers the next unnamed go for the
  interface's name field. `restore_takes` keeps a restored take's go.
  The Undo refusal (library.py:1592, api.py:6395) says
  "A newer take has its place now." with no number.
- `api.py`: `_next_take` / `suggest_take_name` / the recording state's
  `take_go` follow the contract; the background line's `plain_name` uses
  `shown_name` for no song too; the fallbacks at ~3181/3187 say "Take".
  Sweep `src/` for every other `Take {take_number}` a person reads.
- `sending/service_songs.py:407` (`_moves`): a take the band moved out of
  its song is renamed to no song (the next unnamed go), not to
  "Take {take_number}".
- `importer.py:99`: an old session's take with no name is no song (it gets
  its go from the count).
- The names pass at open (`_names_out_of_line` / `_put_name_right`,
  api.py ~7538) already renames folders and cloud copies to "07 - Take 47";
  a test proves it does for a migrated take.
- Tests (`tests/test_store.py`, `tests/test_sending.py`, the api tests that
  name takes): migration numbering order and count, no number given twice
  after a delete, out of a song and back, "Take #3" typed, `_moves` out,
  service rows marked due.

## Task 2 — РЭХА interface (`ui/`)

- `lib/takeText.ts`: `takeText` = `${take.song ?? "Take"} #go` whenever go
  is set; a helper `takeTitle(take)` = `take.song ?? "Take"` for the
  components that draw title and go apart.
- Remove the evening number: `RehearsalOverview.tsx:438` (the "28" before a
  row), `Rehearsal.tsx:583-590` (button reads "Record"; the empty list hint
  "Press Record or Space…" at 626), `Recording.tsx:299, 458` (no "Take 33";
  an unnamed take's title is «Take #49»), `Review.tsx:87, 171, 369, 383`
  (subtitle is the rehearsal's name alone; fallbacks «Take #N»),
  `App.tsx:178`, `SongTab.tsx:180, 414`, `SongLadder.tsx:278` (a bar with
  no song shows "#47").
- Screen readers: `TakeStrip.tsx` `takeButtonLabel` = `takeText(take)` plus
  ", starred" and the status ("Pałyn #2, starred"). Other aria-labels that
  carry `take_number` follow.
- The Record button keeps `data-next-take={n}` so tests can wait for the
  next take; `e2e/app.ts` gets `recordButton(page, n?)`, and the specs'
  `getByRole("button", { name: /Record take N/ })` become it (about 30
  specs, mechanical).
- `e2e/fake-bridge.js` follows Python: no-song takes counted like a song's
  (`resolved`, `songOf` accepting "Take #N", `nextTake`, fixtures via
  `asSent`), `take_go` for an unnamed next take. `e2e/band.js` likewise.
- Specs that select a take by "Take 2 Pałyn 2" select it by «Pałyn #2»;
  expectations of "Take N" for a take with no song become «Take #N».
- Stories: `components/ui/button.stories.tsx`, `kbd.stories.tsx`.
- Tests: `npm run typecheck`, the ui unit tests touched, the touched e2e
  specs once each.

## Task 3 — band service and Telegram (`service/`)

- `src/shell/words.ts` `songAndNumber`: a take with no song, not moved,
  named "Take N" → `{ song: "Take", number: N }`, so «Take #47» everywhere
  TakeName and `takeText` draw it.
- `worker/takes/band-routes.ts:212`: a take moved out of its song is named
  "Take" until РЭХА numbers it (TakeName then shows "Take · number from
  РЭХА", as a move to a song does now).
- `worker/chat/words.ts` `takeText`: «Take #47» for a take with no song.
- Hints and comments that say «Take 4» (parts.tsx:43, Songs/Rehearsal hints)
  follow.
- Seeds: `e2e/seed.ts` no-song take named "Take 3" with `number: 7`, so its
  two numbers differ; tests expect «Take #3».
- Tests: `words.test.ts`, `test/chat.test.ts`, the band-routes test for a
  move out, the touched e2e specs.

Tasks 1, 2 and 3 run at once, each by a helper in its own worktree, briefed
with this plan, the contract above and the test rule; Claude merges them
into the branch and runs the touched tests once more on the whole.

## Task 4 — words and pictures (after 1–3)

- `docs/using-it.md`: **Record** for **Record take** throughout; the lines
  that show the evening number (~285-287 recording line, ~345-346 Review,
  ~529 and ~563 the take with no song, ~909); the folders section (~1801)
  says the number at the start of a folder counts the evening's takes in
  order. Curly quotes, British.
- `docs/design-system.md` (220, 266) and `docs/design-notes.md` (~303).
- `CHANGELOG.md`, Unreleased: one item, starting in bold.
- Site: `site/content/story.md` section "One number for each take" and line
  124; **Record** in `download.md` and the stories `digital-mixer.md`,
  `metronome.md`, `record-rehearsal.md`, `tempo-drift.md`. Site code that
  finds a take by its label (`site/src/stage/Hero.tsx:33`, `Story.tsx`)
  follows the new label.
- Guide pictures: `python tests/docs_screenshots.py`; commit the ones that
  changed.
- A page with the site's changed text, for Alex before the merge.

## Task 5 — review and PR

Whole-branch review, every minor fixed before opening, one PR (template
headings, plain "Generated with Claude Code"), subscribe, merge card to
Alex once CI is green and he has seen the site text.
