import type { Locator } from "@playwright/test"
import {
  colour,
  expect,
  hold,
  letGo,
  openEvening,
  settled,
  style,
  test,
  themed,
  TONIGHT,
} from "./app.ts"

// The evening's songs on the rehearsal screen as one group (owner,
// 2026-10-12, Q1): the legend and the buttons at its head, each song under
// a 1 px line, and the take row on the shared pieces. Tonight is TONIGHT, in
// app.ts: take 1 Pałyn 3:20 (starred), take 2 Pałyn 0:12 (starred), take 3
// Viasna 0:12 with a mark at 4 s, take 4 Pałyn 0:12 (a false start).

const row = (overview: Locator, n: number) => overview.locator(`[data-take="${n}"]`)
/** The take's bar: the button that opens it, and the way in by the keys. */
const bar = (overview: Locator, n: number) =>
  row(overview, n).getByRole("button", { name: new RegExp(`^Take ${n} `) })
const play = (overview: Locator, n: number) =>
  row(overview, n).getByRole("button", { name: /^(Play|Pause|Could not load) / })
/** What the bar's number and name sit on. */
const titleOf = (it: Locator) => it.locator("[data-bar-title]")
/** A take's length as its row draws it: with the time played before it while it plays. */
const lengthOf = (it: Locator, text: string) => row(it, 1).locator(".tnum").filter({ hasText: text })

type Box = { x: number; y: number; width: number; height: number }
const box = async (it: Locator): Promise<Box> => (await it.boundingBox())!

/** The same box, to a quarter of a pixel (layout works in 1/64 px). */
function expectSame(now: Box, was: Box, what: string) {
  for (const k of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(now[k] - was[k]), `${what} ${k}: ${now[k]} against ${was[k]}`).toBeLessThan(0.25)
  }
}

/** How much of a colour shows: 1 for a solid one. The browser writes a colour
 *  with some see-through as `oklch(… / 0.1)` or `rgba(…, 0.1)`. */
function alphaOf(css: string): number {
  const slash = /\/\s*([\d.]+)(%?)\s*\)/.exec(css)
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1)
  const comma = /^rgba\(([^)]*)\)$/.exec(css)
  return comma ? Number(comma[1].split(",")[3]) : 1
}

test.describe("the evening's songs", () => {
  test("the songs are one group with a line between songs", async ({ page }) => {
    const overview = await openEvening(page)
    const groups = overview.locator("[data-songs-group]")
    await expect(groups).toHaveCount(1)
    const it = await style(
      groups,
      "background-color",
      "border-top-left-radius",
      "border-bottom-right-radius",
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width"
    )
    expect(it).toEqual({
      "background-color": await colour(page, "--card"),
      "border-top-left-radius": "12px",
      "border-bottom-right-radius": "12px",
      "border-top-width": "0px",
      "border-right-width": "0px",
      "border-bottom-width": "0px",
      "border-left-width": "0px",
    })

    // The head, then every song under it: Pałyn, Viasna, Sonca, Not named.
    const head = groups.locator("[data-overview-head]")
    await expect(head).toHaveCount(1)
    const songs = groups.locator("[data-song-group]")
    await expect(songs).toHaveCount(4)
    expect(await songs.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "Pałyn",
      "Viasna",
      "Sonca",
      "Not named",
    ])
    const border = await colour(page, "--border")
    for (const song of await songs.all()) {
      expect(await style(song, "border-top-width", "border-top-color")).toEqual({
        "border-top-width": "1px",
        "border-top-color": border,
      })
    }
    // They are inside the one fill, not cards of their own.
    for (const song of await songs.all()) {
      expect((await style(song, "background-color"))["background-color"]).toBe("rgba(0, 0, 0, 0)")
    }
  })

  test("the takes nobody named are last in the group with a muted heading", async ({ page }) => {
    const overview = await openEvening(page)
    const songs = overview.locator("[data-songs-group] [data-song-group]")
    const last = songs.last()
    await expect(last).toHaveAttribute("aria-label", "Not named")
    // Dashed no more: a line above it like the others, and nothing round it.
    const sides = await style(
      last,
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style",
      "border-right-width",
      "border-bottom-width",
      "border-left-width"
    )
    expect(Object.values(sides)).not.toContain("dashed")
    expect(sides["border-top-style"]).toBe("solid")
    expect(sides["border-right-width"] + sides["border-bottom-width"] + sides["border-left-width"]).toBe(
      "0px0px0px"
    )
    expect(await style(last.getByRole("heading", { level: 3 }), "color")).toEqual({
      color: await colour(page, "--muted-foreground"),
    })
    // A named song's heading is the text's own colour.
    expect(await style(songs.first().getByRole("heading", { level: 3 }), "color")).toEqual({
      color: await colour(page, "--foreground"),
    })
  })

  test("the overview says no figures of its own", async ({ page }) => {
    // The header has them (Length, Takes, In the cloud, On disk).
    const overview = await openEvening(page)
    await expect(overview.getByText(/\bplayed\b/)).toHaveCount(0)
    await expect(overview.getByText(/^in the cloud$/)).toHaveCount(0)
  })

  test("the songs group rises first", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    const overview = await openEvening(page)
    const it = await style(overview.locator("[data-songs-group]"), "--i", "animation-name")
    expect(it["--i"].trim()).toBe("0")
    expect(it["animation-name"]).toBe("rise")
  })

  test("the row opens by keyboard through its bar", async ({ page }) => {
    // A guard: the whole row opens the take with a click, and the bar is
    // the one to reach with Tab.
    const overview = await openEvening(page)
    await play(overview, 1).focus()
    await page.keyboard.press("Tab")
    await expect(bar(overview, 1)).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
    await expect(overview).toHaveCount(0)
  })
})

test.describe("the take row", () => {
  test("the row's play button is the shared one and shows a spinner after one second", async ({ page }) => {
    const overview = await openEvening(page)
    const button = play(overview, 1)
    const spinner = button.locator(".animate-spin")
    await settled(page)
    const was = await box(button)
    // The take is slow to open: the fake holds it until it is let go.
    await hold(page, "player_open")
    const since = Date.now()
    const at = (ms: number) => page.waitForTimeout(Math.max(0, ms - (Date.now() - since)))
    await button.click()
    await expect(button).toHaveAttribute("data-look", "loading")
    await at(500)
    expect(await spinner.isVisible(), "a spinner at 0.5 s").toBe(false)
    await at(900)
    expect(await spinner.isVisible(), "a spinner at 0.9 s").toBe(false)
    await expect(spinner, "a spinner by 2 s").toBeVisible({ timeout: 2000 })
    // The spinner takes the play button's place, in the same box.
    expectSame(await box(button), was, "the play button with the spinner")

    await letGo(page, "player_open")
    await expect(row(overview, 1).getByRole("button", { name: /^Pause Pałyn / })).toBeVisible()
    await expect(spinner).toHaveCount(0)
  })

  test("a take that cannot be loaded says so on its play button", async ({ page }) => {
    // The fake answers a file under /gone/ as Python does one that is not on disk.
    const overview = await openEvening(page, "", [
      { name: "Pałyn", duration_sec: 200, tracks: [{ name: "Guitar", file: "/gone/p1.wav" }] },
    ])
    const button = play(overview, 1)
    await expect(button).toHaveAttribute("data-look", "idle")
    await button.click()
    await expect(button).toHaveAttribute("data-look", "failed")
    await expect(button).toHaveAccessibleName("Could not load Pałyn 1. Try again")
    await expect(button).toBeEnabled()
  })

  test("a playing bar keeps its width and its length keeps its place", async ({ page }) => {
    const overview = await openEvening(page)
    await settled(page)
    const length = lengthOf(overview, "3:20")
    await expect(length).toHaveCount(1)
    const bars = await box(bar(overview, 1))
    const lengths = await box(length)

    await play(overview, 1).click()
    await expect(row(overview, 1).getByRole("button", { name: /^Pause / })).toBeVisible()
    // Past 0:01: the time played is in front of the length by now.
    await expect.poll(() => length.innerText()).toMatch(/^0:(0[2-9]|[1-5]\d) \/ 3:20$/)
    expectSame(await box(bar(overview, 1)), bars, "the bar")
    expectSame(await box(length), lengths, "the length")
  })

  test("the take row's toolbar is star, rename, cloud, delete", async ({ page }) => {
    const overview = await openEvening(page)
    await settled(page)
    const it = row(overview, 1)
    await it.hover()
    const kinds: [string, RegExp][] = [
      ["star", /^Star /],
      ["rename", /^Rename take /],
      ["cloud", /^(Copy .* to the cloud|Cloud copies of .*)$/],
      ["delete", /^Delete take /],
    ]
    const labels = await it
      .getByRole("button")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))
    const order = labels
      .map((label) => kinds.find(([, pattern]) => pattern.test(label))?.[0])
      .filter((kind) => kind !== undefined)
    expect(order).toEqual(["star", "rename", "cloud", "delete"])

    const at = async (kind: string) => {
      const [, pattern] = kinds.find(([k]) => k === kind)!
      return box(it.getByRole("button", { name: pattern }))
    }
    const [rename, cloud, remove] = [await at("rename"), await at("cloud"), await at("delete")]
    const between = (a: Box, b: Box) => b.x - (a.x + a.width)
    // Delete is set apart: it cannot be undone by a slip of the hand.
    expect(between(cloud, remove) - between(rename, cloud)).toBeGreaterThanOrEqual(8)
  })

  test("false start is a badge", async ({ page }) => {
    const overview = await openEvening(page)
    const badge = row(overview, 4).locator("[data-slot='badge']")
    await expect(badge).toHaveText("false start")
    await expect(badge).toHaveAttribute("data-variant", "warn")
    // Only the false starts have one.
    await expect(row(overview, 1).locator("[data-slot='badge']")).toHaveCount(0)
  })

  test("a greyed Send starred says why in a tip and in its description", async ({ page }) => {
    const overview = await openEvening(page, "", [{ name: "Pałyn", duration_sec: 200 }])
    const send = overview.getByRole("button", { name: /Send starred/ })
    await expect(send).toBeDisabled()
    await expect(send).toHaveAccessibleDescription("No take has ★")
    // The tip says it, not a native title, which would say it twice.
    await expect(send).not.toHaveAttribute("title")
    await send.hover()
    await expect(page.getByRole("tooltip")).toHaveText("No take has ★")
    await page.mouse.move(0, 0, { steps: 8 })
    await expect(page.getByRole("tooltip")).toHaveCount(0)

    const clear = overview.getByRole("button", { name: /Clear false starts/ })
    await expect(clear).not.toHaveAttribute("title")
    // Nothing here is a false start: it says why it is off.
    await expect(clear).toHaveAccessibleDescription("No take is shorter than 30 s without ★ or marks")
  })

  test("a take's star says what it does in a tip", async ({ page }) => {
    const overview = await openEvening(page)
    const star = row(overview, 1).getByRole("button", { name: /^Star / })
    await expect(star).not.toHaveAttribute("title")
    await row(overview, 1).hover()
    await star.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Starred. Click to take the star off")
    await page.mouse.move(0, 0, { steps: 8 })
    await expect(page.getByRole("tooltip")).toHaveCount(0)
  })

  test("a take's cloud button says what it does in a tip", async ({ page }) => {
    const overview = await openEvening(page)
    const cloud = row(overview, 1).getByRole("button", { name: /^Copy .* to the cloud$/ })
    await expect(cloud).not.toHaveAttribute("title")
    await row(overview, 1).hover()
    await cloud.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Copy this take to the cloud folder")
  })

  test("the bar has no native title, and a take that failed to copy says why in a tip", async ({ page }) => {
    const tonight = TONIGHT.map((t, i) => (i === 5 ? { ...t, cloud_error: "Cloud folder not found" } : t))
    const overview = await openEvening(page, "", tonight)
    await expect(overview.locator("[title]")).toHaveCount(0)
    const said = row(overview, 6).getByText("Not in the cloud", { exact: true })
    await expect(said).toBeVisible()
    await said.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Cloud folder not found")
    // And the bar says it to a screen reader: the take, its state, then why.
    await expect(bar(overview, 6)).toHaveAccessibleName("Take 6 Take 6, not in the cloud")
    await expect(bar(overview, 6)).toHaveAccessibleDescription("Cloud folder not found")
  })

  test("a chosen song pill is grey, not the accent", async ({ page }) => {
    const overview = await openEvening(page)
    await row(overview, 1).hover()
    await row(overview, 1).getByRole("button", { name: /^Rename take / }).click()
    const dialog = page.getByRole("dialog", { name: "Rename take" })
    const pill = dialog.locator("[data-song-choice='Pałyn']").first()
    await expect(pill).toHaveAttribute("aria-current", "true")
    await page.mouse.move(0, 0)
    await expect(pill).toHaveCSS("background-color", await colour(page, "--selected"))
    // No accent in its frame either.
    expect((await style(pill, "border-top-color"))["border-top-color"]).not.toBe(
      await colour(page, "--primary")
    )
  })
})

test.describe("the bar of a short take", () => {
  test("a mark tick passes under a short take's name", async ({ page }) => {
    const overview = await openEvening(page)
    const short = bar(overview, 3)
    const tick = short.locator("[data-mark-colour]")
    await expect(tick).toHaveCount(1)
    const title = titleOf(short)
    await settled(page)

    // The tick lands on the name: without that this proves nothing.
    const tickAt = await box(tick)
    const titleAt = await box(title)
    const x = tickAt.x + tickAt.width / 2
    expect(x, "the tick's x in the title's box").toBeGreaterThan(titleAt.x)
    expect(x, "the tick's x in the title's box").toBeLessThan(titleAt.x + titleAt.width)

    // The title sits on the bar's own fill, solid, so the tick does not
    // strike it out.
    const fill = ["background-color", "background-image"]
    const barFill = await style(short, ...fill)
    expect(await style(title, ...fill)).toEqual(barFill)
    expect(alphaOf(barFill["background-color"])).toBe(1)
    // Nothing of the tick shows at its middle: the title is over it.
    const over = await tick.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return hit ? hit.closest("[data-mark-colour]") !== null : null
    })
    expect(over, "the tick is the topmost thing at its middle").toBe(false)
  })

  test("the played part washes over the name while the take plays in place", async ({ page }) => {
    const overview = await openEvening(page)
    const short = bar(overview, 3)
    const number = short.locator(".tnum").first()
    await settled(page)
    await play(overview, 3).click()
    await expect(row(overview, 3).getByRole("button", { name: /^Pause / })).toBeVisible()
    const length = row(overview, 3).locator(".tnum").filter({ hasText: "0:12" })
    // Past 0:02, the wash reaches the number at the bar's left.
    await expect.poll(() => length.innerText()).toMatch(/^0:(0[2-9]|1\d) \/ 0:12$/)
    const at = await box(number)
    const over = await number.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + 2, r.y + r.height / 2)
      return hit ? { text: hit.textContent, hidden: hit.getAttribute("aria-hidden") } : null
    })
    expect(at.width).toBeGreaterThan(0)
    // The wash is drawn after the name: what is on top there says nothing.
    expect(over).toEqual({ text: "", hidden: "true" })
  })

  for (const theme of ["dark", "light"] as const) {
    test(`a starred short take's title keeps the bar's fill in the ${theme} theme`, async ({ page }) => {
      const overview = await openEvening(page, themed(theme))
      const starred = bar(overview, 2)
      await expect(starred).toHaveAttribute("data-starred", "true")
      const fill = ["background-color", "background-image"]
      const barFill = await style(starred, ...fill)
      expect(await style(titleOf(starred), ...fill)).toEqual(barFill)
      expect(alphaOf(barFill["background-color"])).toBe(1)
      // A flat tint over the card, not a see-through fill.
      expect(barFill["background-color"]).toBe(await colour(page, "--card"))
      expect(barFill["background-image"]).not.toBe("none")
    })
  }

  test("a short take bar is opaque in every state", async ({ page }) => {
    const overview = await openEvening(page)
    // The bars' colours fade in together as the takes arrive (200 ms): read
    // them once the false start's has.
    const card = await colour(page, "--card")
    const fill = async () => (await style(bar(overview, 4), "background-color"))["background-color"]
    await expect.poll(fill).toBe(card)
    const rest = await style(bar(overview, 3), "background-color", "background-image")
    const starred = await style(bar(overview, 2), "background-color", "background-image")
    const falseStart = await style(bar(overview, 4), "background-color", "background-image")
    for (const [state, fill] of [["rest", rest], ["starred", starred], ["false start", falseStart]] as const) {
      expect(alphaOf(fill["background-color"]), `${state} fill`).toBe(1)
    }
    expect(rest["background-color"]).toBe(await colour(page, "--muted"))
    expect(starred["background-color"]).toBe(await colour(page, "--card"))
    expect(falseStart["background-color"]).toBe(await colour(page, "--card"))
    expect(rest["background-image"]).toBe("none")
    expect(falseStart["background-image"]).toBe("none")
  })
})
