import { test, expect } from "./fixtures.ts"

// The page Vercel answers with for an address that is no file of the site
// (vercel-config.json). Here it is opened by its own name.

test("the 404 page says nothing was recorded here, and goes back", async ({ page }) => {
  await page.goto("/404.html")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing was recorded here")
  await expect(page.getByRole("link", { name: "Go to the main page" })).toHaveAttribute("href", "/")
  await expect(page.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/#how")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex")
})

test("its take is Take 404, four minutes and four seconds of nothing", async ({ page }) => {
  await page.goto("/404.html")
  const take = page.getByRole("img", { name: /^Take 404/ })
  await expect(take.getByText("Take 404")).toBeVisible()
  await expect(take.getByText("0:00 / 4:04")).toBeVisible()
  for (const name of ["Drums", "Bass", "Guitar", "Vocals"]) await expect(take.getByText(name, { exact: true })).toBeVisible()
})

// The take's tracks come a moment after the page; shown before them, the
// take would grow and push the words beside it.
test("the page shows with its take whole, and nothing moves after", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: number[] = []
    ;(window as unknown as { __heights__: number[] }).__heights__ = seen
    const look = () => {
      const wrap = document.querySelector(".wrap")
      const take = document.querySelector(".nf-take")
      if (wrap && take && getComputedStyle(wrap).visibility !== "hidden")
        seen.push(Math.round(take.getBoundingClientRect().height))
    }
    new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true })
  })
  await page.goto("/404.html")
  await expect(page.getByText("0:00 / 4:04")).toBeVisible()
  const heights = await page.evaluate(() => (window as unknown as { __heights__: number[] }).__heights__)
  expect(heights.length).toBeGreaterThan(0)
  expect(new Set(heights).size).toBe(1)
})

test("its take does not take the page's keys", async ({ page }) => {
  await page.goto("/404.html")
  await expect(page.getByText("0:00 / 4:04")).toBeVisible()
  await page.keyboard.press("Shift+?")
  await page.keyboard.press("r")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Repeat" })).toHaveAttribute("aria-pressed", "false")
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("the 404 page fits, with the take under the button", async ({ page }) => {
    await page.goto("/404.html")
    await expect(page.getByText("0:00 / 4:04")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    const button = (await page.getByRole("link", { name: "Go to the main page" }).boundingBox())!
    const take = (await page.getByRole("img", { name: /^Take 404/ }).boundingBox())!
    expect(take.y).toBeGreaterThanOrEqual(button.y + button.height)
  })

  // In the app the master holds to the bottom of the window; on the page it
  // stays under the tracks, and does not hide one as the page scrolls.
  test("the take's master is under its four tracks", async ({ page }) => {
    await page.goto("/404.html")
    const take = page.getByRole("img", { name: /^Take 404/ })
    await expect(take.getByText("0:00 / 4:04")).toBeVisible()
    const vocals = (await take.getByText("Vocals", { exact: true }).boundingBox())!
    const master = (await take.getByText("Master", { exact: true }).boundingBox())!
    expect(master.y).toBeGreaterThan(vocals.y + vocals.height)
  })
})
