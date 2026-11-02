# Deleting takes and songs in the band service: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone in the band deletes a take or a whole song right in the band service; both wait in the Trash for 30 days, and РЭХА keeps the takes but stops sending them.

**Architecture:** The Worker gets two columns on `take` and two on `song` (migration 0004), routes to delete a take, delete a song with its takes and restore a song, a Trash answer with songs, and a clean-up that also deletes songs. РЭХА's PUT carries `by_hand`; the service keeps a take the band deleted in the Trash unless it comes by hand, and says so. РЭХА also asks `GET /api/reha/takes` when it starts and then every hour, and brings its rows in line. The pages get ⋯ › **Delete take** on every take line, in the take's panel and on its page.

**Tech Stack:** Cloudflare Worker (Hono + zod-openapi, Drizzle on D1, R2), React + TanStack Query/Router on РЭХА's shadcn components (`service/src`), Python with SQLAlchemy and Alembic (`src/rehearsal_recorder`).

**Spec:** `docs/superpowers/specs/2026-11-02-service-delete-design.md` (approved by Alex, 2 November 23:29).

## Global Constraints

- Anyone in the band may delete or restore; no owner check on these routes.
- 30 days in the Trash, then gone for good, songs too (`TRASH_DAYS` in `service/worker/takes/purge.ts`).
- A take РЭХА removed (`trashed_by` null, `with_song` false) comes out of the Trash on any PUT, as today. A take the band deleted, or one that went with its song, comes out only with `by_hand: true`.
- РЭХА asks the service when it starts and then every 3600 seconds (`CHECK_SEC = 3600`).
- Words exactly as the spec gives them: the questions' titles and texts, the Trash's heading line and row lines. Curly quotes in titles (design system B8); button names in bold in the guide and CHANGELOG; British spelling.
- **Delete take** and **Delete song** buttons in the questions use `destructive={false}` (the accent); a song that never had a take keeps the red one.
- Test labels in `tests/test_sending.py`: cp1252 characters only.
- While building, run only the tests a change touches, once each. The full suites run once, on CI.

## Review Focus

1. РЭХА sends a rename of a take the band deleted (no `by_hand`): the take must stay in the Trash and the answer must say `in_trash: true` (Task 1 test).
2. **Remove from the band service** in РЭХА, then the hourly check runs before the DELETE reached the service: the row must stay taken out (Task 3 test).
3. **New song** with the title of a song in the Trash: the answer must point at the Trash, not say only “There is already a song called …” (Task 1 test).
4. **Delete take** in an open panel or on the take's own page: the panel closes or the page goes to the rehearsal, with no “This screen could not open.” (Task 2 test).
5. РЭХА was off for more than 30 days: at start the check runs before any take is sent, so a take deleted for good is marked taken out and never made again as an empty take (Task 3 test).

---

### Task 1: The Worker: columns, routes, clean-up

**Files:**
- Modify: `service/worker/shared/schema.ts` (`song`, `take`)
- Create: `service/migrations/0004_*.sql` and its `meta/` snapshot, with `npm run migrations` (drizzle-kit names it)
- Modify: `service/worker/takes/store.ts` (`songId`, `putTake`, new `toTrash`)
- Modify: `service/worker/takes/meta.ts` (`TakeMeta`)
- Modify: `service/worker/takes/reha-routes.ts` (PUT answer, new GET)
- Modify: `service/worker/takes/band-routes.ts` (new DELETE, `GET /api/trash`, restores)
- Modify: `service/worker/songs/routes.ts` (`songItems`, song page, `DELETE /api/songs/{id}`, `POST /api/songs` clash)
- Modify: `service/worker/takes/purge.ts` (songs)
- Modify: `service/openapi.json` (`npm run openapi`)
- Test: `service/test/reha.test.ts`, `service/test/songs.test.ts`, new `service/test/trash.test.ts`

**Interfaces:**
- Produces, schema: `take.trashedBy: text("trashed_by")` referencing `user.id`, null when РЭХА removed it; `take.withSong: integer("with_song", { mode: "boolean" }).notNull().default(false)`; `song.trashedAt: text("trashed_at")`; `song.trashedBy: text("trashed_by")` referencing `user.id`.
- Produces, API:
  - `DELETE /api/takes/{uid}` (`needMember`) → `{ ok: true }`; 404 `NO_TAKE` when there is no shown take; a take already in the Trash answers 200 and is left as it is.
  - `DELETE /api/songs/{id}` (`needMember`) → `{ ok: true }`. A song with any take (in the Trash or not) gets `trashedAt`, `trashedBy`; its takes not in the Trash get `trashedAt` (the same moment), `trashedBy`, `withSong: true`. A song that never had a take is deleted as today, files and all.
  - `GET /api/songs/{id}` adds `trashed_takes: number` (its takes in the Trash) to `song`; a song in the Trash answers 404 `NO_SONG`.
  - `POST /api/trash/songs/{id}/restore` (`needMember`) → `{ ok: true }`; 404 when the song is not in the Trash. Clears the song's `trashedAt`/`trashedBy`, and on its takes with `withSong` clears `trashedAt`, `trashedBy`, `withSong`.
  - `POST /api/trash/{uid}/restore` also clears `trashedBy` and `withSong`, and clears the song's `trashedAt`/`trashedBy` when its song is in the Trash.
  - `GET /api/trash` → `{ songs: TrashedSong[], takes: (TakeRow & { trashed_at: string; by: string | null })[] }`, each list newest first. `TrashedSong = { id: number; title: string; takes: number; trashed_at: string; by: string | null }`, `takes` counting its `withSong` takes. A take with `withSong` whose song is in the Trash is left out of `takes`. `by` is the member's shown name (`shownName`), null for РЭХА.
  - `TakeMeta.by_hand: z.boolean().optional()`.
  - `PUT /api/reha/takes/{uid}` → `{ ok: true, in_trash: boolean }`.
  - `GET /api/reha/takes` (`needKey`, `RehaHeaders`) → `{ uid: string; trashed: boolean; mp3_gen: number | null; flac_gen: number | null }[]`, every take; `mp3_gen` is `shownGen`.
- Produces, store: `putTake(env, uid, meta): Promise<{ inTrash: boolean }>`; `toTrash(db, uids: string[], by: string, withSong: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing Worker tests**

In `service/test/trash.test.ts` (new; helpers from `test/helpers.ts`: `reha`, `takeMeta`, `shownTake`, `signInOwner`, `member`, `del`, `post`, `read`, `answer`):
- `"a take deleted in the service waits in the trash with who deleted it"`: `del("/api/takes/<uid>", ivan)` → 200; `read("/api/trash", alex).takes[0]` matches `{ uid, by: "Ivan" }`; the take is gone from `/api/songs/<id>` takes and from `/api/home`.
- `"a change from РЭХА leaves a take the band deleted in the trash"`: delete in the service, then `r.put(…, takeMeta({ name: "Viasna 12b" }))` answers `{ ok: true, in_trash: true }`; the take is still in `/api/trash`; then `takeMeta({ by_hand: true })` answers `in_trash: false` and the take is back.
- `"a take РЭХА removed comes out on any change, as before"`: `r.del` then `r.put` without `by_hand` → `in_trash: false`.
- `"a song goes to the trash with its takes and comes back whole"`: two shown takes of “Pałyn”, one deleted on its own first; `del("/api/songs/<id>")` → 200; `/api/trash` is `{ songs: [{ title: "Pałyn", takes: 1, by: "Ivan" }], takes: [<the one deleted first>] }`; `/api/songs` has no “Pałyn”; `GET /api/songs/<id>` → 404; `post("/api/trash/songs/<id>/restore")` → 200; the song is back with the take that went with it; the one deleted first stays in the Trash.
- `"restoring one take of a song in the trash brings the song back with that take"`: after the song's delete, `post("/api/trash/<uid>/restore")`; `/api/songs` lists the song with `takes: 1`; `/api/trash.takes` now lists the song's other take on its own.
- `"a new take of a song in the trash brings the song back"`: song in the Trash, `r.put` of a new uid with `song: "Pałyn"` → the song is back with one take; its old takes listed on their own in the Trash.
- `"a song that never had a take is deleted at once"` (moved from `songs.test.ts`' old test, which loses its 400 case).
- `"New song with the title of a song in the trash says so"`: 409 with `“Pałyn” is in the Trash. Restore it there.`
- `"РЭХА lists its takes with what is up and whether each is in the trash"`: `r.get("/api/reha/takes")` after one live and one deleted take → `[{ uid, trashed: false, mp3_gen: 1, flac_gen: null }, { uid, trashed: true, … }]` (any order: compare sorted by uid).
- `"songs 30 days in the trash are deleted with their files"`: fake timers as in `reha.test.ts`' trash test; a song with one take and one file deleted; after `purgeTrash` at 30 days and a minute, `SELECT id FROM song` is empty and `songs/<id>/` in `FILES` is empty.

In `service/test/reha.test.ts`, the existing `"a take sent again leaves the trash with its comments"` stays as it is and must still pass.

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run test/trash.test.ts test/reha.test.ts test/songs.test.ts`
Expected: the new tests FAIL (404 on `/api/takes/<uid>` DELETE, `GET /api/trash` an array, no `in_trash`).

- [ ] **Step 3: Columns and migration**

Add the four columns to `schema.ts` with one-line comments in the file's manner; `npm run migrations`; check the SQL only adds columns.

- [ ] **Step 4: Store**

`putTake` reads `before`; `stays = before?.trashedAt != null && (before.trashedBy != null || before.withSong) && !meta.by_hand`. When `stays`, `fields.trashedAt` keeps `before.trashedAt` (and `trashedBy`, `withSong` are not touched); otherwise they are cleared. The details are written either way, so a restored take is up to date. `songId` brings a song in the Trash back (`trashedAt`, `trashedBy` null) only when the take will not stay in the Trash: pass `stays` in. Return `{ inTrash: stays }`. `toTrash` sets `trashedAt: iso()`, `trashedBy: by`, `withSong` on the takes not already in the Trash.

- [ ] **Step 5: Routes**

As the Interfaces block says. The clash check in `POST /api/songs` answers `` `${quoted(title)} is in the Trash. Restore it there.` `` when the taken title belongs to a song in the Trash. `songItems` leaves out songs with `trashedAt`. Each route's `description` in the existing words' manner (**Delete take**, **Delete song**, **Restore**).

- [ ] **Step 6: Clean-up**

After the takes, `purgeTrash` takes songs 30 days in the Trash, the longest there first, `PER_RUN` at most, skips one that still has a take, and for the rest deletes `song_file` rows, the song, and `deleteFiles(env, \`songs/${id}/\`)`. Returns takes plus songs deleted.

- [ ] **Step 7: Run the tests**

Run: `cd service && npx vitest run test/trash.test.ts test/reha.test.ts test/songs.test.ts test/migration.test.ts`
Expected: PASS.

- [ ] **Step 8: openapi.json and its test**

Run: `cd service && npm run openapi && npx vitest run test/openapi.test.ts && npm run typecheck`
Expected: PASS, `openapi.json` changed.

- [ ] **Step 9: Commit**

`git add service/worker service/migrations service/test service/openapi.json && git commit -m "Band service: delete a take or a song, both to the Trash"`

### Task 2: The pages: ⋯ › Delete take, Delete song, the Trash

**Files:**
- Create: `service/src/takes/TakeMenu.tsx`
- Modify: `service/src/api.ts` (`useDeleteTake`, `useRestoreSong`, `Trashed`, `TrashedSong`)
- Modify: `service/src/takes/parts.tsx` (`TakeLine`), `service/src/takes/TakePanel.tsx`, `service/src/takes/Take.tsx`
- Modify: `service/src/songs/parts.tsx` (`SongMenu`)
- Modify: `service/src/trash/Trash.tsx`
- Test: `service/e2e/trash.spec.ts`, `service/e2e/takes.spec.ts`

**Interfaces:**
- Consumes: Task 1's routes and `GET /api/trash` shape; `song.trashed_takes`.
- Produces: `TakeMenu({ take, onGone }: { take: { uid: string; name: string }; onGone?: () => void })`: ⋯ (`variant="ghost" size="icon-row"`, `aria-label={\`What to do with ${take.name}\`}`) with one item **Delete take**, then `ConfirmDialog` with the spec's title, text and `actionLabel="Delete take"`, `destructive={false}`; `onGone` runs before the change, as `SongMenu` does. `useDeleteTake(): (uid: string)`, `useRestoreSong(): (id: number)`.

- [ ] **Step 1: Write the failing page tests**

In `service/e2e/trash.spec.ts` (each test leaves the band as it found it, since the tests share one band; Viasna 4 starts in the Trash and the old test expects it alone there):
- `"a take deleted from its line waits in the trash and comes back"`: on the first rehearsal's page (`band()` in `e2e/band.ts`), the line `[data-take="Viasna 5"]` › `What to do with Viasna 5` › **Delete take**; the dialog reads `Delete “Viasna 5”?`; confirm; the line is gone; on Trash its row reads `/deleted by Alex .+ · deleted for good in 30 days/`; **Restore**; the status says it is back.
- `"a song deleted with its takes is one line in the trash"`: Kupalle's panel › ⋯ › **Delete song**; the dialog text starts `It goes to the Trash with its`; confirm; Songs has no Kupalle; Trash has `[data-song="Kupalle"]` reading `/song with \d+ takes?, notes and files · deleted by Alex/`; **Restore** brings it back to Songs with its takes.

In `service/e2e/takes.spec.ts`:
- `"deleting the open take closes its panel"`: open a take's panel, its ⋯ › **Delete take** › confirm; the panel is closed, no `This screen could not open.`; then restore it through `/api/trash/<uid>/restore` with `page.request`.
- `"deleting a take on its page goes to its rehearsal"`: the same from `/takes/<uid>`; the URL becomes `/rehearsals/<uid>`; restore as above.

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx playwright test e2e/trash.spec.ts e2e/takes.spec.ts` (locally with a throwaway config that sets `launchOptions.executablePath: "/opt/pw-browsers/chromium"`, not committed)
Expected: FAIL, no `What to do with Viasna 5` button.

- [ ] **Step 3: `TakeMenu` and the hooks**

As the Interfaces block says.

- [ ] **Step 4: Put it where the spec says**

`TakeLine`: after `StarButton`, in one `flex items-center gap-1` with it. `TakePanel`: before ✕, `onGone={close}`. `Take` page: after the star, left out when `take.trashed_at`; `onGone` navigates to `/rehearsals/$uid` of its rehearsal with `replace: true`.

- [ ] **Step 5: `SongMenu`**

Shown for every song. Text: `song.takes > 0` → `` `It goes to the Trash with its ${count(song.takes, "take")}, notes and files, where anyone in the band can put it back for 30 days. In РЭХА the takes stay as they are.` ``; `song.takes === 0 && song.trashed_takes > 0` → `It goes to the Trash with its notes and files, where anyone in the band can put it back for 30 days.`; neither → `Its notes and files go with it.`, red. `destructive` only in the last case.

- [ ] **Step 6: Trash**

Heading line and rows as the spec words them; songs and takes in one list, newest first by `trashed_at`; a song row `data-song={title}` with **Restore** (`useRestoreSong`) and the status line `` `${quoted(title)} is back with its takes.` ``. A take's line says `deleted by ${by} ${day(localDay(trashed_at))}` when `by`, else today's `removed in РЭХА …`.

- [ ] **Step 7: Run the page tests and the type check**

Run: `cd service && npm run typecheck && npx playwright test e2e/trash.spec.ts e2e/takes.spec.ts e2e/songs.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

`git commit -m "Band service: Delete take on every take, Delete song with its takes, songs in the Trash"`

### Task 3: РЭХА: by hand, in the Trash, the hourly check

**Files:**
- Create: `src/rehearsal_recorder/store/migrations/versions/0013_service_by_hand.py`
- Modify: `src/rehearsal_recorder/store/models.py` (`ServiceCopy.by_hand`)
- Modify: `src/rehearsal_recorder/sending/service_client.py` (`takes`)
- Modify: `src/rehearsal_recorder/sending/band_service.py`
- Modify: `tests/fake_band_service.py`, `tests/test_sending.py`

**Interfaces:**
- Consumes: Task 1's `by_hand`, `in_trash`, `GET /api/reha/takes` (the fake checks every request against `service/openapi.json`).
- Produces: `ServiceCopy.by_hand: Mapped[bool] = mapped_column(Boolean, default=False)` (revision `"0013"`, down `"0012"`, server default false); `ServiceClient.takes() -> list[dict]`; `BandService.CHECK_SEC = 3600`; `BandService._compare()` and `BandService._taken_out(take_id)`.

- [ ] **Step 1: Teach the fake the new answers**

`tests/fake_band_service.py`: a take has `"trashed_by"`; a test can set it with a helper `delete_in_service(uid)` (`trashed`, `trashed_by = "Ira"`). PUT keeps such a take trashed unless `by_hand`, and answers `{"ok": True, "in_trash": …}`. `GET takes` answers every take's `uid`, `trashed`, and `mp3_gen`/`flac_gen` from the `ready` calls it has seen (record them per uid).

- [ ] **Step 2: Write the failing checks**

A new section in `tests/test_sending.py`, after the Remove checks, cp1252 labels:
- `"a change of a take deleted in the service marks it taken out"`: `fake.delete_in_service(uid)`, rename the take, drain; `take(n)["service"] is None`, the fake's take still trashed, no upload started for it.
- `"the cloud button brings it back with by_hand"`: `api.send…` on it, drain; the fake saw `by_hand` true and the take is not trashed.
- `"the check finds a take deleted in the service"`: delete in the fake, set `service()._next_check = 0`, drain; `take(n)["service"] is None` with no change made in РЭХА.
- `"the check finds a take restored in the service"`: the fake untrashes it; check; `take(n)["service"]` is `{"up": True, …}` and no file was sent again (`fake.count("start <uid>")` unchanged).
- `"the check leaves a take removed here before its delete went"`: Remove from the band service with the fake not answering DELETE yet (`_later` for the delete in the future), check, the row stays taken out.
- `"a take the service no longer has is marked taken out at start"`: drop it from the fake's takes, a fresh `BandService` (or `_next_check = 0`), the first `run_next` makes the comparison before any send; the take is taken out and no PUT for it went.

- [ ] **Step 3: Run them to see them fail**

Run: `python tests/test_sending.py`
Expected: the new labels print `FAIL`.

- [ ] **Step 4: Migration and model**

`0013_service_by_hand.py` in `0012_take_shape.py`'s manner: one `add_column`, server default `sa.false()`.

- [ ] **Step 5: Client**

`ServiceClient.takes()` → `self._call("GET", "/api/reha/takes")`.

- [ ] **Step 6: Band service**

- `_queue(folder, take_number, take=None, by_hand=False)`; `send` and `send_starred` pass `by_hand=True`; it sets `by_hand` on the row.
- `_send`: the meta gets `"by_hand": bool(row["by_hand"])`; after `put_take`, `by_hand` goes back to False; an answer with `in_trash` calls `_taken_out(take_id)` and raises `_Changed` so nothing uploads.
- `_taken_out(take_id)`: the same fields `remove` sets (`removed`, `due`, `error`, `sent`, `mp3_gen`, `flac_gen`), `drop_service_files`, the staging folder gone; no DELETE is sent.
- `_compare()`: `client.takes()`; uids with a pending delete (`self._deletes()`) are skipped; for each row: in the list and `trashed`, not removed → `_taken_out`; in the list, not `trashed`, removed → `removed=False, due=True, error=None, mp3_gen, flac_gen` from the list; not in the list, not removed, `mp3_gen` set → `_taken_out`. `Offline` puts the next check `RETRY_SEC` away; `Refused` an hour away.
- `run_next`: before deletes and sends, when `time.monotonic() >= self._next_check` (0 at start), run `_compare()` and set `_next_check = now + CHECK_SEC`; return True.

- [ ] **Step 7: Run the checks**

Run: `python tests/test_sending.py`
Expected: `All band service checks passed.`

- [ ] **Step 8: Commit**

`git commit -m "РЭХА: a take deleted in the band service is taken out here; checked at start and hourly"`

### Task 4: Guide, CHANGELOG, reha.stream

**Files:**
- Modify: `docs/using-it.md` (“In the band service”, around line 853)
- Modify: `CHANGELOG.md` (a new `## Unreleased` on top)
- Modify: `site/content/band-service.md` (“Nothing gets lost”)

- [ ] **Step 1: Guide**

After the paragraph on **Remove from the band service**: a take someone in the band deletes in the service stays on this computer and is no longer sent; its cloud button sends it again and brings it back. **Restore** in the service puts it back in the sending within an hour, or when РЭХА next starts.

- [ ] **Step 2: CHANGELOG**

`## Unreleased`, first item bold: **Delete takes and songs in the band service.** Then: ⋯ › **Delete take** on every take, ⋯ › **Delete song** for a song with its takes, the Trash for 30 days, РЭХА keeps the takes and stops sending them. A second item for the fix: **Delete song** no longer shows on a song it could not delete.

- [ ] **Step 3: reha.stream**

The sentence from the spec, word for word.

- [ ] **Step 4: Check the words and the site's tests**

Humanizer pass on the new paragraphs; `cd site && npx vitest run src/content/bandService.test.ts src/content/changelog.test.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Guide, CHANGELOG and reha.stream: deleting in the band service"`

### After the tasks

- [ ] One review of the whole branch; every finding fixed before the PR, so CI runs once.
- [ ] The PR with Alex's picks and Claude's calls; the site preview for him to look at the changed sentence.
