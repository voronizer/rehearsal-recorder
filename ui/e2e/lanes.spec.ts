import {
  colour,
  expect,
  expectedError,
  hold,
  letGo,
  mixed,
  openApp,
  openBandApp,
  problemBar,
  recordTake,
  scaled,
  settled,
  startRehearsal,
  style,
  test,
  themed,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// The player's track lanes (spec C6): 56 px, M and S at 20, and the master
// holding the window's bottom edge. M and S are after the fader, on its row
// (owner, 2026-10-12, Q3), so the name has the plate's whole width. The lanes
// are one group on the card's fill with no line between them, each picture on
// a well of its own, a Both track's audio and notes sharing one under a 1 px
// line; the master is its own group under them (owner, 2026-10-12, "Lanes as
// one group" and "Lanes apart").

const NAMES = ["Drums", "Bass", "Guitar", "Vocals", "Keys", "Horns", "Room", "Talkback"]

/** A take of `n` audio tracks: the fake's own has two, so its answer to
 *  stop_take is widened to the band's first `n`. */
const band = (n: number, stereo = "") => ({
  before: `window.__STEREO_TRACKS__ = ${JSON.stringify(stereo ? [stereo] : [])};`,
  after: `
    const real = window.pywebview.api.stop_take;
    window.pywebview.api.stop_take = async (...args) => ({
      ...(await real(...args)),
      tracks: ${JSON.stringify(NAMES.slice(0, n))}.map((name) => ({name, file: '/rec/' + name + '.wav'})),
    });`,
})

/** The drummer on Both, a guitar, and a keyboard on MIDI alone. */
const BOTH = {
  before: `
    window.__SESSION_TRACKS__ = [
      {name: 'Drums', channel: 1, icon: 'drums', mode: 'both', midi_port: {name: 'TD-17'}},
      {name: 'Gtr', channel: 2, icon: 'guitar-electric', mode: 'audio'},
      {name: 'Keys', channel: null, icon: 'keys', mode: 'midi', midi_port: {name: 'Launchkey Mini MK3'}},
    ];
    window.__BAND_ICONS__ = {Drums: 'drums', Gtr: 'guitar-electric', Keys: 'keys'};`,
}

/** The first take of a band up for review. */
async function review(page: Page, setup: { before?: string; after?: string }, theme = "") {
  await openApp(page, { before: theme + (setup.before ?? ""), after: setup.after })
  await startRehearsal(page)
  await recordTake(page, 1)
  await expect(page.getByRole("button", { name: /^Mute / }).first()).toBeVisible()
}

const plate = (page: Page, name: string) => page.locator(`[data-plate='${name}']`)
/** The waveform's own box, which is what is drawn, on its well. */
const lane = (page: Page, name: string) => page.locator(`[data-lane='${name}'] > div`)
/** The waveform's cell: the lane, as tall as its plate, the well's 3 px
 *  round the waveform in it. */
const cell = (page: Page, name: string) => page.locator(`[data-lane='${name}']`)
const notesPlate = (page: Page, name: string) => page.locator(`[data-notes-plate='${name}']`)
const notesLane = (page: Page, name: string) => page.locator(`[data-notes-lane='${name}']`)
/** The one group every track's lane is a row of. */
const group = (page: Page) => page.locator("[data-lanes]")
/** The row a lane's picture or plate is in. */
const rowOf = (el: Locator) => el.locator("xpath=ancestor::*[@data-lane-row][1]")
/** The master's strip, where the page's own scroll holds it. */
const strip = (page: Page) =>
  page.getByRole("slider", { name: "Master volume" }).locator("xpath=ancestor::div[contains(@class, 'sticky')][1]")
const masterBand = (page: Page) => page.locator("[data-master-band]")
/** The master's plate in its band under the lanes: the playback volume's
 *  popover draws the same plate while it is open. */
const masterPlate = (page: Page) => masterBand(page).locator("[data-master-plate]")
/** The master's group in its band: its plate and its click's lane on the
 *  card's fill, as a track's row is in the lanes group. */
const masterGroup = (page: Page) => masterBand(page).locator("[data-master-group]")
/** Whether the master's plate is anywhere in the lanes group. */
const masterInLanes = (page: Page) => masterPlate(page).evaluate((e) => e.closest("[data-lanes]") !== null)
const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })
const clock = (page: Page) => page.getByRole("group", { name: "Timeline clock" })

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, "on screen").not.toBeNull()
  return b!
}

/** A few frames: a waveform draws its canvas again on the frame after its
 *  box changes, and a canvas that grew its row would show by then. */
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let left = 4
        const next = () => (--left > 0 ? requestAnimationFrame(next) : done())
        requestAnimationFrame(next)
      })
  )

/** Each row of the lanes group, top to bottom: where it is, and where its
 *  picture (a waveform, or a lane of notes) is and how it is drawn. */
function rowsOf(page: Page) {
  return page.locator("[data-lane-row]").evaluateAll((rows) =>
    rows.map((row) => {
      const r = row.getBoundingClientRect()
      const pic = row.querySelector("[data-lane] > div, [data-notes-lane]")!
      const p = pic.getBoundingClientRect()
      const cs = getComputedStyle(pic)
      return {
        name: `${row.getAttribute("data-lane-row")}${row.hasAttribute("data-paired") ? " (notes)" : ""}`,
        paired: row.hasAttribute("data-paired"),
        top: r.top,
        bottom: r.bottom,
        line: getComputedStyle(row).borderTopWidth,
        picTop: p.top,
        picBottom: p.bottom,
        fill: cs.backgroundColor,
        split: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        corners: [
          cs.borderTopLeftRadius,
          cs.borderTopRightRadius,
          cs.borderBottomRightRadius,
          cs.borderBottomLeftRadius,
        ].join(" "),
      }
    })
  )
}

/**
 * The rows touch, with no line between them, and every picture is on its
 * well: the well's colour with 8 px corners, 3 px of the group's fill above
 * and below it. A Both track's audio and its notes (the row after, with
 * data-paired) are one well: nothing pads them apart, their corners where they
 * meet are square, and the notes are under a 1 px line in the border colour.
 */
async function expectWells(page: Page) {
  const rows = await rowsOf(page)
  const well = await colour(page, "--well")
  const line = await colour(page, "--border")
  expect(rows.length, "rows in the group").toBeGreaterThan(0)
  rows.forEach((row, i) => {
    const above = row.paired
    const below = rows[i + 1]?.paired === true
    expect(row.line, `no line over ${row.name}`).toBe("0px")
    if (i > 0)
      expect(Math.abs(row.top - rows[i - 1].bottom), `${row.name} starts where the row above ends`).toBeLessThan(0.5)
    expect(row.fill, `${row.name}'s well`).toBe(well)
    expect(row.picTop - row.top, `the fill over ${row.name}'s picture`).toBeCloseTo(above ? 0 : 3, 0)
    expect(row.bottom - row.picBottom, `the fill under ${row.name}'s picture`).toBeCloseTo(below ? 0 : 3, 0)
    expect(row.corners, `${row.name}'s corners`).toBe(
      above ? "0px 0px 8px 8px" : below ? "8px 8px 0px 0px" : "8px 8px 8px 8px"
    )
    if (above) {
      expect(row.split, `the line over ${row.name}`).toBe(`1px solid ${line}`)
      expect(Math.abs(row.picTop - rows[i - 1].picBottom), `${row.name} touches its audio`).toBeLessThan(0.5)
    } else expect(row.split.split(" ")[0], `no line over ${row.name}'s picture`).toBe("0px")
  })
}

/** How far the strip's lower edge is above the page's (the bottom of the
 *  scrolling area, which is the window's above a footer). */
async function above(page: Page) {
  const main = await box(page.locator("main"))
  const b = await box(strip(page))
  return main.y + main.height - (b.y + b.height)
}

/** The points across the master's band, every 20 px, where something of the
 *  lanes shows instead of the band: the group, or the surface the loop band
 *  and the marks are drawn on over it. */
function showingThrough(page: Page) {
  return masterBand(page).evaluate((band) => {
    const b = band.getBoundingClientRect()
    const lanes = document.querySelector("[data-lanes]")!
    const surface = document.querySelector("[aria-label='Take timeline']")!
    const across = (from: number, to: number) => {
      const at: number[] = []
      for (let v = from + 1; v < to - 1; v += 20) at.push(v)
      return [...at, to - 1]
    }
    const seen: string[] = []
    for (const x of across(b.left, b.right))
      for (const y of across(b.top, b.bottom)) {
        const hit = document.elementFromPoint(x, y)
        if (hit && (lanes.contains(hit) || surface.contains(hit))) seen.push(`${Math.round(x)},${Math.round(y)}`)
      }
    return seen
  })
}

const HANNA = "Lead and backing vocals (Hanna)"

/** The rehearsal stress band's take 2, up in the player: eight tracks, the
 *  drummer on Both, a keyboard on MIDI alone, and a name that is too long for
 *  its plate (Hanna's). `held` runs once the rehearsal is up, before the take
 *  is opened. Returns when the take was asked for, in ms. */
async function openTake2(page: Page, held?: () => Promise<void>) {
  await openBandApp(page, { stress: "rehearsal" })
  await startRehearsal(page, 33)
  await held?.()
  const since = Date.now()
  await page.locator('[data-take="2"]').getByRole("button", { name: /^Take 2 / }).click()
  await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
  return since
}

/** The middle of a box, down the page. */
const middle = (b: { y: number; height: number }) => b.y + b.height / 2

/** The pixel the screen shows at a point of the window, as [r, g, b]. */
async function pixelAt(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d")!
    ctx.drawImage(img, 0, 0)
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }, png.toString("base64"))
}

/** A CSS colour as the [r, g, b] a screen shows for it. */
const rgbOf = (page: Page, css: string) =>
  page.evaluate((c) => {
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d")!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }, css)

test.describe("track lanes", () => {
  test("every audio lane and its plate are 56 px tall", async ({ page }) => {
    await review(page, band(4))
    for (const name of NAMES.slice(0, 4)) {
      expect((await box(plate(page, name))).height).toBeCloseTo(56, 0)
      expect((await box(cell(page, name))).height).toBeCloseTo(56, 0)
    }
    // The master's plate is a lane's height.
    expect((await box(masterPlate(page))).height).toBeCloseTo(56, 0)
    // And no taller in a tall window: the extra room stays empty.
    await page.setViewportSize({ width: 1180, height: 1400 })
    for (const name of NAMES.slice(0, 4)) {
      expect((await box(plate(page, name))).height).toBeCloseTo(56, 0)
      expect((await box(cell(page, name))).height).toBeCloseTo(56, 0)
    }
  })

  test("M and S are 20 by 20 and 6 px apart", async ({ page }) => {
    await review(page, band(4))
    for (const name of NAMES.slice(0, 4)) {
      const m = await box(plate(page, name).getByRole("button", { name: `Mute ${name}` }))
      const s = await box(plate(page, name).getByRole("button", { name: `Solo ${name}` }))
      expect([m.width, m.height, s.width, s.height]).toEqual([20, 20, 20, 20])
      expect(s.x - (m.x + m.width)).toBeCloseTo(6, 0)
      expect(Math.abs(s.y - m.y)).toBeLessThan(1)
    }
    const m = plate(page, "Drums").getByRole("button", { name: "Mute Drums" })
    expect(await style(m, "font-size", "border-top-left-radius")).toEqual({
      "font-size": "12px",
      "border-top-left-radius": "4px",
    })
  })

  // Everything on a plate is rem, so a lane is too: at 150 % a 56 px row would
  // leave the fader on top of M and S, and at 130 % squeeze it to nothing.
  for (const scale of [0.9, 1.15, 1.3, 1.5]) {
    test(`at the Appearance scale ${scale} a lane grows with it and a plate holds all it has`, async ({
      page,
    }) => {
      await review(page, band(4), scaled(scale))
      const rem = 16 * scale
      expect(
        parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
      ).toBeCloseTo(rem, 1)
      for (const name of NAMES.slice(0, 4)) {
        const p = plate(page, name)
        const at = await box(p)
        // 3.5rem: 56 px at the scale of 1. The well's 3 px above and below
        // the waveform are not rem.
        expect(at.height).toBeCloseTo(3.5 * rem, 0)
        expect((await box(cell(page, name))).height).toBeCloseTo(3.5 * rem, 0)
        expect((await box(lane(page, name))).height).toBeCloseTo(3.5 * rem - 6, 0)
        expect(await p.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(0)
        // The fader keeps its 1rem, whole and inside the plate, with its name
        // above it; M and S are beside it, on its row, not over it.
        const fader = await box(page.getByRole("meter", { name: `${name} level` }).locator("xpath=.."))
        expect(fader.height).toBeCloseTo(rem, 0)
        expect(fader.y + fader.height).toBeLessThanOrEqual(at.y + at.height + 0.5)
        const title = await box(p.locator("[data-plate-name]"))
        expect(title.y + title.height).toBeLessThanOrEqual(fader.y + 0.5)
        expect(title.y).toBeGreaterThanOrEqual(at.y - 0.5)
        for (const label of ["Mute", "Solo"]) {
          const b = await box(p.getByRole("button", { name: `${label} ${name}` }))
          expect(b.height).toBeCloseTo(1.25 * rem, 0)
          expect(b.x).toBeGreaterThanOrEqual(fader.x + fader.width - 0.5)
          expect(Math.abs(middle(b) - middle(fader))).toBeLessThan(1)
          expect(b.y + b.height).toBeLessThanOrEqual(at.y + at.height + 0.5)
          expect(b.y).toBeGreaterThanOrEqual(title.y + title.height - 0.5)
        }
      }
      // The master is a lane's height as well.
      expect((await box(masterPlate(page))).height).toBeCloseTo(3.5 * rem, 0)
    })
  }

  // Six drum rows named in rem (0.875rem each), the lane's own 3 px above and
  // below them, the 1 px line it shares its audio's well under, and the
  // well's 3 px below it: 94 at the scale of 1.
  for (const scale of [0.9, 1, 1.15, 1.3, 1.5]) {
    test(`at the Appearance scale ${scale} the notes plate keeps its text and its drum rows are named`, async ({
      page,
    }) => {
      await review(page, BOTH, scaled(scale))
      await settled(page)
      const midi = notesPlate(page, "Drums")
      const at = await box(midi)
      // At least what six named rows need, which is with the scale; the
      // 10 px are not.
      expect(at.height).toBeGreaterThanOrEqual(84 * scale + 10 - 0.5)
      if (scale === 1) expect(at.height).toBeGreaterThanOrEqual(94 - 0.5)
      expect(await midi.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(0)
      await expect(notesLane(page, "Drums").getByText("Kick", { exact: true })).toBeVisible()
      // Its lane is the plate less the well's 3 px under it.
      expect((await box(notesLane(page, "Drums"))).height).toBeCloseTo(at.height - 3, 0)
      // The audio row above it is 3.5rem.
      expect((await box(plate(page, "Drums"))).height).toBeCloseTo(3.5 * 16 * scale, 0)
    })
  }

  // A MIDI-only track's notes are on a well of their own: the six rows' rem,
  // the lane's own 3 px above and below them, and the well's 3 px above and
  // below the lane: 96 at the scale of 1.
  for (const scale of [0.9, 1.3, 1.5]) {
    test(`at the Appearance scale ${scale} a MIDI-only notes plate keeps its text and its lane its well`, async ({
      page,
    }) => {
      await review(page, BOTH, scaled(scale))
      await settled(page)
      const keys = notesPlate(page, "Keys")
      const at = await box(keys)
      // At least what six named rows need, which is with the scale; the
      // 12 px are not.
      expect(at.height).toBeGreaterThanOrEqual(84 * scale + 12 - 0.5)
      expect(await keys.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(0)
      // Its lane is the plate less the well's 3 px above and below it, and
      // its octaves are named.
      const notes = await box(notesLane(page, "Keys"))
      expect(notes.y - at.y).toBeCloseTo(3, 0)
      expect(notes.height).toBeCloseTo(at.height - 6, 0)
      await expect(notesLane(page, "Keys").getByText(/^C\d$/).first()).toBeVisible()
    })
  }

  for (const theme of ["dark", "light"] as const) {
    test(`the lanes are one group with the card's fill and no frame, in the ${theme} theme`, async ({
      page,
    }) => {
      await review(page, band(4), themed(theme))
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
        theme === "dark"
      )
      const card = await colour(page, "--card")
      const well = await colour(page, "--well")
      await expect(group(page)).toHaveCount(1)
      expect(
        await style(
          group(page),
          "background-color",
          "border-top-width",
          "border-right-width",
          "border-bottom-width",
          "border-left-width",
          "border-top-left-radius",
          "border-top-right-radius",
          "border-bottom-right-radius",
          "border-bottom-left-radius"
        )
      ).toEqual({
        "background-color": card,
        "border-top-width": "0px",
        "border-right-width": "0px",
        "border-bottom-width": "0px",
        "border-left-width": "0px",
        "border-top-left-radius": "12px",
        "border-top-right-radius": "12px",
        "border-bottom-right-radius": "12px",
        "border-bottom-left-radius": "12px",
      })
      // Every track's plate is in it, on its fill: no fill, corners or
      // frame of its own.
      await expect(group(page).locator("[data-plate]")).toHaveCount(4)
      const plates = await page.locator("[data-plate], [data-notes-plate]").all()
      expect(plates).toHaveLength(4)
      for (const el of plates)
        expect(await style(el, "background-color", "border-top-left-radius", "border-top-width")).toEqual({
          "background-color": "rgba(0, 0, 0, 0)",
          "border-top-left-radius": "0px",
          "border-top-width": "0px",
        })
      // Each picture is on its well: the well's colour, 8 px corners
      // (band(4) has no Both track).
      const pictures = await page.locator("[data-lane] > div, [data-notes-lane]").all()
      expect(pictures).toHaveLength(4)
      for (const el of pictures)
        expect(
          await style(
            el,
            "background-color",
            "border-top-left-radius",
            "border-top-right-radius",
            "border-bottom-right-radius",
            "border-bottom-left-radius"
          )
        ).toEqual({
          "background-color": well,
          "border-top-left-radius": "8px",
          "border-top-right-radius": "8px",
          "border-bottom-right-radius": "8px",
          "border-bottom-left-radius": "8px",
        })
      // The master is not in it: a group of its own on the card's fill, its
      // plate in it with no fill of its own, as a track's plate is.
      await expect(masterPlate(page)).toHaveCount(1)
      expect(await masterInLanes(page)).toBe(false)
      expect(await style(masterGroup(page), "border-top-width", "background-color")).toEqual({
        "border-top-width": "0px",
        "background-color": card,
      })
      expect(await style(masterPlate(page), "border-top-width", "background-color")).toEqual({
        "border-top-width": "0px",
        "background-color": "rgba(0, 0, 0, 0)",
      })
    })
  }

  test("the lanes touch with no line between them, and each waveform sits on its well 3 px in", async ({
    page,
  }) => {
    await review(page, band(4))
    await settled(page)
    await expectWells(page)
    // A lane is 56 px and its waveform 50, whatever the window did: a canvas
    // drawn at one size must not hold its row at that size.
    const sizes = async (at: string) => {
      for (const name of NAMES.slice(0, 4)) {
        const c = await box(cell(page, name))
        const w = await box(lane(page, name))
        expect(c.height, `${name}'s lane ${at}`).toBeCloseTo(56, 0)
        expect(w.height, `${name}'s waveform ${at}`).toBeCloseTo(50, 0)
        expect(w.y - c.y, `the well over ${name}'s waveform ${at}`).toBeCloseTo(3, 0)
        expect(c.y + c.height - (w.y + w.height), `the well under ${name}'s waveform ${at}`).toBeCloseTo(3, 0)
      }
    }
    await sizes("at 1180 by 820")
    await page.setViewportSize({ width: 960, height: 680 })
    await frames(page)
    await sizes("at 960 by 680")
    await page.setViewportSize({ width: 1180, height: 820 })
    await frames(page)
    await sizes("back at 1180 by 820")
    await expectWells(page)
  })

  test("the plate has no Mono or Stereo line, whatever the file", async ({ page }) => {
    await review(page, band(2, "Bass"))
    for (const name of ["Drums", "Bass"]) {
      await expect(plate(page, name)).not.toContainText("Mono")
      await expect(plate(page, name)).not.toContainText("Stereo")
    }
    // The meter still says it: two bars for a stereo file.
    const fills = (name: string) =>
      page.getByRole("meter", { name: `${name} level` }).locator("[data-fill]")
    await expect(fills("Drums")).toHaveCount(1)
    await expect(fills("Bass")).toHaveCount(2)
  })

  for (const theme of ["dark", "light"] as const) {
    test(`a Both track's audio and notes share one well split by a 1 px line, in the ${theme} theme`, async ({
      page,
    }) => {
      await review(page, BOTH, themed(theme))
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
        theme === "dark"
      )
      await settled(page)
      const line = await colour(page, "--border")
      const well = await colour(page, "--well")
      const wave = lane(page, "Drums")
      const notes = notesLane(page, "Drums")
      const audioRow = await box(rowOf(wave))
      const notesRow = page.locator("[data-lane-row='Drums'][data-paired]")
      await expect(notesRow).toHaveCount(1)
      const w = await box(wave)
      const n = await box(notes)
      const nr = await box(notesRow)
      // The waveform: on the well, 3 px under its row's top and down to its
      // row's foot, with square lower corners.
      expect(w.y - audioRow.y).toBeCloseTo(3, 0)
      expect(Math.abs(audioRow.y + audioRow.height - (w.y + w.height))).toBeLessThan(0.5)
      expect(
        await style(
          wave,
          "background-color",
          "border-top-left-radius",
          "border-top-right-radius",
          "border-bottom-right-radius",
          "border-bottom-left-radius",
          "border-bottom-width"
        )
      ).toEqual({
        "background-color": well,
        "border-top-left-radius": "8px",
        "border-top-right-radius": "8px",
        "border-bottom-right-radius": "0px",
        "border-bottom-left-radius": "0px",
        "border-bottom-width": "0px",
      })
      // Its notes: the same well, from where the waveform ends, under a 1 px
      // line in the border colour, with square upper corners, to 3 px above
      // their row's foot.
      expect(Math.abs(n.y - (w.y + w.height))).toBeLessThan(0.5)
      expect(
        await style(
          notes,
          "background-color",
          "border-top-width",
          "border-top-style",
          "border-top-color",
          "border-top-left-radius",
          "border-top-right-radius",
          "border-bottom-right-radius",
          "border-bottom-left-radius"
        )
      ).toEqual({
        "background-color": well,
        "border-top-width": "1px",
        "border-top-style": "solid",
        "border-top-color": line,
        "border-top-left-radius": "0px",
        "border-top-right-radius": "0px",
        "border-bottom-right-radius": "8px",
        "border-bottom-left-radius": "8px",
      })
      expect(nr.y + nr.height - (n.y + n.height)).toBeCloseTo(3, 0)
      // The next track's well is 3 px under its row's top: 6 px of the group's
      // fill between the two wells.
      const g = await box(lane(page, "Gtr"))
      expect(g.y - (await box(rowOf(lane(page, "Gtr")))).y).toBeCloseTo(3, 0)
      expect(g.y - (n.y + n.height)).toBeCloseTo(6, 0)
      // The plates beside them touch, with no line and no fill of their own.
      const a = await box(plate(page, "Drums"))
      const m = await box(notesPlate(page, "Drums"))
      expect(Math.abs(m.y - (a.y + a.height))).toBeLessThan(0.5)
      expect(Math.abs(m.x - a.x)).toBeLessThan(0.5)
      expect(Math.abs(m.width - a.width)).toBeLessThan(0.5)
      expect(await style(notesPlate(page, "Drums"), "border-top-width", "background-color")).toEqual({
        "border-top-width": "0px",
        "background-color": "rgba(0, 0, 0, 0)",
      })
      await expectWells(page)
    })
  }

  // One look for a well on both screens (the recording screen's tiles too):
  // the side panel's colour, in both themes.
  for (const theme of ["dark", "light"] as const) {
    test(`the rehearsal screen's wells are --well, in the ${theme} theme`, async ({ page }) => {
      await review(page, BOTH, themed(theme))
      await settled(page)
      const well = await colour(page, "--well")
      expect(well, "the theme has a well").not.toBe("rgba(0, 0, 0, 0)")
      expect(well, "a well is the panel's colour").toBe(await colour(page, "--panel"))
      // Drums' waveform and notes, Gtr's waveform, Keys' notes.
      const pictures = await page.locator("[data-lane] > div, [data-notes-lane]").all()
      expect(pictures).toHaveLength(4)
      for (const el of pictures) expect(await style(el, "background-color")).toEqual({ "background-color": well })
      // The names of a notes lane's octaves stand on the well's colour, so
      // a note under one does not run through it.
      const octave = notesLane(page, "Keys").getByText(/^C\d$/).first()
      await expect(octave).toBeVisible()
      expect(await style(octave, "background-color")).toEqual({
        "background-color": await mixed(page, "--well", 85),
      })
    })
  }

  test("a MIDI-only lane is a row of the group on a well of its own", async ({ page }) => {
    await review(page, BOTH)
    await settled(page)
    const keys = notesLane(page, "Keys")
    const row = page.locator("[data-lane-row='Keys']")
    await expect(row).toHaveCount(1)
    await expect(row).not.toHaveAttribute("data-paired")
    await expect(group(page).locator("[data-lane-row='Keys']")).toHaveCount(1)
    const k = await box(keys)
    const r = await box(row)
    expect(k.y - r.y).toBeCloseTo(3, 0)
    expect(r.y + r.height - (k.y + k.height)).toBeCloseTo(3, 0)
    expect(
      await style(
        keys,
        "border-top-width",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius",
        "background-color"
      )
    ).toEqual({
      "border-top-width": "0px",
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
      "background-color": await colour(page, "--well"),
    })
    // Its plate is a row's plate, as an audio track's: no fill of its own,
    // and the same padding.
    const plateOf = notesPlate(page, "Keys")
    expect(await style(plateOf, "background-color", "border-top-width")).toEqual({
      "background-color": "rgba(0, 0, 0, 0)",
      "border-top-width": "0px",
    })
    const pad = ["padding-left", "padding-top"]
    expect(await style(plateOf, ...pad)).toEqual(await style(plate(page, "Gtr"), ...pad))
  })

  test("the time axis is one line from the map down through every lane", async ({ page }) => {
    await review(page, band(4))
    await settled(page)
    const g = await box(group(page))
    // 200 px of plates and 12 of gap before it, and the group's 12 after it.
    const lined = async (what: string, b: { x: number; width: number }) => {
      expect(b.x - g.x, `${what} starts`).toBeCloseTo(212, 0)
      expect(g.x + g.width - (b.x + b.width), `${what} ends`).toBeCloseTo(12, 0)
    }
    const waves = await Promise.all(NAMES.slice(0, 4).map((name) => box(lane(page, name))))
    for (const [i, w] of waves.entries()) {
      expect(Math.abs(w.x - waves[0].x), `${NAMES[i]} starts with Drums`).toBeLessThan(0.5)
      expect(Math.abs(w.width - waves[0].width), `${NAMES[i]} ends with Drums`).toBeLessThan(0.5)
      await lined(NAMES[i], w)
    }
    await lined("the ruler", await box(clock(page)))
    await lined("the surface", await box(timeline(page)))

    // Zoomed in with the wheel over the lanes, the map frames part of the
    // take, and its strip is on the same axis.
    const t = await box(timeline(page))
    await page.mouse.move(t.x + t.width / 2, middle(waves[1]))
    await page.keyboard.down("Meta")
    await page.mouse.wheel(0, -400)
    await page.keyboard.up("Meta")
    const frame = page.locator("[data-view-frame]")
    await expect(frame).toBeVisible()
    await lined("the map's strip", await box(frame.locator("xpath=..")))
    for (const name of NAMES.slice(0, 4)) await lined(name, await box(lane(page, name)))
  })

  test("a loop drawn across two lanes runs from the ruler's foot to the group's foot", async ({
    page,
  }) => {
    await review(page, band(4))
    await settled(page)
    const t = await box(timeline(page))
    const from = t.x + t.width * 0.3
    const to = t.x + t.width * 0.6
    await page.mouse.move(from, middle(await box(lane(page, "Drums"))))
    await page.mouse.down()
    await page.mouse.move(to, middle(await box(lane(page, "Bass"))), { steps: 10 })
    await page.mouse.up()
    const region = page.locator("[data-region]")
    await expect(region).toBeVisible()
    const r = await box(region)
    const g = await box(group(page))
    const ruler = await box(clock(page))
    expect(Math.abs(r.y - (ruler.y + ruler.height)), "from the ruler's foot").toBeLessThan(0.5)
    expect(Math.abs(r.y + r.height - (g.y + g.height)), "to the group's foot").toBeLessThan(0.5)
    expect(Math.abs(r.x - from), "from where the pointer went down").toBeLessThan(1)
    expect(Math.abs(r.x + r.width - to), "to where it let go").toBeLessThan(1)
  })

  test("the master is its own group in a band as wide as the lanes", async ({ page }) => {
    await review(page, band(4))
    await settled(page)
    // Four tracks in a window of 820: the band lies in the flow, not stuck.
    expect(await above(page)).toBeGreaterThan(8)
    const g = await box(group(page))
    const p = await box(masterPlate(page))
    const b = await box(masterBand(page))
    expect(await masterInLanes(page)).toBe(false)
    expect(p.width).toBeCloseTo(200, 0)
    // The card's fill and its 12 px corners are the group's, round the plate
    // and the click's lane.
    expect(
      await style(masterGroup(page), "background-color", "border-top-left-radius", "border-bottom-right-radius")
    ).toEqual({
      "background-color": await colour(page, "--card"),
      "border-top-left-radius": "12px",
      "border-bottom-right-radius": "12px",
    })
    // A group of its own, 24 px under the lanes', as the take's groups are
    // apart from each other.
    expect(p.y - (g.y + g.height)).toBeCloseTo(24, 0)
    // Its band is the lanes' width, in the page's colour.
    expect(Math.abs(b.x - g.x), "the band's left").toBeLessThan(0.5)
    expect(Math.abs(b.x + b.width - (g.x + g.width)), "the band's right").toBeLessThan(0.5)
    expect((await style(masterBand(page), "background-color"))["background-color"]).toBe(
      await colour(page, "--background")
    )
    expect(Math.abs(p.x - b.x), "its plate at the band's left").toBeLessThan(0.5)
  })

  test("stuck, the master's band covers the lanes under it", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 600 })
    await review(page, band(8))
    await settled(page)
    expect(Math.abs(await above(page)), "the band is stuck").toBeLessThan(1)
    const b = await box(masterBand(page))
    const g = await box(group(page))
    expect(Math.abs(b.x - g.x)).toBeLessThan(0.5)
    expect(Math.abs(b.x + b.width - (g.x + g.width))).toBeLessThan(0.5)
    // Lanes go on under it...
    expect(g.y + g.height, "lanes under the band").toBeGreaterThan(b.y + b.height)
    // ...and nothing of them shows across it.
    expect(await showingThrough(page)).toEqual([])
  })

  test("the master holds the window's bottom edge while the page scrolls, with eight tracks", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 600 })
    await review(page, band(8))
    const main = page.locator("main")
    await expect(strip(page)).toBeVisible()
    const scrolls = await main.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(scrolls, "the page has more than a window of tracks").toBeGreaterThan(100)

    // Flush with the page's edge, not a strip of padding above it, at the
    // top and wherever the page is scrolled to.
    for (const to of [0, scrolls / 3, (scrolls * 2) / 3]) {
      await main.evaluate((el, y) => (el.scrollTop = y), to)
      expect(Math.abs(await above(page))).toBeLessThan(1)
    }
    // At the very end it is where it lies in the page, the padding below it,
    // and the last track is not under it.
    await main.evaluate((el) => (el.scrollTop = el.scrollHeight))
    expect(await above(page)).toBeGreaterThan(8)
    expect(await above(page)).toBeLessThanOrEqual(25)
    const last = await box(plate(page, "Talkback"))
    const held = await box(strip(page))
    expect(last.y + last.height).toBeLessThanOrEqual(held.y + 1)
  })

  test("the master's edge follows the screen's padding", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 600 })
    await review(page, band(8))
    const main = page.locator("main")
    // Review has the other screens' air, 32 px, as its own value of the token.
    expect(
      await main.evaluate((el) => getComputedStyle(el).getPropertyValue("--screen-pad-y").trim())
    ).toBe("2rem")
    expect(await style(main, "padding-top", "padding-bottom")).toEqual({
      "padding-top": "32px",
      "padding-bottom": "32px",
    })
    // A roomier screen: the padding follows the token, and so does the master.
    await main.evaluate((el) => el.style.setProperty("--screen-pad-y", "3rem"))
    expect(await style(main, "padding-top", "padding-bottom")).toEqual({
      "padding-top": "48px",
      "padding-bottom": "48px",
    })
    await main.evaluate((el) => (el.scrollTop = 0))
    expect(Math.abs(await above(page))).toBeLessThan(1)
  })
})

// Q3: M and S in the fader's row, after the fader. The name is alone on the
// row above and has the plate's whole width, about 152 px.
test.describe("M and S at the fader", () => {
  test("M and S sit after the fader on its row and the name has the plate's width", async ({
    page,
  }) => {
    await openTake2(page)
    await settled(page)
    for (const name of [HANNA, "Drums"]) {
      const p = plate(page, name)
      const fader = await box(p.getByRole("slider", { name: `${name} volume` }))
      for (const label of ["Mute", "Solo"]) {
        const b = await box(p.getByRole("button", { name: `${label} ${name}` }))
        expect(b.x, `${label} is right of the fader's right edge`).toBeGreaterThanOrEqual(
          fader.x + fader.width - 0.5
        )
        expect(Math.abs(middle(b) - middle(fader)), `${label} is level with the fader`).toBeLessThan(1)
      }
      // The name alone on the row above, at the plate's width less its
      // padding and the icon: 152 px of the 200.
      const title = await box(p.locator("[data-plate-name]"))
      expect(title.width, `${name}'s width`).toBeGreaterThanOrEqual(140)
      expect(title.y + title.height).toBeLessThanOrEqual(fader.y + 0.5)
      // And the lane is still 56 px.
      expect((await box(p)).height).toBeCloseTo(56, 0)
      expect((await box(cell(page, name))).height).toBeCloseTo(56, 0)
    }
  })

  test("a cut plate name shows whole on hover and when Tab reaches it", async ({ page }) => {
    await openTake2(page)
    await settled(page)
    const hanna = plate(page, HANNA).locator("[data-plate-name]")
    const drums = plate(page, "Drums").locator("[data-plate-name]")
    const tip = page.locator("[data-whole][data-state$='open']")
    await expect(hanna).toHaveText(HANNA)
    await expect(hanna).toHaveAttribute("data-cut")
    await expect(hanna).toHaveAttribute("tabindex", "0")
    // A name that fits has no tip and no place in the Tab order.
    await expect(drums).not.toHaveAttribute("data-cut")
    await expect(drums).not.toHaveAttribute("tabindex")

    // Under the pointer.
    await hanna.hover()
    await expect(tip).toHaveText(HANNA)
    await page.mouse.move(0, 0, { steps: 8 })
    await expect(tip).toHaveCount(0)

    // Under the keys: Tab from the control before it, with the shared ring.
    await hanna.locator("xpath=preceding::button[1]").focus()
    await page.keyboard.press("Tab")
    await expect(hanna).toBeFocused()
    await expect(tip).toHaveText(HANNA)
    expect((await style(hanna, "box-shadow"))["box-shadow"]).not.toBe("none")
    // Tab goes on to the fader: the name is one stop, and only while it is cut.
    await page.keyboard.press("Tab")
    await expect(plate(page, HANNA).getByRole("slider")).toBeFocused()
    await expect(tip).toHaveCount(0)
  })

  for (const theme of ["dark", "light"] as const) {
    test(`M and S are grey when on, not amber or the accent, in the ${theme} theme`, async ({ page }) => {
      await review(page, band(2), themed(theme))
      const grey = await colour(page, "--selected")
      for (const label of ["Mute", "Solo"]) {
        const button = plate(page, "Drums").getByRole("button", { name: `${label} Drums` })
        await expect(button).toHaveAttribute("aria-pressed", "false")
        await button.click()
        await expect(button).toHaveAttribute("aria-pressed", "true")
        // The fill fades in, so it is read once it has settled.
        await expect
          .poll(async () => (await style(button, "background-color"))["background-color"], label)
          .toBe(grey)
        // The pointer is still on it: an "on" button keeps its fill.
        expect((await style(button, "background-color"))["background-color"]).toBe(grey)
      }
    })

    // The thumb is the engine's own pseudo-element, which getComputedStyle
    // does not answer for: so it is read where it is drawn. A fader at its top
    // has its thumb at the right end.
    test(`the fader thumbs are in the text colour, in the ${theme} theme`, async ({ page }) => {
      await review(page, band(2), themed(theme))
      const text = await colour(page, "--foreground")
      for (const name of ["Drums volume", "Master volume"]) {
        const fader = await box(page.getByRole("slider", { name }))
        const thumb = await pixelAt(page, fader.x + fader.width - 7, middle(fader))
        // The probe is painted by a canvas and the thumb by the page, so a
        // channel may differ by a step or two of rounding.
        const want = await rgbOf(page, text)
        thumb.forEach((c, i) => expect(Math.abs(c - want[i]), `${name}, channel ${i}`).toBeLessThanOrEqual(2))
      }
    })
  }

  test("the master's figure sits after its fader, under the name", async ({ page }) => {
    await review(page, band(2))
    const master = strip(page)
    const fader = await box(master.getByRole("slider", { name: "Master volume" }))
    const figure = await box(master.getByText(/^\d+%$/))
    const name = await box(master.getByText("Master", { exact: true }))
    expect(figure.x).toBeGreaterThanOrEqual(fader.x + fader.width - 0.5)
    expect(Math.abs(middle(figure) - middle(fader))).toBeLessThan(1)
    expect(figure.y).toBeGreaterThanOrEqual(name.y + name.height - 0.5)
    // Where a track has M and S, so every fader in the column is as long as
    // the others and ends in the same place.
    const track = await box(plate(page, "Drums").getByRole("slider", { name: "Drums volume" }))
    expect(Math.abs(fader.x - track.x)).toBeLessThan(0.5)
    expect(Math.abs(fader.width - track.width)).toBeLessThan(0.5)
  })

  // Review Focus 3: the notes of a take are read once it is opened, and a
  // slow disk is a lane with a spinner in it after a second.
  test("a notes lane shows a spinner after one second while it reads", async ({ page }) => {
    const since = await openTake2(page, () => hold(page, "take_notes"))
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    // Each notes lane has one, and it shows nothing before the second: it is
    // on the page the whole time, hidden (so out of the role query).
    const spinners = page
      .locator("[data-notes-lane]")
      .getByRole("status", { name: "Loading", includeHidden: true })
    await expect(page.locator("[data-notes-lane]")).toHaveCount(2)
    expect(await spinners.count(), "a spinner in each notes lane").toBe(2)
    await at(500)
    expect(await spinners.first().isVisible(), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await spinners.first().isVisible(), "a spinner at 0.9 s").toBe(false)
    expect(await spinners.last().isVisible(), "a spinner at 0.9 s").toBe(false)
    await expect(spinners.first(), "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    await expect(spinners.last()).toBeVisible()
    await settled(page)
    const layout = () =>
      page
        .locator("[data-plate], [data-lane], [data-notes-plate], [data-notes-lane]")
        .evaluateAll((els) => els.map((e) => JSON.stringify(e.getBoundingClientRect())))
    const waiting = await layout()

    // The notes come: they draw, the spinners go, and nothing has moved.
    await letGo(page, "take_notes")
    await expect(notesLane(page, "Drums").getByText("Kick", { exact: true })).toBeVisible()
    await expect(spinners).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await layout()).toEqual(waiting)
  })

  // A read that fails is said in the lane, where the notes would be, and the
  // spinner it waited with does not turn for ever.
  test("a notes lane says so when its notes cannot be read, and the audio lanes are as they were", async ({
    page,
    pageErrors,
  }) => {
    const since = await openTake2(page, () =>
      page.evaluate(() => {
        const bridge = (window as unknown as { pywebview: { api: Record<string, unknown> } }).pywebview.api
        bridge.take_notes = async () => {
          const e = new Error("The disk went away")
          e.name = "OSError"
          throw e
        }
      })
    )
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    const lanes = page.locator("[data-notes-lane]")
    await expect(lanes).toHaveCount(2)
    for (const name of ["Drums", "Keys (Nord Stage 3 MIDI)"])
      await expect(notesLane(page, name)).toHaveText("Could not read the notes")
    // The bar has said what Python raised.
    await expect(problemBar(page)).toContainText("The disk went away")
    expectedError(pageErrors, /take_notes failed/)
    // And a lane that is not waiting has no spinner to show after the second.
    await at(2000)
    const spinners = lanes.getByRole("status", { name: "Loading", includeHidden: true })
    expect(await spinners.count(), "a spinner in a lane that failed").toBe(0)
    // The audio lanes are drawn and their plates are 56 px, as ever.
    await expect(page.locator("[data-lane]")).not.toHaveCount(0)
    for (const track of ["Drums", HANNA]) {
      expect((await box(plate(page, track))).height).toBeCloseTo(56, 0)
      expect((await box(cell(page, track))).height).toBeCloseTo(56, 0)
    }
    await expect(plate(page, HANNA).getByRole("button", { name: `Mute ${HANNA}` })).toBeEnabled()
  })

  test("a notes lane's row names are 12 px", async ({ page }) => {
    await openTake2(page)
    await settled(page)
    const kick = notesLane(page, "Drums").getByText("Kick", { exact: true })
    await expect(kick).toBeVisible()
    expect((await style(kick, "font-size"))["font-size"]).toBe("12px")
    // A keyboard's are its octaves' Cs.
    const octave = notesLane(page, "Keys (Nord Stage 3 MIDI)").getByText(/^C\d$/).first()
    await expect(octave).toBeVisible()
    expect((await style(octave, "font-size"))["font-size"]).toBe("12px")
  })
})

// Review Focus 5: the group in the smallest window, with the most it holds.
test.describe("the lanes group with the rehearsal stress band", () => {
  test("eight tracks with a Both and a MIDI-only track at 960 by 680 stay one group as the page scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openTake2(page)
    await settled(page)
    // Eight tracks in nine rows: Drums' notes are a row of their own.
    await expect(group(page).locator("[data-lane-row]")).toHaveCount(9)
    await expect(group(page).locator("[data-lane-row][data-paired]")).toHaveCount(1)
    await expectWells(page)

    // Halfway down, the rows are still one run, and the master's band holds
    // the window's foot with nothing of a lane beside it or under it.
    const main = page.locator("main")
    const scrolls = await main.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(scrolls, "the page scrolls").toBeGreaterThan(100)
    await main.evaluate((el, y) => (el.scrollTop = y), scrolls / 2)
    await expectWells(page)
    expect(Math.abs(await above(page)), "the band is stuck").toBeLessThan(1)
    const b = await box(masterBand(page))
    const g = await box(group(page))
    expect(g.y + g.height, "lanes under the band").toBeGreaterThan(b.y + b.height)
    expect(await showingThrough(page)).toEqual([])

    // Tab reaches Hanna's cut name, which shows whole.
    const hanna = plate(page, HANNA).locator("[data-plate-name]")
    await expect(hanna).toHaveAttribute("data-cut")
    await hanna.locator("xpath=preceding::button[1]").focus()
    await page.keyboard.press("Tab")
    await expect(hanna).toBeFocused()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(HANNA)
  })
})
