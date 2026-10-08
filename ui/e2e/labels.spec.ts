import { callCount, calls, expect, openApp, openHistory, recordTake, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// A mark's label is a name and a colour, the library's own (spec
// 2026-10-04-labels-design.md). The fuller evening at /rec/old has a Keep
// this mark on Pałyn 2, a plain Note with nothing written on Take 3, and a
// Went wrong one on Viasna 1.

async function openEvening(page: Page, before = "") {
  await openApp(page, { before: `window.__FULL_EVENING__ = true; ${before}` })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

test("a mark with no comment is listed under its take by its label's name", async ({ page }) => {
  const overview = await openEvening(page)
  const take3 = overview.locator("[data-note]").filter({ hasText: "0:05" })
  await expect(take3).toHaveText(/Note$/)
  await expect(overview.locator("[data-note]").filter({ hasText: "0:40" })).toContainText(
    "Went wrong · guitar drifts here"
  )
})

test("a mark is drawn in its label's colour, on the bar and on the waveform", async ({ page }) => {
  const overview = await openEvening(
    page,
    "window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:2, name:'Keep this', colour:'green'}, {id:3, name:'Went wrong', colour:'pink'}];"
  )
  const dot = page.locator("[data-take='4'] [data-mark-colour]")
  await expect(dot).toHaveAttribute("data-mark-colour", "pink")
  // The variable is there in the theme: the dot is not left transparent.
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    "rgba(0, 0, 0, 0)"
  )
  await overview.getByText("guitar drifts here").click()
  await expect(page.locator("[data-marker-at]")).toHaveAttribute("data-colour", "pink")
})

test("the marker dialog's buttons are the labels, in their order, the first chosen", async ({
  page,
}) => {
  await openApp(page, {
    before:
      "window.__LABELS__ = [{id:7, name:'Solo', colour:'violet'}, {id:1, name:'Note', colour:'grey'}, {id:3, name:'Went wrong', colour:'red'}];",
  })
  // On the review screen, where a mark is held until Save take: the
  // interface gives it the first label itself.
  await startRehearsal(page)
  await recordTake(page)
  await page.getByRole("button", { name: "Add marker" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Marker at")).toBeVisible()
  expect(await dialog.locator("button[aria-pressed]").allInnerTexts()).toEqual([
    "Solo",
    "Note",
    "Went wrong",
  ])
  await expect(dialog.getByRole("button", { name: "Solo" })).toHaveAttribute("aria-pressed", "true")
  await dialog.getByRole("button", { name: "Went wrong" }).click()
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
  const kept = (await calls(page, "keep_take")).at(-1)!.args
  expect((kept[5] as { label_id: number }[])[0].label_id).toBe(3)
})

// Settings › Marks: the labels made, named, coloured, ordered and deleted.

async function openMarks(page: Page, before = "") {
  await openApp(page, { before: `window.__FULL_EVENING__ = true; ${before}` })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Marks", exact: true }).first().click()
  const list = page.getByRole("list", { name: "Labels" })
  await expect(list).toBeVisible()
  return list
}

const row = (page: Page, name: string) => page.locator(`[data-label='${name}']`)

test("Marks sits between Folders and Sets, with every label and its marks", async ({
  page,
}) => {
  const list = await openMarks(page)
  const tabs = await page.locator("nav button").allInnerTexts()
  expect(tabs.indexOf("Marks")).toBe(tabs.indexOf("Folders") + 1)
  expect(tabs.indexOf("Sets")).toBe(tabs.indexOf("Marks") + 1)
  await expect(page.getByText("What a moment in a take can be marked with")).toBeVisible()
  expect(await list.locator("[data-label]").evaluateAll((els) => els.map((e) => e.getAttribute("data-label")))).toEqual([
    "Note",
    "Keep this",
    "Went wrong",
    "Do again",
  ])
  await expect(row(page, "Keep this")).toContainText("1 mark")
  await expect(row(page, "Do again")).toContainText("no marks")
})

test("a new label: a name, Enter, and the first colour no label has", async ({ page }) => {
  await openMarks(page)
  await page.getByRole("button", { name: "New label" }).click()
  const field = page.getByRole("textbox", { name: "New label name" })
  await expect(field).toBeFocused()
  await field.press("Escape")
  await expect(field).toHaveCount(0)
  await page.getByRole("button", { name: "New label" }).click()
  await page.getByRole("textbox", { name: "New label name" }).fill("Solo")
  await page.getByRole("textbox", { name: "New label name" }).press("Enter")
  await expect(row(page, "Solo")).toBeVisible()
  expect((await calls(page, "add_label")).at(-1)?.args).toEqual(["Solo", "teal"])
})

test("a name another label has is refused, and says why", async ({ page }) => {
  await openMarks(page)
  await page.getByRole("button", { name: "New label" }).click()
  await page.getByRole("textbox", { name: "New label name" }).fill("keep THIS")
  await page.getByRole("textbox", { name: "New label name" }).press("Enter")
  await expect(page.getByText("There is already a label called Keep this")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "New label name" })).toHaveValue("keep THIS")
})

test("a label renamed with Enter; Escape leaves it as it was", async ({ page }) => {
  await openMarks(page)
  await page.getByRole("button", { name: "Rename Note" }).click()
  await page.getByRole("textbox", { name: "Label name" }).fill("Idea")
  await page.getByRole("textbox", { name: "Label name" }).press("Escape")
  await expect(row(page, "Note")).toBeVisible()
  expect(await callCount(page, "rename_label")).toBe(0)
  await page.getByRole("button", { name: "Rename Note" }).click()
  await page.getByRole("textbox", { name: "Label name" }).fill("Idea")
  await page.getByRole("textbox", { name: "Label name" }).press("Enter")
  await expect(row(page, "Idea")).toBeVisible()
  expect((await calls(page, "rename_label")).at(-1)?.args).toEqual([1, "Idea"])
})

test("a label recoloured recolours its marks, in the overview and on the waveform", async ({
  page,
}) => {
  await openMarks(page)
  await page.getByRole("button", { name: "Colour of Went wrong" }).click()
  await page.getByRole("button", { name: "Violet" }).click()
  expect((await calls(page, "recolour_label")).at(-1)?.args).toEqual([3, "violet"])
  await expect(row(page, "Went wrong").locator("[data-colour]")).toHaveAttribute("data-colour", "violet")
  // The palette fades out; until it has gone, Escape is still its own.
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await openHistory(page)
  await expect(page.locator("[data-take='4'] [data-mark-colour]")).toHaveAttribute(
    "data-mark-colour",
    "violet"
  )
  await page.locator("[aria-label='Rehearsal overview']").getByText("guitar drifts here").click()
  await expect(page.locator("[data-marker-at]")).toHaveAttribute("data-colour", "violet")
})

async function drag(page: Page, from: string, to: string) {
  const handle = page.getByRole("button", { name: `Move ${from}` })
  const target = await row(page, to).boundingBox()
  await handle.hover()
  await page.mouse.down()
  await page.mouse.move(target!.x + 20, target!.y + 2, { steps: 12 })
  await page.mouse.up()
}

test("a label dragged to the top is the first, and a new mark gets it", async ({ page }) => {
  await openMarks(page)
  await drag(page, "Do again", "Note")
  await expect.poll(async () => (await calls(page, "move_label")).at(-1)?.args).toEqual([4, 0])
  // Polled: while the row settles into its place, dnd-kit keeps a hidden
  // copy of it in the list.
  await expect
    .poll(() => page.locator("[data-label]").evaluateAll((els) => els.map((e) => e.getAttribute("data-label"))))
    .toEqual(["Do again", "Note", "Keep this", "Went wrong"])
  await page.keyboard.press("Escape")
  await startRehearsal(page)
  await recordTake(page)
  await page.getByRole("button", { name: "Add marker" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Do again" })).toHaveAttribute("aria-pressed", "true")
  expect((await dialog.locator("button[aria-pressed]").allInnerTexts())[0]).toBe("Do again")
})

test("a label picked up and put back where it was is not moved", async ({ page }) => {
  await openMarks(page)
  const handle = page.getByRole("button", { name: "Move Keep this" })
  await handle.hover()
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect(await callCount(page, "move_label")).toBe(0)
})

// Escape while a label is in hand puts it back where it was. It is the
// drag's: Settings stays open.

const order = (page: Page) =>
  page.locator("[data-label]").evaluateAll((els) => els.map((e) => e.getAttribute("data-label")))

test("Escape puts a label moved with the keys back, and Settings stays", async ({ page }) => {
  const list = await openMarks(page)
  await page.getByRole("button", { name: "Move Keep this" }).focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Escape")
  await expect(list).toBeVisible()
  await expect.poll(() => order(page)).toEqual(["Note", "Keep this", "Went wrong", "Do again"])
  expect(await callCount(page, "move_label")).toBe(0)
})

test("Escape puts a label being dragged back, and Settings stays", async ({ page }) => {
  const list = await openMarks(page)
  const handle = page.getByRole("button", { name: "Move Keep this" })
  const box = (await handle.boundingBox())!
  await handle.hover()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 6 })
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(list).toBeVisible()
  await expect.poll(() => order(page)).toEqual(["Note", "Keep this", "Went wrong", "Do again"])
  expect(await callCount(page, "move_label")).toBe(0)
})

test("a label no mark has is deleted at once", async ({ page }) => {
  await openMarks(page)
  await row(page, "Do again").hover()
  await page.getByRole("button", { name: "Delete Do again" }).click()
  await expect(row(page, "Do again")).toHaveCount(0)
  expect((await calls(page, "delete_label")).at(-1)?.args).toEqual([4, null])
})

test("a label in use asks which label its marks get", async ({ page }) => {
  await openMarks(page)
  await row(page, "Went wrong").hover()
  await page.getByRole("button", { name: "Delete Went wrong" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Delete Went wrong?")
  await expect(dialog).toContainText("Its 1 mark gets:")
  await expect(dialog.getByRole("combobox", { name: "Label for its marks" })).toHaveText("Note")
  await dialog.getByRole("combobox", { name: "Label for its marks" }).click()
  await page.getByRole("option", { name: "Keep this" }).click()
  await dialog.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(row(page, "Went wrong")).toHaveCount(0)
  expect((await calls(page, "delete_label")).at(-1)?.args).toEqual([3, 2])
  await expect(row(page, "Keep this")).toContainText("2 marks")
})

test("the last label has no Delete", async ({ page }) => {
  await openMarks(page, "window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:5, name:'Solo', colour:'violet'}];")
  await row(page, "Solo").hover()
  await page.getByRole("button", { name: "Delete Solo" }).click()
  await expect(row(page, "Solo")).toHaveCount(0)
  await row(page, "Note").hover()
  await expect(page.getByRole("button", { name: "Delete Note" })).toHaveCount(0)
})

test("another recordings folder brings its own labels", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  const before = await callCount(page, "list_labels")
  await page.getByRole("button", { name: "Choose recordings folder" }).click()
  await expect.poll(() => callCount(page, "list_labels")).toBeGreaterThan(before)
})

test("a folder typed in brings its library's labels to the marker dialog", async ({ page }) => {
  await openApp(page, {
    before:
      "window.__OTHER_FOLDER_LABELS__ = [{id:1, name:'Riff', colour:'blue'}, {id:2, name:'Tempo', colour:'pink'}];",
  })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  const before = await callCount(page, "list_labels")
  await page.locator("#recordings-dir").fill("/Users/alex/Band")
  // Saved on leaving the field.
  await page.keyboard.press("Tab")
  await expect.poll(() => callCount(page, "list_labels")).toBeGreaterThan(before)
  await page.keyboard.press("Escape")
  await startRehearsal(page)
  await recordTake(page)
  await page.getByRole("button", { name: "Add marker" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Marker at")).toBeVisible()
  expect(await dialog.locator("button[aria-pressed]").allInnerTexts()).toEqual(["Riff", "Tempo"])
})
