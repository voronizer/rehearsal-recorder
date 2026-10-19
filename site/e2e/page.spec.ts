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

test("the controller has a block of its own after the app, its photo beside its words", async ({ page }) => {
  await page.goto("/")
  const block = page.locator("#controller")
  await expect(block.getByRole("heading", { level: 2 })).toHaveText("Start a take without going to the laptop.")
  await expect(block.getByRole("link", { name: "Victor Baikov's controller on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/viktor-baikov/reha-controller"
  )
  const photo = block.getByRole("img", { name: /^Victor Baikov's controller: a red REC button/ })
  await expect(photo).toBeVisible()
  await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1000)
  const at = await page.evaluate(() => ({
    hero: document.querySelector(".hero")!.getBoundingClientRect().bottom,
    block: document.querySelector("#controller")!.getBoundingClientRect(),
    features: document.querySelector("#features")!.getBoundingClientRect().top,
    copy: document.querySelector("#controller .copy")!.getBoundingClientRect(),
    photo: document.querySelector("#controller img")!.getBoundingClientRect(),
  }))
  expect(at.block.top).toBeGreaterThanOrEqual(at.hero)
  expect(at.block.bottom).toBeLessThanOrEqual(at.features)
  expect(at.copy.right).toBeLessThanOrEqual(at.photo.left)
  // The photo goes to the block's edges: top, right and bottom.
  expect(Math.abs(at.photo.top - at.block.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(at.photo.right - at.block.right)).toBeLessThanOrEqual(1)
  expect(Math.abs(at.photo.bottom - at.block.bottom)).toBeLessThanOrEqual(1)
})

// On a phone the photo is under the words, across the whole block, and the
// link still fits.
for (const width of [320, 390]) {
  test(`at ${width} px the controller's photo is across the block, and the page does not scroll sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const block = (await page.locator("#controller").boundingBox())!
    const photo = (await page.locator("#controller img").boundingBox())!
    expect(Math.abs(photo.x - block.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(photo.x + photo.width - (block.x + block.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(photo.y + photo.height - (block.y + block.height))).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

test("the health piece is as wide as its words, with no room held for a longer sentence", async ({
  page,
}) => {
  // The app's line holds, unseen, the room of the longest thing it can say,
  // so that it never moves during a take. A still picture has nothing to
  // keep still for: its box ends where its words do. Where the tile is wide
  // enough for the sentence on one line (800 px, two columns) the held room
  // would show as empty card beside the words; where the tile is narrow, the
  // words wrap and fill it either way.
  for (const width of [390, 800, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const health = page.locator("#features [data-health]")
    await expect(health).toHaveCount(1)
    const words = health.getByText("Interface connected · room for")
    await expect(words).toBeVisible()
    await health.scrollIntoViewIfNeeded()
    // The line the words are on: the icon, the gap and the words.
    const said = (await words.locator("..").boundingBox())!
    const box = (await health.boundingBox())!
    expect(box.width, `width at ${width} px`).toBeLessThanOrEqual(said.width + 2)
    expect(box.height, `height at ${width} px`).toBeLessThanOrEqual(said.height + 2)
    // Its words start at the left, as the tile's heading does, when they wrap.
    await expect(health).toHaveCSS("text-align", "start")
  }
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
  // The take kept in the cloud carries its row's cloud mark. The overview no
  // longer says the evening's figures: in the app, the header has them.
  await expect(tiles.getByRole("img", { name: /in the cloud/ }).locator("[data-in-cloud]")).toBeVisible()
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

test("the two recording tiles are on wells, as the app draws them", async ({ page }) => {
  await page.goto("/")
  const piece = page.locator("#features").getByRole("img", { name: /Bass and Guitar tiles/ })
  await expect(piece.locator("[role=group]")).toHaveCount(2)
  // Each on a well, the side panel's grey, as on the recording screen: on
  // the page's white, a tile on a card's white would not show.
  const found = await piece.evaluate((el) => {
    const probe = document.createElement("div")
    probe.style.backgroundColor = "var(--panel)"
    el.append(probe)
    const panel = getComputedStyle(probe).backgroundColor
    probe.remove()
    const fill = (e: Element) => getComputedStyle(e).backgroundColor
    return { tiles: [...el.querySelectorAll("[role=group]")].map(fill), panel, ground: fill(el) }
  })
  expect(found.tiles).toEqual([found.panel, found.panel])
  expect(found.ground).not.toBe(found.panel)
})

test("the sets tile shows a rehearsal mid-set", async ({ page }) => {
  await page.goto("/")
  const tile = page.locator("#features article").filter({
    has: page.getByRole("heading", { name: "Rehearse the set, in order." }),
  })
  const piece = tile.getByRole("img", { name: /Gig on the 25th/ })
  await expect(piece.locator("textarea")).toHaveValue("Viasna")
  const card = piece.locator("[data-set-card]")
  await expect(card.locator("h2")).toHaveText("Gig on the 25th · 1 of 6 played")
  await expect(card.locator("[data-set-song]")).toHaveText([
    /^1Pałyn4 takes$/,
    /^2Viasna$/,
    /^3Ahońnext$/,
    /^4Sonca$/,
    /^5Dym$/,
    /^6Ptuška$/,
  ])
  await expect(card.locator("[data-set-song='Viasna']")).toHaveAttribute("aria-current", "true")
})

test("the Next take tiles draw the panel's line between the field and what is under it", async ({
  page,
}) => {
  await page.goto("/")
  const tiles = page.locator("#features")
  // The part a group sits in is the box the line is drawn on, as in the app.
  const part = (label: RegExp, group: string) =>
    tiles.getByRole("img", { name: label }).locator(group).locator("xpath=..")
  await expect(part(/Gig on the 25th/, "[data-set-card]")).toHaveCSS("border-top-width", "1px")
  await expect(part(/Palyn is Pałyn now/, "[data-song-list]")).toHaveCSS("border-top-width", "1px")
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

// Six columns from 1000 px: the section's seven rows are full on a laptop
// and on a wide screen alike, and the Trash tile is the last of them, the
// whole width.
for (const width of [1000, 1280, 1440]) {
  test(`every row of tiles is full at ${width} px, the Trash tile the whole width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const found = await page.locator("#features .bento").evaluate((bento) => {
      const { left, right } = bento.getBoundingClientRect()
      const ends = new Map<number, number>()
      for (const tile of bento.children) {
        const box = tile.getBoundingClientRect()
        const top = Math.round(box.top)
        ends.set(top, Math.max(ends.get(top) ?? 0, box.right))
      }
      const trash = bento.lastElementChild!.getBoundingClientRect()
      return {
        rows: [...ends.values()].map((end) => Math.round(right - end)),
        last: bento.lastElementChild!.querySelector("h3")?.textContent,
        trash: [Math.round(trash.left - left), Math.round(right - trash.right)],
      }
    })
    expect(found.rows.length).toBe(7)
    for (const gap of found.rows) expect(gap).toBeLessThanOrEqual(1)
    expect(found.last).toBe("Deleting goes to the Trash.")
    for (const gap of found.trash) expect(Math.abs(gap)).toBeLessThanOrEqual(1)
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

/** The metronome's tile, found by its heading. */
const metronomeTile = (page: Page) =>
  page.locator("#features article").filter({
    has: page.getByRole("heading", { name: "A click for the drummer." }),
  })

test.describe("metronome on the site", () => {
  test("the tile shows the rehearsal screen's row: Palyn's 128 bpm in 4/4, the song's tempo", async ({
    page,
  }) => {
    await page.goto("/")
    const tile = metronomeTile(page)
    await expect(tile.getByText("Each song keeps its tempo and time signature.")).toBeVisible()
    const piece = tile.getByRole("img", { name: /Pałyn's 128 bpm in 4\/4/ })
    const row = piece.locator("section[aria-label='Metronome']")
    await expect(row).toBeVisible()
    await expect(row.locator("input[aria-label='Tempo']")).toHaveValue("128")
    await expect(row.getByText("bpm", { exact: true })).toBeVisible()
    await expect(row.locator("[aria-label='Time signature']")).toHaveText("4/4")
    await expect(row.locator("button", { hasText: "Tap" })).toBeVisible()
    await expect(row.locator("button[aria-label='Play the click']")).toBeVisible()
    await expect(row.locator("[data-beat-dots] [data-dot]")).toHaveCount(4)
    await expect(row.locator("button[aria-label='Metronome settings']")).toBeVisible()
    await expect(row.locator("[data-status-line]")).toHaveText("The song's tempo.")
  })

  test("the tile is a picture: nothing plays, nothing to press, and T taps nothing", async ({ page }) => {
    await page.goto("/")
    const tile = metronomeTile(page)
    const piece = tile.getByRole("img", { name: /128 bpm/ })
    await expect(piece.locator("section[aria-label='Metronome']")).toBeVisible()
    await expect(piece.locator("[inert]")).toHaveCount(1)
    await expect(tile.locator("audio, video")).toHaveCount(0)
    // T is Tap's key in the app, anywhere outside a field. What the page
    // asks of the fake bridge about the click is noted from here on.
    await page.evaluate(() => {
      type Bridge = Record<string, (...args: unknown[]) => unknown>
      const w = window as unknown as { pywebview: { api: Bridge }; __asked: string[] }
      w.__asked = []
      const bridge = w.pywebview.api
      for (const name of Object.keys(bridge).filter((n) => /metronome|click/.test(n))) {
        const real = bridge[name]
        bridge[name] = (...args) => {
          w.__asked.push(name)
          return real(...args)
        }
      }
    })
    await page.keyboard.press("t")
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toEqual([])
  })

  // The row's line keeps two lines' room in the app, so a longer one moves
  // nothing under it. A still picture has nothing to keep still for.
  test("the piece ends under the row's line, with no room held for a longer one", async ({ page }) => {
    await page.goto("/")
    const line = metronomeTile(page).locator("[data-status-line]")
    await expect(line).toHaveText("The song's tempo.")
    const found = await line.evaluate((el) => {
      const words = document.createRange()
      words.selectNodeContents(el)
      return { box: el.getBoundingClientRect().height, words: words.getBoundingClientRect().height }
    })
    expect(found.box).toBeLessThanOrEqual(found.words + 1)
  })

  test("on a phone the row shows its tempo and time signature, and the page does not scroll sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    const piece = metronomeTile(page).getByRole("img", { name: /128 bpm/ })
    await expect(piece.locator("section[aria-label='Metronome']")).toBeVisible()
    await piece.scrollIntoViewIfNeeded()
    const found = await piece.evaluate((el) => {
      const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect()
      return {
        piece: el.getBoundingClientRect(),
        tempo: box("input[aria-label='Tempo']"),
        signature: box("[aria-label='Time signature']"),
      }
    })
    expect(found.tempo.left).toBeGreaterThanOrEqual(found.piece.left)
    expect(found.signature.right).toBeLessThanOrEqual(found.piece.right)
    // The rest of the row, wider than the tile, is cut at the piece's edge
    // rather than drawn past its ground.
    await expect(piece).toHaveCSS("overflow-x", "hidden")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })

  // After the sets tile, whose songs bring their tempos with them: a row
  // of its own at every width, its words beside the row from 1000 px, and
  // the row whole, gear and all.
  for (const width of [860, 1000, 1280, 1440]) {
    test(`at ${width} px the tile is the whole width after the sets one, with the whole row`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/")
      const piece = metronomeTile(page).getByRole("img", { name: /128 bpm/ })
      await expect(piece.locator("section[aria-label='Metronome']")).toBeVisible()
      const found = await page.locator("#features .bento").evaluate((bento) => {
        const box = (el: Element) => el.getBoundingClientRect()
        const tiles = [...bento.children]
        const at = tiles.findIndex((t) => t.querySelector("h3")?.textContent === "A click for the drummer.")
        const tile = tiles[at]
        const piece = tile.querySelector(".piece")!
        return {
          before: tiles[at - 1]?.querySelector("h3")?.textContent,
          bento: box(bento),
          tile: box(tile),
          sets: box(tiles[at - 1]),
          copy: box(tile.querySelector(".copy")!),
          piece: box(piece),
          gear: box(piece.querySelector("button[aria-label='Metronome settings']")!),
          cut: piece.scrollWidth - piece.clientWidth,
        }
      })
      expect(found.before).toBe("Rehearse the set, in order.")
      expect(Math.abs(found.tile.left - found.bento.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(found.tile.right - found.bento.right)).toBeLessThanOrEqual(1)
      expect(found.tile.top).toBeGreaterThanOrEqual(found.sets.bottom)
      expect(found.cut).toBe(0)
      expect(found.gear.right).toBeLessThanOrEqual(found.piece.right)
      if (width >= 1000) {
        expect(found.copy.right).toBeLessThanOrEqual(found.piece.left)
        expect(found.copy.top).toBeLessThan(found.piece.bottom)
        expect(found.piece.top).toBeLessThan(found.copy.bottom)
      }
    })
  }
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

// Google's results show a site's icon only from the formats it lists (BMP,
// GIF, ICO, PNG, JPEG, PPM, TIFF; not SVG), square and best over 48 px; the
// home page's <link rel="icon"> says where it is.
test("the page names an icon Google's results can show", async ({ page, request }) => {
  await page.goto("/")
  const href = await page.locator('link[rel="icon"][type="image/png"]').getAttribute("href")
  const png = await (await request.get(href!)).body()
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  expect(height).toBe(width)
  expect(width).toBeGreaterThan(48)
  expect(width % 48).toBe(0)
  // Where browsers and crawlers look when a page names no icon.
  const ico = await request.get("/favicon.ico")
  expect(ico.status()).toBe(200)
  expect([...(await ico.body()).subarray(0, 4)]).toEqual([0, 0, 1, 0])
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
