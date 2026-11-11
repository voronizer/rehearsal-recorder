import { expect, test, type Locator, type Page } from "@playwright/test"
import { as, band, HEADERS } from "./band"
import { roomBetween } from "./rows"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a take page has REHA's player: a lane per track with M and S, the drums' notes, and Master", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await expect(page.getByRole("main").getByText(/^0:10 · 6 tracks$/)).toBeVisible()
    const player = page.locator("[data-take-player]")
    const lanes = player.locator("[data-lane-row]")
    await expect(lanes).toHaveCount(7)
    for (const [i, name] of ["Drums", "Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"].entries())
      await expect(lanes.nth(i)).toHaveAttribute("data-lane-row", name)
    // The drums' notes under their sound, read from the .mid on the page, a row each for the kit.
    await expect(lanes.nth(1)).toHaveAttribute("data-paired", "true")
    // Not played here: M pressed for good, the words in its tip.
    await expect(lanes.nth(1).locator("[data-notes-plate]").getByRole("button", { name: "Drums: Saved as .mid, not played here" })).toHaveAttribute("aria-pressed", "true")
    // Folded when the take opens; the arrow after M opens them.
    const unfold = lanes.nth(1).getByRole("button", { name: "Drums notes" })
    await expect(unfold).toHaveAttribute("aria-expanded", "false")
    await unfold.click()
    await expect(unfold).toHaveAttribute("aria-expanded", "true")
    const kit = player.locator('[data-notes-lane="Drums"]')
    for (const row of ["Hi-hat", "Snare", "Kick"]) await expect(kit.getByText(row, { exact: true })).toBeVisible()
    await expect(kit).not.toContainText("Notes file")
    // Master: how loud the take plays here, and no click button, as the
    // service plays no click; its lane has the click's bars and the band's
    // tempo through them, as РЭХА counted it.
    const master = player.locator("[data-master-group]")
    await expect(master.getByRole("slider", { name: "Master volume" })).toBeVisible()
    await expect(master.getByRole("meter", { name: "Master level" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Click with the take" })).toHaveCount(0)
    const lane = master.locator("[data-master-lane]")
    await expect(lane.locator("[data-click-tag]")).toHaveText("Click 120 bpm · 4/4")
    expect(await lane.locator("[data-click-line]").count()).toBeGreaterThan(0)
    await expect(lane.locator("[data-drift-line]")).toBeVisible()
    await expect(lane.locator("[data-drift-chip]")).toHaveText(["+6"])
    await expect(lane).toHaveAttribute("aria-label", "Click 120 bpm · 4/4. Tempo: ahead 6 bpm, bars 3 to 5.")
    // РЭХА's balance came with the take.
    await expect(player.getByRole("slider", { name: "Vocals volume" })).toHaveAttribute("aria-valuetext", "70%")
    await expect(player.getByRole("slider", { name: "Bass volume" })).toHaveAttribute("aria-valuetext", "100%")

    const mute = player.getByRole("button", { name: "Mute Vocals" })
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    const solo = player.getByRole("button", { name: "Solo Bass" })
    await solo.click()
    await expect(solo).toHaveAttribute("aria-pressed", "true")
    // The drums' notes go pale with their sound while the bass plays alone.
    await expect(kit).toHaveAttribute("data-dimmed", "true")
    await solo.click()
    await expect(solo).toHaveAttribute("aria-pressed", "false")
    await expect(kit).not.toHaveAttribute("data-dimmed")
    await expect(mute).toHaveAttribute("aria-pressed", "true")

    // On one track, S takes M off and M takes S off.
    const soloVocals = player.getByRole("button", { name: "Solo Vocals" })
    await soloVocals.click()
    await expect(soloVocals).toHaveAttribute("aria-pressed", "true")
    await expect(mute).toHaveAttribute("aria-pressed", "false")
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    await expect(soloVocals).toHaveAttribute("aria-pressed", "false")
  })

  test("a take's page has its song's and its rehearsal's pills, each to its page, and Songs is lit", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    const main = page.getByRole("main")
    const songs = page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Songs" })
    await expect(songs).toHaveAttribute("aria-current", "page")
    await expect(main.locator("[data-pill]")).toHaveText(["Pałyn", /^Thursday, 30 October( 2025)?$/])
    // No ‹ Pałyn over the title: the song's pill does its job.
    await expect(main.getByRole("link", { name: "Pałyn" })).toHaveCount(1)
    await main.getByRole("link", { name: "Pałyn", exact: true }).click()
    await expect(page).toHaveURL(`/songs/${band().songs["Pałyn"]}`)
    await page.goBack()
    await main.getByRole("link", { name: /^Thursday, 30 October/ }).click()
    await expect(page).toHaveURL(`/rehearsals/${band().rehearsals.second}`)

    // A take with no song has the day alone; Songs is lit, as Songs lists it under Not named.
    await page.goto(`/takes/${band().takes["Take 3"]}`)
    await expect(main.locator("[data-pill]")).toHaveText([/^Thursday, 30 October( 2025)?$/])
    await expect(main.locator('[data-pill="rehearsal"]')).toBeVisible()
    await expect(songs).toHaveAttribute("aria-current", "page")
  })

  test("a take plays, its time moves, and a press on the lanes moves the playhead", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const transport = page.getByRole("toolbar", { name: "Transport" })
    const time = transport.getByText(/^\d:\d\d \/ 0:10$/)
    await expect(time).toHaveText("0:00 / 0:10")
    await transport.getByRole("button", { name: "Play", exact: true }).click()
    // Master's meter shows the whole take coming out.
    const meter = page.getByRole("meter", { name: "Master level" })
    await expect.poll(async () => Number(await meter.getAttribute("aria-valuenow")), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect(time).toHaveText(/^0:0[2-9] \/ 0:10$/, { timeout: 10_000 })
    // The bar at the bottom holds the same take, so it steps aside here.
    await expect(page.getByLabel("Player", { exact: true })).toHaveCount(0)
    await transport.getByRole("button", { name: "Pause", exact: true }).click()
    const lanes = page.getByRole("group", { name: "Take timeline" })
    const box = (await lanes.boundingBox())!
    await lanes.click({ position: { x: box.width * 0.8, y: box.height - 20 } })
    await expect(time).toHaveText("0:08 / 0:10")
  })

  test("stuck at the foot of the window, Master covers the lanes that go on under it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await page.getByRole("button", { name: "Drums notes" }).click()
    await expect(page.locator('[data-notes-lane="Drums"]').getByText("Kick", { exact: true })).toBeVisible()
    const master = page.locator("[data-master-band]")
    // Its foot is the window's, so no strip of a lane shows under it.
    const foot = await master.evaluate((b) => {
      const main = b.closest("main")!.getBoundingClientRect()
      const hit = document.elementFromPoint(main.left + main.width / 2, main.bottom - 3)
      return { gap: main.bottom - b.getBoundingClientRect().bottom, master: !!hit && b.contains(hit) }
    })
    expect(Math.abs(foot.gap)).toBeLessThan(1)
    expect(foot.master).toBe(true)
  })

  test("a track of notes alone has a lane of its own, after the tracks of sound", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    // The keys are one of its tracks.
    await expect(page.getByRole("main").getByText(/^0:10 · 3 tracks$/)).toBeVisible()
    const lanes = page.locator("[data-take-player] [data-lane-row]")
    await expect(lanes).toHaveCount(3)
    await expect(lanes.nth(2)).toHaveAttribute("data-lane-row", "Keys")
    await expect(lanes.nth(2)).not.toHaveAttribute("data-paired")
    await expect(lanes.nth(2).locator("[data-notes-plate]")).toContainText("Keys")
    await expect(lanes.nth(2).locator("[data-notes-plate] [data-icon]")).toHaveAttribute("data-icon", "keys")
    // Folded when the take opens; a chord in the octave of middle C, once
    // the lane is open.
    const fold = lanes.nth(2).getByRole("button", { name: "Keys notes" })
    await expect(fold).toHaveAttribute("aria-expanded", "false")
    await expect(lanes.nth(2)).toHaveAttribute("data-folded", "true")
    await fold.click()
    const keys = page.locator('[data-notes-lane="Keys"]')
    await expect(keys.getByText("C4", { exact: true })).toBeVisible()
    await expect(keys).not.toContainText("Notes file")
    // Another track's S leaves the keys' notes out of what is heard: pale.
    await expect(keys).not.toHaveAttribute("data-dimmed")
    await page.getByRole("button", { name: "Solo Drums" }).click()
    await expect(keys).toHaveAttribute("data-dimmed", "true")
  })

  test("a take sent by REHA 0.21 has Master with no lane: its click was not sent", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    const master = page.locator("[data-take-player] [data-master-group]")
    await expect(master.getByRole("slider", { name: "Master volume" })).toBeVisible()
    await expect(master.locator("[data-master-lane]")).toHaveCount(0)
  })

  test("Master's level is kept on this device for the next take", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const master = page.getByRole("slider", { name: "Master volume" })
    await expect(master).toHaveAttribute("aria-valuetext", "100%")
    await master.focus()
    for (let k = 0; k < 10; k++) await page.keyboard.press("ArrowLeft")
    await expect(master).toHaveAttribute("aria-valuetext", "90%")
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    await expect(page.getByRole("slider", { name: "Master volume" })).toHaveAttribute("aria-valuetext", "90%")
  })

  test("Download gives the tracks ticked in a list, each a file of its own; FLAC waits for the originals", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    await page.getByRole("button", { name: "Download", exact: true }).click()
    const window = page.getByRole("dialog", { name: "Download “Pałyn #9”" })
    await expect(window.getByRole("button", { name: "The mix" })).toBeEnabled()
    await expect(window.getByRole("button", { name: "Tracks in FLAC" })).toBeDisabled()
    await expect(window).toContainText("The originals are still coming from РЭХА.")

    await window.getByRole("button", { name: "Tracks in MP3" }).click()
    const list = page.getByRole("dialog", { name: "Tracks of “Pałyn #9” in MP3" })
    // The keys recorded notes alone: their .mid is a line of its own, after the tracks of sound.
    await expect(list.locator("[data-file]")).toHaveText(["Drums", "Bass", "Keys, notes (MIDI)"])
    await expect(list.getByRole("button", { name: "Download 3 files" })).toBeEnabled()
    await list.getByRole("checkbox").nth(1).click()
    // The files as the Worker serves them; their names are checked on Kupalle 2, since a
    // browser on Linux with no UTF-8 locale names “Pałyn” files “download”.
    const files: string[] = []
    page.on("download", (d) => void files.push(new URL(d.url()).pathname.split("/").pop()!))
    await list.getByRole("button", { name: "Download 2 files" }).click()
    await expect(list).toBeHidden()
    await expect.poll(() => files).toEqual(["1.mp3", "3.mid"])

    // Opened again, it starts from the three choices.
    await page.getByRole("button", { name: "Download", exact: true }).click()
    await expect(window.getByRole("button", { name: "The mix" })).toBeVisible()
  })

  test("the FLAC list has a track's notes under its sound, once the originals are up", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    await page.getByRole("button", { name: "Download", exact: true }).click()
    await page.getByRole("button", { name: "Tracks in FLAC" }).click()
    await expect(page.getByRole("dialog").locator("[data-file]")).toHaveText(["Drums", "Bass"])
    await page.getByRole("button", { name: "Back" }).click()
    await page.getByRole("button", { name: "Tracks in FLAC" }).click()
    const files: string[] = []
    page.on("download", (d) => void files.push(d.suggestedFilename()))
    await page.getByRole("button", { name: "Download 2 files" }).click()
    await expect.poll(() => files).toEqual(["Kupalle 2 - Drums.flac", "Kupalle 2 - Bass.flac"])

    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await page.getByRole("button", { name: "Download", exact: true }).click()
    await expect(page.getByRole("button", { name: "Tracks in FLAC" })).toBeDisabled()
    await page.getByRole("button", { name: "Tracks in MP3" }).click()
    await expect(page.getByRole("dialog").locator("[data-file]")).toHaveText([
      "Drums",
      "Drums, notes (MIDI)",
      "Bass",
      "Guitar",
      "Keys",
      "Vocals",
      "Shaker",
    ])
    for (const box of await page.getByRole("dialog").getByRole("checkbox").all()) await box.click()
    await expect(page.getByRole("button", { name: "Download 0 files" })).toBeDisabled()
  })

  test("the mix is made in the page as it plays, and called after what was muted", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await page.getByRole("button", { name: "Mute Bass" }).click()
    await page.getByRole("button", { name: "Download", exact: true }).click()
    const coming = page.waitForEvent("download")
    await page.getByRole("button", { name: "The mix" }).click()
    const mix = await coming
    expect(mix.suggestedFilename()).toBe("Viasna 12 - without Bass.mp3")
    await expect(page.getByRole("dialog")).toBeHidden()
    // An MP3: its first frame's sync bits, after an ID3 tag if LAME wrote one.
    const bytes = new Uint8Array(await (await mix.createReadStream()).toArray().then((c) => Buffer.concat(c)))
    const at = bytes[0] === 0x49 ? 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) : 0
    expect([bytes[at], bytes[at + 1] & 0xe0]).toEqual([0xff, 0xe0])

    // With every track muted there is nothing to mix.
    for (const name of ["Drums", "Guitar", "Keys", "Vocals", "Shaker"]) await page.getByRole("button", { name: `Mute ${name}` }).click()
    await page.getByRole("button", { name: "Download", exact: true }).click()
    await page.getByRole("button", { name: "The mix" }).click()
    await expect(page.getByRole("dialog")).toContainText("Every track is muted, so the mix would be silent.")
  })
})

test.describe("as Alex on a phone", () => {
  test.use({ storageState: as("alex"), viewport: { width: 390, height: 844 } })

  test("a take page lists the marks, each with its colour, and Download is an icon by the name", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const main = page.getByRole("main")
    const marks = main.getByRole("region", { name: "Marks" })
    await expect(main.getByRole("region", { name: "Download tracks" })).toHaveCount(0)
    const download = main.getByRole("button", { name: "Download", exact: true })
    await expect(download).toHaveText("")
    await download.click()
    await expect(page.getByRole("dialog", { name: "Download “Kupalle #2”" })).toBeVisible()
    await page.getByRole("button", { name: "Close" }).click()
    // The dot beside the label's name: it has a size.
    const dot = marks.locator("[data-mark]").first().locator("[data-label] > *").first()
    const box = (await dot.boundingBox())!
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
  })

  test("a take page on a phone has a row per track as on the desk, and no lanes", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const tracks = page.getByRole("main").getByRole("region", { name: "Tracks" })
    const rows = tracks.locator("[data-desk-row]")
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(4)).toHaveAttribute("data-desk-row", "Vocals")
    // The MIDI sign on the drums, which sent their notes too; Master after the tracks.
    await expect(rows.nth(0).getByRole("img", { name: "MIDI notes too" })).toBeVisible()
    await expect(rows.nth(1).getByRole("img", { name: "MIDI notes too" })).toHaveCount(0)
    await expect(tracks.locator("[data-master-plate]")).toBeVisible()
    await expect(tracks.getByRole("slider", { name: "Master volume" })).toBeVisible()
    await expect(page.locator("[data-lane-row]")).toHaveCount(0)
    await expect(page.getByRole("toolbar", { name: "Transport" })).toHaveCount(0)
    const mute = tracks.getByRole("button", { name: "Mute Drums" })
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    await expect(tracks.getByRole("slider", { name: "Vocals volume" })).toHaveAttribute("aria-valuetext", "70%")
  })
  test("on a phone, a take's marks keep their talk close, as messages, and its wave the cross", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const main = page.getByRole("main")
    // Not the lists' 24 px: a mark's talk reads as messages.
    const talk = main.getByRole("region", { name: "Marks" }).getByRole("list").first()
    // РЭХА's mark at 0:01 and the band's two.
    await expect(talk.locator(":scope > [role=listitem]")).toHaveCount(3)
    expect(await roomBetween(talk)).toEqual([14, 14])
    // A press on the player's wave sets the playhead: the cross, as in REHA.
    await expect(main.getByTestId("wave").first()).toHaveCSS("cursor", "crosshair")
  })

  test("on a phone, an old take's panel address opens its page, and an old editor's the panel", async ({ page }) => {
    const uid = band().takes["Pałyn 3"]
    await page.goto(`/songs?panel=take:${uid}`)
    await expect(page).toHaveURL(`/takes/${uid}`)
    await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
    await page.goto("/songs?edit=statuses")
    await expect(page).toHaveURL(/\/songs\?panel=statuses$/)
    await expect(page.getByLabel("Panel", { exact: true }).getByRole("heading", { name: "Statuses", exact: true })).toBeVisible()
  })

  test("on a phone, a track of notes alone has a row that says so, after the tracks of sound", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    const tracks = page.getByRole("main").getByRole("region", { name: "Tracks", exact: true })
    await expect(tracks).toContainText(/^Tracks\s*3/)
    const rows = tracks.locator("[data-desk-row]")
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2)).toHaveAttribute("data-desk-row", "Keys")
    await expect(rows.nth(2).getByRole("button", { name: "Keys: Saved as .mid, not played here" })).toHaveAttribute("aria-pressed", "true")
    await expect(rows.nth(2)).not.toContainText("Saved as")
    await expect(rows.nth(2).getByRole("slider")).toHaveCount(0)
    await expect(rows.nth(2)).not.toHaveAttribute("data-dimmed")
    await tracks.getByRole("button", { name: "Solo Drums" }).click()
    await expect(rows.nth(2)).toHaveAttribute("data-dimmed", "true")
  })
})

test.describe("stereo, as Alex", () => {
  test.use({ storageState: as("alex") })

  /** The rings after a track's name: their words, or none. */
  const rings = (row: Locator) => row.locator("[data-plate-file]")
  /** How many bars a track's meter has: two for a stereo file. */
  const bars = (row: Locator, name: string) => row.getByRole("meter", { name: `${name} level` }).locator("[data-fill]")

  /**
   * How far a lane's wave reaches above its middle line and below it, in
   * px, along the lane: a stereo wave has its left side up and its right
   * down, and the right is a third of the left in the seed, so it reaches
   * less far down; a wave in one piece reaches as far each way.
   */
  const reach = (page: Page, name: string) =>
    page.locator(`[data-lane="${name}"] canvas`).evaluate((c: HTMLCanvasElement) => {
      const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height)
      const mid = c.height / 2
      let up = 0
      let down = 0
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x += 4)
          if (data[(y * c.width + x) * 4 + 3] > 0) {
            up = Math.max(up, mid - y)
            down = Math.max(down, y + 1 - mid)
          }
      return { up: up / devicePixelRatio, down: down / devicePixelRatio }
    })

  /** The colour the band's muted text has in the theme on now. */
  const muted = (page: Page) =>
    page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement("span"))
      probe.style.color = "var(--muted-foreground)"
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    })

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [
      [1180, 820],
      [960, 680],
    ]) {
      test(`a stereo track has two rings, two bars and its wave in two halves, at ${width}x${height} in the ${theme} theme`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        await page.emulateMedia({ colorScheme: theme })
        await page.goto(`/takes/${band().takes["Viasna 5"]}`)
        const player = page.locator("[data-take-player]")
        const lanes = player.locator("[data-lane-row]")
        await expect(lanes).toHaveCount(3)
        const plate = (name: string) => player.locator(`[data-plate="${name}"]`)
        // Its wave sent with both sides: two rings, two bars, left above the line and right below.
        await expect(rings(plate("Bass"))).toHaveAccessibleName("Stereo file")
        await expect(bars(plate("Bass"), "Bass")).toHaveCount(2)
        await expect(rings(plate("Drums"))).toHaveAccessibleName("Mono file")
        await expect(bars(plate("Drums"), "Drums")).toHaveCount(1)
        await expect(rings(plate("Backing"))).toHaveAccessibleName("Stereo file")
        await expect.poll(async () => (await reach(page, "Bass")).up).toBeGreaterThan(10)
        for (const name of ["Bass", "Backing"]) {
          const { up, down } = await reach(page, name)
          expect(up).toBeGreaterThan(down * 2)
        }
        const drums = await reach(page, "Drums")
        expect(drums.up).toBeGreaterThan(10)
        expect(Math.abs(drums.up - drums.down)).toBeLessThanOrEqual(1)
        // The rings in the muted text's colour, whatever the theme.
        const colour = await muted(page)
        for (const name of ["Drums", "Bass"]) await expect(rings(plate(name)).locator("svg")).toHaveCSS("color", colour)
        // The rings take their 16 px after the name, and the row stays 56 px.
        expect((await rings(plate("Bass")).boundingBox())!.width).toBeCloseTo(16, 0)
        for (const name of ["Drums", "Bass", "Backing"]) expect((await plate(name).boundingBox())!.height).toBeCloseTo(56, 0)
        await rings(plate("Bass")).hover()
        await expect(page.getByRole("tooltip")).toHaveText("Stereo file")

        // A take sent before РЭХА sent both sides: its MP3 says stereo, and its wave is in one piece.
        await page.goto(`/takes/${band().takes["Viasna 11"]}`)
        await expect(player.locator("[data-lane-row]")).toHaveCount(4)
        await expect(rings(plate("Backing"))).toHaveAccessibleName("Stereo file")
        await expect(bars(plate("Backing"), "Backing")).toHaveCount(2)
        await expect(rings(plate("Bass"))).toHaveAccessibleName("Mono file")
        await expect.poll(async () => (await reach(page, "Backing")).up).toBeGreaterThan(5)
        const one = await reach(page, "Backing")
        expect(Math.abs(one.up - one.down)).toBeLessThanOrEqual(1)
      })
    }

    test(`on a phone, a stereo track has two rings and two bars on the desk in the ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(`/takes/${band().takes["Viasna 5"]}`)
      const tracks = page.getByRole("main").getByRole("region", { name: "Tracks" })
      const row = (name: string) => tracks.locator(`[data-desk-row="${name}"]`)
      await expect(rings(row("Bass"))).toHaveAccessibleName("Stereo file")
      await expect(bars(row("Bass"), "Bass")).toHaveCount(2)
      await expect(rings(row("Drums"))).toHaveAccessibleName("Mono file")
      await expect(bars(row("Drums"), "Drums")).toHaveCount(1)
      await expect(rings(row("Backing"))).toHaveAccessibleName("Stereo file")
      const colour = await muted(page)
      await expect(rings(row("Bass")).locator("svg")).toHaveCSS("color", colour)
      for (const name of ["Drums", "Bass", "Backing"]) expect((await row(name).boundingBox())!.height).toBeCloseTo(56, 0)

      await page.goto(`/takes/${band().takes["Viasna 11"]}`)
      await expect(rings(row("Backing"))).toHaveAccessibleName("Stereo file")
      await expect(bars(row("Backing"), "Backing")).toHaveCount(2)
      await expect(rings(row("Bass"))).toHaveAccessibleName("Mono file")
    })
  }

  test("a stereo track's level comes in two bars as it plays, the right side lower here", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 5"]}`)
    const player = page.locator("[data-take-player]")
    await expect(bars(player, "Bass")).toHaveCount(2)
    await page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play", exact: true }).click()
    const widths = (name: string) => bars(player, name).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
    await expect
      .poll(async () => {
        const [left, right] = await widths("Bass")
        return left > 0 && right > 0 && right < left
      }, { timeout: 10_000 })
      .toBe(true)
    await expect.poll(async () => (await widths("Drums"))[0], { timeout: 10_000 }).toBeGreaterThan(0)
    await page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Pause", exact: true }).click()
  })

  test("on a phone, a track's row comes with its rings, and no row moves when they come", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // The waves are held back until the test lets them through.
    let letThrough = () => {}
    const held = new Promise<void>((done) => (letThrough = done))
    await page.route("**/*.peaks", async (route) => {
      await held
      await route.fallback()
    })
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    const tracks = page.getByRole("main").getByRole("region", { name: "Tracks" })
    const rows = tracks.locator("[data-desk-row]")
    await expect(rows).toHaveCount(4)
    const master = tracks.locator("[data-master-plate]")
    await expect(master).toBeVisible()
    const before = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
    const masterAt = (await master.boundingBox())!.y
    // Each row is there, empty: no name without its rings.
    await expect(rows.locator("[data-plate]")).toHaveCount(0)
    letThrough()
    await expect(rows.locator("[data-plate]")).toHaveCount(3)
    await expect(rows.locator("[data-plate-file]")).toHaveCount(3)
    expect(await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))).toEqual(before)
    expect((await master.boundingBox())!.y).toBe(masterAt)
    await page.unrouteAll({ behavior: "ignoreErrors" })
  })
})

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("a level moved is yours after a reload, and the way back is the balance, under Master", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const player = page.locator("[data-take-player]")
    // The way back is under the faders it sets: under Master's plate, there
    // all the time, faded while the levels are РЭХА's.
    const back = player.getByRole("button", { name: "РЭХА's levels" })
    await expect(back).toBeDisabled()
    const master = (await player.locator("[data-master-plate]").boundingBox())!
    const at = (await back.boundingBox())!
    expect(at.y).toBeGreaterThanOrEqual(master.y + master.height)
    expect(at.x + at.width).toBeLessThanOrEqual(master.x + master.width)
    await expect(page.getByText("Levels as РЭХА sent them.")).toHaveCount(0)
    const guitar = player.getByRole("slider", { name: "Guitar volume" })
    await expect(guitar).toHaveAttribute("aria-valuetext", "100%")
    // The page is read again only once the last turn has reached the service.
    const kept = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith("/api/me/levels") &&
        Math.round(r.request().postDataJSON().levels.Guitar * 100) === 95
    )
    await guitar.focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft")
    await expect(guitar).toHaveAttribute("aria-valuetext", "95%")
    await expect(back).toBeEnabled()
    await back.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Your levels: only you hear them. This puts back the ones РЭХА sent.")
    await kept

    await page.reload()
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "95%")
    // A track not moved stays at the take's balance.
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Vocals volume" })).toHaveAttribute("aria-valuetext", "70%")

    await page.locator("[data-take-player]").getByRole("button", { name: "РЭХА's levels" }).click()
    await expect(page.locator("[data-take-player]").getByRole("button", { name: "РЭХА's levels" })).toBeDisabled()
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "100%")
    await page.reload()
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "100%")
  })

  test("an answer to an earlier level comes late: the fader stays where the keys or the hand put it", async ({ page }) => {
    // Each level sent is answered only when the test lets it through, as on a slow connection.
    const waiting: (() => void)[] = []
    await page.route("**/api/me/levels", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback()
      await new Promise<void>((go) => waiting.push(go))
      await route.fallback()
    })
    const answerOne = async () => {
      await expect.poll(() => waiting.length).toBeGreaterThan(0)
      const answered = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/me/levels"))
      waiting.shift()!()
      await answered
      // The player is read every 120 ms: a fader put back would show by now.
      await page.waitForTimeout(500)
    }
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const player = page.locator("[data-take-player]")
    const guitar = player.getByRole("slider", { name: "Guitar volume" })
    await expect(guitar).toHaveAttribute("aria-valuetext", "100%")
    await guitar.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft")
    await expect(guitar).toHaveAttribute("aria-valuetext", "97%")
    // The answer to 99% comes while 98% and 97% still wait to be sent.
    await answerOne()
    await expect(guitar).toHaveAttribute("aria-valuetext", "97%")
    await answerOne()
    await expect(guitar).toHaveAttribute("aria-valuetext", "97%")

    // Let go, take it again at once, and hold it while the answer to the first comes.
    const box = (await guitar.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * 0.96, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 })
    await page.mouse.up()
    const letGo = await guitar.getAttribute("aria-valuetext")
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 })
    const hand = (await guitar.getAttribute("aria-valuetext"))!
    expect(hand).not.toBe(letGo)
    await answerOne()
    await expect(guitar).toHaveAttribute("aria-valuetext", hand)
    // What the hand let go of is what is kept.
    const sent = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/me/levels"))
    await page.mouse.up()
    expect(`${Math.round((await sent).postDataJSON().levels.Guitar * 100)}%`).toBe(hand)
    await answerOne()
    await page.unroute("**/api/me/levels")
    await page.reload()
    await expect(player.getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", hand)

    // The take's balance back, for the tests after this one.
    await player.getByRole("button", { name: "РЭХА's levels" }).click()
    await expect(player.getByRole("button", { name: "РЭХА's levels" })).toBeDisabled()
    await page.reload()
    await expect(player.getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "100%")
  })

  test("a level turned while another take plays is the one heard when Play is pressed, before it is kept", async ({ page }) => {
    await page.goto(`/rehearsals/${band().rehearsals.second}`)
    await page.locator('[data-take="Viasna 11"]').getByRole("button", { name: "Play “Viasna 11”" }).click()
    await expect(page.getByRole("button", { name: "Pause “Viasna 11”" }).first()).toBeVisible()
    // To Viasna 12's page while Viasna 11 plays on in the bar: Viasna 12 is not in the player yet.
    await page.locator('[data-take="Viasna 12"]').getByRole("link", { name: "Viasna 12", exact: true }).click()
    await expect(page).toHaveURL(`/takes/${band().takes["Viasna 12"]}`)
    const waiting: (() => void)[] = []
    await page.route("**/api/me/levels", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback()
      await new Promise<void>((go) => waiting.push(go))
      await route.fallback()
    })
    const player = page.locator("[data-take-player]")
    const guitar = player.getByRole("slider", { name: "Guitar volume" })
    await expect(guitar).toHaveAttribute("aria-valuetext", "100%")
    await guitar.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft")
    await expect(guitar).toHaveAttribute("aria-valuetext", "97%")
    await page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play", exact: true }).click()
    await expect(page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    // The player is read every 120 ms: a fader the new player put back would show by now.
    await page.waitForTimeout(500)
    await expect(guitar).toHaveAttribute("aria-valuetext", "97%")
    await page.unroute("**/api/me/levels")
    while (waiting.length) waiting.shift()!()
    await page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Pause", exact: true }).click()

    // The take's balance back, for the tests after this one.
    await expect(player.getByRole("button", { name: "РЭХА's levels" })).toBeEnabled()
    await player.getByRole("button", { name: "РЭХА's levels" }).click()
    await expect(player.getByRole("button", { name: "РЭХА's levels" })).toBeDisabled()
    await page.reload()
    await expect(player.getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "100%")
  })

  test("a level that could not be kept says so beside the way back", async ({ page }) => {
    await page.route("**/api/me/levels", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, json: { error: "The band service is resting" } })
        : route.fallback()
    )
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const bass = page.locator("[data-take-player]").getByRole("slider", { name: "Bass volume" })
    await bass.focus()
    await page.keyboard.press("ArrowLeft")
    await expect(page.locator("[data-levels]").getByRole("alert")).toHaveText("Your levels were not kept: The band service is resting")
  })

  test("Play shows Pause at once while the files come, and a second press pauses", async ({ page }) => {
    // The take's files are held back until the test lets them through: all
    // but the first bytes of each, which say its channels as the page opens.
    let letThrough = () => {}
    const held = new Promise<void>((done) => (letThrough = done))
    await page.route("**/*.mp3*", async (route) => {
      if (route.request().headers()["range"] !== "bytes=0-16383") await held
      await route.fallback()
    })
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const transport = page.getByRole("toolbar", { name: "Transport" })
    await transport.getByRole("button", { name: "Play", exact: true }).click()
    await expect(transport.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await expect(transport.getByText(/^\d:\d\d \/ 0:10$/)).toHaveText("0:00 / 0:10")
    await transport.getByRole("button", { name: "Pause", exact: true }).click()
    await expect(transport.getByRole("button", { name: "Play", exact: true })).toBeVisible()
    letThrough()
    await page.unrouteAll({ behavior: "ignoreErrors" })
  })

  test("M and S on a take's page work before the take plays, and stay when it does", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 3"]}`)
    const player = page.locator("[data-take-player]")
    const solo = player.getByRole("button", { name: "Solo Bass" })
    await expect(solo).toBeEnabled()
    await solo.click()
    await expect(solo).toHaveAttribute("aria-pressed", "true")
    const transport = page.getByRole("toolbar", { name: "Transport" })
    await transport.getByRole("button", { name: "Play", exact: true }).click()
    await expect(transport.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await expect(solo).toHaveAttribute("aria-pressed", "true")
    // M on the soloed track takes its S off.
    const mute = player.getByRole("button", { name: "Mute Bass" })
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    await expect(solo).toHaveAttribute("aria-pressed", "false")
    await transport.getByRole("button", { name: "Pause", exact: true }).click()
  })

  test("a star shows at once and stays after a reload", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 3"]}`)
    const main = page.getByRole("main")
    const star = main.getByRole("button", { name: "Star “Pałyn 3”" })
    await expect(star).toHaveAttribute("aria-pressed", "false")
    await star.click()
    await expect(main.getByRole("button", { name: "Take back your star from “Pałyn 3”" })).toHaveAttribute("aria-pressed", "true")
    await expect(main.getByTitle("Starred by Ira")).toBeVisible()
    await page.reload()
    await expect(page.getByRole("main").getByRole("button", { name: "Take back your star from “Pałyn 3”" })).toBeVisible()
    await expect(page.getByRole("main").getByTitle("Starred by Ira")).toBeVisible()
  })
})

test.describe("as Dzima", () => {
  test.use({ storageState: as("dzima") })

  test("Mark in the bar sets a mark where the take is", async ({ page }) => {
    // The take's page puts it in the player at 0:05; on its song's page the bar has it.
    await page.goto(`/takes/${band().takes["Pałyn 9"]}?at=5`)
    await page.getByRole("main").getByRole("link", { name: "Pałyn" }).first().click()
    const bar = page.getByLabel("Player")
    await expect(bar.getByTestId("bar-time")).toHaveText("0:05")
    await bar.getByRole("button", { name: "Mark" }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("New mark at 0:05")
    await panel.getByLabel("Note").fill("Bass comes in late")
    await panel.getByRole("button", { name: "Add mark" }).click()
    const mine = panel.locator("[data-mark]").filter({ hasText: "Bass comes in late" })
    await expect(mine).toContainText("0:05")
    await expect(mine).toContainText("Dzima")
    // On the take's page it is a chip in the player; pressed, its talk is in the panel.
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    await page.locator("[data-take-player]").getByRole("button", { name: "Bass comes in late" }).click()
    await expect(page.getByLabel("Panel", { exact: true })).toContainText("Mark at 0:05")
    const kept = page.getByLabel("Panel", { exact: true }).locator("[data-mark]").filter({ hasText: "Bass comes in late" })
    await expect(kept).toContainText("0:05")
    // The box for a comment is open; Send comes with the words.
    await expect(kept.getByRole("button", { name: "Send" })).toHaveCount(0)
    await kept.getByRole("textbox", { name: "Your comment" }).fill("Or the drums are early")
    await kept.getByRole("button", { name: "Send" }).click()
    await expect(kept.getByText("Or the drums are early")).toBeVisible()
    await expect(kept.getByRole("textbox", { name: "Your comment" })).toHaveValue("")
    // Deleting your mark, under its ⋯, says what goes with it.
    await kept.getByRole("button", { name: "What to do with the mark at 0:05" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const ask = page.getByRole("dialog")
    await expect(ask).toContainText("Its comment goes with it.")
    await ask.getByRole("button", { name: "Cancel" }).click()
  })

  test("Mark on the take page opens a new mark in the panel", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}?at=8`)
    const transport = page.getByRole("toolbar", { name: "Transport" })
    await expect(transport.getByText(/^\d:\d\d \/ /)).toHaveText(/^0:08 /)
    await transport.getByRole("button", { name: "Add mark" }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(panel).toContainText("New mark at 0:08")
    await panel.getByLabel("Note").fill("Guitar too loud")
    await panel.getByRole("button", { name: "Add mark" }).click()
    await expect(panel).toContainText("Mark at 0:08")
    await expect(panel.locator("[data-mark]")).toContainText("Dzima")
    await expect(page.locator("[data-take-player]").getByRole("button", { name: "Guitar too loud" })).toBeVisible()
  })

  test("closing a mark with words not sent asks first", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    await page.locator("[data-take-player]").getByRole("button", { name: "Count it in" }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await panel.getByRole("textbox", { name: "Your comment" }).fill("Half a thou")
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    const ask = page.getByRole("dialog", { name: "Discard what you wrote?" })
    await ask.getByRole("button", { name: "Keep writing" }).click()
    await expect(panel.getByRole("textbox", { name: "Your comment" })).toHaveValue("Half a thou")
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await ask.getByRole("button", { name: "Discard" }).click()
    await expect(panel).toHaveCount(0)
  })

  test("a mark chip opens its talk: a comment, closed and opened again", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const player = page.locator("[data-take-player]")
    const panel = page.getByLabel("Panel", { exact: true })
    // A mark from РЭХА follows РЭХА: no ⋯ with Edit or Delete. A chip has no ✕.
    await player.getByRole("button", { name: "Count it in" }).click()
    await expect(panel.locator("[data-mark]")).toContainText("Set in РЭХА")
    await expect(panel.getByRole("button", { name: /^What to do with/ })).toHaveCount(0)
    await expect(player.getByRole("button", { name: /^Remove mark/ })).toHaveCount(0)

    await player.getByRole("button", { name: "Too quiet here" }).click()
    const quiet = panel.locator("[data-mark]").filter({ hasText: "Too quiet here" })
    await quiet.getByRole("textbox", { name: "Your comment" }).fill("Turn the vocal up")
    await quiet.getByRole("textbox", { name: "Your comment" }).press("Control+Enter")
    await expect(quiet.getByText("Turn the vocal up")).toBeVisible()
    await quiet.getByRole("button", { name: "Done", exact: true }).click()
    await expect(quiet).toHaveAttribute("data-closed", "true")
    await quiet.getByRole("button", { name: "Not done yet" }).click()
    await expect(quiet).toHaveAttribute("data-closed", "false")
    // The panel is in the page's address: a reload keeps it open.
    await page.reload()
    await expect(page.getByLabel("Panel", { exact: true }).locator("[data-mark]").getByText("Turn the vocal up")).toBeVisible()
  })
})

test.describe("deleting a take, as Alex", () => {
  test.use({ storageState: as("alex") })

  /** ⋯ › Delete take, and yes to the question. */
  async function deleteTake(page: import("@playwright/test").Page, where: import("@playwright/test").Locator, name: string) {
    await where.getByRole("button", { name: `What to do with ${name}`, exact: true }).click()
    await page.getByRole("menuitem", { name: "Delete take" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete take" }).click()
  }

  test("an old take's panel address opens the take's page", async ({ page }) => {
    const uid = band().takes["Pałyn 3"]
    await page.goto(`/songs?panel=take:${uid}`)
    await expect(page).toHaveURL(`/takes/${uid}`)
    await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Pałyn")
  })

  test("deleting a take on its page goes to its rehearsal", async ({ page }) => {
    const uid = band().takes["Pałyn 3"]
    await page.goto(`/takes/${uid}`)
    await deleteTake(page, page.getByRole("main"), "Pałyn 3")
    await expect(page).toHaveURL(new RegExp(`/rehearsals/${band().rehearsals.first}$`))
    await expect(page.getByText("This screen could not open.")).toHaveCount(0)
    await expect(page.locator('[data-take="Viasna 5"]').first()).toBeVisible()
    await expect(page.locator('[data-take="Pałyn 3"]')).toHaveCount(0)
    expect((await page.request.post(`/api/trash/${uid}/restore`, { headers: HEADERS })).ok()).toBe(true)
  })
})

test.describe("moving a take", () => {
  test.use({ storageState: as("alex") })

  test("Move to song: to a new song, to one the band has, out of its song", async ({ page }) => {
    await page.goto("/songs")
    const named = page.getByRole("region", { name: "Not named" })
    await named.getByRole("button", { name: "What to do with Take 3", exact: true }).click()
    await page.getByRole("menuitem", { name: "Move to song" }).click()
    // A take with no song: Not named is ticked.
    await expect(page.getByRole("menuitemradio", { name: "Not named" })).toHaveAttribute("aria-checked", "true")
    await page.getByRole("menuitem", { name: "New song…" }).click()
    // From a list the take's page opens, the field in its line.
    await expect(page).toHaveURL(`/takes/${band().takes["Take 3"]}`)
    const main = page.getByRole("main")
    const title = main.getByRole("heading", { level: 1 })
    const field = main.getByRole("textbox", { name: "New song" })
    await expect(field).toBeFocused()
    // Its number among the takes with no song, not the 7 of its evening.
    await expect(title).toContainText("Take #3")
    await field.fill("pałyn")
    await expect(main.getByRole("alert")).toHaveText("“Pałyn” is already a song: pick it in the list.")
    await expect(main.getByRole("button", { name: "Make the song" })).toBeDisabled()
    await field.fill("Rečka")
    await field.press("Enter")
    // РЭХА gives the number at its next check.
    await expect(title).toContainText("Rečka · number from РЭХА")

    await main.getByRole("button", { name: "What to do with Rečka", exact: true }).click()
    await page.getByRole("menuitem", { name: "Move to song" }).click()
    await expect(page.getByRole("menuitemradio", { name: "Rečka" })).toHaveAttribute("aria-checked", "true")
    await page.getByRole("menuitemradio", { name: "Pałyn" }).click()
    await expect(title).toContainText("Pałyn · number from РЭХА")
    await page.goto("/songs")
    await expect(named).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Learning" }).locator('[data-song="Rečka"]')).toBeVisible()
    // In a row, the song's title alone.
    await page.goto(`/songs/${band().songs["Pałyn"]}`)
    const row = page.getByRole("main").locator('[data-take="Pałyn"]')
    await expect(row).toBeVisible()

    // Out of its song from its row: “Take” under Not named, until РЭХА numbers it.
    // The take's ⋯ in its rehearsal's fold, not the song's by its title.
    await page.getByRole("main").getByRole("region").getByRole("button", { name: "What to do with Pałyn", exact: true }).click()
    await page.getByRole("menuitem", { name: "Move to song" }).click()
    await page.getByRole("menuitemradio", { name: "Not named" }).click()
    await expect(row).toHaveCount(0)
    await page.goto("/songs")
    await expect(named.locator('[data-take="Take"]')).toBeVisible()
    await named.getByRole("link", { name: "Take", exact: true }).click()
    await expect(title).toContainText("Take · number from РЭХА")

    // Not named is ticked, and picking it again sends nothing.
    let sent = 0
    page.on("request", (r) => void (r.method() === "PATCH" && sent++))
    await main.getByRole("button", { name: "What to do with Take", exact: true }).click()
    await page.getByRole("menuitem", { name: "Move to song" }).click()
    const none = page.getByRole("menuitemradio", { name: "Not named" })
    await expect(none).toHaveAttribute("aria-checked", "true")
    await none.click()
    await expect(none).toBeHidden()
    expect(sent).toBe(0)
  })
})

test.describe("the drawer on a take's page, as Alex", () => {
  test.use({ storageState: as("alex") })
  const marksOf = async (page: Page, take: string) =>
    ((await (await page.request.get(`/api/takes/${band().takes[take]}`)).json()) as { marks: { id: number; note: string }[] }).marks

  test("a take's page opens folded; its strip counts the marks and opens the drawer; it folds", async ({ page }) => {
    const n = (await marksOf(page, "Kupalle 2")).length
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const strip = page.getByLabel("Strip")
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(strip.getByRole("button", { name: `Marks: ${n}` })).toBeVisible()
    await expect(panel).toHaveCount(0)
    await strip.getByRole("button", { name: `Marks: ${n}` }).click()
    await expect(panel.getByRole("heading", { name: "Marks", exact: true })).toBeVisible()
    await expect(panel.locator("[data-mark]")).toHaveCount(n)
    await expect(page).toHaveURL(/panel=marks(%3A|:)/)
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await expect(strip).toBeVisible()
    // The sign at the top opens it too; Esc and Back fold it.
    await strip.getByRole("button", { name: "Open the panel" }).click()
    await expect(panel).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(panel).toHaveCount(0)
    await strip.getByRole("button", { name: "Open the panel" }).click()
    await expect(panel).toBeVisible()
    await page.goBack()
    await expect(panel).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/takes/${band().takes["Kupalle 2"]}$`))
  })

  test("a mark's chip opens the drawer on it; from the list, Back returns to the list", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const panel = page.getByLabel("Panel", { exact: true })
    const chip = page.locator("[data-take-player]").getByRole("button", { name: "Too quiet here" })
    await chip.click()
    await expect(panel).toContainText("Mark at 0:03")
    await expect(panel.getByRole("button", { name: "Back" })).toHaveCount(0)
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await page.getByLabel("Strip").getByRole("button", { name: /^Marks: / }).click()
    await chip.click()
    await expect(panel).toContainText("Mark at 0:03")
    await panel.getByRole("button", { name: "Back" }).click()
    await expect(panel.getByRole("heading", { name: "Marks", exact: true })).toBeVisible()
  })

  test("a chat link with a mark opens the take's page with the drawer on that mark", async ({ page }) => {
    const quiet = (await marksOf(page, "Kupalle 2")).find((m) => m.note === "Too quiet here")!
    await page.goto(`/takes/${band().takes["Kupalle 2"]}?at=3&mark=${quiet.id}`)
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(panel).toContainText("Mark at 0:03")
    await expect(panel).toHaveCount(1)
    await expect(page.getByLabel("Strip")).toBeVisible()
  })

  test("a drawer a chat link opened folds with Back, and with its sign after another mark", async ({ page }) => {
    const k = band().takes["Kupalle 2"]
    const quiet = (await marksOf(page, "Kupalle 2")).find((m) => m.note === "Too quiet here")!
    const panel = page.getByLabel("Panel", { exact: true })
    await page.goto(`/takes/${k}?at=3&mark=${quiet.id}`)
    await expect(panel).toContainText("Mark at 0:03")
    await page.goBack()
    await expect(panel).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/takes/${k}\\?at=3$`))

    await page.goto(`/takes/${k}?at=3&mark=${quiet.id}`)
    await expect(panel).toContainText("Mark at 0:03")
    await page.locator("[data-take-player]").getByRole("button", { name: "Count it in" }).click()
    await expect(panel).toContainText("Mark at 0:02")
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    // Folded, a reload does not open it again.
    await page.reload()
    await expect(page.getByLabel("Strip")).toBeVisible()
    await expect(panel).toHaveCount(0)
  })

  test("a mark that is gone still has the fold sign, and a take that is not there no signs in its strip", async ({ page }) => {
    const k = band().takes["Kupalle 2"]
    await page.goto(`/takes/${k}?panel=mark:${k}:999999`)
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(panel).toContainText("This mark is no longer there.")
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await page.goto("/takes/no-such-take")
    await expect(page.getByLabel("Strip")).toBeVisible()
    await expect(page.getByLabel("Strip").getByRole("button")).toHaveCount(0)
  })

  test("the take's name in a mark on its own page opens the drawer's list, not the take's panel", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    await page.locator("[data-take-player]").getByRole("button", { name: "Too quiet here" }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await panel.getByRole("button", { name: "Kupalle 2", exact: true }).click()
    await expect(panel.getByRole("heading", { name: "Marks", exact: true })).toBeVisible()
    // The take's own panel would draw its player a second time.
    await expect(panel.getByRole("heading", { level: 2, name: /Kupalle/ })).toHaveCount(0)
  })

  test("Esc in a list in the drawer closes the list, not the drawer", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    await page.getByLabel("Strip").getByRole("button", { name: "Open the panel" }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await panel.getByRole("button", { name: /^Add a mark at / }).click()
    await panel.getByRole("combobox", { name: "Label" }).click()
    await expect(page.getByRole("listbox")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("listbox")).toHaveCount(0)
    await expect(panel).toBeVisible()
  })
})
