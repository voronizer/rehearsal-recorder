# The interface on shadcn, and a check that keeps it there: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every piece the shadcn audit found is built from
`ui/src/components/ui/` or shadcn's registry, `npm run design-check` covers
`ui/src`, `service/src` and `site/src` with six more rules and finds nothing,
and CLAUDE.md and `/check-plan` carry the rule.

**Architecture:** The new shadcn components and the variants the rows need
go into `ui/src/components/ui/` first (Task 1), so РЭХА (Task 2), the
service (Tasks 3 and 4) and the site (Task 5) only swap pieces. The check
(Task 6) comes last, when there is nothing left for it to find, and its
commit carries the workflows, K3, CLAUDE.md and `/check-plan`.

**Tech Stack:** React 19, Radix (`radix-ui`), Tailwind 4 (`cn` = clsx +
tailwind-merge), shadcn new-york (`ui/components.json`), Vitest and
Playwright in `ui/`, `service/` and `site/`; Python Playwright for the guide
pictures; plain Node for the check.

**Spec:** `docs/superpowers/specs/2026-11-11-shadcn-rule-design.md`. Row
numbers (R1–R15, S1–S18, W1–W3, C1–C4) are the audit's,
https://claude.ai/artifact/4pxLtR5eZhGjVfVg5w86vL; its file:line were taken
on a57de94, so find each place again before changing it.

**Mockup Alex saw:** https://claude.ai/artifact/8EmLqkwzaFGYasCHKRXLjK, built
from the real components and the shadcn registry's files; its sources, with
the new components' imports already fixed, are in
`/mnt/project-files/band-service/shadcn/mock/` (a starting point only).

## Global Constraints

- While developing, run only the tests a change touches, once each; never
  two full suites at once. The full suites run once, on CI. Say so in every
  subagent brief.
- Local browser tests: `@playwright/test` wants a Chromium the container
  lacks; use a throwaway config with `launchOptions.executablePath:
  "/opt/pw-browsers/chromium"`, never committed. Same for
  `tests/docs_screenshots.py` (`executable_path`) and `npm run pictures` in
  `service/`.
- Test titles and check labels: cp1252 characters only (Windows CI).
- Commit messages end with the Co-Authored-By line only: no session link
  (CLAUDE.md).
- A swapped piece keeps its look, size and behaviour unless the spec's "What
  the band sees" names the change. Rows keep their heights; nothing moves
  when a piece swaps (B4). Both themes; windows 1180×820 and 960×680; the
  service also at 390 px.
- `npx shadcn add <name>` from `ui/`: never let it overwrite `button.tsx` or
  `input.tsx` (answer no); change its `cn` import to `@/lib/utils`; put it on
  the theme; a story and a C8 line each (`docs/design-system.md`, "Adding a
  shadcn component").
- Radix only inside `components/ui/` (U4); no Base UI.
- Words people read follow CLAUDE.md "Writing": British spelling, curly
  double quotes in the guide, README and CHANGELOG, button names in bold,
  each CHANGELOG item starting bold. Check CHANGELOG and guide text with the
  humanizer skill.
- The thread «Показывать стерео и Backing в сервисе» (branch
  `claude/project-thread-wdz2ie`) changes `ui/src/components/LaneControls.tsx`,
  `ui/e2e/lanes.spec.ts`, `service/src/takes/Take.tsx`,
  `service/pictures/seed.ts`, `site/src/stories/band-service/*.webp` and
  CHANGELOG. If this merges first, its new code must pass the six new rules. If it merges first, rebase on main before Task 2 and build R3 on
  its fader (two meters for a stereo track). If this merges first, tell that
  thread; it rebases and retakes.

## Review Focus

1. The right panel on a take's page: folded to the 48 px strip; open beside
   the page, which narrows by 400 px (448 on a page with no strip); the
   address still opens and closes it; ↑/↓ to the next take keeps it as it
   was. Test in Task 3.
2. Below 1100 px the left column folds to its icons while the right panel is
   open and opens again when it closes (Alex, 22:23:17); no key folds either
   column. Test in Task 3.
3. A question (AlertDialog) no longer closes on a click outside; Enter
   presses Cancel; Esc closes it; Space and ⌘Z with a question open do not
   reach the screen behind. Test in Task 2.
4. The fader over its meter: same look, keys, commit on let go. Test in
   Task 2.
5. An error under a field holds its room: the line below does not move when
   it shows. Test in Task 4.
6. The check finds a `title=` two lines under its tag, and lets pass a file
   picker, an iframe's title and our own components' `title` prop. Test in
   Task 6.

---

### Task 1: The shared pieces

**Files:**
- Create in `ui/src/components/ui/`: `alert-dialog.tsx`, `textarea.tsx`,
  `input-group.tsx`, `button-group.tsx`, `field.tsx`, `avatar.tsx`,
  `sidebar.tsx`, `skeleton.tsx`, `accordion.tsx`, `input-otp.tsx`,
  `command.tsx`, each with `NAME.stories.tsx`.
- Modify: `ui/src/components/ui/slider.tsx`, `toggle-group.tsx`,
  `ui/src/index.css` (tokens), `ui/package.json` (`input-otp`, `cmdk`),
  `docs/design-system.md` C8. (`OPENS` and `ITEM_CHOSEN` are exported
  already, and Toggle's on state is already `bg-selected`.)
- Move: `ShareOption` from `ui/src/components/ShareDialog.tsx` into a shared
  place both ShareDialog and the service's Download can import (C3).

- [ ] **Step 1: Add the components.** `npx shadcn add alert-dialog textarea
  input-group button-group field avatar sidebar skeleton accordion input-otp
  command` from `ui/`. Refuse every overwrite of an existing file. Fix the
  `cn` imports. shadcn's sidebar asks for `hooks/use-mobile.ts`: do not add
  it (see Step 3).
- [ ] **Step 2: On the theme.** Each new file uses the theme's colours,
  radii and the five text sizes; run `npm run design-check` in `ui/` (it
  still walks only `ui/src` until Task 6) and fix what it lists inside
  `components/ui/`. AlertDialogContent takes `dialog.tsx`'s frame (12 px
  corners, 16 px title, the same veil); its footer is left to the caller.
- [ ] **Step 3: Sidebar.** In our `sidebar.tsx`: no Ctrl/⌘+B listener and
  no cookie; `SidebarProvider` takes `mobileBelow?: number` (px; default
  768) and reads the mobile state from a `matchMedia` on it inside the file;
  the phone Sheet's hidden title is a prop (`mobileTitle`, default "Menu")
  with no description; `--sidebar-width`, `--sidebar-width-mobile` and
  `--sidebar-width-icon` are set by the caller. Two providers nest without
  sharing state. The container's position is the caller's (`className`), so
  it can sit inside the page's area rather than the viewport.
- [ ] **Step 4: Variants.**
  - Slider `variant="fader"`: clear track and range, the thumb as the fader
    draws it now (`size-3.5 rounded-full bg-foreground ring-2 ring-card`,
    focus ring `ring-[3px] ring-ring/50`), for R3.
  - Slider `variant="mark"`: no track, the thumb drawn by the caller, for R14.
  - Slider `variant="bar"`: the bar as `shell/PlayerBar.tsx` draws it, the
    thumb shown only on keyboard focus, for S5.
  - Textarea `variant="line"`: no frame, a line under it, as
    `components/NameField.tsx` draws it now (R4).
  - ToggleGroup passes `rovingFocus` through, so a grid can keep its own
    arrow keys (R5, S15).
- [ ] **Step 5: Tokens.** `--signal-foreground` and `--mark-foreground` in
  both themes in `ui/src/index.css`, each the white used now, with
  `--color-…` lines beside the others. `--sidebar-*` from our tokens in both
  themes (`--sidebar: var(--panel)`, `--sidebar-foreground:
  var(--foreground)`, `--sidebar-accent: var(--accent)`, `--sidebar-border:
  var(--border)`, `--sidebar-ring: var(--ring)`, the primary pair from
  `--primary`), and remove whatever values `npx shadcn add sidebar` wrote.
- [ ] **Step 6: C3.** `ShareOption` becomes shared (in `components/` if only
  the two use it); ShareDialog imports it back unchanged.
- [ ] **Step 7: Stories and C8.** A story per new file and variant; one line
  each in `docs/design-system.md` C8.
- [ ] **Step 8: Tests.** `npx vitest run src/components/ui` in `ui/`;
  `npx tsc -b`.
- [ ] **Step 9: Commit** "Shared pieces from shadcn for the audit's rows".

### Task 2: РЭХА (R1–R15, C4)

**Files:** each row's file in the spec's table, under `ui/src/`; the
`ui/e2e/*.spec.ts` that read a changed piece; `tests/test_*.py` only if one
reads a changed piece.

- [ ] **Step 1: R1.** `ConfirmDialog` on AlertDialog, keeping
  `DialogButtons`' order (P3) with AlertDialogCancel and AlertDialogAction
  around our Buttons: Cancel gets the first focus, so Enter presses it; Esc
  closes; a click outside does not. `PromptDialog` and `RenameTakeDialog`
  in the same file stay on Dialog. Add `[role="alertdialog"]` to `LAYERS`
  (`ui/src/hooks/useSpacebar.ts:56`), to the dialog lookup at
  `useSpacebar.ts:400` and to `hooks/useUndoKey.ts`. Change every e2e lookup
  of a question from `getByRole("dialog")` to `getByRole("alertdialog")` in
  `ui/e2e` and `service/e2e` (`grep -rn 'getByRole("dialog"'`, then keep the
  ones that find a PromptDialog, a RenameTakeDialog or another Dialog). Add
  e2e tests in the spec that already tests a question (find it with `grep
  -rln "Cancel" ui/e2e`): a click outside leaves it open; Space with
  “Finish this rehearsal?” open does not start a take.
- [ ] **Step 2: R2, R4, R11.** TakeNameField on InputGroup (InputGroupInput
  or InputGroupTextarea, ✕ as an InputGroupAddon with a Button) and Label;
  NameField on Textarea `line`, keeping its own growing (spec call 17);
  DevicePicker's and Rehearsal's labels on Label.
- [ ] **Step 3: R3.** The fader on Slider `fader`, over the meter as now;
  `onVolume` from `onValueChange`, `onVolumeCommit` from `onValueCommit`; its
  name on the thumb. Change `ui/e2e/volume.spec.ts` where it reads
  `toHaveValue` to `aria-valuenow`, and run `volume.spec.ts` and
  `lanes.spec.ts`.
- [ ] **Step 4: R5, R6, C4.** IconPicker on ToggleGroup `type="single"`
  with `rovingFocus={false}` and its own ↑/↓; StarButton and RegionTag on
  Toggle (`pressed`, `onPressedChange`), their names unchanged; the six
  hand-written chosen greys in РЭХА on `ITEM_CHOSEN` (or Toggle's on state
  where the row became a Toggle).
- [ ] **Step 5: R7, R8, R9, R12.** Spinner in ActivityButton and App;
  ErrorBar on Alert `destructive`, where it is now; the six groups on Card,
  their padding and gap as now through `className`; the two bars on
  Separator `orientation="vertical"`.
- [ ] **Step 6: R10, R15.** The folder field and Browse on ButtonGroup;
  TempoField and BarOneField's − n + on ButtonGroup. Same heights as now.
- [ ] **Step 7: R13, R14.** The four folds on Collapsible (the open part as
  CollapsibleContent where it sits in the same component; NotesFold's lane
  lives in Timeline, so Collapsible's root goes where both are); bar one's
  mark on Slider `mark`, its keys and drag as now.
- [ ] **Step 8: Tests.** The e2e specs of the changed screens, one by one,
  once each (`grep -rl` the component's name or its aria-label in
  `ui/e2e/`); `npx vitest run` for the changed files' tests.
- [ ] **Step 9: Commit** "РЭХА: the audit's rows on shared pieces".

### Task 3: The service's frame (S2, S3, S18)

**Files:** `service/src/shell/Shell.tsx`, `Side.tsx`, `drawer.tsx`,
`panel.tsx`, `size.ts`; `service/e2e/*.spec.ts` that open the menu, the
panel or the strip.

- [ ] **Step 1: Left.** The column of sections in a `SidebarProvider`
  (`mobileBelow={500}`) with `Sidebar side="left" collapsible="icon"`,
  `--sidebar-width` 14rem (224 px, as `w-56` now), `--sidebar-width-icon`
  3rem. Its look as now (`bg-panel`, `p-3`, gaps); each section a
  SidebarMenuButton with `isActive` in `ITEM_CHOSEN` (replaces `LIT`, C4),
  its name as the tip when folded. It is open, except below 1100 px
  (`useSize() === "narrow"`) while the right panel is open: then it folds to
  its icons, and opens again when the panel closes (Alex, 22:23:17). On a
  phone it is the Sidebar's Sheet, `--sidebar-width-mobile` 16rem (256 px,
  as now), titled “Menu”: the hand-made backdrop button and `bg-black/30`
  go; the ☰ button calls `setOpenMobile`.
- [ ] **Step 2: Right.** The panel in a second `SidebarProvider`
  (`mobileBelow={500}`), `open` and `onOpenChange` tied to `usePanel()`. `Sidebar side="right"`,
  `--sidebar-width` 28rem, `--sidebar-width-icon` 3rem (the strip's `w-12`).
  On a take's page `collapsible="icon"`: folded, the strip's buttons as in
  `drawer.tsx`; open, the panel. Elsewhere `collapsible="offcanvas"`. The
  container's top and bottom stay where the panel's are now (inside the
  page's area, above the player bar), not the viewport's. The Back button in
  the panel (S1) is a Button.
- [ ] **Step 3: Phone.** Under 500 px the right panel (a mark's, Statuses,
  Labels) does not become a Sheet: it keeps today's place between the header
  and the player bar, full width, no veil, the bar usable (render the
  panel as now there instead of the right Sidebar); a take opens its page as
  now.
- [ ] **Step 4: Tests.** New in the spec that tests the panel (`grep -rln
  'aria-label="Panel"\|"Panel"' service/e2e`): on a take's page the 48 px
  strip shows; opening the panel narrows the main area by 400 px and closing
  folds it back to the strip (compare widths); on Songs with Statuses open
  the main area is 448 px narrower; at 960 px the left column folds to icons
  while the panel is open and opens when it closes; the phone menu closes on
  Esc; on a phone the player bar still plays with a mark's panel open. Run
  the changed specs once each.
- [ ] **Step 5: Commit** "Service: both columns on shadcn's Sidebar".

### Task 4: The rest of the service (S1, S4–S17, C1–C3, sizes, colours)

**Files:** the rows' files in the spec's table under `service/src/`;
`service/src/service.css` if the print sheet's rules move; `service/e2e/`.

- [ ] **Step 1: S1.** The remaining hand-made buttons on Button (`ghost`,
  `link`, the sizes in use) or Toggle where pressed; the grip in
  `shell/EditList.tsx` a ghost Button with the ref (`asChild` if the drag
  library needs the element). S1b: **Statuses** and **Labels**
  (`songs/Songs.tsx`, `marks/Marks.tsx`) on Toggle `outline` `row`, pressed
  while their panel is open, and a press while pressed keeps it open
  (`onPressedChange` always opens); the service's star (`takes/parts.tsx`) on
  Toggle. S6b: the track rows' `<label>` in `takes/Download.tsx` on Label.
- [ ] **Step 2: S4.** Each `title=` tip: Tooltip, or WholeTip where it shows a
  name cut short; the take link's too (`takes/parts.tsx`). StarButton's
  "Starred by …" wraps the Toggle in a Tooltip.
- [ ] **Step 3: S5, S6, S7.** PlayerBar on Slider `bar`; the `TEXTAREA` class
  gone, its two boxes on Textarea; one in-place name editor in
  `service/src/shell/` on InputGroup (input, ✓ and ✕ as addons) used by
  `songs/edit.tsx`, `sets/SetPage.tsx` and `takes/move.tsx`.
- [ ] **Step 4: S8, S9, S10, S13, S14, C1, C2, C3.** Avatar for `Avatar`,
  `Logo` and `Initials` (letters `text-xs`; in the star stack the circles
  keep `h-5 min-w-5 px-1`, so two letters, “Iv” and “Ir”, still fit); the
  shared Empty for `Empty`, the first sentence of each page's words as
  EmptyTitle and the rest as EmptyDescription, no new words; `Waiting`:
  nothing for 1 s, then Spinner, and from 10 s “Opening…” beside it (B5); Badge for the pills,
  their look as now through a variant if Badge's differs; Card for `Groups`
  and `signin/Frame.tsx`; `OPENS` from `button.tsx` (`text-left` stays at the
  call); MarkLine for the three mark lines; the shared ShareOption in
  Download.
- [ ] **Step 5: S11.** All 21 in `text-sm` (FieldError's size), by the
  spec's three kinds:
  - under a field, a Field with the error in a `min-h-5` line that is there
    when empty: `songs/parts.tsx:141`, `songs/NewSong.tsx:87`,
    `takes/move.tsx:156`, `marks/MarkItem.tsx:98` and `:254`,
    `shell/EditList.tsx:104`, `signin/SignIn.tsx:108`, `signin/Name.tsx:48`,
    `sets/SetPage.tsx:114`, and the set length's error, now only a `title=`
    on its Input (`sets/SetPage.tsx:207`);
  - in a row, FieldError in place: `songs/parts.tsx:221` and `:275`,
    `songs/edit.tsx:41`, `takes/TakeMenu.tsx:43`, `sets/SetPage.tsx:166`,
    `takes/Take.tsx:141`;
  - under a list or a button, FieldError in place: `songs/parts.tsx:196`,
    `sets/Sets.tsx:79`, `sets/SetPage.tsx:387`, `members/Members.tsx:32`,
    `trash/Trash.tsx:66`;
  - `Trouble` (`shell/parts.tsx:450`) on Alert, **Try again** as now.
- [ ] **Step 6: S12.** The list rows on Item and ItemGroup; a press anywhere
  on the row still opens what it opened, and the buttons inside still work.
- [ ] **Step 7: S15, S16, S17.** The colour row as a ToggleGroup in a Popover
  by the swatch (`rovingFocus={false}`, own ↑/↓ as R5; the check on the
  chosen one in `text-mark-foreground`); Move to song as Command inside the
  `DropdownMenuSubContent` that is there now, its search field focused when
  the submenu opens and stopping the menu's own typeahead, **Not named** and
  **New song…** outside the search (`forceMount`), so a search with no match
  still shows them; the code on InputOTP, six slots,
  `autoComplete="one-time-code"`, a pasted code filling all six, **Sign in**
  still pressed by the member.
- [ ] **Step 8: Sizes and colours.** `text-lg` to `text-base` (F5) in
  `MarkPanel.tsx`, `EditList.tsx`, `SetPage.tsx` (three), `Name.tsx`,
  `SignIn.tsx`; `text-[10px]` to `text-xs` in `songs/parts.tsx` and
  `takes/parts.tsx`; the stage title `text-[clamp(1.75rem,8.5vw,3.5rem)]`
  (28 px at 330 px wide, 56 px from 660 px; wraps balanced as now) with
  `design-ok(text-size)` and a reason; FirstDay's done step
  `text-signal-foreground`; the diamond under `design-ok(radius)` with the
  same reason as `Timeline.tsx`'s; `sets/Print.tsx` under the paper kind of
  `design-ok`, which Task 6 adds (until then the check does not walk the
  service).
- [ ] **Step 9: Tests.** New: an error under a field moves nothing below it
  (the next element's top, before and after); Move to song finds a song by
  typing two letters; the code fills six boxes from a paste. Run each changed
  spec once; `npm run typecheck` and `npx vitest run` for the changed files.
- [ ] **Step 10: Commit** "Service: the audit's rows on shared pieces".

### Task 5: The site (W1–W3)

**Files:** `site/src/page/Faq.tsx`, `Story.tsx`, `Nav.tsx`, `page.css`;
`site/e2e/`.

- [ ] **Step 1: W1.** FAQ on Accordion `type="multiple"`, styled by
  `page.css` as `<details>` is now; AccordionContent with `forceMount` and
  hidden while closed, so every answer stays in the page; opening in 250 ms
  (F10), at once under Reduce motion (F11); the e2e test that opens a
  question still passes, and ↑/↓ move between questions.
- [ ] **Step 2: W2.** The pieces under a story's window on Toggle (they carry
  `aria-pressed`), the steps on Button; `page.css` keeps their look (its
  `.item button` and `.rail button` rules sit outside Tailwind's layers, so
  they win; check both themes).
- [ ] **Step 3: W3.** `Logo` draws `ui/public/logo.svg` as an `<img alt="">`
  through a Vite import; the menu looks as now.
- [ ] **Step 4: Tests.** `npm run build` and the site's e2e specs that touch
  the FAQ, a story and the menu, once each.
- [ ] **Step 5: Commit** "Site: FAQ on Accordion, the story's buttons and
  the icon".

### Task 6: The check over three parts, and the rule for Claude

**Files:** `ui/scripts/design-rules.mjs`, `design-check.mjs`,
`design-rules.test.mjs`, `ui/design-check.allow.json` (stays `{}`);
`.github/workflows/interface.yml`, `service.yml`,
`.github/actions/site/action.yml`; `docs/design-system.md` K3 and "The
check"; `CLAUDE.md`; `.claude/skills/check-plan/SKILL.md`.

- [ ] **Step 1: Paths and parts.** `SHARED_DIR` becomes
  `"ui/src/components/ui/"`; `isChecked` takes `(ui|service|site)/src/…`
  .ts/.tsx but tests; `design-check.mjs` walks the parts named on its command
  line (`ui`, `service`, `site`; none means all three) from the repository's
  root and prints paths from there. Change the paths in
  `design-rules.test.mjs` from `"src/` to `"ui/src/`.
- [ ] **Step 2: The tag an attribute belongs to.** A helper that, from a
  place on a line, walks back over `ctx.lines` (skipping strings and `{…}`)
  to the `<Name` that opened the tag it sits in, and forward to the tag's
  `>`; returns the name and the tag's text.
- [ ] **Step 3: The six rules** (`outsideUi: true` each), as the spec's
  table: `raw-field`, `raw-label`, `spinner`, `native-tip`,
  `pressed-button`, `card`, each with its `why`.
- [ ] **Step 4: `design-ok` for paper.** The waiver's text in
  `design-check.mjs` and the comment at the top of `design-rules.mjs` name
  the third kind. (A waiver needs a reason; the kind is said in it, as now.)
- [ ] **Step 5: Tests** in `design-rules.test.mjs`, each failing first: a
  hit and a pass for every new rule, a `title=` two lines under `<span`, a
  `type="file"` input two lines under `<input`, `<iframe title>`, `<Group
  title=…>`, a part named on the command line, the allow-list still `{}`.
  `npx vitest run scripts/design-rules.test.mjs` in `ui/`.
- [ ] **Step 6: Zero.** `npm run design-check` in `ui/`: nothing in any part.
  Fix what it lists in the task it belongs to.
- [ ] **Step 7: CI.** `interface.yml`: `npm run design-check -- ui`.
  `service.yml`: a step before Typecheck, `node ../ui/scripts/design-check.mjs
  service`. The site's action: a step before its build, `node
  ui/scripts/design-check.mjs site`. Each with a comment in the style of the
  file's others.
- [ ] **Step 8: The rule in words.** CLAUDE.md "Features" gets the spec's
  line; `/check-plan` section D gets the spec's line; in
  `docs/design-system.md`: K3 and "The check" name the three parts, the six
  rules (in its table) and the third kind of `design-ok`; C3 says a question
  is AlertDialog; B2 says a click outside does not close it; B5 says the
  service waits the same second; C8 lists the new components and drops
  InputGroup and the side panel from the ones "added by the first screen's
  pull request that needs them"; "Where things stand" says the service and
  the site are checked too.
- [ ] **Step 9: Commit** "design-check over РЭХА, the service and the site,
  with six more rules".

### Task 7: Words and pictures

**Files:** `CHANGELOG.md`; `docs/using-it.md`; `service/README.md`;
`docs/screenshots/*.png` taken by `tests/docs_screenshots.py`;
`site/src/stories/band-service/*` taken by `npm run pictures` in
`service/`.

- [ ] **Step 1: CHANGELOG.** Under "Unreleased", one item for РЭХА and one
  for the service, each starting bold, naming what the spec's "What the band
  sees" lists for it. Humanizer.
- [ ] **Step 2: Guide and README.** `grep -n` `docs/using-it.md` and
  `service/README.md` for the code from the email, a question's click
  outside, the folder field, the tempo field, the menu and the panel; bring
  each line into line.
- [ ] **Step 3: Pictures.** Guide pictures where R8, R10 or R15 show (find
  them in `tests/docs_screenshots.py`); the service's pictures, all; look at
  each before committing.
- [ ] **Step 4: Site screenshots for Alex.** Build the site and take its
  pages that show the FAQ, a story and the band service story, both themes,
  at 1440 and 390 px; publish them as an artifact to show him before merge.
- [ ] **Step 5: Commit** "CHANGELOG, guide and pictures".

### Task 8: Review and the pull request

- [ ] **Step 1:** Review the whole branch (`git diff main...`), fix every
  finding, minors too, and run the touched tests again once.
- [ ] **Step 2:** Push; open the PR (body ends with the project's line);
  start the checks; subscribe to its activity.
- [ ] **Step 3:** Send Alex the link and the site screenshots; merge only on
  his word, with a merge commit.
