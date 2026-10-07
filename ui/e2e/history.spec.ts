import {
  callCount,
  calls,
  expect,
  keyOn,
  openApp,
  openHistory,
  recordTake,
  startButton,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

test("finishing a rehearsal with takes in it asks, and is answered from the keyboard", async ({
  page,
}) => {
  // On the rehearsal screen the ladder is the open take, then the rehearsal
  // itself — and with takes in it, that rung is a decision and asks.
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
  await page.fill("#take-name", "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  // Tonight's, not Pałyn's take 1 from before tonight in the panel.
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  const timeline = page.getByRole("group", { name: "Take timeline" })
  await expect(timeline).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(timeline).toHaveCount(0)

  const finishes = await callCount(page, "finish_rehearsal")
  const question = page.getByText("Finish this rehearsal?")
  await page.keyboard.press("Escape")
  await expect(question).toBeVisible()
  // And still there a moment later: a dialog opened by a keydown still on
  // its way through the page can be dismissed by that same keydown, which
  // looks like a flicker. Waiting for it to appear cannot see that.
  await page.waitForTimeout(300)
  await expect(question).toHaveCount(1)
  expect(await callCount(page, "finish_rehearsal")).toBe(finishes)

  // Answered without the mouse. It opens on the answer that changes
  // nothing, and getting to the other one is the app's doing, not the
  // browser's: the window the app runs in on a Mac moves focus on Tab only
  // with macOS keyboard navigation on, so the arrows carry the weight.
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? "")
  expect(await focused()).toBe("Keep going")
  await page.keyboard.press("ArrowRight")
  await expect.poll(focused).toBe("Finish")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(focused).toBe("Keep going")
  // Tab is taken over too, watched from the capture phase on window, where
  // the app takes the key and stops it.
  await page.evaluate(() => {
    const w = window as unknown as { __TAB_TAKEN__: boolean | null }
    w.__TAB_TAKEN__ = null
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Tab") w.__TAB_TAKEN__ = e.defaultPrevented
      },
      true
    )
  })
  await page.keyboard.press("Tab")
  await expect.poll(focused).toBe("Finish")
  expect(await page.evaluate(() => (window as unknown as { __TAB_TAKEN__: boolean }).__TAB_TAKEN__)).toBe(true)

  await page.keyboard.press("Escape")
  await expect(question).toHaveCount(0)
  expect(await callCount(page, "finish_rehearsal")).toBe(finishes)
})

test.describe("History", () => {
  test("opens on the newest rehearsal beside the list, and Escape goes back a layer at a time", async ({
    page,
  }) => {
    await openApp(page)
    const list = await openHistory(page)
    // Chosen already, and on screen next to the list: no row to open first.
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    await expect(list.locator("[aria-current='true']")).toContainText("Tuesday jam")
    await page.getByRole("button", { name: "Take 1 Pałyn 1", exact: true }).click()
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    // A ten-minute take gets a clock in minutes.
    await expect(page.getByRole("group", { name: "Timeline clock" })).toContainText("2:00")
    // The player has the whole window.
    await expect(list).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
    await expect(list).toBeVisible()
    await expect(page.getByRole("button", { name: "Take 1 Pałyn 1", exact: true })).toHaveCount(1)
    // The list is history itself, so the next rung is the setup screen.
    await page.keyboard.press("Escape")
    await expect(startButton(page)).toBeVisible()
    await expect(list).toHaveCount(0)
  })

  test("lists each rehearsal by month, with when, how long and its evening drawn", async ({
    page,
  }) => {
    // Months later a rehearsal is recognised by what was played in it and
    // how the evening went. The strip says it without a single mark.
    await openApp(page)
    const list = await openHistory(page)
    await expect(list.getByRole("group", { name: "September 2026" })).toHaveCount(1)
    await expect(list.getByRole("group", { name: "August 2026" })).toHaveCount(1)
    const jam = list.getByRole("button", { name: /^Tuesday jam/ })
    await expect(jam).toContainText("Thu 10 Sep, 19:00")
    await expect(jam).toContainText("42 min")
    await expect(jam).toContainText("9 takes")
    // One run per song, one bar per go, and the starred go in green.
    const strip = jam.locator("[data-strip]")
    await expect(strip.locator(":scope > div")).toHaveCount(6)
    await expect(strip.locator("span")).toHaveCount(9)
    await expect(strip.locator("[data-starred]")).toHaveCount(1)
    // Takes nobody named are one run, still drawn.
    const quiet = list.getByRole("button", { name: /^Wednesday jam/ })
    await expect(quiet.locator("[data-strip] > div")).toHaveCount(1)
    await expect(quiet.locator("[data-strip] span")).toHaveCount(2)
    // All of it, in the header.
    await expect(page.locator("header")).toContainText("4 rehearsals · 1 h 20 min played · 1.7 GB")
  })

  test("↑ and ↓ go through the rehearsals, and what was playing stops", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const list = await openHistory(page)
    const overview = page.locator("[aria-label='Rehearsal overview']")
    await overview.getByRole("button", { name: "Play Viasna" }).click()
    await expect(page.getByRole("button", { name: "Pause Viasna" })).toBeVisible()
    const closes = await callCount(page, "player_close")

    await page.keyboard.press("ArrowDown")
    await expect(page.getByRole("heading", { name: "Wednesday jam" })).toBeVisible()
    await expect(list.locator("[aria-current='true']")).toContainText("Wednesday jam")
    await expect(overview).toContainText("Not named")
    // Viasna belonged to the rehearsal that was left.
    await expect(page.getByRole("button", { name: /Pause/ })).toHaveCount(0)
    expect(await callCount(page, "player_close")).toBeGreaterThan(closes)

    await page.keyboard.press("ArrowUp")
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    await expect(overview).toContainText("guitar drifts here")

    // And by the mouse.
    await list.getByRole("button", { name: /^First rehearsal/ }).click()
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
    await expect(overview).toContainText("Daroha")
    await expect(overview).toContainText("2 goes")
  })

  test("deleting a rehearsal says what it frees and that its cloud copies go", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("goes to the Trash")
    // The space is the reason people delete a rehearsal at all.
    await expect(page.getByText("9 takes, 1.2 GB")).toHaveCount(1)
    await expect(dialog).toContainText("So do the copies of 3 of them in the cloud folder.")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toHaveCount(0)
    expect(await callCount(page, "delete_rehearsal")).toBe(0)
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
    await page.getByRole("dialog").locator("button", { hasText: "Delete" }).last().click()
    await expect.poll(() => callCount(page, "delete_rehearsal")).toBe(1)
  })

  test("a take playing in one rehearsal is not taken for the same take number in another", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const list = await openHistory(page, "Tuesday jam")
    const overview = page.locator("[aria-label='Rehearsal overview']")
    await overview.getByRole("button", { name: "Play Pałyn 1" }).click()
    await expect(overview.getByRole("button", { name: "Pause Pałyn 1" })).toBeVisible()
    const toggles = await callCount(page, "player_toggle")

    // Daroha 1 is First rehearsal's take 1, as Pałyn 1 is Tuesday jam's.
    await list.getByRole("button", { name: /^First rehearsal/ }).click()
    await overview.getByRole("button", { name: "Play Daroha 1" }).click()
    await expect(overview.getByRole("button", { name: "Pause Daroha 1" })).toBeVisible()
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/older/d1.wav" },
    ])
    expect(await callCount(page, "player_toggle")).toBe(toggles)
  })
})

// History, and an open rehearsal with no take picked: the evening at a
// glance, and each go at a song as a row.

async function openEvening(page: Page) {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

const current = (page: Page) => page.locator("[data-tab][aria-current='true']")

test("an open rehearsal with no take picked shows the evening", async ({ page }) => {
  // It used to be one lonely "Pick a take" under the strip. What was played,
  // how many goes each song got and every note left while listening are all
  // known already, and are what you came back for.
  const overview = await openEvening(page)
  const said = await overview.innerText()
  for (const part of [
    "11:50\nplayed",
    "4\ntakes",
    "2\nsongs",
    "1 of 4\nin the cloud",
    "Pałyn",
    "2 goes",
    "Viasna",
    "1 Keep this",
    "1 Went wrong",
    "1 Note",
    "Not named",
    "this one is the take",
    "guitar drifts here",
  ]) {
    expect(said).toContain(part)
  }
  // Every mark has its line, a plain one with nothing written included: by
  // its label's name.
  await expect(overview.locator("[data-note]")).toHaveCount(3)
  await expect(page.getByText("Pick a take")).toHaveCount(0)
  // Only the take already in the cloud folder says so on its row.
  await expect(page.locator("[data-take='2'] [data-in-cloud]")).toHaveCount(1)
  await expect(overview.locator("[data-in-cloud]")).toHaveCount(1)
  // Every go on one scale: the four-minute Viasna is the longest bar.
  const widths = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-take]")].map((r) => [
        r.dataset.take,
        r.querySelector('button[aria-label^="Take "]')!.getBoundingClientRect().width,
      ])
    )
  )
  expect(widths["4"]).toBeGreaterThan(widths["1"])
  expect(widths["1"]).toBeGreaterThan(widths["3"])
  // And no strip of pills repeating it.
  await expect(page.getByRole("group", { name: "Take strip" })).toHaveCount(0)
})

test("a note opens its take at the spot it was left", async ({ page }) => {
  const overview = await openEvening(page)
  await overview.getByText("guitar drifts here").click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  await expect(current(page)).toContainText("Viasna")
  await expect
    .poll(async () => (await calls(page, "player_seek")).at(-1)?.args[0] as number)
    .toBeCloseTo(40, 0)
  // The overview makes way for the player, and the strip is back, to switch
  // takes without going back.
  await expect(overview).toHaveCount(0)
  await expect(page.getByRole("group", { name: "Take strip" })).toHaveCount(1)
})

test("a take opened from the overview can be deleted, and says its cloud copy goes too", async ({
  page,
}) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Take 2 Pałyn 2" }).click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  await expect(current(page)).toContainText("Pałyn 2")
  await page.getByRole("button", { name: "Delete take Pałyn 2" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("go to the Trash")
  await expect(dialog).toContainText("Its copy in the cloud folder goes too.")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  expect(await callCount(page, "delete_take")).toBe(0)
})

test("the whole of a take's row opens it, not only its bar", async ({ page }) => {
  // A short take's bar is a small thing to aim at, and the row lights up
  // under the mouse all the way across.
  const overview = await openEvening(page)
  const opens = async (x: number, y: number) => {
    await page.mouse.click(x, y)
    await expect(current(page)).toContainText("Take 3")
    await page.keyboard.press("Escape")
    await expect(overview).toBeVisible()
  }
  // Beside the actions, where a short take's row is empty.
  const past = await page.evaluate(() => {
    const row = document.querySelector("[data-take='3'] > div")!
    const actions = row.lastElementChild!.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return { x: actions.left - 6, y: r.top + r.height / 2 }
  })
  await opens(past.x, past.y)
  // And on its length.
  const length = await page.locator("[data-take='3'] > div span.tnum.shrink-0").first().boundingBox()
  await opens(length!.x + length!.width / 2, length!.y + length!.height / 2)
})

test("a take plays from its row, and on in the player and back", async ({ page }) => {
  const overview = await openEvening(page)
  const opens = await callCount(page, "player_open")
  await overview.getByRole("button", { name: "Play Viasna" }).click()
  await expect(page.getByRole("button", { name: "Pause Viasna" })).toBeVisible()
  // Right there, with no player on screen, and how far it has got beside
  // its bar.
  expect(await callCount(page, "player_open")).toBe(opens + 1)
  await expect(page.locator("[aria-label='Take timeline']")).toHaveCount(0)
  await expect(page.locator("[data-take='4']")).toContainText("/ 4:10")

  // Space pauses it, though the mouse pressed Play.
  await page.keyboard.press("Space")
  await expect(page.getByRole("button", { name: "Play Viasna" })).toBeVisible()
  await page.keyboard.press("Space")
  await expect(page.getByRole("button", { name: "Pause Viasna" })).toBeVisible()

  // Its bar opens it in the player without opening it again, and it carries
  // on playing there.
  await overview.getByRole("button", { name: "Take 4 Viasna" }).click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  expect(await callCount(page, "player_open")).toBe(opens + 1)
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(1)

  // Back in the overview it plays on, and Escape stops it and puts it away.
  await page.keyboard.press("Escape")
  await expect(overview).toBeVisible()
  await expect(page.getByRole("button", { name: "Pause Viasna" })).toHaveCount(1)
  const closes = await callCount(page, "player_close")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Play Viasna" })).toBeVisible()
  expect(await callCount(page, "player_close")).toBeGreaterThan(closes)
  await expect(overview).toHaveCount(1)
})

test("a row's own buttons work on its take without opening it", async ({ page }) => {
  const overview = await openEvening(page)
  await page.hover("[data-take='1']")
  await page.getByRole("button", { name: "Rename take Pałyn 1", exact: true }).click()
  await expect(page.getByText("Rename take")).toBeVisible()
  await expect(page.locator("[aria-label='Take timeline']")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // The next Escape leaves history.
  await page.keyboard.press("Escape")
  await expect(startButton(page)).toBeVisible()
  await expect(overview).toHaveCount(0)
})

test.describe("a rehearsal whose folder is gone", () => {
  test("is marked, says why rather than opening, and can be found again", async ({ page }) => {
    await openApp(page)
    const list = await openHistory(page)
    const item = list.getByRole("button", { name: /^Missing jam/ })
    await expect(item).toContainText("Not found on disk")
    await expect(item.locator("[data-strip]")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    const reads = await callCount(page, "get_rehearsal")
    await item.click()
    await expect(page.getByRole("heading", { name: "Missing jam" })).toBeVisible()
    await expect(page.getByText("Not found on disk.")).toBeVisible()
    // There is nothing to read, so nothing is asked for, and no overview.
    expect(await callCount(page, "get_rehearsal")).toBe(reads)
    await expect(page.locator("[aria-label='Rehearsal overview']")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Delete rehearsal Missing jam" })).toHaveCount(0)

    await page.getByRole("button", { name: "Locate folder…" }).click()
    await expect.poll(() => callCount(page, "choose_rehearsal_folder")).toBe(1)
    expect((await calls(page, "choose_rehearsal_folder"))[0].args[0]).toBe("/rec/gone")
    // Found, it drops off the missing list.
    await expect(page.getByText("Not found on disk")).toHaveCount(0)
  })

  test("stays as it was when the folder dialog is cancelled, and can be forgotten", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__CANCEL_LOCATE__ = true;" })
    const list = await openHistory(page, "Missing jam")
    await page.getByRole("button", { name: "Locate folder…" }).click()
    await expect.poll(() => callCount(page, "choose_rehearsal_folder")).toBe(1)
    await expect(page.getByText("Not found on disk.")).toHaveCount(1)

    await page.getByRole("button", { name: "Remove from history" }).click()
    await expect(page.getByText("Only the entry goes")).toBeVisible()
    // It asks before removing anything; confirmed, only the entry goes.
    expect(await callCount(page, "forget_rehearsal")).toBe(0)
    await page.getByRole("button", { name: "Remove", exact: true }).click()
    await expect.poll(() => callCount(page, "forget_rehearsal")).toBe(1)
    expect((await calls(page, "forget_rehearsal"))[0].args[0]).toBe("/rec/gone")
    await expect(list.getByText("Missing jam")).toHaveCount(0)
    // The one beside it in the list takes its place.
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
  })
})

// Last time, beside the setup: the rehearsal before this one, song by song,
// to listen to before starting.

const lastTime = (page: Page) => page.getByRole("complementary", { name: "Last time" })

test.describe("last time, on the setup screen", () => {
  test("goes over the last rehearsal song by song, and needs no marks to", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const panel = lastTime(page)
    await expect(panel).toContainText("Last time · Thu 10 Sep")
    await expect(panel).toContainText("Tuesday jam")
    await expect(panel).toContainText("12 min · 4 takes · 1 in the cloud")
    // Each song with how many goes it got and how long they ran in all.
    await expect(panel.locator("[data-song='Pałyn']")).toContainText("2 goes · 6:10")
    await expect(panel.locator("[data-song='Viasna']")).toContainText("1 go · 4:10")
    await expect(panel.locator("[data-song='Not named']")).toContainText("1 take · 1:30")
    // The marks, under their song, each by its label and its comment.
    await expect(panel.locator("[data-song='Pałyn'] [data-note]")).toContainText("this one is the take")
    await expect(panel.locator("[data-song='Viasna'] [data-note]")).toContainText("guitar drifts here")
    await expect(panel.locator("[data-song='Not named'] [data-note]")).toContainText("Note")
    await expect(panel.locator("[data-note]")).toHaveCount(3)
    // What was not played last time, from before it.
    const leftOut = panel.getByRole("region", { name: "Not played last time" })
    await expect(leftOut).toContainText("Daroha")
    await expect(leftOut).toContainText(/Tue 25 Aug.* · 2 goes/)
    // And the rest of history.
    const earlier = panel.getByRole("region", { name: "Earlier" })
    await expect(earlier).toContainText("Wednesday jam")
    await expect(earlier).toContainText("First rehearsal")
    await expect(earlier.getByRole("button", { name: /Missing jam/ })).toContainText("not found")
    await expect(panel.getByRole("button", { name: /^History/ })).toContainText("4 rehearsals")
  })

  test("a song's button plays its last go, and has Space and Escape while it plays", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const panel = lastTime(page)
    await expect(keyOn(startButton(page))).resolves.toBe("Space")
    await panel.getByRole("button", { name: "Play Pałyn 2, the last go at Pałyn" }).click()
    await expect(panel.getByRole("button", { name: "Pause Pałyn 2, the last go at Pałyn" })).toBeVisible()
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/old/p2.wav" },
    ])
    await expect(panel.locator("[data-song='Pałyn']")).toContainText("/ 2:58")
    // Space is the take's now, not Start's.
    expect(await keyOn(startButton(page))).toBeNull()
    await page.keyboard.press("Space")
    await expect(panel.getByRole("button", { name: "Play Pałyn 2, the last go at Pałyn" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Record take/ })).toHaveCount(0)
    await page.keyboard.press("Space")
    await expect(panel.getByRole("button", { name: "Pause Pałyn 2, the last go at Pałyn" })).toBeVisible()

    // Take 2 of another rehearsal is another take, not this one again.
    const opens = await callCount(page, "player_open")
    await panel.getByRole("button", { name: "Play Daroha 2, the last go at Daroha" }).click()
    await expect(panel.getByRole("button", { name: "Pause Daroha 2, the last go at Daroha" })).toBeVisible()
    expect(await callCount(page, "player_open")).toBe(opens + 1)
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/older/d2.wav" },
    ])

    // Escape stops it, and Start has Space back.
    await page.keyboard.press("Escape")
    await expect(panel.getByRole("button", { name: /^Pause/ })).toHaveCount(0)
    await expect(keyOn(startButton(page))).resolves.toBe("Space")
  })

  test("checking the signal stops what was playing", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const panel = lastTime(page)
    await panel.getByRole("button", { name: "Play Viasna 1, the last go at Viasna" }).click()
    await expect(panel.getByRole("button", { name: /^Pause Viasna/ })).toBeVisible()
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(panel.getByRole("button", { name: /^Pause/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
  })

  test("Open and the other rehearsals lead into history, on the one chosen", async ({ page }) => {
    await openApp(page)
    await lastTime(page).getByRole("button", { name: "Open Tuesday jam in history" }).click()
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    await page.keyboard.press("Escape")

    await lastTime(page).getByRole("region", { name: "Earlier" })
      .getByRole("button", { name: /First rehearsal/ }).click()
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
    const list = page.getByRole("navigation", { name: "Rehearsals" })
    await expect(list.locator("[aria-current='true']")).toContainText("First rehearsal")
    await page.keyboard.press("Escape")

    await lastTime(page).getByRole("button", { name: /^History/ }).click()
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
  })

  test("with no rehearsal before, the setup has the screen to itself", async ({ page }) => {
    await openApp(page, { before: "window.__NO_HISTORY__ = true;" })
    await expect(startButton(page)).toBeVisible()
    await expect.poll(() => callCount(page, "last_time")).toBe(1)
    await expect(lastTime(page)).toHaveCount(0)
  })
})
