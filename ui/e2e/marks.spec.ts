import { calls, expect, openApp, openHistory, test } from "./app.ts"
import type { Page } from "@playwright/test"

// History's Marks view, against the fake's library with more marks in it:
//
//   Note        Tuesday jam (10 Sep) Take 3 at 0:05, no comment
//               Wednesday jam (3 Sep) Take 1 at 2:00 "the riff", 3:20 "the riff, slower"
//   Keep this   Tuesday jam Pałyn 2 at 1:12 "this one is the take"
//   Went wrong  Tuesday jam Viasna 1 at 0:40 "guitar drifts here"
//               First rehearsal (25 Aug) Daroha 2 at 0:30, no comment
//               Missing jam (20 Aug, not on disk) Pałyn 8 at 1:00 "late again"
//   Do again    none
const MORE = "window.__FULL_EVENING__ = true; window.__MORE_MARKS__ = true;"

const VIASNA = "/rec/old#4@40"
const DAROHA = "/rec/older#2@30"
const GONE = "/rec/gone#1@60"

/** History, switched to its Marks view: the list of labels. */
async function openMarks(page: Page) {
  await openHistory(page)
  await page.getByRole("button", { name: "Marks", exact: true }).click()
  const list = page.getByRole("navigation", { name: "Labels" })
  await expect(list).toBeVisible()
  return list
}

const labelItem = (page: Page, id: number) =>
  page.getByRole("navigation", { name: "Labels" }).locator(`[data-label='${id}']`)

/** The chosen label's marks, on the right. */
const pane = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

const row = (page: Page, key: string) => page.locator(`[data-mark='${key}']`)

/** A label in the list, chosen. */
async function chooseLabel(page: Page, id: number, name: string) {
  await labelItem(page, id).click()
  await expect(pane(page, name).getByRole("heading", { name, level: 2 })).toBeVisible()
}

const marksOn = (page: Page) =>
  page.locator("[data-mark]").evaluateAll((els) => els.map((el) => el.getAttribute("data-mark")))

const lastSeek = async (page: Page) => (await calls(page, "player_seek")).at(-1)?.args[0] as number

test.describe("Marks in History", () => {
  test("the switch has three views, and History opens on the one used last", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await expect(page.getByRole("group", { name: "History view" }).getByRole("button")).toHaveText([
      "Rehearsals",
      "Songs",
      "Marks",
    ])
    expect((await calls(page, "save_history_view")).map((c) => c.args[0])).toEqual(["marks"])

    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "History", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Labels" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Marks", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  test("the labels show their counts and rehearsals, and a label with none is dimmed", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    const list = await openMarks(page)
    expect(
      await list.locator("[data-label]").evaluateAll((els) => els.map((el) => el.getAttribute("data-label")))
    ).toEqual(["1", "2", "3", "4"])
    const wrong = labelItem(page, 3)
    await expect(wrong).toContainText("Went wrong")
    await expect(wrong.locator("[data-count]")).toHaveText("3")
    await expect(wrong).toContainText("3 rehearsals · last 10 Sep")
    await expect(labelItem(page, 1)).toContainText("2 rehearsals · last 10 Sep")
    const again = labelItem(page, 4)
    await expect(again).toContainText("no marks yet")
    await expect(again.locator("[data-count]")).toHaveCount(0)
    await expect(again).toHaveAttribute("data-empty", "true")
    // The first label is the one chosen at first.
    await expect(labelItem(page, 1)).toHaveAttribute("aria-current", "true")
  })

  test("a label's marks come newest first, under a heading per rehearsal", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const marks = pane(page, "Went wrong")
    await expect(marks.getByText("3 marks in 3 rehearsals · last 10 Sep")).toBeVisible()
    await expect(marks.locator("[data-group-title]")).toHaveText([
      "Tuesday jam · Thu 10 Sep · 1 mark",
      "First rehearsal · Tue 25 Aug · 1 mark",
      "Missing jam · Thu 20 Aug · 1 mark",
    ])
    expect(await marksOn(page)).toEqual([VIASNA, DAROHA, GONE])
    const viasna = row(page, VIASNA)
    await expect(viasna.locator("[data-line='comment']")).toHaveText("guitar drifts here")
    await expect(viasna.locator("[data-line='comment']")).toHaveAttribute("title", "guitar drifts here")
    await expect(viasna.locator("[data-line='take']")).toHaveText("Viasna 1 · 0:40")
    await expect(viasna.getByRole("button", { name: "Viasna", exact: true })).toBeVisible()
    await expect(viasna).toContainText("4:10")
  })

  test("by song and one list, and the choice is kept", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const marks = pane(page, "Went wrong")
    const grouping = marks.getByRole("group", { name: "Group marks" })
    await expect(grouping.getByRole("button", { name: "By rehearsal" })).toHaveAttribute("aria-pressed", "true")

    await grouping.getByRole("button", { name: "By song" }).click()
    await expect(marks.locator("[data-group-title]")).toHaveText([
      "Viasna · 1 mark",
      "Daroha · 1 mark",
      "Pałyn · 1 mark",
    ])
    await expect(row(page, VIASNA).locator("[data-line='take']")).toHaveText(
      "Viasna 1 · 0:40 · Tuesday jam, 10 Sep"
    )
    await chooseLabel(page, 1, "Note")
    await expect(pane(page, "Note").locator("[data-group-title]")).toHaveText(["Not named · 3 marks"])

    await pane(page, "Note").getByRole("button", { name: "One list" }).click()
    await expect(pane(page, "Note").locator("[data-group-title]")).toHaveCount(0)
    await expect(pane(page, "Note").locator("[data-mark]")).toHaveCount(3)
    await expect(row(page, "/rec/quiet#1@120").locator("[data-line='take']")).toHaveText(
      "Take 1 · 2:00 · Wednesday jam, 3 Sep"
    )
    expect((await calls(page, "save_marks_grouping")).map((c) => c.args[0])).toEqual(["song", "list"])

    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "History", exact: true }).click()
    await expect(
      page.getByRole("group", { name: "Group marks" }).getByRole("button", { name: "One list" })
    ).toHaveAttribute("aria-pressed", "true")
  })

  test("play starts 5 s before the mark, and again pauses", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const viasna = row(page, VIASNA)
    await viasna.getByRole("button", { name: "Play Viasna 1 from 0:35" }).click()
    await expect(viasna.getByRole("button", { name: "Pause Viasna 1" })).toBeVisible()
    expect(((await calls(page, "player_open")).at(-1)!.args[0] as { file: string }[])[0].file).toBe(
      "/rec/old/v1.wav"
    )
    await expect.poll(() => lastSeek(page)).toBe(35)
    await expect(page.getByRole("button", { name: /^Pause / })).toHaveCount(1)
    // It plays here, in the list: no player opens.
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)

    await viasna.getByRole("button", { name: "Pause Viasna 1" }).click()
    await expect(viasna.getByRole("button", { name: "Play Viasna 1 from 0:35" })).toBeVisible()
    expect((await calls(page, "player_toggle")).length).toBeGreaterThan(0)
  })

  test("a second mark of the same take moves the playing take there", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    const first = row(page, "/rec/quiet#1@120")
    const second = row(page, "/rec/quiet#1@200")
    await first.getByRole("button", { name: "Play Take 1 from 1:55" }).click()
    await expect(first.getByRole("button", { name: "Pause Take 1" })).toBeVisible()
    await expect.poll(() => lastSeek(page)).toBe(115)
    const opened = (await calls(page, "player_open")).length

    await second.getByRole("button", { name: "Play Take 1 from 3:15" }).click()
    await expect.poll(() => lastSeek(page)).toBe(195)
    await expect(second.getByRole("button", { name: "Pause Take 1" })).toBeVisible()
    await expect(first.getByRole("button", { name: "Play Take 1 from 1:55" })).toBeVisible()
    expect((await calls(page, "player_open")).length).toBe(opened)
  })

  test("a click opens the take at the mark, and Escape comes back scrolled where it was", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 360 })
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const marks = pane(page, "Went wrong")
    await marks.evaluate((el) => (el.scrollTop = el.scrollHeight))
    const scrolled = await marks.evaluate((el) => el.scrollTop)
    expect(scrolled).toBeGreaterThan(40)

    await row(page, DAROHA).locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "First rehearsal" })).toBeVisible()
    await expect.poll(() => lastSeek(page)).toBe(30)

    await page.keyboard.press("Escape")
    await expect(marks).toBeVisible()
    await expect.poll(() => marks.evaluate((el) => el.scrollTop)).toBe(scrolled)
  })

  test("a take opened from a row and played there comes back playing in that row", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await row(page, DAROHA).locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await page.keyboard.press("Space")
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()

    await page.keyboard.press("Escape")
    const daroha = row(page, DAROHA)
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Pause / })).toHaveCount(1)
    const opened = (await calls(page, "player_open")).length
    await daroha.getByRole("button", { name: "Pause Daroha 2" }).click()
    await expect(daroha.getByRole("button", { name: "Play Daroha 2 from 0:25" })).toBeVisible()
    expect((await calls(page, "player_open")).length).toBe(opened)
  })

  test("a row opened after another of the same take was played is the one that shows it", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    const first = row(page, "/rec/quiet#1@120")
    const second = row(page, "/rec/quiet#1@200")
    await first.getByRole("button", { name: "Play Take 1 from 1:55" }).click()
    await expect(first.getByRole("button", { name: "Pause Take 1" })).toBeVisible()

    await second.locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(second.getByRole("button", { name: "Pause Take 1" })).toBeVisible()
    await expect(first.getByRole("button", { name: "Play Take 1 from 1:55" })).toBeVisible()
  })

  test("a mark with no comment shows its label's name", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await expect(row(page, DAROHA).locator("[data-line='comment']")).toHaveText("Went wrong")
    await expect(row(page, DAROHA).locator("[data-line='comment']")).toHaveAttribute("data-unsaid", "true")
  })

  test("a rehearsal not on disk keeps its marks greyed, with nothing to play", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const gone = row(page, GONE)
    await expect(gone).toHaveAttribute("data-missing", "true")
    await expect(gone).toContainText("not on disk")
    await expect(gone.getByRole("button", { name: /^Play Pałyn 8/ })).toBeDisabled()
    const reads = (await calls(page, "get_rehearsal")).length
    await gone.locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
    expect((await calls(page, "get_rehearsal")).length).toBe(reads)
  })

  test("a heading opens the rehearsal, a song opens its page", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await pane(page, "Went wrong").getByRole("button", { name: "First rehearsal · Tue 25 Aug" }).click()
    const rehearsals = page.getByRole("navigation", { name: "Rehearsals" })
    await expect(rehearsals).toBeVisible()
    await expect(rehearsals.locator("[data-rehearsal='/rec/older']")).toHaveAttribute("aria-current", "true")

    // Back on Marks, the label chosen is still chosen.
    await page.getByRole("button", { name: "Marks", exact: true }).click()
    await expect(labelItem(page, 3)).toHaveAttribute("aria-current", "true")
    await row(page, VIASNA).getByRole("button", { name: "Viasna", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Songs" })).toBeVisible()
    await expect(page.locator("[data-song-head]").getByRole("heading", { name: "Viasna" })).toBeVisible()
  })

  test("a mark relabelled in the player leaves the list after Escape, and the counts follow", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await row(page, VIASNA).locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await page.getByRole("button", { name: "Edit marker at 0:40" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Do again" }).click()
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await page.keyboard.press("Escape")
    await expect(pane(page, "Went wrong")).toBeVisible()
    await expect.poll(() => marksOn(page)).toEqual([DAROHA, GONE])
    await expect(labelItem(page, 3).locator("[data-count]")).toHaveText("2")
    await expect(labelItem(page, 4).locator("[data-count]")).toHaveText("1")
    await expect(labelItem(page, 4)).not.toHaveAttribute("data-empty", "true")
    await expect(labelItem(page, 3)).toHaveAttribute("aria-current", "true")
  })

  test("up and down go through the labels", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await expect(labelItem(page, 1)).toHaveAttribute("aria-current", "true")
    await page.keyboard.press("ArrowDown")
    await expect(pane(page, "Keep this")).toBeVisible()
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await expect(labelItem(page, 4)).toHaveAttribute("aria-current", "true")
    await page.keyboard.press("ArrowUp")
    await expect(pane(page, "Went wrong")).toBeVisible()
  })

  test("the switch is off for a label with no marks, which says where its marks will come from", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 4, "Do again")
    const marks = pane(page, "Do again")
    await expect(marks.getByText("No marks yet")).toBeVisible()
    for (const name of ["By rehearsal", "By song", "One list"])
      await expect(marks.getByRole("button", { name })).toBeDisabled()
    await expect(
      marks.getByText("Marks given the label Do again in the player gather here, from every rehearsal.")
    ).toBeVisible()
    await expect(marks.locator("[data-mark]")).toHaveCount(0)
  })

  test("a 960 px window with a long label name scrolls nothing sideways", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 700 })
    const long = "Went wrong in the second verse every tim"
    expect(long).toHaveLength(40)
    await openApp(page, {
      before: `${MORE} window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:2, name:'Keep this', colour:'green'}, {id:3, name:'${long}', colour:'red'}, {id:4, name:'Do again', colour:'amber'}];`,
    })
    await openMarks(page)
    await chooseLabel(page, 3, long)
    const marks = pane(page, long)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await marks.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const grouping = (await marks.getByRole("group", { name: "Group marks" }).boundingBox())!
    const box = (await marks.boundingBox())!
    expect(grouping.x + grouping.width).toBeLessThanOrEqual(box.x + box.width)
    const item = labelItem(page, 3).locator("[data-name]")
    expect(await item.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  })
})
