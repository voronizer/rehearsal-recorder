import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("rehearsals come by month, and a rehearsal's takes by song", async ({ page }) => {
  await page.goto("/rehearsals")
  const october = page.getByRole("region", { name: "October 2025" })
  const rows = october.locator("[data-rehearsal]")
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText(/Thu 30 Oct( 2025)?/)
  await expect(rows.nth(0)).toContainText("Not named")
  await expect(rows.nth(1)).toContainText(/Thu 23 Oct( 2025)?/)

  await rows.nth(0).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Thursday, 30 October( 2025)?$/)
  await expect(page.getByText("5 takes · 3 songs · 0:50 recorded")).toBeVisible()
  // In the order they were played; takes with no song's title last.
  await expect(page.getByRole("main").getByRole("region")).toHaveText([/^Kupalle/, /^Pałyn/, /^Viasna/, /^Not named/])
  const viasna12 = page.locator('[data-take="Viasna 12"]')
  await expect(viasna12).toContainText("The bridge drags here")
  await expect(viasna12).toContainText("Fill too long?")

  await page.getByRole("region", { name: "Viasna", exact: true }).getByRole("link", { name: "Notes and files" }).click()
  await expect(page).toHaveURL(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Rehearsals" }).click()
  await expect(page).toHaveURL("/rehearsals")
})

test("a rehearsal opened by its link shows its takes only with their songs' titles", async ({ page }) => {
  // The titles come late: until they do, no take is drawn.
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route("**/api/songs", async (route) => {
    await held
    await route.continue()
  })
  const read = page.waitForResponse((r) => r.url().includes("/api/rehearsals/") && r.ok())
  await page.goto(`/rehearsals/${band().rehearsals.second}`)
  await read
  // Two frames for the page to draw what it has.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await expect(page.locator("[data-take]")).toHaveCount(0)

  release()
  const viasna = page.getByRole("region", { name: "Viasna", exact: true })
  await expect(viasna.locator('[data-take="Viasna 11"]')).toBeVisible()
  await expect(page.locator("[data-take]")).toHaveCount(5)
})

test("a rehearsal with no takes left opens Rehearsals", async ({ page }) => {
  // As after Delete take on its last take: the service has no such rehearsal any more.
  await page.goto(`/rehearsals/${crypto.randomUUID()}`)
  await expect(page).toHaveURL(/\/rehearsals$/)
  await expect(page.getByRole("heading", { level: 1, name: "Rehearsals" })).toBeVisible()
  await expect(page.getByText("No such rehearsal")).toHaveCount(0)
})
