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

test("the story goes through its five steps", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 0)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("setup")
  await expect(page.getByRole("button", { name: /Stop checking/ })).toBeVisible()

  // Last week's ★ go beside the song picked, then Record on it.
  await step(page, 1)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("record")
  await expect(page.locator("h1")).toContainText(/Pałyn\s*3/)
  await expect(page.getByText("clipped 3×")).toBeVisible({ timeout: 6_000 })

  // Stop, save, and back on the rehearsal screen the unnamed take is named
  // with one click; the false start is grey, the evening's buttons above.
  await step(page, 2)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("keep")
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview.getByRole("group", { name: "Sonca" }).locator('[data-take="4"]')).toBeVisible()
  await expect(overview.locator("[data-false-start]")).toHaveCount(1)
  await expect(overview.getByRole("button", { name: /Send starred/ })).toBeVisible()

  // History's marks: every Went wrong, then a song in them, on to Pałyn's page.
  await step(page, 3)
  const wentWrong = page.locator('section[aria-label="Went wrong"]')
  await expect(wentWrong).toBeVisible({ timeout: 30_000 })
  await expect(wentWrong.locator("[data-mark]")).toHaveCount(5)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("history")
  await expect(page.locator("[data-song-head] h2")).toHaveText("Pałyn")
  await expect(
    page.locator("[data-rung-group]").filter({ has: page.locator("[aria-expanded='true']") })
  ).toContainText("Pałyn 7")

  await step(page, 4)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("compare")
  const open = page.locator("[data-tab][aria-current='true']")
  await expect(open).toHaveAttribute("data-tab", "song:Pałyn")
  await expect(open.locator("[data-tab-line]")).toHaveText(/^7/)
  await expect(page.locator("[data-column]").first()).toBeVisible()
  await expect(page.locator("[data-region-span]")).toBeVisible()
})

test("the story tells the page each line as it gets to it", async ({ page }) => {
  // The stage is the page here, so it tells itself.
  await page.addInitScript(() => {
    const w = window as unknown as { __beats: number[][] }
    w.__beats = []
    window.addEventListener("message", (e) => {
      if (e.data?.type === "rr-beat") w.__beats.push([e.data.step, e.data.beat])
    })
  })
  await page.goto("/stage.html#story")
  await step(page, 4)
  const beats = () => page.evaluate(() => (window as unknown as { __beats: number[][] }).__beats)
  await expect.poll(async () => (await beats()).length, { timeout: 60_000 }).toBe(15)
  expect(await beats()).toEqual([0, 1, 2, 3, 4].flatMap((s) => [0, 1, 2].map((b) => [s, b])))
})

test("the story finds the marks grouped by rehearsal, whatever was kept", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("mock-python-config", JSON.stringify({ marks_grouping: "song" }))
  )
  await page.goto("/stage.html#story")
  await step(page, 3)
  await expect.poll(() => scene(page), { timeout: 40_000 }).toBe("history")
  await expect(page.locator("[data-song-head] h2")).toHaveText("Pałyn")
})

test("a jump from the first step to the last ends on the last", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 0)
  await step(page, 4)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("compare")
  await page.waitForTimeout(1_500)
  expect(await scene(page)).toBe("compare")
})

test("a step back starts the story again", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 3)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("history")
  await step(page, 0)
  await expect.poll(() => scene(page), { timeout: 20_000 }).toBe("setup")
  await expect(page.getByRole("button", { name: /Stop checking/ })).toBeVisible()
})
