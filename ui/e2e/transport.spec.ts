import type { Locator, Page } from "@playwright/test"
import {
  calls,
  colour,
  dragRegion,
  expect,
  hold,
  letGo,
  literally,
  mixed,
  openApp,
  openEvening,
  recordTake,
  setFake,
  settled,
  startRehearsal,
  style,
  test,
  TONIGHT,
} from "./app.ts"

// The player's transport, and the one line it keeps for what it has to say
// (owner, 2026-10-12, Q1: one group per job; the plan's Calls: the line). The
// evening's takes are TONIGHT: take 1 is a Pałyn of 200 s, take 3 a Viasna of
// 12 s with a mark at 4 s.

const transport = (page: Page) => page.getByRole("toolbar", { name: "Transport" })
const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })
const line = (page: Page) => page.locator("[data-player-line]")
const play = (page: Page) => page.getByRole("button", { name: "Play", exact: true })
/** The map above the ruler, as a row. */
const mapRow = (page: Page) =>
  page.getByRole("scrollbar", { name: "Part of the take on screen" }).locator("xpath=..")
/** The whole player: what the transport, the lanes and the marks are in. */
const player = (page: Page) => transport(page).locator("xpath=..")

const QUIET =
  "Playback stopped: nothing has gone out through “Interface” for 3 seconds. It " +
  "was unplugged, switched off or stopped answering. Press play to try it again."

/** A take of the evening open in the player, loaded and settled. */
async function openTonight(page: Page, take: string, before = "", tonight: object[] = TONIGHT) {
  const overview = await openEvening(page, before, tonight)
  await overview.getByRole("button", { name: new RegExp(`^${literally(take)}`) }).click()
  await expect(timeline(page)).toBeVisible()
  await expect(play(page)).toBeEnabled()
  await settled(page)
}

type Box = { x: number; y: number; width: number; height: number }

/** The same box, to a quarter of a pixel (layout works in 1/64 px). */
function expectSame(now: Box, was: Box, what: string) {
  for (const k of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(now[k] - was[k]), `${what} ${k}: ${now[k]} against ${was[k]}`).toBeLessThan(0.25)
  }
}

/** The crop of take 1, as the journal of background work lists it. */
async function croppingTake(page: Page, fraction = 0.4) {
  const rehearsal = (await calls(page, "start_rehearsal"))[0].args[0]
  await setFake(page, "__ACTIVITY__", [
    {
      id: 50,
      kind: "crop",
      title: "crop",
      folder: `/rec/${rehearsal}`,
      take_number: 1,
      state: "running",
      fraction,
      step: null,
      error: null,
      detail: null,
      retry: null,
      seen: false,
    },
  ])
}

/** The playback device going quiet while a take plays, as Python says it. */
async function goQuiet(page: Page, what = QUIET) {
  await play(page).click()
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
  await setFake(page, "__OUTPUT_QUIET__", what)
  await expect(line(page).getByRole("alert")).toContainText("Playback stopped")
}

/** What the player's line says, in the one span the tip and the cut are on. */
const lineWords = (page: Page) => line(page).locator("[data-slot='alert-description'] > span")

const shows = (locator: Locator) => locator.isVisible()

test.describe("the transport", () => {
  test("near a mark the transport keeps its height at 960 px", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 820 })
    await openTonight(page, "Take 3 Viasna 1")
    // All in one go in the page: the playhead is by the mark for two seconds
    // only, and a box read after it has gone on proves nothing.
    const seen = () =>
      page.evaluate(() => {
        const rect = (el: Element | null) => {
          const r = el!.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        const mark = document.querySelector(
          "button[aria-label='Add mark'], button[aria-label='Open mark']"
        )
        return {
          near: mark?.getAttribute("aria-label") === "Open mark",
          transport: rect(document.querySelector("[role='toolbar'][aria-label='Transport']")),
          timeline: rect(document.querySelector("[role='group'][aria-label='Take timeline']")),
          mark: rect(mark),
        }
      })
    const rest = await seen()
    expect(rest.near).toBe(false)

    await play(page).click()
    // Played on to the mark at 4 s: within a second of it, Mark says Open mark.
    let near: Awaited<ReturnType<typeof seen>> | null = null
    await expect
      .poll(
        async () => {
          const now = await seen()
          if (now.near) near = now
          return now.near
        },
        { timeout: 20_000 }
      )
      .toBe(true)
    expectSame(near!.transport, rest.transport, "transport")
    expectSame(near!.timeline, rest.timeline, "timeline")
    expectSame(near!.mark, rest.mark, "Mark")
  })

  test("the transport is a card without a frame, in the air of a group", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    expect(
      await style(
        transport(page),
        "border-top-width",
        "border-top-left-radius",
        "padding-left",
        "padding-top",
        "background-color"
      )
    ).toEqual({
      "border-top-width": "0px",
      "border-top-left-radius": "12px",
      "padding-left": "24px",
      "padding-top": "16px",
      "background-color": await colour(page, "--card"),
    })
  })

  test("Repeat is a toggle, grey when on", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    const repeat = transport(page).getByRole("button", { name: "Repeat", exact: true })
    await expect(repeat).toHaveAttribute("aria-pressed", "false")
    await expect(repeat).toHaveText("Repeat")
    await expect(repeat).not.toHaveAttribute("title")
    const fill = async () => (await style(repeat, "background-color"))["background-color"]
    // Off it has no fill of its own; the pointer is nowhere near it.
    await page.mouse.move(0, 0)
    await expect.poll(fill).toBe("rgba(0, 0, 0, 0)")

    await repeat.click()
    await expect(repeat).toHaveAttribute("aria-pressed", "true")
    // On, it is the grey fill, even with the pointer on it: not the warn
    // amber it was.
    await expect.poll(fill).toBe(await colour(page, "--selected"))
    expect(await colour(page, "--selected")).not.toBe(await colour(page, "--warn"))

    // And the key still turns it off.
    await page.mouse.move(0, 0)
    await page.keyboard.press("r")
    await expect(repeat).toHaveAttribute("aria-pressed", "false")
  })

  test("Play shows a spinner only after one second", async ({ page }) => {
    const overview = await openEvening(page)
    await hold(page, "player_open")
    const open = overview.getByRole("button", { name: /^Take 1 Pałyn 1/ })
    const playing = play(page)
    const spinner = playing.getByRole("status", { name: "Loading" })
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await open.click()
    await expect(playing).toBeDisabled()
    const turning = playing.locator(".animate-spin")
    await at(500)
    expect(await shows(turning), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await shows(turning), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })

    await letGo(page, "player_open")
    await expect(playing).toBeEnabled()
    await expect(spinner).toHaveCount(0)
  })
})

test.describe("the player's line", () => {
  test("the warning and the crop line take the player's kept line and the timeline stays", async ({
    page,
  }) => {
    await openTonight(page, "Take 1 Pałyn 1", "window.__ACTIVITY__ = [];")
    const top = async () => (await timeline(page).boundingBox())!.y
    const rest = await top()
    // There at rest, between the transport and the map, with no gap round it
    // and nothing in it.
    await expect(line(page)).toHaveCount(1)
    await expect(line(page)).toHaveText("")
    const above = (await transport(page).boundingBox())!
    const kept = (await line(page).boundingBox())!
    const below = (await mapRow(page).boundingBox())!
    expect(kept.height).toBeCloseTo(24, 0)
    expect(kept.y).toBeCloseTo(above.y + above.height, 0)
    expect(below.y).toBeCloseTo(kept.y + kept.height, 0)

    await goQuiet(page)
    expect(await line(page).getByRole("alert").count()).toBe(1)
    expect(Math.abs((await top()) - rest)).toBeLessThan(0.25)

    // The crop line takes the line instead, and nothing moves.
    await hold(page, "crop_take")
    await dragRegion(page, 0.25, 0.75)
    expect(Math.abs((await top()) - rest)).toBeLessThan(0.25)
    await croppingTake(page)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await expect(line(page)).toContainText("Cropping… 40%")
    expect(Math.abs((await top()) - rest)).toBeLessThan(0.25)
    await letGo(page, "crop_take")
  })

  test("a load error is said in the player's line, and play tries again", async ({ page }) => {
    await openEvening(page, "", [
      { name: "Pałyn", duration_sec: 60, tracks: [{ name: "Guitar", file: "/gone/t1.wav" }] },
    ])
    await page.getByRole("button", { name: /^Take 1 Pałyn 1/ }).click()
    const said = line(page).getByRole("alert")
    await expect(said).toHaveText("Track file not found")
    // An alert of its own colour, with no box round it.
    expect(await style(said, "color", "border-top-width", "background-color")).toEqual({
      color: await colour(page, "--destructive"),
      "border-top-width": "0px",
      "background-color": "rgba(0, 0, 0, 0)",
    })
    // Play stays on. It has the name a take's play button has on the other
    // pages when its take could not load, and still answers to Space.
    const again = transport(page).getByRole("button", {
      name: "Could not load the take. Try again",
      exact: true,
    })
    await expect(again).toBeEnabled()
    await expect(again).toHaveAttribute("aria-keyshortcuts", "Space")

    // The files are back where they were: pressing it opens the take once
    // more, and it plays.
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
    const opens = (await calls(page, "player_open")).length
    await again.click()
    await expect(transport(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await expect(said).toHaveCount(0)
    expect((await calls(page, "player_open")).length).toBe(opens + 1)
  })

  test("one thing at a time in the player's line", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1", "window.__ACTIVITY__ = [];")
    await goQuiet(page)

    // A crop, held: it is said over the warning, which is not.
    await hold(page, "crop_take")
    await dragRegion(page, 0.25, 0.75)
    await croppingTake(page)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await expect(line(page)).toContainText("Cropping… 40%")
    await expect(line(page).getByRole("alert")).toHaveCount(0)
    await expect(page.getByText("Playback stopped")).toHaveCount(0)
    await letGo(page, "crop_take")
  })

  test("a load error is said before the crop line", async ({ page }) => {
    await openEvening(page, "window.__ACTIVITY__ = [];", [
      { name: "Pałyn", duration_sec: 60, tracks: [{ name: "Guitar", file: "/gone/t1.wav" }] },
    ])
    await croppingTake(page)
    await page.getByRole("button", { name: /^Take 1 Pałyn 1/ }).click()
    await expect(line(page).getByRole("alert")).toHaveText("Track file not found")
    await expect(line(page).getByRole("status")).toHaveCount(0)
    await expect(page.getByText("Cropping…")).toHaveCount(0)
  })

  test("a line too long for its room is cut, and shows whole on hover", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    await goQuiet(page)
    const words = line(page).locator("[data-slot='alert-description'] > span")
    await expect(words).toHaveText(QUIET)
    const cut = await words.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(cut, "the warning is longer than the line").toBe(true)
    expect(await style(words, "text-overflow", "white-space")).toEqual({
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    })
    // One line: no taller than the line holds.
    expect((await words.boundingBox())!.height).toBeLessThanOrEqual(24)
    await words.hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(QUIET)
  })

  test("a line that is cut takes Tab and shows whole in the tip", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    await goQuiet(page)
    const alert = line(page).getByRole("alert")
    await expect(alert).toHaveAttribute("tabindex", "0")
    // The keys button ends the transport, and the line is the next stop.
    await page.getByRole("button", { name: "Player keys" }).focus()
    await page.keyboard.press("Tab")
    await expect(alert).toBeFocused()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(QUIET)
    // The shared focus ring, round the line: the words are cut at their own
    // box, which would clip a ring drawn round them.
    expect((await style(alert, "box-shadow"))["box-shadow"]).not.toBe("none")
    // And the next Tab goes on, out of the line, to the first lane's fader.
    await page.keyboard.press("Tab")
    await expect(alert).not.toBeFocused()
    await expect(page.getByRole("slider", { name: "Guitar volume" })).toBeFocused()
  })

  test("a line that fits is no stop for Tab", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    await goQuiet(page, "Playback stopped.")
    const alert = line(page).getByRole("alert")
    const words = lineWords(page)
    await expect(words).toHaveText("Playback stopped.")
    const cut = await words.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(cut, "the warning fits the line").toBe(false)
    await expect(alert).not.toHaveAttribute("tabindex")
    // Tab goes by the line, from the keys button to the first lane's fader.
    await page.getByRole("button", { name: "Player keys" }).focus()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("slider", { name: "Guitar volume" })).toBeFocused()
  })
})

test.describe("the marker's kind", () => {
  test("the marker's kind picker is a switch", async ({ page }) => {
    await openApp(page, {
      before:
        "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
    })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: "Add mark" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Mark at")).toBeVisible()

    // The kinds are radios of one group, the first chosen.
    const kinds = dialog.getByRole("radio")
    await expect(kinds).toHaveText(["Solo", "Note", "Went wrong"])
    await expect(kinds.nth(0)).toHaveAttribute("aria-checked", "true")
    await expect(kinds.nth(1)).toHaveAttribute("aria-checked", "false")
    await expect(dialog.locator("[data-slot='toggle-group'][data-variant='switch']")).toHaveCount(1)
    // Each with its colour's dot.
    await expect(dialog.locator("[data-slot='label-dot']")).toHaveCount(3)

    // The arrow keys move along them.
    await kinds.nth(0).focus()
    await page.keyboard.press("ArrowRight")
    await expect(kinds.nth(1)).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(kinds.nth(2)).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(kinds.nth(1)).toBeFocused()
    // Tab leaves the group for the next control, and Shift+Tab for the
    // one before; the group's own box is no stop to be handed back from.
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("textbox", { name: "Comment" })).toBeFocused()
    // Back to the radio the group last had, which is where its tab stop is.
    await page.keyboard.press("Shift+Tab")
    await expect(kinds.nth(1)).toBeFocused()
    // Past the group's first stop, the way round to the last control of the
    // dialog, which is Save.
    await page.keyboard.press("Shift+Tab")
    await expect(dialog.getByRole("button", { name: "Save" })).toBeFocused()

    // One is always chosen: the chosen one pressed again stays chosen.
    await kinds.nth(0).click()
    await expect(kinds.nth(0)).toHaveAttribute("aria-checked", "true")
    await kinds.nth(2).click()
    await expect(kinds.nth(2)).toHaveAttribute("aria-checked", "true")
    await expect(kinds.nth(0)).toHaveAttribute("aria-checked", "false")
    await kinds.nth(2).click()
    await expect(kinds.nth(2)).toHaveAttribute("aria-checked", "true")
  })

  test("the kind picker is one Tab stop from a fresh open", async ({ page }) => {
    await openApp(page, {
      before:
        "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
    })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: "Add mark" }).click()
    const dialog = page.getByRole("dialog")
    const kinds = dialog.getByRole("radio")
    const note = dialog.getByRole("textbox", { name: "Comment" })
    const save = dialog.getByRole("button", { name: "Save" })
    await expect(kinds).toHaveCount(3)

    // Nothing is focused by hand: the note has the focus, as it opens, and
    // no kind has had it yet, so none is a stop of its own as far as the
    // group knows.
    await expect(note).toBeFocused()
    expect(await kinds.evaluateAll((els) => els.map((el) => (el as HTMLElement).tabIndex))).toEqual([
      -1, -1, -1,
    ])
    // Back from the note is the chosen kind.
    await page.keyboard.press("Shift+Tab")
    await expect(kinds.nth(0)).toBeFocused()
    // Back again leaves the group, the way round to the dialog's last control.
    await page.keyboard.press("Shift+Tab")
    await expect(save).toBeFocused()
    // And forward from there comes to the chosen kind and on to the note.
    await page.keyboard.press("Tab")
    await expect(kinds.nth(0)).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(note).toBeFocused()
  })

  test("Space chooses the kind the arrows came to, and Save keeps it", async ({ page }) => {
    await openApp(page, {
      before:
        "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
    })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: "Add mark" }).click()
    const dialog = page.getByRole("dialog")
    const kinds = dialog.getByRole("radio")
    await expect(dialog.getByRole("textbox", { name: "Comment" })).toBeFocused()

    // Back to the chosen kind, and along to the next: the arrow moves the
    // focus and leaves the choice where it was.
    await page.keyboard.press("Shift+Tab")
    await expect(kinds.nth(0)).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(kinds.nth(1)).toBeFocused()
    await expect(kinds.nth(1)).toHaveAttribute("aria-checked", "false")
    // Space chooses it.
    await page.keyboard.press("Space")
    await expect(kinds.nth(1)).toHaveAttribute("aria-checked", "true")
    await expect(kinds.nth(0)).toHaveAttribute("aria-checked", "false")
    await expect(dialog).toHaveCount(1)

    // And Save keeps the marker with it, Note, whose id is 1: held on this
    // screen until Save take hands the take's marks over.
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
    const kept = (await calls(page, "keep_take")).at(-1)!.args
    expect((kept[5] as { label_id: number }[]).map((m) => m.label_id)).toEqual([1])
  })

  test("a kind other than the first, chosen, is the one the Tab key comes to", async ({ page }) => {
    await openApp(page, {
      before:
        "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
    })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: "Add mark" }).click()
    await page.getByRole("radio", { name: "Went wrong" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)

    // The marker opened again is a fresh dialog, with Went wrong chosen.
    await page.getByRole("button", { name: /^Edit mark at/ }).click()
    const dialog = page.getByRole("dialog")
    const kinds = dialog.getByRole("radio")
    await expect(kinds.nth(2)).toHaveAttribute("aria-checked", "true")
    expect(await kinds.evaluateAll((els) => els.map((el) => (el as HTMLElement).tabIndex))).toEqual([
      -1, -1, -1,
    ])
    await expect(dialog.getByRole("textbox", { name: "Comment" })).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(kinds.nth(2)).toBeFocused()
  })

  test("Tab goes on past the kinds from a kind that is not the group's stop", async ({ page }) => {
    await openApp(page, {
      before:
        "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
    })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: "Add mark" }).click()
    const dialog = page.getByRole("dialog")
    const kinds = dialog.getByRole("radio")
    const note = dialog.getByRole("textbox", { name: "Comment" })
    await expect(note).toBeFocused()

    // Radix makes a focused kind its group's stop. Left on Solo while Went
    // wrong has the focus, the stop still stands for the whole group.
    await kinds.nth(2).focus()
    await kinds.evaluateAll((els) => {
      ;(els[0] as HTMLElement).tabIndex = 0
      ;(els[2] as HTMLElement).tabIndex = -1
    })
    await page.keyboard.press("Tab")
    await expect(note).toBeFocused()
  })
})

test.describe("the map", () => {
  test("the map's view frame is grey", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    const box = (await timeline(page).boundingBox())!
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
    await page.keyboard.down("Control")
    await page.mouse.wheel(0, -500)
    await page.keyboard.up("Control")
    const frame = page.locator("[data-view-frame]")
    await expect(frame).toHaveCount(1)
    // The text's colour at 15 % of its strength, not the accent it was.
    const grey = await mixed(page, "--foreground", 15)
    await expect
      .poll(async () => (await style(frame, "background-color"))["background-color"])
      .toBe(grey)
    expect(grey).not.toBe(await mixed(page, "--primary", 30))
  })
})

test.describe("the share dialog", () => {
  test("the share dialog shows a spinner only after one second", async ({ page }) => {
    await openEvening(page)
    await page.getByRole("button", { name: "Copy Pałyn 1 to the cloud" }).click()
    const dialog = page.getByRole("dialog")
    const mix = dialog.getByRole("button", { name: "The mix", exact: true })
    await expect(mix).toBeEnabled()
    await settled(page)
    // Its layout size: the dialog may still be growing into its place.
    const sized = () => mix.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])
    const before = await sized()

    // An option keeps its icon for the second.
    await hold(page, "share_take")
    const spinner = mix.getByRole("status", { name: "Loading" })
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await mix.click()
    await at(500)
    expect(await shows(mix.locator(".animate-spin")), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await shows(mix.locator(".animate-spin")), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    expect(await sized(), "the option's box").toEqual(before)
    await letGo(page, "share_take")
    await expect(dialog).toHaveCount(0)
  })

  test("Remove from the cloud shows a spinner only after one second, and does not move", async ({
    page,
  }) => {
    await openEvening(page)
    // Take 5 has its mix in the cloud already.
    await page.getByRole("button", { name: "Cloud copies of Viasna 2" }).click()
    const dialog = page.getByRole("dialog")
    const remove = dialog.getByRole("button", { name: "Remove from the cloud" })
    await expect(remove).toBeEnabled()
    await settled(page)
    // The dialog has grown into its place.
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
    // The button's box, and where its words start.
    const look = () =>
      remove.evaluate((el) => {
        const words = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!
        const range = document.createRange()
        range.selectNodeContents(words)
        const b = el.getBoundingClientRect()
        return { x: b.x, y: b.y, width: b.width, height: b.height, words: range.getBoundingClientRect().x }
      })
    const before = await look()

    await hold(page, "unshare_take")
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await remove.click()
    await at(500)
    expect(await shows(remove.locator(".animate-spin")), "a spinner at 0.5 s").toBe(false)
    expect(await look(), "the button at 0.5 s").toEqual(before)
    await at(900)
    expect(await shows(remove.locator(".animate-spin")), "a spinner at 0.9 s").toBe(false)
    await expect(remove.getByRole("status", { name: "Loading" }), "a spinner by 2 s").toBeVisible({
      timeout: 2000,
    })
    expect(await look(), "the button with its spinner").toEqual(before)
    await letGo(page, "unshare_take")
    await expect(dialog).toHaveCount(0)
  })
})

test.describe("the marks and the region", () => {
  test("a mark chip's time and words are buttons with the shared focus ring", async ({ page }) => {
    await openTonight(page, "Take 3 Viasna 1")
    const time = page.getByRole("button", { name: "0:04", exact: true })
    const words = time.locator("xpath=following-sibling::button[1]")
    await expect(time).toHaveCount(1)
    await expect(words).toHaveCount(1)
    const ring = async (el: Locator) => (await style(el, "box-shadow"))["box-shadow"]
    // Not focused, neither shows one.
    expect(await ring(time)).toBe("none")

    // Reached with the Tab key from the top of the page, the time first.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const focused = (el: Locator) => el.evaluate((e) => e === document.activeElement)
    let tabs = 0
    while (!(await focused(time)) && tabs++ < 120) await page.keyboard.press("Tab")
    expect(await focused(time), "Tab reaches the time").toBe(true)
    expect(await ring(time), "the time's focus ring").not.toBe("none")
    await page.keyboard.press("Tab")
    expect(await focused(words), "the words follow the time").toBe(true)
    expect(await ring(words), "the words' focus ring").not.toBe("none")
  })

  test("a mark chip is 30 px high, and the marks are 24 px under the master", async ({
    page,
  }) => {
    // The page is settled by openTonight: a box read while the groups rise is
    // up to 12 px off.
    await openTonight(page, "Take 3 Viasna 1")
    await settled(page)
    const chip = page.getByRole("button", { name: "0:04", exact: true }).locator("xpath=..")
    const row = chip.locator("xpath=..")
    await expect(row).toContainText("Marks")
    expect((await chip.boundingBox())!.height).toBeCloseTo(30, 0)
    // One group, 24 px apart inside it (Q1): the row of marks starts 24 px
    // under the master, which is the last of the timeline.
    const master = (await page.getByText("Master", { exact: true }).locator("xpath=../..").boundingBox())!
    const marks = (await row.boundingBox())!
    expect(marks.y - (master.y + master.height)).toBeCloseTo(24, 0)
  })

  test("a mark chip's cut words show whole in the shared tip", async ({ page }) => {
    const long =
      "the second chorus drifts flat against the bass line and the drums rush it again " +
      "after the bridge, and nobody noticed until we listened back to the whole take"
    await page.setViewportSize({ width: 960, height: 820 })
    await openTonight(page, "Take 3 Viasna 1", "", [
      ...TONIGHT.slice(0, 2),
      { name: "Viasna", duration_sec: 12, markers: [{ at: 4, note: long, label_id: 1 }] },
    ])
    const time = page.getByRole("button", { name: "0:04", exact: true })
    const words = time.locator("xpath=following-sibling::button[1]")
    await expect(words).toContainText("the second chorus")
    await expect(words).not.toHaveAttribute("title")
    const cut = await words.locator("span").evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(cut, "the words are longer than the chip's room").toBe(true)
    await words.hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toContainText(long)
  })

  test("the player says what its icon buttons do in the shared tip, not a native title", async ({
    page,
  }) => {
    await openTonight(page, "Take 3 Viasna 1")
    await dragRegion(page, 0.2, 0.6)
    const loop = page.getByRole("button", { name: "Loop the region" })
    await expect(loop).toBeVisible()
    // Not one native title is left in the player.
    await expect(player(page).locator("[title]")).toHaveCount(0)

    const tip = page.getByRole("tooltip")
    const says = async (button: Locator, words: string) => {
      await button.hover()
      await expect(tip).toHaveText(words)
      // Away in steps: a tip lets go when the pointer travels out of its
      // reach, not when it is dropped elsewhere.
      await page.mouse.move(0, 0, { steps: 6 })
      await expect(tip).toHaveCount(0)
    }
    await says(transport(page).getByRole("button", { name: "To start" }), "To start")
    await says(transport(page).getByRole("button", { name: "Player keys" }), "Keys (?)")
    await says(loop, "Repeat it (R)")
    await says(
      page.getByRole("button", { name: "Clear the loop region" }),
      "Clear it, then Repeat loops the whole take"
    )
    await loop.click()
    await expect(loop).toHaveAttribute("aria-pressed", "true")
    await page.mouse.move(0, 0, { steps: 6 })
    await says(loop, "Stop repeating it (R)")
  })

  test("To start's tip is for the eyes, not read again as the button's description", async ({
    page,
  }) => {
    await openTonight(page, "Take 3 Viasna 1")
    const start = transport(page).getByRole("button", { name: "To start" })
    await transport(page).getByRole("button", { name: /^Back \d+ seconds$/ }).focus()
    await page.keyboard.press("Shift+Tab")
    await expect(start).toBeFocused()
    await expect(page.getByRole("tooltip")).toHaveText("To start")
    await expect(start).toHaveAccessibleDescription("")
  })

  test("the region's tag is on the shared buttons, in the tag's own tints", async ({ page }) => {
    await openTonight(page, "Take 1 Pałyn 1")
    await dragRegion(page, 0.25, 0.75)
    const loop = page.getByRole("button", { name: "Loop the region" })
    const clear = page.getByRole("button", { name: "Clear the loop region" })
    const crop = page.getByRole("button", { name: "Crop to the region" })
    // The shared Button's own marks (a tip on a button keeps its slot).
    await expect(loop).toHaveAttribute("data-variant", "ghost")
    await expect(clear).toHaveAttribute("data-variant", "ghost")
    await expect(crop).toHaveAttribute("data-variant", "outline")
    // The shared focus ring on the keys: Crop is reached with Tab.
    await crop.focus()
    await page.keyboard.press("Shift+Tab")
    await page.keyboard.press("Tab")
    await expect(crop).toBeFocused()
    expect((await style(crop, "box-shadow"))["box-shadow"]).not.toBe("none")
    // On, the loop is pressed in: a tint of the tag's own text colour, not a
    // raw black.
    await loop.click()
    await expect(loop).toHaveAttribute("aria-pressed", "true")
    await page.mouse.move(0, 0)
    const ink = await mixed(page, "--warn-foreground", 15)
    await expect
      .poll(async () => (await style(loop, "background-color"))["background-color"])
      .toBe(ink)
    // The words on the tag are 12 px.
    expect((await style(page.locator("[data-region-span]"), "font-size"))["font-size"]).toBe("12px")
  })
})
