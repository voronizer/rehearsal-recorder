import { expect, test } from "@playwright/test"
import { as, asMember, band } from "./band"

test.use({ storageState: as("alex") })

type Marks = { counts: { open: number; closed: number; all: number }; marks: { id: number; note: string }[] }

test("the marks switch counts open, closed and all", async ({ page }) => {
  const alex = await asMember("alex")
  const all = (await (await alex.get("/api/marks?show=all")).json()) as Marks
  const fill = all.marks.find((k) => k.note === "Fill too long?")!
  expect((await alex.patch(`/api/marks/${fill.id}`, { data: { closed: true } })).ok()).toBe(true)
  const { counts } = (await (await alex.get("/api/marks")).json()) as Marks
  expect(counts.closed).toBe(1)

  await page.goto("/marks")
  const which = page.getByRole("radiogroup", { name: "Which marks" })
  await expect(which.getByRole("radio")).toHaveText([
    new RegExp(`^Open\\s*${counts.open}$`),
    new RegExp(`^Closed\\s*${counts.closed}$`),
    new RegExp(`^All\\s*${counts.all}$`),
  ])
  const shown = page.locator("[data-mark]")
  await expect(shown).toHaveCount(counts.open)
  await expect(page.getByRole("region", { name: "Viasna", exact: true })).toBeVisible()

  await which.getByRole("radio", { name: /^Closed/ }).click()
  await expect(shown).toHaveCount(1)
  await expect(shown).toHaveAttribute("data-closed", "true")
  await expect(shown).toContainText("Fill too long?")
  await which.getByRole("radio", { name: /^All/ }).click()
  await expect(shown).toHaveCount(counts.all)

  await which.getByRole("radio", { name: /^Closed/ }).click()
  await shown.getByRole("button", { name: "Open again" }).click()
  await expect(page.getByText("No mark is closed yet.")).toBeVisible()
})

test("a label renamed shows on its marks", async ({ page }) => {
  await page.goto("/marks")
  await page.getByRole("button", { name: "Labels" }).click()
  const panel = page.getByLabel("Panel")
  // РЭХА's four, then the two its marks brought.
  const names = panel.getByRole("textbox", { name: "Name" })
  await expect(names).toHaveCount(6)
  await expect(names.nth(5)).toHaveValue("Good")
  await names.nth(5).fill("Great")
  await names.nth(5).press("Enter")
  await expect(panel.getByRole("button", { name: "Delete “Great”" })).toBeVisible()

  // The mark from РЭХА with no note shows its label's name.
  await page.goto(`/takes/${band().takes["Viasna 12"]}`)
  await expect(page.getByRole("main").getByRole("region", { name: "Marks" }).locator("[data-mark]").first()).toContainText("Great")
})

test("a label dragged by its grip to the top is the first", async ({ page }) => {
  await page.goto("/marks")
  await page.getByRole("button", { name: "Labels" }).click()
  const panel = page.getByLabel("Panel")
  const names = panel.getByRole("textbox", { name: "Name" })
  await expect(names.first()).toHaveValue("Note")
  const target = (await names.first().boundingBox())!
  await panel.getByRole("button", { name: "Move Do again" }).hover()
  await page.mouse.down()
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => names.evaluateAll((els) => els.slice(0, 2).map((e) => (e as HTMLInputElement).value))).toEqual(["Do again", "Note"])
  await page.reload()
  await page.getByRole("button", { name: "Labels" }).click()
  await expect(names.first()).toHaveValue("Do again")
})
