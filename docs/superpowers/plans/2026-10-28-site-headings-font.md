# Geologica and the recording dot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The site's headings are set in Geologica, served by the site, and the icon's red marks the words over a heading and the steps' and chapters' numbers as a recording's dot.

**Architecture:** Three variable WOFF2 subsets in `site/src/page/fonts/`, declared in `page.css` with `@font-face` and unicode ranges, behind a `--page-display` token; the dot is a `::before` on the existing `.eyebrow`, `.step .n` and `.chap-head .n`, coloured by a `--page-dot` token. CSS only: no component changes.

**Tech Stack:** Vite site (`site/`), CSS, Playwright for the tests.

**Spec:** `docs/superpowers/specs/2026-10-28-site-design-review-design.md`, section 7 (R4). Read it first; this plan does not repeat its reasons.

## Global Constraints

- Geologica only from the site: no request to `fonts.googleapis.com` or `fonts.gstatic.com` from any page that uses `page.css`.
- Weights 500 to 600, `font-display: swap`, fallback `var(--page-sans)`.
- Headings only: `.h1`, `.h2`, `.copy h3`, `.step h3`, `.stories-block h2`, `.remote h2`, `.chap-head h2`, `.chap-body > p.joke`, `.tale-card h2`, `.oss p`. Running text, menu, buttons and the app's pieces stay in the system font.
- The dot: `--page-dot: #e5484d`, 9 px, `border-radius: 50%`, ring `0 0 0 3px` of the dot at 22 %, 8 px gap.
- The license file ships beside the fonts: `site/src/page/fonts/Geologica-OFL.txt`.
- Test labels: cp1252 characters only.
- Each test is written and seen failing before the code it checks (Alex, 28 Oct).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the session line.

## Review Focus

1. **The font does not load** (blocked, offline): headings fall back to the system font, not to a serif. (Task 1: the computed `font-family` ends in the system stack.)
2. **A page under a path** (`/stories/tempo-drift`): the font's URL still resolves. (Task 1: the test runs on `/stories/tempo-drift`.)
3. **Letters outside Latin** (*РЭХА*, *Pałyn*): their subsets load from the site. (Task 1: `document.fonts.load` of both.)
4. **The narrowest phone, 320 px**: a heading in Geologica still fits, no sideways scroll. (Existing tests at 320 px on the main page and a story cover it; run them in Task 3.)
5. **The 404 page**, which has its own entry (`src/notfound/main.tsx`): headings and dot as elsewhere. (Tasks 1 and 2 run on `/404.html`.)

---

### Task 1: Geologica for the headings

**Files:**
- Create: `site/src/page/fonts/geologica-latin.woff2`, `geologica-latin-ext.woff2`, `geologica-cyrillic.woff2`, `Geologica-OFL.txt`
- Modify: `site/src/page/page.css` (the comment over `:root`, three `@font-face`, `--page-display`, one rule for the headings)
- Test: `site/e2e/page.spec.ts`

**Interfaces:**
- Produces: `--page-display: "Geologica", var(--page-sans)`.

- [ ] **Step 1: Write the failing test.** For each of `/`, `/stories`, `/stories/tempo-drift`, `/404.html`, test `on <path> the headings are in Geologica, from the site`:
  - the `h1`'s `font-family` matches `/^"?Geologica"?,/` and contains `-apple-system`;
  - after `document.fonts.ready`, `document.fonts.load('600 40px Geologica', 'РЭХА Pałyn')` returns faces, and every Geologica face it returns has status `loaded`;
  - no request was made to `fonts.googleapis.com` or `fonts.gstatic.com`.
- [ ] **Step 2: Run it and see it fail.** `cd site && npm run build && npx playwright test -g "in Geologica"`. Expected: 4 failed, the `font-family` is the system's.
- [ ] **Step 3: Add the fonts and the rule.** The three files from Google's CSS for `Geologica:wght@500..600` (the `latin`, `latin-ext` and `cyrillic` blocks), their unicode ranges copied into the `@font-face`s; the license from `google/fonts`, `ofl/geologica/OFL.txt`.
- [ ] **Step 4: Run it and see it pass.** Same command. Expected: 4 passed.
- [ ] **Step 5: Commit.**

### Task 2: The recording dot

**Files:**
- Modify: `site/src/page/page.css` (`--page-dot`, the rule after `.eyebrow`)
- Test: `site/e2e/page.spec.ts`

- [ ] **Step 1: Write the failing test.** For the same four paths, test `on <path> the word over the heading has the recording dot`: the first `.eyebrow`'s `::before` has `background-color` `rgb(229, 72, 77)`, `width` `9px`, `border-radius` `50%`. On `/`, test `a step's number has the recording dot`: the same for `#how .step .n`.
- [ ] **Step 2: Run it and see it fail.** `npx playwright test -g "recording dot"`. Expected: 5 failed, `::before` has no background.
- [ ] **Step 3: Add the dot.**
- [ ] **Step 4: Run it and see it pass.** Expected: 5 passed.
- [ ] **Step 5: Commit.**

### Task 3: The link picture in Geologica (spec section 8)

**Files:** Modify `site/og.html` (no Google), `site/src/og/og.css` (`@font-face` from `../page/fonts/`, the heading in Geologica, the eyebrow's red and dot), `site/src/og/main.tsx` (wait for Geologica), `site/scripts/og.mjs` (its error), `site/scripts/og-fonts.conf` (its comment). Test: `site/e2e/og.spec.ts`.

- [ ] **Step 1: Write the failing tests.** `og.html sets its heading in Geologica, from the site`: `h1` font-family matches `/^"?Geologica"?,/`, `data-og` is `ready`, no request to Google. `og.html says so when Geologica did not load`: with `**/geologica-*.woff2` aborted, `data-og` is `no-font`.
- [ ] **Step 2: Run them and see them fail.** `npx playwright test e2e/og.spec.ts`. Expected: the heading is in Instrument Sans; the abort test reads `ready`.
- [ ] **Step 3: Change the picture.**
- [ ] **Step 4: Run them and see them pass; then `npm run og` draws a picture.**
- [ ] **Step 5: Commit.**

### Task 4: Phones on their side (spec section 9)

**Files:** Modify `site/src/page/Story.tsx` (`beside()`), `site/src/page/page.css` (the steps' media queries). Test: `site/e2e/page.spec.ts`.

- [ ] **Step 1: Write the failing test.** In a `describe` at 932 by 430, `isMobile`, `hasTouch`: `on a phone on its side the window stands in the step on show`: `.stage` position is `absolute`, for each step its top is the slot's within 1 px, and `scrollWidth` is 932.
- [ ] **Step 2: Run it and see it fail.** Expected: position `sticky`.
- [ ] **Step 3: Beside means `(min-width: 900px) and (min-height: 501px)`;** the phone's rules apply under 900 px wide or at 500 px high or less.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit.**

### Task 5: Review and the pull request

- [ ] **Step 1:** `cd site && npx tsc -b && npx vitest run`, then `npm run build && npm run og && npx playwright test`. Expected: all pass.
- [ ] **Step 2:** A fresh reviewer (superpowers:requesting-code-review) reads the branch against this plan and the spec; every finding is fixed or answered.
- [ ] **Step 3:** Screenshots of the four pages at 1440 and 390 px for Alex.
- [ ] **Step 4:** The pull request, with the spec, this plan and the code. It is merged when Alex says so, not on green alone.
