import { calls, expect, openApp, recordTake, startRehearsal, test } from "./app.ts"
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
