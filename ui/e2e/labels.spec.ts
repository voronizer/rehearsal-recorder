import { calls, expect, openApp, openHistory, recordTake, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// A mark's label is a name and a colour, the library's own (spec
// 2026-10-04-labels-design.md). The fuller evening at /rec/old has a Keep
// this mark on Polyn 2, a plain Note with nothing written on Take 3, and a
// Went wrong one on Vesna 1.

async function openEvening(page: Page, before = "") {
  await openApp(page, { before: `window.__FULL_EVENING__ = true; ${before}` })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

test("a mark with no comment is listed under its take by its label's name", async ({ page }) => {
  const overview = await openEvening(page)
  const take3 = overview.locator("[data-note]").filter({ hasText: "0:05" })
  await expect(take3).toHaveText(/Note$/)
  await expect(overview.locator("[data-note]").filter({ hasText: "0:40" })).toContainText(
    "Went wrong · guitar drifts here"
  )
})

test("a mark is drawn in its label's colour, on the bar and on the waveform", async ({ page }) => {
  const overview = await openEvening(
    page,
    "window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:2, name:'Keep this', colour:'green'}, {id:3, name:'Went wrong', colour:'pink'}];"
  )
  const dot = page.locator("[data-take='4'] [data-mark-colour]")
  await expect(dot).toHaveAttribute("data-mark-colour", "pink")
  // The variable is there in the theme: the dot is not left transparent.
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    "rgba(0, 0, 0, 0)"
  )
  await overview.getByText("guitar drifts here").click()
  await expect(page.locator("[data-marker-at]")).toHaveAttribute("data-colour", "pink")
})

test("the marker dialog's buttons are the labels, in their order, the first chosen", async ({
  page,
}) => {
  await openApp(page, {
    before:
      "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
  })
  // On the review screen, where a mark is held until Save take: the
  // interface gives it the first label itself.
  await startRehearsal(page)
  await recordTake(page)
  await page.getByRole("button", { name: "Add marker" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Marker at")).toBeVisible()
  expect(await dialog.locator("button[aria-pressed]").allInnerTexts()).toEqual([
    "Solo",
    "Note",
    "Went wrong",
  ])
  await expect(dialog.getByRole("button", { name: "Solo" })).toHaveAttribute("aria-pressed", "true")
  await dialog.getByRole("button", { name: "Went wrong" }).click()
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
  const kept = (await calls(page, "keep_take")).at(-1)!.args
  expect((kept[5] as { label_id: number }[])[0].label_id).toBe(3)
})
