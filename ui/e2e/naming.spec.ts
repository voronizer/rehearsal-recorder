import {
  callCount,
  calls,
  expect,
  openApp,
  openHistory,
  recordTake,
  startButton,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// A take is named after the song it is a go at, and the band plays the same
// songs week after week. So wherever a take is named — on the review screen,
// renaming it after, and before it is played — the songs already played are
// there to click, and nobody types a title twice. The fake's repertoire is
// Pałyn, Viasna, Ahoń, Sonca, Dym, Ptuška and Daroha.

const nameField = (page: Page) => page.locator("#take-name")

async function saveAs(page: Page, name: string) {
  await nameField(page).fill(name)
  await page.getByRole("button", { name: /Save take/ }).click()
}

/** The pills under the review screen's field, in the order shown. */
const pills = (page: Page) =>
  page.getByRole("group", { name: "Take name" }).locator("[data-song-choice]")

/** How many rows the pills under a field take, All songs… included. */
const rowsUnder = (page: Page, field: string) =>
  page.evaluate((label) => {
    const group = document.querySelector(`[role=group][aria-label='${label}']`)!
    const tops = [...group.querySelectorAll("[data-song-choice], [data-all-songs]")].map((p) =>
      Math.round(p.getBoundingClientRect().top)
    )
    return new Set(tops).size
  }, field)

test("the songs under the review screen's name: this rehearsal's first, a click fills the field", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  // Nothing played yet tonight: the whole repertoire, the latest played first.
  await expect(pills(page)).toHaveText([
    "Pałyn 1",
    "Viasna 1",
    "Ahoń 1",
    "Sonca 1",
    "Dym 1",
    "Ptuška 1",
    "Daroha 1",
  ])
  await pills(page).filter({ hasText: /^Ahoń 1$/ }).click()
  await expect(nameField(page)).toHaveValue("Ahoń")
  // The click left the keyboard to the screen, so Space saves.
  await page.keyboard.press("Space")
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Ahoń")

  // The next take is another go at it: first, lit, and not offered twice.
  await recordTake(page, 2)
  await expect(nameField(page)).toHaveValue("Ahoń")
  await expect(pills(page).first()).toHaveText("Ahoń 2")
  await expect(pills(page).first()).toHaveAttribute("aria-current", "true")
  await expect(pills(page).filter({ hasText: /^Ahoń 1$/ })).toHaveCount(0)

  // Typing narrows them over every song; the song typed out in full puts
  // them all back; a title nobody has played leaves none in the way.
  await nameField(page).fill("da")
  await expect(pills(page)).toHaveText(["Daroha 1"])
  await nameField(page).fill("Daroha")
  await expect(pills(page).first()).toHaveText("Ahoń 2")
  await expect(pills(page).filter({ hasText: /^Daroha 1$/ })).toHaveAttribute("aria-current", "true")
  await nameField(page).fill("Brand new")
  await expect(pills(page)).toHaveCount(0)
})

test("two rows at most, in any window, and the songs played latest stay", async ({ page }) => {
  // Twenty songs played tonight, one go each: more than two rows hold.
  // (Not "Song number N": the app reads a trailing number as a go count, so
  // every one of those would collapse into a single song's 20th go.)
  const takes = Array.from({ length: 20 }, (_, i) => `Song${i + 1}`)
  await openApp(page)
  await startRehearsal(page)
  for (const [i, name] of takes.entries()) {
    await recordTake(page, i + 1)
    await nameField(page).fill(name)
    await page.getByRole("button", { name: /Save take/ }).click()
  }
  for (const width of [1366, 1024, 960]) {
    await page.setViewportSize({ width, height: 768 })
    await expect.poll(() => rowsUnder(page, "Next take"), { message: `at ${width}` }).toBe(2)
    // The ones kept are the latest played, still in the order played.
    const shown = await page
      .getByRole("group", { name: "Next take" })
      .locator("[data-song-choice]")
      .allTextContents()
    const numbers = shown.map((s) => Number(/(\d+) 2$/.exec(s)![1]))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(numbers.at(-1)).toBe(20)
  }
})

test("a quick click on Record or Save take after a name nothing matches still lands", async ({
  page,
}) => {
  await openApp(page, {
    after:
      "window.pywebview.api.song_choices = async () => ({here: [], other: " +
      "Array.from({length: 30}, (_, i) => ({song: 'Song' + (i + 1), name: 'Song' + (i + 1)}))});",
  })
  await startRehearsal(page)
  await expect.poll(() => rowsUnder(page, "Next take")).toBe(2)

  const field = page.getByRole("textbox", { name: "Next take" })
  await field.fill("Nothing like it")
  const record = page.getByRole("button", { name: /Record take 1/ })
  const recordBox = (await record.boundingBox())!
  await page.mouse.move(recordBox.x + recordBox.width / 2, recordBox.y + 6)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByRole("heading", { level: 1, name: "Nothing like it" })).toBeVisible()

  await page.getByRole("button", { name: /^Stop/ }).click()
  await nameField(page).fill("Still nothing")
  const save = page.getByRole("button", { name: /Save take/ })
  const saveBox = (await save.boundingBox())!
  await page.mouse.move(saveBox.x + saveBox.width / 2, saveBox.y + 6)
  await page.mouse.down()
  await page.mouse.up()
  await expect
    .poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2])
    .toBe("Still nothing")
})

test("a song name longer than the row is cut short, and is still one pill", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  // Long enough that no row this footer could ever be would hold it.
  await nameField(page).fill(
    "A song with a name so long that no footer anywhere could hold it in one line, " +
      "so long in fact that it must wrap more than the width of any take name field " +
      "could ever allow, however wide the window around it might be"
  )
  await page.getByRole("button", { name: /Save take/ }).click()
  const pill = page.getByRole("group", { name: "Next take" }).locator("[data-song-choice]").first()
  const cut = await pill.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(cut).toBe(true)
  expect(await rowsUnder(page, "Next take")).toBeLessThanOrEqual(2)
})

test("with no songs at all, nothing is offered under the field", async ({ page }) => {
  await openApp(page, {
    after: "window.pywebview.api.song_choices = async () => ({here: [], other: []});",
  })
  await startRehearsal(page)
  await expect(page.getByRole("textbox", { name: "Next take" })).toBeVisible()
  await expect(page.locator("[data-song-choice], [data-all-songs]")).toHaveCount(0)
})

test("renaming a take on the rehearsal screen offers the songs, ✕ puts its name back, and Enter renames", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  await recordTake(page, 2)
  await saveAs(page, "Pałyn 2")

  await page.hover("[data-take='2']")
  await page.getByRole("button", { name: "Rename take Pałyn 2" }).click()
  const dialog = page.getByRole("dialog")
  const field = dialog.getByRole("textbox", { name: "Take name" })
  // The take being renamed is not a go of its own: Pałyn is still Pałyn 2.
  await expect(dialog.locator("[data-song-choice]").first()).toHaveText("Pałyn 2")
  await dialog.locator("[data-song-choice]").filter({ hasText: /^Viasna 1$/ }).click()
  await expect(field).toHaveValue("Viasna")
  await expect(field).toBeFocused()
  await dialog.getByRole("button", { name: "Put back “Pałyn”" }).click()
  await expect(field).toHaveValue("Pałyn")
  await expect(field).toBeFocused()
  await field.fill("Viasna")
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  expect((await calls(page, "rename_take")).at(-1)?.args.slice(1)).toEqual([2, "Viasna"])
})

test("renaming a take in history offers what that rehearsal played, as the next go", async ({
  page,
}) => {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await openHistory(page)
  await page.hover("[data-take='3']")
  await page.getByRole("button", { name: "Rename take Take 3" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.locator("[data-song-choice]").nth(0)).toHaveText("Pałyn 3")
  await expect(dialog.locator("[data-song-choice]").nth(1)).toHaveText("Viasna 2")
  expect((await calls(page, "song_choices")).at(-1)?.args).toEqual(["/rec/old", 3])

  const field = dialog.getByRole("textbox", { name: "Take name" })
  await field.fill("Something else")
  await dialog.getByRole("button", { name: "Put back “Take 3”" }).click()
  await expect(field).toHaveValue("Take 3")

  await dialog.locator("[data-song-choice]").filter({ hasText: "Pałyn 3" }).click()
  await dialog.getByRole("button", { name: "Rename" }).click()
  expect((await calls(page, "rename_take")).at(-1)?.args).toEqual(["/rec/old", 3, "Pałyn"])
})

test("All songs… in the Rename take dialog lists every song and fills the dialog's field", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  await recordTake(page, 2)
  await saveAs(page, "Pałyn 2")

  await page.hover("[data-take='2']")
  await page.getByRole("button", { name: "Rename take Pałyn 2" }).click()
  const dialog = page.getByRole("dialog")
  const field = dialog.getByRole("textbox", { name: "Take name" })
  await dialog.getByRole("button", { name: "All songs…" }).click()
  const panel = page.getByRole("dialog", { name: "All songs" })
  await expect(panel).toBeVisible()
  await panel.getByRole("button", { name: "Ptuška" }).click()
  await expect(panel).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(field).toHaveValue("Ptuška")
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  expect((await calls(page, "rename_take")).at(-1)?.args.slice(1)).toEqual([2, "Ptuška"])
})

test.describe("the next take", () => {
  /** The name over Record: one field, and the songs under it. */
  const field = (page: Page) => page.getByRole("textbox", { name: "Next take" })
  const songs = (page: Page) => page.getByRole("group", { name: "Next take" })
  const order = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __CALLS__: { name: string }[] }).__CALLS__.map((c) => c.name)
    )

  test("is named in one field over Record, and keeps its name through a take thrown away", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(field(page)).toHaveValue("Take 1")

    // A song clicked fills the field and names the take; nothing under the
    // pointer moves.
    const viasna = songs(page).getByRole("button", { name: "Viasna 1", exact: true })
    const before = await songs(page).locator("[data-song-choice]").allTextContents()
    const at = (await viasna.boundingBox())!
    await viasna.click()
    await expect(field(page)).toHaveValue("Viasna")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Viasna"])
    expect(await songs(page).locator("[data-song-choice]").allTextContents()).toEqual(before)
    expect((await viasna.boundingBox())!).toEqual(at)

    // ✕ goes back to the name it would have had, and tells Python so.
    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])

    await viasna.click()
    // The click left the keyboard to the screen: Space records.
    await page.keyboard.press("Space")
    await expect(page.getByRole("heading", { level: 1, name: "Viasna" })).toBeVisible()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Viasna")

    // Thrown away, it is played again under the same name.
    await page.getByRole("button", { name: /^Discard/ }).click()
    await expect(field(page)).toHaveValue("Viasna")
    await recordTake(page, 2)
    await expect(nameField(page)).toHaveValue("Viasna")
    await page.getByRole("button", { name: /Save take/ }).click()
    // Kept, it is used up, and the next one follows on from it.
    await expect(field(page)).toHaveValue("Viasna")
    await expect(
      page.getByRole("group", { name: "Next take" }).locator("[data-take-go]")
    ).toHaveText("2")
  })

  test("a name typed is the one recorded, however the field is left", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)

    await field(page).fill("New song")
    await page.keyboard.press("Enter")
    await expect(field(page)).not.toBeFocused()
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["New song"])

    // Typed, and Record clicked straight away: the name reaches Python
    // before the take starts, and the take is recorded under it.
    await field(page).fill("  Another one  ")
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Another one" })).toBeVisible()
    const log = await order(page)
    expect(log.lastIndexOf("set_next_take_name")).toBeLessThan(log.lastIndexOf("start_take"))
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Another one"])
  })

  test("a song picked while typing leaves the field, and only the song is sent, so Space records", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await field(page).fill("Via")
    const sent = await callCount(page, "set_next_take_name")
    await songs(page).getByRole("button", { name: "Viasna 1", exact: true }).click()
    await expect(field(page)).toHaveValue("Viasna")
    await expect(field(page)).not.toBeFocused()
    // What was half typed is not sent on the way out, before or after it.
    await expect
      .poll(async () => (await calls(page, "set_next_take_name")).slice(sent).map((c) => c.args))
      .toEqual([["Viasna"]])
    await page.keyboard.press("Space")
    await expect(page.getByRole("heading", { level: 1, name: "Viasna" })).toBeVisible()
  })

  test("a case-only variant of the fallback settles on the fallback's own spelling", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)

    await field(page).fill("take 1")
    await page.keyboard.press("Enter")
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])
  })

  test("a name of its own, left and come back to, still has every song under it", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    const before = await songs(page).locator("[data-song-choice]").count()

    await field(page).fill("Another one")
    await page.keyboard.press("Enter")
    await expect
      .poll(async () => (await calls(page, "set_next_take_name")).at(-1)?.args)
      .toEqual(["Another one"])

    // Come back to it, without retyping: narrowed from what the field held
    // the first time it got focus, not from the name it settled on.
    await field(page).click()
    await expect(songs(page).locator("[data-song-choice]")).toHaveCount(before)
  })

  test("✕ clicked while focused puts back the fallback without narrowing the pills", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    const before = await songs(page).locator("[data-song-choice]").count()

    await songs(page).getByRole("button", { name: "Viasna 1", exact: true }).click()
    await expect(field(page)).toHaveValue("Viasna")
    await field(page).click()
    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(field(page)).toHaveValue("Take 1")
    await expect(songs(page).locator("[data-song-choice]")).toHaveCount(before)
  })

  test("typing a name nothing matches moves neither the field nor Record", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    const record = page.getByRole("button", { name: /Record take 1/ })
    const fieldAt = (await field(page).boundingBox())!
    const recordAt = (await record.boundingBox())!
    const near = (b: { x: number; y: number }, at: { x: number; y: number }) => {
      expect(Math.abs(b.x - at.x)).toBeLessThan(1)
      expect(Math.abs(b.y - at.y)).toBeLessThan(1)
    }

    // The songs area holds the height it had when focus arrived, so the
    // list emptying out as the name narrows it moves nothing beside it.
    await field(page).fill("Something nobody has played")
    near((await field(page).boundingBox())!, fieldAt)
    near((await record.boundingBox())!, recordAt)

    // And filling again once the name is left does not move it back.
    await page.locator("main").click({ position: { x: 5, y: 5 } })
    near((await field(page).boundingBox())!, fieldAt)
    near((await record.boundingBox())!, recordAt)
  })

  test("a name Python does not take goes back to the one it has, and says so", async ({
    page,
  }) => {
    await openApp(page, {
      after:
        "window.pywebview.api.set_next_take_name = async () => " +
        "({ok: false, error: 'Could not name it'});",
    })
    await startRehearsal(page)
    await field(page).fill("Lost")
    await page.keyboard.press("Enter")
    await expect(field(page)).toHaveValue("Take 1")
    await expect(page.getByText("Could not name it")).toBeVisible()

    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Take 1" })).toBeVisible()
  })

  test("naming the take successfully clears an earlier error", async ({ page }) => {
    await openApp(page, {
      after:
        "let n = 0; window.pywebview.api.set_next_take_name = async () => " +
        "{ n += 1; return n === 1 ? {ok: false, error: 'Could not name it'} : {ok: true}; };",
    })
    await startRehearsal(page)
    await field(page).fill("Lost")
    await page.keyboard.press("Enter")
    await expect(page.getByText("Could not name it")).toBeVisible()

    await field(page).fill("Found")
    await page.keyboard.press("Enter")
    await expect(page.getByText("Could not name it")).toHaveCount(0)
    await expect(field(page)).toHaveValue("Found")
  })

  test("Space types, Escape leaves the field, and an emptied field gets its name back", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await field(page).fill("Pałyn")
    await page.keyboard.press("Space")
    await page.keyboard.type("live")
    await expect(field(page)).toHaveValue("Pałyn live")
    // Escape only leaves the field: it does not finish the rehearsal.
    await page.keyboard.press("Escape")
    await expect(field(page)).not.toBeFocused()
    expect(await callCount(page, "start_take")).toBe(0)
    expect(await callCount(page, "finish_rehearsal")).toBe(0)
    await expect(startButton(page)).toHaveCount(0)
    // What was typed was not lost on the way out.
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Pałyn live"])

    // Emptied, or left as spaces, it is never empty once left.
    await field(page).fill("   ")
    await page.locator("main").click({ position: { x: 5, y: 5 } })
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])
  })
})

test.describe("after Stop", () => {
  // The rehearsal screen has its name field in the panel on the right, and
  // the save screen at the footer's left: Alex chose that for step 6.
  test("the name carries over to the save screen's field, and ✕ puts back the one it would have had", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    const over = page.getByRole("textbox", { name: "Next take" })
    await over.fill("Viasna")
    await page.keyboard.press("Enter")
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Viasna")
    // Over Save take, with a line between it and the buttons.
    await expect(page.locator("footer [data-footer-rule]")).toHaveCount(1)

    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(nameField(page)).toHaveValue("Take 1")
    await page.getByRole("button", { name: /Save take/ }).click()
    expect((await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Take 1")
  })

  test("a song picked while typing leaves the field, so Space saves it", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await nameField(page).fill("Ah")
    await pills(page).filter({ hasText: /^Ahoń 1$/ }).click()
    await expect(nameField(page)).toHaveValue("Ahoń")
    await expect(nameField(page)).not.toBeFocused()
    await page.keyboard.press("Space")
    await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Ahoń")
  })

  test("✕ clicked while typing leaves the field too, so Space saves", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await nameField(page).fill("Half a na")
    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(nameField(page)).toHaveValue("Take 1")
    await expect(nameField(page)).not.toBeFocused()
    await page.keyboard.press("Space")
    await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Take 1")
  })
})

test("All songs… lists every song alphabetically, and a click fills the field and closes it", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameField(page).fill("Viasna")
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.getByRole("button", { name: "All songs…" }).click()
  const panel = page.getByRole("dialog", { name: "All songs" })
  await expect(panel).toBeVisible()
  // Every song, case-blind alphabetical, tonight's as its next go.
  await expect(panel.locator("[data-song-choice]")).toHaveText([
    "Ahoń 1", "Daroha 1", "Dym 1", "Pałyn 1", "Ptuška 1", "Sonca 1", "Viasna 2",
  ])
  await panel.getByRole("button", { name: "Ptuška" }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Next take" })).toHaveValue("Ptuška")
  expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Ptuška"])
  // Closed, it leaves the keyboard to the screen: Space records.
  await page.keyboard.press("Space")
  await expect(page.getByRole("heading", { level: 1, name: "Ptuška" })).toBeVisible()
})

test("All songs… opened while typing leaves the field as it was, and a song picked fills it", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  const field = page.getByRole("textbox", { name: "Next take" })
  await field.fill("Pt")
  const before = await callCount(page, "set_next_take_name")
  await page.getByRole("button", { name: "All songs…" }).click()
  const panel = page.getByRole("dialog", { name: "All songs" })
  await expect(panel).toBeVisible()
  // Opening the list does not steal the field's focus or send what it holds.
  await expect(field).toBeFocused()
  await expect(field).toHaveValue("Pt")
  expect(await callCount(page, "set_next_take_name")).toBe(before)

  await panel.getByRole("button", { name: "Ptuška" }).click()
  await expect(panel).toHaveCount(0)
  await expect(field).toHaveValue("Ptuška")
  await expect(field).not.toBeFocused()
  expect((await calls(page, "set_next_take_name")).slice(before).map((c) => c.args)).toEqual([
    ["Ptuška"],
  ])
  await page.keyboard.press("Space")
  await expect(page.getByRole("heading", { level: 1, name: "Ptuška" })).toBeVisible()
})

test("All songs… draws a song lit or in focus inside its own box, so none of it shows in the next column", async ({
  page,
}) => {
  // The window is WebKit on a Mac, and WebKit paints columns as one strip
  // cut at the columns' height: a ring or an outline under the last song of
  // a column showed at the top of the next one.
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("textbox", { name: "Next take" }).fill("Ahoń")
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "All songs…" }).click()
  const panel = page.getByRole("dialog", { name: "All songs" })
  await expect(panel).toBeVisible()

  const drawnOutside = (el: Element) => {
    const cs = getComputedStyle(el)
    const shadows = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/,(?![^(]*\))/)
    const shadow = shadows.some((s) => !s.includes("inset") && !s.includes("rgba(0, 0, 0, 0)"))
    const width = parseFloat(cs.outlineWidth)
    const outline = cs.outlineStyle !== "none" && width > 0 && parseFloat(cs.outlineOffset) > -width
    return shadow || outline
  }
  const lit = panel.locator("[aria-current=true]")
  await expect(lit).toHaveText("Ahoń 1")
  expect(await lit.evaluate(drawnOutside)).toBe(false)

  // In focus from the keyboard.
  await page.keyboard.press("Shift")
  const other = panel.getByRole("button", { name: "Daroha" })
  await other.focus()
  expect(await other.evaluate((el) => el.matches(":focus-visible"))).toBe(true)
  expect(await other.evaluate(drawnOutside)).toBe(false)
})

test("the field holds the song's title, and the go beside it follows what is typed", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  const next = page.locator("#next-take-name")
  const go = page.getByRole("group", { name: "Next take" }).locator("[data-take-go]")
  await expect(next).toHaveValue("Pałyn")
  await expect(go).toHaveText("2")
  await next.fill("Viasna")
  await expect(go).toHaveText("1")
  await next.fill("Take 7")
  await expect(go).toHaveCount(0)
})

test("a pill puts only the song's title in the field", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  await recordTake(page, 2)
  await expect(pills(page).first()).toHaveText("Pałyn 2")
  await pills(page).filter({ hasText: /^Viasna/ }).click()
  await expect(nameField(page)).toHaveValue("Viasna")
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Viasna")
})

// Tonight's takes, apart from Pałyn's go from before tonight in the panel.
const overview = (page: Page) => page.locator("[aria-label='Rehearsal overview']")

test("a take is shown as its song with the go beside it, from 1", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  await expect(overview(page).getByRole("button", { name: /^Take 1 Pałyn 1/ })).toContainText("Pałyn 1")
  await page.keyboard.press("Space")
  await expect(page.getByRole("heading", { name: "Pałyn 2" })).toBeVisible()
})

test("until the songs are in, the go beside the field is Python's, never a guess of 1", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  await expect(overview(page).getByRole("button", { name: /^Take 1 Pałyn 1/ })).toBeVisible()
  await recordTake(page, 2)
  // song_choices is held from here: the next Rehearsal mounts without it.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & {
      __HOLD__?: Record<string, Promise<void>>
    }
    w.__HOLD__ = w.__HOLD__ || {}
    w.__HOLD__.song_choices = new Promise((r) => {
      w.__RELEASE_song_choices = r
    })
  })
  await page.getByRole("button", { name: /Save take/ }).click()
  const next = page.getByRole("textbox", { name: "Next take" })
  await expect(next).toHaveValue("Pałyn")
  const go = page.getByRole("group", { name: "Next take" }).locator("[data-take-go]")
  // Pałyn has been gone at twice: this is the third.
  await expect(go).toHaveText("3")
  await page.keyboard.press("Space")
  await expect(page.getByRole("heading", { level: 1, name: "Pałyn 3" })).toBeVisible()
  await page.evaluate(() => (window as unknown as { __RELEASE_song_choices: () => void }).__RELEASE_song_choices())
})

test("the go sits apart from the title, not run into it", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Pałyn")
  const take = overview(page).getByRole("button", { name: /^Take 1 Pałyn 1/ })
  const title = await take.locator("[data-go-title]").boundingBox()
  // The go's box starts with its space, so measure where its digit is drawn.
  const digitX = await take.locator("[data-go]").evaluate((el) => {
    const text = el.lastChild as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, text.length)
    return range.getBoundingClientRect().x
  })
  expect(digitX - (title!.x + title!.width)).toBeGreaterThan(2)
})
