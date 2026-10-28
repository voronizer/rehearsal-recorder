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

// The picture's heading in the page's own Geologica, from the site.
test("og.html sets its heading in Geologica, from the site", async ({ page }) => {
  const away: string[] = []
  page.on("request", (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) away.push(r.url())
  })
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.goto("/og.html")
  const family = await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toMatch(/^"?Geologica"?,/)
  await expect(page.locator("html")).toHaveAttribute("data-og", "ready")
  expect(away).toEqual([])
  // The word over the heading, under it here, on one line with its dot,
  // and inside the words' column: past it, it would run under the app.
  const found = await page.locator(".og-eyebrow").evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()]
    return {
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      right: Math.max(...rects.map((r) => r.right)),
      column: el.closest(".og-text")!.getBoundingClientRect().right,
    }
  })
  expect(found.lines).toBe(1)
  expect(found.right).toBeLessThanOrEqual(found.column)
})

// A picture in the fallback font would be cached by every chat that shows
// it, so scripts/og.mjs draws none when Geologica did not come.
test("og.html says so when Geologica did not load", async ({ page }) => {
  await page.route(/geologica-[^/]*\.woff2/, (route) => route.abort())
  await page.goto("/og.html")
  await expect(page.locator("html")).toHaveAttribute("data-og", "no-font")
})

test("the link picture is a 1200 by 630 PNG", async ({ request }) => {
  const png = await (await request.get("/og.png")).body()
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  expect(png.readUInt32BE(16)).toBe(1200)
  expect(png.readUInt32BE(20)).toBe(630)
})
