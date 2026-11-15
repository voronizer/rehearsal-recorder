# The way back to РЭХА's levels on the faders: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a take's page in the band service, a fader you moved shows a
mark at РЭХА's level. Dragged near it, the fader stops on it; let go there,
your level for that track is forgotten. A double-click does the same on a
computer, and the pointer over a fader with a mark opens a tip. **РЭХА's
levels** moves from the row under Master to the take's ⋯ menu. РЭХА does
not change.

**Architecture:** The shared fader (`MeteredFader` in
`ui/src/components/LaneControls.tsx`) takes an optional `reha` level. With
it, it draws the mark, stops a drag on it, takes a double-click back to it,
and has a tip; without it (every РЭХА screen) it is as now. `Timeline` and
`TakePlayer` pass a `reha` map by track name, which only the service gives,
and lose `underMaster`. The service's sound forgets a level that comes back
to РЭХА's, so a fader on the mark sends null for that track.

**Tech Stack:** React, Radix Slider and Tooltip (shadcn), vitest,
Playwright (the service's e2e, РЭХА's interface tests and the site's
pictures).

**Spec:** `docs/superpowers/specs/2026-11-15-service-levels-mark-design.md`
(Alex's «ок» 2026-11-15 15:45:03Z).

## Global Constraints

- Code starts from main after the speed branch (#105,
  `claude/project-thread-syxdgt`) has merged: it changes `Take.tsx`,
  `TakePlayer.tsx`, `site/content/band-service.md`, the site's pictures
  and CHANGELOG. Merge main into this branch first; the line numbers below
  are main at d850487 and move with it.
- While developing, run only the tests a change touches, once each; the full
  suites run once, on CI, started by hand after the push. Never two suites at
  once. Say so in every subagent brief.
- Test titles and check labels: cp1252 characters only (Windows CI), so
  РЭХА is "REHA" in a title.
- Build every piece of interface from `ui/src/components/ui/`; `npm run
  design-check` in `ui/` covers `ui/src`, `service/src` and `site/src`.
- One number for "at РЭХА's level", in one place: within 0.005 of it
  (`AT_REHA`), half a key step. The mark shows outside it, the sound
  forgets inside it. A drag stops on the mark within 0.03 (`STOP_AT_REHA`).
- No session link in commits or the PR; the PR body ends with the line
  “🤖 Generated with [Claude Code](https://claude.com/claude-code)”.
- After the last task: review the whole branch, fix every finding (minors
  too), then push and start `service.yml` and `site.yml` by hand.
  `interface.yml` has no manual start: it runs when the PR opens.

---

## Task 1: The mark on the shared fader

**Files:**
- Modify: `ui/src/lib/levels.ts` (`AT_REHA`, `STOP_AT_REHA`, `atReha`, `stopAtReha`), with `ui/src/lib/levels.test.ts`
- Modify: `ui/src/components/LaneControls.tsx` (`MeteredFader`, `LaneControls`)
- Modify: `ui/src/components/Timeline.tsx` (prop `reha`, no `underMaster`)
- Modify: `ui/src/components/TakePlayer.tsx` (props `reha` and `warning`, no `underMaster`)
- Modify: `docs/design-system.md` (C6, the fader)
- Test: `ui/e2e/player.spec.ts`

- [ ] **Step 1: the rule, test first.** In `ui/src/lib/levels.ts`:
  `export const AT_REHA = 0.005`, `export const STOP_AT_REHA = 0.03`,
  `atReha(v, reha) = Math.abs(v - reha) < AT_REHA`, and
  `stopAtReha(v, reha) = Math.abs(v - reha) < STOP_AT_REHA ? reha : v`.
  Tests in `levels.test.ts`: 0.996 is at 1, 0.99 is not; a drag at 0.78
  stops at 0.8, at 0.76 does not. Run
  `cd ui && npx vitest run src/lib/levels.test.ts`: fail, write, pass.
- [ ] **Step 2: `MeteredFader`.** Props `reha?: number` and
  `onBack?: () => void`. While `reha !== undefined && !atReha(volume,
  reha)`:
  - the mark: a `span` with `data-reha-mark`, `aria-hidden`,
    `pointer-events-none`, 2 px by 14 px (`w-0.5 h-3.5`), `rounded-full`,
    `bg-foreground/45`, centred on the level where the thumb's centre
    would be (`left: calc(${reha * 100}% + ${(0.5 - reha) * 14}px)`, the
    thumb being `size-3.5`; check it against the thumb at 0, 50 and 100%),
    drawn before the `Slider` so the knob is over it;
  - the tip: the `div` round the fader is the trigger of a `Tooltip` with
    "Your level: only you hear it. The mark is РЭХА's.", controlled:
    `open={hover && !dragging}`, `onOpenChange` sets `hover`;
  - a double-click on that `div` calls `onBack`.
  `dragging` is set by `onPointerDown` on the `Slider` and cleared in the
  `onPointerUp` that already commits. While dragging, `onValueChange`
  passes `stopAtReha(v, reha)`; keys pass `v` as now. Without `reha`
  nothing of this is drawn or done.
- [ ] **Step 3: `LaneControls`.** Prop `reha?: number`, passed to the
  fader with `onBack`: `onVolume(reha)`, then `onVolumeCommit()` once the
  screen holds the new volume (a ref to the latest `onVolumeCommit`, called
  after the render, as the existing comment on keeping explains).
  `MasterControls` gets nothing.
- [ ] **Step 4: `Timeline` and `TakePlayer`.** `Timeline`: prop
  `reha?: Record<string, number>`, `reha={reha?.[m.name]}` on each
  `LaneControls` (`Timeline.tsx:661`); remove `underMaster` and its row
  (`:102`, `:105-108`, `:782-790`). `TakePlayer`: prop `reha` passed on;
  prop `warning?: string | null`, shown in the player's line in place of
  the output's warning (`warning={warning ?? player.outputWarning}`), so a
  load error still comes first (B4); remove `underMaster` (`:109`,
  `:144-145`, `:198`).
- [ ] **Step 5: design system.** C6, after "Under it is the fader, with M
  and S after it.": "In the band service a fader you moved shows a mark at
  РЭХА's level (`reha`): a drag stops on it, a double-click goes back to it,
  and its tip says what it is. РЭХА's screens give no `reha`."
- [ ] **Step 6: interface test.** `ui/e2e/player.spec.ts`: "REHA's player
  shows no mark on a fader moved": open the take, move a fader with the
  keys, `[data-reha-mark]` has count 0. Run that test alone.
- [ ] **Step 7: commit.** `npx tsc -b` and `npm run design-check` in
  `ui/`; `git commit -m "The shared fader can show РЭХА's level as a mark
  and stop on it; no row under Master"`.

## Task 2: The service: marks, the menu, the failure line

**Files:**
- Modify: `service/src/takes/player/sound.ts` (`keepLevels`)
- Test: `service/src/takes/player/sound.test.ts`
- Modify: `service/src/takes/Take.tsx` (no `Levels`; `reha`, `warning`, the phone's line, the menu)
- Modify: `service/src/takes/Desk.tsx` (prop `reha`)
- Modify: `service/src/takes/TakeMenu.tsx` (prop `levels`)
- Test: `service/e2e/takes.spec.ts`, `service/pictures/site.spec.ts`

- [ ] **Step 1: forgetting at РЭХА's level, test first.** In
  `sound.test.ts` (its take: Bass 1, Guitar 0.8):
  - "a level turned back to REHA's is forgotten, not kept": yours
    `{ Guitar: 0.5 }`, `keepLevels({ Guitar: 0.8 })` calls the API's
    `keepLevels` with `{ Guitar: null }`; with `0.803` the same.
  - "a track turned back to its balance while the turn before is on its
    way" (`:315`) now expects `{ Guitar: null }`: forgotten, not kept as
    0.8. Its title says so.
  - the tests at `:298` and `:329` (no yours, back to 0.8: nothing sent)
    still hold.
  In `sound.ts` `keepLevels` (`:263-285`): `rehaOf(n) = levelOf(undefined,
  take, n)`; for each `[n, v]`, when `atReha(v, rehaOf(n))` the track is
  forgotten if `yours?.[n] !== undefined || sent[n] !== undefined` (send
  `null`), else it is left as now (`delete moved[n]`). `turned` and `sent`
  become `Record<string, number | null>`. Run
  `cd service && npx vitest run src/takes/player/sound.test.ts`: fail,
  write, pass.
- [ ] **Step 2: `Take.tsx`.** Remove `Levels` (`:104-148`) and
  `RotateCcw`. `const reha = Object.fromEntries(take.tracks.map((t) =>
  [t.name, levelOf(undefined, take, t.name)]))` (memoised on the take),
  passed to `RehaPlayer` and to `Desk`. `Full` passes
  `warning={trouble && \`Your levels were not kept: ${trouble}\`}` from
  `useLevelsTrouble()`. `Phone`: under the `Desk`, a `div` with
  `data-levels-trouble` and `min-h-5`, holding the `FieldError` with the
  same words when there is one. `TakeView` passes the menu
  `levels={{ on, back: () => void sound.backToReha() }}`, with
  `on = take.tracks.some((t) => yours?.[t.name] !== undefined &&
  !atReha(yours[t.name], reha[t.name]))` from `useLevels()`.
- [ ] **Step 3: `Desk.tsx`.** Prop `reha?: Record<string, number>`,
  `reha={reha?.[t.name]}` on each `LaneControls` (`:44`).
- [ ] **Step 4: `TakeMenu.tsx`.** Prop `levels?: { on: boolean; back: ()
  => void }`. With it, a `DropdownMenuItem` "РЭХА's levels" between
  `MoveSub` and **Delete take**, `disabled={!levels.on}`,
  `onSelect={levels.back}`. Only the take page passes it, so a take's ⋯ in
  a list is as now. Its doc comment names the item.
- [ ] **Step 5: e2e, failing first.** In `service/e2e/takes.spec.ts`
  ("as Ira", `:476-627`), the button's tests become:
  - "a level moved is yours after a reload, with a mark at REHA's level":
    no `[data-reha-mark]` at first; Guitar 100% → 95% with the keys; the
    Guitar plate has one mark and the others none; hover over the Guitar
    fader: the tooltip reads "Your level: only you hear it. The mark is
    РЭХА's."; reload: 95%, Vocals still 70%; ⋯ › **РЭХА's levels**: 100%,
    no mark, and after a reload 100%; ⋯ › **РЭХА's levels** is then
    disabled.
  - "a fader dragged back near the mark stops on it and the level is
    forgotten": Guitar to 95% with the keys and kept; drag the thumb from
    95% to about 98.5% of the fader: it reads 100%, the PUT sends
    `Guitar: null`, the mark goes; after a reload 100%.
  - "a double-click on a fader with a mark takes it back": Vocals to 60%
    with the keys and kept, double-click its fader: 70% and `Vocals: null`.
  - "the keys step past the mark": Guitar 95%, ArrowRight ×4 reads 99%,
    with the mark still there.
  - "a level that could not be kept says so in the player's line" (`:617`):
    the alert is in `[data-player-line]`; and at 390 px wide in
    `[data-levels-trouble]` under the desk, with the marks below it at the
    same place before and after.
  - nothing under Master: `[data-under-master]` has count 0.
  - the cleanups at `:571-576` and `:608-614` use ⋯ › **РЭХА's levels**.
  - the late-answer test (`:529-576`): its drag starts at 96% of the
    fader, near Guitar's 100%; start it at 90% so the stop does not catch
    it.
  Run each changed test alone, in the e2e server the service's README
  describes, once each.
- [ ] **Step 6: pictures' wait.** `service/pictures/site.spec.ts:49` waits
  for `[data-reha-mark]` on the Guitar plate in place of the button.
- [ ] **Step 7: commit.** `npx tsc -b` and `npm run design-check`;
  `git commit -m "Service: the way back to РЭХА's levels is a mark on each
  fader moved, and РЭХА's levels is in the take's menu"`.

## Task 3: Words, pictures, CHANGELOG

**Files:**
- Modify: `site/content/band-service.md` (`:34`, `:36`)
- Modify: `docs/using-it.md` (`:822-824`)
- Modify: `CHANGELOG.md`
- Modify: `site/src/stories/band-service/*.webp` (retaken)

- [ ] **Step 1: the site.** `:34`, the last sentence becomes the spec's
  three: "A thin mark on the fader shows where РЭХА had it. Bring the fader
  back to the mark and it stops there; a double-click does the same.
  **РЭХА's levels** in the take's ⋯ menu brings every track back at once."
  `:36`, the alt text: "Viasna #12 on Ivan's phone: a row for each track
  with its level, M and S, and the guitar turned all the way up, past the
  mark where РЭХА had it".
- [ ] **Step 2: the guide.** `docs/using-it.md:822-824`, the sentence
  about the button becomes the spec's: "A fader you moved shows a thin mark
  where РЭХА had it: bring the fader back to the mark, or double-click it,
  and the track plays as РЭХА sent it. **РЭХА's levels** in the take's ⋯
  menu does that for every track."
- [ ] **Step 3: CHANGELOG.** Under "Unreleased", after the speed item: "-
  **The way back to РЭХА's levels is on the faders.** In the band service a
  fader you moved shows a thin mark where РЭХА had it. Drag it back near
  the mark and it stops there, and your level for that track is forgotten,
  so every take plays it as РЭХА sent it; on a computer a double-click does
  the same, and the pointer over the fader says what the mark is.
  **РЭХА's levels**, which sat under Master, is now in the take's ⋯ menu,
  for every track at once." Check the three texts with the humanizer skill.
- [ ] **Step 4: pictures.** `cd service && npm run pictures` (with its own
  server as `playwright.pictures.config.ts` says); look at each changed
  picture: "lanes" has the mark on the guitar, and a take's page on a
  computer has no row under Master. Commit the changed `.webp` files.
- [ ] **Step 5: commit.** `git commit -m "Marks on the faders on
  reha.stream, in the guide and CHANGELOG; pictures retaken"`.

## Before the PR

- Review the whole branch against the spec, fix every finding.
- Show Alex the changed site block and every retaken picture before the
  merge.
- Push, start `service.yml` and `site.yml` by hand; open the PR with the
  attribution lines; ask Alex before the merge.
