import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a take page has a lane per track with M and S", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await expect(page.getByText(/^Thursday, 30 October( 2025)? · 0:10 · 6 tracks$/)).toBeVisible()
    const lanes = page.getByRole("main").getByRole("group")
    await expect(lanes).toHaveCount(6)
    for (const [i, name] of ["Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"].entries())
      await expect(lanes.nth(i)).toHaveAccessibleName(name)

    const vocals = page.getByRole("group", { name: "Vocals" })
    await vocals.getByRole("button", { name: "Mute Vocals" }).click()
    await expect(vocals.getByRole("button", { name: "Mute Vocals" })).toHaveAttribute("aria-pressed", "true")
    await expect(vocals).toHaveAttribute("data-heard", "false")

    const bass = page.getByRole("group", { name: "Bass" })
    await bass.getByRole("button", { name: "Solo Bass" }).click()
    await expect(bass).toHaveAttribute("data-heard", "true")
    await expect(page.getByRole("group", { name: "Drums" })).toHaveAttribute("data-heard", "false")
    await bass.getByRole("button", { name: "Solo Bass" }).click()
    await expect(page.getByRole("group", { name: "Drums" })).toHaveAttribute("data-heard", "true")
    await expect(vocals).toHaveAttribute("data-heard", "false")
  })

  test("a take plays and its time moves", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    const main = page.getByRole("main")
    const clock = main.getByTestId("clock")
    await expect(clock).toHaveText("0:00 / 0:10")
    await main.getByRole("button", { name: "Play “Viasna 12”" }).click()
    await expect(clock).toHaveText("0:02 / 0:10", { timeout: 10_000 })
    await main.getByRole("button", { name: "Pause “Viasna 12”" }).click()
    // Tapping a lane moves the playhead there.
    const lane = page.getByRole("group", { name: "Drums" }).getByTestId("wave")
    const box = (await lane.boundingBox())!
    await lane.click({ position: { x: box.width * 0.8, y: box.height / 2 } })
    await expect(clock).toHaveText("0:08 / 0:10")
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
})

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

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
    await expect(page.getByRole("main").locator("[data-mark]").filter({ hasText: "Bass comes in late" })).toContainText("0:05")
  })

  test("a mark gets a comment, is closed and opened again", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const marks = page.getByRole("main").getByRole("region", { name: "Marks" }).locator("[data-mark]")
    // A mark from РЭХА and Ira's, by their moment. РЭХА's follows РЭХА: no Edit or Delete.
    await expect(marks).toHaveCount(2)
    await expect(marks.nth(0)).toContainText("Count it in")
    await expect(marks.nth(0)).toContainText("Set in РЭХА")
    await expect(marks.nth(0).getByRole("button", { name: "Edit" })).toHaveCount(0)

    const quiet = marks.filter({ hasText: "Too quiet here" })
    await quiet.getByRole("button", { name: "Comment", exact: true }).click()
    await quiet.getByLabel("Your comment").fill("Turn the vocal up")
    await quiet.getByRole("button", { name: "Send" }).click()
    await expect(quiet).toContainText("Dzima: Turn the vocal up")
    await quiet.getByRole("button", { name: "Close", exact: true }).click()
    await expect(quiet).toHaveAttribute("data-closed", "true")
    await quiet.getByRole("button", { name: "Open again" }).click()
    await expect(quiet).toHaveAttribute("data-closed", "false")
    await page.reload()
    await expect(page.locator("[data-mark]").filter({ hasText: "Too quiet here" })).toContainText("Dzima: Turn the vocal up")
  })
})
