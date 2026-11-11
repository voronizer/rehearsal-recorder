import { expect, test } from "@playwright/test"
import { as, asMember, band } from "./band"
import { linesOf, roomBetween } from "./rows"

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
  const viasna = page.getByRole("region", { name: "Viasna", exact: true })
  await expect(viasna).toBeVisible()
  // 24 px between rows, no lines; a row opens as a whole, so its words are not dotted.
  expect(new Set(await roomBetween(viasna.getByRole("list")))).toEqual(new Set([24]))
  expect(new Set(await linesOf(viasna.getByRole("list")))).toEqual(new Set(["0px"]))
  await expect(viasna.getByRole("button", { name: "The bridge drags here" })).toHaveCSS("text-decoration-line", "none")

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

test("a mark's take opens the take's page, from Marks and from the mark's panel", async ({ page }) => {
  await page.goto("/marks")
  const fill = page.locator("[data-mark]").filter({ hasText: "Fill too long?" })
  await fill.getByRole("link", { name: "Viasna 12", exact: true }).click()
  await expect(page).toHaveURL(`/takes/${band().takes["Viasna 12"]}`)

  await page.goto("/")
  await page.getByRole("region", { name: "Latest marks" }).getByRole("button", { name: /Too quiet here/ }).click()
  await page.getByLabel("Panel", { exact: true }).getByRole("link", { name: "Kupalle 2", exact: true }).click()
  await expect(page).toHaveURL(`/takes/${band().takes["Kupalle 2"]}`)
  await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
})

test("a label renamed shows on its marks", async ({ page }) => {
  await page.goto("/marks")
  await page.getByRole("button", { name: "Labels" }).click()
  // In the panel from the right, over the marks.
  await expect(page).toHaveURL(/\/marks\?panel=labels$/)
  const panel = page.getByLabel("Panel")
  await expect(panel.getByRole("heading", { name: "Labels", exact: true })).toBeVisible()
  await expect(page.getByRole("main").locator("[data-mark]").first()).toBeVisible()
  // РЭХА's four, then the two its marks brought.
  const names = panel.getByRole("textbox", { name: "Name" })
  await expect(names).toHaveCount(6)
  await expect(names.nth(5)).toHaveValue("Good")
  await names.nth(5).fill("Great")
  await names.nth(5).press("Enter")
  await expect(panel.getByRole("button", { name: "Delete “Great”" })).toBeVisible()

  // The mark from РЭХА with no note shows its label's name, on its chip in РЭХА's player too.
  await page.goto(`/takes/${band().takes["Viasna 12"]}`)
  await expect(page.locator("[data-take-player]").getByRole("button", { name: "Great", exact: true })).toBeVisible()
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
  // The panel is in the page's address: a reload keeps it open.
  await page.reload()
  await expect(page).toHaveURL(/\?panel=labels$/)
  await expect(names.first()).toHaveValue("Do again")
})

test("Labels and a mark's panel are one layer: one in the other's place, Back steps through them, X closes", async ({ page }) => {
  await page.goto("/marks")
  const panel = page.getByLabel("Panel")
  const labels = panel.getByRole("heading", { name: "Labels", exact: true })
  const lines = page.getByRole("main").locator("[data-mark]")
  await lines.nth(0).getByRole("button").first().click()
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at/)
  // The panel is beside the page, clear of the buttons at the top right.
  await page.getByRole("button", { name: "Labels", exact: true }).click()
  await expect(labels).toBeVisible()
  await expect(panel).toHaveCount(1)
  await lines.nth(1).getByRole("button").first().click()
  await expect(labels).toHaveCount(0)
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at/)
  await page.goBack()
  await expect(labels).toBeVisible()
  await panel.getByRole("button", { name: "Close", exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page).toHaveURL(/\/marks$/)
})
