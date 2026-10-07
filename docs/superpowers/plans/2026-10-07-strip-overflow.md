# Long Names and Many Songs on the Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the strip over the player, a long song name is cut with «…» at 224 px and shown whole on hover; with more songs than fit, the mouse wheel moves the row sideways, the row fades on a side that has more, a round ‹ or › there moves it a screenful, and the open tab comes back into view when the window narrows.

**Architecture:** `SongTab` caps its name and titles it when cut. A new hook, `useRowEdges`, owns everything about the row's ends: which side has more, the wheel, a screenful's move and bringing a tab into view clear of the fade. `TakeStrip` wraps its row to draw the fade and the two buttons from it, and uses it in place of `scrollIntoView`. Python, the bridge and the site's content are untouched.

**Tech Stack:** React 19 + TypeScript + Tailwind v4, lucide-react; Playwright against `ui/e2e/fake-bridge.js`; the site in `site/`.

**Spec:** Alex's picks on the mockup "Strip Overflow Variants" (https://claude.ai/artifact/KDmn3x8xJbdboMPvrLr6RY), 2026-10-07: **A** for a long name, **2** for many songs. The mockup is the look for anything this plan does not spell out.

## Global Constraints

- A name is at most `14rem` (224 px) wide, cut with an ellipsis; its whole text is the tab's `title` only when it is cut.
- The fade is 48 px of `mask-image` at a side with more songs; none at a side without.
- The buttons: round, 28 px, the side's chevron (`ChevronLeft`/`ChevronRight`), named "Earlier songs" and "Later songs" (the row is in the order first played), shown only at a side with more, centred on the tab heads (they stay put when the strip opens out). A click moves the row by its width less both fades, smoothly, and the button gives up focus (Space plays).
- The wheel moves the row only for a mostly vertical turn with no Ctrl or ⌘, only while the row can still move that way, and never over a column of goes that can still scroll that way; otherwise the page or the column gets it as now.
- Both strips get this: the player in History and the rehearsal screen's.
- No new dependencies. Copy is English. Test titles stay in Latin script; test data can be any script.
- Checks: `cd ui && npx tsc -b`, `npm test`, `npm run lint` (no new warnings against `lint-baseline`), `npm run build && npx playwright test e2e/<file>`. Site: `cd site && npm test`, `npm run build && npx playwright test`.
- Existing tests are not edited. Any that fails is stopped on and reported.
- Comments say why, in plain sentences, like the code around them.
- Commits end with the session's attribution lines.

## Review Focus

1. A tab that grows (a cloud status, a rename) or a new take changes how much there is to scroll without the row's own box changing: the fade and the buttons must follow, not stay stale.
2. A trackpad's sideways swipe must still scroll natively, once, not twice.
3. The open tab brought into view must not land under a fade or a button.
4. Opening the strip out (taller row) must not move the buttons down into the columns or re-scroll the row.
5. The site's frame (1180 px, the demo evening) must look as before when everything fits.

---

### Task 1: A long name is cut, and whole on hover

**Files:**
- Modify: `ui/src/components/SongTab.tsx` (the `name` span, the layout effect)
- Test: `ui/e2e/goes.spec.ts`

**Interfaces:**
- Produces: a tab's name text in `[data-tab-name]`; the tab's `title` set to the whole name only while it is cut.

- [ ] **Step 1: Write the failing test** `"a long song name is cut to 224 px and shown whole on hover"`: `startWith(page, ["Pałyn", LONG])` with `LONG = "Pieśnia pra doŭhuju darohu dadomu praz uvieś horad"`; open Pałyn from the overview; expect `[data-tab='LONG'] [data-tab-name]` to be at most 224 px wide, the LONG tab's button to have `title` LONG and still be named from LONG, and Pałyn's tab to have no `title`.
- [ ] **Step 2: Run it** — `npx playwright test e2e/goes.spec.ts -g "long song name"`. Expected: FAIL on the width (the name is about 400 px).
- [ ] **Step 3: Implement.** Wrap the name's text in a `truncate` span with `data-tab-name`, cap the name at `max-w-56`, keep the bold-width `::after` inside the cap. In the existing layout effect, set or remove `title` on the tab's button or open block by comparing the text's `scrollWidth` with its `clientWidth`.
- [ ] **Step 4: Run it, then the file.** Expected: PASS; `e2e/goes.spec.ts` and `e2e/songs.spec.ts` all pass.
- [ ] **Step 5: Commit** — "A long song name is cut on its tab, and whole on hover".

### Task 2: The row's ends: wheel, fade and ‹ ›

**Files:**
- Create: `ui/src/hooks/useRowEdges.ts`
- Modify: `ui/src/components/TakeStrip.tsx` (wrap the row; draw the fade and the buttons)
- Test: `ui/e2e/goes.spec.ts`

**Interfaces:**
- Produces: `useRowEdges(row: RefObject<HTMLElement | null>): { before: boolean; after: boolean; page: (dir: -1 | 1) => void; reveal: (el: HTMLElement) => void }` and `FADE = 48`. `before`/`after` are recomputed on scroll, on the row's resize and after every render (set only when they change). The wheel listener is added by the hook (`passive: false`).

- [ ] **Step 1: Write the failing tests:**
  - `"a few songs show no arrows"`: the default evening, a take open; no button named "Earlier songs" or "Later songs".
  - `"the mouse wheel moves the songs sideways"`: `startWith` 20 names, open the first; `mouse.wheel(0, 300)` over a tab head; the row's `scrollLeft` > 0 and `window.scrollY` unchanged.
  - `"an arrow at a side with more songs moves the row a screenful"`: same 20; "Later songs" shown, "Earlier songs" not; click "Later songs"; `scrollLeft` ≥ `clientWidth − 96 − 1` and "Earlier songs" shown; click it until the row is back at 0, then "Earlier songs" is gone.
  - `"the wheel over an open column scrolls the column, not the songs"`: `startWith` 12 × "Alpha" then 12 other names, open an Alpha go at 760 px tall, open the columns; wheel over Alpha's column; the column's `scrollTop` > 0, the row's `scrollLeft` unchanged.
- [ ] **Step 2: Run them.** Expected: the first passes already (it pins the quiet case); the other three FAIL (no wheel, no buttons).
- [ ] **Step 3: Implement** `useRowEdges` and the wrapper in `TakeStrip`: the row keeps `overflow-x-auto`; the wrapper is `relative min-w-0 flex-1`; the fade is a `mask-image` class on the row from `before`/`after`; the buttons are absolutely placed in the wrapper at its ends, centred on the first tab head's height.
- [ ] **Step 4: Run them, then the file.** Expected: all PASS.
- [ ] **Step 5: Commit** — "The wheel moves the songs, and ‹ › show where there are more".

### Task 3: The open tab stays in view

**Files:**
- Modify: `ui/src/hooks/useRowEdges.ts`, `ui/src/components/TakeStrip.tsx` (the open-tab effect)
- Test: `ui/e2e/goes.spec.ts`

**Interfaces:**
- Consumes: `reveal` and `FADE` from Task 2.

- [ ] **Step 1: Write the failing test** `"the open tab comes back into view when the window narrows"`: at 1180 px, `startWith` 9 names, open the 7th from the overview; narrow to 900 px; the open tab lies inside the row, at least `FADE` clear of an end that has more songs.
- [ ] **Step 2: Run it.** Expected: FAIL (the tab stays cut at the edge).
- [ ] **Step 3: Implement.** `reveal(el)` sets the row's `scrollLeft` so `el` is whole and clear of a fade at either end. The hook's resize observer calls a `onWidth` callback when the row's width (not height) changes; `TakeStrip` reveals the open tab there and in the existing open-tab effect, in place of `scrollIntoView`.
- [ ] **Step 4: Run it, then the file.** Expected: all PASS, including "a renamed go's tab is scrolled into view".
- [ ] **Step 5: Commit** — "The open tab comes back into view when the window narrows".

### Task 4: Changelog, pictures, site and the full suites

**Files:**
- Modify: `CHANGELOG.md` (the "Compare goes at the same bar" entry under Unreleased)
- Maybe: `docs/screenshots/*.png` (only if the strip in them changed)

- [ ] **Step 1:** Add to the "Compare goes at the same bar" entry: "A long name is cut short, whole on hover; with more songs than fit, the mouse wheel moves the strip sideways, and ‹ › at an edge show there are more." (It reaches "What's new" on reha.stream with the next release.)
- [ ] **Step 2:** Take `rehearsal.png`, `player.png` and `zoom.png` again as in `tests/docs_screenshots.py`; replace them only if the strip looks different (it should not: the demo evening fits).
- [ ] **Step 3:** Run the full suites: `cd ui && npx tsc -b && npm test && npm run lint && npm run build && npm run test:e2e`; `cd site && npm test && npm run build && npx playwright test`; `venv/bin/python tests/run_all.py`. Expected: all pass. Look at the site's sixth step: no arrows or fade.
- [ ] **Step 4:** Commit, push to `claude/project-thread-6mqr6n`, open the PR, ask Alex before merging.
