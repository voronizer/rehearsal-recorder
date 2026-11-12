import {
  callCount,
  calls,
  colour,
  EDGE,
  closeTake,
  expect,
  expectedError,
  GIG,
  holdFor,
  letThrough,
  notices,
  openApp,
  recordTake,
  startButton,
  startRehearsal,
  style,
  test,
  waitingFor,
  withSets,
  recordButton,
} from "./app.ts"
import type { SetSeed } from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// Song sets (issue #12 step 8): a set is a named list of songs in order,
// kept in the library and picked beside Start rehearsal.

type Bridge = {
  pywebview: { api: Record<string, (...a: unknown[]) => Promise<unknown>> }
}

/** A call straight into the fake Python side. */
const py = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) => (window as unknown as Bridge).pywebview.api[n as string](...(a as unknown[])),
    [name, args] as const
  )

test("sets made through the bridge come back in order", async ({ page }) => {
  await openApp(page)
  await py(page, "add_set", "Gig at Hrodna", ["Pałyn", "Viasna", "Ahoń"])
  await py(page, "add_set", "New songs", ["Kalyханka", "Dym"])
  const sets = (await py(page, "list_sets")) as {
    id: number
    name: string
    songs: { title: string; new: boolean }[]
  }[]
  expect(sets.map((s) => s.name)).toEqual(["Gig at Hrodna", "New songs"])
  expect(sets[0].songs.map((x) => x.title)).toEqual(["Pałyn", "Viasna", "Ahoń"])
  expect(sets[1].songs).toEqual([
    { title: "Kalyханka", new: true },
    { title: "Dym", new: false },
  ])
})

// ---------- the rehearsal screen: the set, then the other songs ----------

const field = (page: Page) => page.getByRole("textbox", { name: "Next take" })
const card = (page: Page) => page.locator("[data-set-card]")
const setRows = (page: Page) => card(page).locator("[data-set-song]")
const setRow = (page: Page, title: string) => page.locator(`[data-set-song="${title}"]`)
const list = (page: Page) => page.locator("[data-song-list]")
const rows = (page: Page) => list(page).locator("[data-song-row]")
const row = (page: Page, title: string) => page.locator(`[data-song-row="${title}"]`)
const titlesOf = (loc: ReturnType<typeof rows>, attr: string) =>
  loc.evaluateAll((els, a) => els.map((e) => e.getAttribute(a as string)), attr)

async function keep(page: Page, n: number) {
  await recordTake(page, n)
  await closeTake(page)
  await expect(recordButton(page, n + 1)).toBeVisible()
}

test.describe("on the rehearsal screen", () => {
  test("the set card lists the set in order with the first song lit and the second next", async ({
    page,
  }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    // The evening's first take is the set's first song (R3).
    await expect(field(page)).toHaveValue("Pałyn")
    await expect(card(page)).toContainText("Gig on the 25th")
    await expect(card(page)).toContainText("0 of 4 played")
    expect(await titlesOf(setRows(page), "data-set-song")).toEqual([
      "Pałyn",
      "Viasna",
      "Ahoń",
      "Sonca",
    ])
    await expect(setRow(page, "Pałyn")).toHaveAttribute("aria-current", "true")
    await expect(setRow(page, "Viasna")).toContainText("next")
    await expect(setRows(page).filter({ hasText: "next" })).toHaveCount(1)
  })

  test("a click on a row names the next take after it and rows keep their places", async ({
    page,
  }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    const at = (await setRow(page, "Sonca").boundingBox())!
    await setRow(page, "Ahoń").click()
    await expect(field(page)).toHaveValue("Ahoń")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Ahoń"])
    await expect(setRow(page, "Ahoń")).toHaveAttribute("aria-current", "true")
    await expect(setRow(page, "Pałyn")).not.toHaveAttribute("aria-current", "true")
    await expect(setRow(page, "Sonca")).toContainText("next")
    expect(await titlesOf(setRows(page), "data-set-song")).toEqual([
      "Pałyn",
      "Viasna",
      "Ahoń",
      "Sonca",
    ])
    expect((await setRow(page, "Sonca").boundingBox())!).toEqual(at)

    // And back: the set's first song is the name the take had anyway.
    await setRow(page, "Pałyn").click()
    await expect(field(page)).toHaveValue("Pałyn")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])
  })

  test("a song played tonight has a check and its goes", async ({ page }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    await keep(page, 1)
    // The next take follows the one before it: Pałyn again.
    await expect(field(page)).toHaveValue("Pałyn")
    await expect(setRow(page, "Pałyn")).toContainText("1 take")
    await expect(card(page)).toContainText("1 of 4 played")
    await keep(page, 2)
    await expect(setRow(page, "Pałyn")).toContainText("2 takes")
    // Lit, the row has no check; another song lit, it has.
    await expect(setRow(page, "Pałyn").locator("[data-played-check]")).toHaveCount(0)
    await setRow(page, "Viasna").click()
    await expect(setRow(page, "Pałyn").locator("[data-played-check]")).toHaveCount(1)
    await expect(setRow(page, "Viasna")).not.toContainText("take")
  })

  test("next is the first unplayed set song while the field names a song outside the set", async ({
    page,
  }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    await keep(page, 1)
    await row(page, "Dym").click()
    await expect(field(page)).toHaveValue("Dym")
    await expect(row(page, "Dym")).toHaveAttribute("aria-current", "true")
    await expect(card(page).locator("[aria-current='true']")).toHaveCount(0)
    await expect(setRows(page).filter({ hasText: "next" })).toHaveText([/Viasna/])

    // A song nobody has played yet, typed: the same.
    await field(page).fill("Novaja")
    await page.keyboard.press("Enter")
    await expect(setRows(page).filter({ hasText: "next" })).toHaveText([/Viasna/])
  })

  test("a set song nobody has played yet, picked and recorded, is played", async ({ page }) => {
    await openApp(page, { before: withSets([{ ...GIG, songs: ["Pałyn", "Novaja"] }]) })
    await startRehearsal(page)
    await setRow(page, "Novaja").click()
    await expect(field(page)).toHaveValue("Novaja")
    await keep(page, 1)
    await expect(field(page)).toHaveValue("Novaja")
    await expect(setRow(page, "Novaja")).toContainText("1 take")
    await expect(card(page)).toContainText("1 of 2 played")
    await setRow(page, "Pałyn").click()
    await expect(setRow(page, "Novaja").locator("[data-played-check]")).toHaveCount(1)
  })

  test("a set with no songs says so and nothing else", async ({ page }) => {
    await openApp(page, { before: withSets([{ ...GIG, songs: [] }]) })
    await startRehearsal(page)
    await expect(card(page)).toContainText("0 of 0 played")
    await expect(card(page).locator("[data-slot='empty']")).toHaveText(
      "This set has no songs yet. Add them in Settings › Sets."
    )
    await expect(rows(page)).toHaveCount(5)
  })

  test("a set naming a song twice, by an old name or a go, lists it once", async ({ page }) => {
    const twice = { ...GIG, songs: ["Pałyn", "Palyn", "Viasna 2", "Viasna"] }
    await openApp(page, {
      before: withSets([twice], 1, `window.__OLD_NAMES__ = [["Palyn", "Pałyn"]];`),
    })
    await startRehearsal(page)
    expect(await titlesOf(setRows(page), "data-set-song")).toEqual(["Pałyn", "Viasna"])
    await expect(card(page)).toContainText("0 of 2 played")
    await page.keyboard.press("ArrowDown")
    await expect(field(page)).toHaveValue("Viasna")
  })

  test("other songs leave out the set, five show, All N songs opens the rest and Fewer folds them", async ({
    page,
  }) => {
    await openApp(page, {
      before: withSets(
        [{ id: 1, name: "Short", songs: ["Pałyn"] }],
        1,
        `window.__MORE_SONGS__ = ["Opus", "Kupalle"];`
      ),
    })
    await startRehearsal(page)
    await expect(list(page)).toContainText("Other songs")
    expect(await titlesOf(rows(page), "data-song-row")).toEqual([
      "Viasna",
      "Ahoń",
      "Sonca",
      "Dym",
      "Ptuška",
    ])
    const more = list(page).locator("[data-songs-more]")
    await expect(more).toHaveText(/All 8 songs/)
    await more.click()
    expect(await titlesOf(rows(page), "data-song-row")).toEqual([
      "Viasna",
      "Ahoń",
      "Sonca",
      "Dym",
      "Ptuška",
      "Daroha",
      "Opus",
      "Kupalle",
    ])
    await expect(more).toHaveText(/Fewer/)
    await more.click()
    await expect(rows(page)).toHaveCount(5)

    // The song the field names shows even when it is past the five.
    await field(page).fill("Kupalle")
    await page.keyboard.press("Enter")
    expect(await titlesOf(rows(page), "data-song-row")).toEqual([
      "Viasna",
      "Ahoń",
      "Sonca",
      "Dym",
      "Ptuška",
      "Kupalle",
    ])
    await expect(row(page, "Kupalle")).toHaveAttribute("aria-current", "true")
  })

  test("the list stays open after a take is recorded and kept", async ({ page }) => {
    await openApp(page, {
      before: withSets(
        [{ id: 1, name: "Short", songs: ["Pałyn"] }],
        1,
        `window.__MORE_SONGS__ = ["Opus", "Kupalle"];`
      ),
    })
    await startRehearsal(page)
    await list(page).locator("[data-songs-more]").click()
    await expect(rows(page)).toHaveCount(8)
    await keep(page, 1)
    await expect(rows(page)).toHaveCount(8)
    await expect(list(page).locator("[data-songs-more]")).toHaveText(/Fewer/)
  })

  test("with no set the list is called Songs and has every song", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(field(page)).toHaveValue("Take")
    await expect(card(page)).toHaveCount(0)
    await expect(list(page)).toContainText("Songs")
    await expect(list(page)).not.toContainText("Other songs")
    await expect(rows(page).locator("[aria-current='true']")).toHaveCount(0)
    await list(page).locator("[data-songs-more]").click()
    expect(await titlesOf(rows(page), "data-song-row")).toEqual([
      "Pałyn",
      "Viasna",
      "Ahoń",
      "Sonca",
      "Dym",
      "Ptuška",
      "Daroha",
    ])
    // Tonight's songs first, then the rest: a song played moves up.
    await row(page, "Dym").click()
    await keep(page, 1)
    expect((await titlesOf(rows(page), "data-song-row"))[0]).toBe("Dym")
    await expect(row(page, "Dym")).toContainText("1 take")
  })

  test("typing narrows the list over all songs, an old name shows its song alone, nothing matching says so", async ({
    page,
  }) => {
    await openApp(page, {
      before: `window.__OLD_NAMES__ = [["Palyn", "Pałyn"]];`,
    })
    await startRehearsal(page)
    await field(page).fill("Dar")
    expect(await titlesOf(rows(page), "data-song-row")).toEqual(["Daroha"])
    await expect(list(page).locator("[data-songs-more]")).toHaveCount(0)

    await field(page).fill("Palyn")
    expect(await titlesOf(rows(page), "data-song-row")).toEqual(["Pałyn"])
    await expect(row(page, "Pałyn")).toHaveAttribute("aria-current", "true")

    await field(page).fill("Novaja")
    await expect(rows(page)).toHaveCount(0)
    await expect(list(page)).toContainText(
      "No song has “Novaja” in it. The take makes it a new one."
    )
  })

  test("a long old name typed is said in two lines at most, over the set's name only", async ({
    page,
  }) => {
    const old = "Some very long old name of a song that was renamed"
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page, {
      before: withSets([GIG], 1, `window.__OLD_NAMES__ = [[${JSON.stringify(old)}, "Pałyn"]];`),
    })
    await startRehearsal(page)
    await field(page).click()
    await field(page).fill(old)
    const said = page.locator("[data-old-name]")
    await expect(said.getByRole("button", { name: `Make ${old} a new song` })).toBeVisible()
    // The box it floats in, over the set card.
    const bottom = await said.evaluate((el) => el.parentElement!.getBoundingClientRect().bottom)
    const firstRow = (await setRows(page).first().boundingBox())!
    expect(bottom).toBeLessThanOrEqual(firstRow.y)
  })

  test("the list keeps its height while the field is typed in", async ({ page }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    const cardAt = (await card(page).boundingBox())!
    const listAt = (await list(page).boundingBox())!
    await field(page).click()
    await page.keyboard.type("zz")
    await expect(rows(page)).toHaveCount(0)
    const cardNow = (await card(page).boundingBox())!
    const listNow = (await list(page).boundingBox())!
    expect(Math.abs(cardNow.y - cardAt.y)).toBeLessThan(1)
    expect(Math.abs(cardNow.height - cardAt.height)).toBeLessThan(1)
    expect(Math.abs(listNow.y - listAt.y)).toBeLessThan(1)
    expect(Math.abs(listNow.height - listAt.height)).toBeLessThan(1)
  })
})

// ---------- the start screen: the set beside Start rehearsal ----------

test.describe("on the start screen", () => {
  const picker = (page: Page) => page.locator("[data-set-picker]")
  const menu = (page: Page) => page.getByRole("menu", { name: "Sets" })
  const SHORT_SET: SetSeed = { id: 2, name: "Short", songs: ["Dym"] }
  const onlySets = (sets: SetSeed[]) => `window.__SETS__ = ${JSON.stringify(sets)};`

  test("No set by default and the menu lists the sets with song counts", async ({ page }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await expect(picker(page)).toHaveText(/No set/)
    await picker(page).click()
    const items = menu(page).getByRole("menuitemradio")
    await expect(items).toHaveText([
      /No set: play freely/,
      /Gig on the 25th\s*4 songs/,
      /Short\s*1 song/,
    ])
    await expect(items.first()).toHaveAttribute("aria-checked", "true")
    await expect(menu(page).getByRole("menuitem", { name: "New set…" })).toBeVisible()
    // Beside Start rehearsal, as tall as it.
    const start = (await startButton(page).boundingBox())!
    const at = (await picker(page).boundingBox())!
    expect(at.x + at.width).toBeLessThanOrEqual(start.x)
    expect(at.height).toBeCloseTo(start.height, 0)
  })

  test("choosing a set is kept across a reload", async ({ page }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await picker(page).click()
    await menu(page)
      .getByRole("menuitemradio", { name: /Gig on the 25th/ })
      .click()
    await expect(menu(page)).toHaveCount(0)
    await expect(picker(page)).toHaveText(/Gig on the 25th/)
    expect((await calls(page, "save_next_set")).at(-1)?.args).toEqual([1])
    await page.reload()
    await expect(picker(page)).toHaveText(/Gig on the 25th/)
    await picker(page).click()
    await expect(
      menu(page).getByRole("menuitemradio", { name: /Gig on the 25th/ })
    ).toHaveAttribute("aria-checked", "true")
    await menu(page)
      .getByRole("menuitemradio", { name: /No set/ })
      .click()
    expect((await calls(page, "save_next_set")).at(-1)?.args).toEqual([null])
    await expect(picker(page)).toHaveText(/No set/)
  })

  /** The shared tip a cut name shows whole in (B6): the open one, since a tip
   *  that has just closed fades out for 220 ms beside the next. */
  const tip = (page: Page) => page.locator("[data-whole][data-state$='open']")
  /** The pointer off to the window's corner, as a hand moves it. */
  const away = (page: Page) => page.mouse.move(0, 0, { steps: 8 })

  test("a long set name is cut, and whole on hover and on keyboard focus", async ({ page }) => {
    const long = "The songs for the long gig in the club"
    await openApp(page, { before: withSets([{ id: 1, name: long, songs: ["Dym"] }]) })
    const name = picker(page).locator("[data-set-name]")
    await expect(name).toHaveText(long)
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    // In the shared tip, not the browser's own.
    await expect(picker(page)).not.toHaveAttribute("title")
    await picker(page).hover()
    await expect(tip(page)).toHaveText(long)
    await away(page)
    await expect(tip(page)).toHaveCount(0)
    // The keys reach the button, and its tip shows at once.
    await page.locator("#rehearsal-name").focus()
    await page.keyboard.press("Tab")
    await expect(picker(page)).toBeFocused()
    await expect(tip(page)).toHaveText(long)

    // In the menu, each cut name the same.
    await page.keyboard.press("Enter")
    const item = menu(page).getByRole("menuitemradio", { name: new RegExp(long) })
    await expect(item).toBeVisible()
    await expect(item).not.toHaveAttribute("title")
    await page.keyboard.press("ArrowDown")
    await expect(item).toBeFocused()
    await expect(tip(page)).toHaveText(long)
    await page.keyboard.press("ArrowUp")
    await expect(tip(page)).toHaveCount(0)
    await item.hover()
    await expect(tip(page)).toHaveText(long)
    await expect(page.locator("[title]")).toHaveCount(0)
  })

  test("a long set picked with the mouse leaves no tip behind", async ({ page }) => {
    const long = "The songs for the long gig in the club"
    await openApp(page, { before: withSets([{ id: 1, name: long, songs: ["Dym"] }], null) })
    await picker(page).click()
    await menu(page).getByRole("menuitemradio", { name: new RegExp(long) }).click()
    await expect(menu(page)).toHaveCount(0)
    await expect(picker(page).locator("[data-set-name]")).toHaveText(long)
    // The menu sends focus back to the button as it shuts, and the mouse
    // put it there: no tip comes with it.
    await expect(picker(page)).toBeFocused()
    await away(page)
    await page.waitForTimeout(800)
    await expect(tip(page)).toHaveCount(0)
  })

  test("New set's cut reason is whole on hover", async ({ page }) => {
    const long = "The songs for the long gig in the club"
    await openApp(page, { before: onlySets([{ id: 1, name: long, songs: ["Dym"] }]) })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    await dialog.getByLabel("Name").fill(long)
    await dialog.locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    await dialog.getByRole("button", { name: "Create set" }).click()
    const line = dialog.locator("p", { hasText: "There is already" })
    const reason = line.getByText(`There is already a set called ${long}`)
    await expect(reason).toBeVisible()
    expect(await reason.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    // In the shared tip, not the browser's own.
    await expect(line).not.toHaveAttribute("title")
    await expect(line.locator("[title]")).toHaveCount(0)
    await reason.hover()
    await expect(tip(page)).toHaveText(`There is already a set called ${long}`)
  })

  test("many sets scroll in the menu", async ({ page }) => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      name: `Set ${i + 1}`,
      songs: ["Dym"],
    }))
    await openApp(page, { before: onlySets(many) })
    await picker(page).click()
    const scrolls = await menu(page).evaluate((el) => {
      const box = el.closest("[data-set-menu]")!
      return box.scrollHeight > box.clientHeight
    })
    expect(scrolls).toBe(true)
    await menu(page)
      .getByRole("menuitemradio", { name: /Set 30/ })
      .click()
    await expect(picker(page)).toHaveText(/Set 30/)
  })

  test("New set makes a set from the start screen and chooses it", async ({ page }) => {
    await openApp(page)
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Name").fill("Gig on the 25th")
    const add = dialog.locator("[data-set-add]")
    await add.getByRole("button", { name: "Viasna" }).click()
    await add.getByRole("button", { name: "Pałyn" }).click()
    // Added, a song leaves the pills.
    await expect(add.getByRole("button", { name: "Viasna" })).toHaveCount(0)
    await dialog.getByRole("textbox", { name: "Another song" }).fill("Novaja")
    await page.keyboard.press("Enter")
    const rowsNow = () =>
      dialog
        .locator("[data-set-editor-song]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-set-editor-song")))
    expect(await rowsNow()).toEqual(["Viasna", "Pałyn", "Novaja"])
    await expect(dialog.locator("[data-set-editor-song='Novaja']")).toContainText("not played yet")
    await expect(dialog.locator("[data-set-editor-song='Pałyn']")).not.toContainText(
      "not played yet"
    )

    // Dragged by its handle to the top.
    const handle = dialog.getByRole("button", { name: "Move Novaja" })
    const top = (await dialog.locator("[data-set-editor-song='Viasna']").boundingBox())!
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(top.x + 20, top.y + 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(rowsNow).toEqual(["Novaja", "Viasna", "Pałyn"])

    // ✕ takes one out.
    await dialog.getByRole("button", { name: "Take Pałyn out" }).click()
    await dialog.getByRole("button", { name: "Create set" }).click()
    await expect(dialog).toHaveCount(0)
    expect((await calls(page, "add_set")).at(-1)?.args).toEqual([
      "Gig on the 25th",
      ["Novaja", "Viasna"],
    ])
    await expect(picker(page)).toHaveText(/Gig on the 25th/)
    expect((await calls(page, "save_next_set")).at(-1)?.args).toEqual([1])
    expect(await callCount(page, "start_rehearsal")).toBe(0)
  })

  test("New set's cross on the start screen raises no notice", async ({ page }) => {
    await openApp(page, { before: onlySets([SHORT_SET]) })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    const add = dialog.locator("[data-set-add]")
    await add.getByRole("button", { name: "Viasna" }).click()
    await add.getByRole("button", { name: "Pałyn" }).click()
    // Nothing is kept until Create set, so there is nothing to undo.
    await dialog.getByRole("button", { name: "Take Pałyn out" }).click()
    await expect(dialog.locator("[data-set-editor-song]")).toHaveCount(1)
    await expect(notices(page)).toHaveCount(0)
    expect(await callCount(page, "update_set")).toBe(0)
    // Taken out to the last, it says it has no songs, as in Settings.
    await dialog.getByRole("button", { name: "Take Viasna out" }).click()
    await expect(dialog.locator("[data-slot=empty-title]")).toHaveText("No songs yet")
    await expect(notices(page)).toHaveCount(0)
  })

  test("Enter in New set's name is Create set, once it has a name and a song", async ({ page }) => {
    await openApp(page, { before: onlySets([SHORT_SET]) })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    const name = dialog.getByLabel("Name")
    await expect(name).toBeFocused()
    // Not ready: no song yet, so Enter does nothing.
    await name.fill("Long")
    await page.keyboard.press("Enter")
    await expect(dialog).toBeVisible()
    expect(await callCount(page, "add_set")).toBe(0)
    await dialog.locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    await name.focus()
    await page.keyboard.press("Enter")
    await expect(dialog).toHaveCount(0)
    expect((await calls(page, "add_set")).at(-1)?.args).toEqual(["Long", ["Dym"]])
    await expect(picker(page)).toHaveText(/Long/)
  })

  test("Create set needs a name and a song", async ({ page }) => {
    await openApp(page, { before: onlySets([SHORT_SET]) })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    const create = dialog.getByRole("button", { name: "Create set" })
    await expect(create).toBeDisabled()
    await dialog.getByLabel("Name").fill("short")
    await expect(create).toBeDisabled()
    await dialog.locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    await expect(create).toBeEnabled()
    // A name another set has is refused, and the window says so.
    await create.click()
    await expect(dialog).toContainText("There is already a set called Short")
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Name").fill("Long")
    await expect(dialog).not.toContainText("There is already")
    await create.click()
    await expect(dialog).toHaveCount(0)
    await expect(picker(page)).toHaveText(/Long/)
  })

  test("New set stays where it opened as its songs come in and are added", async ({ page }) => {
    await openApp(page, {
      before:
        "window.__HOLD__ = {song_choices: new Promise((r) => { window.__RELEASE__ = r })};",
    })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    const name = dialog.getByLabel("Name")
    await expect(name).toBeVisible()
    await page.waitForTimeout(300)
    const at = (await name.boundingBox())!
    await page.evaluate(() => (window as unknown as { __RELEASE__: () => void }).__RELEASE__())
    const add = dialog.locator("[data-set-add]")
    await expect(add.getByRole("button", { name: "Viasna" })).toBeVisible()
    await page.waitForTimeout(300)
    expect((await name.boundingBox())!).toEqual(at)
    await add.getByRole("button", { name: "Viasna" }).click()
    await add.getByRole("button", { name: "Dym" }).click()
    await page.waitForTimeout(300)
    expect((await name.boundingBox())!).toEqual(at)
  })

  test("in New set a refused name leaves the songs where they were", async ({ page }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    await dialog.getByLabel("Name").fill("short")
    await dialog.locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    const songs = dialog.getByText("Songs, in the order you play them")
    const at = (await songs.boundingBox())!
    await dialog.getByRole("button", { name: "Create set" }).click()
    await expect(dialog).toContainText("There is already a set called Short")
    expect((await songs.boundingBox())!).toEqual(at)
  })

  test("when the bridge fails, Create set says so and can be pressed again", async ({
    page,
    pageErrors,
  }) => {
    await openApp(page, {
      after:
        "const real = window.pywebview.api.add_set; let failed = false;" +
        "window.pywebview.api.add_set = (...a) => failed ? real(...a) :" +
        " (failed = true, Promise.reject(new Error('bridge')));",
    })
    await picker(page).click()
    await menu(page).getByRole("menuitem", { name: "New set…" }).click()
    const dialog = page.getByRole("dialog", { name: "New set" })
    const create = dialog.getByRole("button", { name: "Create set" })
    await dialog.getByLabel("Name").fill("Long")
    await dialog.locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    await create.click()
    // What failed, as the bridge tells it (lib/api.ts), and the window stays.
    await expect(dialog).toContainText("Error: bridge")
    await expect(create).toBeEnabled()
    await create.click()
    await expect(dialog).toHaveCount(0)
    await expect(picker(page)).toHaveText(/Long/)
    expectedError(pageErrors, /add_set failed/)
  })

  test("when the choice cannot be kept, the start screen still shows it", async ({
    page,
    pageErrors,
  }) => {
    await openApp(page, {
      before: onlySets([GIG, SHORT_SET]),
      after: "window.pywebview.api.save_next_set = () => Promise.reject(new Error('bridge'));",
    })
    await picker(page).click()
    await menu(page).getByRole("menuitemradio", { name: /Short/ }).click()
    await expect(picker(page)).toHaveText(/Short/)
    await expect.poll(() => pageErrors.some((e) => /save_next_set failed/.test(e))).toBe(true)
    await page.waitForTimeout(200)
    expectedError(pageErrors, /save_next_set failed/)
  })

  test("after a set is picked with the mouse, Space starts the rehearsal", async ({ page }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await picker(page).click()
    await menu(page).getByRole("menuitemradio", { name: /Short/ }).click()
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press("Space")
    await expect(recordButton(page, 1)).toBeVisible()
    expect((await calls(page, "start_rehearsal")).at(-1)?.args[5]).toBe(2)
  })

  test("after the menu is opened and shut with the mouse, Space starts the rehearsal", async ({
    page,
  }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await picker(page).click()
    await expect(menu(page)).toBeVisible()
    await picker(page).click({ force: true })
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press("Space")
    await expect(recordButton(page, 1)).toBeVisible()
  })

  test("Space on the set button reached with the keyboard opens the menu", async ({ page }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await picker(page).focus()
    await page.keyboard.press("Space")
    await expect(menu(page)).toBeVisible()
    expect(await callCount(page, "start_rehearsal")).toBe(0)
  })

  test("Start sends the chosen set", async ({ page }) => {
    await openApp(page, { before: onlySets([GIG, SHORT_SET]) })
    await picker(page).click()
    await menu(page).getByRole("menuitemradio", { name: /Short/ }).click()
    await startRehearsal(page)
    expect((await calls(page, "start_rehearsal")).at(-1)?.args[5]).toBe(2)
    await expect(page.locator("[data-set-card]")).toContainText("Short")
  })

  test("a deleted chosen set reads No set", async ({ page }) => {
    await openApp(page, { before: withSets([GIG], 5) })
    await expect(picker(page)).toHaveText(/No set/)
    await startRehearsal(page)
    expect((await calls(page, "start_rehearsal")).at(-1)?.args[5] ?? null).toBeNull()
  })

  // Check the band service: under New set… while takes go to the band
  // service, where the sets are the same (sending/service_sets.py).
  const WITH_KEY = "window.__SERVICE_KEY__ = 'band.example:secret';"
  const checkItem = (page: Page) => menu(page).getByRole("menuitem", { name: "Check the band service" })

  test("the set menu checks the band service", async ({ page }) => {
    await openApp(page, { before: withSets([GIG], 1, WITH_KEY) })
    await picker(page).click()
    const items = menu(page).getByRole("menuitem")
    await expect(items).toHaveText(["New set…", "Check the band service"])
    await expect(checkItem(page).locator("svg.lucide-refresh-cw")).toHaveCount(1)
    await checkItem(page).click()
    await expect(menu(page)).toHaveCount(0)
    expect(await callCount(page, "check_band_service")).toBe(1)
    // Nothing new: it says so, with no lines to See.
    const nothing = notices(page, "done").filter({ hasText: "Nothing new in the band service." })
    await expect(nothing).toBeVisible()
    await expect(nothing.getByRole("button", { name: "See", exact: true })).toHaveCount(0)

    // The band made a set there: the notice says so, and the menu has it.
    await page.evaluate(() => {
      ;(window as unknown as { __CHECK__: unknown }).__CHECK__ = {
        sets: [{ name: "Club gig, 13 December", songs: ["Dym"] }],
        text: "Ivan changed 1 set in the band service",
      }
    })
    await picker(page).click()
    await checkItem(page).click()
    expect(await callCount(page, "check_band_service")).toBe(2)
    const news = notices(page, "done").filter({ hasText: "Ivan changed 1 set in the band service" })
    await expect(news.getByRole("button", { name: "See", exact: true })).toBeVisible()
    await picker(page).click()
    await expect(menu(page).getByRole("menuitemradio", { name: /Club gig, 13 December/ })).toBeVisible()
  })

  test("no check item without the band service", async ({ page }) => {
    await openApp(page, { before: withSets([GIG]) })
    await picker(page).click()
    await expect(menu(page).getByRole("menuitem", { name: "New set…" })).toBeVisible()
    await expect(checkItem(page)).toHaveCount(0)
  })

  test("a line of the band service about a set reads the sets again", async ({ page }) => {
    await openApp(page, { before: withSets([GIG], 1, WITH_KEY) })
    await expect(picker(page)).toHaveText(/Gig on the 25th/)
    const read = await callCount(page, "list_sets")
    // The sending renamed the set, the service having one with its name,
    // and says so in the list of background work.
    await py(page, "update_set", 1, "Gig on the 25th 2", null)
    await page.evaluate(() => {
      const w = window as unknown as { __ACTIVITY__?: unknown[] }
      w.__ACTIVITY__ = [
        ...(w.__ACTIVITY__ || []),
        {
          id: 990,
          kind: "service",
          title: "Renaming Gig to Gig on the 25th",
          folder: null,
          take_number: null,
          state: "done",
          fraction: 1,
          step: null,
          error: null,
          detail: "Named Gig on the 25th 2: the band service already has a set called Gig on the 25th",
          retry: null,
          seen: false,
        },
      ]
    })
    await expect(picker(page)).toHaveText(/Gig on the 25th 2/)
    expect(await callCount(page, "list_sets")).toBeGreaterThan(read)
  })
})

// ---------- Settings › Sets ----------

test.describe("in Settings", () => {
  const OTHER: SetSeed = { id: 2, name: "New songs", songs: ["Kupalle", "Dym"] }

  async function openSets(page: Page, before = withSets([GIG, OTHER], null)) {
    await openApp(page, { before })
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("button", { name: "Sets", exact: true }).first().click()
  }

  const items = (page: Page) => page.getByRole("list", { name: "Sets" }).locator("[data-set-item]")
  const item = (page: Page, name: string) => page.locator(`[data-set-item="${name}"]`)
  const detail = (page: Page) => page.locator("[data-set-detail]")
  const nameField = (page: Page) => detail(page).getByLabel("Name")
  const songsNow = (page: Page) =>
    detail(page)
      .locator("[data-set-editor-song]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-set-editor-song")))
  const songRow = (page: Page, title: string) =>
    detail(page).locator(`[data-set-editor-song=${JSON.stringify(title)}]`)
  const box = async (el: Locator) => (await el.boundingBox())!
  /** The shared tip a cut name shows whole in, the open one. */
  const tip = (page: Page) => page.locator("[data-whole][data-state$='open']")
  const away = (page: Page) => page.mouse.move(0, 0, { steps: 8 })
  /** The notice whose words are exactly `text`. */
  const said = (page: Page, text: string) =>
    notices(page).filter({
      has: page.locator("p", { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
    })
  /** Until `el`, with the pointer away from it, has this fill: it eases to
   *  it over 200 ms after a click. */
  const filled = async (page: Page, el: Locator, fill: string) => {
    await away(page)
    await expect.poll(async () => (await style(el, "background-color"))["background-color"]).toBe(fill)
  }
  const edgeClear = async (el: Locator) => {
    const edge = await style(el, ...EDGE)
    return ["top", "right", "bottom", "left"].every(
      (side) =>
        edge[`border-${side}-width`] === "0px" || edge[`border-${side}-color`] === "rgba(0, 0, 0, 0)"
    )
  }
  /** At 150 %, over the config withSets wrote. */
  const AT_150 =
    'localStorage.setItem("mock-python-config", JSON.stringify(' +
    '{...JSON.parse(localStorage.getItem("mock-python-config")), ui_scale: 1.5}));'

  // The sixteen sets of the screen's stress case: one with a name of 40
  // letters, and one of 24 songs, among them the 84-letter Kalychanka.
  const KALY =
    "Kalychanka (slow version for the wedding, with the long intro the bride asked for)"
  const BARE = "Dancing barefoot on the roof of the old brewery"
  const LAKE = "Wedding at the lake house, third sitting"
  const BAND = ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška", "Daroha"]
  const MORE = ["Zorka", "Vecharyna", "Ranica", "Kupalle", "Žniŭnaja", "Kalada"]
  const FULL = [
    ...BAND,
    ...MORE,
    BARE,
    KALY,
    ...["Kupalinka", "Siabry", "Charot", "Biarozka", "Maci", "Lasy", "Zima", "Vyshyvanka", "Zvon"],
  ]
  const MANY_SETS: SetSeed[] = [
    { id: 1, name: "Gig on the 25th", songs: BAND.slice(0, 6) },
    {
      id: 2,
      name: "Wedding set",
      songs: [KALY, "Zorka", "Viasna", "Kupalle", "Sonca", "Dym", "Kalada", "Daroha"],
    },
    { id: 3, name: LAKE, songs: [KALY, "Zorka", "Ranica", "Vecharyna", "Ptuška"] },
    { id: 4, name: "Open-air, short", songs: ["Dym", "Ahoń", "Pałyn", "Viasna", "Sonca"] },
    { id: 5, name: "Full night at the brewery", songs: FULL.slice(0, 24) },
    { id: 6, name: "Open-air, long", songs: FULL.slice(0, 12) },
    { id: 7, name: "Acoustic hour", songs: ["Sonca", "Daroha", "Ptuška", "Viasna", "Zorka", "Ranica"] },
    {
      id: 8,
      name: "Christmas party",
      songs: ["Kalada", "Zorka", "Dym", "Ahoń", "Pałyn", "Vecharyna", "Kupalle"],
    },
    {
      id: 9,
      name: "Folk club Friday",
      songs: ["Viasna", "Žniŭnaja", "Kalada", "Sonca", "Ahoń", "Dym", "Ptuška", "Daroha", "Zorka"],
    },
    { id: 10, name: "Warm-up", songs: ["Dym", "Pałyn", "Viasna"] },
    { id: 11, name: "New songs", songs: ["Kupalinka", "Siabry", "Charot", "Biarozka"] },
    { id: 12, name: "Slow ones", songs: ["Daroha", "Sonca", "Maci", "Lasy", "Zima"] },
    { id: 13, name: "Street festival", songs: FULL.slice(0, 9) },
    { id: 14, name: "Radio session", songs: ["Ptuška", "Dym", "Viasna", "Pałyn"] },
    {
      id: 15,
      name: "Kupalle night",
      songs: ["Kupalle", "Kupalinka", "Kalada", "Zorka", "Vyshyvanka", "Zvon", "Ranica", "Vecharyna"],
    },
    { id: 16, name: "Backup set", songs: ["Pałyn", "Viasna", "Ahoń", "Dym"] },
  ]

  test("Settings has a Sets tab after Marks", async ({ page }) => {
    await openSets(page)
    const tabs = await page.locator("nav button").allInnerTexts()
    expect(tabs.indexOf("Sets")).toBe(tabs.indexOf("Marks") + 1)
    await expect(page.getByText("Songs in the order a rehearsal goes through them")).toBeVisible()
    await expect(items(page)).toHaveCount(2)
    await expect(item(page, "Gig on the 25th")).toContainText("4 songs")
    await expect(item(page, "New songs")).toContainText("2 songs")
    // The first is open beside them, lit in the list.
    await expect(item(page, "Gig on the 25th")).toHaveAttribute("aria-current", "true")
    await expect(nameField(page)).toHaveValue("Gig on the 25th")
    expect(await songsNow(page)).toEqual(["Pałyn", "Viasna", "Ahoń", "Sonca"])
    await item(page, "New songs").click()
    await expect(nameField(page)).toHaveValue("New songs")
    await expect(item(page, "New songs")).toHaveAttribute("aria-current", "true")
  })

  test("New set adds New set and New set 2 and chooses it", async ({ page }) => {
    await openSets(page)
    const add = page.getByRole("button", { name: "New set", exact: true })
    await add.click()
    await expect(item(page, "New set")).toHaveAttribute("aria-current", "true")
    await expect(nameField(page)).toHaveValue("New set")
    await expect(item(page, "New set")).toContainText("0 songs")
    await add.click()
    await expect(item(page, "New set 2")).toHaveAttribute("aria-current", "true")
    expect((await calls(page, "add_set")).map((c) => c.args)).toEqual([
      ["New set", []],
      ["New set 2", []],
    ])
    // Not what Start plays by: that is chosen beside it.
    expect(await callCount(page, "save_next_set")).toBe(0)
  })

  test("a name is saved on Enter and on leaving, a taken name is refused with the reason", async ({
    page,
  }) => {
    await openSets(page)
    await nameField(page).fill("Gig at Hrodna")
    await page.keyboard.press("Enter")
    await expect(item(page, "Gig at Hrodna")).toBeVisible()
    await expect(nameField(page)).not.toBeFocused()
    // Saved once: leaving the field after Enter does not send it again.
    await page.waitForTimeout(200)
    expect((await calls(page, "update_set")).map((c) => c.args)).toEqual([
      [1, "Gig at Hrodna", null],
    ])

    await nameField(page).fill("Gig at Hrodna, Sunday")
    await page.getByText("Songs in the order a rehearsal goes through them").click()
    await expect(item(page, "Gig at Hrodna, Sunday")).toBeVisible()

    await nameField(page).fill("new songs")
    await page.keyboard.press("Enter")
    await expect(detail(page)).toContainText("There is already a set called New songs")
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true")
    await expect(item(page, "Gig at Hrodna, Sunday")).toBeVisible()
    await nameField(page).fill("Gig")
    await expect(detail(page)).not.toContainText("There is already")
  })

  test("a refused name leaves the songs where they were", async ({ page }) => {
    await openSets(page)
    const songs = detail(page).getByText("Songs, in the order you play them")
    const at = (await songs.boundingBox())!
    await nameField(page).fill("new songs")
    await page.keyboard.press("Enter")
    await expect(detail(page)).toContainText("There is already a set called New songs")
    expect((await songs.boundingBox())!).toEqual(at)
  })

  test("songs added, dragged and removed are saved at once", async ({ page }) => {
    await openSets(page)
    await detail(page).locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    expect(await songsNow(page)).toEqual(["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym"])
    expect((await calls(page, "update_set")).at(-1)?.args).toEqual([
      1,
      null,
      ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym"],
    ])
    await expect(item(page, "Gig on the 25th")).toContainText("5 songs")

    const handle = detail(page).getByRole("button", { name: "Move Dym" })
    const top = (await detail(page).locator("[data-set-editor-song='Pałyn']").boundingBox())!
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(top.x + 20, top.y + 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => songsNow(page)).toEqual(["Dym", "Pałyn", "Viasna", "Ahoń", "Sonca"])

    await detail(page).getByRole("button", { name: "Take Viasna out" }).click()
    expect(await songsNow(page)).toEqual(["Dym", "Pałyn", "Ahoń", "Sonca"])

    await page.reload()
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("button", { name: "Sets", exact: true }).first().click()
    await expect.poll(() => songsNow(page)).toEqual(["Dym", "Pałyn", "Ahoń", "Sonca"])
  })

  test("a song not played yet says so", async ({ page }) => {
    await openSets(page)
    await item(page, "New songs").click()
    await expect(detail(page).locator("[data-set-editor-song='Kupalle']")).toContainText(
      "not played yet"
    )
    await expect(detail(page).locator("[data-set-editor-song='Dym']")).not.toContainText(
      "not played yet"
    )
  })

  test("Delete set asks first and the set goes", async ({ page }) => {
    await openSets(page)
    await detail(page).getByRole("button", { name: "Delete set" }).click()
    const ask = page.getByRole("alertdialog", { name: "Delete “Gig on the 25th”?" })
    await expect(ask).toContainText(
      "Rehearsals played by it keep their takes and their names."
    )
    await ask.getByRole("button", { name: "Cancel" }).click()
    await expect(items(page)).toHaveCount(2)
    expect(await callCount(page, "delete_set")).toBe(0)

    await detail(page).getByRole("button", { name: "Delete set" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(items(page)).toHaveCount(1)
    expect((await calls(page, "delete_set")).at(-1)?.args).toEqual([1])
    await expect(nameField(page)).toHaveValue("New songs")
  })

  test("the sets are the shared rows, the chosen one grey with no frame", async ({ page }) => {
    await openSets(page)
    for (const row of await items(page).all()) {
      // Item's own class: the row is the shared one, on a button the keys
      // reach. Its data-slot is the tip's, round it.
      await expect(row).toHaveClass(/(^|\s)group\/item(\s|$)/)
      expect(await row.evaluate((e) => e.tagName)).toBe("BUTTON")
    }
    // A name over its count: the name in 600, the count in 12 px grey.
    const gig = item(page, "Gig on the 25th")
    expect(await style(gig.locator("[data-name]"), "font-weight")).toEqual({ "font-weight": "600" })
    expect(await style(gig.getByText("4 songs"), "font-size", "color")).toEqual({
      "font-size": "12px",
      color: await colour(page, "--muted-foreground"),
    })
    // No tip of the browser's own: a cut name is whole in the shared one.
    await expect(page.locator("[data-tab-body] [title]")).toHaveCount(0)

    const selected = await colour(page, "--selected")
    await expect(gig).toHaveAttribute("aria-current", "true")
    await filled(page, gig, selected)
    expect(await edgeClear(gig)).toBe(true)
    await filled(page, item(page, "New songs"), "rgba(0, 0, 0, 0)")
    await item(page, "New songs").click()
    await expect(item(page, "New songs")).toHaveAttribute("aria-current", "true")
    await expect(gig).not.toHaveAttribute("aria-current")
    await filled(page, item(page, "New songs"), selected)
    await filled(page, gig, "rgba(0, 0, 0, 0)")

    // The set beside them is a group: the card's fill, with no frame.
    await expect(detail(page)).toHaveAttribute("data-slot", "card")
    expect((await style(detail(page), "background-color"))["background-color"]).toBe(
      await colour(page, "--card")
    )
    expect(await edgeClear(detail(page))).toBe(true)
  })

  test("a set's songs on the shared pieces, a cut name whole in its tip", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openSets(page, withSets(MANY_SETS, 5, AT_150))
    await expect(nameField(page)).toHaveValue("Full night at the brewery")
    expect(await songsNow(page)).toEqual(FULL.slice(0, 24))
    for (const title of ["Pałyn", KALY, "Zvon"]) {
      const row = songRow(page, title)
      const move = row.getByRole("button", { name: `Move ${title}`, exact: true })
      const out = row.getByRole("button", { name: `Take ${title} out`, exact: true })
      for (const button of [move, out]) {
        expect(await button.evaluate((e) => e.tagName)).toBe("BUTTON")
        await expect(button).toHaveAttribute("data-variant", "ghost")
        await expect(button).toHaveAttribute("data-size", "icon-tiny")
        // 24 px, at 150 %.
        const b = await box(button)
        expect(b.width, title).toBeCloseTo(36, 0)
        expect(b.height, title).toBeCloseTo(36, 0)
      }
      // The ✕ is round, as the other ✕s are.
      expect(
        await out.evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= e.clientWidth / 2)
      ).toBe(true)
    }
    // The ✕ says what it does in the shared tip.
    const out = songRow(page, "Pałyn").getByRole("button", { name: "Take Pałyn out" })
    await out.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Take it out of the set")
    // For the eyes: the button's name says it, so it is not read out twice.
    await expect(out).toHaveAccessibleDescription("")
    await away(page)
    await expect(page.getByRole("tooltip")).toHaveCount(0)

    // The long name is cut at the end of its room, and whole on hover.
    const name = songRow(page, KALY).locator("[data-cut]")
    await expect(name).toHaveText(KALY)
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await name.hover()
    await expect(tip(page)).toHaveText(KALY)
    await expect(page.locator("[data-tab-body] [title]")).toHaveCount(0)
    // Its row is as tall as the others.
    expect((await box(songRow(page, KALY))).height).toBeCloseTo(
      (await box(songRow(page, "Pałyn"))).height,
      0
    )
  })

  test("16 sets at 960x680 and 150 %: two columns, each scrolling on its own", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openSets(page, withSets(MANY_SETS, 5, AT_150))
    await expect(nameField(page)).toHaveValue("Full night at the brewery")
    const list = page.getByRole("list", { name: "Sets" })
    const listColumn = page.locator("[data-column='list']")
    const setColumn = page.locator("[data-column='set']")
    await expect(items(page)).toHaveCount(16)

    // Side by side: the list's column 13 rem wide, with a quarter rem each
    // side for the focus ring, and the set in the rest.
    const l = await box(list)
    const s = await box(setColumn)
    expect((await box(listColumn)).width).toBeCloseTo(13.5 * 24, 0)
    expect(s.x).toBeGreaterThan(l.x + l.width)
    expect((await box(detail(page))).y).toBeCloseTo(l.y, 0)
    expect(s.width).toBeGreaterThan(400)

    // Each longer than the window, and scrolled on its own.
    for (const column of [listColumn, setColumn]) {
      expect(await column.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
    }
    const head = await box(page.locator("[data-tab-head]"))
    await listColumn.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => listColumn.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    expect(await setColumn.evaluate((e) => e.scrollTop)).toBe(0)
    await setColumn.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => setColumn.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    expect(await page.locator("[data-tab-body]").evaluate((e) => e.scrollTop)).toBe(0)
    expect(await box(page.locator("[data-tab-head]"))).toEqual(head)

    // The 40-letter name is cut, and whole in the shared tip on hover and on
    // keyboard focus.
    const lake = item(page, LAKE)
    const lakeName = lake.locator("[data-name]")
    await expect(lakeName).toHaveText(LAKE)
    await listColumn.evaluate((e) => (e.scrollTop = 0))
    expect(await lakeName.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await lake.hover()
    await expect(tip(page)).toHaveText(LAKE)
    await away(page)
    await expect(tip(page)).toHaveCount(0)
    await item(page, "Wedding set").focus()
    await page.keyboard.press("Tab")
    await expect(lake).toBeFocused()
    await expect(tip(page)).toHaveText(LAKE)
    await page.keyboard.press("Tab")
    await expect(tip(page)).toHaveCount(0)

    // The 16th picked: the list stays where it is, and the set's top is in
    // view, wherever the last set was scrolled to.
    await away(page)
    const last = item(page, "Backup set")
    await listColumn.evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect(last).toBeInViewport()
    const at = await box(last)
    const scrolled = await listColumn.evaluate((e) => e.scrollTop)
    await last.click()
    await expect(nameField(page)).toHaveValue("Backup set")
    await expect(last).toHaveAttribute("aria-current", "true")
    expect(await box(last)).toEqual(at)
    expect(await listColumn.evaluate((e) => e.scrollTop)).toBe(scrolled)
    expect(await setColumn.evaluate((e) => e.scrollTop)).toBe(0)
    const set = await box(detail(page))
    expect(set.y).toBeGreaterThanOrEqual((await box(setColumn)).y - 1)
    await expect(nameField(page)).toBeInViewport()

    // Nothing runs off sideways.
    for (const el of [
      page.locator("html"),
      page.locator("main"),
      page.locator("[data-tab-body]"),
      listColumn,
      setColumn,
    ]) {
      expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    }
  })

  test("a song taken out goes at once, and Undo puts it back in its place", async ({ page }) => {
    await openSets(page)
    const titles = ["Pałyn", "Viasna", "Ahoń", "Sonca"]
    const where = async () => Promise.all(titles.map(async (t) => (await box(songRow(page, t))).y))
    const before = await where()
    await holdFor(page, "update_set", 1)
    await detail(page).getByRole("button", { name: "Take Viasna out" }).click()
    // Gone before Python has answered: the rows after it move up one, and
    // the rows before it stay.
    expect(await songsNow(page)).toEqual(["Pałyn", "Ahoń", "Sonca"])
    await expect(item(page, "Gig on the 25th")).toContainText("3 songs")
    expect((await box(songRow(page, "Pałyn"))).y).toBeCloseTo(before[0], 0)
    expect((await box(songRow(page, "Ahoń"))).y).toBeCloseTo(before[1], 0)
    expect((await box(songRow(page, "Sonca"))).y).toBeCloseTo(before[2], 0)
    expect(await waitingFor(page)).toBe(1)
    // Said once Python has taken it out.
    await expect(notices(page)).toHaveCount(0)
    await letThrough(page)
    const notice = said(page, "“Viasna” was taken out of the set.")
    await expect(notice).toHaveAttribute("data-notice", "done")
    expect((await calls(page, "update_set")).at(-1)?.args).toEqual([1, null, ["Pałyn", "Ahoń", "Sonca"]])

    await notice.getByRole("button", { name: "Undo" }).click()
    await expect.poll(() => songsNow(page)).toEqual(titles)
    expect((await calls(page, "update_set")).at(-1)?.args).toEqual([1, null, titles])
    await expect(item(page, "Gig on the 25th")).toContainText("4 songs")
    expect(await where()).toEqual(before)
    await expect(notices(page)).toHaveCount(0)
  })

  test("Undo after picking another set puts the song back in its own set", async ({ page }) => {
    await openSets(page)
    await detail(page).getByRole("button", { name: "Take Ahoń out" }).click()
    const notice = said(page, "“Ahoń” was taken out of the set.")
    await expect(notice).toHaveCount(1)
    await item(page, "New songs").click()
    await expect(nameField(page)).toHaveValue("New songs")

    await notice.getByRole("button", { name: "Undo" }).click()
    await expect(item(page, "Gig on the 25th")).toContainText("4 songs")
    expect((await calls(page, "update_set")).at(-1)?.args).toEqual([
      1,
      null,
      ["Pałyn", "Viasna", "Ahoń", "Sonca"],
    ])
    // New songs is still the set shown, as it was.
    await expect(item(page, "New songs")).toHaveAttribute("aria-current", "true")
    await expect(nameField(page)).toHaveValue("New songs")
    expect(await songsNow(page)).toEqual(["Kupalle", "Dym"])
    await expect(item(page, "New songs")).toContainText("2 songs")
    await item(page, "Gig on the 25th").click()
    expect(await songsNow(page)).toEqual(["Pałyn", "Viasna", "Ahoń", "Sonca"])
  })

  test("two songs taken out each keep their Undo", async ({ page }) => {
    await openSets(page)
    await detail(page).getByRole("button", { name: "Take Viasna out" }).click()
    const viasna = said(page, "“Viasna” was taken out of the set.")
    await expect(viasna).toHaveCount(1)
    await detail(page).getByRole("button", { name: "Take Sonca out" }).click()
    const sonca = said(page, "“Sonca” was taken out of the set.")
    await expect(sonca).toHaveCount(1)
    await expect(viasna.getByRole("button", { name: "Undo" })).toBeVisible()
    expect(await songsNow(page)).toEqual(["Pałyn", "Ahoń"])

    // From the start screen too: each puts its own song back in its place,
    // the older first.
    await page.keyboard.press("Escape")
    await expect(startButton(page)).toBeVisible()
    await viasna.getByRole("button", { name: "Undo" }).click()
    await expect(viasna).toHaveCount(0)
    await expect(sonca.getByRole("button", { name: "Undo" })).toBeVisible()
    await sonca.getByRole("button", { name: "Undo" }).click()
    await expect(notices(page)).toHaveCount(0)
    await expect
      .poll(async () => (await calls(page, "update_set")).at(-1)?.args)
      .toEqual([1, null, ["Pałyn", "Viasna", "Ahoń", "Sonca"]])
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("button", { name: "Sets", exact: true }).first().click()
    await expect.poll(() => songsNow(page)).toEqual(["Pałyn", "Viasna", "Ahoń", "Sonca"])
  })

  test("Undo of a song whose set was deleted says why", async ({ page }) => {
    await openSets(page)
    await detail(page).getByRole("button", { name: "Take Viasna out" }).click()
    const notice = said(page, "“Viasna” was taken out of the set.")
    await expect(notice).toHaveCount(1)
    await detail(page).getByRole("button", { name: "Delete set" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(items(page)).toHaveCount(1)

    await notice.getByRole("button", { name: "Undo" }).click()
    await expect(said(page, "Could not put “Viasna” back: its set was deleted")).toHaveAttribute(
      "data-notice",
      "error"
    )
    // Only the taking out was sent; the set is not made again.
    expect(await callCount(page, "update_set")).toBe(1)
    await expect(items(page)).toHaveCount(1)
    await expect(nameField(page)).toHaveValue("New songs")
  })

  test("an Undo Python refuses says why, in the sets' one notice", async ({ page }) => {
    await openSets(page)
    await detail(page).getByRole("button", { name: "Take Viasna out" }).click()
    const notice = said(page, "“Viasna” was taken out of the set.")
    await expect(notice).toHaveCount(1)
    // The set went from under Python between its read and its save.
    await page.evaluate(() => {
      const w = window as unknown as { pywebview: { api: Record<string, unknown> }; __UPDATE_SET__: unknown }
      w.__UPDATE_SET__ = w.pywebview.api.update_set
      w.pywebview.api.update_set = async () => ({ ok: false, error: "Set not found" })
    })

    await notice.getByRole("button", { name: "Undo" }).click()
    const refused = said(page, "Could not put “Viasna” back: Set not found")
    await expect(refused).toHaveAttribute("data-notice", "error")
    await expect(notice).toHaveCount(0)
    expect(await songsNow(page)).toEqual(["Pałyn", "Ahoń", "Sonca"])
    await expect(item(page, "Gig on the 25th")).toContainText("3 songs")

    // Said where every change to the sets says what went wrong: the next
    // change that goes through puts it away.
    await page.evaluate(() => {
      const w = window as unknown as { pywebview: { api: Record<string, unknown> }; __UPDATE_SET__: unknown }
      w.pywebview.api.update_set = w.__UPDATE_SET__
    })
    await detail(page).getByRole("button", { name: "Take Sonca out" }).click()
    await expect(said(page, "“Sonca” was taken out of the set.")).toHaveCount(1)
    await expect(refused).toHaveCount(0)
    expect(await songsNow(page)).toEqual(["Pałyn", "Ahoń"])
  })

  test("no sets, or a set with no songs, says so on the shared Empty", async ({ page }) => {
    await openSets(page, withSets([], null))
    const empty = page.locator("[data-tab-body] [data-slot=empty]")
    await expect(empty).toHaveCount(1)
    await expect(empty.locator("[data-slot=empty-title]")).toHaveText("No sets yet")
    await expect(empty.locator("[data-slot=empty-description]")).toHaveText(
      "A set is the songs a rehearsal goes through, in order. Make one with New set, then pick it beside Start rehearsal."
    )
    // Across both columns, as wide as the tab's head, with New set in it.
    expect((await box(empty)).width).toBeCloseTo((await box(page.locator("[data-tab-head]"))).width, 0)
    await expect(page.getByRole("list", { name: "Sets" })).toHaveCount(0)
    await expect(detail(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "New set", exact: true })).toHaveCount(1)
    await empty.getByRole("button", { name: "New set", exact: true }).click()
    await expect(nameField(page)).toHaveValue("New set")
    await expect(page.getByText("No sets yet")).toHaveCount(0)

    // The new set has no songs, and says how they come.
    const none = detail(page).locator("[data-slot=empty]")
    await expect(none.locator("[data-slot=empty-title]")).toHaveText("No songs yet")
    await expect(none.locator("[data-slot=empty-description]")).toHaveText(
      "Add them below, in the order you play them."
    )
    await detail(page).locator("[data-set-add]").getByRole("button", { name: "Dym" }).click()
    await expect(none).toHaveCount(0)
    expect(await songsNow(page)).toEqual(["Dym"])
  })
})
