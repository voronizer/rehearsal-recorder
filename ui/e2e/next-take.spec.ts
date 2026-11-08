import type { Locator, Page } from "@playwright/test"
import {
  callCount,
  colour,
  expect,
  openApp,
  openBandApp,
  openEvening,
  settled,
  startRehearsal,
  style,
  test,
  withSets,
  recordButton,
} from "./app.ts"

// The rehearsal screen's Next take panel as one group (owner, 2026-10-12, Q1):
// the field at its head, the set and the other songs under it, each under a
// 1 px line across the panel. Its field wraps a long name, and the old name's
// line floats over what is under it.

const OLD = "window.__OLD_NAMES__ = [['Palyn', 'Pałyn']];"

const panel = (page: Page) => page.locator("[data-next-take-panel]")
const group = (page: Page) => page.getByRole("group", { name: "Next take" })
const field = (page: Page) => page.locator("#next-take-name")
const setCard = (page: Page) => page.locator("[data-set-card]")
const songList = (page: Page) => page.locator("[data-song-list]")
const setRow = (page: Page, title: string) => page.locator(`[data-set-song="${title}"]`)
/** The part of the panel a group sits in: the box the line is drawn on. */
const partOf = (inner: Locator) => inner.locator("xpath=..")

test.describe("the Next take panel", () => {
  test("the next take panel is one group with lines between its parts", async ({ page }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    await settled(page)
    const border = await colour(page, "--border")

    // The field heads the panel and has no line above it.
    expect(await style(partOf(group(page)), "border-top-width")).toEqual({
      "border-top-width": "0px",
    })
    // The set and the songs each sit under a 1 px line in the border colour,
    // which runs from one edge of the panel to the other.
    for (const inner of [setCard(page), songList(page)]) {
      const part = partOf(inner)
      expect(await style(part, "border-top-width", "border-top-color")).toEqual({
        "border-top-width": "1px",
        "border-top-color": border,
      })
      const off = await part.evaluate((p) => {
        const aside = p.closest("[data-next-take-panel]")!
        const edge = aside.getBoundingClientRect().left + aside.clientLeft
        const at = p.getBoundingClientRect()
        return { left: at.left - edge, width: at.width - aside.clientWidth }
      })
      expect(Math.abs(off.left)).toBeLessThan(0.5)
      expect(Math.abs(off.width)).toBeLessThan(0.5)
    }
    // The groups have no frame of their own: the panel is the one group.
    for (const inner of [setCard(page), songList(page)]) {
      expect(await style(inner, "border-top-width", "border-top-left-radius")).toEqual({
        "border-top-width": "0px",
        "border-top-left-radius": "0px",
      })
    }
  })

  test("the panel is 26rem from 1100 px and 22.5rem under it, following the scale", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    // Layout works in 1/64 px: 22.5 rem of 20.8 px comes out as 467.98. Once
    // the panel has risen into place, as a box is only measured then.
    const width = async () => {
      await settled(page)
      return panel(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))
    }

    await expect.poll(width).toBe(416)
    await page.setViewportSize({ width: 1000, height: 820 })
    await expect.poll(width).toBe(360)

    // 130 %, as Appearance sets it: the root's font is 20.8 px, 1100 px of
    // 16 px is then 1430 px of 20.8, and the panel is 22.5 of those rem.
    await page.setViewportSize({ width: 1280, height: 820 })
    await expect.poll(width).toBe(416)
    await page.evaluate(() => (document.documentElement.style.fontSize = "20.8px"))
    await expect.poll(width).toBe(468)
  })

  test("a long next take name wraps and its take number follows its end", async ({ page }) => {
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)
    await settled(page)
    const before = (await setCard(page).boundingBox())!.y

    // A new song, two lines long with room for its " #1" on the second: the
    // stress song's name fills its second line, and its "#3" goes to a third.
    await field(page).fill("Dancing barefoot on the roof of the brewery")
    const line = parseFloat((await style(field(page), "line-height"))["line-height"])
    const at = (await field(page).boundingBox())!
    expect(at.height).toBeGreaterThanOrEqual(2 * line)

    const go = group(page).locator("[data-take-go]")
    await expect(go).toBeVisible()
    const num = (await go.boundingBox())!
    expect(num.x).toBeGreaterThanOrEqual(at.x)
    expect(num.x + num.width).toBeLessThanOrEqual(at.x + at.width)
    expect(num.y).toBeGreaterThanOrEqual(at.y)
    expect(num.y + num.height).toBeLessThanOrEqual(at.y + at.height)
    // On the last line, where the name ends: 6 px of padding under it.
    const centre = num.y + num.height / 2
    expect(centre).toBeGreaterThan(at.y + at.height - 6 - line)

    // The field grew by the line the name wrapped to, and pushed the set down.
    const after = (await setCard(page).boundingBox())!.y
    expect(Math.abs(after - before - line)).toBeLessThanOrEqual(1)
  })

  test("a line break pasted into the next take name becomes a space", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await field(page).fill("Pałyn\nViasna")
    await expect(field(page)).toHaveValue("Pałyn Viasna")
  })

  test("a line break pasted into the middle of the name leaves the caret after the paste", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await field(page).fill("Pałyn")
    await field(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 2))
    await page.keyboard.insertText("a\nb")
    await expect(field(page)).toHaveValue("Paa błyn")
    // Just after the "b", not at the end of the name.
    await expect
      .poll(() =>
        field(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
      )
      .toEqual([5, 5])
  })

  test("the next take label has no capitals", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    expect(await style(group(page).locator("label"), "text-transform", "font-size")).toEqual({
      "text-transform": "none",
      "font-size": "12px",
    })
  })

  test("the set row the field names is grey and next and the tick are in the text colour", async ({
    page,
  }) => {
    // Pałyn and Sonca are played tonight; Viasna is named, Ahoń comes after.
    await openEvening(page, withSets())
    await setRow(page, "Viasna").click()
    const named = page.locator("[data-set-song][aria-current='true']")
    await expect(named).toHaveAttribute("data-set-song", "Viasna")
    const text = await colour(page, "--foreground")
    await expect(named).toHaveCSS("background-color", await colour(page, "--selected"))
    await expect(setRow(page, "Ahoń").getByText("next", { exact: true })).toHaveCSS("color", text)
    await expect(setRow(page, "Pałyn").locator("[data-played-check]")).toHaveCSS("color", text)
  })

  test("the arrow keys row shows the shared focus ring", async ({ page }) => {
    await openApp(page, { before: withSets() })
    await startRehearsal(page)
    await field(page).click()
    await page.keyboard.press("ArrowDown")
    const row = page.locator("[data-highlighted]")
    await expect(row).toHaveCount(1)
    await expect(row).toHaveCSS("border-top-color", await colour(page, "--ring"))
  })

  test("a long set name wraps and its played count stays whole", async ({ page }) => {
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)
    await settled(page)
    const title = setCard(page).locator("h2")
    const [name, played] = [title.locator("span").first(), title.locator("span").last()]
    await expect(played).toContainText("of 10 played")
    for (const part of [name, played]) {
      expect(await part.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    // The name's words are all there, and the count is on one line.
    await expect(name).toHaveText("Gig on the 25th at the old brewery with the horn section")
    const lineHeight = parseFloat((await style(played, "line-height"))["line-height"])
    expect((await played.boundingBox())!.height).toBeLessThan(lineHeight * 1.5)
    const inside = (await title.boundingBox())!
    const count = (await played.boundingBox())!
    expect(count.x + count.width).toBeLessThanOrEqual(inside.x + inside.width + 0.5)
  })

  test("a cut song name in a row is whole in the shared tip, with no native title left in the panel", async ({
    page,
  }) => {
    await openBandApp(page, { stress: "rehearsal" })
    await startRehearsal(page, 33)
    const long = "Dancing barefoot on the roof of the old brewery"
    const name = setRow(page, long).locator("[data-row-title]")
    await expect(name).toHaveText(long)
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await name.hover()
    await expect(page.locator("[data-whole][data-state$='open']")).toHaveText(long)
    await expect(panel(page).locator("[title]")).toHaveCount(0)
  })

  test.describe("a song's old name typed in the field", () => {
    const link = (page: Page) =>
      page
        .locator("[data-slot='popover-content']")
        .getByRole("button", { name: "Make Palyn a new song" })

    test("the old name's line floats in a popover and the field keeps focus", async ({ page }) => {
      await openApp(page, { before: OLD })
      await startRehearsal(page)
      await field(page).fill("Palyn")
      const line = page.locator("[data-slot='popover-content'] [data-old-name]")
      await expect(line).toBeVisible()
      await expect(line).toHaveText("Palyn is Pałyn now. Make Palyn a new song")
      await expect(field(page)).toBeFocused()
      // The shared link: underlined, in the text's colour, not the muted grey
      // of the words before it.
      expect(await style(link(page), "text-decoration-line", "color")).toEqual({
        "text-decoration-line": "underline",
        color: await colour(page, "--foreground"),
      })
    })

    test("Escape leaves the field and finishes nothing while the line shows", async ({ page }) => {
      await openApp(page, { before: OLD })
      await startRehearsal(page)
      await field(page).fill("Palyn")
      await expect(link(page)).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(field(page)).not.toBeFocused()
      expect(await callCount(page, "finish_rehearsal")).toBe(0)
      await expect(recordButton(page, 1)).toBeVisible()
    })
  })
})
