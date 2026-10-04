import {
  calls,
  callCount,
  expect,
  openApp,
  openHistory,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// ★ on a take: one click on, one click off, as many per song as are worth
// coming back to. The fuller evening is Polyn 1, Polyn 2 (with a Keep this
// mark), Take 3 and Vesna 1, at /rec/old.

async function openEvening(page: Page, before = "") {
  await openApp(page, { before: `window.__FULL_EVENING__ = true; ${before}` })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

const star = (scope: ReturnType<Page["locator"]>, name: string) =>
  scope.getByRole("button", { name: `Star ${name}`, exact: true })

test("★ on a row goes on and comes off with one click, and opens nothing", async ({ page }) => {
  const overview = await openEvening(page)
  const opens = await callCount(page, "player_open")
  await expect(star(overview, "Polyn 1")).toHaveAttribute("aria-pressed", "false")
  await star(overview, "Polyn 1").click()
  await expect(star(overview, "Polyn 1")).toHaveAttribute("aria-pressed", "true")
  expect((await calls(page, "set_take_star")).at(-1)?.args).toEqual(["/rec/old", 1, true])
  // The row opens its take on a click anywhere else; ★ only stars.
  await expect(overview).toBeVisible()
  expect(await callCount(page, "player_open")).toBe(opens)
  await star(overview, "Polyn 1").click()
  await expect(star(overview, "Polyn 1")).toHaveAttribute("aria-pressed", "false")
  expect((await calls(page, "set_take_star")).at(-1)?.args).toEqual(["/rec/old", 1, false])
})

test("two goes at a song can both have ★, and so can a take with no song", async ({ page }) => {
  const overview = await openEvening(page)
  for (const name of ["Polyn 1", "Polyn 2", "Take 3"]) await star(overview, name).click()
  for (const name of ["Polyn 1", "Polyn 2", "Take 3"])
    await expect(star(overview, name)).toHaveAttribute("aria-pressed", "true")
  await expect(star(overview, "Vesna 1")).toHaveAttribute("aria-pressed", "false")
})

test("the starred take is the green one; a Keep this mark alone is not", async ({ page }) => {
  const overview = await openEvening(page)
  // Polyn 2 carries a Keep this mark: a mark about a moment, not the take.
  await expect(page.locator("[data-take='2'] [data-starred]")).toHaveCount(0)
  await expect(overview.getByText("keep", { exact: true })).toHaveCount(0)
  await star(overview, "Polyn 2").click()
  await expect(page.locator("[data-take='2'] [data-starred]")).toHaveCount(1)
  // The mark is still there, as a mark.
  await expect(overview).toContainText("this one is the take")
})

test("a starred take keeps its ★ in view; the others show it under the mouse", async ({
  page,
}) => {
  const overview = await openEvening(page, "window.__STARRED__ = ['/rec/old#4'];")
  await expect(star(overview, "Vesna 1")).toBeVisible()
  await expect(star(overview, "Vesna 1")).toHaveCSS("opacity", "1")
  await expect(star(overview, "Polyn 1")).toHaveCSS("opacity", "0")
  await page.locator("[data-take='1']").hover()
  await expect(star(overview, "Polyn 1")).toHaveCSS("opacity", "1")
})

test("starring a take while it plays in the overview leaves it playing", async ({ page }) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Play Polyn 2" }).click()
  await expect(overview.getByRole("button", { name: "Pause Polyn 2" })).toBeVisible()
  const opens = await callCount(page, "player_open")
  await star(overview, "Polyn 2").click()
  await expect(star(overview, "Polyn 2")).toHaveAttribute("aria-pressed", "true")
  await expect(overview.getByRole("button", { name: "Pause Polyn 2" })).toBeVisible()
  expect(await callCount(page, "player_open")).toBe(opens)
})

test("a take just saved is starred from the rehearsal's own overview", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await page.getByRole("button", { name: /Save take/ }).click()
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  const button = overview.getByRole("button", { name: /^Star / })
  await button.click()
  await expect(button).toHaveAttribute("aria-pressed", "true")
  expect((await calls(page, "set_take_star")).at(-1)?.args.slice(1)).toEqual([1, true])
})

test("in the player, ★ is beside the open take, and its pill carries it", async ({ page }) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Take 2 Polyn 2" }).click()
  const strip = page.getByRole("group", { name: "Take strip" })
  await expect(star(strip, "Polyn 2")).toHaveAttribute("aria-pressed", "false")
  await star(strip, "Polyn 2").click()
  await expect(star(strip, "Polyn 2")).toHaveAttribute("aria-pressed", "true")
  expect((await calls(page, "set_take_star")).at(-1)?.args).toEqual(["/rec/old", 2, true])
  await expect(strip.getByRole("button", { name: /^Take 2 Polyn 2, starred/ })).toBeVisible()
  await expect(strip.locator("[aria-current='true'] [data-starred]")).toHaveCount(1)
})

test("every starred pill carries ★, not only the open one", async ({ page }) => {
  const overview = await openEvening(page, "window.__STARRED__ = ['/rec/old#1', '/rec/old#3'];")
  await overview.getByRole("button", { name: "Take 4 Vesna 1" }).click()
  const strip = page.getByRole("group", { name: "Take strip" })
  await expect(strip.locator("[data-starred]")).toHaveCount(2)
  await expect(strip.getByRole("button", { name: /^Take 1 Polyn 1, starred/ })).toBeVisible()
  await expect(strip.getByRole("button", { name: /^Take 3 Take 3, starred/ })).toBeVisible()
})
