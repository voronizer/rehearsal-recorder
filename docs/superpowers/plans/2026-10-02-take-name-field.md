# Take name field and one-row footers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name a take in one field over the main button, before recording and after, and lay every screen's footer out as one row with the buttons on the right.

**Architecture:** A `FooterRow` component gives all six footers the same shape. A new `TakeNameField` holds the name: it shows the settled name, keeps what is typed while it has focus, and reports the name settled on through `onCommit`. Rehearsal sends that to Python (`set_next_take_name`); Review keeps it for Save take; the rename dialog submits it. Under the field, step 1 reuses `SongChips`; step 2 replaces it with `SongPills` (two measured rows and an All songs popover); step 3 moves the rename dialogs onto the field and deletes `SongChips`.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, Radix (`radix-ui`), Vite; Playwright e2e against `ui/e2e/fake-bridge.js`; Vitest; Python 3.12 checks in `tests/test_engine.py`.

**Spec:** `docs/superpowers/specs/2026-10-02-take-name-field-design.md` (requirement ids F1–F7, N1–N7, S1–S8, R1–R2, P1–P2 below are that document's).

## Global Constraints

- The smallest window is 960×680 (`min_size` in `src/rehearsal_recorder/app.py`); every footer keeps its buttons on one line there (F7).
- The main buttons keep their words: "Record take N", "Save take" (F6).
- The review screen's name input keeps `id="take-name"`: twenty-odd e2e tests and `tests/docs_screenshots.py` fill it.
- Heights are measured in Arial in e2e (`wideFont` in `ui/e2e/recording.spec.ts`), because CI's Linux draws in Liberation Sans.
- Three commits, one per step, each ending with the app working (the user chose this). Each commit message ends with the attribution lines from the session's system reminder.
- Commands: interface tests `cd ui && npm run build && npx playwright test`; unit tests `cd ui && npx vitest run`; lint `cd ui && npx oxlint`; Python `venv/Scripts/python.exe tests/run_all.py` from the repo root (Windows); docs pictures `venv/Scripts/python.exe tests/docs_screenshots.py`.

## Review Focus

- **Record clicked with the mouse straight after typing.** The blur sends `set_next_take_name`; the click starts the take. The take must start with the typed name, and `set_next_take_name` must reach Python before `start_take`. Pinned in Task 3.
- **A name of spaces, or spaces around a name.** Settled trimmed; all spaces counts as empty and becomes the fallback. Pinned in Task 3.
- **A library with no songs at all** (first rehearsal ever). No pills, and no All songs… pill with an empty panel behind it. Pinned in Task 7.
- **The window resized while the footer shows.** The two rows re-fit; no third row, no pill cut off. Pinned in Task 7.
- **A song name longer than the row.** Its pill is cut short with an ellipsis and still counts as one pill in the two rows. Pinned in Task 6 (pure layout) and Task 7.

---

# Step 1 — footers in one row, the field on Rehearsal and Review

### Task 1: `stop_take` returns `default_name` (P1)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`stop_take`, around line 1631)
- Modify: `ui/src/lib/api.ts` (`PendingTake`, around line 100)
- Modify: `ui/e2e/fake-bridge.js` (`stop_take`, around line 411)
- Modify: `tests/docs_screenshots.py` (`api.stop_take`, around line 256)
- Test: `tests/test_engine.py` (new section `[51]` before the final `print("\n" + "=" * 60)`; one more condition in `[44]` around line 5005)

**Interfaces:**
- Produces: `stop_take()` result gains `"default_name": str`; TS `PendingTake.default_name?: string`.

- [ ] **Step 1: Write the failing test**

Add before the final `print("\n" + "=" * 60)` in `main()` of `tests/test_engine.py`:

```python
    print("\n[51] After Stop, the name the take would have had without one picked")
    _, a51 = fresh_api(Path(tempfile.mkdtemp()))
    a51.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)

    def record51():
        a51.start_take()
        a51._recorder._callback(np.full((SR, 1), 900, dtype=np.int16), SR, None, None)
        return a51.stop_take()

    first51 = record51()
    ok("a first take with no name picked would be Take 1 either way",
       first51["suggested_name"] == "Take 1" and first51["default_name"] == "Take 1")
    a51.keep_take(first51["take_number"], first51["temp_dir"], "Polyn",
                  first51["duration_sec"], first51["tracks"])
    a51.set_next_take_name("Vesna")
    second51 = record51()
    ok("a name picked before recording is offered, and the one it would have had beside it",
       second51["suggested_name"] == "Vesna" and second51["default_name"] == "Polyn 2")
```

And in `[44]`, extend the existing condition (around line 5005):

```python
    ok("a stop whose name cannot be looked up still stops and keeps the take",
       stopped44.get("ok") is True and a44._recorder is None
       and (Path(stopped44["temp_dir"]) / "Gtr.wav").exists()
       and stopped44["suggested_name"] == f"Take {stopped44['take_number']}"
       and stopped44["default_name"] == f"Take {stopped44['take_number']}")
```

- [ ] **Step 2: Run it to see it fail**

Run: `venv/Scripts/python.exe tests/test_engine.py`
Expected: the `[51]` checks and the `[44]` check fail with `KeyError: 'default_name'` reported as a problem (or a traceback at `first51["default_name"]`).

- [ ] **Step 3: Write the implementation**

In `stop_take` of `src/rehearsal_recorder/api.py`, replace the naming block and the return:

```python
        try:
            name = self.suggest_take_name(take_number)
            # What ✕ on the review screen puts back: the name the take would
            # have had with none picked before recording.
            default = self.suggest_take_name(take_number, chosen=False)
        except Exception:
            # The name comes from the library. A take is not left recording,
            # holding the card, because the library could not answer.
            name = default = f"Take {take_number}"
```

and add to the returned dict, after `"suggested_name": name,`:

```python
            "default_name": default,
```

In `ui/src/lib/api.ts`, `PendingTake`:

```ts
export type PendingTake = {
  ok: true
  take_number: number
  temp_dir: string
  duration_sec: number
  tracks: TrackFile[]
  suggested_name?: string
  /** The name it would have had with none picked before recording: what ✕
   *  in the review screen's name field puts back. */
  default_name?: string
}
```

In `ui/e2e/fake-bridge.js`, `stop_take`, after `suggested_name:suggestName(takeCounter),` add `default_name:suggestName(takeCounter, false),`.

In `tests/docs_screenshots.py`, `api.stop_take`, after `suggested_name: suggestName(takeCounter),` add `default_name: suggestName(takeCounter),` (that script's `suggestName` takes one argument and has no picked name).

- [ ] **Step 4: Run it to see it pass**

Run: `venv/Scripts/python.exe tests/test_engine.py`
Expected: ends with `Python side: all checks passed.`

### Task 2: `FooterRow`, every footer in one row, and Last time on the left (F1–F4, F6–F8)

**Files:**
- Create: `ui/src/components/FooterRow.tsx`
- Modify: `ui/src/screens/Setup.tsx` (footer, around line 408; the Last time panel, around line 762)
- Modify: `ui/src/screens/Rehearsal.tsx` (footer, around line 251)
- Modify: `ui/src/screens/Recording.tsx` (footer, around line 175)
- Modify: `ui/src/screens/Review.tsx` (footer, around line 208)
- Modify: `ui/src/screens/Finished.tsx` (footer, around line 22)
- Modify: `ui/src/screens/DraftsScreen.tsx` (footer, around line 69)
- Test: `ui/e2e/footer.spec.ts` (new)

**Interfaces:**
- Produces: `FooterRow({ left?: ReactNode; rule?: boolean; error?: string | null; children: ReactNode })`. The right-hand part carries `data-footer-actions`; the rule carries `data-footer-rule`.

- [ ] **Step 1: Write the failing test**

Create `ui/e2e/footer.spec.ts`:

```ts
import { expect, openApp, recordTake, startButton, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Every footer is one row: what the screen has to say on the left, its
// buttons on the right with the main one rightmost, so it is in the same
// place on every screen. A secondary button has an edge. It holds in the
// smallest window the app allows.

/** The footer's buttons, as laid out. */
const footer = (page: Page) =>
  page.evaluate(() => {
    const f = document.querySelector("footer")!
    const buttons = [
      ...f.querySelectorAll<HTMLElement>("[data-footer-actions] [data-slot='button']"),
    ]
    const boxes = buttons.map((b) => b.getBoundingClientRect())
    const middles = boxes.map((r) => Math.round(r.top + r.height / 2))
    const rightmost = boxes.reduce((best, r, i) => (r.right > boxes[best].right ? i : best), 0)
    return {
      variants: buttons.map((b) => b.dataset.variant),
      oneLine: Math.max(...middles) - Math.min(...middles) <= 2,
      main: (buttons[rightmost]?.textContent ?? "").trim(),
      onTheRight: boxes.every((r) => r.left > window.innerWidth / 2),
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    }
  })

test.use({ viewport: { width: 960, height: 680 } })

test("setup: Start rehearsal on the right", async ({ page }) => {
  await openApp(page)
  await expect(startButton(page)).toBeVisible()
  const f = await footer(page)
  expect(f.main).toMatch(/^Start rehearsal/)
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false })
})

test("rehearsal: Finish with an edge, Record rightmost", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  const f = await footer(page)
  expect(f.main).toMatch(/^Record take 1/)
  expect(f.variants).toEqual(["outline", "destructive"])
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false })
})

test("recording: Stop on the right, autosave said under it", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  const f = await footer(page)
  expect(f.main).toMatch(/^Stop/)
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false })
  const under = await page.evaluate(() => {
    const stop = [...document.querySelectorAll("footer button")].find((b) =>
      b.textContent?.startsWith("Stop")
    )!
    const line = [...document.querySelectorAll("footer p")].find((p) =>
      p.textContent?.includes("autosaved every 30 s")
    )!
    return line.getBoundingClientRect().top >= stop.getBoundingClientRect().bottom
  })
  expect(under).toBe(true)
})

test("review: Discard with an edge, Save take rightmost", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  const f = await footer(page)
  expect(f.main).toMatch(/^Save take/)
  expect(f.variants).toEqual(["outline", "default"])
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false })
})

test("finished: History with an edge, New rehearsal rightmost", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /^Finish/ }).click()
  await expect(page.getByText("Rehearsal finished")).toBeVisible()
  const f = await footer(page)
  expect(f.main).toMatch(/^New rehearsal/)
  expect(f.variants).toEqual(["outline", "default"])
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false })
})

test("drafts: the note on the left, Decide later with an edge on the right", async ({ page }) => {
  await openApp(page, {
    before: `window.__DRAFTS__ = [{dir: '/rec/old/_drafts/take 1', name: 'take 1',
      tracks: ['Guitar', 'Vocals'], duration_sec: 95,
      rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
      created_at: '2026-09-10T19:00:00'}];`,
  })
  await expect(page.getByRole("button", { name: "Decide later" })).toBeVisible()
  const f = await footer(page)
  expect(f.variants).toEqual(["outline"])
  expect(f).toMatchObject({ onTheRight: true, sideways: false })
  const note = page.locator("footer").getByText("They stay on disk")
  expect((await note.boundingBox())!.x).toBeLessThan(960 / 2)
})

test.describe("the setup screen with a rehearsal before", () => {
  const lastTime = (page: Page) => page.getByRole("complementary", { name: "Last time" })
  const setupBox = (page: Page) =>
    page.getByRole("button", { name: "Change the interface and quality" })

  test("wide, Last time is on the left and the new rehearsal over Start", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const last = (await lastTime(page).boundingBox())!
    const setup = (await setupBox(page).boundingBox())!
    const start = (await startButton(page).boundingBox())!
    expect(last.x + last.width).toBeLessThanOrEqual(setup.x)
    expect(setup.x + setup.width).toBeGreaterThan(start.x)
  })

  test("narrow, the new rehearsal comes first and Last time under it", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await expect(lastTime(page)).toBeAttached()
    const last = (await lastTime(page).boundingBox())!
    const setup = (await setupBox(page).boundingBox())!
    expect(last.y).toBeGreaterThan(setup.y + setup.height)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd ui && npm run build && npx playwright test e2e/footer.spec.ts`
Expected: the six footer tests fail — `onTheRight` false (the buttons are centred) and the variants are `ghost` where `outline` is expected; "wide, Last time is on the left" fails (it is on the right); "narrow" passes already.

- [ ] **Step 3: Write `FooterRow`**

Create `ui/src/components/FooterRow.tsx`:

```tsx
import type { ReactNode } from "react"

/**
 * A screen's footer as one row: what the screen has to say on the left, its
 * buttons on the right, the main one rightmost, so that it is in the same
 * place on every screen. Stacked with the name field and its songs, the
 * review screen's footer came to about 270 px; in a row, 183.
 *
 * `rule` draws a line between the two halves, where the left one holds a
 * field. An error goes over the buttons it is about.
 */
export function FooterRow({
  left,
  rule = false,
  error,
  children,
}: {
  left?: ReactNode
  rule?: boolean
  error?: string | null
  /** The buttons, and any line that goes under them. */
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl items-center gap-7">
      <div className="min-w-0 flex-1">{left}</div>
      {rule && <div data-footer-rule aria-hidden className="w-px self-stretch bg-border" />}
      <div data-footer-actions className="flex shrink-0 flex-col items-end gap-2">
        {error && <p className="max-w-md text-right text-sm text-destructive">{error}</p>}
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Use it on every screen**

`ui/src/screens/Setup.tsx`, replace the footer prop's value:

```tsx
      footer={
        <FooterRow error={error}>
          <Button
            size="xl"
            onClick={start}
            disabled={!canStart}
            aria-keyshortcuts={inHand ? undefined : "Space"}
          >
            <Radio />
            Start rehearsal
            {!inHand && <Kbd>Space</Kbd>}
          </Button>
        </FooterRow>
      }
```

`ui/src/screens/Recording.tsx`, replace the footer prop's value:

```tsx
      footer={
        <FooterRow error={error}>
          <Button
            size="xl"
            onClick={stop}
            disabled={stopping}
            aria-keyshortcuts="Space"
          >
            <Square className="fill-current" />
            Stop
            <Kbd>Space</Kbd>
          </Button>
          {stopping ? (
            <RunningLine entry={saving} label="Saving the take" active />
          ) : (
            <p className="text-xs text-muted-foreground">autosaved every 30 s</p>
          )}
        </FooterRow>
      }
```

`ui/src/screens/Rehearsal.tsx`, replace the footer prop's value (`NextTakeName` stays on the left until Task 3):

```tsx
      footer={
        <FooterRow
          error={error}
          left={
            <NextTakeName
              name={session.next_take_name}
              defaultName={session.next_take_default ?? session.next_take_name}
              version={session.takes.map((t) => `${t.take_number}:${t.name}`).join("|")}
              onChoose={(name) => void nameNextTake(name)}
            />
          }
        >
          <div className="flex items-center gap-3">
            {/* Escape finishes only with no take in hand; with one, it puts
                the take away — see useEscape above. */}
            <Button
              variant="outline"
              size="lg"
              onClick={finish}
              aria-keyshortcuts={inHand ? undefined : "Escape"}
            >
              Finish
              {!inHand && <Kbd>Esc</Kbd>}
            </Button>
            <Button
              size="xl"
              variant="destructive"
              onClick={startTake}
              disabled={busy}
              aria-keyshortcuts={inHand ? undefined : "Space"}
            >
              <Circle className="fill-current" />
              Record take {session.next_take_number}
              {/* With a take in hand Space plays it, and the key is on Play. */}
              {!inHand && <Kbd>Space</Kbd>}
            </Button>
          </div>
        </FooterRow>
      }
```

`ui/src/screens/Review.tsx`, replace the footer prop's value (the name stays at the top until Task 3):

```tsx
      footer={
        <FooterRow error={error}>
          <div className="flex items-center gap-3">
            {/* Escape asks before discarding; the button itself does not.
                It is still the button Escape leads to. */}
            <Button
              variant="outline"
              size="lg"
              onClick={discard}
              disabled={busy}
              aria-keyshortcuts="Escape"
            >
              <Trash2 />
              Discard
              <Kbd>Esc</Kbd>
            </Button>
            <Button
              size="lg"
              onClick={keep}
              disabled={busy}
              aria-keyshortcuts="Space"
            >
              <Check />
              Save take
              <Kbd>Space</Kbd>
            </Button>
          </div>
          {cloud &&
            (cloud.dir ? (
              <label
                htmlFor="send-to-cloud"
                className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
              >
                <input
                  id="send-to-cloud"
                  type="checkbox"
                  checked={send}
                  onChange={(e) => {
                    setSend(e.target.checked)
                    // Focus left on the box would give it the next Space,
                    // which on this screen means Save take.
                    e.currentTarget.blur()
                  }}
                  disabled={busy}
                  className="size-4 accent-primary"
                />
                <Cloud className="size-4" />
                Send to the cloud — {WHAT_GOES[cloud.what]},{" "}
                {cloud.format.toUpperCase()}
              </label>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Cloud className="size-4" />
                Stays on this computer — no cloud folder is set
              </p>
            ))}
        </FooterRow>
      }
```

`ui/src/screens/Finished.tsx`, replace the footer prop's value:

```tsx
      footer={
        <FooterRow>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" onClick={onOpenHistory}>
              <History />
              History
            </Button>
            <Button
              size="lg"
              onClick={onNewRehearsal}
              aria-keyshortcuts="Space"
            >
              <Radio />
              New rehearsal
              <Kbd>Space</Kbd>
            </Button>
          </div>
        </FooterRow>
      }
```

`ui/src/screens/DraftsScreen.tsx`, replace the footer prop's value:

```tsx
      footer={
        <FooterRow
          left={
            <p className="text-xs text-muted-foreground">
              They stay on disk and will be offered again next time.
            </p>
          }
        >
          <Button variant="outline" size="lg" onClick={onDone}>
            Decide later
          </Button>
        </FooterRow>
      }
```

Add `import { FooterRow } from "@/components/FooterRow"` to each of the six files.

- [ ] **Step 5: Last time on the left**

In `ui/src/screens/Setup.tsx`, the Last time panel (the `div` that wraps `<LastTime …/>`, class starting `border-t bg-panel`): in a wide window it goes first, and its rule moves to its right-hand edge. Replace its `className` with:

```tsx
        <div className="border-t bg-panel px-6 py-6 min-[1100px]:order-first min-[1100px]:w-[26rem] min-[1100px]:shrink-0 min-[1100px]:overflow-y-auto min-[1100px]:border-t-0 min-[1100px]:border-r min-[1100px]:px-5">
```

and replace the comment over the setup column ("Last time beside the setup when the window is wide enough for both, under it when it is not.") with:

```tsx
      {/* Last time beside the setup when the window is wide enough for both
          — on the left, so that the setup is over Start rehearsal — and
          under it when it is not. */}
```

- [ ] **Step 6: Run the new tests and the whole suite**

Run: `cd ui && npm run build && npx playwright test`
Expected: `footer.spec.ts` passes; every other spec passes as before (137 + 8). `notices.spec.ts` "a failure stays…" still finds Start rehearsal uncovered and the notice above the footer.

### Task 3: `TakeNameField` on Rehearsal and Review (N1–N7, F5, S8)

**Files:**
- Create: `ui/src/components/TakeNameField.tsx`
- Delete: `ui/src/components/NextTakeName.tsx`
- Modify: `ui/src/screens/Rehearsal.tsx`
- Modify: `ui/src/screens/Review.tsx`
- Test: `ui/e2e/naming.spec.ts` (replace the `test.describe("the next take", …)` block; add review tests)

**Interfaces:**
- Consumes: `FooterRow` (Task 2); `PendingTake.default_name` (Task 1); `SongChips({ choices, value, initial, onPick, className? })` from `ui/src/components/SongChips.tsx` (unchanged).
- Produces, used by Tasks 7 and 10:

```ts
TakeNameField(props: {
  id: string
  label: string
  value: string          // the settled name, shown whenever the field is not being typed in
  initial: string        // what the field started from; it does not narrow the songs
  fallback: string       // what ✕ puts back, and what an emptied field becomes
  choices: SongChoices | null
  onCommit: (name: string) => void   // a song clicked, ✕, Enter, or focus leaving
  onEnter?: (name: string) => void   // Enter; without it Enter leaves the field
  size?: "big" | "compact"
  autoFocus?: boolean
})
```

The ✕ button's accessible name is ``Put back “${fallback}”``.

- [ ] **Step 1: Write the failing tests**

In `ui/e2e/naming.spec.ts`, replace the whole `test.describe("the next take", () => { … })` block with:

```ts
test.describe("the next take", () => {
  /** The name over Record: one field, and the songs under it. */
  const field = (page: Page) => page.getByRole("textbox", { name: "Next take" })
  const songs = (page: Page) => page.getByRole("group", { name: "Next take" })
  const order = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __CALLS__: { name: string }[] }).__CALLS__.map((c) => c.name)
    )

  test("is named in one field over Record, and keeps its name through a take thrown away", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(field(page)).toHaveValue("Take 1")

    // A song clicked fills the field and names the take; nothing under the
    // pointer moves.
    const vesna = songs(page).getByRole("button", { name: "Vesna", exact: true })
    const before = await songs(page).locator("[data-song-choice]").allTextContents()
    const at = (await vesna.boundingBox())!
    await vesna.click()
    await expect(field(page)).toHaveValue("Vesna")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Vesna"])
    expect(await songs(page).locator("[data-song-choice]").allTextContents()).toEqual(before)
    expect((await vesna.boundingBox())!).toEqual(at)

    // ✕ goes back to the name it would have had, and tells Python so.
    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])

    await vesna.click()
    // The click left the keyboard to the screen: Space records.
    await page.keyboard.press("Space")
    await expect(page.getByRole("heading", { level: 1, name: "Vesna" })).toBeVisible()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Vesna")

    // Thrown away, it is played again under the same name.
    await page.getByRole("button", { name: /^Discard/ }).click()
    await expect(field(page)).toHaveValue("Vesna")
    await recordTake(page, 2)
    await expect(nameField(page)).toHaveValue("Vesna")
    await page.getByRole("button", { name: /Save take/ }).click()
    // Kept, it is used up, and the next one follows on from it.
    await expect(field(page)).toHaveValue("Vesna 2")
  })

  test("a name typed is the one recorded, however the field is left", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)

    await field(page).fill("New song")
    await page.keyboard.press("Enter")
    await expect(field(page)).not.toBeFocused()
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["New song"])

    // Typed, and Record clicked straight away: the name reaches Python
    // before the take starts, and the take is recorded under it.
    await field(page).fill("  Another one  ")
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Another one" })).toBeVisible()
    const log = await order(page)
    expect(log.lastIndexOf("set_next_take_name")).toBeLessThan(log.lastIndexOf("start_take"))
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Another one"])
  })

  test("Space types, Escape leaves the field, and an emptied field gets its name back", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await field(page).fill("Polyn")
    await page.keyboard.press("Space")
    await page.keyboard.type("live")
    await expect(field(page)).toHaveValue("Polyn live")
    // Escape only leaves the field: it does not finish the rehearsal.
    await page.keyboard.press("Escape")
    await expect(field(page)).not.toBeFocused()
    expect(await callCount(page, "start_take")).toBe(0)
    expect(await callCount(page, "finish_rehearsal")).toBe(0)
    await expect(startButton(page)).toHaveCount(0)
    // What was typed was not lost on the way out.
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Polyn live"])

    // Emptied, or left as spaces, it is never empty once left.
    await field(page).fill("   ")
    await page.locator("main").click({ position: { x: 5, y: 5 } })
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])
  })
})

test.describe("after Stop", () => {
  test("the name is in the same field, in the same place, and ✕ puts back the one it would have had", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    const over = page.getByRole("textbox", { name: "Next take" })
    await over.fill("Vesna")
    await page.keyboard.press("Enter")
    const before = (await over.boundingBox())!
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Vesna")
    const after = (await nameField(page).boundingBox())!
    expect(Math.abs(after.x - before.x)).toBeLessThan(2)
    expect(Math.abs(after.y - before.y)).toBeLessThan(2)
    // Over Save take, with a line between it and the buttons.
    await expect(page.locator("footer [data-footer-rule]")).toHaveCount(1)

    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(nameField(page)).toHaveValue("Take 1")
    await page.getByRole("button", { name: /Save take/ }).click()
    expect((await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Take 1")
  })
})
```

Keep the file's three earlier tests (review songs, the two rename dialogs) as they are: in this step the songs under both fields and in the dialogs are still `SongChips`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd ui && npx playwright test e2e/naming.spec.ts`
Expected: the four new tests fail at `getByRole("textbox", { name: "Next take" })` (element not found); the three kept tests pass.

- [ ] **Step 3: Write `TakeNameField`**

Create `ui/src/components/TakeNameField.tsx`:

```tsx
import { useRef, useState } from "react"
import { X } from "lucide-react"
import { SongChips } from "@/components/SongChips"
import type { SongChoices } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * A take's name, in one field: over Record before the take, over Save take
 * after it, and in the Rename take dialog. Naming the take is what is most
 * easily forgotten at a rehearsal, so it is big, and it is in the same
 * place before recording and after.
 *
 * It shows `value`, the name as settled, except while somebody types in
 * it. The name settled on goes to `onCommit`: a song clicked under it, ✕,
 * Enter, or focus leaving it. Never empty: ✕ and an emptied field both put
 * back `fallback`, the name the take would have anyway.
 *
 * Space types a space and Escape leaves the field (useSpacebar.ts does both
 * for any text field); Enter leaves it too, so the next Space does what the
 * main button says — or, given `onEnter`, does that instead.
 */
export function TakeNameField({
  id,
  label,
  value,
  initial,
  fallback,
  choices,
  onCommit,
  onEnter,
  size = "big",
  autoFocus = false,
}: {
  id: string
  label: string
  value: string
  /** What the field started from: it does not narrow the songs. */
  initial: string
  fallback: string
  choices: SongChoices | null
  onCommit: (name: string) => void
  onEnter?: (name: string) => void
  size?: "big" | "compact"
  autoFocus?: boolean
}) {
  // What is typed, while the field has focus; null shows `value`.
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const shown = draft ?? value
  const named = (typed: string) => typed.trim() || fallback

  const commit = (name: string) => {
    if (name !== value) onCommit(name)
  }
  // A song or ✕ while typing goes into the field and stays there to type on.
  const put = (name: string) => {
    if (draft !== null) setDraft(name)
    commit(name)
  }

  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          "font-semibold text-muted-foreground",
          size === "big" ? "text-[11px] tracking-wider uppercase" : "text-xs"
        )}
      >
        {label}
      </label>
      <div
        className={cn(
          "relative w-full max-w-md rounded-lg border border-input bg-muted/45",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        )}
      >
        <input
          id={id}
          ref={input}
          value={shown}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setDraft(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setDraft(null)
            commit(named(shown))
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            if (onEnter) onEnter(named(shown))
            else input.current?.blur()
          }}
          className={cn(
            "w-full bg-transparent pr-11 pl-3.5 font-semibold outline-none",
            size === "big" ? "py-1.5 text-[1.75rem] leading-9" : "h-9 text-base"
          )}
        />
        <button
          type="button"
          aria-label={`Put back “${fallback}”`}
          // Leaves focus where it was, as the songs do.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => put(fallback)}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <SongChips choices={choices} value={shown} initial={initial} onPick={put} />
    </div>
  )
}
```

- [ ] **Step 4: Put it over Record**

In `ui/src/screens/Rehearsal.tsx`:

1. Change the first import line to `import { useEffect, useRef, useState } from "react"`, remove `import { NextTakeName } from "@/components/NextTakeName"`, and add `import { TakeNameField } from "@/components/TakeNameField"`.
2. Replace `nameNextTake` and add the state it needs, after the `const [finishing, setFinishing] = useState(false)` line:

```tsx
  // The next take's name as the field last settled on it, against the
  // session's name at the time: once Python has it, the session says the
  // same, and a take kept moves the session on past it.
  const [picked, setPicked] = useState<{ against: string; name: string } | null>(null)
  const nextName =
    picked && picked.against === session.next_take_name ? picked.name : session.next_take_name
  const fallback = session.next_take_default ?? session.next_take_name
  const nextChoices = useSongChoices(
    true,
    null,
    null,
    session.takes.map((t) => `${t.take_number}:${t.name}`).join("|")
  )
  // Names sent to Python, one after another: Record waits for the last one,
  // so a name typed and Record clicked straight after is the one recorded.
  const naming = useRef<Promise<void>>(Promise.resolve())

  const nameNextTake = (name: string) => {
    setPicked({ against: session.next_take_name, name })
    // The name it would have anyway goes as "", so it goes on following
    // the takes when one is renamed or deleted.
    const sent = name.toLocaleLowerCase() === fallback.toLocaleLowerCase() ? "" : name
    naming.current = naming.current.then(async () => {
      try {
        const res = await api().set_next_take_name(sent)
        if (!res.ok) setError(res.error ?? "Could not name the next take")
      } catch {
        setError("Could not name the next take")
      }
      onChanged()
    })
  }
```

3. In `startTake`, wait for it, and start the recording screen with the field's name:

```tsx
  const startTake = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    player.pause()
    await naming.current
    const res = await api().start_take()
    setBusy(false)
    if (!res.ok || res.take_number == null) {
      setError(res.error ?? "Could not start the take")
      return
    }
    onStartTake(res.take_number, nextName)
  }
```

Delete the old `const nameNextTake = async (name: string) => { … }`.

4. In the footer from Task 2, replace `left={<NextTakeName … />}` with:

```tsx
          rule
          left={
            <TakeNameField
              id="next-take-name"
              label="Next take"
              value={nextName}
              initial={session.next_take_name}
              fallback={fallback}
              choices={nextChoices}
              onCommit={nameNextTake}
            />
          }
```

5. Delete `ui/src/components/NextTakeName.tsx`.

- [ ] **Step 5: Put it over Save take**

In `ui/src/screens/Review.tsx`:

1. Remove the imports of `Input`, `Label` and `SongChips`; add `import { TakeNameField } from "@/components/TakeNameField"`.
2. Delete the block at the top of the content (`<div className="flex max-w-xl flex-col gap-2"> … </div>` with the `Take name` label, the `#take-name` input and `SongChips`), and the wrapper comment "The player wants the width; the name field does not.". The content becomes:

```tsx
      <div className="flex w-full flex-col gap-6">
        <TakePlayer
          player={player}
          markers={markers}
          onAddMarker={addMarker}
          onEditMarker={setEditing}
          onRemoveMarker={removeMarker}
          onCrop={(from, to) => void cropDraft(from, to)}
          canCrop={!busy}
          status={<RunningLine entry={cropping} label="Cropping" />}
        />
      </div>
```

3. Change `<FooterRow error={error}>` in the footer to:

```tsx
        <FooterRow
          error={error}
          rule
          left={
            <TakeNameField
              id="take-name"
              label="Take name"
              value={name}
              initial={firstName}
              fallback={take.default_name ?? `Take ${take.take_number}`}
              choices={songChoices}
              onCommit={setName}
            />
          }
        >
```

- [ ] **Step 6: Run the tests**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts e2e/player.spec.ts e2e/footer.spec.ts`
Expected: all pass, including `player.spec.ts` "a space typed in the take's name is a space, and saves nothing" and "Escape leaves the name field without asking to discard, and Space then saves".

Then: `cd ui && npx vitest run && npx oxlint && npx playwright test`
Expected: Vitest all pass; oxlint reports the five warnings it reported before this work (in `useMultitrackPlayer.ts`, `Settings.tsx`, `HistoryScreen.tsx` and two in `Recording.tsx`) and none in the files this task touches; the whole e2e suite passes.

### Task 4: Step 1's docs, pictures and commit

**Files:**
- Modify: `docs/using-it.md` (the paragraph "Above the button is **Next take**…" around line 107, and "Keep the take or not" around line 151)
- Modify: `CHANGELOG.md` (under `## Unreleased`)
- Modify: `docs/screenshots/*.png` (regenerated)

- [ ] **Step 1: The guide**

In `docs/using-it.md`, replace the paragraph starting "Above the button is **Next take**:" with:

```markdown
Left of the button is **Next take**: the name the next take will get, in a
field of its own, and under it the songs you could play instead. When you
move on to another song, click it before you press Record, or type a name
and press Enter. The take is then recorded under that name, and the
recording screen can say how long the last go at that song took. ✕ puts
back the name the take would have had anyway. If you discard the take, the
next one keeps the name you picked.
```

In "### Last time", replace "Beside the tracks, or under them in a narrow window, is" with "Left of the tracks, or under them in a narrow window, is".

In "Keep the take or not", replace "Check its name, then press **Save take** (Space) or **Discard**." with:

```markdown
Its name is in the same field, in the same place as before you recorded:
check it, then press **Save take** (Space) or **Discard**. ✕ there puts back
the name the take would have had if none had been picked before recording.
```

- [ ] **Step 2: The changelog**

Under `## Unreleased` in `CHANGELOG.md`, add:

```markdown
- **The take's name is one field, over the main button, before recording
  and after.** On the rehearsal screen it is left of Record, as *Next take*;
  after Stop it is in the same place, left of Save take, holding the name
  picked before recording, so a wrong one is put right there and then. Type
  in it, or click a song under it; ✕ puts back the name the take would have
  anyway, and the field is never left empty. Space types a space in it, and
  Enter or Escape leave it, so the next Space records or saves. A name typed
  and never confirmed is still the one recorded. Other… is gone: the field
  is where another name goes (#10).
- **Every footer is one row**, the buttons on the right and the main one
  rightmost, so it is in the same place on every screen. Finish, Discard,
  History and Decide later have an edge, and read as buttons. On the setup
  screen Last time has moved to the left, so the new rehearsal's setup is
  over Start rehearsal.
```

- [ ] **Step 3: The pictures**

Run: `venv/Scripts/python.exe tests/docs_screenshots.py` (from the repo root; needs `ui/dist` built).
Expected: all of `docs/screenshots/*.png` rewritten. Open `setup.png`, `rehearsal.png`, `recording.png` and `review.png`: the buttons are on the right, on `setup.png` Last time is the left column, and on `rehearsal.png` and `review.png` the name field is on the left behind a rule. Keep them all: every footer changed.

- [ ] **Step 4: Verify everything**

Run: `venv/Scripts/python.exe tests/run_all.py` — expected: every suite passes.
Run: `cd ui && npm run build && npx vitest run && npx oxlint && npx playwright test` — expected: build passes, Vitest all pass, no new lint warnings, every e2e test passes.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py tests/docs_screenshots.py \
  ui/src/components/FooterRow.tsx ui/src/components/TakeNameField.tsx ui/src/components/NextTakeName.tsx \
  ui/src/screens/Setup.tsx ui/src/screens/Rehearsal.tsx ui/src/screens/Recording.tsx \
  ui/src/screens/Review.tsx ui/src/screens/Finished.tsx ui/src/screens/DraftsScreen.tsx \
  ui/src/lib/api.ts ui/e2e/fake-bridge.js ui/e2e/footer.spec.ts ui/e2e/naming.spec.ts \
  docs/using-it.md CHANGELOG.md docs/screenshots
git commit -m "Name a take in one field over the main button, and lay every footer out as one row"
```

(The message body says what changed and why, ends with "#10" and the attribution lines from the system reminder.)

---

# Step 2 — two rows of songs and the All songs panel

### Task 5: `song_choices` gives each `here` song its latest take (P2)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`song_choices`, around line 1465)
- Modify: `ui/src/lib/api.ts` (`SongChoice`)
- Modify: `ui/e2e/fake-bridge.js` (`song_choices`, around line 395)
- Test: `tests/test_engine.py` (section `[8]` around line 860; the library section around line 2152)

**Interfaces:**
- Produces: each `here` entry is `{"song", "name", "last_take": int}`; TS `SongChoice.last_take?: number`.

- [ ] **Step 1: Write the failing test, and keep the existing ones about song and name**

In `tests/test_engine.py`, add near the top of `main()` (after `ok` is defined is enough; put it just before section `[8]`'s first use):

```python
    def plain(choices):
        """A list of song choices as song and name only."""
        return [{"song": c["song"], "name": c["name"]} for c in choices]
```

Change the checks at lines ~860–865 to:

```python
    ok("the songs of the rehearsal in progress, as the next go at each",
       plain(a.song_choices()["here"]) == [{"song": "Polyn", "name": "Polyn 3"},
                                           {"song": "Vesna", "name": "Vesna 2"},
                                           {"song": "Rescued", "name": "Rescued 2"}])
    ok("each with the number of its latest take",
       [c["last_take"] for c in a.song_choices()["here"]] == [2, 3, 4])
    ok("the take being renamed is not a go of its own",
       plain(a.song_choices(str(folder), 2)["here"])[0] == {"song": "Polyn", "name": "Polyn 2"})
```

And the library ones at ~2154 and ~2164:

```python
    ok("naming a take offers what its rehearsal played, as the next go at each",
       plain(ch["here"]) == [{"song": "Polyn", "name": "Polyn 4"},
                             {"song": "Vesna", "name": "Vesna 2"}])
```

```python
    ok("an older rehearsal is offered the songs played after it too",
       [c["song"] for c in e.song_choices(older)["other"]] == ["Vesna", "Dym", "Ptaha"]
       and plain(e.song_choices(older)["here"])[1] == {"song": "Doroga", "name": "Doroga 3"})
```

- [ ] **Step 2: Run it to see it fail**

Run: `venv/Scripts/python.exe tests/test_engine.py`
Expected: only "each with the number of its latest take" fails (`KeyError: 'last_take'`).

- [ ] **Step 3: Write the implementation**

In `song_choices` of `src/rehearsal_recorder/api.py`, replace the `here = …` comprehension with:

```python
        # last_take: which songs the interface keeps when this rehearsal's
        # alone do not fit under the field — the ones played latest.
        here = [{"song": s["name"], "name": _next_go(others, s["name"]),
                 "last_take": max(s["take_numbers"])}
                for s in _songs_of(takes)]
```

and add to the docstring after the paragraph on "here": `Each "here" entry also has "last_take", the number of its latest take.`

In `ui/src/lib/api.ts`, `SongChoice` gains:

```ts
  /** On a song this rehearsal played: the number of its latest take. */
  last_take?: number
```

In `ui/e2e/fake-bridge.js`, `song_choices`:

```js
    const here = songsOf(takes).map(s => ({song:s.name, name:nextGo(others, s.name),
                                           last_take:Math.max(...s.take_numbers)}));
```

- [ ] **Step 4: Run it to see it pass**

Run: `venv/Scripts/python.exe tests/test_engine.py`
Expected: `Python side: all checks passed.`

### Task 6: Which pills fit in two rows (S1–S3)

**Files:**
- Create: `ui/src/lib/songPills.ts`
- Test: `ui/src/lib/songPills.test.ts`

**Interfaces:**
- Consumes: `SongChoice` with `last_take` (Task 5).
- Produces:

```ts
fitsInTwoRows(widths: number[], last: number, row: number, gap: number): boolean
pillsShown(here: SongChoice[], other: SongChoice[], width: (c: SongChoice) => number,
           last: number, row: number, gap: number): SongChoice[]
```

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/songPills.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { fitsInTwoRows, pillsShown } from "@/lib/songPills"
import type { SongChoice } from "@/lib/api"

const song = (name: string, last_take?: number): SongChoice => ({ song: name, name, last_take })
const by = (widths: Record<string, number>) => (c: SongChoice) => widths[c.name]

describe("fitsInTwoRows: pills wrap as flex-wrap lays them out", () => {
  it("fits what wraps once", () => {
    // Row of 100, gap 10: [40 40] [40 + last 30].
    expect(fitsInTwoRows([40, 40, 40], 30, 100, 10)).toBe(true)
  })
  it("refuses what needs a third row for All songs…", () => {
    expect(fitsInTwoRows([40, 40, 40, 40], 30, 100, 10)).toBe(false)
  })
  it("counts a pill wider than the row as one, cut to the row", () => {
    expect(fitsInTwoRows([500], 30, 100, 10)).toBe(true)
    expect(fitsInTwoRows([500, 500], 30, 100, 10)).toBe(false)
  })
})

describe("pillsShown: this rehearsal's first, then the rest, as many as fit", () => {
  it("adds the other songs, in their order, until the next would not fit", () => {
    const here = [song("Polyn 3", 2), song("Vesna 2", 3)]
    const other = [song("Ogon"), song("Sonce"), song("Dym")]
    const w = by({ "Polyn 3": 40, "Vesna 2": 40, Ogon: 40, Sonce: 40, Dym: 40 })
    expect(pillsShown(here, other, w, 30, 100, 10).map((c) => c.name)).toEqual([
      "Polyn 3",
      "Vesna 2",
      "Ogon",
    ])
  })
  it("keeps the songs played latest when this rehearsal's alone do not fit, in the order first played", () => {
    const here = [song("A", 9), song("B", 2), song("C", 7), song("D", 5)]
    const w = by({ A: 40, B: 40, C: 40, D: 40 })
    expect(pillsShown(here, [song("E")], w, 30, 100, 10).map((c) => c.name)).toEqual([
      "A",
      "C",
      "D",
    ])
  })
  it("shows nothing when there is nothing", () => {
    expect(pillsShown([], [], () => 0, 30, 100, 10)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd ui && npx vitest run src/lib/songPills.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/songPills"`.

- [ ] **Step 3: Write the implementation**

Create `ui/src/lib/songPills.ts`:

```ts
import type { SongChoice } from "@/lib/api"

/**
 * Whether pills of `widths`, in order with `gap` between them and then one
 * more `last` wide (All songs…), wrap into at most two rows `row` wide. A
 * pill wider than the row takes a row of its own, cut short to it.
 */
export function fitsInTwoRows(widths: number[], last: number, row: number, gap: number): boolean {
  let rows = 1
  let x = 0
  for (const w of [...widths, last]) {
    const width = Math.min(w, row)
    if (x === 0) x = width
    else if (x + gap + width <= row) x += gap + width
    else {
      rows += 1
      x = width
    }
    if (rows > 2) return false
  }
  return true
}

/**
 * The songs the two rows under a take's name show, in the order shown: this
 * rehearsal's first, then the others, as many as fit with All songs… after
 * them. When this rehearsal's alone do not fit, the ones whose latest take
 * is latest stay, still in the order they were first played.
 */
export function pillsShown(
  here: SongChoice[],
  other: SongChoice[],
  width: (c: SongChoice) => number,
  last: number,
  row: number,
  gap: number
): SongChoice[] {
  const fits = (cs: SongChoice[]) => fitsInTwoRows(cs.map(width), last, row, gap)
  if (fits(here)) {
    const shown = [...here]
    for (const c of other) {
      if (!fits([...shown, c])) break
      shown.push(c)
    }
    return shown
  }
  const latestFirst = [...here].sort((a, b) => (b.last_take ?? 0) - (a.last_take ?? 0))
  const kept = new Set<SongChoice>()
  for (const c of latestFirst) {
    if (!fits(here.filter((h) => kept.has(h) || h === c))) break
    kept.add(c)
  }
  return here.filter((h) => kept.has(h))
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd ui && npx vitest run src/lib/songPills.test.ts`
Expected: 6 passed.

### Task 7: `SongPills` under the field (S1–S6)

**Files:**
- Create: `ui/src/components/SongPills.tsx`
- Modify: `ui/src/components/TakeNameField.tsx` (use `SongPills` instead of `SongChips`)
- Test: `ui/e2e/naming.spec.ts`

**Interfaces:**
- Consumes: `pillsShown` (Task 6); `TakeNameField` (Task 3).
- Produces: `SongPills({ choices: SongChoices | null; value: string; initial: string; onPick: (name: string) => void })`. Each pill is a `button` with `data-song-choice={name}` and `aria-current="true"` when it matches `value`; the last is the button "All songs…" (`data-all-songs`), present only when there is at least one song.

- [ ] **Step 1: Write the failing tests**

In `ui/e2e/naming.spec.ts`, replace the first test ("the review screen offers the songs already played, and a click names the take") with the tests below, and add the helper under `group`:

```ts
/** The pills under the review screen's field, in the order shown. */
const pills = (page: Page) =>
  page.getByRole("group", { name: "Take name" }).locator("[data-song-choice]")

/** How many rows the pills under a field take, All songs… included. */
const rowsUnder = (page: Page, field: string) =>
  page.evaluate((label) => {
    const group = document.querySelector(`[role=group][aria-label='${label}']`)!
    const tops = [...group.querySelectorAll("[data-song-choice], [data-all-songs]")].map((p) =>
      Math.round(p.getBoundingClientRect().top)
    )
    return new Set(tops).size
  }, field)

test("the songs under the review screen's name: this rehearsal's first, a click fills the field", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  // Nothing played yet tonight: the whole repertoire, the latest played first.
  await expect(pills(page)).toHaveText(["Polyn", "Vesna", "Ogon", "Sonce", "Dym", "Ptaha", "Doroga"])
  await pills(page).filter({ hasText: /^Ogon$/ }).click()
  await expect(nameField(page)).toHaveValue("Ogon")
  // The click left the keyboard to the screen, so Space saves.
  await page.keyboard.press("Space")
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Ogon")

  // The next take is another go at it: first, lit, and not offered twice.
  await recordTake(page, 2)
  await expect(nameField(page)).toHaveValue("Ogon 2")
  await expect(pills(page).first()).toHaveText("Ogon 2")
  await expect(pills(page).first()).toHaveAttribute("aria-current", "true")
  await expect(pills(page).filter({ hasText: /^Ogon$/ })).toHaveCount(0)

  // Typing narrows them over every song; the song typed out in full puts
  // them all back; a title nobody has played leaves none in the way.
  await nameField(page).fill("do")
  await expect(pills(page)).toHaveText(["Doroga"])
  await nameField(page).fill("Doroga")
  await expect(pills(page).first()).toHaveText("Ogon 2")
  await expect(pills(page).filter({ hasText: /^Doroga$/ })).toHaveAttribute("aria-current", "true")
  await nameField(page).fill("Brand new")
  await expect(pills(page)).toHaveCount(0)
})

test("two rows at most, in any window, and the songs played latest stay", async ({ page }) => {
  // Twenty songs played tonight, one go each: more than two rows hold.
  const takes = Array.from({ length: 20 }, (_, i) => `Song number ${i + 1}`)
  await openApp(page)
  await startRehearsal(page)
  for (const [i, name] of takes.entries()) {
    await recordTake(page, i + 1)
    await nameField(page).fill(name)
    await page.getByRole("button", { name: /Save take/ }).click()
  }
  for (const width of [1366, 1024, 960]) {
    await page.setViewportSize({ width, height: 768 })
    await expect.poll(() => rowsUnder(page, "Next take"), { message: `at ${width}` }).toBe(2)
    // The ones kept are the latest played, still in the order played.
    const shown = await page
      .getByRole("group", { name: "Next take" })
      .locator("[data-song-choice]")
      .allTextContents()
    const numbers = shown.map((s) => Number(/(\d+) 2$/.exec(s)![1]))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(numbers.at(-1)).toBe(20)
  }
})

test("a song name longer than the row is cut short, and is still one pill", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameField(page).fill("A song with a name so long that no footer anywhere could hold it in one line")
  await page.getByRole("button", { name: /Save take/ }).click()
  const pill = page.getByRole("group", { name: "Next take" }).locator("[data-song-choice]").first()
  const cut = await pill.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(cut).toBe(true)
  expect(await rowsUnder(page, "Next take")).toBeLessThanOrEqual(2)
})

test("with no songs at all, nothing is offered under the field", async ({ page }) => {
  await openApp(page, {
    after: "window.pywebview.api.song_choices = async () => ({here: [], other: []});",
  })
  await startRehearsal(page)
  await expect(page.getByRole("textbox", { name: "Next take" })).toBeVisible()
  await expect(page.locator("[data-song-choice], [data-all-songs]")).toHaveCount(0)
})
```

The rename dialogs keep `PromptDialog` with `SongChips` until Task 10, so their two tests in this file pass unchanged here. `window.pywebview.api` is where `fake-bridge.js` puts the fake (its line `window.pywebview = { api: window.__MAKE_API__() };`), and `after:` runs once it is there.

- [ ] **Step 2: Run them to see them fail**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts -g "songs|rows|longer|no songs"`
Expected: FAIL — pills come in "This rehearsal"/"Other songs" groups with titles and more than two rows; no `data-all-songs`.

- [ ] **Step 3: Write `SongPills`**

Create `ui/src/components/SongPills.tsx`:

```tsx
import { useLayoutEffect, useRef, useState } from "react"
import type { SongChoice, SongChoices } from "@/lib/api"
import { pillsShown } from "@/lib/songPills"
import { cn } from "@/lib/utils"

/** The gap between pills, as `gap-1.5` draws it. */
const GAP = 6
const PILL =
  "max-w-full truncate rounded-full border px-3 py-1 text-[13px] font-medium transition-colors " +
  "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

/**
 * The songs under a take's name, in two rows at most: what this rehearsal
 * played, as the next go at each ("Polyn 3", the number dimmed), then the
 * other rehearsals' songs, the latest played first, and All songs… last.
 *
 * A click puts the song's name in the field; it leaves focus where it was,
 * so Space still records or saves. The one matching the field is lit where
 * it stands: nothing moves under the pointer. Typing narrows them over every
 * song, not only the ones shown.
 *
 * Which fit is worked out from the pills' own widths, measured off screen,
 * and again whenever the row changes width.
 */
export function SongPills({
  choices,
  value,
  initial,
  onPick,
}: {
  choices: SongChoices | null
  value: string
  /** What the field started from: it does not narrow them. */
  initial: string
  onPick: (name: string) => void
}) {
  const all = choices ? [...choices.here, ...choices.other] : []
  const typed = value.trim().toLocaleLowerCase()
  const isChoice = (c: SongChoice) => c.name.toLocaleLowerCase() === typed
  const narrowing = typed !== "" && value.trim() !== initial.trim() && !all.some(isChoice)
  const fits = (c: SongChoice) => !narrowing || c.song.toLocaleLowerCase().includes(typed)
  const here = (choices?.here ?? []).filter(fits)
  const other = (choices?.other ?? []).filter(fits)
  const candidates = [...here, ...other]
  const key = candidates.map((c) => c.name).join("\n")

  const row = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<string[]>([])

  // The observer answers once as soon as it starts, and then on every
  // change of width: the first answer comes before the row is painted.
  useLayoutEffect(() => {
    const rowEl = row.current
    const m = measure.current
    if (!rowEl || !m) return
    const lay = () => {
      const kids = [...m.children] as HTMLElement[]
      const width = new Map(candidates.map((c, i) => [c.name, kids[i].getBoundingClientRect().width]))
      const last = kids[candidates.length]?.getBoundingClientRect().width ?? 0
      const picked = pillsShown(here, other, (c) => width.get(c.name) ?? 0, last, rowEl.clientWidth, GAP)
      setShown(picked.map((c) => c.name))
    }
    const watch = new ResizeObserver(lay)
    watch.observe(rowEl)
    return () => watch.disconnect()
    // `key` stands for the candidates: the same names, the same layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (all.length === 0) return null
  const byName = new Map(candidates.map((c) => [c.name, c]))
  const visible = shown.map((n) => byName.get(n)).filter((c): c is SongChoice => !!c)

  return (
    <div className="relative min-w-0">
      <div ref={row} className="flex flex-wrap gap-1.5">
        {visible.map((c) => (
          <button
            key={c.name}
            type="button"
            data-song-choice={c.name}
            aria-current={isChoice(c) ? "true" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c.name)}
            className={cn(PILL, isChoice(c) && "border-primary bg-primary/15 hover:bg-primary/20")}
          >
            <SongName choice={c} />
          </button>
        ))}
        <AllSongsPill choices={all} value={value} onPick={onPick} className={PILL} />
      </div>
      {/* The same pills, out of sight, to measure. */}
      <div
        ref={measure}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-1.5"
      >
        {candidates.map((c) => (
          <span key={c.name} className={PILL}>
            <SongName choice={c} />
          </span>
        ))}
        <span className={PILL}>All songs…</span>
      </div>
    </div>
  )
}

/** "Polyn 3", the number dimmed: the song, and which go at it this is. */
export function SongName({ choice: c }: { choice: SongChoice }) {
  return (
    <>
      {c.song}
      {c.name !== c.song && (
        <span className="text-muted-foreground">{c.name.slice(c.song.length)}</span>
      )}
    </>
  )
}
```

and, until Task 8 replaces it, a plain All songs pill in the same file:

```tsx
function AllSongsPill({
  className,
}: {
  choices: SongChoice[]
  value: string
  onPick: (name: string) => void
  className: string
}) {
  return (
    <button type="button" data-all-songs className={cn(className, "border-dashed text-muted-foreground")}>
      All songs…
    </button>
  )
}
```

(oxlint honours the `eslint-disable-next-line react-hooks/exhaustive-deps` form; `ui/src/components/UnderTheHood.tsx` uses it.)

In `ui/src/components/TakeNameField.tsx`, replace the `SongChips` import with `import { SongPills } from "@/components/SongPills"` and the last element with:

```tsx
      <SongPills choices={choices} value={shown} initial={initial} onPick={put} />
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts e2e/player.spec.ts`
Expected: the four new tests and the next-take tests pass (`[data-song-choice]` is still on each pill, so "nothing moves" holds).

### Task 8: The All songs panel (S7)

**Files:**
- Modify: `ui/src/components/SongPills.tsx` (`AllSongsPill`)
- Test: `ui/e2e/naming.spec.ts`

**Interfaces:**
- Consumes: `Popover`, `PopoverTrigger`, `PopoverContent` from `ui/src/components/ui/popover.tsx`; `SongName` (Task 7).
- Produces: a dialog named "All songs" holding a `button` per song (`data-song-choice`), alphabetical.

- [ ] **Step 1: Write the failing test**

Add to `ui/e2e/naming.spec.ts`:

```ts
test("All songs… lists every song alphabetically, and a click fills the field and closes it", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameField(page).fill("Vesna")
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.getByRole("button", { name: "All songs…" }).click()
  const panel = page.getByRole("dialog", { name: "All songs" })
  await expect(panel).toBeVisible()
  // Every song, case-blind alphabetical, tonight's as its next go.
  await expect(panel.locator("[data-song-choice]")).toHaveText([
    "Doroga", "Dym", "Ogon", "Polyn", "Ptaha", "Sonce", "Vesna 2",
  ])
  await panel.getByRole("button", { name: "Ptaha" }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Next take" })).toHaveValue("Ptaha")
  expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Ptaha"])
  // Closed, it leaves the keyboard to the screen: Space records.
  await page.keyboard.press("Space")
  await expect(page.getByRole("heading", { level: 1, name: "Ptaha" })).toBeVisible()
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts -g "All songs"`
Expected: FAIL — no dialog named "All songs".

- [ ] **Step 3: Write the panel**

In `ui/src/components/SongPills.tsx`, add `import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"`, and replace `AllSongsPill` with:

```tsx
/** Song titles in the order a person looks for them: alphabetical, any
 *  script, capitals or not. History's list of songs (#12) uses the same. */
const ALPHABETICAL = new Intl.Collator(undefined, { sensitivity: "base" })

/**
 * The last pill, and the whole repertoire behind it, over the field: in
 * columns, alphabetical, scrolling when it is long. One click opens it, one
 * fills the field and closes it. Closed, focus goes nowhere in particular,
 * so the next Space is the screen's again.
 */
function AllSongsPill({
  choices,
  value,
  onPick,
  className,
}: {
  choices: SongChoice[]
  value: string
  onPick: (name: string) => void
  className: string
}) {
  const [open, setOpen] = useState(false)
  const typed = value.trim().toLocaleLowerCase()
  const sorted = [...choices].sort((a, b) => ALPHABETICAL.compare(a.song, b.song))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-all-songs
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            className,
            "border-dashed text-muted-foreground",
            open && "bg-accent text-foreground"
          )}
        >
          All songs…
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        aria-label="All songs"
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="max-h-[min(22rem,55vh)] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto p-3"
      >
        <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          All songs
        </div>
        <div className="mt-2 columns-[9rem] gap-4">
          {sorted.map((c) => (
            <button
              key={c.name}
              type="button"
              data-song-choice={c.name}
              aria-current={c.name.toLocaleLowerCase() === typed ? "true" : undefined}
              onClick={() => {
                onPick(c.name)
                setOpen(false)
              }}
              className={cn(
                "block w-full truncate rounded-md px-1.5 py-0.5 text-left text-sm break-inside-avoid hover:bg-accent",
                c.name.toLocaleLowerCase() === typed && "bg-primary/15 ring-1 ring-primary"
              )}
            >
              <SongName choice={c} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts`
Expected: all naming tests pass except the two rename tests (Task 10).

### Task 9: Step 2's docs, pictures and commit

**Files:**
- Modify: `docs/using-it.md`, `CHANGELOG.md`, `docs/screenshots/rehearsal.png`, `docs/screenshots/review.png`

- [ ] **Step 1: The guide**

In `docs/using-it.md`, in the paragraph from Task 4 Step 1, replace "and under it the songs you could play instead." with:

```markdown
and under it, in two rows, the songs you could play instead: tonight's
first, as the next go at each ("Polyn 3"), then the songs of earlier
rehearsals, the latest first. **All songs…** at the end lists every song
you have ever played, in alphabetical order. Typing in the field narrows
the songs to the ones that match.
```

- [ ] **Step 2: The changelog**

Under `## Unreleased`, add:

```markdown
- **The songs under the name fill two rows**, tonight's first and then the
  ones played at earlier rehearsals, and **All songs…** at the end opens
  every song you have played, alphabetically, in columns. When tonight
  alone has played more than two rows hold, the songs played latest stay.
  A click puts a song in the field; nothing moves under the pointer (#10).
```

- [ ] **Step 3: Pictures, verification, commit**

Run: `venv/Scripts/python.exe tests/docs_screenshots.py`; keep `rehearsal.png` and `review.png`, and restore the others with `git checkout -- docs/screenshots/<name>.png` if only their pixels moved.
Run: `venv/Scripts/python.exe tests/run_all.py` and `cd ui && npm run build && npx vitest run && npx oxlint && npx playwright test`. Expected: all pass, no new lint warnings.

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py ui/src/lib/api.ts ui/src/lib/songPills.ts \
  ui/src/lib/songPills.test.ts ui/src/components/SongPills.tsx ui/src/components/TakeNameField.tsx \
  ui/e2e/fake-bridge.js ui/e2e/naming.spec.ts docs/using-it.md CHANGELOG.md \
  docs/screenshots/rehearsal.png docs/screenshots/review.png
git commit -m "Offer the songs under a take's name in two rows, with every song a click away"
```

---

# Step 3 — the rename dialogs

### Task 10: Rename take on `TakeNameField` (R1, R2)

**Files:**
- Modify: `ui/src/components/ConfirmDialog.tsx` (add `RenameTakeDialog`)
- Modify: `ui/src/screens/Rehearsal.tsx` (the Rename take `PromptDialog`, around line 373)
- Modify: `ui/src/screens/HistoryScreen.tsx` (the Rename take `PromptDialog`, around line 398)
- Delete: `ui/src/components/SongChips.tsx`
- Test: `ui/e2e/naming.spec.ts` (the two rename tests)

**Interfaces:**
- Consumes: `TakeNameField` with `size="compact"`, `onEnter`, `autoFocus` (Task 3); `SongPills` inside it (Task 7).
- Produces: `RenameTakeDialog({ take: Take | null; choices: SongChoices | null; onOpenChange: (open: boolean) => void; onSubmit: (name: string) => void })`.

- [ ] **Step 1: Rewrite the two rename tests**

Replace them in `ui/e2e/naming.spec.ts` with:

```ts
test("renaming a take on the rehearsal screen offers the songs, ✕ puts its name back, and Enter renames", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Polyn")
  await recordTake(page, 2)
  await saveAs(page, "Polyn 2")

  await page.hover("[data-take='2']")
  await page.getByRole("button", { name: "Rename take Polyn 2" }).click()
  const dialog = page.getByRole("dialog")
  const field = dialog.getByRole("textbox", { name: "Take name" })
  // The take being renamed is not a go of its own: Polyn is still Polyn 2.
  await expect(dialog.locator("[data-song-choice]").first()).toHaveText("Polyn 2")
  await dialog.locator("[data-song-choice]").filter({ hasText: /^Vesna$/ }).click()
  await expect(field).toHaveValue("Vesna")
  await expect(field).toBeFocused()
  await dialog.getByRole("button", { name: "Put back “Polyn 2”" }).click()
  await expect(field).toHaveValue("Polyn 2")
  await field.fill("Vesna")
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  expect((await calls(page, "rename_take")).at(-1)?.args.slice(1)).toEqual([2, "Vesna"])
})

test("renaming a take in history offers what that rehearsal played, as the next go", async ({
  page,
}) => {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await openHistory(page)
  await page.hover("[data-take='3']")
  await page.getByRole("button", { name: "Rename take Take 3" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.locator("[data-song-choice]").nth(0)).toHaveText("Polyn 3")
  await expect(dialog.locator("[data-song-choice]").nth(1)).toHaveText("Vesna 2")
  expect((await calls(page, "song_choices")).at(-1)?.args).toEqual(["/rec/old", 3])
  await dialog.locator("[data-song-choice]").filter({ hasText: "Polyn 3" }).click()
  await dialog.getByRole("button", { name: "Rename" }).click()
  expect((await calls(page, "rename_take")).at(-1)?.args).toEqual(["/rec/old", 3, "Polyn 3"])
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts -g "renaming"`
Expected: FAIL — no textbox named "Take name" in the dialog, no "Put back" button.

- [ ] **Step 3: Write `RenameTakeDialog`**

In `ui/src/components/ConfirmDialog.tsx`, add the imports `import { TakeNameField } from "@/components/TakeNameField"` and `import type { SongChoices, Take } from "@/lib/api"` (merge with existing imports), and add at the end:

```tsx
/**
 * Rename take: the take's name in the field it was named in before and after
 * recording, at the dialog's size, with the songs under it. ✕ puts back the
 * name it has now; Enter renames, as Rename does.
 */
export function RenameTakeDialog({
  take,
  choices,
  onOpenChange,
  onSubmit,
}: {
  take: Take | null
  choices: SongChoices | null
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  return (
    <DialogPrimitive.Root open={take !== null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="text-base font-semibold">
            Rename take
          </DialogPrimitive.Title>
          {/* Keyed by the take, so a second take opened starts from its own name. */}
          {take && (
            <RenameTakeForm
              key={take.take_number}
              take={take}
              choices={choices}
              onSubmit={(name) => {
                onSubmit(name)
                onOpenChange(false)
              }}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function RenameTakeForm({
  take,
  choices,
  onSubmit,
}: {
  take: Take
  choices: SongChoices | null
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(take.name)
  return (
    <div className="mt-4 flex flex-col gap-4">
      <span className="text-xs text-muted-foreground">The folder on disk is renamed too.</span>
      <TakeNameField
        id="rename-take"
        label="Take name"
        size="compact"
        autoFocus
        value={name}
        initial={take.name}
        fallback={take.name}
        choices={choices}
        onCommit={setName}
        onEnter={onSubmit}
      />
      {/* As PromptDialog draws them. */}
      <div className="mt-2 flex justify-end gap-3">
        <DialogPrimitive.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogPrimitive.Close>
        <Button onClick={() => onSubmit(name)}>Rename</Button>
      </div>
    </div>
  )
}
```

(`overlayClass`, `contentClass`, `Button`, `DialogPrimitive` and `useState` are already at the top of `ConfirmDialog.tsx`, for `PromptDialog`.)

- [ ] **Step 4: Use it in both places, and delete `SongChips`**

In `ui/src/screens/Rehearsal.tsx`, replace the Rename take `PromptDialog` (the one with `title="Rename take"`) with:

```tsx
      <RenameTakeDialog
        take={toRename}
        choices={renameChoices}
        onOpenChange={(open) => !open && setToRename(null)}
        onSubmit={(name) => {
          if (toRename) void renameTake(toRename, name)
        }}
      />
```

and change the import to `import { ConfirmDialog, PromptDialog, RenameTakeDialog } from "@/components/ConfirmDialog"`; remove the `SongChips` import.

In `ui/src/screens/HistoryScreen.tsx`, replace the Rename take `PromptDialog` with:

```tsx
      <RenameTakeDialog
        take={takeToRename}
        choices={renameChoices}
        onOpenChange={(open) => !open && setTakeToRename(null)}
        onSubmit={(name) => {
          if (takeToRename) void renameTake(takeToRename, name)
        }}
      />
```

with the same import change; remove the `SongChips` import.

Delete `ui/src/components/SongChips.tsx`, then run `cd ui && npx tsc -b` — expected: no errors (nothing imports it any more).

- [ ] **Step 5: Run the tests**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts e2e/history.spec.ts e2e/player.spec.ts`
Expected: all pass, including `player.spec.ts` "renames the take and the rehearsal, and keeps the player on screen" and `history.spec.ts` "a row's own buttons work on its take without opening it".

### Task 11: Step 3's changelog, full verification, commit, close #10

- [ ] **Step 1: The changelog**

Under `## Unreleased`, add:

```markdown
- **Rename take uses the same field and songs**, on the rehearsal screen and
  in History: ✕ there puts back the name the take has, and Enter renames.
```

- [ ] **Step 2: Verify everything**

Run: `venv/Scripts/python.exe tests/run_all.py` — every suite passes.
Run: `cd ui && npm run build && npx vitest run && npx oxlint && npx playwright test` — build passes, Vitest all pass, no new lint warnings, every e2e test passes.

- [ ] **Step 3: Commit, and after the user says so, push and close #10**

```bash
git add ui/src/components/ConfirmDialog.tsx ui/src/screens/Rehearsal.tsx ui/src/screens/HistoryScreen.tsx \
  ui/src/components/SongChips.tsx ui/e2e/naming.spec.ts CHANGELOG.md
git commit -m "Rename a take in the same field it was named in"
```

Push and the issue comment wait for the user's word.
