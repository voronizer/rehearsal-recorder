import { expect, test } from "@playwright/test"
import { as } from "./band"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("members show who has not confirmed or signed in yet", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Members" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible()
    const row = (email: string) => page.getByRole("listitem").filter({ hasText: email })
    await expect(row("nina@example.com")).toContainText("Has not confirmed the address yet")
    await expect(row("ales@example.com")).toContainText("Has not signed in yet")
    await expect(row("dzima@example.com")).toContainText("Dzima")
    await expect(row("dzima@example.com").getByRole("button", { name: "Sign out everywhere" })).toBeVisible()
    await expect(row("dzima@example.com").getByRole("button", { name: "Remove" })).toBeVisible()
    // The owner cannot be removed, but can sign out on every device.
    // (Not pressed: it would end this test's own session.)
    await expect(row("alex@example.com").getByRole("button", { name: "Remove" })).toHaveCount(0)
    await expect(row("alex@example.com").getByRole("button", { name: "Sign out everywhere" })).toBeVisible()

    await page.getByLabel("Email address").fill("vera@example.com")
    await page.getByRole("button", { name: "Add member" }).click()
    await expect(row("vera@example.com")).toContainText("Has not confirmed the address yet")

    // Remove asks first; Cancel leaves her in the band.
    await row("vera@example.com").getByRole("button", { name: "Remove" }).click()
    const ask = page.getByRole("dialog", { name: "Remove “vera@example.com”?" })
    await expect(ask).toContainText("Their comments and stars stay")
    await ask.getByRole("button", { name: "Cancel" }).click()
    await expect(ask).toHaveCount(0)
    await expect(row("vera@example.com")).toBeVisible()
    await row("vera@example.com").getByRole("button", { name: "Remove" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click()
    await expect(row("vera@example.com")).toHaveCount(0)

    const keys = page.getByRole("region", { name: "Keys for РЭХА" })
    await expect(keys.getByRole("listitem").filter({ hasText: "Rehearsal room" }).getByRole("button", { name: "Remove" })).toBeVisible()
  })

  test("a key for REHA is shown once", async ({ page }) => {
    await page.goto("/members")
    const keys = page.getByRole("region", { name: "Keys for РЭХА" })
    await keys.getByLabel("Where РЭХА runs").fill("Home")
    await keys.getByRole("button", { name: "Make a key for РЭХА" }).click()
    await expect(keys.getByTestId("new-key")).toHaveText(/^localhost:8799:[A-Za-z]+$/)
    await expect(keys.getByRole("listitem").filter({ hasText: "Home" })).toBeVisible()
    await page.reload()
    await expect(page.getByTestId("new-key")).toHaveCount(0)
    await expect(page.getByRole("listitem").filter({ hasText: "Home" })).toBeVisible()
  })
})

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("members and keys are only for the owner", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Trash" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Members" })).toHaveCount(0)
    await page.goto("/members")
    await expect(page.getByText("Only the owner can do this")).toBeVisible()
    await expect(page.getByRole("button", { name: "Add member" })).toHaveCount(0)
  })
})
