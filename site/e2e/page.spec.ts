import type { Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { test, expect } from "./fixtures.ts"

const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf-8")
const VERSION = /^## (\d\S*)\s*$/m.exec(CHANGELOG)![1]
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
  const lead = new RegExp(`^## ${VERSION.replace(/\./g, "\\.")}\\s*\\n+- \\*\\*(.+?)\\*\\*`, "m").exec(
    CHANGELOG
  )![1]
  const ribbon = page.locator(".ribbon")
  await expect(ribbon).toContainText(`New in ${VERSION}.`)
  await expect(ribbon).toContainText(lead)
  await expect(ribbon.getByRole("link", { name: "Release notes" })).toHaveAttribute(
    "href",
    `${RELEASES}/tag/${VERSION}`
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
  await expect(tiles.getByText("Polyn").first()).toBeVisible()
  await expect(tiles.getByRole("img", { name: /in the cloud/ }).getByText("1 of 1")).toBeVisible()
})

test("the story follows the scroll, and the rail goes back", async ({ page }) => {
  await page.goto("/")
  const steps = page.locator(".step")
  const scenes = ["setup", "record", "review", "history"]
  for (let i = 0; i < scenes.length; i++) {
    await steps.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" }))
    await expect.poll(() => sceneIn(page, "story"), { timeout: 20_000 }).toBe(scenes[i])
  }
  await page.locator(".rail button").first().click()
  await expect.poll(() => sceneIn(page, "story"), { timeout: 20_000 }).toBe("setup")
})

test("a frame scrolled past holds still", async ({ page }) => {
  await page.goto("/")
  await expect.poll(() => heldIn(page, "hero"), { timeout: 20_000 }).toBe("false")
  await page.locator("#faq").evaluate((el) => el.scrollIntoView())
  await expect.poll(() => heldIn(page, "hero")).toBe("true")
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => heldIn(page, "hero")).toBe("false")
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
