import { expect, keyOn, openApp, setFake, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// The recording screen is read from across the room. Nobody stands at the
// laptop while they play, so the screen is read from behind the kit: the
// take's name over a big clock, and a tile per track that lights up. A clip
// stays on its tile to the end of the take, because nobody was looking at the
// moment it happened. The page's clock is a fake one, so time can pass
// without waiting for it.

/** The second go at "Vesna", recording, both tracks at half scale. */
async function secondGo(page: Page, song = "Vesna") {
  await page.clock.install()
  await openApp(page, { before: "window.__LEVELS__ = {'Guitar': [0.5], 'Vocals': [0.5]};" })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await page.fill("#take-name", song)
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.getByRole("button", { name: /Record take 2/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await vocalsAt(page, 50)
}

const levels = (page: Page, guitar: number, vocals: number) =>
  setFake(page, "__LEVELS__", { Guitar: [guitar], Vocals: [vocals] })

/** Until the Vocals tile shows this level: the page has polled since. */
const vocalsAt = (page: Page, level: number) =>
  expect(
    page.locator("main [role=group][aria-label='Vocals'] [data-side]").first()
  ).toHaveAttribute("data-level", String(level))

const tile = (page: Page, name: string) => page.getByRole("group", { name })
/** The take's name, big over the clock. */
const takeName = (page: Page) => page.getByRole("heading", { level: 1 })
/** The line up top, beside the red RECORDING. */
const topLine = (page: Page) => page.locator("[data-recording-line]")
/** The pill in the middle that said all was well, or what was not. */
const pill = (page: Page) => page.getByRole("status", { name: "Take status" })

/** CI's Linux draws the page in Liberation Sans, which has Arial's metrics
 *  and is wider than Segoe UI or San Francisco. Measured in Arial, the tiles
 *  fit or do not the same on every machine, and a squeeze only CI would have
 *  seen shows up here first. */
const wideFont = (page: Page) =>
  page.addStyleTag({ content: "html, body { font-family: Arial, sans-serif !important; }" })

/** The track names a tile cuts short: no worse than it is without the take's
 *  name over the clock, at each size checked. */
const cutNames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main [role=group]")]
      .filter((t) => {
        const el = t.querySelector("[data-name]")!
        return el.scrollHeight > el.clientHeight + 1
      })
      .map((t) => t.getAttribute("aria-label"))
  )

/** How far up its side the Vocals tile's fill reaches, 0..1. */
const reach = (page: Page) =>
  page.evaluate(() => {
    const side = document.querySelector("main [role=group][aria-label='Vocals'] [data-side='1']")
    const fill = side?.querySelector("[data-fill]")
    return side && fill
      ? fill.getBoundingClientRect().height / side.getBoundingClientRect().height
      : 0
  })

/** How each tile writes its track's name: up the tile, in one piece, from
 *  its bottom left corner — "Overheads" broken into "Overhea / ds" across a
 *  narrow tile is what this replaced. Returns the ones that do not. */
const badNames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main [role=group]")]
      .map((t) => {
        const el = t.querySelector("[data-name]")
        const name = t.getAttribute("aria-label")
        if (!el) return { name, found: false }
        const tile = t.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const size = parseFloat(cs.fontSize)
        return {
          name,
          found: true,
          upward: cs.writingMode === "vertical-rl" && cs.transform !== "none",
          oneLine: r.width < size * 1.6,
          whole: el.scrollHeight <= el.clientHeight + 1,
          corner: r.left - tile.left < 24 && tile.bottom - r.bottom < 24,
        }
      })
      .filter((n) => !Object.values(n).every(Boolean))
  )

test("a first take says what is recording, what clipped and what is silent", async ({ page }) => {
  // The fake holds Guitar at the top and Vocals at nothing, unless a test
  // plays its own.
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  // A take nobody named says so, big: the sign that a name was forgotten.
  // Said once — "Take 1" up top as well would say it twice.
  await expect(takeName(page)).toHaveText("Take 1")
  await expect(topLine(page)).toHaveText("Recording")
  // Silent is said once an input has been quiet for a moment.
  await expect(tile(page, "Vocals")).toHaveAttribute("data-silent")
  await expect(tile(page, "Vocals")).toContainText("silent")
  // An estimate under two days keeps its about.
  await expect(
    page.getByText("Interface connected · room for about 10 h 40 min more", { exact: true })
  ).toHaveCount(1)
  // Guitar at the top the whole time is one clip that has not ended, not
  // one for every poll, said on its tile and nowhere else.
  await expect(tile(page, "Guitar")).toHaveAttribute("data-clipped")
  await expect(tile(page, "Guitar")).toContainText("clipped")
  await expect(tile(page, "Guitar")).not.toContainText("clipped 2×")
  await expect(pill(page)).toHaveCount(0)
  // The clock counts minutes, not hours nobody has played yet, and a first
  // take has nothing to be measured against.
  await expect(page.getByRole("timer")).toHaveText(/^0:0\d$/)
  await expect(page.getByText("last time")).toHaveCount(0)
  await expect.poll(() => keyOn(page.getByRole("button", { name: /^Stop/ }))).toBe("Space")
  await expect(page.getByText("autosaved every 30 s", { exact: true })).toHaveCount(1)
})

test("a second go at a song is measured against the first, under the take's name", async ({
  page,
}) => {
  await secondGo(page)
  // The name, big over the clock, half its size and centred over it, so it
  // reads from as far away. The number goes up beside RECORDING.
  await expect(takeName(page)).toHaveText("Vesna 2")
  await expect(topLine(page)).toHaveText(/^Recording\s*Take 2$/)
  const shape = await page.evaluate(() => {
    const name = document.querySelector("h1")!
    const clock = document.querySelector("[role=timer]")!
    const n = name.getBoundingClientRect()
    const c = clock.getBoundingClientRect()
    return {
      half: parseFloat(getComputedStyle(name).fontSize) / parseFloat(getComputedStyle(clock).fontSize),
      offCentre: Math.abs(n.left + n.width / 2 - (c.left + c.width / 2)),
      over: c.top - n.bottom,
    }
  })
  expect(shape.half).toBeCloseTo(0.5, 1)
  expect(shape.offCentre).toBeLessThan(2)
  expect(shape.over).toBeGreaterThanOrEqual(0)
  expect(shape.over).toBeLessThan(12)

  // The song is up there already; the bar under the clock says only the time.
  await expect(page.getByText("Took 0:06 last time", { exact: true })).toHaveCount(1)
  // On a bar that fills as the band gets further into it.
  await expect(page.getByRole("progressbar", { name: "Against the last go" })).toHaveAttribute(
    "aria-valuemax",
    "6"
  )
  await expect(pill(page)).toHaveCount(0)
})

test("a long name is cut short on one line, and moves nothing", async ({ page }) => {
  await secondGo(page, "A very long name for a song about spring, summer and a little autumn")
  const name = takeName(page)
  await expect(name).toHaveText(/^A very long name .* 2$/)
  const cut = await name.evaluate((el) => ({
    short: el.scrollWidth > el.clientWidth,
    oneLine: el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 1.5,
    inside: el.getBoundingClientRect().right <= window.innerWidth,
    ellipsis: getComputedStyle(el).textOverflow,
  }))
  expect(cut).toEqual({ short: true, oneLine: true, inside: true, ellipsis: "ellipsis" })
})

test("clips are counted, on the tile that clipped, and kept to the end of the take", async ({
  page,
}) => {
  await secondGo(page)
  for (let i = 0; i < 3; i++) {
    await levels(page, 0.5, 0.99)
    await vocalsAt(page, 99)
    await levels(page, 0.5, 0.5)
    await vocalsAt(page, 50)
  }
  await expect(tile(page, "Vocals")).toHaveAttribute("data-clipped")
  await expect(tile(page, "Vocals")).toContainText("clipped 3×")
  await expect(tile(page, "Guitar")).not.toHaveAttribute("data-clipped")

  // Whoever was playing at the time sees it when they look up, however much
  // later that is.
  await page.clock.fastForward(61_000)
  await vocalsAt(page, 50)
  await expect(tile(page, "Vocals")).toHaveAttribute("data-clipped")
  await expect(tile(page, "Vocals")).toContainText("clipped 3×")
  // And the clock goes on in minutes past the first.
  await expect(page.getByRole("timer")).toHaveText(/^1:0\d$/)
})

test("a quiet singer is not silent, and a dead input dims without an alarm", async ({ page }) => {
  await secondGo(page)
  const vocals = tile(page, "Vocals")
  // With the gain set for the loudest hit, whole passages sit around −48 dBFS.
  await levels(page, 0.5, 0.004)
  await vocalsAt(page, 0)
  await page.clock.fastForward(2_000)
  const polls = () =>
    page.evaluate(() => (window as unknown as { __LEVEL_POLLS__?: number }).__LEVEL_POLLS__ ?? 0)
  const now = await polls()
  await expect.poll(polls).toBeGreaterThanOrEqual(now + 2)
  await expect(vocals).not.toHaveAttribute("data-silent")

  // A singer between verses is quiet: dimmed, and nothing said about it.
  await levels(page, 0.5, 0.0005)
  await expect(vocals).toHaveAttribute("data-silent")
  await expect(page.locator("[data-notice]")).toHaveCount(0)
  await levels(page, 0.5, 0.5)
  await expect(vocals).not.toHaveAttribute("data-silent")
})

test("the fill is in dB and falls back, and the figure holds the peak", async ({ page }) => {
  await secondGo(page)
  // A band sets its gain for the loudest hit to reach about −18 dBFS, which
  // on a straight scale was an eighth of the tile.
  // From half scale it sinks there rather than drops, so it is waited for.
  await levels(page, 0.5, 0.126)
  await vocalsAt(page, 13)
  await expect.poll(() => reach(page)).toBeLessThan(0.75)
  expect(await reach(page)).toBeGreaterThan(0.65)

  // A meter rises at once and falls back at a steady rate, as on the desk:
  // dropping to each poll's level made a voice blink.
  await levels(page, 0.5, 0.5)
  await vocalsAt(page, 50)
  await expect.poll(() => reach(page)).toBeGreaterThan(0.85)
  await levels(page, 0.5, 0.0005)
  await vocalsAt(page, 0)
  expect(await reach(page)).toBeGreaterThan(0.3)
  await page.clock.fastForward(3_000)
  await expect.poll(() => reach(page)).toBeLessThan(0.05)

  // The figure is the peak the line holds, not the last poll's: that changed
  // fourteen times a second, and what the eye kept was the troughs.
  await levels(page, 0.5, 0.5)
  await vocalsAt(page, 50)
  await levels(page, 0.5, 0.126)
  await vocalsAt(page, 13)
  await expect(tile(page, "Vocals")).toContainText("-6.0 dB")
  await page.clock.fastForward(2_000)
  await expect(tile(page, "Vocals")).toContainText("-18.0 dB")
})

test("running out of disk is said on the disk line, and past an hour the clock says the hours", async ({
  page,
}) => {
  await secondGo(page)
  await levels(page, 0.5, 0.99)
  await vocalsAt(page, 99)
  await setFake(page, "__LOW_SPACE__", true)
  // Said where the free space always is, for as long as it holds: not a
  // notice over the tiles, and not instead of the clip.
  await expect(page.getByText(/^Running out of space: .* left\./)).toHaveCount(1)
  await expect(page.locator("[data-notice]")).toHaveCount(0)
  await expect(pill(page)).toHaveCount(0)
  await expect(tile(page, "Vocals")).toHaveAttribute("data-clipped")
  await setFake(page, "__LOW_SPACE__", false)

  await page.clock.fastForward(3_600_000)
  await expect(page.getByRole("timer")).toHaveText(/^1:0\d:\d\d$/)
  // Two tracks give wide tiles, and the name is written the same way there:
  // one way to read a tile, whatever the band.
  expect(await badNames(page)).toEqual([])
})

test("sixteen tracks still fit in one row, a stereo one split down the middle", async ({
  page,
}) => {
  // The XR18 has sixteen inputs and a stereo pair besides. However many of
  // them are recorded, every track is one tile of one width in one row —
  // never a second row, never a scrollbar.
  const tracks: { name: string; channel: number; stereo: boolean }[] = []
  let channel = 1
  for (const name of [
    "Kick", "Snare", "Hi-hat", "Tom 1", "Tom 2", "Floor tom", "Overheads", "Bass",
    "Guitar 1", "Guitar 2", "Keys", "Acoustic", "Vocals", "Backing 1", "Backing 2", "Sax",
  ]) {
    const stereo = name === "Overheads" || name === "Keys"
    tracks.push({ name, channel, stereo })
    channel += stereo ? 2 : 1
  }
  const lit = Object.fromEntries(
    tracks.map((t) => [t.name, t.name === "Keys" ? [0.4, 0] : t.stereo ? [0.4, 0.4] : [0.4]])
  )
  await openApp(page, {
    before: `window.__SESSION_TRACKS__ = ${JSON.stringify(tracks)};
      window.__LEVELS__ = ${JSON.stringify(lit)};`,
  })
  await wideFont(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.locator("main [role=group]")).toHaveCount(16)

  for (const [width, height] of [
    [1180, 820],
    [1024, 640],
  ]) {
    await page.setViewportSize({ width, height })
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tiles = [...document.querySelectorAll("main [role=group]")].map((el) =>
            el.getBoundingClientRect()
          )
          const main = document.querySelector("main")!
          const widths = tiles.map((r) => r.width)
          return {
            count: tiles.length,
            rows: new Set(tiles.map((r) => Math.round(r.top))).size,
            // A stereo tile is as wide as a mono one.
            sameWidth: Math.max(...widths) - Math.min(...widths) < 1,
            // Nothing scrolls, either way.
            inside: Math.max(...tiles.map((r) => r.right)) <= window.innerWidth,
            sideways: document.documentElement.scrollWidth > window.innerWidth,
            scrolls: main.scrollHeight > main.clientHeight + 1,
          }
        })
      , { message: `at ${width}×${height}` })
      .toEqual({ count: 16, rows: 1, sameWidth: true, inside: true, sideways: false, scrolls: false })
    expect(await badNames(page), `names at ${width}×${height}`).toEqual([])
  }

  // A stereo tile shows both sides, each on its own, so a side that has
  // gone dead shows as dead.
  const keys = tile(page, "Keys")
  await expect(keys).toHaveAttribute("data-channels", "2")
  await expect(keys.locator("[data-side]")).toHaveCount(2)
  await expect(keys.locator("[data-side='2']")).toHaveAttribute("data-level", "0")
})

test("on a small laptop the take's name leaves the tiles room for their names", async ({
  page,
}) => {
  // Eight tracks on a second go, with the bar under the clock: the tallest
  // the screen gets. The name over the clock takes no more than the pill in
  // the middle gave back.
  const tracks = ["Kick", "Snare", "Overheads", "Bass", "Guitar", "Keys", "Vocals", "Backing"].map(
    (name, i) => ({ name, channel: i + 1 })
  )
  await page.addInitScript(`window.__SESSION_TRACKS__ = ${JSON.stringify(tracks)};`)
  await secondGo(page)
  await wideFont(page)
  await expect(page.locator("main [role=group]")).toHaveCount(8)
  for (const [width, height, longest] of [
    [1366, 768, "whole"],
    // The narrowest tiles were already too short for "Overheads" here.
    [1024, 640, "may be cut"],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect
      .poll(() => page.evaluate(() => {
        const main = document.querySelector("main")!
        return main.scrollHeight > main.clientHeight + 1
      }), { message: `scrolls at ${width}×${height}` })
      .toBe(false)
    const cut = await cutNames(page)
    expect(longest === "whole" ? cut : cut.filter((n) => n !== "Overheads"), `names cut short at ${width}×${height}`).toEqual([])
  }
})

test("a tile carries its track's icon in its top left corner", async ({ page }) => {
  await openApp(page, {
    before: `window.__SESSION_TRACKS__ = [{name: 'Guitar', channel: 1, icon: 'guitar-electric'},
      {name: 'Vocals', channel: 2}];`,
  })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  const guitar = tile(page, "Guitar")
  const icon = guitar.locator("[data-icon]")
  await expect(icon).toHaveAttribute("data-icon", "guitar-electric")
  // None chosen: the neutral one, so every tile reads the same way.
  await expect(tile(page, "Vocals").locator("[data-icon]")).toHaveAttribute("data-icon", "other")

  const box = (await guitar.boundingBox())!
  const at = (await icon.boundingBox())!
  const name = (await guitar.locator("[data-name]").boundingBox())!
  expect(at.x - box.x).toBeLessThan(box.width / 4)
  expect(at.y - box.y).toBeLessThan(box.height / 4)
  expect(at.y + at.height).toBeLessThan(name.y)
})
