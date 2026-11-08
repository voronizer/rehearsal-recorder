import type { Locator, Page } from "@playwright/test"
import {
  colour,
  expect,
  openApp,
  openBandApp,
  openEvening,
  openHistory,
  settled,
  startRehearsal,
  style,
  test,
  themed,
} from "./app.ts"

// The take strip on the shared pieces (owner, 2026-10-12): Songs a Toggle, a
// toolbar in the take row's order, the edges Buttons with their names in a
// tip, and tabs whose numbers, dots and day headings follow the five sizes
// and the type rules. Tonight's takes are TONIGHT in app.ts: Viasna has three
// of them (3, 5, 7), take 5 is in the cloud, and Pałyn's are not.

const strip = (page: Page) => page.getByRole("group", { name: "Take strip" })
const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })
const songs = (page: Page) => strip(page).getByRole("button", { name: "Songs", exact: true })
const openTab = (scope: Locator) => scope.locator("[data-tab][aria-current='true']")
/** The shared tooltip, as a screen reader is given it. */
const tooltip = (page: Page) => page.getByRole("tooltip")
/** The pointer off whatever it was over, on its way as a hand takes it: a
 *  tip closes on the pointer leaving, not on its being somewhere else. */
const away = (page: Page) => page.mouse.move(0, 0, { steps: 8 })

const THEMES = ["dark", "light"] as const
type Theme = (typeof THEMES)[number]

/** Tonight's rehearsal with take `n` open in the player, under its strip. */
async function openTake(page: Page, n: number, theme: Theme = "dark") {
  const overview = await openEvening(page, themed(theme))
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
    theme === "dark"
  )
  await overview.getByRole("button", { name: new RegExp(`^Take ${n} `) }).click()
  await expect(timeline(page)).toBeVisible()
  await expect(strip(page)).toBeVisible()
  await settled(page)
}

/** Whether an element draws a border: a width, in a colour that shows. */
const bordered = (el: Locator) =>
  el.evaluate((e) => {
    const cs = getComputedStyle(e)
    return ["top", "right", "bottom", "left"].some(
      (side) =>
        cs.getPropertyValue(`border-${side}-width`) !== "0px" &&
        cs.getPropertyValue(`border-${side}-color`) !== "rgba(0, 0, 0, 0)"
    )
  })

for (const theme of THEMES) {
  test(`Songs is a toggle without capitals, grey when open, in the ${theme} theme`, async ({
    page,
  }) => {
    await openTake(page, 5, theme)
    const button = songs(page)
    await expect(button).toHaveAttribute("data-slot", "toggle")
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await expect(button).toHaveAttribute("aria-expanded", "false")
    await expect(button).not.toHaveAttribute("title")
    expect((await style(button, "text-transform"))["text-transform"]).toBe("none")

    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
    await expect(button).toHaveAttribute("aria-expanded", "true")
    // The grey of what is on, not the accent; and the pointer still over it
    // does not change that.
    await expect(button).toHaveCSS("background-color", await colour(page, "--selected"))
    await expect(button).toHaveCSS("color", await colour(page, "--foreground"))
    await expect(strip(page).locator("[data-column]")).not.toHaveCount(0)

    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await expect(button).toHaveAttribute("aria-expanded", "false")
    await expect(strip(page).locator("[data-column]")).toHaveCount(0)
  })
}

for (const theme of THEMES) {
  test(`the open tab's bar is grey, in the ${theme} theme`, async ({ page }) => {
    await openTake(page, 5, theme)
    const bar = openTab(strip(page)).locator("[data-tab-bar]")
    await expect(bar).toHaveCount(1)
    const grey = await colour(page, "--muted-foreground")
    await expect(bar).toHaveCSS("background-color", grey)
    expect(grey).not.toBe(await colour(page, "--primary"))
    // Its top corners are the small radius (4 px), its foot is flat.
    expect(
      await style(
        bar,
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-left-radius",
        "border-bottom-right-radius"
      )
    ).toEqual({
      "border-top-left-radius": "4px",
      "border-top-right-radius": "4px",
      "border-bottom-left-radius": "0px",
      "border-bottom-right-radius": "0px",
    })
  })
}

test("the strip's toolbar is star, rename, cloud, delete, as on a take row", async ({ page }) => {
  await openTake(page, 5)
  const tools = [
    strip(page).getByRole("button", { name: /^Star / }),
    strip(page).getByRole("button", { name: /^Rename take / }),
    strip(page).getByRole("button", { name: /^Cloud copies of |^Copy .* to the cloud$/ }),
    strip(page).getByRole("button", { name: /^Delete take / }),
  ]
  const boxes = await Promise.all(tools.map(async (t) => (await t.boundingBox())!))
  // One row, left to right in that order.
  for (const b of boxes) expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(1)
  const gaps = boxes.slice(1).map((b, i) => b.x - (boxes[i].x + boxes[i].width))
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(0)
  // The three that act on the take sit together; delete is set apart from
  // them by at least 8 px more than they are from each other.
  expect(Math.abs(gaps[0] - gaps[1])).toBeLessThan(0.5)
  expect(gaps[2] - gaps[1]).toBeGreaterThanOrEqual(8)
})

test("the strip shows one cloud icon whatever the take's cloud state", async ({ page }) => {
  await openTake(page, 5)
  const cloud = strip(page).getByRole("button", { name: /^Cloud copies of |^Copy .* to the cloud$/ })
  // Take 5 has its mix in the cloud folder.
  await expect(cloud).toHaveAccessibleName("Cloud copies of Viasna 2")
  await expect(cloud.locator("svg.lucide-cloud-upload")).toHaveCount(1)
  await expect(cloud).not.toHaveAttribute("title")
  await cloud.hover()
  await expect(tooltip(page)).toHaveText("In the cloud folder")

  // A Pałyn take has nothing there.
  await away(page)
  await expect(tooltip(page)).toHaveCount(0)
  await strip(page).getByRole("button", { name: /^Pałyn, take / }).click()
  await expect(cloud).toHaveAccessibleName(/^Copy Pałyn \d+ to the cloud$/)
  await expect(cloud.locator("svg.lucide-cloud-upload")).toHaveCount(1)
  await expect(cloud.locator("svg")).toHaveCount(1)
  await cloud.hover()
  await expect(tooltip(page)).toHaveText("Copy this take to the cloud folder")
})

test("a tab's take number is in even figures, not a mono box", async ({ page }) => {
  await openTake(page, 5)
  const name = openTab(strip(page)).locator("[data-tab-name]")
  const number = strip(page).getByRole("button", { name: "Every take of Viasna" })
  await expect(number).toBeVisible()
  const look = await style(number, "font-variant-numeric", "font-family")
  expect(look["font-variant-numeric"]).toContain("tabular-nums")
  expect(look["font-family"]).not.toMatch(/mono/i)
  expect(look["font-family"]).toBe((await style(name, "font-family"))["font-family"])
  expect(await bordered(number)).toBe(false)

  // Opened out, the rows of the column say their numbers the same way.
  await songs(page).click()
  const row = strip(page).locator("[data-column='song:Viasna'] [data-go-row]").first()
  const figure = row.locator("span").first()
  await expect(figure).toHaveText("#1")
  const rowLook = await style(figure, "font-variant-numeric", "font-family")
  expect(rowLook["font-variant-numeric"]).toContain("tabular-nums")
  expect(rowLook["font-family"]).not.toMatch(/mono/i)
})

for (const theme of THEMES) {
  test(`Every take of is a shared button with its words in a tip, in the ${theme} theme`, async ({
    page,
  }) => {
    await openTake(page, 5, theme)
    const number = strip(page).getByRole("button", { name: "Every take of Viasna" })
    await expect(number).toHaveAttribute("data-variant", "ghost")
    await expect(number).toHaveAttribute("data-size", "icon-tiny")
    await expect(number).not.toHaveAttribute("title")
    await number.hover()
    await expect(tooltip(page)).toHaveText("Every take of Viasna (↑ ↓)")
    await number.click()
    await expect(number).toHaveAttribute("aria-expanded", "true")
    await expect(number).toHaveCSS("background-color", await colour(page, "--selected"))
    await expect(strip(page).locator("[data-column]")).not.toHaveCount(0)
  })
}

test("Every take of says its keys to a screen reader once, not again as its tip", async ({ page }) => {
  await openTake(page, 5)
  const number = strip(page).getByRole("button", { name: "Every take of Viasna" })
  // Pałyn's tab is the stop before Viasna's, which is open, and the number
  // the first stop in it.
  await strip(page).getByRole("button", { name: /^Pałyn, take / }).focus()
  await page.keyboard.press("Tab")
  await expect(number).toBeFocused()
  await expect(tooltip(page)).toHaveText("Every take of Viasna (↑ ↓)")
  await expect(number).toHaveAccessibleDescription("")
  // The keys the tip shows, said as the button's own.
  await expect(number).toHaveAttribute("aria-keyshortcuts", "ArrowUp ArrowDown")
})

test("the marks on a tab are shared dots with no title, and a count at 12 px", async ({ page }) => {
  // Take 3 is Viasna 1, with a mark.
  await openTake(page, 3)
  const line = openTab(strip(page)).locator("[data-tab-line]")
  const dots = line.locator("[data-slot='label-dot']")
  await expect(dots).toHaveCount(1)
  expect(await style(dots.first(), "width", "height")).toEqual({ width: "8px", height: "8px" })
  const count = dots.last().locator("xpath=following-sibling::span")
  await expect(count).toHaveText("1")
  expect((await style(count, "font-size"))["font-size"]).toBe("12px")
  // Nothing in the strip is titled: not the dots, not the number, not the
  // buttons, not the star.
  await songs(page).click()
  await expect(strip(page).locator("[data-column] [data-slot='label-dot']")).not.toHaveCount(0)
  await expect(strip(page).locator("[title]")).toHaveCount(0)
})

test("the edge buttons are the shared ones with their name in a tip", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await openBandApp(page, { stress: "rehearsal" })
  await startRehearsal(page, 33)
  await page
    .locator("[aria-label='Rehearsal overview']")
    .getByRole("button", { name: /^Take 1 / })
    .click()
  await expect(timeline(page)).toBeVisible()
  await settled(page)

  const later = strip(page).getByRole("button", { name: "Later songs" })
  await expect(later).toBeVisible()
  await expect(later).toHaveAttribute("data-variant", "outline")
  await expect(later).toHaveAttribute("data-size", "icon-row")
  await expect(later).not.toHaveAttribute("title")
  await later.hover()
  await expect(tooltip(page)).toHaveText("Later songs")

  // › pages the row along, smoothly: wait for the row to move, not for a
  // time. Then to its end, where › is gone and ‹ has the same words.
  await away(page)
  await expect(tooltip(page)).toHaveCount(0)
  const row = strip(page).locator("[data-tab]").first().locator("..")
  await later.click()
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }))
  await expect(later).toHaveCount(0)
  const earlier = strip(page).getByRole("button", { name: "Earlier songs" })
  await expect(earlier).toBeVisible()
  await expect(earlier).toHaveAttribute("data-variant", "outline")
  await expect(earlier).toHaveAttribute("data-size", "icon-row")
  await expect(earlier).not.toHaveAttribute("title")
  await earlier.hover()
  await expect(tooltip(page)).toHaveText("Earlier songs")
})

for (const theme of THEMES) {
  test(`the open go's row in a column is the grey selected one on a button, in the ${theme} theme`, async ({
    page,
  }) => {
    await openTake(page, 5, theme)
    await songs(page).click()
    const open = strip(page).locator("[data-column='song:Viasna'] [data-go-row][aria-current='true']")
    await expect(open).toHaveCount(1)
    await expect(open).toHaveAttribute("data-slot", "button")
    const selected = await colour(page, "--selected")
    await expect(open).toHaveCSS("background-color", selected)
    expect((await style(open, "border-top-left-radius"))["border-top-left-radius"]).toBe("8px")
    // It keeps its fill under the pointer.
    await open.hover()
    await expect(open).toHaveCSS("background-color", selected)
    // The others are clear until the pointer is over them.
    const other = strip(page)
      .locator("[data-column='song:Viasna'] [data-go-row]:not([aria-current])")
      .first()
    await away(page)
    await expect(other).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  })
}

test("a tab list's day headings have no capitals", async ({ page }) => {
  // Pałyn 1 of Tuesday jam, opened from Pałyn's page, so that its column has
  // the goes of two rehearsals, a day over each.
  await openApp(page, {
    before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn", "Pałyn"];`,
  })
  await openHistory(page)
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await page.locator("[data-song='Pałyn']").click()
  await page
    .locator(`[data-rung-group="/rec/old"]`)
    .getByRole("button", { name: "Take 1 Pałyn 1" })
    .click()
  await expect(timeline(page)).toBeVisible()
  await songs(page).click()

  const days = strip(page).locator("[data-day]")
  expect(await days.count()).toBeGreaterThan(1)
  for (const heading of await days.all()) {
    expect(
      await style(heading, "text-transform", "letter-spacing", "font-size")
    ).toEqual({ "text-transform": "none", "letter-spacing": "normal", "font-size": "12px" })
    // innerText is the text as drawn, capitals made by the style and all.
    expect(await heading.innerText()).toBe(await heading.evaluate((el) => el.textContent))
  }
})

test("with no takes the strip says how they get there on the shared Empty", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  const empty = page.locator("[data-slot='empty']").filter({ hasText: "No takes yet" })
  await expect(empty).toHaveCount(1)
  await expect(empty.locator("[data-slot='empty-title']")).toHaveText("No takes yet")
  await expect(empty.locator("[data-slot='empty-description']")).toContainText(
    "Press Record take or Space"
  )
  await expect(empty.locator("[data-slot='empty-description']")).toContainText(
    "ready to play"
  )
})
