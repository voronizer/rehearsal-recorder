import { writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("a song's page sets its status, key and notes, and takes a file", async ({ page }) => {
  await page.goto("/songs")
  // A press on the row past the title opens the song's page too.
  await page.getByRole("region", { name: "Learning" }).locator('[data-song="Viasna"]').click({ position: { x: 120, y: 10 } })
  await expect(page).toHaveURL(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByLabel("Panel")).toHaveCount(0)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Viasna")

  await main.getByRole("button", { name: "Status: Learning" }).click()
  await page.getByRole("menuitemradio", { name: "Ready" }).click()
  await expect(main.getByRole("button", { name: "Status: Ready" })).toBeVisible()

  await main.getByRole("combobox", { name: "Key" }).click()
  await page.getByRole("option", { name: "A minor" }).click()
  await expect(main.getByRole("combobox", { name: "Key" })).toHaveText("A minor")

  // Notes save themselves, with no button to press.
  await main.getByRole("textbox", { name: "Notes" }).fill("Ira starts, then the bass")
  await expect(main.getByRole("status").filter({ hasText: "Saved" })).toBeVisible()
  await page.reload()
  await expect(main.getByRole("textbox", { name: "Notes" })).toHaveValue("Ira starts, then the bass")

  await main.getByLabel("A file for the song").setInputFiles({
    name: "Viasna chart.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 made up"),
  })
  await expect(main.getByRole("link", { name: /Viasna chart\.pdf/ })).toHaveAttribute("target", "_blank")

  await page.getByRole("link", { name: "Songs" }).first().click()
  await expect(page.getByRole("region", { name: "Ready" }).getByRole("link", { name: "Viasna", exact: true })).toBeVisible()
})

test("a new song is refused for a title the band has in another case", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("button", { name: "New song" }).click()
  const main = page.getByRole("main")
  await main.getByLabel("Title").fill("pałyn")
  await main.getByRole("button", { name: "Add song" }).click()
  await expect(main.getByRole("alert")).toHaveText("There is already a song called “Pałyn”.")
  await main.getByLabel("Title").fill("Zorka")
  await main.getByRole("button", { name: "Add song" }).click()
  // The new song's page opens; Back from it is Songs, not the empty New song again.
  await expect(page).toHaveURL(/\/songs\/\d+$/)
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Zorka")
  await page.goBack()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(main.getByLabel("Title")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Learning" }).locator('[data-song="Zorka"]')).toContainText("No takes yet")
})

test("Statuses and New song open at the top of Songs, one in place of the other, and Back closes them", async ({ page }) => {
  // An address from before, with an editor in the panel, opens the page alone.
  await page.goto("/songs?panel=statuses")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Songs")
  await expect(page.getByLabel("Panel")).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Statuses", exact: true })).toHaveCount(0)

  await page.goto("/songs")
  const main = page.getByRole("main")
  const statuses = main.getByRole("heading", { name: "Statuses", exact: true })
  const newSong = main.getByRole("heading", { name: "New song", exact: true })
  await page.getByRole("button", { name: "Statuses", exact: true }).click()
  await expect(page).toHaveURL(/\?edit=statuses$/)
  await expect(statuses).toBeVisible()
  await expect(page.getByRole("button", { name: "Statuses", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel("Panel")).toHaveCount(0)
  // The editor is in the page's address: a reload keeps it open.
  await page.reload()
  await expect(statuses).toBeVisible()

  await page.getByRole("button", { name: "New song", exact: true }).click()
  await expect(newSong).toBeVisible()
  await expect(statuses).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(newSong).toHaveCount(0)
  await expect(statuses).toHaveCount(0)

  // The button pressed again, the card's ✕ or Cancel closes it.
  await page.getByRole("button", { name: "Statuses", exact: true }).click()
  await expect(statuses).toBeVisible()
  await page.getByRole("button", { name: "Statuses", exact: true }).click()
  await expect(statuses).toHaveCount(0)
  await page.getByRole("button", { name: "Statuses", exact: true }).click()
  await main.getByRole("button", { name: "Close" }).click()
  await expect(statuses).toHaveCount(0)
  await page.getByRole("button", { name: "New song", exact: true }).click()
  await main.getByRole("button", { name: "Cancel" }).click()
  await expect(newSong).toHaveCount(0)
  await expect(page).toHaveURL(/\/songs$/)
})

test("New song pressed over a panel on Statuses closes the panel, and Cancel is Songs", async ({ page }) => {
  // A take's marks in the panel, by its address, over Statuses.
  await page.goto(`/songs?edit=statuses&panel=marks:${band().takes["Kupalle 2"]}`)
  const main = page.getByRole("main")
  const panel = page.getByLabel("Panel")
  await expect(main.getByRole("heading", { name: "Statuses", exact: true })).toBeVisible()
  await expect(panel).toBeVisible()
  // The panel covers the buttons at the top right: by keyboard.
  await page.getByRole("button", { name: "New song", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(main.getByRole("heading", { name: "New song", exact: true })).toBeVisible()
  await expect(main.getByRole("heading", { name: "Statuses", exact: true })).toHaveCount(0)
  await expect(panel).toHaveCount(0)
  await main.getByRole("button", { name: "Cancel" }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(main.getByRole("heading", { name: "Statuses", exact: true })).toHaveCount(0)
})

test("Edit statuses on a song's page opens Statuses on Songs", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Pałyn"]}`)
  await page.getByRole("main").getByRole("button", { name: /^Status: / }).click()
  await page.getByRole("menuitem", { name: "Edit statuses" }).click()
  await expect(page).toHaveURL(/\/songs\?edit=statuses$/)
  await expect(page.getByRole("main").getByRole("heading", { name: "Statuses", exact: true })).toBeVisible()
  await expect(page.getByLabel("Panel")).toHaveCount(0)
})

test("a song's title changes where it stands, its takes with it", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Pałyn"]}`)
  const main = page.getByRole("main")
  const field = main.getByRole("textbox", { name: "Song title" })
  await main.getByRole("button", { name: "Rename song Pałyn" }).click()
  await expect(field).toBeFocused()
  // In the facts' place, a line says what only it can.
  await field.fill("viasna")
  await expect(main.getByText("“Viasna” is another song. Songs are merged in РЭХА: Rename song there.")).toBeVisible()
  await expect(main.getByRole("button", { name: "Rename", exact: true })).toBeDisabled()
  await field.fill("Take 3")
  await expect(main.getByText("Take 3 is what a take with no song is called.")).toBeVisible()
  await field.fill("Pałyn vosień")
  await expect(main.getByText("Its 2 takes are renamed with it.")).toBeVisible()
  await field.press("Escape")
  await expect(field).toHaveCount(0)
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Pałyn")
  await expect(main.getByText(/^\d:\d\d · 2 takes on 2 rehearsals$/)).toBeVisible()

  await main.getByRole("button", { name: "Rename song Pałyn" }).click()
  await field.fill("Pałyn vosień")
  await field.press("Enter")
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Pałyn vosień")
  await expect(main.locator('[data-take="Pałyn vosień 9"]').first()).toBeVisible()
  // Put back, for the tests after.
  await main.getByRole("button", { name: "Rename song Pałyn vosień" }).click()
  await field.fill("Pałyn")
  await main.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(main.locator('[data-take="Pałyn 9"]').first()).toBeVisible()
})

test("a song's tempo and signature are set on its page and kept", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Pałyn"]}`)
  const main = page.getByRole("main")
  const tempo = main.getByRole("textbox", { name: "Tempo" })
  await expect(tempo).toHaveValue("")
  await tempo.fill("96")
  await tempo.press("Enter")
  await main.getByRole("combobox", { name: "Time signature" }).click()
  await page.getByRole("option", { name: "6/8" }).click()
  await expect(main.getByRole("combobox", { name: "Time signature" })).toHaveText("6/8")
  await page.reload()
  await expect(tempo).toHaveValue("96")
  await expect(main.getByRole("combobox", { name: "Time signature" })).toHaveText("6/8")
  await page.getByRole("link", { name: "Songs" }).first().click()
  await expect(page.getByRole("region", { name: "Learning" }).locator('[data-song="Pałyn"]')).toContainText("96")
  await page.goBack()
  // Empty, the song has no tempo again.
  await tempo.fill("")
  await tempo.press("Enter")
  await page.reload()
  await expect(tempo).toHaveValue("")
})

test("a song page puts the best take on top", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Viasna"]}`)
  // Viasna 11 has two members' stars; Viasna 12 is newer and has none.
  const best = page.getByRole("region", { name: "Best take" })
  await expect(best).toContainText("most stars")
  await expect(best.locator("[data-take]")).toHaveAttribute("data-take", "Viasna 11")
  await expect(best.getByTitle("Starred by Dzima, Ira")).toBeVisible()
  // Every take by rehearsal, newest first; only the newest rehearsal open.
  const all = page.getByRole("region", { name: "All takes" })
  await expect(all.locator("[data-take]")).toHaveCount(2)
  await expect(all.locator("[data-take]").nth(0)).toHaveAttribute("data-take", "Viasna 12")
  await expect(all.locator("[data-take]").nth(1)).toHaveAttribute("data-take", "Viasna 11")
  // A day is its rehearsal's pill; the arrow and the count fold its takes.
  await all.getByRole("button", { name: /^Thursday, 23 October( 2025)?, 1 take$/ }).click()
  await expect(all.locator("[data-take]")).toHaveCount(3)
  await expect(all.locator("[data-take]").nth(2)).toHaveAttribute("data-take", "Viasna 5")
  await all.getByText("1 take", { exact: true }).click()
  await expect(all.locator("[data-take]")).toHaveCount(2)
  await all.locator('[data-pill="rehearsal"]').filter({ hasText: /^Thursday, 23 October/ }).click()
  await expect(page).toHaveURL(`/rehearsals/${band().rehearsals.first}`)
})

test("the star at rehearsal shows apart", async ({ page }) => {
  await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
  const main = page.getByRole("main")
  await expect(main.getByText("★ at rehearsal")).toBeVisible()
  await expect(main.getByRole("button", { name: "Star “Kupalle 2”" })).toHaveAttribute("aria-pressed", "false")
  await expect(main.getByTitle(/^Starred by/)).toHaveCount(0)

  // It does not count for the best take: with no member's star, the newest is it.
  await page.goto(`/songs/${band().songs["Kupalle"]}`)
  const best = page.getByRole("region", { name: "Best take" })
  await expect(best).toContainText("latest, no stars yet")
  await expect(best.locator("[data-take]")).toHaveAttribute("data-take", "Kupalle 2")
})

test("a file and a song with no takes go only after asking", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("button", { name: "New song" }).click()
  const main = page.getByRole("main")
  await main.getByLabel("Title").fill("Kalyhanka")
  await main.getByRole("button", { name: "Add song" }).click()
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Kalyhanka")
  await main.getByLabel("A file for the song").setInputFiles({ name: "words.txt", mimeType: "text/plain", buffer: Buffer.from("la la") })
  await expect(main.getByRole("link", { name: /words\.txt/ })).toBeVisible()

  await main.getByRole("button", { name: "Remove words.txt" }).click()
  const ask = page.getByRole("dialog")
  await expect(ask).toContainText("Remove “words.txt”?")
  await ask.getByRole("button", { name: "Cancel" }).click()
  await expect(main.getByRole("link", { name: /words\.txt/ })).toBeVisible()
  await main.getByRole("button", { name: "Remove words.txt" }).click()
  await ask.getByRole("button", { name: "Remove file" }).click()
  await expect(main.getByRole("link", { name: /words\.txt/ })).toHaveCount(0)

  await main.getByRole("button", { name: "What to do with Kalyhanka" }).click()
  await page.getByRole("menuitem", { name: "Delete song" }).click()
  await expect(ask).toContainText("Delete “Kalyhanka”?")
  await ask.getByRole("button", { name: "Delete song" }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(main.getByRole("link", { name: "Kalyhanka", exact: true })).toHaveCount(0)
  // Back does not lead to the song that is gone.
  await page.goBack()
  await expect(page).toHaveURL(/\/songs$/)
  // It waits in the Trash, so РЭХА can learn of it; put back for the tests after.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Trash" }).click()
  const kept = page.locator('[data-song="Kalyhanka"]')
  await expect(kept).toContainText(/^Kalyhankasong with notes and files · deleted by Alex/)
  await kept.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByRole("status")).toHaveText("“Kalyhanka” is back.")
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Songs" }).click()

  // A song with takes has the menu too, to send it to the Trash with them. Its title opens by keyboard.
  await page.getByRole("region", { name: "Learning" }).getByRole("link", { name: "Pałyn", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Pałyn")
  await expect(main.getByRole("button", { name: "What to do with Pałyn", exact: true })).toBeVisible()
})

test("a status dragged by its grip moves its group on Songs", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("button", { name: "Statuses", exact: true }).click()
  const main = page.getByRole("main")
  const names = main.getByRole("textbox", { name: "Name" })
  await expect(names.first()).toHaveValue("Learning")
  const target = (await names.first().boundingBox())!
  await main.getByRole("button", { name: "Move Archive" }).hover()
  await page.mouse.down()
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => names.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["Archive", "Learning", "Ready"])
  // Put back, for the tests after.
  const learning = (await names.nth(1).boundingBox())!
  const archive = (await names.first().boundingBox())!
  await main.getByRole("button", { name: "Move Archive" }).hover()
  await page.mouse.down()
  await page.mouse.move(archive.x + 20, learning.y + learning.height * 3, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => names.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["Learning", "Ready", "Archive"])
})

test("a file over 50 MB is refused before it is sent", async ({ page }, info) => {
  const big = info.outputPath("big.pdf")
  writeFileSync(big, Buffer.alloc(50 * 1024 * 1024 + 1))
  await page.goto("/songs")
  await page.getByRole("region", { name: "Learning" }).getByRole("link", { name: "Pałyn", exact: true }).click()
  const main = page.getByRole("main")
  const sent: string[] = []
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/files") && sent.push(r.url()))
  await main.getByLabel("A file for the song").setInputFiles(big)
  await expect(main.getByRole("alert")).toHaveText("A file is up to 50 MB")
  expect(sent).toEqual([])
})
