import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("trash lists takes and restores them", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Trash" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible()
  const row = page.locator('[data-take="Viasna 4"]')
  await expect(row).toContainText(/Thu 23 Oct( 2025)? · removed in РЭХА .+ · deleted for good in 30 days/)
  await row.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByRole("status")).toHaveText(/^“Viasna 4” is back with the takes of Thursday, 23 October( 2025)?\.$/)
  await expect(page.getByText("The trash is empty.")).toBeVisible()

  await page.goto(`/songs/${band().songs["Viasna"]}`)
  const all = page.getByRole("region", { name: "All takes" })
  await all.getByRole("button", { name: /^Thursday, 23 October/ }).click()
  await expect(all.locator('[data-take="Viasna 4"]')).toBeVisible()
})
