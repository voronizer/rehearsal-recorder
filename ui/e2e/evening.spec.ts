import {
  calls,
  callCount,
  expect,
  notices,
  openApp,
  openBandApp,
  openEvening,
  openHistory,
  settled,
  startRehearsal,
  style,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// Sorting the evening on the rehearsal screen: false starts drawn as such,
// song pills under the takes nobody named, Send starred and Clear false
// starts at the head of the songs. Its takes are TONIGHT, in app.ts.

/** The rehearsal's folder, as the fake made it from the name it was given. */
async function folderOf(page: Page) {
  return `/rec/${(await calls(page, "start_rehearsal"))[0].args[0]}`
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
  await expect(send).toHaveAccessibleDescription("Every ★ take is in the cloud folder")
})

test("Send starred says why it is off when nothing has a star", async ({ page }) => {
  const overview = await openEvening(page, "", [{ name: "Pałyn", duration_sec: 200 }])
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toBeDisabled()
  await expect(send).toHaveAccessibleDescription("No take has ★")
  await send.click({ force: true })
  expect(await callCount(page, "send_starred")).toBe(0)
})

test("Send starred is off with no cloud folder, and says where to choose one", async ({ page }) => {
  const overview = await openEvening(page, "window.__CLOUD_DIR__ = null;")
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toBeDisabled()
  await expect(send).toHaveAccessibleDescription("Choose a cloud folder in Settings")
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

test("Clear false starts removes only them at once, and Undo puts them back", async ({ page }) => {
  const overview = await openEvening(page)
  const clear = overview.getByRole("button", { name: /Clear false starts/ })
  await expect(clear).toHaveText(/Clear false starts\s*2/)
  await clear.click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect((await calls(page, "delete_takes")).at(-1)?.args).toEqual([await folderOf(page), [4, 10]])
  await expect(row(overview, 4)).toHaveCount(0)
  await expect(row(overview, 10)).toHaveCount(0)
  await expect(row(overview, 2)).toBeVisible()
  await expect(clear).toBeDisabled()

  const notice = notices(page).filter({ hasText: "2 false starts went to the Trash." })
  await notice.getByRole("button", { name: "Undo" }).click()
  await expect(row(overview, 4)).toBeVisible()
  await expect(row(overview, 10)).toBeVisible()
  await expect(clear).toHaveText(/Clear false starts\s*2/)
})

test("Send starred says which take it could not send, and why", async ({ page }) => {
  const overview = await openEvening(page, "window.__UNSENDABLE__ = [2];")
  await overview.getByRole("button", { name: /Send starred/ }).click()
  await expect(page.getByText("Could not send Pałyn #2: The take has no files left on disk")).toBeVisible()
})

test("Clear false starts is off while it clears", async ({ page }) => {
  // The fake takes 3 s to clear, so a busy machine still sees the button
  // disabled well inside that time; the check below gives it 2 s of it.
  const overview = await openEvening(page, "window.__DELETE_MS__ = 3000;")
  const clear = overview.getByRole("button", { name: /Clear false starts/ })
  await clear.click()
  // Still clearing: pressed again, it does nothing.
  await expect(clear).toBeDisabled({ timeout: 2000 })
  await clear.click({ force: true })
  await expect(row(overview, 4)).toHaveCount(0)
  expect(await callCount(page, "delete_takes")).toBe(1)
})

test("Not named goes once its last take is cleared", async ({ page }) => {
  const overview = await openEvening(page, "", [
    { name: "Pałyn", duration_sec: 200 },
    { name: "Take 1", duration_sec: 8 },
  ])
  await expect(overview.getByRole("group", { name: "Not named" })).toBeVisible()
  await overview.getByRole("button", { name: /Clear false starts/ }).click()
  await expect(overview.getByRole("group", { name: "Not named" })).toHaveCount(0)
  await expect(overview.getByRole("group", { name: "Pałyn" })).toBeVisible()
})

test("the buttons and the legend share the songs group's head in a 960 px window", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  const overview = await openEvening(page)
  await settled(page)
  const head = (await overview.locator("[data-overview-head]").boundingBox())!
  const send = (await overview.getByRole("button", { name: /Send starred/ }).boundingBox())!
  const clear = (await overview.getByRole("button", { name: /Clear false starts/ }).boundingBox())!
  // Tonight has one mark, so the legend is one entry: "1 Note".
  const legend = (await overview.locator("[data-overview-head]").getByText("1 Note").boundingBox())!
  for (const [what, at] of [["Send starred", send], ["Clear false starts", clear], ["the legend", legend]] as const) {
    expect(at.x, `${what} inside the head, left`).toBeGreaterThanOrEqual(head.x)
    expect(at.x + at.width, `${what} inside the head, right`).toBeLessThanOrEqual(head.x + head.width)
    expect(at.y, `${what} inside the head, top`).toBeGreaterThanOrEqual(head.y)
    expect(at.y + at.height, `${what} inside the head, bottom`).toBeLessThanOrEqual(head.y + head.height)
  }
  // The legend on the left, on the row of the buttons, which are on the right.
  const middle = legend.y + legend.height / 2
  expect(middle, "the legend on the buttons' row").toBeGreaterThan(send.y)
  expect(middle, "the legend on the buttons' row").toBeLessThan(send.y + send.height)
  expect(legend.x + legend.width, "the legend before the buttons").toBeLessThanOrEqual(send.x)
  expect(await overview.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test("with the stress band the buttons go under the legend and stay on the right", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openBandApp(page, { stress: "rehearsal" })
  await startRehearsal(page, 33)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  await settled(page)
  const head = overview.locator("[data-overview-head]")
  const box = (await head.boundingBox())!
  const pad = parseFloat((await style(head, "padding-right"))["padding-right"])
  expect(pad).toBe(24)
  const send = (await overview.getByRole("button", { name: /Send starred/ }).boundingBox())!
  const clear = (await overview.getByRole("button", { name: /Clear false starts/ }).boundingBox())!
  const legend = (await head.locator("> div").first().boundingBox())!
  // The legend takes the head's first line; the buttons have one of their
  // own under it, at its right end, where they are when the two share one.
  expect(send.y, "Send starred under the legend").toBeGreaterThanOrEqual(legend.y + legend.height)
  expect(clear.y, "Clear false starts under the legend").toBeGreaterThanOrEqual(legend.y + legend.height)
  expect(Math.abs(clear.x + clear.width - (box.x + box.width - pad))).toBeLessThan(0.5)
})

test("clearing a false start playing in the overview lets the player go", async ({ page }) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Play Pałyn 3" }).click()
  await expect(overview.getByRole("button", { name: "Pause Pałyn 3" })).toBeVisible()
  const closes = await callCount(page, "player_close")
  await overview.getByRole("button", { name: /Clear false starts/ }).click()
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
  await expect(overview.getByRole("button", { name: /Send starred/ })).toHaveAccessibleDescription(
    "No take has ★"
  )
  await overview.getByRole("button", { name: /Clear false starts/ }).click()
  expect((await calls(page, "delete_takes")).at(-1)?.args).toEqual(["/rec/old", [1]])
  await expect(page.getByText("No takes", { exact: true })).toBeVisible()
  await notices(page)
    .filter({ hasText: "1 false start went to the Trash." })
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(row(overview, 1)).toHaveAttribute("data-false-start")
})

test("in History Send starred sends the starred takes of that rehearsal", async ({ page }) => {
  const overview = await openPast(page, "Tuesday jam", "window.__STARRED__ = ['/rec/old#1'];")
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toHaveText(/Send starred\s*1/)
  await send.click()
  expect((await calls(page, "send_starred")).at(-1)?.args).toEqual(["/rec/old"])
  await expect(send).toHaveText(/^\s*Send starred\s*$/)
  await expect(send).toBeDisabled()
})

test("in History a starred take on its way says so, in its row and in the tooltip", async ({ page }) => {
  const overview = await openPast(page, "Tuesday jam", "window.__STARRED__ = ['/rec/old#1'];")
  const send = overview.getByRole("button", { name: /Send starred/ })
  const polls = () => page.evaluate(() => (window as unknown as { __ACTIVITY_POLLS__: number }).__ACTIVITY_POLLS__)
  const before = await polls()
  await send.click()
  // It asks after the copy at once, not at the next look in two seconds.
  await expect.poll(polls, { timeout: 400 }).toBeGreaterThan(before)
  await expect(row(overview, 1)).toContainText("Waiting for the cloud")
  await expect(send).toHaveAccessibleDescription("Every ★ take is in the cloud folder or on its way")
})

test("in History a pill under an unnamed take names it there", async ({ page }) => {
  const overview = await openPast(page, "Wednesday jam")
  await overview.locator('[data-name-pills="2"] [data-song-choice="Pałyn"]').click()
  expect((await calls(page, "rename_take")).at(-1)?.args).toEqual(["/rec/quiet", 2, "Pałyn"])
})
