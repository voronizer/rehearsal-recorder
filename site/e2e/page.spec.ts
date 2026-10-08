import type { Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { displayVersion, latestVersion, newsLead } from "../src/content/changelog.ts"
import { test, expect } from "./fixtures.ts"

const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf-8")
// What the build was given: a release's tag, or none for CHANGELOG's newest.
const TAG = process.env.VITE_SITE_VERSION || latestVersion(CHANGELOG)
const VERSION = displayVersion(TAG)
const NEWS = newsLead(CHANGELOG, VERSION)
const FEATURES = readFileSync(new URL("../content/features.md", import.meta.url), "utf-8")
const TILE_HEADINGS = [...FEATURES.matchAll(/^## (.+?) \{#\w+\}$/gm)].map((m) => m[1])
const RELEASES = "https://github.com/voronizer/rehearsal-recorder/releases"
const MAC_ZIP = `${RELEASES}/latest/download/RehearsalRecorder-macos.zip`
const WIN_ZIP = `${RELEASES}/latest/download/RehearsalRecorder-windows.zip`

/** The frame showing `scene` of stage.html, and what it is showing. */
const frame = (page: Page, scene: string) => page.locator(`iframe[src$="#${scene}"]`)
const sceneIn = (page: Page, scene: string) =>
  frame(page, scene)
    .contentFrame()
    .locator("html")
    .getAttribute("data-scene")
    .catch(() => null)
const heldIn = (page: Page, scene: string) =>
  frame(page, scene).contentFrame().locator("html").getAttribute("data-held").catch(() => null)

test("the page has its heading", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Multitrack recording for band rehearsals"
  )
})

test("the news line is the version's first change, with its notes", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.locator(".ribbon")
  await expect(ribbon).toHaveText(
    NEWS ? `New in ${VERSION}. ${NEWS} Release notes` : `New in ${VERSION}. Release notes`
  )
  await expect(ribbon.getByRole("link", { name: "Release notes" })).toHaveAttribute(
    "href",
    `${RELEASES}/tag/${TAG}`
  )
})

test("on a Mac, the Mac download is the button", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" })
  )
  await page.goto("/")
  await expect(page.locator(".btn")).toHaveText("Download for macOS")
  await expect(page.locator(".btn")).toHaveAttribute("href", MAC_ZIP)
  const other = page.getByRole("link", { name: "Download for Windows" })
  await expect(other).toHaveAttribute("href", WIN_ZIP)
  await expect(page.getByText(`Version ${VERSION} · Open source`)).toBeVisible()
})

test("on Windows, the Windows download is the button", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" })
  )
  await page.goto("/")
  await expect(page.locator(".btn")).toHaveText("Download for Windows")
  await expect(page.locator(".btn")).toHaveAttribute("href", WIN_ZIP)
  await expect(page.getByRole("link", { name: "Download for macOS" })).toHaveAttribute("href", MAC_ZIP)
})

test("the tiles show the app's own pieces", async ({ page }) => {
  await page.goto("/")
  const tiles = page.locator("#features")
  for (const heading of TILE_HEADINGS) await expect(tiles.getByRole("heading", { name: heading })).toBeVisible()
  await expect(tiles.getByText("Interface connected · room for")).toBeVisible()
  await expect(tiles.getByText("clipped 3×")).toBeVisible()
  await expect(tiles.getByText("autosaved every 30 s")).toBeVisible()
  await expect(tiles.getByText("Tuesday jam")).toHaveCount(2)
  await expect(tiles.getByText("New songs")).toBeVisible()
  await expect(tiles.getByText("Soundcheck")).toBeVisible()
  await expect(tiles.getByText("Pałyn").first()).toBeVisible()
  await expect(tiles.getByRole("img", { name: /in the cloud/ }).getByText("1 of 1")).toBeVisible()
  // Palyn typed in the Next take field: it is Pałyn now.
  const names = tiles.getByRole("img", { name: /Palyn is Pałyn now/ })
  await expect(names.locator("[data-take-go]")).toHaveText(/^ → Pałyn \d+$/)
  await expect(names.getByText("Make Palyn a new song")).toBeVisible()
})

test("every row of tiles is full", async ({ page }) => {
  await page.goto("/")
  const rows = await page.locator("#features .bento").evaluate((bento) => {
    const right = bento.getBoundingClientRect().right
    const ends = new Map<number, number>()
    for (const tile of bento.children) {
      const box = tile.getBoundingClientRect()
      const top = Math.round(box.top)
      ends.set(top, Math.max(ends.get(top) ?? 0, box.right))
    }
    return [...ends.values()].map((end) => Math.round(right - end))
  })
  expect(rows.length).toBe(4)
  for (const gap of rows) expect(gap).toBeLessThanOrEqual(1)
})

test("the story follows the scroll, and the rail goes back", async ({ page }) => {
  await page.goto("/")
  const steps = page.locator(".step")
  const scenes = ["setup", "record", "keep", "history", "compare"]
  for (let i = 0; i < scenes.length; i++) {
    await steps.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" }))
    await expect.poll(() => sceneIn(page, "story"), { timeout: 20_000 }).toBe(scenes[i])
  }
  await page.locator(".rail button").first().click()
  await expect.poll(() => sceneIn(page, "story"), { timeout: 20_000 }).toBe("setup")
})

test("the step on screen lights the line the app is on", async ({ page }) => {
  await page.goto("/")
  const steps = page.locator("#how .step")
  const now = page.locator("#how .step.on .beats li.now")
  const elsewhere = page.locator("#how .step:not(.on) .beats li.now")
  await steps.nth(3).evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(now).toHaveText(/^Marks: every Went wrong, from every rehearsal\./, { timeout: 40_000 })
  await expect(elsewhere).toHaveCount(0)
  await expect(now).toHaveText(/^A click on Pałyn: /, { timeout: 20_000 })
  await expect(elsewhere).toHaveCount(0)
  await expect(now).toHaveAttribute("aria-current", "true")

  await steps.nth(0).evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(now).toHaveCount(0)
  await expect(now).toHaveText(/^Name the rehearsal, or keep the date\./, { timeout: 20_000 })
  await expect(elsewhere).toHaveCount(0)
})

test("a step left and come back to is dark until the app gets to it again", async ({ page }) => {
  await page.goto("/")
  const steps = page.locator("#how .step")
  const now = page.locator("#how .step.on .beats li.now")
  await steps.nth(3).evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(now).toHaveText(/^A click on Pałyn: /, { timeout: 40_000 })

  // Up to the first step starts the app again; it is slow to come back
  // here, so it is still starting when the fourth step is back on screen.
  await page.route(/\/stage\.html/, async (route) => {
    await new Promise((r) => setTimeout(r, 1_500))
    await route.continue()
  })
  await steps.nth(0).evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(steps.nth(0)).toHaveClass(/\bon\b/)
  await steps.nth(3).evaluate((el) => el.scrollIntoView({ block: "center" }))
  await expect(steps.nth(3)).toHaveClass(/\bon\b/)
  expect(await now.count()).toBe(0)
  await page.waitForTimeout(500)
  expect(await now.count()).toBe(0)
  await page.unrouteAll({ behavior: "wait" })
  await expect(now).toHaveText(/^History opens on the newest rehearsal\./, { timeout: 40_000 })
})

test("a frame scrolled past holds still", async ({ page }) => {
  await page.goto("/")
  await expect.poll(() => heldIn(page, "hero"), { timeout: 20_000 }).toBe("false")
  await page.locator("#faq").evaluate((el) => el.scrollIntoView())
  await expect.poll(() => heldIn(page, "hero")).toBe("true")
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => heldIn(page, "hero")).toBe("false")
})

// Vercel's script itself is only on Vercel, once the project has Web
// Analytics switched on; here it is a missing file.
test("the page counts its visit with Vercel's analytics, the app in it does not", async ({ page }) => {
  const analytics = 'script[src="/_vercel/insights/script.js"]'
  await page.goto("/")
  await expect(page.locator(analytics)).toHaveCount(1)
  await expect.poll(() => sceneIn(page, "hero"), { timeout: 20_000 }).toBe("hero")
  await expect(frame(page, "hero").contentFrame().locator(analytics)).toHaveCount(0)
})

// All of it is in the HTML as the build wrote it, for readers that run no
// script: search engines, AI crawlers, and chats drawing a card for a link.
test("the page tells search engines and chats what it is", async ({ page, request }) => {
  await page.goto("/")
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://reha.stream/og.png")
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://reha.stream/")
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)
  expect(ld.softwareVersion).toBe(VERSION)
  expect(await page.locator("noscript").textContent()).toContain(MAC_ZIP)
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap: https://reha.stream/sitemap.xml")
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>https://reha.stream/</loc>")
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("the page fits, and the app in it only shows", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await expect(frame(page, "hero")).toHaveCSS("pointer-events", "none")
    await expect(page.getByText("Try it on a computer.")).toBeVisible()
  })
})
