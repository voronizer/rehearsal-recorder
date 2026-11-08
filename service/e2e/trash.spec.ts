import { expect, test } from "@playwright/test"
import { as, band } from "./band"

const trashLink = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Trash" })

test.use({ storageState: as("alex") })

test("a take in the trash cannot be marked from the bar", async ({ page }) => {
  await page.goto(`/takes/${band().takes["Viasna 4"]}?at=2`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
  // On its own page the bar steps aside; on another page it holds the take.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Trash" }).click()
  const bar = page.getByLabel("Player", { exact: true })
  await expect(bar.getByTestId("bar-time")).toHaveText("0:02")
  await expect(bar.getByRole("button", { name: "Mark" })).toBeDisabled()
})

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

// Each test puts back what it deleted: the tests share one band.
test("a take deleted from its line waits in the trash and comes back", async ({ page }) => {
  await page.goto(`/rehearsals/${band().rehearsals.first}`)
  const line = page.locator('[data-take="Viasna 5"]')
  await line.getByRole("button", { name: "What to do with Viasna 5", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete take" }).click()
  const ask = page.getByRole("dialog")
  await expect(ask.getByRole("heading")).toHaveText("Delete “Viasna 5”?")
  await expect(ask).toContainText("It goes to the Trash, where anyone in the band can put it back for 30 days. In РЭХА it stays as it is.")
  await ask.getByRole("button", { name: "Delete take" }).click()
  await expect(line).toHaveCount(0)

  await trashLink(page).click()
  const row = page.locator('[data-take="Viasna 5"]')
  await expect(row).toContainText(/deleted by Alex .+ · deleted for good in 30 days/)
  await row.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByRole("status")).toHaveText(/^“Viasna 5” is back with the takes of Thursday, 23 October( 2025)?\.$/)
})

test("a song deleted with its takes is one line in the trash", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Kupalle"]}`)
  await page.getByRole("main").getByRole("button", { name: "What to do with Kupalle", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete song" }).click()
  const ask = page.getByRole("dialog")
  await expect(ask.getByRole("heading")).toHaveText("Delete “Kupalle”?")
  await expect(ask).toContainText(/^Delete “Kupalle”\?It goes to the Trash with its 1 take, notes and files, where anyone in the band/)
  await ask.getByRole("button", { name: "Delete song" }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.getByRole("main").getByRole("link", { name: "Kupalle", exact: true })).toHaveCount(0)

  await trashLink(page).click()
  const row = page.locator('[data-song="Kupalle"]')
  await expect(row).toContainText(/song with \d+ takes?, notes and files · deleted by Alex .+ · deleted for good in 30 days/)
  // Its take has no line of its own.
  await expect(page.locator('[data-take="Kupalle 2"]')).toHaveCount(0)
  await row.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByRole("status")).toHaveText("“Kupalle” is back with its takes.")

  await page.goto(`/songs/${band().songs["Kupalle"]}`)
  await expect(page.getByRole("main").locator('[data-take="Kupalle 2"]').first()).toBeVisible()
})
