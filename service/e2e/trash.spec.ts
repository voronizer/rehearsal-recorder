import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("trash lists takes and restores them", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: "Trash" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible()
  const row = page.getByRole("listitem").filter({ hasText: "Viasna 4" })
  await expect(row).toContainText(/Thu 23 Oct( 2025)? · 0:10/)
  await row.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByText("The trash is empty.")).toBeVisible()

  await page.goto(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByRole("region", { name: "All takes" })).toContainText("Viasna 4")
})
