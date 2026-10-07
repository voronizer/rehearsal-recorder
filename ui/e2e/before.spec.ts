import { expect, openApp, openBandApp, recordTake, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Step 6 of issue #12: the Next take field, its songs and the named song's
// go from before tonight sit together in a panel right of the rehearsal,
// set back on the panel colour as the setup screen's Last time is. See
// docs/superpowers/specs/2026-10-02-last-time-while-rehearsing-design.md.

const panel = (page: Page) => page.getByRole("complementary", { name: "Next take" })
const card = (page: Page, song: string) => panel(page).getByRole("region", { name: `${song} before tonight` })
const pill = (page: Page, song: string) => panel(page).locator(`[data-song-choice='${song}']`)
const toggle = (page: Page) => panel(page).getByRole("button", { name: /^(\d+ more|Fewer)$/ })
const nextField = (page: Page) => page.getByRole("textbox", { name: "Next take" })

test("the Next take field and its songs sit in a panel right of the overview", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await expect(panel(page).getByRole("textbox", { name: "Next take" })).toBeVisible()
  await expect(panel(page).getByRole("group", { name: "Next take" })).toBeVisible()
  await expect(page.locator("footer").getByRole("textbox")).toHaveCount(0)

  const box = (await panel(page).boundingBox())!
  const main = (await page.locator("main").boundingBox())!
  const header = (await page.locator("header").first().boundingBox())!
  const footer = (await page.locator("footer").boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(main.x + main.width - 1)
  expect(Math.abs(box.width - 416)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y + box.height - footer.y)).toBeLessThanOrEqual(1)

  // Set back from the page, as the setup screen's Last time column is.
  const colours = await page.evaluate(() => {
    const aside = document.querySelector("[data-next-take-panel]")!
    return {
      panel: getComputedStyle(aside).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }
  })
  expect(colours.panel).not.toBe(colours.page)
  expect(colours.panel).not.toBe("rgba(0, 0, 0, 0)")

  await page.setViewportSize({ width: 960, height: 680 })
  await expect
    .poll(async () => Math.round((await panel(page).boundingBox())!.width))
    .toBe(360)
  expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test.describe("the card", () => {
  test("a fresh rehearsal's card says how to see goes from before", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(
      panel(page).getByText("Name the next take after a song to see how it went before.")
    ).toBeVisible()
  })

  test("a song pill brings its last go from before tonight", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await pill(page, "Daroha").click()
    const daroha = card(page, "Daroha")
    await expect(daroha).toBeVisible()
    await expect(daroha.getByRole("heading", { level: 2 })).toContainText("before tonight")
    await expect(daroha.getByRole("button", { name: /^Play / })).toHaveCount(1)
    await expect(daroha.getByRole("button", { name: "Play Daroha 2" })).toBeVisible()
    await expect(daroha).toContainText("4:00")
    await expect(daroha).toContainText("25 Aug")
    await expect(toggle(page)).toHaveCount(0)
    // The rehearsal whose folder is gone had Daroha 9: it cannot be played.
    await expect(daroha).not.toContainText("Daroha 9")
  })

  test("the newest starred go is shown, and more opens the rest under it", async ({ page }) => {
    await openBandApp(page)
    await startRehearsal(page, 4)
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    const rows = palyn.getByRole("button", { name: /^(Play|Pause) / })
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAccessibleName("Play Pałyn 7")
    await expect(palyn).toContainText("22 Sep")
    await expect(toggle(page)).toHaveText(/^1 more/)
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false")

    const firstAt = (await rows.first().boundingBox())!
    await toggle(page).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1)).toHaveAccessibleName("Play Pałyn 3")
    await expect(palyn).toContainText("15 Sep")
    await expect(toggle(page)).toHaveText(/^Fewer/)
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true")
    const stillAt = (await rows.first().boundingBox())!
    expect(Math.abs(stillAt.x - firstAt.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(stillAt.y - firstAt.y)).toBeLessThanOrEqual(1)

    // Another song, and back: it starts folded again.
    await pill(page, "Viasna").click()
    await expect(card(page, "Viasna")).toBeVisible()
    await pill(page, "Pałyn").click()
    await expect(card(page, "Pałyn")).toBeVisible()
    await expect(toggle(page)).toHaveText(/^1 more/)
    await expect(rows).toHaveCount(1)
  })

  test("a song played only tonight says its goes are in the overview", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await page.locator("#take-name").fill("Sonca")
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(nextField(page)).toHaveValue("Sonca")
    await expect(
      panel(page).getByText("No goes at Sonca before tonight. Tonight's are in the overview.")
    ).toBeVisible()
  })

  test("a new song says it has no goes before tonight", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await nextField(page).fill("Brand new")
    await page.keyboard.press("Enter")
    await expect(panel(page).getByText("No goes at Brand new before tonight.")).toBeVisible()
  })

  test("a take open in the player hides the card, and the field stays where it was", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true" })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: /Save take/ }).click()
    await pill(page, "Pałyn").click()
    await expect(card(page, "Pałyn")).toBeVisible()
    const fieldAt = (await nextField(page).boundingBox())!

    await page
      .locator("[aria-label='Rehearsal overview']")
      .getByRole("button", { name: /^Take 1 / })
      .click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(card(page, "Pałyn")).toHaveCount(0)
    const fieldNow = (await nextField(page).boundingBox())!
    expect(Math.abs(fieldNow.x - fieldAt.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(fieldNow.y - fieldAt.y)).toBeLessThanOrEqual(1)

    await page.keyboard.press("Escape")
    await expect(card(page, "Pałyn")).toBeVisible()
  })

  test("a long title is cut short in the card's heading, whole on hover", async ({ page }) => {
    const long = "A very long song title that goes on and on past the panel"
    await openApp(page, { before: `window.__EXTRA_SONGS__ = ${JSON.stringify([long])}` })
    await startRehearsal(page)
    await nextField(page).fill(long)
    await page.keyboard.press("Enter")
    const title = card(page, long).locator("[data-before-title]")
    await expect(title).toHaveAttribute("title", long)
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

    await page.setViewportSize({ width: 960, height: 680 })
    await expect
      .poll(async () => Math.round((await panel(page).boundingBox())!.width))
      .toBe(360)
    expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})
