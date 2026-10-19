import {
  callCount,
  calls,
  colour,
  expect,
  openApp,
  openEvening,
  settled,
  startRehearsal,
  test,
  themed,
  withKeys,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// The metronome on the rehearsal screen and while a take records (spec Parts
// 2, 4, 5 and 11): one row at the bottom left, its tempo following the next
// take's name, a change held until another song, Tap and the key T, the
// click run between takes; then the count-in in the clock's place, the
// window's edge lit on every click, and the row at the footer's left
// beside the status. The fake keeps the metronome as Python does
// (fake-bridge.js), and counts in and clicks by the page's own clock.

const field = (page: Page) => page.locator("#next-take-name")
/** The row on the rehearsal screen, or the take's row while recording. */
const row = (page: Page) => page.locator("footer").getByRole("region", { name: "Metronome" })
const tempo = (page: Page) => row(page).getByRole("textbox", { name: "Tempo" })
const unit = (page: Page) => row(page).locator("[data-tempo-unit]")
const signature = (page: Page) => row(page).getByRole("combobox", { name: "Time signature" })
const tap = (page: Page) => row(page).getByRole("button", { name: /^Tap/ })
const play = (page: Page) => row(page).getByRole("button", { name: "Play the click" })
const stopClick = (page: Page) => row(page).getByRole("button", { name: "Stop the click" })
const onOff = (page: Page) => row(page).getByRole("button", { name: "Click in takes" })
const gear = (page: Page) => row(page).getByRole("button", { name: "Metronome settings" })
const dots = (page: Page) => row(page).locator("[data-beat-dots] [data-dot]")
const status = (page: Page) => row(page).locator("[data-status-line]")
const record = (page: Page) => page.getByRole("button", { name: /Record take/ })
const finish = (page: Page) => page.getByRole("button", { name: "Finish", exact: true })

/** Names the next take, as typed and taken with Enter, and waits for the
 *  row to have followed it. */
async function nameNext(page: Page, name: string) {
  const sent = await callCount(page, "set_next_take_name")
  await field(page).fill(name)
  await field(page).press("Enter")
  await expect.poll(() => callCount(page, "set_next_take_name")).toBe(sent + 1)
}

/** What the fake's metronome says now, asked as the screen asks. */
type State = { phase: string; tempo: number | null; signature: string; on: boolean }
const metronome = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { pywebview: { api: { metronome_state: () => Promise<State> } } }).pywebview.api.metronome_state()
  )

/** The tempos the row sent Python, oldest first. */
const sent = async (page: Page) => (await calls(page, "metronome_set")).map((c) => c.args)

const box = async (el: Locator) => {
  const b = (await el.boundingBox())!
  return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2) / 2)
}

/** A rehearsal with no takes yet, the next take named `name`. */
async function rehearse(page: Page, name: string, before = "") {
  await openApp(page, { before })
  await startRehearsal(page)
  await nameNext(page, name)
}

/**
 * From now on, at every frame, what the recording screen shows of the beat:
 * the count-in's digit and its colour, the clock and whether it is shown,
 * and the edge's light (its accent, or null while dark), each with the page's
 * time. Read back with `beats`.
 */
const watchBeat = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __BEAT__: unknown[]; __WATCH_BEAT__: boolean }
    w.__BEAT__ = []
    w.__WATCH_BEAT__ = true
    const look = () => {
      if (!w.__WATCH_BEAT__) return
      const count = document.querySelector<HTMLElement>("[data-count-in]")
      const clock = document.querySelector<HTMLElement>("[data-clock]")
      const edge = document.querySelector<HTMLElement>("[data-edge-light]")
      const lit = document.querySelectorAll("footer [data-beat-dots] [data-lit]").length
      w.__BEAT__.push({
        t: performance.now(),
        digit: count?.textContent?.trim() || null,
        digitColour: count ? getComputedStyle(count).color : null,
        clock: clock?.textContent ?? null,
        clockShown: clock ? getComputedStyle(clock).visibility === "visible" : false,
        edge: edge?.hasAttribute("data-lit") ? edge.getAttribute("data-accent") : null,
        dotLit: lit > 0,
      })
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
type Frame = {
  t: number
  digit: string | null
  digitColour: string | null
  clock: string | null
  clockShown: boolean
  edge: string | null
  dotLit: boolean
}
const beats = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __BEAT__: Frame[]; __WATCH_BEAT__: boolean }
    w.__WATCH_BEAT__ = false
    return w.__BEAT__
  })

/** When the take's count-in ends on the page's clock, from what Python says
 *  while the take records. */
const countInEnd = (page: Page) =>
  page.evaluate(async () => {
    const api = (window as unknown as {
      pywebview: { api: { metronome_state: () => Promise<{ since_count_in_ms: number | null }> } }
    }).pywebview.api
    const s = await api.metronome_state()
    return performance.now() - (s.since_count_in_ms ?? 0)
  })

/** The edge's look at the first frame it is lit for a click of this
 *  accent: a light that is on for a moment is caught where it is, not
 *  asked for until a poll happens to fall on it. */
const litLook = (page: Page, accent: string) =>
  page.evaluate(
    (accent) =>
      new Promise<{ transition: string; animation: string; shadow: string; hidden: string | null }>(
        (done) => {
          const look = () => {
            const el = document.querySelector<HTMLElement>(
              `[data-edge-light][data-lit][data-accent='${accent}']`
            )
            if (!el) return void requestAnimationFrame(look)
            const cs = getComputedStyle(el)
            done({
              transition: cs.transitionDuration,
              animation: cs.animationName,
              shadow: cs.boxShadow,
              hidden: el.getAttribute("aria-hidden"),
            })
          }
          requestAnimationFrame(look)
        }
      ),
    accent
  )

/** The digits a count-in showed, each once, in order. */
const digitsOf = (frames: Frame[]) =>
  frames.map((f) => f.digit).filter((d, i, all): d is string => d !== null && d !== all[i - 1])

test.describe("the row on the rehearsal screen", () => {
  test("metronome row follows the next song", async ({ page }) => {
    // Dym played once tonight, with no tempo: a take to count one from.
    await openApp(page, { before: "window.__TONIGHT__ = [{name: 'Dym', duration_sec: 200}];" })
    await startRehearsal(page, 2)
    await nameNext(page, "Pałyn")
    await expect(tempo(page)).toHaveValue("128")
    await expect(unit(page)).toHaveText("bpm")
    await expect(signature(page)).toHaveText("4/4")
    await expect(status(page)).toHaveText("The song's tempo.")
    await expect(dots(page)).toHaveCount(4)

    await nameNext(page, "Viasna")
    await expect(tempo(page)).toHaveValue("128")
    await expect(status(page)).toHaveText("The song's tempo.")

    // A song with no tempo yet: the row is empty, and Dym has a take to
    // count one from.
    await nameNext(page, "Dym")
    await expect(tempo(page)).toHaveValue("")
    await expect(status(page)).toHaveText("No tempo yet: type or tap one, or count it from the last take")
    await expect(status(page).getByRole("button", { name: "count it from the last take" })).toBeVisible()
    await expect(play(page)).toBeDisabled()

    // Counted from the last take, then saved to the song.
    await status(page).getByRole("button", { name: "count it from the last take" }).click()
    await expect(tempo(page)).toHaveValue("104")
    await expect(status(page)).toHaveText(/^Counted from Dym \d+\. Pick the time signature, then save it to the song$/)
    expect(await calls(page, "count_tempo")).toHaveLength(1)
    await status(page).getByRole("button", { name: "save it to the song" }).click()
    await expect(status(page)).toHaveText("The song's tempo.")
    expect(await callCount(page, "metronome_save_to_song")).toBe(1)
  })

  test("a change holds until another song and saves to it", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await expect(tempo(page)).toHaveValue("128")
    await row(page).getByRole("button", { name: "Faster" }).click()
    await expect(tempo(page)).toHaveValue("129")
    expect(await sent(page)).toEqual([[129, "4/4"]])
    await expect(status(page)).toHaveText(
      "The song has 128 · 4/4; this holds until another song. Save to song"
    )

    // Another song, and back: the change was dropped.
    await nameNext(page, "Viasna")
    await nameNext(page, "Pałyn")
    await expect(tempo(page)).toHaveValue("128")
    await expect(status(page)).toHaveText("The song's tempo.")

    // Typed, held, and saved to the song: it is the song's from then on.
    await tempo(page).fill("140")
    await tempo(page).press("Enter")
    await expect(status(page).getByRole("button", { name: "Save to song" })).toBeVisible()
    await status(page).getByRole("button", { name: "Save to song" }).click()
    await expect(status(page)).toHaveText("The song's tempo.")
    await nameNext(page, "Viasna")
    await nameNext(page, "Pałyn")
    await expect(tempo(page)).toHaveValue("140")
  })

  test("a free take", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(field(page)).toHaveValue("Take 1")
    await expect(tempo(page)).toHaveValue("")
    await expect(status(page)).toHaveText("Free take: no click unless you set a tempo.")
    await expect(play(page)).toBeDisabled()

    await tempo(page).fill("100")
    await tempo(page).press("Enter")
    await expect(status(page)).toHaveText("Free take: this tempo stays with the take only.")
    await expect(play(page)).toBeEnabled()
    expect(await sent(page)).toEqual([[100, "4/4"]])
    // Not a number puts the last one back; empty means none.
    await tempo(page).fill("fast")
    await tempo(page).press("Enter")
    await expect(tempo(page)).toHaveValue("100")
    await tempo(page).fill("")
    await tempo(page).press("Enter")
    await expect(status(page)).toHaveText("Free take: no click unless you set a tempo.")
    expect((await sent(page)).at(-1)).toEqual([null, "4/4"])
  })

  test("T taps a tempo and not inside the name field", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await expect(tap(page)).toHaveAttribute("aria-keyshortcuts", "T")
    expect((await tap(page).locator("kbd").innerText()).trim()).toBe("T")
    await field(page).blur()
    for (let i = 0; i < 4; i++) {
      if (i) await page.waitForTimeout(500)
      await page.keyboard.press("t")
    }
    // Four taps half a second apart: 120 a minute, give or take the test's
    // own timing.
    await expect.poll(async () => (await sent(page)).length).toBeGreaterThan(0)
    const [tapped, sig] = (await sent(page)).at(-1)!
    expect(sig).toBe("4/4")
    expect(tapped as number).toBeGreaterThanOrEqual(110)
    expect(tapped as number).toBeLessThanOrEqual(122)
    await expect(tempo(page)).toHaveValue(String(tapped))

    // In the Next take field a T is a letter.
    const before = (await sent(page)).length
    await field(page).click()
    await page.keyboard.type("tt")
    await page.waitForTimeout(300)
    expect((await sent(page)).length).toBe(before)
  })

  test("T is off with the player keys", async ({ page }) => {
    await rehearse(page, "Pałyn", withKeys({ player: false }))
    await field(page).blur()
    // No chip, no key said, and T does nothing.
    await expect(tap(page).locator("kbd")).toHaveCount(0)
    await expect(tap(page)).not.toHaveAttribute("aria-keyshortcuts")
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("t")
      await page.waitForTimeout(300)
    }
    expect(await sent(page)).toEqual([])
    // The button still taps.
    for (let i = 0; i < 3; i++) {
      if (i) await page.waitForTimeout(400)
      await tap(page).click()
    }
    await expect.poll(async () => (await sent(page)).length).toBeGreaterThan(0)
  })

  test("pads tap after Tap", async ({ page }) => {
    await rehearse(page, "Pałyn")
    const pad = () => page.evaluate(() => (window as unknown as { __PAD_TAP__: () => void }).__PAD_TAP__())
    // Before Tap is pressed a pad is only played.
    await pad()
    await page.waitForTimeout(300)
    expect(await callCount(page, "metronome_tap_listen")).toBe(0)

    await tap(page).click()
    await expect.poll(() => callCount(page, "metronome_tap_listen")).toBe(1)
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(400)
      await pad()
    }
    // The press and three hits 0.4 s apart: 150 a minute.
    await expect.poll(async () => (await sent(page)).length).toBeGreaterThan(0)
    await expect
      .poll(async () => (await sent(page)).at(-1)![0] as number)
      .toBeGreaterThanOrEqual(140)
    expect((await sent(page)).at(-1)![0] as number).toBeLessThanOrEqual(155)
  })

  test("play runs the click and Record stops it", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await expect(row(page).locator("[data-beat-dots] [data-lit]")).toHaveCount(0)
    await play(page).click()
    expect(await callCount(page, "metronome_play")).toBe(1)
    await expect(stopClick(page)).toBeVisible()
    // The dots light as it clicks.
    await watchBeat(page)
    await page.waitForTimeout(1000)
    expect((await beats(page)).some((f) => f.dotLit)).toBe(true)
    await stopClick(page).click()
    expect(await callCount(page, "metronome_stop")).toBe(1)
    await expect(play(page)).toBeVisible()
    await expect.poll(async () => (await metronome(page)).phase).toBe("idle")

    // Running again, Record takes it over: the take counts in.
    await play(page).click()
    await expect(stopClick(page)).toBeVisible()
    await record(page).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    await expect.poll(async () => (await metronome(page)).phase).not.toBe("preview")
    await page.getByRole("button", { name: /^Stop/ }).click()
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(play(page)).toBeVisible()
    expect((await metronome(page)).phase).toBe("idle")
  })

  test("the warning line when the click output is missing", async ({ page }) => {
    await rehearse(page, "Pałyn", "window.__CLICK_MISSING__ = 'X18';")
    await expect(status(page)).toHaveText(
      "The click's output, X18, is not connected. The beat will only flash."
    )
    // The warning icon in amber, the words in the text's colour.
    const icon = status(page).locator("svg")
    expect(await icon.evaluate((el) => getComputedStyle(el).color)).toBe(await colour(page, "--warn"))
    expect(await status(page).evaluate((el) => getComputedStyle(el).color)).toBe(
      await colour(page, "--foreground")
    )
    // Without a tempo there is no click to miss.
    await nameNext(page, "Dym")
    await expect(status(page)).toHaveText(/^No tempo yet/)
  })

  test("nothing moves when a song is picked", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await settled(page)
    const parts = () => [
      row(page),
      onOff(page),
      tempo(page),
      unit(page),
      signature(page),
      tap(page),
      play(page).or(stopClick(page)),
      row(page).locator("[data-beat-dots]"),
      gear(page),
      status(page),
      record(page),
      finish(page),
    ]
    const boxes = async () => Promise.all(parts().map(box))
    const was = await boxes()
    for (const name of ["Ahoń", "Dym", "Take 1", "Sonca", "Pałyn"]) {
      await nameNext(page, name)
      await expect(status(page)).not.toHaveText("")
      await page.waitForTimeout(150)
      expect(await boxes(), name).toEqual(was)
    }
    // A change held, and its long line.
    await row(page).getByRole("button", { name: "Faster" }).click()
    await expect(status(page)).toContainText("Save to song")
    expect(await boxes(), "held").toEqual(was)
  })

  test("a signature change keeps the number", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await signature(page).click()
    await page.getByRole("option", { name: "6/8" }).click()
    await expect(signature(page)).toHaveText("6/8")
    await expect(tempo(page)).toHaveValue("128")
    expect(await sent(page)).toEqual([[128, "6/8"]])
    // The eighth is drawn after the number, and its tip says what it counts.
    await expect(unit(page).locator("svg")).toHaveCount(1)
    await expect(unit(page)).toHaveText("")
    await expect(dots(page)).toHaveCount(6)
    await unit(page).hover()
    await expect(page.getByRole("tooltip")).toHaveText("Eighths a minute: the six clicks of a bar")

    // A 6/8 number past what 4/4 takes comes back in its range.
    await tempo(page).fill("400")
    await tempo(page).press("Enter")
    await signature(page).click()
    await page.getByRole("option", { name: "4/4" }).click()
    await expect(tempo(page)).toHaveValue("300")
    expect((await sent(page)).at(-1)).toEqual([300, "4/4"])
  })

  test("leaving the screen stops the click", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await play(page).click()
    await expect(stopClick(page)).toBeVisible()
    await finish(page).click()
    await expect(page.getByRole("button", { name: /Start rehearsal/ })).toBeVisible()
    await expect.poll(() => callCount(page, "metronome_stop")).toBe(1)
  })

  for (const theme of ["dark", "light"] as const) {
    test(`row fits at 960 in the ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 960, height: 680 })
      await openEvening(page, themed(theme))
      await settled(page)
      const fits = async (what: string) => {
        const actions = (await page.locator("footer [data-footer-actions]").boundingBox())!
        const parts = [onOff(page), tempo(page), unit(page), signature(page), tap(page), play(page).or(stopClick(page)), row(page).locator("[data-beat-dots]"), gear(page)]
        const at = await Promise.all(parts.map((p) => p.boundingBox()))
        const middles = at.map((b) => b!.y + b!.height / 2)
        expect(Math.max(...middles) - Math.min(...middles), `${what}: one line`).toBeLessThanOrEqual(1)
        const right = Math.max(...at.map((b) => b!.x + b!.width))
        expect(right, `${what}: left of Finish`).toBeLessThanOrEqual(actions.x - 16)
        // Nothing cut: every word whole, the line on two lines at most.
        const cut = await row(page).evaluate((r) =>
          [...r.querySelectorAll<HTMLElement>("button, input, [data-status-line], [data-tempo-unit]")]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.textContent)
        )
        expect(cut, `${what}: cut`).toEqual([])
        const line = await status(page).evaluate((el) => ({
          height: el.scrollHeight,
          line: parseFloat(getComputedStyle(el).lineHeight),
        }))
        expect(line.height, `${what}: two lines at most`).toBeLessThanOrEqual(2 * line.line + 1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(960)
      }
      await nameNext(page, "Pałyn")
      await fits("Palyn")
      await row(page).getByRole("button", { name: "Faster" }).click()
      await expect(status(page)).toContainText("Save to song")
      await fits("held")
      await nameNext(page, "Ahoń")
      await expect(dots(page)).toHaveCount(6)
      await fits("Ahon in 6/8")
      // The longest line: a song with no tempo yet, and one typed in.
      await nameNext(page, "Dym")
      await tempo(page).fill("100")
      await tempo(page).press("Enter")
      await expect(status(page)).toContainText("Save now")
      await fits("Dym with a tempo typed")

      // A take open in the player: the row costs it no lane at 960x680.
      const lanes = async () =>
        page.evaluate(() => {
          // In the main part's room, above the master's band held at its bottom.
          const main = document.querySelector("main")!.getBoundingClientRect()
          const master = document.querySelector("[data-master-band]")?.getBoundingClientRect()
          const bottom = Math.min(main.bottom, master?.top ?? main.bottom)
          return [...document.querySelectorAll("[data-lane]")].filter((l) => {
            const r = l.getBoundingClientRect()
            return r.top >= main.top && r.bottom <= bottom + 0.5
          }).length
        })
      await page.locator("[aria-label='Rehearsal overview']").locator("button[aria-label^='Take 1 Pałyn']").click()
      await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
      await settled(page)
      const inView = await lanes()
      expect(inView, "lanes in view").toBeGreaterThanOrEqual(LANES_AT_960)
      await nameNext(page, "Pałyn")
      await expect(status(page)).toHaveText("The song's tempo.")
      expect(await lanes(), "lanes in view after a song is picked").toBe(inView)
    })
  }
})

/** The lanes of Pałyn 1 wholly in view at 960x680 before the row was in
 *  the footer. */
const LANES_AT_960 = 1

test.describe("while a take records", () => {
  test("count-in digits then the edge light", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await watchBeat(page)
    await record(page).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    const end = await countInEnd(page)
    await expect(row(page).locator("[data-status-line]")).toHaveText("Clicking to Stop.", { timeout: 5_000 })
    await page.waitForTimeout(1200)
    const frames = await beats(page)
    // A bar of four, the first in the accent.
    expect(digitsOf(frames)).toEqual(["1", "2", "3", "4"])
    const primary = await colour(page, "--primary")
    const firsts = frames.filter((f) => f.digit === "1").map((f) => f.digitColour)
    expect(new Set(firsts)).toEqual(new Set([primary]))
    const others = frames.filter((f) => f.digit === "3").map((f) => f.digitColour)
    expect(others.every((c) => c !== primary)).toBe(true)
    // While it counts the clock is not shown, and the edge stays dark.
    const counting = frames.filter((f) => f.digit !== null)
    expect(counting.every((f) => !f.clockShown && f.edge === null)).toBe(true)
    // Then the edge lights on the next click, the first of a bar, brighter.
    const lit = frames.filter((f) => f.edge !== null)
    expect(lit.length).toBeGreaterThan(0)
    expect(lit[0].t).toBeGreaterThanOrEqual(end - 20)
    expect(lit[0].t).toBeLessThanOrEqual(end + 80)
    expect(lit[0].edge).toBe("2")
    expect(lit.some((f) => f.edge === "0")).toBe(true)
    // On and off: dark between clicks.
    const after = frames.filter((f) => f.t > end + 100)
    expect(after.some((f) => f.edge === null)).toBe(true)
  })

  test("6/8 counts to six", async ({ page }) => {
    await rehearse(page, "Ahoń")
    await watchBeat(page)
    await record(page).click()
    await expect(row(page).locator("[data-status-line]")).toHaveText("Clicking to Stop.", { timeout: 5_000 })
    const frames = await beats(page)
    expect(digitsOf(frames)).toEqual(["1", "2", "3", "4", "5", "6"])
    const primary = await colour(page, "--primary")
    for (const d of ["1", "4"])
      expect(new Set(frames.filter((f) => f.digit === d).map((f) => f.digitColour)), d).toEqual(new Set([primary]))
    for (const d of ["2", "3", "5", "6"])
      expect(frames.filter((f) => f.digit === d).every((f) => f.digitColour !== primary), d).toBe(true)
    // The take's row: the tempo with its drawn eighth, the signature, six dots.
    await expect(row(page).locator("[data-take-tempo]")).toHaveText("198")
    await expect(row(page).locator("[data-take-tempo] svg")).toHaveCount(1)
    await expect(row(page).locator("[data-take-signature]")).toHaveText("6/8")
    await expect(row(page).locator("[data-beat-dots] [data-dot]")).toHaveCount(6)
  })

  test("the clock starts after the count-in", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await watchBeat(page)
    await record(page).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    const end = await countInEnd(page)
    await expect(page.locator("[data-clock]")).toHaveText("0:02", { timeout: 6_000 })
    const frames = await beats(page)
    // 0:00 as the count-in ends, and 0:01 a second later, give or take 0.2 s.
    const shown = frames.filter((f) => f.clockShown)
    expect(shown[0].clock).toBe("0:00")
    expect(Math.abs(shown[0].t - end)).toBeLessThanOrEqual(200)
    const one = frames.find((f) => f.clockShown && f.clock === "0:01")!
    expect(Math.abs(one.t - end - 1000)).toBeLessThanOrEqual(200)
  })

  test("the switch silences the click mid-take", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await record(page).click()
    await expect(row(page).locator("[data-status-line]")).toHaveText("Clicking to Stop.", { timeout: 5_000 })
    await expect(onOff(page)).toHaveAttribute("aria-pressed", "true")
    await onOff(page).click()
    await expect.poll(async () => (await calls(page, "metronome_set_on")).map((c) => c.args)).toEqual([[false]])
    await expect(onOff(page)).toHaveAttribute("aria-pressed", "false")
    await expect(row(page).locator("[data-status-line]")).toHaveText(
      "Click off. The tempo still goes into the take."
    )
    await page.waitForTimeout(400)
    await watchBeat(page)
    await page.waitForTimeout(1000)
    const frames = await beats(page)
    expect(frames.filter((f) => f.edge !== null || f.dotLit)).toEqual([])
    // On again, and it clicks on the beat.
    await onOff(page).click()
    await expect(row(page).locator("[data-status-line]")).toHaveText("Clicking to Stop.")
    await watchBeat(page)
    await page.waitForTimeout(1000)
    expect((await beats(page)).some((f) => f.edge !== null)).toBe(true)
  })

  test("no click, no light", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await watchBeat(page)
    await record(page).click()
    await expect(row(page).locator("[data-status-line]")).toHaveText("No click: this take has no tempo.")
    await page.waitForTimeout(1000)
    const frames = (await beats(page)).filter((f) => f.clock !== null)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((f) => f.clockShown && f.digit === null && f.edge === null && !f.dotLit)).toBe(true)
    await expect(row(page).locator("[data-beat-dots]")).toHaveCount(0)
  })

  test("the edge light shows with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await rehearse(page, "Pałyn")
    await record(page).click()
    const look = await litLook(page, "2")
    expect(look).toMatchObject({ transition: "0s", animation: "none", hidden: "true" })
    expect(look.shadow).toMatch(/inset/)
    expect(look.shadow).toMatch(/14px/)
    // The others of the bar, half as wide.
    expect((await litLook(page, "0")).shadow).toMatch(/ 7px/)
  })

  for (const theme of ["dark", "light"] as const) {
    test(`the take row fits at 960 beside the status in the ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 960, height: 680 })
      await rehearse(page, "Ahoń", `${themed(theme)} window.__CLICK_MISSING__ = 'Headphone amp';`)
      await record(page).click()
      const take = row(page)
      await expect(take.locator("[data-status-line]")).toHaveText(
        "The click's output, Headphone amp, is not connected. The beat will only flash."
      )
      await settled(page)
      // The take's row at the far left; the status row, then Stop, at the right.
      const footer = (await page.locator("footer").boundingBox())!
      const at = (await take.boundingBox())!
      const statusRow = (await page.locator("footer [data-status-row]").boundingBox())!
      const stop = (await page.getByRole("button", { name: /^Stop/ }).boundingBox())!
      expect(at.x).toBeLessThanOrEqual(footer.x + 32 + 0.5)
      const parts = take.locator("[data-take-reading] > *")
      const right = Math.max(
        ...(await parts.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right)))
      )
      expect(right, "the reading left of the status").toBeLessThanOrEqual(statusRow.x - 16)
      expect(statusRow.x + statusRow.width, "the status left of Stop").toBeLessThanOrEqual(stop.x)
      const tops = await parts.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return r.top + r.height / 2
        })
      )
      expect(Math.max(...tops) - Math.min(...tops), "one line").toBeLessThanOrEqual(1)
      const line = await take.locator("[data-status-line]").evaluate((el) => ({
        height: el.scrollHeight,
        line: parseFloat(getComputedStyle(el).lineHeight),
        right: el.getBoundingClientRect().right,
      }))
      expect(line.height, "two lines at most").toBeLessThanOrEqual(2 * line.line + 1)
      expect(line.right, "the line left of the status").toBeLessThanOrEqual(statusRow.x - 16)
      // No gear, no Tap, no tempo field during a take.
      await expect(take.getByRole("textbox")).toHaveCount(0)
      await expect(take.getByRole("button", { name: /^Tap/ })).toHaveCount(0)
      await expect(take.getByRole("button", { name: "Metronome settings" })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(960)
    })
  }
})

test("the gear holds the four settings, and a sound picked plays a bar", async ({ page }) => {
  await rehearse(page, "Pałyn")
  await gear(page).click()
  const pop = page.getByRole("dialog", { name: "Metronome settings" })
  await expect(pop).toBeVisible()
  await expect(pop.getByRole("combobox", { name: "Click output" })).toBeVisible()
  await expect(pop.getByRole("radiogroup", { name: "Sound" }).getByRole("radio")).toHaveText([
    "Click",
    "Woodblock",
    "Hi-hat",
  ])
  await expect(pop.getByRole("radiogroup", { name: "Count-in" }).getByRole("radio")).toHaveText([
    "None",
    "1 bar",
    "2 bars",
  ])
  await expect(pop.getByRole("slider", { name: "Click volume" })).toHaveAttribute("aria-valuenow", "0.7")
  await expect(pop).toContainText("The same settings are in Settings › Metronome.")
  await pop.getByRole("radio", { name: "Woodblock" }).click()
  await expect.poll(async () => (await calls(page, "set_metronome_setting")).map((c) => c.args)).toEqual([
    ["click_sound", "wood"],
  ])
  await expect.poll(async () => (await calls(page, "metronome_preview")).map((c) => c.args)).toEqual([["wood"]])
  await pop.getByRole("radio", { name: "2 bars" }).click()
  await expect.poll(async () => (await calls(page, "set_metronome_setting")).at(-1)?.args).toEqual([
    "count_in_bars",
    2,
  ])
  // The volume is set when it is let go, and a bar plays at it.
  await pop.getByRole("slider", { name: "Click volume" }).focus()
  await page.keyboard.press("ArrowLeft")
  await expect.poll(async () => (await calls(page, "set_metronome_setting")).at(-1)?.args).toEqual([
    "click_volume",
    0.69,
  ])
  await page.keyboard.press("Escape")
  await expect(pop).toHaveCount(0)
})
