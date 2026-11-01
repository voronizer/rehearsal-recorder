import { expect, test } from "@playwright/test"
import { as, asMember, band } from "./band"

// Paŭlik opened Viasna 12 before the others marked it; nothing else.
test.use({ storageState: as("paulik") })

const NOTHING = "Press ▶ on a take to play it here."

test("home says what is new and lists the songs with their best take", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
  await expect(page.getByText("6 takes you have not heard yet · 2 new marks")).toBeVisible()

  // The song played last first; each with its best take.
  const songs = page.getByRole("region", { name: "Songs" }).locator("[data-song]")
  await expect(songs).toHaveCount(3)
  await expect(songs.nth(0)).toHaveAttribute("data-song", "Viasna")
  await expect(songs.nth(1)).toHaveAttribute("data-song", "Pałyn")
  await expect(songs.nth(2)).toHaveAttribute("data-song", "Kupalle")
  await expect(songs.nth(0)).toContainText(/3 takes · last Thu 30 Oct( 2025)? · 2 not heard yet/)
  await expect(songs.nth(0).locator("[data-take]")).toHaveAttribute("data-take", "Viasna 11")

  // The mark set or commented on last first, with the last word under it.
  const marks = page.getByRole("region", { name: "Latest marks" }).locator("[data-mark]")
  await expect(marks).toHaveCount(5)
  await expect(marks.nth(0)).toContainText("Too quiet here")
  await expect(marks.nth(1)).toContainText("Fill too long?")
  await expect(marks.nth(2)).toContainText("The bridge drags here")
  await expect(marks.nth(2)).toContainText("Alex: It's us waiting for the vocal.")

  await expect(page.getByRole("region", { name: "The band's favourites" }).locator("[data-take]")).toHaveText(/Viasna\s*11/)
  await expect(page.getByLabel("Player")).toContainText(NOTHING)
})

test("play in a list plays the take in the bar, and it is heard", async ({ page }) => {
  await page.goto("/")
  const palyn = page.locator('[data-song="Pałyn"]')
  await expect(palyn).toContainText("2 not heard yet")
  await palyn.getByRole("button", { name: "Play “Pałyn 9”" }).click()

  const bar = page.getByLabel("Player")
  await expect(bar.getByRole("button", { name: "Pałyn 9", exact: true })).toBeVisible()
  await expect(bar.getByTestId("bar-time")).toHaveText("0:01", { timeout: 10_000 })
  await expect(page.getByText("5 takes you have not heard yet · 2 new marks")).toBeVisible()
  await expect(palyn).toContainText("1 not heard yet")
  await bar.getByRole("button", { name: "Pause “Pałyn 9”" }).click()
})

test("not heard yet opens the first take not heard, and opening it hears it", async ({ page }) => {
  await page.goto("/")
  const viasna = page.locator('[data-song="Viasna"]')
  await viasna.getByRole("button", { name: "2 not heard yet" }).click()
  const panel = page.getByLabel("Panel")
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/Viasna\s*5/)
  await expect(viasna).toContainText("1 not heard yet")
  // Opening a take's panel does not play it.
  await expect(page.getByLabel("Player")).toContainText(NOTHING)
})

test("a mark set after you heard a take is new until you open the take again", async ({ page }) => {
  const sub = page.getByRole("main").locator("p").filter({ hasText: /not heard yet|new mark|heard every take/ }).first()
  const fresh = async () => Number(/(\d+) new marks?/.exec((await sub.textContent()) ?? "")?.[1] ?? 0)
  const favourite = page.getByRole("region", { name: "The band's favourites" }).getByRole("button", { name: "Viasna 11", exact: true })
  const panel = page.getByLabel("Panel")
  await page.goto("/")
  await favourite.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(sub).toBeVisible()
  const before = await fresh()

  const dzima = await asMember("dzima")
  const set = await dzima.post(`/api/takes/${band().takes["Viasna 11"]}/marks`, { data: { at: 3, note: "Late again" } })
  expect(set.ok()).toBe(true)
  const { id } = (await set.json()) as { id: number }
  const sections = page.getByRole("navigation", { name: "Sections" })
  await sections.getByRole("link", { name: "Songs" }).click()
  await sections.getByRole("link", { name: "Home" }).click()
  await expect.poll(fresh).toBe(before + 1)

  // Opened again in the same tab, with no reload.
  await favourite.click()
  await expect(panel).toBeVisible()
  await expect.poll(fresh).toBe(before)
  // Gone again, so the tests after count the seed's marks.
  expect((await dzima.delete(`/api/marks/${id}`)).ok()).toBe(true)
  await dzima.dispose()
})

test("home says so when the service cannot answer", async ({ page }) => {
  await page.route("**/api/frame", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong in the band service" }) }))
  await page.goto("/")
  await expect(page.getByRole("main")).toContainText("Something went wrong in the band service")
})
