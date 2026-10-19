import {
  calls,
  dragRegion,
  expect,
  hold,
  letGo,
  openApp,
  openBandApp,
  openEvening,
  recordTake,
  settled,
  startButton,
  test,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// Where the band drifted (drift spec Part 3): the band's tempo bar by bar
// along Master's lane. The band's takes (band.js) have the curves the
// mockup drew: Pałyn 2, played with the click switched off, ran in its
// choruses and most in the bridge and sank in the outro; Viasna, to the
// click, dragged a while; Take 4, of no song, is measured against its own
// middle. The fake's other takes hold their aim (fake-bridge.js fakeDrift).

const lane = (page: Page) => page.locator("[data-master-lane]")
const tag = (page: Page) => lane(page).locator("[data-click-tag]")
const chips = (page: Page) => lane(page).locator("[data-drift-chip]")
const line = (page: Page) => lane(page).locator("[data-drift-line]")

/** The band's Tuesday jam started, its takes tonight's, one of them open. */
async function bandTake(page: Page, label: string, before = "") {
  if (before) await page.addInitScript(before)
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startButton(page).click()
  await page.locator(`[aria-label='Rehearsal overview'] button[aria-label^='${label}']`).click()
  await expect(page.locator("[data-master-plate]")).toBeVisible()
  await settled(page)
}

const box = async (l: Locator) => (await l.boundingBox())!

test("Palyn 2: the line, the band, the chips and a bar on hover", async ({ page }) => {
  await bandTake(page, "Take 2 Pałyn 2")
  await expect(tag(page)).toHaveText("No click · 128 bpm · 4/4")
  await expect(line(page)).toBeVisible()
  await expect(line(page).locator("[data-drift-aim]")).toHaveCount(1)
  await expect(line(page).locator("[data-drift-band]")).toHaveCount(1)
  await expect(chips(page)).toHaveText(["+6", "+7", "−5"])
  await expect(lane(page)).toHaveAttribute("aria-label", /^No click · 128 bpm · 4\/4\. Tempo: ahead 6 bpm, bars \d+ to \d+; ahead 7 bpm, bars \d+ to \d+; behind 5 bpm, bars \d+ to \d+\.$/)
  // The amber is drawn, and no take of the band's has stripes here.
  await expect(line(page).locator("[data-drift-stretch]")).toHaveCount(3)
  await expect(lane(page).locator("[data-click-line]")).toHaveCount(0)
  // Hovering over the bridge's chip says that bar's tempo.
  const bridge = await box(chips(page).nth(1))
  const l = await box(lane(page))
  await page.mouse.move(bridge.x + bridge.width / 2, l.y + l.height - 4)
  await expect(lane(page).locator("[data-drift-hover]")).toHaveText(/^Bar \d+ · 13[45] bpm \(\+[67]\)$/)
  await page.mouse.move(l.x - 40, l.y - 40)
  await expect(lane(page).locator("[data-drift-hover]")).toHaveCount(0)
  // Asked once, with the take's files and its own meter.
  const asked = await calls(page, "take_drift")
  expect(asked.at(-1)!.args[2]).toEqual({ tempo: 128, signature: "4/4", click: false, song: "Pałyn" })
})

test("Viasna, to the click: its stripes dimmed under the line", async ({ page }) => {
  await bandTake(page, "Take 5 Viasna")
  await expect(tag(page)).toHaveText("Click 128 bpm · 4/4")
  await expect(line(page)).toBeVisible()
  expect(await lane(page).locator("[data-click-line]").count()).toBeGreaterThan(0)
  const opacity = await lane(page).locator("[data-click-lines]").evaluate((e) => Number(getComputedStyle(e).opacity))
  expect(opacity).toBeLessThan(0.4)
  await expect(chips(page)).toHaveText(["−3"])
})

test("Take 4, of no song, against its own middle", async ({ page }) => {
  await bandTake(page, "Take 4")
  await expect(tag(page)).toHaveText("No tempo · middle 126 bpm")
  await expect(line(page)).toBeVisible()
})

test("a take while it counts: nothing for a second, a spinner, then words", async ({ page }) => {
  await openEvening(page)
  await page.clock.install()
  await hold(page, "take_drift")
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 6']").click()
  await expect(lane(page)).toBeVisible()
  // The tag is hidden from a screen reader, which hears the lane's label.
  const spinner = tag(page).locator("[role=status]")
  await expect(spinner).toBeAttached()
  await expect(spinner).toHaveClass(/invisible/)
  await page.clock.runFor(1000)
  await expect(spinner).not.toHaveClass(/invisible/)
  await expect(tag(page)).not.toContainText("Counting")
  await page.clock.runFor(9000)
  await expect(tag(page)).toHaveText("Counting the tempo…")
  await letGo(page, "take_drift")
  await expect(tag(page)).toHaveText("No tempo · middle 120 bpm · from the mix")
})

for (const [why, said] of [
  ["short", "Too short to show the tempo"],
  ["no-beat", "No steady beat found"],
] as const) {
  test(`a take with ${why} says so in the tag's place`, async ({ page }) => {
    await openEvening(page, `window.__DRIFT__ = {ok: false, why: '${why}'};`)
    await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 7 Viasna']").click()
    await expect(tag(page)).toHaveText(said)
    await expect(lane(page)).toHaveAttribute("aria-label", said)
    await expect(line(page)).toHaveCount(0)
    // A click take keeps its stripes.
    expect(await lane(page).locator("[data-click-line]").count()).toBeGreaterThan(0)
  })
}

for (const [take, said] of [
  ["Take 6", "Recorded without the click"],
  ["Take 7 Viasna", "Click 128 bpm · 4/4"],
] as const) {
  test(`${take}, its files missing, shows the lane as before`, async ({ page }) => {
    await openEvening(page, "window.__DRIFT__ = {ok: false, why: 'missing'};")
    await page.locator(`[aria-label='Rehearsal overview'] button[aria-label^='${take}']`).click()
    await expect(tag(page)).toHaveText(said)
    await expect(lane(page)).toHaveAttribute("aria-label", said)
    await expect(line(page)).toHaveCount(0)
  })
}

test("Review right after a take shows its line", async ({ page }) => {
  await openEvening(page)
  await recordTake(page, 11)
  await expect(line(page)).toBeVisible()
  await expect(tag(page)).toContainText("bpm")
})

test("a wider tolerance in Settings leaves fewer stretches amber", async ({ page }) => {
  await bandTake(
    page,
    "Take 2 Pałyn 2",
    `localStorage.setItem("mock-python-config", JSON.stringify({theme: "dark", ui_scale: 1, drift_tolerance: 0.05}));`
  )
  await expect(chips(page)).toHaveText(["+7"])
})

test("the tolerance is picked in Settings > Metronome", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Metronome", exact: true }).click()
  const group = page.locator("[data-tab-body]").getByRole("region", { name: "Tempo drift" })
  await expect(group).toContainText(
    "How far from the tempo a stretch of two bars turns amber on Master. 2% is about 2.5 bpm at 128."
  )
  const picks = group.getByRole("radiogroup", { name: "Drift shown past" })
  await expect(picks.getByRole("radio")).toHaveText(["1%", "2%", "3%", "5%"])
  await expect(picks.getByRole("radio", { checked: true })).toHaveText("2%")
  await picks.getByRole("radio", { name: "3%" }).click()
  await expect
    .poll(async () => (await calls(page, "set_metronome_setting")).map((c) => c.args))
    .toEqual([["drift_tolerance", 0.03]])
  await expect(page.locator("[data-tab-body]")).toContainText(
    "The click's settings are also behind the gear in the metronome row, on the rehearsal screen."
  )
})

test("a stretch inside a region still reads, and the line zooms with the lanes", async ({ page }) => {
  await bandTake(page, "Take 2 Pałyn 2")
  const bridge = chips(page).nth(1)
  await expect(bridge).toHaveText("+7")
  const timeline = await box(page.getByRole("group", { name: "Take timeline" }))
  const at = await box(bridge)
  const centre = (at.x + at.width / 2 - timeline.x) / timeline.width
  await dragRegion(page, centre - 0.04, centre + 0.04)
  const region = await box(lane(page).locator("[data-master-region]"))
  const chip = await box(bridge)
  expect(chip.x + chip.width / 2).toBeGreaterThan(region.x)
  expect(chip.x + chip.width / 2).toBeLessThan(region.x + region.width)
  // The chip stands over the region's amber, so its own must read: it is
  // drawn above it.
  const z = await bridge.evaluate((e) => getComputedStyle(e).backgroundColor)
  expect(z).not.toBe("rgba(0, 0, 0, 0)")
  // Zoomed in on the bridge, the chip stays over the same seconds.
  await page.mouse.move(chip.x + chip.width / 2, timeline.y + timeline.height / 2)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -400)
  await page.keyboard.up("Control")
  const tracks = page.locator("[data-region]")
  await expect.poll(async () => (await box(tracks)).width).toBeGreaterThan(region.width * 1.2)
  const zoomed = await box(lane(page).locator("[data-master-region]"))
  const after = await box(lane(page).locator("[data-drift-chip]", { hasText: "+7" }))
  expect(after.x + after.width / 2).toBeGreaterThan(zoomed.x)
  expect(after.x + after.width / 2).toBeLessThan(zoomed.x + zoomed.width)
})

for (const theme of ["dark", "light"] as const) {
  test(`at 960 px in ${theme}, nothing on the lane is cut`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await bandTake(
      page,
      "Take 2 Pałyn 2",
      `localStorage.setItem("mock-python-config", JSON.stringify({theme: "${theme}", ui_scale: 1}));`
    )
    await expect(chips(page)).toHaveCount(3)
    const l = await box(lane(page))
    for (const el of [...(await chips(page).all()), tag(page)]) {
      const b = await box(el)
      expect(b.x).toBeGreaterThanOrEqual(l.x)
      expect(b.y).toBeGreaterThanOrEqual(l.y)
      expect(b.x + b.width).toBeLessThanOrEqual(l.x + l.width)
      expect(b.y + b.height).toBeLessThanOrEqual(l.y + l.height)
    }
    const tagText = tag(page)
    expect(await tagText.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  })
}
