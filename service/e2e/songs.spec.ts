import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("a take shows the path back to its song", async ({ page }) => {
  await page.goto(`/takes/${band().takes["Viasna 12"]}`)
  const path = page.getByRole("navigation", { name: "Where you are" })
  await expect(path).toHaveText(/Viasna\s*Viasna 12/)
  await path.getByRole("link", { name: "Viasna" }).click()
  await expect(page).toHaveURL(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByRole("heading", { level: 1, name: "Viasna" })).toBeVisible()
})

test("a song page puts the best take on top", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Viasna"]}`)
  // Viasna 11 has two members' stars; Viasna 12 is newer and has none.
  const best = page.getByRole("region", { name: "The take the band likes best" })
  await expect(best).toContainText("Viasna 11")
  await expect(best.getByLabel("Starred by Dzima, Ira")).toBeVisible()
  await expect(best.getByRole("button", { name: "Play “Viasna 11”" })).toBeVisible()
  const all = page.getByRole("region", { name: "All takes" })
  await expect(all.getByRole("listitem")).toHaveCount(2)
  await expect(all.getByRole("listitem").nth(0)).toContainText("Viasna 12")
  await expect(all.getByRole("listitem").nth(0)).toContainText(/Thu 30 Oct( 2025)? · 0:10 · 1 mark/)
  await expect(all.getByRole("listitem").nth(1)).toContainText("Viasna 5")
})

test("the star at rehearsal shows apart", async ({ page }) => {
  await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
  await expect(page.getByText("★ at rehearsal")).toBeVisible()
  await expect(page.getByRole("button", { name: "Star “Kupalle 2”" })).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByLabel(/^Starred by/)).toHaveCount(0)

  // It does not count for the best take: with no member's star, the newest is on top.
  await page.goto(`/songs/${band().songs["Kupalle"]}`)
  await expect(page.getByRole("region", { name: "The newest take" })).toContainText("Kupalle 2")
})
