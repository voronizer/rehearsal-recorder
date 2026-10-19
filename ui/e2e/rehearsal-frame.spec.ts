import type { Locator, Page } from "@playwright/test"
import {
  callCount,
  calls,
  expect,
  literally,
  notices,
  openApp,
  openBandApp,
  openEvening,
  recordTake,
  scaled,
  setFake,
  settled,
  startButton,
  startRehearsal,
  style,
  test,
  TONIGHT,
} from "./app.ts"

// The rehearsal screen's frame (owner, 2026-10-12, Q1): a header whose name
// wraps and whose figures give way to it, the air the start screen has, and a
// footer where nothing moves. The stress band's rehearsal has a name of 80
// letters (stress-rehearsal.js).

const LONG = "Tuesday jam at the old brewery, with the horn section and the choir from upstairs"

const header = (page: Page) => page.locator("header")
const title = (page: Page) => header(page).getByRole("heading", { level: 1 })
const facts = (page: Page) => page.getByRole("group", { name: "About this rehearsal" })
const finish = (page: Page) => page.getByRole("button", { name: "Finish", exact: true })
const record = (page: Page) => page.getByRole("button", { name: /^Record take/ })
const panel = (page: Page) => page.locator("[data-next-take-panel]")

/** The facts in the order the header says them, most needed first. */
const ORDER = ["Length", "Takes", "In the cloud", "On disk"]

/** Which of the four facts the header draws now, by label. */
const shownFacts = (page: Page) =>
  facts(page)
    .locator("dt")
    .evaluateAll((labels) =>
      labels
        .filter((dt) => getComputedStyle(dt.parentElement!).display !== "none")
        .map((dt) => dt.textContent!)
    )

/** Whole figures give way least needed first: what shows is the front of the
 *  list, never a gap in it. */
const frontOfOrder = (shown: string[]) => expect(shown).toEqual(ORDER.slice(0, shown.length))

type Box = { x: number; y: number; width: number; height: number }
const box = async (it: Locator): Promise<Box> => (await it.boundingBox())!

/** The same box, to a quarter of a pixel (layout works in 1/64 px). */
function expectSame(now: Box, was: Box, what: string) {
  for (const k of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(now[k] - was[k]), `${what} ${k}: ${now[k]} against ${was[k]}`).toBeLessThan(0.25)
  }
}

/** How the h1 holds the rehearsal's name: its lines and the text of each,
 *  whether anything of it is cut or drawn past its box, and where the pencil
 *  is against its last line. */
const holdsName = (h1: Locator) =>
  h1.evaluate((el) => {
    const own = el.getBoundingClientRect()
    // Each line of the name, by the boxes its letters make. A space a line
    // ends at may have no box: it goes with the letter before it.
    const lines: { top: number; bottom: number; text: string }[] = []
    let at: (typeof lines)[number] | undefined
    let right = 0
    const words = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = words.nextNode(); n; n = words.nextNode()) {
      const text = n.textContent ?? ""
      for (let i = 0; i < text.length; ) {
        const len = String.fromCodePoint(text.codePointAt(i)!).length
        const range = document.createRange()
        range.setStart(n, i)
        range.setEnd(n, i + len)
        const r = [...range.getClientRects()].find((b) => b.height > 0)
        if (r) {
          const middle = (r.top + r.bottom) / 2
          at = lines.find((l) => middle > l.top && middle < l.bottom)
          if (!at) lines.push((at = { top: r.top, bottom: r.bottom, text: "" }))
          if (r.width > 0) right = Math.max(right, r.right)
        }
        if (at) at.text += text.slice(i, i + len)
        i += len
      }
    }
    lines.sort((a, b) => a.top - b.top)
    const last = lines.at(-1)!
    const pencil = el.querySelector("button")!.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      lines: lines.length,
      texts: lines.map((l) => l.text.trim()),
      // Cut is clipped, or shown with an ellipsis, or drawn past the box.
      cut: cs.overflowX !== "visible" || cs.textOverflow === "ellipsis" || right > own.right,
      pencilRight: pencil.right - own.right,
      pencilMiddle: pencil.top + pencil.height / 2,
      last: { top: last.top, bottom: last.bottom },
    }
  })

/** The name is whole in its box, and the pencil is inside the box's right
 *  edge, level with its last line. */
function expectHeld(seen: Awaited<ReturnType<typeof holdsName>>, what: string) {
  expect(seen.cut, `${what}: the name is cut or drawn past its box`).toBe(false)
  expect(seen.pencilRight, `${what}: the pencil past the box`).toBeLessThanOrEqual(0.5)
  expect(seen.pencilMiddle, `${what}: the pencil above the last line`).toBeGreaterThan(seen.last.top)
  expect(seen.pencilMiddle, `${what}: the pencil below the last line`).toBeLessThan(seen.last.bottom)
}

/** The name's last word is whole on its last line: a word that fits the box
 *  is not broken, at a hyphen or anywhere else. */
function expectLastWordWhole(seen: Awaited<ReturnType<typeof holdsName>>, name: string, what: string) {
  const word = name.split(" ").at(-1)!
  expect(seen.texts.at(-1)!.split(/\s+/).at(-1), `${what}: the last line, of ${seen.texts.join(" / ")}`).toBe(word)
}

/** How many of the facts fit in the room they have, the most needed first, as
 *  measured from the out-of-sight copy of them that the header keeps to
 *  measure with (the last thing in the group's parent). */
const fitting = (page: Page) =>
  facts(page).evaluate((group) => {
    const dl = group.querySelector("dl")!
    const ruler = group.parentElement!.lastElementChild!.firstElementChild!
    const own = getComputedStyle(dl)
    const room = dl.clientWidth - parseFloat(own.paddingLeft) - parseFloat(own.paddingRight)
    const gap = parseFloat(getComputedStyle(ruler).columnGap)
    let used = 0
    let n = 0
    for (const fact of ruler.children) {
      used += (n > 0 ? gap : 0) + fact.getBoundingClientRect().width
      if (used > room + 0.5) break
      n++
    }
    return n
  })

test.describe("the header", () => {
  test("a long rehearsal name wraps with its pencil beside its last word", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)

    for (const [width, height] of [
      [1180, 820],
      [960, 680],
    ]) {
      await page.setViewportSize({ width, height })
      await settled(page)
      const h1 = title(page)
      await expect(h1).toContainText(LONG)
      const seen = await holdsName(h1)
      expectHeld(seen, `${width} px`)
      expectLastWordWhole(seen, LONG, `${width} px`)
      // In a window this narrow the name takes more than one line.
      if (width === 960) expect(seen.lines).toBeGreaterThan(1)
    }
  })

  test("a rehearsal name ending in a date keeps the date whole on its last line", async ({ page }) => {
    // The date has hyphens a line could break at, and at 960 px the line
    // ends inside it; it is far narrower than the box, so it goes to the
    // next line whole instead.
    const name = "Tuesday jam at the old brewery with the horn section and the 2026-10-12"
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page)
    await page.locator("#rehearsal-name").fill(name)
    await startRehearsal(page)
    await settled(page)
    const h1 = title(page)
    await expect(h1).toContainText(name)
    const seen = await holdsName(h1)
    expect(seen.lines).toBeGreaterThan(1)
    expectHeld(seen, "a date at the end")
    expectLastWordWhole(seen, name, "a date at the end")
  })

  test("a rehearsal name of one long word breaks inside the title box", async ({ page }) => {
    // 81 letters with nowhere to wrap at (not even a hyphen): wider than the
    // title's box at 960 px, where the buttons beside it take theirs first.
    const word = "Rehearsal".repeat(9)
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page)
    await page.locator("#rehearsal-name").fill(word)
    await startRehearsal(page)
    const h1 = title(page)
    await expect(h1).toContainText(word)
    const seen = await holdsName(h1)
    expect(seen.lines).toBeGreaterThan(1)
    expectHeld(seen, "one long word")
    // The box ends before the facts and the buttons begin.
    const name = await box(h1)
    expect(name.x + name.width).toBeLessThanOrEqual((await box(facts(page))).x)
  })

  test("the header's figures give way least needed first and show whole on hover", async ({
    context,
    page,
  }) => {
    // The room the name leaves is wide enough for all four, where the old
    // rule showed two under 1280 px.
    await page.setViewportSize({ width: 1180, height: 820 })
    await openBandApp(page)
    await startButton(page).click()
    await expect(facts(page)).toBeVisible()
    await settled(page)
    expect(await shownFacts(page)).toEqual(ORDER)

    // With the stress band the name takes the room: what shows is the front
    // of the list, and pointing at the group says all four, each with its
    // label, as the header writes them.
    const stress = await context.newPage()
    await stress.setViewportSize({ width: 960, height: 680 })
    await openBandApp(stress, { stress: "rehearsal" })
    await startRehearsal(stress, 33)
    await settled(stress)
    frontOfOrder(await shownFacts(stress))
    const line = facts(stress).locator(".sr-only")
    await expect(line).toHaveText(
      new RegExp(
        "^" +
          literally("Length 1 h 54 min · Takes 32, 14 songs · In the cloud ") +
          "\\d+" +
          literally(" of 32 · On disk ") +
          ".+$"
      )
    )
    await facts(stress).hover({ position: { x: 4, y: 4 } })
    await expect(stress.locator("[data-whole][data-state$='open']")).toHaveText(
      (await line.textContent())!
    )
  })

  test("the figures that stay are always the front of the list, at every width", async ({
    page,
  }) => {
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)
    const counts = new Set<number>()
    for (const width of [960, 1100, 1280, 1500, 1700, 1900, 2200]) {
      await page.setViewportSize({ width, height: 820 })
      // The facts are fitted again from a ResizeObserver and a state update,
      // which `settled` does not wait for: what shows comes to be what fits.
      const fit = await fitting(page)
      await expect
        .poll(async () => (await shownFacts(page)).length, { message: `${width} px` })
        .toBe(fit)
      frontOfOrder(await shownFacts(page))
      counts.add(fit)
    }
    // Some widths show none and some all, or this proves little.
    expect(counts).toContain(0)
    expect(counts).toContain(ORDER.length)
    expect(counts.size).toBeGreaterThan(2)
  })

  test("the header's fact labels have no capitals and are 12 px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await openEvening(page)
    await settled(page)
    const labels = facts(page).locator("dt")
    await expect(labels).toHaveText(ORDER)
    for (const label of await labels.all()) {
      expect(await style(label, "text-transform", "font-size")).toEqual({
        "text-transform": "none",
        "font-size": "12px",
      })
    }
  })

  test("the folder button says its path in the shared tip, not a native title", async ({
    page,
  }) => {
    await openEvening(page)
    await settled(page)
    const folder = facts(page).getByRole("button", { name: "Open folder" })
    await expect(folder).not.toHaveAttribute("title")
    await folder.hover()
    // The fake puts a rehearsal in /rec, under the name it was started with.
    const name = (await calls(page, "start_rehearsal"))[0].args[0]
    await expect(page.getByRole("tooltip")).toHaveText(`/rec/${name}`)
  })
})

test.describe("the footer", () => {
  test("Finish and Record keep their boxes with a take in hand", async ({ page }) => {
    const overview = await openEvening(page)
    await settled(page)
    const row = overview.locator('[data-take="1"]')
    // The take's bar, and the Next take field beside the takes: nothing
    // round the footer moves either.
    const bar = row.getByRole("button", { name: /^Take 1 / })
    const field = page.locator("#next-take-name")
    const was = {
      finish: await box(finish(page)),
      record: await box(record(page)),
      bar: await box(bar),
      field: await box(field),
    }
    // Finish's and Record's: the metronome's T is in the footer too.
    const chips = page.locator("footer [data-footer-actions] kbd")
    const hidden = async () =>
      chips.evaluateAll((all) => all.map((k) => getComputedStyle(k).visibility))
    expect(await hidden()).toEqual(["visible", "visible"])

    // A take playing where it is: both keys are the take's now, and the
    // buttons keep the room the chips take.
    await row.getByRole("button", { name: /^Play / }).click()
    await expect(row.getByRole("button", { name: /^Pause / })).toBeVisible()
    await settled(page)
    expect(await hidden()).toEqual(["hidden", "hidden"])
    expectSame(await box(finish(page)), was.finish, "Finish while it plays")
    expectSame(await box(record(page)), was.record, "Record while it plays")
    expectSame(await box(field), was.field, "the Next take field while it plays")
    const playing = await box(bar)
    expect(Math.abs(playing.width - was.bar.width), "the bar's width while it plays").toBeLessThan(0.25)

    // Opened in the player, it plays on: nothing toggles it again.
    const toggles = await callCount(page, "player_toggle")
    await row.getByRole("button", { name: /^Take 1 / }).click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await settled(page)
    expect(await callCount(page, "player_toggle")).toBe(toggles)
    expect(await hidden()).toEqual(["hidden", "hidden"])
    expectSame(await box(finish(page)), was.finish, "Finish with the take open")
    expectSame(await box(record(page)), was.record, "Record with the take open")
    expectSame(await box(field), was.field, "the Next take field with the take open")

    // Space is the take's: it plays or pauses, and records nothing.
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
    expect(await callCount(page, "start_take")).toBe(0)

    // Escape puts the take away, the keys come back, and nothing has moved.
    await page.keyboard.press("Escape")
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
    await settled(page)
    expect(await hidden()).toEqual(["visible", "visible"])
    expectSame(await box(finish(page)), was.finish, "Finish after Escape")
    expectSame(await box(record(page)), was.record, "Record after Escape")
    expectSame(await box(field), was.field, "the Next take field after Escape")
    expect(Math.abs((await box(bar)).width - was.bar.width), "the bar's width after Escape").toBeLessThan(0.25)
  })

  test("Record keeps its width from take 9 to take 10", async ({ page }) => {
    await openEvening(page, "", TONIGHT.slice(0, 8))
    await settled(page)
    const was = { finish: await box(finish(page)), record: await box(record(page)) }
    await expect(record(page)).toHaveAccessibleName("Record take 9")

    await recordTake(page, 9)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(record(page)).toHaveAccessibleName("Record take 10")
    await settled(page)
    expectSame(await box(record(page)), was.record, "Record at take 10")
    expectSame(await box(finish(page)), was.finish, "Finish at take 10")
  })

  test("a footer button's error is an error notice, and moves nothing", async ({ page }) => {
    await openApp(page, {
      after: `window.pywebview.api.start_take = async () => ({ok: false, error: 'The interface is gone'});`,
    })
    await startRehearsal(page)
    await settled(page)
    const footer = page.locator("footer")
    const was = {
      footer: await box(footer),
      finish: await box(finish(page)),
      record: await box(record(page)),
    }

    await record(page).click()
    const error = notices(page, "error").filter({ hasText: "The interface is gone" })
    await expect(error).toBeVisible()
    expectSame(await box(footer), was.footer, "the footer")
    expectSame(await box(finish(page)), was.finish, "Finish")
    expectSame(await box(record(page)), was.record, "Record")

    // Nothing is said over the buttons any more: the corner has it, above
    // the footer, and it stays until it is closed.
    await expect(footer.getByRole("alert")).toHaveCount(0)
    const at = await box(error)
    expect(at.y + at.height).toBeLessThanOrEqual(was.footer.y)
    await error.getByRole("button", { name: "Close notice" }).click()
    await expect(error).toHaveCount(0)
  })

  test("a long error is whole in its notice, in more than one line", async ({ page }) => {
    const long =
      "The interface is gone, and with it every input the rehearsal was recording from, " +
      "so nothing more can be recorded here until it is plugged back in and the app is opened again"
    await openApp(page, {
      after:
        "window.__START_ERROR__ = 'The interface is gone';" +
        " window.pywebview.api.start_take = async () => ({ok: false, error: window.__START_ERROR__});",
    })
    await startRehearsal(page)
    await settled(page)
    // A short error first, for the height of one line in a notice.
    await record(page).click()
    const error = notices(page, "error").filter({ hasText: "The interface is gone" })
    await expect(error).toBeVisible()
    const oneLine = (await box(error.locator("p"))).height
    await error.getByRole("button", { name: "Close notice" }).click()
    await expect(error).toHaveCount(0)

    // The words go in as data, not as code.
    await setFake(page, "__START_ERROR__", long)
    await record(page).click()
    await expect(error).toContainText(long)
    const words = error.locator("p")
    expect(await words.evaluate((p) => p.scrollWidth <= p.clientWidth)).toBe(true)
    expect((await box(words)).height).toBeGreaterThan(oneLine * 1.5)
  })

  test("a footer button's error goes with its screen", async ({ page }) => {
    await openApp(page, {
      after: `window.pywebview.api.start_take = async () => ({ok: false, error: 'The interface is gone'});`,
    })
    await startRehearsal(page)
    await settled(page)
    await record(page).click()
    await expect(notices(page, "error").filter({ hasText: "The interface is gone" })).toBeVisible()
    // The rehearsal is finished: the start screen does not carry on about a
    // take that was never started.
    await finish(page).click()
    await expect(startButton(page)).toBeVisible()
    await expect(notices(page, "error")).toHaveCount(0)
  })

  test("an error that comes after its screen has gone is not said", async ({ page }) => {
    // The next take's name fails, but only once the rehearsal is finished.
    await openApp(page, {
      after:
        "window.pywebview.api.set_next_take_name = () => new Promise((answer) => {" +
        " window.__ANSWER__ = () => answer({ok: false, error: 'Could not name the next take'}); });",
    })
    await startRehearsal(page)
    await page.getByRole("textbox", { name: "Next take" }).fill("Lost")
    await page.keyboard.press("Enter")
    await expect
      .poll(() => page.evaluate(() => typeof (window as unknown as { __ANSWER__?: unknown }).__ANSWER__))
      .toBe("function")
    await finish(page).click()
    await expect(startButton(page)).toBeVisible()
    await page.evaluate(() => (window as unknown as { __ANSWER__: () => void }).__ANSWER__())
    // The start screen does not carry on about a name for a rehearsal that
    // is over.
    await page.waitForTimeout(300)
    await expect(notices(page, "error")).toHaveCount(0)
  })
})

test.describe("the screen", () => {
  test("the rehearsal screen has the start screen's air", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await settled(page)
    const px = (n: number) => `${n}px`
    expect(await style(page.locator("main"), "padding-left", "padding-top")).toEqual({
      "padding-left": px(32),
      "padding-top": px(32),
    })
    expect(await style(header(page), "padding-left", "padding-right")).toEqual({
      "padding-left": px(32),
      "padding-right": px(32),
    })
    expect(
      await style(
        page.locator("footer"),
        "padding-left",
        "padding-right",
        "padding-top",
        "padding-bottom"
      )
    ).toEqual({
      "padding-left": px(32),
      "padding-right": px(32),
      "padding-top": px(24),
      "padding-bottom": px(24),
    })
    expect(
      await style(panel(page), "padding-left", "padding-right", "padding-top", "padding-bottom")
    ).toEqual({
      "padding-left": px(32),
      "padding-right": px(32),
      "padding-top": px(32),
      "padding-bottom": px(32),
    })
  })

  test("the Next take panel rises 40 ms after the takes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await openApp(page)
    await startRehearsal(page)
    // The panel's inner box, the one that rises: the second in the line (the
    // songs group, which is the first, is the overview's).
    const rises = panel(page).locator("> div")
    await expect(rises).toHaveCount(1)
    const it = await style(rises, "--i", "animation-delay", "animation-name")
    expect(it["--i"].trim()).toBe("1")
    expect(it["animation-delay"]).toBe("0.04s")
    expect(it["animation-name"]).toBe("rise")
  })

  test("at 150 percent in a 960 by 680 window nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await page.addInitScript(scaled(1.5))
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)
    await settled(page)
    for (const [name, it] of [
      ["main", page.locator("main")],
      ["the Next take panel", panel(page)],
    ] as const) {
      const [scroll, client] = await it.evaluate((el) => [el.scrollWidth, el.clientWidth])
      expect(scroll, name).toBeLessThanOrEqual(client)
    }
    // The panel is 22.5 rem of the scale's 24 px, the window being under
    // 1100 px of rem.
    expect(Math.abs((await box(panel(page))).width - 540)).toBeLessThan(0.5)
    // The long name still wraps, whole, with its pencil on its last line.
    const seen = await holdsName(title(page))
    expect(seen.lines).toBeGreaterThan(1)
    expectHeld(seen, "at 150 percent")
    // Neither button is cut off at the window's edge.
    for (const button of [finish(page), record(page)]) {
      const at = await box(button)
      expect(at.x).toBeGreaterThanOrEqual(0)
      expect(at.x + at.width).toBeLessThanOrEqual(960)
    }
  })

  // What follows a bar goes under it only where there is no room for it beside
  // the bar at its smallest (the test above): before that the longest take's
  // bar is the first to give way. In a window of 880 the column has 12.75rem,
  // too little for the badge of a false start, which goes under its bar, and
  // enough for the length of every other take.
  test("a take's length stays beside its bar, whose width gives way first, at 100 percent in an 880 by 680 window", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 680 })
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)
    await settled(page)
    const rows = page.locator("[data-take]:not([data-false-start])")
    const under = await rows.evaluateAll((all) =>
      all
        .filter((row) => {
          const middle = (el: Element) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2
          const bar = row.querySelector("[data-bar-title]")!
          const length = row.querySelector("span.tnum.grid")!
          return Math.abs(middle(length) - middle(bar)) >= 4
        })
        .map((row) => (row as HTMLElement).dataset.take)
    )
    expect(under, "takes whose length is not beside their bar").toEqual([])
    expect(await rows.count()).toBeGreaterThan(20)
  })
})
