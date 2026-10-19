import {
  callCount,
  calls,
  colour,
  dragRegion,
  expect,
  notices,
  openApp,
  openBandApp,
  openEvening,
  openHistory,
  settled,
  startButton,
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
      const line = document.querySelector<HTMLElement>("footer [data-status-line]")
      w.__BEAT__.push({
        t: performance.now(),
        digit: count?.textContent?.trim() || null,
        digitColour: count ? getComputedStyle(count).color : null,
        clock: clock?.textContent ?? null,
        clockShown: clock ? getComputedStyle(clock).visibility === "visible" : false,
        edge: edge?.hasAttribute("data-lit") ? edge.getAttribute("data-accent") : null,
        dotLit: lit > 0,
        line: line?.textContent ?? null,
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
  /** The metronome row's line. */
  line: string | null
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

/** Holds the fake's answer to `name` until `letGo`. */
const hold = (page: Page, name: string) =>
  page.evaluate((n) => {
    const w = window as unknown as { __HOLD__?: Record<string, Promise<void>>; __LET_GO__?: () => void }
    w.__HOLD__ = { ...w.__HOLD__, [n]: new Promise<void>((r) => (w.__LET_GO__ = r)) }
  }, name)
const letGo = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __HOLD__?: object; __LET_GO__: () => void }
    w.__HOLD__ = {}
    w.__LET_GO__()
  })

/** From now on, each value the tempo field shows, once, in order; read back
 *  with `tempos`. */
const watchTempo = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __TEMPOS__: string[]; __WATCH_TEMPO__: boolean }
    w.__TEMPOS__ = []
    w.__WATCH_TEMPO__ = true
    const look = () => {
      if (!w.__WATCH_TEMPO__) return
      const v = document.querySelector<HTMLInputElement>("footer input[aria-label='Tempo']")?.value
      if (v !== undefined && v !== w.__TEMPOS__.at(-1)) w.__TEMPOS__.push(v)
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
const tempos = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __TEMPOS__: string[]; __WATCH_TEMPO__: boolean }
    w.__WATCH_TEMPO__ = false
    return w.__TEMPOS__
  })

/** The fake's bridge, to change one of its answers while a test runs. */
type Bridge = {
  pywebview: { api: Record<string, (...args: unknown[]) => Promise<unknown>> }
  __GATES__: (() => void)[]
}

/** Where the click was sent, in order: its device, then its outputs. */
const clickOutputCalls = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__
      .filter((c) => c.name === "set_click_device" || c.name === "set_click_channels")
      .map((c) => [c.name, ...c.args])
  )

/** The player plays through UA Monitors, the fake's first output. */
const playerOnMonitors = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).pywebview.api.set_output_device(0))

/** A song with a take tonight and no tempo: Dym, the next take's name. */
async function dymToCount(page: Page) {
  await openApp(page, { before: "window.__TONIGHT__ = [{name: 'Dym', duration_sec: 200}];" })
  await startRehearsal(page, 2)
  // The field offers Dym again, so another song is named first.
  await nameNext(page, "Pałyn")
  await nameNext(page, "Dym")
  await expect(status(page)).toHaveText("No tempo yet: type or tap one, or count it from the last take")
}

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

  test("a signature picked after a count counts the take again", async ({ page }) => {
    await dymToCount(page)
    await status(page).getByRole("button", { name: "count it from the last take" }).click()
    await expect(tempo(page)).toHaveValue("104")
    // The same count in 6/8 is Python's to say, in eighths: not 104 kept.
    await signature(page).click()
    await page.getByRole("option", { name: "6/8" }).click()
    await expect(tempo(page)).toHaveValue("208")
    expect((await calls(page, "count_tempo")).map((c) => c.args.at(-1))).toEqual(["4/4", "6/8"])
    expect((await sent(page)).at(-1)).toEqual([208, "6/8"])
    await expect(status(page)).toHaveText(/^Counted from Dym \d+\. Pick the time signature, then save it to the song$/)

    // A number typed over the count is the band's: a signature keeps it.
    await tempo(page).fill("200")
    await tempo(page).press("Enter")
    await expect(status(page)).toHaveText(
      "No tempo in the song yet: the first take played to the click keeps this one. Save now"
    )
    await signature(page).click()
    await page.getByRole("option", { name: "3/4" }).click()
    await expect(tempo(page)).toHaveValue("200")
    expect((await sent(page)).at(-1)).toEqual([200, "3/4"])
    expect(await calls(page, "count_tempo")).toHaveLength(2)
  })

  test("a count is dropped when the next take names another song, or a tempo is typed, meanwhile", async ({ page }) => {
    await dymToCount(page)
    await hold(page, "count_tempo")
    await status(page).getByRole("button", { name: "count it from the last take" }).click()
    await expect(status(page)).toHaveText("Counting the tempo from the last take…")
    await nameNext(page, "Pałyn")
    await expect(tempo(page)).toHaveValue("128")
    await letGo(page)
    await page.waitForTimeout(500)
    // Dym's count is not Pałyn's tempo, nor held for Dym.
    expect(await sent(page)).toEqual([])
    await expect(tempo(page)).toHaveValue("128")
    await expect(status(page)).toHaveText("The song's tempo.")
    await nameNext(page, "Dym")
    await expect(tempo(page)).toHaveValue("")

    // A tempo typed while it counts is the band's: the count does not
    // replace it.
    await hold(page, "count_tempo")
    await status(page).getByRole("button", { name: "count it from the last take" }).click()
    await expect(status(page)).toHaveText("Counting the tempo from the last take…")
    await tempo(page).fill("99")
    await tempo(page).press("Enter")
    await expect(tempo(page)).toHaveValue("99")
    await letGo(page)
    await page.waitForTimeout(500)
    expect(await sent(page)).toEqual([[99, "4/4"]])
    await expect(tempo(page)).toHaveValue("99")
  })

  test("quick presses hold, and a refused change goes back", async ({ page }) => {
    await rehearse(page, "Pałyn")
    await expect(tempo(page)).toHaveValue("128")
    // Python answers the first press late, and takes the second later
    // still: the field never shows the first again meanwhile.
    await page.evaluate(() => {
      const w = window as unknown as Bridge
      const api = w.pywebview.api
      const real = api.metronome_set
      w.__GATES__ = []
      const gate = () => new Promise<void>((r) => w.__GATES__.push(r))
      let n = 0
      api.metronome_set = async (...args) => {
        const k = n++
        if (k === 1) await gate()
        const res = await real(...args)
        if (k === 0) await gate()
        return res
      }
    })
    await watchTempo(page)
    const faster = row(page).getByRole("button", { name: "Faster" })
    await faster.click()
    await faster.click()
    await expect(tempo(page)).toHaveValue("130")
    await page.evaluate(() => (window as unknown as Bridge).__GATES__[0]())
    await page.waitForTimeout(400)
    await page.evaluate(() => (window as unknown as Bridge).__GATES__[1]())
    await expect.poll(async () => (await metronome(page)).tempo).toBe(130)
    await page.waitForTimeout(300)
    expect(await tempos(page)).toEqual(["128", "129", "130"])

    // Refused: the field goes back to what Python holds, and says why.
    await page.evaluate(() => {
      ;(window as unknown as Bridge).pywebview.api.metronome_set = async () => ({ ok: false, error: "Not now" })
    })
    await faster.click()
    await expect(page.getByText("Not now")).toBeVisible()
    await expect(tempo(page)).toHaveValue("130")
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
    // Empty, the field shows a dash.
    await expect(tempo(page)).toHaveValue("")
    await expect(tempo(page)).toHaveAttribute("placeholder", "—")
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
    // Each with its label in plain letters, as test labels keep to cp1252.
    const songs = [
      ["Ahoń", "Ahon"],
      ["Dym", "Dym"],
      ["Take 1", "Take 1"],
      ["Sonca", "Sonca"],
      ["Pałyn", "Palyn"],
    ]
    for (const [name, label] of songs) {
      await nameNext(page, name)
      await expect(status(page)).not.toHaveText("")
      await page.waitForTimeout(150)
      expect(await boxes(), label).toEqual(was)
    }
    // A change held, and its long line.
    await row(page).getByRole("button", { name: "Faster" }).click()
    await expect(status(page)).toContainText("Save to song")
    expect(await boxes(), "held").toEqual(was)
  })

  test("a signature change keeps the number", async ({ page }) => {
    await rehearse(page, "Pałyn")
    // The row has followed the name to Pałyn's tempo before it is changed.
    await expect(tempo(page)).toHaveValue("128")
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
      expect(inView, "lanes in view").toBe(LANES_AT_960)
      await nameNext(page, "Pałyn")
      await expect(status(page)).toHaveText("The song's tempo.")
      expect(await lanes(), "lanes in view after a song is picked").toBe(inView)
    })
  }
})

/** The lanes of Pałyn 1 wholly in view at 960x680 before the row was in
 *  the footer, measured on that build (26dc6a8) in both themes: its one
 *  lane, 18 px clear of the master's band. With the row it is 4 px clear. */
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

  test("the clock waits at 0:00 until the count-in is known", async ({ page }) => {
    // Python chooses the first click a second and a half after Record, as
    // with the click on another device: until then the take says it counts
    // in, with no time for it yet.
    await rehearse(page, "Pałyn", "window.__COUNT_IN_LATE_MS__ = 1500;")
    await watchBeat(page)
    await record(page).click()
    await expect(row(page).locator("[data-status-line]")).toHaveText("Clicking to Stop.", { timeout: 6_000 })
    const frames = await beats(page)
    const first = frames.findIndex((f) => f.digit !== null)
    expect(first, "the count-in came").toBeGreaterThan(0)
    // Held at 0:00 meanwhile: never a clock run from Record, then hidden.
    const before = frames.slice(0, first)
    expect(before.some((f) => f.clockShown), "the clock shown while it waits").toBe(true)
    expect(before.filter((f) => f.clockShown && f.clock !== "0:00")).toEqual([])
    // Nor is a count-in said before its first click is chosen.
    expect(before.filter((f) => f.line?.startsWith("Count-in"))).toEqual([])
    expect(digitsOf(frames)).toEqual(["1", "2", "3", "4"])
    // And from the count-in's end it counts from 0:00.
    const after = frames.slice(first).filter((f) => f.clockShown)
    expect(after[0].clock).toBe("0:00")
  })

  test("an answer from before the take leaves the clock waiting for it", async ({ page }) => {
    // Python's first answers on the recording screen still say the row is
    // between takes: they settle nothing, and the take's count-in, when it
    // is said, has the clock's place. Its first click is chosen after
    // those answers, so the whole count is seen.
    await rehearse(page, "Pałyn", "window.__TAKE_LATE_MS__ = 500; window.__COUNT_IN_LATE_MS__ = 800;")
    await watchBeat(page)
    await record(page).click()
    await expect(row(page).locator("[data-status-line]")).toHaveText("Clicking to Stop.", { timeout: 6_000 })
    const frames = await beats(page)
    expect(digitsOf(frames)).toEqual(["1", "2", "3", "4"])
    const first = frames.findIndex((f) => f.digit !== null)
    expect(frames.slice(0, first).filter((f) => f.clockShown && f.clock !== "0:00")).toEqual([])
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
  // The volume is set when it is let go, and a bar plays at it: once for
  // a run of key presses, not at each step.
  const volumes = async () =>
    (await calls(page, "set_metronome_setting")).filter((c) => c.args[0] === "click_volume").map((c) => c.args[1])
  const previews = async () => (await calls(page, "metronome_preview")).map((c) => c.args)
  await pop.getByRole("slider", { name: "Click volume" }).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft")
  await expect(pop.getByRole("slider", { name: "Click volume" })).toHaveAttribute("aria-valuenow", "0.67")
  await expect.poll(volumes).toEqual([0.67])
  await expect.poll(previews).toEqual([["wood"], []])
  await page.waitForTimeout(500)
  expect(await volumes()).toEqual([0.67])
  expect(await previews()).toEqual([["wood"], []])
  await page.keyboard.press("Escape")
  await expect(pop).toHaveCount(0)
})

test.describe("the click's output", () => {
  const device = (page: Page) =>
    page.getByRole("dialog", { name: "Metronome settings" }).getByRole("combobox", { name: "Click output" })
  const outputs = (page: Page) =>
    page.getByRole("dialog", { name: "Metronome settings" }).getByRole("combobox", { name: "Outputs" })

  test("the click goes where the player plays until its output is picked", async ({ page }) => {
    await rehearse(page, "Pałyn")
    // The player on the system output: nothing of the click's to pick.
    await gear(page).click()
    await expect(device(page)).toHaveText("Where the player plays")
    await expect(outputs(page)).toHaveText("1–2")
    await expect(outputs(page)).toBeDisabled()
    await page.keyboard.press("Escape")

    // The player on UA Monitors: its outputs are the ones shown.
    await playerOnMonitors(page)
    await gear(page).click()
    await expect(device(page)).toHaveText("Where the player plays")
    await expect(outputs(page)).toHaveText("1–2")
    // Outputs picked with no device saved: the device is saved first, so
    // the outputs shown are the ones the click uses.
    await outputs(page).click()
    await page.getByRole("option", { name: "2 (mono)" }).click()
    await expect.poll(() => clickOutputCalls(page)).toEqual([
      ["set_click_device", 0],
      ["set_click_channels", [2]],
    ])
    await expect(device(page)).toContainText("UA Monitors")
    await expect(outputs(page)).toHaveText("2 (mono)")

    // And back to where the player plays.
    await device(page).click()
    await page.getByRole("option", { name: "Where the player plays" }).click()
    await expect.poll(async () => (await clickOutputCalls(page)).at(-1)).toEqual(["set_click_device", null])
    await expect(device(page)).toHaveText("Where the player plays")
    await expect(outputs(page)).toHaveText("1–2")
  })

  test("an unplugged click output shows under its own name, and is not replaced", async ({ page }) => {
    await rehearse(
      page,
      "Pałyn",
      `localStorage.setItem("mock-python-config", JSON.stringify({theme: "dark", ui_scale: 1,
        click_device_index: 7, click_channels: [3, 4]}));
      window.__CLICK_MISSING__ = "Headphone amp";`
    )
    // As Python does, the settings give no device for an output that is not
    // plugged in: only metronome_state names it.
    const saved = await page.evaluate(() =>
      (window as unknown as Bridge).pywebview.api.get_settings()
    )
    expect(saved).toMatchObject({ click_device_index: null, click_channels: [3, 4] })
    // The player has an output of its own, which is not the click's.
    await playerOnMonitors(page)
    await gear(page).click()
    await expect(device(page)).toHaveText("“Headphone amp” is not connected")
    await expect(device(page)).not.toContainText("Where the player plays")
    await expect(outputs(page)).toHaveText("3–4")
    // Its outputs cannot be picked, so the player's device is never saved
    // over it.
    await expect(outputs(page)).toBeDisabled()
    await outputs(page).click({ force: true })
    await page.waitForTimeout(300)
    await expect(page.getByRole("option")).toHaveCount(0)
    expect(await clickOutputCalls(page)).toEqual([])
  })
})

// ---- Settings › Metronome, a song's page in History, and Master --------
// (spec Parts 6, 7 and 8): the same settings in the tab as behind the gear,
// a song's tempo saved from its page at once, and the click on Master with
// its stripes in the player.

/** Settings, on its Metronome tab. */
async function metronomeTab(page: Page, before = "") {
  await openApp(page, { before })
  await page.getByRole("button", { name: "Settings" }).click()
  await sectionButton(page, "Metronome").click()
  await expect(page.locator("[data-tab-head]")).toContainText("Where the click is heard, its sound, and the count-in")
}
const sectionButton = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name, exact: true })
const tabBody = (page: Page) => page.locator("[data-tab-body]")
const settingCalls = async (page: Page) => (await calls(page, "set_metronome_setting")).map((c) => c.args)
const previews = async (page: Page) => (await calls(page, "metronome_preview")).map((c) => c.args)
const checkedIn = (where: Locator, group: string) =>
  where.getByRole("radiogroup", { name: group }).getByRole("radio", { checked: true })

test("the tab and the gear show the same settings", async ({ page }) => {
  await metronomeTab(
    page,
    `localStorage.setItem("mock-python-config", JSON.stringify({theme: "dark", ui_scale: 1,
      click_sound: "hihat", click_volume: 0.4, count_in_bars: 2}));`
  )
  const tab = tabBody(page)
  const output = tab.getByRole("region", { name: "Click output" })
  await expect(output).toContainText(
    "Where the click is heard. A pair of outputs that feeds only the headphones keeps it off the mics."
  )
  await expect(output.getByRole("combobox", { name: "Click output" })).toHaveText("Where the player plays")
  await expect(checkedIn(tab, "Sound")).toHaveText("Hi-hat")
  await expect(checkedIn(tab, "Count-in")).toHaveText("2 bars")
  await expect(tab.getByRole("slider", { name: "Click volume" })).toHaveAttribute("aria-valuenow", "0.4")
  await expect(tab).toContainText(
    "Clicked before every take that has the click. It is in the recording; the take's clock starts after it."
  )
  await expect(tab).toContainText(
    "The same settings are behind the gear in the metronome row, on the rehearsal screen."
  )
  // Changed in the tab, and the gear shows it: one setting underneath.
  await tab.getByRole("radio", { name: "Woodblock" }).click()
  await expect.poll(() => settingCalls(page)).toEqual([["click_sound", "wood"]])
  await page.getByRole("button", { name: "Back" }).click()
  await startRehearsal(page)
  await nameNext(page, "Pałyn")
  await gear(page).click()
  const pop = page.getByRole("dialog", { name: "Metronome settings" })
  await expect(pop.getByRole("combobox", { name: "Click output" })).toHaveText("Where the player plays")
  await expect(checkedIn(pop, "Sound")).toHaveText("Woodblock")
  await expect(checkedIn(pop, "Count-in")).toHaveText("2 bars")
  await expect(pop.getByRole("slider", { name: "Click volume" })).toHaveAttribute("aria-valuenow", "0.4")
  // The WAV setting is the tab's only.
  await expect(pop.getByRole("checkbox")).toHaveCount(0)
})

test("picking a sound plays a bar", async ({ page }) => {
  await metronomeTab(page)
  const tab = tabBody(page)
  await expect(tab).toContainText("The first beat of a bar is higher, in 6/8 the fourth too. Pick one to hear it.")
  await tab.getByRole("radio", { name: "Hi-hat" }).click()
  await expect.poll(() => settingCalls(page)).toEqual([["click_sound", "hihat"]])
  await expect.poll(() => previews(page)).toEqual([["hihat"]])
  await expect(checkedIn(tab, "Sound")).toHaveText("Hi-hat")
  // The volume plays a bar once it is let go, at the sound picked.
  await tab.getByRole("slider", { name: "Click volume" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => settingCalls(page)).toEqual([
    ["click_sound", "hihat"],
    ["click_volume", 0.71],
  ])
  await expect.poll(() => previews(page)).toEqual([["hihat"], []])
})

test("the WAV checkbox is on by default and saves", async ({ page }) => {
  await metronomeTab(page)
  const tab = tabBody(page)
  const wav = tab.getByRole("checkbox", { name: "Write the tempo into WAV files" })
  await expect(wav).toBeChecked()
  await expect(tab).toContainText(
    "Takes recorded to the click get their tempo and time signature in each WAV. Cubase, Pro Tools, Studio One and FL Studio then fit them to the project's tempo, so set the project to the song's tempo first. Ableton Live and Logic ignore it."
  )
  await wav.click()
  await expect.poll(() => settingCalls(page)).toEqual([["tempo_in_wav", false]])
  await expect(wav).not.toBeChecked()
  // Read back from the settings when the tab opens again.
  await sectionButton(page, "Audio").click()
  await sectionButton(page, "Metronome").click()
  await expect(tabBody(page).getByRole("checkbox", { name: "Write the tempo into WAV files" })).not.toBeChecked()
  await tabBody(page).getByRole("checkbox", { name: "Write the tempo into WAV files" }).click()
  await expect.poll(async () => (await settingCalls(page)).at(-1)).toEqual(["tempo_in_wav", true])
})

test("a second ASIO card is not offered for the click", async ({ page }) => {
  // On Windows the fake's X32 USB is an ASIO card that cannot take the click.
  await metronomeTab(page, "window.__HOST_API__ = 'Windows WASAPI';")
  const output = tabBody(page).getByRole("region", { name: "Click output" })
  await output.getByRole("combobox", { name: "Driver" }).click()
  await page.getByRole("option", { name: "ASIO" }).click()
  await output.getByRole("combobox", { name: "Click output" }).click()
  const card = page.getByRole("option", { name: /X32 USB/ })
  // Listed, so its reason is seen, and not to be picked.
  await expect(card).toHaveAttribute("aria-disabled", "true")
  await expect(card).toContainText("Another ASIO card can't play while one records.")
  await card.click({ force: true })
  await page.waitForTimeout(200)
  expect(await clickOutputCalls(page)).toEqual([])
  await page.keyboard.press("Escape")
  await expect(output.getByRole("combobox", { name: "Click output" })).toHaveText("Where the player plays")
})

/** History's Songs view, on `title`'s page. */
async function songPage(page: Page, title: string) {
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator(`[data-song='${title}']`).click()
  await expect(page.locator("[data-song-head]").getByRole("heading", { name: title, exact: true })).toBeVisible()
}
/** The tempo row under a song's title, and its line. */
const songRow = (page: Page) => page.locator("[data-song-head]").getByRole("region", { name: "Tempo" })
const songLine = (page: Page) => songRow(page).locator("[data-song-tempo-line]")
const songTempos = async (page: Page) => (await calls(page, "set_song_tempo")).map((c) => c.args.slice(1))

test("song page counts a tempo and halves it", async ({ page }) => {
  await openBandApp(page)
  await openHistory(page)
  await songPage(page, "Dym")
  const row = songRow(page)
  await expect(row.getByRole("textbox", { name: "Tempo" })).toHaveValue("")
  await expect(songLine(page)).toHaveText("No tempo yet: type or tap one, or count it from a take")
  await row.getByRole("button", { name: "count it from a take" }).click()
  const menu = page.getByRole("menu", { name: "count it from a take" })
  await expect(menu).toContainText("Count the tempo from a whole take of the song:")
  // The starred take first, then the newest.
  expect(
    await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.getAttribute("data-take")))
  ).toEqual(["Dym 5", "Dym 4", "Dym 3", "Dym 2", "Dym"])
  await menu.getByRole("menuitem").first().click()
  await expect.poll(async () => (await calls(page, "count_tempo")).map((c) => c.args)).toEqual([
    ["/rec/sat", 4, "4/4"],
  ])
  // Saved to the song at once.
  await expect.poll(() => songTempos(page)).toEqual([[104, "4/4"]])
  await expect(row.getByRole("textbox", { name: "Tempo" })).toHaveValue("104")
  await expect(songLine(page)).toHaveText(
    "Counted from Dym 5; pick the time signature. If the click runs twice too fast or too slow: halve or double."
  )
  await songLine(page).getByRole("button", { name: "halve" }).click()
  await expect(row.getByRole("textbox", { name: "Tempo" })).toHaveValue("52")
  await songLine(page).getByRole("button", { name: "double" }).click()
  await expect(row.getByRole("textbox", { name: "Tempo" })).toHaveValue("104")
  await expect.poll(() => songTempos(page)).toEqual([
    [104, "4/4"],
    [52, "4/4"],
    [104, "4/4"],
  ])
  // The count is kept while the page is open: a signature picked counts
  // the same take in it.
  await row.getByRole("combobox", { name: "Time signature" }).click()
  await page.getByRole("option", { name: "6/8" }).click()
  await expect.poll(async () => (await calls(page, "count_tempo")).at(-1)?.args).toEqual(["/rec/sat", 4, "6/8"])
  await expect(row.getByRole("textbox", { name: "Tempo" })).toHaveValue("208")
  await expect.poll(async () => (await songTempos(page)).at(-1)).toEqual([208, "6/8"])
  await expect(row.locator("[data-tempo-unit] svg")).toHaveCount(1)
  await expect(songLine(page)).toContainText("Counted from Dym 5")
  // Away and back, the song has its tempo and the count is over.
  await songPage(page, "Pałyn")
  await songPage(page, "Dym")
  await expect(songRow(page).getByRole("textbox", { name: "Tempo" })).toHaveValue("208")
  await expect(songLine(page)).toHaveText("Picking Dym at a rehearsal puts this in the metronome.")
})

test("song page tempo saves at once", async ({ page }) => {
  await openBandApp(page)
  await openHistory(page)
  await songPage(page, "Pałyn")
  const row = songRow(page)
  const field = row.getByRole("textbox", { name: "Tempo" })
  await expect(field).toHaveValue("128")
  await expect(songLine(page)).toHaveText("Picking Pałyn at a rehearsal puts this in the metronome.")
  // Counting is not offered for a song that has a tempo.
  await expect(row.getByRole("button", { name: "count it from a take" })).toHaveCount(0)
  await row.getByRole("button", { name: "Faster" }).click()
  await expect.poll(() => songTempos(page)).toEqual([[129, "4/4"]])
  await field.fill("140")
  await field.press("Enter")
  await expect.poll(() => songTempos(page)).toEqual([
    [129, "4/4"],
    [140, "4/4"],
  ])
  await row.getByRole("combobox", { name: "Time signature" }).click()
  await page.getByRole("option", { name: "3/4" }).click()
  await expect.poll(async () => (await songTempos(page)).at(-1)).toEqual([140, "3/4"])
  // ▶ clicks at the song's tempo, unlike the head's round ▶, and leaves the
  // metronome as it found it.
  const play = row.getByRole("button", { name: "Play the click" })
  expect((await play.boundingBox())!.height).toBe(32)
  await play.click()
  await expect.poll(() => callCount(page, "metronome_play")).toBe(1)
  expect((await calls(page, "metronome_set")).map((c) => c.args)).toEqual([[140, "3/4"]])
  await expect.poll(async () => (await metronome(page)).phase).toBe("preview")
  await row.getByRole("button", { name: "Stop the click" }).click()
  await expect.poll(() => callCount(page, "metronome_stop")).toBe(1)
  await expect.poll(async () => (await calls(page, "metronome_set")).map((c) => c.args)).toEqual([
    [140, "3/4"],
    [null, "4/4"],
  ])
  // Saved: the page opened again reads it back.
  await songPage(page, "Viasna")
  await songPage(page, "Pałyn")
  await expect(songRow(page).getByRole("textbox", { name: "Tempo" })).toHaveValue("140")
  await expect(songRow(page).getByRole("combobox", { name: "Time signature" })).toHaveText("3/4")
  // Tap, and T, listen to the band's pads. Last, as two taps make a tempo.
  await songRow(page).getByRole("button", { name: /^Tap/ }).click()
  await expect.poll(() => callCount(page, "metronome_tap_listen")).toBe(1)
  await page.keyboard.press("t")
  await expect.poll(() => callCount(page, "metronome_tap_listen")).toBe(2)
})

/** A take of the evening, opened in the player. */
async function openTake(page: Page, label: string) {
  await page.locator(`[aria-label='Rehearsal overview'] button[aria-label^='${label}']`).click()
  await expect(page.locator("[data-master-plate]")).toBeVisible()
  await settled(page)
}
const masterClick = (page: Page) =>
  page.locator("[data-master-plate]").getByRole("button", { name: "Click with the take" })
const masterLane = (page: Page) => page.locator("[data-master-lane]")
const clickTag = (page: Page) => masterLane(page).locator("[data-click-tag]")
const clickLines = (page: Page) => masterLane(page).locator("[data-click-line]")
/** The middle of each stripe, in the page's pixels. */
const stripesAt = (page: Page) =>
  clickLines(page).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return r.x + r.width / 2
    })
  )
const clickSent = async (page: Page) => (await calls(page, "player_set_click")).map((c) => c.args)
/** A notice that says exactly `text`. */
const said = (page: Page, text: string) =>
  notices(page).filter({
    has: page.locator("p", { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
  })

test("master click plays with the take", async ({ page }) => {
  await openEvening(page, "", [
    { name: "Pałyn", duration_sec: 200 },
    { name: "Ahoń", duration_sec: 150 },
  ])
  await openTake(page, "Take 1 Pałyn")
  const button = masterClick(page)
  // Off when the app starts.
  await expect(button).toBeEnabled()
  await expect(button).toHaveAttribute("aria-pressed", "false")
  await button.hover()
  await expect(page.getByRole("tooltip")).toHaveText("Click with the take: 128 bpm · 4/4")
  await expect(clickTag(page)).toHaveText("Click 128 bpm · 4/4")
  await expect(masterLane(page).locator("[data-click-lines]")).toHaveCSS("opacity", "0.5")
  await button.click()
  await expect.poll(() => clickSent(page)).toEqual([[true]])
  await expect(button).toHaveAttribute("aria-pressed", "true")
  // Grey when on, as every switch: never the accent.
  await expect(button).toHaveCSS("background-color", await colour(page, "--selected"))
  await expect(masterLane(page).locator("[data-click-lines]")).toHaveCSS("opacity", "1")
  // It stays as left from one take to the next; in 6/8 the tag counts eighths.
  await page.getByRole("group", { name: "Take strip" }).getByRole("button", { name: /^Ahoń, take 1,/ }).click()
  await expect(clickTag(page)).toHaveText(/^Click 198\s*· 6\/8$/)
  await expect(clickTag(page).locator("svg")).toHaveCount(1)
  await expect(masterClick(page)).toHaveAttribute("aria-pressed", "true")
  await masterClick(page).click()
  await expect.poll(() => clickSent(page)).toEqual([[true], [false]])
  await expect(masterClick(page)).toHaveAttribute("aria-pressed", "false")
})

test("master stripes follow zoom", async ({ page }) => {
  // Ten minutes at 128: 1280 clicks.
  await openEvening(page, "", [{ name: "Pałyn", duration_sec: 600 }])
  await openTake(page, "Take 1 Pałyn")
  const well = (await masterLane(page).boundingBox())!
  // The whole take: every fourth bar, 7.5 s apart, the first on the file's
  // first sample.
  await expect(clickLines(page)).toHaveCount(81)
  expect(await clickLines(page).evaluateAll((els) => els.every((e) => e.hasAttribute("data-bar")))).toBe(true)
  const whole = await stripesAt(page)
  expect(Math.abs(whole[0] - well.x)).toBeLessThanOrEqual(1)
  for (let i = 1; i < whole.length; i++)
    expect(Math.abs(whole[i] - whole[i - 1] - (well.width * 7.5) / 600)).toBeLessThanOrEqual(0.6)
  // Closest: two seconds in view, every click, the bars among them.
  const surface = (await page.getByRole("group", { name: "Take timeline" }).boundingBox())!
  await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -3000)
  await page.keyboard.up("Control")
  await expect(page.getByText("closest zoom")).toBeVisible()
  const near = await stripesAt(page)
  expect(near.length).toBeGreaterThanOrEqual(4)
  expect(near.length).toBeLessThanOrEqual(5)
  for (let i = 1; i < near.length; i++)
    expect(Math.abs(near[i] - near[i - 1] - (well.width * (60 / 128)) / 2)).toBeLessThanOrEqual(0.6)
  const bars = await clickLines(page).evaluateAll((els) => els.map((e) => e.hasAttribute("data-bar")))
  expect(bars.filter(Boolean).length).toBeGreaterThanOrEqual(1)
  expect(bars.filter((b) => !b).length).toBeGreaterThanOrEqual(2)
})

test("a take without the click", async ({ page }) => {
  await openEvening(page)
  await openTake(page, "Take 6")
  await expect(masterClick(page)).toBeDisabled()
  await page.locator("[data-master-click]").hover()
  await expect(page.getByRole("tooltip")).toHaveText("This take was recorded without the click")
  await expect(clickTag(page)).toHaveText("Recorded without the click")
  await expect(clickLines(page)).toHaveCount(0)
})

test("a cropped click take says where it starts", async ({ page }) => {
  // Python puts a click take's region on its grid: its start back to the
  // bar line before it.
  await openEvening(page, "window.__CROP_ON_GRID__ = true;")
  await openTake(page, "Take 2 Pałyn 2")
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect.poll(() => callCount(page, "crop_take")).toBe(1)
  await expect(said(page, "“Pałyn 2” is cropped from the bar at 0:01. The uncut take went to the Trash.")).toHaveCount(1)
  // The same notice for a take still on the review screen.
  await page.keyboard.press("Escape")
  await nameNext(page, "Pałyn")
  await page.getByRole("button", { name: /Record take 11/ }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(page.locator("[data-take-summary]")).toBeVisible()
  await settled(page)
  await dragRegion(page, 0.4, 0.9)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect.poll(() => callCount(page, "crop_draft")).toBe(1)
  await expect(said(page, "“Pałyn 5” is cropped from the bar at 0:01. The uncut take went to the Trash.")).toHaveCount(1)
})

test("master lane lines up with the tracks at 960", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openEvening(page)
  await openTake(page, "Take 1 Pałyn")
  const group = (await page.locator("[data-master-group]").boundingBox())!
  const lanes = (await page.locator("[data-lanes]").boundingBox())!
  expect(Math.abs(group.x - lanes.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(group.width - lanes.width)).toBeLessThanOrEqual(0.5)
  // On a well as the tracks' pictures are, over the same seconds.
  const well = (await masterLane(page).boundingBox())!
  const wave = (await page.locator("[data-lane]").first().locator(":scope > *").first().boundingBox())!
  expect(Math.abs(well.x - wave.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(well.width - wave.width)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(well.height - wave.height)).toBeLessThanOrEqual(0.5)
  expect(await masterLane(page).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    await colour(page, "--well")
  )
  const tag = (await clickTag(page).boundingBox())!
  expect(tag.x + tag.width).toBeLessThanOrEqual(well.x + well.width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(960)
})

test("the master plate keeps its height", async ({ page }) => {
  await openEvening(page)
  await openTake(page, "Take 1 Pałyn")
  const plate = (await page.locator("[data-master-plate]").boundingBox())!
  const track = (await page.locator("[data-plate]").first().boundingBox())!
  expect(plate.height).toBe(56)
  expect(track.height).toBe(56)
  // The 20 px lane toggle, as M and S, on the name's line.
  const button = (await masterClick(page).boundingBox())!
  expect([button.width, button.height]).toEqual([20, 20])
  const name = (await page.locator("[data-master-plate] [data-plate-name='Master']").boundingBox())!
  expect(Math.abs(button.y + button.height / 2 - (name.y + name.height / 2))).toBeLessThanOrEqual(1)
  expect(button.x).toBeGreaterThan(name.x)
})

test("stripes sit on the demo band's beats", async ({ page }) => {
  // The band's Pałyn 2, played to the click at 128 in 4/4: a bar of the
  // sticks to count in, then the song from the bar line after it.
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startButton(page).click()
  await openTake(page, "Take 2 Pałyn 2")
  // The closest zoom from the take's start: 0 to 2 s.
  const surface = page.getByRole("group", { name: "Take timeline" })
  await surface.evaluate((el) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -3000,
        ctrlKey: true,
        clientX: r.left,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      })
    )
  })
  await expect(page.getByText("closest zoom")).toBeVisible()
  // Where the drums' waveform rises, from the peaks the player draws.
  const N = 2000
  const onsets = await page.evaluate(async (n) => {
    const api = (window as unknown as {
      pywebview: { api: { take_media: (...a: unknown[]) => Promise<{ peaks: number[][] }[]> } }
    }).pywebview.api
    const [drums] = await api.take_media([{ name: "Drums", file: "/rec/tue/2/Drums.wav" }], n, 0, 2)
    const v = drums.peaks[0]
    const out: number[] = []
    for (let i = 0; i < v.length; i++) if (v[i] > 0.15 && (i === 0 || v[i - 1] <= 0.15)) out.push((i / n) * 2)
    return out
  }, N)
  const wave = (await page.locator("[data-lane='Drums'] > *").first().boundingBox())!
  const xOf = (t: number) => wave.x + (t / 2) * wave.width
  const stripes = await stripesAt(page)
  expect(onsets.length).toBeGreaterThanOrEqual(1)
  // The first beat's stripe on the first onset.
  expect(Math.abs(stripes[0] - xOf(onsets[0]))).toBeLessThanOrEqual(2)
  // And every stripe in view on a hit: the count-in's sticks, then the one.
  for (const x of stripes) expect(Math.min(...onsets.map((t) => Math.abs(xOf(t) - x)))).toBeLessThanOrEqual(2)
})
