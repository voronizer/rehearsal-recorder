import { expect, test } from "@playwright/test"
import { as, band } from "./band"

// Paŭlik, a member of the band.
test.use({ storageState: as("paulik") })

const NOTHING = "Press ▶ on a take to play it here."

test("home has the last rehearsal as played, then the songs with their best take", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()

  // The last rehearsal on top, its takes in the order they were played.
  const last = page.getByRole("region", { name: "The last rehearsal" })
  await expect(last).toContainText("the last rehearsal · 5 takes")
  await expect(last.locator("[data-take]")).toHaveText([/Kupalle\s*#2/, /Take 7/, /Pałyn\s*#9/, /Viasna\s*#11/, /Viasna\s*#12/])

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
  await expect(bar.getByRole("button", { name: "Pałyn 9", exact: true })).toBeVisible()
  await expect(bar.getByTestId("bar-time")).toHaveText("0:01", { timeout: 10_000 })
  await bar.getByRole("button", { name: "Pause “Pałyn 9”" }).click()
})

test("a take's name opens its panel and does not play it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "The last rehearsal" }).getByRole("button", { name: "Viasna 11", exact: true }).click()
  const panel = page.getByLabel("Panel")
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/Viasna\s*#11/)
  await expect(page.getByLabel("Player")).toContainText(NOTHING)
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
