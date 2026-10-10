import {
  TAKE_SECONDS,
  callCount,
  calls,
  dragRegion,
  expect,
  openApp,
  openHistory,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// The player with a take's notes in it (spec Part 6): a Both track's notes
// right under its audio, one card of two halves; a MIDI track's notes in a
// lane of their own; and a track whose port never appeared, saying so. The
// notes are drawn, never played: no M, S or fader on their plates.

/** The drummer on Both, the keyboard player on MIDI between the guitar and
 *  the bass, as the band and as the session that records. */
const BAND = `
  window.__SESSION_TRACKS__ = [
    {name: 'Drums', channel: 1, icon: 'drums', mode: 'both', midi_port: {name: 'TD-17'}},
    {name: 'Gtr', channel: 2, icon: 'guitar-electric', mode: 'audio'},
    {name: 'Keys', channel: null, icon: 'keys', mode: 'midi', midi_port: {name: 'Launchkey Mini MK3'}},
    {name: 'Bass', channel: 3, icon: 'bass', mode: 'audio'},
  ];
  window.__BAND_ICONS__ = {Drums: 'drums', Gtr: 'guitar-electric', Keys: 'keys', Bass: 'bass'};
`

/** What stop_take answers for that band: a .mid for each track that took
 *  notes, each after the audio lane it follows, with its place in the band. */
const NOTES = [
  { name: "Drums", port: "TD-17", after: "Drums", place: 0, file: "/rec/Drums.mid" },
  { name: "Keys", port: "Launchkey Mini MK3", after: "Gtr", place: 2, file: "/rec/Keys.mid" },
]

/** Every plate and lane of the player, where it is. */
async function layout(page: Page) {
  return page
    .locator("[data-plate], [data-lane], [data-notes-plate], [data-notes-lane]")
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        const what = ["data-plate", "data-lane", "data-notes-plate", "data-notes-lane"]
          .filter((a) => e.hasAttribute(a))
          .map((a) => `${a}=${e.getAttribute(a)}`)
          .join(" ")
        return `${what} ${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`
      })
    )
}

/** The first take of that band, stopped and up for review. */
async function review(page: Page, before = "") {
  await openApp(page, { before: BAND + before })
  await startRehearsal(page)
  await recordTake(page, 1)
  await expect(page.getByRole("button", { name: "Mute Drums" })).toBeVisible()
}

const plate = (page: Page, name: string) => page.locator(`[data-plate='${name}']`)
const notesPlate = (page: Page, name: string) => page.locator(`[data-notes-plate='${name}']`)
const notesLane = (page: Page, name: string) => page.locator(`[data-notes-lane='${name}']`)
const audioLane = (page: Page, name: string) => page.locator(`[data-lane='${name}']`)
const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, "on screen").not.toBeNull()
  return b!
}

/**
 * Where a lane's canvas has notes drawn along one line across it, at a
 * fraction of its height: each run of drawn pixels as [start, end] in
 * fractions of the width, with its colour.
 */
async function drawnAlong(lane: Locator, at: number) {
  return lane.locator("canvas").evaluate((c: HTMLCanvasElement, at: number) => {
    const ctx = c.getContext("2d")!
    const y = Math.floor(c.height * at)
    const { data } = ctx.getImageData(0, y, c.width, 1)
    const runs: { from: number; to: number; r: number; g: number; b: number }[] = []
    for (let x = 0; x < c.width; x++) {
      if (data[x * 4 + 3] === 0) continue
      const last = runs.at(-1)
      if (last && last.to === (x - 1) / c.width) last.to = x / c.width
      else
        runs.push({ from: x / c.width, to: x / c.width, r: data[x * 4], g: data[x * 4 + 1], b: data[x * 4 + 2] })
    }
    return runs
  }, at)
}

/** The middle of a drum row, as a fraction of the lane's height: the rows
 *  share the height between 3 px at the top and the bottom. */
async function rowMiddle(lane: Locator, row: number, rows = 6) {
  const h = (await box(lane.locator("canvas"))).height
  return (3 + ((row + 0.5) * (h - 6)) / rows) / h
}

/** The accent is the theme's blue; the rest a grey with hardly any blue. */
const accent = (p: { r: number; b: number }) => p.b - p.r > 60
const grey = (p: { r: number; b: number }) => Math.abs(p.b - p.r) < 30

test.describe("notes in the player", () => {
  test("puts a Both track's notes right under its audio, as the lower half of its card", async ({
    page,
  }) => {
    await review(page)
    const audio = plate(page, "Drums")
    const midi = notesPlate(page, "Drums")
    await expect(midi).toContainText("MIDI")
    await expect(midi).toContainText("TD-17")
    await expect(midi).toContainText("Saved as .mid, not played here")
    // There is nothing to hear, so nothing to mute, solo or turn up.
    await expect(midi.getByRole("button")).toHaveCount(0)
    await expect(midi.locator("input")).toHaveCount(0)
    await expect(midi.getByRole("meter")).toHaveCount(0)
    // One card: the halves touch, with a dashed line between them.
    const a = await box(audio)
    const m = await box(midi)
    expect(Math.abs(m.y - (a.y + a.height))).toBeLessThan(1)
    expect(Math.abs(m.x - a.x)).toBeLessThan(1)
    expect(Math.abs(m.width - a.width)).toBeLessThan(1)
    expect(await midi.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed")
    expect(await audio.evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe("0px")
    // And the lane is right under the waveform, as tall as its plate.
    const wave = await box(audioLane(page, "Drums"))
    const lane = await box(notesLane(page, "Drums"))
    expect(Math.abs(lane.y - (wave.y + wave.height))).toBeLessThan(1)
    expect(Math.abs(lane.y - m.y)).toBeLessThan(1)
    expect(Math.abs(lane.height - m.height)).toBeLessThan(1)
    expect(await notesLane(page, "Drums").evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe(
      "dashed"
    )
    // A lane's worth of height: the drum rows are named, and the notes by
    // pitch have their Cs.
    for (const row of ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"])
      await expect(notesLane(page, "Drums").getByText(row, { exact: true })).toBeVisible()
    await expect(notesLane(page, "Keys").getByText("C4", { exact: true })).toBeVisible()
  })

  test("gives a MIDI-only track a lane of its own in band order, with its icon", async ({
    page,
  }) => {
    await review(page)
    const keys = notesPlate(page, "Keys")
    await expect(keys.locator("[data-icon]")).toHaveAttribute("data-icon", "keys")
    await expect(keys).toContainText("Keys")
    await expect(keys).toContainText("Launchkey Mini MK3")
    await expect(keys).toContainText("Saved as .mid, not played here")
    await expect(keys.getByRole("button")).toHaveCount(0)
    await expect(keys.locator("input")).toHaveCount(0)
    // A card of its own, not half of the guitar's.
    expect(await keys.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("solid")
    const gtr = await box(plate(page, "Gtr"))
    expect((await box(keys)).y - (gtr.y + gtr.height)).toBeGreaterThan(6)
    // The band's order: the drummer, the drums' notes, the guitar, the keys,
    // the bass.
    const ys = []
    for (const p of [
      plate(page, "Drums"),
      notesPlate(page, "Drums"),
      plate(page, "Gtr"),
      keys,
      plate(page, "Bass"),
    ])
      ys.push((await box(p)).y)
    expect([...ys].sort((x, y) => x - y)).toEqual(ys)
    // Each lane level with its plate.
    const lane = await box(notesLane(page, "Keys"))
    expect(Math.abs(lane.y - (await box(keys)).y)).toBeLessThan(1)
  })

  test("puts a missing and a saved MIDI lane after the same audio lane in band order", async ({
    page,
  }) => {
    // Pads' port is not plugged in, Synth's is: both follow Gtr, and Pads
    // stood first in the band.
    await openApp(page, {
      before: `
        window.__SESSION_TRACKS__ = [
          {name: 'Gtr', channel: 1, icon: 'guitar-electric', mode: 'audio'},
          {name: 'Pads', channel: null, icon: 'keys', mode: 'midi', midi_port: {name: 'Pad box'}},
          {name: 'Synth', channel: null, icon: 'keys', mode: 'midi', midi_port: {name: 'Synth port'}},
          {name: 'Bass', channel: 2, icon: 'bass', mode: 'audio'},
        ];
        window.__BAND_ICONS__ = {Gtr: 'guitar-electric', Pads: 'keys', Synth: 'keys', Bass: 'bass'};
        window.__MIDI_PORTS__ = ['Synth port'];`,
    })
    await startRehearsal(page)
    await recordTake(page, 1)
    await expect(notesPlate(page, "Pads")).toContainText("Not connected, no .mid saved")
    await expect(notesPlate(page, "Synth")).toContainText("Saved as .mid, not played here")
    const ys = []
    for (const p of [plate(page, "Gtr"), notesPlate(page, "Pads"), notesPlate(page, "Synth"), plate(page, "Bass")])
      ys.push((await box(p)).y)
    expect([...ys].sort((x, y) => x - y)).toEqual(ys)
  })

  test("says so when a track's port never appeared in the take", async ({ page }) => {
    await review(page, "window.__MIDI_GONE__ = ['Launchkey Mini MK3'];")
    await expect(notesLane(page, "Keys")).toContainText("No notes in this take")
    const keys = notesPlate(page, "Keys")
    await expect(keys).toContainText("Not connected, no .mid saved")
    await expect(keys).not.toContainText("Saved as .mid")
    await expect(keys).toContainText("Launchkey Mini MK3")
    // Its icon comes from the same call as the notes: one, for the take.
    await expect(keys.locator("[data-icon]")).toHaveAttribute("data-icon", "keys")
    expect(await callCount(page, "take_notes")).toBe(1)
    expect((await calls(page, "take_notes"))[0].args[0]).toEqual([
      { name: "Drums", file: "/rec/Drums.mid" },
      { name: "Keys", file: null },
    ])
    // The drums' notes are there all the same.
    await expect(notesLane(page, "Drums")).not.toContainText("No notes")
    await expect(notesPlate(page, "Drums")).toContainText("Saved as .mid, not played here")
  })

  test("a Both track whose port never appeared keeps its sound, and its notes half says so", async ({
    page,
  }) => {
    await review(page, "window.__MIDI_GONE__ = ['TD-17'];")
    // The audio half is as it always is, its waveform drawn.
    await expect(plate(page, "Drums").getByRole("button", { name: "Mute Drums" })).toBeVisible()
    expect((await box(audioLane(page, "Drums"))).height).toBeGreaterThanOrEqual(91.5)
    await expect
      .poll(async () => (await drawnAlong(audioLane(page, "Drums"), 0.5)).length)
      .toBeGreaterThan(0)
    // The notes half is still the lower half of its card, and says why it
    // is empty.
    const midi = notesPlate(page, "Drums")
    await expect(midi).toContainText("MIDI")
    await expect(midi).toContainText("TD-17")
    await expect(midi).toContainText("Not connected, no .mid saved")
    await expect(notesLane(page, "Drums")).toContainText("No notes in this take")
    expect(await midi.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed")
    const a = await box(plate(page, "Drums"))
    expect(Math.abs((await box(midi)).y - (a.y + a.height))).toBeLessThan(1)
    const wave = await box(audioLane(page, "Drums"))
    expect(Math.abs((await box(notesLane(page, "Drums"))).y - (wave.y + wave.height))).toBeLessThan(1)
    expect((await calls(page, "take_notes"))[0].args[0]).toEqual([
      { name: "Keys", file: "/rec/Keys.mid" },
      { name: "Drums", file: null },
    ])
  })

  test("a notes file that cannot be read says so in its lane, and the take still plays", async ({
    page,
  }) => {
    await openApp(page, {
      before: BAND,
      after: `
        const real = window.pywebview.api.take_notes;
        window.pywebview.api.take_notes = async (files) => (await real(files)).map((a) =>
          a.name === 'Drums' ? {name: 'Drums', icon: 'drums', error: 'Notes file not readable'} : a);`,
    })
    await startRehearsal(page)
    await recordTake(page, 1)
    await expect(notesLane(page, "Drums")).toContainText("Notes file not readable")
    await expect(notesLane(page, "Keys")).not.toContainText("Notes file")
    await expect(notesLane(page, "Keys")).not.toContainText("No notes")
    await expect(notesPlate(page, "Keys")).toContainText("Saved as .mid, not played here")
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect.poll(() => callCount(page, "player_toggle")).toBe(1)
  })

  test("asks for a take's notes once, not again to zoom, play or mark a region", async ({
    page,
  }) => {
    await review(page)
    await expect(notesLane(page, "Keys")).toBeVisible()
    await expect.poll(() => callCount(page, "take_notes")).toBe(1)
    expect((await calls(page, "take_notes"))[0].args[0]).toEqual([
      { name: "Drums", file: "/rec/Drums.mid" },
      { name: "Keys", file: "/rec/Keys.mid" },
    ])
    const t = await box(timeline(page))
    await page.mouse.move(t.x + t.width * 0.3, t.y + t.height / 2)
    await page.keyboard.down("Control")
    await page.mouse.wheel(0, -500)
    await page.keyboard.up("Control")
    await expect(page.getByRole("button", { name: "Whole take" })).toBeVisible()
    await dragRegion(page, 0.2, 0.6)
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Pause", exact: true }).click()
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.getByRole("button", { name: "Whole take" }).click()
    await page.waitForTimeout(300)
    expect(await callCount(page, "take_notes")).toBe(1)
  })

  test("nothing moves when the notes arrive", async ({ page }) => {
    // take_notes is held back until the test lets it answer, as a slow disk
    // would hold it.
    await openApp(page, {
      before: BAND,
      after: `
        const real = window.pywebview.api.take_notes;
        let release;
        const held = new Promise((r) => { release = r; });
        window.__RELEASE_NOTES__ = () => release();
        window.pywebview.api.take_notes = async (files) => {
          const answer = await real(files);
          await held;
          window.__NOTES_LANDED__ = true;
          return answer;
        };`,
    })
    await startRehearsal(page)
    await recordTake(page, 1)
    await expect(plate(page, "Bass")).toBeVisible()
    await expect.poll(() => callCount(page, "take_notes")).toBe(1)
    await page.waitForTimeout(300)
    const before = await layout(page)
    // The notes' plates and lanes are there already, at their size, waiting:
    // no notes drawn, and the keyboard's icon not known yet.
    expect(before.filter((b) => b.startsWith("data-notes"))).toHaveLength(4)
    expect(await page.evaluate(() => (window as { __NOTES_LANDED__?: boolean }).__NOTES_LANDED__)).toBeFalsy()
    expect(await drawnAlong(notesLane(page, "Drums"), await rowMiddle(notesLane(page, "Drums"), 0))).toEqual([])
    await expect(notesPlate(page, "Keys").locator("[data-icon]")).not.toHaveAttribute("data-icon", "keys")

    await page.evaluate(() => (window as { __RELEASE_NOTES__?: () => void }).__RELEASE_NOTES__?.())
    await expect(notesPlate(page, "Keys").locator("[data-icon]")).toHaveAttribute("data-icon", "keys")
    const crash = await rowMiddle(notesLane(page, "Drums"), 0)
    await expect.poll(async () => (await drawnAlong(notesLane(page, "Drums"), crash)).length).toBe(1)
    await page.waitForTimeout(300)
    expect(await layout(page)).toEqual(before)
  })

  test("draws the notes along the view: zoom and the region go across them as across the audio", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await review(page)
    const drums = notesLane(page, "Drums")
    // The fake kit's crash, once, a quarter of a second in.
    const crash = await rowMiddle(drums, 0)
    await expect.poll(async () => (await drawnAlong(drums, crash)).length).toBe(1)
    const [whole] = await drawnAlong(drums, crash)
    expect(Math.abs(whole.from - 0.25 / TAKE_SECONDS)).toBeLessThan(0.005)

    // Zoomed in about the left edge, the take's first seconds fill the lane.
    const t = await box(timeline(page))
    await page.mouse.move(t.x + 2, t.y + t.height / 2)
    await page.keyboard.down("Control")
    await page.mouse.wheel(0, -500)
    await page.keyboard.up("Control")
    await expect(page.getByRole("button", { name: "Whole take" })).toBeVisible()
    // Where the window is, from where clicks near its two ends land.
    const seekAt = async (ratio: number) => {
      const seeks = await callCount(page, "player_seek")
      await page.mouse.click(t.x + t.width * ratio, t.y + t.height / 2)
      await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
      return (await calls(page, "player_seek")).at(-1)!.args[0] as number
    }
    const t02 = await seekAt(0.02)
    const t98 = await seekAt(0.98)
    const length = (t98 - t02) / 0.96
    const start = t02 - 0.02 * length
    expect(length).toBeLessThan(TAKE_SECONDS * 0.6)
    await expect
      .poll(async () => Math.abs(((await drawnAlong(drums, crash))[0]?.from ?? -1) - (0.25 - start) / length))
      .toBeLessThan(0.005)
    // A note is as long as it was held: the kit's hits are a tenth of a
    // second, wider zoomed in than out.
    const [zoomed] = await drawnAlong(drums, crash)
    expect(zoomed.to - zoomed.from).toBeGreaterThan(whole.to - whole.from)

    // The region is drawn through the notes lanes as through the audio
    // lanes, and the playhead crosses them too.
    await page.getByRole("button", { name: "Whole take" }).click()
    await dragRegion(page, 0.25, 0.75)
    const band = await box(page.locator("[data-region]"))
    const first = await box(audioLane(page, "Drums"))
    const last = await box(audioLane(page, "Bass"))
    const keys = await box(notesLane(page, "Keys"))
    expect(band.y).toBeLessThanOrEqual(first.y + 1)
    expect(band.y + band.height).toBeGreaterThanOrEqual(last.y + last.height - 1)
    expect(band.y).toBeLessThan(keys.y)
    expect(Math.abs(band.x - (t.x + t.width * 0.25))).toBeLessThan(t.width * 0.02)
  })

  test("the part before the playhead is in the accent, the rest grey", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await review(page)
    const drums = notesLane(page, "Drums")
    // The hi-hat plays every quarter of a second.
    const hats = await rowMiddle(drums, 2)
    await expect.poll(async () => (await drawnAlong(drums, hats)).length).toBeGreaterThan(10)
    const before = await drawnAlong(drums, hats)
    expect(before.every(grey)).toBe(true)

    const t = await box(timeline(page))
    await page.mouse.click(t.x + t.width * 0.5, t.y + t.height / 2)
    await expect.poll(() => callCount(page, "player_seek")).toBe(1)
    await expect
      .poll(async () => (await drawnAlong(drums, hats)).filter((r) => r.to < 0.45).every(accent))
      .toBe(true)
    const after = await drawnAlong(drums, hats)
    expect(after.filter((r) => r.to < 0.45).length).toBeGreaterThan(4)
    expect(after.filter((r) => r.from > 0.55).length).toBeGreaterThan(4)
    expect(after.filter((r) => r.from > 0.55).every(grey)).toBe(true)
    // The keyboard's line too.
    const keys = notesLane(page, "Keys")
    const line = (await box(keys.locator("canvas"))).height
    let played = 0
    for (let y = 4; y < line - 4; y += 2) {
      const runs = await drawnAlong(keys, y / line)
      played += runs.filter((r) => r.to < 0.45 && accent(r)).length
      expect(runs.filter((r) => r.from > 0.55).every(grey)).toBe(true)
    }
    expect(played).toBeGreaterThan(0)
  })

  test("a note 0 long is still drawn, 2 px wide", async ({ page }) => {
    // A key struck as the take's very last event has no length in the .mid.
    await page.setViewportSize({ width: 1280, height: 1000 })
    await openApp(page, {
      before: BAND,
      after: `
        const real = window.pywebview.api.take_notes;
        window.pywebview.api.take_notes = async (files) => (await real(files)).map((a) =>
          a.name === 'Keys'
            ? {name: 'Keys', icon: 'keys', drums: false, low: 60, high: 71, notes: [[${TAKE_SECONDS / 2}, 0, 64, 1]]}
            : a);`,
    })
    await startRehearsal(page)
    await recordTake(page, 1)
    const keys = notesLane(page, "Keys")
    await expect(keys).toBeVisible()
    // The middle of E4's row, an octave of rows between 3 px at either end.
    const h = (await box(keys.locator("canvas"))).height
    const e4 = (3 + (71 - 64 + 0.45) * ((h - 6) / 12)) / h
    await expect.poll(async () => (await drawnAlong(keys, e4)).length).toBe(1)
    const [note] = await drawnAlong(keys, e4)
    const width = await keys.locator("canvas").evaluate((c: HTMLCanvasElement) => c.width)
    // Pixels from the first drawn to the last, both counted.
    expect(Math.round((note.to - note.from) * width) + 1).toBeGreaterThanOrEqual(2)
    expect(Math.abs(note.from - 0.5)).toBeLessThan(0.005)
  })

  test("audio lanes keep their 92 px, and a notes lane is as tall as its plate", async ({
    page,
  }) => {
    // A keyboard with a long name on a port with a long name: its plate is
    // taller than a lane, and squeezes the lanes beside it.
    const name = "Keys and the old Juno 106 that has lived in the corner of the rehearsal room since 1990"
    const port = "Launchkey Mini MK3 MIDI Port, the one on the left of the desk"
    await page.setViewportSize({ width: 960, height: 1000 })
    await review(
      page,
      `window.__SESSION_TRACKS__[2].name = ${JSON.stringify(name)};
       window.__SESSION_TRACKS__[2].midi_port = {name: ${JSON.stringify(port)}};
       window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];
       window.__BAND_ICONS__[${JSON.stringify(name)}] = 'keys';`
    )
    const keys = notesPlate(page, name)
    await expect(keys).toContainText(name)
    await expect(keys).toContainText(port)
    for (const track of ["Drums", "Gtr", "Bass"])
      expect((await box(plate(page, track))).height).toBeGreaterThanOrEqual(91.5)
    for (const track of ["Drums", name]) {
      const p = notesPlate(page, track)
      // Nothing in it cut: the plate is as tall as it needs, and its lane
      // as tall as the plate.
      expect(await p.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1)
      const cut = await p.evaluate((e) =>
        [...e.querySelectorAll("span")].some((s) => s.scrollWidth > s.clientWidth + 1)
      )
      expect(cut).toBe(false)
      const lane = await box(notesLane(page, track))
      expect(Math.abs(lane.height - (await box(p)).height)).toBeLessThan(1)
    }
    // The keyboard's plate is taller than a lane, and its lane with it; the
    // drums' half card is left what it needs, less than a lane.
    expect((await box(keys)).height).toBeGreaterThan(96)
    expect((await box(notesPlate(page, "Drums"))).height).toBeLessThan(92)
    // Its rows are too thin to name there.
    await expect(notesLane(page, "Drums").getByText("Kick", { exact: true })).toBeHidden()
  })

  test("the review screen hands the take's notes to crop_draft and keep_take", async ({
    page,
  }) => {
    await review(page)
    await expect.poll(() => callCount(page, "take_notes")).toBe(1)
    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await page.getByRole("button", { name: "Crop", exact: true }).click()
    await expect.poll(() => callCount(page, "crop_draft")).toBe(1)
    expect((await calls(page, "crop_draft"))[0].args[4]).toEqual(NOTES)
    // The cut take is a take opened again: its notes are asked for anew.
    await expect.poll(() => callCount(page, "take_notes")).toBe(2)
    const cut = (await calls(page, "take_notes"))[1].args[0] as { file: string }[]
    expect(cut.every((f) => /\.mid#\d+$/.test(f.file))).toBe(true)
    await expect(notesPlate(page, "Drums")).toBeVisible()

    await page.getByRole("button", { name: /Save take/ }).click()
    await expect.poll(() => callCount(page, "keep_take")).toBe(1)
    const kept = (await calls(page, "keep_take"))[0].args[7] as { name: string; file: string }[]
    expect(kept.map((n) => n.name)).toEqual(["Drums", "Keys"])
    expect(kept.map((n) => n.file)).toEqual(cut.map((f) => f.file))
  })

  test("a saved take opens with its notes", async ({ page }) => {
    await review(page)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
    await page.locator("button[aria-label^='Take 1']").first().click()
    await expect(notesPlate(page, "Drums")).toContainText("TD-17")
    await expect(notesPlate(page, "Keys")).toContainText("Launchkey Mini MK3")
    await expect(notesLane(page, "Keys")).toBeVisible()
    await expect.poll(() => callCount(page, "take_notes")).toBe(2)
  })

  test("a take of an evening before opens with its notes in History", async ({ page }) => {
    await openApp(page, {
      before: `window.__BAND_ICONS__ = {Keys: 'keys'};
        window.__OLD_TAKE_NOTES__ = {
          notes: [{name: 'Keys', file: '/rec/old/Keys.mid', port: 'Launchkey Mini MK3', after: 'Guitar'}],
          notes_missing: [{name: 'Pads', port: 'Pad box', after: null}]};`,
    })
    await openHistory(page)
    await page.getByRole("button", { name: "Take 1 Pałyn" }).click()
    await expect(notesPlate(page, "Keys")).toContainText("Saved as .mid, not played here")
    await expect(notesPlate(page, "Keys").locator("[data-icon]")).toHaveAttribute("data-icon", "keys")
    await expect(notesLane(page, "Pads")).toContainText("No notes in this take")
    await expect(notesPlate(page, "Pads")).toContainText("Not connected, no .mid saved")
    // Pads goes first, before every audio lane; Keys after the guitar.
    const pads = await box(notesPlate(page, "Pads"))
    const guitar = await box(plate(page, "Guitar"))
    const keys = await box(notesPlate(page, "Keys"))
    expect(pads.y).toBeLessThan(guitar.y)
    expect(guitar.y).toBeLessThan(keys.y)
    expect(await callCount(page, "take_notes")).toBe(1)
  })

  test("a take with no notes looks as it always has, and asks for none", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page, 1)
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    await expect(page.locator("[data-notes-plate], [data-notes-lane]")).toHaveCount(0)
    expect(await callCount(page, "take_notes")).toBe(0)
  })
})
