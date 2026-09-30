import {
  callCount,
  calls,
  expect,
  openApp,
  openHistory,
  recordTake,
  startButton,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// A take is named after the song it is a go at, and the band plays the same
// songs week after week. So wherever a take is named — on the review screen,
// renaming it after, and before it is played — the songs already played are
// there to click, and nobody types a title twice. The fake's repertoire is
// Polyn, Vesna, Ogon, Sonce, Dym, Ptaha and Doroga.

const nameField = (page: Page) => page.locator("#take-name")
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true })

async function saveAs(page: Page, name: string) {
  await nameField(page).fill(name)
  await page.getByRole("button", { name: /Save take/ }).click()
}

test("the review screen offers the songs already played, and a click names the take", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  // Nothing played yet tonight: the whole repertoire, as it is.
  await expect(group(page, "This rehearsal")).toHaveCount(0)
  await group(page, "Songs").getByRole("button", { name: "Ogon", exact: true }).click()
  await expect(nameField(page)).toHaveValue("Ogon")
  // The click left the keyboard to the screen, so Space saves.
  await page.keyboard.press("Space")
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Ogon")

  // The next take is another go at it, and the song is lit as that.
  await recordTake(page, 2)
  await expect(nameField(page)).toHaveValue("Ogon 2")
  const here = group(page, "This rehearsal")
  await expect(here.getByRole("button", { name: "Ogon 2" })).toHaveAttribute("aria-current", "true")
  await expect(group(page, "Other songs")).not.toContainText("Ogon")

  // Typing narrows them; the song typed out in full puts them all back.
  await nameField(page).fill("do")
  await expect(group(page, "Songs").getByRole("button")).toHaveText(["Doroga"])
  await nameField(page).fill("Doroga")
  await expect(here).toBeVisible()
  await expect(
    group(page, "Other songs").getByRole("button", { name: "Doroga" })
  ).toHaveAttribute("aria-current", "true")
  // A title nobody has played is simply typed: nothing is in the way.
  await nameField(page).fill("Brand new")
  await expect(page.locator("[data-song-choice]")).toHaveCount(0)
})

test("renaming a take on the rehearsal screen offers them too, and Enter still renames", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Polyn")
  await recordTake(page, 2)
  await saveAs(page, "Polyn 2")

  await page.hover("[data-take='2']")
  await page.getByRole("button", { name: "Rename take Polyn 2" }).click()
  const dialog = page.getByRole("dialog")
  // The take being renamed is not a go of its own: Polyn is still Polyn 2.
  await expect(
    dialog.getByRole("group", { name: "This rehearsal" }).getByRole("button")
  ).toHaveText(["Polyn 2"])
  await dialog.getByRole("button", { name: "Vesna", exact: true }).click()
  await expect(dialog.locator("input")).toHaveValue("Vesna")
  await expect(dialog.locator("input")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  expect((await calls(page, "rename_take")).at(-1)?.args.slice(1)).toEqual([2, "Vesna"])
})

test("renaming a take in history offers what that rehearsal played, as the next go", async ({
  page,
}) => {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await openHistory(page)
  await page.hover("[data-take='3']")
  await page.getByRole("button", { name: "Rename take Take 3" }).click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByRole("group", { name: "This rehearsal" }).getByRole("button")
  ).toHaveText(["Polyn 3", "Vesna 2"])
  expect((await calls(page, "song_choices")).at(-1)?.args).toEqual(["/rec/old", 3])
  await dialog.getByRole("button", { name: "Polyn 3" }).click()
  await dialog.getByRole("button", { name: "Rename" }).click()
  expect((await calls(page, "rename_take")).at(-1)?.args).toEqual(["/rec/old", 3, "Polyn 3"])
})

test.describe("the next take", () => {
  /** The row over Record: the name the next take has, lit, and the songs. */
  const row = (page: Page) => page.getByRole("group", { name: "Next take" })
  const lit = (page: Page) => row(page).locator("[aria-current='true']")

  test("is named from the songs over Record, and keeps its name through a take thrown away", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    // Out in the open, not behind a menu: the name it has and the songs.
    await expect(lit(page)).toHaveText("Take 1")
    await expect(row(page).getByRole("button", { name: "Vesna", exact: true })).toBeVisible()

    await row(page).getByRole("button", { name: "Vesna", exact: true }).click()
    await expect(lit(page)).toHaveText("Vesna")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Vesna"])
    // The click left the keyboard to the screen: Space records.
    await page.keyboard.press("Space")
    // The recording screen already says the song, and review has the name.
    await expect(page.getByText("Take 1 · Vesna")).toBeVisible()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Vesna")

    // Thrown away, it is played again under the same name.
    await page.getByRole("button", { name: /^Discard/ }).click()
    await expect(lit(page)).toHaveText("Vesna")
    await recordTake(page, 2)
    await expect(nameField(page)).toHaveValue("Vesna")
    await page.getByRole("button", { name: /Save take/ }).click()
    // Kept, it is used up, and the next one follows on from it — and the
    // song is not offered a second time beside it.
    await expect(lit(page)).toHaveText("Vesna 2")
    await expect(row(page).locator("[data-song-choice^='Vesna']")).toHaveCount(1)
  })

  test("takes a typed name under Other…, and leaves Space and Escape to it", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    const other = row(page).getByRole("button", { name: "Another name for the next take" })
    await other.click()
    const field = page.getByRole("textbox", { name: "Name of the next take" })
    await expect(field).toBeFocused()
    // Every song is in there, the ones the row had no room for too.
    await expect(page.getByRole("dialog").locator("[data-song-choice]")).toHaveCount(7)
    // Neither records nor finishes the rehearsal from inside it.
    await page.keyboard.press("Space")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(await callCount(page, "start_take")).toBe(0)
    expect(await callCount(page, "finish_rehearsal")).toBe(0)
    await expect(startButton(page)).toHaveCount(0)
    expect(await callCount(page, "set_next_take_name")).toBe(0)

    await other.click()
    await field.fill("New song")
    await page.keyboard.press("Enter")
    await expect(lit(page)).toHaveText("New song")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["New song"])
  })
})
