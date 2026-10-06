import { calls, expect, openApp, openHistory, test } from "./app.ts"
import type { Page } from "@playwright/test"

// History's Songs view, against the fake's library: Tuesday jam (Pałyn),
// Wednesday jam (nothing named), First rehearsal (Daroha ×2) and Missing
// jam, whose folder is not on disk (Pałyn and Daroha, two of each).

/** History, switched to its Songs view: the list of songs. */
async function openSongs(page: Page) {
  await openHistory(page)
  await page.getByRole("button", { name: "Songs", exact: true }).click()
  const list = page.getByRole("navigation", { name: "Songs" })
  await expect(list).toBeVisible()
  return list
}

/** The rows of the list, by the song each is. */
const rows = (page: Page) =>
  page.getByRole("navigation", { name: "Songs" }).locator("[data-song]")

/** The head of the song's page on show. */
const head = (page: Page) => page.locator("[data-song-head]")

test.describe("Songs in History", () => {
  test("the switch shows the songs, and history opens on the view used last", async ({
    page,
  }) => {
    await openApp(page)
    await openSongs(page)
    expect((await calls(page, "save_history_view")).map((c) => c.args[0])).toEqual(["songs"])

    // A restart: the window comes back with nothing in it but what Python kept.
    await page.reload()
    await expect(page.getByRole("button", { name: "History", exact: true })).toBeVisible()
    await page.evaluate(() => {
      const w = window as unknown as { __sawRehearsals?: boolean }
      new MutationObserver(() => {
        if (document.querySelector("nav[aria-label='Rehearsals']")) w.__sawRehearsals = true
      }).observe(document.body, { childList: true, subtree: true })
    })
    await page.getByRole("button", { name: "History", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Songs" })).toBeVisible()
    // Not the Rehearsals view first and the Songs view after it.
    expect(
      await page.evaluate(() => (window as unknown as { __sawRehearsals?: boolean }).__sawRehearsals)
    ).toBeFalsy()
  })

  test("songs are in alphabetical order, any script, case-blind, with Not named last", async ({
    page,
  }) => {
    await openApp(page, {
      before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["bridge jam", "Дорога", "Echo"];`,
    })
    await openSongs(page)
    // In code-point order "bridge jam" would come after "Viasna".
    await expect(rows(page)).toHaveCount(7)
    expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-song")))).toEqual([
      "bridge jam",
      "Daroha",
      "Echo",
      "Pałyn",
      "Viasna",
      "Дорога",
      "Not named",
    ])
  })

  test("up and down go through the songs, and the song stays chosen across the switch", async ({
    page,
  }) => {
    await openApp(page)
    const list = await openSongs(page)
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
    await expect(list.locator("[aria-current='true']")).toHaveAttribute("data-song", "Daroha")

    await page.keyboard.press("ArrowDown")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await page.keyboard.press("ArrowUp")
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()

    await page.keyboard.press("ArrowDown")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await page.getByRole("button", { name: "Rehearsals", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Rehearsals" })).toBeVisible()
    await page.getByRole("button", { name: "Songs", exact: true }).click()
    await expect(list.locator("[aria-current='true']")).toHaveAttribute("data-song", "Pałyn")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
  })

  test("a song counts its goes, rehearsals and stars", async ({ page }) => {
    await openApp(page, { before: "window.__STARRED__ = ['/rec/older#1'];" })
    await openSongs(page)
    const daroha = rows(page).and(page.locator("[data-song='Daroha']"))
    // The year shows once the clock passes New Year.
    await expect(daroha).toContainText(/4 goes · 2 rehearsals · last 25 Aug( 2026)?/)
    await expect(daroha).toContainText("★ 1")
    await expect(head(page)).toContainText(
      /4 goes in 2 rehearsals · first 20 Aug( 2026)? · last 25 Aug( 2026)?/
    )
  })

  test("the play button on a song's head plays its newest starred go", async ({ page }) => {
    await openApp(page, { before: "window.__STARRED__ = ['/rec/older#1'];" })
    await openSongs(page)
    await expect(head(page)).toContainText("▶ plays ★ Daroha 1 · Tue 25 Aug")
    await head(page).getByRole("button", { name: "Play Daroha 1" }).click()
    await expect(head(page).getByRole("button", { name: "Pause Daroha 1" })).toBeVisible()
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/older/d1.wav" },
    ])
  })

  test("with no star, the play button plays the last go on disk", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await expect(head(page)).toContainText("▶ plays the last go, Daroha 2 · Tue 25 Aug")
  })

  test("Not named has no play button", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await rows(page).and(page.locator("[data-song='Not named']")).click()
    await expect(head(page)).toContainText("Takes nobody named. Rename one to give it a song.")
    await expect(head(page).getByRole("button", { name: /^Play/ })).toHaveCount(0)
  })
})
