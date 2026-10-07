import { expect, openApp, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Step 6 of issue #12: the Next take field, its songs and the named song's
// go from before tonight sit together in a panel right of the rehearsal,
// set back on the panel colour as the setup screen's Last time is. See
// docs/superpowers/specs/2026-10-02-last-time-while-rehearsing-design.md.

const panel = (page: Page) => page.getByRole("complementary", { name: "Next take" })

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
