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
