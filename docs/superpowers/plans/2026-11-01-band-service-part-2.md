# Band service part 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the band service the frame, sections, panels, marks with comments, and songs with status, key, tempo, notes and files that Alex picked on 1 November, drawn the way РЭХА draws its History.

**Architecture:** One migration (`0001`) reshapes the data: the band, labels, statuses, songs' new fields, song files, and the comment table split into marks (no parent) and comments (a parent). The Worker gets a module per feature (`band/`, `songs/`, `labels/`, `marks/`, `home/`, `rehearsals/`), each with its own routes and tests. The pages are rebuilt in `service/src` on the prototype's structure (`service/mock/`), with one player for the whole frame; the prototype leaves the branch before the PR.

**Tech Stack:** Cloudflare Worker, Hono + @hono/zod-openapi, Drizzle on D1, R2, Queues; React, TanStack Router and Query, РЭХА's components from `ui/src`; vitest (Workers pool), Playwright; Python for РЭХА's side.

**Spec:** `docs/superpowers/specs/2026-11-01-band-service-part-2-design.md`

Alex waived the plan's «ок» on 1 November at 19:45:39Z («делай все. потом просто покажи что получилось»): this plan is the record and the ledger; it runs inline to the end.

## Global Constraints

- English, British spelling, РЭХА's words: take, rehearsal, song, mark, label. Curly quotes in titles and messages (“Zorka”); apostrophes straight.
- Text 14 px, page titles 20 px, group headings 14 px semibold; bold only for headings and the band's name.
- Below 500 px the phone layout; 1100 px and wider two columns where the prototype has them.
- Files up to 50 MB each; the band's picture up to 5 MB, PNG, JPEG or WebP.
- The band starts with labels Note grey, Keep this green, Went wrong red, Do again amber, and statuses Learning, Ready, Archive.
- Label colours are РЭХА's eight: grey, red, amber, green, teal, blue (drawn orange), violet, pink; any other colour from РЭХА is grey.
- Test labels and titles: cp1252 characters only.
- While building, run only the tests a change touches, once each; the full suites run once on CI.
- Never send Alex's address anywhere; example.com addresses only in seeds and tests.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; no session trailer.

## Review Focus

1. A label renamed twice, then a mark from РЭХА under its first name: the mark gets the renamed label, and no new label is made.
2. Deleting the last label or the last status is refused; deleting one in use without saying where its marks or songs go is refused.
3. A member who is not the writer tries to edit or delete a mark or comment by calling the route: 403, nothing changes. A mark from РЭХА cannot be edited or deleted by anyone.
4. A file over 50 MB, or a picture that is not PNG, JPEG or WebP, is refused before anything reaches R2.
5. Part 1's comments on a take that is in the trash, or whose member was removed, move over like the rest.

Each has its test in the task that owns the code (Tasks 1, 2 and 3).

---

### Task 1: The data and what РЭХА sends

**Files:**
- Modify: `service/worker/shared/schema.ts` (band, label, status, song fields, song_file, comment fields)
- Create: `service/migrations/0001_part_2.sql` (+ `meta/0001_snapshot.json`, `_journal.json`) from `npm run migrations`, then the data moves added by hand between the new columns and the drops
- Modify: `service/worker/takes/meta.ts` (`tempo`), `service/worker/takes/store.ts` (labels from РЭХА, tempo, a song gets the first status)
- Create: `service/worker/labels/match.ts`
- Modify: `src/rehearsal_recorder/sending/service_files.py` (`meta(..., tempo=None)`), `src/rehearsal_recorder/sending/band_service.py` (passes the song's tempo)
- Test: `service/test/migration.test.ts`, `service/test/reha.test.ts`, `tests/test_sending.py`

**Interfaces:**
- Produces: tables `band(id=1, name, picture_at)`, `label(id, name, colour, position, was json string[])`, `status(id, name, position)`, `song(+status_id, key, tempo, notes, created_at)`, `song_file(id, song_id, name, kind, type, size, key, member_id, created_at)`, `comment(+label_id, updated_at; −label, −colour)`.
- Produces: `labelFor(db, name: string, colour: string): Promise<number>` in `labels/match.ts`; `COLOURS: readonly string[]`; `firstStatus(db): Promise<number>`.
- Produces: `TakeMeta.tempo?: number | null`.

- [ ] **Step 1: Write the failing tests**
  - `migration.test.ts` › "part 1's comments become marks": apply 0000 alone, insert a take with a РЭХА mark (“Keep this”, green), a РЭХА mark (“Solo”, teal), a member's comment with a reply, one closed, and a take in the trash with a comment; apply 0001. Expect labels Note, Keep this, Went wrong, Do again, Solo (teal, position 4); the РЭХА marks keep their label; the member's comment is a mark with label Note and its text as note; the reply's parent is that mark; `closed` where it was; songs have the first status and `created_at`.
  - `reha.test.ts` › "a mark from РЭХА gets the band's label by name", "…by a name it had before a rename", "…adds a new label with РЭХА's colour", "an unknown colour is grey", "tempo sets the song's tempo; a take without it leaves it".
  - `test_sending.py`: “its details carry the song's tempo”, `meta["tempo"] == 120` after `set_song_tempo`, and `None` for a song with none.
- [ ] **Step 2: Run them; they fail** — `cd service && npx vitest run test/migration.test.ts test/reha.test.ts`; `python tests/test_sending.py`.
- [ ] **Step 3: Schema, migration, `labelFor`, store and РЭХА changes.** `status_id` stays nullable in SQL (an ADD COLUMN cannot be NOT NULL without a constant default); every write sets it, and a song read with none counts as the first status.
- [ ] **Step 4: Run them; they pass.** Run `npm run openapi` so РЭХА's fake service knows `tempo`.
- [ ] **Step 5: Commit** “Reshape the band service's data for part 2”.

### Task 2: The Worker's routes

**Files:**
- Create: `service/worker/band/routes.ts` (GET `/api/band` public part and member part, PUT `/api/band`, PUT/DELETE `/api/band/picture`, GET `/files/band/picture`)
- Create: `service/worker/labels/routes.ts`, `service/worker/songs/routes.ts` (songs table, a song, new, change, delete, statuses), `service/worker/songs/files.ts` (a song's files), `service/worker/marks/routes.ts` (marks and their comments), `service/worker/marks/view.ts`, `service/worker/home/routes.ts`, `service/worker/rehearsals/routes.ts`
- Modify: `service/worker/takes/rows.ts` (TakeRow carries `number`, `rehearsal_uid` and its marks), `service/worker/takes/band-routes.ts` (the take page with marks; the feed and the not-named song page go), `service/worker/members/routes.ts` (GET `/api/people` for everyone), `service/worker/chat/*` (marks and comments), `service/worker/index.ts`
- Delete: `service/worker/comments/`
- Test: `service/test/songs.test.ts`, `service/test/labels.test.ts`, `service/test/marks.test.ts`, `service/test/home.test.ts`, `service/test/band.test.ts`, `service/test/chat.test.ts`, `service/test/members.test.ts`

**Interfaces:**
- Produces (JSON): `TakeRow {uid, name, number, song_id, rehearsal_uid, date, duration_sec, marks: {id, at, label_id, note, closed}[], stars, starred_at_rehearsal, is_new}`; `Mark {id, take: {uid, name, number, song_id, song_title, date}, at, label_id, note, author, member_id, from_reha, closed, created_at, updated_at, is_new, comments: Comment[]}`; `Comment {id, author, member_id, text, created_at, updated_at}`.
- Routes: `/api/band`, `/api/people`, `/api/home`, `/api/rehearsals`, `/api/rehearsals/{uid}`, `/api/songs` (GET, POST), `/api/songs/{id}` (GET, PATCH, DELETE), `/api/songs/{id}/files` (POST raw body with `x-file-name`), `/api/songs/{id}/files/{file}` (DELETE), `/files/songs/{id}/{file}`, `/api/statuses` (POST), `/api/statuses/{id}` (PATCH, DELETE `{to}`), `/api/statuses/order` (PUT `{ids}`), `/api/labels` (GET, POST), `/api/labels/{id}` (PATCH, DELETE `{to}`), `/api/labels/order` (PUT), `/api/marks?show=open|closed|all`, `/api/takes/{uid}/marks` (POST), `/api/marks/{id}` (PATCH `{label_id?, note?, closed?}`, DELETE), `/api/marks/{id}/comments` (POST), `/api/comments/{id}` (PATCH `{text}`, DELETE). Members, keys, stars, seen and trash keep part 1's.
- Words the pages show: “There is already a song called “Zorka”.”, “A song with takes cannot be deleted”, “Only who wrote it can change it”, “A mark from РЭХА follows РЭХА”, “A file is up to 50 MB”, “A picture is PNG, JPEG or WebP, up to 5 MB”.

- [ ] **Step 1: Write the failing tests** (one file per module): songs table grouped data, new song refused by case, first status; PATCH status/key/notes, key only one of the 24 or null; delete with and without takes; statuses rename/order/delete-with-move, last refused; files: upload GP/PDF/picture/other, kind and disposition (`attachment` for GP and other, `inline` for PDF and pictures), 50 MB refused, delete; labels same pattern with marks moved; marks add at the playhead with label, edit and delete by the writer only (403 for another member, Alex included), РЭХА's not at all, close and open by anyone, comments add/edit/delete; a mark set or commented on after you heard its take is new until you open it again; Home: unheard count, new marks, songs most recently played first with the first unheard take, five latest marks closed included, favourites with two members' stars, the owner's four steps; rehearsals by date with their takes; band name and picture (owner only, type and size checked); people for every member; chat: a member's marks on a take in one message, comments per person and mark.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: The routes**, each module mounted in `index.ts`; `needOwner` for the band, members and keys; writer checks in `marks/routes.ts`.
- [ ] **Step 4: Run the worker tests that changed; they pass.** `npm run openapi`, `npm run typecheck`.
- [ ] **Step 5: Commit** “Add the band service's part 2 routes”.

### Task 3: The pages

**Files:**
- Create: `service/src/shell/{Shell,Side,PlayerBar,panel,parts,EditList}.tsx`, `service/src/shell/size.ts` (phone, narrow, wide)
- Create: `service/src/takes/{TakeLine,TakePanel,Wave,Lanes}.tsx`, `service/src/takes/player/one.tsx` (the frame's one player around `player.ts`)
- Create: `service/src/home/{Home,FirstDay}.tsx`, `service/src/rehearsals/{Rehearsals,Rehearsal}.tsx`, `service/src/songs/{Songs,SongPanel,parts,StatusesPanel,NewSongPanel}.tsx`, `service/src/marks/{Marks,MarkItem,TakeMarks,LabelsPanel,labels}.tsx`
- Modify: `service/src/api.ts`, `service/src/routes.tsx`, `service/src/main.tsx`, `service/src/service.css`, `service/src/songs/Song.tsx`, `service/src/takes/Take.tsx`, `service/src/takes/Downloads.tsx`, `service/src/members/Members.tsx`, `service/src/trash/Trash.tsx`, `service/src/signin/{SignIn,Name,Frame}.tsx`
- Delete: `service/src/feed/`, `service/src/takes/Comments.tsx`, `service/src/takes/colours.ts`, `service/src/takes/player/usePlayer.ts`, `service/src/shell/useWide.ts`
- Test: `service/e2e/*.spec.ts`, `service/e2e/seed.ts`

**Interfaces:**
- Consumes: Task 2's routes and shapes.
- Produces: `usePlayer(): {uid, time, playing, look, play(uid, at?), seek(uid, at), mute(i), solo(i), heard(i)}`; `usePanel(): {panel, open(p), close()}` with `Panel = {kind: "take", uid, markAt?} | {kind: "song", id} | {kind: "labels"} | {kind: "statuses"} | {kind: "new-song"} | null`.

- [ ] **Step 1: Write the failing browser tests**: the frame's sections and the bar; a take in the panel (✕, Esc, another section closes it); ▶ in a list plays in the bar and makes the take heard; **Mark** in the bar opens the panel with a new mark at that moment; a mark with a comment, closed and opened; the Marks switch with counts; **Labels** rename; a song's status, key, notes and a file; **New song** refused for a title in another case; Members as a member (names only) and as Alex (the band's name); the phone's ☰.
- [ ] **Step 2: Run them; they fail.** `npx playwright test -c playwright.local.config.ts` (the container's Chromium).
- [ ] **Step 3: The pages**, ported from `service/mock/` onto the API; ▶ and a press on a wave put a take in the player; opening a panel does not.
- [ ] **Step 4: Run the changed specs; they pass.** `npm run typecheck`, `npm run build`.
- [ ] **Step 5: Commit** “Rebuild the band service's pages as a home for the band”.

### Task 4: The site, the guide and the release note

**Files:**
- Modify: `service/pictures/seed.ts`, `service/pictures/site.spec.ts`, `site/content/band-service.md`, `site/src/stories/band-service/*.webp`, `sizes.json`, `site/e2e/band-service.spec.ts` if it counts chapters
- Modify: `docs/using-it.md` (“marks” for “comments”), `CHANGELOG.md` (Unreleased, bold first words), `service/README.md` if a step names a page that moved
- Delete: `service/mock/` (a copy stays in /mnt/project-files/band-service/look/mock/)

- [ ] **Step 1:** `npm run pictures` with the new screens; the chapter “Point at the second” shows a mark at 1:42 with the band's talk under it; a new chapter on what a mark's colour tells the band.
- [ ] **Step 2:** The site's own test for the page passes; look at every picture.
- [ ] **Step 3:** Guide and CHANGELOG; humanizer pass over the new text.
- [ ] **Step 4: Commit** “Show part 2 on reha.stream”, then the final review, then the PR.
