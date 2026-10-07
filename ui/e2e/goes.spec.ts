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

// The evening in the window's header: what there is to know about it, and
// a button to its folder.

const facts = (page: Page) => page.getByRole("group", { name: "About this rehearsal" })
const fact = (page: Page, label: string) =>
  facts(page).locator("div", { has: page.locator("dt", { hasText: label }) }).locator("dd")

test("the player's header says what the evening was, and opens its folder", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openGo(page)
  await expect(fact(page, "Length")).toHaveText("12 min")
  await expect(fact(page, "Takes")).toHaveText("4, 2 songs")
  await expect(fact(page, "In the cloud")).toHaveText("1 of 4")
  await expect(fact(page, "On disk")).toHaveText("1.2 GB")
  // The path is not shown: the button is enough.
  await expect(page.getByText("/rec/old")).toHaveCount(0)
  await facts(page).getByRole("button", { name: "Open folder" }).click()
  await expect.poll(async () => (await calls(page, "show_rehearsal_folder")).at(-1)?.args).toEqual([
    "/rec/old",
  ])
})

test("the rehearsal screen has the same header", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
  await page.fill("#take-name", "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await recordTake(page, 2)
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 3/ })).toBeVisible()
  await expect(fact(page, "Takes")).toHaveText("2, 1 song")
  await expect(fact(page, "On disk")).toHaveText("96 MB")
  await expect(page.getByText("2 takes", { exact: true })).toHaveCount(0)
  await expect(page.getByText(/^\/rec\//)).toHaveCount(0)
  await facts(page).getByRole("button", { name: "Open folder" }).click()
  await expect.poll(async () => (await calls(page, "show_rehearsal_folder")).length).toBe(1)
})

test("on Windows the button says Explorer", async ({ page }) => {
  await page.addInitScript("Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});")
  await openGo(page)
  await expect(facts(page).getByRole("button", { name: "Show in Explorer" })).toBeVisible()
})

test("a narrow window keeps the length, the takes and the button", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 })
  await openGo(page)
  await expect(fact(page, "Length")).toBeVisible()
  await expect(fact(page, "Takes")).toBeVisible()
  await expect(facts(page).getByRole("button", { name: "Open folder" })).toBeVisible()
  await expect(fact(page, "In the cloud")).toBeHidden()
  await expect(fact(page, "On disk")).toBeHidden()
})

// A place on its way to a go, or a go on its way from another rehearsal,
// is the person's last word only until they say something else.

/** Holds `name` in the fake until `letGo` is called. */
async function hold(page: Page, name: string) {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __HOLD__?: Record<string, Promise<void>>
      __LET_GO__?: () => void
    }
    w.__HOLD__ = { [n]: new Promise<void>((r) => (w.__LET_GO__ = r)) }
  }, name)
}
async function letGo(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __HOLD__?: object; __LET_GO__: () => void }
    w.__HOLD__ = {}
    w.__LET_GO__()
  })
}

/** Pałyn 1 open with a loop on Repeat, then ↓ held on its way to Pałyn 2. */
async function moveOnItsWay(page: Page) {
  await openGo(page, "Take 1 Pałyn 1")
  await dragRegion(page, 0.25, 0.5)
  await repeat(page).click()
  await expect(repeat(page)).toHaveAttribute("aria-pressed", "true")
  await hold(page, "player_open")
  const opens = await callCount(page, "player_open")
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => callCount(page, "player_open")).toBe(opens + 1)
}

/** Viasna 1 opened with nothing of Pałyn's place on it. */
async function startsFresh(page: Page, from: number) {
  await expect.poll(() => opened(page)).toBe("/rec/old/v1.wav")
  await page.waitForTimeout(400)
  const after = await callsFrom(page, from)
  expect(after.filter((c) => c.name === "player_set_loop")).toEqual([])
  expect(
    after.filter((c) => c.name === "player_seek" && (c.args[0] as number) > 0)
  ).toEqual([])
  await expect(repeat(page)).toHaveAttribute("aria-pressed", "false")
  await expect(page.locator("[data-region-span]")).toHaveCount(0)
}

test("a place on its way is dropped when another song's tab is picked", async ({ page }) => {
  await moveOnItsWay(page)
  await strip(page).getByRole("button", { name: /^Viasna, go 1/ }).click()
  await expect(openTab(strip(page))).toHaveAttribute("data-tab", "Viasna")
  const from = await everyCall(page)
  await letGo(page)
  await startsFresh(page, from)
})

test("a place on its way is dropped when the take is closed", async ({ page }) => {
  await moveOnItsWay(page)
  await page.keyboard.press("Escape")
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  await overview.getByRole("button", { name: "Take 4 Viasna 1" }).click()
  const from = await everyCall(page)
  await letGo(page)
  await expect(timeline(page)).toBeVisible()
  await startsFresh(page, from)
})

/** Pałyn 1 of Tuesday jam opened from Pałyn's page, whose ↑ is the last
 *  go at it in First rehearsal, the rehearsal before. */
async function fromSongPage(page: Page) {
  await openApp(page, {
    before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn", "Pałyn"];`,
  })
  await openHistory(page)
  await page.getByRole("button", { name: "Songs", exact: true }).click()
  await page.locator("[data-song='Pałyn']").click()
  await page
    .locator(`[data-rung-group="/rec/old"]`)
    .getByRole("button", { name: "Take 1 Pałyn 1" })
    .click()
  await expect(timeline(page)).toBeVisible()
}
const openedFiles = async (page: Page, from: number) =>
  (await calls(page, "player_open"))
    .slice(from)
    .map((c) => (c.args[0] as { file: string }[])[0].file)

test("a go on its way from another rehearsal gives way to a later move", async ({ page }) => {
  await fromSongPage(page)
  const opens = await callCount(page, "player_open")
  await hold(page, "get_rehearsal")
  await page.keyboard.press("ArrowUp")
  await expect.poll(() => callCount(page, "get_rehearsal")).toBeGreaterThan(0)
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => opened(page)).toBe("/rec/old/p2.wav")
  await letGo(page)
  await page.waitForTimeout(800)
  expect(await openedFiles(page, opens)).toEqual(["/rec/old/p2.wav"])
  await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
})

test("a go on its way from another rehearsal is dropped by Escape", async ({ page }) => {
  await fromSongPage(page)
  const opens = await callCount(page, "player_open")
  const asked = await callCount(page, "get_rehearsal")
  await hold(page, "get_rehearsal")
  await page.keyboard.press("ArrowUp")
  await expect.poll(() => callCount(page, "get_rehearsal")).toBe(asked + 1)
  await page.keyboard.press("Escape")
  await expect(timeline(page)).toHaveCount(0)
  await letGo(page)
  await page.waitForTimeout(800)
  await expect(timeline(page)).toHaveCount(0)
  expect(await openedFiles(page, opens)).toEqual([])
})

/** Where each tab is along the strip, and how wide. */
async function places(page: Page) {
  return strip(page)
    .locator("[data-tab]")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { key: el.getAttribute("data-tab"), x: Math.round(r.x), w: Math.round(r.width) }
      })
    )
}

/** A rehearsal that starts with `names` kept already, as the fake keeps
 *  them: each is waiting for the cloud until the screen asks again. */
async function startWith(page: Page, names: string[], clock = false) {
  if (clock) await page.clock.install()
  await openApp(page, {
    after: `
      const api = window.pywebview.api; const start = api.start_rehearsal;
      api.start_rehearsal = async (...a) => { const r = await start(...a);
        for (const name of ${JSON.stringify(names)}) {
          const { take_number: n } = await api.start_take();
          await api.keep_take(n, '/tmp/draft', name, 6, [{name:'Guitar', file:'/rec/k' + n + '.wav'}], []);
        }
        return r; };
    `,
  })
  await startRehearsal(page, names.length + 1)
}

test("no tab moves when a copy to the cloud finishes", async ({ page }) => {
  await startWith(page, ["Pałyn", "Viasna", "Pałyn"], true)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await overview.getByRole("button", { name: /^Take 2 Viasna/ }).click()
  await expect(timeline(page)).toBeVisible()
  await expect(strip(page).getByText("Waiting for the cloud").first()).toBeVisible()
  const before = await places(page)
  await page.clock.runFor(4000)
  await expect(strip(page).getByText(/for the cloud|to the cloud/)).toHaveCount(0)
  expect(await places(page)).toEqual(before)
})

test("a renamed go's tab is scrolled into view", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 })
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"]
  await startWith(page, names)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview.getByText("Waiting for the cloud")).toHaveCount(0)
  await overview.getByRole("button", { name: /^Take 9 India/ }).click()
  await expect(timeline(page)).toBeVisible()
  await page.getByRole("button", { name: /^Rename take India/ }).click()
  await page.getByRole("dialog").locator("input").fill("Alpha")
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(openTab(strip(page))).toHaveAttribute("data-tab", "Alpha")
  await expect
    .poll(() =>
      openTab(strip(page)).evaluate((el) => {
        const row = el.parentElement!.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return r.left >= row.left - 1 && r.right <= row.right + 1
      })
    )
    .toBe(true)
})

test("from a song's page, its tab is as wide shut as open", async ({ page }) => {
  // One go at Pałyn in First rehearsal failed its copy, so its line, unseen
  // in the tab, is the widest.
  const failed = `
    const api = window.pywebview.api; const get = api.get_song;
    api.get_song = async (id) => { const r = await get(id);
      for (const g of r.goes || [])
        if (g.folder === '/rec/older' && g.take.take_number === 3) g.take.cloud_error = 'Cloud folder not found';
      return r; };
  `
  await openApp(page, {
    before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn", "Pałyn"];`,
    after: failed,
  })
  await openHistory(page)
  await page.getByRole("button", { name: "Songs", exact: true }).click()
  await page.locator("[data-song='Pałyn']").click()
  await page
    .locator(`[data-rung-group="/rec/old"]`)
    .getByRole("button", { name: "Take 2 Pałyn 2" })
    .click()
  await expect(timeline(page)).toBeVisible()
  const open = await places(page)
  await strip(page).getByRole("button", { name: /^Viasna, go 1/ }).click()
  await expect(openTab(strip(page))).toHaveAttribute("data-tab", "Viasna")
  expect(await places(page)).toEqual(open)
})

// Long names and many songs on the strip.

const LONG = "Pieśnia pra doŭhuju darohu dadomu praz uvieś horad"

/** A rehearsal kept with `names`, the `open`-th of them open in the player. */
async function openOf(page: Page, names: string[], open = 1) {
  await startWith(page, names)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview.getByText("Waiting for the cloud")).toHaveCount(0)
  await overview.getByRole("button", { name: new RegExp(`^Take ${open} `) }).click()
  await expect(timeline(page)).toBeVisible()
}

test("a long song name is cut to 224 px and shown whole on hover", async ({ page }) => {
  await openOf(page, ["Pałyn", LONG])
  const long = strip(page).locator(`[data-tab='${LONG}']`)
  const name = long.locator("[data-tab-name]")
  await expect(name).toHaveText(LONG)
  expect((await name.boundingBox())!.width).toBeLessThanOrEqual(224)
  const button = long.getByRole("button", { name: new RegExp(`^${LONG}, go 1`) })
  await expect(button).toHaveAttribute("title", LONG)
  await expect(openTab(strip(page)).locator("[title]")).toHaveCount(0)
  await expect(openTab(strip(page))).not.toHaveAttribute("title")
  await button.click()
  await expect(openTab(strip(page))).toHaveAttribute("data-tab", LONG)
  await expect(openTab(strip(page)).locator(`[title='${LONG}']`)).toHaveCount(1)
})

const TWENTY = ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška", "Daroha", "Rečka",
  "Vieter", "Zorka", "Kvietka", "Rassvet", "Lieta", "Zima", "Vosień", "Bierah", "Rečyšča",
  "Ranica", "Viečar", "Noč"]
const tabRow = (page: Page) => strip(page).locator("[data-tab]").first().locator("..")
const scrolled = (page: Page) => tabRow(page).evaluate((el) => el.scrollLeft)
/** Where the row is once a smooth move has come to rest. */
async function rested(page: Page) {
  let at = -1
  await expect
    .poll(async () => {
      const was = at
      at = await scrolled(page)
      return at === was
    })
    .toBe(true)
  return at
}
const earlier = (page: Page) => strip(page).getByRole("button", { name: "Earlier songs" })
const later = (page: Page) => strip(page).getByRole("button", { name: "Later songs" })

test("a few songs show no arrows", async ({ page }) => {
  await openGo(page)
  await expect(openTab(strip(page))).toBeVisible()
  await expect(earlier(page)).toHaveCount(0)
  await expect(later(page)).toHaveCount(0)
  expect(await tabRow(page).evaluate((el) => getComputedStyle(el).maskImage)).toBe("none")
})

test("the mouse wheel moves the songs sideways", async ({ page }) => {
  await openOf(page, TWENTY)
  const pageAt = await page.evaluate(() => window.scrollY)
  await strip(page).locator("[data-tab='Viasna']").hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(() => scrolled(page)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(pageAt)
})

test("an arrow at a side with more songs moves the row a screenful", async ({ page }) => {
  await openOf(page, TWENTY)
  await expect(later(page)).toBeVisible()
  await expect(earlier(page)).toHaveCount(0)
  expect(await tabRow(page).evaluate((el) => getComputedStyle(el).maskImage)).not.toBe("none")
  const width = await tabRow(page).evaluate((el) => el.clientWidth)
  await later(page).click()
  expect(await rested(page)).toBeGreaterThanOrEqual(width - 96 - 1)
  await expect(earlier(page)).toBeVisible()
  // It gives up focus, so Space still plays.
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).not.toBe(
    "Later songs"
  )
  for (let i = 0; i < 5 && (await earlier(page).count()); i++) {
    const at = await scrolled(page)
    await earlier(page).click()
    expect(await rested(page)).toBeLessThan(at)
  }
  expect(await scrolled(page)).toBe(0)
  await expect(earlier(page)).toHaveCount(0)
})

test("the wheel over an open column scrolls the column, not the songs", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 })
  await openOf(page, [...Array(12).fill("Alpha"), ...TWENTY.slice(0, 12)])
  await songs(page).click()
  const column = strip(page).locator("[data-column='Alpha']")
  await expect(column).toBeVisible()
  expect(await column.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await column.hover()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await scrolled(page)).toBe(0)
})

/** Whether the open tab is whole in the row, and clear of a fade at an end
 *  that has more songs past it. */
function inView(page: Page) {
  return openTab(strip(page)).evaluate((el) => {
    const row = el.parentElement!
    const r = row.getBoundingClientRect()
    const t = el.getBoundingClientRect()
    const from = r.left + (row.hasAttribute("data-before") ? 48 : 0)
    const to = r.right - (row.hasAttribute("data-after") ? 48 : 0)
    return t.left >= from - 1 && t.right <= to + 1
  })
}

test("the open tab comes back into view when the window narrows", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 })
  await openOf(page, TWENTY.slice(0, 7), 7)
  await expect(openTab(strip(page))).toHaveAttribute("data-tab", "Daroha")
  await expect.poll(() => inView(page)).toBe(true)
  await page.setViewportSize({ width: 900, height: 820 })
  await expect(later(page)).toHaveCount(0)
  await expect(earlier(page)).toBeVisible()
  await expect.poll(() => inView(page)).toBe(true)
})
