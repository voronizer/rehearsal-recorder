import type { Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { changelogHead, displayVersion, latestNews, latestVersion } from "../src/content/changelog.ts"
import { test, expect } from "./fixtures.ts"

const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf-8")
// What the build was given: a release's tag, or none for CHANGELOG's newest.
const TAG = process.env.VITE_SITE_VERSION || latestVersion(CHANGELOG)
const VERSION = displayVersion(TAG)
// A release with nothing new in the app shows the news of the one before.
const NEWS = latestNews(changelogHead(CHANGELOG, process.env.VITE_SITE_VERSION || undefined))
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

test("the news line is the newest change that is news, with its notes", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.locator(".ribbon")
  await expect(ribbon).toHaveText(
    NEWS ? `New in ${NEWS.version}. ${NEWS.lead} Release notes` : `New in ${VERSION}. Release notes`
  )
  await expect(ribbon.getByRole("link", { name: "Release notes" })).toHaveAttribute(
    "href",
    `${RELEASES}/tag/${NEWS && NEWS.version !== VERSION ? NEWS.version : TAG}`
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
  // Palyn typed in the Next take field: it is Pałyn now, the one song
  // under it, lit; as on the rehearsal screen, a list and no pills.
  const names = tiles.getByRole("img", { name: /Palyn is Pałyn now/ })
  await expect(names.locator("[data-take-go]")).toHaveText(/^ → Pałyn \d+$/)
  const songs = names.locator("[data-song-list]")
  await expect(songs.locator("h2")).toHaveText("Songs")
  await expect(songs.locator("[data-song-row]")).toHaveCount(1)
  await expect(songs.locator("[data-song-row='Pałyn']")).toHaveAttribute("aria-current", "true")
  await expect(names.locator("[data-song-choice]")).toHaveCount(0)
})

test("the sets tile shows a rehearsal mid-set", async ({ page }) => {
  await page.goto("/")
  const tile = page.locator("#features article").filter({
    has: page.getByRole("heading", { name: "Rehearse the set, in order." }),
  })
  const piece = tile.getByRole("img", { name: /Gig on the 25th/ })
  await expect(piece.locator("input")).toHaveValue("Viasna")
  const card = piece.locator("[data-set-card]")
  await expect(card.locator("h2")).toHaveText("Gig on the 25th — 1 of 6 played")
  await expect(card.locator("[data-set-song]")).toHaveText([
    /^1Pałyn4 goes$/,
    /^2Viasna$/,
    /^3Ahońnext$/,
    /^4Sonca$/,
    /^5Dym$/,
    /^6Ptuška$/,
  ])
  await expect(card.locator("[data-set-song='Viasna']")).toHaveAttribute("aria-current", "true")
})

/** The MIDI tile, found by its heading. */
const midiTile = (page: Page) =>
  page.locator("#features article").filter({
    has: page.getByRole("heading", { name: "Notes too, from an e-kit or a keyboard." }),
  })

test("the MIDI tile shows two lanes of notes, each with its plate", async ({ page }) => {
  await page.goto("/")
  const tile = midiTile(page)
  await expect(tile.getByText("A track records its audio, its MIDI or both.")).toBeVisible()
  const piece = tile.getByRole("img", { name: /TD-17.*Launchkey Mini MK3/ })
  const drums = piece.locator("[data-notes-plate='Drums']")
  await expect(drums).toContainText("TD-17")
  await expect(drums).toContainText("Saved as .mid, not played here")
  const keys = piece.locator("[data-notes-plate='Keys']")
  await expect(keys).toContainText("Launchkey Mini MK3")
  await expect(keys).toContainText("Saved as .mid, not played here")
  await expect(piece.locator("[data-notes-lane]")).toHaveCount(2)
  // The drums' rows are named, and the keys' octaves.
  await expect(piece.locator("[data-notes-lane='Drums']")).toContainText("Crash")
  await expect(piece.locator("[data-notes-lane='Drums']")).toContainText("Kick")
  await expect(piece.locator("[data-notes-lane='Keys']")).toContainText("C4")
})

test("in the MIDI tile the part already heard is in the accent and the rest grey", async ({ page }) => {
  await page.goto("/")
  const piece = midiTile(page).getByRole("img", { name: /TD-17/ })
  for (const name of ["Drums", "Keys"]) {
    const canvas = piece.locator(`[data-notes-lane='${name}'] canvas`)
    // Where the accent ends and the grey begins, as a share of the lane.
    const edge = () =>
      canvas.evaluate((el: HTMLCanvasElement) => {
        const { data, width, height } = el.getContext("2d")!.getImageData(0, 0, el.width, el.height)
        let lastAccent = -1
        let firstGrey = width
        for (let x = 0; x < width; x++)
          for (let y = 0; y < height; y++) {
            const i = (y * width + x) * 4
            if (data[i + 3] < 40) continue
            // The accent is blue, the unheard notes a dark grey; the lines
            // between the rows are a light one.
            if (data[i + 2] - data[i] > 60) lastAccent = Math.max(lastAccent, x)
            else if (data[i] < 150) firstGrey = Math.min(firstGrey, x)
          }
        return { accent: lastAccent / width, grey: firstGrey / width }
      })
    await expect.poll(async () => (await edge()).accent, { message: name }).toBeGreaterThan(0.5)
    const { accent, grey } = await edge()
    // A bar into the bridge of eight bars, five eighths of the way.
    expect(accent).toBeLessThan(0.7)
    expect(grey).toBeGreaterThanOrEqual(accent - 0.01)
    expect(grey).toBeLessThan(1)
  }
})

test("the MIDI tile is a picture: nothing moves, nothing plays, nothing to click", async ({ page }) => {
  await page.goto("/")
  const tile = midiTile(page)
  const piece = tile.getByRole("img", { name: /TD-17/ })
  await expect(piece.locator("[inert]")).toHaveCount(1)
  await expect(tile.locator("audio, video, button, a, input")).toHaveCount(0)
  const drawn = () =>
    piece.locator("canvas").evaluateAll((all) => all.map((c) => (c as HTMLCanvasElement).toDataURL()).join())
  await expect.poll(async () => (await drawn()).length).toBeGreaterThan(1000)
  const before = await drawn()
  await page.waitForTimeout(800)
  expect(await drawn()).toBe(before)
})

test("the MIDI tile is the whole width, right after the one on tracks, its words beside its notes", async ({
  page,
}) => {
  await page.goto("/")
  const found = await page.locator("#features .bento").evaluate((bento) => {
    const box = (el: Element) => el.getBoundingClientRect()
    const tiles = [...bento.children]
    const at = tiles.findIndex((t) => t.querySelector("h3")?.textContent === "Notes too, from an e-kit or a keyboard.")
    const midi = tiles[at]
    return {
      before: tiles[at - 1]?.querySelector("h3")?.textContent,
      bento: box(bento),
      midi: box(midi),
      track: box(tiles[at - 1]),
      copy: box(midi.querySelector(".copy")!),
      piece: box(midi.querySelector(".piece")!),
    }
  })
  expect(found.before).toBe("Every musician on their own track.")
  expect(Math.abs(found.midi.left - found.bento.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(found.midi.right - found.bento.right)).toBeLessThanOrEqual(1)
  expect(found.midi.top).toBeGreaterThanOrEqual(found.track.bottom)
  expect(found.copy.right).toBeLessThanOrEqual(found.piece.left)
  expect(found.copy.top).toBeLessThan(found.piece.bottom)
  expect(found.piece.top).toBeLessThan(found.copy.bottom)
})

// The name on a plate is whole from the narrowest phone to a wide screen,
// and at 1000 px, where the plate and the notes are tightest side by side:
// none of its words is broken across lines or sticks out of it, and the notes
// still have room beside it, or under it.
for (const width of [320, 390, 960, 1000, 1440]) {
  test(`at ${width} px the Launchkey Mini MK3 is whole on its plate, with room for its notes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const piece = midiTile(page).getByRole("img", { name: /TD-17/ })
    await expect(piece).toBeVisible()
    await piece.scrollIntoViewIfNeeded()
    const plate = piece.locator("[data-notes-plate='Keys']")
    await expect(plate).toContainText("Launchkey Mini MK3")
    const found = await plate.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const broken: string[] = []
      const outside: string[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const word of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange()
          range.setStart(node, word.index!)
          range.setEnd(node, word.index! + word[0].length)
          if (range.getClientRects().length > 1) broken.push(word[0])
          const r = range.getBoundingClientRect()
          if (r.left < box.left - 0.5 || r.right > box.right + 0.5) outside.push(word[0])
        }
      }
      return { broken, outside, overflow: el.scrollWidth - el.clientWidth }
    })
    expect(found).toEqual({ broken: [], outside: [], overflow: 0 })
    // The heading keeps e-kit whole too, rather than end a line on "e-".
    const heading = midiTile(page).getByRole("heading")
    const lines = await heading.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf("e-kit")
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + "e-kit".length)
        return range.getClientRects().length
      }
      return 0
    })
    expect(lines).toBe(1)
    const lane = await piece.locator("[data-notes-lane='Keys']").boundingBox()
    expect(lane!.width).toBeGreaterThanOrEqual(200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

// Six columns from 1000 px: the section's six rows are full on a laptop and
// on a wide screen alike.
for (const width of [1000, 1280, 1440]) {
  test(`every row of tiles is full at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
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
    expect(rows.length).toBe(6)
    for (const gap of rows) expect(gap).toBeLessThanOrEqual(1)
  })
}

test("on a middle-sized window too, no row of tiles has a hole", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 900 })
  await page.goto("/")
  const gaps = await page.locator("#features .bento").evaluate((bento) => {
    const right = bento.getBoundingClientRect().right
    const ends = new Map<number, number>()
    for (const tile of bento.children) {
      const box = tile.getBoundingClientRect()
      const top = Math.round(box.top)
      ends.set(top, Math.max(ends.get(top) ?? 0, box.right))
    }
    return [...ends.values()].map((end) => Math.round(right - end))
  })
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(1)
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

// Vercel's scripts themselves are only on Vercel, once the project has Web
// Analytics and Speed Insights switched on; here they are missing files.
test("the page counts its visit and its speed with Vercel's scripts, the app in it does not", async ({ page }) => {
  const scripts = ['script[src="/_vercel/insights/script.js"]', 'script[src="/_vercel/speed-insights/script.js"]']
  await page.goto("/")
  for (const script of scripts) await expect(page.locator(script)).toHaveCount(1)
  await expect.poll(() => sceneIn(page, "hero"), { timeout: 20_000 }).toBe("hero")
  for (const script of scripts) await expect(frame(page, "hero").contentFrame().locator(script)).toHaveCount(0)
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
