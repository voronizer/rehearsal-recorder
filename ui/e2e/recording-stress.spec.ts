import {
  drawnLate,
  expect,
  fitted,
  openApp,
  openBandApp,
  scaled,
  setFake,
  settled,
  startRehearsal,
  test,
  tileNames,
  tipLines,
  watchDrawn,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The recording stress data (stress-recording.js): the screen as the longest
// names and the most tracks the band has make it, read from here by the
// recording screen's own tests. A fixture whose own test fails on any error in
// the page, so that what it lays over the rehearsal stress band is checked here
// once, and the tests built on it can rely on it.

test("the recording stress data opens on take 33 with eight tiles", async ({ page }) => {
  await openApp(page, { stress: "recording" })
  // The second take of the longest song name, take 33 of the evening,
  // recording. Read whole: drawn, it is cut after two lines.
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Kalychanka (slow version for the wedding, with the long intro the bride asked for) #2"
  )
  await expect(page.getByText("Take 33", { exact: true })).toBeVisible()
  await expect(page.getByText("Recording", { exact: true })).toBeVisible()
  // Seven tracks that take sound and the Nord, on MIDI alone.
  const tiles = page.locator("main [role=group]")
  await expect(tiles).toHaveCount(8)
  // Somebody plays the Nord: its tile counts notes.
  const nord = page.getByRole("group", { name: "Keys (Nord Stage 3 MIDI)" })
  await expect(nord).toBeVisible()
  await expect(nord).toContainText(/[1-9][\d,]* notes?/)
  // Guitar clips three times in the first seconds, Percussion is silent.
  await expect(page.getByRole("group", { name: "Guitar", exact: true })).toContainText("clipped 3×")
  await expect(page.getByRole("group", { name: "Percussion" })).toContainText("silent")
  // The disk has 5 min left.
  await expect(
    page.getByText("Low disk space: room for about 5 min. Free some up or finish the rehearsal.", {
      exact: true,
    })
  ).toBeVisible()
})

// A tile's name (Q2, «В две строки и мельче»): up to two lines at 2.25rem; a
// name still too long gets smaller, down to 1.5rem, and past that it is cut
// and whole in the tile's tooltip. Short names keep 2.25rem. Sizes are read
// from the name as drawn, within 1 px: the container draws in Inter, a Mac or
// Windows in its own font.

const HANNA = "Lead and backing vocals (Hanna)"
const NORD = "Keys (Nord Stage 3 MIDI)"

type Want = { px: number | [number, number]; lines?: 1 | 2; cut?: true }

/** Every tile's name held against `want`, as one comparison that shows every
 *  name that is not as it should be: a size within 1 px of the one wanted,
 *  or strictly between the two, reads as the one wanted; the lines are read
 *  where they are wanted; and a name is whole unless it is to be cut. */
async function namesAgainst(page: Page, want: Record<string, Want>) {
  const seen = Object.fromEntries((await tileNames(page)).map((n) => [n.name, n]))
  const keys = [...new Set([...Object.keys(want), ...Object.keys(seen)])]
  const fits = (px: number, w: Want["px"]) =>
    typeof w === "number" ? Math.abs(px - w) <= 1 : px > w[0] && px < w[1]
  const read = (name: string) => {
    const n = seen[name]
    const w = want[name]
    if (!n) return "not drawn"
    if (!w) return "not wanted"
    return {
      px: fits(n.px, w.px) ? w.px : n.px,
      ...(w.lines ? { lines: n.lines } : {}),
      ...(n.cut ? { cut: true } : n.whole ? {} : { overflows: true }),
    }
  }
  return {
    seen: Object.fromEntries(keys.map((k) => [k, read(k)])),
    wanted: Object.fromEntries(keys.map((k) => [k, want[k] ?? "not drawn"])),
  }
}

test("long names fit on two lines and get smaller at 1180x820", async ({ page }) => {
  await openApp(page, { stress: "recording" })
  await fitted(page, { width: 1180, height: 820 })
  const { seen, wanted } = await namesAgainst(page, {
    // Too long for two lines even at 1.5rem: cut, and whole in the tooltip.
    [HANNA]: { px: 24, lines: 2, cut: true },
    // Smaller, whole on two lines. How much smaller depends on the font:
    // 24 px with one, 25.3 with the Linux CI machine's.
    [NORD]: { px: [23, 36], lines: 2 },
    // Smaller, on one line, and not as small as it may get.
    Percussion: { px: [24, 36], lines: 1 },
    "Second guitar": { px: 36, lines: 2 },
    Drums: { px: 36 },
    Bass: { px: 36 },
    Guitar: { px: 36 },
    Keys: { px: 36 },
  })
  expect(seen).toEqual(wanted)
})

test("only Hanna is cut at 960x680", async ({ page }) => {
  await openApp(page, { stress: "recording" })
  await fitted(page, { width: 960, height: 680 })
  const seen = await tileNames(page)
  expect(seen).toHaveLength(8)
  expect(seen.filter((n) => n.cut).map((n) => n.name), "cut").toEqual([HANNA])
  expect(
    seen.filter((n) => n.name !== HANNA && !n.whole).map((n) => n.name),
    "not whole"
  ).toEqual([])
  // None under 1.5rem, within 1 px.
  expect(
    seen.filter((n) => n.px < 23).map((n) => `${n.name} ${n.px}`),
    "under 24 px"
  ).toEqual([])
})

test("a cut name is whole in the tooltip on hover", async ({ page }) => {
  await openApp(page, { stress: "recording" })
  await fitted(page, { width: 960, height: 680 })
  const hanna = page.getByRole("group", { name: HANNA })
  await expect(hanna.locator("[data-name]")).toHaveAttribute("data-cut")
  await expect(hanna.locator("[data-name]")).toHaveText(/…$/)
  expect(await tipLines(page, hanna)).toContain(HANNA)
  // A name drawn whole is not said again.
  expect(await tipLines(page, page.getByRole("group", { name: "Bass" }))).not.toContain("Bass")
})

test("the input line gives way to a second line and the tooltip says it", async ({ page }) => {
  await openApp(page, { stress: "recording" })
  await page.setViewportSize({ width: 1180, height: 680 })
  // The input line stands beside the name on a tile 7rem wide or more. A
  // name on two lines at 2.25rem needs its width there only on a tile just
  // that wide, a pixel or two of window: so the tiles are held at 7rem, the
  // narrowest that has room for the line.
  await page.addStyleTag({ content: "main [role=group] { width: 7rem !important; }" })
  await fitted(page)
  // The levels tiles whose input line has given way to their name, and what
  // the line said.
  const gone = await page.evaluate(() =>
    [...document.querySelectorAll("main [role=group]")].flatMap((t) => {
      const line = t.querySelector("[data-side-line]")
      const shows = line?.parentElement && getComputedStyle(line.parentElement).display !== "none"
      return t.querySelector("[data-levels]") && shows && getComputedStyle(line).display === "none"
        ? [{ name: t.getAttribute("aria-label") ?? "", input: line.textContent ?? "" }]
        : []
    })
  )
  expect(gone.length, "input lines gone").toBeGreaterThan(0)
  for (const { name, input } of gone) {
    const tile = page.getByRole("group", { name, exact: true })
    await expect(tile.locator("[data-name]"), name).toHaveAttribute("data-lines", "2")
    expect(input, name).toMatch(/^Inputs? \d/)
    expect(await tipLines(page, tile), name).toContain(input)
  }
  // A name on one line keeps its input line, and the tooltip does not say
  // it again.
  const bass = page.getByRole("group", { name: "Bass" })
  await expect(bass.locator("[data-side-line]")).toBeVisible()
  expect(await tipLines(page, bass)).not.toContain(await bass.locator("[data-side-line]").textContent())
})

/** Every tile's name as fitted, in the page: its size, its lines, whether it
 *  is cut, and its words. Null until the recording screen's tiles are
 *  drawn. */
const NAMES = `(() => {
  const names = [...document.querySelectorAll("main [data-tiles] [data-name]")];
  return names.length
    ? JSON.stringify(names.map((el) => [el.getAttribute("data-name-px"), el.getAttribute("data-lines"), el.hasAttribute("data-cut"), el.textContent]))
    : null;
})()`

for (const [where, size, before] of [
  // The clock's cap for 10:00:00 makes the tiles taller than the window's
  // height alone would.
  ["960x820", { width: 960, height: 820 }, ""],
  // The tiles give way down to 6rem.
  ["960x680 at 150 percent", { width: 960, height: 680 }, scaled(1.5)],
] as const) {
  test(`the tiles' names are fitted before the screen is first drawn, in ${where}`, async ({
    page,
  }) => {
    // Each name is first fitted to its tile before the screen's own fit
    // (Recording's) has moved the tiles; fitted again only after a frame was
    // drawn, the band would see the names change size as the take starts.
    await page.setViewportSize(size)
    await page.addInitScript(watchDrawn(NAMES))
    await openApp(page, { stress: "recording", before })
    await fitted(page)
    const { last, late } = await drawnLate(page)
    expect(JSON.parse(last ?? "[]"), "the names").toHaveLength(8)
    expect(late, "names fitted after a frame was drawn").toEqual([])
  })
}

/** Guitar, Percussion and Hanna as the test plays them, over the stress
 *  data's own: all three at a fair level until the test sets
 *  window.__PLAYED__ otherwise. */
const PLAYED = `{
  const api = window.pywebview.api;
  const read = api.get_levels;
  window.__PLAYED__ = {Guitar: [0.3], Percussion: [0.3], ${JSON.stringify(HANNA)}: [0.3]};
  api.get_levels = async () => ({...(await read()), ...window.__PLAYED__});
}`

test("a name does not change when a clip or a silence comes", async ({ page }) => {
  await openApp(page, { stress: "recording", after: PLAYED })
  const guitar = page.getByRole("group", { name: "Guitar", exact: true })
  const percussion = page.getByRole("group", { name: "Percussion" })
  // Hanna's name is cut: a clip on that tile changes nothing in it either.
  const hanna = page.getByRole("group", { name: HANNA })
  /** Every name's size, lines, cut and box, by its track. */
  const drawn = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main [role=group]")].map((t) => {
        const el = t.querySelector("[data-name]")!
        const r = el.getBoundingClientRect()
        return {
          name: t.getAttribute("aria-label"),
          px: el.getAttribute("data-name-px"),
          lines: el.getAttribute("data-lines"),
          cut: el.getAttribute("data-cut"),
          box: [r.x, r.y, r.width, r.height],
        }
      })
    )
  type Drawn = Awaited<ReturnType<typeof drawn>>
  /** `now` as `was`, with a box within 0.5 px of the one it had read as
   *  "same". */
  const against = (now: Drawn, was: Drawn) =>
    now.map((n, i) => ({
      ...n,
      box: was[i] && n.box.every((v, j) => Math.abs(v - was[i].box[j]) <= 0.5) ? "same" : n.box,
    }))
  // At 1180x680 the tiles are wide enough to show their status line, and
  // short enough that a long name's size is set by their height. It comes
  // last, so that the clip and the silence come in it, with no resize
  // between the two reads.
  const windows = [
    [1180, 820],
    [960, 680],
    [1180, 680],
  ] as const
  const before: Record<string, Drawn> = {}
  for (const [width, height] of windows) {
    await fitted(page, { width, height })
    before[`${width}x${height}`] = await drawn()
  }
  // Fitted, every one: a name with no size or lines to compare has no jump
  // to show either.
  expect(
    Object.values(before)
      .flat()
      .filter((n) => !n.px || !n.lines)
      .map((n) => n.name),
    "names not fitted"
  ).toEqual([])
  await expect(guitar).not.toHaveAttribute("data-clipped")
  await expect(percussion).not.toHaveAttribute("data-silent")
  await expect(hanna).not.toHaveAttribute("data-clipped")
  await expect(hanna.locator("[data-name]")).toHaveAttribute("data-cut")

  await setFake(page, "__PLAYED__", { Guitar: [0.995], Percussion: [0.0005], [HANNA]: [0.995] })
  await expect(guitar).toHaveAttribute("data-clipped")
  await expect(percussion).toHaveAttribute("data-silent")
  await expect(hanna).toHaveAttribute("data-clipped")
  for (const [width, height] of [...windows].reverse()) {
    await fitted(page, { width, height })
    const was = before[`${width}x${height}`]
    expect(against(await drawn(), was), `at ${width}x${height}`).toEqual(
      was.map((n) => ({ ...n, box: "same" }))
    )
  }
})

test("the band's names are whole at 960x680", async ({ page }) => {
  // The band's take of Viasna, its second tonight, with the bar against the
  // first under the clock.
  await openBandApp(page)
  await startRehearsal(page, 6)
  await page.locator("#next-take-name").fill("Viasna")
  await page.getByRole("button", { name: /Record take 6/ }).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Viasna #2")
  await fitted(page, { width: 960, height: 680 })
  const seen = await tileNames(page)
  expect(seen.map((n) => n.name)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
  expect(
    seen.filter((n) => !n.whole).map((n) => n.name),
    "not whole"
  ).toEqual([])
  // 35 px, within 1 px.
  expect(seen.find((n) => n.name === "Vocals")?.px ?? 0).toBeGreaterThanOrEqual(34)
})

// What gives way in a window too short for everything (the plan's calls): the
// clock and the take's name first, down to the clock's 3rem; then the tiles,
// from their 12.5rem down to 6rem; only then does the page scroll.

/** The clock's size, how many tiles there are and their heights, and
 *  whether the screen scrolls. */
const giveWay = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector("main")!
    const tiles = [...document.querySelectorAll("main [data-tiles] [role=group]")].map(
      (t) => t.getBoundingClientRect().height
    )
    const stop = [...document.querySelectorAll("footer button")]
      .find((b) => b.textContent?.startsWith("Stop"))!
      .getBoundingClientRect()
    return {
      clock: parseFloat(getComputedStyle(document.querySelector("[role=timer]")!).fontSize),
      // With none, the least and the most of them would be ±Infinity, and
      // pass whatever they are held against.
      count: tiles.length,
      lowest: Math.min(...tiles),
      highest: Math.max(...tiles),
      down: main.scrollHeight > main.clientHeight + 1,
      mainSideways: main.scrollWidth > main.clientWidth + 1,
      pageSideways: document.documentElement.scrollWidth > window.innerWidth,
      stopInView: stop.top >= 0 && stop.bottom <= window.innerHeight,
    }
  })

test("in a short window the clock gives way before the tiles", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, { stress: "recording" })
  await settled(page)
  const seen = await giveWay(page)
  expect(seen.count, "the tiles").toBe(8)
  // The tiles keep their 12.5rem; the clock is smaller than the window's
  // 19vh would make it, and no smaller than its 3rem.
  expect(seen.lowest, "the tiles").toBeGreaterThanOrEqual(200 - 0.5)
  expect(seen.clock, "the clock").toBeLessThan(129)
  expect(seen.clock, "the clock").toBeGreaterThanOrEqual(48)
  expect(seen.down, "the screen scrolls").toBe(false)
})

test("at 150 percent in 960x680 the tiles give way after the clock", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, { stress: "recording", before: scaled(1.5) })
  await settled(page)
  const seen = await giveWay(page)
  expect(seen.count, "the tiles").toBe(8)
  // The clock at its 3rem, and the tiles between 6rem and 12.5rem.
  expect(Math.abs(seen.clock - 72), `the clock at ${seen.clock}px`).toBeLessThanOrEqual(1)
  expect(seen.lowest, "the tiles").toBeGreaterThanOrEqual(144 - 0.5)
  expect(seen.highest, "the tiles").toBeLessThanOrEqual(300 + 0.5)
  expect(seen.mainSideways, "the screen scrolls sideways").toBe(false)
  expect(seen.pageSideways, "the page scrolls sideways").toBe(false)
  if (seen.down) expect(seen.stopInView, "Stop, with the screen scrolling").toBe(true)
})

test("tab reaches only stop", async ({ page }) => {
  await openApp(page, { stress: "recording" })
  await settled(page)
  // From the page's start: nothing has been pressed or focused since it
  // loaded (the fixture presses Record from a script, which moves no focus).
  expect(await page.evaluate(() => document.activeElement === document.body), "on the page").toBe(true)
  const stop = page.getByRole("button", { name: /^Stop/ })
  const on = () =>
    stop.evaluate((el) =>
      document.activeElement === el ? "Stop" : document.activeElement === document.body ? "the page" : "else"
    )
  await page.keyboard.press("Tab")
  expect(await on(), "the first Tab").toBe("Stop")
  await page.keyboard.press("Tab")
  // Off the page, or round to Stop again: nothing else.
  expect(["Stop", "the page"], "the second Tab").toContain(await on())
})
