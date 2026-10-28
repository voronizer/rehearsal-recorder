# reha.stream in the dark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** reha.stream is dark when the system is, all through, the live app included, with no flash of white and no switch.

**Architecture:** An inline script in each page's `<head>` sets the app's own `.dark` class on `<html>` from `prefers-color-scheme` and follows its changes; the page's tokens already point at the app's, so they turn dark with it; three tokens of the page's own get dark values; the frames of the live app ask for the theme `system`.

**Tech Stack:** Vite site (`site/`), CSS, a few lines of inline JS, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-site-dark-theme-design.md` (approved by Alex, 28 Oct). Read it first.

## Global Constraints

- Dark from `matchMedia("(prefers-color-scheme: dark)")` only; no switch, nothing stored.
- The class is the app's `.dark` on `<html>`; `color-scheme: dark` under it.
- Dark values: `--page-rec: #e5484d`; `--page-link` lighter than `--primary`, 4.5:1 or more on the dark page and tile; the screen's ring from `--page-line`.
- Light unchanged: no visible change with `colorScheme: "light"`.
- `og.html` untouched.
- Test labels: cp1252 characters only. Each test is written and seen failing before its code.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the session line.

## Review Focus

1. **A story page**, built from `stories.html` by the `stories()` plugin: the head's script must reach every `stories/<name>.html`. (Task 1 runs on `/stories/tempo-drift`.)
2. **A script blocked or slow**: the head's script still sets the class before the module runs. (Task 1, no-flash test.)
3. **The theme changed with the page open**: page and frames both follow. (Tasks 1 and 3.)
4. **Links inside a tile** (the stories' block, a card): 4.5:1 on the tile's dark grey, which is darker than the page. (Task 2 checks a link on a tile.)
5. **The light theme**: nothing moves. (Task 1's light test; the whole suite runs in light by default.)

---

### Task 1: The page follows the system

**Files:**
- Modify: `site/index.html`, `site/stories.html`, `site/404.html` (the head's script)
- Modify: `site/src/page/page.css` (`color-scheme` under `.dark`)
- Test: `site/e2e/dark.spec.ts` (new)

**Interfaces:**
- Produces: `<html class="dark">` whenever the system is dark.

- [ ] **Step 1: Write the failing tests** in `dark.spec.ts`, for each of `/`, `/stories`, `/stories/tempo-drift`, `/404.html`:
  - `on <path> in the dark the page is dark`: with `colorScheme: "dark"`, `<html>` has class `dark`, and `body`'s background, read as sRGB through a canvas, has luminance under 0.05.
  - `on <path> in the light the page is as it was`: with `colorScheme: "light"`, no `dark` class, `body` background `rgb(255, 255, 255)`.
  - `on <path> the page is dark before its script runs`: dark, with every `/assets/*.js` request aborted; `<html>` has `dark`.
  - `on <path> the page follows a change of the system`: load light, `page.emulateMedia({ colorScheme: "dark" })`, `<html>` gets `dark`; back to light, it loses it.
- [ ] **Step 2: Run them and see them fail.** `cd site && npm run build && npx playwright test e2e/dark.spec.ts`. Expected: the dark ones fail, no `dark` class; the light ones pass.
- [ ] **Step 3: The head's script**, the same in the three files, before any stylesheet: read the media query, toggle `dark` on `document.documentElement`, and `addEventListener("change", ...)` on it. `page.css`: `:root.dark { color-scheme: dark; }`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.**

### Task 2: The page's own colours in the dark

**Files:**
- Modify: `site/src/page/page.css` (`--page-link`, `.dark` values of `--page-rec` and `--page-link`, `.more` and `.chap-body a` from `--page-link`, the screen's ring)
- Test: `site/e2e/dark.spec.ts`

**Interfaces:**
- Produces: `--page-link` (light: `var(--page-accent)`).

- [ ] **Step 1: Write the failing test** `on <path> in the dark the words read at 4.5:1`, for the four paths, dark: against the first non-transparent background up the tree, contrast 4.5 or more for `h1`, the first `.lede` or `p` in grey, the first `.eyebrow`, and the first `a.more`; on `/` also `#stories a.more` (a link on a tile).
- [ ] **Step 2: Run it and see it fail.** Expected: the eyebrow about 3.4, the link about 3.8.
- [ ] **Step 3: The dark values.**
- [ ] **Step 4: Run it and see it pass**, and the light suite still passes (`npx playwright test e2e/page.spec.ts -g "4.5:1"`).
- [ ] **Step 5: Commit.**

### Task 3: The live app in the dark

**Files:**
- Modify: `site/src/stage/main.tsx` (`applyAppearance("system", 1)`), `site/src/stage/demo.ts` (`theme: "system"`, its comment)
- Test: `site/e2e/dark.spec.ts`

- [ ] **Step 1: Write the failing tests**, on `/`, dark: `in the dark the live app is dark`: the hero frame's `<html>` and the story's frame's `<html>` have `dark`; `in the dark a piece of the app is dark`: after clicking *Rehearse the set, in order.*, `#how .over .piece`'s background has luminance under 0.05; `the live app follows a change of the system`: load light, switch to dark, the hero frame's `<html>` gets `dark`.
- [ ] **Step 2: Run them and see them fail.** Expected: the frames have no `dark`.
- [ ] **Step 3: Ask for `system`;** if the frame does not follow a change by itself, listen for the media query's `change` in `stage/main.tsx` and apply again.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.**

### Task 4: Review and the pull request

- [ ] **Step 1:** `cd site && npx tsc -b && npx vitest run`, then `npm run build && npm run og && npx playwright test`. Expected: all pass.
- [ ] **Step 2:** A fresh reviewer (superpowers:requesting-code-review) reads the branch against this plan and the spec; every finding is fixed, each fix test first, or answered.
- [ ] **Step 3:** Screenshots of the four pages, dark, at 1440 and 390 px, for Alex, with the link's blue.
- [ ] **Step 4:** The pull request. It is merged when Alex says so.
