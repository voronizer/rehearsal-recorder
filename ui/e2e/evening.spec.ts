import { calls, callCount, expect, openApp, openHistory, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Sorting the evening on the rehearsal screen: false starts drawn as such,
// song pills under the takes nobody named, Send starred and Clear false
// starts over the takes. Tonight is ten takes, the rehearsal started with
// them already in it:
//   1 Pałyn 3:20 ★          2 Pałyn 0:12 ★         3 Viasna 0:12, a mark
//   4 Pałyn 0:12            5 Viasna 3:00 ★ mix    6 Take 6 2:30
//   7 Viasna 3:10           8 Pałyn 3:30           9 Sonca 2:50 ★ tracks
//  10 Take 10 0:08
// So with the 30 s default 4 and 10 are false starts, and 1 and 2 are the
// ★ takes with nothing in the cloud folder.
const TONIGHT = [
  { name: "Pałyn", duration_sec: 200, starred: true },
  { name: "Pałyn", duration_sec: 12, starred: true },
  { name: "Viasna", duration_sec: 12, markers: [{ at: 4, note: "", label_id: 1 }] },
  { name: "Pałyn", duration_sec: 12 },
  { name: "Viasna", duration_sec: 180, starred: true, cloud: { mix: "/cloud/Viasna 2.mp3" } },
  { name: "Take 6", duration_sec: 150 },
  { name: "Viasna", duration_sec: 190 },
  { name: "Pałyn", duration_sec: 210 },
  { name: "Sonca", duration_sec: 170, starred: true, cloud: { tracks: "/cloud/Sonca 1" } },
  { name: "Take 10", duration_sec: 8 },
]
/** The rehearsal's folder, as the fake made it from the name it was given. */
async function folderOf(page: Page) {
  return `/rec/${(await calls(page, "start_rehearsal"))[0].args[0]}`
}

async function openEvening(page: Page, before = "", tonight: object[] = TONIGHT) {
  await openApp(page, {
    before: `window.__TONIGHT__ = ${JSON.stringify(tonight)};
             window.__CLOUD_DIR__ = '/cloud'; ${before}`,
  })
  await startRehearsal(page, tonight.length + 1)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

const row = (overview: ReturnType<Page["locator"]>, n: number) =>
  overview.locator(`[data-take="${n}"]`)

test("a short take with no star or mark is drawn as a false start", async ({ page }) => {
  const overview = await openEvening(page)
  await expect(row(overview, 4)).toHaveAttribute("data-false-start")
  await expect(row(overview, 4)).toContainText("false start")
  // Short, but starred; short, but marked; long.
  for (const n of [2, 3, 1]) {
    await expect(row(overview, n)).not.toHaveAttribute("data-false-start")
    await expect(row(overview, n)).not.toContainText("false start")
  }
})

test("the limit comes from Settings", async ({ page }) => {
  const overview = await openEvening(page, "window.__FALSE_START__ = 10;")
  await expect(row(overview, 10)).toHaveAttribute("data-false-start")
  await expect(row(overview, 4)).not.toHaveAttribute("data-false-start")
})

test("an unnamed false start stays grey in Not named and still has pills", async ({ page }) => {
  const overview = await openEvening(page)
  const notNamed = overview.getByRole("group", { name: "Not named" })
  await expect(notNamed.locator('[data-take="10"]')).toHaveAttribute("data-false-start")
  await expect(notNamed.locator('[data-name-pills="10"] [data-song-choice]').first()).toBeVisible()
})

test("a pill under an unnamed take names it", async ({ page }) => {
  const overview = await openEvening(page)
  const pills = overview.locator('[data-name-pills="6"]')
  // Tonight's songs first, each as the go the take would be.
  await expect(pills.locator("[data-song-choice]").first()).toBeVisible()
  await pills.locator('[data-song-choice="Viasna"]').click()
  expect((await calls(page, "rename_take")).at(-1)?.args).toEqual([await folderOf(page), 6, "Viasna"])
  await expect(overview.getByRole("group", { name: "Viasna" }).locator('[data-take="6"]')).toBeVisible()
  await expect(overview.locator('[data-name-pills="6"]')).toHaveCount(0)
})

test("a named take has no pills", async ({ page }) => {
  const overview = await openEvening(page)
  await expect(overview.locator('[data-name-pills="1"]')).toHaveCount(0)
})

test("the pills under a take are one row", async ({ page }) => {
  const overview = await openEvening(page)
  const tops = await overview
    .locator('[data-name-pills="6"] button')
    .evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))])
  expect(tops).toHaveLength(1)
})

test("Send starred sends the starred takes not in the cloud", async ({ page }) => {
  const overview = await openEvening(page)
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toHaveText(/Send starred\s*2/)
  await expect(send).toBeEnabled()
  await send.click()
  await expect.poll(() => callCount(page, "send_starred")).toBe(1)
  expect((await calls(page, "send_starred"))[0].args).toEqual([await folderOf(page)])
  await expect(send).toHaveText(/^\s*Send starred\s*$/)
  await expect(send).toBeDisabled()
  await expect(send).toHaveAttribute("title", "Every ★ take is in the cloud folder")
})

test("Send starred says why it is off when nothing has a star", async ({ page }) => {
  const overview = await openEvening(page, "", [{ name: "Pałyn", duration_sec: 200 }])
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toBeDisabled()
  await expect(send).toHaveAttribute("title", "No take has ★")
  await send.click({ force: true })
  expect(await callCount(page, "send_starred")).toBe(0)
})

test("Send starred is off with no cloud folder, and says where to choose one", async ({ page }) => {
  const overview = await openEvening(page, "window.__CLOUD_DIR__ = null;")
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toBeDisabled()
  await expect(send).toHaveAttribute("title", "Choose a cloud folder in Settings")
})

test("a cloud folder chosen from a take's cloud button turns Send starred on", async ({ page }) => {
  const overview = await openEvening(page, "window.__CLOUD_DIR__ = null;")
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toBeDisabled()
  await row(overview, 1).hover()
  await overview.getByRole("button", { name: /^Copy .* to the cloud$/ }).first().click()
  await page.getByRole("dialog").getByText("Choose").click()
  await expect.poll(() => callCount(page, "choose_cloud_dir")).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(send).toBeEnabled()
  await expect(send).toHaveText(/Send starred\s*2/)
})

test("the songs under the takes nobody named are asked for once", async ({ page }) => {
  const overview = await openEvening(page)
  await expect(overview.locator('[data-name-pills="6"] [data-song-choice]').first()).toBeVisible()
  await expect(overview.locator('[data-name-pills="10"] [data-song-choice]').first()).toBeVisible()
  const folder = await folderOf(page)
  const asked = async () =>
    (await calls(page, "song_choices")).filter((c) => c.args[0] === folder).length
  // Each look reads the whole library, so two takes nobody named, or twelve,
  // are one look between them.
  expect(await asked()).toBe(1)
  await overview.locator('[data-name-pills="6"] [data-song-choice="Viasna"]').click()
  await expect(overview.locator('[data-name-pills="6"]')).toHaveCount(0)
  await expect(overview.locator('[data-name-pills="10"] [data-song-choice]').first()).toBeVisible()
  await expect.poll(asked).toBe(2)
})

test("Clear false starts asks first and removes only them", async ({ page }) => {
  const overview = await openEvening(page)
  const clear = overview.getByRole("button", { name: /Clear false starts/ })
  await expect(clear).toHaveText(/Clear false starts\s*2/)
  await clear.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading")).toHaveText("Move 2 false starts to the Trash?")
  await expect(dialog).toContainText("Pałyn")
  await expect(dialog).toContainText("0:12")
  await expect(dialog).toContainText("Take 10")
  await expect(dialog).toContainText("0:08")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  expect(await callCount(page, "delete_takes")).toBe(0)
  await expect(row(overview, 4)).toBeVisible()

  await clear.click()
  await page.getByRole("dialog").getByRole("button", { name: "Move to the Trash" }).click()
  expect((await calls(page, "delete_takes")).at(-1)?.args).toEqual([await folderOf(page), [4, 10]])
  await expect(row(overview, 4)).toHaveCount(0)
  await expect(row(overview, 10)).toHaveCount(0)
  await expect(row(overview, 2)).toBeVisible()
  await expect(clear).toBeDisabled()
})

test("the buttons sit on their own line in a 960 px window", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  const overview = await openEvening(page)
  const played = await overview.getByText("played", { exact: true }).boundingBox()
  const send = await overview.getByRole("button", { name: /Send starred/ }).boundingBox()
  expect(send!.y).toBeGreaterThan(played!.y + played!.height)
  expect(await overview.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test("clearing a false start playing in the overview lets the player go", async ({ page }) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Play Pałyn 3" }).click()
  await expect(overview.getByRole("button", { name: "Pause Pałyn 3" })).toBeVisible()
  const closes = await callCount(page, "player_close")
  await overview.getByRole("button", { name: /Clear false starts/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Move to the Trash" }).click()
  await expect(row(overview, 4)).toHaveCount(0)
  await expect.poll(() => callCount(page, "player_close")).toBeGreaterThan(closes)
  await expect(overview.getByRole("button", { name: /^Pause / })).toHaveCount(0)
})

// History: Tuesday jam is one take of Pałyn, 20 s here, so a false start;
// Wednesday jam is two takes nobody named.
async function openPast(page: Page, name: string, before = "") {
  await openApp(page, { before: `window.__OLD_LENGTH_SEC__ = 20; window.__CLOUD_DIR__ = '/cloud'; ${before}` })
  await openHistory(page, name)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

test("in History a rehearsal has its false starts and both buttons", async ({ page }) => {
  const overview = await openPast(page, "Tuesday jam")
  await expect(row(overview, 1)).toHaveAttribute("data-false-start")
  await expect(overview.getByRole("button", { name: /Send starred/ })).toHaveAttribute(
    "title",
    "No take has ★"
  )
  await overview.getByRole("button", { name: /Clear false starts/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading")).toHaveText("Move 1 false start to the Trash?")
  await dialog.getByRole("button", { name: "Move to the Trash" }).click()
  expect((await calls(page, "delete_takes")).at(-1)?.args).toEqual(["/rec/old", [1]])
  await expect(page.getByText("No takes", { exact: true })).toBeVisible()
})

test("in History Send starred sends the starred takes of that rehearsal", async ({ page }) => {
  const overview = await openPast(page, "Tuesday jam", "window.__STARRED__ = ['/rec/old#1'];")
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toHaveText(/Send starred\s*1/)
  await send.click()
  expect((await calls(page, "send_starred")).at(-1)?.args).toEqual(["/rec/old"])
  await expect(send).toHaveAttribute("title", "Every ★ take is in the cloud folder")
})

test("in History a pill under an unnamed take names it there", async ({ page }) => {
  const overview = await openPast(page, "Wednesday jam")
  await overview.locator('[data-name-pills="2"] [data-song-choice="Pałyn"]').click()
  expect((await calls(page, "rename_take")).at(-1)?.args).toEqual(["/rec/quiet", 2, "Pałyn"])
})
