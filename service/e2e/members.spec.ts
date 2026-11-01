import { expect, test } from "@playwright/test"
import { as } from "./band"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("members show who has not confirmed or signed in yet", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Members" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible()
    const row = (email: string) => page.locator(`[data-member="${email}"]`)
    await expect(row("nina@example.com")).toContainText("Has not confirmed the address yet")
    await expect(row("ales@example.com")).toContainText("Has not signed in yet")
    await expect(row("dzima@example.com")).toContainText("Dzima")
    await row("dzima@example.com").getByRole("button", { name: "What to do with Dzima" }).click()
    await expect(page.getByRole("menuitem")).toHaveText(["Sign out everywhere", "Remove"])
    await page.keyboard.press("Escape")
    // The owner cannot be removed, but can sign out on every device.
    // (Not pressed: it would end this test's own session.)
    await expect(row("alex@example.com")).toContainText("Alex · you")
    await row("alex@example.com").getByRole("button", { name: "What to do with Alex" }).click()
    await expect(page.getByRole("menuitem")).toHaveText(["Sign out everywhere"])
    await page.keyboard.press("Escape")

    await page.getByLabel("Email address").fill("vera@example.com")
    await page.getByRole("button", { name: "Add member" }).click()
    await expect(row("vera@example.com")).toContainText("Has not confirmed the address yet")

    // Remove asks first; Cancel leaves her in the band.
    const remove = async () => {
      await row("vera@example.com").getByRole("button", { name: "What to do with vera@example.com" }).click()
      await page.getByRole("menuitem", { name: "Remove" }).click()
    }
    await remove()
    const ask = page.getByRole("dialog", { name: "Remove “vera@example.com”?" })
    await expect(ask).toContainText("Their marks, comments and stars stay")
    await ask.getByRole("button", { name: "Cancel" }).click()
    await expect(ask).toHaveCount(0)
    await expect(row("vera@example.com")).toBeVisible()
    await remove()
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click()
    await expect(row("vera@example.com")).toHaveCount(0)

    // Folded once the band has a key.
    const keys = page.getByRole("region", { name: "Keys for РЭХА" })
    await keys.getByRole("button", { name: /Keys for РЭХА/ }).click()
    await expect(keys.getByRole("listitem").filter({ hasText: "Rehearsal room" }).getByRole("button", { name: "Remove" })).toBeVisible()
  })

  test("a key for REHA is shown once", async ({ page }) => {
    await page.goto("/members")
    const keys = page.getByRole("region", { name: "Keys for РЭХА" })
    await keys.getByRole("button", { name: /Keys for РЭХА/ }).click()
    await keys.getByLabel("Where РЭХА runs").fill("Home")
    await keys.getByRole("button", { name: "Make a key for РЭХА" }).click()
    await expect(keys.getByTestId("new-key")).toHaveText(/^localhost:8799:[A-Za-z]+$/)
    await expect(keys.getByRole("listitem").filter({ hasText: "Home" })).toBeVisible()
    await page.reload()
    await expect(page.getByTestId("new-key")).toHaveCount(0)
  })

  test("the band's name shows in the frame", async ({ page }) => {
    await page.goto("/members")
    const name = page.getByRole("textbox", { name: "The band's name" })
    await name.fill("Kapela")
    await name.press("Enter")
    await expect(page.getByRole("complementary").first()).toContainText("Kapela")
    await page.reload()
    await expect(page.getByRole("textbox", { name: "The band's name" })).toHaveValue("Kapela")
  })
})

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("a member sees who is in the band, names only", async ({ page }) => {
    await page.goto("/members")
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible()
    const people = page.getByRole("region", { name: "People" })
    await expect(people).toContainText("Alex")
    await expect(people).toContainText("Dzima")
    await expect(people).toContainText("Ira · you")
    await expect(people).not.toContainText("@example.com")
    await expect(page.getByRole("button", { name: "Add member" })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Keys for РЭХА" })).toHaveCount(0)
  })
})
