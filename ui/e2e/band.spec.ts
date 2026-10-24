import { test, expect, openBandApp, openHistory, startButton } from "./app.ts"

// The band in band.js is what the docs' pictures and the site show. These
// keep it in step with the interface: a band the interface cannot open is
// a broken page on the site, not a test that fails somewhere else later.

test("the band's rehearsal opens on its next take", async ({ page }) => {
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startButton(page).click()
  await expect(page.getByRole("button", { name: /Record take 6/ })).toBeVisible()
  await expect(page.locator("button[aria-label^='Take 2 Pałyn 2']")).toBeVisible()
})

test("the band's rehearsal played by its set lists the set", async ({ page }) => {
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await page.locator("[data-set-picker]").click()
  await page
    .getByRole("menu", { name: "Sets" })
    .getByRole("menuitemradio", { name: /Gig on the 25th/ })
    .click()
  await startButton(page).click()
  const card = page.locator("[data-set-card]")
  await expect(card.locator("h2")).toHaveText("Gig on the 25th · 3 of 6 played")
  await expect(card.locator("[data-set-song='Viasna']")).toHaveAttribute("aria-current", "true")
})

test("the band's history lists its rehearsals", async ({ page }) => {
  await openBandApp(page)
  const list = await openHistory(page)
  for (const name of ["Tuesday jam", "New songs", "Soundcheck"]) {
    await expect(list.getByText(name).first()).toBeVisible()
  }
})

test("a rehearsal of the band's played by its set says so in History", async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __PLAYED_BY__: object }).__PLAYED_BY__ = {
      "/rec/tue": { name: "Gig on the 25th", songs: ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška"] },
    }
  })
  await openBandApp(page)
  await openHistory(page)
  await expect(page.locator("[data-set-name]").first()).toHaveText("Gig on the 25th")
  await expect(page.locator("[data-set-card] h2")).toHaveText("Gig on the 25th · 4 of 6 played")
})

test("the band plays on the click's grid from the first sample", async ({ page }) => {
  await openBandApp(page)
  // Pałyn 2's drums, a take at 128 in 4/4 played on the click's grid (the
  // band had the click switched off for it, band.js): the sticks count in a
  // bar from the file's first sample, as the click's count-in does, and the
  // song comes in on the bar after it.
  const onsets = await page.evaluate(async () => {
    const api = (window as unknown as {
      pywebview: { api: { take_media: (...a: unknown[]) => Promise<{ peaks: number[][] }[]> } }
    }).pywebview.api
    const n = 4000
    const [drums] = await api.take_media([{ name: "Drums", file: "/rec/tonight/2/Drums.wav" }], n, 0, 4)
    const v = drums.peaks[0]
    const out: number[] = []
    for (let i = 0; i < n; i++) if (v[i] > 0.15 && (i === 0 || v[i - 1] <= 0.15)) out.push((i / n) * 4)
    return out
  })
  const click = 60 / 128
  expect(onsets.length).toBeGreaterThanOrEqual(5)
  for (const [k, t] of onsets.slice(0, 5).entries()) {
    expect(Math.abs(t - k * click), `hit ${k + 1}`).toBeLessThanOrEqual(0.003)
  }
})

// A take of last Tuesday's opens as History lists it, with the band playing
// on it: not tonight's take of the same number, nor silence.
test("the band's past takes have their own length and music", async ({ page }) => {
  await openBandApp(page)
  const found = await page.evaluate(async () => {
    type Track = { name: string; file: string }
    type Take = { name: string; duration_sec: number; tracks: Track[] }
    const api = (window as unknown as {
      pywebview: {
        api: {
          get_rehearsal: (folder: string) => Promise<{ takes: Take[] }>
          take_media: (...a: unknown[]) => Promise<{ duration_sec: number; peaks: number[][] }[]>
        }
      }
    }).pywebview.api
    const out: Record<string, { listed: number; player: number; loudest: number; until: number }> = {}
    for (const [folder, name] of [
      ["/rec/tue", "Pałyn 5"],
      ["/rec/tue", "Pałyn 6"],
      ["/rec/sat", "Dym 3"],
    ]) {
      const take = (await api.get_rehearsal(folder)).takes.find((t) => t.name === name)!
      const [drums] = await api.take_media(take.tracks.filter((t) => t.name === "Drums"), 400)
      const v = drums.peaks[0]
      const last = v.reduce((at, x, i) => (x > 0.05 ? i : at), -1)
      out[name] = {
        listed: take.duration_sec,
        player: drums.duration_sec,
        loudest: Math.max(...v),
        until: ((last + 1) / v.length) * drums.duration_sec,
      }
    }
    return out
  })
  expect(Object.keys(found)).toHaveLength(3)
  // Each as long in the player as in the list, the drums loud on it, and the
  // song playing on to its end, two and a half minutes in.
  const wrong = Object.entries(found).filter(
    ([, take]) => take.player !== take.listed || take.loudest <= 0.5 || take.until <= 150
  )
  expect(wrong).toEqual([])
})

test("the band's click output offers its desk on ASIO", async ({ page }) => {
  await openBandApp(page)
  const outputs = await page.evaluate(() =>
    (window as unknown as {
      pywebview: { api: { list_output_devices: () => Promise<{ click_unavailable?: string | null }[]> } }
    }).pywebview.api.list_output_devices()
  )
  expect(outputs.every((d) => d.click_unavailable === null)).toBe(true)
  await page.getByRole("button", { name: "Settings" }).click()
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Click & backing track", exact: true })
    .click()
  const output = page.locator("[data-tab-body]").getByRole("region", { name: "Click output" })
  await output.getByRole("combobox", { name: "Driver" }).click()
  await page.getByRole("option", { name: "ASIO" }).click()
  await output.getByRole("combobox", { name: "Click output" }).click()
  await expect(page.getByRole("option", { name: /X18\/XR18/ })).not.toHaveAttribute("aria-disabled", "true")
})
