import {
  calls,
  callCount,
  expect,
  openApp,
  openBandApp,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// Step 6 of issue #12: the Next take field, its songs and the named song's
// go from before tonight sit together in a panel right of the rehearsal,
// set back on the panel colour as the setup screen's Last time is. See
// docs/superpowers/specs/2026-10-02-last-time-while-rehearsing-design.md.

const panel = (page: Page) => page.getByRole("complementary", { name: "Next take" })
const card = (page: Page, song: string) => panel(page).getByRole("region", { name: `${song} before tonight` })
const pill = (page: Page, song: string) => panel(page).locator(`[data-song-choice='${song}']`)
const toggle = (page: Page) => panel(page).getByRole("button", { name: /^(\d+ more|Fewer)$/ })
const nextField = (page: Page) => page.getByRole("textbox", { name: "Next take" })

test("the Next take field and its songs sit in a panel right of the overview", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await expect(panel(page).getByRole("textbox", { name: "Next take" })).toBeVisible()
  await expect(panel(page).getByRole("group", { name: "Next take" })).toBeVisible()
  await expect(page.locator("footer").getByRole("textbox")).toHaveCount(0)

  const box = (await panel(page).boundingBox())!
  const main = (await page.locator("main").boundingBox())!
  const header = (await page.locator("header").first().boundingBox())!
  const footer = (await page.locator("footer").boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(main.x + main.width - 1)
  expect(Math.abs(box.width - 416)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y + box.height - footer.y)).toBeLessThanOrEqual(1)

  // Set back from the page, as the setup screen's Last time column is.
  const colours = await page.evaluate(() => {
    const aside = document.querySelector("[data-next-take-panel]")!
    return {
      panel: getComputedStyle(aside).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }
  })
  expect(colours.panel).not.toBe(colours.page)
  expect(colours.panel).not.toBe("rgba(0, 0, 0, 0)")

  await page.setViewportSize({ width: 960, height: 680 })
  await expect
    .poll(async () => Math.round((await panel(page).boundingBox())!.width))
    .toBe(360)
  expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test.describe("the card", () => {
  test("a fresh rehearsal's card says how to see goes from before", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(
      panel(page).getByText("Name the next take after a song to see how it went before.")
    ).toBeVisible()
  })

  test("a song pill brings its last go from before tonight", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await pill(page, "Daroha").click()
    const daroha = card(page, "Daroha")
    await expect(daroha).toBeVisible()
    await expect(daroha.getByRole("heading", { level: 2 })).toContainText("before tonight")
    await expect(daroha.getByRole("button", { name: /^Play / })).toHaveCount(1)
    await expect(daroha.getByRole("button", { name: "Play Daroha 2" })).toBeVisible()
    await expect(daroha).toContainText("4:00")
    await expect(daroha).toContainText("25 Aug")
    await expect(toggle(page)).toHaveCount(0)
    // The rehearsal whose folder is gone had Daroha 9: it cannot be played.
    await expect(daroha).not.toContainText("Daroha 9")
  })

  test("the newest starred go is shown, and more opens the rest under it", async ({ page }) => {
    // The first row is measured: not while the card is still sliding in.
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openBandApp(page)
    await startRehearsal(page, 6)
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    const rows = palyn.getByRole("button", { name: /^(Play|Pause) / })
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAccessibleName("Play Pałyn 7")
    await expect(palyn).toContainText("22 Sep")
    await expect(toggle(page)).toHaveText(/^1 more/)
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false")

    const firstAt = (await rows.first().boundingBox())!
    await toggle(page).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1)).toHaveAccessibleName("Play Pałyn 3")
    await expect(palyn).toContainText("15 Sep")
    await expect(toggle(page)).toHaveText(/^Fewer/)
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true")
    const stillAt = (await rows.first().boundingBox())!
    expect(Math.abs(stillAt.x - firstAt.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(stillAt.y - firstAt.y)).toBeLessThanOrEqual(1)

    // Another song, and back: it starts folded again.
    await pill(page, "Viasna").click()
    await expect(card(page, "Viasna")).toBeVisible()
    await pill(page, "Pałyn").click()
    await expect(card(page, "Pałyn")).toBeVisible()
    await expect(toggle(page)).toHaveText(/^1 more/)
    await expect(rows).toHaveCount(1)
  })

  test("a song played only tonight says its goes are in the overview", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await page.locator("#take-name").fill("Sonca")
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(nextField(page)).toHaveValue("Sonca")
    await expect(
      panel(page).getByText("No goes at Sonca before tonight. Tonight's are in the overview.")
    ).toBeVisible()
  })

  test("a new song says it has no goes before tonight", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await nextField(page).fill("Brand new")
    await page.keyboard.press("Enter")
    await expect(panel(page).getByText("No goes at Brand new before tonight.")).toBeVisible()
  })

  test("a take open in the player hides the card, and the field stays where it was", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true" })
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: /Save take/ }).click()
    await pill(page, "Pałyn").click()
    await expect(card(page, "Pałyn")).toBeVisible()
    const fieldAt = (await nextField(page).boundingBox())!

    await page
      .locator("[aria-label='Rehearsal overview']")
      .getByRole("button", { name: /^Take 1 / })
      .click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(card(page, "Pałyn")).toHaveCount(0)
    const fieldNow = (await nextField(page).boundingBox())!
    expect(Math.abs(fieldNow.x - fieldAt.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(fieldNow.y - fieldAt.y)).toBeLessThanOrEqual(1)

    await page.keyboard.press("Escape")
    await expect(card(page, "Pałyn")).toBeVisible()
  })

  test("a take opened and put away leaves the card as it was", async ({ page }) => {
    await openBandApp(page)
    await startRehearsal(page, 6)
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    await toggle(page).click()
    await expect(toggle(page)).toHaveText(/^Fewer/)

    await page
      .locator("[aria-label='Rehearsal overview']")
      .getByRole("button", { name: /^Take 1 / })
      .click()
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(palyn).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(palyn).toBeVisible()
    // Still opened out, and not sliding in again: it never went away.
    await expect(toggle(page)).toHaveText(/^Fewer/)
    expect(await palyn.evaluate((el) => el.getAnimations().length)).toBe(0)
  })

  test("a take opened while the card slides in does not slide it in again", async ({ page }) => {
    await openBandApp(page)
    await startRehearsal(page, 6)
    // A slide slowed down, so the take is surely opened before it is over.
    await page.addStyleTag({
      content: "[aria-label$='before tonight'] { animation-duration: 5s !important }",
    })
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    await expect(palyn).toBeVisible()
    // Hidden mid-slide, the slide is cut short and never ends.
    await page
      .locator("[aria-label='Rehearsal overview']")
      .getByRole("button", { name: /^Take 1 / })
      .click()
    await expect(palyn).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(palyn).toBeVisible()
    expect(await palyn.evaluate((el) => el.getAnimations().length)).toBe(0)
  })

  test("a long title is cut short in the card's heading, whole on hover", async ({ page }) => {
    const long = "A very long song title that goes on and on past the panel"
    await openApp(page, { before: `window.__EXTRA_SONGS__ = ${JSON.stringify([long])}` })
    await startRehearsal(page)
    await nextField(page).fill(long)
    await page.keyboard.press("Enter")
    const title = card(page, long).locator("[data-before-title]")
    await expect(title).toHaveAttribute("title", long)
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

    await page.setViewportSize({ width: 960, height: 680 })
    await expect
      .poll(async () => Math.round((await panel(page).boundingBox())!.width))
      .toBe(360)
    expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})

/** Holds `name` in the fake until `letGo` is called. */
async function hold(page: Page, name: string) {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __HOLD__?: Record<string, Promise<void>>
      __LET_GO__?: () => void
    }
    w.__HOLD__ = { [n]: new Promise<void>((r) => (w.__LET_GO__ = r)) }
  }, name)
}
async function letGo(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __HOLD__?: object; __LET_GO__: () => void }
    w.__HOLD__ = {}
    w.__LET_GO__()
  })
}

test.describe("playing an earlier go", () => {
  /** Whether the fake's one player is playing. */
  const playing = (page: Page) =>
    page.evaluate(async () => {
      const w = window as unknown as {
        pywebview: { api: { player_state: () => Promise<{ playing?: boolean }> } }
      }
      return Boolean((await w.pywebview.api.player_state()).playing)
    })

  async function withDaroha(page: Page, options: { before?: string; after?: string } = {}) {
    await openApp(page, options)
    await startRehearsal(page)
    await pill(page, "Daroha").click()
    await expect(card(page, "Daroha")).toBeVisible()
  }

  test("play starts an earlier go in place, with no player", async ({ page }) => {
    await withDaroha(page)
    await card(page, "Daroha").getByRole("button", { name: "Play Daroha 2" }).click()
    await expect(card(page, "Daroha").getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
    const opened = (await calls(page, "player_open")).at(-1)!
    expect((opened.args[0] as { file: string }[])[0].file).toBe("/rec/older/d2.wav")
  })

  // A click made by a script, as a screen reader's or the site's story's is,
  // lands where the fake answers the opening in the same breath: loading
  // goes on and off in one render. The go must play all the same.
  test("a click from a script plays an earlier go too", async ({ page }) => {
    await withDaroha(page)
    const daroha = card(page, "Daroha")
    await daroha.getByRole("button", { name: "Play Daroha 2" }).evaluate((b: HTMLElement) => b.click())
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await expect.poll(() => playing(page)).toBe(true)
  })

  test("a note clicked from a script plays its go from 3 s before", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true" })
    await startRehearsal(page)
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    await palyn.locator("[data-note]").first().evaluate((n: HTMLElement) => n.click())
    await expect(palyn.getByRole("button", { name: "Pause Pałyn 2" })).toBeVisible()
    await expect.poll(async () => (await calls(page, "player_seek")).at(-1)?.args[0]).toBe(69)
  })

  test("a note clicked while its go is still opening plays from the note", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true" })
    await startRehearsal(page)
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    await hold(page, "player_open")
    const opens = await callCount(page, "player_open")
    await palyn.getByRole("button", { name: "Play Pałyn 2" }).click()
    await expect.poll(() => callCount(page, "player_open")).toBe(opens + 1)
    await palyn.locator("[data-note]").first().click()
    await letGo(page)
    await expect(palyn.getByRole("button", { name: "Pause Pałyn 2" })).toBeVisible()
    await expect.poll(async () => (await calls(page, "player_seek")).at(-1)?.args[0]).toBe(69)
  })

  test("an earlier go that cannot be opened says why", async ({ page }) => {
    await withDaroha(page, {
      after:
        "const api = window.pywebview.api; const media = api.take_media;" +
        "api.take_media = async (tracks, ...a) => tracks.some((t) => t.file === '/rec/older/d2.wav')" +
        " ? tracks.map((t) => ({ name: t.name, url: null, error: 'Missing file: d2.wav' }))" +
        " : media(tracks, ...a);",
    })
    const daroha = card(page, "Daroha")
    await daroha.getByRole("button", { name: "Play Daroha 2" }).click()
    await expect(daroha.getByRole("status")).toHaveText("Missing file: d2.wav")
    expect(await playing(page)).toBe(false)
  })

  test("an earlier take 2 and tonight's take 2 are told apart", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    for (const n of [1, 2]) {
      await recordTake(page, n)
      await page.getByRole("button", { name: /Save take/ }).click()
    }
    await pill(page, "Daroha").click()
    const daroha = card(page, "Daroha")
    await daroha.getByRole("button", { name: "Play Daroha 2" }).click()
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    const tonight = page.locator("[aria-label='Rehearsal overview'] [data-take='2']")
    await expect(tonight.getByRole("button", { name: /^Pause / })).toHaveCount(0)

    await tonight.getByRole("button", { name: /^Play / }).click()
    await expect(tonight.getByRole("button", { name: /^Pause / })).toBeVisible()
    await expect(daroha.getByRole("button", { name: "Play Daroha 2" })).toBeVisible()
  })

  test("a note plays its go from 3 s before", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true" })
    await startRehearsal(page)
    await pill(page, "Pałyn").click()
    const palyn = card(page, "Pałyn")
    await palyn.locator("[data-note]").first().click()
    await expect(palyn.getByRole("button", { name: "Pause Pałyn 2" })).toBeVisible()
    await expect.poll(async () => (await calls(page, "player_seek")).at(-1)?.args[0]).toBe(69)
  })

  test("Space pauses and plays it, Escape puts it away", async ({ page }) => {
    await withDaroha(page)
    const daroha = card(page, "Daroha")
    await daroha.getByRole("button", { name: "Play Daroha 2" }).click()
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await page.keyboard.press("Space")
    await expect(daroha.getByRole("button", { name: "Play Daroha 2" })).toBeVisible()
    await page.keyboard.press("Space")
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(daroha.getByRole("button", { name: /^Pause / })).toHaveCount(0)
    expect(await playing(page)).toBe(false)
    expect(await callCount(page, "finish_rehearsal")).toBe(0)
    await expect(page.getByText("Finish this rehearsal?")).toHaveCount(0)
  })

  test("Record stops an earlier go before the take starts", async ({ page }) => {
    await withDaroha(page, {
      after:
        "const api = window.pywebview.api; const start = api.start_take;" +
        "api.start_take = async (...a) => {" +
        " window.__PLAYING_AT_START__ = (await api.player_state()).playing; return start(...a); };",
    })
    const daroha = card(page, "Daroha")
    await daroha.getByRole("button", { name: "Play Daroha 2" }).click()
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    const atStart = await page.evaluate(
      () => (window as unknown as { __PLAYING_AT_START__: boolean }).__PLAYING_AT_START__
    )
    expect(atStart).toBe(false)
  })

  test("picking another song stops the earlier go", async ({ page }) => {
    await withDaroha(page)
    const daroha = card(page, "Daroha")
    await daroha.getByRole("button", { name: "Play Daroha 2" }).click()
    await expect(daroha.getByRole("button", { name: "Pause Daroha 2" })).toBeVisible()
    await pill(page, "Pałyn").click()
    await expect(card(page, "Pałyn")).toBeVisible()
    await expect(panel(page).getByRole("button", { name: /^Pause / })).toHaveCount(0)
    await expect.poll(() => playing(page)).toBe(false)
  })
})

test("the first take of a song tonight is measured against its go before tonight", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await pill(page, "Daroha").click()
  await expect(card(page, "Daroha")).toBeVisible()
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByText("Took 4:00 on 25 Aug")).toBeVisible()
  await expect(page.getByRole("progressbar", { name: "Against the last go" })).toHaveAttribute(
    "aria-valuemax",
    "240"
  )
})
