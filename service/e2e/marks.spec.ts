import { expect, test } from "@playwright/test"
import { as, asMember, band } from "./band"

test.use({ storageState: as("alex") })

type Marks = { counts: { open: number; closed: number; all: number }; marks: { id: number; note: string }[] }

test("the marks switch counts to do, done and all", async ({ page }) => {
  const alex = await asMember("alex")
  const all = (await (await alex.get("/api/marks?show=all")).json()) as Marks
  const fill = all.marks.find((k) => k.note === "Fill too long?")!
  expect((await alex.patch(`/api/marks/${fill.id}`, { data: { closed: true } })).ok()).toBe(true)
  const { counts } = (await (await alex.get("/api/marks")).json()) as Marks
  expect(counts.closed).toBe(1)

  await page.goto("/marks")
  const which = page.getByRole("radiogroup", { name: "Which marks" })
  await expect(which.getByRole("radio")).toHaveText([
    new RegExp(`^To do\\s*${counts.open}$`),
    new RegExp(`^Done\\s*${counts.closed}$`),
    new RegExp(`^All\\s*${counts.all}$`),
  ])
  const shown = page.locator("[data-mark]")
  await expect(shown).toHaveCount(counts.open)
  await expect(page.getByRole("region", { name: "Viasna", exact: true })).toBeVisible()

  await which.getByRole("radio", { name: /^Done/ }).click()
  await expect(shown).toHaveCount(1)
  await expect(shown).toHaveAttribute("data-closed", "true")
  await expect(shown).toContainText("Fill too long?")
  await which.getByRole("radio", { name: /^All/ }).click()
  await expect(shown).toHaveCount(counts.all)

  // A line opens the mark in the panel, where Not done yet brings it back.
  await which.getByRole("radio", { name: /^Done/ }).click()
  await shown.getByRole("button", { name: "Fill too long?" }).click()
  await page.getByLabel("Panel").getByRole("button", { name: "Not done yet" }).click()
  await expect(page.getByText("No mark is done yet.")).toBeVisible()
})

test("a label renamed shows on its marks", async ({ page }) => {
  await page.goto("/marks")
  await page.getByRole("button", { name: "Labels" }).click()
  // At the top of Marks, not in the panel.
  await expect(page).toHaveURL(/\/marks\?edit=labels$/)
  await expect(page.getByLabel("Panel")).toHaveCount(0)
  const main = page.getByRole("main")
  // РЭХА's four, then the two its marks brought.
  const names = main.getByRole("textbox", { name: "Name" })
  await expect(names).toHaveCount(6)
  await expect(names.nth(5)).toHaveValue("Good")
  await names.nth(5).fill("Great")
  await names.nth(5).press("Enter")
  await expect(main.getByRole("button", { name: "Delete “Great”" })).toBeVisible()

  // The mark from РЭХА with no note shows its label's name, on its chip in РЭХА's player too.
  await page.goto(`/takes/${band().takes["Viasna 12"]}`)
  await expect(page.locator("[data-take-player]").getByRole("button", { name: "Great", exact: true })).toBeVisible()
})

test("a label dragged by its grip to the top is the first", async ({ page }) => {
  await page.goto("/marks")
  await page.getByRole("button", { name: "Labels" }).click()
  const main = page.getByRole("main")
  const names = main.getByRole("textbox", { name: "Name" })
  await expect(names.first()).toHaveValue("Note")
  const target = (await names.first().boundingBox())!
  await main.getByRole("button", { name: "Move Do again" }).hover()
  await page.mouse.down()
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => names.evaluateAll((els) => els.slice(0, 2).map((e) => (e as HTMLInputElement).value))).toEqual(["Do again", "Note"])
  // The editor is in the page's address: a reload keeps it open.
  await page.reload()
  await expect(page).toHaveURL(/\?edit=labels$/)
  await expect(names.first()).toHaveValue("Do again")
})
