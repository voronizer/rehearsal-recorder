import { callCount, calls, expect, notices, openApp, setFake, startButton, test } from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// MIDI on the setup screen: what each track records (Audio, Both or MIDI),
// the port its notes come from, what stops Start, and the check. The fake's
// ports are TD-17 (an e-kit, which plays during a check) and a Launchkey
// (a keyboard, quiet) unless a test lists others.

/** A track's row, counted from 1. */
const row = (page: Page, n: number) => page.locator("[data-track-row]").nth(n - 1)
const modes = (page: Page, n: number) => page.getByRole("radiogroup", { name: `Track ${n} records` })
const picker = (page: Page, n: number) => page.getByRole("combobox", { name: `Track ${n} MIDI port` })
const input = (page: Page, n: number) => page.locator(`[aria-label='Track ${n} input']`)
const nameField = (page: Page, n: number) => page.getByRole("textbox", { name: `Track ${n} name` })
const note = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text })
/** What a track's own line says of its port, beside the picker. */
const portNote = (page: Page, n: number) => row(page, n).locator("[data-port-note]")

async function setMode(page: Page, n: number, mode: "Audio" | "Both" | "MIDI") {
  await modes(page, n).getByRole("radio", { name: mode, exact: true }).click()
}

async function pickPort(page: Page, n: number, port: string) {
  await picker(page, n).click()
  await page.getByRole("option", { name: port }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}

/** Which mode a track's switch shows chosen. */
async function pressed(page: Page, n: number): Promise<string[]> {
  return modes(page, n).locator("[aria-checked='true']").allInnerTexts()
}

/** A colour, as the browser draws it for text. */
const textColour = (page: Page, colour: string) =>
  page.evaluate((c) => {
    const probe = document.createElement("i")
    probe.style.color = c
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, colour)

/** How many lines an element's text takes. */
function lines(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
  })
}

/**
 * Whether `words`, somewhere in the element's text, are all on show: inside
 * every box round them that cuts off what overflows it, a line clamp's too.
 */
function shown(el: Locator, words: string): Promise<boolean> {
  return el.evaluate((node, w) => {
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const at = t.textContent!.indexOf(w)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(t, at)
      range.setEnd(t, at + w.length)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0)
      for (let box = t.parentElement; box && box !== node.parentElement; box = box.parentElement) {
        if (getComputedStyle(box).overflow === "visible") continue
        const b = box.getBoundingClientRect()
        const out = (r: DOMRect) =>
          r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5
        if (rects.some(out)) return false
      }
      return rects.length > 0
    }
    return false
  }, words)
}

/** Where every row and every control on one stands, to the half pixel, each
 *  control by its name. With `inRow`, the controls are measured from their
 *  row's corner. */
function places(page: Page, inRow = false) {
  return page.evaluate((relative) => {
    const box = (el: Element, from?: DOMRect) => {
      const b = el.getBoundingClientRect()
      const at = [b.x - (from?.x ?? 0), b.y - (from?.y ?? 0), b.width, b.height]
      return at.map((v) => Math.round(v * 2) / 2)
    }
    return [...document.querySelectorAll("[data-track-row]")].map((c) => {
      const own = c.getBoundingClientRect()
      const controls = [
        ...c.querySelectorAll<HTMLElement>("button, textarea, [role='combobox'], [data-check-slot]"),
      ]
      return {
        row: relative ? box(c).slice(2) : box(c),
        controls: Object.fromEntries(
          controls.map((el) => [
            el.getAttribute("aria-label") ?? el.dataset.checkSlot ?? el.textContent,
            box(el, relative ? own : undefined),
          ])
        ),
      }
    })
  }, inRow)
}

/** `places` with row `n`'s notes slot gone: a note about its port takes the
 *  slot's room. Everything else stays where it was. */
function slotGone(at: Awaited<ReturnType<typeof places>>, n: number) {
  return at.map((c, i) =>
    i === n - 1
      ? { ...c, controls: Object.fromEntries(Object.entries(c.controls).filter(([k]) => k !== "notes")) }
      : c
  )
}

test.describe("setup", () => {
  test("each row says what it records, and its lines follow", async ({ page }) => {
    await openApp(page)
    for (const n of [1, 2]) {
      await expect(modes(page, n).getByRole("radio")).toHaveText(["Audio", "Both", "MIDI"])
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
    // The other row was never touched.
    await expect(input(page, 2)).toHaveText("Input 2")
  })

  test("Both with ports listed picks none, and Start waits for one (P3)", async ({ page }) => {
    await openApp(page)
    await expect(startButton(page)).toBeEnabled()
    await setMode(page, 1, "Both")
    await expect(picker(page, 1)).toHaveText("No port")
    await expect(startButton(page)).toBeDisabled()
    // Said in the track's own line, beside the picker it is about.
    await expect(portNote(page, 1)).toHaveText("Pick a port, or set it to Audio.")
    await setMode(page, 2, "MIDI")
    await expect(portNote(page, 1)).toHaveText("Pick a port, or set it to Audio.")
    await expect(portNote(page, 2)).toHaveText("Pick a port, or set it to Audio.")
    await setMode(page, 2, "Audio")
    await expect(portNote(page, 2)).toHaveCount(0)

    await pickPort(page, 1, "TD-17")
    await expect(picker(page, 1)).toHaveText("TD-17")
    await expect(page.getByText("Pick a port")).toHaveCount(0)
    await expect(startButton(page)).toBeEnabled()
  })

  test("two tracks on one port, or none recording sound, stop Start (P2, A1)", async ({ page }) => {
    await openApp(page)
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await setMode(page, 2, "Both")
    await pickPort(page, 2, "TD-17")
    // Each says it of the other, in its own line.
    await expect(portNote(page, 1)).toHaveText("Vocals takes notes from this port too.")
    await expect(portNote(page, 2)).toHaveText("Guitar takes notes from this port too.")
    await expect(startButton(page)).toBeDisabled()

    await pickPort(page, 2, "Launchkey Mini MK3")
    await expect(page.getByText("takes notes from this port too")).toHaveCount(0)
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
    await expect(portNote(page, 1)).toHaveCount(0)

    await setFake(page, "__MIDI_GONE__", ["TD-17"])
    // Noticed on its own, within the second the list is read again in, and
    // said in the track's own line.
    await expect(portNote(page, 1)).toHaveText(
      "Not connected. Records its notes from the moment it is plugged in.",
      { timeout: 2000 }
    )
    await expect(picker(page, 1)).toHaveText("TD-17")
    await expect(picker(page, 1)).toHaveClass(/border-warn/)
    await expect(note(page, "Not connected.")).toHaveCount(1)
    await expect(startButton(page)).toBeEnabled()

    // The picker still lists it, marked, with the ports that are there.
    await picker(page, 1).click()
    const options = page.getByRole("option")
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toContainText("TD-17")
    // In the quiet look every status has: small, and grey.
    const status = options.nth(0).getByText("Not connected", { exact: true })
    await expect(status).toHaveCSS("font-size", "12px")
    await expect(status).toHaveCSS("color", await textColour(page, "var(--muted-foreground)"))
    await expect(options.nth(1)).toHaveText("Launchkey Mini MK3")
    await page.keyboard.press("Escape")

    // Plugged back in, it is a port like any other again.
    await setFake(page, "__MIDI_GONE__", [])
    await expect(portNote(page, 1)).toHaveCount(0, { timeout: 2000 })
    await expect(picker(page, 1)).not.toHaveClass(/border-warn/)
    await expect(note(page, "Not connected.")).toHaveCount(0)
  })

  test("a port another app holds is said so (P5)", async ({ page }) => {
    await openApp(page, { before: "window.__MIDI_BUSY__ = ['TD-17'];" })
    await nameField(page, 1).fill("Drums")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    // Only opening it says it is taken: the check does.
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(portNote(page, 1)).toHaveText(
      "In use by another app. Records its notes from the moment it is free."
    )
    await expect(picker(page, 1)).toHaveClass(/border-warn/)
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

  test("a new track records Audio, and Update keeps each mode and port", async ({ page }) => {
    await openApp(page)
    await page.getByRole("button", { name: "Add track" }).click()
    expect(await pressed(page, 3)).toEqual(["Audio"])
    await expect(picker(page, 3)).toHaveCount(0)
    await nameField(page, 3).fill("Keys")

    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await setMode(page, 3, "MIDI")
    await pickPort(page, 3, "Launchkey Mini MK3")
    await page.getByRole("button", { name: "Update", exact: true }).click()
    const saved = (await calls(page, "update_lineup")).at(-1)?.args[2] as {
      name: string
      mode?: string
      midi_port?: Record<string, string> | null
    }[]
    expect(saved.map((t) => [t.name, t.mode ?? "audio", t.midi_port?.name ?? null])).toEqual([
      ["Guitar", "both", "TD-17"],
      ["Vocals", "audio", null],
      ["Keys", "midi", "Launchkey Mini MK3"],
    ])
    // The port as the system describes it, which finds it again when its
    // name changes (P1), and nothing that is only the check's.
    expect(Object.keys(saved[0].midi_port!).sort()).toEqual(["device", "id", "maker", "name"])
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
      const kit = row(page, 1).locator("[data-check-slot='notes']")
      const keys = row(page, 2).locator("[data-check-slot='notes']")
      await expect(kit.getByText("no notes")).toBeHidden()
      await expect(keys.getByText("no notes")).toBeHidden()

      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(kit.getByText("notes", { exact: true })).toBeVisible({ timeout: 3000 })
      await expect(kit.getByText("no notes")).toHaveCount(0)
      await expect(keys.getByText("no notes")).toBeVisible()
      await expect(keys.getByText("notes", { exact: true })).toHaveCount(0)

      await page.getByRole("button", { name: "Stop checking" }).click()
      await expect(kit.getByText("notes", { exact: true })).toBeHidden()
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
      // In the line of the track that gets the other's notes, naming it.
      await expect(portNote(page, 2)).toHaveText("Same notes as Synth. Plugged in twice?", {
        timeout: 3000,
      })
      await expect(portNote(page, 1)).toHaveCount(0)
      // It warns and stops nothing.
      await expect(startButton(page)).toBeEnabled()
    })

    test("the question goes when the other track stops taking notes during it (P8)", async ({
      page,
    }) => {
      await openApp(page, { before: "window.__MIDI_ECHO__ = ['Synth', 'Keys'];" })
      await nameField(page, 1).fill("Synth")
      await nameField(page, 2).fill("Keys")
      await setMode(page, 1, "Both")
      await pickPort(page, 1, "TD-17")
      await setMode(page, 2, "Both")
      await pickPort(page, 2, "Launchkey Mini MK3")
      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(note(page, "Same notes as Synth.")).toBeVisible({ timeout: 3000 })
      // Synth records sound alone now: there is nothing left to ask about it.
      await setMode(page, 1, "Audio")
      await expect(note(page, "Same notes as")).toHaveCount(0)
    })

    test("the question moves no row while it is the only note (P8)", async ({ page }) => {
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
      await expect(note(page, "Same notes as Synth.")).toBeVisible({ timeout: 3000 })
      expect(await places(page)).toEqual(slotGone(before, 2))
    })

    test("a track named again during it keeps what it heard, said in the new names (P8)", async ({
      page,
    }) => {
      // At 960 px, with the kit's long first name: the question names the
      // tracks as they are called now.
      await page.setViewportSize({ width: 960, height: 900 })
      const kit =
        "Drums and pads (Kastuś), the kit by the window, with its second snare and both cowbells"
      await openApp(page, { before: "window.__MIDI_PLAYED__ = ['TD-17'];" })
      await nameField(page, 1).fill(kit)
      await setMode(page, 1, "Both")
      await pickPort(page, 1, "TD-17")
      await nameField(page, 2).fill("Keys")
      await setMode(page, 2, "Both")
      await pickPort(page, 2, "Launchkey Mini MK3")
      await page.getByRole("button", { name: "Check signal" }).click()
      const kitSlot = row(page, 1).locator("[data-check-slot='notes']")
      const keysSlot = row(page, 2).locator("[data-check-slot='notes']")
      await expect(kitSlot.getByText("notes", { exact: true })).toBeVisible({ timeout: 3000 })
      await expect(keysSlot.getByText("no notes")).toBeVisible()

      // Each slot goes on saying what its port sent, under any name.
      await nameField(page, 1).fill("Kit")
      await nameField(page, 2).fill("Pad")
      await expect(kitSlot.getByText("notes", { exact: true })).toBeVisible()
      await expect(keysSlot.getByText("no notes")).toBeVisible()
      await page.mouse.move(0, 0)
      const before = await places(page)

      // The question then comes by itself, in Pad's line, moving no row,
      // and in the names the tracks have now.
      await setFake(page, "__MIDI_ECHO__", [kit, "Keys"])
      await expect(portNote(page, 2)).toBeVisible({ timeout: 3000 })
      expect(await places(page)).toEqual(slotGone(before, 2))
      await expect(portNote(page, 2)).toHaveText("Same notes as Kit. Plugged in twice?")
      // A name taken away reads as it does in every other note.
      await nameField(page, 1).fill("")
      await expect(portNote(page, 2)).toHaveText("Same notes as An unnamed track. Plugged in twice?")
    })

    test("a track taken out during it leaves what it heard from the others", async ({ page }) => {
      await openApp(page)
      await nameField(page, 2).fill("Drums")
      await setMode(page, 2, "Both")
      await pickPort(page, 2, "TD-17")
      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(row(page, 2).getByText("notes", { exact: true })).toBeVisible({ timeout: 3000 })
      // The kit's row is the first now, and still says what its port sent.
      await page.getByRole("button", { name: "Remove track Guitar" }).click()
      await expect(page.locator("[data-track-row]")).toHaveCount(1)
      await expect(row(page, 1).getByText("notes", { exact: true })).toBeVisible()
    })

    test("says nothing of a port picked after it began", async ({ page }) => {
      await openApp(page)
      await nameField(page, 1).fill("Drums")
      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
      // The kit plays from now on, to a check that never opened its port.
      await setMode(page, 1, "Both")
      await pickPort(page, 1, "TD-17")
      const slot = row(page, 1).locator("[data-check-slot='notes']")
      await page.waitForTimeout(1500)
      await expect(slot.getByText("no notes")).toBeHidden()
      await expect(slot.getByText("notes", { exact: true })).toBeHidden()

      // The next check opens it, and says so.
      await page.getByRole("button", { name: "Stop checking" }).click()
      await page.getByRole("button", { name: "Check signal" }).click()
      await expect(slot.getByText("notes", { exact: true })).toBeVisible({ timeout: 3000 })
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
      await expect(midiPort.getByText("notes", { exact: true })).toBeVisible({ timeout: 3000 })
      await expect(dawPort).not.toContainText("notes")
      // Grey, in the text's colour: notes are not the accent.
      await expect(midiPort.getByText("notes", { exact: true })).toHaveClass(/text-foreground/)
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
    await expect(row(page, 1).getByText("notes", { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(row(page, 1).getByText("signal", { exact: true })).toBeVisible()
    expect(await places(page)).toEqual(before)
    await page.getByRole("button", { name: "Stop checking" }).click()
    await expect(row(page, 1).getByText("notes", { exact: true })).toBeHidden()
    expect(await places(page)).toEqual(before)

    // The note in the track's own line says it is gone, in the room of the
    // notes slot it takes: no row moves for it.
    await setFake(page, "__MIDI_GONE__", ["TD-17"])
    await expect(portNote(page, 1)).toHaveText(
      "Not connected. Records its notes from the moment it is plugged in.",
      { timeout: 2000 }
    )
    expect(await places(page)).toEqual(slotGone(before, 1))
    await setFake(page, "__MIDI_GONE__", [])
    await expect(portNote(page, 1)).toHaveCount(0, { timeout: 2000 })
    expect(await places(page)).toEqual(before)
  })

  test("a long note alone moves no row either, with D5's names at 960 px (D7, P8)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 900 })
    const port = "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub"
    const overheads = "Overheads left and right microphones"
    const kit = "Drums and pads (Kastuś), the kit by the window"
    await openApp(page, {
      before:
        `window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];` +
        `window.__MIDI_ECHO__ = ${JSON.stringify([kit, overheads])};`,
    })
    await nameField(page, 1).fill(overheads)
    await setMode(page, 1, "Both")
    await pickPort(page, 1, port)
    await nameField(page, 2).fill(kit)
    await setMode(page, 2, "Both")
    await pickPort(page, 2, "TD-17")
    await page.mouse.move(0, 0)
    const before = await places(page)

    // Each of these comes by itself, beside a port name that takes two lines.
    const gone = portNote(page, 1).filter({ hasText: "Not connected." })
    await setFake(page, "__MIDI_GONE__", [port])
    await expect(gone).toBeVisible({ timeout: 2000 })
    expect(await places(page)).toEqual(slotGone(before, 1))
    await setFake(page, "__MIDI_GONE__", [])
    await expect(gone).toHaveCount(0, { timeout: 2000 })
    expect(await places(page)).toEqual(before)

    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(portNote(page, 1)).toHaveText(`Same notes as ${kit}. Plugged in twice?`, {
      timeout: 3000,
    })
    expect(await places(page)).toEqual(slotGone(before, 1))
  })

  test("a note beside a long port name keeps to two lines in the narrowest rows (D7)", async ({
    page,
  }) => {
    // Just wide enough for Last time beside the setup: the rows are at their
    // narrowest. The picker leaves the note room for two lines of its words.
    await page.setViewportSize({ width: 1100, height: 900 })
    const port = "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub"
    await openApp(page, { before: `window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];` })
    await nameField(page, 1).fill("Keys")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, port)
    await page.mouse.move(0, 0)
    const before = await places(page)

    for (const [fake, words] of [
      ["__MIDI_GONE__", "Not connected. Records its notes from the moment it is plugged in."],
      ["__MIDI_BUSY__", "In use by another app. Records its notes from the moment it is free."],
    ] as const) {
      await setFake(page, fake, [port])
      if (fake === "__MIDI_BUSY__") await page.getByRole("button", { name: "Check signal" }).click()
      await expect(portNote(page, 1)).toHaveText(words, { timeout: 3000 })
      // Whole, in two lines at most, and nothing moved for it.
      await expect(portNote(page, 1).locator("[data-cut]")).toHaveCount(0)
      expect(await lines(portNote(page, 1).getByText(words))).toBeLessThanOrEqual(2)
      expect(await places(page), words).toEqual(slotGone(before, 1))
      await setFake(page, fake, [])
      if (fake === "__MIDI_BUSY__") await page.getByRole("button", { name: "Stop checking" }).click()
      await expect(portNote(page, 1)).toHaveCount(0, { timeout: 3000 })
    }
  })

  test("a question naming a long-named track moves no row, and is whole in its tip (P8)", async ({
    page,
  }) => {
    // Beside Last time, a long name in the question, beside a long port.
    const ports = [
      "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub",
      "TD-17 with the long name of the second port here",
    ]
    const kit = "Drums and pads (Kastuś), the kit by the window, with its second snare and both cowbells"
    await openApp(page, { before: `window.__MIDI_PORTS__ = ${JSON.stringify(ports)};` })
    await nameField(page, 1).fill(kit)
    await setMode(page, 1, "Both")
    await pickPort(page, 1, ports[0])
    await nameField(page, 2).fill("Keys")
    await setMode(page, 2, "Both")
    await pickPort(page, 2, ports[1])
    await page.getByRole("button", { name: "Check signal" }).click()
    await expect(row(page, 2).locator("[data-check-slot='notes']").getByText("no notes")).toBeVisible({
      timeout: 3000,
    })
    await page.mouse.move(0, 0)
    const before = await places(page)

    await setFake(page, "__MIDI_ECHO__", [kit, "Keys"])
    const question = `Same notes as ${kit}. Plugged in twice?`
    // Read whole; shown in the two lines the picker's height has room for.
    await expect(portNote(page, 2)).toHaveText(question, { timeout: 3000 })
    expect(await places(page)).toEqual(slotGone(before, 2))
    // The name gives way inside the sentence; the question's own words do not.
    expect(await shown(portNote(page, 2), "Same notes as")).toBe(true)
    expect(await shown(portNote(page, 2), "Plugged in twice?")).toBe(true)
    const words = portNote(page, 2).locator("[data-cut]")
    await expect(words).toHaveCount(1)
    // Whole in its tip, under the pointer and on keyboard focus. The open
    // tip: one that has just closed fades out for 220 ms beside the next.
    // Gone means every tip, a fading one too.
    const tip = page.locator("[data-whole][data-state$='open']")
    const tips = page.locator("[data-whole]")
    await words.hover()
    await expect(tip).toHaveText(question)
    await page.mouse.move(0, 0, { steps: 8 })
    await expect(tips).toHaveCount(0)
    await picker(page, 2).focus()
    await page.keyboard.press("Tab")
    await expect(portNote(page, 2)).toBeFocused()
    await expect(tip).toHaveText(question)
  })

  test("a long name on the same port gives way in the note, and its words do not (P2)", async ({
    page,
  }) => {
    // The narrowest rows, beside a long port: the note has the least room.
    await page.setViewportSize({ width: 1100, height: 900 })
    const port = "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub"
    const kit = "Drums and pads (Kastuś), the kit by the window, with its second snare and both cowbells"
    await openApp(page, { before: `window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];` })
    await nameField(page, 1).fill("Kit")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, port)
    await nameField(page, 2).fill("Keys")
    await setMode(page, 2, "Both")
    await pickPort(page, 2, port)
    await expect(portNote(page, 2)).toHaveText("Kit takes notes from this port too.")
    await page.mouse.move(0, 0)
    const keys = async () => (await places(page, true))[1]
    const before = await keys()

    // The kit named at length: the keys' note says so, and its row stays.
    await nameField(page, 1).fill(kit)
    const line = `${kit} takes notes from this port too.`
    await expect(portNote(page, 2)).toHaveText(line)
    await page.mouse.move(0, 0)
    expect(await shown(portNote(page, 2), "takes notes from this port too.")).toBe(true)
    expect(await keys()).toEqual(before)
    // Whole in its tip: the open one.
    await portNote(page, 2).locator("[data-cut]").hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(line)
  })

  test("two tracks on one port move no row either (P2)", async ({ page }) => {
    // Two kits whose names take the same room, so that only the note can
    // move anything: a picker is as wide as the port it shows.
    await openApp(page, { before: "window.__MIDI_PORTS__ = ['TD-17', 'TD-71'];" })
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    await setMode(page, 2, "Both")
    await pickPort(page, 2, "TD-71")
    await page.mouse.move(0, 0)
    const rows = async () => (await places(page)).map((c) => c.row)
    const before = await rows()

    await pickPort(page, 2, "TD-17")
    await expect(portNote(page, 2)).toHaveText("Guitar takes notes from this port too.")
    expect(await rows()).toEqual(before)
    await pickPort(page, 2, "TD-71")
    await expect(page.getByText("takes notes from this port too")).toHaveCount(0)
    expect(await rows()).toEqual(before)
  })

  test("a second notes track leaves a row's port as wide as it was", async ({ page }) => {
    // At 1180 px, where Last time takes the side and the rows are narrower.
    await page.setViewportSize({ width: 1180, height: 900 })
    const port = "Launchkey Mini MK3 MIDI Port"
    await openApp(page, { before: `window.__MIDI_PORTS__ = ['TD-17', ${JSON.stringify(port)}];` })
    await nameField(page, 2).fill("Keys")
    await setMode(page, 2, "MIDI")
    await pickPort(page, 2, port)
    expect(await lines(picker(page, 2).getByText(port))).toBe(1)
    const alone = await row(page, 2).boundingBox()
    const pickerAlone = await picker(page, 2).boundingBox()

    await nameField(page, 1).fill("Drums")
    await setMode(page, 1, "Both")
    await pickPort(page, 1, "TD-17")
    expect(await lines(picker(page, 2).getByText(port))).toBe(1)
    expect((await row(page, 2).boundingBox())!.height).toBe(alone!.height)
    expect((await picker(page, 2).boundingBox())!.width).toBe(pickerAlone!.width)
  })

  test("a band without MIDI reads no ports, and the first Both reads them at once", async ({
    page,
  }) => {
    // The page's own clock, running as usual until it is held still below.
    await page.clock.install()
    await openApp(page)
    await expect(input(page, 2)).toHaveText("Input 2")
    await page.waitForTimeout(1500)
    expect(await callCount(page, "list_midi_ports")).toBe(0)

    // Held still from here, a read every second cannot come: any read is the
    // one the first Both makes at once, however long a busy machine takes.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
    await setMode(page, 1, "Both")
    await expect.poll(() => callCount(page, "list_midi_ports"), { timeout: 5000 }).toBeGreaterThan(0)
    await page.clock.resume()
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
    await expect(notices(page, "error").filter({ hasText: "No room left" })).toBeVisible()

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

    // A name longer than its line wraps onto a second one and the row grows.
    const field = nameField(page, 1)
    const oneLine = (await field.boundingBox())!.height
    await field.fill(`${name}, and the room microphone by the door of the rehearsal room`)
    await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5)

    await picker(page, 1).click()
    const option = page.getByRole("option", { name: port })
    await expect(option).toBeVisible()
    expect(await lines(option.getByText(port))).toBe(2)

    const cut = await page.evaluate(() =>
      [...document.querySelectorAll("[data-track-row] *, [role='listbox'] *")]
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
