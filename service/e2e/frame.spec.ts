import { expect, test, type Page } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test("the frame has its sections, and a panel closes with its X, Esc and another section", async ({ page }) => {
  await page.goto("/")
  const sections = page.getByRole("navigation", { name: "Sections" })
  await expect(sections.getByRole("link")).toHaveText(["Home", "Rehearsals", "Songs", /^Marks\s*\d+$/, "Members", "Trash"])
  await expect(page.getByLabel("Player")).toBeVisible()

  const favourite = page.getByRole("region", { name: "The band's favourites" }).getByRole("button", { name: "Viasna 11", exact: true })
  const panel = page.getByLabel("Panel")
  await favourite.click()
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/Viasna\s*11/)
  await panel.getByRole("button", { name: "Close", exact: true }).click()
  await expect(panel).toHaveCount(0)

  await favourite.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)

  await favourite.click()
  await expect(panel).toBeVisible()
  await sections.getByRole("link", { name: "Songs" }).click()
  await expect(page).toHaveURL("/songs")
  await expect(panel).toHaveCount(0)
})

test("a press on a wave plays the take from there", async ({ page }) => {
  await page.goto(`/rehearsals/${band().rehearsals.second}`)
  const wave = page.locator('[data-take="Viasna 11"]').getByTestId("wave")
  const box = (await wave.boundingBox())!
  await wave.click({ position: { x: box.width * 0.5, y: box.height / 2 } })
  const bar = page.getByLabel("Player")
  await expect(bar.getByRole("button", { name: "Viasna 11", exact: true })).toBeVisible()
  await expect(bar.getByTestId("bar-time")).toHaveText(/^0:0[56]$/, { timeout: 10_000 })
  await bar.getByRole("button", { name: "Pause “Viasna 11”" }).click()
  // Paused, the same take's wave plays it again from where it is pressed.
  await wave.click({ position: { x: box.width * 0.2, y: box.height / 2 } })
  await expect(bar.getByRole("button", { name: "Pause “Viasna 11”" })).toBeVisible()
  await bar.getByRole("button", { name: "Pause “Viasna 11”" }).click()
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a wave in a list lets a finger scroll, and a tap plays it", async ({ page }) => {
    await page.goto(`/rehearsals/${band().rehearsals.second}`)
    const wave = page.locator('[data-take="Viasna 11"]').getByTestId("wave")
    await expect(wave).not.toHaveCSS("touch-action", "none")
    await wave.tap()
    const bar = page.getByLabel("Player")
    await expect(bar.getByRole("button", { name: "Pause “Viasna 11”" })).toBeVisible()
    await bar.getByRole("button", { name: "Pause “Viasna 11”" }).click()
  })

  test("a take's name opens its page, and Mark in the bar opens a new mark", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("region", { name: "The last rehearsal" }).getByRole("button", { name: "Viasna 11", exact: true }).click()
    await expect(page).toHaveURL(`/takes/${band().takes["Viasna 11"]}`)
    await expect(page.getByLabel("Panel")).toHaveCount(0)
    const bar = page.getByLabel("Player")
    await expect(bar.getByRole("button", { name: "Viasna 11", exact: true })).toBeVisible()
    await bar.getByRole("button", { name: "Mark", exact: true }).click()
    await expect(page.getByLabel("Panel")).toContainText(/New mark at \d:\d\d/)
  })

  test("New song from a take's line opens its page with the name field", async ({ page }) => {
    await page.goto("/songs")
    await page.getByRole("region", { name: "Not named" }).getByRole("button", { name: "What to do with Take 7", exact: true }).click()
    await page.getByRole("menuitem", { name: "Move to song" }).click()
    await page.getByRole("menuitem", { name: "New song…" }).click()
    await expect(page).toHaveURL(`/takes/${band().takes["Take 7"]}`)
    await expect(page.getByRole("main").getByRole("textbox", { name: "New song" })).toBeVisible()
    await expect(page.getByLabel("Panel")).toHaveCount(0)
  })
})

test("Esc in a menu inside a panel closes the menu, not the panel", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "The band's favourites" }).getByRole("button", { name: "Viasna 11", exact: true }).click()
  const panel = page.getByLabel("Panel")
  await panel.getByRole("button", { name: "What to do with Viasna 11" }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
})

test("a computer's windows fit every section", async ({ page }) => {
  for (const [width, height] of [
    [1180, 820],
    [960, 680],
  ]) {
    await page.setViewportSize({ width, height })
    for (const path of ["/", "/rehearsals", "/songs", "/marks", "/members", "/trash"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      expect(await fits(page), `${path} at ${width}`).toBe(true)
    }
  }
})

test("a phone keeps the sections behind the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  const sections = page.getByRole("navigation", { name: "Sections" })
  await expect(sections).toHaveCount(0)
  await page.getByRole("button", { name: "Menu" }).click()
  await sections.getByRole("link", { name: "Songs" }).click()
  await expect(sections).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Songs")
  for (const path of ["/", "/rehearsals", "/songs", "/marks", "/members", "/trash", `/takes/${band().takes["Viasna 12"]}`]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await fits(page), path).toBe(true)
  }
})
