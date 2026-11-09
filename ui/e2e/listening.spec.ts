import {
  callCount,
  calls,
  closeTakeButton,
  expect,
  keyOn,
  notices,
  openApp,
  recordButton,
  recordTake,
  setFake,
  startRehearsal,
  takeButton,
  test,
  withKeys,
} from "./app.ts"
import type { Page } from "@playwright/test"

// Listening apart from recording (spec 2026-11-09): Stop saves the take and
// the rehearsal screen opens it, paused, to listen to. While it is open the
// footer is Close take (Esc) and Play or Pause (Space), its box to send it
// is where the metronome was, and its marks are in the right panel.

/** The footer's two buttons: the one at the left, and the main one. */
const buttons = (page: Page) => page.locator("footer [data-footer-actions] button")
const aside = (page: Page) => buttons(page).nth(0)
const main = (page: Page) => buttons(page).nth(1)
const transport = (page: Page) => page.getByRole("toolbar", { name: "Transport" })
const marksPanel = (page: Page) => page.getByRole("complementary", { name: "Marks" })
const nextTakePanel = (page: Page) => page.getByRole("complementary", { name: "Next take" })
const overview = (page: Page) => page.locator("[aria-label='Rehearsal overview']")
const strip = (page: Page) => page.getByRole("group", { name: "Take strip" })
const serviceBox = (page: Page) => page.getByRole("checkbox", { name: "Send to the band service" })
/** A take's row in the overview, and its own play button there. */
const row = (page: Page, n: number) => overview(page).locator(`[data-take="${n}"]`)
const playInRow = (page: Page, n: number) =>
  row(page, n).getByRole("button", { name: /^(Play|Pause) / })
/** The open take's tab in the strip, and its pencil, which names it. */
const openTab = (page: Page) => strip(page).locator("[data-tab][aria-current='true']")
const tab = (page: Page, song: string, go: number) =>
  strip(page).getByRole("button", { name: `Rename take ${song} ${go}`, exact: true })

/** What the session says is held. */
const held = (page: Page) =>
  page.evaluate(async () => {
    const w = window as unknown as {
      pywebview: { api: { session_state(): Promise<{ held_take?: number | null }> } }
    }
    return (await w.pywebview.api.session_state()).held_take ?? null
  })

/** The controller, as it sends the transport a command. */
const fromController = (page: Page, action: string) =>
  page.evaluate(async (a) => {
    const w = window as unknown as {
      pywebview: { api: { control_command(a: string): Promise<unknown> } }
    }
    await w.pywebview.api.control_command(a)
  }, action)

/** The band service, with its own sending on. */
const SERVICE =
  "window.__SERVICE_KEY__ = 'band.example:reha_secret'; window.__SERVICE_AUTO__ = true;"
/** The fake's takes are 6 s, false starts under the 30 s the setting starts
 *  at. With the limit at its lowest they are takes like any other. */
const LONG_ENOUGH = " window.__FALSE_START__ = 5;"

/** The next take named on the rehearsal screen. */
async function nameNext(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Next take" }).fill(name)
  await page.keyboard.press("Enter")
}

/** The footer's two buttons and the footer, as they are laid out. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element | null) => {
      const r = el!.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const [left, right] = document.querySelectorAll("footer [data-footer-actions] button")
    return { left: box(left), right: box(right), footer: box(document.querySelector("footer")) }
  })

test("Stop saves the take and opens it, paused at its start", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  expect(await callCount(page, "keep_take")).toBe(1)
  expect((await calls(page, "control_command")).map((c) => c.args[0])).toEqual([
    "start_rehearsal",
    "start",
    "stop_keep",
  ])
  await expect(page.locator("[data-take-summary]")).toHaveCount(0)
  await expect(strip(page)).toBeVisible()
  await expect(transport(page).getByRole("button", { name: "Play", exact: true })).toBeVisible()
  await expect(transport(page)).toContainText("0:00 / 0:06")
  await expect(main(page)).toHaveAccessibleName("Play")
  await expect(aside(page)).toHaveAccessibleName("Close take")
  await expect(marksPanel(page)).toBeVisible()
  await expect(nextTakePanel(page)).toHaveCount(0)
})

test("Space plays the open take, and Esc stops it and closes it", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await page.keyboard.press("Space")
  await expect(main(page)).toHaveAccessibleName("Pause")
  await expect(transport(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  // Closed and stopped: it does not play on in the overview.
  await expect(recordButton(page, 2)).toBeVisible()
  await expect(aside(page)).toHaveAccessibleName("Finish")
  await expect(overview(page)).toBeVisible()
  await expect(playInRow(page, 1)).toHaveAccessibleName(/^Play /)
  await expect(nextTakePanel(page)).toBeVisible()
  // Space records again.
  await page.keyboard.press("Space")
  await expect(page.locator("[role=timer]")).toBeVisible()
})

test("Close take stops the take and closes it, as Esc does", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await main(page).click()
  await expect(main(page)).toHaveAccessibleName("Pause")
  await closeTakeButton(page).click()
  await expect(recordButton(page, 2)).toBeVisible()
  await expect(playInRow(page, 1)).toHaveAccessibleName(/^Play /)
})

test("the footer's buttons show their keys in each state and keep their places", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  const nothing = await layout(page)
  expect(await keyOn(aside(page))).toBe("Esc")
  expect(await keyOn(main(page))).toBe("Space")
  await expect(aside(page)).toHaveAttribute("aria-keyshortcuts", "Escape")
  await expect(main(page)).toHaveAttribute("aria-keyshortcuts", "Space")

  // A take open: Close take and Play, then Pause.
  await recordTake(page)
  expect(await layout(page)).toEqual(nothing)
  expect(await keyOn(aside(page))).toBe("Esc")
  expect(await keyOn(main(page))).toBe("Space")
  await page.keyboard.press("Space")
  await expect(main(page)).toHaveAccessibleName("Pause")
  expect(await layout(page)).toEqual(nothing)
  expect(await keyOn(main(page))).toBe("Space")

  // A take playing in the overview, not open: Stop and Pause.
  await page.keyboard.press("Escape")
  await expect(aside(page)).toHaveAccessibleName("Finish")
  await playInRow(page, 1).click()
  await expect(aside(page)).toHaveAccessibleName("Stop")
  await expect(main(page)).toHaveAccessibleName("Pause")
  expect(await layout(page)).toEqual(nothing)
  expect(await keyOn(aside(page))).toBe("Esc")
  expect(await keyOn(main(page))).toBe("Space")
  // Stop puts it away.
  await aside(page).click()
  await expect(aside(page)).toHaveAccessibleName("Finish")
  await expect(main(page)).toHaveAccessibleName("Record")
  expect(await layout(page)).toEqual(nothing)
})

test("with Space and Esc off the footer's buttons show no keys", async ({ page }) => {
  await openApp(page, { before: withKeys({ space: false }) })
  await startRehearsal(page)
  expect(await keyOn(aside(page))).toBeNull()
  expect(await keyOn(main(page))).toBeNull()
  await recordTake(page)
  expect(await keyOn(aside(page))).toBeNull()
  expect(await keyOn(main(page))).toBeNull()
  await expect(main(page)).not.toHaveAttribute("aria-keyshortcuts")
})

test("while a take is open the metronome waits unseen and the footer keeps its height", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  const metronome = page.getByRole("region", { name: "Metronome" })
  await expect(metronome).toBeVisible()
  const before = await layout(page)
  await recordTake(page)
  await expect(metronome).toBeHidden()
  await expect(page.getByRole("checkbox", { name: "Send to the cloud" })).toBeVisible()
  expect((await layout(page)).footer).toEqual(before.footer)
  await page.keyboard.press("Escape")
  await expect(metronome).toBeVisible()
})

/** Viasna with three marks, set down out of order. */
const MARKED =
  "window.__TONIGHT__ = [{name: 'Viasna', duration_sec: 30, markers: [" +
  "{at: 21, note: 'Bridge too slow', label_id: 1}, {at: 4, note: '', label_id: 1}," +
  " {at: 12.5, note: 'Vocals late', label_id: 1}]}];"

test("the marks panel lists the open take's marks in time order", async ({ page }) => {
  await openApp(page, { before: MARKED })
  await startRehearsal(page, 2)
  await takeButton(overview(page), "Viasna #1").click()
  const panel = marksPanel(page)
  await expect(panel.getByRole("heading", { name: "Marks" })).toBeVisible()
  const lines = panel.locator("[data-note]")
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(0)).toContainText("0:04")
  await expect(lines.nth(1)).toContainText("0:12")
  await expect(lines.nth(1)).toContainText("Vocals late")
  await expect(lines.nth(2)).toContainText("0:21")
  // The chips under the lanes are gone: the panel has them.
  await expect(page.locator("main").getByRole("button", { name: /^Edit mark at/ })).toHaveCount(0)

  // A line moves the take there.
  await lines.nth(2).click()
  await expect(transport(page)).toContainText("0:21 / 0:30")

  // The pencil and the cross show on hover, and edit and remove.
  const pencil = panel.getByRole("button", { name: "Edit mark at 0:12" })
  await page.mouse.move(0, 0)
  await expect(pencil).toHaveCSS("opacity", "0")
  await lines.nth(1).hover()
  await expect(pencil).toHaveCSS("opacity", "1")
  await pencil.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await panel.getByRole("button", { name: "Remove mark at 0:04" }).click()
  await expect.poll(() => callCount(page, "remove_take_marker")).toBe(1)
  expect((await calls(page, "remove_take_marker"))[0].args.slice(1)).toEqual([1, 4])
  await expect(lines).toHaveCount(2)
})

test("a take with no marks has the heading and nothing under it", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await expect(marksPanel(page).getByRole("heading", { name: "Marks" })).toBeVisible()
  await expect(marksPanel(page).locator("li")).toHaveCount(0)
  await expect(marksPanel(page)).toHaveText("Marks")
})

test("a mark made while listening shows in the panel", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await expect(transport(page).getByRole("button", { name: "Play", exact: true })).toBeEnabled()
  await page.keyboard.press("m")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(marksPanel(page).locator("[data-note]")).toHaveCount(1)
  await expect(marksPanel(page).locator("[data-note]")).toContainText("0:00")
})

test("the send box ticks a false start and sends it", async ({ page }) => {
  await openApp(page, { before: SERVICE })
  await startRehearsal(page)
  await recordTake(page)
  // A 6 s take is a false start: the setting leaves it behind.
  await expect(serviceBox(page)).not.toBeChecked()
  expect(await callCount(page, "share_take")).toBe(0)
  await serviceBox(page).click()
  await expect(serviceBox(page)).toBeChecked()
  expect((await calls(page, "share_take"))[0].args.slice(1)).toEqual([1, "mix"])
  // The box gave up focus, so Space is the screen's: Play.
  await page.keyboard.press("Space")
  await expect(main(page)).toHaveAccessibleName("Pause")
  // The open take waiting says so in its box, not in the strip as well.
  await expect(openTab(page)).toContainText("Take #1")
  await expect(openTab(page)).not.toContainText("Waiting for the band service")
})

test("the send box unticks a good take and takes it out", async ({ page }) => {
  await openApp(page, { before: SERVICE + LONG_ENOUGH })
  await startRehearsal(page)
  await recordTake(page)
  await expect(serviceBox(page)).toBeChecked()
  await serviceBox(page).click()
  await expect(serviceBox(page)).not.toBeChecked()
  expect((await calls(page, "unshare_take"))[0].args.slice(1)).toEqual([1])
  // Nothing of it is on its way any more.
  await closeTakeButton(page).click()
  await expect(row(page, 1)).toBeVisible()
  await expect(row(page, 1)).not.toContainText("Waiting for the band service")
})

test("an open take's refusal still shows in the strip", async ({ page }) => {
  await openApp(page, {
    before:
      SERVICE +
      "window.__TONIGHT__ = [{name: 'Dym', duration_sec: 200," +
      " service: {up: false, flac: false, error: 'The band service refused it'}}];",
  })
  await startRehearsal(page, 2)
  await takeButton(overview(page), "Dym #1").click()
  await expect(openTab(page)).toContainText("Not in the band service")
})

test("the take Stop saved is held until it is closed or another take is opened", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await nameNext(page, "Viasna")
  await recordTake(page)
  expect(await held(page)).toBe(1)
  expect(await callCount(page, "release_take")).toBe(0)
  await closeTakeButton(page).click()
  await expect.poll(() => callCount(page, "release_take")).toBe(1)

  // Another go at the song opened with the arrow lets the held one go.
  await recordTake(page, 2)
  await expect(tab(page, "Viasna", 2)).toBeVisible()
  expect(await held(page)).toBe(2)
  expect(await callCount(page, "release_take")).toBe(1)
  await page.keyboard.press("ArrowUp")
  await expect(tab(page, "Viasna", 1)).toBeVisible()
  await expect.poll(() => callCount(page, "release_take")).toBe(2)
  // A take that was never held lets nothing go when it is closed.
  await page.keyboard.press("Escape")
  await expect(recordButton(page, 3)).toBeVisible()
  expect(await callCount(page, "release_take")).toBe(2)
})

test("the controller's Record lets the open take go as the screen is left", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await startRehearsal(page)
  await recordTake(page)
  expect(await callCount(page, "release_take")).toBe(0)
  await fromController(page, "start")
  await expect(page.locator("[role=timer]")).toBeVisible()
  await expect.poll(() => callCount(page, "release_take")).toBe(1)
  // Python ended the hold at Record anyway.
  expect(await held(page)).toBeNull()
})

test("the trash on the take just stopped gives its number back", async ({ page }) => {
  await openApp(page, { before: "window.__TONIGHT__ = [{name: 'Viasna', duration_sec: 200}];" })
  await startRehearsal(page, 2)
  await recordTake(page, 2)
  await expect(tab(page, "Viasna", 2)).toBeVisible()
  await strip(page).getByRole("button", { name: /^Delete take/ }).click()
  await expect(notices(page).filter({ hasText: "“Viasna #2” went to the Trash." })).toBeVisible()
  expect(await held(page)).toBeNull()
  await expect(recordButton(page, 3)).toBeVisible()
  await recordTake(page, 3)
  await expect(tab(page, "Viasna", 2)).toBeVisible()
})

test("the trash on the first take of a song picks that song again", async ({ page }) => {
  await openApp(page, { before: "window.__TONIGHT__ = [{name: 'Viasna', duration_sec: 200}];" })
  await startRehearsal(page, 2)
  const field = page.getByRole("textbox", { name: "Next take" })
  await field.fill("Sonca")
  await page.keyboard.press("Enter")
  await recordTake(page, 2)
  await expect(tab(page, "Sonca", 1)).toBeVisible()
  await strip(page).getByRole("button", { name: /^Delete take/ }).click()
  await expect(recordButton(page, 3)).toBeVisible()
  // Not Viasna, the song of the take before it.
  await expect(field).toHaveValue("Sonca")
})

test("the controller's Stop saves the take and opens it, paused", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await startRehearsal(page)
  // What the controller's take is called is in place before it starts: the
  // screen takes the take from the first state that says recording.
  await setFake(page, "__CONTROL_STATE__", {
    state: "recording", busy: false, error: null, pending_take: null,
    take_number: 1, take_name: "Sonca", take_go: 1, playback_take_number: null,
  })
  await fromController(page, "start")
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await fromController(page, "stop_keep")
  await setFake(page, "__CONTROL_STATE__", null)
  await expect(closeTakeButton(page)).toBeVisible()
  await expect(main(page)).toHaveAccessibleName("Play")
  await expect(transport(page)).toContainText("0:00 / 0:06")
})

test("an old controller's stop_review saves the take as stop_keep does", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await startRehearsal(page)
  await recordButton(page, 1).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await fromController(page, "stop_review")
  await expect(closeTakeButton(page)).toBeVisible()
  expect(await callCount(page, "keep_take")).toBe(1)
})

/** Every save refused, as a full disk refuses it. */
const SAVE_FAILS =
  "{ const api = window.pywebview.api;" +
  " api.keep_take = async () => ({ ok: false, error: 'The disk is full' }); }"

test("a save that fails says why and opens Unsaved takes", async ({ page }) => {
  await openApp(page, { after: SAVE_FAILS })
  await startRehearsal(page)
  await recordButton(page, 1).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(notices(page).filter({ hasText: "The disk is full" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Unsaved takes" })).toBeVisible()
  await expect(page.locator("[data-draft]")).toHaveCount(1)
  await expect(closeTakeButton(page)).toHaveCount(0)
})

test("a controller's save that fails opens Unsaved takes too", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;", after: SAVE_FAILS })
  await startRehearsal(page)
  await recordButton(page, 1).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await page.evaluate(async () => {
    const w = window as unknown as {
      pywebview: { api: { control_command(a: string): Promise<{ transport: unknown }> } }
      __CONTROL_STATE__: unknown
    }
    const result = await w.pywebview.api.control_command("stop_keep")
    w.__CONTROL_STATE__ = result.transport
  })
  await expect(notices(page).filter({ hasText: "The disk is full" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Unsaved takes" })).toBeVisible()
})
