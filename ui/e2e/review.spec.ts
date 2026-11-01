import {
  callCount,
  calls,
  dragRegion,
  expect,
  nameTake,
  notices,
  openApp,
  recordTake,
  scaled,
  settled,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The screen after a take (issue #12 step 8, and the design system's Q1,
// "the name in the header"): the header's title is the take, its song with
// its number and a pencil, on up to two lines, with "Take N · rehearsal"
// over it and the song's takes tonight as columns at its right. The footer
// is one row: the cloud line, then Discard and Save take. The take's length
// is the transport's to say.

const summary = (page: Page) => page.locator("[data-take-summary]")
const title = (page: Page) => page.locator("header h1")
const drawn = (page: Page) => title(page).locator("[data-go-title]")
const subtitle = (page: Page) => page.locator("header [data-subtitle]")
const figures = (page: Page) => page.locator("header [data-take-figures]")
/** The columns drawn: the figures also hold an unseen copy, to measure. */
const columns = (page: Page) => figures(page).getByRole("img").locator("[data-column]")
const pencil = (page: Page) => summary(page).getByRole("button", { name: "Rename take" })
const dialog = (page: Page) => page.getByRole("dialog", { name: "Rename take" })
const tip = (page: Page) => page.locator("[data-whole][data-state$='open']")
const cloudBox = (page: Page) => page.getByRole("checkbox", { name: /^Send to the cloud/ })

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

/** The band's evening so far: Pałyn 1 to 3 were takes 1, 2 and 6, so the
 *  next Pałyn is take 7 and its fourth. */
const PALYN =
  "window.__TONIGHT__ = [{name: 'Pałyn', duration_sec: 58}," +
  " {name: 'Pałyn 2', duration_sec: 155, starred: true}, {name: 'Ahoń', duration_sec: 12}," +
  " {name: 'Take 4', duration_sec: 108}, {name: 'Viasna', duration_sec: 141}," +
  " {name: 'Pałyn 3', duration_sec: 172}];"

/** A cloud folder, with every take sent to it. */
const CLOUD =
  "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';" +
  " window.__AUTO_PUBLISH__ = {on: true, what: 'mix'};"

/** The fake's takes are 6 s, false starts under the 30 s the setting starts
 *  at, which sending on its own leaves behind. With the limit at its lowest
 *  they are takes like any other. */
const LONG_ENOUGH = " window.__FALSE_START__ = 5;"

/** A new song with a name of 111 characters. */
const LONG =
  "Last song of the night that we wrote in the van on the way back from the festival, with a new bridge at the end"

/** How many 1 px lines show in the header's row: the one between the
 *  columns and the buttons, while the columns show. It keeps its room when
 *  they go, unseen. */
const rules = (page: Page) =>
  page
    .locator("header")
    .evaluate(
      (h) =>
        [...h.children].filter(
          (el) =>
            el.getBoundingClientRect().width === 1 && getComputedStyle(el).visibility !== "hidden"
        ).length
    )

/** The stress take's song, take 33 being its second. */
const KALYCHANKA =
  "Kalychanka (slow version for the wedding, with the long intro the bride asked for)"
/** The stress rehearsal's name, in the subtitle with take 33. */
const STRESS_SUBTITLE =
  "Take 33 · Tuesday jam at the old brewery, with the horn section and the choir from upstairs"

/** Whether the page has scrolled sideways anywhere. */
const sideways = (page: Page) =>
  page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("header, main, footer")].some(
      (el) => el.scrollWidth > el.clientWidth + 1
    )
  )

test("the header's title is the take with its number and pencil, under Take N and the rehearsal", async ({
  page,
}) => {
  await openApp(page, { before: PALYN })
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startRehearsal(page, 7)
  await record(page, "Pałyn", 7)
  await expect(title(page)).toHaveText("Pałyn 4")
  await expect(title(page).locator("[data-go]")).toHaveText("4")
  await expect(title(page).getByRole("button", { name: "Rename take" })).toBeVisible()
  await expect(subtitle(page)).toHaveText("Take 7 · Tuesday jam")
  await expect(page.getByText(/recorded/)).toHaveCount(0)
  await expect(page.locator("#take-name")).toHaveCount(0)
  // The pencil says what it does in the shared tip.
  await pencil(page).hover()
  await expect(page.getByRole("tooltip")).toHaveText("Rename take")
})

test("the take's length is said once, by the transport, not in the header", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(title(page)).toHaveText("Viasna 3")
  await expect(page.locator("[data-take-line]")).toHaveCount(0)
  await expect(page.locator("header")).not.toContainText("0:06")
  await expect(page.locator("header")).not.toContainText("shorter than")
  await expect(page.getByRole("toolbar", { name: "Transport" })).toContainText("0:06")
})

test("a second take shows columns for the takes tonight, said in words", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(columns(page)).toHaveText(["1", "2", "3"])
  // Each column by the take's own name, so its number is not an evening's "Take 3".
  const said = "Viasna 1: 0:18, Viasna 2: 0:12, Viasna 3: 0:06"
  await expect(figures(page).getByRole("img")).toHaveAccessibleName(`Takes of Viasna tonight: ${said}`)
  await expect(columns(page).nth(0)).toHaveAttribute("data-starred")
  await expect(columns(page).nth(2)).toHaveAttribute("data-lit")
  // A line sets them apart from the buttons after them.
  expect(await rules(page)).toBe(1)
  // Each as tall as it ran: 18, 12 and 6 s.
  const height = (i: number) =>
    columns(page)
      .nth(i)
      .locator("[data-bar]")
      .evaluate((el) => el.getBoundingClientRect().height)
  expect(await height(0)).toBeGreaterThan(await height(1))
  expect(await height(1)).toBeGreaterThan(await height(2))
  // Hovering them says them.
  await settled(page)
  await figures(page).getByRole("img").hover()
  await expect(page.getByRole("tooltip")).toHaveText(said)
})

test("a window narrowed and widened across where the columns give way settles each time", async ({
  page,
}) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(columns(page)).toHaveCount(3)
  // Somewhere between these widths three columns stop fitting beside
  // "Viasna 3", whatever the font. Each width gets two frames to settle; an
  // error in the page fails the test.
  const widths = Array.from({ length: 45 }, (_, i) => 520 - i * 5)
  const frames = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    )
  for (const width of [...widths, ...[...widths].reverse()]) {
    await page.setViewportSize({ width, height: 680 })
    await frames()
  }
  await expect(columns(page)).toHaveCount(3)
  expect(await rules(page)).toBe(1)
  await page.setViewportSize({ width: 300, height: 680 })
  await expect(figures(page)).toHaveAttribute("data-columns-gone")
  expect(await rules(page)).toBe(0)
})

test("thirty takes tonight show the last ten as columns and the title stays whole", async ({
  page,
}) => {
  const takes = Array.from(
    { length: 30 },
    (_, i) => `{name: 'Viasna${i ? ` ${i + 1}` : ""}', duration_sec: ${10 + (i % 7)}}`
  )
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, { before: `window.__TONIGHT__ = [${takes.join(",")}];` })
  await startRehearsal(page, 31)
  await recordTake(page, 31)
  await expect(title(page)).toHaveText("Viasna 31")
  await expect(columns(page)).toHaveCount(10)
  await expect(columns(page).first()).toHaveText("22")
  await expect(columns(page).last()).toHaveAttribute("data-lit")
  await expect(drawn(page)).not.toHaveAttribute("data-cut")
})

test("a take nobody named is Take N in grey, with no columns", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await expect(title(page)).toHaveText("Take 1")
  await expect(title(page).locator("[data-go]")).toHaveCount(0)
  await expect(figures(page)).toHaveCount(0)
  const colour = (selector: string) =>
    page.locator(selector).first().evaluate((el) => getComputedStyle(el).color)
  expect(await colour("header [data-go-title]")).toBe(await colour("header [data-subtitle]"))
})

test("a long title takes two lines, then is cut with its number, whole in the tooltip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page)
  await startRehearsal(page)
  await record(page, LONG)
  // Two lines, whole, and the pencil right after the last word rather than
  // at the box's right edge.
  await expect(drawn(page)).toHaveAttribute("data-lines", "2")
  await expect(drawn(page)).not.toHaveAttribute("data-cut")
  const go = (await title(page).locator("[data-go]").boundingBox())!
  const pen = (await pencil(page).boundingBox())!
  expect(pen.x - (go.x + go.width)).toBeGreaterThanOrEqual(0)
  expect(pen.x - (go.x + go.width)).toBeLessThan(12)
  expect(Math.abs(pen.y + pen.height / 2 - (go.y + go.height / 2))).toBeLessThan(4)
  expect(await sideways(page)).toBe(false)

  // At 150 % it has no room for two lines: cut at a word, the number kept,
  // whole in the shared tip.
  await openApp(page, { before: scaled(1.5) })
  await startRehearsal(page)
  await record(page, LONG)
  await expect(drawn(page)).toHaveAttribute("data-cut")
  await expect(drawn(page)).toHaveAttribute("data-lines", "2")
  await expect(drawn(page)).toContainText("…")
  await expect(title(page).locator("[data-go]")).toHaveText("1")
  await expect(pencil(page)).toBeVisible()
  expect(await sideways(page)).toBe(false)
  // The cloud line beside the buttons keeps to one line too.
  const words = page.locator("footer [data-cloud-line] [data-slot='tooltip-trigger']")
  expect(
    await words.evaluate(
      (el) => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1
    )
  ).toBe(true)
  await settled(page)
  await drawn(page).hover()
  await expect(tip(page)).toHaveText(LONG)
})

// Take 33, the second of the longest song name, take 16 its first.
for (const scale of [1, 1.5]) {
  test(`the columns give way before the title, and hovering the title says them, at ${scale * 100} %`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page, { stress: "recording", before: scaled(scale) })
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(summary(page)).toBeVisible()
    await expect(figures(page)).toHaveAttribute("data-columns-gone")
    await expect(columns(page)).toHaveCount(0)
    // With the columns gone, so is the line after them.
    expect(await rules(page)).toBe(0)
    await expect(pencil(page)).toBeVisible()
    expect(await sideways(page)).toBe(false)
    // A screen reader still has them.
    await expect(figures(page)).toContainText(/^Takes of Kalychanka .* tonight: Kalychanka /)
    await settled(page)
    await drawn(page).hover()
    await expect(tip(page)).toContainText(`${KALYCHANKA} 1: `)
    await expect(tip(page)).toContainText(`${KALYCHANKA} 2: 2:31`)
    // Whether the rehearsal's name is cut here depends on the font: the
    // next test cuts it whatever the font, and hovers it.
  })
}

test("a long rehearsal name is cut before the columns, never making them give way", async ({
  page,
}) => {
  // Zorka 9, a short title with nine columns, under the stress rehearsal's
  // long name: at 150 % the name is wider than the room the columns leave.
  await openApp(page, { stress: "recording", before: scaled(1.5) })
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(summary(page)).toBeVisible()
  await nameTake(page, "Zorka")
  await expect(title(page)).toHaveText("Zorka 9")
  await expect(figures(page)).not.toHaveAttribute("data-columns-gone")
  await expect(columns(page)).toHaveCount(9)
  expect(await sideways(page)).toBe(false)
  // Cut where the columns begin, not at the title's end.
  await expect(subtitle(page)).toHaveAttribute("data-cut")
  const line = (await subtitle(page).boundingBox())!
  const first = (await columns(page).first().boundingBox())!
  const name = (await drawn(page).boundingBox())!
  expect(line.x + line.width).toBeLessThanOrEqual(first.x)
  expect(line.x + line.width).toBeGreaterThan(name.x + name.width)
  await settled(page)
  await subtitle(page).hover()
  await expect(tip(page)).toHaveText(STRESS_SUBTITLE)
})

test("Save take is the footer's 56 px button and Discard 40", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  const save = (await page.getByRole("button", { name: /Save take/ }).boundingBox())!
  const discard = (await page.getByRole("button", { name: /Discard/ }).boundingBox())!
  expect(save.height).toBe(56)
  expect(discard.height).toBe(40)
  // One row: no line between the take and the buttons, the cloud line at its left.
  await expect(page.locator("footer [data-footer-rule]")).toHaveCount(0)
  const line = (await page.locator("footer [data-cloud-line]").boundingBox())!
  expect(line.x + line.width).toBeLessThan(discard.x)
})

test("the cloud line holds its room before the settings answer", async ({ page }) => {
  await openApp(page, { before: CLOUD + LONG_ENOUGH })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  // The screen asks for the settings as it comes up; they are held there.
  await page.evaluate(() => {
    const w = window as unknown as {
      pywebview: { api: Record<string, () => Promise<unknown>> }
      __LET_GO__: () => void
    }
    const real = w.pywebview.api.get_settings
    const waiting: (() => void)[] = []
    w.pywebview.api.get_settings = () =>
      new Promise((done) => waiting.push(() => done(real())))
    w.__LET_GO__ = () => {
      w.pywebview.api.get_settings = real
      for (const go of waiting) go()
    }
  })
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(summary(page)).toBeVisible()
  await settled(page)
  await expect(page.locator("[data-cloud-line='waiting']")).toHaveCount(1)
  const measure = () =>
    page.evaluate(() => ({
      footer: document.querySelector("footer")!.getBoundingClientRect().height,
      line: document.querySelector("footer [data-cloud-line]")!.getBoundingClientRect().height,
      header: document.querySelector("header")!.getBoundingClientRect().height,
      player: document.querySelector("[aria-label='Transport']")!.getBoundingClientRect().top,
    }))
  const before = await measure()
  await page.evaluate(() => (window as unknown as { __LET_GO__: () => void }).__LET_GO__())
  await expect(cloudBox(page)).toBeChecked()
  await expect(page.locator("footer")).toContainText("Send to the cloud: the mix, WAV")
  expect(await measure()).toEqual(before)
})

test("the cloud box is a checkbox, and Space after ticking it saves the take", async ({ page }) => {
  await openApp(page, { before: CLOUD + LONG_ENOUGH })
  await startRehearsal(page)
  await recordTake(page)
  await expect(cloudBox(page)).toBeChecked()
  await cloudBox(page).click()
  await expect(cloudBox(page)).not.toBeChecked()
  // The box gave up focus, so Space is the screen's: Save take.
  await page.keyboard.press("Space")
  await expect.poll(() => callCount(page, "keep_take")).toBe(1)
  expect((await calls(page, "keep_take"))[0].args[6]).toBe(false)
})

test("a false start's cloud box starts unticked, and a mark ticks it", async ({ page }) => {
  await openApp(page, { before: CLOUD })
  await startRehearsal(page)
  await recordTake(page)
  await expect(cloudBox(page)).not.toBeChecked()
  // M makes a mark and opens its note, which covers the screen until saved.
  await page.keyboard.press("m")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(cloudBox(page)).toBeChecked()
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect.poll(() => callCount(page, "keep_take")).toBe(1)
  // Ticked as the setting does it for a marked take: left to the setting.
  expect((await calls(page, "keep_take"))[0].args[6]).toBeNull()
})

test("a false start ticked by hand is sent", async ({ page }) => {
  await openApp(page, { before: CLOUD })
  await startRehearsal(page)
  await recordTake(page)
  await cloudBox(page).click()
  await expect(cloudBox(page)).toBeChecked()
  await page.keyboard.press("Space")
  await expect.poll(() => callCount(page, "keep_take")).toBe(1)
  expect((await calls(page, "keep_take"))[0].args[6]).toBe(true)
})

test("the player's groups rise in, 40 ms apart", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  const rise = (el: string) =>
    page.locator(el).evaluate((e) => {
      const s = getComputedStyle(e.closest(".animate-rise")!)
      return [s.animationName, s.animationDelay]
    })
  expect(await rise("[aria-label='Transport']")).toEqual(["rise", "0s"])
  expect(await rise("[aria-label='Take timeline']")).toEqual(["rise", "0.04s"])
})

test("the pencil renames the take and the title and columns follow", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(columns(page)).toHaveCount(3)
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
  await expect(columns(page)).toHaveText(["1", "2"])

  // A song's first take tonight has no columns.
  await nameTake(page, "Ahoń")
  await expect(title(page)).toHaveText("Ahoń 1")
  await expect(figures(page)).toHaveCount(0)
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Ahoń")
})

test("the header is as tall with the columns as without, and no taller than they need", async ({
  page,
}) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(columns(page)).toHaveCount(3)
  await expect(drawn(page)).toHaveAttribute("data-lines", "1")
  await settled(page)
  const header = () =>
    page.evaluate(() => {
      const h = document.querySelector("header")!
      const s = getComputedStyle(h)
      const box = h.getBoundingClientRect()
      const words =
        h.querySelector("h1")!.getBoundingClientRect().bottom -
        h.querySelector("[data-subtitle]")!.getBoundingClientRect().top
      const cols = h.querySelector("[data-take-figures] [role=img]")?.getBoundingClientRect()
      return {
        height: box.height,
        // The room inside its padding, and what stands in it.
        top: box.top + parseFloat(s.paddingTop),
        bottom: box.bottom - parseFloat(s.paddingBottom) - parseFloat(s.borderBottomWidth),
        words,
        columns: cols ? { top: cols.top, bottom: cols.bottom } : null,
        player: document.querySelector("[aria-label='Transport']")!.getBoundingClientRect().top,
      }
    })
  const was = await header()
  // The columns stand inside the header's padding, and the header is as
  // tall as the taller of them and the two lines of words.
  expect(was.columns!.top).toBeGreaterThanOrEqual(was.top - 0.5)
  expect(was.columns!.bottom).toBeLessThanOrEqual(was.bottom + 0.5)
  const columnsTall = was.columns!.bottom - was.columns!.top
  expect(was.bottom - was.top).toBeLessThanOrEqual(Math.max(was.words, columnsTall) + 0.5)
  // A song's first take tonight has none, and nothing under the header moves.
  await nameTake(page, "Ahoń")
  await expect(figures(page)).toHaveCount(0)
  await expect(drawn(page)).toHaveAttribute("data-lines", "1")
  const now = await header()
  expect(now.height).toBe(was.height)
  expect(now.player).toBe(was.player)
})

test("a take renamed and then cropped keeps its new name and columns", async ({ page }) => {
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await nameTake(page, "Dym")
  await expect(title(page)).toHaveText("Dym 2")
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect(page.getByRole("toolbar", { name: "Transport" })).toContainText("0:03")
  await expect(subtitle(page)).toHaveText(/^Take 4 · /)
  await expect(title(page)).toHaveText("Dym 2")
  await expect(columns(page)).toHaveText(["1", "2"])
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
  await expect(title(page)).toHaveText("Take 1")
  expect(await callCount(page, "discard_take")).toBe(0)
})

test("outside the dialog Esc discards at once, Undo brings it back, and Space saves", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameTake(page, "Sonca")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
  expect(await callCount(page, "discard_take")).toBe(1)
  await notices(page)
    .filter({ hasText: "“Sonca 1” went to the Trash." })
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(title(page)).toHaveText("Sonca 1")
  await page.keyboard.press("Space")
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Sonca")
})

test("the footer is no taller than its buttons need", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await openApp(page, { before: TONIGHT })
  await startRehearsal(page, 4)
  await recordTake(page, 4)
  await expect(columns(page)).toHaveCount(3)
  const footer = (await page.locator("footer").boundingBox())!
  expect(footer.height).toBeLessThan(140)
})
