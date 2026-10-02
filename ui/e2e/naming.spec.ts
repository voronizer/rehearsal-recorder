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
  /** The name over Record: one field, and the songs under it. */
  const field = (page: Page) => page.getByRole("textbox", { name: "Next take" })
  const songs = (page: Page) => page.getByRole("group", { name: "Next take" })
  const order = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __CALLS__: { name: string }[] }).__CALLS__.map((c) => c.name)
    )

  test("is named in one field over Record, and keeps its name through a take thrown away", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await expect(field(page)).toHaveValue("Take 1")

    // A song clicked fills the field and names the take; nothing under the
    // pointer moves.
    const vesna = songs(page).getByRole("button", { name: "Vesna", exact: true })
    const before = await songs(page).locator("[data-song-choice]").allTextContents()
    const at = (await vesna.boundingBox())!
    await vesna.click()
    await expect(field(page)).toHaveValue("Vesna")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Vesna"])
    expect(await songs(page).locator("[data-song-choice]").allTextContents()).toEqual(before)
    expect((await vesna.boundingBox())!).toEqual(at)

    // ✕ goes back to the name it would have had, and tells Python so.
    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])

    await vesna.click()
    // The click left the keyboard to the screen: Space records.
    await page.keyboard.press("Space")
    await expect(page.getByRole("heading", { level: 1, name: "Vesna" })).toBeVisible()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Vesna")

    // Thrown away, it is played again under the same name.
    await page.getByRole("button", { name: /^Discard/ }).click()
    await expect(field(page)).toHaveValue("Vesna")
    await recordTake(page, 2)
    await expect(nameField(page)).toHaveValue("Vesna")
    await page.getByRole("button", { name: /Save take/ }).click()
    // Kept, it is used up, and the next one follows on from it.
    await expect(field(page)).toHaveValue("Vesna 2")
  })

  test("a name typed is the one recorded, however the field is left", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)

    await field(page).fill("New song")
    await page.keyboard.press("Enter")
    await expect(field(page)).not.toBeFocused()
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["New song"])

    // Typed, and Record clicked straight away: the name reaches Python
    // before the take starts, and the take is recorded under it.
    await field(page).fill("  Another one  ")
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Another one" })).toBeVisible()
    const log = await order(page)
    expect(log.lastIndexOf("set_next_take_name")).toBeLessThan(log.lastIndexOf("start_take"))
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Another one"])
  })

  test("a name of its own, left and come back to, still has every song under it", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    const before = await songs(page).locator("[data-song-choice]").count()

    await field(page).fill("Another one")
    await page.keyboard.press("Enter")
    await expect
      .poll(async () => (await calls(page, "set_next_take_name")).at(-1)?.args)
      .toEqual(["Another one"])

    // Come back to it, without retyping: narrowed from what the field held
    // the first time it got focus, not from the name it settled on.
    await field(page).click()
    await expect(songs(page).locator("[data-song-choice]")).toHaveCount(before)
  })

  test("typing a name nothing matches moves neither the field nor Record", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    const record = page.getByRole("button", { name: /Record take 1/ })
    const fieldAt = (await field(page).boundingBox())!
    const recordAt = (await record.boundingBox())!
    const near = (b: { x: number; y: number }, at: { x: number; y: number }) => {
      expect(Math.abs(b.x - at.x)).toBeLessThan(1)
      expect(Math.abs(b.y - at.y)).toBeLessThan(1)
    }

    // The songs area holds the height it had when focus arrived, so the
    // list emptying out as the name narrows it moves nothing beside it.
    await field(page).fill("Something nobody has played")
    near((await field(page).boundingBox())!, fieldAt)
    near((await record.boundingBox())!, recordAt)

    // And filling again once the name is left does not move it back.
    await page.locator("main").click({ position: { x: 5, y: 5 } })
    near((await field(page).boundingBox())!, fieldAt)
    near((await record.boundingBox())!, recordAt)
  })

  test("a name Python does not take goes back to the one it has, and says so", async ({
    page,
  }) => {
    await openApp(page, {
      after:
        "window.pywebview.api.set_next_take_name = async () => " +
        "({ok: false, error: 'Could not name it'});",
    })
    await startRehearsal(page)
    await field(page).fill("Lost")
    await page.keyboard.press("Enter")
    await expect(field(page)).toHaveValue("Take 1")
    await expect(page.getByText("Could not name it")).toBeVisible()

    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Take 1" })).toBeVisible()
  })

  test("Space types, Escape leaves the field, and an emptied field gets its name back", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await field(page).fill("Polyn")
    await page.keyboard.press("Space")
    await page.keyboard.type("live")
    await expect(field(page)).toHaveValue("Polyn live")
    // Escape only leaves the field: it does not finish the rehearsal.
    await page.keyboard.press("Escape")
    await expect(field(page)).not.toBeFocused()
    expect(await callCount(page, "start_take")).toBe(0)
    expect(await callCount(page, "finish_rehearsal")).toBe(0)
    await expect(startButton(page)).toHaveCount(0)
    // What was typed was not lost on the way out.
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual(["Polyn live"])

    // Emptied, or left as spaces, it is never empty once left.
    await field(page).fill("   ")
    await page.locator("main").click({ position: { x: 5, y: 5 } })
    await expect(field(page)).toHaveValue("Take 1")
    expect((await calls(page, "set_next_take_name")).at(-1)?.args).toEqual([""])
  })
})

test.describe("after Stop", () => {
  test("the name is in the same field, in the same place, and ✕ puts back the one it would have had", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    const over = page.getByRole("textbox", { name: "Next take" })
    await over.fill("Vesna")
    await page.keyboard.press("Enter")
    const before = (await over.boundingBox())!
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(nameField(page)).toHaveValue("Vesna")
    const after = (await nameField(page).boundingBox())!
    expect(Math.abs(after.x - before.x)).toBeLessThan(2)
    expect(Math.abs(after.y - before.y)).toBeLessThan(2)
    // Over Save take, with a line between it and the buttons.
    await expect(page.locator("footer [data-footer-rule]")).toHaveCount(1)

    await page.getByRole("button", { name: "Put back “Take 1”" }).click()
    await expect(nameField(page)).toHaveValue("Take 1")
    await page.getByRole("button", { name: /Save take/ }).click()
    expect((await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Take 1")
  })
})
