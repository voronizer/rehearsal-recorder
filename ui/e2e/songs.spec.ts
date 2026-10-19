import {
  callCount,
  calls,
  colour,
  expect,
  headsSeen,
  hold,
  holdFor,
  letGo,
  letThrough,
  notices,
  openApp,
  openBandApp,
  openHistory,
  recordTake,
  scaled,
  setFake,
  settled,
  startButton,
  startRehearsal,
  style,
  test,
  waitingFor,
  watchHeads,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// History's Songs view, against the fake's library: Tuesday jam (Pałyn),
// Wednesday jam (nothing named), First rehearsal (Daroha ×2) and Missing
// jam, whose folder is not on disk (Pałyn and Daroha, two of each).

/** History, switched to its Songs view: the list of songs. */
async function openSongs(page: Page) {
  await openHistory(page)
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
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

/** The id the fake's library gives the song of that title. */
const songId = (page: Page, title: string) =>
  page.evaluate(async (t) => {
    const api = (
      window as unknown as {
        pywebview: { api: { list_songs: () => Promise<{ songs: { id: number; title: string }[] }> } }
      }
    ).pywebview.api
    return (await api.list_songs()).songs.find((s) => s.title === t)!.id
  }, title)

// Pałyn has two goes in First rehearsal too, after its Daroha 1 and 2.
const EVERY_PALYN = `window.__FULL_EVENING__ = true; window.__EXTRA_SONGS__ = ["Pałyn", "Pałyn"];`

const lastOpened = async (page: Page) =>
  ((await calls(page, "player_open")).at(-1)!.args[0] as { file: string }[])[0].file

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
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Rehearsals" })).toBeVisible()
    await page.getByRole("radio", { name: "Songs", exact: true }).click()
    await expect(list.locator("[aria-current='true']")).toHaveAttribute("data-song", "Pałyn")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
  })

  test("a song's page stays until the next song is read, then starts at its top", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 320 })
    await openApp(page)
    const list = await openSongs(page)
    const daroha = page.getByRole("region", { name: "Daroha", exact: true })
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
    await settled(page)
    await daroha.evaluate((el) => (el.scrollTop = el.scrollHeight))
    expect(await daroha.evaluate((el) => el.scrollTop)).toBeGreaterThan(40)

    // Down to Pałyn, its page held: Daroha's stays as it is.
    await watchHeads(page)
    await hold(page, "get_song")
    await page.keyboard.press("ArrowDown")
    await expect(list.locator("[aria-current='true']")).toHaveAttribute("data-song", "Pałyn")
    await page.waitForTimeout(300)
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()

    // Read, Pałyn's page takes its place whole, at its top.
    await letGo(page, "get_song")
    const palyn = page.getByRole("region", { name: "Pałyn", exact: true })
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    expect(await palyn.evaluate((el) => el.scrollTop)).toBe(0)
    expect(await palyn.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
    const heads = await headsSeen(page)
    expect(heads.length).toBeGreaterThan(10)
    expect(heads.filter((h, i) => h !== heads[i - 1])).toEqual(["Daroha", "Pałyn"])
  })

  test("a song opened from another view never shows another song's page first", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await page
      .getByRole("navigation", { name: "Rehearsals" })
      .getByRole("button", { name: /^Tuesday jam/ })
      .click()
    const overview = page.getByRole("region", { name: "Rehearsal overview" })
    await expect(overview.getByRole("button", { name: "Open the song Pałyn" })).toBeVisible()

    // Pałyn from the overview, its page held: Daroha's, read before, is
    // never drawn, and the pane stays empty until Pałyn's is read.
    await watchHeads(page)
    await hold(page, "get_song")
    await overview.getByRole("button", { name: "Open the song Pałyn" }).click()
    await expect(
      page.getByRole("navigation", { name: "Songs" }).locator("[aria-current='true']")
    ).toHaveAttribute("data-song", "Pałyn")
    await page.waitForTimeout(300)
    await expect(head(page)).toHaveCount(0)
    await letGo(page, "get_song")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    // The DOM can be visible before the frame observer samples that paint.
    await expect.poll(() => headsSeen(page)).toContain("Pałyn")
    const heads = await headsSeen(page)
    const seen = heads.filter((h, i) => h !== heads[i - 1])
    expect(seen).not.toContain("Daroha")
    expect(seen.slice(-2)).toEqual([null, "Pałyn"])
  })

  test("a song's page read late, after Songs was left, is not put back for another song", async ({
    page,
  }) => {
    await openApp(page)
    await openSongs(page)
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()

    // Down to Pałyn, its page held; then out of Songs, and back in on
    // Daroha, from First rehearsal's overview.
    await holdFor(page, "get_song", await songId(page, "Pałyn"))
    await page.keyboard.press("ArrowDown")
    await expect(rows(page).and(page.locator("[aria-current='true']"))).toHaveAttribute(
      "data-song",
      "Pałyn"
    )
    await expect.poll(() => waitingFor(page)).toBe(1)
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await page
      .getByRole("navigation", { name: "Rehearsals" })
      .getByRole("button", { name: /^First rehearsal/ })
      .click()
    const overview = page.getByRole("region", { name: "Rehearsal overview" })
    await overview.getByRole("button", { name: "Open the song Daroha" }).click()
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()

    // Pałyn's page comes only now, and is not put back.
    await watchHeads(page)
    await letThrough(page)
    await expect.poll(() => waitingFor(page)).toBe(0)
    await page.waitForTimeout(300)
    await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
    expect(await headsSeen(page)).not.toContain("Pałyn")
  })

  test("Songs entered again on the same song shows its page at once, until the new read", async ({
    page,
  }) => {
    await openApp(page)
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await expect(page.locator("[data-pane-head] h2")).toBeVisible()

    // Back in Songs, Pałyn's page read again and held: the one kept from
    // before is drawn at once, in the same frame as the switch.
    const reads = await callCount(page, "get_song")
    await watchHeads(page)
    await hold(page, "get_song")
    await page.getByRole("radio", { name: "Songs", exact: true }).click()
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await expect.poll(() => callCount(page, "get_song")).toBe(reads + 1)
    await page.waitForTimeout(300)
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    await letGo(page, "get_song")
    await settled(page)
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    const heads = await headsSeen(page)
    const seen = heads.filter((h, i) => h !== heads[i - 1])
    expect(seen).not.toContain(null)
    expect(seen.at(-1)).toBe("Pałyn")
  })

  test("a song counts its goes, rehearsals and stars", async ({ page }) => {
    await openApp(page, { before: "window.__STARRED__ = ['/rec/older#1'];" })
    await openSongs(page)
    const daroha = rows(page).and(page.locator("[data-song='Daroha']"))
    // The year shows once the clock passes New Year.
    await expect(daroha).toContainText(/4 takes · 2 rehearsals · last 25 Aug( 2026)?/)
    await expect(daroha).toContainText("★ 1")
    await expect(head(page)).toContainText(
      /4 takes in 2 rehearsals · first 20 Aug( 2026)? · last 25 Aug( 2026)?/
    )
  })

  test("the play button on a song's head plays its newest starred go", async ({ page }) => {
    await openApp(page, { before: "window.__STARRED__ = ['/rec/older#1'];" })
    await openSongs(page)
    await expect(head(page)).toContainText("▶ plays ★ Daroha 1 · Tue 25 Aug")
    // Space is its key only once its take is the one in hand.
    const play = head(page).getByRole("button", { name: "Play Daroha 1" })
    await expect(play).not.toHaveAttribute("aria-keyshortcuts")
    await play.click()
    const pause = head(page).getByRole("button", { name: "Pause Daroha 1" })
    await expect(pause).toBeVisible()
    await expect(pause).toHaveAttribute("aria-keyshortcuts", "Space")
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/older/d1.wav" },
    ])
  })

  test("with no star, the play button plays the last go on disk", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await expect(head(page)).toContainText("▶ plays the last take, Daroha 2 · Tue 25 Aug")
  })

  test("Not named has no play button", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await rows(page).and(page.locator("[data-song='Not named']")).click()
    await expect(head(page)).toContainText("Takes nobody named. Rename one to give it a song.")
    await expect(head(page).getByRole("button", { name: /^Play/ })).toHaveCount(0)
  })

  test("month headings and Not named have no capitals and no dashed edge", async ({ page }) => {
    // F7: a heading reads as it is written, at one of the five sizes (F5).
    await openApp(page)
    const list = await openHistory(page)
    const month = list.getByRole("heading", { name: "September 2026" })
    expect(await style(month, "text-transform", "letter-spacing", "font-size")).toEqual({
      "text-transform": "none",
      "letter-spacing": "normal",
      "font-size": "12px",
    })

    // F4: Not named is set apart by its place and its grey words, with no
    // frame round it.
    await page.getByRole("radio", { name: "Songs", exact: true }).click()
    const notNamed = rows(page).and(page.locator("[data-song='Not named']"))
    const sides = await style(
      notNamed,
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style"
    )
    expect(Object.values(sides)).not.toContain("dashed")
    expect(
      (await style(notNamed.getByText("Not named", { exact: true }), "text-transform"))["text-transform"]
    ).toBe("none")
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

  test("a rehearsal not on disk has its takes greyed, with nothing to play or open", async ({ page }) => {
    await openApp(page)
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await expect(rung(page, "/rec/gone")).toContainText("Not found on disk")
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

  test("a take not on disk whose copy failed points at no reason that is not there", async ({ page }) => {
    // The reason is drawn, and described, only for a take that is on disk: a
    // row greyed as not found says that and nothing about the cloud.
    const failed = `
      const api = window.pywebview.api; const get = api.get_song;
      api.get_song = async (id) => { const r = await get(id);
        for (const g of r.goes || [])
          if (g.folder === '/rec/gone') g.take.cloud_error = 'Cloud folder not found';
        return r; };
    `
    await openApp(page, { after: failed })
    await openSongs(page)
    await chooseSong(page, "Pałyn")
    await rung(page, "/rec/gone").click()
    const gone = rungGroup(page, "/rec/gone").locator("[data-take='1']")
    await expect(gone).toContainText("Not found on disk")
    await expect(gone).not.toContainText("Not in the cloud")
    const bar = gone.getByRole("button", { name: /^Take 1 Pałyn 8/ })
    await expect(bar).toBeDisabled()
    await expect(bar).not.toHaveAttribute("aria-describedby")
    // Its name says what the row says, not the cloud's status.
    await expect(bar).toHaveAccessibleName("Take 1 Pałyn 8, not found on disk")
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
    await expect(last.locator("button[data-note]")).toHaveCount(1)
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

    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
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
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(0)
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    // Undo puts the go back, and the song with it.
    await notices(page)
      .filter({ hasText: "“Opus 1” went to the Trash." })
      .getByRole("button", { name: "Undo" })
      .click()
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(1)
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
      page.locator("[data-tab='song:Pałyn'][aria-current='true'] [data-tab-line]")
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
    const column = strip.locator("[data-column='song:Pałyn']")
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
    const column = strip.locator("[data-column='song:Pałyn']")
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
    ).toEqual(["song:Daroha", "song:Pałyn"])
    await expect(strip.locator("[data-tab][aria-current='true']")).toHaveAttribute("data-tab", "song:Pałyn")

    await page.keyboard.press("Escape")
    await expect(head(page).getByRole("heading", { name: "Pałyn" })).toBeVisible()
    const songPage = page.getByRole("region", { name: "Pałyn", exact: true })
    await expect.poll(() => songPage.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(196)
    expect(await songPage.evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(204)
  })

  test("another song picked there goes through that evening's goes only", async ({ page }) => {
    await toFirstRehearsal(page)
    const strip = page.getByRole("group", { name: "Take strip" })
    await strip.getByRole("button", { name: /^Daroha, take 2/ }).click()
    await expect(strip.locator("[data-tab][aria-current='true']")).toHaveAttribute("data-tab", "song:Daroha")
    await strip.getByRole("button", { name: "Songs", exact: true }).click()
    const column = strip.locator("[data-column='song:Daroha']")
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
    await expect(strip.locator("[data-tab='song:Daroha']")).toHaveAttribute("aria-current", "true")
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
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
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
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
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
    await page.locator("[data-take-summary]").getByRole("button", { name: "Rename take" }).click()
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
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await page
      .getByRole("navigation", { name: "Rehearsals" })
      .getByRole("button", { name: /^First rehearsal/ })
      .click()
    await page.getByRole("button", { name: "Delete rehearsal First rehearsal" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByRole("radio", { name: "Songs", exact: true }).click()
    await expect(rows(page).and(page.locator("[data-song='Pałyn']"))).toHaveCount(1)
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(0)
    await expect(rows(page).and(page.locator("[data-song='Daroha']"))).toContainText(
      "2 takes · 1 rehearsal"
    )
    // Undo brings the rehearsal back, and its songs with it.
    await notices(page)
      .filter({ hasText: "“First rehearsal” went to the Trash." })
      .getByRole("button", { name: "Undo" })
      .click()
    await expect(rows(page).and(page.locator("[data-song='Opus']"))).toHaveCount(1)
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

// ---------- the song's page on the shared pieces ----------

/** The stress band's long title: more than two lines of the head at 960 px
 *  and 150 %. */
const KALYCHANKA =
  "Kalychanka (slow version for the wedding, with the long intro the bride asked for)"

/** The song's page as History scrolls it: the region named after the song. */
const pane = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true })

/** Whether the page's own scrolling pane, or the window, scrolls sideways. */
const sideways = (it: Locator) =>
  it.evaluate(
    (el) =>
      el.scrollWidth > el.clientWidth + 1 ||
      document.documentElement.scrollWidth > window.innerWidth
  )

/** The page's one group, and its parts in order. */
const group = (page: Page) => page.locator("[data-song-parts]")
const parts = (page: Page) => group(page).locator(":scope > section")

test("the song page's head: play 48 px, the title on two lines then cut, the pencil after it", async ({
  page,
}) => {
  const scale = 1.5
  await page.setViewportSize({ width: 960, height: 680 })
  await page.addInitScript(scaled(scale))
  await openBandApp(page, { stress: true })
  await openSongs(page)
  await rows(page).and(page.locator(`[data-song="${KALYCHANKA}"]`)).click()
  const h = head(page)
  await expect(h.locator("h2 .sr-only")).toHaveText(KALYCHANKA)
  await settled(page)
  // The shared pane head, as a rehearsal's page has it.
  await expect(h).toHaveAttribute("data-pane-head")

  // The shared play button at its head size, before the title.
  const play = h.getByRole("button", { name: `Play ${KALYCHANKA}`, exact: true })
  await expect(play).toHaveAttribute("data-look", "idle")
  const ring = (await play.boundingBox())!
  expect(ring.width).toBeCloseTo(48 * scale, 0)
  expect(ring.height).toBeCloseTo(48 * scale, 0)
  const title = h.getByRole("heading", { level: 2 })
  expect(ring.x + ring.width).toBeLessThanOrEqual((await title.boundingBox())!.x)

  // 20 px, on two lines, then cut: whole to a screen reader and in the
  // shared tip.
  expect((await style(title, "font-size"))["font-size"]).toBe(`${20 * scale}px`)
  const name = h.locator("[data-go-title]")
  await expect(name).toHaveAttribute("data-lines", "2")
  await expect(name).toHaveAttribute("data-cut")
  await name.hover()
  await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(KALYCHANKA)
  await page.mouse.move(0, 0, { steps: 8 })
  // The heading is named by the whole title alone, the pencil apart.
  await expect(h.getByRole("heading", { name: KALYCHANKA, exact: true })).toBeVisible()

  // The pencil right after the last word drawn, on its line.
  const pen = (await h
    .getByRole("button", { name: `Rename song ${KALYCHANKA}`, exact: true })
    .boundingBox())!
  const end = await name.evaluate((el) => {
    const tail = el.querySelector(":scope > .whitespace-nowrap")!
    const range = document.createRange()
    range.selectNodeContents(tail.firstChild!)
    const r = range.getBoundingClientRect()
    return { right: r.right, middle: r.top + r.height / 2 }
  })
  expect(pen.x - end.right, "the pencil after the last word").toBeGreaterThanOrEqual(0)
  expect(pen.x - end.right, "the pencil right after it").toBeLessThan(12 * scale)
  expect(Math.abs(pen.y + pen.height / 2 - end.middle), "on its line").toBeLessThan(4 * scale)

  // Under it, the takes in 14 px and what ▶ plays in 12.
  expect((await style(h.getByText(/^1 take in 1 rehearsal/), "font-size"))["font-size"]).toBe(
    `${14 * scale}px`
  )
  expect((await style(h.getByText(/^▶ plays/), "font-size"))["font-size"]).toBe(`${12 * scale}px`)
  // Nothing scrolls sideways, the open rung of the long rehearsal included.
  const tue = rung(page, "/rec/tue")
  await expect(tue).toHaveAttribute("aria-expanded", "true")
  expect(await sideways(pane(page, KALYCHANKA))).toBe(false)
  // The rehearsal's name is cut on its rung, and whole in the rung's tip.
  const rehearsal = "Tuesday jam at the old brewery, with the horn section and the choir from upstairs"
  expect(await tue.getByText(rehearsal).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await tue.hover()
  await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(rehearsal)
})

test("the song page is one group: Starred, From last time and Every take split by lines", async ({
  page,
}) => {
  await openApp(page, {
    before: "window.__FULL_EVENING__ = true; window.__STARRED__ = ['/rec/old#2'];",
  })
  await openSongs(page)
  await chooseSong(page, "Pałyn")
  await settled(page)
  expect(
    await parts(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
  ).toEqual(["Starred", "From last time", "Every take"])

  // One group on the card's fill, with its 12 px corners and no frame,
  // 32 px under the head.
  expect(
    await style(group(page), "background-color", "border-top-left-radius", "border-top-width")
  ).toEqual({
    "background-color": await colour(page, "--card"),
    "border-top-left-radius": "12px",
    "border-top-width": "0px",
  })
  const top = (await head(page).boundingBox())!
  const all = (await group(page).boundingBox())!
  expect(all.y - (top.y + top.height)).toBeCloseTo(32, 0)

  // 24 px inside each part, and a 1 px line across the whole group above
  // each but the first.
  for (const [i, part] of (await parts(page).all()).entries()) {
    expect(
      await style(part, "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width")
    ).toEqual({
      "padding-top": "24px",
      "padding-right": "24px",
      "padding-bottom": "24px",
      "padding-left": "24px",
      "border-top-width": i === 0 ? "0px" : "1px",
    })
    expect((await part.boundingBox())!.width).toBeCloseTo(all.width, 0)
    expect(await style(part.locator("h3"), "font-size", "font-weight")).toEqual({
      "font-size": "14px",
      "font-weight": "600",
    })
  }
  await expect(parts(page).nth(1).locator("h3")).toHaveText("From last time · Thu 10 Sep")
  const star = parts(page).first().locator("h3").getByText("★")
  expect((await style(star, "color")).color).toBe(await colour(page, "--signal"))

  // A note is the shared button, in 14 px and the regular weight, naming its
  // take.
  const note = parts(page).nth(1).locator("button[data-note]")
  await expect(note).toHaveCount(1)
  await expect(note).toHaveAttribute("data-variant", "ghost")
  expect(await style(note, "font-size", "font-weight")).toEqual({
    "font-size": "14px",
    "font-weight": "400",
  })
  await expect(note).toContainText("Pałyn 2 · ")

  // A song with no star and no marks: Every take alone, with no line above.
  await chooseSong(page, "Daroha")
  await expect(parts(page)).toHaveCount(1)
  await expect(parts(page).first()).toHaveAttribute("aria-label", "Every take")
  expect((await style(parts(page).first(), "border-top-width"))["border-top-width"]).toBe("0px")
})

/** Pałyn 2's mark in Tuesday jam, with a note too long for its line. */
const LONG_NOTE =
  "this one is the take, though the second verse drags a little, the bridge comes in late " +
  "and the ending needs work before the gig on Saturday"
const PALYN_2_LONG_NOTE = `
  const api = window.pywebview.api; const get = api.get_song;
  api.get_song = async (id) => {
    const r = await get(id);
    r.goes = (r.goes || []).map((g) => ({...g, take: {...g.take,
      markers: (g.take.markers || []).map((m) => ({...m, note: ${JSON.stringify(LONG_NOTE)}}))}}));
    return r;
  };
`

test("a note under From last time cut at the end of its line is whole in the tip", async ({ page }) => {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;", after: PALYN_2_LONG_NOTE })
  await openSongs(page)
  await chooseSong(page, "Pałyn")
  await settled(page)
  const note = page.getByRole("region", { name: "From last time" }).locator("button[data-note]")
  await expect(note).toHaveCount(1)
  const words = note.locator("span[data-note] > .truncate")
  expect(await words.evaluate((el) => el.scrollWidth > el.clientWidth), "the note cut").toBe(true)
  await note.hover()
  await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(
    `Pałyn 2 · Keep this · ${LONG_NOTE}`
  )
})

/** Daroha 2 of First rehearsal, its tracks where no file is: the fake
 *  answers a file under /gone/ as Python does one that is not on disk. It is
 *  the take Daroha's ▶ plays. */
const DAROHA_2_GONE = `
  const api = window.pywebview.api; const get = api.get_song;
  const gone = (t) => ({...t, tracks: t.tracks.map((x) => ({...x, file: '/gone/' + x.file.split('/').pop()}))});
  const it = (folder, t) => folder === '/rec/older' && t.take_number === 2;
  api.get_song = async (id) => {
    const r = await get(id);
    r.goes = (r.goes || []).map((g) => (it(g.folder, g.take) ? {...g, take: gone(g.take)} : g));
    if (r.plays && it(r.plays.folder, r.plays.take)) r.plays = {...r.plays, take: gone(r.plays.take)};
    return r;
  };
`

test("a take that cannot be loaded says so on the song's play button and on its rung", async ({
  page,
}) => {
  await openApp(page, { after: DAROHA_2_GONE })
  await openSongs(page)
  await expect(head(page).getByRole("heading", { name: "Daroha" })).toBeVisible()
  const play = head(page).locator("[data-look]")
  const onRung = rungGroup(page, "/rec/older").locator("[data-take='2'] [data-look]")
  await expect(play).toHaveAttribute("data-look", "idle")
  await play.click()
  await expect(play).toHaveAttribute("data-look", "failed")
  await expect(play).toHaveAccessibleName("Could not load Daroha 2. Try again")
  await expect(play).toBeEnabled()
  await expect(onRung).toHaveAttribute("data-look", "failed")

  // The files are back where they were: pressing it again opens the take
  // once more, and it plays.
  await page.evaluate(() => {
    const bridge = (
      window as unknown as { pywebview: { api: Record<string, (...a: unknown[]) => Promise<unknown>> } }
    ).pywebview.api
    const media = bridge.take_media
    bridge.take_media = (tracks, ...rest) =>
      media(
        (tracks as { file: string }[]).map((t) => ({ ...t, file: t.file.replace("/gone/", "/rec/back/") })),
        ...rest
      )
  })
  const opens = await callCount(page, "player_open")
  await play.click()
  await expect(play).toHaveAttribute("data-look", "playing")
  await expect(onRung).toHaveAttribute("data-look", "playing")
  expect(await callCount(page, "player_open")).toBe(opens + 1)
})

/** Pałyn's takes in Tuesday jam made thirty, from 5 s to 300 s long. */
const THIRTY_PALYN = `
  const api = window.pywebview.api; const get = api.get_song;
  api.get_song = async (id) => {
    const r = await get(id);
    if (r.title !== 'Pałyn') return r;
    const one = r.goes.find((g) => g.folder === '/rec/old');
    const thirty = Array.from({length: 30}, (_, i) => ({...one, take: {...one.take,
      take_number: i + 1, name: 'Pałyn ' + (i + 1), go: i + 1, starred: false, markers: [],
      duration_sec: Math.round(5 + (295 * i) / 29),
      tracks: [{name: 'Guitar', file: '/rec/old/z' + (i + 1) + '.wav'}]}}));
    r.goes = [...thirty, ...r.goes.filter((g) => g.folder !== '/rec/old')];
    return r;
  };
`

test("a rung opens with Enter and Space, and a 30-take evening's bars wrap, none under 6 px", async ({
  page,
}) => {
  await openApp(page, { after: THIRTY_PALYN })
  await openSongs(page)
  await chooseSong(page, "Pałyn")

  // Enter on a rung opens it, and again closes it.
  const gone = rung(page, "/rec/gone")
  await gone.focus()
  await page.keyboard.press("Enter")
  await expect(gone).toHaveAttribute("aria-expanded", "true")
  await expect(rungGroup(page, "/rec/gone").locator("[data-take]")).toHaveCount(2)
  await page.keyboard.press("Enter")
  await expect(gone).toHaveAttribute("aria-expanded", "false")
  await expect(rungGroup(page, "/rec/gone").locator("[data-take]")).toHaveCount(0)
  // Space too: a button reached with the keys keeps Space.
  await page.keyboard.press("Space")
  await expect(gone).toHaveAttribute("aria-expanded", "true")
  await page.keyboard.press("Space")
  await expect(gone).toHaveAttribute("aria-expanded", "false")

  for (const [width, height, scale] of [
    [1180, 820, 1],
    [960, 680, 1],
    [960, 680, 1.5],
    [960, 680, 0.9],
  ] as const) {
    if (scale !== 1) {
      // The stored scale is the whole stored config, so History comes back
      // on Rehearsals.
      await page.addInitScript(scaled(scale))
      await page.reload()
      await openSongs(page)
      await chooseSong(page, "Pałyn")
    }
    await page.setViewportSize({ width, height })
    await settled(page)
    const where = `${width} px at ${scale * 100} %`
    const bars = rung(page, "/rec/old").locator("[data-bars]")
    await expect(bars.locator(":scope > span"), where).toHaveCount(30)
    const drawn = await bars.evaluate((row) => {
      const edge = row.getBoundingClientRect()
      const boxes = [...row.children].map((b) => b.getBoundingClientRect())
      return {
        least: Math.min(...boxes.map((b) => b.width)),
        lines: new Set(boxes.map((b) => Math.round(b.top))).size,
        inside: boxes.every((b) => b.left >= edge.left - 0.5 && b.right <= edge.right + 0.5),
      }
    })
    // Every take in its place: none under 6 px, onto more lines where they
    // do not fit on one, and none out past the rung's edge.
    expect(drawn.least, where).toBeGreaterThanOrEqual(6)
    expect(drawn.lines, where).toBeGreaterThan(1)
    expect(drawn.inside, where).toBe(true)
    // No native title on a bar: the open rung names each take.
    await expect(bars.locator("[title]"), where).toHaveCount(0)
    expect(await sideways(pane(page, "Pałyn")), where).toBe(false)
  }
})

test("the ladder's labels and part titles have no capitals", async ({ page }) => {
  await openApp(page, {
    before: "window.__FULL_EVENING__ = true; window.__STARRED__ = ['/rec/old#2'];",
  })
  await openSongs(page)
  await chooseSong(page, "Pałyn")
  const ladder = page.getByRole("region", { name: "Every take" })
  // F7: as written, at one of the five sizes (F5).
  for (const label of ["Rehearsal", "Takes, to scale", "Takes"]) {
    expect(
      await style(
        ladder.getByText(label, { exact: true }),
        "text-transform",
        "letter-spacing",
        "font-size",
        "font-weight"
      ),
      label
    ).toEqual({
      "text-transform": "none",
      "letter-spacing": "normal",
      "font-size": "12px",
      "font-weight": "400",
    })
  }
  for (const part of await parts(page).all()) {
    const title = part.locator("h3")
    expect(await style(title, "text-transform", "letter-spacing")).toEqual({
      "text-transform": "none",
      "letter-spacing": "normal",
    })
    // Drawn as written: the words drawn are the words in the page.
    const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()
    expect(flat(await title.innerText())).toBe(flat(await title.evaluate((el) => el.textContent)))
  }
  await expect(parts(page).locator("h3")).toHaveText([
    "★ Starred",
    "From last time · Thu 10 Sep",
    "Every take",
  ])
})

test("a rehearsal not on disk on the ladder says Not found on disk in red", async ({ page }) => {
  await openApp(page)
  await openSongs(page)
  await chooseSong(page, "Pałyn")
  const gone = rung(page, "/rec/gone")
  await expect(gone).toHaveAttribute("data-missing", "true")
  const said = gone.getByText("Not found on disk", { exact: true })
  await expect(said).toBeVisible()
  expect((await style(said, "color")).color).toBe(await colour(page, "--destructive"))
  // Its takes' bars are the quiet ones: the card's fill in a dashed frame.
  const bars = gone.locator("[data-bars] > span")
  await expect(bars).toHaveCount(2)
  for (const bar of await bars.all())
    expect(await style(bar, "border-top-style", "background-color")).toEqual({
      "border-top-style": "dashed",
      "background-color": await colour(page, "--card"),
    })
  // A rehearsal on disk says nothing of the kind.
  await expect(rung(page, "/rec/old")).not.toContainText("Not found on disk")
})
