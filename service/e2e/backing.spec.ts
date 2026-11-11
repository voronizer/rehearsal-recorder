import { expect, test, type Locator, type Page } from "@playwright/test"
import { as, band, HEADERS } from "./band"

/*
  The take's Backing track, as РЭХА shows it: last, in a dashed frame,
  muted the first time a take of its song opens, and after that as you
  last left its M for that song. Ira turns Viasna's on and back off; no
  other test reads it.
*/

const border = (at: Locator) => at.evaluate((el) => getComputedStyle(el).borderTopStyle)
const lanes = (page: Page) => page.locator("[data-take-player] [data-lane-row]")
const mute = (page: Page) => page.locator("[data-take-player]").getByRole("button", { name: "Mute Backing" })
const pause = (page: Page) => page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Pause", exact: true })

/** The take has opened in the player and set Backing's M: its lanes are there, and the
 *  transport, off while the take opens, is on. */
async function opened(page: Page) {
  await expect(lanes(page).last()).toHaveAttribute("data-lane-row", "Backing")
  await expect(page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "To start" })).toBeEnabled()
}

type Heard = { most: number; now: number | null }

/**
 * Backing's level as the take's player sends it out, read every few
 * milliseconds from the moment the player makes it: the loudest it has
 * been, and now. The player makes Master, then each track's level in the
 * take's order, so Backing's, last, is the last made.
 */
const watchBacking = (page: Page) =>
  page.addInitScript(() => {
    const made: GainNode[] = []
    const make = BaseAudioContext.prototype.createGain
    BaseAudioContext.prototype.createGain = function (this: BaseAudioContext) {
      const g = make.call(this)
      made.push(g)
      return g
    }
    const backing: Heard = { most: 0, now: null }
    Object.assign(window, { backing })
    setInterval(() => {
      const g = made.at(-1)
      if (!g) return
      backing.now = g.gain.value
      backing.most = Math.max(backing.most, g.gain.value)
    }, 5)
  })
const heard = (page: Page) => page.evaluate(() => (window as unknown as { backing: Heard }).backing)

/** The page asking the service whether the member hears Backing. */
const asked = (page: Page) => page.waitForRequest((r) => r.method() === "GET" && r.url().endsWith("/api/me/backing"))

/** Every change of Backing's M the page sends from now on. */
function kept(page: Page) {
  const sent: unknown[] = []
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/me/backing")) sent.push(r.postDataJSON())
  })
  return sent
}

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("Backing is the last lane, right above Master, after a track of notes alone, in a dashed frame", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await expect(page.getByRole("main").getByText(/^0:10 · 4 tracks$/)).toBeVisible()
    await expect(lanes(page)).toHaveCount(4)
    for (const [i, name] of ["Drums", "Bass", "Keys", "Backing"].entries()) await expect(lanes(page).nth(i)).toHaveAttribute("data-lane-row", name)
    await expect(lanes(page).nth(2).locator("[data-notes-plate]")).toContainText("Keys")
    const plate = page.locator('[data-take-player] [data-plate="Backing"]')
    expect(await border(plate)).toBe("dashed")
    expect(await border(page.locator('[data-lane="Backing"] > div'))).toBe("dashed")
    expect(await border(page.locator('[data-take-player] [data-plate="Bass"]'))).not.toBe("dashed")
    // The backing track's own icon, as in РЭХА.
    await expect(plate.locator("[data-icon]")).toHaveAttribute("data-icon", "backing")
    // Master after it.
    const last = (await lanes(page).last().boundingBox())!
    expect((await page.locator("[data-take-player] [data-master-plate]").boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height)
  })

  test("Backing opens muted the first time; turned on, every take of its song opens with it", async ({ page }) => {
    const sent = kept(page)
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    // Opening it sends nothing: only a press is kept.
    expect(sent).toEqual([])
    const answered = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/me/backing"))
    await mute(page).click()
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
    expect((await answered).ok()).toBe(true)
    expect(sent).toEqual([{ song_id: band().songs["Viasna"], heard: true }])

    // Another take of the song, the page opened afresh: heard.
    await page.goto(`/takes/${band().takes["Viasna 5"]}`)
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
    // So is this one, on the next visit.
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")

    // M on it again is kept as muted.
    const again = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/me/backing"))
    await mute(page).click()
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    expect((await again).ok()).toBe(true)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual({ song_id: band().songs["Viasna"], heard: false })
    await page.goto(`/takes/${band().takes["Viasna 5"]}`)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
  })

  test("the take opens only once the service has said, and with Backing muted when it could not", async ({ page }) => {
    // Ira has Viasna's Backing on while this test runs.
    let letThrough = () => {}
    const held = new Promise<void>((done) => (letThrough = done))
    await page.route("**/api/me/backing", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      await held
      await route.fulfill({ status: 500, json: { error: "The band service is resting" } })
    })
    const on = await page.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: true }, headers: HEADERS })
    expect(on.ok()).toBe(true)
    const asking = asked(page)
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
    await asking
    // No lanes yet: nothing of the take plays before Backing is muted.
    await expect(lanes(page)).toHaveCount(0)
    letThrough()
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await page.unrouteAll({ behavior: "ignoreErrors" })
    // Back as it was, for the tests after this one.
    const off = await page.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: false }, headers: HEADERS })
    expect(off.ok()).toBe(true)
  })

  test("a take with no song opens with Backing muted, and its M is kept nowhere", async ({ page }) => {
    const sent = kept(page)
    await page.goto(`/takes/${band().takes["Take 3"]}`)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await opened(page)
    await mute(page).click()
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
    await page.waitForTimeout(500)
    expect(sent).toEqual([])
    await page.reload()
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
  })

  test("Play in a list plays Backing muted, and heard once its M is off for the song; the page opening changes neither", async ({ page }) => {
    await watchBacking(page)
    const bar = page.getByLabel("Player", { exact: true })
    const row = page.locator('[data-take="Viasna 11"]')
    await page.goto(`/rehearsals/${band().rehearsals.second}`)
    await row.getByRole("button", { name: "Play “Viasna 11”" }).click()
    await expect(bar.getByRole("button", { name: "Pause “Viasna 11”" })).toBeVisible()
    await expect.poll(async () => (await heard(page)).now).toBe(0)
    await page.waitForTimeout(300)
    // To its page while it plays: Backing stays as it began, muted.
    await row.getByRole("link", { name: "Viasna 11", exact: true }).click()
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await page.waitForTimeout(300)
    expect(await heard(page)).toEqual({ most: 0, now: 0 })
    // It played on all the while.
    await pause(page).click()

    // Ira has it on for the song: Play in the list plays it heard from the start.
    const on = await page.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: true }, headers: HEADERS })
    expect(on.ok()).toBe(true)
    await page.goto(`/rehearsals/${band().rehearsals.second}`)
    await row.getByRole("button", { name: "Play “Viasna 11”" }).click()
    await expect(bar.getByRole("button", { name: "Pause “Viasna 11”" })).toBeVisible()
    await expect.poll(async () => (await heard(page)).now).toBeGreaterThan(0)
    await row.getByRole("link", { name: "Viasna 11", exact: true }).click()
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
    await page.waitForTimeout(300)
    expect((await heard(page)).now).toBeGreaterThan(0)
    await pause(page).click()
    // Back as it was, for the tests after this one.
    const off = await page.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: false }, headers: HEADERS })
    expect(off.ok()).toBe(true)
  })

  test("M on Backing the service could not keep stays as pressed, and nothing is said", async ({ page }) => {
    await page.route("**/api/me/backing", (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "The band service is resting" } }) : route.fallback()
    )
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    const failed = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/me/backing"))
    await mute(page).click()
    expect((await failed).status()).toBe(500)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
    // Two frames on, with the failure in: still nothing said.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(page.getByText("The band service is resting")).toHaveCount(0)
    await page.unrouteAll({ behavior: "ignoreErrors" })
  })

  test("the mix leaves Backing out while it is muted", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Download", exact: true }).click()
    const coming = page.waitForEvent("download")
    await page.getByRole("button", { name: "The mix" }).click()
    const mix = await coming
    expect(mix.suggestedFilename()).toBe("Viasna 11 - without Backing.mp3")
    // Drums and Bass are mono, in the middle; Backing is louder on the left.
    // Left out, the mix's two sides are the same.
    const bytes = Buffer.concat(await (await mix.createReadStream()).toArray()).toString("base64")
    const apart = await page.evaluate(async (data) => {
      const file = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const sound = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(file.buffer)
      const [left, right] = [sound.getChannelData(0), sound.getChannelData(1)]
      let most = 0
      let loudest = 0
      for (let i = 0; i < left.length; i++) {
        most = Math.max(most, Math.abs(left[i] - right[i]))
        loudest = Math.max(loudest, Math.abs(left[i]))
      }
      return { most, loudest }
    }, bytes)
    expect(apart.loudest).toBeGreaterThan(0.1)
    expect(apart.most).toBeLessThan(0.01)
  })
})

test.describe("as Dzima", () => {
  test.use({ storageState: as("dzima") })

  test("Backing heard for one member is muted for another", async ({ page, browser }) => {
    // Ira turns it on, and Dzima opens a take of the song.
    const ira = await browser.newContext({ storageState: as("ira") })
    const on = await ira.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: true }, headers: HEADERS })
    expect(on.ok()).toBe(true)
    await page.goto(`/takes/${band().takes["Viasna 5"]}`)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await opened(page)
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    const off = await ira.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: false }, headers: HEADERS })
    expect(off.ok()).toBe(true)
    await ira.close()
  })
})

test.describe("as Ira on a phone", () => {
  test.use({ storageState: as("ira"), viewport: { width: 390, height: 844 } })

  test("Backing's row is last before Master, after a row of notes alone, in a dashed frame", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    const tracks = page.getByRole("main").getByRole("region", { name: "Tracks" })
    const rows = tracks.locator("[data-desk-row]")
    await expect(rows).toHaveCount(4)
    for (const [i, name] of ["Drums", "Bass", "Keys", "Backing"].entries()) await expect(rows.nth(i)).toHaveAttribute("data-desk-row", name)
    const plate = rows.nth(3).locator('[data-plate="Backing"]')
    await expect(plate).toBeVisible()
    expect(await border(plate)).toBe("dashed")
    expect(await border(rows.nth(1).locator('[data-plate="Bass"]'))).not.toBe("dashed")
    // No card's fill behind it, as no grey is behind it in the player.
    await expect(rows.nth(3)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(rows.nth(3).getByRole("button", { name: "Mute Backing" })).toHaveAttribute("aria-pressed", "true")
    const last = (await rows.nth(3).boundingBox())!
    expect((await tracks.locator("[data-master-plate]").boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height)
    expect(last.height).toBeCloseTo(56, 0)
  })

  test("Backing turned on opens heard on the next take of its song", async ({ page }) => {
    await watchBacking(page)
    const sent = kept(page)
    const main = page.getByRole("main")
    const m = main.getByRole("region", { name: "Tracks" }).getByRole("button", { name: "Mute Backing" })
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    // Pressed once the take has opened: muted the first time.
    await expect(m).toHaveAttribute("aria-pressed", "true")
    const answered = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/me/backing"))
    await m.click()
    await expect(m).toHaveAttribute("aria-pressed", "false")
    expect((await answered).ok()).toBe(true)
    expect(sent).toEqual([{ song_id: band().songs["Viasna"], heard: true }])

    // The next take of the song, the page opened afresh: Backing plays heard.
    await page.goto(`/takes/${band().takes["Viasna 5"]}`)
    await main.getByRole("button", { name: "Play “Viasna 5”" }).first().click()
    await expect(main.getByRole("button", { name: "Pause “Viasna 5”" }).first()).toBeVisible()
    await expect.poll(async () => (await heard(page)).now).toBeGreaterThan(0)
    await expect(m).toHaveAttribute("aria-pressed", "false")
    await main.getByRole("button", { name: "Pause “Viasna 5”" }).first().click()
    // Back as it was, for the tests after this one.
    const off = await page.request.put("/api/me/backing", { data: { song_id: band().songs["Viasna"], heard: false }, headers: HEADERS })
    expect(off.ok()).toBe(true)
  })

  test("Play pressed before the take has opened waits for the service, and plays Backing muted", async ({ page }) => {
    await watchBacking(page)
    let letThrough = () => {}
    const held = new Promise<void>((done) => (letThrough = done))
    await page.route("**/api/me/backing", async (route) => {
      if (route.request().method() === "GET") await held
      await route.fallback()
    })
    const asking = asked(page)
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    const main = page.getByRole("main")
    await main.getByRole("button", { name: "Play “Viasna 11”" }).first().click()
    await asking
    // No player yet: nothing of the take plays before Backing is muted.
    expect((await heard(page)).now).toBeNull()
    letThrough()
    await expect(main.getByRole("button", { name: "Pause “Viasna 11”" }).first()).toBeVisible()
    await expect.poll(async () => (await heard(page)).now).toBe(0)
    await expect(main.getByRole("region", { name: "Tracks" }).getByRole("button", { name: "Mute Backing" })).toHaveAttribute("aria-pressed", "true")
    await page.waitForTimeout(300)
    expect(await heard(page)).toEqual({ most: 0, now: 0 })
    await main.getByRole("button", { name: "Pause “Viasna 11”" }).first().click()
    await page.unrouteAll({ behavior: "ignoreErrors" })
  })
})
