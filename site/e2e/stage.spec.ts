import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures.ts"

// stage.html on its own, as a frame of the page sees it: the page's messages
// are posted to it directly here.

// A step back reloads the frame: asked mid-reload, the scene is none yet.
const scene = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.scene ?? null).catch(() => null)
const post = (page: Page, message: object) =>
  page.evaluate((m) => window.postMessage(m, "*"), message)
const step = (page: Page, n: number) => post(page, { type: "rr-step", step: n })

/** The player's clock, in seconds: "1:52 / 2:46" is 112. */
async function clock(page: Page): Promise<number> {
  const text = await page.locator("span.tnum", { hasText: "/ 2:46" }).innerText()
  const [m, s] = text.split("/")[0].trim().split(":").map(Number)
  return m * 60 + s
}

test("the hero plays the bridge of Pałyn 2 on repeat", async ({ page }) => {
  await page.goto("/stage.html#hero")
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("hero")
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible()
  const song = await page.evaluate(() => {
    const s = (window as unknown as { __SONG__: { bridge: number; bar: number } }).__SONG__
    return { from: s.bridge, to: s.bridge + 8 * s.bar }
  })
  const first = await clock(page)
  await expect.poll(() => clock(page), { timeout: 2_000 }).not.toBe(first)
  for (let i = 0; i < 6; i++) {
    const at = await clock(page)
    expect(at).toBeGreaterThanOrEqual(Math.floor(song.from) - 1)
    expect(at).toBeLessThanOrEqual(Math.ceil(song.to) + 1)
    await page.waitForTimeout(400)
  }
})

test("held, the hero stands still, and goes on when let go", async ({ page }) => {
  await page.goto("/stage.html#hero")
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("hero")
  await post(page, { type: "rr-hold", hold: true })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.held)).toBe("true")
  const at = await clock(page)
  await page.waitForTimeout(1_500)
  expect(await clock(page)).toBe(at)
  await post(page, { type: "rr-hold", hold: false })
  await expect.poll(() => clock(page), { timeout: 2_000 }).not.toBe(at)
})

test("the story goes through its four steps", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 0)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("setup")
  await expect(page.getByRole("button", { name: /Stop checking/ })).toBeVisible()

  await step(page, 1)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("record")
  await expect(page.locator("h1")).toContainText(/Viasna\s*2/)
  await expect(page.getByText("clipped 3×")).toBeVisible({ timeout: 6_000 })

  await step(page, 2)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("review")
  await expect(page.locator("#take-name")).toBeVisible()

  await step(page, 3)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("history")
  await expect(page.getByText("New songs").first()).toBeVisible()
})

test("a jump from the first step to the last ends on the last", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 0)
  await step(page, 3)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("history")
  await page.waitForTimeout(1_500)
  expect(await scene(page)).toBe("history")
})

test("a step back starts the story again", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 3)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("history")
  await step(page, 0)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("setup")
  await expect(page.getByRole("button", { name: /Stop checking/ })).toBeVisible()
})
