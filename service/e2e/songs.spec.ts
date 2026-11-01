import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("a song's panel sets its status, key and notes, and takes a file", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("region", { name: "Learning" }).getByRole("button", { name: "Viasna", exact: true }).click()
  const panel = page.getByLabel("Panel")
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText("Viasna")

  await panel.getByRole("button", { name: "Status: Learning" }).click()
  await page.getByRole("menuitemradio", { name: "Ready" }).click()
  await expect(panel.getByRole("button", { name: "Status: Ready" })).toBeVisible()

  await panel.getByRole("combobox", { name: "Key" }).click()
  await page.getByRole("option", { name: "A minor" }).click()
  await expect(panel.getByRole("combobox", { name: "Key" })).toHaveText("A minor")

  await panel.getByRole("button", { name: "Edit notes" }).click()
  await panel.getByRole("textbox", { name: "Notes" }).fill("Ira starts, then the bass")
  await panel.getByRole("button", { name: "Save notes" }).click()
  await expect(panel).toContainText("Ira starts, then the bass")

  await panel.locator('input[type="file"]').setInputFiles({
    name: "Viasna chart.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 made up"),
  })
  await expect(panel.getByRole("link", { name: /Viasna chart\.pdf/ })).toHaveAttribute("target", "_blank")

  await panel.getByRole("link", { name: "Song's page" }).click()
  await expect(page).toHaveURL(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
  await expect(page.getByRole("main")).toContainText("Ira starts, then the bass")
  await expect(page.getByRole("main")).toContainText("Viasna chart.pdf")
  await page.getByRole("link", { name: "Songs" }).first().click()
  await expect(page.getByRole("region", { name: "Ready" }).getByRole("button", { name: "Viasna", exact: true })).toBeVisible()
})

test("a new song is refused for a title the band has in another case", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("button", { name: "New song" }).click()
  const panel = page.getByLabel("Panel")
  await panel.getByLabel("Title").fill("pałyn")
  await panel.getByRole("button", { name: "Add song" }).click()
  await expect(panel.getByRole("alert")).toHaveText("There is already a song called “Pałyn”.")
  await panel.getByLabel("Title").fill("Zorka")
  await panel.getByRole("button", { name: "Add song" }).click()
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText("Zorka")
  await expect(page.getByRole("region", { name: "Learning" }).getByRole("button", { name: "Zorka", exact: true })).toContainText("No takes yet")
})

test("a song page puts the best take on top", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Viasna"]}`)
  // Viasna 11 has two members' stars; Viasna 12 is newer and has none.
  const best = page.getByRole("region", { name: "Best take" })
  await expect(best).toContainText("most stars")
  await expect(best.locator("[data-take]")).toHaveAttribute("data-take", "Viasna 11")
  await expect(best.getByTitle("Starred by Dzima, Ira")).toBeVisible()
  // Every take by rehearsal, newest first; only the newest rehearsal open.
  const all = page.getByRole("region", { name: "All takes" })
  await expect(all.locator("[data-take]")).toHaveCount(2)
  await expect(all.locator("[data-take]").nth(0)).toHaveAttribute("data-take", "Viasna 12")
  await expect(all.locator("[data-take]").nth(1)).toHaveAttribute("data-take", "Viasna 11")
  await all.getByRole("button", { name: /^Thursday, 23 October/ }).click()
  await expect(all.locator("[data-take]")).toHaveCount(3)
  await expect(all.locator("[data-take]").nth(2)).toHaveAttribute("data-take", "Viasna 5")
})

test("the star at rehearsal shows apart", async ({ page }) => {
  await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
  const main = page.getByRole("main")
  await expect(main.getByText("★ at rehearsal")).toBeVisible()
  await expect(main.getByRole("button", { name: "Star “Kupalle 2”" })).toHaveAttribute("aria-pressed", "false")
  await expect(main.getByTitle(/^Starred by/)).toHaveCount(0)

  // It does not count for the best take: with no member's star, the newest is it.
  await page.goto(`/songs/${band().songs["Kupalle"]}`)
  const best = page.getByRole("region", { name: "Best take" })
  await expect(best).toContainText("latest, no stars yet")
  await expect(best.locator("[data-take]")).toHaveAttribute("data-take", "Kupalle 2")
})
