import { callCount, calls, expect, openApp, setFake, startButton, test } from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// MIDI on the setup screen: what each track records (Audio, Both or MIDI),
// the port its notes come from, what stops Start, and the check. The fake's
// ports are TD-17 (an e-kit, which plays during a check) and a Launchkey
// (a keyboard, quiet) unless a test lists others.

/** A track's card, counted from 1. */
const card = (page: Page, n: number) => page.locator("[data-track-card]").nth(n - 1)
const modes = (page: Page, n: number) => page.getByRole("group", { name: `Track ${n} records` })
const picker = (page: Page, n: number) => page.getByRole("combobox", { name: `Track ${n} MIDI port` })
const input = (page: Page, n: number) => page.locator(`[aria-label='Track ${n} input']`)
const nameField = (page: Page, n: number) => page.getByRole("textbox", { name: `Track ${n} name` })
const note = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text })

async function setMode(page: Page, n: number, mode: "Audio" | "Both" | "MIDI") {
  await modes(page, n).getByRole("button", { name: mode, exact: true }).click()
}

async function pickPort(page: Page, n: number, port: string) {
  await picker(page, n).click()
  await page.getByRole("option", { name: port }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}

/** Which mode a track's switch shows pressed. */
async function pressed(page: Page, n: number): Promise<string[]> {
  return modes(page, n).locator("button[aria-pressed='true']").allInnerTexts()
}

/** How many lines an element's text takes. */
function lines(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
  })
}

/** Where every card and every control on one stands, to the half pixel. With
 *  `inCard`, the controls are measured from their card's corner. */
function places(page: Page, inCard = false) {
  return page.evaluate((relative) => {
    const box = (el: Element, from?: DOMRect) => {
      const b = el.getBoundingClientRect()
      const at = [b.x - (from?.x ?? 0), b.y - (from?.y ?? 0), b.width, b.height]
      return at.map((v) => Math.round(v * 2) / 2)
    }
    return [...document.querySelectorAll("[data-track-card]")].map((c) => {
      const own = c.getBoundingClientRect()
      return {
        card: relative ? box(c).slice(2) : box(c),
        controls: [
          ...c.querySelectorAll("button, textarea, [role='combobox'], [data-check-slot]"),
        ].map((el) => box(el, relative ? own : undefined)),
      }
    })
  }, inCard)
}

test.describe("setup", () => {
  test("each card says what it records, and its lines follow", async ({ page }) => {
    await openApp(page)
    for (const n of [1, 2]) {
      await expect(modes(page, n).getByRole("button")).toHaveText(["Audio", "Both", "MIDI"])
      expect(await pressed(page, n)).toEqual(["Audio"])
      await expect(picker(page, n)).toHaveCount(0)
    }

    await setMode(page, 1, "Both")
    expect(await pressed(page, 1)).toEqual(["Both"])
    await expect(input(page, 1)).toBeVisible()
    await expect(picker(page, 1)).toBeVisible()
    // The port's line is under the input's.
    const inputBox = (await input(page, 1).boundingBox())!
    const portBox = (await picker(page, 1).boundingBox())!
    expect(portBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height)

    await setMode(page, 1, "MIDI")
    await expect(input(page, 1)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Track 1 in stereo" })).toHaveCount(0)
    await expect(picker(page, 1)).toBeVisible()

    await setMode(page, 1, "Audio")
    await expect(input(page, 1)).toHaveText("Input 1")
    await expect(picker(page, 1)).toHaveCount(0)
    // The other card was never touched.
    await expect(input(page, 2)).toHaveText("Input 2")
  })

  test("Both with ports listed picks none, and Start waits for one (P3)", async ({ page }) => {
    await openApp(page)
    await expect(startButton(page)).toBeEnabled()
    await setMode(page, 1, "Both")
    await expect(picker(page, 1)).toHaveText("No port")
    await expect(startButton(page)).toBeDisabled()
    await expect(
      note(page, "Guitar has no MIDI port yet. Pick one, or set it to Audio.")
    ).toHaveCount(1)
    await setMode(page, 2, "MIDI")
    await expect(
      note(page, "Guitar, Vocals have no MIDI port yet. Pick one, or set them to Audio.")
    ).toHaveCount(1)
    await setMode(page, 2, "Audio")

    await pickPort(page, 1, "TD-17")
    await expect(picker(page, 1)).toHaveText("TD-17")
    await expect(page.getByText("no MIDI port yet")).toHaveCount(0)
    await expect(startButton(page)).toBeEnabled()
  })

  test("two tracks on one port, or none recording sound, stop Start (P2, A1)", async ({ page }) => {
    await openApp(page)
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await setMode(page, 2, "Both")
    await pickPort(page, 2, "TD-17")
    await expect(note(page, "Guitar and Vocals both take notes from TD-17.")).toHaveCount(1)
    await expect(startButton(page)).toBeDisabled()

    await pickPort(page, 2, "Launchkey Mini MK3")
    await expect(page.getByText("both take notes from")).toHaveCount(0)
    await expect(startButton(page)).toBeEnabled()

    await setMode(page, 1, "MIDI")
    await setMode(page, 2, "MIDI")
    await expect(
      note(page, "At least one track has to record sound, so the takes can be heard.")
    ).toHaveCount(1)
    await expect(startButton(page)).toBeDisabled()
  })

  test("a port not plugged in waits, and Start stays on (D7)", async ({ page }) => {
    await openApp(page)
    await nameField(page, 1).fill("Drums")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await expect(card(page, 1).getByText("not connected")).toBeHidden()

    await setFake(page, "__MIDI_GONE__", ["TD-17"])
    // Noticed on its own, within the second the list is read again in.
    await expect(card(page, 1).getByText("not connected", { exact: true })).toBeVisible({
      timeout: 2000,
    })
    await expect(picker(page, 1)).toHaveText("TD-17")
    await expect(picker(page, 1)).toHaveClass(/border-amber/)
    await expect(
      note(page, "“TD-17” is not connected. Drums records its notes from the moment it is plugged in.")
    ).toHaveCount(1)
    await expect(startButton(page)).toBeEnabled()

    // The picker still lists it, marked, with the ports that are there.
    await picker(page, 1).click()
    const options = page.getByRole("option")
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toContainText("TD-17")
    await expect(options.nth(0)).toContainText("not connected")
    await expect(options.nth(1)).toHaveText("Launchkey Mini MK3")
    await page.keyboard.press("Escape")

    // Plugged back in, it is a port like any other again.
    await setFake(page, "__MIDI_GONE__", [])
    await expect(card(page, 1).getByText("not connected", { exact: true })).toBeHidden({
      timeout: 2000,
    })
    await expect(picker(page, 1)).not.toHaveClass(/border-amber/)
    await expect(page.getByText("is not connected.")).toHaveCount(0)
  })

  test("a port another app holds is said so (P5)", async ({ page }) => {
    await openApp(page, { before: "window.__MIDI_BUSY__ = ['TD-17'];" })
    await nameField(page, 1).fill("Drums")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    // Only opening it says it is taken: the check does.
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(note(page, "“TD-17” is in use by another app.")).toHaveCount(1)
    await expect(picker(page, 1)).toHaveClass(/border-amber/)
    await expect(startButton(page)).toBeEnabled()
  })

  test("with no ports the picker says so, and one plugged in shows by itself", async ({ page }) => {
    await openApp(page, { before: "window.__MIDI_PORTS__ = [];" })
    await setMode(page, 1, "Both")
    await expect(picker(page, 1)).toHaveText("No MIDI ports. Plug one in.")
    await picker(page, 1).click()
    const list = page.getByRole("listbox")
    await expect(list).toContainText("No MIDI ports. Plug one in.")
    await expect(list.getByRole("option")).toHaveCount(0)

    // Left open, without a click: the list is read again every second.
    await setFake(page, "__MIDI_PORTS__", ["TD-17"])
    await expect(list.getByRole("option", { name: "TD-17" })).toBeVisible({ timeout: 2000 })
    await expect(list).not.toContainText("No MIDI ports")
    await list.getByRole("option", { name: "TD-17" }).click()
    await expect(picker(page, 1)).toHaveText("TD-17")
  })

  test("a new track records Audio, and the template keeps each mode and port", async ({ page }) => {
    await openApp(page)
    await page.getByRole("button", { name: "Add track" }).click()
    expect(await pressed(page, 3)).toEqual(["Audio"])
    await expect(picker(page, 3)).toHaveCount(0)
    await nameField(page, 3).fill("Keys")

    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await setMode(page, 3, "MIDI")
    await pickPort(page, 3, "Launchkey Mini MK3")
    await page.getByRole("button", { name: "Save as template" }).click()
    const saved = (await calls(page, "save_default_tracks")).at(-1)?.args[0] as {
      tracks: { name: string; mode?: string; midi_port?: Record<string, string> | null }[]
    }
    expect(saved.tracks.map((t) => [t.name, t.mode ?? "audio", t.midi_port?.name ?? null])).toEqual([
      ["Guitar", "both", "TD-17"],
      ["Vocals", "audio", null],
      ["Keys", "midi", "Launchkey Mini MK3"],
    ])
    // The port as the system describes it, which finds it again when its
    // name changes (P1), and nothing that is only the check's.
    expect(Object.keys(saved.tracks[0].midi_port!).sort()).toEqual(["device", "id", "maker", "name"])
  })

  test("Start hands the check's ports to the rehearsal, with each track's mode", async ({
    page,
  }) => {
    await openApp(page)
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    await startButton(page).click()
    await expect(page.getByRole("button", { name: /Record take 1/ })).toBeVisible()

    const log = await page.evaluate(() =>
      (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__
    )
    const started = log.findIndex((c) => c.name === "start_rehearsal")
    const stopped = log.slice(0, started).filter((c) => c.name === "stop_monitor").at(-1)
    expect(stopped?.args[0]).toBe(true)
    const tracks = log[started].args[3] as { name: string; mode?: string; midi_port?: { name: string } }[]
    expect(tracks.map((t) => [t.name, t.mode ?? "audio", t.midi_port?.name ?? null])).toEqual([
      ["Guitar", "both", "TD-17"],
      ["Vocals", "audio", null],
    ])
  })

  test("Look again keeps each track's mode and port", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 })
    await openApp(page, { before: "window.__PLUGGED_IN_LATE__ = true;" })
    await setMode(page, 2, "MIDI")
    await pickPort(page, 2, "Launchkey Mini MK3")
    await page.getByRole("button", { name: "Look again" }).click()
    await expect(page.getByText("Still not there")).toBeVisible()
    const band = (await calls(page, "load_default_tracks")).at(-1)?.args[0] as {
      name: string
      mode?: string
      midi_port?: { name: string } | null
    }[]
    expect(band.map((t) => [t.name, t.mode ?? "audio", t.midi_port?.name ?? null])).toEqual([
      ["Guitar", "audio", null],
      ["Vocals", "midi", "Launchkey Mini MK3"],
    ])
    expect(await pressed(page, 2)).toEqual(["MIDI"])
    await expect(picker(page, 2)).toHaveText("Launchkey Mini MK3")
  })

  test.describe("the check", () => {
    test("says when a port's notes arrive", async ({ page }) => {
      await openApp(page)
      // The kit plays during a check; nobody plays the keyboard.
      await nameField(page, 1).fill("Drums")
      await setMode(page, 1, "Both")
      await pickPort(page, 1, "TD-17")
      await nameField(page, 2).fill("Keys")
      await setMode(page, 2, "MIDI")
      await pickPort(page, 2, "Launchkey Mini MK3")
      const kit = card(page, 1).locator("[data-check-slot='notes']")
      const keys = card(page, 2).locator("[data-check-slot='notes']")
      await expect(kit.getByText("no notes")).toBeHidden()
      await expect(keys.getByText("no notes")).toBeHidden()

      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(kit.getByText("✓ notes")).toBeVisible({ timeout: 3000 })
      await expect(kit.getByText("no notes")).toHaveCount(0)
      await expect(keys.getByText("no notes")).toBeVisible()
      await expect(keys.getByText("✓ notes")).toHaveCount(0)

      await page.getByRole("button", { name: "Stop checking" }).click()
      await expect(kit.getByText("✓ notes")).toBeHidden()
      await expect(keys.getByText("no notes")).toBeHidden()
    })

    test("asks whether one instrument is plugged in twice (P8)", async ({ page }) => {
      await openApp(page, { before: "window.__MIDI_ECHO__ = ['Synth', 'Keys'];" })
      await nameField(page, 1).fill("Synth")
      await nameField(page, 2).fill("Keys")
      await setMode(page, 1, "Both")
      await pickPort(page, 1, "TD-17")
      await setMode(page, 2, "Both")
      await pickPort(page, 2, "Launchkey Mini MK3")
      await page.getByRole("button", { name: "Check signal" }).click()
      // Above the cards, with the other notes: its words name both tracks.
      const said = "Keys gets the same notes as Synth. Is it one instrument plugged in twice?"
      await expect(note(page, said)).toBeVisible({ timeout: 3000 })
      await expect(page.locator("[data-track-card]").getByText("gets the same notes")).toHaveCount(0)
      // It warns and stops nothing.
      await expect(startButton(page)).toBeEnabled()
    })

    test("the question moves no card while it is the only note (P8)", async ({ page }) => {
      await page.setViewportSize({ width: 960, height: 900 })
      const ports = [
        "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub",
        "TD-17 with the long name of the second port here",
      ]
      await openApp(page, {
        before: `window.__MIDI_ECHO__ = ['Synth', 'Keys']; window.__MIDI_PORTS__ = ${JSON.stringify(ports)};`,
      })
      await nameField(page, 1).fill("Synth")
      await nameField(page, 2).fill("Keys")
      await setMode(page, 1, "Both")
      await pickPort(page, 1, ports[0])
      await setMode(page, 2, "Both")
      await pickPort(page, 2, ports[1])
      await page.mouse.move(0, 0)
      const before = await places(page)

      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(note(page, "Keys gets the same notes as Synth.")).toBeVisible({ timeout: 3000 })
      expect(await places(page)).toEqual(before)
    })

    test("says nothing of a port picked after it began", async ({ page }) => {
      await openApp(page)
      await nameField(page, 1).fill("Drums")
      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
      // The kit plays from now on, to a check that never opened its port.
      await setMode(page, 1, "Both")
      await pickPort(page, 1, "TD-17")
      const slot = card(page, 1).locator("[data-check-slot='notes']")
      await page.waitForTimeout(1500)
      await expect(slot.getByText("no notes")).toBeHidden()
      await expect(slot.getByText("✓ notes")).toBeHidden()

      // The next check opens it, and says so.
      await page.getByRole("button", { name: "Stop checking" }).click()
      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(slot.getByText("✓ notes")).toBeVisible({ timeout: 3000 })
    })

    test("lists a keyboard's playing port first, and marks the one played (P7)", async ({
      page,
    }) => {
      await openApp(page, {
        before:
          "window.__MIDI_PORTS__ = ['Launchkey Mini MK3 DAW Port', 'Launchkey Mini MK3 MIDI Port'];" +
          "window.__MIDI_PLAYED__ = ['Launchkey Mini MK3 MIDI Port'];",
      })
      await nameField(page, 1).fill("Keys")
      await setMode(page, 1, "Both")
      await picker(page, 1).click()
      await expect(page.getByRole("option")).toHaveText([
        "Launchkey Mini MK3 MIDI Port",
        "Launchkey Mini MK3 DAW Port",
      ])
      // Picked wrong, as anyone would by the name: the check shows which.
      await page.getByRole("option", { name: "Launchkey Mini MK3 DAW Port" }).click()
      await page.getByRole("button", { name: "Check signal" }).click()
      await picker(page, 1).click()
      const midiPort = page.getByRole("option", { name: /MIDI Port/ })
      const dawPort = page.getByRole("option", { name: /DAW Port/ })
      await expect(midiPort).toContainText("✓ notes", { timeout: 3000 })
      await expect(dawPort).not.toContainText("✓ notes")
    })
  })

  test("nothing moves when the check starts and stops, or a port goes and comes back", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__MONITOR_LEVELS__ = {Drums: [0.62], Vocals: [0.0004]};" })
    await nameField(page, 1).fill("Drums")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await page.mouse.move(0, 0)
    const before = await places(page)

    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(card(page, 1).getByText("✓ notes")).toBeVisible({ timeout: 3000 })
    await expect(card(page, 1).getByText("signal", { exact: true })).toBeVisible()
    expect(await places(page)).toEqual(before)
    await page.getByRole("button", { name: "Stop checking" }).click()
    await expect(card(page, 1).getByText("✓ notes")).toBeHidden()
    expect(await places(page)).toEqual(before)

    // The note above the cards says it is gone, in a place kept for one note
    // while any track takes notes: no card moves for it.
    await setFake(page, "__MIDI_GONE__", ["TD-17"])
    await expect(card(page, 1).getByText("not connected", { exact: true })).toBeVisible({
      timeout: 2000,
    })
    await expect(note(page, "“TD-17” is not connected.")).toHaveCount(1)
    expect(await places(page)).toEqual(before)
    await setFake(page, "__MIDI_GONE__", [])
    await expect(card(page, 1).getByText("not connected", { exact: true })).toBeHidden({
      timeout: 2000,
    })
    await expect(note(page, "is not connected.")).toHaveCount(0)
    expect(await places(page)).toEqual(before)
  })

  test("two tracks on one port move no card either (P2)", async ({ page }) => {
    // Two kits whose names take the same room, so that only the note can
    // move anything: a picker is as wide as the port it shows.
    await openApp(page, { before: "window.__MIDI_PORTS__ = ['TD-17', 'TD-71'];" })
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await setMode(page, 2, "Both")
    await pickPort(page, 2, "TD-71")
    await page.mouse.move(0, 0)
    const cards = async () => (await places(page)).map((c) => c.card)
    const before = await cards()

    await pickPort(page, 2, "TD-17")
    await expect(note(page, "Guitar and Vocals both take notes from TD-17.")).toHaveCount(1)
    expect(await cards()).toEqual(before)
    await pickPort(page, 2, "TD-71")
    await expect(page.getByText("both take notes from")).toHaveCount(0)
    expect(await cards()).toEqual(before)
  })

  test("a second notes track leaves a card's port as wide as it was", async ({ page }) => {
    // At 1180 px, where Last time takes the side and the cards are narrower.
    await page.setViewportSize({ width: 1180, height: 900 })
    const port = "Launchkey Mini MK3 MIDI Port"
    await openApp(page, { before: `window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];` })
    await nameField(page, 2).fill("Keys")
    await setMode(page, 2, "MIDI")
    await pickPort(page, 2, port)
    expect(await lines(picker(page, 2).getByText(port))).toBe(1)
    const alone = await card(page, 2).boundingBox()
    const pickerAlone = await picker(page, 2).boundingBox()

    await nameField(page, 1).fill("Drums")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    expect(await lines(picker(page, 2).getByText(port))).toBe(1)
    expect((await card(page, 2).boundingBox())!.height).toBe(alone!.height)
    expect((await picker(page, 2).boundingBox())!.width).toBe(pickerAlone!.width)
  })

  test("a band without MIDI reads no ports, and the first Both reads them at once", async ({
    page,
  }) => {
    await openApp(page)
    await expect(input(page, 2)).toHaveText("Input 2")
    await page.waitForTimeout(1500)
    expect(await callCount(page, "list_midi_ports")).toBe(0)
    // Nor keeps a place for notes it will never have.
    await expect(page.locator("[data-notes-strip]")).toHaveCount(0)

    await setMode(page, 1, "Both")
    await expect.poll(() => callCount(page, "list_midi_ports"), { timeout: 500 }).toBeGreaterThan(0)
    await picker(page, 1).click()
    await expect(page.getByRole("option", { name: "TD-17" })).toBeVisible()
    await page.keyboard.press("Escape")

    // Back to sound alone, it stops reading them.
    await setMode(page, 1, "Audio")
    await page.waitForTimeout(300)
    const read = await callCount(page, "list_midi_ports")
    await page.waitForTimeout(1500)
    expect(await callCount(page, "list_midi_ports")).toBe(read)
  })

  test("Enter in a name stays in it, and Space types a space", async ({ page }) => {
    await openApp(page)
    const field = nameField(page, 2)
    await field.fill("Vocals two")
    await field.press("Enter")
    await expect(field).toBeFocused()
    await page.keyboard.press("Space")
    await expect(field).toHaveValue("Vocals two ")
    expect(await callCount(page, "start_rehearsal")).toBe(0)
  })

  test("a Start that fails lets the check's ports go", async ({ page }) => {
    // Python answers that it could not start, as it does when the card has
    // gone since.
    await openApp(page, {
      after:
        "window.pywebview.api.start_rehearsal = async (...args) => {" +
        " window.__CALLS__.push({name: 'start_rehearsal', args});" +
        " return {ok: false, error: 'No room left'} };",
    })
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
    await startButton(page).click()
    await expect(page.getByText("No room left")).toBeVisible()

    // Kept open for the rehearsal, then let go when there was none.
    const log = await page.evaluate(() =>
      (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__
    )
    const started = log.findIndex((c) => c.name === "start_rehearsal")
    const kept = log.slice(0, started).filter((c) => c.name === "stop_monitor").at(-1)
    expect(kept?.args[0]).toBe(true)
    const after = log.slice(started).filter((c) => c.name === "stop_monitor")
    expect(after).toHaveLength(1)
    expect(after[0].args[0]).toBeUndefined()
    await expect(page.getByRole("button", { name: "Check signal" })).toBeVisible()
  })

  test("long names wrap at 960 px, and nothing is cut (D5)", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 900 })
    const port = "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub"
    await openApp(page, { before: `window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];` })
    const name = "Overheads left and right microphones"
    await nameField(page, 1).fill(name)
    await setMode(page, 1, "Both")
    await pickPort(page, 1, port)
    await expect(nameField(page, 1)).toHaveValue(name)
    await expect(picker(page, 1)).toHaveText(port)
    expect(await lines(picker(page, 1).getByText(port))).toBe(2)

    // A name longer than its line goes onto a second one and the card grows.
    const field = nameField(page, 1)
    const oneLine = (await field.boundingBox())!.height
    await field.fill(`${name}, and the room microphone by the door of the rehearsal room`)
    await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5)

    await picker(page, 1).click()
    const option = page.getByRole("option", { name: port })
    await expect(option).toBeVisible()
    expect(await lines(option.getByText(port))).toBe(2)

    const cut = await page.evaluate(() =>
      [...document.querySelectorAll("[data-track-card] *, [role='listbox'] *")]
        .filter((el) => {
          const style = getComputedStyle(el)
          return el.scrollWidth > el.clientWidth || style.textOverflow === "ellipsis"
        })
        .map((el) => `${el.tagName} ${el.className}`)
    )
    expect(cut).toEqual([])
  })

  test("the disk estimate counts the audio channels only", async ({ page }) => {
    await openApp(page)
    await expect.poll(async () => (await calls(page, "disk_estimate")).at(-1)?.args[0]).toBe(2)
    await setMode(page, 1, "MIDI")
    await expect.poll(async () => (await calls(page, "disk_estimate")).at(-1)?.args[0]).toBe(1)
    await setMode(page, 1, "Both")
    await expect.poll(async () => (await calls(page, "disk_estimate")).at(-1)?.args[0]).toBe(2)
    expect(await callCount(page, "disk_estimate")).toBeGreaterThanOrEqual(3)
  })
})
