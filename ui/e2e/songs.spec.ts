import {
  calls,
  expect,
  openApp,
  openHistory,
  recordTake,
  setFake,
  startButton,
  startRehearsal,
  test,
} from "./app.ts"
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

/** Last time, beside the setup. */
const lastTime = (page: Page) => page.getByRole("complementary", { name: "Last time" })

/** A song in the list, chosen. */
async function chooseSong(page: Page, title: string) {
  await rows(page).and(page.locator(`[data-song='${title}']`)).click()
  await expect(head(page).getByRole("heading", { name: title })).toBeVisible()
}

// Pałyn has two goes in First rehearsal too, after its Daroha 1 and 2.
const EVERY_PALYN = `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn", "Pałyn"];`

const lastOpened = async (page: Page) =>
  ((await calls(page, "player_open")).at(-1)?.args[0] as { file: string }[])[0].file

/**
 * Pałyn 2 of Tuesday jam opened from Pałyn's page, scrolled 200 px down,
 * and at 0:30; then ↑ twice, to Pałyn 1 and on to the last go at Pałyn in
 * First rehearsal, the rehearsal before. Returns where 0:30 was sought to.
 */
async function toFirstRehearsal(page: Page): Promise<number> {
  await openApp(page, { before: EVERY_PALYN })
  await openSongs(page)
  await chooseSong(page, "Pałyn")
  await rung(page, "/rec/older").click()
  await rung(page, "/rec/gone").click()
  const songPage = page.getByRole("region", { name: "Pałyn", exact: true })
  await songPage.evaluate((el) => (el.scrollTop = 200))
  await rungGroup(page, "/rec/old").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
  const timeline = page.getByRole("group", { name: "Take timeline" })
  await expect(timeline).toBeVisible()
  const box = (await timeline.boundingBox())!
  const seeks = (await calls(page, "player_seek")).length
  await page.mouse.click(box.x + box.width * (30 / 178), box.y + box.height / 2)
  await expect.poll(async () => (await calls(page, "player_seek")).length).toBe(seeks + 1)
  const at = (await calls(page, "player_seek")).at(-1)!.args[0] as number

  await page.keyboard.press("ArrowUp")
  await expect.poll(() => lastOpened(page)).toBe("/rec/old/p1.wav")
  await page.keyboard.press("ArrowUp")
  await expect.poll(async () => (await calls(page, "get_rehearsal")).at(-1)?.args[0]).toBe("/rec/older")
  await expect.poll(() => lastOpened(page)).toBe("/rec/older/x4.wav")
  await expect
    .poll(async () => (await calls(page, "player_seek")).at(-1)!.args[0] as number)
    .toBeCloseTo(at, 0)
  return at
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

  test("an answer about the songs that comes back after a later one is dropped", async ({
    page,
  }) => {
    type Held = { __HOLD__?: Record<string, Promise<void>>; __RELEASE_LIST__?: () => void }
    await openApp(page, { before: `window.__EXTRA_SONGS__ = ["Opus"];` })
    await openSongs(page)
    await chooseSong(page, "Opus")
    const opus = rows(page).and(page.locator("[data-song='Opus']"))
    const row = rungGroup(page, "/rec/older").locator("[data-take='3']")
    // A star, and the list read again with Opus in it: that answer held on
    // its way back.
    await page.evaluate(() => {
      const w = window as unknown as Held
      w.__HOLD__ = { ...w.__HOLD__, list_songs: new Promise((r) => (w.__RELEASE_LIST__ = r)) }
    })
    const asked = (await calls(page, "list_songs")).length
    await row.hover()
    await row.getByRole("button", { name: "Star Opus 1" }).click()
    await expect.poll(async () => (await calls(page, "list_songs")).length).toBe(asked + 1)
    await page.evaluate(() => delete (window as unknown as Held).__HOLD__?.list_songs)
    // Opus's only go deleted: the list read after it has no Opus.
    await row.hover()
    await row.getByRole("button", { name: "Delete take Opus 1" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
    await expect(opus).toHaveCount(0)
    // The held answer arrives last, and is older news than what is shown:
    // still no Opus a moment later. Waiting for the row to go cannot see it
    // come back.
    await page.evaluate(() => (window as unknown as Held).__RELEASE_LIST__?.())
    await page.waitForTimeout(300)
    await expect(opus).toHaveCount(0)
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

  test("a go opened from a song's page, and Escape back to the same song where it was", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 600 })
    await openApp(page, {
      before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn", "Pałyn", "Pałyn"];`,
    })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await rung(page, "/rec/older").click()
    await rung(page, "/rec/gone").click()
    const songPage = page.getByRole("region", { name: "Pałyn", exact: true })
    await songPage.evaluate((el) => (el.scrollTop = 200))
    expect(await songPage.evaluate((el) => el.scrollTop)).toBe(200)

    await rungGroup(page, "/rec/old").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
    await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    await expect(
      page.locator("[data-tab='Pałyn'][aria-current='true'] [data-tab-line]")
    ).toHaveText(/^2/)

    await page.keyboard.press("Escape")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await expect(rung(page, "/rec/old")).toHaveAttribute("aria-expanded", "true")
    await expect
      .poll(() => songPage.evaluate((el) => el.scrollTop))
      .toBeGreaterThanOrEqual(196)
    expect(await songPage.evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(204)
  })

  test("from a song's page, the column has every go by time, with its days", async ({
    page,
  }) => {
    await openApp(page, { before: EVERY_PALYN })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await rungGroup(page, "/rec/old").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
    const strip = page.getByRole("group", { name: "Take strip" })
    await strip.getByRole("button", { name: "Songs", exact: true }).click()
    const column = strip.locator("[data-column='Pałyn']")
    // First rehearsal, 25 Aug, then Tuesday jam, 10 Sep; Missing jam's are
    // not on disk.
    await expect(column.locator("[data-day]")).toHaveText(["Tue 25 Aug", "Thu 10 Sep"])
    await expect(column.locator("button[data-go-row]")).toHaveCount(4)
    await expect(column.getByRole("button", { name: /Pałyn [89]/ })).toHaveCount(0)
    await expect(column.locator("button[aria-current='true']")).toHaveAccessibleName(
      /^Take 2 Pałyn 2/
    )
  })

  test("a song with many goes keeps its column short, and the player in view", async ({
    page,
  }) => {
    // Every go at a song from its page can be dozens: the column scrolls in
    // its place rather than pushing the player off the window.
    await openApp(page, {
      before: `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = Array(24).fill("Pałyn");`,
    })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await rungGroup(page, "/rec/old").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
    const strip = page.getByRole("group", { name: "Take strip" })
    await strip.getByRole("button", { name: "Songs", exact: true }).click()
    const column = strip.locator("[data-column='Pałyn']")
    await expect(column.locator("button[data-go-row]")).toHaveCount(26)
    await expect(column.locator("button[aria-current='true']")).toBeInViewport()
    await expect(page.getByRole("toolbar", { name: "Transport" })).toBeInViewport()
  })

  test("↑ goes on into the rehearsal before, with the place kept", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 600 })
    await toFirstRehearsal(page)
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
    const strip = page.getByRole("group", { name: "Take strip" })
    expect(
      await strip
        .locator("[data-tab]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-tab")))
    ).toEqual(["Daroha", "Pałyn"])
    await expect(strip.locator("[data-tab][aria-current='true']")).toHaveAttribute("data-tab", "Pałyn")

    await page.keyboard.press("Escape")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    const songPage = page.getByRole("region", { name: "Pałyn", exact: true })
    await expect.poll(() => songPage.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(196)
    expect(await songPage.evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(204)
  })

  test("another song picked there goes through that evening's goes only", async ({ page }) => {
    await toFirstRehearsal(page)
    const strip = page.getByRole("group", { name: "Take strip" })
    await strip.getByRole("button", { name: /^Daroha, go 2/ }).click()
    await expect(strip.locator("[data-tab][aria-current='true']")).toHaveAttribute("data-tab", "Daroha")
    await strip.getByRole("button", { name: "Songs", exact: true }).click()
    const column = strip.locator("[data-column='Daroha']")
    await expect(column.locator("[data-day]")).toHaveCount(0)
    await expect(column.locator("button[data-go-row]")).toHaveCount(2)
  })

  test("a go of another rehearsal than the one chosen opens with its own rehearsal's takes", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await openSongs(page)
    // Rehearsals has Tuesday jam chosen; Daroha's goes are First rehearsal's.
    await rungGroup(page, "/rec/older").getByRole("button", { name: "Take 1 Daroha 1" }).click()
    await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
    const strip = page.getByRole("group", { name: "Take strip" })
    await expect(strip.locator("[data-tab='Daroha']")).toHaveAttribute("aria-current", "true")
    await strip.getByRole("button", { name: "Songs", exact: true }).click()
    await expect(strip.getByRole("button", { name: /^Take 2 Daroha 2/ })).toBeVisible()
    await expect(strip.getByRole("button", { name: /Pałyn/ })).toHaveCount(0)
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/older/d1.wav" },
    ])
    await strip.getByRole("button", { name: "Songs", exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
  })

  test("a rename in the player is read again on the song's page", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await rungGroup(page, "/rec/old").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
    await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
    const id = (await calls(page, "get_song")).at(-1)?.args[0]
    await page.getByRole("button", { name: "Rename take Pałyn 2" }).click()
    await page.getByRole("dialog").locator("input").fill("Viasna")
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click()
    await expect.poll(async () => (await calls(page, "rename_take")).length).toBe(1)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await expect
      .poll(async () => {
        const all = await page.evaluate(
          () => (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__
        )
        const renamed = all.findIndex((c) => c.name === "rename_take")
        return all.slice(renamed + 1).some((c) => c.name === "get_song" && c.args[0] === id)
      })
      .toBe(true)
  })

  test("a go open in the player from a song's page shows its cloud copy once it is made", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__ACTIVITY__ = [];" })
    await openSongs(page)
    await chooseSong(page, "Daroha")
    // First rehearsal's, while Rehearsals has Tuesday jam chosen.
    await rungGroup(page, "/rec/older").getByRole("button", { name: "Take 1 Daroha 1" }).click()
    await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
    await expect(page.getByRole("button", { name: "Copy Daroha 1 to the cloud" })).toBeVisible()
    // Past the first answer about background work, which is old news.
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __ACTIVITY_POLLS__?: number }).__ACTIVITY_POLLS__ ?? 0)
      )
      .toBeGreaterThanOrEqual(2)
    // The copy, made in the background: Python records it as it finishes.
    await setFake(page, "__SHARED__", ["/rec/older#1"])
    await setFake(page, "__ACTIVITY__", [
      {
        id: 1,
        kind: "cloud",
        title: "“Daroha 1” → cloud",
        folder: "/rec/older",
        take_number: 1,
        state: "done",
        fraction: 1,
        step: null,
        error: null,
        detail: null,
        retry: null,
        seen: false,
      },
    ])
    await expect(page.getByRole("button", { name: "Cloud copies of Daroha 1" })).toBeVisible()
  })

  test("open the rehearsal in Rehearsals", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await rungGroup(page, "/rec/older")
      .getByRole("button", { name: "Open First rehearsal, Tue 25 Aug in Rehearsals" })
      .click()
    await expect(page.getByRole("navigation", { name: "Rehearsals" })).toBeVisible()
    await expect(page.getByRole("region", { name: "First rehearsal" })).toBeVisible()
    expect((await calls(page, "save_history_view")).map((c) => c.args[0])).toEqual([
      "songs",
      "rehearsals",
    ])
  })

  test("a song on the setup screen opens its page, and Escape goes back to setup", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await lastTime(page).getByRole("button", { name: "Open the song Pałyn" }).click()
    await expect(page.getByRole("navigation", { name: "Songs" })).toBeVisible()
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(startButton(page)).toBeVisible()
  })

  test("a not-played song on the setup screen opens its page", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await lastTime(page)
      .getByRole("region", { name: "Not played last time" })
      .getByRole("button", { name: "Open the song Daroha" })
      .click()
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
  })

  test("a song heading in a rehearsal's overview opens its page, and the rehearsal stays chosen", async ({
    page,
  }) => {
    await openApp(page)
    await openHistory(page, "First rehearsal")
    await expect(page.getByRole("region", { name: "First rehearsal" })).toBeVisible()
    await page
      .getByRole("region", { name: "Rehearsal overview" })
      .getByRole("button", { name: "Open the song Daroha" })
      .click()
    await expect(page.getByRole("navigation", { name: "Songs" })).toBeVisible()
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
    await page.getByRole("button", { name: "Rehearsals", exact: true }).click()
    await expect(page.getByRole("region", { name: "First rehearsal" })).toBeVisible()
  })

  test("Not named opens its page, from the setup screen and from History", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await lastTime(page).getByRole("button", { name: "Open Not named" }).click()
    await expect(
      page.getByRole("navigation", { name: "Songs" }).locator("[aria-current='true']")
    ).toHaveAttribute("data-song", "Not named")
    await expect(head(page)).toContainText("Takes nobody named. Rename one to give it a song.")

    await page.keyboard.press("Escape")
    // History comes back on the view used last, Songs.
    await page.getByRole("button", { name: "History", exact: true }).click()
    await page.getByRole("button", { name: "Rehearsals", exact: true }).click()
    await page
      .getByRole("navigation", { name: "Rehearsals" })
      .getByRole("button", { name: /^Tuesday jam/ })
      .click()
    await page
      .getByRole("region", { name: "Rehearsal overview" })
      .getByRole("button", { name: "Open Not named" })
      .click()
    await expect(
      page.getByRole("navigation", { name: "Songs" }).locator("[aria-current='true']")
    ).toHaveAttribute("data-song", "Not named")
    await expect(head(page)).toContainText("Takes nobody named. Rename one to give it a song.")
  })

  test("the name field's songs still only name the take", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    const pills = page.getByRole("group", { name: "Take name" }).locator("[data-song-choice]")
    await pills.filter({ hasText: /^Ahoń 1$/ }).click()
    await expect(page.locator("#take-name")).toHaveValue("Ahoń")
    expect(await calls(page, "list_songs")).toHaveLength(0)
  })

  test("a rehearsal opened from the setup screen shows in Rehearsals, whatever view was used last", async ({
    page,
  }) => {
    await openApp(page)
    await openSongs(page)
    await page.keyboard.press("Escape")
    await lastTime(page)
      .getByRole("region", { name: "Earlier" })
      .getByRole("button", { name: /First rehearsal/ })
      .click()
    await expect(page.getByRole("navigation", { name: "Rehearsals" })).toBeVisible()
    await expect(page.getByRole("region", { name: "First rehearsal" })).toBeVisible()
  })

  test("deleting a rehearsal takes its songs off the Songs view", async ({ page }) => {
    // Opus is played at First rehearsal only; Daroha there and at Missing jam.
    await openApp(page, { before: `window.__EXTRA_SONGS__ = ["Opus"];` })
    await openSongs(page)
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(1)
    await page.getByRole("button", { name: "Rehearsals", exact: true }).click()
    await page
      .getByRole("navigation", { name: "Rehearsals" })
      .getByRole("button", { name: /^First rehearsal/ })
      .click()
    await page.getByRole("button", { name: "Delete rehearsal First rehearsal" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByRole("button", { name: "Songs", exact: true }).click()
    await expect(rows(page).and(page.locator("[data-song='Pałyn']"))).toHaveCount(1)
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(0)
    await expect(rows(page).and(page.locator("[data-song='Daroha']"))).toContainText(
      "2 goes · 1 rehearsal"
    )
  })

  test("a mark dropped in a go's player is on the song's page after Escape", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await rungGroup(page, "/rec/old").getByRole("button", { name: "Take 2 Pałyn 2" }).click()
    await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
    await page.keyboard.press("m")
    await expect.poll(async () => (await calls(page, "add_take_marker")).length).toBe(1)
    // The fake keeps no marks on past takes, so no note dialog opens here; in
    // the app it does, and is shut without a note.
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    // The page is read again after the mark, so its ticks and From last time have it.
    await expect
      .poll(async () => {
        const all = await page.evaluate(
          () => (window as unknown as { __CALLS__: { name: string }[] }).__CALLS__
        )
        const marked = all.findIndex((c) => c.name === "add_take_marker")
        return marked >= 0 && all.slice(marked + 1).some((c) => c.name === "get_song")
      })
      .toBe(true)
  })

  test("every go of an evening shows on its rung, however many", async ({ page }) => {
    await openApp(page, {
      before: `window.__EXTRA_SONGS__ = Array(9).fill("Daroha");`,
    })
    await openSongs(page)
    const bars = rung(page, "/rec/older").locator("[data-bars] > span")
    await expect(bars).toHaveCount(11)
    const fit = await rung(page, "/rec/older")
      .locator("[data-bars]")
      .evaluate((row) => {
        const edge = row.getBoundingClientRect().right
        return [...row.children].every((bar) => {
          const box = bar.getBoundingClientRect()
          return box.width > 0 && box.right <= edge + 0.5
        })
      })
    expect(fit).toBe(true)
  })
})
