# Taking a take out of its song: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⋯ › **Move to song** › **Not named** takes a take out of its song in the band service, and РЭХА follows at its next check.

**Architecture:** The take PATCH route takes `song: null`, names the take “Take {number}” and sets `movedBy`, so the listing РЭХА already reads carries it with `song_id` null. РЭХА's `_moves` renames such a take to `Take {take_number}` through `rename_take`, which sends it with no song and ends the listing.

**Tech Stack:** Hono + zod-openapi + Drizzle on D1 (service/worker), React (service/src, shadcn from ui/src), vitest, Playwright; Python (РЭХА), tests/test_sending.py with tests/fake_band_service.py.

**Spec:** `docs/superpowers/specs/2026-11-05-service-take-out-design.md` (Alex «ок» 2026-11-05 23:41Z).

## Global Constraints

- The list line is **Not named**, first in **Move to song**, a separator under it; the take's place is ticked (a take with no song: **Not named**).
- A take moved to no song is named `Take {number}` at once; `moved` (“number from РЭХА”) is true only for a take moved to a song.
- Nothing on reha.stream.
- English, British spelling; curly “ ” in the guide and CHANGELOG, apostrophes straight; button names bold; each CHANGELOG item starts bold.
- Test titles and labels: cp1252 characters only (no Cyrillic, no ⋯ or › in test names).
- While developing, run only the tests a change touches, once each; the full suites run once, on CI.
- No migration: `take.moved_by` exists since 0.24.0.

## Review Focus

1. A take already with no song picked as **Not named** again: no call, no change (Task 1 e2e ticks it; Task 1 vitest: PATCH on it changes nothing and lists nothing for РЭХА).
2. A take moved to a song, then to no song before РЭХА's check: listed once, with `song_id` null, name Take N (Task 1 vitest).
3. A take renamed in РЭХА after it last went, then moved to no song there: РЭХА's name wins (Task 2 test).
4. A take with no song in РЭХА already, moved to no song there: goes again and leaves the listing, nothing renamed (Task 2 test).
5. A song whose last take leaves stays, with no takes (Task 1 vitest).

---

### Task 1: The service

**Files:**
- Modify: `service/worker/takes/band-routes.ts:174` (`moved`), `:183-227` (PATCH)
- Modify: `service/worker/takes/rows.ts:125` (`moved`)
- Modify: `service/src/api.ts:276-280` (`useMoveTake`)
- Modify: `service/src/takes/move.tsx` (`MoveSub`, header comment)
- Modify: `service/src/songs/Songs.tsx:118`, `service/src/rehearsals/Rehearsal.tsx:52` (hints)
- Modify: `service/openapi.json` (made by `npm run openapi`)
- Test: `service/test/sync.test.ts`, `service/e2e/takes.spec.ts`

**Interfaces:**
- Produces: `PATCH /api/takes/{uid}` body `{ song: number | null } | { new_song: string }`; `waits(t: { movedBy: string | null; songId: number | null }): boolean` exported from `service/worker/takes/rows.ts`, used for both `moved` fields; `useMoveTake()` mutation arg `{ uid: string } & ({ song: number | null } | { new_song: string })`.
- Consumes: `GET /api/reha/songs` as is (`moved[].song_id` already nullable).

- [ ] **Step 1: Write the failing vitest** in `service/test/sync.test.ts`, after the move test:

```ts
test("a take leaves its song here: Take N at once, listed for REHA with no song, the song stays", async () => {
  const { alex, ivan, r } = await band()
  const uid = await shownTake({ song: "Viasna", number: 3, name: "Viasna 13" })
  const viasna = (await called(alex, "Viasna"))!
  expect((await patch(`/api/takes/${uid}`, { song: null }, ivan)).status).toBe(200)
  expect(await takeOf(uid)).toMatchObject({ name: "Take 3", song_id: null })
  expect((await songs(alex)).not_named.find((t) => t.uid === uid)).toMatchObject({ name: "Take 3", moved: false })
  expect(await called(alex, "Viasna")).toMatchObject({ id: viasna.id, takes: 0 })
  expect(((await answer(r.get("/api/reha/songs"))).body as Listed).moved).toEqual([{ uid, song_id: null, by: "Ivan" }])
  // РЭХА renames it and sends it with no song: the wait ends.
  const done = await answer(r.put(`/api/reha/takes/${uid}`, takeMeta({ number: 3, song: null, name: "Take 3" })))
  expect(done.body).toMatchObject({ ok: true, song_id: null })
  expect(await takeOf(uid)).toEqual({ name: "Take 3", song_id: null, moved_by: null })
  // Again on a take with no song: nothing changes, nothing listed.
  expect((await patch(`/api/takes/${uid}`, { song: null }, ivan)).status).toBe(200)
  expect(await takeOf(uid)).toEqual({ name: "Take 3", song_id: null, moved_by: null })
})
```

A second test, “moved to a song, then out of it before REHA's check: listed once, with no song”: `shownTake({ song: "Viasna", number: 5, name: "Viasna 5" })`, a `Pałyn` take beside it; PATCH `{ song: palyn.id }`, then `{ song: null }`; `takeOf` is `{ name: "Take 5", song_id: null }`, `moved` lists `[{ uid, song_id: null, by: "Ivan" }]`. The file's `Songs` type gets `moved: boolean` in `not_named`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run test/sync.test.ts -t "leaves its song|out of it"`
Expected: FAIL, 400 from the PATCH (`song` must be a number).

- [ ] **Step 3: Implement**
  - PATCH body: `z.object({ song: z.int().min(1).nullable() })` in the union. `song: null`: a take with `songId === null` answers ok untouched; otherwise `songId: null, name: \`Take ${t.number}\`, movedBy: me, updatedAt: iso()`. Description: “… to the song `song`, out of its song with `song: null` (named Take and its number at once), or to a new song titled `new_song`. …”.
  - `waits(t)` = `t.movedBy !== null && t.songId !== null`, in both `moved:` lines.
  - `useMoveTake`: `{ song: number | null }`.
  - `MoveSub`: radio value `"none"` for a take with no song; first item `<DropdownMenuRadioItem value="none">Not named</DropdownMenuRadioItem>`, then `<DropdownMenuSeparator />`, then the songs; picking `"none"` calls `move.mutate({ uid, song: null })` only when the take has a song. Header comment: add “or out of its song to Not named (Alex, 5 November)”.
  - Hints: Songs.tsx `hint={String(not_named.length)}`; Rehearsal.tsx `hint={count(ts.length, "take")}` for every group.
  - `cd service && npm run openapi`.

- [ ] **Step 4: Run the vitests again**

Run: `cd service && npx vitest run test/sync.test.ts -t "leaves its song|out of it|moves to another song"`
Expected: PASS (the existing move test too).

- [ ] **Step 5: Extend the e2e test** “Move to song: to a new song, then to one the band has” in `service/e2e/takes.spec.ts`. The take starts as Take 7 under **Not named**: before **New song…**, assert `page.getByRole("menuitemradio", { name: "Not named" })` has `aria-checked="true"`. After the move to Pałyn, still in the panel:

```ts
await panel.getByRole("button", { name: "What to do with Pałyn", exact: true }).click()
await page.getByRole("menuitem", { name: "Move to song" }).click()
await page.getByRole("menuitemradio", { name: "Not named" }).click()
await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText("Take 7")
```

In place of the last two lines (Pałyn's page), assert that on `/songs` the **Not named** region has the button “What to do with Take 7”. Rename the test “Move to song: to a new song, to one the band has, out of its song”.

- [ ] **Step 6: Run it**

Run: `cd service && npx playwright test e2e/takes.spec.ts -g "Move to song" --trace off`
Expected: 1 passed.

- [ ] **Step 7: Typecheck and lint the service**

Run: `cd service && npx tsc --noEmit && npm run lint --if-present`
Expected: no errors.

- [ ] **Step 8: Commit** `Service: Not named in Move to song takes a take out of its song`.

### Task 2: РЭХА follows

**Files:**
- Modify: `src/rehearsal_recorder/sending/service_songs.py:365-396` (`_moves`)
- Modify: `tests/fake_band_service.py:207-213` (`move_in_service`)
- Test: `tests/test_sending.py` (after the “which goes and wins there” block, ~line 1003)

**Interfaces:**
- Consumes: `moved[]` entries `{ "uid", "song_id": None, "by" }` from Task 1.
- Produces: `FakeBandService.move_in_service(uid, title, by="Ivan")` with `title=None` meaning no song: the take gets `song_id=None, song=None, name=f"Take {number}"`, `moved[uid] = {"song_id": None, "by": by}`.

- [ ] **Step 1: Write the failing checks** in `test_sending.py`, in the same style (`keep`, `drain`, `check`, `ok`):
  - `n_j = keep("Hušča", band=["Drums"])`, drained, `fake.move_in_service(uid_j, None)`, `check()`: `take(n_j)["song"]` is falsy and `take(n_j)["name"] == f"Take {n_j}"`; `(f"Hušča {go} → Take {n_j}", "Ivan moved it in the band service") in lines()` (read the go from the take's name before the move); `uid_j not in fake.moved` and `fake.takes[uid_j]["song_id"] is None`.
  - Renamed here first: as the “Lipa” block, with `move_in_service(uid, None)`: the take keeps “Lipa”, and after `drain()` the service has it under Lipa and not in `fake.moved`.
  - Already with no song here: a take renamed to `f"Take {n}"` with `api.rename_take` and drained, then `move_in_service(uid, None)`, `check()`, `drain()`: its name is unchanged and `uid not in fake.moved`.

- [ ] **Step 2: Run to see them fail**

Run: `python tests/test_sending.py`
Expected: FAIL at the first new `ok`: the take is still in Hušča.

- [ ] **Step 3: Implement** in `_moves`: `to_none = m.get("song_id") is None`; skip on `title is None` only when not `to_none`. The target name is `f"Take {row['take_number']}"` for `to_none`, else `title`. For `to_none` and a take with no song here, clear `sent["name"]` (not `sent["song"]`) with `change_service_row` and call `self.service.edited(...)`. The `done` key for `to_none` is `("song", self.number_of(take.get("song")))`, the song it left. Docstring: “or out of its song, to Take and its number”. Also `move_in_service` in the fake per the Interfaces.

- [ ] **Step 4: Run the file again**

Run: same command. Expected: every check passes.

- [ ] **Step 5: Commit** `РЭХА: a take the band took out of its song is renamed Take N`.

### Task 3: Words

**Files:**
- Modify: `docs/using-it.md:902-907`
- Modify: `CHANGELOG.md` (a new `## Unreleased` above `## 0.24.0`)

- [ ] **Step 1: The guide.** After “… or to a **New song…**.” add: “A take that is no song's, a jam with Viasna still in the field, goes to **Not named** from the same list and is called Take and its number.” Keep the next sentence. In the РЭХА paragraph after it, nothing changes: it already says РЭХА renames the takes as **Rename take** does.

- [ ] **Step 2: CHANGELOG.**

```markdown
## Unreleased

- **A take can leave its song in the band service.** A jam that came in as
  Viasna because the name field still said so goes to **Not named** with ⋯ ›
  **Move to song** › **Not named**, and is called Take and its number. РЭХА
  does the same on the laptop when it next asks what the band changed.
```

- [ ] **Step 3: Check the words** with the humanizer skill’s list (§1, §2, §6, §8, §19 first) and fix what it finds.

- [ ] **Step 4: Commit** `Words: taking a take out of its song`.

### After the tasks

One review of the whole branch, fixes with their tests, then the PR (template headings, attribution block, assignee and reviewer `voronizer`); CI runs once. Merge waits for Alex.
