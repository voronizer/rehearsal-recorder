# Renaming and Merging Songs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pencil beside a song's title in History renames the song or merges it into another, every go's folder and cloud copy following in the background; a title that left is remembered, so "Palyn" typed again is Pałyn's next go, shown as "Palyn → Pałyn 12", with "Also typed as Palyn ×" on the song's page to forget it. reha.stream gets a tile for it.

**Architecture:** Python keeps old names in a new `song_name` table (migration 0005) and looks through them when naming a take (`Library._resolve`). `Library.rename_song` and `Library.merge_songs` change the database in one transaction each and hand back the takes whose names changed; `Api` gives those to the names pass, which learns to work on a given set of takes under its own title. The interface resolves old names the same way over the `also` lists Python sends with every song, so the field and the pills follow typing; the Rename song dialog is the take name field without goes. The fake bridge and the band learn the same, which feeds the e2e tests, the docs pictures and the site's new tile.

**Tech Stack:** Python 3.12 (SQLAlchemy, Alembic, pywebview bridge), React 19 + TypeScript + Tailwind v4, Vitest, Playwright, `ui/e2e/fake-bridge.js` and `ui/e2e/band.js`.

**Spec:** `docs/superpowers/specs/2026-10-02-rename-and-merge-songs-design.md` (D1–D8, R1–R7, A1–A5, "On reha.stream"; updated 8 Oct 2026 with Alex's answers). Mockups: https://claude.ai/artifact/Mh9tNWYXdECHrZmLHDtGjn (the app), https://claude.ai/artifact/LdiyJmuZaVjVQASBjKF6rW (the site, variant C). Rulings: `/mnt/project-files/issue12/step10-rulings.md`.

## Global Constraints

- Merged goes: `into.last_go + 1` onward, oldest rehearsal first (`created_at`, then rehearsal id), then `take_number`; the target's own goes and every ★ unchanged.
- Names compare case-blind with `casefold()` in Python and `toLocaleLowerCase()` in the interface, as titles already do.
- Resolution order, Python and interface alike: whole text as a title, whole text as an old name, text less a trailing number as a title, then as an old name, else a new song. In Rename song only the first two count.
- Copy, exactly:
  - dialog title `Rename song`; line under it `Every go is renamed, with its folder on disk and its copies in the cloud folder.`; field label `Song title`; buttons `Cancel`, `Rename` / `Merge…`;
  - line under the field: `4 goes become Polyn.` (`1 go becomes Polyn.`), `Spelled anew: the same song.`, `Pałyn is another song: Palyn's goes join it.`;
  - question `Merge Palyn into Pałyn?` / `2 goes in 1 rehearsal become Pałyn 8–9, and their folders and cloud copies are renamed. To split them again, rename the takes one by one.` (`1 go … becomes Pałyn 8`), button `Merge`, not red;
  - page: `Also typed as` then each name with × `aria-label="Forget Palyn"`, `title="Forget Palyn: typed again, it is a new song"`;
  - field: overlay ` → Pałyn 12`; line `Palyn is Pałyn now.` + link `Make Palyn a new song`;
  - Python refusals: `A song needs a title`, `Take 4 is what a take with no song is called`, `There is already a song called Pałyn`, `Palyn is Pałyn now`, `Song not found`, `A song cannot be merged into itself`, `No song was called Palyn`;
  - background entry titles `Renaming Palyn to Pałyn`, `Merging Palyn into Pałyn`; done `2 takes renamed` as the pass says it.
- Site tile: id `names`, after `marks`, heading `Spell it however you like.`, body `Typed Palyn one night and Pałyn the next? Merge them once, and the old spelling still finds the song.`
- Windows CI prints in cp1252: Python check labels and test titles in Latin script with no ★, ▶, → or ł (write `Palyn`/`Polyn` in labels; data may hold any letters).
- Lint: no new oxlint warnings per file against `scratchpad/lint-baseline.txt` (from `npx oxlint` on main before Task 3).

## Review Focus

1. A song renamed or merged while one of its goes plays on its page: playback stops first, every folder is renamed by the pass, nothing is left for the next start (Task 6 test).
2. A merge into a song with no goes left (all deleted, so not in the Songs list): the dialog says Rename, Python refuses with `into`, and the merge question still comes before anything changes (Task 6 test).
3. Old names chained: Polyn merged into Palyn, then Palyn into Pałyn: Polyn and Palyn both lead to Pałyn; renaming Pałyn back to Palyn makes Pałyn the old name (Task 1 test).
4. A 60-character title and twelve old names: the dialog, the question and "Also typed as" wrap, nothing scrolls sideways at 960 px (Task 6 test).
5. "Make Palyn a new song" on the rehearsal screen: the next take is Palyn 1, the song list refreshes, the field stops showing → Pałyn, and the panel does not jump (Task 5 test).

---

### Task 1: The store: old names, rename, merge

**Files:**
- Create: `src/rehearsal_recorder/store/migrations/versions/0005_song_names.py`
- Modify: `src/rehearsal_recorder/store/models.py` (new `SongName`), `src/rehearsal_recorder/store/library.py`
- Test: `tests/test_store.py` (new section `[13] Renaming and merging songs (migration 0005)`)

**Interfaces:**
- Produces:
  - `SongName(id, song_id → song.id ON DELETE CASCADE, indexed, name: str)`.
  - `class SongRefused(ValueError)` with `.into: dict | None` (`{"id", "title"}`).
  - `Library.rename_song(song_id, title) -> {"from": str, "title": str, "takes": [(folder: str, take_number: int, name: str)]}`; raises `SongRefused`.
  - `Library.merge_songs(from_id, into_id, dry_run=False) -> {"from", "into", "goes", "rehearsals", "first": int | None, "last": int | None, "takes": [...]}` (takes as above, the moved ones; `first`/`last` None with no goes); raises `SongRefused`.
  - `Library.forget_song_name(name) -> bool`.
  - `Library.song_names() -> {title: [old names]}`, each list sorted case-blind.
  - `songs()` rows and `goes_of()` gain `"also": [old names]` (`[]` for the takes with no song).

- [ ] **Step 1: Write the failing checks** in `[13]`, on a library built with `add_take` as `[10]` builds one:
  - the database is at HEAD (0005) and the models match it (the existing drift check covers `song_name`);
  - `rename_song(polyn, "Polin")`: every take's name is `Polin N` with its go; `song_names() == {"Polin": ["Polyn"]}`; `takes` lists every go, oldest first, with its new name;
  - typing `"polyn"` and `"Polyn 9"` into `resolve_name` gives song `Polin` and its next go;
  - `rename_song(polin, "polin")` respells to `polin` and remembers nothing new; `rename_song(x, "")`, `rename_song(x, "Take 4")`, another song's title, another song's old name each raise `SongRefused` with the copy above, `.into` set for the last two;
  - `merge_songs(palyn, palyn_target)` with Pałyn at `last_go` 7 and Palyn's goes 1–2 in one rehearsal: Palyn's takes become `Pałyn 8`, `Pałyn 9` in played order; Pałyn 1–7 unchanged; `last_go` 9; ★ on both songs' takes unchanged; Palyn's Song row gone; `song_names()["Pałyn"] == ["Palyn"]`; the answer `goes 2, rehearsals 1, first 8, last 9`;
  - `dry_run=True` returns the same counts and changes nothing (titles, goes, rows);
  - chained (Review Focus 3): Polyn merged into Palyn, Palyn into Pałyn: `song_names()["Pałyn"] == ["Palyn", "Polyn"]`; then `rename_song(pałyn, "Palyn")`: title Palyn, `also == ["Pałyn", "Polyn"]`;
  - `forget_song_name("palyn")` is True, `resolve_name(.., "Palyn", ..)` is then a new song, and a second forget is False;
  - `songs()` and `goes_of()` carry `also`;
  - `import_rehearsal` of an old session naming takes `Palyn`, `Palyn 2` after the merge: both are goes at Pałyn.
- [ ] **Step 2: Run** `venv/bin/python tests/test_store.py 2>&1 | tail -20`. Expected: `[13]` fails (no `song_name`, no methods).
- [ ] **Step 3: Implement.** Migration 0005 creates `song_name` (`id` PK, `song_id` INTEGER NOT NULL FK `song.id` ON DELETE CASCADE, indexed, `name` VARCHAR NOT NULL); downgrade drops it. In `library.py`: `_names_by_key(db) -> {casefold: SongName}`; `_resolve` steps 2b and 3b (old names after titles); `_remember(db, song, name)` and `_free(db, name)` keep the D7 rules (a title never an old name, no old name twice); `rename_song`, `merge_songs` (one `update(Take)` per moved take, `update(SongName)` to re-point old names, then `db.delete(from)`), `forget_song_name`, `song_names`, `also` in `songs()` (one more query for all names) and `goes_of()`; `import_rehearsal`'s map also looks through old names.
- [ ] **Step 4: Run** `venv/bin/python tests/test_store.py && venv/bin/python tests/test_engine.py 2>&1 | tail -3`. Expected: both pass.
- [ ] **Step 5: Commit** `git commit -m "The store: songs renamed and merged, their old names remembered"`.

### Task 2: Api: the calls, and the names pass for a set of takes

**Files:**
- Modify: `src/rehearsal_recorder/names_pass.py`, `src/rehearsal_recorder/api.py`
- Test: `tests/test_engine.py` (new section `[61] Renaming and merging songs`)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `NamesPass.request_takes(todo: [(folder, take_number, name)], title: str)` queues a pass over those takes; `NamesPass.run_queued() -> int` runs every queued one (the thread calls it before a full pass; suites call it themselves); `NamesPass.run(todo=None, title=TITLE)`.
  - `Api.rename_song(song_id, title) -> {"ok": True, "title", "goes"} | {"ok": False, "error", "into": {"id", "title"} | None}`.
  - `Api.merge_songs(from_id, into_id, dry_run=False) -> {"ok": True, "into", "goes", "rehearsals", "first", "last"} | {"ok": False, "error"}`.
  - `Api.forget_song_name(name) -> {"ok": True} | {"ok": False, "error": "No song was called <name>"}`.
  - `song_choices` items gain `"also": [old names]`.

- [ ] **Step 1: Write the failing checks** in `[61]`, with real take folders and a cloud folder as `[53]` makes them:
  - a queued pass over two takes renames only those, under its own title, and says `2 takes renamed`; a full pass after it finds nothing;
  - `rename_song` of Polyn (3 goes, one with a cloud copy) to Polin: `{"ok": True, "title": "Polin", "goes": 3}`; after `run_queued()` the folders are `0N - Polin N`, the cloud copy is renamed, the entry is `Renaming Polyn to Polin`, `done`;
  - a take of the song open in the player is left (not closed) and a full pass renames it once the player lets go;
  - `rename_song` to another song's title answers `ok False` with `into` that song's id and title;
  - `merge_songs(palyn, pałyn, True)` answers the counts and moves nothing on disk; without `dry_run` the folders become `Pałyn 8`, `Pałyn 9` after `run_queued()`, entry `Merging Palyn into Pałyn`;
  - D4: with ★ on Palyn 2 (now Pałyn 9, the newest rehearsal) and on Pałyn 3, `get_song(pałyn)["plays"]` is Pałyn 9;
  - `song_choices()["other"]` has Pałyn with `also == ["Palyn"]`; `set_next_take_name("Palyn")` in a rehearsal answers `next_take_name "Pałyn"` and the next go;
  - `forget_song_name("Palyn")` then `set_next_take_name("Palyn")` answers `Palyn` go 1; a second forget answers the error;
  - `list_songs()` and `get_song()` carry `also`.
- [ ] **Step 2: Run** `venv/bin/python tests/test_engine.py 2>&1 | tail -20`. Expected: `[61]` fails.
- [ ] **Step 3: Implement.** `NamesPass`: a deque of `(todo, title)` under a lock; `request_takes` appends and sets `_asked`; `_loop` runs `run_queued()` then a full `run()` only when `request()`/`start()` asked for one (a flag). `run(todo, title)` uses `title` for `journal.begin("names", title)` and the "stopped unexpectedly" text. `Api`: the three calls, each from `self._lib` under `self._files_lock` (the pass takes it per take), the takes handed to `self._names_pass.request_takes`; `song_choices` adds `also` from `self._lib.song_names()`.
- [ ] **Step 4: Run** `venv/bin/python tests/run_all.py 2>&1 | tail -5`. Expected: all suites pass.
- [ ] **Step 5: Commit** `git commit -m "Renaming and merging songs: the calls, and the files following in the background"`.

### Task 3: The interface's types, and old names in naming

**Files:**
- Create: `ui/src/lib/songNames.ts`
- Modify: `ui/src/lib/api.ts`, `ui/src/lib/goes.ts`, `ui/src/lib/goes.test.ts`, `ui/src/hooks/useSongChoices.ts`

**Interfaces:**
- Consumes: Task 2's answers.
- Produces:
  - `SongChoice.also?: string[]`; `SongSummary.also: string[]`; `SongDetail.also?: string[]`.
  - `type RenameSongAnswer = Ok<{ title?: string; goes?: number; into?: { id: number; title: string } | null }>`; `type MergeAnswer = Ok<{ into?: string; goes?: number; rehearsals?: number; first?: number | null; last?: number | null }>`.
  - `api().rename_song(songId: number, title: string): Promise<RenameSongAnswer>`; `api().merge_songs(fromId: number, intoId: number, dryRun?: boolean): Promise<MergeAnswer>`; `api().forget_song_name(name: string): Promise<Ok>`.
  - `goes.ts`: `songNamed(text: string, choices: SongChoices | null): { choice: SongChoice; old: string | null } | null` (whole text: title, then old name; `old` is the old name as Python spelt it); `songFor(text, choices)` (that, then the text less a trailing number); `goFor` built on `songFor`, unchanged in what it answers for titles.
  - `songNames.ts`: `forgetSongName(name: string): Promise<boolean>` (calls Python, then tells the listeners); `useSongNamesVersion(): number` (`useSyncExternalStore`, as `labels.ts` does); `useSongChoices` refetches when it changes.

- [ ] **Step 1: Write the failing Vitest cases** in `goes.test.ts`, choices with `{song: "Pałyn", go: 12, also: ["Palyn", "Polyn"]}`:
  - `songNamed("palyn", c)` is Pałyn with `old: "Palyn"`; `songNamed("Pałyn", c)` has `old: null`; `songNamed("Palyn 3", c)` is null;
  - `songFor("Palyn 3", c)` is Pałyn, `old "Palyn"`; `songFor("Opus", c)` is null;
  - `goFor("polyn", c) === 12`, `goFor("Polyn 2", c) === 12`, `goFor("Opus", c) === 1`; the existing cases still pass;
  - a title equal to another song's old name never happens (D7), but if sent, the title wins.
- [ ] **Step 2: Run** `cd ui && npm test -- goes`. Expected: the new cases fail.
- [ ] **Step 3: Implement** the types, the three methods (all answer `{ok}`, so none joins `ANSWERS_WITH_A_VALUE`), `goes.ts`, `songNames.ts` and the hook's dependency.
- [ ] **Step 4: Run** `cd ui && npx tsc -b && npm test`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Interface: old names in naming, and the calls to rename and merge songs"`.

### Task 4: The fake bridge and the band

**Files:**
- Modify: `ui/e2e/fake-bridge.js`, `ui/e2e/band.js`

**Interfaces:**
- Consumes: Task 3's types.
- Produces (fake): a top-level `oldNames` map (`casefold → {name, song}`) read by `songOf` (old names after titles, whole text then less a trailing number), by `song_choices`, `list_songs` and `get_song` (`also`); a `retitled` map (`"folder#n" → {song, go}`) applied in `libraryNow()` and to the session's takes; `rename_song`, `merge_songs` (numbered after the target's highest go in the library, oldest rehearsal first), `forget_song_name`, each pushing a `names` entry onto `window.__ACTIVITY__` as the mockup's `mkDone` does; `window.__OLD_NAMES__ = [["Palyn", "Pałyn"], …]` seeds the map for a test. Band: Pałyn also typed as `Palyn`; its `song_choices` numbers `other` goes across `PAST` (one past the highest), as Python does.

- [ ] **Step 1:** No test of its own: Tasks 5 and 6 test it. Make the change.
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/naming.spec.ts e2e/songs.spec.ts e2e/band.spec.ts`. Expected: green, as before.
- [ ] **Step 3: Commit** `git commit -m "The fake bridge: songs renamed, merged and their old names"`.

### Task 5: The name field says what an old name is

**Files:**
- Modify: `ui/src/components/TakeNameField.tsx`, `ui/src/components/SongPills.tsx`
- Test: `ui/e2e/naming.spec.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4 (`songFor`, `songNamed`, `forgetSongName`).
- Produces:
  - `TakeNameField` props `goes?: boolean` (default true: false draws no go and passes it on), `offerNewSong?: boolean` (default true), `onDraft?: (text: string | null) => void`. When the text resolves through an old name: the overlay draws ` → Pałyn 12` (` → Pałyn` with `goes` false) in `[data-take-go]`; the sr-only line says `Pałyn, go 12`; with `offerNewSong`, `p[data-old-name]` under the songs says the line, and its button forgets the name (`forgetSongName`) and then puts it in the field (`put`).
  - `SongPills` prop `goes?: boolean` (default true) for pills, measuring copies and All songs…; a whole-text old name lights its song (`aria-current`) and narrows the pills to it, whatever the field started from.

- [ ] **Step 1: Write the failing Playwright tests** in `naming.spec.ts`, with `__OLD_NAMES__ = [["Palyn", "Pałyn"]]` (titles in Latin):
  - "an old name typed on the rehearsal screen says which song it is" (`#next-take-name` filled `Palyn`: `[data-take-go]` has `→ Pałyn`, only Pałyn's pill and All songs… shown, Pałyn's lit, the line visible);
  - "leaving the field names the take after the song" (`set_next_take_name` called with `Palyn`; the field then shows `Pałyn`, no line);
  - "Make Palyn a new song forgets the old name and names the take Palyn" (`forget_song_name` called first; the field shows `Palyn` with go 1, no arrow, no line; a later `Palyn` stays a new song);
  - "the panel does not move when the line appears" (the Record button's box before and after typing is the same);
  - "an old name with a number typed is the song too" (`Palyn 4` shows `→ Pałyn`);
  - "Rename take keeps the old name until Rename, saying what it is".
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/naming.spec.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd ui && npx tsc -b && npm test && npm run build && npx playwright test`. Expected: green; lint per file at or under the baseline.
- [ ] **Step 5: Commit** `git commit -m "The name field: an old name typed says which song it is now"`.

### Task 6: The song page: ✎, Rename song, Merge…, Also typed as

**Files:**
- Create: `ui/src/components/RenameSongDialog.tsx`, `ui/src/components/OldNames.tsx`, `ui/e2e/rename-songs.spec.ts`
- Modify: `ui/src/components/SongPage.tsx`, `ui/src/screens/HistoryScreen.tsx`

**Interfaces:**
- Consumes: Tasks 3–5; `ConfirmDialog`; `loadSongs`, `songRefFor`, `close()` in `HistoryScreen`.
- Produces:
  - `RenameSongDialog({ song: SongSummary | null, songs: SongSummary[], onOpenChange, onRename: (title: string) => void, onMerge: (into: { id: number; title: string }) => void })`: `TakeNameField` id `rename-song`, label `Song title`, compact, `goes={false}`, `offerNewSong={false}`, choices `{here: [], other}` from the other songs, latest played first; the line under it in a `min-h-5` box; Enter submits.
  - `OldNames({ names: string[], onForget: (name: string) => void })`: `[data-old-names]`, nothing with none.
  - `SongPage` props `onRenameSong: () => void`, `onForgetName: (name: string) => void`; ✎ `aria-label="Rename song Pałyn"` beside the `h2`; `OldNames` under the play line.
  - `HistoryScreen`: `songToRename`, `mergeAsked` state; rename and merge call `close()` first; after a rename the page re-reads (`loadSongs`); after a merge `setSong(songRefFor(index, into))`; a refusal with `into` asks the merge question; other refusals go to `notify` as errors.

- [ ] **Step 1: Write the failing Playwright tests** in `rename-songs.spec.ts`:
  - "the pencil beside the title opens Rename song with the title in the field and the other songs without goes";
  - "a new title renames the song, its page shows it, and the background work says so";
  - "a case-only change respells the song";
  - "a song's pill turns Rename into Merge, and the question names the counts" (`Merge Palyn into Pałyn?`, `2 goes in 1 rehearsal become Pałyn 8–9`);
  - "an old name of another song typed is a merge too";
  - "after a merge the page is the target song's, with every go, numbered after its own";
  - "Cancel on the question changes nothing";
  - "a title of a song with no goes left asks the merge question" (Review Focus 2: fake `rename_song` refusing with `into`);
  - "Take 4 is refused with its reason";
  - "playback stops before a rename";
  - "Also typed as lists the old names, and the cross forgets one";
  - "a 960 px window with a 60-character title and twelve old names scrolls nothing sideways";
  - "up, down and Space in the dialog's field do not change the song or play".
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/rename-songs.spec.ts`. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd ui && npx tsc -b && npm test && npm run build && npx playwright test`. Expected: green; lint per file at or under the baseline.
- [ ] **Step 5: Commit** `git commit -m "History: rename a song or merge it into another, from its page"`.

### Task 7: reha.stream, the docs and the changelog

**Files:**
- Modify: `site/content/features.md`, `site/src/content/index.ts` (`TILES`), `site/src/content/index.test.ts`, `site/src/page/pieces.tsx`, `site/src/page/Features.tsx` (`LAYOUT`), `site/e2e/page.spec.ts`, `docs/using-it.md` ("Names and songs" and "History"), `CHANGELOG.md` (Unreleased), `docs/screenshots/history-songs.png`

**Interfaces:**
- Consumes: Tasks 4 and 5 (`TakeNameField`, the band's old name and goes).
- Produces: `TILES` = `health, track, rehearsals, marks, names, cloud, formats, trash`; `PieceData.choices: SongChoices` (from `api().song_choices()` in `loadPieces`); the `names` shot: `left: true`, a `Piece` labelled `The Next take field with Palyn typed: Palyn is Pałyn now, at its next go` holding `TakeNameField` (`value="Palyn"`, `fallback="Pałyn"`, `onPanel`) at `w-[23rem] max-w-full`; `LAYOUT.names = "tile s4"`, `LAYOUT.trash = "tile s4 word"` so the last row is full.

- [ ] **Step 1: Write the failing tests:** `index.test.ts` expects the eight ids in order; `page.spec.ts` "the tiles show the app's own pieces" also expects `→ Pałyn` and `Make Palyn a new song` in `#features`, and no tile row with a gap at 1280 px (each row's spans add up to 6).
- [ ] **Step 2: Run** `cd site && npm test && npm run build && npx playwright test e2e/page.spec.ts`. Expected: fail.
- [ ] **Step 3: Implement** the tile, then the docs: "Names and songs" gains renaming a song, merging and old names (three short paragraphs, the copy above); CHANGELOG's Unreleased gains **Rename a song, or merge two.** first; `venv/bin/python tests/docs_screenshots.py` refreshes `history-songs.png`.
- [ ] **Step 4: Run** `cd site && npm test && npm run build && npx playwright test`, then the whole suite once: `venv/bin/python tests/run_all.py && (cd ui && npx tsc -b && npm test && npm run build && npx playwright test)`. Expected: all green.
- [ ] **Step 5: Commit** `git commit -m "reha.stream and the docs: renaming and merging songs"`.

### Then

Final review of the whole branch (one fresh reviewer), fix every minor it finds, push once, open the PR, watch it to green, ask Alex before merging, and mark step 10 done in the #12 tracking comment.

## Claude's own calls

1. **Old names in a table of their own**, not a column on `song`: a song can have several (Palyn, Polyn, a working title), and each must be found by `_resolve` with one query.
2. **"Take 4" is refused as a song title**: typed into a name field it means a take with no song, so a song called that could never be named again.
3. **In Rename song a number at the end is part of the title** ("Opus 5"), unlike the take field, where "Pałyn 5" means Pałyn: here the title itself is being set, and no go is involved.
4. **Another song's old name typed in Rename song merges into that song**, as its title does: D6 says the old name is that song everywhere.
5. **What plays on the page stops before a rename or a merge**: the pass leaves a take open in the player alone, so without this the playing go would keep its old folder until the app starts again.
6. **The merge button is not red**: nothing is deleted, and the question says how to split them again.
7. **No goes in the Rename song pills**: a rename gives no go, so the numbers would only mislead.
8. **The line "Palyn is Pałyn now" shows whenever the field holds an old name**, not only while typing: Rename take keeps the typed text until Rename is pressed, and the line still says what will happen.
9. **Old rehearsals imported from session.json follow old names**, so an old "Palyn" lands on Pałyn and not on a new song beside it.
10. **On reha.stream the Trash tile widens to fill its row**, which the new tile would otherwise leave half empty; the number after "→ Pałyn" is the demo band's next go, not the mockup's 12.
11. **The demo band has Pałyn also typed as Palyn**, so the docs' Songs picture shows the pencil and "Also typed as Palyn".
