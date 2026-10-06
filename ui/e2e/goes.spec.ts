import { calls, callCount, expect, openApp, openHistory, test } from "./app.ts"
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
