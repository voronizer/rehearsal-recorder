import { expect, test } from "@playwright/test"
import { as } from "./band"

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

  await page.getByRole("region", { name: "Viasna", exact: true }).getByRole("button", { name: "The song" }).click()
  await expect(page.getByLabel("Panel").getByRole("heading", { level: 2 }).first()).toHaveText("Viasna")
  await page.getByRole("link", { name: "Rehearsals" }).first().click()
  await expect(page).toHaveURL("/rehearsals")
})
