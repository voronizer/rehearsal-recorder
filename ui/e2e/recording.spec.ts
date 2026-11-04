import {
  badNames,
  colour,
  drawnLate,
  EDGE,
  expect,
  fitted,
  keyOn,
  mixed,
  nameTake,
  openApp,
  openBandApp,
  scaled,
  setFake,
  settled,
  startButton,
  startRehearsal,
  style,
  test,
  themed,
  tileNames,
  tipLines,
  watchDrawn,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The recording screen is read from across the room. Nobody stands at the
// laptop while they play, so the screen is read from behind the kit: the
// take's name over a big clock, and a tile per track that lights up. A clip
// stays on its tile to the end of the take, because nobody was looking at the
// moment it happened. The page's clock is a fake one, so time can pass
// without waiting for it.

/** The second go at "Viasna", recording, both tracks at half scale. */
async function secondGo(page: Page, song = "Viasna", before = "") {
  await page.clock.install()
  await openApp(page, { before: `window.__LEVELS__ = {'Guitar': [0.5], 'Vocals': [0.5]};${before}` })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await nameTake(page, song)
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
/** The red dot, Recording and the take's number, in the footer beside Stop. */
const topLine = (page: Page) => page.locator("[data-recording-line]")
/** The disk line under it, with the battery and what is wrong with the
 *  interface: one box that keeps its size whatever it says. */
const health = (page: Page) => page.locator("[data-health]")
/** The pill in the middle of the header the screen had, which said all was
 *  well or what was not. Neither is drawn now (Q1). */
const pill = (page: Page) => page.getByRole("status", { name: "Take status" })

/** CI's Linux draws the page in Liberation Sans, which has Arial's metrics
 *  and is wider than Segoe UI or San Francisco. Measured in Arial, the tiles
 *  fit or do not the same on every machine, and a squeeze only CI would have
 *  seen shows up here first. */
const wideFont = (page: Page) =>
  page.addStyleTag({ content: "html, body { font-family: Arial, sans-serif !important; }" })

/** The track names a tile cuts short: no worse than it is without the take's
 *  name over the clock, at each size checked. */
const cutNames = async (page: Page) =>
  (await tileNames(page)).filter((n) => !n.whole).map((n) => n.name)

/** How far up its side the Vocals tile's fill reaches, 0..1. */
const reach = (page: Page) =>
  page.evaluate(() => {
    const side = document.querySelector("main [role=group][aria-label='Vocals'] [data-side='1']")
    const fill = side?.querySelector("[data-fill]")
    return side && fill
      ? fill.getBoundingClientRect().height / side.getBoundingClientRect().height
      : 0
  })

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
  // An estimate under two days keeps its about, after the green dot that
  // says the interface is sending.
  await expect(
    page.getByText("Room for about 10 h 40 min of recording", {
      exact: true,
    })
  ).toHaveCount(1)
  await expect(page.locator("[data-health]").getByRole("img", { name: "Interface connected" })).toBeVisible()
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
  // reads from as far away. The number goes beside Recording, by Stop.
  await expect(takeName(page)).toHaveText("Viasna 2")
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
  // On a bar that fills as the band gets further into it, read out in time.
  await expect(page.getByRole("progressbar", { name: "Against the last take" })).toHaveAttribute(
    "aria-valuetext",
    /^0:0\d of 0:06$/
  )
  await expect(pill(page)).toHaveCount(0)
})

/** A box's edges, to the pixel's fraction. */
const edges = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { top: r.top, right: r.right, bottom: r.bottom, left: r.left }
}

test("the screen is the take and the tiles, with the status beside Stop", async ({ page }) => {
  // The band's sixth take, its second go at Viasna: the bar against the
  // first is under the clock.
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startButton(page).click()
  await page.getByRole("button", { name: /Record take 6/ }).click()
  const stop = page.getByRole("button", { name: /^Stop/ })
  await expect(stop).toBeVisible()
  await settled(page)

  // Two groups and a footer, with no header over them (Q1, «Статус у Stop»).
  await expect(page.locator("header")).toHaveCount(0)
  const take = page.locator("main [data-take]")
  const tiles = page.locator("main [data-tiles]")
  await expect(take.getByRole("heading", { level: 1 })).toHaveText("Viasna 2")
  await expect(take.getByRole("timer")).toHaveCount(1)
  await expect(take.getByRole("progressbar", { name: "Against the last take" })).toHaveCount(1)
  await expect(tiles.getByRole("group")).toHaveCount(4)

  // The status row is in the footer's left, beside Stop: Recording, as
  // written, over the disk line.
  const status = page.locator("footer [data-status-row]")
  await expect(status).toHaveCount(1)
  const recording = status.locator("[data-recording-line]")
  await expect(recording).toHaveText(/^Recording\s*Take 6$/)
  expect(await style(recording.getByText("Recording", { exact: true }), "text-transform")).toEqual({
    "text-transform": "none",
  })
  const row = await status.evaluate(edges)
  const line = await recording.evaluate(edges)
  const disk = await status.locator("[data-health]").evaluate(edges)
  expect(row.right, "left of Stop").toBeLessThanOrEqual((await stop.evaluate(edges)).left)
  expect(disk.top, "the disk line under Recording").toBeGreaterThanOrEqual(line.bottom)
  expect(Math.abs(disk.left - line.left), "both from the row's left").toBeLessThanOrEqual(0.5)
  // The disk line in the start screen's look, its words where Recording's
  // start: its green dot's place and gap are as wide as the red dot and its,
  // and the two dots are one size, one above the other.
  const starts = await status.evaluate((el) =>
    [
      el.querySelector("[data-recording-line] .font-semibold")!,
      el.querySelector("[data-health] > :last-child > span:last-child")!,
    ].map((e) => e.getBoundingClientRect().left)
  )
  const dots = await status.evaluate((el) =>
    [el.querySelector("[data-recording-line] > span")!, el.querySelector("[data-health] [data-live]")!].map((e) => {
      const r = e.getBoundingClientRect()
      return [r.left, r.width]
    })
  )
  expect(dots[1], "the green dot under the red one").toEqual(dots[0])
  expect(Math.abs(starts[0] - starts[1]), "the two lines' words from one x").toBeLessThanOrEqual(0.5)

  // The start screen's air: 32 round the screen, 48 between the groups, the
  // bar 24 under the clock.
  const main = page.locator("main")
  expect(
    await style(main, "padding-top", "padding-right", "padding-bottom", "padding-left")
  ).toEqual({
    "padding-top": "32px",
    "padding-right": "32px",
    "padding-bottom": "32px",
    "padding-left": "32px",
  })
  const between = (await tiles.evaluate(edges)).top - (await take.evaluate(edges)).bottom
  expect(Math.abs(between - 48), `${between} between the take and the tiles`).toBeLessThanOrEqual(0.5)
  const clock = await take.getByRole("timer").evaluate(edges)
  const bar = await take.locator("[data-against]").evaluate(edges)
  expect(Math.abs(bar.top - clock.bottom - 24), "the bar under the clock").toBeLessThanOrEqual(0.5)

  // The tiles one group on one fill, 6 px between them and 3 px of it round
  // each well.
  expect(
    await style(
      tiles,
      "background-color",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
      "column-gap",
      "padding-top"
    )
  ).toEqual({
    "background-color": await colour(page, "--card"),
    "border-top-left-radius": "12px",
    "border-top-right-radius": "12px",
    "border-bottom-right-radius": "12px",
    "border-bottom-left-radius": "12px",
    "column-gap": "6px",
    "padding-top": "3px",
  })
})

test("the bar against the last take is the shared progress bar, in grey", async ({ page }) => {
  await secondGo(page)
  const bar = page.getByRole("progressbar", { name: "Against the last take" })
  await expect(bar).toHaveAttribute("data-slot", "progress")
  // Grey, as it was: it is a reading, not the main action or what plays.
  const fill = bar.locator("[data-slot='progress-indicator']")
  const grey = await mixed(page, "--foreground", 55)
  expect(await style(fill, "background-color")).toEqual({ "background-color": grey })
  expect(grey, "not the accent").not.toBe(await colour(page, "--primary"))
})

test("a long take name wraps to two lines and is cut after that with its number", async ({
  page,
}) => {
  const whole = "Kalychanka (slow version for the wedding, with the long intro the bride asked for)"
  await openApp(page, { stress: "recording" })
  await settled(page)
  const name = takeName(page)
  // Read whole, whatever is drawn.
  await expect(name).toHaveAccessibleName(`${whole} 2`)
  const title = name.locator("[data-go-title]")
  await expect(title).toHaveAttribute("data-lines", "2")
  await expect(title).toHaveAttribute("data-cut")
  // Cut after the second line, and the go after the "…" stays whole.
  await expect(title).toHaveText(/…\s2$/)
  const drawn = await title.evaluate((el) => {
    const size = parseFloat(getComputedStyle(el).fontSize)
    const box = el.getBoundingClientRect()
    const go = el.querySelector("[data-go]")!.getBoundingClientRect()
    return {
      lines: Math.round(box.height / (size * 1.1)),
      goOnTheLast: Math.abs(go.bottom - box.bottom) <= size * 0.2,
      goInside: go.width > 0 && go.left >= box.left && go.right <= box.right,
      inside: box.left >= 0 && box.right <= window.innerWidth,
    }
  })
  expect(drawn).toEqual({ lines: 2, goOnTheLast: true, goInside: true, inside: true })
  // Whole in the shared tooltip, on hover.
  await title.hover()
  await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(whole)
})

test("a name on the edge of a second line settles, and then nothing moves", async ({ page }) => {
  // Eight tracks, 960 wide: the clock gives way for the tiles, so a window a
  // few pixels taller draws it, and the name over it, a little bigger.
  // Somewhere between 600 and 780 tall this name goes from one line to two
  // (at 688 in Inter or in Arial). The test finds that edge in whatever
  // font the page has and looks every 2 px round it. Every line is 1.1 tall, one or two
  // (TwoLines): with one line at 1, how tall the name is would depend on
  // what it was last fitted to, and on the edge the name and the clock would
  // be fitted one after the other for ever.
  const tracks = ["Kick", "Snare", "Overheads", "Bass", "Guitar", "Keys", "Vocals", "Backing"].map(
    (name, i) => ({ name, channel: i + 1 })
  )
  await page.setViewportSize({ width: 960, height: 600 })
  await page.addInitScript(`window.__SESSION_TRACKS__ = ${JSON.stringify(tracks)};`)
  await secondGo(page, "Forty characters in this song name here ok")
  await settled(page)
  /** What a fit changes, counted over 60 ms: the clock's size on the
   *  column, the tiles' least height on their group, the name's lines and
   *  words. A fit that does not settle changes them every frame. */
  const changes = () =>
    page.evaluate(
      () =>
        new Promise<number>((done) => {
          let count = 0
          const watch = new MutationObserver((seen) => (count += seen.length))
          watch.observe(document.querySelector("main [data-take]")!.parentElement!, { attributes: true })
          watch.observe(document.querySelector("main [data-tiles]")!, { attributes: true })
          watch.observe(document.querySelector("main h1")!, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
          })
          setTimeout(() => {
            watch.disconnect()
            done(count)
          }, 60)
        })
    )
  const title = takeName(page).locator("[data-go-title]")
  const at = async (height: number) => {
    await page.setViewportSize({ width: 960, height })
    // The fit, once, for the new size.
    await page.waitForTimeout(100)
    return title.getAttribute("data-lines")
  }
  // Where the name goes from one line to two depends on the font: find it,
  // then look closely only round it, where a fit that chases its own
  // line count would show.
  let one = 600
  let two = 780
  expect(await at(one), `one line at ${one}`).toBe("1")
  expect(await at(two), `two lines at ${two}`).toBe("2")
  while (two - one > 2) {
    const mid = Math.round((one + two) / 2)
    if ((await at(mid)) === "1") one = mid
    else two = mid
  }
  const seen: { height: number; lines: string | null; leading: number; changes: number }[] = []
  for (let height = one - 10; height <= two + 4; height += 2) {
    const lines = await at(height)
    const after = await changes()
    const leading = await title.evaluate((el) => {
      const cs = getComputedStyle(el)
      return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)
    })
    seen.push({ height, lines, leading: Math.round(leading * 100) / 100, changes: after })
  }
  expect(
    seen.filter((s) => s.leading !== 1.1 || s.changes > 0),
    "a leading not 1.1, on one line or two, or a fit that does not settle"
  ).toEqual([])
})

test("a take name has its words before the screen is first drawn", async ({ page }) => {
  // In 960x680 the clock gives way for the tiles, so the take's name is drawn
  // smaller than the window's height alone makes it: the stress data's long
  // name is whole on two lines, where at the window's size it is cut. It is
  // first fitted at the window's size, before the screen's fit; fitted again
  // at the screen's only after the first frame was drawn, it would show cut
  // for that frame, and then whole.
  await page.setViewportSize({ width: 960, height: 680 })
  await page.addInitScript(
    watchDrawn(`document.querySelector("main h1 [data-go-title]")?.textContent ?? null`)
  )
  await openApp(page, { stress: "recording" })
  await settled(page)
  const { last, late } = await drawnLate(page)
  // The 2 after a no-break space, so it never starts a line of its own.
  expect(last, "the name, whole").toBe(
    "Kalychanka (slow version for the wedding, with the long intro the bride asked for)\u00a02"
  )
  expect(late, "words that came after a frame was drawn").toEqual([])
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

test("a reading under -99.9 dB stays in the room the figure holds", async ({ page }) => {
  await secondGo(page)
  const figure = tile(page, "Vocals").locator("[data-db]")
  const box = () =>
    figure.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return [Math.round(r.x * 10) / 10, Math.round(r.width * 10) / 10]
    })
  await expect(figure).toContainText("-6.0")
  const was = await box()
  // A dead input on a real interface reads -100 to -140 dB; the quietest a
  // 24-bit one can read is -186.6.
  await levels(page, 0.5, 0.00001)
  await vocalsAt(page, 0)
  await page.clock.fastForward(3_000)
  await expect(figure).toContainText("-100.0")
  expect(await box(), "where the figure stands, and how wide it is").toEqual(was)
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
  await expect(
    page.getByText("Low disk space: room for about 5 min. Free some up or finish the rehearsal.", {
      exact: true,
    })
  ).toHaveCount(1)
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

test("a battery running low is said on the status line, and nothing moves", async ({ page }) => {
  await secondGo(page)
  // The status row the line shares with Recording: it must not grow a line.
  const row = topLine(page).locator("..")
  const before = (await row.boundingBox())!.height
  await setFake(page, "__BATTERY__", 14)
  // Said where the free space always is, as long as it holds: not a notice.
  await expect(page.getByText("Battery 14%: plug the laptop in", { exact: true })).toHaveCount(1)
  await expect(page.locator("[data-notice]")).toHaveCount(0)
  expect((await row.boundingBox())!.height).toBe(before)
  // Charged enough, or plugged in: the usual line.
  await setFake(page, "__BATTERY__", 64)
  await expect(page.getByText(/^Room for/)).toHaveCount(1)
  await expect(page.getByText(/^Battery/)).toHaveCount(0)
  await setFake(page, "__BATTERY__", 14)
  await expect(page.getByText(/^Battery 14%/)).toHaveCount(1)
  await setFake(page, "__BATTERY__", null)
  await expect(page.getByText(/^Room for/)).toHaveCount(1)
})

/** The take's time as m:ss or h:mm:ss, in seconds. */
const seconds = (clock: string) => clock.split(":").reduce((s, part) => s * 60 + Number(part), 0)

/** Moves the page's clock on until the take's clock reads `reading`: to a
 *  second short of it, then on by the screen's own tick. */
async function clockReads(page: Page, reading: string) {
  const figures = page.locator("[data-clock]")
  const short = seconds(reading) - seconds(await figures.innerText()) - 1
  if (short > 0) await page.clock.fastForward(short * 1000)
  await expect
    .poll(
      async () => {
        const now = await figures.innerText()
        if (seconds(now) < seconds(reading)) await page.clock.fastForward(200)
        return now
      },
      { intervals: [50] }
    )
    .toBe(reading)
}

test("the seconds never move as the clock gains a figure", async ({ page }) => {
  await secondGo(page)
  await settled(page)
  // The clock grows to the left from where "0:00" ends.
  const right: Record<string, number> = {}
  for (const reading of ["9:59", "10:00", "59:59", "1:00:00"]) {
    await clockReads(page, reading)
    right[reading] = await page.locator("[data-clock]").evaluate((el) => el.getBoundingClientRect().right)
  }
  for (const [reading, at] of Object.entries(right))
    expect(Math.abs(at - right["9:59"]), `the right edge at ${reading}`).toBeLessThanOrEqual(0.5)
})

test("ten hours fit in a 960x820 window", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 820 })
  await secondGo(page)
  await settled(page)
  await page.clock.fastForward(10 * 3600 * 1000)
  await expect(page.locator("[data-clock]")).toHaveText(/^10:00:\d\d$/)
  // Inside the screen's air: it starts no further left than the padding.
  const { left, edge } = await page.evaluate(() => {
    const main = document.querySelector("main")!
    return {
      left: document.querySelector("[data-clock]")!.getBoundingClientRect().left,
      edge: main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft),
    }
  })
  expect(left).toBeGreaterThanOrEqual(edge - 0.5)
})

test("nothing moves when low space comes at 150 percent in 960x680", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await secondGo(page, "Viasna", scaled(1.5))
  // Past the last take's 0:06, so the bar is full and holds still.
  await page.clock.fastForward(10_000)
  await settled(page)
  // Every box on the screen; inside the disk line only its own box, as its
  // words are what changes.
  const boxes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main *, footer *")]
        .filter((el) => !el.parentElement?.closest("[data-health]"))
        .map((el) => {
          const r = el.getBoundingClientRect()
          const marks = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.name)
          return { el: [el.tagName.toLowerCase(), ...marks].join(" "), at: [r.x, r.y, r.width, r.height] }
        })
    )
  const before = await boxes()
  await setFake(page, "__LOW_SPACE__", true)
  await expect(page.getByText(/^Low disk space: room for about 5 min\./)).toHaveCount(1)
  await settled(page)
  const after = await boxes()
  expect(after.length, "the same boxes").toBe(before.length)
  const moved = after.filter((b, i) => b.at.some((v, k) => Math.abs(v - before[i].at[k]) > 0.5))
  expect(moved.map((b) => b.el), "what moved").toEqual([])
})

test("the recording disk line says the start screen's words", async ({ page }) => {
  await secondGo(page)
  // The start screen says "Room for about 10 h 40 min of recording"; here
  // the same sentence follows a green dot: the interface is sending.
  const live = health(page).getByRole("img", { name: "Interface connected" })
  await expect(live).toBeVisible()
  expect(await style(live, "background-color")).toEqual({ "background-color": await colour(page, "--signal") })
  await expect(
    page.getByText("Room for about 10 h 40 min of recording", {
      exact: true,
    })
  ).toHaveCount(1)
  // Low space is the start screen's "Low disk space: room for about 5 min",
  // and what to do about it.
  await setFake(page, "__LOW_SPACE__", true)
  await expect(
    page.getByText("Low disk space: room for about 5 min. Free some up or finish the rehearsal.", {
      exact: true,
    })
  ).toHaveCount(1)
  await expect(page.getByText(/^Running out of space/)).toHaveCount(0)
  // Low on space, the dot is not there: the warning says enough.
  await expect(live).toHaveCount(0)
  await setFake(page, "__LOW_SPACE__", false)
  await expect(page.getByText(/^Room for /)).toHaveCount(1)
  await expect(live).toBeVisible()
})

for (const theme of ["dark", "light"] as const) {
  test(`the low disk line on the recording screen is a warning in the text colour, in the ${theme} theme`, async ({
    page,
  }) => {
    await secondGo(page, "Viasna", themed(theme))
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
      theme === "dark"
    )
    await setFake(page, "__LOW_SPACE__", true)
    const words = page.getByText(/^Low disk space: room for about 5 min\./)
    await expect(words).toHaveCount(1)
    // The shared warning look (Alert's): the icon in warn, the words in the
    // text's colour. The same as on the start screen.
    expect(await style(words, "color")).toEqual({ color: await colour(page, "--foreground") })
    expect(await style(words.locator("..").locator("svg"), "color")).toEqual({
      color: await colour(page, "--warn"),
    })
    // A low battery is the same line and the same look.
    await setFake(page, "__LOW_SPACE__", false)
    await setFake(page, "__BATTERY__", 14)
    const battery = page.getByText("Battery 14%: plug the laptop in", { exact: true })
    await expect(battery).toHaveCount(1)
    expect(await style(battery, "color")).toEqual({ color: await colour(page, "--foreground") })
    expect(await style(battery.locator("..").locator("svg"), "color")).toEqual({
      color: await colour(page, "--warn"),
    })
    // Quiet when all is well.
    await setFake(page, "__BATTERY__", null)
    const fine = page.getByText(/^Room for /)
    await expect(fine).toHaveCount(1)
    expect(await style(fine, "color")).toEqual({ color: await colour(page, "--muted-foreground") })
  })
}

test("the health line keeps its size when low space comes", async ({ page }) => {
  await secondGo(page)
  for (const width of [1180, 640]) {
    await page.setViewportSize({ width, height: 820 })
    await settled(page)
    const line = health(page)
    const said = () => line.evaluate((e) => (e as HTMLElement).innerText)
    const was = await said()
    const before = (await line.boundingBox())!
    // The longest it says is held, unseen, from the start; whatever it says
    // after that, it takes the same room.
    for (const [name, value] of [
      ["__LOW_SPACE__", true],
      ["__BATTERY__", 14],
    ] as const) {
      await setFake(page, name, value)
      await expect.poll(said, { message: `${name} at ${width}` }).not.toBe(was)
      await settled(page)
      const after = (await line.boundingBox())!
      for (const key of ["x", "y", "width", "height"] as const)
        expect(Math.abs(after[key] - before[key]), `${key} at ${width} with ${name}`).toBeLessThanOrEqual(0.5)
      await setFake(page, name, name === "__BATTERY__" ? null : false)
      await expect.poll(said, { message: `${name} gone at ${width}` }).toBe(was)
    }
  }
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
    await fitted(page, { width, height })
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
  // the screen gets. The take's name and the clock give way for the tiles
  // before the tiles do, so the names keep their room.
  const tracks = ["Kick", "Snare", "Overheads", "Bass", "Guitar", "Keys", "Vocals", "Backing"].map(
    (name, i) => ({ name, channel: i + 1 })
  )
  await page.addInitScript(`window.__SESSION_TRACKS__ = ${JSON.stringify(tracks)};`)
  await secondGo(page)
  await wideFont(page)
  await expect(page.locator("main [role=group]")).toHaveCount(8)
  for (const [width, height, longest] of [
    [1366, 768, "whole"],
    // Here the clock has given way and the tiles stand at their 12.5rem,
    // too short for "Overheads" at 2.25rem: it gets smaller (TileName), and
    // in a font wider than Arial it could still be cut.
    [1024, 640, "may be cut"],
  ] as const) {
    await fitted(page, { width, height })
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

// The tile itself (C8, F4, B4, B6): set apart by its fill alone, on a well;
// what comes during a take draws inside it and moves nothing; and what it has
// no room to show is in the shared tooltip, never cut or in a native title.

/** A first take, recording: Guitar held at the top, Vocals at nothing. */
async function firstTake(page: Page) {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await settled(page)
}

/** A 2 px edge of `colour` on every side. */
const edgeOf = (colour: string) =>
  Object.fromEntries(EDGE.map((p) => [p, p.endsWith("color") ? colour : "2px"]))

/** Where a box stands, to the pixel's fraction. */
const at = (el: Element) => {
  const r = el.getBoundingClientRect()
  return [r.x, r.y, r.width, r.height]
}

const near = (a: number[] | null, b: number[] | null) =>
  !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 0.5)

test("a tile has no frame and sits on a well", async ({ page }) => {
  await firstTake(page)
  const well = await colour(page, "--well")
  expect(well, "the theme has a well").not.toBe("rgba(0, 0, 0, 0)")
  for (const name of ["Guitar", "Vocals"])
    expect(
      await style(
        tile(page, name),
        "border-top-width",
        "border-right-width",
        "border-bottom-width",
        "border-left-width",
        "background-color",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius"
      ),
      name
    ).toEqual({
      "border-top-width": "0px",
      "border-right-width": "0px",
      "border-bottom-width": "0px",
      "border-left-width": "0px",
      "background-color": well,
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
    })
})

test("a clip draws an edge inside the tile and moves nothing", async ({ page }) => {
  await secondGo(page)
  await settled(page)
  const vocals = tile(page, "Vocals")
  const boxes = () =>
    vocals.evaluate((el) => {
      const box = (e: Element | null) => {
        const r = e?.getBoundingClientRect()
        return r ? [r.x, r.y, r.width, r.height] : null
      }
      return { tile: box(el), header: box(el.querySelector("[data-header]")) }
    })
  await expect(vocals.locator("[data-edge]")).toHaveCount(0)
  const before = await boxes()

  await levels(page, 0.5, 0.99)
  await vocalsAt(page, 99)
  await levels(page, 0.5, 0.5)
  await vocalsAt(page, 50)
  await expect(vocals).toHaveAttribute("data-clipped")
  const edge = vocals.locator("[data-edge='clip']")
  await expect(edge).toHaveCount(1)
  // The red at 70 %, 2 px inside the tile's own box.
  expect(await style(edge, ...EDGE)).toEqual(edgeOf(await mixed(page, "--destructive", 70)))
  expect(near(await edge.evaluate(at), await vocals.evaluate(at)), "the edge is the tile's box").toBe(true)

  const after = await boxes()
  expect(before.header, "the tile has a header").not.toBeNull()
  expect(near(after.tile, before.tile), "the tile stays").toBe(true)
  expect(near(after.header, before.header), "its header stays").toBe(true)
})

test("a held line at full scale stays inside its meter", async ({ page }) => {
  await secondGo(page)
  await settled(page)
  const vocals = tile(page, "Vocals")
  await levels(page, 0.5, 1)
  await vocalsAt(page, 100)
  // Each side's held line, against its side's box: at full scale the line is
  // the top 2 px of it, not 2 px over it, where the tile cut it off.
  const held = () =>
    vocals.locator("[data-levels] [data-side]").evaluateAll((sides) =>
      sides.map((side) => {
        const line = side.querySelector("[data-held]")?.getBoundingClientRect()
        const box = side.getBoundingClientRect()
        return line ? { top: line.top - box.top, bottom: box.bottom - line.bottom, tall: line.height } : null
      })
    )
  // Until the line has risen to the clip, from wherever it held before.
  await expect.poll(async () => (await held())[0]?.top ?? Infinity).toBeLessThan(3)
  const [line] = await held()
  expect(line!.tall, "a 2 px line").toBe(2)
  expect(line!.top, "inside the meter, at its top").toBeGreaterThanOrEqual(-0.01)
  expect(line!.top, "at its top").toBeLessThanOrEqual(0.01)
})

test("a silent tile dims at once", async ({ page }) => {
  await secondGo(page)
  const vocals = tile(page, "Vocals")
  // What is drawn on the well: the fill, the figures and the name.
  const face = vocals.locator("[data-face]")
  await expect(face).toHaveCount(1)
  await levels(page, 0.5, 0.0005)
  await expect(vocals).toHaveAttribute("data-silent")
  // Read the moment it is said: a fade would be part way.
  expect(await style(face, "opacity", "transition-duration")).toEqual({
    opacity: "0.45",
    "transition-duration": "0s",
  })
  // The well keeps its colour, so the row of tiles keeps its shape.
  expect(await style(vocals, "opacity", "transition-duration", "background-color")).toEqual({
    opacity: "1",
    "transition-duration": "0s",
    "background-color": await colour(page, "--well"),
  })
  await levels(page, 0.5, 0.5)
  await expect(vocals).not.toHaveAttribute("data-silent")
  expect(await style(face, "opacity")).toEqual({ opacity: "1" })
})

test("the header keeps the room of its status line", async ({ page }) => {
  await secondGo(page)
  await settled(page)
  const vocals = tile(page, "Vocals")
  const header = vocals.locator("[data-header]")
  const status = vocals.locator("[data-status]")
  const tall = async () => (await header.boundingBox())!.height
  const playing = await tall()
  await expect(status).toBeHidden()
  // The room is kept by nothing to read: a sounding tile does not say silent.
  await expect(vocals).not.toContainText("silent")

  await levels(page, 0.5, 0.0005)
  await expect(status).toBeVisible()
  await expect(status).toHaveText("silent")
  expect(Math.abs((await tall()) - playing), "silent").toBeLessThanOrEqual(0.5)

  for (let i = 0; i < 3; i++) {
    await levels(page, 0.5, 0.99)
    await vocalsAt(page, 99)
    await levels(page, 0.5, 0.5)
    await vocalsAt(page, 50)
  }
  await expect(status).toHaveText("clipped 3×")
  expect(Math.abs((await tall()) - playing), "clipped 3 times").toBeLessThanOrEqual(0.5)
})

test("a tile with nothing to say opens no tooltip", async ({ page }) => {
  await secondGo(page)
  await settled(page)
  // Its figure fits and it takes no notes: there is nothing to add.
  const vocals = tile(page, "Vocals")
  expect(await tipLines(page, vocals)).toEqual([])
  // Still resting on it: no tooltip, and no aria-describedby naming one
  // that is not there.
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await expect(vocals).not.toHaveAttribute("aria-describedby")
  await expect(vocals).toHaveAttribute("data-state", "closed")
})

test("a dB figure with no room hides and is in the tooltip", async ({ page }) => {
  const tracks = Array.from({ length: 16 }, (_, i) => ({ name: `Track ${i + 1}`, channel: i + 1 }))
  const lit = Object.fromEntries(tracks.map((t) => [t.name, [0.4]]))
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, {
    before: `window.__SESSION_TRACKS__ = ${JSON.stringify(tracks)};
      window.__LEVELS__ = ${JSON.stringify(lit)};`,
  })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.locator("main [role=group]")).toHaveCount(16)
  await expect(tile(page, "Track 16").locator("[data-side]").first()).toHaveAttribute("data-level", "40")
  await settled(page)

  const seen = await page.evaluate(() =>
    [...document.querySelectorAll("main [role=group]")].map((t) => {
      const edge = t.getBoundingClientRect().right
      const past: string[] = []
      // What is drawn: the words, and the icons.
      const walk = document.createTreeWalker(t, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent?.trim() || getComputedStyle(n.parentElement!).visibility !== "visible") continue
        const range = document.createRange()
        range.selectNodeContents(n)
        const r = range.getBoundingClientRect()
        if (r.width > 0 && r.right > edge + 0.5) past.push(n.textContent)
      }
      for (const svg of t.querySelectorAll("svg")) {
        const r = svg.getBoundingClientRect()
        if (getComputedStyle(svg).visibility === "visible" && r.width > 0 && r.right > edge + 0.5)
          past.push("an icon")
      }
      const figure = t.querySelector("[data-db]")
      return {
        name: t.getAttribute("aria-label")!,
        past,
        hidden: figure ? getComputedStyle(figure).visibility !== "visible" : null,
      }
    })
  )
  expect(seen.filter((s) => s.past.length > 0), "what runs past a tile's right edge").toEqual([])
  const hidden = seen.filter((s) => s.hidden)
  expect(hidden.length, "figures with no room").toBeGreaterThan(0)
  for (const s of hidden.slice(0, 3)) {
    const el = page.getByRole("group", { name: s.name, exact: true })
    await expect.poll(() => tipLines(page, el), { message: s.name }).toContain("-8.0 dB")
  }
})

