import {
  callCount,
  calls,
  colour,
  EDGE,
  expect,
  hold,
  keyOn,
  letGo,
  nameTake,
  notices,
  openApp,
  openBandApp,
  openHistory,
  recordTake,
  scaled,
  settled,
  startButton,
  startRehearsal,
  style,
  test,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

test("finishing a rehearsal with takes in it asks, and is answered from the keyboard", async ({
  page,
}) => {
  // On the rehearsal screen the ladder is the open take, then the rehearsal
  // itself — and with takes in it, that rung is a decision and asks.
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
  await nameTake(page, "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
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
  expect(await focused()).toBe("Cancel")
  await page.keyboard.press("ArrowRight")
  await expect.poll(focused).toBe("Finish")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(focused).toBe("Cancel")
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

/** The stress band's Tuesday jam, too long for two lines of its row. */
const LONG_TUESDAY = "Tuesday jam at the old brewery, with the horn section and the choir from upstairs"

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
    // All of it, in the window's header.
    await expect(page.getByRole("banner")).toContainText("4 rehearsals · 1 h 20 min played · 1.7 GB")
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
    await expect(overview).toContainText("2 takes")
  })

  test("deleting a rehearsal asks nothing, says it went, and Undo brings it back", async ({
    page,
  }) => {
    await openApp(page)
    const list = await openHistory(page)
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect((await calls(page, "delete_rehearsal")).map((c) => c.args)).toEqual([["/rec/old"]])
    await expect(list.getByRole("button", { name: /^Tuesday jam/ })).toHaveCount(0)
    const notice = notices(page).filter({ hasText: "“Tuesday jam” went to the Trash." })
    await notice.getByRole("button", { name: "Undo" }).click()
    await expect(list.getByRole("button", { name: /^Tuesday jam/ })).toHaveCount(1)
    expect((await calls(page, "undo_trash")).length).toBe(1)
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

  test("the switch is three radios, and arrow keys on it leave the list alone", async ({ page }) => {
    await openApp(page)
    const list = await openHistory(page)
    const views = page.getByRole("radiogroup", { name: "History view" })
    await expect(views.getByRole("radio")).toHaveText(["Rehearsals", "Songs", "Marks"])
    const rehearsals = views.getByRole("radio", { name: "Rehearsals", exact: true })
    const songs = views.getByRole("radio", { name: "Songs", exact: true })
    await expect(rehearsals).toHaveAttribute("aria-checked", "true")

    // Along the switch the arrows move the focus and choose nothing.
    await rehearsals.focus()
    await page.keyboard.press("ArrowRight")
    await expect(songs).toBeFocused()
    await expect(songs).toHaveAttribute("aria-checked", "false")
    await expect(rehearsals).toHaveAttribute("aria-checked", "true")
    await expect(list).toBeVisible()

    // Down is the list's, wherever the focus is: the next rehearsal, in the
    // view that was on.
    await page.keyboard.press("ArrowDown")
    await expect(page.getByRole("heading", { name: "Wednesday jam" })).toBeVisible()
    await expect(list.locator("[aria-current='true']")).toContainText("Wednesday jam")
    await expect(rehearsals).toHaveAttribute("aria-checked", "true")
    await expect(songs).toBeFocused()
    // And up, back to the one before.
    await page.keyboard.press("ArrowUp")
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    await expect(list.locator("[aria-current='true']")).toContainText("Tuesday jam")
    await expect(rehearsals).toHaveAttribute("aria-checked", "true")
    await expect(songs).toBeFocused()
    expect(await calls(page, "save_history_view")).toEqual([])

    // A view chosen from the keyboard keeps the focus on the switch.
    await page.keyboard.press("Enter")
    await expect(songs).toHaveAttribute("aria-checked", "true")
    await expect(songs).toBeFocused()
  })

  test("left and right on the switch move along it, and leave a take playing where it is", async ({
    page,
  }) => {
    // A take playing in the overview has the arrows, to skip 10 s through
    // it; on the switch they are the switch's.
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const list = await openHistory(page)
    const overview = page.locator("[aria-label='Rehearsal overview']")
    await overview.getByRole("button", { name: "Play Pałyn 1" }).click()
    await expect(overview.getByRole("button", { name: "Pause Pałyn 1" })).toBeVisible()
    const seeks = await callCount(page, "player_seek")

    const views = page.getByRole("radiogroup", { name: "History view" })
    const rehearsals = views.getByRole("radio", { name: "Rehearsals", exact: true })
    await rehearsals.focus()
    await page.keyboard.press("ArrowRight")
    await expect(views.getByRole("radio", { name: "Songs", exact: true })).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(rehearsals).toBeFocused()
    await expect(rehearsals).toHaveAttribute("aria-checked", "true")
    await expect(list).toBeVisible()
    await expect(overview.getByRole("button", { name: "Pause Pałyn 1" })).toBeVisible()
    expect(await callCount(page, "player_seek")).toBe(seeks)

    // Off the switch they skip through the take, as before.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
  })

  test("a view chosen with the mouse gives left, right and Space back to the take playing", async ({
    page,
  }) => {
    // The switch keeps no focus after a click: the next arrow skips through
    // the take, and Space pauses it, rather than choosing another view.
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await openHistory(page)
    const overview = page.locator("[aria-label='Rehearsal overview']")
    await overview.getByRole("button", { name: "Play Pałyn 1" }).click()
    await expect(overview.getByRole("button", { name: "Pause Pałyn 1" })).toBeVisible()
    const seeks = await callCount(page, "player_seek")
    const toggles = await callCount(page, "player_toggle")

    const views = page.getByRole("radiogroup", { name: "History view" })
    const songs = views.getByRole("radio", { name: "Songs", exact: true })
    await songs.click()
    await expect(songs).toHaveAttribute("aria-checked", "true")
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
    await expect(songs).toHaveAttribute("aria-checked", "true")

    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
    await expect(songs).toHaveAttribute("aria-checked", "true")
    expect((await calls(page, "save_history_view")).map((c) => c.args)).toEqual([["songs"]])
  })

  test("a chosen row is grey with no frame", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    const selected = await colour(page, "--selected")
    const chosen = page.locator("nav [aria-current='true']")
    const check = async (view: string) => {
      await expect(chosen, view).toHaveCount(1)
      await page.mouse.move(0, 0)
      await expect
        .poll(async () => (await style(chosen, "background-color"))["background-color"], view)
        .toBe(selected)
      const edge = await style(chosen, ...EDGE)
      for (const side of ["top", "right", "bottom", "left"]) {
        const clear =
          edge[`border-${side}-width`] === "0px" || edge[`border-${side}-color`] === "rgba(0, 0, 0, 0)"
        expect(clear, `${view}, ${side} edge`).toBe(true)
      }
    }
    await check("Rehearsals")
    for (const view of ["Songs", "Marks"]) {
      await page.getByRole("radio", { name: view, exact: true }).click()
      await check(view)
    }
  })

  for (const scale of [1, 1.5]) {
    test(`a long name takes two lines in its row, then is cut, whole in its tip, and the minutes give way at ${scale * 100} %`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 960, height: 680 })
      await page.addInitScript(scaled(scale))
      await openBandApp(page, { stress: true })
      const list = await openHistory(page)
      await settled(page)
      const row = list.locator("[data-rehearsal='/rec/tue']")

      // The minutes give their room to the name first.
      const figures = row.locator("[data-figures]")
      await expect(figures).toHaveAttribute("data-dropped")
      await expect(figures.locator("[data-shown]")).toHaveText("")
      const minutes = (await figures.locator(".sr-only").textContent()) ?? ""
      expect(minutes).toMatch(/ min$/)

      // Then the name takes two lines, and is cut.
      const name = row.locator("[data-name]")
      await expect(name).toHaveText(LONG_TUESDAY)
      expect(
        await name.evaluate((el) => ({
          lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
          cut: el.scrollHeight > el.clientHeight + 1,
        }))
      ).toEqual({ lines: 2, cut: true })

      // Whole in the row's tip, with the minutes under it: on hover, and on
      // focus from the keys, which reach the row and not its figures.
      const tip = page.locator("[data-whole][data-state$='open']")
      await row.hover()
      await expect(tip).toContainText(LONG_TUESDAY)
      await expect(tip).toContainText(minutes)
      await page.mouse.move(0, 0, { steps: 8 })
      await expect(tip).toHaveCount(0)
      await page.getByRole("radio", { name: "Rehearsals", exact: true }).focus()
      await page.keyboard.press("Tab")
      await expect(row).toBeFocused()
      await expect(tip).toContainText(LONG_TUESDAY)
      await expect(tip).toContainText(minutes)

      // A short name keeps its minutes beside it.
      const short = list.locator("[data-rehearsal='/rec/sat']")
      await expect(short.locator("[data-figures]")).not.toHaveAttribute("data-dropped")
      await expect(short.locator("[data-figures] [data-shown]")).toHaveText(/ min$/)
      // Nothing scrolls sideways, in the list or in the window.
      expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
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

const facts = (page: Page) => page.getByRole("group", { name: "About this rehearsal" })
const fact = (page: Page, label: string) =>
  facts(page).locator("div", { has: page.locator("dt", { hasText: label }) }).locator("dd")
/** The rehearsal page's head: the name with its pencil, the facts and Delete
 *  in a row, and the line of the date, the set and the path under them. */
const paneHead = (page: Page) => page.locator("[data-pane-head]")
/** The name as the head draws it, on up to two lines (data-lines), then cut
 *  (data-cut). */
const headName = (page: Page) => paneHead(page).locator("[data-go-title]")
/** A tip open on the page, as drawn. */
const tipShown = (page: Page) => page.locator("[data-slot='tooltip-content'][data-state$='open']")
/** Whether anything in `it`, or the window itself, scrolls sideways. */
const sideways = async (page: Page, ...it: Locator[]) =>
  (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) ||
  (await Promise.all(it.map((el) => el.evaluate((e) => e.scrollWidth > e.clientWidth)))).some(Boolean)

// ---------- the screen's frame ----------

/** Thirty rehearsals in July under the fake's four: a list longer than any
 *  window. */
const THIRTY_MORE = `
  const api = window.pywebview.api; const list = api.list_rehearsals;
  api.list_rehearsals = async () => [...(await list()), ...Array.from({ length: 30 }, (_, i) => ({
    folder: '/rec/july-' + (i + 1), name: 'July jam ' + (i + 1),
    created_at: '2026-07-' + String(31 - i).padStart(2, '0') + 'T19:00:00',
    take_count: 2, total_duration_sec: 600, disk_bytes: 100000000, songs: [], runs: [] }))];
`

test("the list is a grey side panel, its switch in view while the list scrolls", async ({ page }) => {
  await openApp(page, { after: THIRTY_MORE })
  const list = await openHistory(page)
  await settled(page)
  // The side panels' grey with its edge, as Last time and Next take have it,
  // and 16 px inside.
  expect(await style(list, "background-color", "border-right-width")).toEqual({
    "background-color": await colour(page, "--panel"),
    "border-right-width": "1px",
  })
  const views = page.getByRole("radiogroup", { name: "History view" })
  const panel = (await list.boundingBox())!
  const before = (await views.boundingBox())!
  expect(before.x - panel.x).toBeCloseTo(16, 0)
  expect(before.y - panel.y).toBeCloseTo(16, 0)

  // At the end of the list the switch is where it was, still in view.
  const last = list.locator("[data-rehearsal='/rec/july-30']")
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  expect(await views.boundingBox()).toEqual(before)
  await expect(views).toBeInViewport()
})

/** The fake's four rehearsals over the whole list, in the order they stand:
 *  the size gives way first, the count last. */
const TOTALS = ["4 rehearsals", "1 h 20 min played", "1.7 GB"]
/** A take on its way to the cloud: "1 working · 64%" in the header. */
const BUSY = `window.__ACTIVITY__ = [{ id: 1, kind: 'cloud', title: 'Palyn to the cloud',
  folder: '/rec/old', take_number: 1, state: 'running', fraction: 0.64, step: 'Encoding the mix',
  error: null, detail: null, retry: null, seen: false }];`

test("the totals stay in the header at 960 px and 150 %, dropping whole, the size first", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page)
  // Whole figures from the front of the line: all three, the first two, the
  // count alone, or none.
  const fronts = [3, 2, 1, 0].map((n) => TOTALS.slice(0, n).join(" · "))
  for (const scale of [1, 1.5]) {
    if (scale !== 1) {
      // At 150 % a copy to the cloud is running too, so its words take room
      // from the header and the totals have to give some up.
      await page.addInitScript(scaled(scale))
      await page.addInitScript(BUSY)
      await page.reload()
    }
    await openHistory(page)
    await settled(page)
    const header = page.getByRole("banner")
    const totals = header.locator("[data-figures]")
    await expect(totals).toBeVisible()
    // Read out whole, whatever shows.
    await expect(totals.locator(".sr-only")).toHaveText(TOTALS.join(" · "))
    if (scale !== 1)
      await expect(header.getByRole("button", { name: /^Background work/ })).toHaveText(
        "1 working · 64%"
      )
    const shown = totals.locator("[data-shown]")
    if (scale === 1) await expect(shown).toHaveText(TOTALS.join(" · "))
    else await expect(shown, "the size gone first").not.toContainText(TOTALS[2])
    expect(fronts, `at ${scale * 100} %`).toContain((await shown.textContent()) ?? "")
    // The line after them stays drawn, whatever they drop.
    await expect(header.locator("span.w-px")).toBeVisible()
  }
})

/** Take 1 of every rehearsal, its tracks where no file is: the fake answers a
 *  file under /gone/ as Python does one that is not on disk. */
const TAKE_1_GONE = `
  const api = window.pywebview.api; const get = api.get_rehearsal;
  api.get_rehearsal = async (folder) => {
    const r = await get(folder);
    for (const t of r.takes ?? [])
      if (t.take_number === 1)
        t.tracks = t.tracks.map((x) => ({ ...x, file: '/gone/' + x.file.split('/').pop() }));
    return r;
  };
`

test("a take that cannot be loaded says so on its play button in the overview", async ({ page }) => {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;", after: TAKE_1_GONE })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  const play = overview.locator("[data-take='1'] [data-look]")
  await expect(play).toHaveAttribute("data-look", "idle")
  await play.click()
  await expect(play).toHaveAttribute("data-look", "failed")
  await expect(play).toHaveAccessibleName("Could not load Pałyn 1. Try again")
  await expect(play).toBeEnabled()

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
  expect(await callCount(page, "player_open")).toBe(opens + 1)
})

test("the list and the page's group rise in, 40 ms apart", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await openHistory(page)
  const rise = (el: Locator) =>
    el.evaluate((e) => {
      const s = getComputedStyle(e.closest(".animate-rise")!)
      return [s.animationName, s.animationDelay]
    })
  expect(await rise(page.getByRole("radiogroup", { name: "History view" }))).toEqual(["rise", "0s"])
  expect(await rise(page.locator("[data-songs-group]"))).toEqual(["rise", "0.04s"])
  // The head holds its place from the first frame: it does not rise.
  expect(await paneHead(page).evaluate((e) => e.closest(".animate-rise") === null)).toBe(true)
})

/** The list of rehearsals, held while window.__HOLD__ holds it (`hold`). */
const LIST_HELD = `
  const api = window.pywebview.api; const list = api.list_rehearsals;
  api.list_rehearsals = async () => {
    const held = window.__HOLD__ && window.__HOLD__.list_rehearsals;
    if (held) await held;
    return list();
  };
`

test("while the rehearsals are read, a spinner after a second and the words after ten", async ({
  page,
}) => {
  await page.clock.install()
  await openApp(page, { after: LIST_HELD })
  await hold(page, "list_rehearsals")
  // Held still from here, so each second is the one the test counts.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await page.getByRole("button", { name: "History", exact: true }).click()
  const spinner = page.locator("main [role='status']")
  const words = page.getByText("Reading the folder…", { exact: true })
  await expect(spinner).toBeAttached()
  await expect(spinner).toBeHidden()
  await expect(words).toHaveCount(0)
  await page.clock.runFor(1000)
  await expect(spinner).toBeVisible()
  await expect(words).toHaveCount(0)
  await page.clock.runFor(9000)
  await expect(words).toBeVisible()

  await page.clock.resume()
  await letGo(page, "list_rehearsals")
  await expect(page.getByRole("navigation", { name: "Rehearsals" })).toBeVisible()
  await expect(spinner).toHaveCount(0)
  await expect(words).toHaveCount(0)
})

test("with no rehearsal yet, History says how one gets here on the shared Empty", async ({
  page,
}) => {
  await openApp(page, { after: "window.pywebview.api.list_rehearsals = async () => [];" })
  await page.getByRole("button", { name: "History", exact: true }).click()
  const empty = page.locator("main [data-slot='empty']")
  await expect(empty.locator("[data-slot='empty-title']")).toHaveText("No past rehearsals yet")
  await expect(empty.locator("[data-slot='empty-description']")).toHaveText(
    "Every rehearsal where you saved at least one take shows up here."
  )
  await expect(page.getByRole("navigation")).toHaveCount(0)
  await expect(page.getByRole("banner").locator("[data-figures]")).toHaveCount(0)
})

test("a take open keeps its header, with 48 px between the strip and the player", async ({
  page,
}) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Take 2 Pałyn 2" }).click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  await settled(page)
  // The rehearsal's name and figures, and the button to its folder.
  const header = page.getByRole("banner")
  await expect(header.getByRole("heading", { level: 1 })).toHaveText("Tuesday jam")
  await expect(header.getByRole("group", { name: "About this rehearsal" })).toBeVisible()
  await expect(header.getByRole("button", { name: "Open folder", exact: true })).toBeVisible()
  // 32 px round the page, the header's sides too, and 48 between the strip
  // and the player.
  expect(await style(header, "padding-left", "padding-right")).toEqual({
    "padding-left": "32px",
    "padding-right": "32px",
  })
  const strip = page.getByRole("group", { name: "Take strip" })
  expect((await strip.boundingBox())!.x).toBeCloseTo(32, 0)
  const gap = await strip.evaluate(
    (el) => el.nextElementSibling!.getBoundingClientRect().top - el.getBoundingClientRect().bottom
  )
  expect(gap).toBeCloseTo(48, 0)
})

test("an open rehearsal with no take picked shows the evening", async ({ page }) => {
  // It used to be one lonely "Pick a take" under the strip. What was played,
  // how many goes each song got and every note left while listening are all
  // known already, and are what you came back for.
  const overview = await openEvening(page)
  const said = await overview.innerText()
  for (const part of [
    "Pałyn",
    "2 takes",
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
  // The evening's figures are the pane head's, not the overview's.
  expect(said).not.toMatch(/\bplayed\b/)
  await expect(fact(page, "Length")).toHaveText("12 min")
  await expect(fact(page, "Takes")).toHaveText("4, 2 songs")
  await expect(fact(page, "In the cloud")).toHaveText("1 of 4")
})

// The facts in the pane's head, beside the rehearsal's name: the name has its
// room first and they give way to it fact by fact, as in the rehearsal
// screen's header. The name takes up to two lines, and past them it is cut,
// whole in the shared tip. The stress band has a rehearsal whose name is 60
// letters and one of 82, which take two lines at 960 px, and a short one.
const FACTS = ["Length", "Takes", "In the cloud", "On disk"]

/** The facts that show, in the order they stand. */
const shownFacts = (group: Locator) =>
  group
    .locator("dt")
    .evaluateAll((labels) =>
      labels
        .filter((dt) => getComputedStyle(dt.parentElement!).display !== "none")
        .map((dt) => dt.textContent!)
    )

/** Where the last character of the head's name ends, as drawn, and the
 *  middle of its line: the pencil comes right after it. */
const nameEnd = (page: Page) =>
  headName(page).evaluate((el) => {
    const tail = el.querySelector(":scope > .whitespace-nowrap")!
    const range = document.createRange()
    range.selectNodeContents(tail.firstChild!)
    const r = range.getBoundingClientRect()
    return { right: r.right, middle: r.top + r.height / 2 }
  })

for (const [pick, wraps] of [["New songs", false], ["Soundcheck at", true], ["Tuesday jam at", true]] as const) {
  test(`the pane head of ${pick} keeps the name's room and the facts give way at 960 px`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openBandApp(page, { stress: true })
    await openHistory(page, pick)
    await settled(page)
    // There, though none may show beside a name on two lines.
    const group = facts(page)
    await expect(group).toBeAttached()
    const head = paneHead(page)
    const name = head.getByRole("heading", { level: 2 })

    // Whole facts, the front of the list, never a gap in it.
    const shown = await shownFacts(group)
    expect(shown).toEqual(FACTS.slice(0, shown.length))
    if (!wraps) expect(shown.length).toBeGreaterThanOrEqual(2)

    const at = async (it: Locator) => (await it.boundingBox())!
    const [room, title, row, bin] = [
      await at(head),
      await at(name),
      await at(group),
      await at(head.getByRole("button", { name: /^Delete rehearsal / })),
    ]
    // Side by side, the name first, then the facts, then Delete.
    expect(title.x + title.width).toBeLessThanOrEqual(row.x + 0.5)
    expect(row.x + row.width).toBeLessThanOrEqual(bin.x + 0.5)
    expect(bin.x + bin.width).toBeLessThanOrEqual(room.x + room.width + 0.5)
    expect(await sideways(page, head)).toBe(false)
    // The name has its room: one line, or two when it is longer than that,
    // whole on them at this size, with most of the row.
    await expect(headName(page)).toHaveAttribute("data-lines", wraps ? "2" : "1")
    await expect(headName(page)).not.toHaveAttribute("data-cut")
    if (wraps) expect(title.width).toBeGreaterThanOrEqual(300)
  })
}

for (const scale of [1, 1.5]) {
  test(`a long name takes two lines in the pane head, then is cut, whole in the tooltip, at ${scale * 100} %`, async ({
    page,
  }) => {
    await page.addInitScript(scaled(scale))
    await openBandApp(page, { stress: true })
    // In a folder of a real length, not the fake's few letters.
    await page.addInitScript(inALongFolder(null, "/rec/tue"))
    await page.reload()
    await openHistory(page)
    for (const [width, height] of [[1180, 820], [960, 680]] as const) {
      await page.setViewportSize({ width, height })
      await settled(page)
      const where = `${width} px at ${scale * 100} %`
      const head = paneHead(page)
      const name = headName(page)
      // Whole on two lines at 100 %; at 150 % two lines hold only part of it.
      const cut = scale === 1.5

      // Two lines, then cut at their end; whole to a screen reader and in
      // the shared tip.
      await expect(name, where).toHaveAttribute("data-lines", "2")
      if (cut) {
        await expect(name, where).toHaveAttribute("data-cut")
        await expect(head.locator("h2 .sr-only"), where).toHaveText(LONG_TUESDAY)
        await name.hover()
        await expect(page.locator("[data-whole][data-state$='open']"), where).toHaveText(LONG_TUESDAY)
        await page.mouse.move(0, 0, { steps: 8 })
      } else {
        await expect(name, where).not.toHaveAttribute("data-cut")
        await expect(name, where).toHaveText(LONG_TUESDAY)
      }

      // The pencil right after the last word drawn, on its line.
      const pen = (await head.getByRole("button", { name: /^Rename rehearsal / }).boundingBox())!
      const end = await nameEnd(page)
      expect(pen.x - end.right, `${where}: the pencil after the last word`).toBeGreaterThanOrEqual(0)
      expect(pen.x - end.right, `${where}: the pencil right after it`).toBeLessThan(12 * scale)
      expect(Math.abs(pen.y + pen.height / 2 - end.middle), `${where}: on its line`).toBeLessThan(4 * scale)

      // The facts have given way before the name did.
      expect(await shownFacts(facts(page)), `${where}: the facts gone first`).toEqual([])
      // Delete inside the head, at its right, clear of the name.
      const room = (await head.boundingBox())!
      const title = (await head.getByRole("heading", { level: 2 }).boundingBox())!
      const bin = (await head.getByRole("button", { name: /^Delete rehearsal / }).boundingBox())!
      expect(Math.abs(room.x + room.width - (bin.x + bin.width)), `${where}: Delete at the right`).toBeLessThanOrEqual(0.5)
      expect(bin.x, `${where}: Delete after the name`).toBeGreaterThanOrEqual(title.x + title.width - 0.5)
      expect(bin.y, `${where}: Delete inside the head`).toBeGreaterThanOrEqual(room.y - 0.5)
      const pane = page.locator("section").filter({ has: head })
      expect(await sideways(page, head, pane), `${where}: nothing scrolls sideways`).toBe(false)

      // Where the line is narrowest, the path is cut at its end and is
      // still the button to the folder.
      if (width === 960 && scale === 1.5) {
        const folder = head.getByRole("button", { name: `Open folder ${LONG_FOLDER}`, exact: true })
        await expect(folder).toBeVisible()
        const path = folder.locator("span.font-mono")
        await expect(path).toHaveAttribute("data-cut")
        expect(await path.evaluate((el) => el.scrollWidth > el.clientWidth), `${where}: the path cut`).toBe(true)
      }
    }
  })
}

test("a step from the long name to a short one moves the evening one title line at most", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await page.addInitScript(scaled(1.5))
  await openBandApp(page, { stress: true })
  await openHistory(page)
  await settled(page)
  const evening = page.locator("[aria-label='Rehearsal overview']")
  await expect(evening).toBeVisible()
  await expect(headName(page)).toHaveAttribute("data-cut")
  const line = await headName(page).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  const before = (await evening.boundingBox())!.y

  await page.keyboard.press("ArrowDown")
  await expect(headName(page)).toHaveText("New songs")
  await expect(headName(page)).toHaveAttribute("data-lines", "1")
  await expect(evening).toContainText("Ptuška")
  await settled(page)
  const after = (await evening.boundingBox())!.y
  expect(Math.abs(after - before)).toBeLessThanOrEqual(line + 0.5)
  expect(await sideways(page, paneHead(page))).toBe(false)
})

// A name longer than two lines of its row is cut at the end of the second,
// at a word where it has one, and is whole in the shared tip; it breaks inside
// a word only where the word is wider than the row. The pencil comes right
// after the last word drawn, and the facts and Delete stay at the top.
const LONG_NAMES = [
  [
    "many words",
    "Tuesday jam at the old brewery, with the horn section, the choir from upstairs, the kids from next door and the man with the accordion",
  ],
  ["one word", "Mississippi".repeat(12) + "abcde"],
] as const

for (const [what, long] of LONG_NAMES) {
  test(`a rehearsal's long name of ${what} takes two lines in the pane head at 960 px, then is cut, its pencil after it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page)
    await openHistory(page)
    await page.getByRole("button", { name: "Rename rehearsal Tuesday jam" }).click()
    const dialog = page.getByRole("dialog", { name: "Rename rehearsal" })
    await dialog.locator("input").fill(long)
    await dialog.getByRole("button", { name: "Rename" }).click()
    await expect(page.getByRole("button", { name: `Delete rehearsal ${long}` })).toBeVisible()
    await settled(page)

    // There, though none shows beside a name on two lines.
    const group = facts(page)
    await expect(group).toBeAttached()
    const head = paneHead(page)
    const name = headName(page)
    // Two lines, then cut, and whole to a screen reader; broken inside a
    // word only where it must be, not anywhere.
    await expect(name).toHaveAttribute("data-lines", "2")
    await expect(name).toHaveAttribute("data-cut")
    await expect(name).toContainText("…")
    await expect(head.locator("h2 .sr-only")).toHaveText(long)
    expect(await style(name, "overflow-wrap")).toEqual({ "overflow-wrap": "break-word" })

    const pencil = head.getByRole("button", { name: /^Rename rehearsal / })
    const bin = head.getByRole("button", { name: /^Delete rehearsal / })
    const at = async (it: Locator) => (await it.boundingBox())!
    const [room, title, edit, row, trash, meta] = [
      await at(head),
      await at(name),
      await at(pencil),
      await at(group),
      await at(bin),
      await at(head.locator("[data-rehearsal-head]")),
    ]
    const line = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    expect(title.height, "two lines tall, no more").toBeLessThanOrEqual(2 * line + 1)

    // The name, the pencil, the facts and Delete are inside the head, the
    // name before the facts, and nothing scrolls sideways.
    for (const [part, it] of [["the name", title], ["the pencil", edit], ["the facts", row], ["Delete", trash]] as const) {
      expect(it.x, `${part} inside the head, left`).toBeGreaterThanOrEqual(room.x - 0.5)
      expect(it.x + it.width, `${part} inside the head, right`).toBeLessThanOrEqual(room.x + room.width + 0.5)
      expect(it.y, `${part} inside the head, top`).toBeGreaterThanOrEqual(room.y - 0.5)
      expect(it.y + it.height, `${part} inside the head, bottom`).toBeLessThanOrEqual(room.y + room.height + 0.5)
    }
    expect(title.x + title.width, "the name before the facts").toBeLessThanOrEqual(row.x + 0.5)
    expect(await sideways(page, head)).toBe(false)
    // The pencil right after the last character drawn, on the second line.
    const end = await nameEnd(page)
    expect(edit.x - end.right, "the pencil after the name").toBeGreaterThanOrEqual(0)
    expect(edit.x - end.right, "right after it").toBeLessThan(12)
    expect(Math.abs(edit.y + edit.height / 2 - end.middle), "on the name's last line").toBeLessThan(4)
    expect(end.middle, "which is its second").toBeGreaterThan(title.y + line)
    // The facts and Delete stay at the top while the name runs on, and the
    // line of the date, the set and the path is under its last line.
    expect(Math.abs(trash.y - room.y), "Delete at the top").toBeLessThan(2)
    expect(Math.abs(row.y - room.y), "the facts at the top").toBeLessThan(2)
    expect(meta.y, "the line under the name").toBeGreaterThanOrEqual(title.y + title.height - 0.5)

    await name.hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(long)
  })
}

// A folder is a path of 60 letters or so, not the fake's eight. It takes none
// of the name's room nor the facts': the name has what it needs and the facts
// what it leaves (B6), however long the path. The line under them is across
// the whole head, and the path has what the date and the set leave, cut at
// the head's edge.
const LONG_FOLDER = String.raw`C:\Users\alex\RehearsalRecordings\Tuesday jam - 2026-09-10 19-00`
const inALongFolder = (name: string | null = null, real = "/rec/old") => `
  const api = window.pywebview.api; const real = ${JSON.stringify(real)}; const long = ${JSON.stringify(LONG_FOLDER)};
  const list = api.list_rehearsals; const get = api.get_rehearsal; const named = ${JSON.stringify(name)};
  const said = (r) => r.folder === real ? { ...r, folder: long, ...(named ? { name: named } : {}) } : r;
  api.list_rehearsals = async () => (await list()).map(said);
  api.get_rehearsal = async (f) => said(await get(f === long ? real : f));
`

for (const [width, every] of [[1180, true], [960, false]] as const) {
  test(`a short name keeps its facts beside a folder of a real length at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await openApp(page, { after: inALongFolder() })
    await openHistory(page)
    await settled(page)
    const group = facts(page)
    await expect(group).toBeVisible()
    const head = paneHead(page)
    const meta = head.locator("[data-rehearsal-head]")

    // All four at 1180 and Length at least at 960, as whole facts.
    const shown = await shownFacts(group)
    expect(shown).toEqual(FACTS.slice(0, shown.length))
    expect(shown.length).toBeGreaterThanOrEqual(every ? 4 : 1)

    // The date is whole, and the line is under the facts, not beside them,
    // so the path takes none of their room; it is inside the head.
    const date = meta.locator("span").first()
    expect(await date.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const at = async (it: Locator) => (await it.boundingBox())!
    const [room, line, row, path] = [
      await at(head),
      await at(meta),
      await at(group),
      await at(meta.locator("span.font-mono")),
    ]
    expect(line.y, "the line under the facts").toBeGreaterThanOrEqual(row.y + row.height - 0.5)
    expect(path.x + path.width, "the path inside the head").toBeLessThanOrEqual(room.x + room.width + 0.5)
    const pane = page.locator("section").filter({ has: group })
    expect(await sideways(page, meta, pane)).toBe(false)
  })
}

test("the folder of a real length is cut inside the head under a longer name at 960 px, the set not squeezed", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 760 })
  await openApp(page, { before: PLAYED_BY_SET, after: inALongFolder("Tuesday jam at the old brewery") })
  await openHistory(page)
  await settled(page)
  const group = facts(page)
  await expect(group).toBeVisible()
  const head = paneHead(page)
  const meta = head.locator("[data-rehearsal-head]")
  const path = meta.locator("span.font-mono")
  await expect(path).toHaveText(LONG_FOLDER)
  await expect(path).toBeVisible()

  // Cut, and inside the head, under the facts.
  expect(await path.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const at = async (it: Locator) => (await it.boundingBox())!
  const [room, line, cut, row] = [await at(head), await at(meta), await at(path), await at(group)]
  expect(cut.x, "the path inside the head, left").toBeGreaterThanOrEqual(room.x - 0.5)
  expect(cut.x + cut.width, "the path inside the head, right").toBeLessThanOrEqual(room.x + room.width + 0.5)
  expect(line.y, "the line under the facts").toBeGreaterThanOrEqual(row.y + row.height - 0.5)
  const pane = page.locator("section").filter({ has: group })
  expect(await sideways(page, meta, pane)).toBe(false)
  // The set shares the line with the path and keeps the room it asks for, up
  // to half of it: it is not squeezed to a letter by a path 60 letters long.
  const set = meta.locator("[data-set-name]")
  await expect(set).toBeVisible()
  expect(await set.locator("span.truncate").evaluate((el) => el.clientWidth)).toBeGreaterThanOrEqual(60)
})

// The line of the date, the set and the path is the whole head's width,
// under the name, its facts and Delete: a short name does not make it as
// narrow as the name. The date is whole, the set's name too, and the path has
// the rest: whole at 1180 px, and cut at the head's edge at 960 px.
for (const [width, cutHere] of [[1180, false], [960, true]] as const) {
  test(`under a short name the date, the set and the folder take the whole head's width at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await openApp(page, { before: PLAYED_BY_SET, after: inALongFolder() })
    await openHistory(page)
    await settled(page)
    const group = facts(page)
    await expect(group).toBeVisible()
    const head = paneHead(page)
    const name = head.getByRole("heading", { level: 2 })
    await expect(headName(page)).toHaveText("Tuesday jam")
    const meta = head.locator("[data-rehearsal-head]")
    const date = meta.locator("span").first()
    const set = meta.locator("[data-set-name]")
    const folder = meta.getByRole("button", { name: `Open folder ${LONG_FOLDER}`, exact: true })
    const path = folder.locator("span.font-mono")

    // The date, the set's name and the start of the path, all drawn, the
    // path as the folder's button.
    await expect(date).toBeVisible()
    expect(await date.evaluate((el) => el.scrollWidth <= el.clientWidth), "the date whole").toBe(true)
    await expect(set).toHaveText("Gig on the 25th")
    await expect(set).toBeVisible()
    expect(await set.locator("span.truncate").evaluate((el) => el.scrollWidth <= el.clientWidth), "the set whole").toBe(true)
    await expect(path).toHaveText(LONG_FOLDER)
    await expect(path).toBeVisible()
    expect(await path.evaluate((el) => el.clientWidth), "the start of the path").toBeGreaterThanOrEqual(100)
    // Cut at the head's edge where it does not fit, and nothing scrolls sideways.
    expect(await path.evaluate((el) => el.scrollWidth > el.clientWidth), "the path cut").toBe(cutHere)
    const pane = page.locator("section").filter({ has: group })
    expect(await sideways(page, meta, head, pane)).toBe(false)

    // The line spans the head, under the name, the facts and Delete.
    const at = async (it: Locator) => (await it.boundingBox())!
    const [room, line, cut, title, row, bin] = [
      await at(head),
      await at(meta),
      await at(path),
      await at(name),
      await at(group),
      await at(head.getByRole("button", { name: /^Delete rehearsal / })),
    ]
    expect(Math.abs(line.x - room.x), "the line from the head's left edge").toBeLessThanOrEqual(0.5)
    expect(room.x + room.width - (line.x + line.width), "the line to the head's right edge").toBeLessThanOrEqual(4)
    expect(cut.x + cut.width, "the path inside the head").toBeLessThanOrEqual(room.x + room.width + 0.5)
    for (const [part, it] of [["the name", title], ["the facts", row], ["Delete", bin]] as const) {
      expect(line.y, `the line under ${part}`).toBeGreaterThanOrEqual(it.y + it.height - 0.5)
    }
  })
}

// The facts' place is there from the first frame, so that the name is laid
// out once, and not again when the takes are read or at every switch from
// one rehearsal to another. Held between the click and the takes, the head is
// where it will be. A name of 73 letters takes two lines at 960 px, and the
// facts give way to it whole; a short one leaves them room.
const WHILE_READING = [
  ["a name of 73 letters", "Tuesday jam at the old brewery with the horn group and the choir upstairs", false],
  ["a short name", "Tuesday jam", true],
] as const

for (const [what, name, room] of WHILE_READING) {
  test(`the pane head does not move when the takes are read, with ${what} at 960 px`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page)
    const list = await openHistory(page)
    if (name !== "Tuesday jam") {
      await page.getByRole("button", { name: "Rename rehearsal Tuesday jam" }).click()
      const dialog = page.getByRole("dialog", { name: "Rename rehearsal" })
      await dialog.locator("input").fill(name)
      await dialog.getByRole("button", { name: "Rename" }).click()
    }
    await expect(page.getByRole("button", { name: `Delete rehearsal ${name}` })).toBeVisible()
    // Away to another rehearsal and back, the takes held on the way.
    await list.getByRole("button", { name: /^Wednesday jam/ }).click()
    await expect(page.getByRole("button", { name: "Delete rehearsal Wednesday jam" })).toBeVisible()
    await expect(fact(page, "Length")).toBeVisible()
    await hold(page, "get_rehearsal")
    const before = await callCount(page, "get_rehearsal")
    await list.getByRole("button", { name: new RegExp(`^${name}`) }).click()
    await expect.poll(() => callCount(page, "get_rehearsal")).toBeGreaterThan(before)
    const bin = page.getByRole("button", { name: `Delete rehearsal ${name}` })
    await expect(bin).toBeVisible()
    await settled(page)

    const group = facts(page)
    const pane = page.locator("section").filter({ has: bin })
    const box = async (it: Locator) => {
      if ((await it.count()) === 0) return null
      const b = (await it.boundingBox())!
      return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
    }
    const where = async () => ({
      name: await box(pane.getByRole("heading", { level: 2 })),
      pencil: await box(pane.getByRole("button", { name: /^Rename rehearsal / })),
      line: await box(pane.locator("[data-rehearsal-head]")),
      folder: await box(pane.getByRole("button", { name: /^Open folder / })),
      bin: await box(bin),
    })

    // While the takes are not read: no figure, and no zero.
    const held = await where()
    await expect.soft(group).toHaveText("")
    await expect.soft(group.locator("dt")).toHaveCount(0)

    await letGo(page, "get_rehearsal")
    // The figures are read out whatever shows, and show when the name leaves room.
    await expect(group.locator("dt")).toHaveCount(4)
    await expect(group.locator(".sr-only")).toContainText("Length")
    if (room) await expect(fact(page, "Length")).toBeVisible()
    else await expect(fact(page, "Length")).toBeHidden()
    await settled(page)
    expect(await where()).toEqual(held)
    // The name takes two lines in the one and one in the other, so that a
    // head which stayed put was not just one that never had a reason to move.
    expect(held.name!.height > 40).toBe(!room)
  })
}

test("a rehearsal that is not on disk has no facts in its pane head", async ({ page }) => {
  await openApp(page)
  await openHistory(page, "Missing jam")
  await expect(page.getByText("Not found on disk.")).toBeVisible()
  await expect(facts(page)).toHaveCount(0)
})

test("a rehearsal not on disk says Not found on disk in red, its path plain text", async ({ page }) => {
  await openApp(page)
  await openHistory(page, "Missing jam")
  const said = page.getByText("Not found on disk.", { exact: true })
  await expect(said).toBeVisible()
  expect((await style(said, "color")).color).toBe(await colour(page, "--destructive"))
  // A group on the card's fill, with no dashed frame.
  const card = page.locator("[data-slot='card']").filter({ has: said })
  expect(await style(card, "background-color", "border-top-width")).toEqual({
    "background-color": await colour(page, "--card"),
    "border-top-width": "0px",
  })
  // Its path is there to read, and is no button: there is no folder to open,
  // so it has no folder icon either, which would make it look like the button.
  const line = paneHead(page).locator("[data-rehearsal-head]")
  await expect(line).toContainText("/rec/gone")
  await expect(paneHead(page).getByRole("button")).toHaveCount(0)
  await expect(line.locator("svg.lucide-folder-open")).toHaveCount(0)
})

test("the path under the name opens its folder, its tip in the system's words", async ({ page }) => {
  await openApp(page)
  // Not the newest, which History opens on.
  const list = await openHistory(page, "Wednesday jam")
  await expect(page.getByRole("button", { name: "Delete rehearsal Wednesday jam" })).toBeVisible()
  await settled(page)
  const line = paneHead(page).locator("[data-rehearsal-head]")
  // The path is the button, so there is none among the facts.
  await expect(facts(page).getByRole("button")).toHaveCount(0)
  const quiet = line.getByRole("button", { name: "Open folder /rec/quiet", exact: true })
  await expect(quiet.locator("span.font-mono")).toHaveText("/rec/quiet")
  await quiet.hover()
  await expect(tipShown(page)).toHaveText("Open folder")
  await page.mouse.move(0, 0, { steps: 8 })
  await quiet.click()
  await expect.poll(async () => (await calls(page, "show_rehearsal_folder")).map((c) => c.args)).toEqual([
    ["/rec/quiet"],
  ])
  await list.getByRole("button", { name: /^Tuesday jam/ }).click()
  await line.getByRole("button", { name: "Open folder /rec/old", exact: true }).click()
  await expect.poll(async () => (await calls(page, "show_rehearsal_folder")).at(-1)?.args).toEqual([
    "/rec/old",
  ])

  // A path of a real length at 960 px, after a set's name, is cut at its
  // end and is still the button; the tip has it whole, under the system's
  // words.
  await page.setViewportSize({ width: 960, height: 680 })
  await page.addInitScript(inALongFolder())
  await page.addInitScript(
    `window.__PLAYED_BY__ = {"/rec/old": {name: "Gig on the 25th", songs: ["Viasna", "Pałyn"]}};`
  )
  await page.reload()
  await openHistory(page)
  await settled(page)
  const long = line.getByRole("button", { name: `Open folder ${LONG_FOLDER}`, exact: true })
  const path = long.locator("span.font-mono")
  await expect(path).toHaveText(LONG_FOLDER)
  expect(await path.evaluate((el) => el.scrollWidth > el.clientWidth), "the path cut").toBe(true)
  await long.hover()
  await expect(tipShown(page)).toContainText("Open folder")
  await expect(tipShown(page)).toContainText(LONG_FOLDER)
  await page.mouse.move(0, 0, { steps: 8 })
  await long.click()
  await expect.poll(async () => (await calls(page, "show_rehearsal_folder")).at(-1)?.args).toEqual([
    LONG_FOLDER,
  ])
})

test("a pane head's heading is named by its title alone, on a rehearsal's page and a song's", async ({
  page,
}) => {
  await openApp(page)
  const list = await openHistory(page)
  const head = paneHead(page)
  await expect(head.getByRole("heading", { name: "Tuesday jam", exact: true })).toBeVisible()
  // The pencil after the last word keeps its own name, and the keys reach
  // it: Tab from the last rehearsal in the list, the stop before the head.
  const pencil = head.getByRole("button", { name: "Rename rehearsal Tuesday jam", exact: true })
  await list.getByRole("button", { name: /^Missing jam/ }).focus()
  await page.keyboard.press("Tab")
  await expect(pencil).toBeFocused()

  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await expect(head.getByRole("heading", { name: "Daroha", exact: true })).toBeVisible()
  await expect(head.getByRole("button", { name: "Rename song Daroha", exact: true })).toBeVisible()
})

test("Delete is an icon at the head's right with its tip", async ({ page }) => {
  await openApp(page)
  await openHistory(page)
  await settled(page)
  const head = paneHead(page)
  const bin = head.getByRole("button", { name: "Delete rehearsal Tuesday jam", exact: true })
  // An icon, and no word.
  await expect(bin).toHaveText("")
  await expect(bin.locator("svg")).toHaveCount(1)
  const room = (await head.boundingBox())!
  const at = (await bin.boundingBox())!
  expect(Math.abs(room.x + room.width - (at.x + at.width)), "at the head's right").toBeLessThanOrEqual(0.5)
  expect(Math.abs(at.y - room.y), "at its top").toBeLessThan(2)
  await bin.hover()
  await expect(tipShown(page)).toHaveText("Delete rehearsal")
  // The tip is for the eyes: the button's name says it already.
  await expect(bin).toHaveAccessibleDescription("")
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

test("a take opened from the overview is deleted at once, and Undo puts it back", async ({
  page,
}) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Take 2 Pałyn 2" }).click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  await expect(current(page)).toContainText("Pałyn 2")
  await page.getByRole("button", { name: "Delete take Pałyn 2" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect((await calls(page, "delete_take")).map((c) => c.args)).toEqual([["/rec/old", 2]])
  const strip = page.getByRole("group", { name: "Take strip" })
  await expect(strip.getByRole("button", { name: /Pałyn 2/ })).toHaveCount(0)
  const notice = notices(page).filter({ hasText: "“Pałyn 2” went to the Trash." })
  await notice.getByRole("button", { name: "Undo" }).click()
  await expect(overview.getByRole("button", { name: "Take 2 Pałyn 2" })).toBeVisible()
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
    await expect(panel.locator("[data-song='Pałyn']")).toContainText("2 takes · 6:10")
    await expect(panel.locator("[data-song='Viasna']")).toContainText("1 take · 4:10")
    await expect(panel.locator("[data-song='Not named']")).toContainText("1 take · 1:30")
    // The marks, under their song, each by its label and its comment.
    await expect(panel.locator("[data-song='Pałyn'] [data-note]")).toContainText("this one is the take")
    await expect(panel.locator("[data-song='Viasna'] [data-note]")).toContainText("guitar drifts here")
    await expect(panel.locator("[data-song='Not named'] [data-note]")).toContainText("Note")
    await expect(panel.locator("[data-note]")).toHaveCount(3)
    // What was not played last time, from before it.
    const leftOut = panel.getByRole("region", { name: "Not played last time" })
    await expect(leftOut).toContainText("Daroha")
    await expect(leftOut).toContainText(/Tue 25 Aug.* · 2 takes/)
    // And the rest of history.
    const earlier = panel.getByRole("region", { name: "Earlier" })
    await expect(earlier).toContainText("Wednesday jam")
    await expect(earlier).toContainText("First rehearsal")
    // One wording for a rehearsal whose folder is gone, as History's own list.
    const missing = earlier.getByRole("button", { name: /Missing jam/ })
    await expect(missing).toContainText("Not found on disk")
    await expect(panel.getByRole("button", { name: /^History/ })).toContainText("4 rehearsals")
  })

  test("a song's button plays its last go, and has Space and Escape while it plays", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const panel = lastTime(page)
    await expect(keyOn(startButton(page))).resolves.toBe("Space")
    await panel.getByRole("button", { name: "Play Pałyn 2, the last take of Pałyn" }).click()
    await expect(panel.getByRole("button", { name: "Pause Pałyn 2, the last take of Pałyn" })).toBeVisible()
    expect((await calls(page, "player_open")).at(-1)?.args[0]).toEqual([
      { name: "Guitar", file: "/rec/old/p2.wav" },
    ])
    await expect(panel.locator("[data-song='Pałyn']")).toContainText("/ 2:58")
    // Space is the take's now, not Start's.
    expect(await keyOn(startButton(page))).toBeNull()
    await page.keyboard.press("Space")
    await expect(panel.getByRole("button", { name: "Play Pałyn 2, the last take of Pałyn" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Record take/ })).toHaveCount(0)
    await page.keyboard.press("Space")
    await expect(panel.getByRole("button", { name: "Pause Pałyn 2, the last take of Pałyn" })).toBeVisible()

    // Take 2 of another rehearsal is another take, not this one again.
    const opens = await callCount(page, "player_open")
    await panel.getByRole("button", { name: "Play Daroha 2, the last take of Daroha" }).click()
    await expect(panel.getByRole("button", { name: "Pause Daroha 2, the last take of Daroha" })).toBeVisible()
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
    await panel.getByRole("button", { name: "Play Viasna 1, the last take of Viasna" }).click()
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

// ---------- a rehearsal played by a set (issue #12 step 8, H1–H4) ----------

/** Tuesday jam was played by a set: Pałyn and Viasna played, Ahoń and
 *  Kupalle not. */
const PLAYED_BY_SET =
  "window.__FULL_EVENING__ = true;" +
  `window.__PLAYED_BY__ = {"/rec/old": {name: "Gig on the 25th", songs: ["Viasna", "Pałyn", "Ahoń", "Kupalle"]}};`

/** The same set with a last song whose name is longer than its row. */
const LONG_SONG = "A song whose name is far too long for its half of the set card, however it is read"
const PLAYED_BY_SET_LONG = PLAYED_BY_SET.replace('"Kupalle"', JSON.stringify(LONG_SONG))

test("a rehearsal played by a set shows its name in the list and under its title", async ({
  page,
}) => {
  await openApp(page, { before: PLAYED_BY_SET })
  const list = await openHistory(page)
  await expect(list.locator("[data-rehearsal='/rec/old'] [data-set-name]")).toHaveText(
    "Gig on the 25th"
  )
  await expect(list.locator("[data-rehearsal='/rec/quiet'] [data-set-name]")).toHaveCount(0)
  await list.getByRole("button", { name: /^Tuesday jam/ }).click()
  const under = page.locator("[data-rehearsal-head] [data-set-name]")
  await expect(under).toHaveText("Gig on the 25th")
  // No native title, in the list or under the name.
  await expect(page.locator("[data-set-name][title], [data-set-name] [title]")).toHaveCount(0)

  // A set's name too long for its half of the line is cut there, and whole
  // in the shared tip. Sets keep 40 letters at most.
  const long = "Wedding at the old brewery, second night"
  await page.setViewportSize({ width: 960, height: 680 })
  await page.addInitScript(
    scaled(1.5) + `window.__PLAYED_BY__ = {"/rec/old": {name: ${JSON.stringify(long)}, songs: ["Viasna", "Pałyn"]}};`
  )
  await page.reload()
  await openHistory(page)
  await settled(page)
  const cut = under.locator("[data-cut]")
  await expect(cut).toHaveText(long)
  await cut.hover()
  await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(long)
  await page.mouse.move(0, 0, { steps: 8 })

  // The set gives way before the folder does: its button keeps its icon
  // whole, and opens the folder.
  const folder = page
    .locator("[data-rehearsal-head]")
    .getByRole("button", { name: "Open folder /rec/old", exact: true })
  await expect(folder).toBeVisible()
  const button = (await folder.boundingBox())!
  const icon = (await folder.locator("svg").boundingBox())!
  expect(icon.x, "the icon inside the button, left").toBeGreaterThanOrEqual(button.x - 0.5)
  expect(icon.x + icon.width, "the icon inside the button, right").toBeLessThanOrEqual(
    button.x + button.width + 0.5
  )
  const before = await callCount(page, "show_rehearsal_folder")
  await folder.click()
  await expect.poll(async () => (await calls(page, "show_rehearsal_folder")).slice(before)).toEqual([
    { name: "show_rehearsal_folder", args: ["/rec/old"] },
  ])
})

test("the set card counts what was played and says not played for the rest", async ({
  page,
}) => {
  await openApp(page, { before: PLAYED_BY_SET })
  await openHistory(page, "Tuesday jam")
  const card = page.getByRole("region", { name: "Set Gig on the 25th" })
  await expect(card).toHaveAttribute("data-set-card")
  await expect(card.getByRole("heading")).toHaveText("Gig on the 25th · 2 of 4 played")
  const songs = card.locator("[data-set-song]")
  await expect(songs).toHaveText([/1\s*Viasna\s*1 take/, /2\s*Pałyn\s*2 takes/, /3\s*Ahoń\s*not played/, /4\s*Kupalle\s*not played/])
  // Two columns read down: Pałyn under Viasna, Ahoń heads the second.
  const [first, second, third, fourth] = await Promise.all(
    [0, 1, 2, 3].map(async (i) => (await songs.nth(i).boundingBox())!)
  )
  expect(second.x).toBeCloseTo(first.x, 0)
  expect(second.y).toBeGreaterThan(first.y + first.height - 1)
  expect(third.x).toBeGreaterThan(first.x + first.width - 1)
  expect(third.y).toBeCloseTo(first.y, 0)
  expect(fourth.x).toBeCloseTo(third.x, 0)
  // History looks back: nothing is next, lit or under the arrow keys.
  await expect(card.getByText("next", { exact: true })).toHaveCount(0)
  await expect(card.locator("[aria-current], [data-highlighted]")).toHaveCount(0)
  // Over the songs, under the figures.
  const palyn = (await page.getByRole("group", { name: "Pałyn" }).boundingBox())!
  expect((await card.boundingBox())!.y).toBeLessThan(palyn.y)
  // The take nobody named is where it was.
  await expect(page.getByRole("group", { name: "Not named" })).toBeVisible()
})

test("the set card is the first part of the evening's group, in two columns when wide", async ({
  page,
}) => {
  await openApp(page, { before: PLAYED_BY_SET_LONG })
  await openHistory(page, "Tuesday jam")
  await settled(page)
  // History's own scrolling pane: the window never scrolls sideways here.
  const pane = () => page.locator("section").filter({ has: paneHead(page) })
  const group = page.locator("[data-songs-group]")
  const head = group.locator("[data-overview-head]")
  const part = group.locator("[data-set-part]")
  const firstSong = group.locator("[data-song-group]").first()
  // One part of the one group, with the set card in it and nowhere else.
  await expect(part).toHaveCount(1)
  await expect(part.locator("[data-set-card]")).toHaveCount(1)
  await expect(page.locator("[data-set-card]")).toHaveCount(1)
  // After the head, before the first song, a 1 px line over each of them
  // and 24 px of air in the part.
  const [h, p, s] = await Promise.all(
    [head, part, firstSong].map(async (l) => (await l.boundingBox())!)
  )
  expect(p.y, "the part starts under the head").toBeGreaterThanOrEqual(h.y + h.height - 0.5)
  expect(s.y, "the first song starts under the part").toBeGreaterThanOrEqual(p.y + p.height - 0.5)
  expect(p.x).toBeCloseTo(h.x, 0)
  expect(p.width).toBeCloseTo(h.width, 0)
  expect(await style(part, "border-top-width", "padding-top", "padding-bottom", "padding-left")).toEqual({
    "border-top-width": "1px",
    "padding-top": "24px",
    "padding-bottom": "24px",
    "padding-left": "24px",
  })
  expect((await style(firstSong, "border-top-width"))["border-top-width"]).toBe("1px")

  // Wide, the songs are two columns read down; one column under 32rem. At
  // 960 x 680 and 150 % the card is far under it.
  const columns = async () => {
    const rows = page.locator("[data-set-card] [data-set-song]")
    const boxes = await Promise.all([0, 1, 2, 3].map(async (i) => (await rows.nth(i).boundingBox())!))
    return new Set(boxes.map((b) => Math.round(b.x))).size
  }
  expect(await columns()).toBe(2)
  expect(await sideways(page, pane()), "wide: nothing scrolls sideways").toBe(false)
  await page.setViewportSize({ width: 960, height: 680 })
  await page.addInitScript(scaled(1.5))
  await page.reload()
  await openHistory(page, "Tuesday jam")
  await settled(page)
  expect(await columns()).toBe(1)
  const rows = page.locator("[data-set-card] [data-set-song]")
  const ys = await Promise.all([0, 1, 2, 3].map(async (i) => (await rows.nth(i).boundingBox())!.y))
  expect(ys).toEqual([...ys].sort((a, b) => a - b))
  expect(new Set(ys).size).toBe(4)
  // The long name is cut in its row: nothing scrolls sideways.
  expect(await sideways(page, pane()), "narrow: nothing scrolls sideways").toBe(false)
})

test("the set card's ticks are in the text's colour", async ({ page }) => {
  await openApp(page, { before: PLAYED_BY_SET })
  await openHistory(page, "Tuesday jam")
  // Viasna and Pałyn were played; the other two have none.
  const ticks = page.locator("[data-set-card] [data-played-check]")
  await expect(ticks).toHaveCount(2)
  const text = await colour(page, "--foreground")
  expect(await ticks.evaluateAll((els) => els.map((e) => getComputedStyle(e).color))).toEqual([text, text])
})

test("a song of the set card cut short is whole on hover, though it was not played", async ({
  page,
}) => {
  // A disabled button gets no pointer events, so the item round it carries the tip.
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, { before: PLAYED_BY_SET_LONG })
  await openHistory(page, "Tuesday jam")
  await settled(page)
  const song = page.locator(`[data-set-song=${JSON.stringify(LONG_SONG)}]`)
  await expect(song).toBeDisabled()
  expect(await song.locator("[data-row-title]").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
  await song.locator("xpath=..").hover()
  await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(LONG_SONG)
})

test("a click on a played song in the set card scrolls to it", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 520 })
  await openApp(page, { before: PLAYED_BY_SET })
  await openHistory(page, "Tuesday jam")
  const viasna = page.getByRole("group", { name: "Viasna" })
  await expect(viasna).not.toBeInViewport()
  const card = page.getByRole("region", { name: "Set Gig on the 25th" })
  await card.locator("[data-set-song='Viasna']").click()
  await expect(viasna).toBeInViewport()
  // A song not played has nowhere to go.
  await expect(card.locator("[data-set-song='Ahoń']")).toBeDisabled()
})

test("a rehearsal played freely has no set card", async ({ page }) => {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await openHistory(page, "Tuesday jam")
  await expect(page.getByRole("group", { name: "Pałyn" })).toBeVisible()
  await expect(page.locator("[data-set-card]")).toHaveCount(0)
  await expect(page.locator("[data-set-name]")).toHaveCount(0)
})
