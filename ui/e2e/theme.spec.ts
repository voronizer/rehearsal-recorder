import {
  expect,
  openApp,
  openHistory,
  recordTake,
  startButton,
  startRehearsal,
  style,
  test,
  themed,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The decided theme (spec F1-F11), as the page shows it: the values in
// src/index.css are checked as text in src/lib/theme.test.ts, and what
// follows from them here.

/** An oklch colour's numbers. The build may write 0.56 as 56% and drop the
 *  zero in 0.24, so the string is read rather than compared. */
function oklch(text: string): number[] {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(text.trim())
  if (!m) throw new Error(`not an oklch colour: ${text}`)
  return [m[2] ? Number(m[1]) / 100 : Number(m[1]), Number(m[3]), Number(m[4])]
}

/** The accent: lightness 0.56, chroma 0.24, hue 266. */
function expectCobalt(text: string) {
  const [l, c, h] = oklch(text)
  expect(l).toBeCloseTo(0.56, 3)
  expect(c).toBeCloseTo(0.24, 3)
  expect(h).toBeCloseTo(266, 1)
}

const root = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name)

test("the accent is cobalt in the light theme and in the dark one", async ({ page }) => {
  await openApp(page, { before: themed("light") })
  await expect(startButton(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
  expectCobalt(await root(page, "--primary"))
  expectCobalt(await root(page, "--ring"))

  await openApp(page, { before: themed("dark") })
  await expect(startButton(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)
  expectCobalt(await root(page, "--primary"))
  expectCobalt(await root(page, "--ring"))
})

test("body text is 14 px at scale 1, and follows the scale", async ({ page }) => {
  await openApp(page)
  await expect(startButton(page)).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("14px")
  // rem, not px: the Appearance scale moves it with everything else.
  await page.evaluate(() => (document.documentElement.style.fontSize = "20.8px"))
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("18.2px")
})

test("the header's subtitle is written as it reads, not in capitals (F7)", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  const subtitle = page.locator("header").getByText("Rehearsal", { exact: true })
  await expect(subtitle).toBeVisible()
  expect(await style(subtitle, "text-transform", "letter-spacing")).toEqual({
    "text-transform": "none",
    "letter-spacing": "normal",
  })
  // innerText is the text as drawn, capitals made by the style and all.
  expect(await subtitle.innerText()).toBe(await subtitle.evaluate((el) => el.textContent))
})

test("a figure is in the system font, with digits of one width", async ({ page }) => {
  await openApp(page)
  await openHistory(page)
  const figure = page.locator("span.tnum").first()
  await expect(figure).toBeVisible()
  const look = await figure.evaluate((e) => {
    const cs = getComputedStyle(e)
    return { family: cs.fontFamily, numeric: cs.fontVariantNumeric }
  })
  expect(look.family.startsWith("ui-monospace")).toBe(false)
  expect(look.numeric).toBe("tabular-nums")
})

test.describe("a take's bar", () => {
  const corner = (bar: ReturnType<Page["locator"]>) =>
    bar.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)

  test("has 4 px corners after a take, under Last time, in History and on a song (F9)", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    const lastTime = page.getByRole("complementary", { name: "Last time" })
    const goes = lastTime.locator("[data-song='Pałyn'] [data-columns] [data-bar]")
    await expect(goes.first()).toBeVisible()
    expect(await corner(goes.first())).toBe("4px")

    // A second go at Viasna tonight, so the screen after it has bars.
    await openApp(page, {
      before: "window.__TONIGHT__ = [{name: 'Viasna', duration_sec: 18}];",
    })
    await startRehearsal(page, 2)
    await recordTake(page, 2)
    const summary = page.locator("header [data-take-figures] [role='img'] [data-bar]")
    await expect(summary.first()).toBeVisible()
    expect(await corner(summary.first())).toBe("4px")

    await openApp(page)
    const list = await openHistory(page)
    const strip = list.getByRole("button", { name: /^Tuesday jam/ }).locator("[data-strip]")
    expect(await corner(strip.locator("span").first())).toBe("4px")

    // A song's page draws each evening's takes as bars, to scale. (Marks
    // draws each mark's take as its wave, which has no corners.)
    await page.getByRole("radio", { name: "Songs", exact: true }).click()
    const rung = page.locator("[data-rung] [data-bars] > span").first()
    await expect(rung).toBeVisible()
    expect(await corner(rung)).toBe("4px")
  })

  test("at its narrowest, 2 px, still draws in History's strip", async ({ page }) => {
    await openApp(page)
    const list = await openHistory(page)
    const strip = list.getByRole("button", { name: /^Tuesday jam/ }).locator("[data-strip]")
    // Squeezed until every bar is at its least. A 4 px corner on a 2 px bar
    // is cut down to fit it (each pair of corners at most the side they
    // share), so the bar is a pill there, not gone.
    await strip.evaluate((e) => ((e as HTMLElement).style.width = "40px"))
    const bar = strip.locator("span").first()
    const box = (await bar.boundingBox())!
    expect(box.width).toBeCloseTo(2, 1)
    expect(box.height).toBeCloseTo(6, 1)

    // The same few pixels with the bar there and with it hidden: they differ.
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height }
    const shown = await page.screenshot({ clip, animations: "disabled" })
    await bar.evaluate((e) => ((e as HTMLElement).style.visibility = "hidden"))
    const hidden = await page.screenshot({ clip, animations: "disabled" })
    expect(shown.equals(hidden)).toBe(false)
  })
})

test.describe("motion", () => {
  // The other tests run with less motion asked for (playwright.config.ts);
  // these are about the motion itself.
  test.use({ reducedMotion: "no-preference" })

  /** A dialog on a screen that is not recording: History's Rename rehearsal. */
  async function openDialog(page: Page) {
    await openHistory(page)
    await page.getByRole("button", { name: "Rename rehearsal Tuesday jam" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    return dialog
  }
  const animation = (dialog: ReturnType<Page["getByRole"]>) =>
    dialog.evaluate((e) => {
      const cs = getComputedStyle(e)
      return { name: cs.animationName, duration: cs.animationDuration }
    })

  test("a dialog opens in 220 ms", async ({ page }) => {
    await openApp(page)
    const dialog = await openDialog(page)
    expect(await animation(dialog)).toEqual({ name: "enter", duration: "0.22s" })
  })

  test("a hover's colour takes 200 ms, on the curve every entrance has", async ({ page }) => {
    await openApp(page)
    const look = await page.getByRole("button", { name: "History", exact: true }).evaluate((e) => {
      const cs = getComputedStyle(e)
      return { duration: cs.transitionDuration, timing: cs.transitionTimingFunction }
    })
    expect(look.duration).toContain("0.2s")
    expect(look.timing).toContain("cubic-bezier(0.2, 0.8, 0.2, 1)")
  })

  test("a dialog is there at once under the system's Reduce motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openApp(page)
    const dialog = await openDialog(page)
    expect((await animation(dialog)).name).toBe("none")
  })

  test("an entrance rises 12 px and fades over 250 ms, a group at a time", async ({ page }) => {
    await openApp(page)
    await expect(startButton(page)).toBeVisible()
    const look = await page.evaluate(() => {
      const el = document.createElement("div")
      el.className = "animate-rise"
      el.style.setProperty("--i", "3")
      document.body.append(el)
      const cs = getComputedStyle(el)
      const out = { name: cs.animationName, duration: cs.animationDuration, delay: cs.animationDelay, fill: cs.animationFillMode }
      el.remove()
      return out
    })
    expect(look).toEqual({ name: "rise", duration: "0.25s", delay: "0.12s", fill: "both" })
  })

  test("an entrance stays still under Reduce motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openApp(page)
    await expect(startButton(page)).toBeVisible()
    const name = await page.evaluate(() => {
      const el = document.createElement("div")
      el.className = "animate-rise"
      document.body.append(el)
      const n = getComputedStyle(el).animationName
      el.remove()
      return n
    })
    expect(name).toBe("none")
  })

  /** The animation an element with these classes gets, put on the page for
   *  the moment of asking. */
  const animationOf = (page: Page, className: string) =>
    page.evaluate((c) => {
      const el = document.createElement("div")
      el.className = c
      document.body.append(el)
      const name = getComputedStyle(el).animationName
      el.remove()
      return name
    }, className)

  test("nothing moves on the recording screen, and moves again after it", async ({ page }) => {
    await openApp(page)
    const html = page.locator("html")
    await startRehearsal(page)
    await expect(html).not.toHaveAttribute("data-recording")
    expect(await animationOf(page, "animate-rise")).toBe("rise")

    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(html).toHaveAttribute("data-recording")
    // Plain and behind a variant, as a dialog or a menu asks for it.
    expect(await animationOf(page, "animate-rise")).toBe("none")
    expect(await animationOf(page, "animate-in")).toBe("none")
    expect(await animationOf(page, "data-[state=open]:animate-in")).toBe("none")
    expect(await animationOf(page, "animate-out")).toBe("none")

    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(page.locator("[data-take-summary]")).toBeVisible()
    await expect(html).not.toHaveAttribute("data-recording")
    expect(await animationOf(page, "animate-rise")).toBe("rise")
  })

  /** The CSS animations playing on the page now, by name: a meter's fill is
   *  a transition and the clock is text, so neither is one of these. */
  const playing = (page: Page) =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a instanceof CSSAnimation && a.playState === "running")
        .map((a) => (a as CSSAnimation).animationName)
    )

  test("while a take records, no CSS animation plays on the page", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.locator("html")).toHaveAttribute("data-recording")
    await expect(page.locator("[data-recording-line]")).toBeVisible()
    // Let the screen settle first: polling until the first empty reading
    // would let through an animation that starts a moment later, such as a
    // spinner put up after the first levels. Past 0:01 the levels and the
    // clock have come round more than once.
    await expect(page.getByRole("timer")).toHaveText(/^0:(0[2-9]|[1-5]\d)$/, { timeout: 10_000 })
    // The record dot and every spinner included: still, all of it.
    expect(await playing(page)).toEqual([])

    // A spinner put up meanwhile stands still too.
    expect(await animationOf(page, "animate-spin")).toBe("none")
  })

  test("a spinner stands still under Reduce motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openApp(page)
    await expect(startButton(page)).toBeVisible()
    expect(await animationOf(page, "animate-spin")).toBe("none")
  })
})
