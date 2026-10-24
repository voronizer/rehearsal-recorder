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
const moment = (page: Page, n: number, beat: number) => post(page, { type: "rr-moment", step: n, beat })
// The moment the story keeps still at, as "<step>.<beat>"; none on the way.
const held = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.moment ?? null).catch(() => null)

/** The player's clock, in seconds: "1:52 / 2:43" is 112. The take's length
 *  is the band's (ui/e2e/band.js), so it is not written here. */
async function clock(page: Page): Promise<number> {
  const text = await page.locator("span.tnum", { hasText: /\/ \d+:\d\d/ }).innerText()
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
  // The rehearsal named, its tracks checked, last week's take heard, then
  // Start, and Pałyn picked with its tempo.
  await step(page, 0)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("before")
  await expect(page.locator("#next-take-name")).toHaveValue(/^Pałyn/)
  await expect(page.locator("section[aria-label='Metronome'] input[aria-label='Tempo']")).toHaveValue("128")

  // Record, the count-in, and the guitar clipping.
  await step(page, 1)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("during")
  await expect(page.locator("h1")).toContainText(/Pałyn\s*3/)
  await expect(page.getByText("clipped 3×")).toBeVisible()

  // Stop, save, and back on the rehearsal screen the unnamed take is named
  // with one click; the false start is grey, the evening's buttons above.
  await step(page, 2)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("after")
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview.getByRole("group", { name: "Sonca" }).locator('[data-take="4"]')).toBeVisible()
  await expect(overview.locator("[data-false-start]")).toHaveCount(1)
  await expect(overview.getByRole("button", { name: /Send starred/ })).toBeVisible()

  // History's marks: every Went wrong, then a song in them, on to Pałyn's
  // page; and from it, Pałyn 5 looping, and on to Pałyn 6 and 7.
  await step(page, 3)
  const wentWrong = page.locator('section[aria-label="Went wrong"]')
  await expect(wentWrong).toBeVisible({ timeout: 30_000 })
  await expect(wentWrong.locator("[data-mark]")).toHaveCount(5)
  await expect(page.locator("[data-song-head] h2")).toHaveText("Pałyn", { timeout: 20_000 })
  await expect(
    page.locator("[data-rung-group]").filter({ has: page.locator("[aria-expanded='true']") })
  ).toContainText("Pałyn 7")
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("later")
  const open = page.locator("[data-tab][aria-current='true']")
  await expect(open).toHaveAttribute("data-tab", "song:Pałyn")
  await expect(open.locator("[data-tab-line]")).toHaveText(/^7/)
  await expect(page.locator("[data-column]").first()).toBeVisible()
  await expect(page.locator("[data-region-span]")).toBeVisible()
})

test("a moment keeps the app there until the page asks for one after it", async ({ page }) => {
  await page.goto("/stage.html#story")
  await moment(page, 1, 1)
  await expect.poll(() => held(page), { timeout: 30_000 }).toBe("1.1")
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await page.waitForTimeout(1_500)
  expect(await held(page)).toBe("1.1")
  expect(await scene(page)).toBe("before")
  await moment(page, 1, 2)
  await expect.poll(() => held(page), { timeout: 10_000 }).toBe("1.2")
  await expect(page.getByText("clipped 3×")).toBeVisible()
})

test("a moment behind the app starts the story again, and walks to it", async ({ page }) => {
  await page.goto("/stage.html#story")
  await moment(page, 1, 0)
  await expect.poll(() => held(page), { timeout: 30_000 }).toBe("1.0")
  await moment(page, 0, 3)
  await expect.poll(() => held(page), { timeout: 30_000 }).toBe("0.3")
  await expect(page.locator("[aria-label='Last time'] button[aria-label^='Pause Pałyn 7']")).toBeVisible()
})

test("a moment asked for while the app pauses at it keeps it there, without starting again", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 0)
  const playing = page.locator("[aria-label='Last time'] button[aria-label^='Pause Pałyn 7']")
  await expect(playing).toBeVisible({ timeout: 30_000 })
  // Gone on a reload, as a start again would be.
  await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true))
  await moment(page, 0, 3)
  await expect.poll(() => held(page), { timeout: 5_000 }).toBe("0.3")
  expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true)
  await expect(playing).toBeVisible()
})

test("the check's moment waits until the check has begun, however slow it is to open", async ({ page }) => {
  await page.goto("/stage.html#story")
  // The fake waits on window.__HOLD__[name] before it answers (see
  // fake-bridge.js): here, something that says when the check's opening
  // has been asked for, and holds it until it is let go.
  await page.evaluate(() => {
    const w = window as unknown as {
      __HOLD__?: Record<string, PromiseLike<void>>
      __ASKED__?: boolean
      __LET_GO__?: () => void
    }
    w.__HOLD__ = {
      start_monitor: {
        then(go) {
          w.__ASKED__ = true
          w.__LET_GO__ = () => void go?.()
          return this as never
        },
      },
    }
  })
  await moment(page, 0, 2)
  const asked = () => page.evaluate(() => (window as unknown as { __ASKED__?: boolean }).__ASKED__ ?? false)
  await expect.poll(asked, { timeout: 20_000 }).toBe(true)
  // Check signal is pressed and still says so: the moment is not there yet.
  await page.waitForTimeout(1_000)
  expect(await held(page)).toBe(null)
  await expect(page.getByRole("button", { name: "Check signal" })).toBeVisible()

  await page.evaluate(() => (window as unknown as { __LET_GO__: () => void }).__LET_GO__())
  await expect.poll(() => held(page), { timeout: 10_000 }).toBe("0.2")
  await expect(page.getByRole("button", { name: "Stop checking" })).toBeVisible()
})

// Metronome on the site: Pałyn's 128 bpm is in the row as ↑ picks it, and
// Record counts in before the clock.
test("the moments of last week's Palyn, Palyn picked with its 128 bpm by the arrow key, and the count-in", async ({
  page,
}) => {
  // What is on screen as the story keeps still at each moment.
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: object[] }
    w.__seen = []
    new MutationObserver(() => {
      const at = document.documentElement.dataset.moment
      if (!at) return
      const row = document.querySelector("section[aria-label='Metronome']")
      w.__seen.push({
        at,
        lastWeek: Boolean(
          document.querySelector("[aria-label='Last time'] button[aria-label^='Pause Pałyn 7']")
        ),
        field: document.querySelector<HTMLTextAreaElement>("#next-take-name")?.value ?? null,
        tempo: row?.querySelector<HTMLInputElement>("input[aria-label='Tempo']")?.value ?? null,
        signature: row?.querySelector("[aria-label='Time signature']")?.textContent ?? null,
        countIn: Boolean(document.querySelector("[data-count-in]")),
        recording: Boolean(document.querySelector("h1")?.textContent?.match(/Pałyn\s*3/)),
      })
    }).observe(document, { attributeFilter: ["data-moment"], subtree: true })
  })
  await page.goto("/stage.html#story")
  for (const [s, b] of [
    [0, 3],
    [0, 4],
    [1, 0],
  ]) {
    await moment(page, s, b)
    await expect.poll(() => held(page), { timeout: 30_000 }).toBe(`${s}.${b}`)
  }
  const seen = await page.evaluate(() => (window as unknown as { __seen: object[] }).__seen)
  expect(seen).toEqual([
    { at: "0.3", lastWeek: true, field: null, tempo: null, signature: null, countIn: false, recording: false },
    {
      at: "0.4",
      lastWeek: false,
      field: expect.stringMatching(/^Pałyn/),
      tempo: "128",
      signature: "4/4",
      countIn: false,
      recording: false,
    },
    { at: "1.0", lastWeek: false, field: null, tempo: null, signature: null, countIn: true, recording: true },
  ])
})

// The frames of the site share localStorage, where the fake keeps its
// settings: the hero's switch, turned off by a visitor before the story's
// frame opened or while it is open, is not the story's.
test("the second step counts in whatever a visitor switched off in another frame", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mock-python-config", JSON.stringify({ metronome_on: false }))
    const w = window as unknown as { __countIn: boolean[] }
    w.__countIn = []
    window.addEventListener("message", (e) => {
      if (e.data?.type === "rr-beat" && e.data.step === 1 && e.data.beat === 0)
        w.__countIn.push(Boolean(document.querySelector("[data-count-in]")))
    })
  })
  await page.goto("/stage.html#story")
  await expect.poll(() => page.evaluate(() => "pywebview" in window)).toBe(true)
  await page.evaluate(() =>
    localStorage.setItem("mock-python-config", JSON.stringify({ metronome_on: false, count_in_bars: 0 }))
  )
  await step(page, 1)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("during")
  expect(await page.evaluate(() => (window as unknown as { __countIn: boolean[] }).__countIn)).toEqual([true])
})

test("the second step gets to the take with no click to count it in", async ({ page }) => {
  await page.goto("/stage.html#story")
  await expect.poll(() => page.evaluate(() => "pywebview" in window)).toBe(true)
  await page.evaluate(() =>
    (window as unknown as { pywebview: { api: { metronome_set_on: (on: boolean) => Promise<unknown> } } })
      .pywebview.api.metronome_set_on(false)
  )
  await step(page, 1)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("during")
  await expect(page.locator("h1")).toContainText(/Pałyn\s*3/)
})

// The songs beside the next take's field come a moment after the screen; on
// a busy machine, long after. The story waits for them before it presses ↑.
test("the story waits for the songs beside the field before the arrow key", async ({ page }) => {
  await page.addInitScript(() => {
    type Api = { song_choices?: (...a: unknown[]) => Promise<unknown>; slowed?: boolean }
    const slow = setInterval(() => {
      const api = (window as unknown as { pywebview?: { api: Api } }).pywebview?.api
      if (!api?.song_choices || api.slowed) return
      const real = api.song_choices
      api.song_choices = async (...a) => {
        await new Promise((done) => setTimeout(done, 1500))
        return real(...a)
      }
      api.slowed = true
      clearInterval(slow)
    }, 1)
  })
  await page.goto("/stage.html#story")
  await step(page, 1)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("during")
})

// The band comes in on the bar after the count-in, and the guitarist with it.
test("the guitar clips only once the count-in is over", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 1)
  const countIn = page.locator("[data-count-in]")
  await countIn.waitFor({ timeout: 30_000 })
  while ((await countIn.count()) > 0) {
    expect(await page.locator("[data-clipped]").count()).toBe(0)
    await page.waitForTimeout(100)
  }
  await expect(page.getByText("clipped 3×")).toBeVisible({ timeout: 10_000 })
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
  await step(page, 3)
  const beats = () => page.evaluate(() => (window as unknown as { __beats: number[][] }).__beats)
  await expect.poll(async () => (await beats()).length, { timeout: 90_000 }).toBe(17)
  expect(await beats()).toEqual(
    [5, 3, 3, 6].flatMap((lines, s) => Array.from({ length: lines }, (_, b) => [s, b]))
  )
})

test("the story finds the marks grouped by rehearsal, whatever was kept", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("mock-python-config", JSON.stringify({ marks_grouping: "song" }))
  )
  await page.goto("/stage.html#story")
  await moment(page, 3, 2)
  await expect.poll(() => held(page), { timeout: 40_000 }).toBe("3.2")
  await expect(page.locator("[data-song-head] h2")).toHaveText("Pałyn")
})

test("a jump from the first step to the last ends on the last", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 0)
  await step(page, 3)
  await expect.poll(() => scene(page), { timeout: 60_000 }).toBe("later")
  await page.waitForTimeout(1_500)
  expect(await scene(page)).toBe("later")
})

test("a step back starts the story again", async ({ page }) => {
  await page.goto("/stage.html#story")
  await step(page, 2)
  await expect.poll(() => scene(page), { timeout: 40_000 }).toBe("after")
  await step(page, 0)
  await expect.poll(() => scene(page), { timeout: 30_000 }).toBe("before")
  await expect(page.locator("#next-take-name")).toHaveValue(/^Pałyn/)
})
