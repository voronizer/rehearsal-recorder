import {
  callCount,
  calls,
  expect,
  openApp,
  recordTake,
  startButton,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

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

type SetSeed = { id: number; name: string; songs: string[] }
const GIG: SetSeed = {
  id: 1,
  name: "Gig on the 25th",
  songs: ["Pałyn", "Viasna", "Ahoń", "Sonca"],
}

/** A page script: the library has these sets and Start plays by `chosen`. */
function withSets(sets: SetSeed[] = [GIG], chosen: number | null = 1, more = "") {
  return (
    `window.__SETS__ = ${JSON.stringify(sets)};` +
    `localStorage.setItem("mock-python-config", JSON.stringify(` +
    `{theme: "dark", ui_scale: 1, next_set: ${JSON.stringify(chosen)}}));` +
    more
  )
}

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
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: new RegExp(`Record take ${n + 1}`) })).toBeVisible()
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
    await expect(setRow(page, "Pałyn")).toContainText("1 go")
    await expect(card(page)).toContainText("1 of 4 played")
    await keep(page, 2)
    await expect(setRow(page, "Pałyn")).toContainText("2 goes")
    // Lit, the row has no check; another song lit, it has.
    await expect(setRow(page, "Pałyn").locator("[data-played-check]")).toHaveCount(0)
    await setRow(page, "Viasna").click()
    await expect(setRow(page, "Pałyn").locator("[data-played-check]")).toHaveCount(1)
    await expect(setRow(page, "Viasna")).not.toContainText("go")
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
    await expect(field(page)).toHaveValue("Take 1")
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
    await expect(row(page, "Dym")).toContainText("1 go")
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

  test("a long set name is cut and whole on hover", async ({ page }) => {
    const long = "The songs for the long gig in the club"
    await openApp(page, { before: withSets([{ id: 1, name: long, songs: ["Dym"] }]) })
    await expect(picker(page)).toHaveAttribute("title", long)
    const cut = await picker(page)
      .locator("[data-set-name]")
      .evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(cut).toBe(true)
    await picker(page).click()
    await expect(menu(page).getByRole("menuitemradio", { name: new RegExp(long) })).toHaveAttribute(
      "title",
      long
    )
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
})
