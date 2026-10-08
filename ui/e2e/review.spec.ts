import {
  callCount,
  calls,
  dragRegion,
  expect,
  nameTake,
  openApp,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The screen after a take (issue #12 step 8, A1–A5): the take's song big,
// with its go and a pencil; how long it ran against the go before; the
// song's goes tonight as bars. The name field went into Rename take.

const summary = (page: Page) => page.locator("[data-take-summary]")
const title = (page: Page) => summary(page).getByRole("heading")
const line = (page: Page) => summary(page).locator("[data-take-line]")
const bars = (page: Page) => summary(page).locator("[data-go-bar]")
const pencil = (page: Page) => summary(page).getByRole("button", { name: "Rename take" })
const dialog = (page: Page) => page.getByRole("dialog", { name: "Rename take" })

/** The next take named on the rehearsal screen, then recorded and stopped. */
async function record(page: Page, name: string, n = 1) {
  const next = page.getByRole("textbox", { name: "Next take" })
  await next.fill(name)
  await page.keyboard.press("Enter")
  await recordTake(page, n)
}

/** Tonight's takes before this one: Viasna 1 (18 s, ★), Dym 1, Viasna 2 (12 s). */
const TONIGHT =
  "window.__TONIGHT__ = [{name: 'Viasna', duration_sec: 18, starred: true}," +
  " {name: 'Dym', duration_sec: 30}, {name: 'Viasna 2', duration_sec: 12}];"

test("the review screen shows the song with its go and a pencil, no name field", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await record(page, "Viasna")
  await expect(title(page)).toHaveText("Viasna 1")
  await expect(title(page).locator("[data-go]")).toHaveText("1")
  await expect(pencil(page)).toBeVisible()
  await expect(page.locator("#take-name")).toHaveCount(0)
  await expect(line(page)).toHaveText("0:06 · the first go at it tonight")
  await expect(bars(page)).toHaveCount(0)
})

test("a second go shows bars for the goes tonight and says how it compares", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(title(page)).toHaveText("Viasna 3")
  await expect(line(page)).toHaveText("0:06 · 6 s shorter than go 2")
  await expect(bars(page)).toHaveText(["1", "2", "3"])
  await expect(bars(page).nth(0)).toHaveAttribute("data-starred", "")
  await expect(bars(page).nth(2)).toHaveAttribute("data-here", "")
  // Each as tall as it ran: 18, 12 and 6 s.
  const height = (i: number) =>
    bars(page)
      .nth(i)
      .locator("[data-bar]")
      .evaluate((el) => el.getBoundingClientRect().height)
  expect(await height(0)).toBeGreaterThan(await height(1))
  expect(await height(1)).toBeGreaterThan(await height(2))
})

test("thirty goes tonight show the last ten as bars and the title stays whole", async ({ page }) => {
  const goes = Array.from(
    { length: 30 },
    (_, i) => `{name: 'Viasna${i ? ` ${i + 1}` : ""}', duration_sec: ${10 + (i % 7)}}`
  )
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, { before: `window.__TONIGHT__ = [${goes.join(",")}];` })
  await startRehearsal(page, 31)
  await recordTake(page, 31)
  await expect(title(page)).toHaveText("Viasna 31")
  await expect(bars(page)).toHaveCount(10)
  await expect(bars(page).first()).toHaveText("22")
  await expect(bars(page).last()).toHaveAttribute("data-here", "")
  const cut = await title(page)
    .locator("[data-go-title]")
    .evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(cut).toBe(false)
})

test("a first go tonight is measured against the last go before tonight with its day", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  // Tuesday jam played Pałyn for 10:00.
  await record(page, "Pałyn")
  await expect(line(page)).toHaveText(/^0:06 · 9:54 shorter than on 10 Sep/)
  await expect(bars(page)).toHaveCount(0)
})

test("while the go before tonight is looked up the line has the length alone", async ({
  page,
}) => {
  await openApp(page, {
    before:
      "window.__HOLD__ = {last_attempt: new Promise((r) => { window.__RELEASE__ = r })};",
  })
  await startRehearsal(page)
  await record(page, "Pałyn")
  await expect(line(page)).toHaveText("0:06")
  await page.evaluate(() => (window as unknown as { __RELEASE__: () => void }).__RELEASE__())
  await expect(line(page)).toHaveText(/^0:06 · 9:54 shorter than on 10 Sep/)
})

test("a take with no song says Take N and its length only", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await expect(title(page)).toHaveText("Take 1")
  await expect(title(page).locator("[data-go]")).toHaveCount(0)
  await expect(line(page)).toHaveText("0:06")
})

test("a long title is cut and whole on hover", async ({ page }) => {
  const long = "A song with a name far too long for the footer of the screen after a take"
  await openApp(page)
  await startRehearsal(page)
  await record(page, long)
  await expect(title(page)).toHaveAttribute("title", long)
  const cut = await title(page)
    .locator("[data-go-title]")
    .evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(cut).toBe(true)
  await expect(title(page).locator("[data-go]")).toHaveText("1")
})

test("the pencil renames the take and the title, bars and line follow", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(bars(page)).toHaveCount(3)
  await pencil(page).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).locator("#take-name")).toHaveValue("Viasna")
  // Not saved yet: it has no folder to rename.
  await expect(dialog(page)).not.toContainText("The folder on disk")
  await expect(dialog(page).locator("[data-song-choice]").first()).toBeVisible()
  await dialog(page).locator("#take-name").fill("Dym")
  await page.keyboard.press("Enter")
  await expect(dialog(page)).toHaveCount(0)
  await expect(title(page)).toHaveText("Dym 2")
  await expect(line(page)).toHaveText("0:06 · 24 s shorter than go 1")
  await expect(bars(page)).toHaveText(["1", "2"])

  await nameTake(page, "Ahoń")
  await expect(title(page)).toHaveText("Ahoń 1")
  await expect(line(page)).toHaveText("0:06 · the first go at it tonight")
  await expect(bars(page)).toHaveCount(0)
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Ahoń")
})

test("a take renamed and then cropped keeps its new name, bars and line", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await nameTake(page, "Dym")
  await expect(title(page)).toHaveText("Dym 2")
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await page.getByRole("button", { name: "Crop", exact: true }).click()
  await expect(page.getByText(/^Take 4 recorded/)).toBeVisible()
  await expect(line(page)).toHaveText(/^0:03 · /)
  await expect(title(page)).toHaveText("Dym 2")
  await expect(bars(page)).toHaveText(["1", "2"])
  await page.getByRole("button", { name: /Save take/ }).click()
  expect((await calls(page, "keep_take")).at(-1)?.args).toContain("Dym")
})

test("Space types in the dialog and Esc closes it without discarding", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await pencil(page).click()
  const field = dialog(page).locator("#take-name")
  await field.fill("Pałyn")
  await page.keyboard.press("Space")
  await expect(field).toHaveValue("Pałyn ")
  expect(await callCount(page, "keep_take")).toBe(0)
  await page.keyboard.press("Escape")
  await expect(dialog(page)).toHaveCount(0)
  await page.waitForTimeout(200)
  await expect(page.getByText("Discard this take?")).toHaveCount(0)
  await expect(title(page)).toHaveText("Take 1")
  expect(await callCount(page, "discard_take")).toBe(0)
})

test("outside the dialog Space saves and Esc asks", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameTake(page, "Sonca")
  await page.keyboard.press("Escape")
  await expect(page.getByText("Discard this take?")).toBeVisible()
  await page.getByRole("button", { name: "Keep it" }).click()
  await expect(page.getByText("Discard this take?")).toHaveCount(0)
  await page.keyboard.press("Space")
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Sonca")
})

test("the footer is no taller than its buttons need", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(bars(page)).toHaveCount(3)
  const footer = (await page.locator("footer").boundingBox())!
  expect(footer.height).toBeLessThan(140)
})
