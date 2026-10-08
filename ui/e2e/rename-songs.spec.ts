import {
  calls,
  callCount,
  expect,
  expectedError,
  notices,
  openApp,
  openHistory,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// Renaming a song, and merging it into another, from its page in History's
// Songs view (rename-and-merge-songs spec, R1-R7, D8). Against the fake's
// library: Pałyn is Tuesday jam's Pałyn 1 and Missing jam's Pałyn 8 and 9;
// Daroha is First rehearsal's and Missing jam's. PALYN adds Palyn 1 and 2 to
// First rehearsal, spelt without the ł.

const PALYN = `window.__EXTRA_SONGS__ = ["Palyn", "Palyn"]; window.__ACTIVITY__ = [];`

/** History's Songs view, with `title`'s page open. */
async function openSong(page: Page, title: string) {
  await openHistory(page)
  await page.getByRole("button", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator(`[data-song='${title}']`).click()
  await expect(head(page).getByRole("heading", { name: title, exact: true })).toBeVisible()
}

const head = (page: Page) => page.locator("[data-song-head]")
const dialog = (page: Page) => page.getByRole("dialog", { name: "Rename song" })
const titleField = (page: Page) => dialog(page).getByRole("textbox", { name: "Song title" })
const question = (page: Page) => page.getByRole("dialog", { name: /^Merge / })

/** Rename song, from the pencil beside the title. */
async function openRename(page: Page, title: string) {
  await head(page).getByRole("button", { name: `Rename song ${title}`, exact: true }).click()
  await expect(dialog(page)).toBeVisible()
}

/** How many times the interface has asked about background work. */
const activityPolls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ACTIVITY_POLLS__?: number }).__ACTIVITY_POLLS__ ?? 0)

/** Whether anything in the page is wider than its box. */
const sideways = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body, [role='dialog'], [role='region']")].some(
      (el) => el.scrollWidth > el.clientWidth + 1
    )
  )

test.describe("Rename song, from a song's page", () => {
  test("the pencil beside the title opens Rename song with the title in the field and the other songs without goes", async ({
    page,
  }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await expect(titleField(page)).toHaveValue("Palyn")
    await expect(titleField(page)).toBeFocused()
    await expect(
      dialog(page).getByText(
        "Every go is renamed, with its folder on disk and its copies in the cloud folder."
      )
    ).toBeVisible()
    const pills = dialog(page).locator("[data-song-choice]")
    await expect(pills.filter({ hasText: "Pałyn" })).toBeVisible()
    await expect(pills.filter({ hasText: "Daroha" })).toBeVisible()
    await expect(pills.filter({ hasText: /^Palyn/ })).toHaveCount(0)
    for (const pill of await pills.all()) await expect(pill).toHaveText(/^\D+$/)
    await expect(dialog(page).locator("[data-take-go]")).toHaveCount(0)
    // Nothing typed yet: nothing to rename to.
    await expect(dialog(page).getByRole("button", { name: "Rename", exact: true })).toBeDisabled()
  })

  test("a new title renames the song, its page shows it, and the background work says so", async ({
    page,
  }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Pałyn")
    await openRename(page, "Pałyn")
    await titleField(page).fill("Polyn")
    await expect(dialog(page).getByText("3 goes become Polyn.")).toBeVisible()
    await dialog(page).getByRole("button", { name: "Rename", exact: true }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(head(page).getByRole("heading", { name: "Polyn", exact: true })).toBeVisible()
    const list = page.getByRole("navigation", { name: "Songs" })
    await expect(list.locator("[data-song='Polyn']")).toBeVisible()
    await expect(list.locator("[data-song='Pałyn']")).toHaveCount(0)
    // The old title is remembered.
    await expect(head(page).locator("[data-old-names]")).toContainText("Pałyn")
    await page.locator("button[aria-label^='Background work']").click()
    await expect(page.getByText("Renaming Pałyn to Polyn · 3 takes")).toBeVisible()
    await expect(page.getByText("3 takes renamed").first()).toBeVisible()
  })

  for (const [state, how] of [
    ["done", "once the files have followed"],
    ["failed", "when the files followed only in part"],
  ] as const) {
    test(`${how}, the page reads its goes again, with their new folders`, async ({ page }) => {
      await openApp(page, { before: PALYN })
      await openSong(page, "Pałyn")
      await openRename(page, "Pałyn")
      await titleField(page).fill("Polyn")
      await dialog(page).getByRole("button", { name: "Rename", exact: true }).click()
      await expect(head(page).getByRole("heading", { name: "Polyn", exact: true })).toBeVisible()
      // Past what the rename itself set off; then the pass, finishing later.
      const polls = await activityPolls(page)
      await expect.poll(() => activityPolls(page)).toBeGreaterThanOrEqual(polls + 2)
      const read = await callCount(page, "get_song")
      await page.evaluate((state) => {
        const w = window as unknown as { __ACTIVITY__: Record<string, unknown>[] }
        w.__ACTIVITY__ = [
          ...w.__ACTIVITY__,
          { id: 990, kind: "names", title: "Renaming Pałyn to Polyn · 3 takes", folder: null,
            take_number: null, state, fraction: 1, step: null,
            error: state === "failed" ? "Could not rename 1 take" : null,
            detail: state === "done" ? "1 take renamed" : null, retry: null, seen: false },
        ]
      }, state)
      await expect.poll(() => callCount(page, "get_song")).toBeGreaterThan(read)
    })
  }

  test("a title typed and Rename pressed at its top edge: nothing moves under the pointer", async ({
    page,
  }) => {
    const songs = ["Palyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška", "Rečka", "Vieter", "Zorka"]
    await openApp(page, { before: `window.__EXTRA_SONGS__ = ${JSON.stringify(songs)};` })
    await openSong(page, "Pałyn")
    await openRename(page, "Pałyn")
    const rename = dialog(page).getByRole("button", { name: "Rename", exact: true })
    const tops = () =>
      dialog(page).evaluate((d) => {
        const all = [...d.querySelectorAll("[data-song-choice], [data-all-songs]")]
        return new Set(all.map((p) => Math.round(p.getBoundingClientRect().top))).size
      })
    await expect.poll(tops).toBe(2)
    // Once it has zoomed in.
    await expect.poll(() => dialog(page).evaluate((d) => d.getAnimations().length)).toBe(0)
    const before = (await dialog(page).boundingBox())!
    await titleField(page).fill("Polyn")
    // The songs narrow to none as it is typed; the dialog keeps its size.
    expect((await dialog(page).boundingBox())!.height).toBeCloseTo(before.height, 0)
    const at = (await rename.boundingBox())!
    await page.mouse.move(at.x + at.width / 2, at.y + 3)
    await page.mouse.down()
    expect((await rename.boundingBox())!.y).toBeCloseTo(at.y, 0)
    await page.mouse.up()
    await expect(head(page).getByRole("heading", { name: "Polyn", exact: true })).toBeVisible()
  })

  test("Enter in the field renames, as Rename does", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await titleField(page).fill("Polyn")
    await titleField(page).press("Enter")
    await expect(head(page).getByRole("heading", { name: "Polyn", exact: true })).toBeVisible()
    expect((await calls(page, "rename_song")).map((c) => c.args[1])).toEqual(["Polyn"])
  })

  test("a case-only change respells the song", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await titleField(page).fill("palyn")
    await expect(dialog(page).getByText("Spelled anew: the same song.")).toBeVisible()
    await dialog(page).getByRole("button", { name: "Rename", exact: true }).click()
    await expect(head(page).getByRole("heading", { name: "palyn", exact: true })).toBeVisible()
    expect(await callCount(page, "merge_songs")).toBe(0)
    // A respelling remembers nothing.
    await expect(head(page).locator("[data-old-names]")).toHaveCount(0)
  })

  test("a number at the end is part of the title", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await titleField(page).fill("Pałyn 5")
    await expect(dialog(page).getByText("2 goes become Pałyn 5.")).toBeVisible()
    await expect(dialog(page).getByRole("button", { name: "Rename", exact: true })).toBeEnabled()
  })

  test("a song's pill turns Rename into Merge, and the question names the counts", async ({
    page,
  }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await dialog(page).locator("[data-song-choice='Pałyn']").click()
    await expect(titleField(page)).toHaveValue("Pałyn")
    await expect(
      dialog(page).getByText("Pałyn is another song: Palyn's goes join it.")
    ).toBeVisible()
    await dialog(page).getByRole("button", { name: "Merge…", exact: true }).click()
    await expect(question(page)).toHaveAccessibleName("Merge Palyn into Pałyn?")
    await expect(question(page)).toContainText(
      "2 goes in 1 rehearsal become Pałyn 10–11, and their folders and cloud copies are renamed. To split them again, rename the takes one by one."
    )
    await expect(question(page).getByRole("button", { name: "Merge", exact: true })).toBeVisible()
    // Asked, not done: only the counts were read.
    expect((await calls(page, "merge_songs")).map((c) => Boolean(c.args[2]))).toEqual([true])
  })

  test("an old name of another song typed is a merge too", async ({ page }) => {
    await openApp(page, { before: PALYN + "window.__OLD_NAMES__ = [['Polyn', 'Pałyn']];" })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await titleField(page).fill("polyn")
    await expect(dialog(page).locator("[data-take-go]")).toHaveText(" → Pałyn")
    await expect(
      dialog(page).getByText("Pałyn is another song: Palyn's goes join it.")
    ).toBeVisible()
    await dialog(page).getByRole("button", { name: "Merge…", exact: true }).click()
    await expect(question(page)).toHaveAccessibleName("Merge Palyn into Pałyn?")
  })

  test("after a merge the page is the target song's, with every go, numbered after its own", async ({
    page,
  }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await dialog(page).locator("[data-song-choice='Pałyn']").click()
    await dialog(page).getByRole("button", { name: "Merge…", exact: true }).click()
    await question(page).getByRole("button", { name: "Merge", exact: true }).click()
    await expect(question(page)).toBeHidden()
    await expect(head(page).getByRole("heading", { name: "Pałyn", exact: true })).toBeVisible()
    await expect(head(page)).toContainText("5 goes in 3 rehearsals")
    const list = page.getByRole("navigation", { name: "Songs" })
    await expect(list.locator("[data-song='Palyn']")).toHaveCount(0)
    await page.locator("[data-rung='/rec/older']").click()
    const older = page.locator("[data-rung-group='/rec/older']")
    await expect(older.getByRole("button", { name: "Take 3 Pałyn 10" })).toBeVisible()
    await expect(older.getByRole("button", { name: "Take 4 Pałyn 11" })).toBeVisible()
    await expect(head(page).locator("[data-old-names]")).toContainText("Palyn")
    await page.locator("button[aria-label^='Background work']").click()
    await expect(page.getByText("Merging Palyn into Pałyn · 2 takes")).toBeVisible()
  })

  test("Cancel on the question changes nothing", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await dialog(page).locator("[data-song-choice='Pałyn']").click()
    await dialog(page).getByRole("button", { name: "Merge…", exact: true }).click()
    await question(page).getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(question(page)).toBeHidden()
    await expect(head(page).getByRole("heading", { name: "Palyn", exact: true })).toBeVisible()
    expect((await calls(page, "merge_songs")).every((c) => c.args[2] === true)).toBe(true)
    expect(await callCount(page, "rename_song")).toBe(0)
  })

  test("a title of a song with no goes left asks the merge question", async ({ page }) => {
    await openApp(page, { before: "window.__TAKELESS_SONGS__ = ['Old'];" })
    await openSong(page, "Pałyn")
    await openRename(page, "Pałyn")
    // Not in the Songs list, so not a pill either: the dialog says Rename.
    await titleField(page).fill("Old")
    await expect(dialog(page).getByText("3 goes become Old.")).toBeVisible()
    await dialog(page).getByRole("button", { name: "Rename", exact: true }).click()
    await expect(question(page)).toHaveAccessibleName("Merge Pałyn into Old?")
    await expect(question(page)).toContainText("3 goes in 2 rehearsals become Old 1–3")
    expect((await calls(page, "merge_songs")).map((c) => Boolean(c.args[2]))).toEqual([true])
    await question(page).getByRole("button", { name: "Merge", exact: true }).click()
    await expect(head(page).getByRole("heading", { name: "Old", exact: true })).toBeVisible()
  })

  test("Take 4 is refused with its reason", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await titleField(page).fill("Take 4")
    await expect(
      dialog(page).getByText("Take 4 is what a take with no song is called")
    ).toBeVisible()
    await expect(dialog(page).getByRole("button", { name: "Rename", exact: true })).toBeDisabled()
    await titleField(page).press("Enter")
    await expect(dialog(page)).toBeVisible()
    expect(await callCount(page, "rename_song")).toBe(0)
  })

  test("playback stops before a rename", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Pałyn")
    await head(page).getByRole("button", { name: "Play Pałyn 1" }).click()
    await expect(head(page).getByRole("button", { name: "Pause Pałyn 1" })).toBeVisible()
    await openRename(page, "Pałyn")
    await titleField(page).fill("Polyn")
    await dialog(page).getByRole("button", { name: "Rename", exact: true }).click()
    await expect(head(page).getByRole("button", { name: "Play Polyn 1" })).toBeVisible()
    const all = await page.evaluate(
      () => (window as unknown as { __CALLS__: { name: string }[] }).__CALLS__.map((c) => c.name)
    )
    const renamed = all.indexOf("rename_song")
    expect(all.slice(all.lastIndexOf("player_play"), renamed)).toContain("player_close")
  })

  test("a case-only Take 4 is a title like any other, as Python has it", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Palyn")
    await openRename(page, "Palyn")
    await titleField(page).fill("take 4")
    await expect(dialog(page).getByText("2 goes become take 4.")).toBeVisible()
    await expect(dialog(page).getByRole("button", { name: "Rename", exact: true })).toBeEnabled()
  })

  test("playback stops before a merge", async ({ page }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Pałyn")
    await head(page).getByRole("button", { name: "Play Pałyn 1" }).click()
    await expect(head(page).getByRole("button", { name: "Pause Pałyn 1" })).toBeVisible()
    await openRename(page, "Pałyn")
    await dialog(page).locator("[data-song-choice='Daroha']").click()
    await dialog(page).getByRole("button", { name: "Merge…", exact: true }).click()
    await question(page).getByRole("button", { name: "Merge", exact: true }).click()
    await expect(head(page).getByRole("heading", { name: "Daroha", exact: true })).toBeVisible()
    const all = await page.evaluate(() =>
      (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__.map(
        (c) => `${c.name}${c.name === "merge_songs" && c.args[2] ? ":asked" : ""}`
      )
    )
    const merged = all.indexOf("merge_songs")
    expect(all.slice(all.lastIndexOf("player_play"), merged)).toContain("player_close")
  })

  test("a name that cannot be forgotten says so, and stays", async ({ page, pageErrors }) => {
    await openApp(page, {
      before:
        "window.__OLD_NAMES__ = [['Palyn', 'Pałyn']]; window.__FAIL__ = {forget_song_name: 'database is locked'};",
    })
    await openSong(page, "Pałyn")
    const old = head(page).locator("[data-old-names]")
    await old.getByRole("button", { name: "Forget Palyn", exact: true }).click()
    await expect(notices(page, "error").filter({ hasText: "Could not forget Palyn" })).toBeVisible()
    await expect(old.getByRole("button", { name: "Forget Palyn", exact: true })).toBeVisible()
    expectedError(pageErrors, /forget_song_name failed/)
  })

  test("Also typed as lists the old names, and the cross forgets one", async ({ page }) => {
    await openApp(page, { before: "window.__OLD_NAMES__ = [['Palyn', 'Pałyn'], ['Polyn', 'Pałyn']];" })
    await openSong(page, "Pałyn")
    const old = head(page).locator("[data-old-names]")
    await expect(old).toHaveText(/Also typed as\s*Palyn\s*Polyn/)
    const forget = old.getByRole("button", { name: "Forget Palyn", exact: true })
    await expect(forget).toHaveAttribute("title", "Forget Palyn: typed again, it is a new song")
    await forget.click()
    await expect(old.getByRole("button", { name: "Forget Palyn", exact: true })).toHaveCount(0)
    await expect(old).toContainText("Polyn")
    expect((await calls(page, "forget_song_name")).map((c) => c.args[0])).toEqual(["Palyn"])
    await old.getByRole("button", { name: "Forget Polyn", exact: true }).click()
    await expect(old).toHaveCount(0)
  })

  test("a 960 px window with a 60-character title and twelve old names scrolls nothing sideways", async ({
    page,
  }) => {
    const LONG = "Kalychanka for long winter nights when the river lies frozen"
    const olds = Array.from({ length: 12 }, (_, i) => [`Kalychanka spelt another way ${i + 1}`, LONG])
    await page.setViewportSize({ width: 960, height: 720 })
    await openApp(page, {
      before: `window.__EXTRA_SONGS__ = ${JSON.stringify([LONG])}; window.__OLD_NAMES__ = ${JSON.stringify(olds)};`,
    })
    await openSong(page, LONG)
    await expect(head(page).locator("[data-old-names]")).toContainText("another way 12")
    expect(await sideways(page)).toBe(false)
    await openRename(page, LONG)
    expect(await sideways(page)).toBe(false)
    await dialog(page).locator("[data-song-choice='Pałyn']").click()
    await expect(
      dialog(page).getByText(`Pałyn is another song: ${LONG}'s goes join it.`)
    ).toBeVisible()
    expect(await sideways(page)).toBe(false)
    await dialog(page).getByRole("button", { name: "Merge…", exact: true }).click()
    await expect(question(page)).toBeVisible()
    expect(await sideways(page)).toBe(false)
  })

  test("up, down and Space in the dialog's field do not change the song or play", async ({
    page,
  }) => {
    await openApp(page, { before: PALYN })
    await openSong(page, "Pałyn")
    await openRename(page, "Pałyn")
    const songs = await callCount(page, "get_song")
    await titleField(page).press("ArrowDown")
    await titleField(page).press("ArrowUp")
    await titleField(page).press("Space")
    // ↑ took the caret to the start of the title, as in any text field.
    await expect(titleField(page)).toHaveValue(" Pałyn")
    expect(await callCount(page, "player_play")).toBe(0)
    expect(await callCount(page, "get_song")).toBe(songs)
    await page.keyboard.press("Escape")
    await expect(dialog(page)).toBeHidden()
    await expect(head(page).getByRole("heading", { name: "Pałyn", exact: true })).toBeVisible()
  })
})
