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

/** The take has opened in the player and set Backing's M: its lanes are there, and the
 *  transport, off while the take opens, is on. */
async function opened(page: Page) {
  await expect(lanes(page).last()).toHaveAttribute("data-lane-row", "Backing")
  await expect(page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "To start" })).toBeEnabled()
}

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
    await mute(page).click()
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
    await expect.poll(() => sent.length).toBe(2)
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
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
    await page.waitForTimeout(500)
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
})
