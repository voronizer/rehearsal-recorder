# A link to a take for someone outside the band: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A band member makes a link to one take in the band service; the
person who gets it opens `/l/<id>` without signing in and hears the mix, or
the tracks, or the tracks and the marks, as the link says, and may download
what it allows. Every member sees all links on **Members and links**.

**Architecture:** A D1 table `share_link` and two route groups in a new
Worker module `service/worker/links/`: the members' routes (make, upload a
mix link's MP3, list, close) and the open routes (`/api/l/…`,
`/files/l/…`) that answer only while a link is open. The open page answer
is the take page's answer, built by the same function, cut to what the
link shows. In the pages, a new module `service/src/links/`: the link
button and window on the take page, the band's list on **Members and
links**, and the page `/l/$id`, which reuses the take page's pieces under
its own query client so it never calls a member's route.

**Tech Stack:** Cloudflare Worker (Hono + `@hono/zod-openapi`, Drizzle, D1,
R2), React + TanStack Router/Query, vitest (`service/test/`), Playwright
(`service/e2e/`, `service/pictures/`).

**Spec:** `docs/superpowers/specs/2026-11-15-share-a-take-design.md`. The
mockups' sources, built from the real components, are in
`/mnt/project-files/band-service/share-link/`: `q1-mock/src/listen/Listen.tsx`
(the link page), `q11-mock/ShareLink.tsx`, `q11-mock/AllLinks.tsx` (the
window, the rows, the list). Start from them; they hold switches (`V`, `W`,
`X`, `mk.ts`) and made-up data that do not go into the service. The q1
mockup has no bar at the bottom on a phone; the link page has the band's
`PhoneBar` there (spec, call 17).

## Global Constraints

- Line numbers are main at 411eadd.
- РЭХА does not change: nothing in `src/` or `ui/`. `ui/src` components are
  used as they are.
- While developing, run only the tests a change touches, once each. Never
  two suites at once. The full suites run on CI after the push. Say so in
  every subagent brief.
- Test titles and check labels: cp1252 characters only (no ▶, ⋯, “ ”).
- Build every piece of interface from `ui/src/components/ui/`; `npm run
  design-check` (from the repository root) passes.
- App words, exactly (F7 sentence case, B8 curly quotes in a title):
  - button tooltip and name: `Link for someone outside the band`
  - window title: `Link to “${takeText(take)}”`; its line: `For someone
    outside the band: they open it without signing in.`
  - `New link`; field placeholder and name: `Who it is for (only the band
    sees this)` / `Who it is for`
  - `Shows`: `The mix` · `Mix and tracks` · `And marks`; `Download`:
    `Nothing` · `The mix` · `Mix and tracks`; `Lasts`: `No end` · `A month`
    · `A week` · `A day`
  - hint: `The mix goes as you hear it now: your levels, mute and solo.`
  - the window opens each time at `Shows` `The mix`, `Download` `Nothing`,
    `Lasts` `A month` (Alex, 23:37:08 and 23:38:13), and an empty field
  - buttons: `Close`, `Make link`, `Close link`; icon button `Copy link`,
    ✓ for 1.5 s after a copy
  - a row: its title who it is for; its first line what it shows (`The
    mix` / `Mix and tracks` / `Mix, tracks and marks`) and what can be
    downloaded (`no download` / `download the mix` / `download
    everything`), as `Mix and tracks, download everything`; its second line
    `<who made it>, <day>`, `until <day>` or `no end`, and `not played yet`
    / `played once` / `played N times, last <day>`, joined by ` · `. With
    who it is for empty, the title is what it shows and the first line the
    download alone, capitalised (`No download`). On **Members and links**
    the title starts with the take's name: `Viasna #12 · Mum`, `Pałyn #2 ·
    The mix`.
  - section and page: `Members and links`; group: `Links for people
    outside the band`; empty: `No links yet.`; member's page line: `Who is
    in the band, and the links for people outside it.`
  - link page: `This link no longer works.`; on a mix link, Download's
    line for The mix: `The MP3 the band made for this link.`
  - the line under the choices, which keeps its room: `Mixing… N%`, then
    `Sending the mix…`, or one of: `Every track is muted, so the mix would
    be silent.` and `Could not make the mix. Try again.` (Download's own,
    exported from `Download.tsx` as `MIX_SILENT` and `MIX_FAILED` and used
    by both); `This take is too long for a link with the mix alone: pick
    Mix and tracks.`; `Could not send the mix. Try again.`; for a tracks
    or marks link, `Could not make the link. Try again.`
  - under the rows: `Could not close the link. Try again.`
  - the Worker's 400: `A link that shows only the mix cannot let download
    the tracks.`
- The pieces, from `ui/src/components/ui/` and the service's own
  `shell/parts.tsx`: the window `Dialog` `size="tall"`; the rows `Item` in
  `ItemGroup`; the field `Input` with `maxLength={60}`; **Shows**,
  **Download**, **Lasts** `PickRow`, a greyed choice by its `disabled`
  (`pick-row.tsx:14`); the address `InputGroup` with an
  `InputGroupButton`; the link button `Button` with `Tooltip`; the line
  `Said` (`TakePlayer.tsx:273`), in a box of fixed height as
  `Take.tsx:258`; a list that cannot be read `Trouble`
  (`shell/parts.tsx:514`); the band's list a `Group`; the link page's bar
  `Logo` (`shell/parts.tsx:468`) and the band's name from `useBand()`, laid
  out as the phone header `Shell.tsx:250-253` without `MenuButton`; not
  `BandName`, which reads the members' `/api/frame` (`Side.tsx:17`).
- A link's id: 22 characters from
  `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789` (57), drawn
  with `crypto.getRandomValues`, rejecting bytes ≥ 228 so each character is
  equally likely. Its address: `${location.origin}/l/${id}`.
- `for` is trimmed, at most 60 characters. A mix link's peaks: 1200 numbers,
  0 to 1. A mix MP3: at most 100 MB.
- An end, from the moment the link is made, in UTC: `day` +24 h, `week`
  +7 days, `month` the same day and time next month, or that month's last
  day when it has no such day (31 January → 28 or 29 February); `never`
  null.
- An open link: ready, `until` null or later than now, its take shown
  (`shown_gen` not null) and not in the Trash. Everything else answers 404
  with `{ "error": "This link no longer works." }` on the open routes and
  is left out of the lists.
- Commits end with `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>`, no session link.

## Review Focus

1. A request from the link page to a member's route answers 401, and the
   band's sign-out handler would send an outsider to sign-in; a file
   address the page builds itself (`lanes.ts:25`, `Download.tsx:33`) would
   reach the members' `/files/…`. Expected: the link page asks only
   `/api/l/…`, `/api/band` and `/files/l/…`, never leaves `/l/<id>`, and
   draws the MIDI notes. Pinned in Task 4 on a marks link of a take with a
   song, Backing and MIDI, made with download everything.
2. A crop after the link was made. Expected: a tracks link plays the new
   generation at the saved levels; a mix link keeps its MP3. Pinned in
   Task 2.
3. The window closed while a mix link's MP3 goes up. Expected: the link is
   not listed, its address answers 404, and the daily run deletes it after
   a day. Pinned in Tasks 1 and 2.
4. A link closed while someone is listening. Expected: the next piece of
   any file answers 404 and the page says the link no longer works on its
   next load. Pinned in Task 2.
5. A month from 31 January. Expected: the last day of February. Pinned in
   Task 1.

---

### Task 1: Links in the Worker: the table and the members' routes

**Files:**
- Modify: `service/worker/shared/schema.ts` (after `take`, `:328`)
- Create: `service/migrations/0011_share_link.sql` (by `npx drizzle-kit
  generate --name share_link` in `service/`) and its `meta/` files
- Create: `service/worker/links/store.ts`, `service/worker/links/routes.ts`
- Modify: `service/worker/index.ts` (mount `linkRoutes`; call
  `purgeLinks` in `scheduled` after `purgeTrash`, in its own try with
  `reportFailure(env, "closing ended links", e)`)
- Modify: `service/worker/takes/purge.ts:44-47` (a take's links go before
  its row)
- Test: `service/test/links.test.ts`

**Interfaces:**
- Produces, in `schema.ts`:
  `shareLink = sqliteTable("share_link", { id: text("id").primaryKey(),
  takeUid: text("take_uid").notNull().references(() => take.uid), madeBy:
  text("made_by").notNull().references(() => user.id), madeAt:
  text("made_at").notNull(), forWhom: text("for_whom").notNull().default(""),
  shows: text("shows").$type<Shows>().notNull(), download:
  text("download").$type<Takes>().notNull(), until: text("until"), heard:
  text("heard", { mode: "json" }).$type<Heard>(), mixGen:
  integer("mix_gen"), ready: integer("ready", { mode: "boolean" }).notNull(),
  plays: integer("plays").notNull().default(0), lastPlayedAt:
  text("last_played_at") }`, index `share_link_take_idx` on `take_uid`.
- Produces, in `links/store.ts`:
  - `type Shows = "mix" | "tracks" | "marks"`, `type Takes = "none" | "mix"
    | "all"`, `type Lasts = "never" | "month" | "week" | "day"`,
    `Heard = z.object({ volumes: z.record(z.string(), z.number().min(0).max(1)),
    muted: z.array(z.string()), soloed: z.array(z.string()) })`
  - `newLinkId(): string`
  - `endOf(lasts: Lasts, from: Date): string | null` (ISO)
  - `openLink(db: Database, id: string): Promise<{ link: typeof
    shareLink.$inferSelect; take: typeof take.$inferSelect } | null>`: the
    link and its take when open, else null (`Database` from
    `shared/db.ts`)
  - `deleteLink(env: Bindings, id: string): Promise<void>`: R2
    `links/${id}/` first (`deleteFiles`, `takes/purge.ts:16`), then the row
  - `purgeLinks(env: Bindings): Promise<number>`: deletes links ended
    before now, links not ready made over 24 h ago; answers how many
- Produces, `linkRoutes` in `links/routes.ts`, all `needMember`:
  - `POST /api/takes/{uid}/links`, body `NewLink = { for: string (≤60
    after trim), shows: Shows, download: Takes, lasts: Lasts, heard: Heard
    (needed unless shows is "mix"), peaks: number[] (1200, needed when
    shows is "mix") }` → 200 `LinkItem`; 404 `No such take` for a take not
    shown or in the Trash; 400 for `shows: "mix"` with `download: "all"`
    with the error above. A mix link is made with `ready: false`,
    `mix_gen` = the take's `shownGen`, and its peaks written to R2 as
    `links/${id}/mix.peaks`, JSON `{ "peaks": [...] }`; every other link is
    ready at once.
  - `PUT /api/links/{id}/mix`, body the MP3 (`audio/mpeg`, needs
    `Content-Length`, at most 100 MB, else 411/413), streamed as
    `c.req.raw.body` to R2 `links/${id}/mix.mp3` with `contentType:
    "audio/mpeg"`; only for a mix link not ready yet that the same member
    made (else 404); then `ready: true` → 200 `LinkItem`.
  - `GET /api/links` → `LinkItem[]`, the open links, newest first.
  - `DELETE /api/links/{id}` → 200 `{ ok: true }`, also for a link already
    gone; any member.
  - `LinkItem = { id: string, take: { uid: string, name: string }, by:
    string (shownName, takes/rows.ts), made_at: string, for: string, shows:
    Shows, download: Takes, until: string | null, plays: number,
    last_played_at: string | null }`, registered as `.openapi("LinkItem")`.

- [ ] **Step 1: Write the failing tests** in `test/links.test.ts`, with
  `signInOwner`, `member`, `shownTake` from `test/helpers.ts`:
  - `test("a member makes each kind of link and every member sees them")`:
    tracks, marks, and mix (then `PUT …/mix`); `GET /api/links` as another
    member lists three, newest first, with `by`, `for`, `shows`,
    `download`, `until`, `plays: 0`.
  - `test("a mix link is listed only once its MP3 is up")`: after POST it
    is not in `GET /api/links`; after PUT it is; a second PUT is 404; PUT by
    another member is 404.
  - `test("a mix link cannot let download the tracks")`: 400 with the error.
  - `test("any member closes any link, and closing twice is fine")`: the
    owner's link closed by a member; `links/<id>/` is empty in R2; a second
    DELETE is 200.
  - `test("links of a take in the Trash leave the list and come back")`:
    trash the take (`DELETE /api/takes/{uid}`), list has none; restore
    (`POST /api/trash/{uid}/restore`), back.
  - `test("the end of a link")`: `endOf("day", 2026-11-15T22:00Z)` =
    `2026-11-16T22:00:00.000Z`; `week` = `2026-11-22T22:00:00.000Z`;
    `month` from `2026-01-31T10:00Z` = `2026-02-28T10:00:00.000Z`, from
    `2028-01-31T10:00Z` = `2028-02-29T10:00:00.000Z`; `never` = null.
  - `test("the daily run deletes ended and unfinished links")`: a link
    with `until` in the past and a mix link not ready made 25 h ago (set by
    `database(env).update`) go with their R2 files; an open one stays.
  - `test("a take deleted for good takes its links")`: `trashed_at` set 31
    days back, `purgeTrash(env)`; the link row and its files are gone.
  - `test("link ids are 22 characters from the 57")`: 200 ids, each
    matches `/^[A-HJ-NP-Za-km-z2-9]{22}$/`, all different.
- [ ] **Step 2: Run them to see them fail.** `cd service && npx vitest run
  test/links.test.ts`. Expected: fails on the missing module.
- [ ] **Step 3: Add the table and the migration.** Then `npx drizzle-kit
  generate --name share_link`; check the SQL makes the table and the index
  only.
- [ ] **Step 4: Write `links/store.ts` and `links/routes.ts`, mount them,
  and change `purge.ts` and `scheduled`.** The list joins `take` and
  `user`, filters by the open-link rule (Global Constraints) in SQL.
- [ ] **Step 5: Run the tests.** `npx vitest run test/links.test.ts
  test/trash.test.ts test/migration.test.ts test/openapi.test.ts` (after
  Step 6's `npm run openapi`). Expected: PASS.
- [ ] **Step 6: `npm run openapi` and `npm run typecheck` in `service/`.**
  `openapi.json` gains the four routes.
- [ ] **Step 7: Commit** “Links to takes: the table and the members'
  routes (#106)”.

### Task 2: The open routes for the person with the link

**Files:**
- Create: `service/worker/takes/page.ts` (the take page's answer, moved out
  of `band-routes.ts:121-196`)
- Modify: `service/worker/takes/band-routes.ts:23-63` (export `TakePage`;
  it gains `files_at: z.string()`), `:116-196` (call `takePage`)
- Create: `service/worker/files/serve.ts` (the file answer, moved out of
  `files/routes.ts:46-78`)
- Modify: `service/worker/files/routes.ts` (call `serveFile`)
- Create: `service/worker/links/open-routes.ts`
- Modify: `service/worker/takes/shape.ts` (export `shapeOf(peaks:
  number[][]): number[]`, the loop of `makeShape` `:27-40`, which then
  calls it)
- Modify: `service/worker/index.ts` (mount `openLinkRoutes` before
  `fileRoutes`: `/files/l/{id}/{name}` has the shape of
  `/files/{uid}/{gen}/{name}`)
- Modify: `service/cloudflare/_headers` (a rule for `/l/*`:
  `X-Robots-Tag: noindex`)
- Test: `service/test/links-open.test.ts`

**Interfaces:**
- Consumes: `openLink`, `shareLink`, `Heard` (Task 1).
- Produces:
  - `takePage(env: Bindings, db: Database, t: typeof take.$inferSelect,
    viewer: string, filesAt: string): Promise<z.infer<typeof TakePage>>` in
    `takes/page.ts`; `viewer` is the member's id for `mine` and
    `starred_by_me`, `""` for nobody. `filesAt` is where the take's files
    are, with no slash at the end: `/files/${uid}/${gen}` for a member,
    `/files/l/${id}/${gen}` for a link. The answer's `files_at` is it, and
    every track's `mp3` and `peaks` is `${filesAt}/${name}`.
  - `serveFile(c: Context, key: string, download?: string):
    Promise<Response>` in `files/serve.ts`: Range, ETag, `If-None-Match`
    for `.peaks`, `Cache-Control` as now; `download` is the file's name for
    `Content-Disposition` (the `disposition` helper moves with it).
  - `openLinkRoutes`, no `needMember`:
    - `GET /api/l/{id}` → `LinkPage = TakePage.extend({ link: z.object({
      id: z.string(), shows: Shows, download: Takes, heard: Heard.nullable(),
      mix: z.boolean() }), labels: z.array(LabelView) })` (`LabelView`,
      `worker/labels/routes.ts:19`), registered as
      `.openapi("LinkPage")`. From `takePage(…, "",
      \`/files/l/${id}/${gen}\`)`, then: `stars: []`,
      `starred_by_me: false`, `starred_at_rehearsal: false`, `trashed_at:
      null`, `moved: false`; each member's `member_id` in marks and
      comments becomes a stand-in, `m1`, `m2`… in the order they first
      appear, the same member always the same one, so `MarkItem.tsx:272`
      shows their name and initial (a mark from РЭХА keeps `""`); `mine:
      false`; `marks: []` and `labels: []` unless shows is
      `"marks"` (then the band's labels); `files: []` unless download is
      `"all"`. A mix link: `tracks: [{ position: 1, name: "The mix", icon:
      null, mp3: \`/files/l/${id}/mix.mp3\`, peaks:
      \`/files/l/${id}/mix.peaks\`, kind: null }]`, `files_at:
      \`/files/l/${id}\``, `notes: []`, `balance:
      {}`, `gain: 1`, `drift: null`, `shape: shapeOf([its peaks])`,
      `heard: null`, `mix: true`.
    - `GET /files/l/{id}/{gen}/{name}`: a tracks or marks link only; `gen`
      the take's `shownGen`; `name` one of `<n>.mp3`, `<n>.peaks`, `<n>.mid`,
      and `<n>.flac` or `?download=1` only when download is `"all"`; R2
      `takes/${uid}/${gen}/${name}`.
    - `GET /files/l/{id}/{name}`: a mix link only; `mix.mp3` or
      `mix.peaks`; `?download=1` on `mix.mp3` only when download is not
      `"none"`, named `${take.name}.mp3`.
    - `POST /api/l/{id}/played` → 200 `{ ok: true }`: `plays + 1`,
      `last_played_at` now.
    - Every other case: 404 with `This link no longer works.`

- [ ] **Step 1: Write the failing tests** in `test/links-open.test.ts`
  (MP3, peaks, FLAC and MID put in R2 by hand, as `test/files.test.ts:13`
  does):
  - `test("a tracks link opens without signing in and shows no member")`:
    `GET /api/l/{id}` with no cookie is 200; tracks' `mp3` start with
    `/files/l/`; `files_at` is `/files/l/<id>/<gen>`; `stars` empty;
    `marks` empty; `files` empty; `link.heard` as made; the answer's JSON
    has no member's id and no `@`.
  - `test("a marks link has the marks and their labels")`: a mark the
    owner set and a comment a member wrote on it carry `m1` and `m2`; a
    second mark by the owner carries `m1` again; `author` is each one's
    name; `labels` is the band's.
  - `test("a mix link is one track, the mix")`: `tracks` length 1, `gain`
    1, `shape` 120 values.
  - `test("each link reaches only what it allows")`: tracks link: MP3,
    peaks, MID 200 (Range 206); FLAC 404; `?download=1` 404; a file of
    another take 404; an older `gen` 404. Download-all link: FLAC 200,
    `?download=1` 200 with `Content-Disposition`. Mix link: track files 404,
    `mix.mp3` 200, `mix.mp3?download=1` 404 when download is `none`, 200
    named `<take name>.mp3` when `mix`.
  - `test("a closed, ended, unknown, unfinished or trashed link no longer
    works")`: each answers 404 with the words, on the page, a file and
    `played`; a file asked after `DELETE /api/links/{id}` is 404.
  - `test("after a crop a tracks link plays the new generation and a mix
    link keeps its mix")`: make both, show generation 2 (as
    `test/reha.test.ts:163-177` crops), `GET /api/l/{tracks}` paths carry `/2/`;
    the mix link's `mix.mp3` is still 200.
  - `test("a play counts")`: two `played` → `GET /api/links` says `plays:
    2` and `last_played_at`.
  - `test("the take page answers as before")`: `GET /api/takes/{uid}` for a
    member is unchanged (stars, `mine`, files) after the move to
    `takes/page.ts`, and its `files_at` is `/files/<uid>/<gen>`.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run
  test/links-open.test.ts`.
- [ ] **Step 3: Move the take page's answer to `takes/page.ts` and the file
  answer to `files/serve.ts`;** run `npx vitest run test/files.test.ts
  test/reha.test.ts test/marks.test.ts` to see nothing moved.
- [ ] **Step 4: Write `links/open-routes.ts`, mount it before
  `fileRoutes`, export `shapeOf`, add the `_headers` rule.**
- [ ] **Step 5: Run** `npx vitest run test/links-open.test.ts
  test/links.test.ts test/files.test.ts test/openapi.test.ts`. Expected:
  PASS.
- [ ] **Step 6: `npm run openapi` and `npm run typecheck`.**
- [ ] **Step 7: Commit** “Links to takes: what the person with the link
  can reach (#106)”.

### Task 3: The link button, the window and Members and links

**Files:**
- Modify: `service/src/api.ts` (types and hooks below)
- Create: `service/src/links/LinkWindow.tsx` (from
  `q11-mock/ShareLink.tsx`: `LinkButton`, the window, `LinkRow`)
- Create: `service/src/links/BandLinks.tsx` (from `q11-mock/AllLinks.tsx`:
  the group only)
- Modify: `service/src/takes/player/mix.ts:129` (`makeMix` gets `onMixed?:
  (mix: Float32Array[]) => void`, called after `turnDown(mix)`)
- Modify: `service/src/takes/Download.tsx:163` (export `MIX_FAILED` and
  `MIX_SILENT` with its two lines, and use them)
- Modify: `service/src/takes/Take.tsx:293-295` (`<LinkButton>` just before
  `<Download>`, when `!take.trashed_at`)
- Modify: `service/src/shell/sections.ts:12`, `service/src/members/Members.tsx`
  (`:272`, `:289`, `:309`, and `<BandLinks />` after `<People>` on both
  pages, the member's page wrapped in `<Groups>`)
- Modify: `service/e2e/frame.spec.ts:17`, `service/e2e/members.spec.ts:10-11,
  79`, `service/e2e/pointer.spec.ts:27` (the new name)
- Test: `service/e2e/links.spec.ts`, `service/src/takes/player/mix.test.ts`

**Interfaces:**
- Consumes: the routes of Task 1.
- Produces, in `api.ts`:
  - `type LinkItem = InferResponseType<typeof client.api.links.$get,
    200>[number]`
  - `useLinks()` (query key `["links"]`), `useMakeLink(uid: string)`
    (mutation of `NewLink`, then reads `["links"]` again), `useCloseLink()`,
    `putMix(id: string, mp3: Blob, signal: AbortSignal): Promise<LinkItem>`
    (a plain `fetch` PUT with `Content-Type: audio/mpeg`, through `data()`)
  - `linkAddress(id: string): string` = `${location.origin}/l/${id}`
- Produces, in `links/LinkWindow.tsx`: `LinkButton({ take, sound, phone }:
  { take: TakePage; sound: ServiceSound; phone: boolean })`, and
  `LinkRow({ link, withTake, fresh }: { link: LinkItem; withTake?: boolean;
  fresh?: boolean })` with **Copy link** and **Close link** inside.
- Produces, in `links/BandLinks.tsx`: `BandLinks()`.

- [ ] **Step 1: Write the failing tests.**
  - `mix.test.ts`: `test("makeMix hands over the mixed sound before it
    encodes")`: with the fake `ways` the file's other tests use, `onMixed`
    is called once with the summed, turned-down channels.
  - `e2e/links.spec.ts`:
    - `test("a member makes a tracks link and sees it at the top")`: open
      Viasna 12 as alex, press the button named `Link for someone outside
      the band`, type `Mum` in `Who it is for`, pick `Mix and tracks`,
      `No end`, press `Make link`; the first row says `Mum`, `Mix and
      tracks, no download`, `no end`, `not played yet`; the field `The
      link` holds `/l/` + 22 characters; the field `Who it is for` is
      empty; the choices stay. Before it, alex turned Guitar down and
      pressed M on Bass: `GET /api/l/<id>` has them in `link.heard`.
    - `test("the window opens at The mix, Nothing and A month each time")`:
      pick `And marks`, `Mix and tracks`, `A day`, type a name, press
      `Close`, open again: `The mix`, `Nothing`, `A month`, an empty field.
    - `test("a mix link is made with its mix")`: the choices as the window
      opens, `Download` `The mix`; while it is made the line says
      `Mixing…` and `Make link` is disabled at the same width; then the row
      appears titled `The mix`, first line `Download the mix`, `until` the
      day a month on; `GET /api/links` has it ready.
    - `test("a mix of muted tracks makes no link")`: M on every track,
      `Make link`: the line says `Every track is muted, so the mix would be
      silent.`; no request to `/api/takes/*/links`.
    - `test("a link the service cannot close stays and says so")`: with
      `DELETE /api/links/*` answering 500 (`page.route`), `Close link`
      leaves the row and the line says `Could not close the link. Try
      again.`
    - `test("the address shows to copy by hand when the clipboard
      refuses")`: `navigator.clipboard.writeText` made to reject
      (`page.addInitScript`); `Copy link` on an older row shows its address
      in a field, selected.
    - `test("Mix and tracks is greyed out while the link shows the mix")`:
      with `Shows` on `The mix`, `Download`'s `Mix and tracks` is disabled;
      picked first, then `Shows` set to `The mix`, `Download` is on `The mix`.
    - `test("Members and links lists every link and any member closes
      one")`: as ira, the section `Members and links` lists alex's link
      with the take's name; `Close link` takes it away; alex's window no
      longer has it.
    - `test("closing the window while the mix is made makes no link")`.
  - Change the three specs to `Members and links`.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run
  src/takes/player/mix.test.ts`; `npx playwright test e2e/links.spec.ts`
  (Playwright starts `npm run e2e:serve` itself, `playwright.config.ts:31`).
- [ ] **Step 3: Write the hooks, `onMixed`, `LinkWindow.tsx`,
  `BandLinks.tsx`; wire the button, the section's name, the page.** The
  window: `Dialog` `size="tall"`, rows from `useLinks()` filtered to the
  take; **Make link** for a mix link runs `makeMix(take, heard, { signal,
  progress, onMixed })` with `heard` from `sound.state()` as
  `Download.tsx:124-125` does, `peaksOf([mix], 1200)` from `onMixed`, then
  `useMakeLink` and `putMix`. The line under the choices says `Mixing…
  N%` from `progress`, then `Sending the mix…`; **Make link** keeps its
  width and is disabled while either runs. No track heard: `MIX_SILENT`
  and no request. An MP3 over 100 MB: the too-long line and no request.
  A failed mix, `MIX_FAILED`; a failed POST or PUT, `Could not send the
  mix. Try again.`, and a link the POST made is closed. A tracks or marks
  link whose POST fails: `Could not make the link. Try again.` Closing the window
  aborts and, when the link was already made, closes it. For any other
  link the body is `{ for, shows, download, lasts, heard }`. The new
  link's row is `fresh`: the address field with **Copy link**. Nothing
  copies by itself. **Close link** that fails keeps the row and says so
  under the rows; a refused copy shows the row's address in a field,
  selected; a list that cannot be read is `Trouble` with **Try again**, in
  the window and on **Members and links**.
- [ ] **Step 4: Run the tests of Step 2 and `npx playwright test
  e2e/frame.spec.ts e2e/members.spec.ts e2e/pointer.spec.ts
  e2e/takes.spec.ts`** (`takes.spec.ts` holds Download's tests, which
  `makeMix` and the two constants touch). Expected: PASS.
- [ ] **Step 5: `npm run typecheck` in `service/`, `npm run design-check`
  at the root.**
- [ ] **Step 6: Commit** “Links to takes: the button, the window and Members
  and links (#106)”.

### Task 4: The page a link opens

**Files:**
- Create: `service/src/links/LinkPage.tsx` (from `q1-mock/src/listen/Listen.tsx`)
- Modify: `service/src/routes.tsx` (route `/l/$id` under `root`, beside
  `signIn`; the `whenSignedOut` handler, `:106`, returns at once when
  `pathname` starts with `/l/`)
- Modify: `service/src/api.ts` (`LinkPage` type, `useLinkPage(id)`,
  `played(id)`, `seedLink(page)`)
- Modify: `service/src/takes/Take.tsx` (export `useNotes`, `useReha`,
  `useTakePlayer`, `useSpeed`, `useRehaLabels`, the row `TakePlayer`)
- Modify: `service/src/takes/player/lanes.ts:25`, `service/src/takes/Download.tsx:33`
  (the addresses from `take.files_at`)
- Modify: `service/src/takes/player/sound.ts:52`, `:360`
  (`serviceSound(take, one, { keeps = true, desk }: { keeps?: boolean;
  desk?: Desk } = {})`, `useServiceSound(take, opts)` the same)
- Modify: `service/src/shell/PlayerBar.tsx:166` (`PhoneBar({ outside })`)
- Modify: `service/src/marks/MarkItem.tsx:164-175`, `:324-380` (`readOnly`)
- Modify: `service/src/takes/Download.tsx:60`, `:100-185` (`link`)
- Test: `service/e2e/link-page.spec.ts`, `service/src/takes/player/sound.test.ts`

**Interfaces:**
- Consumes: `GET /api/l/{id}` (`LinkPage`, with `files_at` and the
  stand-in member ids), `POST /api/l/{id}/played`, the files (Task 2);
  `MIX_FAILED`, `MIX_SILENT` (Task 3); from Task 3 only `linkAddress`, in
  the tests.
- Produces:
  - `LinkPage()` route component; `type LinkPage =
    InferResponseType<(typeof client.api.l)[":id"]["$get"], 200>`
  - `seedLink(page: LinkPage): void` in `api.ts`
  - `serviceSound(take, one, { keeps, desk })`: with `keeps` false,
    `keepLevels`, `keepBackingHeard` and `backToReha` change only the page
    and send nothing; `keepMaster` stays, as Master is the device's
    (`master.ts:2-7`). `desk` replaces `firstDesk(take)` as the start.
  - `PhoneBar({ outside = false }: { outside?: boolean })`: with
    `outside`, the take's name as plain text in place of `TakeLink`, and no
    `MarkHere`.
  - `MarkItem({ …, readOnly })`: no ⋯ on a comment, no **Done** or ⋯ on
    the mark, no comment box.
  - `Download({ take, sound, phone, link })`, `link?: { mix: string | null;
    tracks: boolean }`: `mix` set, **The mix** saves that file with
    `?download=1` and its line says `The MP3 the band made for this link.`;
    `tracks` false, no **Tracks in MP3** or **Tracks in FLAC**.

The page uses the app's own `queryClient` (`main.tsx`), as every page
does; on `/l/<id>` nothing else runs in it. Once `useLinkPage(id)` has the
answer, and before the player renders, `seedLink(page)` sets:
`["take", page.uid]` the page; `["levels"]` `{ levels:
page.link.heard?.volumes ?? {} }`; `["labels"]` `page.labels`;
`["people"]` `[]`; `["backing"]` `{ heard: { [song id]: Backing not in
heard.muted } }` when the take has a song and a Backing track, else `{
heard: {} }`; and `queryClient.setQueryDefaults(key, { staleTime: Infinity
})` for each of the five, so no hook asks for them again, and `whenHeard`
(`backing.ts:51`), `useBackingSong` and `yoursNow` (`sound.ts:44`) read
the maker's choices. The sound is `useServiceSound(take, { keeps: false,
desk })`, `desk` M on each track in `heard.muted` and S on each in
`heard.soloed`, Backing included; a mix link has `heard` null and starts
from no M and no S. The bar at the top is `Logo` and the name from
`useBand()` (Global Constraints). The body follows the q1 mockup's `View`,
`Full` and `Phone`, with `take.link.shows` in place of its switch;
**Download** with `link` sits in the title row where the take page has it
(`Take.tsx:293-295`); on a phone `<PhoneBar outside />` is at the bottom.
A browser that cannot play gets `CANNOT_PLAY` (`one.tsx:432`) in place of
the player, as `Take.tsx:333`. The first time the one player plays this
take after the page opened, it calls `played(id)` once. `document.title`
is `${takeText(page)} · ${band name}`. A 404 from `useLinkPage` shows the
bar and `This link no longer works.`; any other failure `Trouble` with
**Try again**.

- [ ] **Step 1: Write the failing tests.**
  - `sound.test.ts`: `test("a sound that does not keep never calls the
    band's levels")`: `serviceSound(take, one, { keeps: false
    }).keepLevels({ Bass: 0.5 })` makes no request (fetch spied) and the
    level is heard; `test("a sound starts at the desk it is given")`.
  - `e2e/link-page.spec.ts`, each with a link made through the API as alex
    and opened in a new browser context with no state:
    - `test("a marks link of a take with a song, Backing and MIDI asks
      nothing of the band's routes")`: Viasna 11; ira sets a mark with a
      comment through the API first; the link shows marks, lets download
      everything, and its `heard` has Backing heard (not in `muted`). Every request the
      page makes is to `/l/`, `/api/l/`, `/api/band`, `/files/l/`,
      `/files/band/picture` or the page's own assets; no `/signin` in the
      URL ever; the Keys lane draws its notes, not `Notes file not
      readable`; Backing is not muted; the mark shows `Ira`; no `Your
      comment` box, no `Done`.
    - `test("a mix link plays the mix")`: the take's name, one wave, no
      faders, no `Download` button (link made with `none`).
    - `test("a tracks link starts at the maker's levels and keeps
      nothing")`: Viasna 12; the link's `heard` has Guitar at 0.3 and Bass in
      `muted`; the outsider's Guitar fader reads 30%, Bass muted; moving a fader
      makes no request; no star, no Mark.
    - `test("Download follows the link")`: `mix` link: only `The mix`,
      which saves `<take name>.mp3`; `all` link: `Tracks in FLAC` saves a
      track whose bytes are the file the seed put in R2.
    - `test("the first play counts once")`: press play twice; `GET
      /api/links` as alex says `plays: 1`.
    - `test("a closed link says it no longer works")`: close it, reload:
      the words, no player.
    - `test("a link page that cannot load says so")`: `GET /api/l/*`
      answering 500 (`page.route`): `Try again`, which loads it once the
      route lets it through.
    - On a phone (`devices["iPhone 13"]`): `test("a tracks link on a phone
      has the tracks and the bar with the speed")`: the faders, the bar at
      the bottom with the speed, the take's name not a link, no `Mark`, no
      star.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run
  src/takes/player/sound.test.ts`; `npx playwright test
  e2e/link-page.spec.ts`.
- [ ] **Step 3: Write `LinkPage.tsx`, `seedLink`, the route, the
  addresses from `files_at`, `keeps` and `desk`, `PhoneBar`'s `outside`,
  `readOnly`, Download's `link`.**
- [ ] **Step 4: Run** `npx vitest run src/takes/player/sound.test.ts`,
  `npx playwright test e2e/link-page.spec.ts e2e/takes.spec.ts
  e2e/marks.spec.ts e2e/backing.spec.ts` (`backing.spec.ts` for the
  Backing path the seeding reads). Expected: PASS.
- [ ] **Step 5: `npm run typecheck`, `npm run design-check`.**
- [ ] **Step 6: Commit** “Links to takes: the page a link opens (#106)”.

### Task 5: Words and pictures

**Files:**
- Modify: `site/content/band-service.md:70` (the spec's sentence as a
  paragraph after the one about MIDI, before the picture at `:72`)
- Modify: `service/README.md:5, 86, 107, 110`, `docs/using-it.md:868, 892`
  (`Members` → `Members and links`)
- Modify: `CHANGELOG.md` (the spec's item, first under “Unreleased”)
- Modify: `docs/design-system.md:280-283` (C3: the link window's case)
- Modify: `site/src/stories/band-service/downloads-{light,dark}.webp`,
  `sets-{light,dark}.webp` (by `npm run pictures` in `service/`)

- [ ] **Step 1: Write the words** exactly as the spec's “Words elsewhere”
  gives them, C3's sentence included.
- [ ] **Step 2: Retake two pictures:** `npm run pictures -- -g
  "(downloads|sets) (light|dark)"` in `service/`. Both say **Members and links** in
  the menu; `downloads` has the chain button beside **Download**. `git
  status` shows only those four files; the other pictures stay (spec,
  call 25).
- [ ] **Step 3: Build the site and run its band service page test:** `cd
  site && npm run build && npx playwright test e2e/band-service.spec.ts`.
- [ ] **Step 4: Commit** “Links to takes: words and pictures (#106)”.

### Task 6: The branch before the pull request

- [ ] **Step 1: Review the whole branch** against the spec (a fresh
  reviewer), and fix every finding, minors too.
- [ ] **Step 2: Security review** by a fresh agent: the open routes, what
  each answers, which files they reach, the id's randomness, the upload's
  size and owner, the `/l/*` headers. Fix what it finds.
- [ ] **Step 3: Push** `claude/project-thread-iuq8zi` and start the checks
  (`service.yml`, `site.yml`, and `reha.yml`, which runs on
  `service/openapi.json`, `reha.yml:53`) by hand; read failed jobs' logs.
- [ ] **Step 4: Show Alex** the new site paragraph and the two retaken
  pictures, then open the pull request with the repository's template,
  ending “🤖 Generated with [Claude Code](https://claude.com/claude-code)”.
  Merge only on his word.
