import {
  calls,
  colour,
  expect,
  openApp,
  openBandApp,
  openHistory,
  setFake,
  settled,
  startRehearsal,
  test,
  themed,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// A song's backing track on the rehearsal screen, while a take records, in
// Settings and behind the metronome's gear, and in the player (backing-track
// spec, Parts 5, 7 and 8): its row under the metronome's, the sentence the
// status line goes on with, the tab "Click & backing track" with its group,
// and the take's Backing track as a dashed lane right above Master, muted
// the first time a take of its song opens. The band's backing tracks are in
// band.js: Pałyn's counted at the song's 128, 3:42 long; Viasna's at the
// song's 128 too, or at 126 with VIASNA_126; Sonca's pads. Dym has none.
// Tonight starts with five takes, and the next is Viasna's second.

/** Viasna's backing track counted at 126 while the song keeps 128, for the
 *  line that says so (band.js counts it at 128). */
const VIASNA_126 =
  "window.__BACKINGS__ = {Viasna: {name: 'Viasna backing.wav', seconds: 268, channels: 2, tempo: 126, first_bar: 0.45}};"

const field = (page: Page) => page.locator("#next-take-name")
const metronome = (page: Page) => page.locator("footer").getByRole("region", { name: "Metronome" })
const status = (page: Page) => metronome(page).locator("[data-status-line]")
const row = (page: Page) => page.locator("footer").getByRole("region", { name: "Backing track" })
const onOff = (page: Page) => row(page).getByRole("button", { name: "Backing track in takes" })
const file = (page: Page) => row(page).locator("[data-backing-row-file]")
const time = (page: Page) => row(page).locator("[data-backing-time]")
const rowLine = (page: Page) => row(page).locator("[data-backing-row-line]")
const volume = (page: Page) => row(page).getByRole("slider", { name: "Backing track volume" })
const play = (page: Page) => row(page).getByRole("button", { name: "Play the backing track" })
const stop = (page: Page) => row(page).getByRole("button", { name: "Stop the backing track" })
const record = (page: Page) => page.getByRole("button", { name: /Record take/ })

const args = async (page: Page, name: string) => (await calls(page, name)).map((c) => c.args)

/** Names the next take, as typed and taken with Enter, and waits for the
 *  row to have followed it. */
async function nameNext(page: Page, name: string) {
  const sent = (await calls(page, "set_next_take_name")).length
  await field(page).fill(name)
  await field(page).press("Enter")
  await expect.poll(async () => (await calls(page, "set_next_take_name")).length).toBe(sent + 1)
}

/** The band's rehearsal started, its next take Viasna 2. `before` runs
 *  ahead of the fake. */
async function bandRehearsal(page: Page, before = "") {
  if (before) await page.addInitScript(before)
  await openBandApp(page)
  await startRehearsal(page, 6)
}

/** The id the library gave a song. */
const idOf = (page: Page, title: string) =>
  page.evaluate(async (t) => {
    const api = (window as unknown as { pywebview: { api: { list_songs: () => Promise<{ songs: { id: number; title: string }[] }> } } }).pywebview.api
    return (await api.list_songs()).songs.find((s) => s.title === t)!.id
  }, title)

test("the row is there once any song has a backing track, and stays", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await expect(metronome(page)).toBeVisible()
  await expect(row(page)).toHaveCount(0)
  // A backing track added on a song's page: the row comes.
  const songId = await page.evaluate(async () => {
    const api = (window as unknown as {
      pywebview: { api: {
        list_songs: () => Promise<{ songs: { id: number }[] }>
        add_backing: (id: number, path: string) => Promise<{ ok: boolean }>
      } }
    }).pywebview.api
    const id = (await api.list_songs()).songs[0].id
    await api.add_backing(id, "/Users/alex/Music/Backing.wav")
    return id
  })
  await expect(row(page)).toBeVisible()
  // Taken away again, the row stays: the band knows where it is.
  await page.evaluate(async (id) => {
    const api = (window as unknown as { pywebview: { api: { remove_backing: (id: number) => Promise<unknown> } } }).pywebview.api
    await api.remove_backing(id)
  }, songId)
  await page.waitForTimeout(600)
  await expect(row(page)).toBeVisible()
})

test("Palyn's row: the file, its length, the volume and play, and the line says when it comes in", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Pałyn")
  await expect(file(page)).toHaveText("Pałyn backing.wav3:42")
  await expect(time(page)).toHaveText("3:42")
  await expect(onOff(page)).toHaveAttribute("aria-pressed", "true")
  await expect(volume(page)).toHaveAttribute("aria-valuenow", "0.8")
  await expect(play(page)).toBeEnabled()
  await expect(status(page)).toHaveText("The song's tempo. The backing track comes in on bar 1, after the count-in.")
  // The row sits under the metronome's, the line under both.
  const tempoRow = await metronome(page).getByRole("textbox", { name: "Tempo" }).boundingBox()
  const own = (await row(page).boundingBox())!
  const line = (await status(page).boundingBox())!
  expect(own.y).toBeGreaterThan(tempoRow!.y + tempoRow!.height - 1)
  expect(line.y).toBeGreaterThanOrEqual(own.y + own.height - 1)
})

test("Viasna's was counted at 126: the line says it will not follow 128", async ({ page }) => {
  await bandRehearsal(page, VIASNA_126)
  await expect(field(page)).toHaveValue("Viasna")
  await expect(file(page)).toContainText("Viasna backing.wav")
  await expect(status(page)).toContainText("The backing track was counted at 126: it will not follow 128.")
  // With the click off, no count-in and no tempo to follow.
  await metronome(page).getByRole("button", { name: "Click in takes" }).click()
  await expect(status(page)).toHaveText(
    "Off: takes record without the click. The backing track starts with Record: no click, so no count-in."
  )
})

test("Dym has none, and a free take has none", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Dym")
  await expect(rowLine(page)).toHaveText("No backing track for Dym. It is added on the song's page in History.")
  await expect(onOff(page)).toBeDisabled()
  await expect(volume(page)).toHaveCount(0)
  await expect(play(page)).toHaveCount(0)
  await expect(status(page)).not.toContainText("backing track")
  await nameNext(page, "Take 6")
  await expect(rowLine(page)).toHaveText("Free take: no backing track.")
  await expect(status(page)).not.toContainText("backing track")
})

test("switched off, the file is dimmed and the line says takes record without it", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Pałyn")
  const name = file(page).locator("[data-backing-name]")
  const lit = await name.evaluate((el) => getComputedStyle(el).color)
  await onOff(page).click()
  await expect.poll(() => args(page, "set_backing_setting")).toEqual([["backing_on", false]])
  await expect(onOff(page)).toHaveAttribute("aria-pressed", "false")
  await expect(status(page)).toHaveText("The song's tempo. Backing track off: takes record without it.")
  const dim = await name.evaluate((el) => getComputedStyle(el).color)
  expect(dim).not.toBe(lit)
  expect(dim).toBe(await colour(page, "--muted-foreground"))
  await onOff(page).click()
  await expect(status(page)).toHaveText("The song's tempo. The backing track comes in on bar 1, after the count-in.")
})

test("play and stop: the time runs, another song stops it", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Pałyn")
  const id = await idOf(page, "Pałyn")
  await play(page).click()
  await expect.poll(() => args(page, "backing_play")).toEqual([[id, false]])
  await expect(time(page)).toHaveText(/^0:0\d \/ 3:42$/)
  await stop(page).click()
  await expect.poll(async () => (await calls(page, "backing_stop")).length).toBe(1)
  await expect(time(page)).toHaveText("3:42")
  // Played again, then another song picked: it stops, as Python follows.
  await play(page).click()
  await expect(stop(page)).toBeVisible()
  await nameNext(page, "Sonca")
  await expect(file(page)).toHaveText("Sonca pads.wav5:00")
  await expect(play(page)).toBeVisible()
})

test("its output not connected: the line says so in amber", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Pałyn")
  await setFake(page, "__BACKING_OUTPUT_MISSING__", "X18 5–6")
  await expect(status(page)).toHaveText(
    "The song's tempo. The backing track's output, X18 5–6, is not connected. Takes record without it."
  )
  const icon = status(page).locator("svg")
  await expect(icon).toHaveCount(1)
  expect(await icon.evaluate((el) => getComputedStyle(el).color)).toBe(await colour(page, "--warn"))
  await setFake(page, "__BACKING_OUTPUT_MISSING__", null)
  await setFake(page, "__BACKING_GETTING_READY__", true)
  await expect(status(page)).toHaveText("The song's tempo. Getting the backing track ready…")
  await expect(status(page).locator("svg")).toHaveCount(0)
})

test("while a take records: the switch, the file playing and the volume, no play", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Pałyn")
  await record(page).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await expect(row(page)).toBeVisible()
  await expect(row(page).locator("[data-backing-name]")).toHaveText("Pałyn backing.wav")
  await expect(time(page)).toHaveText(/^0:0\d \/ 3:42$/)
  await expect(volume(page)).toBeVisible()
  await expect(row(page).getByRole("button", { name: /Play|Stop/ })).toHaveCount(0)
  // Its output gone mid-take: the line says so in amber, and the file dims.
  await expect(file(page)).not.toHaveClass(/text-muted-foreground/)
  await setFake(page, "__BACKING_OUTPUT_MISSING__", "X18 5–6")
  await expect(status(page)).toContainText("The backing track's output, X18 5–6, is not connected.")
  await expect(status(page).locator("svg")).toHaveCount(1)
  await expect(file(page)).toHaveClass(/text-muted-foreground/)
  await setFake(page, "__BACKING_OUTPUT_MISSING__", null)
  await expect(status(page)).not.toContainText("backing track")
  await expect(file(page)).not.toHaveClass(/text-muted-foreground/)
  // The switch changes what is heard; the take keeps the file.
  await onOff(page).click()
  await expect.poll(() => args(page, "set_backing_setting")).toEqual([["backing_on", false]])
  await expect(onOff(page)).toHaveAttribute("aria-pressed", "false")
  // Nothing new among the tiles.
  const tiles = await page.locator("main [role=group]").evaluateAll((ts) => ts.map((t) => t.getAttribute("aria-label")))
  expect(tiles.length).toBeGreaterThan(0)
  expect(tiles.filter((t) => t?.includes("Backing"))).toEqual([])
})

// The take plays on past the file's end, silent, until Stop.
test("while a take records past the file's end, its time stops at its length", async ({ page }) => {
  await bandRehearsal(page, "window.__BACKINGS__ = {Sonca: {name: 'Sonca pads.wav', seconds: 1, channels: 1, tempo: null, first_bar: 0}};")
  await nameNext(page, "Sonca")
  await record(page).click()
  await expect(time(page)).toHaveText(/^0:0\d \/ 0:01$/)
  // Python's own position runs on: 2.3 s in, the row still says 0:01.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const api = (window as unknown as { pywebview: { api: { metronome_state: () => Promise<{ backing: { position_sec: number } }> } } }).pywebview.api
          return (await api.metronome_state()).backing.position_sec
        }),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(2.3)
  await expect(time(page)).toHaveText("0:01 / 0:01")
})

test("Settings: the tab is Click & backing track, with a Backing track group", async ({ page }) => {
  await openBandApp(page)
  await page.getByRole("button", { name: "Settings" }).click()
  const sections = page.getByRole("navigation", { name: "Settings sections" })
  await expect(sections.getByRole("button", { name: "Metronome", exact: true })).toHaveCount(0)
  await sections.getByRole("button", { name: "Click & backing track", exact: true }).click()
  await expect(page.locator("[data-tab-head]")).toContainText(
    "Where the click and the backing track are heard, the click's sound, and the count-in"
  )
  const body = page.locator("[data-tab-body]")
  // After The click; Tempo drift stays after it.
  const titles = await body.locator("[data-settings-group] h3").allTextContents()
  expect(titles).toEqual(["Click output", "The click", "Backing track", "Tempo drift"])
  const group = body.getByRole("region", { name: "Backing track" })
  await expect(group).toContainText(
    "Where the backing track is heard: the speakers the band plays to, or the mix for in-ear monitors. Picking one plays two seconds of it."
  )
  await expect(group.getByRole("combobox", { name: "Backing track output" })).toHaveText("Where the player plays")
  await expect(group.getByRole("slider", { name: "Backing track volume" })).toHaveAttribute("aria-valuenow", "0.8")
  await expect(group).not.toContainText("One output")
  await expect(body).toContainText(
    "The click's and the backing track's settings are also behind the gear in the metronome row, on the rehearsal screen."
  )

  // Picking an output plays two seconds of it.
  await group.getByRole("combobox", { name: "Driver" }).click()
  await page.getByRole("option", { name: "ASIO" }).click()
  await group.getByRole("combobox", { name: "Backing track output" }).click()
  await page.getByRole("option", { name: /X18\/XR18/ }).click()
  await expect.poll(() => args(page, "set_backing_device")).toEqual([[3]])
  await expect.poll(async () => (await calls(page, "backing_preview")).length).toBe(1)
  await expect(group.getByRole("combobox", { name: "Outputs" })).toHaveText("1–2")
  // One output: a stereo file is played in mono, and the line says so.
  await group.getByRole("combobox", { name: "Outputs" }).click()
  await page.getByRole("option", { name: "5 (mono)", exact: true }).click()
  await expect.poll(() => args(page, "set_backing_channels")).toEqual([[[5]]])
  await expect.poll(async () => (await calls(page, "backing_preview")).length).toBe(2)
  await expect(group).toContainText("One output: a stereo backing track is played in mono.")

  // The volume, the same as the row's.
  await group.getByRole("slider", { name: "Backing track volume" }).focus()
  await page.keyboard.press("ArrowLeft")
  await expect.poll(() => args(page, "set_backing_setting")).toEqual([["backing_volume", 0.79]])
})

test("the gear: Click and backing track, with the backing track's output", async ({ page }) => {
  await bandRehearsal(page)
  await metronome(page).getByRole("button", { name: "Click and backing track" }).click()
  const pop = page.getByRole("dialog", { name: "Click and backing track" })
  await expect(pop.getByRole("combobox", { name: "Click output" })).toBeVisible()
  const own = pop.getByRole("group", { name: "Backing track output" })
  await expect(own.getByRole("combobox", { name: "Backing track output" })).toHaveText("Where the player plays")
  await expect(own.getByRole("combobox", { name: "Outputs" })).toBeVisible()
  await expect(pop).toContainText("The same settings are in Settings › Click & backing track.")
  // The row has no gear of its own.
  await expect(row(page).getByRole("button", { name: /settings/i })).toHaveCount(0)
})

// ---- The player ----------------------------------------------------------

const lanes = (page: Page) => page.locator("[data-lanes] [data-lane-row]")
const mute = (page: Page) => page.getByRole("button", { name: "Mute Backing", exact: true })
const rung = (page: Page, folder: string) => page.locator(`[data-rung="${folder}"]`)
const rungGroup = (page: Page, folder: string) => page.locator(`[data-rung-group="${folder}"]`)

/** A take of the band's Tuesday jam a fortnight ago, opened from its
 *  song's page in History; Escape first puts away a take already open. */
async function openOld(page: Page, song: string, take: string) {
  if (await page.locator("[data-master-plate]").isVisible()) {
    await page.keyboard.press("Escape")
    await expect(page.locator("[data-master-plate]")).toHaveCount(0)
  }
  await page.getByRole("navigation", { name: "Songs" }).locator(`[data-song='${song}']`).click()
  await expect(page.locator("[data-song-head]").getByRole("heading", { name: song, exact: true })).toBeVisible()
  if (!(await rungGroup(page, "/rec/tue-before").getByRole("button", { name: take, exact: true }).isVisible()))
    await rung(page, "/rec/tue-before").click()
  await rungGroup(page, "/rec/tue-before").getByRole("button", { name: take, exact: true }).click()
  await expect(page.locator("[data-master-plate]")).toBeVisible()
  await expect(lanes(page).last()).toHaveAttribute("data-lane-row", "Backing")
}

const dashed = (el: Locator) => el.evaluate((e) => getComputedStyle(e).borderTopStyle)

test("the Backing lane is last, above Master, dashed and muted the first time; M is kept for the song", async ({
  page,
}) => {
  await openBandApp(page)
  await openHistory(page)
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await openOld(page, "Viasna", "Take 4 Viasna")
  const id = await idOf(page, "Viasna")
  // The plate says what the file is, and both it and the lane are dashed.
  const plate = page.locator("[data-plate='Backing']")
  await expect(plate).toContainText("Backing")
  await expect(plate).toContainText("Stereo file")
  expect(await dashed(plate)).toBe("dashed")
  expect(await dashed(page.locator("[data-lane='Backing'] > div"))).toBe("dashed")
  expect(await dashed(page.locator("[data-plate='Drums']"))).not.toBe("dashed")
  // Right above Master.
  const last = (await lanes(page).last().boundingBox())!
  const master = (await page.locator("[data-master-group]").boundingBox())!
  expect(master.y).toBeGreaterThanOrEqual(last.y + last.height - 1)
  // Muted the first time a take of Viasna opens.
  await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
  expect(await args(page, "set_song_backing_heard")).toEqual([])

  // M heard: kept for Viasna, and its next take opens heard.
  await mute(page).click()
  await expect(mute(page)).toHaveAttribute("aria-pressed", "false")
  await expect.poll(() => args(page, "set_song_backing_heard")).toEqual([[id, true]])
  await openOld(page, "Viasna", "Take 5 Viasna 2")
  await expect(mute(page)).toHaveAttribute("aria-pressed", "false")

  // Another song's is its own: Pałyn's opens muted.
  await openOld(page, "Pałyn", "Take 3 Pałyn 3")
  await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
})

// Drift leaves the Backing track out of "the mix" by its kind (spec Part 9):
// the kind has to reach Python with the take's files.
test("the drift line is asked with the Backing track named as one", async ({ page }) => {
  await openBandApp(page)
  await openHistory(page)
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await openOld(page, "Viasna", "Take 4 Viasna")
  await expect.poll(async () => (await args(page, "take_drift")).length).toBeGreaterThan(0)
  const [tracks] = (await args(page, "take_drift")).at(-1) as [{ name: string; kind?: string }[]]
  expect(tracks.find((t) => t.name === "Backing")?.kind).toBe("backing")
  expect(tracks.find((t) => t.name === "Drums")?.kind).toBeUndefined()
})

test("Review right after a take shows the same lane, muted the first time", async ({ page }) => {
  await bandRehearsal(page)
  await nameNext(page, "Pałyn")
  await record(page).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(page.locator("[data-take-summary]")).toBeVisible()
  await expect(lanes(page).last()).toHaveAttribute("data-lane-row", "Backing")
  await expect(page.locator("[data-plate='Backing']")).toContainText("Stereo file")
  await expect(mute(page)).toHaveAttribute("aria-pressed", "true")
  await mute(page).click()
  await expect.poll(() => args(page, "set_song_backing_heard")).toEqual([[await idOf(page, "Pałyn"), true]])
})

// ---- 960 px ----------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`the two rows, Finish and Record fit at 960 and nothing moves, in the ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await bandRehearsal(page, themed(theme) + VIASNA_126)
    await settled(page)
    const at = async () => {
      const [r, s] = await Promise.all([record(page).boundingBox(), status(page).boundingBox()])
      return [r!.x, r!.y, r!.width, s!.y, s!.height].map((v) => Math.round(v))
    }
    const still = await at()
    const fits = async (what: string) => {
      // Nothing cut: every word in the row whole, the line on two lines.
      const cut = await row(page).evaluate((r) =>
        [...r.querySelectorAll<HTMLElement>("[data-backing-name], [data-backing-time], [data-backing-row-line]")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
          .map((el) => el.textContent)
      )
      expect(cut, `${what}: cut`).toEqual([])
      const said = await status(page).evaluate((el) => ({
        height: el.scrollHeight,
        line: parseFloat(getComputedStyle(el).lineHeight),
      }))
      expect(said.height, `${what}: two lines at most`).toBeLessThanOrEqual(2 * said.line + 1)
      expect(await at(), `${what}: moved`).toEqual(still)
      const footer = (await page.locator("footer").boundingBox())!
      const own = (await row(page).boundingBox())!
      const actions = (await page.locator("[data-footer-actions]").boundingBox())!
      expect(own.x + own.width, `${what}: into Finish`).toBeLessThanOrEqual(actions.x)
      expect(footer.x + footer.width).toBeLessThanOrEqual(960)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(960)
    }
    await expect(status(page)).toContainText("counted at 126")
    await fits("Viasna 2, counted at 126")
    await nameNext(page, "Pałyn")
    await expect(file(page)).toContainText("Pałyn backing.wav")
    await fits("Palyn")
    await play(page).click()
    await expect(time(page)).toHaveText(/ \/ 3:42$/)
    await fits("Palyn playing")
    await stop(page).click()
    await onOff(page).click()
    await expect(status(page)).toContainText("Backing track off")
    await fits("off")
    await onOff(page).click()
    await setFake(page, "__BACKING_GETTING_READY__", true)
    await expect(status(page)).toContainText("Getting the backing track ready")
    await fits("getting ready")
    await setFake(page, "__BACKING_GETTING_READY__", false)
    // The longest pair: both outputs not connected.
    await setFake(page, "__BACKING_OUTPUT_MISSING__", "X18 5–6")
    await setFake(page, "__CLICK_MISSING__", "X18 3–4")
    await expect(status(page)).toContainText("The beat will only flash.")
    await expect(status(page)).toContainText("Takes record without it.")
    await fits("both outputs missing")
    await setFake(page, "__CLICK_MISSING__", null)
    await setFake(page, "__BACKING_OUTPUT_MISSING__", null)
    // A held tempo with its link, and the backing track's longest own line.
    await metronome(page).getByRole("textbox", { name: "Tempo" }).fill("132")
    await metronome(page).getByRole("textbox", { name: "Tempo" }).press("Enter")
    await expect(status(page)).toContainText("it will not follow 132.")
    await fits("held at 132")
    await nameNext(page, "Dym")
    await expect(rowLine(page)).toBeVisible()
    await fits("Dym")
    await nameNext(page, "Take 6")
    await expect(rowLine(page)).toHaveText("Free take: no backing track.")
    await fits("free take")
  })
}
