import { expect, test, type Locator, type Page } from "@playwright/test"
import { as, asMember, band } from "./band"
import { linesOf, roomBetween } from "./rows"

// The seed's sets: Club gig with Viasna, Pałyn and Kupalle, and Vik's
// birthday with Kupalle and Viasna. Each test puts back what it changed;
// a set made here stays in the list, since a deleted one would wait in the
// Trash, which trash.spec.ts finds empty.

test.use({ storageState: as("alex") })

const order = (list: Locator) => () => list.locator("[data-song]").evaluateAll((els) => els.map((e) => e.getAttribute("data-song")))
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** A finger, or here the mouse, across the middle of the screen: left goes on, right goes back. */
async function swipe(page: Page, dx: number) {
  const { width, height } = page.viewportSize()!
  await page.mouse.move(width / 2, height / 2)
  await page.mouse.down()
  await page.mouse.move(width / 2 + dx, height / 2 + 5, { steps: 8 })
  await page.mouse.up()
}

test("make a set, name it and add songs in order", async ({ page }) => {
  await page.goto("/sets")
  const main = page.getByRole("main")
  const name = main.getByRole("textbox", { name: "Set's name" })
  // New set makes the set at once and opens it, its name selected to type over.
  await main.getByRole("button", { name: "New set", exact: true }).click()
  await expect(page).toHaveURL(/\/sets\/\d+$/)
  await expect(name).toBeFocused()
  await expect(name).toHaveValue("New set")
  expect(await name.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([0, 7])
  await name.press("Escape")
  await expect(name).toHaveCount(0)
  await main.getByRole("button", { name: "New set", exact: true }).click()
  await expect(name).toHaveValue("New set 2")
  await expect(main.getByRole("button", { name: "On stage" })).toBeDisabled()
  await expect(main.getByText("No songs yet. Add them in the order you play them.")).toBeVisible()

  // A name another set has, in any case, is turned down.
  await page.keyboard.type("club GIG")
  await name.press("Enter")
  await expect(main.getByRole("alert")).toHaveText("There is already a set called Club gig.")
  await expect(name).toHaveAttribute("aria-invalid", "true")
  await name.fill("Wedding")
  await name.press("Enter")
  await expect(name).toHaveCount(0)
  const sets = main.getByRole("list", { name: "Sets" })
  await expect(sets.getByRole("link", { name: /^Wedding/ })).toHaveAttribute("aria-current", "page")

  // A pill adds its song at the end, and so does a title typed, whatever its case.
  await main.locator('[data-song-choice="Kupalle"]').click()
  await main.locator('[data-song-choice="Viasna"]').click()
  await main.getByRole("textbox", { name: "Another song" }).fill("pałyn")
  await main.getByRole("textbox", { name: "Another song" }).press("Enter")
  const songs = main.getByRole("list", { name: "Songs of the set" })
  await expect.poll(order(songs)).toEqual(["Kupalle", "Viasna", "Pałyn"])
  await expect(main.getByText("All the band's songs are in the set.")).toBeVisible()
  await expect(main.getByRole("button", { name: "On stage" })).toBeEnabled()
  await expect(main.locator("p").filter({ hasText: /^3 songs/ })).toHaveText("3 songs · 0:30")
  await expect(sets.getByRole("link", { name: /^Wedding/ })).toContainText("3 songs · 0:30")

  // Dragged by its handle to the top.
  const top = (await songs.locator("[data-song]").first().boundingBox())!
  await main.getByRole("button", { name: "Move Pałyn" }).hover()
  await page.mouse.down()
  await page.mouse.move(top.x + 20, top.y + 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(order(songs)).toEqual(["Pałyn", "Kupalle", "Viasna"])
  await main.getByRole("button", { name: "Take Kupalle out" }).click()
  await expect.poll(order(songs)).toEqual(["Pałyn", "Viasna"])
  await expect(main.locator('[data-song-choice="Kupalle"]')).toBeVisible()
  await page.reload()
  await expect.poll(order(songs)).toEqual(["Pałyn", "Viasna"])
  await expect(main.getByRole("heading", { level: 2 })).toContainText("Wedding")
})

test("type a length and empty it again", async ({ page }) => {
  await page.goto(`/sets/${band().sets["Club gig"]}`)
  const main = page.getByRole("main")
  const songs = main.getByRole("list", { name: "Songs of the set" })
  const viasna = songs.locator('[data-song="Viasna"]')
  const line = main.locator("p").filter({ hasText: /^3 songs/ })
  await expect(line).toHaveText("3 songs · 0:30")
  // A set's songs as every list: 24 px apart, no lines; a song's title and its length keep the dotted line.
  expect(await roomBetween(songs, ":scope > li > [data-song]")).toEqual([24, 24])
  expect(new Set(await linesOf(songs, ":scope > li"))).toEqual(new Set(["0px"]))
  await expect(viasna.getByRole("link", { name: "Viasna", exact: true })).toHaveCSS("text-decoration-style", "dotted")
  await expect(viasna.getByRole("button", { name: "0:10" })).toHaveCSS("text-decoration-style", "dotted")
  await viasna.getByRole("button", { name: "0:10" }).click()
  const field = main.getByRole("textbox", { name: "Length of Viasna" })
  await expect(field).toHaveValue("0:10")
  for (const bad of ["4:5", "4:65", "abc", "-1:00"]) {
    await field.fill(bad)
    await field.press("Enter")
    await expect(field, bad).toHaveAttribute("aria-invalid", "true")
  }
  await field.fill("4:05")
  await field.press("Enter")
  await expect(viasna.getByRole("button", { name: "4:05" })).toBeVisible()
  await expect(line).toHaveText("3 songs · 4:25")
  await page.reload()
  await expect(viasna.getByRole("button", { name: "4:05" })).toBeVisible()
  // Emptied, it is the best take's again.
  await viasna.getByRole("button", { name: "4:05" }).click()
  await field.fill("")
  await field.press("Enter")
  await expect(viasna.getByRole("button", { name: "0:10" })).toBeVisible()
  await expect(line).toHaveText("3 songs · 0:30")

  // A song with no take and no length typed, as Kupalle would be with none.
  await page.route("**/api/songs", async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { songs: { title: string; length: number | null }[] }
    for (const s of body.songs) if (s.title === "Kupalle") s.length = null
    await route.fulfill({ response: res, json: body })
  })
  await page.reload()
  await expect(songs.locator('[data-song="Kupalle"]').getByRole("button", { name: "no takes" })).toBeVisible()
  await expect(line).toHaveText("3 songs · 0:20 · no length: Kupalle")
  // The page asks for the songs a second time: that answer may still be on its way.
  await page.unrouteAll({ behavior: "ignoreErrors" })
})

test("on stage goes song to song and ends", async ({ page }) => {
  // The screen is kept on while the stage view is open, and let go after.
  await page.addInitScript(() => {
    const w = window as unknown as { locks: string[] }
    w.locks = []
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => (w.locks.push("on"), { release: async () => void w.locks.push("off") }) },
    })
  })
  const locks = () => page.evaluate(() => (window as unknown as { locks: string[] }).locks)
  const id = band().sets["Club gig"]
  await page.goto(`/sets/${id}`)
  await page.getByRole("main").getByRole("button", { name: "On stage" }).click()
  await expect(page).toHaveURL(`/stage/${id}/1`)
  await expect(page.getByText("Still in development")).toBeVisible()
  await expect(page.getByText("1 of 3")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1Viasna")
  await expect.poll(locks).toEqual(["on"])

  const before = page.getByRole("button", { name: /^Previous song/ })
  const after = page.getByRole("button", { name: /^(Next song|The end)/ })
  await expect(before).toBeDisabled()
  // A swipe back from the first song does nothing.
  await swipe(page, 200)
  await expect(page.getByText("1 of 3")).toBeVisible()
  await expect(after).toHaveAccessibleName("Next song: Pałyn")
  await after.click()
  await expect(page).toHaveURL(`/stage/${id}/2`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2Pałyn")
  await expect(before).toHaveAccessibleName("Previous song: Viasna")
  await swipe(page, -200)
  await expect(page.getByText("3 of 3")).toBeVisible()
  await expect(after).toHaveText("The end")
  await expect(after).toBeDisabled()
  // Nor does one on from the last.
  await swipe(page, -200)
  await expect(page.getByText("3 of 3")).toBeVisible()
  await before.click()
  await expect(page.getByText("2 of 3")).toBeVisible()

  await page.getByRole("link", { name: "Leave the stage view" }).click()
  await expect(page).toHaveURL(`/sets/${id}`)
  await expect.poll(locks).toEqual(["on", "off"])
})

test("print puts the set alone on the sheet", async ({ page }) => {
  // As if the songs had keys and a tempo.
  await page.route("**/api/songs", async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { songs: { title: string; key: string | null; tempo: number | null; signature: string | null }[] }
    for (const s of body.songs) {
      if (s.title === "Pałyn") Object.assign(s, { key: "F♯ major", tempo: 96, signature: "4/4" })
      if (s.title === "Kupalle") s.key = "E minor"
    }
    await route.fulfill({ response: res, json: body })
  })
  await page.addInitScript(() => {
    window.print = () => void ((window as unknown as { printed: boolean }).printed = true)
  })
  await page.goto(`/sets/${band().sets["Club gig"]}`)
  const sheet = page.locator(".print-sheet")
  await expect(sheet).toBeHidden()
  await page.getByRole("main").getByRole("button", { name: "Print" }).click()
  expect(await page.evaluate(() => (window as unknown as { printed?: boolean }).printed)).toBe(true)

  await page.emulateMedia({ media: "print" })
  await expect(sheet).toBeVisible()
  await expect(page.locator("#root")).toBeHidden()
  await expect(sheet.locator("div").first()).toHaveText("Club gig3 songs · 0:30")
  await expect(sheet.locator("li")).toHaveText(["1Viasna", "2PałynF♯ · 96", "3KupalleEm"])
  await page.unrouteAll({ behavior: "ignoreErrors" })
})

test("delete a set and restore it", async ({ page }) => {
  await page.goto(`/sets/${band().sets["Vik's birthday"]}`)
  const main = page.getByRole("main")
  const sets = main.getByRole("list", { name: "Sets" })
  await main.getByRole("button", { name: "What to do with Vik's birthday" }).click()
  await page.getByRole("menuitem", { name: "Delete set" }).click()
  const ask = page.getByRole("dialog")
  await expect(ask.getByRole("heading")).toHaveText("Delete “Vik's birthday”?")
  await expect(ask).toContainText("It goes to the Trash, where anyone in the band can put it back for 30 days. Its songs stay as they are.")
  await ask.getByRole("button", { name: "Delete set" }).click()
  await expect(page).toHaveURL(/\/sets$/)
  await expect(sets.getByRole("link", { name: /^Club gig/ })).toBeVisible()
  await expect(sets.getByRole("link", { name: /^Vik's birthday/ })).toHaveCount(0)

  // Someone gives its name to another set meanwhile: Restore says so.
  const alex = await asMember("alex")
  const other = await alex.post("/api/sets", { data: { name: "vik's BIRTHDAY" } })
  expect(other.ok()).toBe(true)
  const { id } = (await other.json()) as { id: number }
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Trash" }).click()
  const row = page.locator(`[data-set="Vik's birthday"]`)
  await expect(row).toContainText(/set with 2 songs · deleted by Alex .+ · deleted for good in 30 days/)
  await row.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByRole("alert")).toHaveText("There is already a set called vik's BIRTHDAY.")
  expect((await alex.patch(`/api/sets/${id}`, { data: { name: "Vik's party" } })).ok()).toBe(true)
  await alex.dispose()
  await row.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByRole("status")).toHaveText("“Vik's birthday” is back.")
  await expect(page.getByRole("alert")).toHaveCount(0)

  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Sets" }).click()
  await expect(sets.getByRole("link", { name: /^Vik's birthday/ })).toContainText("2 songs · 0:20")
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("a phone opens the set on its own page", async ({ page }) => {
    await page.goto("/sets")
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Sets")
    await expect(main.getByRole("list", { name: "Songs of the set" })).toHaveCount(0)
    expect(await fits(page)).toBe(true)
    await main.getByRole("list", { name: "Sets" }).getByRole("link", { name: /^Club gig/ }).click()
    await expect(page).toHaveURL(`/sets/${band().sets["Club gig"]}`)
    await expect(main.getByRole("heading", { level: 1 })).toContainText("Club gig")
    await expect(main.getByText("3 songs · 0:30", { exact: true })).toBeVisible()
    await expect.poll(order(main.getByRole("list", { name: "Songs of the set" }))).toEqual(["Viasna", "Pałyn", "Kupalle"])
    expect(await fits(page)).toBe(true)
    await main.getByRole("link", { name: "Sets", exact: true }).click()
    await expect(page).toHaveURL("/sets")
    await expect(main.getByRole("list", { name: "Sets" })).toBeVisible()
  })
})
