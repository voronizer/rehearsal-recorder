import {
  callCount,
  calls,
  colour,
  expect,
  expectedError,
  hold,
  keyOn,
  lastTimeButton,
  letGo,
  literally,
  notices,
  openApp,
  openBandApp,
  scaled,
  settled,
  setFake,
  startButton,
  startRehearsal,
  style,
  test,
  themed,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// The setup screen: the band on the card's inputs, and what stops a
// rehearsal from starting on a card that cannot take it.

const MAC = "Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});"

/** The band's four, each on its own input of the fake's 18. */
const FOUR = [
  { name: "Drums", channel: 1, icon: "drums" },
  { name: "Bass", channel: 2, icon: "bass" },
  { name: "Guitar", channel: 3, icon: "guitar-electric" },
  { name: "Vocals", channel: 4, icon: "vocals" },
]

/**
 * The setup screen with the band's four on it, and what the check hears from
 * each, by the names Python knows them by: the names they had when it began.
 */
async function openFour(page: Page, levels: Record<string, number[]> = {}, before = "") {
  // Both handed over as data, never written into the page's code.
  await page.addInitScript(
    ([heard, four]) => {
      const w = window as unknown as { __MONITOR_LEVELS__: unknown; __FOUR__: unknown }
      w.__MONITOR_LEVELS__ = heard
      w.__FOUR__ = four
    },
    [levels, FOUR] as const
  )
  await openApp(page, {
    before,
    after:
      "window.pywebview.api.load_default_tracks = async () => ({tracks: structuredClone(window.__FOUR__)});",
  })
  await expect(rows(page)).toHaveCount(4)
}

/** The tracks group's rows, one per track, in the band's order. */
const rows = (page: Page) => page.locator("[data-track-row]")

/** Each row's name, top to bottom. */
const namesOf = (page: Page) =>
  rows(page)
    .locator("textarea")
    .evaluateAll((fields) => fields.map((f) => (f as HTMLTextAreaElement).value))

/** What the check says of a row's input: "signal" or "silent". */
const heard = (row: Locator, word: "signal" | "silent") =>
  row.locator("[data-check-slot='signal']").getByText(word, { exact: true })

/** How far along a row's level bar reaches, 0..1. */
const reach = (row: Locator) =>
  row.locator("[data-meter]").evaluate((m) => {
    const bar = m.firstElementChild
    return bar ? bar.getBoundingClientRect().width / m.getBoundingClientRect().width : 0
  })

/** How many lines a field's text takes. */
const linesIn = (field: Locator) =>
  field.evaluate((el) => {
    const s = getComputedStyle(el)
    const text = el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)
    return Math.round(text / parseFloat(s.lineHeight))
  })

/** The notice whose words are exactly `text`. */
const said = (page: Page, text: string) =>
  notices(page).filter({ has: page.locator("p", { hasText: new RegExp(`^${literally(text)}$`) }) })

/** Waits for the check to have read the levels `n` more times. */
async function polls(page: Page, n: number) {
  const done = await callCount(page, "monitor_levels")
  await expect.poll(() => callCount(page, "monitor_levels")).toBeGreaterThanOrEqual(done + n)
}

test("says the app's name with its logo, and fills the band in from the template", async ({
  page,
}) => {
  await openApp(page)
  // The one screen that says the app's name says it with the logo; the
  // working screens after it carry neither. The logo can still be loading
  // when the screen first shows.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const h = document.querySelector("header h1")
        const img = h?.querySelector<HTMLImageElement>('img[src$="favicon.svg"]')
        return !!img && img.complete && img.naturalWidth > 0 && h!.textContent!.trim() === "РЭХА"
      })
    )
    .toBe(true)
  // A title is cut at the end of its row, never wrapped, unless the screen
  // says it fits itself to its lines (Review's take).
  expect(await style(page.locator("header h1"), "white-space", "text-overflow")).toEqual({
    "white-space": "nowrap",
    "text-overflow": "ellipsis",
  })
  await expect(page.locator("textarea[aria-label='Track 1 name']")).toHaveValue("Guitar")
  // Free space is always on screen. The fake's disk lasts for weeks: past
  // two days the estimate is "many hours", which "about" does not go in
  // front of.
  await expect(page.getByText("Room for many hours of recording", { exact: true })).toHaveCount(1)
  // The figures beside the interface's name, all of them shown at this width.
  await expect(
    page.getByRole("button", { name: "Change the interface and quality" }).locator("[data-shown]")
  ).toHaveText("18 inputs · 44.1 kHz · 24 bit")
  await expect.poll(() => keyOn(startButton(page))).toBe("Space")
})

for (const theme of ["dark", "light"] as const) {
  test(`the start screen's low disk line is a warning in the text colour, in the ${theme} theme`, async ({
    page,
  }) => {
    await openApp(page, { before: `${themed(theme)} window.__LOW_SPACE__ = true;` })
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
      theme === "dark"
    )
    // Said where the free space always is, in the shared warning look: the
    // icon in warn, as the Alert draws it, and the words in the text's own
    // colour, which amber does not pass in the light theme.
    const words = page.getByText("Low disk space: room for about 5 min", { exact: true })
    await expect(words).toHaveCount(1)
    expect(await style(words, "color")).toEqual({ color: await colour(page, "--foreground") })
    expect(await style(words.locator("..").locator("svg"), "color")).toEqual({
      color: await colour(page, "--warn"),
    })
  })
}

test.describe("the signal check", () => {
  /** How far along the Guitar row's bar reaches, 0..1. */
  const guitarReach = (page: Page) =>
    page.evaluate(() => {
      const m = document.querySelector("[data-meter='Guitar']")
      const bar = m?.firstElementChild
      return m && bar ? bar.getBoundingClientRect().width / m.getBoundingClientRect().width : 0
    })

  test("listens over the bridge, and says which inputs have signal", async ({ page }) => {
    await openApp(page)
    await page.getByText("Check signal").click()
    await expect(page.getByText("Stop checking")).toBeVisible()
    expect(await callCount(page, "start_monitor")).toBe(1)
    // With no /api route here the meters can only be fed over the bridge,
    // which is the fallback doing its job.
    await expect.poll(() => callCount(page, "monitor_levels")).toBeGreaterThan(2)
    await expect(page.getByText("signal", { exact: true })).toHaveCount(1)
    await expect(page.getByText("silent", { exact: true })).toHaveCount(1)
    // In dB, like the recording screen and the desk: −4 dBFS is most of the
    // bar. On a straight scale it was three fifths of it.
    await expect.poll(() => guitarReach(page)).toBeGreaterThan(0.88)
    expect(await guitarReach(page)).toBeLessThan(0.97)
  })

  test("counts a quiet input as signal, and lets a bar fall back rather than drop", async ({
    page,
  }) => {
    await openApp(page)
    await page.getByText("Check signal").click()
    await expect.poll(() => guitarReach(page)).toBeGreaterThan(0.88)
    // With the gain set for the loudest hit, whole passages sit around −48.
    await setFake(page, "__MONITOR_LEVELS__", { Guitar: [0.62], Vocals: [0.004] })
    await expect(page.getByText("silent", { exact: true })).toHaveCount(0)
    // A meter rises at once and falls back at a steady rate, as on the desk:
    // dropping to each poll's level made a voice blink.
    await setFake(page, "__MONITOR_LEVELS__", { Guitar: [0.0004], Vocals: [0.004] })
    const polls = await callCount(page, "monitor_levels")
    await expect.poll(() => callCount(page, "monitor_levels")).toBeGreaterThanOrEqual(polls + 2)
    expect(await guitarReach(page)).toBeGreaterThan(0.3)
    await expect.poll(() => guitarReach(page), { timeout: 8000 }).toBeLessThan(0.05)
  })

  test("a second press while the check opens opens nothing more", async ({ page }) => {
    await openApp(page)
    // Python is slow to open the inputs, and the button is pressed again.
    await hold(page, "start_monitor")
    const check = page.getByRole("button", { name: "Check signal" })
    await check.click()
    await expect.poll(() => callCount(page, "start_monitor")).toBe(1)
    await check.click()
    await page.waitForTimeout(300)
    expect(await callCount(page, "start_monitor")).toBe(1)

    // One chain of reads: each waits for the one before it to be answered,
    // so with the answers held there is one read out, not one per press.
    await hold(page, "monitor_levels")
    await letGo(page, "start_monitor")
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    await expect.poll(() => callCount(page, "monitor_levels")).toBe(1)
    await page.waitForTimeout(500)
    expect(await callCount(page, "monitor_levels")).toBe(1)
    await letGo(page, "monitor_levels")
    await expect(page.getByText("signal", { exact: true })).toHaveCount(1)
  })

  test("a check that could not reach Python can be asked for again", async ({ page, pageErrors }) => {
    await openApp(page)
    const check = page.getByRole("button", { name: "Check signal" })
    // The screen up first: pulled while the app still opens, the bridge takes
    // the start screen with it.
    await expect(check).toBeVisible()
    // The bridge gone for a moment, as before Python is ready: the press
    // throws before anything is asked.
    await page.evaluate(() => {
      const w = window as unknown as { pywebview: { api?: unknown }; __API__?: unknown }
      w.__API__ = w.pywebview.api
      w.pywebview.api = undefined
    })
    await check.click()
    await expect.poll(() => pageErrors.some((e) => /not ready yet/.test(e))).toBe(true)
    expectedError(pageErrors, /not ready yet/)
    await page.evaluate(() => {
      const w = window as unknown as { pywebview: { api?: unknown }; __API__?: unknown }
      w.pywebview.api = w.__API__
    })

    await check.click()
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    expect(await callCount(page, "start_monitor")).toBe(1)
  })

  // B5: a press that takes a second shows a spinner in its icon's place, and
  // nothing round it moves.
  test("Check signal shows a spinner only after one second", async ({ page }) => {
    await openApp(page)
    const check = page.getByRole("button", { name: "Check signal" })
    const save = page.getByRole("button", { name: "Save as template" })
    await expect(check).toBeVisible()
    await settled(page)
    const boxes = async () => [await check.boundingBox(), await save.boundingBox()]
    const before = await boxes()
    await hold(page, "start_monitor")
    const spinner = check.getByRole("status", { name: "Loading" })
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await check.click()
    await at(500)
    expect(await spinner.isVisible(), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await spinner.isVisible(), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    // Its words and its box as they were.
    await expect(check.locator("span:not(.invisible) > span:not(.invisible)")).toHaveText("Check signal")
    expect(await boxes()).toEqual(before)

    await letGo(page, "start_monitor")
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0)
  })

  test("Start rehearsal shows a spinner only after one second", async ({ page }) => {
    await openApp(page)
    const start = startButton(page)
    await expect(start).toBeEnabled()
    await settled(page)
    const boxes = async () => [
      await start.boundingBox(),
      await page.locator("[data-set-picker]").boundingBox(),
    ]
    const before = await boxes()
    await hold(page, "start_rehearsal")
    const spinner = start.getByRole("status", { name: "Loading" })
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await start.click()
    await at(500)
    expect(await spinner.isVisible(), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await spinner.isVisible(), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    await expect(start).toContainText("Start rehearsal")
    expect(await boxes()).toEqual(before)

    await letGo(page, "start_rehearsal")
    await expect(page.getByRole("button", { name: /Record take 1/ })).toBeVisible()
  })

  test("Space after clicking Check signal starts the rehearsal, not the check again", async ({
    page,
  }) => {
    await openApp(page)
    await page.getByText("Check signal").click()
    await page.getByText("Stop checking").click()
    // Clicked last, the check's button keeps focus, as a clicked button does
    // in Chromium — the browser the app runs in on Windows. Space used to
    // press it again.
    expect(await page.evaluate(() => document.activeElement?.textContent ?? "")).toContain(
      "Check signal"
    )
    const monitors = await callCount(page, "start_monitor")
    await page.keyboard.press("Space")
    await expect(page.getByRole("button", { name: /Record take 1/ })).toBeVisible()
    expect(await callCount(page, "start_monitor")).toBe(monitors)
    // With exactly what the screen said it would record with.
    const started = await calls(page, "start_rehearsal")
    expect(started).toHaveLength(1)
    expect(started[0].args[2]).toBe(44100)
    expect(started[0].args[4]).toBe(24)
  })
})

test("Escape leaves a rehearsal with nothing in it yet, without asking", async ({ page }) => {
  // Nothing recorded, so nothing to protect: one level up from an empty
  // rehearsal is what Finish does. Python takes the empty folder with it.
  await openApp(page)
  await startButton(page).click()
  await expect(page.getByRole("button", { name: /Record take 1/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(startButton(page)).toBeVisible()
  await expect(page.locator("#rehearsal-name")).toBeVisible()
  expect(await callCount(page, "finish_rehearsal")).toBe(1)
})

test("Finish goes straight to the start screen; Escape asks first", async ({ page }) => {
  // Bands close the app rather than press Finish, so nothing waits after it:
  // the start screen's Last time already has the evening.
  await openApp(page, { before: "window.__TONIGHT__ = [{name: 'Pałyn', duration_sec: 200}];" })
  await startRehearsal(page, 2)
  await page.getByRole("button", { name: /^Finish/ }).click()
  await expect(startButton(page)).toBeVisible()
  await expect(page.locator("#rehearsal-name")).toBeVisible()
  expect(await callCount(page, "finish_rehearsal")).toBe(1)
  await expect(page.getByText("Rehearsal finished")).toHaveCount(0)

  await startButton(page).click()
  await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
  await page.keyboard.press("Escape")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading")).toHaveText("Finish this rehearsal?")
  await dialog.getByRole("button", { name: "Finish" }).click()
  await expect(startButton(page)).toBeVisible()
  expect(await callCount(page, "finish_rehearsal")).toBe(2)
})

test("does not guess a driver when several are offered and none is resolved", async ({ page }) => {
  // A Windows-shaped list with nothing chosen: a legacy choice dropped on
  // upgrade, or a card unplugged. Guessing the first would usually land on an
  // MME entry nobody chose.
  await openApp(page, {
    before: "window.__HOST_API__ = 'Windows WASAPI'; window.__NO_DEVICE__ = true;",
  })
  await expect(page.getByText("No interface chosen")).toHaveCount(1)
  await expect(startButton(page)).toBeDisabled()
})

test("names a track left on another card's inputs, and what would fix it", async ({ page }) => {
  // The template keeps its input numbers, and changing the interface in
  // Settings does not touch them. On a narrower card the selector went blank
  // and nothing said anything until the signal check came back with
  // paInvalidChannelCount.
  await openApp(page, { before: "window.__TRACKS_FROM_A_BIGGER_CARD__ = true;" })
  const stray = page.getByRole("status").filter({ hasText: "no input" })
  await expect(stray).toHaveCount(1)
  await expect(stray).toContainText("Vocals")
  await expect(stray).toContainText("Little USB box")
  await expect(stray).toContainText("2")
  await expect(stray).not.toContainText("Guitar")
  await expect(stray).toContainText("Pick one")
  await expect(page.locator("[aria-label='Track 2 input']")).toHaveText("No input")
  await expect(startButton(page)).toBeDisabled()

  // More tracks than the card has inputs is the other way of not fitting,
  // and the one where choosing again cannot help.
  for (let i = 0; i < 3; i++) await page.getByText("Add track").click()
  const crowded = page.getByRole("status").filter({ hasText: "not enough" })
  await expect(crowded).toHaveCount(1)
  await expect(crowded).not.toContainText("Pick one")
})

test("a track in stereo takes the input after its own, and waits when that is taken", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 900 })
  await openApp(page)
  const input = page.locator("[aria-label='Track 1 input']")
  await expect(input).toHaveText("Input 1")

  await page.getByRole("button", { name: "Track 1 in stereo" }).click()
  await expect(input).toHaveText("No input")
  const note = page.getByRole("status").filter({ hasText: "no input" })
  await expect(note).toHaveCount(1)
  await expect(note).toContainText("Guitar")
  await expect(startButton(page)).toBeDisabled()

  // Input 3 is free: the pair 3–4 fits, and the control says so.
  await input.click()
  await page.getByRole("option", { name: "Inputs 3–4" }).click()
  await expect(input).toHaveText("Inputs 3–4")
  await expect(startButton(page)).toBeEnabled()
  // The free space is worked out for three channels, not two tracks.
  await expect
    .poll(async () => (await calls(page, "disk_estimate")).at(-1)?.args[0])
    .toBe(3)
})

test.describe("an interface switched on after the app", () => {
  // PortAudio lists the devices once, when the app starts. A desk switched
  // on afterwards is not there until somebody looks again, and until then
  // the screen says so rather than "No interface chosen", or on a Mac
  // quietly taking the laptop's own microphone.
  test.use({ viewport: { width: 1180, height: 900 } })

  test("is said to be not connected on the setup screen, until it is found", async ({ page }) => {
    await openApp(page, { before: "window.__PLUGGED_IN_LATE__ = true;" })
    const box = page.getByRole("button", { name: "Change the interface and quality" })
    await expect(box).toContainText("“X18/XR18” is not connected")
    await expect(box).not.toContainText("MacBook")
    await expect(startButton(page)).toBeDisabled()

    // Edited while the desk boots, which is when people do it.
    await page.fill("textarea[aria-label='Track 2 name']", "Bass")
    await page.getByRole("button", { name: "Look again" }).click()
    await expect(page.getByText("Still not there")).toBeVisible()
    expect(await callCount(page, "rescan_devices")).toBe(1)
    await expect(box).toContainText("not connected")

    await page.getByRole("button", { name: "Look again" }).click()
    // The figures as they show beside its name, not only as they are read.
    const shown = box.locator("[data-shown]")
    await expect(shown).toBeVisible()
    await expect(shown).toContainText("18 inputs")
    await expect(box).toHaveText(/^X18\/XR18/)
    await expect(page.getByRole("button", { name: "Look again" })).toHaveCount(0)
    await expect(page.getByText("Still not there")).toHaveCount(0)
    // A name edited meanwhile is kept, because the band on screen is what
    // gets placed on the desk's inputs.
    await expect(page.locator("textarea[aria-label='Track 2 name']")).toHaveValue("Bass")
    const placed = (await calls(page, "load_default_tracks")).at(-1)?.args[0] as { name: string }[]
    expect(placed.map((t) => t.name)).toEqual(["Guitar", "Bass"])
    await expect(page.locator("[aria-label='Track 2 input']")).toHaveText("Input 2")
    await expect(startButton(page)).toBeEnabled()
  })

  test("is said to be not connected in Settings, until it is found", async ({ page }) => {
    await openApp(page, { before: "window.__PLUGGED_IN_LATE__ = true;" })
    await page.getByRole("button", { name: "Settings" }).click()
    const device = page.locator("#input-device")
    await expect(device).toContainText("“X18/XR18” is not connected")
    const asked = await callCount(page, "recording_formats")
    const listed = await callCount(page, "list_input_devices")
    await page.getByRole("button", { name: "Look again" }).click()
    await expect.poll(() => callCount(page, "rescan_devices")).toBe(1)
    await page.getByRole("button", { name: "Look again" }).click()
    await expect(page.getByText("Found “X18/XR18”")).toBeVisible()
    expect(await callCount(page, "list_input_devices")).toBeGreaterThanOrEqual(listed + 2)
    await expect(device).toHaveText(/^X18\/XR18/)
    expect(await callCount(page, "recording_formats")).toBeGreaterThan(asked)

    await page.getByRole("button", { name: "Look again" }).click()
    await expect(page.getByText("No new interfaces")).toBeVisible()
    await expect(page.getByText("Found “X18/XR18”")).toHaveCount(0)
  })
})

test.describe("a track's icon", () => {
  test.use({ viewport: { width: 1180, height: 900 } })

  test("is chosen from a grid at the start of its row, and goes with the band", async ({
    page,
  }) => {
    await openApp(page)
    const first = page.getByRole("button", { name: "Track 1 icon" })
    // None chosen yet: the neutral one, not a guess from the name.
    await expect(first).toHaveAttribute("data-icon", "other")
    await first.click()
    const grid = page.getByRole("dialog", { name: "Icon for Guitar" })
    await expect(grid.getByRole("button")).toHaveCount(14)
    await expect(grid.getByRole("button", { name: "Other" })).toHaveAttribute("aria-pressed", "true")
    await grid.getByRole("button", { name: "Electric guitar" }).click()
    await expect(grid).toHaveCount(0)
    await expect(first).toHaveAttribute("data-icon", "guitar-electric")
    await expect(first).toBeFocused()

    // From the keys: the grid opens on the one chosen, the arrows move
    // through it, Enter takes one and Escape takes none.
    const second = page.getByRole("button", { name: "Track 2 icon" })
    await second.focus()
    await page.keyboard.press("Enter")
    const vocals = page.getByRole("dialog", { name: "Icon for Vocals" })
    await expect(vocals.getByRole("button", { name: "Other" })).toBeFocused()
    await page.keyboard.press("Home")
    await expect(vocals.getByRole("button", { name: "Vocals" })).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(vocals.getByRole("button", { name: "Drums" })).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(vocals.getByRole("button", { name: "Percussion" })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(vocals).toHaveCount(0)
    await expect(second).toHaveAttribute("data-icon", "other")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Home")
    await page.keyboard.press("Enter")
    await expect(second).toHaveAttribute("data-icon", "vocals")

    // Kept with the band, as stereo is: in the template and when it starts.
    await page.getByRole("button", { name: "Save as template" }).click()
    const saved = (await calls(page, "save_default_tracks")).at(-1)?.args[0] as {
      tracks: { name: string; icon?: string }[]
    }
    expect(saved.tracks.map((t) => [t.name, t.icon])).toEqual([
      ["Guitar", "guitar-electric"],
      ["Vocals", "vocals"],
    ])
    await startButton(page).click()
    const started = (await calls(page, "start_rehearsal"))[0].args[3] as { icon?: string }[]
    expect(started.map((t) => t.icon)).toEqual(["guitar-electric", "vocals"])
  })

  test("comes back from the saved band", async ({ page }) => {
    await openApp(page, { before: "window.__BAND_ICONS__ = {Guitar: 'bass'};" })
    await expect(page.getByRole("button", { name: "Track 1 icon" })).toHaveAttribute(
      "data-icon",
      "bass"
    )
  })

  test("one it does not know is drawn as the neutral one", async ({ page }) => {
    await openApp(page, { before: "window.__BAND_ICONS__ = {Guitar: 'theremin'};" })
    await expect(page.getByRole("button", { name: "Track 1 icon" })).toHaveAttribute(
      "data-icon",
      "other"
    )
  })

  test("the chosen one in the grid is grey, and the icon's name is its tip", async ({ page }) => {
    await openApp(page, { before: "window.__BAND_ICONS__ = {Guitar: 'bass'};" })
    const icon = page.getByRole("button", { name: "Track 1 icon" })
    // Its name in the shared tip, not the browser's own.
    await expect(icon).not.toHaveAttribute("title")
    await icon.hover()
    await expect(tooltip(page)).toHaveText("Bass")
    await icon.click()
    const grid = page.getByRole("dialog", { name: "Icon for Guitar" })
    const chosen = grid.getByRole("button", { name: "Bass" })
    await expect(chosen).toHaveAttribute("aria-pressed", "true")
    // On is the grey fill, with no ring in the accent round it (F2): looked
    // at with the focus and the pointer elsewhere.
    await expect(chosen).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(chosen).not.toBeFocused()
    await page.mouse.move(0, 0)
    await expect.poll(() => chosen.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await colourOf(page, "selected")
    )
    await expect(chosen).toHaveCSS("box-shadow", "none")
    // Each one the shared button, its name at 12 px.
    await expect(grid.locator("button:not([data-slot='button'])")).toHaveCount(0)
    await expect(chosen).toHaveCSS("font-size", "12px")
  })

  test("one picked with the mouse leaves no tip behind, one picked with the keys says its name", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__BAND_ICONS__ = {Guitar: 'bass'};" })
    const icon = page.getByRole("button", { name: "Track 1 icon" })
    await icon.click()
    const grid = page.getByRole("dialog", { name: "Icon for Guitar" })
    await grid.getByRole("button", { name: "Drums" }).click()
    await expect(grid).toHaveCount(0)
    await expect(icon).toHaveAttribute("data-icon", "drums")
    // The grid sends focus back to the button as it shuts, and the mouse
    // put it there: no tip comes with it.
    await expect(icon).toBeFocused()
    await page.mouse.move(0, 0, { steps: 8 })
    await page.waitForTimeout(800)
    await expect(tooltip(page)).toHaveCount(0)

    // From the keys, the tip says the one picked as focus comes back...
    await page.keyboard.press("Enter")
    await expect(grid).toBeVisible()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("Enter")
    await expect(grid).toHaveCount(0)
    await expect(icon).toHaveAttribute("data-icon", "percussion")
    await expect(icon).toBeFocused()
    await expect(tooltip(page)).toHaveText("Percussion")
    // ...and after Esc, which picks none.
    await page.keyboard.press("Enter")
    await expect(grid).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(grid).toHaveCount(0)
    await expect(icon).toBeFocused()
    await expect(tooltip(page)).toHaveText("Percussion")
  })
})

// The header's icon buttons say what they are in the shared tip, never the
// browser's own (C8); a tip that only repeats a button's name is for the
// eyes, and is not read out a second time as its description.
test.describe("the header's tips", () => {
  test.use({ viewport: { width: 1180, height: 900 } })
  const away = (page: Page) => page.mouse.move(0, 0, { steps: 8 })

  test("the gear's tip says Settings once", async ({ page }) => {
    await openApp(page)
    const gear = page.getByRole("button", { name: "Settings", exact: true })
    await gear.hover()
    await expect(tooltip(page)).toHaveText("Settings")
    await expect(gear).toHaveAccessibleDescription("")
    await away(page)
    await expect(tooltip(page)).toHaveCount(0)
  })

  test("the gear's tip says a new version is out, to a screen reader too", async ({ page }) => {
    await openApp(page, { before: "window.__LATEST__ = {version: '0.3.0'};" })
    const gear = page.getByRole("button", { name: "Settings, a new version is out" })
    await gear.hover()
    await expect(tooltip(page)).toHaveText("0.3.0 is out")
    await expect(gear).toHaveAccessibleDescription("0.3.0 is out")
  })

  test("the playback volume says its level in the shared tip", async ({ page }) => {
    await openApp(page)
    const speaker = page.getByRole("button", { name: "Playback volume" })
    await expect(speaker).toBeVisible()
    await expect(speaker).not.toHaveAttribute("title")
    await speaker.hover()
    await expect(tooltip(page)).toHaveText(/^Playback volume \d+%$/)
    await expect(speaker).toHaveAccessibleDescription(/^Playback volume \d+%$/)
    await away(page)
    await expect(tooltip(page)).toHaveCount(0)
  })
})

/** A colour, as the browser draws it for a background: a theme colour by its
 *  name ("selected"), or any CSS colour. */
const colourOf = (page: Page, colour: string) =>
  page.evaluate((c) => {
    const probe = document.createElement("i")
    probe.style.backgroundColor = /^[a-z-]+$/.test(c) ? `var(--${c})` : c
    document.body.append(probe)
    const out = getComputedStyle(probe).backgroundColor
    probe.remove()
    return out
  }, colour)

/** The shared tooltip's words, as a screen reader is given them. */
const tooltip = (page: Page) => page.getByRole("tooltip")

// A track's row on the shared pieces (C8): Stereo a Toggle, Audio · Both ·
// MIDI a ToggleGroup, the name a field with the shared ring, Look again's
// Spinner, and Empty for a band with nobody in it (B7).
test.describe("the track rows on the shared pieces", () => {
  test("an empty band says how to add tracks", async ({ page }) => {
    await openApp(page)
    // Emptied while the check runs: Stop checking still stops it.
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    for (const name of ["Guitar", "Vocals"])
      await page.getByRole("button", { name: `Remove track ${name}` }).click()
    await expect(rows(page)).toHaveCount(0)

    const empty = page.locator("section[data-tracks] [data-slot='empty']")
    await expect(empty.getByText("No tracks yet", { exact: true })).toBeVisible()
    await expect(
      empty.getByText("Add one per musician, then pick the input they plug into.", { exact: true })
    ).toBeVisible()
    await expect(startButton(page)).toBeDisabled()

    const stop = page.getByRole("button", { name: "Stop checking" })
    await expect(stop).toBeEnabled()
    const stops = await callCount(page, "stop_monitor")
    await stop.click()
    await expect(page.getByRole("button", { name: "Check signal" })).toBeDisabled()
    expect(await callCount(page, "stop_monitor")).toBe(stops + 1)

    await page.getByRole("button", { name: "Add track" }).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(empty).toHaveCount(0)
    await expect(page.getByRole("textbox", { name: "Track 1 name" })).toHaveValue("")
    await expect(page.locator("[aria-label='Track 1 input']")).toHaveText("Input 1")
    await expect(page.getByRole("button", { name: "Check signal" })).toBeEnabled()
  })

  test("Stereo is a toggle with aria-pressed", async ({ page }) => {
    await openApp(page)
    const stereo = page.getByRole("button", { name: "Track 1 in stereo" })
    await expect(stereo).toHaveAttribute("data-slot", "toggle")
    await expect(stereo).toHaveAttribute("aria-pressed", "false")
    // What it does, in the shared tip rather than the browser's own.
    await expect(stereo).not.toHaveAttribute("title")
    await stereo.hover()
    await expect(tooltip(page)).toHaveText("Two adjacent inputs, written as one stereo file")

    await stereo.click()
    await expect(stereo).toHaveAttribute("aria-pressed", "true")
    await expect(stereo).toHaveAttribute("data-state", "on")
    // On is grey, never the accent (F2), under the pointer as well.
    const background = () => stereo.evaluate((el) => getComputedStyle(el).backgroundColor)
    await expect.poll(background).toBe(await colourOf(page, "selected"))
    expect(await background()).not.toBe(await colourOf(page, "primary"))
    await page.mouse.move(0, 0)
    await expect.poll(background).toBe(await colourOf(page, "selected"))

    await stereo.click()
    await expect(stereo).toHaveAttribute("aria-pressed", "false")
  })

  test("Check signal is a button that says what it does, grey while the check runs", async ({
    page,
  }) => {
    await openApp(page)
    // Not a toggle: its words change with what pressing it does, which a
    // toggle's name must not, so it says nothing of being pressed.
    const check = page.getByRole("button", { name: "Check signal" })
    await expect(check).toHaveAttribute("data-slot", "button")
    await expect(check).not.toHaveAttribute("aria-pressed")
    expect(await check.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("Check signal")

    await check.click()
    const stop = page.getByRole("button", { name: "Stop checking" })
    await expect(stop).toBeVisible()
    await expect(stop).not.toHaveAttribute("aria-pressed")
    expect(await stop.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("Stop checking")
    await expect(page.getByRole("button", { name: "Check signal" })).toHaveCount(0)

    // Grey while it runs, as what is on is (F2), and under the pointer too:
    // read once its colour has stopped changing.
    const background = async () => {
      await page.waitForTimeout(50)
      await expect.poll(() => stop.evaluate((el) => el.getAnimations().length)).toBe(0)
      return stop.evaluate((el) => getComputedStyle(el).backgroundColor)
    }
    const grey = await colourOf(page, "selected")
    await page.mouse.move(0, 0)
    expect(await background()).toBe(grey)
    await stop.hover()
    expect(await background()).toBe(grey)

    await stop.click()
    await expect(page.getByRole("button", { name: "Check signal" })).not.toHaveAttribute("aria-pressed")
  })

  test("arrow keys move along Audio Both MIDI", async ({ page }) => {
    await openApp(page)
    const group = page.getByRole("radiogroup", { name: "Track 1 records" })
    const mode = (name: string) => group.getByRole("radio", { name, exact: true })
    await expect(mode("Audio")).toHaveAttribute("aria-checked", "true")

    // Tab comes into the group on the one chosen; the arrows move along it.
    await page.getByRole("textbox", { name: "Track 1 name" }).focus()
    await page.keyboard.press("Tab")
    await expect(mode("Audio")).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(mode("Both")).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(mode("MIDI")).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(mode("Both")).toBeFocused()
    // Moving chooses nothing; Space does.
    await expect(mode("Audio")).toHaveAttribute("aria-checked", "true")
    await page.keyboard.press("Space")
    await expect(mode("Both")).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("combobox", { name: "Track 1 MIDI port" })).toBeVisible()
    expect(await callCount(page, "start_rehearsal")).toBe(0)
    // Tab leaves the group at once.
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "Remove track Guitar" })).toBeFocused()

    // One is always chosen: pressing the chosen one again leaves it so.
    await mode("Both").click()
    await expect(mode("Both")).toHaveAttribute("aria-checked", "true")
    await expect(group.locator("[aria-checked='true']")).toHaveCount(1)
    await expect(page.getByRole("combobox", { name: "Track 1 MIDI port" })).toBeVisible()
  })

  test("Look again shows a spinner only after one second", async ({ page }) => {
    await openApp(page, { before: "window.__PLUGGED_IN_LATE__ = true;" })
    const look = page.getByRole("button", { name: "Look again" })
    await expect(look).toBeVisible()
    await settled(page)
    const box = await look.boundingBox()
    // The fake is slow to look: it holds the answer until it is let go.
    await hold(page, "rescan_devices")
    const looking = page.getByRole("button", { name: "Looking…" })
    const spinner = looking.getByRole("status", { name: "Loading" })
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await look.click()
    await expect(looking).toBeDisabled()
    await at(500)
    expect(await spinner.isVisible(), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await spinner.isVisible(), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    // The button keeps its box, its words and its spinner changing in it.
    expect(await looking.boundingBox()).toEqual(box)

    await letGo(page, "rescan_devices")
    await expect(page.getByText("Still not there")).toBeVisible()
    await expect(look).toBeEnabled()
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0)
  })

  test("the device name keeps its width and the figures give way", async ({ page }) => {
    // Beside Last time at 1180 px, the stress data's interface leaves its
    // figures too little room for all of them.
    await openBandApp(page, { stress: true })
    // Fix font metrics so this deliberate no-room case is portable across OSes.
    await page.addStyleTag({ content: "* { font-family: Arial, sans-serif !important; }" })
    const row = page.locator("[data-recording-with]")
    const name = row.getByText("Universal Audio Apollo Twin X DUO Heritage Edition", { exact: true })
    await expect(name).toBeVisible()
    await expect(name).not.toHaveAttribute("data-cut")
    const whole = (el: Element) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight
    expect(await name.evaluate(whole)).toBe(true)
    const figures = row.locator("[data-figures]")
    await expect(figures).toHaveAttribute("data-dropped")
    // The least needed first: the depth, then the rate; the inputs last.
    const shown = (await figures.locator("[data-shown]").innerText()).trim()
    expect(["18 inputs · 48 kHz", "18 inputs", ""]).toContain(shown)
    await expect(figures.locator(".sr-only")).toHaveText("18 inputs · 48 kHz · 24 bit")
  })

  test("a track's name is bare at rest, filled under the pointer, ringed while typing", async ({
    page,
  }) => {
    await openApp(page)
    const field = page.getByRole("textbox", { name: "Track 1 name" })
    const place = field.locator("xpath=..")
    const look = () =>
      place.evaluate((el) => {
        const s = getComputedStyle(el)
        return { fill: s.backgroundColor, ring: s.boxShadow }
      })
    await page.mouse.move(0, 0)
    await expect.poll(look).toEqual({ fill: "rgba(0, 0, 0, 0)", ring: "none" })
    await field.hover()
    await expect.poll(async () => (await look()).fill).not.toBe("rgba(0, 0, 0, 0)")
    await field.focus()
    await page.mouse.move(0, 0)
    // The shared focus ring, as every field has.
    await expect.poll(async () => (await look()).ring).not.toBe("none")
    await expect.poll(async () => (await look()).fill).toBe("rgba(0, 0, 0, 0)")
  })

  test("signal and notes are said with the one tick, notes in the text's colour", async ({ page }) => {
    await openApp(page, { before: "window.__MONITOR_LEVELS__ = {Drums: [0.62], Vocals: [0.0004]};" })
    await page.getByRole("textbox", { name: "Track 1 name" }).fill("Drums")
    await page
      .getByRole("radiogroup", { name: "Track 1 records" })
      .getByRole("radio", { name: "Both", exact: true })
      .click()
    await page.getByRole("combobox", { name: "Track 1 MIDI port" }).click()
    await page.getByRole("option", { name: "TD-17" }).click()
    await page.getByRole("button", { name: "Check signal" }).click()

    const drums = rows(page).first()
    const signal = drums.locator("[data-check-slot='signal']").getByText("signal", { exact: true })
    const notes = drums.locator("[data-check-slot='notes']").getByText("notes", { exact: true })
    await expect(signal).toBeVisible()
    await expect(notes).toBeVisible({ timeout: 3000 })
    // The same drawn tick before each word, not a character.
    for (const word of [signal, notes]) {
      await expect(word.locator("svg.lucide-check")).toHaveCount(1)
      await expect(word).not.toContainText("✓")
    }
    // Notes are grey, in the text's colour, not the accent; their bar too.
    const text = await drums.evaluate((el) => getComputedStyle(el).color)
    await expect(notes).toHaveCSS("color", text)
    const bar = drums.locator("[data-check-slot='notes'] [data-slot='meter'] > div")
    await expect(bar).toHaveCSS(
      "background-color",
      await colourOf(page, "color-mix(in oklab, var(--foreground) 60%, transparent)")
    )
    await expect(bar).toHaveCSS("opacity", "1")
    // One meter for both: the level's and the notes'.
    await expect(drums.locator("[data-slot='meter']")).toHaveCount(2)
  })
})

// The start screen in three groups (Alex, Q1): the past on the left, the
// tracks as one group headed by the interface they record with, and
// tonight's name in the footer beside the set and Start.
test.describe("the start screen's groups", () => {
  test("the start screen is three groups: past, tracks, tonight", async ({ page }) => {
    // How the groups rise is checked below.
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await openApp(page)
    await expect(page.locator("footer #rehearsal-name")).toHaveCount(1)
    const group = page.locator("[data-part='setup'] section[data-tracks]")
    const recordingWith = group.locator("[data-recording-with]")
    await expect(recordingWith).toContainText("Recording with")
    await expect(group.locator("[data-track-row]")).toHaveCount(2)
    await expect(page.locator("[data-part='past']")).toBeVisible()
    await settled(page)

    // "Recording with" is the group's first row, under its head.
    const head = (await group.getByRole("heading", { name: "Tracks" }).boundingBox())!
    const rw = (await recordingWith.boundingBox())!
    const first = (await rows(page).first().boundingBox())!
    expect(head.y + head.height).toBeLessThanOrEqual(rw.y)
    expect(rw.y + rw.height).toBeLessThanOrEqual(first.y + 0.5)

    // The past on the left of the tracks at 1180 px.
    const past = (await page.locator("[data-part='past']").boundingBox())!
    const setup = (await page.locator("[data-part='setup']").boundingBox())!
    expect(past.x + past.width).toBeLessThanOrEqual(setup.x + 0.5)

    // Tonight: the name, a rule, then the set and Start.
    await expect(page.locator("footer [data-footer-rule]")).toHaveCount(1)
    const name = (await page.locator("#rehearsal-name").boundingBox())!
    const set = (await page.locator("footer [data-set-picker]").boundingBox())!
    expect(name.x + name.width).toBeLessThan(set.x)

    // The groups come in one after another, 40 ms apart.
    const rising = await page.evaluate(() =>
      [
        document.querySelector("[data-part='past'] > *"),
        document.querySelector("section[data-tracks]"),
        document.querySelector("footer > *"),
      ].map((el) => {
        const style = el ? getComputedStyle(el) : null
        return style && [style.animationName, style.animationDelay]
      })
    )
    expect(rising).toEqual([
      ["rise", "0s"],
      ["rise", "0.04s"],
      ["rise", "0.08s"],
    ])
  })

  test("no empty band under Recording with", async ({ page }) => {
    // A track that takes notes used to keep a place above the rows for the
    // notes' own notes, empty while none was said.
    await openApp(page)
    await page
      .getByRole("radiogroup", { name: "Track 1 records" })
      .getByRole("radio", { name: "Both", exact: true })
      .click()
    await expect(page.getByRole("combobox", { name: "Track 1 MIDI port" })).toBeVisible()
    await settled(page)
    const rw = (await page.locator("[data-recording-with]").boundingBox())!
    const first = (await rows(page).first().boundingBox())!
    // The first row's own line is the edge between them.
    expect(Math.abs(first.y - (rw.y + rw.height))).toBeLessThanOrEqual(1)
  })

  test("Check signal does not move when the template is saved", async ({ page }) => {
    await openApp(page)
    const check = page.getByRole("button", { name: "Check signal" })
    const save = page.getByRole("button", { name: /^(Save as template|Template saved)$/ })
    await expect(save).toHaveAccessibleName("Save as template")
    await settled(page)
    const boxes = async () => [await check.boundingBox(), await save.boundingBox()]
    const before = await boxes()

    await save.click()
    await expect(save).toHaveAccessibleName("Template saved")
    expect(await boxes()).toEqual(before)
    // It says Save as template again after a while, in the same box.
    await expect(save).toHaveAccessibleName("Save as template", { timeout: 4000 })
    expect(await boxes()).toEqual(before)
  })

  test("Start keeps its width while Last time plays", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const panel = page.getByRole("complementary", { name: "Last time" })
    const play = panel.getByRole("button", { name: "Play Pałyn 2, the last take of Pałyn" })
    await expect(play).toBeVisible()
    await settled(page)
    const boxes = async () => [
      await startButton(page).boundingBox(),
      await page.locator("[data-set-picker]").boundingBox(),
    ]
    const before = await boxes()

    await play.click()
    await expect(panel.getByRole("button", { name: "Pause Pałyn 2, the last take of Pałyn" })).toBeVisible()
    expect(await boxes()).toEqual(before)
    // Its Space chip keeps its room, unseen: Space is the take's now.
    const chip = startButton(page).locator("kbd")
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveCSS("visibility", "hidden")
    expect(await keyOn(startButton(page))).toBeNull()
  })
})

// A track taken off goes at once, with Undo (B1); and the check keeps each
// reading with its own track, by its place, whatever the track is called
// now (rollout step 4).
test.describe("the tracks during the check", () => {
  test("renaming a track during the check keeps its meter and signal", async ({ page }) => {
    await openFour(page, { Drums: [0.62], Bass: [0.0004], Guitar: [0.0004], Vocals: [0.0004] })
    await page.getByRole("button", { name: "Check signal" }).click()
    const drums = rows(page).first()
    await expect.poll(() => reach(drums)).toBeGreaterThan(0.8)
    await expect(heard(drums, "signal")).toBeVisible()

    await page.getByRole("textbox", { name: "Track 1 name" }).fill("Kit")
    await polls(page, 3)
    expect(await reach(drums)).toBeGreaterThan(0.8)
    await expect(heard(drums, "signal")).toBeVisible()
    await expect(heard(rows(page).nth(1), "silent")).toBeVisible()
  })

  test("taking a track off says so and Undo puts it back in its place", async ({ page }) => {
    await openFour(page)
    await page.getByRole("button", { name: "Remove track Bass" }).click()
    await expect(rows(page)).toHaveCount(3)
    expect(await namesOf(page)).toEqual(["Drums", "Guitar", "Vocals"])
    const notice = said(page, "Bass was taken off.")
    await expect(notice).toHaveCount(1)

    await notice.getByRole("button", { name: "Undo" }).click()
    await expect(rows(page)).toHaveCount(4)
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await expect(page.locator("[aria-label='Track 2 input']")).toHaveText("Input 2")
    await expect(page.getByRole("button", { name: "Track 2 icon" })).toHaveAttribute("data-icon", "bass")
    await expect(notices(page)).toHaveCount(0)
  })

  test("Cmd+Z puts back the track taken off", async ({ page }) => {
    await openFour(page, {}, MAC)
    await page.getByRole("button", { name: "Remove track Bass" }).click()
    await expect(rows(page)).toHaveCount(3)
    await expect(said(page, "Bass was taken off.").locator("kbd")).toHaveText("⌘Z")
    // Not in a field, where the key would undo its typing.
    await expect(page.locator("textarea:focus, input:focus")).toHaveCount(0)

    await page.keyboard.press("Meta+z")
    await expect(rows(page)).toHaveCount(4)
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await expect(page.locator("[aria-label='Track 2 input']")).toHaveText("Input 2")
    await expect(notices(page)).toHaveCount(0)
  })

  // A double click on a bin takes off its track and the one that moves up
  // under the pointer: each says so with an Undo of its own (B1).
  test("two tracks taken off at once each come back, with Ctrl+Z twice", async ({ page }) => {
    await openFour(page, { Drums: [0.0004], Bass: [0.62], Guitar: [0.0004], Vocals: [0.62] })
    // Clicked while the screen still rises, Check signal can be scrolled to,
    // and a screen scrolled down moves its rows down when one goes: the
    // second click would then land between them.
    await settled(page)
    await page.getByRole("button", { name: "Check signal" }).click()
    const row = (n: number) => rows(page).nth(n - 1)
    await expect(heard(row(2), "signal")).toBeVisible()

    await page.getByRole("button", { name: "Remove track Bass" }).dblclick()
    await expect(rows(page)).toHaveCount(2)
    expect(await namesOf(page)).toEqual(["Drums", "Vocals"])
    await expect(said(page, "Bass was taken off.")).toHaveCount(1)
    await expect(said(page, "Guitar was taken off.")).toHaveCount(1)

    await page.keyboard.press("Control+z")
    await expect(rows(page)).toHaveCount(3)
    expect(await namesOf(page)).toEqual(["Drums", "Guitar", "Vocals"])
    await page.keyboard.press("Control+z")
    await expect(rows(page)).toHaveCount(4)
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await expect(notices(page)).toHaveCount(0)
    // Each with what its own input sends.
    await polls(page, 3)
    for (const [n, word] of [[1, "silent"], [2, "signal"], [3, "silent"], [4, "signal"]] as const)
      await expect(heard(row(n), word)).toBeVisible()
    expect(await reach(row(2))).toBeGreaterThan(0.8)
    expect(await reach(row(3))).toBeLessThan(0.05)
  })

  test("the older of two Undos puts its track back in its own place", async ({ page }) => {
    await openFour(page, { Drums: [0.0004], Bass: [0.62], Guitar: [0.0004], Vocals: [0.62] })
    await page.getByRole("button", { name: "Check signal" }).click()
    const row = (n: number) => rows(page).nth(n - 1)
    await expect(heard(row(2), "signal")).toBeVisible()
    await page.getByRole("button", { name: "Remove track Bass" }).click()
    await page.getByRole("button", { name: "Remove track Guitar" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Vocals"])

    // Bass's Undo first, though Guitar's is the newer.
    await said(page, "Bass was taken off.").getByRole("button", { name: "Undo" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Vocals"])
    await said(page, "Guitar was taken off.").getByRole("button", { name: "Undo" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await polls(page, 3)
    for (const [n, word] of [[1, "silent"], [2, "signal"], [3, "silent"], [4, "signal"]] as const)
      await expect(heard(row(n), word)).toBeVisible()

    // Leaving the screen takes every Undo it offered with it.
    await page.getByRole("button", { name: "Remove track Drums" }).click()
    await page.getByRole("button", { name: "Remove track Vocals" }).click()
    await expect(notices(page)).toHaveCount(2)
    await startButton(page).click()
    await expect(page.getByRole("button", { name: /Record take 1/ })).toBeVisible()
    await expect(notices(page)).toHaveCount(0)
  })

  // An Undo puts its track back before the first track after it that is on
  // screen, through those still taken off, so the band keeps its order
  // whichever Undo is clicked first.
  test("the Undo of a track whose next one is off too puts it back above that one", async ({
    page,
  }) => {
    await openFour(page, { Drums: [0.0004], Bass: [0.0004], Guitar: [0.62], Vocals: [0.0004] })
    await page.getByRole("button", { name: "Check signal" }).click()
    const row = (n: number) => rows(page).nth(n - 1)
    await expect(heard(row(3), "signal")).toBeVisible()
    await page.getByRole("button", { name: "Remove track Guitar" }).click()
    await page.getByRole("button", { name: "Remove track Vocals" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass"])

    await said(page, "Guitar was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass", "Guitar"])
    await said(page, "Vocals was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    // Each with what its own input sends.
    await polls(page, 3)
    for (const [n, word] of [[1, "silent"], [2, "silent"], [3, "signal"], [4, "silent"]] as const)
      await expect(heard(row(n), word)).toBeVisible()
  })

  test("three tracks taken off and put back oldest first keep the band's order", async ({
    page,
  }) => {
    await openFour(page)
    for (const name of ["Bass", "Guitar", "Vocals"])
      await page.getByRole("button", { name: `Remove track ${name}` }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums"])

    await said(page, "Bass was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass"])
    await said(page, "Guitar was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass", "Guitar"])
    await said(page, "Vocals was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
  })

  test("the last track's Undo first, then the one above it, keep the band's order", async ({
    page,
  }) => {
    await openFour(page)
    await page.getByRole("button", { name: "Remove track Bass" }).click()
    await page.getByRole("button", { name: "Remove track Vocals" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Guitar"])

    await said(page, "Vocals was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Guitar", "Vocals"])
    await said(page, "Bass was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
  })

  test("taking a track off during the check keeps the others' meters", async ({ page }) => {
    await openFour(page, { Drums: [0.62], Bass: [0.0004], Guitar: [0.62], Vocals: [0.0004] })
    await page.getByRole("button", { name: "Check signal" }).click()
    const row = (n: number) => rows(page).nth(n - 1)
    await expect(heard(row(1), "signal")).toBeVisible()
    await expect(heard(row(3), "signal")).toBeVisible()

    await page.getByRole("button", { name: "Remove track Drums" }).click()
    await expect(rows(page)).toHaveCount(3)
    await polls(page, 3)
    // Bass, Guitar and Vocals, each with what its own input sends.
    await expect(heard(row(1), "silent")).toBeVisible()
    await expect(heard(row(2), "signal")).toBeVisible()
    await expect(heard(row(3), "silent")).toBeVisible()
    expect(await reach(row(1))).toBeLessThan(0.05)
    expect(await reach(row(2))).toBeGreaterThan(0.8)
    expect(await reach(row(3))).toBeLessThan(0.05)

    // Undo puts Drums back first, with its reading, and the others keep theirs.
    await said(page, "Drums was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect(rows(page)).toHaveCount(4)
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await polls(page, 3)
    for (const [n, word] of [[1, "signal"], [2, "silent"], [3, "signal"], [4, "silent"]] as const)
      await expect(heard(row(n), word)).toBeVisible()
    expect(await reach(row(1))).toBeGreaterThan(0.8)
    expect(await reach(row(2))).toBeLessThan(0.05)
  })

  test("a port pulled out is said in its track's line and no row moves", async ({ page }) => {
    await openApp(page)
    await page.getByRole("textbox", { name: "Track 2 name" }).fill("Keys")
    await page
      .getByRole("radiogroup", { name: "Track 2 records" })
      .getByRole("radio", { name: "MIDI", exact: true })
      .click()
    await page.getByRole("combobox", { name: "Track 2 MIDI port" }).click()
    await page.getByRole("option", { name: "Launchkey Mini MK3" }).click()
    await expect(page.getByRole("listbox")).toHaveCount(0)
    await page.getByRole("button", { name: "Check signal" }).click()
    const keys = rows(page).nth(1)
    await expect(keys.getByText("no notes")).toBeVisible({ timeout: 3000 })
    await page.mouse.move(0, 0)
    await settled(page)
    const before = await layout(page)

    await setFake(page, "__MIDI_GONE__", ["Launchkey Mini MK3"])
    await expect(keys.getByRole("status").filter({ hasText: GONE })).toBeVisible({ timeout: 3000 })
    expect(await layout(page)).toEqual(before)
  })

  // Review Focus 5: the stress data's band, the keys' track under a name
  // that takes two lines, beside Last time at 1180 px and alone at 960.
  for (const width of [1180, 960]) {
    test(`a port pulled out of a long-named track during the check moves nothing at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 820 })
      await openBandApp(page, { stress: true })
      await expect(rows(page)).toHaveCount(5)
      const long = "Keys and the string pads (Hanna's second keyboard, the one by the window)"
      const name = page.getByRole("textbox", { name: "Track 5 name" })
      await name.fill(long)
      expect(await linesIn(name)).toBe(2)
      await page.getByRole("button", { name: "Check signal" }).click()
      const keys = rows(page).nth(4)
      const notes = keys.locator("[data-check-slot='notes']").getByText("notes", { exact: true })
      await expect(notes).toBeVisible({ timeout: 3000 })
      await page.mouse.move(0, 0)
      await settled(page)
      const before = await layout(page)

      await setFake(page, "__MIDI_GONE__", ["Launchkey Mini MK3"])
      // Said in the keys' own line, beside its picker, and nowhere else.
      await expect(keys.locator("[data-port-note]")).toHaveText(GONE, { timeout: 3000 })
      await expect(page.locator("[data-port-note]")).toHaveCount(1)
      await expect(page.getByRole("combobox", { name: "Track 5 MIDI port" })).toHaveText("Launchkey Mini MK3")
      expect(await layout(page)).toEqual(before)
    })
  }

  test("a track put back after a new check began reads silent", async ({ page }) => {
    // What the first check heard from Drums is not the second's: the second
    // never opened its input.
    await openFour(page, { Drums: [0.62], Bass: [0.0004], Guitar: [0.0004], Vocals: [0.0004] })
    await page.getByRole("button", { name: "Check signal" }).click()
    const drums = rows(page).first()
    await expect(heard(drums, "signal")).toBeVisible()
    await page.getByRole("button", { name: "Remove track Drums" }).click()
    await page.getByRole("button", { name: "Stop checking" }).click()
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()

    await said(page, "Drums was taken off.").getByRole("button", { name: "Undo" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await polls(page, 3)
    await expect(heard(rows(page).first(), "silent")).toBeVisible()
    expect(await reach(rows(page).first())).toBe(0)
  })

  test("a track put back while the check opens reads its own input", async ({ page }) => {
    await openFour(page, { Drums: [0.0004], Bass: [0.0004], Guitar: [0.62], Vocals: [0.0004] })
    await page.getByRole("button", { name: "Remove track Bass" }).click()
    await expect(rows(page)).toHaveCount(3)
    // The check is slow to open, and Bass comes back meanwhile.
    await hold(page, "start_monitor")
    await page.getByRole("button", { name: "Check signal" }).click()
    await said(page, "Bass was taken off.").getByRole("button", { name: "Undo" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await letGo(page, "start_monitor")
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()

    // The check opened the three that were there: Bass, put back, is silent
    // and has no meter of anybody else's; Guitar keeps its own.
    await polls(page, 3)
    const row = (n: number) => rows(page).nth(n - 1)
    await expect(heard(row(2), "silent")).toBeVisible()
    expect(await reach(row(2))).toBe(0)
    await expect(heard(row(3), "signal")).toBeVisible()
    expect(await reach(row(3))).toBeGreaterThan(0.8)
  })

  test("a track taken off while the check opens leaves the others theirs", async ({ page }) => {
    // Every other one loud: a reading one place out says the wrong word.
    await openFour(page, { Drums: [0.0004], Bass: [0.62], Guitar: [0.0004], Vocals: [0.62] })
    await hold(page, "start_monitor")
    await page.getByRole("button", { name: "Check signal" }).click()
    await page.getByRole("button", { name: "Remove track Bass" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Guitar", "Vocals"])
    await letGo(page, "start_monitor")
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()

    await polls(page, 3)
    const row = (n: number) => rows(page).nth(n - 1)
    await expect(heard(row(2), "silent")).toBeVisible()
    expect(await reach(row(2))).toBeLessThan(0.05)
    await expect(heard(row(3), "signal")).toBeVisible()
    expect(await reach(row(3))).toBeGreaterThan(0.8)

    // And Undo puts Bass back with what the check opened for it: its own
    // loud input, where a track put back with nothing reads silent.
    await said(page, "Bass was taken off.").getByRole("button", { name: "Undo" }).click()
    expect(await namesOf(page)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    await polls(page, 3)
    await expect(heard(row(2), "signal")).toBeVisible()
    expect(await reach(row(2))).toBeGreaterThan(0.8)
    await expect(heard(row(3), "silent")).toBeVisible()
    await expect(heard(row(4), "signal")).toBeVisible()
  })
})

/** What a track's line says of a port that is not plugged in. */
const GONE = "Not connected. Records its notes from the moment it is plugged in."

/** Every row's top and bottom, Add track's box and the footer's, to the half
 *  pixel. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element | null) => {
      const b = el!.getBoundingClientRect()
      return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2) / 2)
    }
    const add = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Add track"))
    return {
      rows: [...document.querySelectorAll("[data-track-row]")].map((r) => {
        const b = r.getBoundingClientRect()
        return [b.top, b.bottom].map((v) => Math.round(v * 2) / 2)
      }),
      add: box(add ?? null),
      footer: box(document.querySelector("footer")),
    }
  })

// Narrower than 68.75rem (1100 px at 100 %, 1430 at 130 %) the left part
// waits behind a Last time button in the header, before History, and opens
// as a panel from the left (Alex, Q4). The player stays the screen's, so the
// panel can close, or the window widen, with a take playing.
test.describe("the left part behind a button in a narrow window", () => {
  test.use({ viewport: { width: 1000, height: 820 } })

  /** The panel the header's Last time button opens. */
  const panel = (page: Page) => page.getByRole("dialog", { name: "Last time" })
  /** The left part, where it is beside the setup. */
  const past = (page: Page) => page.locator("[data-part='past']")

  /** The tracks group's width; the most the setup part gives it (its width
   *  less its padding, at most 48rem); and how wide the setup part and the
   *  screen are. */
  const tracksRoom = (page: Page) =>
    page.evaluate(() => {
      const setup = document.querySelector<HTMLElement>("[data-part='setup']")!
      const style = getComputedStyle(setup)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const inside = setup.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      return {
        group: document.querySelector("section[data-tracks]")!.getBoundingClientRect().width,
        most: Math.min(inside, 48 * rem),
        setup: setup.getBoundingClientRect().width,
        screen: document.querySelector("main")!.clientWidth,
      }
    })

  /** What the fake's player says: whether it plays, and where it is. */
  const playerNow = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as {
        pywebview: { api: { player_state: () => Promise<{ playing: boolean; position: number }> } }
      }
      return w.pywebview.api.player_state()
    })

  /** What the open panel locks, as a modal does: the pointer off the page,
   *  its scroll, the screen hidden from a screen reader, anything inert. */
  const locks = (page: Page) =>
    page.evaluate(() => ({
      pointer: getComputedStyle(document.body).pointerEvents === "none",
      scroll: document.body.hasAttribute("data-scroll-locked"),
      hidden: document.querySelector("main")!.closest("[aria-hidden='true']") !== null,
      inert: document.querySelector("[inert]") !== null,
    }))

  /** Last time's button for Pałyn 2, the last take of Pałyn, in `where`. */
  const palyn = (where: Locator, does: "Play" | "Pause") =>
    where.getByRole("button", { name: `${does} Pałyn 2, the last take of Pałyn` })

  test("under 1100 px Last time opens as a side panel from the header", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const button = lastTimeButton(page)
    await expect(button).toBeVisible()
    await expect(past(page)).toBeHidden()
    const history = page.locator("header").getByRole("button", { name: "History", exact: true })
    expect((await button.boundingBox())!.x).toBeLessThan((await history.boundingBox())!.x)
    await expect(button).toHaveAttribute("aria-expanded", "false")

    await button.click()
    await expect(button).toHaveAttribute("aria-expanded", "true")
    const sheet = panel(page)
    await expect(sheet.getByRole("complementary", { name: "Last time" })).toContainText(
      "Last time · Thu 10 Sep"
    )
    // From the left, 28rem wide.
    await expect.poll(async () => (await sheet.boundingBox())?.x).toBe(0)
    expect((await sheet.boundingBox())!.width).toBeCloseTo(28 * 16, 0)
  })

  test("Esc closes the panel and focus returns to its button", async ({ page }) => {
    await openApp(page)
    const button = lastTimeButton(page)
    const ways: [string, () => Promise<void>][] = [
      ["Esc", () => page.keyboard.press("Escape")],
      ["the close button", () => panel(page).getByRole("button", { name: "Close" }).click()],
      // Right of the panel, on the veil.
      ["the veil", () => page.mouse.click(980, 400)],
    ]
    for (const [way, close] of ways) {
      await button.click()
      await expect(panel(page), way).toBeVisible()
      await close()
      await expect(panel(page), way).toHaveCount(0)
      await expect(button, way).toBeFocused()
      await expect(button, way).toHaveAttribute("aria-expanded", "false")
    }
  })

  test("widening the window closes the panel", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await lastTimeButton(page).click()
    await palyn(panel(page), "Play").click()
    await expect(palyn(panel(page), "Pause")).toBeVisible()
    expect(await locks(page)).toEqual({ pointer: true, scroll: true, hidden: true, inert: false })

    await page.setViewportSize({ width: 1180, height: 820 })
    await expect(panel(page)).toHaveCount(0)
    await expect(lastTimeButton(page)).toHaveCount(0)
    await expect(past(page)).toBeVisible()
    // What the panel locked goes with it.
    await expect
      .poll(() => locks(page))
      .toEqual({ pointer: false, scroll: false, hidden: false, inert: false })
    await settled(page)
    const left = (await past(page).boundingBox())!
    const setup = (await page.locator("[data-part='setup']").boundingBox())!
    expect(left.x + left.width).toBeLessThanOrEqual(setup.x + 0.5)

    // The take plays on beside the setup, and Space is still its own.
    await expect(palyn(past(page), "Pause")).toBeVisible()
    await page.keyboard.press("Space")
    await expect(palyn(past(page), "Play")).toBeVisible()
    expect((await playerNow(page)).playing).toBe(false)

    // Narrowed again, it stays shut until it is asked for.
    await page.setViewportSize({ width: 1000, height: 820 })
    await expect(lastTimeButton(page)).toHaveAttribute("aria-expanded", "false")
    await expect(panel(page)).toHaveCount(0)
  })

  test("at 130 percent the side panel takes over below 1430 px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await openApp(page)
    // At 100 % the window has room for both.
    await expect(past(page)).toBeVisible()
    await expect(lastTimeButton(page)).toHaveCount(0)

    // 130 %, as Appearance sets it: on the root's font size.
    await page.evaluate(() => (document.documentElement.style.fontSize = "20.8px"))
    await expect(lastTimeButton(page)).toBeVisible()
    await expect(past(page)).toBeHidden()
    await settled(page)
    const room = await tracksRoom(page)
    expect(room.setup).toBeCloseTo(room.screen, 0)
    expect(room.group).toBeCloseTo(room.most, 0)
  })

  test("at 150 percent in the smallest window the panel takes over and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page, { before: scaled(1.5) })
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
      .toBe("24px")
    await expect(lastTimeButton(page)).toBeVisible()
    await expect(past(page)).toBeHidden()
    await settled(page)
    const room = await tracksRoom(page)
    expect(room.setup).toBeCloseTo(room.screen, 0)
    expect(room.group).toBeCloseTo(room.most, 0)

    // Shell clips the page, so the document itself never scrolls: what
    // could is the screen's middle and, with the panel open, what scrolls in
    // the panel (null while there is none). A header button cut off at the
    // window's edge is looked for directly.
    const sideways = () =>
      page.evaluate(() => {
        const wider = (el: Element) => el.scrollWidth > el.clientWidth + 1
        const dialog = document.querySelector("[role='dialog']")
        const scrollers = dialog
          ? [...dialog.querySelectorAll("*")].filter((el) => getComputedStyle(el).overflowY === "auto")
          : []
        return {
          middle: wider(document.querySelector("main")!),
          panel: scrollers.length ? scrollers.some(wider) : null,
          cut: [...document.querySelectorAll("header button")].some(
            (b) => b.getBoundingClientRect().right > window.innerWidth
          ),
        }
      })
    expect(await sideways()).toEqual({ middle: false, panel: null, cut: false })

    await lastTimeButton(page).click()
    await expect(panel(page).getByRole("complementary", { name: "Last time" })).toBeVisible()
    expect(await sideways()).toEqual({ middle: false, panel: false, cut: false })
  })

  test("the header button shows Last time playing", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const button = lastTimeButton(page)
    await expect(button).toBeVisible()
    const width = (await button.boundingBox())!.width
    await expect(button).not.toHaveAttribute("data-playing")
    await expect(button).toHaveAccessibleName("Last time")

    await button.click()
    await palyn(panel(page), "Play").click()
    await expect(palyn(panel(page), "Pause")).toBeVisible()
    // Esc is the panel's while it is open: it closes it, and the take plays on.
    await page.keyboard.press("Escape")
    await expect(panel(page)).toHaveCount(0)
    await expect(button).toHaveAttribute("data-playing")
    // The sr-only words are a box of their own, so Chromium sets them apart.
    await expect(button).toHaveAccessibleName(/^Last time ?, playing$/)
    expect((await button.boundingBox())!.width).toBe(width)
    const was = await playerNow(page)
    expect(was.playing).toBe(true)
    await expect.poll(async () => (await playerNow(page)).position).toBeGreaterThan(was.position)

    // Widened, the left part is beside the setup again, the take still
    // playing in it, never opened again.
    const opens = await callCount(page, "player_open")
    await page.setViewportSize({ width: 1180, height: 820 })
    await expect(lastTimeButton(page)).toHaveCount(0)
    await expect(palyn(past(page), "Pause")).toBeVisible()
    expect((await playerNow(page)).playing).toBe(true)
    expect(await callCount(page, "player_open")).toBe(opens)
  })

  test("after the close button Space pauses the take, after Esc it opens the panel again", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const button = lastTimeButton(page)
    await button.click()
    await palyn(panel(page), "Play").click()
    await expect(button).toHaveAttribute("data-playing")

    // Closed with the mouse, the panel sends focus back to its button, but
    // the mouse put it there: Space is the take's, and pauses it.
    await panel(page).getByRole("button", { name: "Close" }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(button).toBeFocused()
    await page.keyboard.press("Space")
    await expect(button).not.toHaveAttribute("data-playing")
    expect((await playerNow(page)).playing).toBe(false)
    await expect(panel(page)).toHaveCount(0)
    await page.keyboard.press("Space")
    await expect(button).toHaveAttribute("data-playing")

    // Closed with Esc, focus is back on the button by the keyboard, and Space
    // presses it, as it presses any button so reached: the panel opens
    // again, and the take plays on.
    await button.click()
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(panel(page)).toHaveCount(0)
    await expect(button).toBeFocused()
    await page.keyboard.press("Space")
    await expect(panel(page)).toBeVisible()
    await expect(palyn(panel(page), "Pause")).toBeVisible()
    expect((await playerNow(page)).playing).toBe(true)
  })

  test("Undo in the notice puts the track back and leaves the panel open", async ({ page }) => {
    await openApp(page)
    await page.getByRole("button", { name: "Remove track Vocals" }).click()
    await expect(rows(page)).toHaveCount(1)
    await lastTimeButton(page).click()
    await expect(panel(page)).toBeVisible()

    // The notices are over the panel's veil, and a click on one is not a
    // click outside the panel (C4).
    await said(page, "Vocals was taken off.").getByRole("button", { name: "Undo" }).click()
    await expect(rows(page)).toHaveCount(2)
    expect(await namesOf(page)).toEqual(["Guitar", "Vocals"])
    await expect(panel(page)).toBeVisible()
    await expect(lastTimeButton(page)).toHaveAttribute("aria-expanded", "true")
  })

  test("with no rehearsal before there is no Last time button and no panel", async ({ page }) => {
    await openApp(page, { before: "window.__NO_HISTORY__ = true;" })
    await expect(startButton(page)).toBeVisible()
    await expect.poll(() => callCount(page, "last_time")).toBe(1)
    await expect(page.locator("header").getByRole("button", { name: "History", exact: true })).toBeVisible()
    await expect(lastTimeButton(page)).toHaveCount(0)
    await expect(panel(page)).toHaveCount(0)
    await expect(past(page)).toHaveCount(0)
  })
})

// Last time on the shared pieces, with the stress data's long names (Q3,
// Review Focus 4): a name keeps its width and wraps past its row, the
// figures beside it drop whole, and whatever is cut or dropped shows whole
// on hover and on keyboard focus — beside the setup at 1180 px, and in the
// panel at 960 px. The interface's name in Recording with does the same.
test.describe("Last time and long names on the shared pieces", () => {
  const KALYCHANKA = "Kalychanka (slow version for the wedding, with the long intro the bride asked for)"
  const DANCING = "Dancing barefoot on the roof of the old brewery"
  const SOUNDCHECK = "Soundcheck at the community hall before the open-air concert"
  const TUESDAY = "Tuesday jam at the old brewery, with the horn section and the choir from upstairs"

  /** Last time, beside the setup. */
  const beside = (page: Page) =>
    page.locator("[data-part='past']").getByRole("complementary", { name: "Last time" })
  /** The panel the header's Last time button opens, and Last time in it. */
  const panel = (page: Page) => page.getByRole("dialog", { name: "Last time" })
  const inPanel = (page: Page) => panel(page).getByRole("complementary", { name: "Last time" })

  /** The smallest window, with Last time open in its panel. */
  async function openPanel(page: Page) {
    await page.setViewportSize({ width: 960, height: 680 })
    await lastTimeButton(page).click()
    await expect(inPanel(page)).toBeVisible()
    return inPanel(page)
  }

  /** The tip a name or a figure line shows: the open one. A tip that has
   *  just closed (Tab moved on past a cut name, or the pointer left) stays
   *  in the page for its 220 ms fade with data-state "closed", beside the
   *  next one, and Playwright's strict mode fails at once on two matches
   *  without waiting for the fade to end. Open is "instant-open" or
   *  "delayed-open". */
  const tip = (page: Page) => page.locator("[data-whole][data-state$='open']")
  /** Every tip in the page, a fading one too: none once a closed tip has
   *  faded and left. */
  const tips = (page: Page) => page.locator("[data-whole]")
  /** The pointer off to the window's corner, moving as a hand does: Radix
   *  keeps a tip while the pointer may be on its way into it, until it has
   *  moved somewhere else. */
  const away = (page: Page) => page.mouse.move(0, 0, { steps: 8 })

  /** A song's name in a row of Last time: the button that opens its page. */
  const songName = (past: Locator, title: string) =>
    past.getByRole("button", { name: `Open the song ${title}`, exact: true })
  /** Last time's day line, the card's heading: a place to start Tabbing from. */
  const dayLine = (past: Locator) => past.getByRole("heading", { name: /^Last time · / })

  /** Tab on from where focus is until `target` has it, as a keyboard gets
   *  there. */
  async function tabTo(page: Page, target: Locator) {
    for (let i = 0; i < 120 && !(await target.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press("Tab")
    await expect(target).toBeFocused()
  }

  test("Not played keeps the song name whole and drops figures", async ({ page }) => {
    await openBandApp(page, { stress: true })
    // Dym's ▶ plays a ★ go from another evening: its figure line is the
    // longest there is, and it used to squeeze "Dym" to "D…".
    const star = "★ Dym 2 (Tue 15 Sep)"
    const check = async (past: Locator, where: string) => {
      const row = past.getByRole("region", { name: "Not played last time" }).locator("[data-song='Dym']")
      const name = row.locator("[data-name]")
      await expect(name, where).toHaveText("Dym")
      await expect(name, where).not.toHaveAttribute("data-cut")
      expect(
        await name.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
        where
      ).toBe(true)
      // In the one link look: the text's colour, underlined at rest.
      await expect(songName(past, "Dym"), where).toHaveCSS("text-decoration-line", "underline")

      const figures = row.locator("[data-figures]")
      await expect(figures, where).toHaveAttribute("data-dropped")
      const read = figures.locator(".sr-only")
      await expect(read, where).toHaveText(new RegExp(`^${literally(star)} · Sat 19 Sep, .+ ago · 4 takes$`))
      // Dropped in order, the least needed first: how long ago, then the
      // day, then the goes, the ★ go last. The ★ is drawn, not written.
      const ago = (await read.innerText()).split(", ")[1].split(" · ")[0]
      const kept = [
        `${star} · Sat 19 Sep, ${ago} · 4 takes`,
        `${star} · Sat 19 Sep · 4 takes`,
        `${star} · 4 takes`,
        star,
        "",
      ].map((line) => line.replace("★ ", ""))
      const shown = (await figures.locator("[data-shown]").innerText()).trim()
      // The card leaves the line room for some of it, beside the setup and in
      // the panel alike: not none.
      expect(kept.slice(1, -1), `${where}: "${shown}"`).toContain(shown)

      // What dropped is a keyboard's too: the name's tip says the line whole.
      await dayLine(past).click()
      await tabTo(page, songName(past, "Dym"))
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toContainText(`${star.replace("★ ", "")} · Sat 19 Sep, ${ago} · 4 takes`)
      await dayLine(past).click()
      await expect(tips(page), where).toHaveCount(0)
    }

    await check(beside(page), "beside the setup")
    await check(await openPanel(page), "in the panel")
  })

  test("the check's readings do not measure Last time again", async ({ page }) => {
    // The stress data beside the setup: two dozen figure lines and cut names,
    // each measured as it is drawn. The check reads the levels every 80 ms.
    await page.setViewportSize({ width: 1180, height: 820 })
    await openBandApp(page, { stress: true })
    await expect(beside(page)).toBeVisible()
    await settled(page)
    // Every box or width read inside Last time, from here on.
    await page.evaluate(() => {
      const w = window as unknown as { __READS__: number }
      w.__READS__ = 0
      const inside = (el: Element) => el.closest("aside[aria-label='Last time']") !== null
      const rect = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function () {
        if (inside(this)) w.__READS__++
        return rect.call(this)
      }
      for (const prop of ["scrollWidth", "clientWidth"] as const) {
        const own = Object.getOwnPropertyDescriptor(Element.prototype, prop)!
        Object.defineProperty(Element.prototype, prop, {
          configurable: true,
          get() {
            if (inside(this)) w.__READS__++
            return own.get!.call(this)
          },
        })
      }
    })
    const reads = () => page.evaluate(() => (window as unknown as { __READS__: number }).__READS__)
    // The band's levels are not counted by the fake: counted here.
    await page.evaluate(() => {
      const w = window as unknown as {
        __LEVEL_READS__: number
        pywebview: { api: Record<string, (...a: unknown[]) => unknown> }
      }
      w.__LEVEL_READS__ = 0
      const api = w.pywebview.api
      const levels = api.monitor_levels
      api.monitor_levels = (...a) => {
        w.__LEVEL_READS__++
        return levels(...a)
      }
    })
    const readings = () =>
      page.evaluate(() => (window as unknown as { __LEVEL_READS__: number }).__LEVEL_READS__)

    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    await expect.poll(readings).toBeGreaterThanOrEqual(2)
    const before = await reads()
    const from = await readings()
    await expect.poll(readings).toBeGreaterThanOrEqual(from + 10)
    expect(await reads(), "reads inside Last time over ten readings").toBe(before)

    // And it still plays, and opens.
    await page.getByRole("button", { name: "Stop checking" }).click()
    const play = beside(page).getByRole("button", { name: /^Play Pałyn 7/ })
    await play.click()
    await expect(beside(page).getByRole("button", { name: /^Pause Pałyn 7/ })).toBeVisible()
    await beside(page).getByRole("button", { name: /^Pause Pałyn 7/ }).click()
    await beside(page).getByRole("button", { name: /^Open .* in History$/ }).click()
    await expect(page.getByRole("navigation", { name: "Rehearsals" })).toBeVisible()
  })

  test("a press the browser called off leaves the tip to the keyboard", async ({ page }) => {
    await openBandApp(page, { stress: true })
    const past = beside(page)
    const name = songName(past, KALYCHANKA)
    await expect(name.locator("[data-name]")).toHaveAttribute("data-cut")
    // A touch that became a scroll: pressed, then called off, never released.
    await name.dispatchEvent("pointerdown", { pointerId: 7, isPrimary: true, button: 0 })
    await name.dispatchEvent("pointercancel", { pointerId: 7, isPrimary: true })
    // Then the keys: from the row's ▶ to its name.
    await past.locator(`[data-song='${KALYCHANKA}'] button[data-look]`).focus()
    await page.keyboard.press("Tab")
    await expect(name).toBeFocused()
    await expect(tip(page)).toBeVisible()
    await expect(tip(page)).toContainText(KALYCHANKA)
  })

  test("a cut name shows whole on hover", async ({ page }) => {
    await openBandApp(page, { stress: true })
    // Longer than two lines of its row: cut, and whole under the pointer.
    const hover = async (past: Locator, where: string) => {
      const name = songName(past, KALYCHANKA)
      await expect(name.locator("[data-name]"), where).toHaveAttribute("data-cut")
      await name.hover()
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toContainText(KALYCHANKA)
      await away(page)
      await expect(tips(page), where).toHaveCount(0)
    }
    await hover(beside(page), "beside the setup")
    await hover(await openPanel(page), "in the panel")
  })

  test("a cut name shows whole on keyboard focus, when the focus scrolls the panel", async ({
    page,
  }) => {
    // At 130 % in the smallest window, the name is below the panel's fold.
    await page.setViewportSize({ width: 960, height: 680 })
    await page.addInitScript(
      "window.localStorage.setItem('mock-python-config', JSON.stringify({theme:'dark', ui_scale:1.3}));"
    )
    await openBandApp(page, { stress: true })
    const past = await openPanel(page)
    const scroller = panel(page).locator(".overflow-y-auto")
    const name = songName(past, KALYCHANKA)
    await expect(name).not.toBeInViewport()
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0)
    // Tab down the panel to the name, as a keyboard does: getting there
    // scrolls the panel.
    await tabTo(page, name)
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(name).toBeInViewport()

    // The tip shows by the focused name, at once, and stays.
    await expect(tip(page)).toBeVisible()
    await expect(tip(page)).toContainText(KALYCHANKA)
    const by = async () => {
      const t = (await tip(page).boundingBox())!
      const n = (await name.boundingBox())!
      return {
        across: t.x < n.x + n.width && n.x < t.x + t.width,
        // Above it or under it, its arrow's length off.
        near: Math.min(Math.abs(t.y + t.height - n.y), Math.abs(n.y + n.height - t.y)) < 24,
      }
    }
    await expect.poll(by).toEqual({ across: true, near: true })
    // Still open once a closing tip would have faded (220 ms), and the only
    // tip in the page: the one Tab opened on a cut name on the way here has
    // faded and left.
    const stays = async () => {
      await page.waitForTimeout(500)
      await expect(tip(page)).toBeVisible()
      await expect(tips(page)).toHaveCount(1)
      expect(await by()).toEqual({ across: true, near: true })
    }
    await stays()

    // The panel scrolled on round the focused name, which closes a Radix
    // tip: this one stays, by the name where it is now.
    const at = (await name.boundingBox())!.y
    await scroller.evaluate((el) => el.scrollBy(0, 40))
    await expect.poll(async () => (await name.boundingBox())!.y).toBeLessThan(at - 30)
    await expect(name).toBeFocused()
    await stays()
  })

  test("a name that takes its whole row carries its figures in its tip", async ({ page }) => {
    // Q3: dropped figures show whole on hover. A name wider than its row
    // wraps and leaves the figures no room at all, so there is nothing of
    // them to hover: the name's own tip says them, though it is not cut.
    await openBandApp(page, { stress: true })
    const check = async (past: Locator, where: string) => {
      const row = past.locator(`[data-song='${DANCING}']`)
      await expect(row.locator("[data-name]"), where).not.toHaveAttribute("data-cut")
      await expect(row.locator("[data-figures] [data-shown]"), where).toHaveText("")
      await songName(past, DANCING).hover()
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toContainText(DANCING)
      await expect(tip(page), where).toContainText("2 takes · 10:10")
      await away(page)
      await expect(tips(page), where).toHaveCount(0)

      // And by keyboard, which reaches the name and not the figures.
      await dayLine(past).click()
      await tabTo(page, songName(past, DANCING))
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toContainText(DANCING)
      await expect(tip(page), where).toContainText("2 takes · 10:10")
      // The tip is for the eyes: a screen reader reads the name, and the
      // figures in their own line, once each.
      await expect(songName(past, DANCING), where).toHaveAccessibleDescription("")
      await expect(past.locator(`[data-song='${DANCING}'] [data-figures] .sr-only`), where).toHaveText(
        "2 takes · 10:10"
      )
      await dayLine(past).click()
      await expect(tips(page), where).toHaveCount(0)

      // A name with room beside it shows no tip of its own.
      await songName(past, "Zorka").hover()
      await page.waitForTimeout(700)
      await expect(tips(page), where).toHaveCount(0)
      await away(page)
    }
    await check(beside(page), "beside the setup")
    await check(await openPanel(page), "in the panel")
  })

  test("an Earlier rehearsal whose name takes its row carries its figures in its tip", async ({
    page,
  }) => {
    // Its name wraps and leaves its figures no room at all. The row is one
    // button, and its one tip says them, on hover and on keyboard focus; a
    // screen reader hears them once, in the row's name.
    await openBandApp(page, { stress: true })
    const check = async (past: Locator, where: string) => {
      const earlier = past.getByRole("region", { name: "Earlier" })
      const row = earlier.locator("[data-earlier='/rec/soundcheck']")
      await expect(row.locator("[data-figures]"), where).toHaveAttribute("data-dropped")
      await expect(row.locator("[data-figures] [data-shown]"), where).toHaveText("")

      await row.hover()
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toContainText(SOUNDCHECK)
      await expect(tip(page), where).toContainText("5 min · 2 takes")
      await away(page)
      await expect(tips(page), where).toHaveCount(0)

      await earlier.getByRole("heading", { name: "Earlier" }).click()
      await tabTo(page, row)
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toContainText(SOUNDCHECK)
      await expect(tip(page), where).toContainText("5 min · 2 takes")
      await expect(row, where).toHaveAccessibleName(/^Sat 12 Sep ?Soundcheck at .+ concert ?5 min · 2 takes$/)
      await expect(row, where).toHaveAccessibleDescription("")
      await earlier.getByRole("heading", { name: "Earlier" }).click()
      await expect(tips(page), where).toHaveCount(0)
    }
    await check(beside(page), "beside the setup")
    await check(await openPanel(page), "in the panel")
  })

  test("the interface's figures are said in its name's tip once none has room", async ({ page }) => {
    // At 150 % in the smallest window, the stress data's interface leaves
    // its figures no room: the name's tip says them.
    await page.setViewportSize({ width: 960, height: 680 })
    await page.addInitScript(
      "window.localStorage.setItem('mock-python-config', JSON.stringify({theme:'dark', ui_scale:1.5}));"
    )
    await openBandApp(page, { stress: true })
    // Fix font metrics so this deliberate no-room case is portable across OSes.
    await page.addStyleTag({ content: "* { font-family: Arial, sans-serif !important; }" })
    const row = page.locator("[data-recording-with]")
    const name = row.getByText("Universal Audio Apollo Twin X DUO Heritage Edition", { exact: true })
    await expect(name).not.toHaveAttribute("data-cut")
    await expect(row.locator("[data-figures]")).toHaveAttribute("data-dropped")
    await expect(row.locator("[data-figures] [data-shown]")).toHaveText("")
    await name.hover()
    await expect(tip(page)).toBeVisible()
    await expect(tip(page)).toContainText("Universal Audio Apollo Twin X DUO Heritage Edition")
    await expect(tip(page)).toContainText("18 inputs · 48 kHz · 24 bit")
    await away(page)
    await expect(tips(page)).toHaveCount(0)

    // The tip is the button's, so Tab shows it too.
    const button = row.getByRole("button", { name: "Change the interface and quality" })
    await row.getByText("Recording with", { exact: true }).click()
    await page.keyboard.press("Tab")
    await expect(button).toBeFocused()
    await expect(tip(page)).toBeVisible()
    await expect(tip(page)).toContainText("Universal Audio Apollo Twin X DUO Heritage Edition")
    await expect(tip(page)).toContainText("18 inputs · 48 kHz · 24 bit")
    // What it is now is read once, after what it does.
    await expect(button).toHaveAccessibleDescription(
      /^Universal Audio Apollo Twin X DUO Heritage Edition ?18 inputs · 48 kHz · 24 bit$/
    )
  })

  test("a cut rehearsal name shows whole in Open's tip, by keyboard", async ({ page }) => {
    // The card's name is cut past two lines. It is not a control, so the
    // keyboard reaches Open beside it, whose tip says the name whole.
    await openBandApp(page, { stress: true })
    const check = async (past: Locator, where: string) => {
      const name = past.locator("[data-card-name]")
      await expect(name, where).toHaveAttribute("data-cut")
      const open = past.getByRole("button", { name: `Open ${TUESDAY} in History`, exact: true })
      // A chevron: its word given up to the name.
      await expect(open, where).toHaveText("")
      // In the panel a click there puts focus on the panel, so Tab first
      // reaches its ✕.
      await dayLine(past).click()
      await tabTo(page, open)
      await expect(tip(page), where).toBeVisible()
      await expect(tip(page), where).toHaveText(`${TUESDAY}Open in History`)
      await expect(open, where).toHaveAccessibleDescription("")
      await dayLine(past).click()
      await expect(tips(page), where).toHaveCount(0)
      // The pointer finds it on the name as well.
      await name.hover()
      await expect(tip(page), where).toHaveText(TUESDAY)
      await away(page)
      await expect(tips(page), where).toHaveCount(0)
    }
    await check(beside(page), "beside the setup")
    await check(await openPanel(page), "in the panel")
  })

  test("Open gives up its word for a long name, and its tip says where it goes", async ({ page }) => {
    // Longer than the room Open with its word leaves, shorter than two lines.
    const name = "Tuesday jam at the old brewery with the horns"
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page, {
      after: `
        const api = window.pywebview.api; const lastTime = api.last_time;
        api.last_time = async () => {
          const r = await lastTime(); r.last.name = ${JSON.stringify(name)}; return r; };
      `,
    })
    const past = page.getByRole("complementary", { name: "Last time" })
    const open = past.getByRole("button", { name: `Open ${name} in History`, exact: true })
    const check = async (at: string) => {
      await expect(open, at).toHaveText("")
      await expect(past.locator("[data-card-name]"), at).not.toHaveAttribute("data-cut")
      await open.hover()
      await expect(tip(page), at).toHaveText("Open in History")
      await away(page)
      await expect(tips(page), at).toHaveCount(0)
      await dayLine(past).click()
      await page.keyboard.press("Tab")
      await expect(open, at).toBeFocused()
      await expect(tip(page), at).toHaveText("Open in History")
      await dayLine(past).click()
      await expect(tips(page), at).toHaveCount(0)
    }
    await check("at 100 %")
    // A new Appearance size, set live: Open and the name are measured afresh.
    await page.evaluate(() => (document.documentElement.style.fontSize = "20.8px"))
    await expect.poll(() => past.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(400)
    await check("at 130 %")
  })

  test("a short rehearsal name keeps Open's word, and Open needs no tip", async ({ page }) => {
    await openApp(page)
    const past = page.getByRole("complementary", { name: "Last time" })
    const open = past.getByRole("button", { name: "Open Tuesday jam in History", exact: true })
    await expect(open).toHaveText("Open")
    await open.hover()
    await page.waitForTimeout(700)
    await expect(tips(page)).toHaveCount(0)
    await away(page)
    await dayLine(past).click()
    await page.keyboard.press("Tab")
    await expect(open).toBeFocused()
    await page.waitForTimeout(300)
    await expect(tips(page)).toHaveCount(0)
  })

  test("the small play button shows a spinner after one second", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const past = page.getByRole("complementary", { name: "Last time" })
    const play = past.getByRole("button", { name: "Play Pałyn 2, the last take of Pałyn" })
    await expect(play).toBeVisible()
    // The take is slow to open: the fake holds it until it is let go.
    await hold(page, "player_open")
    const button = past.locator("[data-song='Pałyn'] button[data-look]")
    const spinner = button.locator(".animate-spin")
    await settled(page)
    const box = await button.boundingBox()
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await play.click()
    await expect(button).toHaveAttribute("data-look", "loading")
    await at(500)
    expect(await spinner.isVisible(), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await spinner.isVisible(), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    // The spinner takes the ▶'s place, in the same box: nothing round it moves.
    expect(await button.boundingBox(), "the ▶'s box with the spinner").toEqual(box)

    await letGo(page, "player_open")
    await expect(past.getByRole("button", { name: "Pause Pałyn 2, the last take of Pałyn" })).toBeVisible()
    await expect(spinner).toHaveCount(0)
  })

  test("Earlier rows open their rehearsal by keyboard", async ({ page }) => {
    await openApp(page)
    const earlier = page
      .getByRole("complementary", { name: "Last time" })
      .getByRole("region", { name: "Earlier" })
    // Each rehearsal is the one list row (Item).
    const rows = earlier.locator("[data-earlier]")
    await expect(rows).toHaveCount(3)
    for (const row of await rows.all()) await expect(row).toHaveClass(/(^| )group\/item( |$)/)
    // Read down to the heading, then Tab: the rows, in turn.
    await earlier.getByRole("heading", { name: "Earlier" }).click()
    await page.keyboard.press("Tab")
    await expect(rows.nth(0)).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(rows.nth(1)).toBeFocused()
    await expect(rows.nth(1)).toContainText("First rehearsal")
    // With the shared focus ring.
    await expect(rows.nth(1)).not.toHaveCSS("box-shadow", "none")
    // A rehearsal whose folder is gone says so, as History does.
    await expect(rows.nth(2)).toContainText("Missing jam")
    await expect(rows.nth(2).getByText("Not found on disk", { exact: true })).toHaveClass(/text-destructive/)

    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
    const list = page.getByRole("navigation", { name: "Rehearsals" })
    await expect(list.locator("[aria-current='true']")).toContainText("First rehearsal")
  })

  test("an Earlier row is drawn as it is written: 8 px at its sides, its parts on one baseline", async ({
    page,
  }) => {
    // The row is an Item and its Button in one element. Item's Slot passes
    // its classes on to the Button, whose merge puts them after its own
    // defaults: so the row draws what Item is given, not the Button's 16 px
    // sides and centring.
    await openApp(page)
    const row = page
      .getByRole("complementary", { name: "Last time" })
      .getByRole("region", { name: "Earlier" })
      .locator("[data-earlier]")
      .first()
    expect(await style(row, "padding-left", "padding-right", "align-items", "column-gap")).toEqual({
      "padding-left": "8px",
      "padding-right": "8px",
      "align-items": "baseline",
      "column-gap": "12px",
    })
  })

  test("the Last time heading has no capitals", async ({ page }) => {
    await openApp(page)
    const past = page.getByRole("complementary", { name: "Last time" })
    const heading = past.getByRole("heading", { name: /^Last time · /i })
    await expect(heading).toHaveText(/^Last time · \w{3} \d{1,2} \w{3}, .+$/)
    await expect(heading).toHaveCSS("text-transform", "none")
    for (const name of ["Not played last time", "Earlier"])
      await expect(past.getByRole("heading", { name, exact: true }), name).toHaveCSS("text-transform", "none")
  })
})
