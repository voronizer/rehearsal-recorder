import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures.ts"

// reha.stream in the dark (docs/superpowers/specs/2026-10-28-site-dark-theme-design.md):
// dark when the system is, all through, the live app included.

const PAGES = ["/", "/stories", "/stories/tempo-drift", "/404.html"]

/** A CSS colour as the browser draws it, in sRGB 0-255. */
const rgbOf = (page: Page, css: string) =>
  page.evaluate((c) => {
    const g = document.createElement("canvas").getContext("2d")!
    g.fillStyle = c
    g.fillRect(0, 0, 1, 1)
    return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, css)

/** How light a colour is, as WCAG counts it: 0 black, 1 white. */
function luminance([r, g, b]: number[]) {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const bodyLight = async (page: Page) =>
  luminance(await rgbOf(page, await page.evaluate(() => getComputedStyle(document.body).backgroundColor)))

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"))

for (const path of PAGES) {
  test.describe(path, () => {
    test(`on ${path} in the dark the page is dark`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" })
      await page.goto(path)
      expect(await isDark(page)).toBe(true)
      expect(await bodyLight(page)).toBeLessThan(0.05)
    })

    test(`on ${path} in the light the page is as it was`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" })
      await page.goto(path)
      expect(await isDark(page)).toBe(false)
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(await rgbOf(page, bg)).toEqual([255, 255, 255])
    })

    // No flash of white on a dark computer: the head sets the class before
    // the page's own script, here never run.
    test(`on ${path} the page is dark before its script runs`, async ({ page }) => {
      await page.route(/\/assets\/.*\.js$/, (route) => route.abort())
      await page.emulateMedia({ colorScheme: "dark" })
      await page.goto(path)
      expect(await isDark(page)).toBe(true)
      expect(await bodyLight(page)).toBeLessThan(0.05)
    })

    test(`on ${path} the page follows a change of the system`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" })
      await page.goto(path)
      expect(await isDark(page)).toBe(false)
      await page.emulateMedia({ colorScheme: "dark" })
      await expect.poll(() => isDark(page)).toBe(true)
      await page.emulateMedia({ colorScheme: "light" })
      await expect.poll(() => isDark(page)).toBe(false)
    })
  })
}
