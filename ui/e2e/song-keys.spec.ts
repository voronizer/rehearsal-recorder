import { callCount, calls, expect, openApp, recordTake, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// ↑ and ↓ on the rehearsal screen pick the next take's song through the rows
// beside the Next take field: the set's, then the other songs (issue #12
// step 8, K1–K5).

type SetSeed = { id: number; name: string; songs: string[] }

/** A page script: the library has this set, Start plays by it, and two more
 *  songs, so the other songs fold after five. */
function withSet(songs: string[]) {
  const set: SetSeed = { id: 1, name: "Gig on the 25th", songs }
  return (
    `window.__SETS__ = ${JSON.stringify([set])};` +
    `window.__MORE_SONGS__ = ["Opus", "Kupalle"];` +
    `localStorage.setItem("mock-python-config", JSON.stringify(` +
    `{theme: "dark", ui_scale: 1, next_set: 1}));`
  )
}

const field = (page: Page) => page.getByRole("textbox", { name: "Next take" })
const rows = (page: Page) => page.locator("[data-song-list] [data-song-row]")
const row = (page: Page, title: string) => page.locator(`[data-song-row="${title}"]`)
const setRow = (page: Page, title: string) => page.locator(`[data-set-song="${title}"]`)
const highlighted = (page: Page) =>
  page
    .locator("[data-next-take-panel] [data-highlighted]")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-set-song") ?? e.getAttribute("data-song-row"))
    )

async function down(page: Page, to: string) {
  await page.keyboard.press("ArrowDown")
  await expect(field(page)).toHaveValue(to)
}

test("down walks the set then the other songs and opens the folded list past the fifth", async ({
  page,
}) => {
  await openApp(page, { before: withSet(["Pałyn", "Viasna"]) })
  await startRehearsal(page)
  await expect(field(page)).toHaveValue("Pałyn")
  await expect(rows(page)).toHaveCount(5)
  await down(page, "Viasna")
  await expect(setRow(page, "Viasna")).toHaveAttribute("aria-current", "true")
  for (const song of ["Ahoń", "Sonca", "Dym", "Ptuška", "Daroha"]) await down(page, song)
  await expect(rows(page)).toHaveCount(5)
  await down(page, "Opus")
  await expect(rows(page)).toHaveCount(7)
  await expect(page.locator("[data-songs-more]")).toHaveText(/Fewer/)
  await expect(row(page, "Opus")).toHaveAttribute("aria-current", "true")
  expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Opus"])
  await page.keyboard.press("ArrowUp")
  await expect(field(page)).toHaveValue("Daroha")
})

test("up at the first row does nothing, down past the last does nothing", async ({ page }) => {
  const all = ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška", "Daroha", "Opus", "Kupalle"]
  await openApp(page, { before: withSet(all) })
  await startRehearsal(page)
  await expect(field(page)).toHaveValue("Pałyn")
  await page.keyboard.press("ArrowUp")
  await page.waitForTimeout(200)
  await expect(field(page)).toHaveValue("Pałyn")
  expect(await callCount(page, "set_next_take_name")).toBe(0)

  await setRow(page, "Kupalle").click()
  await expect(field(page)).toHaveValue("Kupalle")
  const sent = await callCount(page, "set_next_take_name")
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(200)
  await expect(field(page)).toHaveValue("Kupalle")
  expect(await callCount(page, "set_next_take_name")).toBe(sent)
})

test("down from a name that is no row goes to the first row", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await expect(field(page)).toHaveValue("Take 1")
  await page.keyboard.press("ArrowUp")
  await page.waitForTimeout(200)
  await expect(field(page)).toHaveValue("Take 1")
  await down(page, "Pałyn")

  // A song nobody has played, typed: the same.
  await field(page).fill("Novaja")
  await page.keyboard.press("Enter")
  await expect(field(page)).not.toBeFocused()
  await down(page, "Pałyn")
})

test("with a take open the arrows step through the takes and leave the next take", async ({
  page,
}) => {
  await openApp(page, { before: withSet(["Pałyn", "Viasna"]) })
  await startRehearsal(page)
  // Two goes at Pałyn: the strip's ↓ goes from one to the other.
  await recordTake(page, 1)
  await page.getByRole("button", { name: /Save take/ }).click()
  await recordTake(page, 2)
  await page.getByRole("button", { name: /Save take/ }).click()
  await setRow(page, "Viasna").click()
  await expect(field(page)).toHaveValue("Viasna")
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
  const opens = await callCount(page, "player_open")
  const sent = await callCount(page, "set_next_take_name")
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => callCount(page, "player_open")).toBeGreaterThan(opens)
  await expect(field(page)).toHaveValue("Viasna")
  expect(await callCount(page, "set_next_take_name")).toBe(sent)
})

test("while typing, down and up highlight the rows left and Enter names the next take after the highlighted row and leaves the field", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await field(page).click()
  await page.keyboard.type("a")
  const sent = await callCount(page, "set_next_take_name")
  await page.keyboard.press("ArrowDown")
  expect(await highlighted(page)).toEqual(["Pałyn"])
  await page.keyboard.press("ArrowDown")
  expect(await highlighted(page)).toEqual(["Viasna"])
  await page.keyboard.press("ArrowUp")
  expect(await highlighted(page)).toEqual(["Pałyn"])
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  // Dym has no "a" in it: Ahoń is next among the rows left.
  expect(await highlighted(page)).toEqual(["Ahoń"])
  await expect(field(page)).toHaveValue("a")
  await page.keyboard.press("Enter")
  await expect(field(page)).toHaveValue("Ahoń")
  await expect(field(page)).not.toBeFocused()
  expect(await highlighted(page)).toEqual([])
  // What was half typed is not sent on the way out.
  await expect
    .poll(async () => (await calls(page, "set_next_take_name")).slice(sent).map((c) => c.args))
    .toEqual([["Ahoń"]])
})

test("the first click selects the whole name, a second places the caret, leaving without typing keeps it", async ({
  page,
}) => {
  await openApp(page, { before: withSet(["Pałyn", "Viasna"]) })
  await startRehearsal(page)
  const selection = () =>
    field(page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])
  await field(page).click()
  expect(await selection()).toEqual([0, 5])
  await field(page).click()
  const [from, to] = await selection()
  expect(from).toBe(to)

  // Left without typing: the name stays, and nothing is sent.
  await page.keyboard.press("Escape")
  await expect(field(page)).not.toBeFocused()
  await expect(field(page)).toHaveValue("Pałyn")
  expect(await callCount(page, "set_next_take_name")).toBe(0)

  // Typed over: the name is replaced.
  await field(page).click()
  expect(await selection()).toEqual([0, 5])
  await page.keyboard.type("Dym")
  await expect(field(page)).toHaveValue("Dym")
})

test("the arrow keys hint sits beside the label and is hidden while a take is open", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  const group = page.getByRole("group", { name: "Next take" })
  const hint = group.locator("[data-song-keys]")
  await expect(hint).toBeVisible()
  await expect(hint).toHaveAttribute("title", "↑ ↓ the song before or after")
  await expect(hint.locator("kbd")).toHaveText(["↑", "↓"])
  const label = (await group.locator("label").boundingBox())!
  const at = (await hint.boundingBox())!
  expect(at.x).toBeGreaterThan(label.x + label.width)
  expect(Math.abs(at.y + at.height / 2 - (label.y + label.height / 2))).toBeLessThan(3)

  await recordTake(page, 1)
  await page.getByRole("button", { name: /Save take/ }).click()
  const fieldAt = (await field(page).boundingBox())!
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1']").click()
  await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
  await expect(hint).toBeHidden()
  // Gone without moving the field.
  expect((await field(page).boundingBox())!.y).toBeCloseTo(fieldAt.y, 0)
})

test("the arrows do nothing while a dialog is open", async ({ page }) => {
  await openApp(page, { before: withSet(["Pałyn", "Viasna"]) })
  await startRehearsal(page)
  await recordTake(page, 1)
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.hover("[data-take='1']")
  await page.getByRole("button", { name: "Rename take Pałyn 1" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Cancel" }).focus()
  const sent = await callCount(page, "set_next_take_name")
  await page.keyboard.press("ArrowDown")
  await page.waitForTimeout(200)
  await expect(dialog).toBeVisible()
  expect(await callCount(page, "set_next_take_name")).toBe(sent)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(field(page)).toHaveValue("Pałyn")
})

test("the arrows do nothing while Delete take asks", async ({ page }) => {
  await openApp(page, { before: withSet(["Pałyn", "Viasna"]) })
  await startRehearsal(page)
  await recordTake(page, 1)
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.hover("[data-take='1']")
  await page.getByRole("button", { name: "Delete take Pałyn 1" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  const sent = await callCount(page, "set_next_take_name")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowUp")
  await page.waitForTimeout(200)
  await expect(dialog).toBeVisible()
  expect(await callCount(page, "set_next_take_name")).toBe(sent)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(field(page)).toHaveValue("Pałyn")
})

test("a row picked by a key is scrolled into view", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 560 })
  await openApp(page, { before: withSet(["Pałyn", "Viasna", "Ahoń", "Sonca"]) })
  await startRehearsal(page)
  for (const song of ["Viasna", "Ahoń", "Sonca", "Dym", "Ptuška", "Daroha", "Opus", "Kupalle"])
    await down(page, song)
  await expect(row(page, "Kupalle")).toBeInViewport()
})

test("with six songs played tonight and the list folded, down goes to the first row shown", async ({
  page,
}) => {
  const tonight = ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška"]
    .map((name) => `{name: '${name}', duration_sec: 60}`)
    .concat("{name: 'Take 7', duration_sec: 5}")
  await openApp(page, {
    before: `window.__MORE_SONGS__ = ["Opus", "Kupalle"]; window.__TONIGHT__ = [${tonight}];`,
  })
  await startRehearsal(page, 8)
  await expect(field(page)).toHaveValue("Take 8")
  await expect(rows(page)).toHaveCount(5)
  const first = await rows(page).first().getAttribute("data-song-row")
  await down(page, first!)
  await expect(rows(page)).toHaveCount(5)
  const second = await rows(page).nth(1).getAttribute("data-song-row")
  await down(page, second!)
})
