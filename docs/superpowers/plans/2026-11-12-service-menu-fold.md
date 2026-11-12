# Folding the band service's menu by hand: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A round handle on the edge of the band service's column of
sections folds it to its icons and opens it again, and the browser keeps the
fold.

**Architecture:** The column is already shadcn's `Sidebar` with
`collapsible="icon"` (`service/src/shell/Side.tsx`), whose provider in
`Frame` (`service/src/shell/Shell.tsx`) decides `open`. The feature's logic
lives in one module, `service/src/shell/menu.tsx`: the kept fold in
`localStorage` (after `takes/player/master.ts`), a `useMenuFold` hook that
joins it with the fold the frame does by itself while the panel is open at
820 to 1099 px, and `MenuHandle`, drawn from our `Button`. `Frame` and
`Side` only call it; the handle stands outside the column's scrolling
`aside`, so it can sit half over the edge.

**Tech Stack:** React 19, TanStack Router, Tailwind 4 (`cn` = clsx +
tailwind-merge), vitest, Playwright e2e in `service/`.

**Spec:** `docs/superpowers/specs/2026-11-12-service-menu-fold-design.md`.
The mockup's `Side.tsx` and `Shell.tsx`, a starting point only:
`/mnt/project-files/band-service/menu-fold/q3-mock/` (its variants A, B, D
and the Marks badge go; only C, the handle, stays).

## Global Constraints

- While developing, run only the tests a change touches, once each; the full
  suites run once, on CI. Say so in every subagent brief.
- Local browser tests: `@playwright/test` wants a Chromium the container
  lacks; use a throwaway config with `launchOptions.executablePath:
  "/opt/pw-browsers/chromium"`, never committed (`service/mk.*`, already in
  `.git/info/exclude`).
- Test titles and check labels: cp1252 characters only (Windows CI).
- Words people read follow CLAUDE.md "Writing": British spelling, button
  names in bold, each CHANGELOG item starting bold, curly double quotes in
  the CHANGELOG. Check the CHANGELOG item with the humanizer skill.
- Every piece from `ui/src/components/ui/` (Button, Tooltip, Sidebar); no
  hand-made button. `npm run design-check` passes.
- Nothing jumps: the sections' icons keep their height open and folded; the
  logo stays 36 px folded (Alex, 10:25:41).
- No other open branch touches `service/src/shell/` or the two pictures
  (checked 2026-11-12 10:30Z: the navigation thread merged everything; the
  loudness thread is a discussion).

## Review Focus

1. The fold by itself (panel open, 820 to 1099 px) must not write the kept
   fold, and closing the panel must bring back the band member's choice.
2. A browser whose storage throws still folds for the visit.
3. No handle on a phone, in the ☰ sheet, or while the column folds by itself.
4. The handle reaches the keyboard first in the column, its tip comes on
   focus, and the focus stays on it after a press.

---

### Task 1: The handle and the kept fold

**Files:**
- Create: `service/src/shell/menu.tsx`, `service/src/shell/menu.test.ts`
- Modify: `service/src/shell/Shell.tsx` (`Frame`), `service/src/shell/Side.tsx`
- Modify: `service/e2e/frame.spec.ts`
- Modify: `docs/design-system.md` (F4's band service paragraph; C8's `Sidebar` line), `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: The kept fold.** `menu.tsx`: `const KEY = "reha.menu"`;
  `keptFold(): boolean` is `localStorage.getItem(KEY) === "folded"`, false
  when the storage throws; `keepFold(folded: boolean)` sets `"folded"` or
  removes the key, swallowing a throw. A header comment as in `master.ts`:
  the browser's, not the member's; Alex, 2026-11-12 10:23:55; and the
  header says the whole feature is here (kept fold, `useMenuFold`,
  `MenuHandle`).
  `menu.test.ts` with `vi.stubGlobal("localStorage", …)` as in
  `master.test.ts`: nothing kept is open; `"folded"` is folded; another
  value is open; a throwing `getItem` is open; `keepFold(true)` then
  `keepFold(false)` leave the key set then removed; a throwing `setItem`
  does not throw. Run `npx vitest run src/shell/menu.test.ts` in `service/`.

- [ ] **Step 2: `useMenuFold`.** In `menu.tsx`,
  `useMenuFold(size: Size, panel: boolean, pushes: boolean)` returns
  `{ open, onOpenChange, handle }`: `const [folded, setFolded] = useState(keptFold)`;
  `const auto = size !== "wide" && panel && pushes` (the fold by itself, as
  `Frame`'s old `open` expression said); `open = !folded && !auto`;
  `onOpenChange = (open) => { if (auto) return; setFolded(!open); keepFold(!open) }`;
  `handle = !auto`. `Frame` calls it before the phone's early return (so the
  hooks keep their order), passes `open` and `onOpenChange` to the left
  `SidebarProvider`, and `<Side handle={handle} />`. Update `Frame`'s comment: the band member
  folds the column by its handle (Alex, 2026-11-12 10:22:43), the browser
  keeps it; with the panel open below 1100 px it folds by itself and the
  handle goes.

- [ ] **Step 3: The handle.** `MenuHandle` in `menu.tsx`; in `Side.tsx`,
  `Side({ handle }: { handle?: boolean })` draws it when `handle && !isMobile`,
  as the first child of `<Sidebar>`, before the `aside` (Tab reaches it first;
  the `aside` scrolls and would clip it):
  ```tsx
  function MenuHandle() {
    const { open, toggleSidebar } = useSidebar()
    const name = open ? "Fold the menu" : "Open the menu"
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-tiny" aria-label={name} onClick={toggleSidebar}
            className="absolute top-[22px] -right-3 z-20 rounded-full text-muted-foreground hover:text-foreground dark:bg-background hover:bg-background dark:hover:bg-background">
            {open ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right"><span aria-hidden>{name}</span></TooltipContent>
      </Tooltip>
    )
  }
  ```
  Check in a browser at 1180 and 960 px, light and dark: the handle sits
  half over the edge level with the band's name, overlaps the folded logo's
  right edge as in the mockup, shows the hand, and its tip reads at the
  right. Update `Side`'s comment (the handle, the tip; folded, Marks has no
  count). Keep the logo 36 px.

- [ ] **Step 4: Page tests** in `service/e2e/frame.spec.ts`, near the
  960 px test, reusing `box`:
  - "the handle folds the sections to their icons and opens them, the page
    takes the room, and a reload keeps the fold": at 1180 px on `/`, the
    first Tab focuses **Fold the menu** and its tip says so; pressed, `main`
    goes from `{ x: 224, width: 956 }` to `{ x: 48, width: 1132 }`, Songs
    from `{ x: 12, width: 200 }` to `{ x: 6, width: 36 }` at the same `y`,
    the focus stays on the handle, now **Open the menu**; after
    `page.reload()` the column is still folded; pressed again it opens, and
    a reload keeps it open.
  - "at 960 px a column folded by hand stays folded beside the panel and
    after it; while the panel folds it, there is no handle": on a take's
    page at 960×680, with the column open (the handle reads **Fold the
    menu**), open a panel from the strip: no button named **Fold the menu**
    or **Open the menu**; fold the panel:
    the handle is back as **Fold the menu** and the column open. Then fold
    by hand, open and fold the panel: the column stays folded throughout,
    the handle back as **Open the menu**.
  - In "a phone keeps the sections behind the menu": no button named
    **Fold the menu** or **Open the menu**, also with ☰ open.
  Run only these three with the throwaway config.

- [ ] **Step 5: Words.** `docs/design-system.md`: in F4's band service
  paragraph, after the sentence ending "in the dark theme the panel keeps
  its colour.", a sentence: the
  column folds to its icons by a round handle on its edge, level with the
  band's name, and the browser keeps the fold (Alex, 12 November 2026); in
  C8's `Sidebar` line, after "keeps nothing between runs": the band service
  keeps its left column's fold itself, in the browser. CHANGELOG under
  Unreleased (create the heading if missing), along these lines, then a
  humanizer pass:
  > - **The band service's menu on the left folds to its icons.** Press the
  >   round handle on the edge of the column of sections, by the band's
  >   name; press it again to open it. The browser remembers, so next time
  >   the menu opens folded in that browser. In a window from 820 to 1099 px
  >   wide the menu still folds by itself while the panel on the right is
  >   open, and the handle comes back when you close the panel. On a phone
  >   nothing changes.

- [ ] **Step 6:** `npm run typecheck` and `npm run design-check` where they
  live, and `npx vitest run src/shell/` in `service/`; commit: "Service: a handle folds the menu to its icons, and the
  browser keeps it".

### Task 2: The two pictures on reha.stream

**Files:**
- Modify: `site/src/stories/band-service/downloads-light.webp`, `downloads-dark.webp`, `sets-light.webp`, `sets-dark.webp`

- [ ] **Step 1:** With a throwaway copy of `service/playwright.pictures.config.ts`
  that sets `launchOptions.executablePath`, run
  `npx playwright test -c <it> --grep "^(downloads|sets) (light|dark)$"` in
  `service/`. Check each picture: the handle ‹ on the column's edge by the
  band's name, nothing else changed.
- [ ] **Step 2:** Commit: "Site: the computer pictures show the menu's handle".
  Show Alex the four pictures as an artifact before the PR merges (CLAUDE.md:
  every new site picture before merge).

### After the tasks

Review the whole branch (spec against code, the four Review Focus points),
fix every finding, push and open the PR: its checks start by themselves on
`pull_request` (`service.yml`, `site.yml`), so they run once with no hand
start. Ask Alex before merging.
