# Clear Ways Between Pages: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the band service a take's whole row opens its page and the take's panel goes; a take's page and a song's page lead to a song or a rehearsal by a pill with its section's icon, and a rehearsal's page by a grey song line; every list keeps one rule (no lines, 24 px between rows, one height); **Statuses** and **Labels** are edited in the panel from the right and **New song** is a dialog with the status. In the service and in РЭХА the pointer is a hand over whatever presses. In РЭХА a press on a take's wave opens the take and rows stand 24 px apart.

**Architecture:** Service changes in `service/src` (React, TanStack Router) and one in `service/worker/songs/routes.ts` (an optional `status_id` on **New song**); shared styles in `ui/src/index.css` and two shadcn components; РЭХА changes in `ui/src/components` and two screens. No change in Python.

**Tech Stack:** React 19, TanStack Router, Tailwind 4, lucide-react, Hono with zod-openapi; Playwright (`service/e2e` against a local Worker, `ui/e2e` against the fake bridge), Vitest for the Worker.

**Spec:** `docs/superpowers/specs/2026-11-10-service-navigation-design.md`

## Global Constraints

- 24 px between rows in every list the spec names, measured with `getBoundingClientRect`: a take row from its wave's bottom to the next name's top, any other row from its content's bottom to the next row's content top.
- Pill: `inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-sm font-normal hover:bg-accent`, icon `size-3.5 text-muted-foreground`; icons `Music` (song) and `CalendarDays` (rehearsal), taken from the column's list in `shell/Side.tsx`.
- Song line: `-mx-3 flex items-center gap-2.5 rounded-lg bg-panel px-3 py-2.5 hover:bg-accent`, `Music` `size-4 text-muted-foreground`, title `text-base font-semibold`, the rest `text-sm text-muted-foreground`, `ChevronRight` at the right (the mockup's variant A, q5-mock).
- `OPENS` stays only on the five words the spec lists.
- The hand: computed `cursor` is `pointer` over every link, button that is not disabled, menu item, radio, tab, switch and row that opens; `grab` on drag handles, `crosshair` on a player's wave, `ew-resize` on a loop's ends, the text cursor in fields, the arrow on what is disabled and on the open tab.
- No new words on screen but those the spec names (the dialog's “Status”). Wording rules from CLAUDE.md: English, British spelling, bold button names in the guide and CHANGELOG, curly double quotes, test titles in cp1252 characters only.
- While developing, run only the tests a change touches, once each; the full suites run once, on CI.

## Review Focus

1. A press on ▶, ★, ⋯, a mark under a take, or a link inside a lit row must not also fire the row's own press (one navigation, no play-and-leave). Test in Task 1.
2. A take's name in a mark's panel on that take's own page opens the drawer's list (`marks`), not a navigation to the same page that would drop the panel. Test kept from `takes.spec.ts:744`.
3. A fold whose title is a pill (a song's page): the pill leads away and does not fold; the arrow and the count fold. Keyboard: Tab reaches both. Test in Task 2.
4. An old `?panel=take:<uid>`, `?edit=statuses`, `?edit=labels` or `?edit=new-song` address lands where the spec says, with no loop, also on a phone. Tests in Tasks 1 and 4.
5. The statuses' panel and a mark's panel are one layer: one replaces the other, Back steps through them, ✕ closes. Test in Task 4.
6. **New song** with a status: the Worker refuses a status that is not there, and the dialog shows why. Tests in Task 4.
7. The base rule for the hand must not reach a disabled button or `aria-disabled`, and must not beat `cursor-grab`, `cursor-crosshair` or `cursor-ew-resize` classes. Test in Task 5.
8. РЭХА: a press on the wave of a take that is playing opens it and it goes on from where it was. Test in Task 6.

---

### Task 1: A take's row opens its page; no take's panel (service)

**Files:**
- Modify: `service/src/takes/parts.tsx` (`TakeLink`, `Wave`, `TakeLine`), `service/src/shell/panel.tsx`, `service/src/shell/Shell.tsx`, `service/src/shell/PlayerBar.tsx`, `service/src/marks/MarkItem.tsx` (`OnTake`), `service/src/marks/MarkPanel.tsx`, `service/src/takes/move.tsx`, `service/src/takes/Take.tsx` (takes `TakePlayer`)
- Delete: `service/src/takes/TakePanel.tsx` (after `TakePlayer` moves)
- Test: `service/e2e/frame.spec.ts`, `home.spec.ts`, `takes.spec.ts`, `marks.spec.ts`, `songs.spec.ts`

**Interfaces:**
- `type Panel = { kind: "mark"; uid: string; id?: number; at?: number } | { kind: "marks"; uid: string } | null` (Task 4 adds `statuses` and `labels`). `panelOf("take:<uid>…")` returns `null`; `takeOfOldPanel(text): string | undefined` gives the uid, and `PanelProvider` replaces the address with `/takes/<uid>` when it is set.
- `TakeLink({ take, short, className })`: a TanStack `Link` to `/takes/$uid`; on that take's own page it opens `{ kind: "marks", uid }` instead. Keeps `title` and `aria-label={take.name}`.
- `TakeLine`'s top row: `-mx-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-accent/60` and its own `onClick` (skips presses inside `button, a, [role=menuitem], input`).

- [ ] **Step 1: Change the tests first.** `frame.spec.ts`: “a press on a wave plays…” becomes “a press on a take's wave opens its page and plays nothing”; the phone test the same with `tap`; the panel test and the Esc-in-a-menu test use a mark's panel from **Latest marks**. `home.spec.ts`: “a take's name opens its page and does not play it”, the row's empty room opens it, ▶ plays without leaving **Home**. `takes.spec.ts`: the three `?panel=take:` starts become the take's page; `:571` becomes “an old take's panel address opens the take's page”. `marks.spec.ts`: a mark's take opens the take's page. `songs.spec.ts:101` moves to Task 4.
- [ ] **Step 2: Run them, see them fail** (throwaway config pointing at `/opt/pw-browsers/chromium`).
- [ ] **Step 3: `panel.tsx`, `Shell.tsx`, `PlayerBar.tsx`, `move.tsx`, `MarkItem.tsx`, `MarkPanel.tsx`.**
- [ ] **Step 4: `takes/parts.tsx`; move `TakePlayer`; delete `TakePanel.tsx`.**
- [ ] **Step 5: Run the touched specs once; `npm run typecheck` in `service/`.**
- [ ] **Step 6: Commit** “Band service: a take's row opens its page; the take's panel goes”.

### Task 2: Pills and the song line (service)

**Files:**
- Modify: `service/src/shell/parts.tsx` (`Pill`, `SongLine`, `Group` with a pill title), `service/src/shell/Side.tsx` (icons exported; **Songs** lit on `/takes/…`), `service/src/takes/Take.tsx` (no `Back`, pills under the title), `service/src/rehearsals/Rehearsal.tsx` (a `SongLine` per song, no fold, **Not named** a plain heading, no **Notes and files**), `service/src/songs/Song.tsx` (day pills)
- Test: `service/e2e/takes.spec.ts`, `rehearsals.spec.ts`, `songs.spec.ts`

**Interfaces:**
- `Pill({ kind, children, ...to }: { kind: "song" | "rehearsal"; children: ReactNode } & LinkProps)`: a link; a press does not reach a fold around it.
- `SongLine({ song, takes })`: a link to `/songs/$id`; words “Viasna”, then “4 takes · E minor · 120 bpm” (key and tempo only when set).
- `Group({ title, fold, … })`: when `title` is not a string and `fold` is set, the trigger holds the arrow and the hint only; the title stands beside it.

- [ ] **Step 1: Tests.** `takes.spec.ts`: the take's page has a link “Pałyn” and a link with the day; each opens its page; a take with no song has only the day; **Songs** lit. `rehearsals.spec.ts`: the song's line opens the song's page, the takes have no fold, **Not named** is a heading, no **Notes and files**. `songs.spec.ts`: a day's pill in **All takes** opens the rehearsal; its arrow folds.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: `Pill`, `SongLine`, `Group`; the three pages and the column.**
- [ ] **Step 4: Run the touched specs once; typecheck.**
- [ ] **Step 5: Commit** “Band service: pills and the song's line lead to their pages”.

### Task 3: Every list by one rule; the dotted line (service)

**Files:**
- Modify: `service/src/shell/parts.tsx` (`Rows`: `gap-0`, rows `py-3`; `takes` the same rule for take rows), `service/src/home/Home.tsx` (favourites as `Rows`; songs 24 px apart, title 8 px over its take), `service/src/songs/Song.tsx` (**All takes** as `Rows`), `service/src/songs/Songs.tsx` (rows `min-h-8`; no `OPENS`), `service/src/rehearsals/Rehearsals.tsx`, `service/src/marks/Marks.tsx`, `service/src/marks/MarkItem.tsx` (compact row lit, opens the mark), `service/src/takes/parts.tsx` (no `OPENS` in `TakeLink` inside a row, nor on the marks under a take), `service/src/sets/Sets.tsx`, `service/src/sets/SetPage.tsx` (no lines between songs), `service/src/members/Members.tsx`, `service/src/trash/Trash.tsx`
- Test: `service/e2e/home.spec.ts`, `songs.spec.ts`, `sets.spec.ts`, `marks.spec.ts`, `rehearsals.spec.ts`, `members.spec.ts`

- [ ] **Step 1: Tests.** One check per page where a test already opens it: 24 px between two rows and no `border-top` on a row (Home's last rehearsal, favourites, latest marks; Rehearsals; Songs; a set; Marks; Members); in **Songs** a song without takes as tall as one with; a row of **Latest marks** opens the mark; no dotted line (`text-decoration-style`) on a take's name in a row, a song's title on **Songs**, a mark on **Marks**; still dotted on a set's song and length.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: `Rows` and the pages.** Measure; adjust until each reads 24.
- [ ] **Step 4: Run the touched specs once; typecheck.**
- [ ] **Step 5: Commit** “Band service: every list by one rule”.

### Task 4: Statuses and Labels in the panel; New song as a dialog with a status (service and Worker)

**Files:**
- Modify: `service/worker/songs/routes.ts` (optional `status_id` on `POST /api/songs`), `service/openapi.json` (`npm run openapi`), `service/src/api.ts` (`useAddSong({ title, status_id })`), `service/src/shell/panel.tsx` (`statuses`, `labels`; old `?edit=` read), `service/src/shell/Shell.tsx` (draws the two editors), `service/src/songs/Songs.tsx`, `service/src/marks/Marks.tsx` (buttons open the panel; no `EditCard`), `service/src/songs/parts.tsx` (**Edit statuses** opens the panel in place), `service/src/songs/NewSong.tsx` (`NewSongDialog` with `Select` for the status), `service/src/songs/Statuses.tsx`, `service/src/marks/Labels.tsx` (heads for the panel)
- Delete: `service/src/shell/editor.ts`, `EditCard` in `service/src/shell/EditList.tsx`
- Test: `service/test/songs.test.ts`, `service/e2e/songs.spec.ts`, `marks.spec.ts`, `labels` and `statuses` tests where they open the card

**Interfaces:**
- `POST /api/songs` body `{ title: string; status_id?: number }`; 404 “No such status” for a missing one, as `PATCH` answers.
- `Panel` adds `{ kind: "statuses" } | { kind: "labels" }`, written `statuses` and `labels` in `?panel=`.

- [ ] **Step 1: Tests.** Worker: a song made with a status has it; with a status that is not there, refused. Playwright: `songs.spec.ts:59`, `:101`, `:119` and `marks.spec.ts:45`, `:75` as the spec says; the dialog makes a song with **Ready** and opens its page; old `?edit=` addresses.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: The Worker, `openapi.json`, `api.ts`.**
- [ ] **Step 4: The panel kinds, the two pages, the dialog, **Edit statuses**; remove `useEditor` and `EditCard`.**
- [ ] **Step 5: Run the touched specs and the Worker test once; typecheck.**
- [ ] **Step 6: Commit** “Band service: statuses and labels in the panel, New song as a dialog”.

### Task 5: The hand over whatever presses (shared styles)

**Files:**
- Modify: `ui/src/index.css` (base layer), `ui/src/components/ui/dropdown-menu.tsx`, `ui/src/components/ui/select.tsx` (items `cursor-pointer`)
- Test: new `service/e2e/pointer.spec.ts`, new `ui/e2e/pointer.spec.ts`

- [ ] **Step 1: Tests.** Each walks its screens (service: Home, Rehearsals, a rehearsal, Songs, a song, a take, Sets, Marks, Members, with a ⋯ menu and the statuses' panel open; РЭХА: start, Settings sections, History's three views, the rehearsal screen with a take open) and checks the cursor at the centre of every visible link, enabled button, menu item, radio, tab and lit row, as the crawl did (`elementFromPoint`, computed `cursor`), with the five exceptions.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: The base rule and the two components.**
- [ ] **Step 4: Run the two pointer specs once; `npx tsc -b` in `ui/`.**
- [ ] **Step 5: Commit** “The hand over everything that presses, in РЭХА and the band service”.

### Task 6: РЭХА's take rows

**Files:**
- Modify: `ui/src/components/RehearsalOverview.tsx` (`TakeRow`'s wave opens; `onPlayAt` goes; a song's rows 24 px apart, the heading where it is), `ui/src/components/SongLadder.tsx`, `ui/src/components/SongPage.tsx`, `ui/src/screens/Rehearsal.tsx`, `ui/src/screens/HistoryScreen.tsx`
- Test: `ui/e2e/overview.spec.ts` (`:345`), `ui/e2e/history.spec.ts`

- [ ] **Step 1: Tests.** `overview.spec.ts:345` becomes “a press on the wave opens the take, and a take that plays goes on”; 24 px between two rows of one song; `history.spec.ts` the same for a song's **Starred** and the ladder where a test already opens them.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: The wave, the props, the gaps.**
- [ ] **Step 4: Run the touched specs once; `npx tsc -b` and `npx eslint` on the changed files.**
- [ ] **Step 5: Commit** “РЭХА: a press on a take's wave opens it; rows further apart”.

### Task 7: Words, pictures, review, pull request

**Files:**
- Modify: `docs/using-it.md` (194-196), `docs/design-system.md` (C1 `OPENS`, the take in a list, the pointer rule, the service's lists and editors), `CHANGELOG.md` (**Unreleased**, three items as in the spec), `site/src/stories/band-service/{new-takes,song,three-weeks-ago,lanes,mark,downloads}-{light,dark}.webp`

- [ ] **Step 1: The guide, the design system, the CHANGELOG.** Check the new English with the humanizer skill.
- [ ] **Step 2: The pictures** with `npm run pictures` in `service/` (throwaway config for the local Chromium), only the six names; show them to Alex in an artifact.
- [ ] **Step 3: Whole-branch review** (superpowers:requesting-code-review); fix every finding, minors too, with tests.
- [ ] **Step 4: Push; open the pull request** (template headings, attribution block, assignee and reviewer Alex); CI runs the full suites once.
- [ ] **Step 5: Merge only on Alex's word.**
