import { expect, test } from "@playwright/test"
import { as, band, HEADERS } from "./band"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a take page has REHA's player: a lane per track with M and S, the drums' notes, and Master", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await expect(page.getByText(/^Thursday, 30 October( 2025)? · 0:10 · 6 tracks$/)).toBeVisible()
    const player = page.locator("[data-take-player]")
    const lanes = player.locator("[data-lane-row]")
    await expect(lanes).toHaveCount(7)
    for (const [i, name] of ["Drums", "Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"].entries())
      await expect(lanes.nth(i)).toHaveAttribute("data-lane-row", name)
    // The drums' notes under their sound, read from the .mid on the page, a row each for the kit.
    await expect(lanes.nth(1)).toHaveAttribute("data-paired", "true")
    await expect(lanes.nth(1).locator("[data-notes-plate]")).toContainText("Saved as .mid, not played here")
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
    await expect(page.getByText(/^Thursday, 30 October( 2025)? · 0:10 · 3 tracks$/)).toBeVisible()
    const lanes = page.locator("[data-take-player] [data-lane-row]")
    await expect(lanes).toHaveCount(3)
    await expect(lanes.nth(2)).toHaveAttribute("data-lane-row", "Keys")
    await expect(lanes.nth(2)).not.toHaveAttribute("data-paired")
    await expect(lanes.nth(2).locator("[data-notes-plate]")).toContainText("Keys")
    await expect(lanes.nth(2).locator("[data-notes-plate] [data-icon]")).toHaveAttribute("data-icon", "keys")
    // A chord in the octave of middle C.
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

  test("download tracks says which originals are still coming", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    const files = page.getByRole("region", { name: "Download tracks" })
    await expect(files).toContainText("The originals are still coming from РЭХА. For now, each track is an MP3.")
    await expect(files.getByRole("link", { name: "Bass MP3" })).toHaveAttribute("href", /\/2\.mp3\?download=1$/)
    await expect(files.getByRole("link", { name: "Keys MIDI" })).toHaveAttribute("href", /\/3\.mid\?download=1$/)
    await expect(files.getByRole("link", { name: /FLAC/ })).toHaveCount(0)

    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    await expect(page.getByRole("region", { name: "Download tracks" })).not.toContainText("still coming")
    await expect(page.getByRole("link", { name: "Drums FLAC" })).toHaveAttribute("href", /\/1\.flac\?download=1$/)

    // A track of sound and notes is one row, with both.
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const rows = page.getByRole("region", { name: "Download tracks" }).locator("[data-download]")
    await expect(rows).toHaveCount(6)
    await expect(rows.first().getByRole("link", { name: "Drums MP3" })).toHaveAttribute("href", /\/1\.mp3\?download=1$/)
    await expect(rows.first().getByRole("link", { name: "Drums MIDI" })).toHaveAttribute("href", /\/7\.mid\?download=1$/)
  })
})

test.describe("as Alex on a phone", () => {
  test.use({ storageState: as("alex"), viewport: { width: 390, height: 844 } })

  test("a take page puts the marks before the downloads, each mark with its colour", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const main = page.getByRole("main")
    const marks = main.getByRole("region", { name: "Marks" })
    const files = main.getByRole("region", { name: "Download tracks" })
    const top = async (l: typeof marks) => (await l.boundingBox())!.y
    expect(await top(marks)).toBeLessThan(await top(files))
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
  test("on a phone, a track of notes alone has a row that says so, after the tracks of sound", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    const tracks = page.getByRole("main").getByRole("region", { name: "Tracks", exact: true })
    await expect(tracks).toContainText(/^Tracks\s*3/)
    const rows = tracks.locator("[data-desk-row]")
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2)).toHaveAttribute("data-desk-row", "Keys")
    await expect(rows.nth(2)).toContainText("Saved as .mid, not played here")
    await expect(rows.nth(2).getByRole("slider")).toHaveCount(0)
    await expect(rows.nth(2)).not.toHaveAttribute("data-dimmed")
    await tracks.getByRole("button", { name: "Solo Drums" }).click()
    await expect(rows.nth(2)).toHaveAttribute("data-dimmed", "true")
  })
})

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("a level moved is yours after a reload, and the way back is the balance", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const player = page.locator("[data-take-player]")
    const line = page.locator("[data-levels]")
    await expect(line).toContainText("Levels as РЭХА sent them.")
    await expect(line.getByRole("button", { name: "РЭХА's levels" })).toBeDisabled()
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
    await expect(line).toContainText("Your levels. Only you hear them.")
    await kept

    await page.reload()
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "95%")
    // A track not moved stays at the take's balance.
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Vocals volume" })).toHaveAttribute("aria-valuetext", "70%")

    await page.locator("[data-levels]").getByRole("button", { name: "РЭХА's levels" }).click()
    await expect(page.locator("[data-levels]")).toContainText("Levels as РЭХА sent them.")
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "100%")
    await page.reload()
    await expect(page.locator("[data-take-player]").getByRole("slider", { name: "Guitar volume" })).toHaveAttribute("aria-valuetext", "100%")
  })

  test("a level that could not be kept says so on the line", async ({ page }) => {
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
    // The take's files are held back until the test lets them through.
    let letThrough = () => {}
    const held = new Promise<void>((done) => (letThrough = done))
    await page.route("**/*.mp3*", async (route) => {
      await held
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
  })

  test("M and S in a take panel work before the take plays, and stay when it does", async ({ page }) => {
    await page.goto(`/?panel=take:${band().takes["Pałyn 3"]}`)
    const panel = page.getByLabel("Panel")
    await panel.getByRole("button", { name: /^Tracks/ }).click()
    const solo = panel.getByRole("button", { name: "Solo Bass" })
    await expect(solo).toBeEnabled()
    await solo.click()
    await expect(solo).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByRole("group", { name: "Drums" })).toHaveAttribute("data-heard", "false")
    await panel.getByRole("button", { name: /^Play “Pałyn 3”/ }).click()
    await expect(panel.getByRole("button", { name: /^Pause “Pałyn 3”/ })).toBeVisible()
    await expect(solo).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByRole("group", { name: "Drums" })).toHaveAttribute("data-heard", "false")
    // M on the soloed track takes its S off.
    const mute = panel.getByRole("button", { name: "Mute Bass" })
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    await expect(solo).toHaveAttribute("aria-pressed", "false")
    await expect(panel.getByRole("group", { name: "Drums" })).toHaveAttribute("data-heard", "true")
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
    const panel = page.getByLabel("Panel")
    await expect(panel).toContainText("A mark at 0:05")
    await panel.getByLabel("Note").fill("Bass comes in late")
    await panel.getByRole("button", { name: "Add mark" }).click()
    const mine = panel.locator("[data-mark]").filter({ hasText: "Bass comes in late" })
    await expect(mine).toContainText("0:05")
    await expect(mine).toContainText("Dzima")
    // On the take's page it is a chip in the player; pressed, its talk is in the panel.
    await page.goto(`/takes/${band().takes["Pałyn 9"]}`)
    await page.locator("[data-take-player]").getByRole("button", { name: "Bass comes in late" }).click()
    await expect(page.getByLabel("Panel")).toContainText("Mark at 0:05")
    const kept = page.getByLabel("Panel").locator("[data-mark]").filter({ hasText: "Bass comes in late" })
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
    const panel = page.getByLabel("Panel")
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
    const panel = page.getByLabel("Panel")
    await panel.getByRole("textbox", { name: "Your comment" }).fill("Half a thou")
    await panel.getByRole("button", { name: "Close", exact: true }).click()
    const ask = page.getByRole("dialog", { name: "Discard what you wrote?" })
    await ask.getByRole("button", { name: "Keep writing" }).click()
    await expect(panel.getByRole("textbox", { name: "Your comment" })).toHaveValue("Half a thou")
    await panel.getByRole("button", { name: "Close", exact: true }).click()
    await ask.getByRole("button", { name: "Discard" }).click()
    await expect(panel).toHaveCount(0)
  })

  test("a mark chip opens its talk: a comment, closed and opened again", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const player = page.locator("[data-take-player]")
    const panel = page.getByLabel("Panel")
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
    await expect(page.getByLabel("Panel").locator("[data-mark]").getByText("Turn the vocal up")).toBeVisible()
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

  test("deleting the open take closes its panel", async ({ page }) => {
    const uid = band().takes["Pałyn 3"]
    await page.goto(`/?panel=take:${uid}`)
    const panel = page.getByLabel("Panel")
    await deleteTake(page, panel, "Pałyn 3")
    await expect(panel).toHaveCount(0)
    await expect(page.getByText("This screen could not open.")).toHaveCount(0)
    expect((await page.request.post(`/api/trash/${uid}/restore`, { headers: HEADERS })).ok()).toBe(true)
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
