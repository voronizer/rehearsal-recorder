import {
  calls,
  callCount,
  dragRegion,
  expect,
  openApp,
  openHistory,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// Goes in the player: a tab per song on the strip, opening down into
// columns of its goes. The fuller evening is Pałyn 1 (3:12), Pałyn 2 (2:58,
// a Keep this mark, in the cloud), Take 3 (1:30) and Viasna 1 (4:10), at
// /rec/old.

async function openGo(page: Page, name = "Take 2 Pałyn 2", before = "") {
  await openApp(page, { before: `window.__FULL_EVENING__ = true; ${before}` })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await overview.getByRole("button", { name }).click()
  await expect(timeline(page)).toBeVisible()
  return strip(page)
}

const strip = (page: Page) => page.getByRole("group", { name: "Take strip" })
const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })
const songs = (page: Page) => strip(page).getByRole("button", { name: "Songs", exact: true })
const openTab = (scope: Locator) => scope.locator("[data-tab][aria-current='true']")

/** The calls made since `from` of them were made. */
async function since(page: Page, name: string, from: number) {
  return (await calls(page, name)).slice(from)
}

async function widths(scope: Locator) {
  return scope.locator("[data-tab]").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().width)
  )
}

test("one tab per song, in the order first played", async ({ page }) => {
  const s = await openGo(page)
  expect(
    await s.locator("[data-tab]").evaluateAll((els) => els.map((el) => el.getAttribute("data-tab")))
  ).toEqual(["Pałyn", "take:3", "Viasna"])
  await expect(openTab(s)).toHaveAttribute("data-tab", "Pałyn")
  await expect(openTab(s).locator("[data-tab-line]")).toHaveText(/^2/)
  await expect(s.getByRole("button", { name: "Viasna, go 1, 4:10", exact: true })).toBeVisible()
  await expect(s.getByRole("button", { name: "Take 3, 1:30", exact: true })).toBeVisible()
})

test("another song's tab opens its last go from the start", async ({ page }) => {
  const s = await openGo(page)
  const seeks = await callCount(page, "player_seek")
  await s.getByRole("button", { name: "Viasna, go 1, 4:10" }).click()
  await expect(openTab(s)).toHaveAttribute("data-tab", "Viasna")
  expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
    { name: "Guitar", file: "/rec/old/v1.wav" },
  ])
  await page.waitForTimeout(300)
  expect((await since(page, "player_seek", seeks)).filter((c) => (c.args[0] as number) > 0)).toEqual([])
})

test("a tab keeps its size when it is opened", async ({ page }) => {
  const s = await openGo(page)
  const before = await widths(s)
  await s.getByRole("button", { name: "Viasna, go 1, 4:10" }).click()
  await expect(openTab(s)).toHaveAttribute("data-tab", "Viasna")
  expect(await widths(s)).toEqual(before)
  await s.getByRole("button", { name: /^Pałyn, go 2/ }).click()
  await expect(openTab(s)).toHaveAttribute("data-tab", "Pałyn")
  expect(await widths(s)).toEqual(before)
  // Nor when the columns open under them: a take with no song is a narrow
  // tab over a column with its dash.
  await songs(page).click()
  await expect(s.locator("[data-column]")).toHaveCount(3)
  expect(await widths(s)).toEqual(before)
})

test("Songs opens the tabs into columns, and the number too", async ({ page }) => {
  const s = await openGo(page)
  await expect(songs(page)).toHaveAttribute("aria-expanded", "false")
  await expect(s.locator("[data-column]")).toHaveCount(0)
  await songs(page).click()
  await expect(songs(page)).toHaveAttribute("aria-expanded", "true")
  await expect(s.locator("[data-column]")).toHaveCount(3)
  const palyn = s.locator("[data-column='Pałyn']")
  await expect(palyn.locator("button[data-go-row]")).toHaveCount(2)
  await expect(palyn.getByRole("button", { name: "Take 1 Pałyn 1" })).toBeVisible()
  await expect(palyn.getByRole("button", { name: "Take 2 Pałyn 2" })).toHaveAttribute(
    "aria-current",
    "true"
  )
  await songs(page).click()
  await expect(s.locator("[data-column]")).toHaveCount(0)
  const number = s.getByRole("button", { name: "Every go at Pałyn" })
  await expect(number).toHaveAttribute("aria-expanded", "false")
  await number.click()
  await expect(number).toHaveAttribute("aria-expanded", "true")
  await expect(s.locator("[data-column]")).toHaveCount(3)
})

test("Escape closes the columns first, then the take, and a take opened again starts with them closed", async ({
  page,
}) => {
  const s = await openGo(page)
  await songs(page).click()
  await expect(s.locator("[data-column]")).toHaveCount(3)
  await page.keyboard.press("Escape")
  await expect(s.locator("[data-column]")).toHaveCount(0)
  await expect(timeline(page)).toBeVisible()
  await page.keyboard.press("Escape")
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  await overview.getByRole("button", { name: "Take 1 Pałyn 1" }).click()
  await expect(timeline(page)).toBeVisible()
  await expect(songs(page)).toHaveAttribute("aria-expanded", "false")
})

test("a go in another song's column starts from the start", async ({ page }) => {
  const s = await openGo(page)
  await songs(page).click()
  const box = (await timeline(page).boundingBox())!
  const seeks = await callCount(page, "player_seek")
  await page.mouse.click(box.x + box.width * (30 / 178), box.y + box.height / 2)
  await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
  const after = await callCount(page, "player_seek")
  await s.locator("[data-column='Viasna']").getByRole("button", { name: "Take 4 Viasna 1" }).click()
  await expect(openTab(s)).toHaveAttribute("data-tab", "Viasna")
  expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
    { name: "Guitar", file: "/rec/old/v1.wav" },
  ])
  await page.waitForTimeout(300)
  expect((await since(page, "player_seek", after)).filter((c) => (c.args[0] as number) > 0)).toEqual([])
})

// Another go at the same song opens at the same place: the position, the
// loop, Repeat, the zoom, and playing if it was.

const transport = (page: Page) => page.getByRole("toolbar", { name: "Transport" })
const repeat = (page: Page) => transport(page).getByRole("button", { name: "Repeat" })
const whole = (page: Page) => page.getByRole("button", { name: "Whole take" })
const opened = async (page: Page) =>
  ((await calls(page, "player_open")).at(-1)?.args[0] as { file: string }[])[0].file

/** Every call the interface made, in order, from the `from`th on. */
async function callsFrom(page: Page, from: number) {
  const all = await page.evaluate(
    () => (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__
  )
  return all.slice(from)
}
const everyCall = async (page: Page) =>
  page.evaluate(() => (window as unknown as { __CALLS__: unknown[] }).__CALLS__.length)

/** A click on the timeline at `seconds` into a take `length` long. */
async function clickAt(page: Page, seconds: number, length: number) {
  const box = (await timeline(page).boundingBox())!
  const seeks = await callCount(page, "player_seek")
  await page.mouse.click(box.x + box.width * (seconds / length), box.y + box.height / 2)
  await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
}

async function zoomIn(page: Page) {
  const box = (await timeline(page).boundingBox())!
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -500)
  await page.keyboard.up("Control")
  await expect(whole(page)).toBeVisible()
}

test("the place is kept going to another go at the song", async ({ page }) => {
  const s = await openGo(page, "Take 1 Pałyn 1")
  await dragRegion(page, 0.25, 0.5)
  await repeat(page).click()
  await expect(repeat(page)).toHaveAttribute("aria-pressed", "true")
  const drawn = (await calls(page, "player_set_loop")).at(-1)!.args as number[]
  await zoomIn(page)
  await transport(page).getByRole("button", { name: "Play", exact: true }).click()
  await expect(transport(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible()

  await songs(page).click()
  const from = await everyCall(page)
  await s.locator("[data-column='Pałyn']").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
  await expect(openTab(s).locator("[data-tab-line]")).toHaveText(/^2/)
  await expect.poll(() => opened(page)).toBe("/rec/old/p2.wav")
  await expect(transport(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible()
  const after = await callsFrom(page, from)
  const loop = after.filter((c) => c.name === "player_set_loop").at(-1)!.args as number[]
  expect(loop[0]).toBeCloseTo(drawn[0], 0)
  expect(loop[1]).toBeCloseTo(drawn[1], 0)
  await expect(repeat(page)).toHaveAttribute("aria-pressed", "true")
  await expect(whole(page)).toBeVisible()
  // Seeked before it plays, or the first moment heard is the go's start.
  const names = after.map((c) => c.name)
  expect(names.lastIndexOf("player_seek")).toBeGreaterThan(names.lastIndexOf("player_open"))
  expect(names.lastIndexOf("player_play")).toBeGreaterThan(names.lastIndexOf("player_seek"))
})

test("↓ and ↑ go through the song's goes, and do nothing at the ends", async ({ page }) => {
  const s = await openGo(page, "Take 1 Pałyn 1")
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => opened(page)).toBe("/rec/old/p2.wav")
  await expect(openTab(s).locator("[data-tab-line]")).toHaveText(/^2/)
  const opens = await callCount(page, "player_open")
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(300)
  expect(await callCount(page, "player_open")).toBe(opens)
  await page.keyboard.press("ArrowUp")
  await expect.poll(() => opened(page)).toBe("/rec/old/p1.wav")

  await s.getByRole("button", { name: /^Take 3, 1:30/ }).click()
  await expect.poll(() => opened(page)).toBe("/rec/old/t3.wav")
  const atTake3 = await callCount(page, "player_open")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(300)
  expect(await callCount(page, "player_open")).toBe(atTake3)
})

test("a place past the end of a shorter go is clamped", async ({ page }) => {
  await openGo(page, "Take 1 Pałyn 1")
  await clickAt(page, 185, 192)
  const seeks = await callCount(page, "player_seek")
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => opened(page)).toBe("/rec/old/p2.wav")
  await expect.poll(() => callCount(page, "player_seek")).toBeGreaterThan(seeks)
  const at = (await calls(page, "player_seek")).at(-1)!.args[0] as number
  expect(at).toBeGreaterThan(170)
  expect(at).toBeLessThanOrEqual(178)
})

test("a second ↑ or ↓ before the go has opened carries the first one's place", async ({
  page,
}) => {
  await openGo(page, "Take 1 Pałyn 1")
  await clickAt(page, 30, 192)
  await page.evaluate(() => {
    const w = window as unknown as {
      __HOLD__?: Record<string, Promise<void>>
      __LET_GO__?: () => void
    }
    w.__HOLD__ = { player_open: new Promise<void>((r) => (w.__LET_GO__ = r)) }
  })
  const opens = await callCount(page, "player_open")
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => callCount(page, "player_open")).toBe(opens + 1)
  await page.keyboard.press("ArrowUp")
  await expect.poll(() => callCount(page, "player_open")).toBe(opens + 2)
  const seeks = await callCount(page, "player_seek")
  await page.evaluate(() => (window as unknown as { __LET_GO__: () => void }).__LET_GO__())
  await expect.poll(() => callCount(page, "player_seek")).toBeGreaterThan(seeks)
  expect(await opened(page)).toBe("/rec/old/p1.wav")
  expect((await calls(page, "player_seek")).at(-1)!.args[0] as number).toBeCloseTo(30, -1)
})

test("the keys list says ↑ and ↓ in the player, and the review screen's does not", async ({
  page,
}) => {
  await openGo(page)
  await page.getByRole("button", { name: "Player keys" }).click()
  const keys = page.getByRole("dialog").filter({ hasText: "Keys in the player" })
  await expect(keys).toContainText("Previous / next go at this song")
  await page.keyboard.press("Escape")

  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
  await page.getByRole("button", { name: "Player keys" }).click()
  await expect(keys).toContainText("10 seconds back / forward")
  await expect(keys).not.toContainText("Previous / next go")
})

test("the place is not carried by a tab", async ({ page }) => {
  // Another song is another song: its go opens from the start.
  const s = await openGo(page, "Take 1 Pałyn 1")
  await dragRegion(page, 0.25, 0.5)
  await clickAt(page, 30, 192)
  const after = await callCount(page, "player_seek")
  await s.getByRole("button", { name: "Viasna, go 1, 4:10" }).click()
  await expect.poll(() => opened(page)).toBe("/rec/old/v1.wav")
  await page.waitForTimeout(300)
  expect((await since(page, "player_seek", after)).filter((c) => (c.args[0] as number) > 0)).toEqual([])
  await expect(page.locator("[data-region-span]")).toHaveCount(0)
})
