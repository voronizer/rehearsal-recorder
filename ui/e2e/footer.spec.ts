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
      // Shell clips rather than scrolls, so a button cut off at the edge
      // would not make `sideways` true: this catches it directly.
      inside: boxes.every((r) => r.right <= window.innerWidth),
    }
  })

test.use({ viewport: { width: 960, height: 680 } })

test("setup: Start rehearsal on the right", async ({ page }) => {
  await openApp(page)
  await expect(startButton(page)).toBeVisible()
  const f = await footer(page)
  expect(f.main).toMatch(/^Start rehearsal/)
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false, inside: true })
})

test("rehearsal: Finish with an edge, Record rightmost", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  const f = await footer(page)
  expect(f.main).toMatch(/^Record take 1/)
  expect(f.variants).toEqual(["outline", "destructive"])
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false, inside: true })
})

test("recording: Stop on the right, autosave said under it", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  const f = await footer(page)
  expect(f.main).toMatch(/^Stop/)
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false, inside: true })
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
  expect(f).toMatchObject({ oneLine: true, onTheRight: true, sideways: false, inside: true })
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
  expect(f).toMatchObject({ onTheRight: true, sideways: false, inside: true })
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
