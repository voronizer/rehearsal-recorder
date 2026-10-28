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

const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
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

// What is read on each page, against what it stands on: the heading, grey
// words, the red word over the heading, and links as words, one on a tile.
const WORDS: Record<string, string[]> = {
  "/": ["h1", ".hero .lede", ".hero .eyebrow", ".hero a.more", "#stories a.more"],
  "/stories": ["h1", ".lede", ".eyebrow", ".tale-card .more"],
  "/stories/tempo-drift": ["h1", ".tale-head .fine", ".eyebrow", ".chap-body a", ".tale-next .also a.more"],
  "/404.html": ["h1", ".lede", ".eyebrow", "a.more"],
}
for (const path of PAGES) {
  test(`on ${path} in the dark the words read at 4.5:1`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto(path)
    for (const sel of WORDS[path]) {
      const [fg, bg] = await page
        .locator(sel)
        .first()
        .evaluate((el) => {
          let under: Element | null = el
          while (under && getComputedStyle(under).backgroundColor === "rgba(0, 0, 0, 0)") under = under.parentElement
          return [getComputedStyle(el).color, under ? getComputedStyle(under).backgroundColor : "#fff"]
        })
      expect(contrast(await rgbOf(page, fg), await rgbOf(page, bg)), sel).toBeGreaterThanOrEqual(4.5)
    }
  })
}
