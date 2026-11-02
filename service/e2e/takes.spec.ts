import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a take page has REHA's player: a lane per track with M and S, no Master", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await expect(page.getByText(/^Thursday, 30 October( 2025)? · 0:10 · 6 tracks$/)).toBeVisible()
    const player = page.locator("[data-take-player]")
    const lanes = player.locator("[data-lane-row]")
    await expect(lanes).toHaveCount(6)
    for (const [i, name] of ["Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"].entries())
      await expect(lanes.nth(i)).toHaveAttribute("data-lane-row", name)
    // The service has no click and no master level.
    await expect(player.locator("[data-master-group]")).toHaveCount(0)
    // РЭХА's balance came with the take.
    await expect(player.getByRole("slider", { name: "Vocals volume" })).toHaveAttribute("aria-valuetext", "70%")
    await expect(player.getByRole("slider", { name: "Bass volume" })).toHaveAttribute("aria-valuetext", "100%")

    const mute = player.getByRole("button", { name: "Mute Vocals" })
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    const solo = player.getByRole("button", { name: "Solo Bass" })
    await solo.click()
    await expect(solo).toHaveAttribute("aria-pressed", "true")
    await solo.click()
    await expect(solo).toHaveAttribute("aria-pressed", "false")
    await expect(mute).toHaveAttribute("aria-pressed", "true")
  })

  test("a take plays, its time moves, and a press on the lanes moves the playhead", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const transport = page.getByRole("toolbar", { name: "Transport" })
    const time = transport.getByText(/^\d:\d\d \/ 0:10$/)
    await expect(time).toHaveText("0:00 / 0:10")
    await transport.getByRole("button", { name: "Play", exact: true }).click()
    await expect(time).toHaveText(/^0:0[2-9] \/ 0:10$/, { timeout: 10_000 })
    // The bar at the bottom plays the same take.
    await expect(page.getByLabel("Player").getByTestId("bar-time")).not.toHaveText("0:00")
    await transport.getByRole("button", { name: "Pause", exact: true }).click()
    const lanes = page.getByRole("group", { name: "Take timeline" })
    const box = (await lanes.boundingBox())!
    await lanes.click({ position: { x: box.width * 0.8, y: box.height - 20 } })
    await expect(time).toHaveText("0:08 / 0:10")
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
    // The dot that says the label: it has a size, not only a title.
    const dot = marks.locator("[data-mark]").first().locator("span[title] > *")
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
    await expect(page.locator("[data-lane-row]")).toHaveCount(0)
    await expect(page.getByRole("toolbar", { name: "Transport" })).toHaveCount(0)
    const mute = tracks.getByRole("button", { name: "Mute Drums" })
    await mute.click()
    await expect(mute).toHaveAttribute("aria-pressed", "true")
    await expect(tracks.getByRole("slider", { name: "Vocals volume" })).toHaveAttribute("aria-valuetext", "70%")
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
    await guitar.focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft")
    await expect(guitar).toHaveAttribute("aria-valuetext", "95%")
    await expect(line).toContainText("Your levels. Only you hear them.")

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
    await page.goto(`/takes/${band().takes["Pałyn 9"]}?at=5`)
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
    await page.reload()
    // On the page it is a chip in the player; pressed, its talk is in the panel.
    await page.locator("[data-take-player]").getByRole("button", { name: "Bass comes in late" }).click()
    await expect(page.getByLabel("Panel")).toContainText("Mark at 0:05")
    const kept = page.getByLabel("Panel").locator("[data-mark]").filter({ hasText: "Bass comes in late" })
    await expect(kept).toContainText("0:05")
    // Deleting your mark says what goes with it.
    await kept.getByRole("button", { name: "Comment", exact: true }).click()
    await kept.getByLabel("Your comment").fill("Or the drums are early")
    await kept.getByRole("button", { name: "Send" }).click()
    await expect(kept).toContainText("Or the drums are early")
    // The mark's own Delete comes after its comments'.
    await kept.getByRole("button", { name: "Delete", exact: true }).last().click()
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

  test("a mark chip opens its talk: a comment, closed and opened again", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const player = page.locator("[data-take-player]")
    const panel = page.getByLabel("Panel")
    // A mark from РЭХА follows РЭХА: no Edit or Delete. A chip has no ✕.
    await player.getByRole("button", { name: "Count it in" }).click()
    await expect(panel.locator("[data-mark]")).toContainText("Set in РЭХА")
    await expect(panel.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0)
    await expect(player.getByRole("button", { name: /^Remove mark/ })).toHaveCount(0)

    await player.getByRole("button", { name: "Too quiet here" }).click()
    const quiet = panel.locator("[data-mark]").filter({ hasText: "Too quiet here" })
    await quiet.getByRole("button", { name: "Comment", exact: true }).click()
    await quiet.getByLabel("Your comment").fill("Turn the vocal up")
    await quiet.getByRole("button", { name: "Send" }).click()
    await expect(quiet).toContainText("Dzima: Turn the vocal up")
    await quiet.getByRole("button", { name: "Close", exact: true }).click()
    await expect(quiet).toHaveAttribute("data-closed", "true")
    await quiet.getByRole("button", { name: "Open again" }).click()
    await expect(quiet).toHaveAttribute("data-closed", "false")
    await page.reload()
    await page.locator("[data-take-player]").getByRole("button", { name: "Too quiet here" }).click()
    await expect(page.getByLabel("Panel").locator("[data-mark]")).toContainText("Dzima: Turn the vocal up")
  })
})
