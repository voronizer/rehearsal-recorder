import { expect, test } from "@playwright/test"
import { as, band } from "./band"
import { linesOf, roomBetween } from "./rows"

// Paŭlik, a member of the band.
test.use({ storageState: as("paulik") })

const NOTHING = "Press ▶ on a take to play it here."

test("home has the last rehearsal as played, then the songs with their best take", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()

  // The last rehearsal on top, its takes in the order they were played.
  const last = page.getByRole("region", { name: "The last rehearsal" })
  await expect(last).toContainText("the last rehearsal · 5 takes")
  await expect(last.locator("[data-take]")).toHaveText([/Kupalle\s*#2/, /Take\s*#3/, /Pałyn\s*#9/, /Viasna\s*#11/, /Viasna\s*#12/])

  // The song played last first; each with its best take.
  const songs = page.getByRole("region", { name: "Songs" }).locator("[data-song]")
  await expect(songs).toHaveCount(3)
  await expect(songs.nth(0)).toHaveAttribute("data-song", "Viasna")
  await expect(songs.nth(1)).toHaveAttribute("data-song", "Pałyn")
  await expect(songs.nth(2)).toHaveAttribute("data-song", "Kupalle")
  await expect(songs.nth(0)).toContainText(/3 takes · last Thu 30 Oct( 2025)?/)
  await expect(songs.nth(0).locator("[data-take]")).toHaveAttribute("data-take", "Viasna 11")

  // The mark set or commented on last first, with the last word under it.
  const marks = page.getByRole("region", { name: "Latest marks" }).locator("[data-mark]")
  await expect(marks).toHaveCount(5)
  await expect(marks.nth(0)).toContainText("Too quiet here")
  await expect(marks.nth(1)).toContainText("Fill too long?")
  await expect(marks.nth(2)).toContainText("The bridge drags here")
  await expect(marks.nth(2)).toContainText("Alex: It's us waiting for the vocal.")

  await expect(page.getByRole("region", { name: "The band's favourites" }).locator("[data-take]")).toHaveText(/Viasna\s*#11/)
  await expect(page.getByLabel("Player")).toContainText(NOTHING)
})

test("Home's lists have 24 px between rows and no lines; only the day and a song's title are dotted", async ({ page }) => {
  await page.goto("/")
  const last = page.getByRole("region", { name: "The last rehearsal" }).getByRole("list")
  const marks = page.getByRole("region", { name: "Latest marks" }).getByRole("list")
  for (const list of [last, marks]) {
    expect(await roomBetween(list)).toEqual(Array((await list.getByRole("listitem").count()) - 1).fill(24))
    expect(new Set(await linesOf(list))).toEqual(new Set(["0px"]))
  }
  await expect(page.getByRole("region", { name: "The band's favourites" }).getByRole("list")).toHaveCount(1)

  // A song's title 8 px over its best take; 24 px from one song's take to the next song's title.
  const songs = page.getByRole("region", { name: "Songs" }).locator("[data-song]")
  const room = await songs.evaluateAll((rows) =>
    rows.map((row) => {
      const title = row.firstElementChild!.getBoundingClientRect()
      const line = row.querySelector("[data-take] > div")!
      const pad = parseFloat(getComputedStyle(line).paddingTop)
      const r = line.getBoundingClientRect()
      return { title, top: r.top + pad, bottom: r.bottom - pad }
    })
  )
  for (const [i, r] of room.entries()) {
    expect(Math.round(r.top - r.title.bottom), `title to take ${i}`).toBe(8)
    if (i > 0) expect(Math.round(r.title.top - room[i - 1].bottom), `take to title ${i}`).toBe(24)
  }

  // A row that opens as a whole has no dotted line; a word that opens alone keeps it.
  await expect(last.getByRole("link", { name: "Viasna 11", exact: true })).toHaveCSS("text-decoration-line", "none")
  await expect(marks.getByText("Too quiet here")).toHaveCSS("text-decoration-line", "none")
  await expect(page.getByRole("region", { name: "The last rehearsal" }).getByRole("link", { name: /^Thursday, 30 October/ })).toHaveCSS("text-decoration-style", "dotted")
  await expect(page.getByRole("region", { name: "Songs" }).getByRole("link", { name: "Pałyn", exact: true })).toHaveCSS("text-decoration-style", "dotted")
})

test("a row of Latest marks opens the mark, and the take's name in it the take's page", async ({ page }) => {
  await page.goto("/")
  const row = page.getByRole("region", { name: "Latest marks" }).locator("[data-mark]").filter({ hasText: "Too quiet here" })
  const box = (await row.boundingBox())!
  // The room at the right of the take's line, under the words.
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 6)
  await expect(page.getByLabel("Panel").getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at 0:03$/)
  await page.getByLabel("Panel").getByRole("button", { name: "Close", exact: true }).click()
  await row.getByRole("link", { name: "Kupalle 2", exact: true }).click()
  await expect(page).toHaveURL(`/takes/${band().takes["Kupalle 2"]}`)
})

test("the last rehearsal's day opens its page", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "The last rehearsal" }).getByRole("link", { name: /Thursday, 30 October/ }).click()
  await expect(page).toHaveURL(new RegExp(`/rehearsals/${band().rehearsals.second}`))
})

test("play in a list plays the take in the bar", async ({ page }) => {
  await page.goto("/")
  const palyn = page.locator('[data-song="Pałyn"]')
  await palyn.getByRole("button", { name: "Play “Pałyn 9”" }).click()

  const bar = page.getByLabel("Player")
  await expect(bar.getByRole("link", { name: "Pałyn 9", exact: true })).toBeVisible()
  await expect(bar.getByTestId("bar-time")).toHaveText("0:01", { timeout: 10_000 })
  await bar.getByRole("button", { name: "Pause “Pałyn 9”" }).click()
})

test("a take's name opens its page and does not play it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "The last rehearsal" }).getByRole("link", { name: "Viasna 11", exact: true }).click()
  await expect(page).toHaveURL(`/takes/${band().takes["Viasna 11"]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
  await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Player", { exact: true }).getByRole("button", { name: /^Pause/ })).toHaveCount(0)
})

test("the empty room of a take's row opens its page, and Play plays it without leaving Home", async ({ page }) => {
  await page.goto("/")
  const row = page.getByRole("region", { name: "The last rehearsal" }).locator('[data-take="Viasna 11"]')
  await row.getByRole("button", { name: "Play “Viasna 11”" }).click()
  const bar = page.getByLabel("Player", { exact: true })
  await expect(bar.getByRole("button", { name: "Pause “Viasna 11”" })).toBeVisible()
  await expect(page).toHaveURL("/")
  await bar.getByRole("button", { name: "Pause “Viasna 11”" }).click()

  // The room between the name and the length, on the name's line.
  const name = (await row.getByRole("link", { name: "Viasna 11", exact: true }).boundingBox())!
  const line = (await row.boundingBox())!
  await page.mouse.click(line.x + line.width * 0.6, name.y + name.height / 2)
  await expect(page).toHaveURL(`/takes/${band().takes["Viasna 11"]}`)
})

test("a take's star and its menu stay on Home, the star too while it is on its way", async ({ page }) => {
  await page.goto("/")
  const row = page.getByRole("region", { name: "The last rehearsal" }).locator('[data-take="Viasna 11"]')
  const star = row.getByRole("button", { name: /^(Star|Take back your star from) “Viasna 11”$/ })
  // The star's answer held, so the star stays greyed while a second press lands on it.
  let release = () => {}
  const held = new Promise<void>((done) => (release = done))
  await page.route("**/api/takes/*/star", async (route) => {
    await held
    await route.continue()
  })
  const was = await star.getAttribute("aria-label")
  await star.click()
  await expect(star).toBeDisabled()
  const box = (await star.boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  // Greyed, it shows the arrow, not the hand.
  expect(await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, [x, y])).not.toBe("pointer")
  await page.mouse.click(x, y)
  await expect(page).toHaveURL("/")
  release()
  await expect(star).toBeEnabled()
  await expect(star).not.toHaveAttribute("aria-label", was!)
  // Back as it was: the tests share one band.
  await star.click()
  await expect(star).toHaveAttribute("aria-label", was!)
  await expect(star).toBeEnabled()

  await row.getByRole("button", { name: "What to do with Viasna 11" }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(page).toHaveURL("/")
})

test("where the browser cannot play, a press on the greyed Play stays on Home", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { AudioDecoder: undefined }))
  await page.goto("/")
  const play = page.getByRole("region", { name: "The last rehearsal" }).locator('[data-take="Viasna 11"]').getByRole("button", { name: /^Play / })
  await expect(play).toBeDisabled()
  const box = (await play.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole("region", { name: "The last rehearsal" })).toBeVisible()
  await expect(page).toHaveURL("/")
})

test("a song's name on Home opens its page", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "Songs" }).getByRole("link", { name: "Pałyn", exact: true }).click()
  await expect(page).toHaveURL(`/songs/${band().songs["Pałyn"]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pałyn")
  await expect(page.getByLabel("Panel")).toHaveCount(0)
})

test("home says so when the service cannot answer", async ({ page }) => {
  await page.route("**/api/frame", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong in the band service" }) }))
  await page.goto("/")
  await expect(page.getByRole("main")).toContainText("Something went wrong in the band service")
})
