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

/** A rung of the ladder, by its rehearsal's folder: the line that opens it. */
const rung = (page: Page, folder: string) => page.locator(`[data-rung="${folder}"]`)

/** The same rung with the goes listed under it while it is open. */
const rungGroup = (page: Page, folder: string) =>
  page.locator(`[data-rung-group="${folder}"]`)

/** A song in the list, chosen. */
async function chooseSong(page: Page, title: string) {
  await rows(page).and(page.locator(`[data-song='${title}']`)).click()
  await expect(head(page).getByRole("heading", { name: title })).toBeVisible()
}

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

  test("a song's ladder has a rung per rehearsal, newest first, the newest on disk open", async ({
    page,
  }) => {
    await openApp(page, {
      before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn"];`,
    })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    const rungs = page.locator("[data-rung]")
    await expect(rungs).toHaveCount(3)
    expect(await rungs.evaluateAll((els) => els.map((e) => e.getAttribute("data-rung")))).toEqual([
      "/rec/old",
      "/rec/older",
      "/rec/gone",
    ])
    await expect(rung(page, "/rec/old")).toHaveAttribute("aria-expanded", "true")
    await expect(rung(page, "/rec/older")).toHaveAttribute("aria-expanded", "false")
    await expect(rung(page, "/rec/gone")).toHaveAttribute("aria-expanded", "false")
    const open = rungGroup(page, "/rec/old")
    await expect(open.getByRole("button", { name: "Play Pałyn 1" })).toBeVisible()
    await expect(open.getByRole("button", { name: "Play Pałyn 2" })).toBeVisible()
    await expect(rungGroup(page, "/rec/older").locator("[data-take]")).toHaveCount(0)
  })

  test("a rung opens and closes, and stays open while history is", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    const gone = rungGroup(page, "/rec/gone").locator("[data-take]")
    await rung(page, "/rec/gone").click()
    await expect(gone).toHaveCount(2)
    await rung(page, "/rec/gone").click()
    await expect(gone).toHaveCount(0)
    await rung(page, "/rec/gone").click()
    await expect(gone).toHaveCount(2)

    await chooseSong(page, "Daroha")
    await chooseSong(page, "Pałyn")
    await expect(rung(page, "/rec/gone")).toHaveAttribute("aria-expanded", "true")
    await expect(gone).toHaveCount(2)
  })

  test("a rehearsal not on disk is greyed, with nothing to play or open", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await expect(rung(page, "/rec/gone")).toContainText("not on disk")
    await rung(page, "/rec/gone").click()
    const gone = rungGroup(page, "/rec/gone")
    await expect(gone.locator("[data-take]")).toHaveCount(2)
    await expect(gone.locator("[data-take='1']")).toContainText("Not found on disk")
    await expect(gone.getByRole("button", { name: /^Play Pałyn/ })).toHaveCount(0)
    await expect(gone.getByRole("button", { name: /^Rename take/ })).toHaveCount(0)
    await expect(gone.getByRole("button", { name: /^Star / })).toHaveCount(0)

    const bar = gone.getByRole("button", { name: "Take 1 Pałyn 8" })
    await expect(bar).toBeDisabled()
    const opens = (await calls(page, "player_open")).length
    await bar.click({ force: true })
    await gone.locator("[data-take='1']").click({ position: { x: 4, y: 4 } })
    expect(await calls(page, "player_open")).toHaveLength(opens)
    await expect(head(page)).toBeVisible()
  })

  test("starred goes come first, and from last time lists the marks", async ({ page }) => {
    await openApp(page, {
      before: "window.__FULL_EVENING__ = true; window.__STARRED__ = ['/rec/old#2'];",
    })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    const starred = page.getByRole("region", { name: "Starred" })
    await expect(starred.locator("[data-take]")).toHaveCount(1)
    await expect(starred.locator("[data-take='2']")).toContainText("Pałyn 2")
    await expect(starred.locator("[data-take='2']")).toContainText("Tuesday jam · Thu 10 Sep")

    const last = page.getByRole("region", { name: "From last time" })
    await expect(last).toContainText("From last time · Thu 10 Sep")
    await expect(last.locator("[data-note]")).toHaveCount(1)
    await last.getByRole("button", { name: /this one is the take/ }).click()
    await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
    await expect
      .poll(async () => (await calls(page, "player_seek")).at(-1)?.args[0] as number)
      .toBeCloseTo(72, 0)
  })

  test("a go played on the ladder, then the same take number in another rehearsal", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await openSongs(page)
    const older = rungGroup(page, "/rec/older")
    await older.getByRole("button", { name: "Play Daroha 1" }).click()
    await expect(older.getByRole("button", { name: "Pause Daroha 1" })).toBeVisible()
    const closes = (await calls(page, "player_close")).length

    await page.getByRole("button", { name: "Rehearsals", exact: true }).click()
    await expect(page.getByRole("region", { name: "Tuesday jam" })).toBeVisible()
    // Nothing was chosen anew, so Daroha 1 plays on.
    expect(await calls(page, "player_close")).toHaveLength(closes)
    // Tuesday jam's take 1 is not First rehearsal's take 1.
    const overview = page.getByRole("region", { name: "Rehearsal overview" })
    const pałyn1 = overview.getByRole("button", { name: "Play Pałyn 1" })
    await expect(pałyn1).toBeVisible()
    const opens = (await calls(page, "player_open")).length
    const toggles = (await calls(page, "player_toggle")).length
    await pałyn1.click()
    await expect.poll(async () => (await calls(page, "player_open")).length).toBe(opens + 1)
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/old/p1.wav" },
    ])
    expect(await calls(page, "player_toggle")).toHaveLength(toggles)
  })

  test("deleting a song's only go moves to its neighbour", async ({ page }) => {
    await openApp(page, { before: `window.__EXTRA_SONGS__ = ["Opus"];` })
    await openSongs(page)
    await chooseSong(page, "Opus")
    const row = rungGroup(page, "/rec/older").locator("[data-take='3']")
    await row.hover()
    await row.getByRole("button", { name: "Delete take Opus 1" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(0)
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
  })

  test("starring a go on the ladder", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    const row = rungGroup(page, "/rec/older").locator("[data-take='2']")
    await row.hover()
    await row.getByRole("button", { name: "Star Daroha 2" }).click()
    await expect
      .poll(async () => (await calls(page, "set_take_star")).at(-1)?.args)
      .toEqual(["/rec/older", 2, true])
    await expect(row.getByRole("button", { name: "Star Daroha 2" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(rung(page, "/rec/older").locator("[data-starred]")).toHaveCount(1)
  })
})
