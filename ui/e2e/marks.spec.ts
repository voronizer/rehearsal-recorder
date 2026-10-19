import {
  callCount,
  calls,
  colour,
  expect,
  headsSeen,
  holdFor,
  letThrough,
  openApp,
  openHistory,
  scaled,
  setFake,
  settled,
  style,
  test,
  waitingFor,
  watchHeads,
} from "./app.ts"
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

/** Wednesday jam's take 1, the one with two marks, its file not found until
 *  window.__FILES_BACK__, as Python answers a file that is not on disk.
 *  window.__MEDIA_ANSWERS__ counts take_media's answers, so a test knows
 *  the load has failed. */
const QUIET_TAKE_1_GONE = `
  const api = window.pywebview.api; const media = api.take_media;
  window.__FILES_BACK__ = false; window.__MEDIA_ANSWERS__ = 0;
  api.take_media = async (tracks, ...rest) => {
    const gone = !window.__FILES_BACK__ && tracks.some((t) => t.file === '/rec/quiet/t1.wav');
    const answer = gone
      ? tracks.map((t) => ({ name: t.name, url: null, error: 'Track file not found', frames: 0,
          samplerate: 0, duration_sec: 0, peaks: [] }))
      : await media(tracks, ...rest);
    window.__MEDIA_ANSWERS__ += 1;
    return answer;
  };
`

/** Went wrong's marks made 221, in 39 rehearsals a week apart, newest
 *  first, as the inventory's stress overlay had them: the stress band's long
 *  rehearsal and song names, a long comment, takes of every length, and one
 *  rehearsal not on disk. */
const MANY_MARKS = `
  const api = window.pywebview.api; const list = api.list_marks;
  const songs = ['Kalychanka (slow version for the wedding, with the long intro the bride asked for)',
                 'Zorka', 'Pałyn', null];
  const notes = ['the second verse drags, count it in faster next time', 'came in late', '',
                 'tempo drops here'];
  api.list_marks = async (id) => {
    if (id !== 3) return list(id);
    const marks = [];
    for (let r = 0; r < 39; r++) {
      const day = new Date(Date.UTC(2026, 8, 26 - 7 * r, 19)).toISOString().slice(0, 19);
      const rehearsal = r === 0
        ? 'Tuesday jam at the old brewery, with the horn section and the choir from upstairs'
        : 'Rehearsal ' + (39 - r);
      for (let i = 0; i < (r < 26 ? 6 : 5); i++) {
        const song = songs[(r + i) % 4];
        const length = 20 + ((r * 37 + i * 61) % 400);
        marks.push({folder: '/rec/many' + r, rehearsal, created_at: day, missing: r === 3,
          take_number: i + 1, name: song ? song + ' ' + (i + 1) : 'Take ' + (i + 1), song,
          duration_sec: length, at: Math.round((length * (i + 1)) / 7), note: notes[(r + i) % 4]});
      }
    }
    return {ok: true, marks};
  };
`

/** History, switched to its Marks view: the list of labels. */
async function openMarks(page: Page) {
  await openHistory(page)
  await page.getByRole("radio", { name: "Marks", exact: true }).click()
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

/** Holds the fake's answers to `name` until let go. */
const hold = (page: Page, name: string) =>
  page.evaluate((n) => {
    const w = window as unknown as { __HOLD__?: Record<string, Promise<void>>; __LET_GO__?: () => void }
    w.__HOLD__ = { ...w.__HOLD__, [n]: new Promise<void>((r) => (w.__LET_GO__ = r)) }
  }, name)
const letGo = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __HOLD__?: object; __LET_GO__: () => void }
    w.__HOLD__ = {}
    w.__LET_GO__()
  })

/** A frame's Marks page: its head's title and the marks under it. */
type Drawn = { head: string | null; marks: string[] }

/** From now on, at every frame, the Marks page drawn, or null in a frame
 *  with none. `pagesSeen` stops and says them. */
const watchPages = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __PAGES__: (Drawn | null)[]; __WATCHING_PAGES__: boolean }
    w.__PAGES__ = []
    w.__WATCHING_PAGES__ = true
    const look = () => {
      if (!w.__WATCHING_PAGES__) return
      const group = document.querySelector("[data-marks-group]")
      w.__PAGES__.push(
        group
          ? {
              head:
                group.parentElement?.querySelector("[data-pane-head] h2")?.getAttribute("aria-label") ??
                null,
              marks: Array.from(group.querySelectorAll("[data-mark]"), (m) => m.getAttribute("data-mark")!),
            }
          : null
      )
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
const pagesSeen = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __PAGES__: (Drawn | null)[]; __WATCHING_PAGES__: boolean }
    w.__WATCHING_PAGES__ = false
    return w.__PAGES__
  })

test.describe("Marks in History", () => {
  test("the switch has three views, and History opens on the one used last", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await expect(page.getByRole("radiogroup", { name: "History view" }).getByRole("radio")).toHaveText([
      "Rehearsals",
      "Songs",
      "Marks",
    ])
    expect((await calls(page, "save_history_view")).map((c) => c.args[0])).toEqual(["marks"])

    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "History", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Labels" })).toBeVisible()
    await expect(page.getByRole("radio", { name: "Marks", exact: true })).toHaveAttribute(
      "aria-checked",
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
    await expect(wrong).toHaveAttribute("data-count", "3")
    await expect(wrong.locator("[data-figures] [data-shown]")).toHaveText("3")
    await expect(wrong).toContainText("3 rehearsals · last 10 Sep")
    await expect(labelItem(page, 1)).toContainText("2 rehearsals · last 10 Sep")
    const again = labelItem(page, 4)
    await expect(again).toContainText("no marks yet")
    await expect(again).not.toHaveAttribute("data-count")
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
    await expect(viasna.locator("[data-line='comment']")).not.toHaveAttribute("title")
    await expect(viasna.locator("[data-line='take']")).toHaveText("Viasna 1 · 0:40")
    await expect(viasna.getByRole("button", { name: "Open the song Viasna", exact: true })).toBeVisible()
    await expect(viasna).toContainText("4:10")
  })

  test("the marks are one group, a part per rehearsal split by lines, titles without capitals", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await settled(page)
    const marks = pane(page, "Went wrong")
    // The pane head: the label's dot, its name at 20 px and the line under it
    // at 14. Nothing in it to press: a label is renamed in Settings.
    const head = marks.locator("[data-pane-head]")
    expect(await style(head.locator("h2"), "font-size")).toEqual({ "font-size": "20px" })
    expect(
      await style(head.getByText("3 marks in 3 rehearsals · last 10 Sep", { exact: true }), "font-size")
    ).toEqual({ "font-size": "14px" })
    expect((await head.locator("[data-slot='label-dot']").boundingBox())!.width).toBeCloseTo(14, 0)
    await expect(head.getByRole("button")).toHaveCount(0)

    // One group on the card's fill, with its 12 px corners and no frame,
    // 32 px under the head.
    const group = marks.locator("[data-marks-group]")
    await expect(group).toHaveCount(1)
    expect(await style(group, "background-color", "border-top-left-radius", "border-top-width")).toEqual({
      "background-color": await colour(page, "--card"),
      "border-top-left-radius": "12px",
      "border-top-width": "0px",
    })
    const top = (await head.boundingBox())!
    const all = (await group.boundingBox())!
    expect(all.y - (top.y + top.height)).toBeCloseTo(32, 0)

    // Its head row, then a part per rehearsal, each under a 1 px line across
    // the whole group: 16 px above and below a part, 24 at its sides and
    // under the last.
    expect(
      await group.evaluate((g) =>
        [...g.children].map((c) =>
          c.hasAttribute("data-marks-head") ? "head" : c.hasAttribute("data-marks-part") ? "part" : c.tagName
        )
      )
    ).toEqual(["head", "part", "part", "part"])
    const parts = group.locator("[data-marks-part]")
    for (const [i, part] of (await parts.all()).entries()) {
      expect(
        await style(part, "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width")
      ).toEqual({
        "padding-top": "16px",
        "padding-right": "24px",
        "padding-bottom": i === 2 ? "24px" : "16px",
        "padding-left": "24px",
        "border-top-width": "1px",
      })
      expect((await part.boundingBox())!.width).toBeCloseTo(all.width, 0)
    }

    // A part's title reads as it is written, 14 px at 600, its count at 400
    // in grey; the rehearsal in it opens that rehearsal.
    const title = parts.first().locator("h3[data-group-title]")
    await expect(title).toHaveText("Tuesday jam · Thu 10 Sep · 1 mark")
    expect(await style(title, "font-size", "font-weight", "text-transform", "letter-spacing")).toEqual({
      "font-size": "14px",
      "font-weight": "600",
      "text-transform": "none",
      "letter-spacing": "normal",
    })
    const opens = title.getByRole("button", { name: "Open the rehearsal Tuesday jam · Thu 10 Sep", exact: true })
    expect(await style(opens, "font-size", "font-weight", "text-transform")).toEqual({
      "font-size": "14px",
      "font-weight": "600",
      "text-transform": "none",
    })
    expect(await style(title.getByText("· 1 mark", { exact: true }), "font-weight", "color")).toEqual({
      "font-weight": "400",
      color: (await style(head.locator("p"), "color")).color,
    })

    // No native tooltips: a cut name has the shared tip.
    await expect(marks.locator("[title]")).toHaveCount(0)
  })

  test("by song and one list, and the choice is kept", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const marks = pane(page, "Went wrong")
    const grouping = marks.getByRole("radiogroup", { name: "Group marks" })
    await expect(grouping.getByRole("radio", { name: "By rehearsal" })).toHaveAttribute("aria-checked", "true")

    await grouping.getByRole("radio", { name: "By song" }).click()
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

    await pane(page, "Note").getByRole("radio", { name: "One list" }).click()
    await expect(pane(page, "Note").locator("[data-group-title]")).toHaveCount(0)
    await expect(pane(page, "Note").locator("[data-mark]")).toHaveCount(3)
    await expect(row(page, "/rec/quiet#1@120").locator("[data-line='take']")).toHaveText(
      "Take 1 · 2:00 · Wednesday jam, 3 Sep"
    )
    expect((await calls(page, "save_marks_grouping")).map((c) => c.args[0])).toEqual(["song", "list"])

    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "History", exact: true }).click()
    await expect(
      page.getByRole("radiogroup", { name: "Group marks" }).getByRole("radio", { name: "One list" })
    ).toHaveAttribute("aria-checked", "true")
  })

  test("Group by is the shared switch in the group's head, and arrow keys on it leave the list alone", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await settled(page)
    const marks = pane(page, "Went wrong")
    const group = marks.locator("[data-marks-group]")
    const head = group.locator("[data-marks-head]")
    // History's own switch, after its words at the right of the group's head
    // row, 24 px in from the group's edges.
    const grouping = head.getByRole("radiogroup", { name: "Group marks" })
    await expect(grouping).toHaveAttribute("data-variant", "switch")
    await expect(grouping.getByRole("radio")).toHaveText(["By rehearsal", "By song", "One list"])
    await expect(head).toHaveText(/^Group by/)
    expect(await style(head.getByText("Group by", { exact: true }), "font-size")).toEqual({ "font-size": "12px" })
    const box = (await group.boundingBox())!
    const at = (await grouping.boundingBox())!
    expect(box.x + box.width - (at.x + at.width)).toBeCloseTo(24, 0)
    expect(at.y - box.y).toBeCloseTo(24, 0)

    const byRehearsal = grouping.getByRole("radio", { name: "By rehearsal" })
    const bySong = grouping.getByRole("radio", { name: "By song" })
    await expect(byRehearsal).toHaveAttribute("aria-checked", "true")

    // A mark playing has the arrows, to skip 10 s through its take.
    const viasna = row(page, VIASNA)
    await viasna.getByRole("button", { name: "Play Viasna 1 from 0:35" }).click()
    await expect(viasna.getByRole("button", { name: "Pause Viasna 1 from 0:35" })).toBeVisible()
    await expect.poll(() => lastSeek(page)).toBe(35)
    const seeks = await callCount(page, "player_seek")

    // Along the switch the arrows move the focus, choose nothing and leave
    // the take where it is.
    await byRehearsal.focus()
    await page.keyboard.press("ArrowRight")
    await expect(bySong).toBeFocused()
    await expect(bySong).toHaveAttribute("aria-checked", "false")
    await expect(byRehearsal).toHaveAttribute("aria-checked", "true")
    await expect(marks.locator("[data-group-title]")).toHaveCount(3)
    expect(await callCount(page, "player_seek")).toBe(seeks)

    // Down and up are the list's: the next label, and back, grouped as
    // they were.
    await page.keyboard.press("ArrowDown")
    await expect(labelItem(page, 4)).toHaveAttribute("aria-current", "true")
    await page.keyboard.press("ArrowUp")
    await expect(labelItem(page, 3)).toHaveAttribute("aria-current", "true")
    await expect(
      pane(page, "Went wrong").getByRole("radio", { name: "By rehearsal" })
    ).toHaveAttribute("aria-checked", "true")
    await expect(pane(page, "Went wrong").locator("[data-group-title]")).toHaveCount(3)
    expect(await calls(page, "save_marks_grouping")).toEqual([])

    // A grouping chosen from the keyboard keeps the focus on Group by.
    const bySongNow = pane(page, "Went wrong").getByRole("radio", { name: "By song" })
    await bySongNow.focus()
    await page.keyboard.press("Space")
    await expect(bySongNow).toHaveAttribute("aria-checked", "true")
    await expect(bySongNow).toBeFocused()
  })

  test("a grouping chosen with the mouse gives left, right and Space back to the mark playing", async ({
    page,
  }) => {
    // Group by keeps no focus after a click: the next arrow skips through
    // the take, and Space pauses it, rather than choosing another grouping.
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const marks = pane(page, "Went wrong")
    const viasna = row(page, VIASNA)
    await viasna.getByRole("button", { name: "Play Viasna 1 from 0:35" }).click()
    await expect(viasna.getByRole("button", { name: "Pause Viasna 1 from 0:35" })).toBeVisible()
    await expect.poll(() => lastSeek(page)).toBe(35)
    const seeks = await callCount(page, "player_seek")
    const toggles = await callCount(page, "player_toggle")

    const bySong = marks.getByRole("radio", { name: "By song" })
    await bySong.click()
    await expect(bySong).toHaveAttribute("aria-checked", "true")
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
    await expect(bySong).toHaveAttribute("aria-checked", "true")

    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
    await expect(bySong).toHaveAttribute("aria-checked", "true")
    expect((await calls(page, "save_marks_grouping")).map((c) => c.args)).toEqual([["song"]])
  })

  test("the page stays until the next label's marks are read, then starts at its top, the focus on Group by", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 320 })
    await openApp(page, { before: MORE })
    await openMarks(page)
    const note = pane(page, "Note")
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    await settled(page)
    // The focus is the keyboard's, moved along the switch: one left over
    // from the clicks that opened Marks is let go on the next key.
    await note.getByRole("radio", { name: "By rehearsal" }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(note.getByRole("radio", { name: "By song" })).toBeFocused()
    await note.evaluate((el) => (el.scrollTop = el.scrollHeight))
    expect(await note.evaluate((el) => el.scrollTop)).toBeGreaterThan(40)

    // Down to Keep this, its marks held: Note's page stays as it is.
    await watchHeads(page)
    await hold(page, "list_marks")
    await page.keyboard.press("ArrowDown")
    await expect(labelItem(page, 2)).toHaveAttribute("aria-current", "true")
    await page.waitForTimeout(300)
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    await expect(note.getByRole("radio", { name: "By song" })).toBeFocused()

    // Read, Keep this's page takes its place whole, at its top, and the
    // focus is on the same Group by radio, never dropped.
    await letGo(page)
    const keep = pane(page, "Keep this")
    await expect(keep.getByRole("heading", { name: "Keep this", level: 2 })).toBeVisible()
    await expect(keep.locator("[data-mark]")).toHaveCount(1)
    expect(await keep.evaluate((el) => el.scrollTop)).toBe(0)
    expect(await keep.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
    await expect(keep.getByRole("radio", { name: "By song" })).toBeFocused()
    const heads = await headsSeen(page)
    expect(heads.length).toBeGreaterThan(10)
    expect(heads.filter((h, i) => h !== heads[i - 1])).toEqual(["Note", "Keep this"])
  })

  test("Marks entered again on the same label shows its page at once, until the new read", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await expect(page.locator("[data-pane-head] h2")).toBeVisible()

    // Back in Marks, its marks read again and held: Went wrong's page kept
    // from before is drawn at once, in the same frame as the switch.
    const reads = await callCount(page, "list_marks")
    await watchHeads(page)
    await hold(page, "list_marks")
    await page.getByRole("radio", { name: "Marks", exact: true }).click()
    const wrong = pane(page, "Went wrong")
    await expect(wrong.getByRole("heading", { name: "Went wrong", level: 2 })).toBeVisible()
    await expect.poll(() => callCount(page, "list_marks")).toBe(reads + 1)
    await page.waitForTimeout(300)
    expect(await marksOn(page)).toEqual([VIASNA, DAROHA, GONE])
    await letGo(page)
    await settled(page)
    expect(await marksOn(page)).toEqual([VIASNA, DAROHA, GONE])
    const heads = await headsSeen(page)
    const seen = heads.filter((h, i) => h !== heads[i - 1])
    expect(seen).not.toContain(null)
    expect(seen.at(-1)).toBe("Went wrong")
  })

  test("a label chosen while its marks are read, then Marks left and entered again, shows no other label's marks", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    const note = pane(page, "Note")
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    const noteMarks = await marksOn(page)
    expect(noteMarks.length).toBeGreaterThan(0)

    // Down to Keep this, its marks held: Note's page stays. Then out of
    // Marks, and back in, Keep this's marks read again and held.
    await hold(page, "list_marks")
    await page.keyboard.press("ArrowDown")
    await expect(labelItem(page, 2)).toHaveAttribute("aria-current", "true")
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await expect(page.locator("[data-pane-head] h2")).toHaveAttribute("aria-label", "Tuesday jam")
    await watchPages(page)
    await page.getByRole("radio", { name: "Marks", exact: true }).click()
    await expect(labelItem(page, 2)).toHaveAttribute("aria-current", "true")

    // Note's page is not drawn under Keep this: the pane is empty until
    // Keep this's marks are read.
    await page.waitForTimeout(300)
    await expect(page.locator("[data-marks-group]")).toHaveCount(0)
    await letGo(page)
    const keep = pane(page, "Keep this")
    await expect(keep.getByRole("heading", { name: "Keep this", level: 2 })).toBeVisible()
    await expect(keep.locator("[data-mark]")).toHaveCount(1)
    const pages = (await pagesSeen(page)).filter((p) => p !== null)
    expect(pages.length).toBeGreaterThan(0)
    expect(pages.filter((p) => p.head !== "Keep this")).toEqual([])
    expect(pages.filter((p) => p.marks.some((m) => noteMarks.includes(m)))).toEqual([])
  })

  test("a label's marks read late, after Marks was left, put no page back on another label", async ({
    page,
  }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    const note = pane(page, "Note")
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    const noteMarks = await marksOn(page)

    // Keep this's marks held, and Note chosen again before they come; then
    // out of Marks and back in, on Note.
    await holdFor(page, "list_marks", 2)
    await page.keyboard.press("ArrowDown")
    await expect(labelItem(page, 2)).toHaveAttribute("aria-current", "true")
    await expect.poll(() => waitingFor(page)).toBe(1)
    await page.keyboard.press("ArrowUp")
    await expect(labelItem(page, 1)).toHaveAttribute("aria-current", "true")
    await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
    await expect(page.locator("[data-pane-head] h2")).toHaveAttribute("aria-label", "Tuesday jam")
    await page.getByRole("radio", { name: "Marks", exact: true }).click()
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()

    // Keep this's answer comes only now, and puts no page of it back.
    await watchHeads(page)
    await letThrough(page)
    await expect.poll(() => waitingFor(page)).toBe(0)
    await page.waitForTimeout(300)
    await expect(note.getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    expect(await headsSeen(page)).not.toContain("Keep this")
    expect(await marksOn(page)).toEqual(noteMarks)
  })

  test("play starts 5 s before the mark, and again pauses", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const viasna = row(page, VIASNA)
    await viasna.getByRole("button", { name: "Play Viasna 1 from 0:35" }).click()
    await expect(viasna.getByRole("button", { name: "Pause Viasna 1 from 0:35" })).toBeVisible()
    expect(((await calls(page, "player_open")).at(-1)!.args[0] as { file: string }[])[0].file).toBe(
      "/rec/old/v1.wav"
    )
    await expect.poll(() => lastSeek(page)).toBe(35)
    await expect(page.getByRole("button", { name: /^Pause / })).toHaveCount(1)
    // It plays here, in the list: no player opens.
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)

    await viasna.getByRole("button", { name: "Pause Viasna 1 from 0:35" }).click()
    await expect(viasna.getByRole("button", { name: "Play Viasna 1 from 0:35" })).toBeVisible()
    expect((await calls(page, "player_toggle")).length).toBeGreaterThan(0)
  })

  test("a second mark of the same take moves the playing take there", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    const first = row(page, "/rec/quiet#1@120")
    const second = row(page, "/rec/quiet#1@200")
    await first.getByRole("button", { name: "Play Take 1 from 1:55" }).click()
    await expect(first.getByRole("button", { name: "Pause Take 1 from 1:55" })).toBeVisible()
    await expect.poll(() => lastSeek(page)).toBe(115)
    const opened = (await calls(page, "player_open")).length

    await second.getByRole("button", { name: "Play Take 1 from 3:15" }).click()
    await expect.poll(() => lastSeek(page)).toBe(195)
    await expect(second.getByRole("button", { name: "Pause Take 1 from 3:15" })).toBeVisible()
    await expect(first.getByRole("button", { name: "Play Take 1 from 1:55" })).toBeVisible()
    expect((await calls(page, "player_open")).length).toBe(opened)
  })

  for (const [what, again, from, at, press] of [
    ["the same mark", "/rec/quiet#1@120", "1:55", 115, "Could not load Take 1 from 1:55. Try again"],
    ["another of its marks", "/rec/quiet#1@200", "3:15", 195, "Play Take 1 from 3:15"],
  ] as const) {
    test(`a take that could not load opens again from ${what}, and plays from there`, async ({ page }) => {
      await openApp(page, { before: MORE, after: QUIET_TAKE_1_GONE })
      await openMarks(page)
      const first = row(page, "/rec/quiet#1@120")
      await first.getByRole("button", { name: "Play Take 1 from 1:55" }).click()
      // Its files are not there: the load fails, and nothing opens.
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __MEDIA_ANSWERS__: number }).__MEDIA_ANSWERS__))
        .toBe(1)
      await expect(first.locator(".animate-spin")).toHaveCount(0)
      await expect(first.getByRole("button", { name: "Could not load Take 1 from 1:55. Try again" })).toBeVisible()
      expect(await callCount(page, "player_open")).toBe(0)

      // The files are back: the mark's play opens the take again, and it
      // plays from 5 s before that mark.
      await setFake(page, "__FILES_BACK__", true)
      const mark = row(page, again)
      await mark.getByRole("button", { name: press, exact: true }).click()
      await expect(mark.getByRole("button", { name: `Pause Take 1 from ${from}` })).toBeVisible()
      await expect.poll(() => lastSeek(page)).toBe(at)
      expect(await callCount(page, "player_open")).toBe(1)
    })
  }

  test("a mark's play button says when its take cannot be loaded", async ({ page }) => {
    await openApp(page, { before: MORE, after: QUIET_TAKE_1_GONE })
    await openMarks(page)
    const play = row(page, "/rec/quiet#1@120").locator("[data-look]")
    await expect(play).toHaveAttribute("data-look", "idle")
    await expect(play).toHaveAccessibleName("Play Take 1 from 1:55")
    await play.click()
    await expect(play).toHaveAttribute("data-look", "failed")
    await expect(play).toHaveAccessibleName("Could not load Take 1 from 1:55. Try again")
    await expect(play).toBeEnabled()
    await expect(play).not.toHaveAttribute("title")
    // Only the mark pressed says so: the other on the same take is as it was.
    await expect(row(page, "/rec/quiet#1@200").locator("[data-look]")).toHaveAttribute("data-look", "idle")
  })

  test("Tab reaches a row's comment, and Enter opens the take at the mark", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    // The row is the shared one, and not a button: in it, the comment, the
    // shared ghost button, is the way to the take.
    const viasna = row(page, VIASNA)
    await expect(viasna).toHaveAttribute("data-slot", "item")
    const comment = viasna.locator("[data-line='comment']")
    await expect(comment).toHaveRole("button")
    await expect(comment).toHaveAttribute("data-variant", "ghost")
    expect(await style(comment, "font-size", "font-weight")).toEqual({ "font-size": "14px", "font-weight": "400" })
    // Under the pointer it keeps its colour and has no fill of its own: the
    // row's fill says where the pointer is. One with nothing written stays grey.
    const resting = await style(comment, "color")
    await comment.hover()
    expect(await style(comment, "color", "background-color")).toEqual({
      ...resting,
      "background-color": "rgba(0, 0, 0, 0)",
    })
    // The row's fill under the pointer, once its fade has run.
    await viasna.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const lit = (await style(viasna, "background-color"))["background-color"]
    expect(lit).not.toBe("rgba(0, 0, 0, 0)")
    const unsaid = row(page, DAROHA).locator("[data-line='comment']")
    await unsaid.hover()
    expect((await style(unsaid, "color")).color).toBe(
      (await style(page.locator("[data-pane-head] p"), "color")).color
    )

    await viasna.locator("[data-look]").focus()
    await page.keyboard.press("Tab")
    await expect(comment).toBeFocused()
    // With the shared focus ring, and the row lit as it is under the
    // pointer, so the keys show which mark's row they are on.
    expect((await style(comment, "box-shadow"))["box-shadow"]).not.toBe("none")
    await expect
      .poll(async () => (await style(viasna, "background-color"))["background-color"])
      .toBe(lit)
    await page.keyboard.press("Enter")
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
    await expect.poll(() => lastSeek(page)).toBe(40)
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
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2 from 0:25" })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Pause / })).toHaveCount(1)
    const opened = (await calls(page, "player_open")).length
    await daroha.getByRole("button", { name: "Pause Daroha 2 from 0:25" }).click()
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
    await expect(first.getByRole("button", { name: "Pause Take 1 from 1:55" })).toBeVisible()

    await second.locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(second.getByRole("button", { name: "Pause Take 1 from 3:15" })).toBeVisible()
    await expect(first.getByRole("button", { name: "Play Take 1 from 1:55" })).toBeVisible()
  })

  test("a play still reading its take when the label changes plays nothing", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await hold(page, "get_rehearsal")
    await row(page, VIASNA).getByRole("button", { name: "Play Viasna 1 from 0:35" }).click()
    await page.keyboard.press("ArrowDown")
    await expect(pane(page, "Do again").getByRole("heading", { name: "Do again", level: 2 })).toBeVisible()
    await letGo(page)
    await page.waitForTimeout(400)
    expect(await calls(page, "player_open")).toHaveLength(0)
  })

  test("a row still opening when the label changes opens nothing", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await hold(page, "get_rehearsal")
    await row(page, VIASNA).locator("[data-line='comment']").click()
    await page.keyboard.press("ArrowDown")
    await expect(pane(page, "Do again").getByRole("heading", { name: "Do again", level: 2 })).toBeVisible()
    await letGo(page)
    await page.waitForTimeout(400)
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
  })

  test("a mark removed in the player leaves its label empty, and still chosen", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 2, "Keep this")
    await pane(page, "Keep this").locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await page.getByRole("button", { name: "Remove mark at 1:12" }).click()
    await expect(page.getByRole("button", { name: "Remove mark at 1:12" })).toHaveCount(0)

    await page.keyboard.press("Escape")
    const keep = pane(page, "Keep this")
    await expect(keep).toContainText("Marks given the label Keep this in the player gather here")
    await expect(keep.locator("[data-mark]")).toHaveCount(0)
    await expect(keep.getByRole("radio", { name: "By song" })).toBeDisabled()
    await expect(labelItem(page, 2)).toHaveAttribute("data-empty", "true")
    await expect(labelItem(page, 2)).toHaveAttribute("aria-current", "true")
  })

  test("the label chosen and then deleted in Settings gives way to the first", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 4, "Do again")
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("button", { name: "Marks", exact: true }).first().click()
    await page.locator("[data-label='Do again']").hover()
    await page.getByRole("button", { name: "Delete Do again" }).click()
    await expect(page.locator("[data-label='Do again']")).toHaveCount(0)
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "History", exact: true }).click()
    await expect(pane(page, "Note").getByRole("heading", { name: "Note", level: 2 })).toBeVisible()
    await expect(labelItem(page, 1)).toHaveAttribute("aria-current", "true")
    await expect(labelItem(page, 4)).toHaveCount(0)
  })

  test("the counts on the left are the newest, whichever answer comes back last", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openHistory(page)
    // The first ask, made on the way into Marks, answers only after the
    // counts have changed and been asked for again.
    await page.evaluate(() => {
      const w = window as unknown as {
        pywebview: { api: Record<string, (...a: unknown[]) => Promise<unknown>> }
        __OLD_COUNTS__: () => void
      }
      const bridge = w.pywebview.api
      const ask = bridge.list_labels
      let first = true
      bridge.list_labels = async (...a: unknown[]) => {
        const answer = await ask(...a)
        if (!first) return answer
        first = false
        await new Promise<void>((r) => (w.__OLD_COUNTS__ = r))
        return answer
      }
    })
    await page.getByRole("radio", { name: "Marks", exact: true }).click()
    await chooseLabel(page, 3, "Went wrong")
    await row(page, VIASNA).locator("[data-line='comment']").click()
    await page.getByRole("button", { name: "Edit mark at 0:40" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("radio", { name: "Do again" }).click()
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(labelItem(page, 3)).toHaveAttribute("data-count", "2")

    await page.evaluate(() => (window as unknown as { __OLD_COUNTS__: () => void }).__OLD_COUNTS__())
    await page.waitForTimeout(400)
    await expect(labelItem(page, 3)).toHaveAttribute("data-count", "2")
    await expect(labelItem(page, 4)).toHaveAttribute("data-count", "1")
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
    // Said in red, as everywhere a folder is gone, and its take's bar is the
    // dashed one.
    const said = gone.getByText("Not found on disk", { exact: true })
    await expect(said).toBeVisible()
    expect((await style(said, "color")).color).toBe(await colour(page, "--destructive"))
    expect((await style(gone.locator("[data-take-bar]"), "border-top-style"))["border-top-style"]).toBe("dashed")
    await expect(gone.getByRole("button", { name: "Pałyn 8 from 0:55 is not on disk" })).toBeDisabled()
    const reads = (await calls(page, "get_rehearsal")).length
    await gone.locator("[data-line='comment']").click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
    expect((await calls(page, "get_rehearsal")).length).toBe(reads)
  })

  test("a heading opens the rehearsal, a song opens its page", async ({ page }) => {
    await openApp(page, { before: MORE })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    await pane(page, "Went wrong")
      .getByRole("button", { name: "Open the rehearsal First rehearsal · Tue 25 Aug", exact: true })
      .click()
    const rehearsals = page.getByRole("navigation", { name: "Rehearsals" })
    await expect(rehearsals).toBeVisible()
    await expect(rehearsals.locator("[data-rehearsal='/rec/older']")).toHaveAttribute("aria-current", "true")

    // Back on Marks, the label chosen is still chosen.
    await page.getByRole("radio", { name: "Marks", exact: true }).click()
    await expect(labelItem(page, 3)).toHaveAttribute("aria-current", "true")
    await row(page, VIASNA).getByRole("button", { name: "Open the song Viasna", exact: true }).click()
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
    await page.getByRole("button", { name: "Edit mark at 0:40" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("radio", { name: "Do again" }).click()
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await page.keyboard.press("Escape")
    await expect(pane(page, "Went wrong")).toBeVisible()
    await expect.poll(() => marksOn(page)).toEqual([DAROHA, GONE])
    await expect(labelItem(page, 3)).toHaveAttribute("data-count", "2")
    await expect(labelItem(page, 4)).toHaveAttribute("data-count", "1")
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
      await expect(marks.getByRole("radio", { name })).toBeDisabled()
    await expect(
      marks.getByText("Marks given the label Do again in the player gather here, from every rehearsal.")
    ).toBeVisible()
    await expect(marks.locator("[data-mark]")).toHaveCount(0)
  })

  test("a long label name at 960 px takes two lines in the list, then is cut, whole in its tip, and nothing scrolls sideways", async ({
    page,
  }) => {
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
    const grouping = (await marks.getByRole("radiogroup", { name: "Group marks" }).boundingBox())!
    const box = (await marks.boundingBox())!
    expect(grouping.x + grouping.width).toBeLessThanOrEqual(box.x + box.width)
    // In the list a row's name takes two lines at most, then is cut at the
    // end of the second, whole in its tip. 40 letters do not fit in two
    // lines of the panel at 960 px, so this one is cut.
    const item = labelItem(page, 3)
    expect(
      await item.locator("[data-name]").evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          lines: Math.round(el.clientHeight / parseFloat(style.lineHeight)),
          clamp: style.webkitLineClamp,
          cut: el.scrollHeight > el.clientHeight + 1,
        }
      })
    ).toEqual({ lines: 2, clamp: "2", cut: true })
    // The pointer is still on the row it chose: away first, then back.
    await page.mouse.move(0, 0, { steps: 4 })
    await item.hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toContainText(long)
    // Neither the row nor the list scrolls sideways.
    expect(await item.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const list = page.getByRole("navigation", { name: "Labels" })
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test("221 marks at 960 px and 150 % are one group and scroll nothing sideways", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openApp(page, { before: `${MORE} ${scaled(1.5)}`, after: MANY_MARKS })
    await openMarks(page)
    await chooseLabel(page, 3, "Went wrong")
    const marks = pane(page, "Went wrong")
    await expect(marks.locator("[data-mark]")).toHaveCount(221)
    await settled(page)
    const group = marks.locator("[data-marks-group]")

    /** What is wider than its room: the page, the pane, the group's head
     *  row, a part's title or a row; or anything that reaches past the
     *  group's edge. */
    const wider = () =>
      group.evaluate((g) => {
        const out: string[] = []
        if (document.documentElement.scrollWidth > window.innerWidth) out.push("page")
        const pane = g.closest("section")!
        if (pane.scrollWidth > pane.clientWidth) out.push("pane")
        for (const el of g.querySelectorAll("[data-marks-head], [data-group-title], [data-mark]"))
          if (el.scrollWidth > el.clientWidth) out.push(el.getAttribute("data-mark") ?? el.tagName)
        const { left, right } = g.getBoundingClientRect()
        for (const el of g.querySelectorAll("*")) {
          const box = el.getBoundingClientRect()
          if (box.left < left - 0.5 || box.right > right + 0.5) out.push(`${el.tagName} past the group`)
        }
        return [...new Set(out)]
      })

    // By rehearsal: one group, a part for each of the 39 rehearsals.
    await expect(group).toHaveCount(1)
    await expect(group.locator("[data-marks-part]")).toHaveCount(39)
    await expect(group.locator("[data-group-title]")).toHaveCount(39)
    expect(await wider()).toEqual([])
    // Group by, its words on one line, stays inside the group's 24 px.
    const box = (await group.boundingBox())!
    const at = (await group.getByRole("radiogroup", { name: "Group marks" }).boundingBox())!
    const words = group.locator("[data-marks-head]").getByText("Group by", { exact: true })
    const said = (await words.boundingBox())!
    expect(Math.min(at.x, said.x) - box.x).toBeGreaterThanOrEqual(24 * 1.5 - 0.5)
    expect(box.x + box.width - (at.x + at.width)).toBeCloseTo(24 * 1.5, 0)
    expect(said.height).toBeCloseTo(parseFloat((await style(words, "line-height"))["line-height"]), 0)
    // Where the rows are narrow, the bars go under the take's line, so a
    // comment keeps 10rem at least.
    const room = await group
      .locator("[data-line='comment']")
      .evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)))
    expect(room).toBeGreaterThanOrEqual(10 * 16 * 1.5)
    // The takes are drawn to one scale in rem: the longest 7.5rem, none
    // under 6 px.
    const bars = await group
      .locator("[data-take-bar]")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
    expect(Math.max(...bars)).toBeCloseTo(7.5 * 16 * 1.5, 0)
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(6)

    // The long rehearsal's title takes two lines, then is cut, whole in its
    // tip; its count stays beside it.
    const tuesday = "Tuesday jam at the old brewery, with the horn section and the choir from upstairs"
    const title = group.locator("[data-group-title]").first()
    await expect(title).toContainText("· 6 marks")
    const name = title.locator("[data-name]")
    expect(
      await name.evaluate((el) => ({
        lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
        cut: el.scrollHeight > el.clientHeight + 1,
      }))
    ).toEqual({ lines: 2, cut: true })
    await name.hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(`${tuesday} · Sat 26 Sep`)
    await page.mouse.move(0, 0, { steps: 8 })
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveCount(0)
    // A song title too long for the take's line is cut; the take's number
    // and the moment after it are whole.
    const take = group.locator("[data-mark]").first().locator("[data-line='take']")
    await expect(take.locator("[data-name][data-cut]")).toHaveCount(1)
    expect(
      await take.evaluate((el) => {
        const rest = el.lastElementChild as HTMLElement
        return { text: rest.textContent, cut: rest.scrollWidth > rest.clientWidth }
      })
    ).toEqual({ text: " 1 · 0:03", cut: false })

    // A comment cut at the end of its room is whole in its tip, which the
    // keys reach too.
    const long = "the second verse drags, count it in faster next time"
    const first = group.locator("[data-mark]").filter({ hasText: long }).first()
    const comment = first.locator("[data-line='comment']")
    await expect(comment.locator("[data-cut]")).toHaveCount(1)
    await first.locator("[data-look]").focus()
    await page.keyboard.press("Tab")
    await expect(comment).toBeFocused()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(long)

    // By song: a part for each song and Not named; one list: one part with
    // no title. Still one group, and nothing wider than its room.
    await group.getByRole("radio", { name: "By song" }).click()
    await expect(group.locator("[data-marks-part]")).toHaveCount(4)
    await expect(group.locator("[data-mark]")).toHaveCount(221)
    expect(await wider()).toEqual([])
    await group.getByRole("radio", { name: "One list" }).click()
    await expect(group.locator("[data-marks-part]")).toHaveCount(1)
    await expect(group.locator("[data-group-title]")).toHaveCount(0)
    await expect(group.locator("[data-mark]")).toHaveCount(221)
    await expect(marks.locator("[data-marks-group]")).toHaveCount(1)
    expect(await wider()).toEqual([])
  })
})
