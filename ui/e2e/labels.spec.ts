import {
  callCount,
  calls,
  colour,
  EDGE,
  expect,
  openApp,
  openHistory,
  recordTake,
  scaled,
  startRehearsal,
  style,
  test,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

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
  await page.getByRole("button", { name: "Add mark" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Mark at")).toBeVisible()
  expect(await dialog.locator("[role='radio'][aria-checked]").allInnerTexts()).toEqual([
    "Solo",
    "Note",
    "Went wrong",
  ])
  await expect(dialog.getByRole("radio", { name: "Solo" })).toHaveAttribute("aria-checked", "true")
  await dialog.getByRole("radio", { name: "Went wrong" }).click()
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
  await expect(row(page, "Do again")).toContainText("0 marks")
})

const box = async (el: Locator) => (await el.boundingBox())!

test("the labels are one group, each row on the shared pieces", async ({ page }) => {
  const list = await openMarks(page)
  const look = async (theme: string) => {
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme).toBe(
      theme === "dark"
    )
    // One group, on the card's fill and with no frame: the list and New label.
    const group = page.locator("[data-tab-body] [data-settings-group]")
    await expect(group, theme).toHaveCount(1)
    await expect(group.getByRole("list", { name: "Labels" })).toBeVisible()
    await expect(group.getByRole("button", { name: "New label" })).toBeVisible()
    const fill = await style(group, "background-color", ...EDGE.filter((p) => p.endsWith("width")))
    expect(fill, theme).toEqual({
      "background-color": await colour(page, "--card"),
      "border-top-width": "0px",
      "border-right-width": "0px",
      "border-bottom-width": "0px",
      "border-left-width": "0px",
    })
    // The rows split by 1 px lines in the border's colour.
    const rows = list.locator(":scope > li")
    await expect(rows).toHaveCount(4)
    expect(await style(rows.first(), "border-top-width")).toEqual({ "border-top-width": "0px" })
    for (const r of (await rows.all()).slice(1)) {
      expect(await style(r, "border-top-width", "border-top-color"), theme).toEqual({
        "border-top-width": "1px",
        "border-top-color": await colour(page, "--border"),
      })
    }

    for (const name of ["Note", "Keep this", "Went wrong", "Do again"]) {
      const at = row(page, name)
      // The grip, the dot and the name are the shared Button, with no fill.
      for (const what of [`Move ${name}`, `Colour of ${name}`, `Rename ${name}`]) {
        const b = at.getByRole("button", { name: what, exact: true })
        expect(await b.evaluate((e) => e.tagName), what).toBe("BUTTON")
        await expect(b, what).toHaveAttribute("data-variant", "ghost")
        await expect(b, what).toHaveAttribute("data-size", what.startsWith("Rename") ? "row" : "icon-tiny")
      }
      // The grip and the dot 24 px; in the dot's, the shared 8 px dot, in the middle.
      for (const what of [`Move ${name}`, `Colour of ${name}`]) {
        const b = await box(at.getByRole("button", { name: what, exact: true }))
        expect(b.width, what).toBeCloseTo(24, 0)
        expect(b.height, what).toBeCloseTo(24, 0)
      }
      const button = at.getByRole("button", { name: `Colour of ${name}`, exact: true })
      const dot = button.locator("[data-slot=label-dot]")
      await expect(dot).toHaveCount(1)
      const b = await box(button)
      const d = await box(dot)
      expect(d.width, name).toBeCloseTo(8, 0)
      expect(d.height, name).toBeCloseTo(8, 0)
      expect(d.x + d.width / 2, name).toBeCloseTo(b.x + b.width / 2, 0)
      expect(d.y + d.height / 2, name).toBeCloseTo(b.y + b.height / 2, 0)
    }
    // Counted as everywhere else: "0 marks", not "no marks".
    await expect(row(page, "Keep this").getByText("1 mark", { exact: true })).toBeVisible()
    await expect(row(page, "Do again").getByText("0 marks", { exact: true })).toBeVisible()
    await expect(page.locator("[data-tab-body] [title]")).toHaveCount(0)
  }
  await look("dark")
  await page.getByRole("button", { name: "Appearance", exact: true }).first().click()
  await page.getByRole("radio", { name: "Light", exact: true }).click()
  await page.getByRole("button", { name: "Marks", exact: true }).first().click()
  await expect(list).toBeVisible()
  await look("light")
})

test("the colour picker is a pick-one of eight, the label's colour chosen", async ({ page }) => {
  await openMarks(
    page,
    "window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:2, name:'Riff', colour:'blue'}];"
  )
  await page.getByRole("button", { name: "Colour of Riff" }).click()
  const picker = page.getByRole("radiogroup", { name: "Colour of Riff" })
  await expect(picker).toBeVisible()
  const swatches = picker.getByRole("radio")
  // In the palette's order: orange sixth, where blue was.
  expect(await swatches.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
    "Grey",
    "Red",
    "Amber",
    "Green",
    "Teal",
    "Orange",
    "Violet",
    "Pink",
  ])
  // The label's own colour is the one chosen, and the focus is on it.
  const orange = picker.getByRole("radio", { name: "Orange" })
  await expect(orange).toHaveAttribute("aria-checked", "true")
  await expect(orange).toBeFocused()
  await expect(picker.locator("[role=radio][aria-checked=true]")).toHaveCount(1)
  // Each 20 px and round, in its colour, four to a row.
  const boxes = await Promise.all((await swatches.all()).map(box))
  for (const b of boxes) {
    expect(b.width).toBeCloseTo(20, 0)
    expect(b.height).toBeCloseTo(20, 0)
  }
  for (const i of [1, 2, 3, 5, 6, 7]) expect(boxes[i].y).toBeCloseTo(boxes[i - 1].y, 0)
  expect(boxes[4].y).toBeGreaterThan(boxes[0].y + 20)
  expect(boxes[4].x).toBeCloseTo(boxes[0].x, 0)
  expect(
    (await style(orange.locator("[data-slot=label-dot]"), "background-color"))["background-color"]
  ).toBe(await colour(page, "--label-orange"))
  expect(
    await orange.evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= e.clientWidth / 2)
  ).toBe(true)

  // The arrows move along it, and Enter takes the one reached.
  await page.keyboard.press("ArrowRight")
  await expect(picker.getByRole("radio", { name: "Violet" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect.poll(async () => (await calls(page, "recolour_label")).at(-1)?.args).toEqual([2, "violet"])
  await expect(picker).toHaveCount(0)
  await expect(row(page, "Riff").locator("[data-colour]")).toHaveAttribute("data-colour", "violet")
})

test("a long label name at 960x680 and 150 % is cut, whole in its tip", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 680 })
  // In capitals, so the 40 letters a name may have are too wide for the row
  // in whichever sans-serif the machine draws with: Linux runners differ.
  const long = "WATCH THE TEMPO IN THE BRIDGE, IT RUSHES"
  await openMarks(
    page,
    scaled(1.5) +
      `window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:2, name:${JSON.stringify(long)}, colour:'violet'}];`
  )
  const rename = page.getByRole("button", { name: `Rename ${long}` })
  const name = rename.getByText(long, { exact: true })
  await expect(name).toHaveText(long)
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  // On one line, as tall as a short name's row.
  expect((await box(row(page, long))).height).toBeCloseTo((await box(row(page, "Note"))).height, 0)
  // The shared tip, not the browser's own, on hover and on keyboard focus.
  const tip = page.locator("[data-whole][data-state$='open']")
  await expect(page.locator("[data-tab-body] [title]")).toHaveCount(0)
  await name.hover()
  await expect(tip).toHaveText(long)
  await page.mouse.move(0, 0, { steps: 8 })
  await expect(tip).toHaveCount(0)
  await page.getByRole("button", { name: `Colour of ${long}` }).focus()
  await page.keyboard.press("Tab")
  await expect(rename).toBeFocused()
  await expect(tip).toHaveText(long)
  await page.keyboard.press("Tab")
  await expect(tip).toHaveCount(0)
  // Its count and Delete keep their room.
  await expect(row(page, long).getByText("1 mark", { exact: true })).toBeVisible()
  const tab = page.locator("[data-tab-body]")
  expect(await tab.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
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
  await page.getByRole("radio", { name: "Violet" }).click()
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
  await page.getByRole("button", { name: "Add mark" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("radio", { name: "Do again" })).toHaveAttribute("aria-checked", "true")
  expect((await dialog.locator("[role='radio'][aria-checked]").allInnerTexts())[0]).toBe("Do again")
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
  await expect(dialog).toContainText("Delete “Went wrong”?")
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
  await page.getByRole("button", { name: "Add mark" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Mark at")).toBeVisible()
  expect(await dialog.locator("[role='radio'][aria-checked]").allInnerTexts()).toEqual(["Riff", "Tempo"])
})
