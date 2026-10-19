import {
  callCount,
  calls,
  colour,
  dragRegion,
  expect,
  keyOn,
  notices,
  openApp,
  openEvening,
  openHistory,
  scaled,
  settled,
  startButton,
  startRehearsal,
  style,
  test,
  TONIGHT,
  withKeys,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// Settings › Keys: Space and Esc, and the player's keys, each turned off
// on its own. Off, those keys do nothing on any screen. Ctrl+Z, and Esc in a
// dialog or a text field, work whatever the switches say. Python keeps both
// with the other settings; the fake keeps them in its config.

/** Presses the keys in turn, then gives them the time to do what they would. */
async function press(page: Page, ...keys: string[]) {
  for (const key of keys) await page.keyboard.press(key)
  await page.waitForTimeout(200)
}

/** How many times each of these was called. */
async function counts(page: Page, names: string[]) {
  const said: Record<string, number> = {}
  for (const name of names) said[name] = await callCount(page, name)
  return said
}

const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })
const nextTake = (page: Page) => page.getByRole("textbox", { name: "Next take" })
const firstTake = (overview: Locator) => overview.locator("button[aria-label^='Take 1 Pałyn']")

test("with Space and Esc off, they do nothing on the start, rehearsal, recording and review screens", async ({
  page,
}) => {
  await openApp(page, { before: withKeys({ space: false }) })
  const dialog = page.getByRole("dialog")

  // The start screen: Space would start the rehearsal.
  await expect(startButton(page)).toBeVisible()
  await press(page, "Space", "Escape")
  expect(await callCount(page, "start_rehearsal")).toBe(0)
  await expect(startButton(page)).toBeVisible()

  // The set button, its focus left by the mouse: Space presses it as it
  // presses any button, and its menu opens.
  await page.locator("[data-set-picker]").click()
  const sets = page.getByRole("menu", { name: "Sets" })
  await sets.getByRole("menuitemradio", { name: /No set/ }).click()
  await expect(sets).toHaveCount(0)
  await press(page, "Space")
  await expect(sets).toBeVisible()
  expect(await callCount(page, "start_rehearsal")).toBe(0)
  await page.keyboard.press("Escape")
  await expect(sets).toHaveCount(0)

  // Settings: Esc would take you back to the start screen.
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByRole("heading", { name: "Settings", level: 1 })
  await expect(settings).toBeVisible()
  await press(page, "Escape")
  await expect(settings).toBeVisible()
  await page.getByRole("button", { name: "Back", exact: true }).click()

  // The rehearsal screen, no takes yet: Space would record, and Esc would
  // finish the rehearsal without asking.
  await startRehearsal(page)
  await press(page, "Space", "Escape")
  expect(await counts(page, ["start_take", "finish_rehearsal"])).toEqual({
    start_take: 0,
    finish_rehearsal: 0,
  })
  await expect(dialog).toHaveCount(0)
  // Nor does the empty strip tell anyone to press Space.
  await expect(page.locator("[data-slot='empty-description']")).toHaveText(
    "Press Record take. Each take shows up here, ready to play."
  )

  // Recording: Space would stop the take.
  await page.getByRole("button", { name: /Record take 1/ }).click()
  const clock = page.locator("[role=timer]")
  await expect(clock).toBeVisible()
  await press(page, "Space", "Escape")
  expect(await callCount(page, "stop_take")).toBe(0)
  await expect(clock).toBeVisible()

  // The screen after a take: Space would save it, and Esc discard it.
  await page.getByRole("button", { name: /^Stop/ }).click()
  const summary = page.locator("[data-take-summary]")
  await expect(summary).toBeVisible()
  await press(page, "Space", "Escape")
  expect(await counts(page, ["keep_take", "discard_take"])).toEqual({
    keep_take: 0,
    discard_take: 0,
  })
  await expect(summary).toBeVisible()
  await expect(dialog).toHaveCount(0)
})

test("with the player's keys off, the arrows, Home, M, R and ? do nothing", async ({ page }) => {
  const overview = await openEvening(page, withKeys({ player: false }))

  // No take open: down would name the next take after the first song.
  const named = await nextTake(page).inputValue()
  const sent = await callCount(page, "set_next_take_name")
  await press(page, "ArrowDown")
  await expect(nextTake(page)).toHaveValue(named)
  expect(await callCount(page, "set_next_take_name")).toBe(sent)

  // Pałyn 1 open, with three more takes of Pałyn tonight for up and down.
  await firstTake(overview).click()
  const play = page.getByRole("toolbar", { name: "Transport" }).getByRole("button", {
    name: "Play",
    exact: true,
  })
  await expect(play).toBeEnabled()
  const watched = ["player_seek", "player_set_loop", "player_open", "add_take_marker"]
  const before = await counts(page, watched)
  await press(page, "ArrowLeft", "ArrowRight", "Home", "r", "ArrowDown", "ArrowUp", "m", "?")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(await counts(page, watched)).toEqual(before)
  await expect(timeline(page)).toBeVisible()

  // Space is not one of the player's keys: it still plays.
  const plays = await callCount(page, "player_toggle")
  await page.keyboard.press("Space")
  await expect.poll(() => callCount(page, "player_toggle")).toBe(plays + 1)

  // History: down would choose the next rehearsal.
  await page.getByRole("button", { name: "Finish", exact: true }).click()
  const list = await openHistory(page)
  const chosen = list.locator("[aria-current='true']")
  await expect(chosen).toContainText("Tuesday jam")
  await press(page, "ArrowDown")
  await expect(chosen).toContainText("Tuesday jam")
})

test("with the keys off, Esc still closes a dialog and leaves a field, and Ctrl+Z still undoes", async ({
  page,
}) => {
  const overview = await openEvening(page, withKeys({ space: false, player: false }))
  await firstTake(overview).click()
  await expect(timeline(page)).toBeVisible()

  // The player's keys, opened from their button: Esc closes the list, and
  // the take stays open.
  await page.getByRole("button", { name: "Player keys" }).click()
  const list = page.getByRole("dialog", { name: "Keys in the player" })
  await expect(list).toBeVisible()
  // With every key off, the list's line says so, and nothing about typing.
  await expect(list).toHaveAccessibleDescription(
    "Space, Esc and the player's keys are off in Settings › Keys."
  )
  await page.keyboard.press("Escape")
  await expect(list).toHaveCount(0)
  await expect(timeline(page)).toBeVisible()

  // In the Next take field M, R, ? and Space are typed, and do nothing else.
  // The first click selects the whole name, so what is typed replaces it.
  await nextTake(page).click()
  await page.keyboard.type("Mr ?")
  await page.keyboard.press("Space")
  await expect(nextTake(page)).toHaveValue("Mr ? ")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(await callCount(page, "add_take_marker")).toBe(0)

  // Esc leaves the field, and asks nothing.
  await press(page, "Escape")
  await expect(nextTake(page)).not.toBeFocused()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(timeline(page)).toBeVisible()

  // A take discarded on the screen after it: Ctrl+Z brings that screen back.
  await page.getByRole("button", { name: /Record take 11/ }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  const summary = page.locator("[data-take-summary]")
  await expect(summary).toBeVisible()
  await page.getByRole("button", { name: /Discard/ }).click()
  await expect(summary).toHaveCount(0)
  await page.keyboard.press("Control+z")
  await expect(summary).toBeVisible()
})

// Settings › Keys itself, and the chips: off, a key leaves the buttons it
// pressed, and the button stops saying it. Undo's ⌘Z or Ctrl+Z always works,
// so its chip stays.

/** Settings, on its Keys tab. */
async function openKeys(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.locator("nav[aria-label='Settings sections'] [data-tab='keys']").click()
  await expect(page.locator("[data-tab-head] h2")).toHaveText("Keys")
}

/** A group of the Keys tab, and its switch, both named by its title. */
const keysGroup = (page: Page, title: string) => page.getByRole("region", { name: title })
const keysSwitch = (page: Page, title: string) =>
  keysGroup(page, title).getByRole("radiogroup", { name: title })

/** Undo's button, which keeps its key with the others off. */
const UNDO = "[aria-keyshortcuts='Control+Z'], [aria-keyshortcuts='Meta+Z']"

/** No button shows a key or says one, Undo's apart: no chip seen on a button
 *  (Settings' Back keeps its room unseen, see keyOn), no hint of the arrows
 *  by a field or a list, no aria-keyshortcuts. */
async function noKeysShown(page: Page, where: string) {
  const chips = page.locator(`button:not(${UNDO}) kbd`).filter({ visible: true })
  await expect(chips, `${where}: a chip`).toHaveCount(0)
  await expect(page.locator("[data-song-keys], [data-list-keys]"), `${where}: a hint`).toHaveCount(0)
  await expect(page.locator(`[aria-keyshortcuts]:not(${UNDO})`), `${where}: a key said`).toHaveCount(0)
}

/** Each screen's row of the tab: the screen, then each key with its words. */
const SPACE_ROWS: [string, string[]][] = [
  ["Start screen", ["Space start the rehearsal"]],
  ["Rehearsal", ["Space record a take", "Esc finish"]],
  ["Recording", ["Space stop the take"]],
  ["After a take", ["Space save the take", "Esc discard it"]],
  ["Listening", ["Space play or pause", "Esc close the take"]],
  ["History, Settings", ["Esc back to the start screen"]],
]
const PLAYER_ROWS: [string, string[]][] = [
  ["Rehearsal", ["↑ ↓ next song"]],
  [
    "Listening",
    ["← → 10 seconds", "Home start", "↑ ↓ next take of the song", "M mark", "R repeat", "? keys"],
  ],
  ["History", ["↑ ↓ next in the list"]],
]

/** The keys of "↑ ↓ next song": what comes before the first word. */
const keysOf = (use: string) => {
  const words = use.split(" ")
  return words.slice(0, words.findIndex((w) => /^[a-z0-9]/.test(w)))
}

test("Keys is a tab between Appearance and Controls, two switches over their screens", async ({
  page,
}) => {
  await openApp(page)
  await openKeys(page)
  const tabs = page.locator("nav[aria-label='Settings sections'] [data-tab]")
  await expect(tabs).toHaveText(["Audio", "Folders", "Marks", "Sets", "Appearance", "Keys", "Controls", "Under the hood"])
  await expect(page.locator("[data-tab-head] p")).toHaveText(
    "Keys that work with one press, and when to turn them off"
  )

  const body = page.locator("[data-tab-body]")
  await expect(body.locator("[data-settings-group]")).toHaveCount(2)
  const grey = await colour(page, "--muted-foreground")
  const groups = [
    ["Space and Esc", "Start and stop a take, save or discard it, and finish the rehearsal.", SPACE_ROWS],
    ["The player's keys", "Arrows, Home, M, R and ? in the player; ↑ and ↓ in the lists.", PLAYER_ROWS],
  ] as const
  for (const [title, hint, rows] of groups) {
    const group = keysGroup(page, title)
    await expect(group.locator("h3"), title).toHaveText(title)
    await expect(group.locator("h3 + p"), title).toHaveText(hint)

    // The switch, at the head's right, On.
    const toggle = keysSwitch(page, title)
    await expect(toggle, title).toHaveAttribute("data-variant", "switch")
    await expect(toggle.getByRole("radio"), title).toHaveText(["On", "Off"])
    await expect(toggle.getByRole("radio", { name: "On" }), title).toHaveAttribute("aria-checked", "true")
    const head = (await group.locator("h3").boundingBox())!
    expect((await toggle.boundingBox())!.x, title).toBeGreaterThan(head.x + head.width)

    // A row a screen: its name in grey, then its keys as chips with words.
    const all = group.locator("dl [data-keys-row]")
    await expect(all, title).toHaveCount(rows.length)
    for (const [i, [screen, uses]] of rows.entries()) {
      const row = all.nth(i)
      await expect(row.locator("dt"), screen).toHaveText(screen)
      expect((await style(row.locator("dt"), "color")).color, screen).toBe(grey)
      await expect(row.locator("dd > *"), screen).toHaveText([...uses])
      await expect(row.locator("dd kbd"), screen).toHaveText(uses.flatMap(keysOf))
    }
  }

  // Last, what off does, and what works either way.
  const note = body.getByText("When a switch is off, its keys no longer show on the buttons.")
  await expect(note).toHaveText(
    "When a switch is off, its keys no longer show on the buttons. Undo (Ctrl+Z), and Esc in a window or a field, work either way."
  )
  expect((await style(note, "font-size"))["font-size"]).toBe("12px")
})

test("a switch Python refuses goes back and says why, and the notice goes with Settings", async ({ page }) => {
  await openApp(page, {
    after: "window.pywebview.api.save_keys = async () => ({ok: false, error: 'The settings file is read-only'});",
  })
  await openKeys(page)
  const off = keysSwitch(page, "Space and Esc").getByRole("radio", { name: "Off" })
  await off.click()
  const said = notices(page, "error").filter({ hasText: "The settings file is read-only" })
  await expect(said).toHaveCount(1)
  await expect(keysSwitch(page, "Space and Esc").getByRole("radio", { name: "On" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(startButton(page)).toBeVisible()
  await expect(said).toHaveCount(0)
})

test("Space and Esc switched off is kept after a reload, and Start loses its chip", async ({
  page,
}) => {
  await openApp(page)
  await expect.poll(() => keyOn(startButton(page))).toBe("Space")
  await openKeys(page)
  await settled(page)
  // The screen's title and Back, the tab's head and its groups.
  const boxes = () =>
    page
      .locator("header h1, header button[aria-label='Back'], [data-tab-head], [data-settings-group]")
      .evaluateAll((els) => els.map((e) => JSON.stringify(e.getBoundingClientRect())))
  const before = await boxes()

  const off = keysSwitch(page, "Space and Esc").getByRole("radio", { name: "Off" })
  await off.click()
  await expect(off).toHaveAttribute("aria-checked", "true")
  expect((await calls(page, "save_keys")).map((c) => c.args)).toEqual([["space", false]])
  // The screen stays as it was: only the switch changed.
  expect(await boxes()).toEqual(before)

  // Esc no longer leaves Settings, and Back has no chip for it.
  const settings = page.getByRole("heading", { name: "Settings", level: 1 })
  await press(page, "Escape")
  await expect(settings).toBeVisible()
  const back = page.getByRole("button", { name: "Back", exact: true })
  expect(await keyOn(back)).toBeNull()
  await expect(back).not.toHaveAttribute("aria-keyshortcuts")
  await back.click()

  // Start has no chip, says no key, and Space starts nothing.
  await expect(startButton(page)).toBeVisible()
  expect(await keyOn(startButton(page))).toBeNull()
  await expect(startButton(page)).not.toHaveAttribute("aria-keyshortcuts")
  await press(page, "Space")
  expect(await callCount(page, "start_rehearsal")).toBe(0)

  // Kept by Python: after a reload Space and Esc are off, the player's on.
  await page.reload()
  await expect(startButton(page)).toBeVisible()
  expect(await keyOn(startButton(page))).toBeNull()
  await openKeys(page)
  await expect(
    keysSwitch(page, "Space and Esc").getByRole("radio", { name: "Off" })
  ).toHaveAttribute("aria-checked", "true")
  await expect(
    keysSwitch(page, "The player's keys").getByRole("radio", { name: "On" })
  ).toHaveAttribute("aria-checked", "true")
})

test("with both off, no button shows a key or says one, on any screen", async ({ page }) => {
  await openApp(page, {
    before:
      `window.__FULL_EVENING__ = true; window.__TONIGHT__ = ${JSON.stringify(TONIGHT)};` +
      withKeys({ space: false, player: false }),
  })
  /** Plays the first take `where` has, and waits until it plays. */
  const play = async (where: Locator) => {
    const button = where.locator("button[data-look]:not([disabled])").first()
    await button.click()
    await expect(button).toHaveAttribute("data-look", "playing")
    return button
  }

  // The start screen, and Last time beside it with a take playing.
  await expect(startButton(page)).toBeVisible()
  await noKeysShown(page, "the start screen")
  const playing = await play(page.getByRole("complementary", { name: "Last time" }))
  await noKeysShown(page, "Last time playing")
  await playing.click()

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible()
  await noKeysShown(page, "Settings")
  await page.getByRole("button", { name: "Back", exact: true }).click()

  // The rehearsal, a take of the overview playing, then a take open.
  await startRehearsal(page, TONIGHT.length + 1)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await noKeysShown(page, "the rehearsal")
  await play(overview)
  await noKeysShown(page, "the overview playing")
  await firstTake(overview).click()
  await expect(timeline(page)).toBeVisible()
  await noKeysShown(page, "a take open")

  await page.getByRole("button", { name: /Record take 11/ }).click()
  await expect(page.locator("[role=timer]")).toBeVisible()
  await noKeysShown(page, "recording")
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(page.locator("[data-take-summary]")).toBeVisible()
  await expect(timeline(page)).toBeVisible()
  await noKeysShown(page, "Review")
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.getByRole("button", { name: "Finish", exact: true }).click()

  // History: a rehearsal, a take of it playing, then the take open; a song's
  // page and a label's marks, each with a take playing.
  await openHistory(page)
  const shown = page.locator("[aria-label='Rehearsal overview']")
  await noKeysShown(page, "History")
  await play(shown)
  await noKeysShown(page, "History playing")
  await shown.locator("button[aria-label^='Take 1 Pałyn']").click()
  await expect(timeline(page)).toBeVisible()
  await noKeysShown(page, "a take open in History")
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(timeline(page)).toHaveCount(0)

  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator("[data-song]").first().click()
  await play(page.locator("[data-song-head]"))
  await noKeysShown(page, "a song's page playing")

  await page.getByRole("radio", { name: "Marks", exact: true }).click()
  await page.getByRole("navigation", { name: "Labels" }).getByRole("button").first().click()
  await play(page.locator("[data-marks-part]"))
  await noKeysShown(page, "a label's marks playing")
})

test("with the player's keys off, the player's key list keeps only what still works", async ({
  page,
}) => {
  const overview = await openEvening(page, withKeys({ player: false }))
  // Space and Esc are still on: Record and Finish keep theirs, and the next
  // song's arrows by the field go.
  expect(await keyOn(page.getByRole("button", { name: /Record take 11/ }))).toBe("Space")
  expect(await keyOn(page.getByRole("button", { name: "Finish", exact: true }))).toBe("Esc")
  await expect(page.locator("[data-song-keys]")).toHaveCount(0)

  await firstTake(overview).click()
  const transport = page.getByRole("toolbar", { name: "Transport" })
  await expect(transport.getByRole("button", { name: "Play", exact: true })).toHaveAttribute(
    "aria-keyshortcuts",
    "Space"
  )
  for (const name of ["To start", "Back 10 seconds", "Forward 10 seconds", "Repeat", "Add mark", "Player keys"]) {
    await expect(transport.getByRole("button", { name, exact: true }), name).not.toHaveAttribute(
      "aria-keyshortcuts"
    )
  }
  // No tip names a key that does nothing: not the song's arrows by its
  // number, not R by the region's loop, not ? by the list's button.
  const tip = page.getByRole("tooltip")
  const says = async (button: Locator, words: string) => {
    await button.hover()
    await expect(tip).toHaveText(words)
    await page.mouse.move(0, 0, { steps: 6 })
    await expect(tip).toHaveCount(0)
  }
  const strip = page.getByRole("group", { name: "Take strip" })
  await says(strip.getByRole("button", { name: "Every take of Pałyn" }), "Every take of Pałyn")
  await dragRegion(page, 0.2, 0.4)
  await says(page.getByRole("button", { name: "Loop the region" }), "Repeat it")
  const keys = transport.getByRole("button", { name: "Player keys" })
  await says(keys, "Keys")

  // The list: Space, which still plays, and the wheel's two rows.
  await keys.click()
  const list = page.getByRole("dialog", { name: "Keys in the player" })
  await expect(list.locator("dt")).toHaveText(["Space", "Ctrl + wheel", "Shift + wheel"])
  await expect(list.locator("dd")).toHaveText(["Play / pause", "Zoom in / out", "Along the take"])
  await expect(list).toHaveAccessibleDescription("The player's keys are off in Settings › Keys.")

  // Space and Esc keep their chips through a take: Stop, then Discard and
  // Save take.
  await page.keyboard.press("Escape")
  await expect(list).toHaveCount(0)
  await page.getByRole("button", { name: /Record take 11/ }).click()
  const stop = page.getByRole("button", { name: /^Stop/ })
  await expect(stop).toBeVisible()
  expect(await keyOn(stop)).toBe("Space")
  await stop.click()
  const save = page.getByRole("button", { name: /Save take/ })
  await expect(save).toBeVisible()
  expect(await keyOn(save)).toBe("Space")
  expect(await keyOn(page.getByRole("button", { name: /Discard/ }))).toBe("Esc")
})

test("the Keys tab at 960x680 and 150 % wraps its rows and scrolls nothing sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 })
  await openApp(page, { before: scaled(1.5) })
  await openKeys(page)
  await settled(page)

  const body = page.locator("[data-tab-body]")
  expect(await body.evaluate((e) => e.scrollWidth - e.clientWidth), "the tab").toBe(0)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    "the page"
  ).toBeLessThanOrEqual(0)

  // Every row, its keys and the switch stay inside the group's padding.
  for (const group of await body.locator("[data-settings-group]").all()) {
    const g = (await group.boundingBox())!
    const inner = g.x + g.width - parseFloat((await style(group, "padding-right"))["padding-right"])
    for (const el of await group.locator("[role=radiogroup], [data-keys-row], dd > *").all()) {
      const b = (await el.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(inner + 0.5)
    }
  }

  // The player's Listening row takes more than one line.
  const listening = keysGroup(page, "The player's keys").locator("[data-keys-row]").nth(1)
  const tops = await listening
    .locator("dd > *")
    .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size)
  expect(tops).toBeGreaterThan(1)
})
