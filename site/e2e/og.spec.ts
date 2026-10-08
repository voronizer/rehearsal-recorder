import { test, expect } from "./fixtures.ts"

// The picture a chat shows for a link to reha.stream: og.html, photographed
// by `npm run og` into dist/og.png, which these tests read back.

test("og.html shows the page's words beside the app", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.goto("/og.html")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Multitrack recording for band rehearsals"
  )
  await expect
    .poll(
      () =>
        page
          .locator('iframe[src$="#hero"]')
          .contentFrame()
          .locator("html")
          .getAttribute("data-scene")
          .catch(() => null),
      { timeout: 20_000 }
    )
    .toBe("hero")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex")
  await expect(page.locator("html")).toHaveAttribute("data-og", "ready")
})

// A picture in the fallback font would be cached by every chat that shows
// it, so scripts/og.mjs draws none when the page's font did not come.
test("og.html says so when the page's font did not load", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  await page.goto("/og.html")
  await expect(page.locator("html")).toHaveAttribute("data-og", "no-font")
})

test("the link picture is a 1200 by 630 PNG", async ({ request }) => {
  const png = await (await request.get("/og.png")).body()
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  expect(png.readUInt32BE(16)).toBe(1200)
  expect(png.readUInt32BE(20)).toBe(630)
})
