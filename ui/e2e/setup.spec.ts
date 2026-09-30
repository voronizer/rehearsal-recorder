import {
  callCount,
  calls,
  expect,
  keyOn,
  openApp,
  setFake,
  startButton,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The setup screen: the band on the card's inputs, and what stops a
// rehearsal from starting on a card that cannot take it.

test("says the app's name with its logo, and fills the band in from the template", async ({
  page,
}) => {
  await openApp(page)
  // The one screen that says the app's name says it with the logo; the
  // working screens after it carry neither.
  expect(
    await page.evaluate(() => {
      const h = document.querySelector("header h1")
      const img = h?.querySelector<HTMLImageElement>('img[src$="favicon.svg"]')
      return !!img && img.complete && img.naturalWidth > 0 && h!.textContent!.trim() === "Rehearsal Recorder"
    })
  ).toBe(true)
  await expect(page.locator("input[aria-label='Track 1 name']")).toHaveValue("Guitar")
  // Free space is always on screen. The fake's disk lasts for weeks: past
  // two days the estimate is "many hours", which "about" does not go in
  // front of.
  await expect(page.getByText("Room for many hours of recording", { exact: true })).toHaveCount(1)
  await expect(page.getByText("44.1 kHz · 24 bit")).toHaveCount(1)
  await expect.poll(() => keyOn(startButton(page))).toBe("Space")
})

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
  await expect(page.getByText("Rehearsal finished")).toBeVisible()
  expect(await callCount(page, "finish_rehearsal")).toBe(1)
  await expect(page.getByText("Saved: 0 takes")).toHaveCount(1)
  const again = page.getByRole("button", { name: /New rehearsal/ })
  await expect.poll(() => keyOn(again)).toBe("Space")
  await again.click()
  await expect(startButton(page)).toBeVisible()
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
    await page.fill("input[aria-label='Track 2 name']", "Bass")
    await page.getByRole("button", { name: "Look again" }).click()
    await expect(page.getByText("Still not there")).toBeVisible()
    expect(await callCount(page, "rescan_devices")).toBe(1)
    await expect(box).toContainText("not connected")

    await page.getByRole("button", { name: "Look again" }).click()
    await expect(page.getByText("18 inputs")).toBeVisible()
    await expect(box).toHaveText(/^X18\/XR18/)
    await expect(page.getByRole("button", { name: "Look again" })).toHaveCount(0)
    await expect(page.getByText("Still not there")).toHaveCount(0)
    // A name edited meanwhile is kept, because the band on screen is what
    // gets placed on the desk's inputs.
    await expect(page.locator("input[aria-label='Track 2 name']")).toHaveValue("Bass")
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
})
