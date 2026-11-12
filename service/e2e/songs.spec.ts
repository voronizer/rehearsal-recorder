import { writeFileSync } from "node:fs"
import { expect, test, type Locator } from "@playwright/test"
import { as, band, HEADERS } from "./band"
import { linesOf, roomBetween } from "./rows"

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
  const dialog = page.getByRole("dialog", { name: "New song" })
  const add = dialog.getByRole("button", { name: "Add song" })
  await dialog.getByLabel("Title").fill("pałyn")
  // The error's line under the title is there before it: nothing below moves.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const top = (await add.boundingBox())!.y
  await add.click()
  await expect(dialog.getByRole("alert")).toHaveText("There is already a song called “Pałyn”.")
  expect((await add.boundingBox())!.y).toBe(top)
  await dialog.getByLabel("Title").fill("Zorka")
  await add.click()
  // The new song's page opens, with the first status; Back from it is Songs, with no dialog.
  await expect(page).toHaveURL(/\/songs\/\d+$/)
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Zorka")
  await expect(main.getByRole("button", { name: "Status: Learning" })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(dialog).toHaveCount(0)
  const learning = page.getByRole("region", { name: "Learning" })
  await expect(learning.locator('[data-song="Zorka"]')).toContainText("No takes yet")
  // The rows of a list are one height, with ▶ or without; 24 px apart, no lines, no dotted titles.
  const heights = await learning.locator("[data-song]").evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)))
  expect(new Set(heights).size, String(heights)).toBe(1)
  const list = learning.getByRole("list")
  expect(new Set(await roomBetween(list))).toEqual(new Set([24]))
  expect(new Set(await linesOf(list))).toEqual(new Set(["0px"]))
  await expect(learning.getByRole("link", { name: "Zorka", exact: true })).toHaveCSS("text-decoration-line", "none")
})

test("a status deleted while New song is open: Add song says so, and the next press takes the first", async ({ page }) => {
  const gig = (await (await page.request.post("/api/statuses", { data: { name: "Gig" }, headers: HEADERS })).json()) as { id: number }
  await page.goto("/songs")
  await page.getByRole("button", { name: "New song" }).click()
  const dialog = page.getByRole("dialog", { name: "New song" })
  const status = dialog.getByRole("combobox", { name: "Status" })
  await dialog.getByLabel("Title").fill("Kalada")
  await status.click()
  await page.getByRole("option", { name: "Gig", exact: true }).click()
  await expect(status).toHaveText("Gig")
  // Someone else deletes it meanwhile.
  expect((await page.request.delete(`/api/statuses/${gig.id}`, { headers: HEADERS })).ok()).toBe(true)
  await dialog.getByRole("button", { name: "Add song" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("No such status")
  await expect(status).toHaveText("Learning")
  // Kalada stays, as Zorka does: a song in the trash would be in the Trash's tests.
  await dialog.getByRole("button", { name: "Add song" }).click()
  await expect(page).toHaveURL(/\/songs\/\d+$/)
  await expect(page.getByRole("main").getByRole("button", { name: "Status: Learning" })).toBeVisible()
})

test("where the browser cannot play, a press on a song's greyed Play stays on Songs", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { AudioDecoder: undefined }))
  await page.goto("/songs")
  const play = page.locator('[data-song="Viasna"]').getByRole("button", { name: /^Play / })
  await expect(play).toBeDisabled()
  const box = (await play.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page).toHaveURL(/\/songs$/)
})

test("Statuses opens in the panel over Songs, New song a dialog, one at a time; Esc, Back and X close them", async ({ page }) => {
  await page.goto("/songs")
  const main = page.getByRole("main")
  const panel = page.getByLabel("Panel")
  const button = page.getByRole("button", { name: "Statuses", exact: true })
  const statuses = panel.getByRole("heading", { name: "Statuses", exact: true })
  await button.click()
  await expect(page).toHaveURL(/\/songs\?panel=statuses$/)
  await expect(statuses).toBeVisible()
  // The songs stay where they are under it.
  await expect(main.getByRole("region", { name: "Learning" })).toBeVisible()
  await expect(main.getByRole("heading", { name: "Statuses", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
  await button.click()
  await page.goBack()
  await expect(panel).toHaveCount(0)
  await expect(page).toHaveURL(/\/songs$/)
  await button.click()
  await panel.getByRole("button", { name: "Close", exact: true }).click()
  await expect(panel).toHaveCount(0)
  // Statuses again closes it; the panel is beside the page, clear of the buttons at the top right.
  await button.click()
  await button.click()
  await expect(panel).toHaveCount(0)

  // New song over the open panel: the dialog in its place.
  await button.click()
  await expect(statuses).toBeVisible()
  await page.getByRole("button", { name: "New song", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New song" })
  await expect(dialog).toBeVisible()
  await expect(panel).toHaveCount(0)
  await expect(dialog.getByRole("combobox", { name: "Status" })).toHaveText("Learning")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.getByRole("button", { name: "New song", exact: true }).click()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/songs$/)
})

test("New song's dialog makes the song with the status picked and opens its page", async ({ page }) => {
  await page.goto("/songs")
  await page.getByRole("button", { name: "New song", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New song" })
  await dialog.getByLabel("Title").fill("Rosy")
  await dialog.getByRole("combobox", { name: "Status" }).click()
  await page.getByRole("option", { name: "Ready" }).click()
  await dialog.getByRole("button", { name: "Add song" }).click()
  await expect(page).toHaveURL(/\/songs\/\d+$/)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Rosy")
  await expect(main.getByRole("button", { name: "Status: Ready" })).toBeVisible()
  await page.goto("/songs")
  await expect(page.getByRole("region", { name: "Ready" }).locator('[data-song="Rosy"]')).toBeVisible()
})

test("Edit statuses on a song's page opens Statuses in the panel over the page", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Pałyn"]}`)
  await page.getByRole("main").getByRole("button", { name: /^Status: / }).click()
  await page.getByRole("menuitem", { name: "Edit statuses" }).click()
  await expect(page).toHaveURL(new RegExp(`/songs/${band().songs["Pałyn"]}\\?panel=statuses$`))
  await expect(page.getByLabel("Panel").getByRole("heading", { name: "Statuses", exact: true })).toBeVisible()
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText("Pałyn")
})

test("an old address with an editor at the top opens it where it is now", async ({ page }) => {
  await page.goto("/songs?edit=statuses")
  await expect(page).toHaveURL(/\/songs\?panel=statuses$/)
  await expect(page.getByLabel("Panel").getByRole("heading", { name: "Statuses", exact: true })).toBeVisible()
  await page.goto("/songs?edit=new-song")
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.getByRole("dialog", { name: "New song" })).toBeVisible()
  await page.goto("/marks?edit=labels")
  await expect(page).toHaveURL(/\/marks\?panel=labels$/)
  await expect(page.getByLabel("Panel").getByRole("heading", { name: "Labels", exact: true })).toBeVisible()
})

test("a song's title changes where it stands, its takes with it", async ({ page }) => {
  await page.goto(`/songs/${band().songs["Pałyn"]}`)
  const main = page.getByRole("main")
  const field = main.getByRole("textbox", { name: "Song title" })
  // The facts' line and what is below it stay where they are: the field is as
  // tall as the heading's row, and a refusal takes the facts' place as an
  // error under a field.
  const facts = main.getByText(/^\d:\d\d · 2 takes on 2 rehearsals$/)
  const below = main.getByRole("region", { name: "Best take" })
  const top = async (l: Locator) => Math.round((await l.boundingBox())!.y)
  const [factsTop, belowTop] = [await top(facts), await top(below)]
  await main.getByRole("button", { name: "Rename song Pałyn" }).click()
  await expect(field).toBeFocused()
  expect(await top(facts)).toBe(factsTop)
  expect(await top(below)).toBe(belowTop)
  await field.fill("viasna")
  const said = main.getByRole("alert")
  await expect(said).toHaveText("“Viasna” is another song. Songs are merged in РЭХА: Rename song there.")
  await expect(main.getByRole("button", { name: "Rename", exact: true })).toBeDisabled()
  expect(await top(said)).toBe(factsTop)
  expect(await top(below)).toBe(belowTop)
  await field.fill("Take 3")
  await expect(main.getByRole("alert")).toHaveText("Take 3 is what a take with no song is called.")
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
  // Who starred it is in the star's tip.
  await best.getByRole("button", { name: "Star “Viasna 11”" }).hover()
  await expect(page.getByRole("tooltip")).toHaveText("Starred by Dzima, Ira")
  await page.mouse.move(0, 0)
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
  // By keyboard: from the arrow, Tab goes to the day's pill.
  const pill = all.locator('[data-pill="rehearsal"]').filter({ hasText: /^Thursday, 23 October/ })
  await all.getByRole("button", { name: /^Thursday, 23 October( 2025)?, 1 take$/ }).focus()
  await page.keyboard.press("Tab")
  await expect(pill).toBeFocused()
  await pill.click()
  await expect(page).toHaveURL(`/rehearsals/${band().rehearsals.first}`)
})

test("the star at rehearsal shows apart", async ({ page }) => {
  await page.goto(`/takes/${band().takes["Kupalle 2"]}`)
  const main = page.getByRole("main")
  await expect(main.getByText("★ at rehearsal")).toBeVisible()
  const star = main.getByRole("button", { name: "Star “Kupalle 2”" })
  await expect(star).toHaveAttribute("aria-pressed", "false")
  // No member's star, so the star has no tip of who: nothing round it opens one.
  await expect(star.locator("xpath=ancestor-or-self::*[@data-slot='tooltip-trigger']")).toHaveCount(0)

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
  const dialog = page.getByRole("dialog", { name: "New song" })
  await dialog.getByLabel("Title").fill("Kalyhanka")
  await dialog.getByRole("button", { name: "Add song" }).click()
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Kalyhanka")
  await main.getByLabel("A file for the song").setInputFiles({ name: "words.txt", mimeType: "text/plain", buffer: Buffer.from("la la") })
  await expect(main.getByRole("link", { name: /words\.txt/ })).toBeVisible()

  await main.getByRole("button", { name: "Remove words.txt" }).click()
  const ask = page.getByRole("alertdialog")
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
  const panel = page.getByLabel("Panel")
  const names = panel.getByRole("textbox", { name: "Name" })
  await expect(names.first()).toHaveValue("Learning")
  const target = (await names.first().boundingBox())!
  await panel.getByRole("button", { name: "Move Archive" }).hover()
  await page.mouse.down()
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => names.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["Archive", "Learning", "Ready"])
  // Put back, for the tests after.
  const learning = (await names.nth(1).boundingBox())!
  const archive = (await names.first().boundingBox())!
  await panel.getByRole("button", { name: "Move Archive" }).hover()
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

test("a best take's number on Songs says its whole name in a tip", async ({ page }) => {
  await page.goto("/songs")
  await page.locator('[data-song="Viasna"]').getByRole("link", { name: "Viasna 11", exact: true }).hover()
  await expect(page.getByRole("tooltip")).toHaveText(/^Viasna\s#11$/)
})
