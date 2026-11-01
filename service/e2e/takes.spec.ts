import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a take page has a lane per track with M and S", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 12"]}`)
    await expect(page.getByText(/^Thursday, 30 October( 2025)? · 0:10 · 6 tracks$/)).toBeVisible()
    const lanes = page.getByRole("group")
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
    const clock = page.getByTestId("clock")
    await expect(clock).toHaveText("0:00 / 0:10")
    await page.getByRole("button", { name: "Play “Viasna 12”" }).click()
    await expect(clock).toHaveText("0:02 / 0:10", { timeout: 10_000 })
    await page.getByRole("button", { name: "Pause “Viasna 12”" }).click()
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

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("a star shows at once and stays after a reload", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 3"]}`)
    const star = page.getByRole("button", { name: "Star “Pałyn 3”" })
    await expect(star).toHaveAttribute("aria-pressed", "false")
    await star.click()
    await expect(star).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByLabel("Starred by Ira")).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Star “Pałyn 3”" })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByLabel("Starred by Ira")).toBeVisible()
  })
})

test.describe("as Dzima", () => {
  test.use({ storageState: as("dzima") })

  test("a comment is written at the playhead", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Pałyn 9"]}?at=5`)
    await page.getByRole("button", { name: "Comment at 0:05" }).click()
    await page.getByLabel("Your comment at 0:05").fill("Bass comes in late")
    await page.getByRole("button", { name: "Save" }).click()
    const list = page.getByRole("region", { name: "Marks and comments" })
    const mine = list.getByRole("listitem").filter({ hasText: "Bass comes in late" })
    await expect(mine).toContainText("0:05")
    await expect(mine).toContainText("Dzima")
    await page.reload()
    await expect(page.getByRole("listitem").filter({ hasText: "Bass comes in late" })).toContainText("0:05")
  })

  test("a closed comment is greyed and stays", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
    const list = page.getByRole("region", { name: "Marks and comments" })
    // A mark from РЭХА and Ira's comment, in time order.
    await expect(list.getByRole("listitem")).toHaveCount(2)
    await expect(list.getByRole("listitem").nth(0)).toContainText("Count it in")
    await expect(list.getByRole("listitem").nth(0)).toContainText("Again · mark from РЭХА")
    const quiet = list.getByRole("listitem").filter({ hasText: "Too quiet here" })
    await quiet.getByRole("button", { name: "Close" }).click()
    await expect(quiet).toHaveAttribute("data-closed", "true")
    await expect(quiet.getByRole("button", { name: "Reopen" })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("listitem").filter({ hasText: "Too quiet here" })).toHaveAttribute("data-closed", "true")
  })
})
