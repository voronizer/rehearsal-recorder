import { expect, test } from "@playwright/test"
import { as } from "./band"

test.use({ storageState: as("alex") })

test("light and dark themes both draw", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/trash")
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  const light = await background()

  // The page follows the system's setting as it changes.
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveClass(/dark/)
  expect(await background()).not.toBe(light)
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible()
})
