# A Lighter Right Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The band service's panel keeps a take and a mark only; a song opens its page, the three editors open in place, a take's page gets a drawer that folds into a strip, and on a phone a take opens its page.

**Architecture:** All in `service/src` (React, TanStack Router). The panel stays in the address (`?panel=`); its kinds become `take`, `mark` and a new `marks`. Editors are kept in the address too (`?edit=` on **Songs** and **Marks**). On a computer, a take's page renders a `Drawer` in place of the panel: a 48 px strip in the row beside the page, and over it, when the address has a panel, the same panel body as elsewhere.

**Tech Stack:** React 19, TanStack Router, Tailwind 4, lucide-react, shadcn components from `ui/src`; Playwright page tests against a local Worker (`service/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-08-service-right-panel-design.md`

## Global Constraints

- Service only: nothing in `src/rehearsal_recorder`, `ui/src` or `service/worker` changes.
- The strip is 48 px wide (`w-12`), full height, `bg-side`, with a left border; the open drawer is the panel's own box: `w-[28rem] max-w-[calc(100%-3rem)]`, over the page.
- The strip's names: “Open the panel” (top sign, `PanelRightOpen`), “Marks: N” (diamond, `Diamond`, N = all the take's marks); the fold sign: “Fold the panel” (`PanelRightClose`).
- The drawer is on a computer only (`useSize() !== "phone"`), on `/takes/$uid`; the page opens folded.
- Editors' addresses: `/songs?edit=statuses`, `/songs?edit=new-song`, `/marks?edit=labels`.
- Wording rules from CLAUDE.md: English, British spelling, button names bold in CHANGELOG, curly double quotes, test titles in cp1252 characters only.
- While developing run only the tests a change touches, once each; full suites run once, on CI.

## Review Focus

1. A take's page opened from a chat link with `?mark=` on a computer must open the drawer on that mark, not a second panel over the strip. Test in Task 2.
2. Esc in the drawer folds it, but Esc inside a list or a menu in it closes only that (the provider already checks `defaultPrevented`). Test in Task 2.
3. Pressing **Statuses** while **New song** is open swaps the card, not stacks two. Test in Task 1.
4. Deleting the song whose page is open after **Add song** (⋯ › **Delete song**) goes to **Songs**, as now. Covered by the existing test at `songs.spec.ts:140`, moved to the page in Task 1.
5. On a phone, a take whose ⋯ › **Move to song** › **New song…** is pressed in a list lands on the take's page with the name field open. Test in Task 3.

---

### Task 1: A song opens its page; the editors open in place

**Files:**
- Create: `service/src/shell/editor.ts`
- Modify: `service/src/shell/panel.tsx` (kinds), `service/src/routes.tsx` (songs and marks `validateSearch`), `service/src/shell/EditList.tsx` (`PanelHead`, new `EditCard`), `service/src/songs/Songs.tsx`, `service/src/songs/parts.tsx` (`StatusMenu`, drop `SongPanel`), `service/src/songs/edit.tsx` (drop the `"panel"` size), `service/src/home/Home.tsx`, `service/src/rehearsals/Rehearsal.tsx`, `service/src/takes/TakePanel.tsx`, `service/src/marks/Marks.tsx`, `service/src/shell/Shell.tsx` (drop the song and editor branches)
- Rename: `songs/StatusesPanel.tsx` → `songs/Statuses.tsx` (`StatusesEditor`), `songs/NewSongPanel.tsx` → `songs/NewSong.tsx` (`NewSongEditor`), `marks/LabelsPanel.tsx` → `marks/Labels.tsx` (`LabelsEditor`)
- Test: `service/e2e/songs.spec.ts`, `marks.spec.ts`, `home.spec.ts`, `rehearsals.spec.ts`, `frame.spec.ts`, `trash.spec.ts:54`

**Interfaces:**
- Produces: `type Panel = { kind: "take"; uid: string; markAt?: number } | { kind: "mark"; uid: string; id?: number; at?: number } | { kind: "marks"; uid: string } | null`; `panelText`/`panelOf` read and write `marks:<uid>`, and read `song:…`, `labels`, `statuses`, `new-song` as `null`.
- Produces: `useEditor<K extends string>(): { edit: K | undefined; toggle(k: K): void; close(): void }` in `shell/editor.ts`. `toggle` pushes `?edit=k` with history state `{ editOpened: true }`, or closes when `k` is open; `close` goes back one step when the state says it was opened here, else replaces the address without `edit`.
- Produces: `PanelHead({ title, onClose }: { title: string; onClose: () => void })`; `EditCard({ children }: { children: ReactNode })` = `<Tile boxed>` at the top of a page.
- Produces: `StatusesEditor({ onClose })`, `LabelsEditor({ onClose })`, `NewSongEditor({ onClose })`; `NewSongEditor` navigates to `/songs/$id` after **Add song**.

- [ ] **Step 1: Write the failing page tests**

In `songs.spec.ts`, retitle and rewrite the panel tests to the page: “a song's page sets its status, key and notes, and takes a file” (row press → `toHaveURL(/\/songs\/\d+$/)`, then the same assertions on `page.locator("main")`), and “a song's tempo and signature are set on its page and kept”. In “a new song is refused …” and “a file and a song with no takes go only after asking”, **New song** opens a card in `main` (no `getByLabel("Panel")`), and **Add song** ends on the new song's page. In “a status dragged by its grip …”, **Statuses** opens the card in `main`. Add:

```ts
test("Statuses and New song open at the top of Songs, one at a time, and Back closes them", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("button", { name: "Statuses" }).click()
  await expect(page).toHaveURL(/\?edit=statuses/)
  await page.getByRole("button", { name: "New song" }).click()
  await expect(page.locator("main").getByRole("heading", { name: "New song" })).toBeVisible()
  await expect(page.locator("main").getByRole("heading", { name: "Statuses" })).toHaveCount(0)
  await page.goBack()
  await expect(page.locator("main").getByRole("heading", { name: "Statuses" })).toBeVisible()
  await expect(page.getByLabel("Panel")).toHaveCount(0)
})

test("Edit statuses on a song's page opens Statuses on Songs", async ({ page }) => {
  // from the song's page, Status menu › Edit statuses → /songs?edit=statuses with the card open
})
```

In `marks.spec.ts`, the two label tests open **Labels** in `main`; the reload in the second keeps `?edit=labels` and the card. In `home.spec.ts` add “a song's name on Home opens its page”; in `rehearsals.spec.ts:25` **Notes and files** ends on `/songs/<id>`. In `frame.spec.ts:62` the Esc test opens a take's panel and its ⋯ menu: Esc closes the menu, the panel stays. In `trash.spec.ts:54` the song is deleted from its page.

- [ ] **Step 2: Run them to see them fail**

Run (Worker started by the config): `cd service && npx playwright test songs.spec.ts marks.spec.ts home.spec.ts rehearsals.spec.ts frame.spec.ts trash.spec.ts`
Expected: the changed tests FAIL (song opens the panel, editors open in the panel).

- [ ] **Step 3: Implement**

`useEditor` as above (read `edit` with `useRouterState`, navigate with `to: "."`, `resetScroll: false`). Routes: `songs` validates `edit` to `"statuses" | "new-song"`, `marks` to `"labels"`. **Songs** and **Marks** render the open editor in an `EditCard` as the first child of `Page` and give their buttons `aria-pressed`. Song names become `<Link to="/songs/$id">` (Home, `SongLine` title, **Notes and files** via `Button asChild`, the song in `TakePanel`); a `SongLine` row press navigates there. `StatusMenu`'s **Edit statuses** navigates to `/songs?edit=statuses`. Remove `SongPanel`, the `"panel"` size of `InPlaceTitle`, and the four kinds from `panel.tsx` and `Shell.tsx`.

- [ ] **Step 4: Run the same tests to see them pass**

Run: the command from Step 2, plus `npx tsc --noEmit` in `service/`.
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A service/src service/e2e
git commit -m "Band service: a song opens its page, the editors open where they are"
```

### Task 2: The drawer on a take's page

**Files:**
- Create: `service/src/shell/drawer.tsx`
- Modify: `service/src/shell/Shell.tsx` (`PanelBody`, desktop frame), `service/src/shell/panel.tsx` (`marks` kind), `service/src/shell/parts.tsx` (`PanelClose`, drawer surface), `service/src/takes/TakePanel.tsx`, `service/src/marks/MarkPanel.tsx`, `service/src/marks/MarkItem.tsx` (`TakeMarks` header unchanged)
- Test: `service/e2e/takes.spec.ts`

**Interfaces:**
- Consumes: `Panel` with `marks` from Task 1; `usePanel()`; `TakeMarks({ take })`; `MarkPanel`, `TakePanel`.
- Produces: `PanelBody({ panel, page }: { panel: Exclude<Panel, null>; page?: string })` in `Shell.tsx`: the switch both the panel and the drawer draw; for `take` with `uid === page` and for `marks` it draws the take's marks list under a header row holding `PanelClose`.
- Produces: `Drawer({ uid }: { uid: string })` in `shell/drawer.tsx`: the strip (`aria-label="Strip"`) always; over it, when `usePanel().panel` is set, `<aside aria-label="Panel">` with `PanelBody`, the **Back** row when `back` exists, and the drawer surface set.
- Produces: `PanelClose()` in `shell/parts.tsx`: the ✕ (`aria-label="Close"`) on the panel; the fold sign (`aria-label="Fold the panel"`) inside the drawer; both call `usePanel().close`. `TakePanel` and `MarkPanel` use it in place of their own ✕ buttons.

- [ ] **Step 1: Write the failing tests** in `takes.spec.ts` (computer, 1180×820):

```ts
test("a take's page opens folded, its strip counts the marks and opens and folds the drawer", async ({ page }) => {
  // goto the take's page; expect getByLabel("Panel") count 0
  // expect getByLabel("Strip").getByRole("button", { name: `Marks: ${n}` }) visible
  // click it → Panel visible with heading "Marks"; URL has panel=marks%3A<uid>
  // click "Fold the panel" → Panel count 0, Strip still visible; Esc on an open drawer folds it too
})
test("a mark's chip opens the drawer on the mark, and Back from the list's mark returns to the list", async ({ page }) => {})
test("a chat link with a mark opens the take's page with the drawer on that mark", async ({ page }) => {
  // goto `/takes/<uid>?at=5&mark=<id>` → one Panel, containing "Mark at 0:05"
})
test("Esc in a mark's menu in the drawer closes the menu, not the drawer", async ({ page }) => {})
```

The existing tests at `takes.spec.ts:343-511` keep `getByLabel("Panel")`; where they press ✕ on a take's page they press “Fold the panel”.

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx playwright test takes.spec.ts`
Expected: the four new tests FAIL (no strip).

- [ ] **Step 3: Implement**

`Shell.tsx`'s desktop frame draws `<Drawer uid=… />` instead of `<PanelView />` when the path is `/takes/<uid>`; the strip sits in the flex row after `main`, the open drawer `absolute inset-y-0 right-0 z-20` over it, as `PanelView` is. The strip's top sign and the diamond call `open({ kind: "marks", uid })`; the count comes from `useTake(uid)`. The drawer surface is a third value of the existing surface context (`"drawer"`), set by `Drawer`, read by `PanelClose`.

- [ ] **Step 4: Run to see them pass**

Run: `cd service && npx playwright test takes.spec.ts frame.spec.ts` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A service/src service/e2e
git commit -m "Band service: a take's page keeps its marks in a drawer that folds into a strip"
```

### Task 3: On a phone a take opens its page

**Files:**
- Modify: `service/src/shell/panel.tsx` (`open`), `service/src/takes/move.tsx:99`
- Test: `service/e2e/frame.spec.ts` (the phone block, `test.use` 390×844)

**Interfaces:**
- Consumes: `open` from `PanelProvider`; `useSize()`.
- Produces: on a phone, `open({ kind: "take", uid })` navigates to `/takes/$uid` (push), and `open({ kind: "take", uid, markAt })` opens `{ kind: "mark", uid, at: markAt }`. Every caller (`TakeLink`, `OnTake`, `MarkHere`, `move.tsx`) gets this through `open`; none changes its call.

- [ ] **Step 1: Write the failing tests** in the phone block:

```ts
test("on a phone a take's name opens its page, and Mark opens a new mark", async ({ page }) => {
  // Home: press a take's name → toHaveURL(/\/takes\//), getByLabel("Panel") count 0
  // play it, press "Mark" in the bar → Panel visible with heading /New mark at/
})
test("on a phone New song from a take's line opens its page with the name field", async ({ page }) => {
  // a rehearsal's page: ⋯ › Move to song › New song… → toHaveURL(/\/takes\//), textbox "New song" visible
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd service && npx playwright test frame.spec.ts -g "on a phone"`
Expected: FAIL (the panel opens full screen).

- [ ] **Step 3: Implement** the phone branch at the top of `open`; in `move.tsx` the row's **New song…** opens the take as before (the branch sends it to the page).

- [ ] **Step 4: Run to see them pass**

Run: the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A service/src service/e2e
git commit -m "Band service: on a phone a take opens its page"
```

### Task 4: Words and the site's picture

**Files:**
- Modify: `docs/design-system.md:80-82`, `CHANGELOG.md` (Unreleased), `site/src/stories/band-service/downloads-light.webp`, `downloads-dark.webp`

- [ ] **Step 1: design-system.md** — the band service's exception paragraph gets a second sentence: on a take's page the panel folds into a strip 48 px wide along the right edge, in the left column's grey, with a sign for each of its sections.

- [ ] **Step 2: CHANGELOG** — under **Unreleased**, before the take-out item, one item starting bold, e.g. “**The band service's panel opens less.**” then: a song opens its own page; **New song**, **Statuses** and **Labels** open at the top of their pages; on a take's page its marks sit in a strip on the right that opens and folds; on a phone a take opens its page. Check it with the humanizer skill.

- [ ] **Step 3: The picture** — retake only `downloads` (both themes) with the pictures run (`npx playwright test -c playwright.pictures.config.ts -g downloads`, Chromium at `/opt/pw-browsers/chromium` through a throwaway config that is not committed). Expected: the two `downloads-*.webp` change, the strip shows at the right edge; `sizes.json` unchanged.

- [ ] **Step 4: Commit**

```bash
git add docs/design-system.md CHANGELOG.md site/src/stories/band-service/downloads-*.webp
git commit -m "Words and the site's picture for the lighter panel"
```

Then a whole-branch review, the PR, and the picture shown to Alex before the merge.
