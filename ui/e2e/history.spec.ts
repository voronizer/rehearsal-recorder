import {
  callCount,
  calls,
  expect,
  openApp,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

test("finishing a rehearsal with takes in it asks, and is answered from the keyboard", async ({
  page,
}) => {
  // On the rehearsal screen the ladder is the open take, then the rehearsal
  // itself — and with takes in it, that rung is a decision and asks.
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
  await page.fill("#take-name", "Polyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.locator("button[aria-label^='Take 1 Polyn']").click()
  const timeline = page.getByRole("group", { name: "Take timeline" })
  await expect(timeline).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(timeline).toHaveCount(0)

  const finishes = await callCount(page, "finish_rehearsal")
  const question = page.getByText("Finish this rehearsal?")
  await page.keyboard.press("Escape")
  await expect(question).toBeVisible()
  // And still there a moment later: a dialog opened by a keydown still on
  // its way through the page can be dismissed by that same keydown, which
  // looks like a flicker. Waiting for it to appear cannot see that.
  await page.waitForTimeout(300)
  await expect(question).toHaveCount(1)
  expect(await callCount(page, "finish_rehearsal")).toBe(finishes)

  // Answered without the mouse. It opens on the answer that changes
  // nothing, and getting to the other one is the app's doing, not the
  // browser's: the window the app runs in on a Mac moves focus on Tab only
  // with macOS keyboard navigation on, so the arrows carry the weight.
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? "")
  expect(await focused()).toBe("Keep going")
  await page.keyboard.press("ArrowRight")
  await expect.poll(focused).toBe("Finish")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(focused).toBe("Keep going")
  // Tab is taken over too, watched from the capture phase on window, where
  // the app takes the key and stops it.
  await page.evaluate(() => {
    const w = window as unknown as { __TAB_TAKEN__: boolean | null }
    w.__TAB_TAKEN__ = null
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Tab") w.__TAB_TAKEN__ = e.defaultPrevented
      },
      true
    )
  })
  await page.keyboard.press("Tab")
  await expect.poll(focused).toBe("Finish")
  expect(await page.evaluate(() => (window as unknown as { __TAB_TAKEN__: boolean }).__TAB_TAKEN__)).toBe(true)

  await page.keyboard.press("Escape")
  await expect(question).toHaveCount(0)
  expect(await callCount(page, "finish_rehearsal")).toBe(finishes)
})

test.describe("History", () => {
  test("opens a rehearsal and its takes, and Escape goes back a layer at a time", async ({
    page,
  }) => {
    await openApp(page)
    await page.getByText("History").click()
    await page.getByText("Tuesday jam").click()
    await page.getByRole("button", { name: "Take 1 Polyn", exact: true }).click()
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    // A ten-minute take gets a clock in minutes.
    await expect(page.getByRole("group", { name: "Timeline clock" })).toContainText("2:00")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("group", { name: "Take timeline" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Take 1 Polyn", exact: true })).toHaveCount(1)
    await page.keyboard.press("Escape")
    await expect(page.getByText("Wednesday jam")).toBeVisible()
    await expect(page.getByRole("button", { name: "Take 1 Polyn", exact: true })).toHaveCount(0)
  })

  test("says in each row what was rehearsed, how long, and how much disk", async ({ page }) => {
    // Months later a rehearsal is recognised by what was played in it. A long
    // list is cut off: the row has to be readable at a glance.
    await openApp(page)
    await page.getByText("History").click()
    const named = page.locator("button", { hasText: "Tuesday jam" }).first()
    const quiet = page.locator("button", { hasText: "Wednesday jam" }).first()
    await expect(named).toContainText("Polyn ×3 · Vesna ×2 · Ogon · Sonce · and 2 more")
    await expect(named).toContainText("10 Sep 2026, 19:00 · 42 min · 1.2 GB")
    // Takes the app named itself are not songs, and there is nothing
    // truthful to put on that line — so the line is not there.
    expect((await quiet.innerText()).trim().split("\n")).toHaveLength(3)
  })

  test("deleting a rehearsal says what it frees and that its cloud copies go", async ({ page }) => {
    await openApp(page)
    await page.getByText("History").click()
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("goes to the Trash")
    // The space is the reason people delete a rehearsal at all.
    await expect(page.getByText("9 takes, 1.2 GB")).toHaveCount(1)
    await expect(dialog).toContainText("So do the copies of 3 of them in the cloud folder.")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toHaveCount(0)
    expect(await callCount(page, "delete_rehearsal")).toBe(0)
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
    await page.getByRole("dialog").locator("button", { hasText: "Delete" }).last().click()
    await expect.poll(() => callCount(page, "delete_rehearsal")).toBe(1)
  })
})

// History, and an open rehearsal with no take picked: the evening at a
// glance, and each go at a song as a row.

async function openEvening(page: Page) {
  await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
  await page.getByText("History").click()
  await page.getByText("Tuesday jam").click()
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

const current = (page: Page) => page.locator("button[aria-current='true']")

test("an open rehearsal with no take picked shows the evening", async ({ page }) => {
  // It used to be one lonely "Pick a take" under the strip. What was played,
  // how many goes each song got and every note left while listening are all
  // known already, and are what you came back for.
  const overview = await openEvening(page)
  const said = await overview.innerText()
  for (const part of [
    "11:50\nplayed",
    "4\ntakes",
    "2\nsongs",
    "1 of 4\nin the cloud",
    "Polyn",
    "2 goes",
    "Vesna",
    "1 keep this",
    "1 went wrong",
    "Not named",
    "this one is the take",
    "guitar drifts here",
  ]) {
    expect(said).toContain(part)
  }
  // A plain mark with nothing written is not a note.
  await expect(overview.locator("[data-note]")).toHaveCount(2)
  await expect(page.getByText("Pick a take")).toHaveCount(0)
  // Only the take already in the cloud folder says so on its row.
  await expect(page.locator("[data-take='2'] [data-in-cloud]")).toHaveCount(1)
  await expect(overview.locator("[data-in-cloud]")).toHaveCount(1)
  // Every go on one scale: the four-minute Vesna is the longest bar.
  const widths = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-take]")].map((r) => [
        r.dataset.take,
        r.querySelector('button[aria-label^="Take "]')!.getBoundingClientRect().width,
      ])
    )
  )
  expect(widths["4"]).toBeGreaterThan(widths["1"])
  expect(widths["1"]).toBeGreaterThan(widths["3"])
  // And no strip of pills repeating it.
  await expect(page.getByRole("group", { name: "Take strip" })).toHaveCount(0)
})

test("a note opens its take at the spot it was left", async ({ page }) => {
  const overview = await openEvening(page)
  await overview.getByText("guitar drifts here").click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  await expect(current(page)).toContainText("Vesna")
  await expect
    .poll(async () => (await calls(page, "player_seek")).at(-1)?.args[0] as number)
    .toBeCloseTo(40, 0)
  // The overview makes way for the player, and the strip is back, to switch
  // takes without going back.
  await expect(overview).toHaveCount(0)
  await expect(page.getByRole("group", { name: "Take strip" })).toHaveCount(1)
})

test("a take opened from the overview can be deleted, and says its cloud copy goes too", async ({
  page,
}) => {
  const overview = await openEvening(page)
  await overview.getByRole("button", { name: "Take 2 Polyn 2" }).click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  await expect(current(page)).toContainText("Polyn 2")
  await page.getByRole("button", { name: "Delete take Polyn 2" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("go to the Trash")
  await expect(dialog).toContainText("Its copy in the cloud folder goes too.")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  expect(await callCount(page, "delete_take")).toBe(0)
})

test("the whole of a take's row opens it, not only its bar", async ({ page }) => {
  // A short take's bar is a small thing to aim at, and the row lights up
  // under the mouse all the way across.
  const overview = await openEvening(page)
  const opens = async (x: number, y: number) => {
    await page.mouse.click(x, y)
    await expect(current(page)).toContainText("Take 3")
    await page.keyboard.press("Escape")
    await expect(overview).toBeVisible()
  }
  // Beside the actions, where a short take's row is empty.
  const past = await page.evaluate(() => {
    const row = document.querySelector("[data-take='3'] > div")!
    const actions = row.lastElementChild!.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return { x: actions.left - 6, y: r.top + r.height / 2 }
  })
  await opens(past.x, past.y)
  // And on its length.
  const length = await page.locator("[data-take='3'] > div span.tnum.shrink-0").first().boundingBox()
  await opens(length!.x + length!.width / 2, length!.y + length!.height / 2)
})

test("a take plays from its row, and on in the player and back", async ({ page }) => {
  const overview = await openEvening(page)
  const opens = await callCount(page, "player_open")
  await overview.getByRole("button", { name: "Play Vesna" }).click()
  await expect(page.getByRole("button", { name: "Pause Vesna" })).toBeVisible()
  // Right there, with no player on screen, and how far it has got beside
  // its bar.
  expect(await callCount(page, "player_open")).toBe(opens + 1)
  await expect(page.locator("[aria-label='Take timeline']")).toHaveCount(0)
  await expect(page.locator("[data-take='4']")).toContainText("/ 4:10")

  // Space pauses it, though the mouse pressed Play.
  await page.keyboard.press("Space")
  await expect(page.getByRole("button", { name: "Play Vesna" })).toBeVisible()
  await page.keyboard.press("Space")
  await expect(page.getByRole("button", { name: "Pause Vesna" })).toBeVisible()

  // Its bar opens it in the player without opening it again, and it carries
  // on playing there.
  await overview.getByRole("button", { name: "Take 4 Vesna" }).click()
  await expect(page.locator("[aria-label='Take timeline']")).toBeVisible()
  expect(await callCount(page, "player_open")).toBe(opens + 1)
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(1)

  // Back in the overview it plays on, and Escape stops it and puts it away.
  await page.keyboard.press("Escape")
  await expect(overview).toBeVisible()
  await expect(page.getByRole("button", { name: "Pause Vesna" })).toHaveCount(1)
  const closes = await callCount(page, "player_close")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Play Vesna" })).toBeVisible()
  expect(await callCount(page, "player_close")).toBeGreaterThan(closes)
  await expect(overview).toHaveCount(1)
})

test("a row's own buttons work on its take without opening it", async ({ page }) => {
  const overview = await openEvening(page)
  await page.hover("[data-take='1']")
  await page.getByRole("button", { name: "Rename take Polyn", exact: true }).click()
  await expect(page.getByText("Rename take")).toBeVisible()
  await expect(page.locator("[aria-label='Take timeline']")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // The next Escape leaves the rehearsal.
  await page.keyboard.press("Escape")
  await expect(page.getByText("Tuesday jam").first()).toBeVisible()
  await expect(overview).toHaveCount(0)
})

test.describe("a rehearsal whose folder is gone", () => {
  const missing = (page: Page) => page.locator(".rounded-xl", { hasText: "Missing jam" }).first()

  test("is marked, does not open, and can be found again", async ({ page }) => {
    await openApp(page)
    await page.getByText("History").click()
    const row = missing(page)
    await expect(row.getByText("Not found on disk")).toHaveCount(1)
    await expect(page.getByText("Not found on disk")).toHaveCount(1)
    // Its info area is marked not to be pressed, and pressing it opens
    // nothing.
    const info = row.locator("[aria-disabled='true']")
    await expect(info).toHaveCount(1)
    await info.click()
    await row.getByRole("button", { name: "Locate folder…" }).click()
    await expect.poll(() => callCount(page, "choose_rehearsal_folder")).toBe(1)
    expect(await callCount(page, "get_rehearsal")).toBe(0)
    expect((await calls(page, "choose_rehearsal_folder"))[0].args[0]).toBe("/rec/gone")
    // Found, it drops off the missing list.
    await expect(page.getByText("Not found on disk")).toHaveCount(0)
  })

  test("stays as it was when the folder dialog is cancelled, and can be forgotten", async ({
    page,
  }) => {
    await openApp(page, { before: "window.__CANCEL_LOCATE__ = true;" })
    await page.getByText("History").click()
    await missing(page).getByRole("button", { name: "Locate folder…" }).click()
    await expect.poll(() => callCount(page, "choose_rehearsal_folder")).toBe(1)
    await expect(page.getByText("Not found on disk")).toHaveCount(1)

    await missing(page).getByRole("button", { name: "Remove from history" }).click()
    await expect(page.getByText("Only the entry goes")).toBeVisible()
    // It asks before removing anything; confirmed, only the entry goes.
    expect(await callCount(page, "forget_rehearsal")).toBe(0)
    await page.getByRole("button", { name: "Remove", exact: true }).click()
    await expect.poll(() => callCount(page, "forget_rehearsal")).toBe(1)
    expect((await calls(page, "forget_rehearsal"))[0].args[0]).toBe("/rec/gone")
    await expect(page.getByText("Missing jam")).toHaveCount(0)
  })
})
