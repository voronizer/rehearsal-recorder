# Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Step 2 of the rollout in one PR: the theme values (F1-F11), the shared components (C1-C7), one place that knows the system (P1-P3), moving to the Trash at once with Undo (B1), Storybook (K2), the CI design check with every screen on its allow-list (K3) and the rules document (K1).

**Architecture:** `ui/src/index.css` stays the one theme file the app and reha.stream import; it gets the decided colours, radii, type and motion tokens. Shared components live in `ui/src/components/ui/` (shadcn sources copied from a pinned commit, plus our own PlayButton and LanePlate), each with a story beside it. Python keeps a removed item in an app-owned holding folder, `<recordings>/_deleting/<token>/`, with a `record.json` snapshot of its database rows, and sends it to the Trash only when the UI says its notice ended (or at quit, at start, before a folder switch, or when it goes stale); Undo moves it back and re-inserts the rows. A node script checks the source against the rules, with an allow-list that the screen PRs shorten.

**Tech Stack:** React 19, TypeScript 7.0.2, Tailwind v4, Vite 8, the unified `radix-ui` package, cva, lucide; Storybook 10.6.1 (`@storybook/react-vite`); Vitest (node) and Playwright on `ui/e2e/fake-bridge.js`; Python 3.12 with SQLAlchemy on SQLite; plain-script test suites with `ok(label, cond)`.

**Spec:** `docs/superpowers/specs/2026-10-08-design-system-design.md` (D1-D8, F1-F11, P1-P3, C1-C8, U1-U5, B1-B9, K1-K3, rollout). Read it whole before the first task. Every ruling with its mockup is in the project's files at `design-system/rulings.md`; the decided CSS values were last applied in `design-system/q-motion/head.html`.

**Research behind this plan** (read the parts a task names): the Trash flow and every test that touches it, `design-system/plan/trash-flow.md`; CI, Storybook and shadcn facts, `design-system/plan/ci-tooling.md`; the dialogs map, `design-system/q-dialog/dialogs-map.md`; the four small players, `design-system/q-player/small-players-map.md`. (All under `/mnt/project-files/`.)

## Global Constraints

- Playwright test titles and Python check labels are Latin only (Windows CI prints cp1252).
- Colours, exact: accent `--primary` and `--ring` `oklch(0.56 0.24 266)` in both themes, `--primary-foreground` `oklch(0.985 0 0)`; `--selected` light `oklch(0.92 0.004 286.3)`, dark `oklch(0.31 0.009 286.3)`; `--strong` light `oklch(0.21 0.006 285.9)` on `--strong-foreground` `oklch(0.985 0 0)`, dark `oklch(0.93 0.003 286.3)` on `oklch(0.18 0.006 285.9)`; the orange label light `oklch(0.68 0.17 48)`, dark `oklch(0.7 0.17 45)`.
- Text sizes: `text-xs` 12, `text-sm` 14, `text-base` 16, `text-xl` 20, `text-2xl` 24 (rem); body text 14. Weights 400 and 600 only in new code.
- Radii: `rounded-sm` and bare `rounded` 4 px, `rounded-md` 8, `rounded-lg` and `rounded-xl` 12, `rounded-full`.
- Motion: entrances rise 12 px and fade over 250 ms with `cubic-bezier(.2,.8,.2,1)`, groups 40 ms apart; dialogs, menus and notices 220 ms; hover colour 200 ms; nothing over 400 ms; off under Reduce motion and while recording.
- Spacing steps 2, 4, 8, 12, 16, 24, 32, 48, 64 px in new code (not checked by CI).
- Shared components only in `ui/src/components/ui/`, each with a `*.stories.tsx` beside it; Radix imported nowhere else.
- shadcn sources come from `https://raw.githubusercontent.com/shadcn-ui/ui/c2a67849be260701852b0977ba15eb5f3a0ce2a4/apps/v4/registry/new-york-v4/ui/<name>.tsx` (the CLI cannot reach ui.shadcn.com from this sandbox); rewrite `from "cn"` to `from "@/lib/utils"` and `@/registry/new-york-v4/ui/` to `@/components/ui/`. Never overwrite `button.tsx` or `input.tsx`.
- Storybook packages pinned at exactly `10.6.1`; `typescript.reactDocgen` is `"react-docgen"`, never `"react-docgen-typescript"` (TS 7 has no compiler API).
- Recordings are never destroyed (CONTRIBUTING.md): every end of a removal is "in the Trash" (or the `_deleted` fallback) or "back where it was". Nothing is deleted outright.
- New Python calls are bridge only: never added to the http allow-list in `mediaserver.py`.
- Copy, exact:
  - `“{name}” went to the Trash.` / `… went to the Recycle Bin.` (Windows) / `… moved to the _deleted folder.` (no Trash on the machine); the folder name comes from `fallback_trash`.
  - `{n} false starts went to the Trash.` / `1 false start went to the Trash.` (same three endings).
  - `“{name}” is cropped. The uncut take went to the Trash.` (same three endings).
  - The notice's button `Undo`, with a key chip `⌘Z` (Mac) or `Ctrl+Z`.
  - Python errors: `It has already gone to the Trash.` · `Take {n} is taken by another take now.` · `Its rehearsal is gone.` · `Something else is in its place now: {path}`.
  - Every dialog's cancel button says `Cancel`. `1 take is saved and stays where it is.` / `{n} takes are saved and stay where they are.`
- Tests come first and are seen failing. Commits end with the two attribution lines the session gives; no model names anywhere in the repo.
- Branch `claude/design-system-rules-8v42zg`. The PR opens only after the whole-branch review's findings, minors included, are fixed and pushed; no merge without Alex's word.

## Review Focus

1. **The app quits, crashes or reloads inside the 10 s.** Expected: the item never comes back half-restored and is never lost; at quit it goes to the Trash, after a crash the next start sends it there and removes its cloud copies. Tests in Task 7 ([71] j, k).
2. **Undo after deleting the last take of a past rehearsal.** `list_rehearsals` runs `cleanup_empty_rehearsals` straight after the delete; expected: the rehearsal survives while the Undo waits, and the take comes back into it. Test in Task 7 ([71] h).
3. **Two removals in a row.** Expected: ⌘Z brings back the newest only; the older notice keeps its own Undo; a fourth notice pushing out the oldest counts as that one's end, so its item goes to the Trash. Tests in Task 6 (vitest) and Task 9 (e2e).
4. **⌘Z / Ctrl+Z while typing, with a dialog open, or while recording.** Expected: a text field undoes its own text; with a dialog open or during a take nothing is undone. Tests in Task 6 (`isUndoKey` cases) and Task 9 (e2e).
5. **The rehearsal or the take's song renamed while the Undo waits.** Expected: the take comes back into the rehearsal's new folder, named by the song's new title. Test in Task 7 ([71] i).

## Files

| File | Its one job |
|---|---|
| `ui/src/lib/platform.ts` (modify) | Which system this is, settable for the showcase; its words. |
| `ui/.storybook/main.ts`, `ui/.storybook/preview.tsx` (new) | Storybook on Vite, with theme and system switches. |
| `ui/components.json` (new) | shadcn's config, so `npx shadcn add` works. |
| `ui/src/index.css` (modify) | Every theme value. |
| `ui/src/lib/motion.ts` (new) | Whether motion is off now (Reduce motion, recording). |
| `ui/src/components/ui/button.tsx` (modify) | C1: variants and sizes named for their place. |
| `ui/src/components/ui/kbd.tsx` (new, shadcn) | C5: the one key chip. |
| `ui/src/components/ui/dialog.tsx` (new, shadcn) | C3: frame, title, `DialogButtons` in the system's order, initial focus. |
| `ui/src/components/ui/dropdown-menu.tsx` (new, shadcn) | U4: the set picker's menu. |
| `ui/src/lib/held.ts` (new) | A dialog's text kept while it closes. |
| `ui/src/lib/notices.ts`, `ui/src/components/Notices.tsx` (modify) | C4: a notice with one action, 10 s, above dialogs. |
| `ui/src/hooks/useUndoKey.ts` (new) | ⌘Z / Ctrl+Z runs the newest notice's action. |
| `src/rehearsal_recorder/holding.py` (new) | The holding folder's file mechanics: hold, put back, send on. |
| `src/rehearsal_recorder/store/library.py` (modify) | Snapshot and restore a take's and a rehearsal's rows. |
| `src/rehearsal_recorder/api.py` (modify) | Removals hold instead of trashing; `undo_trash`, `end_trash`; the ends. |
| `ui/src/lib/trash.ts` (new) | `offerUndo`: the notice, its Undo and its end. |
| `ui/src/lib/deletion.ts` (modify) | The words for where things went. |
| `ui/src/components/ui/card.tsx` (modify) | C7: the group. |
| `ui/src/components/ui/play-button.tsx` (new), `ui/src/lib/playLook.ts` (new) | C2: the one small ▶ and its look. |
| `ui/src/components/ui/lane-plate.tsx` (new) | C6: the plate and lane halves of a track. |
| `ui/scripts/design-rules.mjs`, `ui/scripts/design-check.mjs` (new) | K3: the rules and the check. |
| `ui/design-check.allow.json` (new) | Files not yet redone, per rule. |
| `docs/design-system.md` (new) | K1: each rule, its reason, its component. |

## Calls this plan makes

The spec left these to the plan (its "Left to the plan"):

- **Notices stay our own component** with an action added, not Sonner: Sonner's toasts take Escape the way Radix Toast does (the reason `Notices.tsx` is plain markup) and its wrapper needs `next-themes`, which this app does not use.
- **The stored label key stays `"blue"`**, shown as Orange with the orange colour: no migration, and a library opened by an older build still reads it.
- **The record is kept by holding the files** in `<recordings>/_deleting/<token>/` with a `record.json` of the rows, not by flags in the database (option B of `trash-flow.md` §7): no migration, no filter on every read, and nothing outside `_deleting` and the Trash is touched. If the app closes inside the 10 s, the item goes to the Trash then, or at the next start after a crash; only the Undo is lost.
- **The group fills** start from the values in Task 3 and are checked on screenshots of both themes before they are kept.
- **Alex's check (step 3)** runs this branch from source on his computers, as he does, with no branch Release build.
- **The New set dialog** is the Dialog's `tall` size: hung near the top and growing down.

## What this PR leaves to the screen PRs

Each screen's PR (rollout step 4) takes its files off the allow-list and brings, for its screen: the C8 pieces, B4-B9, sizes in rem instead of px (F5's mapping), no `uppercase` (F7), groups on `Card` (C7) with entrances on `animate-rise` (F10), the PlayButton in place of its hand-made ▶ (C2, B3), the neutral "selected" and "on" (F2) including grey MIDI notes, and the three removals B1 names that are not Trash moves: a track off the start screen (start screen PR, with the Check signal fix), a song out of a set (Settings PR), a forgotten old name (History PR). This PR changes every screen only through the theme values, the converted dialogs, key chips and lanes, and the Trash flow.

---

### Task 1: One place that knows the system (P1, P2)

**Files:**
- Modify: `ui/src/lib/platform.ts`, `ui/src/components/PlayerKeys.tsx:6,41`, `ui/src/components/TakeMap.tsx:5,116`, `ui/src/components/EveningFacts.tsx:7,54`, `ui/src/components/UnderTheHood.tsx:272,424-426`, `ui/src/lib/deletion.ts`
- Test: `ui/src/lib/platform.test.ts`, `ui/src/lib/deletion.test.ts`

**Interfaces:**
- Produces:
  - `type System = "mac" | "windows" | "other"`
  - `system(): System` (from `navigator.platform`, unless set)
  - `setSystem(s: System | null): void` (null goes back to the navigator's)
  - `useSystem(): System` (re-renders on `setSystem`, `useSyncExternalStore`)
  - `type Words = { mod: "⌘" | "Ctrl"; undoKey: "⌘Z" | "Ctrl+Z"; fileManager: "Finder" | "Explorer" | "file manager"; folderButton: "Show in Finder" | "Show in Explorer" | "Open folder"; trash: "the Trash" | "the Recycle Bin" }`
  - `words(s: System = system()): Words`
  - in `deletion.ts`: `wentTo(subject: string): string` and `croppedText(name: string): string` (copy in Global Constraints); `trashName()` returns `words().trash` for the system kind.
- `IS_MAC`, `IS_WINDOWS`, `ZOOM_KEY` and `FOLDER_BUTTON` are removed; callers render `words(useSystem())`.

- [ ] **Step 1: Write the failing tests.** `platform.test.ts`: `words("mac")` is `{mod:"⌘", undoKey:"⌘Z", fileManager:"Finder", folderButton:"Show in Finder", trash:"the Trash"}`; `words("windows")` is `{mod:"Ctrl", undoKey:"Ctrl+Z", fileManager:"Explorer", folderButton:"Show in Explorer", trash:"the Recycle Bin"}`; `words("other")` has `mod "Ctrl"`, `folderButton "Open folder"`, `trash "the Trash"`; `setSystem("windows")` makes `system()` say `"windows"` and `setSystem(null)` brings back the navigator's (`"other"` under node). `deletion.test.ts`: with the system kind and `setSystem("windows")`, `wentTo("“Palyn 3”")` is `“Palyn 3” went to the Recycle Bin.`; on `"mac"` it ends `went to the Trash.`; with the folder kind (set through an exported test seam `setDeletionKind({kind:"folder", folder:"_deleted"})`) it is `“Palyn 3” moved to the _deleted folder.`; `croppedText("Palyn 3")` on mac is `“Palyn 3” is cropped. The uncut take went to the Trash.`
- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/platform.test.ts src/lib/deletion.test.ts`. Expected: FAIL (`words` not exported).
- [ ] **Step 3: Implement** the interfaces above, convert the four callers, and make Under the hood's "Recycle Bin" line read `words().trash` and its system check use `system()`.
- [ ] **Step 4: Run** the two tests, then `npm run build` and `npx playwright test e2e/settings.spec.ts e2e/player.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `UI: one place knows which system it is, and its words`.

### Task 2: Storybook and shadcn config (K2, U1)

**Files:**
- Create: `ui/.storybook/main.ts`, `ui/.storybook/preview.tsx`, `ui/components.json`, a story beside each of the nine files in `ui/src/components/ui/` (`badge`, `button`, `card`, `input`, `label`, `popover`, `progress`, `select`, `separator`)
- Modify: `ui/package.json` (scripts, devDependencies `storybook@10.6.1`, `@storybook/react-vite@10.6.1`), `ui/.gitignore` (`storybook-static/`), `ui/tsconfig.node.json` (include `.storybook/**/*.ts*`), `.github/workflows/tests.yml` (interface job)

**Interfaces:**
- Consumes: `setSystem` (Task 1).
- Produces: scripts `"storybook": "storybook dev -p 6006"` and `"build-storybook": "storybook build --quiet --disable-telemetry"`; toolbar globals `theme` (`"dark"` default, `"light"`) and `system` (`"mac"` default, `"windows"`); the decorator toggles `.dark` on `<html>` and calls `setSystem`. Stories are `src/**/*.stories.tsx`, `import type { Meta, StoryObj } from "@storybook/react-vite"`.

- [ ] **Step 1: Write the failing check.** Add the build-storybook step to the interface job of `tests.yml`, right after Vitest: `- name: Showcase` / `run: npm run build-storybook`. Run `cd ui && npm run build-storybook`. Expected: FAIL (no script).
- [ ] **Step 2: Implement.** `main.ts` as in `ci-tooling.md` §5 (stories glob, `framework @storybook/react-vite`, `typescript.reactDocgen "react-docgen"`, `core.disableTelemetry true`); `preview.tsx` imports `../src/index.css` and sets the globals and decorator above. `components.json` as in `ci-tooling.md` §6 (`style "new-york"`, `rsc false`, `tsx true`, `tailwind {config:"", css:"src/index.css", baseColor:"zinc", cssVariables:true, prefix:""}`, `iconLibrary "lucide"`, the five aliases). One story file per existing component, a story per variant and state. Also give the interface job `timeout-minutes: 30` and its "Install the browser" step `timeout-minutes: 10` (that apt step sometimes hangs).
- [ ] **Step 3: Run** `npm run build-storybook` (output in `storybook-static/`, ignored by git) and `npm run build` (type-checks the stories). Expected: both PASS. Open `npm run storybook` once and confirm both toolbar switches change the canvas.
- [ ] **Step 4: Commit** `UI: Storybook showcase and shadcn config; CI builds the showcase`.

### Task 3: Theme values (F1-F11)

**Files:**
- Modify: `ui/src/index.css`, `ui/src/lib/labels.ts`, `ui/src/components/MarksSettings.tsx:31`, `ui/src/screens/Recording.tsx`, `ui/src/components/SongLadder.tsx:91`, `ui/src/components/RehearsalOverview.tsx:185`, `site/src/page/page.css:21`
- Create: `ui/src/lib/motion.ts`
- Test: `ui/src/lib/theme.test.ts`, `ui/src/lib/labels.test.ts`, `ui/e2e/theme.spec.ts`

**Interfaces:**
- Produces:
  - Tokens (both themes): `--primary`, `--ring`, `--primary-foreground` (Global Constraints); `--selected`; `--strong`, `--strong-foreground`; `--destructive-foreground` `oklch(0.985 0 0)`; `--overlay` `oklch(0 0 0 / 0.6)`; `--label-orange` (replaces `--label-blue`); Tailwind colours `selected`, `strong`, `strong-foreground`, `destructive-foreground`, `overlay`, `label-orange`.
  - Group fill (F4): light `--background` `oklch(0.965 0.002 286.3)` with `--card` `oklch(1 0 0)`; light `--panel` `oklch(0.94 0.003 286.3)`; light `--secondary`, `--muted`, `--accent` `oklch(0.935 0.004 286.3)`; dark values stay. These are starting values: Step 4 checks them on screen and may move them, keeping card L minus background L at least 0.03 in both themes.
  - Radii in `@theme inline`: `--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 12px` (drop the `--radius` variable).
  - Body text 14 (`text-sm` on `body`); `.tnum` keeps its name, drops `font-mono` and keeps `tabular-nums` (figures in the system font).
  - Motion: `--ease-smooth: cubic-bezier(.2,.8,.2,1)`, `--default-transition-duration: 200ms`, `--default-transition-timing-function: var(--ease-smooth)`; a utility `animate-rise` (opacity 0 and `translateY(12px)` to none over 250 ms, `--ease-smooth`, `animation-delay: calc(var(--i, 0) * 40ms)`, fill `both`); `animate-in` and `animate-out` run 220 ms. Under `prefers-reduced-motion: reduce`, and under `html[data-recording]`, `animate-rise`, `animate-in` and `animate-out` have `animation: none`.
  - `lib/motion.ts`: `motionOff(): boolean` (Reduce motion, or `data-recording` on `<html>`).
  - `lib/labels.ts`: the stored key stays `"blue"` (no migration); its look uses the `label-orange` classes and `--label-orange`; `colourName(c: LabelColour): string` says `"Orange"` for `"blue"` and capitalises the rest; MarksSettings uses it.
  - Recording.tsx sets `data-recording` on `<html>` while it is mounted and removes it on unmount.

- [ ] **Step 1: Write the failing tests.** `theme.test.ts` reads `src/index.css` as text and asserts: `--primary: oklch(0.56 0.24 266)` appears in `:root` and in `.dark`; `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-xl: 12px`; no `--label-blue`; `--label-orange: oklch(0.68 0.17 48)` and `oklch(0.7 0.17 45)`; in each theme `L(--card) - L(--background) >= 0.03` (parse the first number of each oklch); every `ms` value in the file is at most 400. `labels.test.ts`: `labelLook("blue").cssVar === "--label-orange"`, `colourName("blue") === "Orange"`, `colourName("teal") === "Teal"`. `theme.spec.ts` (Playwright): at scale 1 the body's computed font size is `14px`; `getComputedStyle(html).getPropertyValue("--primary")` is the cobalt string in light and dark; a `.tnum` span's `font-family` does not start with `ui-monospace` and its `font-variant-numeric` is `tabular-nums`; with `page.emulateMedia({ reducedMotion: "reduce" })` an open dialog's content has `animation-name: none`; without it, `animation-duration: 0.22s`.
- [ ] **Step 2: Run** `npx vitest run src/lib/theme.test.ts src/lib/labels.test.ts` and, after `npm run build`, `npx playwright test e2e/theme.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the values above; `SongLadder` and `RehearsalOverview`'s smooth scroll ask `motionOff()`; `page.css:21` becomes `--page-accent: var(--primary);`.
- [ ] **Step 4: Check on screen.** Screenshot Setup, History and Settings in both themes (`ui/e2e` fake bridge, 1180×820) into `/mnt/project-files/design-system/foundation/`; every bordered panel's fill and every hover fill must show against the page in both. Move the light values if one does not, and say which in the commit message.
- [ ] **Step 5: Run** the whole Vitest suite, `npm run build`, the whole Playwright suite and `cd site && npm test && npm run build`. Fix what the new values break in the specs (body text size, `.tnum`, the label colour names); a spec is changed only where it asserted the old value.
- [ ] **Step 6: Commit** `UI: the decided theme: cobalt, neutral selected and strong, orange label, radii 4/8/12, body 14, smooth motion`.

### Task 4: Button and Kbd (C1, C5)

**Files:**
- Modify: `ui/src/components/ui/button.tsx`, every caller of a renamed size, `ui/src/components/StopTake.tsx`, `ui/src/components/Shell.tsx:153` (its `Kbd` goes), `ui/src/components/PlayerKeys.tsx` (`kbdClass`), `ui/src/screens/HistoryScreen.tsx:1059-1060`, the SongKeys `KEY` chip, the four users of Shell's `Kbd` (StopTake, Review, Setup, Rehearsal)
- Create: `ui/src/components/ui/kbd.tsx` (from shadcn `kbd`), `ui/src/components/ui/kbd.stories.tsx`
- Test: `ui/src/components/ui/button.test.ts`, `ui/src/components/ui/button.stories.tsx`

**Interfaces:**
- Produces:
  - `Button` variants: `default` (accent), `strong` (`bg-strong text-strong-foreground`), `destructive` (`bg-destructive text-destructive-foreground`, full colour in both themes), `outline`, `ghost`, `link` (text colour, thin underline, one hover). `secondary` goes (no callers). Filled variants are `font-semibold`, the rest `font-normal`. Every size is `rounded-md` except `lane`.
  - Sizes: `default` (h-9), `row` (was `sm`, h-8), `footer` (was `xl`, h-14), `footer-aside` (was `lg`, h-10), `icon` (size-9), `icon-row` (was `icon-sm`, size-8), `icon-tiny` (was `icon-xs`, size-6), `player` (was `icon-lg`, size-10), `lane` (new: size-5, `text-xs`, `rounded-sm`). `xs` goes. `tsc -b` finds every caller of a renamed size.
  - `Kbd({ children, className })` and `KbdGroup`: a chip in the current colour (`border-current/30 bg-current/10`), `rounded-sm`, `text-xs`, `font-sans`, weight 400, so it reads on a filled button too.
  - StopTake's Stop is `variant="strong" size="footer"` (F2).

- [ ] **Step 1: Write the failing test.** `button.test.ts` calls `buttonVariants`: `destructive` contains `text-destructive-foreground` and not `/60`; `default`, `strong` and `destructive` contain `font-semibold`; `outline`, `ghost` and `link` contain `font-normal`; size `lane` contains `size-5` and `rounded-sm`; size `footer` contains `rounded-md`; `strong` contains `bg-strong`.
- [ ] **Step 2: Run** `npx vitest run src/components/ui/button.test.ts`. Expected: FAIL. (Vitest's include gets `src/**/*.test.ts`, which already covers this path.)
- [ ] **Step 3: Implement** the variants and sizes, rename the callers, add `kbd.tsx` from the pinned shadcn source restyled as above, and replace the four hand-made chips with `Kbd` (`Kbd` text for ⌘/Ctrl comes from `words(useSystem()).mod`). Stories: every variant at every size, disabled, with an icon, with a `Kbd`; `Kbd` alone, in a group, on a filled button, in both systems.
- [ ] **Step 4: Run** `npm run build`, the Vitest suite, `npm run build-storybook` and the Playwright suite. Expected: PASS (fix specs that read a chip's class only where they asserted it).
- [ ] **Step 5: Commit** `UI: Button sizes named for their place, a strong Stop, one Kbd`.

### Task 5: Dialog, popover and menu (C3, P3, U4, B2 wording)

**Files:**
- Create: `ui/src/components/ui/dialog.tsx` (shadcn `dialog`), `ui/src/components/ui/dropdown-menu.tsx` (shadcn `dropdown-menu`), their stories, `ui/src/lib/held.ts`
- Modify: `ui/src/components/ConfirmDialog.tsx` (ConfirmDialog, PromptDialog, RenameTakeDialog), `MarkerDialog.tsx`, `ShareDialog.tsx`, `PlayerKeys.tsx`, `RenameSongDialog.tsx`, `SetPicker.tsx` (New set dialog and its menu), `ActivityButton.tsx` (onto `ui/popover`), the Finish dialog (`screens/Rehearsal.tsx:562-574`), `lib/format.ts` (the saved line), `MarksSettings.tsx:283`, `SetsSettings.tsx:146`, `lib/songs.ts:165`, `hooks/useSpacebar.ts` (its doc on Enter)
- Test: `ui/src/lib/held.test.ts`, `ui/src/lib/format.test.ts`, `ui/e2e/dialogs.spec.ts`

**Interfaces:**
- Consumes: `useSystem` (Task 1), `Button` (Task 4).
- Produces:
  - `DialogContent` props add `size?: "default" | "narrow" | "tall"` (`max-w-md`; `max-w-sm`; `max-w-md` hung from `top-[12vh]` and growing down, for New set) and default `showCloseButton={false}` (no ✕, as today). Frame: `rounded-xl border bg-card`, overlay `bg-overlay`, title `text-base font-semibold`, 220 ms in and out.
  - `DialogButtons({ cancel = "Cancel", action, aside, irreversible = false })`: `action` is a node (the action `Button`); `aside` sits at the far left (Delete marker, Remove from the cloud). On the Mac the order is `[aside] … Cancel, action`; on Windows `[aside] … action, Cancel`. It marks the button that gets focus when the dialog opens: the action, or Cancel when `irreversible`.
  - `DialogContent`'s `onOpenAutoFocus` focuses an element with `autoFocus` if there is one, else the marked button; so Enter presses the action, or Cancel where nothing can be undone.
  - `held<T>(last: T, current: T | null | undefined): T` and `useHeld<T>(current: T | null | undefined, initial: T): T` keep a dialog's text while it closes.
  - `ConfirmDialog({ open, onOpenChange, title, description, actionLabel, destructive = true, onConfirm })` is the question where nothing can be undone (B2): always `irreversible`, `cancelLabel` gone.
  - `savedLine(n: number): string` in `lib/format.ts`: `1 take is saved and stays where it is.` / `{n} takes are saved and stay where they are.`
  - Titles quote names: `Delete “{label}”?`, `Delete “{set}”?`, `Merge “{a}” into “{b}”?`.

- [ ] **Step 1: Write the failing tests.** `held.test.ts`: `held("Delete “A”?", null)` is the last; `held("x", "y")` is `"y"`. `format.test.ts`: `savedLine(1)` and `savedLine(3)` as above. `dialogs.spec.ts`: (a) Esc on the rehearsal screen with takes opens the Finish dialog with focus on `Cancel`; Enter closes it and the screen stays; its buttons read `Cancel` and `Finish` and its text says `2 takes are saved`; (b) Rename rehearsal: typing a name and Enter renames; (c) Mac order: the Finish button's box is right of Cancel; with an init script setting `navigator.platform` to `Win32`, it is left of Cancel; (d) the Delete label dialog's title is `Delete “Fix”?` (quotes); (e) no element outside `[data-slot="dialog-content"]` has `role="dialog"` while each of the converted dialogs is open (open each once: Finish, Remove from history, rename take, marker, share, player keys, rename song, new set, delete label, delete set, merge).
- [ ] **Step 2: Run** the vitest files and, after `npm run build`, `npx playwright test e2e/dialogs.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `dialog.tsx` and `dropdown-menu.tsx` from the pinned shadcn sources (restyled to the theme), `held.ts`, `DialogButtons`, and convert every dialog listed under Files onto them, every cancel to `Cancel`, every action to a verb. `ActivityButton` moves onto `components/ui/popover`; SetPicker's menu onto `dropdown-menu`. After this, `grep -rn 'from "radix-ui"' ui/src --include=*.tsx` lists only `components/ui/`. Stories: Dialog in each size, irreversible and not, with an aside, both systems; DropdownMenu.
- [ ] **Step 4: Run** `npm run build`, Vitest, `npm run build-storybook` and the whole Playwright suite. Update the specs that clicked `Keep going`, `Keep it` or `Keep it all` or read the old saved line; the Trash questions still exist until Task 9.
- [ ] **Step 5: Commit** `UI: one Dialog in the system's button order; Enter acts unless nothing can be undone`.

### Task 6: Notices with an action, and ⌘Z (C4)

**Files:**
- Modify: `ui/src/lib/notices.ts`, `ui/src/components/Notices.tsx`, `ui/src/hooks/useSpacebar.ts` (export `isTyping`), `ui/src/App.tsx` (mount the hook)
- Create: `ui/src/hooks/useUndoKey.ts`
- Test: `ui/src/lib/notices.test.ts`, `ui/e2e/notices.spec.ts`

**Interfaces:**
- Produces:
  - `notify({ key, kind, text, action?: { label: string; run: () => void }, onGone?: () => void })`; `Notice` gains `action?` and `onGone?`.
  - `ACTION_MS = 10000`: a notice with an action leaves after 10 s whatever its kind; hover pauses it as it pauses the others.
  - `onGone` runs exactly once when the notice leaves without its action running: timed out, closed with ✕, `dismiss`/`dismissNotice`, replaced under the same key, or pushed out past `MAX_NOTICES`. Running the action removes the notice and does not call `onGone`.
  - `runAction(id: number): void` and `undoLatest(): boolean` (runs the newest notice's action; false when none has one).
  - `isUndoKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, s: System): boolean` in `useUndoKey.ts` (⌘Z on the Mac, Ctrl+Z elsewhere; not with Shift or Alt).
  - `useUndoKey()`: on keydown, when `isUndoKey` and not `isTyping(document.activeElement)`, not with a `[role="dialog"]` open, and not with `data-recording` on `<html>`, calls `undoLatest()` and `preventDefault()` when it ran something.
  - Notices sit at `z-[60]`, above the dialog overlay; the action is a `Button variant="outline" size="row"` reading `Undo` with a `Kbd` of `words().undoKey`.

- [ ] **Step 1: Write the failing tests.** `notices.test.ts` (fake timers not needed; the store has no timers): an `onGone` spy is called once on `dismissNotice`, once on replacement by the same key, once on eviction by a fourth notice, and not on `runAction`; `undoLatest()` runs the newest notice's action (two notices with actions: the second runs, the first stays) and returns false with none; `isUndoKey` is true for `{key:"z", metaKey:true}` on mac and `{key:"z", ctrlKey:true}` on windows, false for Ctrl+Z on mac, for Shift+⌘Z, and for `"Z"` with Alt. `notices.spec.ts` adds: a notice with an action stays at 9 s and is gone at 11 s (Playwright clock); hovering at 9 s keeps it past 11 s; while a dialog is open a notice is on top (`document.elementFromPoint` at its centre is inside it).
- [ ] **Step 2: Run** the vitest file and the Playwright file. Expected: FAIL.
- [ ] **Step 3: Implement**, keeping the existing comments' points (Escape takes no part; the corner takes no clicks).
- [ ] **Step 4: Run** Vitest, `npm run build`, the notices spec and the whole Playwright suite. Expected: PASS.
- [ ] **Step 5: Commit** `UI: a notice can carry one action for 10 s, above dialogs; ⌘Z or Ctrl+Z runs the newest`.

### Task 7: Python: removals wait in a holding folder, with Undo (B1)

**Files:**
- Create: `src/rehearsal_recorder/holding.py`
- Modify: `src/rehearsal_recorder/store/library.py`, `src/rehearsal_recorder/api.py` (`delete_take` 3521, `delete_takes` 3550, `delete_rehearsal` 3563, `discard_take` 2405, `discard_draft` 2527, `shutdown` 566, start after `_open_library` ~554, `set_recordings_dir` 970, `cleanup_empty_rehearsals` 1914, `locate_rehearsal` 3596, `keep_take`)
- Test: `tests/test_store.py` (new [17]), `tests/test_engine.py` (new [71]; change [17], [59], [11m], [5c]; twins of [16b] and [23])

**Interfaces:**
- Produces, in `holding.py` (file mechanics only, no database):
  - `HOLDING_DIR = "_deleting"`, `RECORD_FILE = "record.json"`, `STALE_SEC = 120`.
  - `hold(recordings: Path, record: dict, paths: list[Path]) -> str`: a new short token (8 hex characters, Windows paths are short), moves each path into `<recordings>/_deleting/<token>/<i>/` (a rename on the same drive), writes `record.json` with the record, the moved items (where each came from, relative to the recordings folder) and the time; a failed move puts back what moved, removes the entry and raises `OSError`.
  - `read(recordings, token) -> dict | None`; `tokens(recordings) -> list[str]`.
  - `put_back(recordings, token, places: list[Path]) -> None`: moves item i to `places[i]`; refuses before moving anything when a place is taken (`FileExistsError`); removes the entry.
  - `send_on(recordings, token, trash) -> dict`: `trash(path, recordings)` for each item (the caller passes `api.move_to_trash`, which tests patch), then removes the entry; `{ok: True}`, or `{ok: False, error}` leaving the entry for the next start.
- Produces, in `Library`:
  - `take_record(folder: str, take_number: int) -> dict`: every column of the take, its song's id and title, its `take_file` rows (paths relative), its markers (label id, note, time, every column) and its `cloud_copy` row.
  - `restore_take(record: dict) -> None`: re-inserts in one transaction into the rehearsal with the record's id (its folder may have changed); the song by id if it still exists, else the song now holding that title (or old name), else a new one; the stored go when it is free for that song, else the next; a marker whose label is gone keeps no label. Raises `ValueError("Take {n} is taken by another take now.")` or `ValueError("Its rehearsal is gone.")`.
  - `rehearsal_record(folder: str) -> dict` and `restore_rehearsal(record: dict) -> None`: the rehearsal row, its tracks, set name and songs, and every take as above.
- Produces, in `Api`:
  - `delete_take(folder, n) -> {ok, undo, takes_left, error?}`; `delete_takes(folder, numbers) -> {ok, deleted, failed, undo}` (one token for all); `delete_rehearsal(folder) -> {ok, undo, error?}`; `discard_take(temp_dir)` and `discard_draft(draft_dir) -> {ok, undo, error?}`. `trashed` and `location` leave these answers.
  - `undo_trash(token) -> {ok, kind, folder?, take_numbers?, temp_dir?, error?}` with `kind` one of `"take"`, `"takes"`, `"rehearsal"`, `"draft"`, `"crop"`; an unknown token answers `{ok: False, error: "It has already gone to the Trash."}`; after re-inserting a take it calls `_enqueue_publish` for it.
  - `end_trash(token) -> {ok, error?}`: `send_on` plus `_remove_shared` for the cloud paths in the record (cloud removal is deferred to here).
  - The ends: `shutdown` ends every entry before the library closes; start ends every entry left in `_deleting` (a crash); `set_recordings_dir` ends every entry before switching; each new hold first ends entries older than `STALE_SEC`, and entries of the same item (a take: its earlier entries, crop included; a rehearsal: every entry of its takes and drafts; a draft: its crop entries; `keep_take` of a draft: that draft's crop entries).
  - Guards: `cleanup_empty_rehearsals` skips a rehearsal with a take waiting in an entry; `locate_rehearsal` refuses `_deleting` and anything under it; `_deleting` is never inside a rehearsal or `_drafts`.
  - A failed move into holding answers `{ok: False, error}` and leaves the row and the files where they were (fixes today's `delete_take`, which drops the row when the move fails).
  - `undo_trash` and `end_trash` are bridge only.

- [ ] **Step 1: Write the failing store tests**, `[17] A take and a rehearsal come back whole` in `test_store.py`: `take_record` then `delete_take` then `restore_take` gives the same `take()` dict (name, go, song, ★, duration, audio and notes files, markers with label and note, cloud copy, cloud flags); the song renamed in between: the take comes back under the new title with its go; its label deleted in between: the marker comes back with no label; the number taken in between: `ValueError` with the exact text; `rehearsal_record`, `forget_rehearsal`, `restore_rehearsal`: the same `rehearsal()` dict, tracks, set and every take.
- [ ] **Step 2: Run** `python tests/test_store.py`. Expected: the new checks FAIL.
- [ ] **Step 3: Implement** the four Library calls. **Run** `python tests/test_store.py`. Expected: PASS.
- [ ] **Step 4: Write the failing engine tests**, `[71] Undo instead of asking` in `test_engine.py`, with `apimod.move_to_trash` patched to record its calls:
  - a. `delete_take` answers an `undo`; the take's folder is under `_deleting/<token>/`; `get_rehearsal` no longer lists it; nothing went to the Trash.
  - b. `undo_trash` brings it back: same paths, same bytes, name, ★, marks, notes files and cloud copy row; `kind == "take"`.
  - c. `end_trash` calls the Trash once per folder, removes the entry, and only now takes the cloud copy out.
  - d. `delete_takes` of three answers one token; Undo brings all three back.
  - e. `delete_rehearsal`; Undo: the rehearsal is listed again with its tracks, set and takes; `end_trash` instead: the whole folder goes to the Trash and the cloud copies with it.
  - f. `discard_take` and `discard_draft`: Undo puts the folder back at `_drafts/take N`; `list_drafts` shows the Drafts one again.
  - g. The second of two folders refuses to move: `{ok: False}`, the row is still there, both folders are where they were.
  - h. The last take of a past rehearsal deleted, then `list_rehearsals` (which cleans up): the rehearsal is still there; Undo brings the take back into it; `end_trash` and `list_rehearsals` then clean it up as today.
  - i. The rehearsal renamed and the song renamed while the entry waits: Undo puts the take into the new folder, under the new title.
  - j. `shutdown` with an entry waiting: it went to the Trash; `_deleting` is empty.
  - k. A fresh `Api` over a recordings folder holding a leftover entry with a cloud path in its record: at start the entry goes to the Trash and the cloud copy is removed.
  - l. `set_recordings_dir` with an entry waiting: it goes to the Trash before the switch.
  - m. An entry older than `STALE_SEC` (its time written back in `record.json`) goes to the Trash at the next hold.
  - n. `undo_trash` of an ended token: `It has already gone to the Trash.`
  - o. `_deleting` is not counted in a rehearsal's size, not taken for a rehearsal by `locate_rehearsal`, not listed by `list_drafts`.
  - Change `[5c]` to list `undo_trash` and `end_trash` among the calls the http route refuses; `[17]` to `undo` in the answer and the folder under `_deleting`; `[59]` to the answer with `undo`; `[11m]` to the copy leaving at `end_trash`.
- [ ] **Step 5: Run** `python tests/test_engine.py`. Expected: the new and changed checks FAIL.
- [ ] **Step 6: Implement** `holding.py` and the Api changes above, all under `self._files_lock`, releasing the player in a folder before moving it, as now.
- [ ] **Step 7: Run** `python tests/run_all.py`. Expected: PASS.
- [ ] **Step 8: Commit** `Engine: removals wait in _deleting with an Undo, and reach the Trash when the notice ends`.

### Task 8: Python: Undo a crop (B1)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`_crop_tracks` 3082, `crop_take` 3204, `crop_draft` 3301), `ui/src/lib/format.ts` (`croppedButNotSwept` goes when it has no caller)
- Test: `tests/test_engine.py` (new [72]; change [19], [68])

**Interfaces:**
- Consumes: `holding.hold`, `put_back`, `send_on` and the ends (Task 7).
- Produces: `crop_take` and `crop_draft` answer `undo` (no `trashed`, `location`). The "(before crop)" folder is held instead of trashed; the record keeps, for a saved take, the markers before the crop (dropped ones included), `duration_sec`, and the cloud shape `had`. `undo_trash` of a crop entry sends the cropped files to the Trash, puts every original back (WAVs, .mid, a `.midraw`, the clock and `take.json` if there were any), and for a saved take restores the markers (a mark added since the crop at t comes back at t + start), the duration, and the cloud copy (`_remove_shared` of the cropped copy, then `_queue_copy(folder, n, had)`); it answers `kind "crop"` with `folder` and `take_numbers`, or `temp_dir` for a draft. `end_trash` sends the uncut take on.

- [ ] **Step 1: Write the failing tests**, `[72] A crop can be undone`: (a) after `crop_take` the uncut folder is under `_deleting/<token>/`, not beside the take and not in the Trash; (b) Undo: every original is back with its bytes, the cropped files went to the Trash, the markers are the pre-crop list including those outside the region, a mark added after the crop at 2.0 s is back at 2.0 + start, the duration is back; (c) a take in the cloud: Undo takes the cropped copy out and queues the whole take again; (d) `end_trash` sends the uncut folder to the Trash; (e) `crop_draft` with notes: Undo puts the draft's WAVs and .mid back. Change `[19]` and `[68]` from "originals leave as one folder" and "location is the aside dir when the sweep fails" to the held folder, and drop the sweep-failure case that can no longer happen.
- [ ] **Step 2: Run** `python tests/test_engine.py`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python tests/run_all.py` and, in `ui/`, `npx vitest run` (after dropping `croppedButNotSwept` and its test). Expected: PASS.
- [ ] **Step 5: Commit** `Engine: a crop can be undone; the uncut take waits until its notice ends`.

### Task 9: Undo in the interface (B1)

**Files:**
- Create: `ui/src/lib/trash.ts`, `ui/e2e/undo.spec.ts`
- Modify: `ui/src/lib/api.ts` (`DeleteResult` 617 and the calls at 867-1045), `ui/src/screens/Rehearsal.tsx`, `ui/src/screens/HistoryScreen.tsx`, `ui/src/components/EveningActions.tsx`, `ui/src/screens/Review.tsx`, `ui/src/screens/DraftsScreen.tsx`, `ui/src/components/TakePlayer.tsx`, `ui/src/App.tsx`, `ui/src/hooks/useSpacebar.ts` (`useEscape`'s doc), `ui/src/lib/deletion.ts` (drop what has no caller), `ui/e2e/fake-bridge.js`, the specs listed in Step 4, `docs/using-it.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `notify` with `action`/`onGone` (Task 6), `wentTo`, `croppedText` (Task 1), the Api answers (Tasks 7, 8).
- Produces:
  - `api.ts`: `DeleteResult = { ok: boolean; error?: string; undo?: string; takes_left?: number }`; `UndoResult = { ok: boolean; error?: string; kind?: "take" | "takes" | "rehearsal" | "draft" | "crop"; folder?: string; take_numbers?: number[]; temp_dir?: string }`; `undo_trash(token): Promise<UndoResult>`; `end_trash(token): Promise<{ ok: boolean; error?: string }>`.
  - `offerUndo({ text, token, onUndone }: { text: string; token: string; onUndone: (r: UndoResult) => void }): () => void`: a `done` notice under key `undo:{token}` with the action `Undo`; the action calls `undo_trash` and then `onUndone`, or shows its `error` as an error notice; `onGone` calls `end_trash` and shows a failure as an error notice. It returns a function that ends the offer (dismisses the notice).
  - The six removals no longer ask: delete a take (rehearsal screen; History's strip, overview and song page), delete a rehearsal, clear false starts, discard on Review (the button and Esc), discard in Drafts, crop (Rehearsal, History, Review). Each says its line from Global Constraints with the take's, rehearsal's or draft's name as its list shows it.
  - Undo puts the screen back: the list refreshes and a take comes back in its place; on Review, App keeps the discarded take (name, marks, cloud answer) and re-enters Review with it; Drafts reopens if it closed because its last draft went; on Review a crop's Undo puts back the take and marks Review kept from before the crop.
  - Ends the UI calls early: starting a take or finishing the rehearsal ends a Review discard's offer; Save or Discard on Review ends that take's crop offer.

- [ ] **Step 1: Write the failing e2e tests**, `undo.spec.ts`: (a) deleting a take in History asks nothing, the row goes, the notice reads `“Palyn 5” went to the Trash.` with `Undo`, and Undo brings the row back with its name and star; (b) Ctrl+Z (⌘Z with a Mac init script) does the same; (c) with focus in the take name field Ctrl+Z does not bring the take back; (d) two deletions: Ctrl+Z brings back the second, the first's notice still offers Undo; (e) after 10 s the notice goes and `end_trash` was called for its token (the fake bridge records calls); (f) clear false starts: `2 false starts went to the Trash.`, Undo brings both back; (g) Esc on Review leaves Review, and Undo opens it again with the name that was typed; (h) crop asks nothing, the notice reads `“Palyn 5” is cropped. The uncut take went to the Trash.`, Undo gives back the take's old length; (i) with `navigator.platform` `Win32` the text ends `went to the Recycle Bin.`; with `__TRASH_KIND__ = "folder"` it ends `moved to the _deleted folder.`; (j) delete a rehearsal: Undo lists it again; (k) with the Rename take dialog open, Ctrl+Z brings nothing back; (l) during a take (the recording screen) Ctrl+Z brings nothing back.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/undo.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The fake bridge's removals return an `undo` token and keep what they removed by token; `undo_trash` puts it back (in the live session too: today `delete_take` there does not remove the take from `session.takes`, fake-bridge.js:1397); `end_trash` forgets it and records the call.
- [ ] **Step 4: Update the specs** that went through the six questions (each one now checks the notice and the Undo instead of the dialog): `evening.spec.ts` 152-252, `history.spec.ts` 153-168 and 263-277, `songs.spec.ts` 306-350 and 653-672, `cloud.spec.ts` 63-67, `player.spec.ts` 76-185, 299-317 and 915-975, `review.spec.ts` 163-209, `background.spec.ts` 218-259, `midi-player.spec.ts` 487-508, `settings.spec.ts` 294-313, `song-keys.spec.ts` 214-232 (it needs another dialog to be open: use Rename take), `naming.spec.ts` 224-265.
- [ ] **Step 5: Run** the whole Playwright suite, Vitest and `npm run build`. Expected: PASS.
- [ ] **Step 6: Docs.** `docs/using-it.md`: deleting, discarding and cropping happen at once and can be undone for 10 s with Undo or ⌘Z / Ctrl+Z. `CHANGELOG.md` Unreleased: the same in one line.
- [ ] **Step 7: Commit** `UI: deleting, discarding and cropping happen at once, with Undo for 10 s`.

### Task 10: Card as the group, and the small player (C7, C2)

**Files:**
- Modify: `ui/src/components/ui/card.tsx`, `ui/src/components/ui/card.stories.tsx`
- Create: `ui/src/components/ui/play-button.tsx`, `ui/src/components/ui/play-button.stories.tsx`, `ui/src/lib/playLook.ts`
- Test: `ui/src/lib/playLook.test.ts`

**Interfaces:**
- Produces:
  - `Card`: `rounded-xl bg-card text-card-foreground p-4`, no border and no shadow (F4); its header, title and content follow (title `text-base font-semibold`). Screens set their own air with `className`.
  - `type PlayLook = "idle" | "loading" | "playing" | "paused" | "failed" | "missing"`.
  - `playLook({ loaded, playing, loading, failed, missing }: { loaded: boolean; playing: boolean; loading: boolean; failed: boolean; missing: boolean }): PlayLook`: `missing` wins, then `failed`, then `loading`, then `playing`, then `paused` when loaded, else `idle`.
  - `PlayButton({ look, size = "row", name, onClick, ...button })`: round, `size "row"` 32 px with a 14 px icon, `size "head"` 48 px with a 20 px icon; thin border and a hover fill when idle; accent fill and border when `playing` or `paused`; `loading` shows the ▶ for its first second, then a spinner in its place (B5); `failed` shows an alert icon in the danger colour and stays pressable (it tries again), label `Could not load {name}. Try again`; `missing` cannot be pressed, label `{name} is not on disk`; `playing` reads `Pause {name}`, the rest `Play {name}`; the shared focus ring.

- [ ] **Step 1: Write the failing test.** `playLook.test.ts`: the six outcomes above, including `missing` beating `playing` and `failed` beating `loading`.
- [ ] **Step 2: Run** `npx vitest run src/lib/playLook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both components. Stories: Card on the page in both themes with a group heading and a row; PlayButton in all six looks at both sizes, hovered and focused, both themes.
- [ ] **Step 4: Run** Vitest, `npm run build`, `npm run build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `UI: Card is the group; one small player with its six looks`.

### Task 11: Track lanes at 56 px (C6)

**Files:**
- Create: `ui/src/components/ui/lane-plate.tsx`, `ui/src/components/ui/lane-plate.stories.tsx`
- Modify: `ui/src/components/Timeline.tsx` (23-24, 310-317, 489, 510-511, 558, 582), `ui/src/components/LaneControls.tsx` (the plate ~166, the Mono/Stereo line ~181, M and S, `MasterControls`), `ui/src/components/midi/NotesPlate.tsx`, `ui/src/components/Shell.tsx:119,125`, `ui/src/index.css` (`--screen-pad-y`)
- Test: `ui/e2e/player.spec.ts` (588-613), `ui/e2e/midi-player.spec.ts` (128-158, 447-482), new checks in `ui/e2e/lanes.spec.ts`

**Interfaces:**
- Consumes: `Button size="lane"` (Task 4), `Separator`.
- Produces:
  - `laneHalf(half?: "top" | "bottom"): string`: the classes of a track's plate or lane box: `rounded-lg bg-card`, no border; `"top"` drops the bottom corners; `"bottom"` drops the top corners and draws a 1 px top line in `--border` (the `Separator`'s look). One way for the plates and the lanes of a Both track (today three).
  - `LanePlate({ half, className, children, ...div })`: a `div` with `laneHalf(half)` and the plate's padding, used by the audio plate, `NotesPlate` (now a variant of it) and the master's plate.
  - `LANE_PX = 56` replaces `LANE_MIN_PX` and `LANE_MAX_PX`; an audio row is 56 px; a notes row grows to its plate.
  - The audio plate has no Mono or Stereo line; M and S are `size="lane"` (20 px, `text-xs`, `rounded-sm`), 6 px apart.
  - `--screen-pad-y: 1.5rem` on `:root`; Shell's `main` pads by it; the master's sticky edge is `bottom: calc(-1 * var(--screen-pad-y))` instead of `-bottom-6`.

- [ ] **Step 1: Write the failing tests.** `lanes.spec.ts`: with four tracks every audio lane and its plate are 56 px tall; M and S are 20×20 and at least 4 px apart; a plate's `border-top-width` is `0px` and its background is the card colour; a Both track's two plate halves touch, the lower one with a solid 1 px top line; the master stays at the window's bottom edge while the page scrolls with eight tracks. Change `player.spec.ts:588-589` to expect no `Mono` or `Stereo`, `:613` to 56, `midi-player.spec.ts:447-482` to "audio lanes keep their 56 px" and `:128-158` from dashed to solid.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/lanes.spec.ts e2e/player.spec.ts e2e/midi-player.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Stories: LanePlate single, top and bottom halves, with a notes variant, both themes.
- [ ] **Step 4: Run** the whole Playwright suite, `npm run build`, `npm run build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `UI: track lanes at 56 px with M and S at 20; one plate for audio and notes`.

### Task 12: The design check (K3)

**Files:**
- Create: `ui/scripts/design-rules.mjs`, `ui/scripts/design-check.mjs`, `ui/scripts/design-rules.test.mjs`, `ui/design-check.allow.json`
- Modify: `ui/package.json` (`"design-check": "node scripts/design-check.mjs"`), `ui/vite.config.ts` (Vitest `include` adds `scripts/**/*.test.mjs`), `.github/workflows/tests.yml` (a step right after Install: `npm run design-check`), whatever in `components/ui/` the check finds
- Test: `ui/scripts/design-rules.test.mjs`

**Interfaces:**
- Produces:
  - `checkText(path: string, text: string): { rule: string; line: number; text: string }[]` and `RULES` in `design-rules.mjs`. Paths are relative to `ui/`; only `src/**/*.tsx` is checked, stories included.
  - Rules:
    - `px-text`: `text-[…px]`, or a `fontSize` in a style.
    - `text-size`: `text-lg`, `text-3xl` and up, or `text-[…rem]` / `text-[…em]`.
    - `raw-colour`: a Tailwind palette colour (`red`, `amber`, `zinc` … with a shade, or `white` / `black`) after a colour utility (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, `from-`, `to-`, `via-`, `outline-`, `decoration-`, `shadow-`, `divide-`, `caret-`, `accent-`, `placeholder-`); an arbitrary `[#…]`, `[rgb(…)]`, `[hsl(…)]` or `[oklch(…)]`; a hex or `oklch(` / `rgb(` literal in the code.
    - `radius`: `rounded-xs`, `rounded-2xl` and up, or `rounded-[…]`, on any side.
    - `uppercase`: the `uppercase` class.
    - `raw-button`: `<button` outside `src/components/ui/`.
    - `radix`: an import from `radix-ui` or `@radix-ui/…` outside `src/components/ui/`.
    - `dialog`: `role="dialog"` or `<dialog` outside `src/components/ui/`.
    - `story`: a `src/components/ui/X.tsx` with no `X.stories.tsx` beside it.
  - A line is exempt from one rule when it, or the line above it, holds `design-ok(<rule>): <reason>` with a reason; for graphics (1-2 px bars, ticks) and sizes taken from the window (the recording clock, the tiles), which F5 and F9 keep.
  - `design-check.allow.json`: `{ "<path>": ["<rule>", …] }`. The check fails on a finding whose file and rule are not listed, and on a listed pair with no finding left (so the list only shrinks), and prints each as `path:line rule text`.

- [ ] **Step 1: Write the failing tests.** `design-rules.test.mjs`, one case per rule, each with a line that trips it and a near miss that does not (`text-sm`, `bg-primary/20`, `rounded-md`, `rounded-t-lg`, `"capitalize"`, `<Button`, an import of `@/components/ui/dialog`); a `design-ok(radius): graphic` comment above a `rounded-[1px]` exempts it, one with no reason does not; a stale allow-list pair is reported.
- [ ] **Step 2: Run** `npx vitest run scripts/design-rules.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** both scripts. Run the check, fix every finding in `src/components/ui/` (no `ui/` file goes on the allow-list), mark the window-sized text and the graphics with `design-ok`, and write the rest into `design-check.allow.json` as it stands.
- [ ] **Step 4: Run** `npm run design-check` (PASS), then add `text-lg` to a story and see it FAIL with the line, and take it out again.
- [ ] **Step 5: Commit** `UI: CI refuses what breaks the design rules; screens not yet redone are on an allow-list`.

### Task 13: The rules document, and the whole branch (K1)

**Files:**
- Create: `docs/design-system.md`
- Modify: `CHANGELOG.md`, `CONTRIBUTING.md` (a line pointing at the document and `npm run storybook`)

- [ ] **Step 1: Write `docs/design-system.md`**: each rule of the spec in a line or two with its reason and the component or token that carries it (F1-F11, P1-P3, C1-C8, U1-U5, B1-B9, K1-K3), how to add a shadcn component (`npx shadcn add <name>` in `ui/`, then `from "cn"` back to `@/lib/utils`, never overwrite `button.tsx` or `input.tsx`), how to run the showcase and the check, and what `design-ok` is for.
- [ ] **Step 2: CHANGELOG** Unreleased, in the project's voice: the new look's foundation (cobalt, calmer type, more rounded corners, lower track lanes), Undo, dialogs in the system's order and words.
- [ ] **Step 3: Run everything**: `python tests/run_all.py`; in `ui/`: `npm run design-check`, `npm run build`, `npx vitest run`, `npm run build-storybook`, `npx playwright test`; in `site/`: `npm test`, `npm run build`, `npx playwright test`. Expected: all PASS.
- [ ] **Step 4: Commit** `Docs: the design system's rules, in one place`.
- [ ] **Step 5: Whole-branch review**, every finding fixed (minors included), then the PR. Its body lists what Alex checks on his own Mac and Windows computers before the first screen's PR (rollout step 3: the system font, even-width figures, the motion in each system's web view, the recording clock read from 3-5 m); he runs the branch from source as usual, with no branch Release build. Ask Alex before merging.
