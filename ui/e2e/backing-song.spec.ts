import {
  callCount,
  calls,
  colour,
  expect,
  hold,
  letGo,
  openBandApp,
  openHistory,
  setFake,
  settled,
  startRehearsal,
  style,
  test,
  themed,
} from "./app.ts"
import type { Page } from "@playwright/test"

// A song's backing track on its page in History, under the tempo row
// (backing-track spec, Part 6): adding and counting it, the line that says
// what was counted, bar 1 moved by a beat, dragged, stepped and typed, ▶
// with its playhead, Replace and Remove; and New song, with the songs that
// have no takes yet. The band's backing tracks are in band.js: Pałyn's
// counted at the song's 128, bar 1 at 0.80; Sonca's pads, no tempo counted;
// Viasna's at the song's 128 too, or at 126 with VIASNA_126. Dym has none,
// and its file counts to 104. Hlyboka was made with New song and has no takes.

/** Viasna's backing track counted at 126 while the song keeps 128, for the
 *  line that says so (band.js counts it at 128). */
const VIASNA_126 =
  "window.__BACKINGS__ = {Viasna: {name: 'Viasna backing.wav', seconds: 268, channels: 2, tempo: 126, first_bar: 0.45}};"

const head = (page: Page) => page.locator("[data-song-head]")
const section = (page: Page) => head(page).getByRole("region", { name: "Backing track" })
const line = (page: Page) => section(page).locator("[data-backing-line]")
const file = (page: Page) => section(page).locator("[data-backing-file]")
const field = (page: Page) => section(page).getByRole("textbox", { name: "Bar 1 at" })
const marker = (page: Page) => section(page).getByRole("slider", { name: "Bar 1" })
const drawing = (page: Page) => section(page).locator("[data-file-start]")
const hint = (page: Page) => section(page).locator("[data-file-start-hint]")
const playhead = (page: Page) => section(page).locator("[data-playhead]")
const play = (page: Page) => section(page).getByRole("button", { name: "Play the backing track with the click" })
const stop = (page: Page) => section(page).getByRole("button", { name: "Stop the backing track" })
const more = (page: Page) => section(page).getByRole("button", { name: "More for the backing track" })
const tempo = (page: Page) => head(page).getByRole("region", { name: "Tempo" }).getByRole("textbox", { name: "Tempo" })

/** History's Songs view, on `title`'s page. */
async function songPage(page: Page, title: string) {
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator(`[data-song='${title}']`).click()
  await expect(head(page).getByRole("heading", { name: title, exact: true })).toBeVisible()
}

/** The band in History, on `title`'s page. `before` runs ahead of the fake. */
async function openSong(page: Page, title: string, before = "") {
  if (before) await page.addInitScript(before)
  await openBandApp(page)
  await openHistory(page)
  await songPage(page, title)
}

/** The id the library gave a song. */
const idOf = (page: Page, title: string) =>
  page.evaluate(async (t) => {
    const api = (window as unknown as { pywebview: { api: { list_songs: () => Promise<{ songs: { id: number; title: string }[] }> } } }).pywebview.api
    return (await api.list_songs()).songs.find((s) => s.title === t)!.id
  }, title)

const args = async (page: Page, name: string) => (await calls(page, name)).map((c) => c.args)

const BEAT_LINKS = " A beat off (a pickup)? One beat earlier or later."

test("adding a backing track to a song with no tempo counts it and gives the song its tempo", async ({ page }) => {
  await openSong(page, "Dym")
  const id = await idOf(page, "Dym")
  await expect(section(page)).toContainText("No backing track")
  await expect(line(page)).toHaveText(
    "One audio file, mono or stereo. Its tempo is counted when it is added; with no steady beat in it, bar 1 is set by ear."
  )
  await expect(tempo(page)).toHaveValue("")

  await setFake(page, "__BACKING_PICK__", { path: "/Users/alex/Music/Dym minus.mp3", name: "Dym minus.mp3" })
  await hold(page, "add_backing")
  await section(page).getByRole("button", { name: "Add backing track…" }).click()
  await expect(line(page)).toHaveText("Counting the tempo of Dym minus.mp3…")
  await expect(file(page)).toContainText("Dym minus.mp3")
  await letGo(page, "add_backing")
  expect(await args(page, "add_backing")).toEqual([[id, "/Users/alex/Music/Dym minus.mp3"]])

  await expect(line(page)).toHaveText(
    "Counted 104 bpm, now the song's tempo; bar 1 on the first strong beat. Twice too fast or too slow: halve or double." +
      BEAT_LINKS
  )
  await expect(file(page)).toHaveText(/Dym minus\.mp3\s*3:34 · stereo/)
  await expect(field(page)).toHaveValue("0:00.62")
  // The tempo row above has the counted tempo, as the song does.
  await expect(tempo(page)).toHaveValue("104")

  await line(page).getByRole("button", { name: "halve" }).click()
  await expect(tempo(page)).toHaveValue("52")
  await expect(line(page)).toContainText("Counted 52 bpm, now the song's tempo")
  await line(page).getByRole("button", { name: "double" }).click()
  await expect(tempo(page)).toHaveValue("104")
  await expect.poll(() => args(page, "set_backing_tempo")).toEqual([
    [id, 52, true],
    [id, 104, true],
  ])

  // Opened again, the page says what is stored: the counted tempo is the
  // song's.
  await songPage(page, "Pałyn")
  await songPage(page, "Dym")
  await expect(line(page)).toHaveText("Counted 104 bpm, as the song; bar 1 on the first strong beat." + BEAT_LINKS)
})

test("a backing track counted at the song's tempo moves bar 1 a beat either way", async ({ page }) => {
  await openSong(page, "Pałyn")
  const id = await idOf(page, "Pałyn")
  await expect(file(page)).toHaveText(/Pałyn backing\.wav\s*3:42 · stereo/)
  await expect(field(page)).toHaveValue("0:00.80")
  await expect(line(page)).toHaveText("Counted 128 bpm, as the song; bar 1 on the first strong beat." + BEAT_LINKS)
  // A beat at 128 is 0.47 s.
  await line(page).getByRole("button", { name: "later" }).click()
  await expect(field(page)).toHaveValue("0:01.27")
  await line(page).getByRole("button", { name: "earlier" }).click()
  await expect(field(page)).toHaveValue("0:00.80")
  await expect.poll(() => args(page, "set_backing_first_bar")).toEqual([
    [id, 1.27],
    [id, 0.8],
  ])
})

test("a backing track counted at another tempo leaves the song's until it is taken", async ({ page }) => {
  await openSong(page, "Viasna", VIASNA_126)
  const id = await idOf(page, "Viasna")
  await expect(file(page)).toHaveText(/Viasna backing\.wav\s*4:28 · stereo/)
  await expect(line(page)).toHaveText(
    "Counted 126 bpm; the song stays at 128 until you take the backing track's tempo. Bar 1 on its first strong beat."
  )
  await expect(tempo(page)).toHaveValue("128")
  await line(page).getByRole("button", { name: "take the backing track's tempo" }).click()
  await expect(tempo(page)).toHaveValue("126")
  await expect(line(page)).toHaveText("Counted 126 bpm, as the song; bar 1 on the first strong beat." + BEAT_LINKS)
  expect(await args(page, "set_backing_tempo")).toEqual([[id, 126, true]])
})

test("pads with no steady beat keep the song's tempo, and draw its bars", async ({ page }) => {
  await openSong(page, "Sonca")
  await expect(file(page)).toHaveText(/Sonca pads\.wav\s*5:00 · mono/)
  await expect(line(page)).toHaveText(
    "No steady beat in it (pads): the click keeps the song's 96. Drag bar 1 to where the band comes in, and check it with ▶."
  )
  await expect(hint(page)).toContainText("Drag bar 1; the lines are the song's bars and beats.")
  // 3/4 at 96 from the file's start: bars 2 to 5 are numbered past bar 1's
  // marker, in the 8 s drawn.
  await expect(drawing(page).locator("[data-bar]")).toHaveText(["2", "3", "4", "5"])
})

test("pads in a song with no tempo draw no bars", async ({ page }) => {
  await openSong(page, "Sonca", "window.__SONG_TEMPOS__ = {Sonca: null}")
  await expect(line(page)).toHaveText(
    "No steady beat in it, and the song has no tempo: type or tap one above, or leave it, and the backing track plays from Record with no click."
  )
  await expect(hint(page)).toContainText("No tempo, so no bars to draw: drag bar 1.")
  await expect(drawing(page).locator("[data-bar]")).toHaveCount(0)
  await expect(marker(page)).toBeVisible()
})

test("bar 1 is stepped with the keys and the buttons, and typed", async ({ page }) => {
  await openSong(page, "Pałyn")
  const id = await idOf(page, "Pałyn")
  const sent = () => args(page, "set_backing_first_bar")

  await marker(page).focus()
  await page.keyboard.press("ArrowRight")
  await expect(field(page)).toHaveValue("0:00.81")
  await page.keyboard.press("Shift+ArrowRight")
  await expect(field(page)).toHaveValue("0:00.91")
  await page.keyboard.press("ArrowLeft")
  await expect(field(page)).toHaveValue("0:00.90")
  await expect(marker(page)).toHaveAttribute("aria-valuetext", "0:00.90")

  await field(page).fill("0:01.50")
  await field(page).press("Enter")
  await expect(field(page)).toHaveValue("0:01.50")
  // Not a time: the field puts back what it had, and nothing is saved.
  const before = (await sent()).length
  await field(page).fill("abc")
  await field(page).press("Enter")
  await expect(field(page)).toHaveValue("0:01.50")
  expect((await sent()).length).toBe(before)

  await field(page).press("ArrowUp")
  await expect(field(page)).toHaveValue("0:01.51")
  await field(page).press("Shift+ArrowUp")
  await expect(field(page)).toHaveValue("0:01.61")
  await field(page).press("ArrowDown")
  await expect(field(page)).toHaveValue("0:01.60")
  await section(page).getByRole("button", { name: "Bar 1 later" }).click()
  await expect(field(page)).toHaveValue("0:01.61")
  await section(page).getByRole("button", { name: "Bar 1 earlier" }).click()
  await expect(field(page)).toHaveValue("0:01.60")

  await expect.poll(sent).toEqual([
    [id, 0.81],
    [id, 0.91],
    [id, 0.9],
    [id, 1.5],
    [id, 1.51],
    [id, 1.61],
    [id, 1.6],
    [id, 1.61],
    [id, 1.6],
  ])
})

test("bar 1 is dragged, saved once let go, and the drawing keeps its scale", async ({ page }) => {
  await openSong(page, "Pałyn")
  const id = await idOf(page, "Pałyn")
  await settled(page)
  const box = (await drawing(page).boundingBox())!
  // Bar 1 at 0.80 and four bars of 128 after it: 8.3 s drawn.
  await expect(hint(page)).toContainText("0:00")
  await expect(hint(page)).toContainText("0:08")
  const ends = await hint(page).locator("[data-end]").textContent()
  const at = (sec: number) => box.x + (sec / 8.3) * box.width
  const m = (await marker(page).boundingBox())!
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2)
  await page.mouse.down()
  await page.mouse.move(at(2.5), m.y + m.height / 2, { steps: 5 })
  await page.mouse.move(at(4), m.y + m.height / 2, { steps: 5 })
  // Nothing saved while it is held.
  expect(await callCount(page, "set_backing_first_bar")).toBe(0)
  await page.mouse.up()
  await expect.poll(() => callCount(page, "set_backing_first_bar")).toBe(1)
  const [[sentId, sec]] = (await args(page, "set_backing_first_bar")) as [number, number][]
  expect(sentId).toBe(id)
  expect(Math.abs(sec - 4)).toBeLessThan(0.05)
  await expect(field(page)).toHaveValue(/^0:0(3\.9\d|4\.0\d)$/)
  // The marker is where it was let go, over the same seconds as before.
  const after = (await marker(page).boundingBox())!
  expect(Math.abs(after.x + after.width / 2 - at(sec))).toBeLessThan(2)
  expect((await drawing(page).boundingBox())!.width).toBe(box.width)
  expect(await hint(page).locator("[data-end]").textContent()).toBe(ends)
})

test("play runs the file and the click, with the playhead, until stopped", async ({ page }) => {
  await openSong(page, "Pałyn")
  const id = await idOf(page, "Pałyn")
  await settled(page)
  const controls = async () =>
    Promise.all([field(page), more(page)].map(async (el) => JSON.stringify(await el.boundingBox())))
  const still = await controls()
  await expect(playhead(page)).toHaveCount(0)
  await play(page).click()
  await expect(stop(page)).toBeVisible()
  expect(await args(page, "backing_play")).toEqual([[id, true]])
  await expect(playhead(page)).toBeVisible()
  await expect(file(page)).toHaveText(/Pałyn backing\.wav\s*0:0\d \/ 3:42 · stereo/)
  const left = () => playhead(page).evaluate((el) => parseFloat((el as HTMLElement).style.left))
  const first = await left()
  await expect.poll(left).toBeGreaterThan(first)
  // Nothing on the line moves as the time counts.
  expect(await controls()).toEqual(still)
  await stop(page).click()
  await expect(play(page)).toBeVisible()
  await expect.poll(() => callCount(page, "backing_stop")).toBe(1)
  await expect(playhead(page)).toHaveCount(0)
  await expect(file(page)).toHaveText(/Pałyn backing\.wav\s*3:42 · stereo/)
})

test("one plays at a time: the tempo row's click and the backing track", async ({ page }) => {
  await openSong(page, "Pałyn")
  const click = head(page).getByRole("region", { name: "Tempo" })
  await play(page).click()
  await expect(stop(page)).toBeVisible()
  await click.getByRole("button", { name: "Play the click" }).click()
  await expect(click.getByRole("button", { name: "Stop the click" })).toBeVisible()
  await expect(play(page)).toBeVisible()
  await expect(playhead(page)).toHaveCount(0)
  await play(page).click()
  await expect(stop(page)).toBeVisible()
  await expect(click.getByRole("button", { name: "Play the click" })).toBeVisible()
})

test("replace and remove, from the backing track's menu", async ({ page }) => {
  await openSong(page, "Pałyn")
  const id = await idOf(page, "Pałyn")
  await more(page).click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem")).toHaveText(["Replace…", "Remove"])
  await expect(menu).toContainText("Takes already recorded keep the backing track they were played with.")
  // Cancel in the window that picks the file: nothing changes.
  await setFake(page, "__BACKING_PICK__", null)
  await menu.getByRole("menuitem", { name: "Replace…" }).click()
  await expect.poll(() => callCount(page, "pick_backing_file")).toBe(1)
  expect(await callCount(page, "add_backing")).toBe(0)
  await expect(file(page)).toContainText("Pałyn backing.wav")

  await setFake(page, "__BACKING_PICK__", { path: "/Users/alex/Music/Pałyn live.wav", name: "Pałyn live.wav" })
  await more(page).click()
  await page.getByRole("menu").getByRole("menuitem", { name: "Replace…" }).click()
  await expect(file(page)).toHaveText(/Pałyn live\.wav\s*3:34 · stereo/)
  expect(await args(page, "add_backing")).toEqual([[id, "/Users/alex/Music/Pałyn live.wav"]])
  await expect(line(page)).toHaveText(
    "Counted 120 bpm; the song stays at 128 until you take the backing track's tempo. Bar 1 on its first strong beat."
  )

  await more(page).click()
  await page.getByRole("menu").getByRole("menuitem", { name: "Remove" }).click()
  await expect(section(page)).toContainText("No backing track")
  await expect(section(page).getByRole("button", { name: "Add backing track…" })).toBeVisible()
  await expect(line(page)).toHaveText(
    "One audio file, mono or stereo. Its tempo is counted when it is added; with no steady beat in it, bar 1 is set by ear."
  )
  expect(await args(page, "remove_backing")).toEqual([[id]])
  await expect(drawing(page)).toHaveCount(0)
})

test("the file's name is in the body's weight, one of the two (F5)", async ({ page }) => {
  await openSong(page, "Pałyn")
  const name = file(page).getByText("Pałyn backing.wav", { exact: true })
  expect(await style(name, "font-weight")).toEqual({ "font-weight": "400" })
})

// The drawing keeps its scale as bar 1 moves, so the marker stays where it
// was let go; a bar 1 typed past the drawing's end widens it instead.
test("a bar 1 typed past the drawn start widens the drawing to show it", async ({ page }) => {
  await openSong(page, "Pałyn")
  await expect(drawing(page)).toBeVisible()
  await field(page).fill("0:12.00")
  await field(page).press("Enter")
  await expect.poll(() => callCount(page, "set_backing_first_bar")).toBe(1)
  await expect(field(page)).toHaveValue("0:12.00")
  const box = (await drawing(page).boundingBox())!
  const m = (await marker(page).boundingBox())!
  expect(m.x + m.width / 2).toBeLessThan(box.x + box.width)
})

test("a copy deleted from the folder by hand says so", async ({ page }) => {
  await openSong(page, "Pałyn", "window.__BACKING_MISSING__ = ['Pałyn']")
  await expect(line(page)).toHaveText("Pałyn backing.wav is missing from the Backing tracks folder.")
  await expect(line(page)).toHaveAttribute("data-amber", "")
  await expect(file(page)).toHaveText("Pałyn backing.wav")
  await expect(play(page)).toHaveCount(0)
  await expect(drawing(page)).toHaveCount(0)
  await more(page).click()
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Replace…", "Remove"])
})

test("new song refuses a song's title or old name, and opens the new song's page", async ({ page }) => {
  await openBandApp(page)
  await openHistory(page)
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).getByRole("button", { name: "New song" }).click()
  const dialog = page.getByRole("dialog", { name: "New song" })
  await expect(dialog).toContainText("A song with no takes yet: give it a tempo and a backing track before its first take.")
  const title = dialog.getByRole("textbox", { name: "Song title" })
  const create = dialog.getByRole("button", { name: "Create" })
  const says = dialog.locator("[data-new-song-says]")
  await expect(create).toBeDisabled()
  // Pałyn was once typed "Palyn": the old name is the song.
  await title.fill("palyn")
  await expect(says).toHaveText("Pałyn is already a song. Open it")
  await expect(create).toBeDisabled()
  await title.fill("Viasna")
  await expect(says).toHaveText("Viasna is already a song. Open it")
  await title.fill("Take 3")
  await expect(says).toHaveText("Take 3 is what a take with no song is called.")
  await expect(create).toBeDisabled()
  await title.fill("Ranak")
  await expect(says).toHaveText("")
  await create.click()
  await expect(dialog).toHaveCount(0)
  expect(await args(page, "add_song")).toEqual([["Ranak"]])

  await expect(head(page).getByRole("heading", { name: "Ranak", exact: true })).toBeVisible()
  await expect(head(page)).toContainText("No takes yet: its first comes with the first take kept under this title.")
  await expect(section(page)).toContainText("No backing track")
  const row = page.getByRole("navigation", { name: "Songs" }).locator("[data-song='Ranak']")
  await expect(row).toContainText("No takes yet")
  await expect(row).toHaveAttribute("aria-current", /.+/)
})

test("new song with a song's title offers that song's page", async ({ page }) => {
  await openSong(page, "Pałyn")
  await page.getByRole("navigation", { name: "Songs" }).getByRole("button", { name: "New song" }).click()
  const dialog = page.getByRole("dialog", { name: "New song" })
  await dialog.getByRole("textbox", { name: "Song title" }).fill("viasna")
  await expect(dialog.locator("[data-new-song-says]")).toHaveText("Viasna is already a song. Open it")
  await dialog.getByRole("button", { name: "Open it" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(head(page).getByRole("heading", { name: "Viasna", exact: true })).toBeVisible()
  expect(await args(page, "add_song")).toEqual([])
})

test("a song with no takes is listed, and its page has no takes to play", async ({ page }) => {
  await openSong(page, "Hlyboka")
  await expect(page.getByRole("navigation", { name: "Songs" }).locator("[data-song='Hlyboka']")).toContainText(
    "No takes yet"
  )
  await expect(head(page)).toContainText("No takes yet: its first comes with the first take kept under this title.")
  await expect(head(page)).not.toContainText("Nothing to play")
  // No round ▶ before the title: there is no take to play.
  await expect(head(page).locator("[data-look]")).toHaveCount(0)
  await expect(page.locator("[data-song-parts]")).toHaveCount(0)
})

test("a song with no takes is offered under Next take for its first", async ({ page }) => {
  await openBandApp(page)
  // The band's evening has five takes in it already.
  await startRehearsal(page, 6)
  await page.locator("#next-take-name").fill("Hly")
  const row = page.locator('[data-next-take-panel] [data-song-row="Hlyboka"]')
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.locator("#next-take-name")).toHaveValue("Hlyboka")
})

for (const theme of ["dark", "light"] as const) {
  test(`the backing track fits at 960 and nothing moves, in the ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await openSong(page, "Viasna", themed(theme) + VIASNA_126)
    await settled(page)
    const fits = async (what: string) => {
      const parts = [file(page), field(page), play(page).or(stop(page)), more(page)]
      const at = await Promise.all(parts.map((p) => p.boundingBox()))
      const middles = at.map((b) => b!.y + b!.height / 2)
      expect(Math.max(...middles) - Math.min(...middles), `${what}: one line`).toBeLessThanOrEqual(1)
      // Nothing cut: every word whole, the line on two lines at most.
      const cut = await section(page).evaluate((s) =>
        [...s.querySelectorAll<HTMLElement>("button, input, [data-backing-line], [data-backing-file] *")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent)
      )
      expect(cut, `${what}: cut`).toEqual([])
      const said = await line(page).evaluate((el) => ({
        height: el.scrollHeight,
        line: parseFloat(getComputedStyle(el).lineHeight),
      }))
      expect(said.height, `${what}: two lines at most`).toBeLessThanOrEqual(2 * said.line + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(960)
    }
    await fits("Viasna")
    const height = (await section(page).boundingBox())!.height
    await line(page).getByRole("button", { name: "take the backing track's tempo" }).click()
    await expect(line(page)).toContainText("as the song")
    await fits("as the song")
    // The line keeps two lines' room whatever it says.
    expect((await section(page).boundingBox())!.height).toBe(height)
    // Bar 1's marker and line are the theme's accent.
    expect(await marker(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await colour(page, "--primary")
    )
  })
}
