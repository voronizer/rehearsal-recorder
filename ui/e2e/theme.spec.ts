import { expect, openApp, openHistory, startButton, startRehearsal, test } from "./app.ts"
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

const dark = "window.localStorage.setItem('mock-python-config', JSON.stringify({theme:'dark', ui_scale:1}));"
const light = "window.localStorage.setItem('mock-python-config', JSON.stringify({theme:'light', ui_scale:1}));"

const root = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name)

test("the accent is cobalt in the light theme and in the dark one", async ({ page }) => {
  await openApp(page, { before: light })
  await expect(startButton(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
  expectCobalt(await root(page, "--primary"))
  expectCobalt(await root(page, "--ring"))

  await openApp(page, { before: dark })
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

test.describe("motion", () => {
  /** A dialog on a screen that is not recording: History's delete. */
  async function openDialog(page: Page) {
    await openHistory(page)
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
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
})
