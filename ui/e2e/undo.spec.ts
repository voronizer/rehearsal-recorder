import {
  callCount,
  calls,
  dragRegion,
  expect,
  expectedError,
  nameTake,
  notices,
  openApp,
  openHistory,
  problemBar,
  recordTake,
  setFake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// Removing something happens at once (spec B1): deleting a take or a
// rehearsal, clearing false starts, discarding a take and cropping one ask
// nothing, and a notice offers it back for ten seconds, with Undo or Ctrl+Z
// (Cmd+Z on a Mac). Python keeps what went until the notice ends; the fake
// keeps it in window.__UNDOABLE__, by the token its Undo sends back.

const MAC = "Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});"
const WINDOWS = "Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});"

/** The tokens of the removals waiting for their Undo, in the fake. */
const waiting = (page: Page) =>
  page.evaluate(() => Object.keys((window as unknown as { __UNDOABLE__: object }).__UNDOABLE__))

const row = (overview: Locator, n: number) => overview.locator(`[data-take="${n}"]`)

/** The notice whose words are exactly `text`. */
const said = (page: Page, text: string) =>
  notices(page).filter({ has: page.locator("p", { hasText: new RegExp(`^${escape(text)}$`) }) })

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** History on Tuesday jam, four takes long, with Pałyn 2 starred. */
async function tuesday(page: Page, before = "") {
  await openApp(page, {
    before: `window.__FULL_EVENING__ = true; window.__STARRED__ = ['/rec/old#2']; ${before}`,
  })
  await openHistory(page)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

/** The 🗑 on a take's row, which used to ask. */
async function deleteTake(overview: Locator, n: number, name: string) {
  await row(overview, n).hover()
  await row(overview, n).getByRole("button", { name: `Delete take ${name}` }).click()
}

/** Tuesday jam renamed in History, which moves its folder to /rec/{name}. */
async function renameTuesday(page: Page, name: string) {
  await page.getByRole("button", { name: "Rename rehearsal Tuesday jam" }).click()
  const dialog = page.getByRole("dialog", { name: "Rename rehearsal" })
  await dialog.locator("input").fill(name)
  await dialog.getByRole("button", { name: "Rename" }).click()
  await expect(page.getByRole("button", { name: `Delete rehearsal ${name}` })).toBeVisible()
}

/** A rehearsal started with takes in it already, on its screen. */
async function tonight(page: Page, takes: object[], before = "") {
  await openApp(page, { before: `window.__TONIGHT__ = ${JSON.stringify(takes)}; ${before}` })
  await startRehearsal(page, takes.length + 1)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

/** Holds every answer of session_state until releaseSession: the read
 *  App makes after a take is discarded, still on its way. */
async function holdSession(page: Page) {
  await page.evaluate(() => {
    type W = {
      pywebview: { api: Record<string, (...a: unknown[]) => Promise<unknown>> }
      __REAL_SESSION__?: (...a: unknown[]) => Promise<unknown>
      __LET_SESSION_GO__?: () => void
    }
    const w = window as unknown as W
    const real = w.pywebview.api.session_state
    w.__REAL_SESSION__ = real
    const gate = new Promise<void>((go) => (w.__LET_SESSION_GO__ = go))
    w.pywebview.api.session_state = async (...a: unknown[]) => {
      await gate
      return real(...a)
    }
  })
}

async function releaseSession(page: Page) {
  await page.evaluate(() => {
    type W = {
      pywebview: { api: Record<string, unknown> }
      __REAL_SESSION__: unknown
      __LET_SESSION_GO__: () => void
    }
    const w = window as unknown as W
    w.pywebview.api.session_state = w.__REAL_SESSION__
    w.__LET_SESSION_GO__()
  })
}

const TWO = [
  { name: "Pałyn", duration_sec: 200 },
  { name: "Viasna", duration_sec: 180 },
]

test("deleting a take in History asks nothing, and Undo brings it back with its star", async ({
  page,
}) => {
  const overview = await tuesday(page)
  const star = overview.getByRole("button", { name: "Star Pałyn 2" })
  await expect(star).toHaveAttribute("aria-pressed", "true")
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(row(overview, 2)).toHaveCount(0)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect((await calls(page, "delete_take")).map((c) => c.args)).toEqual([["/rec/old", 2]])

  const notice = said(page, "“Pałyn 2” went to the Trash.")
  await expect(notice).toHaveCount(1)
  await notice.getByRole("button", { name: "Undo" }).click()
  await expect(overview.getByRole("button", { name: /^Take 2 Pałyn 2/ })).toBeVisible()
  await expect(star).toHaveAttribute("aria-pressed", "true")
  await expect(notice).toHaveCount(0)
  expect(await callCount(page, "undo_trash")).toBe(1)
  // Brought back, it is not sent on to the Trash when its notice would have
  // ended.
  expect(await callCount(page, "end_trash")).toBe(0)
})

test("Ctrl+Z brings a take back as Undo does", async ({ page }) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(row(overview, 2)).toHaveCount(0)
  await page.keyboard.press("Control+z")
  await expect(overview.getByRole("button", { name: /^Take 2 Pałyn 2/ })).toBeVisible()
  await expect(notices(page)).toHaveCount(0)
})

test("on a Mac Cmd+Z brings it back, and Ctrl+Z does not", async ({ page }) => {
  const overview = await tuesday(page, MAC)
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(row(overview, 2)).toHaveCount(0)
  // The key on the button is the Mac's.
  await expect(said(page, "“Pałyn 2” went to the Trash.").locator("kbd")).toHaveText("⌘Z")
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(200)
  expect(await callCount(page, "undo_trash")).toBe(0)
  await page.keyboard.press("Meta+z")
  await expect(overview.getByRole("button", { name: /^Take 2 Pałyn 2/ })).toBeVisible()
})

test("Ctrl+Z in the take name field is the field's own", async ({ page }) => {
  const overview = await tonight(page, TWO)
  await deleteTake(overview, 1, "Pałyn 1")
  await expect(row(overview, 1)).toHaveCount(0)
  await expect(said(page, "“Pałyn 1” went to the Trash.")).toHaveCount(1)
  await page.locator("#next-take-name").click()
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(200)
  expect(await callCount(page, "undo_trash")).toBe(0)
  await expect(row(overview, 1)).toHaveCount(0)
  // Out of the field, the key is Undo's again.
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+z")
  await expect(row(overview, 1)).toBeVisible()
})

test("two deletions: Ctrl+Z brings back the second, and the first still offers Undo", async ({
  page,
}) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 1, "Pałyn 1")
  await expect(row(overview, 1)).toHaveCount(0)
  await deleteTake(overview, 3, "Take 3")
  await expect(row(overview, 3)).toHaveCount(0)
  await page.mouse.move(10, 10)
  await page.keyboard.press("Control+z")
  await expect(row(overview, 3)).toBeVisible()
  await expect(row(overview, 1)).toHaveCount(0)
  const first = said(page, "“Pałyn 1” went to the Trash.")
  await expect(first.getByRole("button", { name: "Undo" })).toBeVisible()
  await expect(said(page, "“Take 3” went to the Trash.")).toHaveCount(0)
  await page.keyboard.press("Control+z")
  await expect(row(overview, 1)).toBeVisible()
})

test.describe("ten seconds", () => {
  test("the notice is there at 9 s, gone at 11 s, and what went is sent on", async ({ page }) => {
    await page.clock.install()
    const overview = await tuesday(page)
    await deleteTake(overview, 2, "Pałyn 2")
    const notice = said(page, "“Pałyn 2” went to the Trash.")
    await expect(notice).toHaveCount(1)
    await page.mouse.move(10, 10)
    const tokens = await waiting(page)
    expect(tokens).toHaveLength(1)

    await page.clock.fastForward(9000)
    await expect(notice).toHaveCount(1)
    expect(await callCount(page, "end_trash")).toBe(0)
    await page.clock.fastForward(2000)
    await expect(notice).toHaveCount(0)
    await expect
      .poll(async () => (await calls(page, "end_trash")).map((c) => c.args))
      .toEqual([tokens])
    expect(await waiting(page)).toEqual([])
    await expect(row(overview, 2)).toHaveCount(0)
  })

  test("hovered at 9 s, Undo is still offered past 11 s", async ({ page }) => {
    await page.clock.install()
    const overview = await tuesday(page)
    await deleteTake(overview, 2, "Pałyn 2")
    const notice = said(page, "“Pałyn 2” went to the Trash.")
    await page.mouse.move(10, 10)
    await page.clock.fastForward(9000)
    await notice.hover()
    await page.clock.fastForward(3000)
    await expect(notice).toHaveCount(1)
    expect(await callCount(page, "end_trash")).toBe(0)
    await page.mouse.move(10, 10)
    await page.clock.fastForward(11000)
    await expect(notice).toHaveCount(0)
    await expect.poll(() => callCount(page, "end_trash")).toBe(1)
  })
})

test("clearing false starts asks nothing, and Undo brings them all back", async ({ page }) => {
  const overview = await tonight(page, [
    { name: "Pałyn", duration_sec: 200 },
    { name: "Pałyn", duration_sec: 12 },
    { name: "Take 3", duration_sec: 8 },
  ])
  const clear = overview.getByRole("button", { name: /Clear false starts/ })
  await expect(clear).toHaveText(/Clear false starts\s*2/)
  await clear.click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(row(overview, 2)).toHaveCount(0)
  await expect(row(overview, 3)).toHaveCount(0)
  expect((await calls(page, "delete_takes")).at(-1)?.args[1]).toEqual([2, 3])
  const notice = said(page, "2 false starts went to the Trash.")
  await notice.getByRole("button", { name: "Undo" }).click()
  await expect(row(overview, 2)).toBeVisible()
  await expect(row(overview, 3)).toBeVisible()
  await expect(clear).toHaveText(/Clear false starts\s*2/)
})

test("one false start cleared is said as one", async ({ page }) => {
  const overview = await tonight(page, [
    { name: "Pałyn", duration_sec: 200 },
    { name: "Take 2", duration_sec: 8 },
  ])
  await overview.getByRole("button", { name: /Clear false starts/ }).click()
  await expect(said(page, "1 false start went to the Trash.")).toHaveCount(1)
})

test.describe("on the screen after a take", () => {
  const title = (page: Page) => page.locator("[data-take-summary]")

  test("Esc leaves it, and Undo opens it again as it was left", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await nameTake(page, "Sonca")
    await expect(title(page)).toHaveText("Sonca 1")
    await page.getByRole("button", { name: "Add mark" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("button", { name: /^Remove mark at/ })).toHaveCount(1)

    await page.keyboard.press("Escape")
    await expect(title(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
    expect(await callCount(page, "discard_take")).toBe(1)
    await said(page, "“Sonca 1” went to the Trash.").getByRole("button", { name: "Undo" }).click()

    await expect(title(page)).toHaveText("Sonca 1")
    await expect(page.getByRole("button", { name: /^Remove mark at/ })).toHaveCount(1)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect.poll(() => callCount(page, "keep_take")).toBe(1)
    const kept = (await calls(page, "keep_take"))[0].args
    expect(kept[2]).toBe("Sonca")
    expect(kept[5]).toHaveLength(1)
  })

  test("Undo after the rehearsal was renamed opens the take where the rename moved it", async ({
    page,
  }) => {
    // The draft is in the rehearsal's own folder, as Python keeps it, and
    // a rename moves it, its files with it.
    await openApp(page, { before: "window.__DRAFTS_IN_REHEARSAL__ = true;" })
    await startRehearsal(page)
    await recordTake(page)
    await nameTake(page, "Sonca")
    await page.keyboard.press("Escape")
    await expect(title(page)).toHaveCount(0)
    await page.getByRole("button", { name: "Rename rehearsal" }).click()
    const dialog = page.getByRole("dialog", { name: "Rename rehearsal" })
    await dialog.locator("input").fill("Tuesday blues")
    await dialog.getByRole("button", { name: "Rename" }).click()
    await expect(dialog).toHaveCount(0)

    await said(page, "“Sonca 1” went to the Trash.").getByRole("button", { name: "Undo" }).click()
    await expect(title(page)).toHaveText("Sonca 1")
    // Its tracks are read from where they are now, and play.
    const play = page.getByRole("button", { name: "Play", exact: true })
    await expect(play).toBeEnabled()
    await expect(page.getByText("Track file not found")).toHaveCount(0)
    await play.click()
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
  })

  test("starting the next take ends the offer, and the take goes on to the Trash", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: /^Discard/ }).click()
    const notice = said(page, "“Take 1” went to the Trash.")
    await expect(notice).toHaveCount(1)
    const tokens = await waiting(page)
    await page.getByRole("button", { name: /Record take 2/ }).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    await expect(notice).toHaveCount(0)
    await expect
      .poll(async () => (await calls(page, "end_trash")).map((c) => c.args))
      .toEqual([tokens])
  })

  test("finishing the rehearsal ends the offer too", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await page.getByRole("button", { name: /^Discard/ }).click()
    const notice = said(page, "“Take 1” went to the Trash.")
    await expect(notice).toHaveCount(1)
    await page.getByRole("button", { name: /^Finish/ }).click()
    await expect(page.getByRole("button", { name: /Start rehearsal/ })).toBeVisible()
    await expect(notice).toHaveCount(0)
    await expect.poll(() => callCount(page, "end_trash")).toBe(1)
  })

  test("a crop's Undo gives back the take and the marks it cut off", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    // A mark at the start, outside the part kept.
    await page.getByRole("button", { name: "Add mark" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("button", { name: /^Remove mark at/ })).toHaveCount(1)

    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.locator("span", { hasText: "/ 0:03" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: /^Remove mark at/ })).toHaveCount(0)
    const notice = said(page, "“Take 1” is cropped. The uncut take went to the Trash.")
    await notice.getByRole("button", { name: "Undo" }).click()
    await expect(page.locator("span", { hasText: "/ 0:06" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: /^Remove mark at/ })).toHaveCount(1)
  })

  test("saving the take ends its crop's offer", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    const notice = said(page, "“Take 1” is cropped. The uncut take went to the Trash.")
    await expect(notice).toHaveCount(1)
    const tokens = await waiting(page)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
    await expect(notice).toHaveCount(0)
    await expect
      .poll(async () => (await calls(page, "end_trash")).map((c) => c.args))
      .toEqual([tokens])
  })

  test("discarding the take ends its crop's offer", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    const cropped = said(page, "“Take 1” is cropped. The uncut take went to the Trash.")
    await expect(cropped).toHaveCount(1)
    const [crop] = await waiting(page)
    await page.getByRole("button", { name: /^Discard/ }).click()
    await expect(said(page, "“Take 1” went to the Trash.")).toHaveCount(1)
    await expect(cropped).toHaveCount(0)
    await expect
      .poll(async () => (await calls(page, "end_trash")).map((c) => c.args))
      .toEqual([[crop]])
  })

  test("a save that fails keeps the crop's offer", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    const cropped = said(page, "“Take 1” is cropped. The uncut take went to the Trash.")
    await expect(cropped).toHaveCount(1)
    await page.evaluate(() => {
      const w = window as unknown as { pywebview: { api: Record<string, unknown> } }
      w.pywebview.api.keep_take = async () => ({ ok: false, error: "The disk is full" })
    })
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(notices(page, "error").filter({ hasText: "The disk is full" })).toBeVisible()
    await expect(cropped.getByRole("button", { name: "Undo" })).toHaveCount(1)
    expect(await callCount(page, "end_trash")).toBe(0)
  })

  test("Undo brings back the cloud answer it was left with", async ({ page }) => {
    await openApp(page, {
      // The limit at its lowest, so the fake's 6 s take is not a false start.
      before: `window.__CLOUD_DIR__ = '/cloud'; window.__AUTO_PUBLISH__ = {on: true, what: 'mix'}; window.__FALSE_START__ = 5;`,
    })
    await startRehearsal(page)
    await recordTake(page)
    const box = page.locator("#send-to-cloud")
    await expect(box).toBeChecked()
    await box.uncheck()
    await page.keyboard.press("Escape")
    await expect(title(page)).toHaveCount(0)
    await said(page, "“Take 1” went to the Trash.").getByRole("button", { name: "Undo" }).click()
    await expect(title(page)).toHaveText("Take 1")
    await expect(box).not.toBeChecked()
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect.poll(() => callCount(page, "keep_take")).toBe(1)
    // Kept out of the cloud folder, against the setting, as it was left.
    expect((await calls(page, "keep_take"))[0].args[6]).toBe(false)
  })

  test("a session that cannot be read after a discard still offers the Undo", async ({
    page,
    pageErrors,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await page.evaluate(() => {
      const api = (window as unknown as { pywebview: { api: Record<string, unknown> } })
        .pywebview.api
      const real = api.session_state
      api.session_state = async () => {
        api.session_state = real
        throw new Error("the bridge blinked")
      }
    })
    await page.keyboard.press("Escape")
    const notice = said(page, "“Take 1” went to the Trash.")
    await expect(notice).toHaveCount(1)
    await expect(page.getByRole("button", { name: /^Record take/ })).toBeVisible()
    await notice.getByRole("button", { name: "Undo" }).click()
    await expect(title(page)).toHaveText("Take 1")
    expectedError(pageErrors, /session_state failed/)
  })

  test("while the session is read after a discard, the take is not saved", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await holdSession(page)
    await page.keyboard.press("Escape")
    await expect(said(page, "“Take 1” went to the Trash.")).toHaveCount(1)
    await page.keyboard.press("Space")
    await page.waitForTimeout(200)
    expect(await callCount(page, "keep_take")).toBe(0)
    await releaseSession(page)
    await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
    expect(await callCount(page, "keep_take")).toBe(0)
  })

  test("an Undo while the session is read after a discard stays on the take", async ({
    page,
  }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await nameTake(page, "Sonca")
    await holdSession(page)
    await page.keyboard.press("Escape")
    await said(page, "“Sonca 1” went to the Trash.").getByRole("button", { name: "Undo" }).click()
    await releaseSession(page)
    await expect(title(page)).toHaveText("Sonca 1")
    await page.waitForTimeout(200)
    await expect(title(page)).toHaveText("Sonca 1")
    // And it is the screen again, not one left busy: Space saves it.
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "keep_take")).toBe(1)
  })
})

test("a crop asks nothing, and Undo gives back the take's old length", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameTake(page, "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  await expect(page.locator("span", { hasText: "/ 0:06" }).first()).toBeVisible()
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator("span", { hasText: "/ 0:03" }).first()).toBeVisible()
  const notice = said(page, "“Pałyn 1” is cropped. The uncut take went to the Trash.")
  await notice.getByRole("button", { name: "Undo" }).click()
  await expect(page.locator("span", { hasText: "/ 0:06" }).first()).toBeVisible()
  await expect(notice).toHaveCount(0)
})

test("a second crop of a take ends the first one's offer", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await nameTake(page, "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  await expect(page.locator("span", { hasText: "/ 0:06" }).first()).toBeVisible()
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect(page.locator("span", { hasText: "/ 0:03" }).first()).toBeVisible()
  const [first] = await waiting(page)
  await dragRegion(page, 0.1, 0.9)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect(page.locator("span", { hasText: "/ 0:02" }).first()).toBeVisible()
  // One notice, the second crop's: Python sent the first one's uncut take
  // on, and its Undo would only say so.
  await expect(said(page, "“Pałyn 1” is cropped. The uncut take went to the Trash.")).toHaveCount(1)
  expect(await waiting(page)).not.toContain(first)
  await expect
    .poll(async () => (await calls(page, "end_trash")).filter((c) => c.args[0] === first).length)
    .toBe(1)
  await page.keyboard.press("Control+z")
  await expect(page.locator("span", { hasText: "/ 0:03" }).first()).toBeVisible()
})

test("a crop in History asks nothing, and Undo gives back the take's old length", async ({
  page,
}) => {
  await openApp(page, { before: "window.__OLD_LENGTH_SEC__ = 20;" })
  await openHistory(page)
  await page.getByRole("button", { name: "Take 1 Pałyn" }).click()
  await expect(page.locator("span", { hasText: "/ 0:20" }).first()).toBeVisible()
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator("span", { hasText: "/ 0:10" }).first()).toBeVisible()
  expect((await calls(page, "crop_take")).at(-1)?.args.slice(0, 2)).toEqual(["/rec/old", 1])
  const notice = said(page, "“Pałyn 1” is cropped. The uncut take went to the Trash.")
  await notice.getByRole("button", { name: "Undo" }).click()
  await expect(page.locator("span", { hasText: "/ 0:20" }).first()).toBeVisible()
  await expect(notice).toHaveCount(0)
})

test("deleting a rehearsal ends the offers of its takes", async ({ page }) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  const take = said(page, "“Pałyn 2” went to the Trash.")
  await expect(take).toHaveCount(1)
  const [token] = await waiting(page)
  await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
  await expect(said(page, "“Tuesday jam” went to the Trash.")).toHaveCount(1)
  await expect(take).toHaveCount(0)
  expect(await waiting(page)).not.toContain(token)
})

test("deleting a rehearsal renamed since ends the offers of its takes", async ({ page }) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  const take = said(page, "“Pałyn 2” went to the Trash.")
  await expect(take).toHaveCount(1)
  const [token] = await waiting(page)
  // The rename moves the rehearsal's folder; Python knows it, and what of
  // it waits for an Undo, by its id all the same.
  await renameTuesday(page, "Tuesday blues")
  await expect(take).toHaveCount(1)
  await page.getByRole("button", { name: "Delete rehearsal Tuesday blues" }).click()
  await expect(said(page, "“Tuesday blues” went to the Trash.")).toHaveCount(1)
  await expect(take).toHaveCount(0)
  expect(await waiting(page)).not.toContain(token)
  // Asked of the folder as it is now, and recorded as it was asked.
  expect((await calls(page, "delete_rehearsal")).map((c) => c.args)).toEqual([
    ["/rec/Tuesday blues"],
  ])
})

test("Undo of a take deleted in History, its rehearsal renamed since, shows it back", async ({
  page,
}) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(row(overview, 2)).toHaveCount(0)
  await renameTuesday(page, "Tuesday blues")
  // The folder it had is not there any more: asked of it, Python finds no
  // rehearsal, and neither does the fake.
  const stale = await page.evaluate(() =>
    (
      window as unknown as {
        pywebview: { api: { get_rehearsal: (folder: string) => Promise<unknown> } }
      }
    ).pywebview.api.get_rehearsal("/rec/old")
  )
  expect(stale).toEqual({ ok: false, error: "Rehearsal not found" })
  await said(page, "“Pałyn 2” went to the Trash.").getByRole("button", { name: "Undo" }).click()
  // Read again where Python said the rehearsal is now.
  await expect(overview.getByRole("button", { name: /^Take 2 Pałyn 2/ })).toBeVisible()
  expect((await calls(page, "get_rehearsal")).at(-1)?.args).toEqual(["/rec/Tuesday blues"])
})

test("Undo of a crop in History, its rehearsal renamed since, gives back the old length", async ({
  page,
}) => {
  await openApp(page, { before: "window.__OLD_LENGTH_SEC__ = 20;" })
  await openHistory(page)
  await page.getByRole("button", { name: "Take 1 Pałyn" }).click()
  await dragRegion(page, 0.25, 0.75)
  await page.getByRole("button", { name: "Crop to the region" }).click()
  await expect(page.locator("span", { hasText: "/ 0:10" }).first()).toBeVisible()
  // Put down, to rename the rehearsal it is in.
  await page.keyboard.press("Escape")
  await renameTuesday(page, "Tuesday blues")
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(row(overview, 1)).toContainText("0:10")
  const notice = said(page, "“Pałyn 1” is cropped. The uncut take went to the Trash.")
  await notice.getByRole("button", { name: "Undo" }).click()
  // Read again where Python said the rehearsal is now.
  await expect(row(overview, 1)).toContainText("0:20")
  await expect(notice).toHaveCount(0)
})

test("switching the recordings folder ends every offer", async ({ page }) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  const take = said(page, "“Pałyn 2” went to the Trash.")
  await expect(take).toHaveCount(1)
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  await page.fill("#recordings-dir", "/Users/alex/Band")
  await page.keyboard.press("Tab")
  await expect(notices(page, "done")).toContainText("Folder saved")
  await expect(take).toHaveCount(0)
})

test("choosing the folder in use again keeps every offer", async ({ page }) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  const take = said(page, "“Pałyn 2” went to the Trash.")
  await expect(take).toHaveCount(1)
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  // The same folder, spelled with a slash at the end: Python says it is the one in use.
  await page.fill("#recordings-dir", "/Users/alex/RehearsalRecordings/")
  await page.keyboard.press("Tab")
  await expect(page.locator("#recordings-dir")).toHaveValue("/Users/alex/RehearsalRecordings")
  await expect(take).toHaveCount(1)
  await expect(take.getByRole("button", { name: "Undo" })).toBeVisible()
  expect(await waiting(page)).toHaveLength(1)
  expect(await callCount(page, "end_trash")).toBe(0)
})

test("on Windows it went to the Recycle Bin", async ({ page }) => {
  const overview = await tuesday(page, WINDOWS)
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(said(page, "“Pałyn 2” went to the Recycle Bin.")).toHaveCount(1)
  await expect(said(page, "“Pałyn 2” went to the Recycle Bin.").locator("kbd")).toHaveText(
    "Ctrl+Z"
  )
})

test("with no Trash on the machine it moved to the _deleted folder", async ({ page }) => {
  const overview = await tuesday(page, `${WINDOWS} window.__TRASH_KIND__ = 'folder';`)
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(said(page, "“Pałyn 2” moved to the _deleted folder.")).toHaveCount(1)
})

test("on Windows an Undo too late says the Recycle Bin", async ({ page }) => {
  const overview = await tuesday(page, WINDOWS)
  await deleteTake(overview, 2, "Pałyn 2")
  const offer = said(page, "“Pałyn 2” went to the Recycle Bin.")
  await expect(offer).toHaveCount(1)
  // Python sent it on meanwhile and has not said so yet: its Undo finds it gone.
  await page.evaluate(() => {
    const held = (window as unknown as { __UNDOABLE__: Record<string, unknown> }).__UNDOABLE__
    for (const token of Object.keys(held)) delete held[token]
  })
  await offer.getByRole("button", { name: "Undo" }).click()
  const late = said(page, "It has already gone to the Recycle Bin.")
  await expect(late).toHaveCount(1)
  await expect(late.getByRole("button", { name: "Undo" })).toHaveCount(0)
  await expect(row(overview, 2)).toHaveCount(0)
})

test("deleting a rehearsal asks nothing, and Undo lists it again", async ({ page }) => {
  const list = await (async () => {
    await openApp(page)
    return openHistory(page)
  })()
  await expect(list.getByRole("button", { name: /^Tuesday jam/ })).toHaveCount(1)
  await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(list.getByRole("button", { name: /^Tuesday jam/ })).toHaveCount(0)
  await said(page, "“Tuesday jam” went to the Trash.").getByRole("button", { name: "Undo" }).click()
  await expect(list.getByRole("button", { name: /^Tuesday jam/ })).toHaveCount(1)
  await expect(page.getByRole("heading", { name: "Tuesday jam" })).toBeVisible()
})

test("with the Rename take dialog open, Ctrl+Z brings nothing back", async ({ page }) => {
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  await expect(row(overview, 2)).toHaveCount(0)
  await row(overview, 1).hover()
  await row(overview, 1).getByRole("button", { name: "Rename take Pałyn 1" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Cancel" }).focus()
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(200)
  expect(await callCount(page, "undo_trash")).toBe(0)
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press("Control+z")
  await expect(row(overview, 2)).toBeVisible()
})

test("during a take Ctrl+Z brings nothing back", async ({ page }) => {
  const overview = await tonight(page, TWO)
  await deleteTake(overview, 1, "Pałyn 1")
  await expect(row(overview, 1)).toHaveCount(0)
  await page.getByRole("button", { name: /Record take 3/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(200)
  expect(await callCount(page, "undo_trash")).toBe(0)
  await expect(said(page, "“Pałyn 1” went to the Trash.")).toHaveCount(1)
})

test("discarding the last unsaved take leaves the list, and Undo opens it again", async ({
  page,
}) => {
  await openApp(page, {
    before: `window.__DRAFTS__ = [{dir: '/rec/old/_drafts/take 4', name: 'take 4',
      tracks: ['Guitar', 'Vocals'], duration_sec: 95,
      rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
      created_at: '2026-09-10T19:00:00'}];`,
  })
  await expect(page.getByText("Unsaved takes found")).toBeVisible()
  await page.getByRole("button", { name: "Discard" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("Unsaved takes found")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Start rehearsal/ })).toBeVisible()
  expect((await calls(page, "discard_draft")).map((c) => c.args)).toEqual([
    ["/rec/old/_drafts/take 4"],
  ])
  await said(page, "“Tuesday jam” went to the Trash.").getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Unsaved takes found")).toBeVisible()
  await expect(page.locator("[data-draft]")).toHaveCount(1)
})

test("an unsaved take discarded from a list still showing comes back into it", async ({
  page,
}) => {
  await openApp(page, {
    before: `window.__DRAFTS__ = [
      {dir: '/rec/old/_drafts/take 4', name: 'take 4', tracks: ['Guitar'], duration_sec: 95,
       rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
       created_at: '2026-09-10T19:00:00'},
      {dir: '/rec/quiet/_drafts/take 2', name: 'take 2', tracks: ['Guitar'], duration_sec: 60,
       rehearsal_folder: '/rec/quiet', rehearsal_name: 'Wednesday jam',
       created_at: '2026-09-03T19:00:00'}];`,
  })
  const list = page.getByText("Unsaved takes found")
  const takes = page.locator("[data-draft]")
  await expect(takes).toHaveCount(2)
  await page.getByRole("button", { name: "Discard" }).first().click()
  await expect(takes).toHaveCount(1)
  await expect(list).toBeVisible()

  await said(page, "“Tuesday jam” went to the Trash.").getByRole("button", { name: "Undo" }).click()
  await expect(takes).toHaveCount(2)
  await expect(page.getByText("Tuesday jam")).toBeVisible()
  await expect(list).toHaveCount(1)
})

test("two unsaved takes discarded, each Undo brings its own back to the list", async ({
  page,
}) => {
  await openApp(page, {
    before: `window.__DRAFTS__ = [
      {dir: '/rec/old/_drafts/take 4', name: 'take 4', tracks: ['Guitar'], duration_sec: 95,
       rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
       created_at: '2026-09-10T19:00:00'},
      {dir: '/rec/quiet/_drafts/take 2', name: 'take 2', tracks: ['Guitar'], duration_sec: 60,
       rehearsal_folder: '/rec/quiet', rehearsal_name: 'Wednesday jam',
       created_at: '2026-09-03T19:00:00'}];`,
  })
  const list = page.getByText("Unsaved takes found")
  await expect(list).toBeVisible()
  const takes = page.locator("[data-draft]")
  await expect(takes).toHaveCount(2)
  await page.getByRole("button", { name: "Discard" }).first().click()
  await expect(takes).toHaveCount(1)
  await page.getByRole("button", { name: "Discard" }).click()
  await expect(list).toHaveCount(0)

  // The first one back, after the list closed on the second.
  await said(page, "“Tuesday jam” went to the Trash.").getByRole("button", { name: "Undo" }).click()
  await expect(list).toBeVisible()
  await expect(takes).toHaveCount(1)
  await expect(page.getByText("Tuesday jam")).toBeVisible()
  // And the second, into the list now showing.
  await said(page, "“Wednesday jam” went to the Trash.").getByRole("button", { name: "Undo" }).click()
  await expect(takes).toHaveCount(2)
})

test("a folder switch names what could not be ended in the old folder", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  await setFake(page, "__KEPT__", ["/Users/alex/Old/_deleting/3"])
  await page.fill("#recordings-dir", "/Users/alex/Band")
  await page.keyboard.press("Tab")
  await expect(
    said(
      page,
      "Something that was being removed stays in “/Users/alex/Old/_deleting/3”: it could not be put back or moved to the Trash."
    )
  ).toHaveAttribute("data-notice", "warning")
  await expect(notices(page, "done")).toContainText("Folder saved")
})

test("an Undo that fails in the page itself is said on the bar and sent to the crash log", async ({
  page,
  pageErrors,
}) => {
  // Python answers, and the page trips over the answer: an error Python never
  // saw, so it is not in crash.log unless the page sends it there.
  const overview = await tuesday(page)
  await deleteTake(overview, 2, "Pałyn 2")
  const notice = said(page, "“Pałyn 2” went to the Trash.")
  await expect(notice).toHaveCount(1)
  await page.evaluate(() => {
    const bridge = (window as unknown as { pywebview: { api: Record<string, unknown> } })
      .pywebview.api
    bridge.undo_trash = async () => null
  })
  await notice.getByRole("button", { name: "Undo" }).click()

  const bar = problemBar(page)
  await expect(bar).toContainText("Something went wrong in Undo")
  await expect(bar).toContainText("TypeError")
  await expect.poll(() => callCount(page, "log_problem")).toBe(1)
  const [sent] = await calls(page, "log_problem")
  expect(sent.args.slice(0, 2)).toEqual(["Undo", "TypeError"])
  expect(String(sent.args[2])).toContain("null")
  // The stack, for whoever reads the log.
  expect(String(sent.args[3])).toContain("TypeError")
  expectedError(pageErrors, /Undo failed/)
})

// An old name forgotten from a song's page is offered back, as a removal is:
// the notice has Undo. Python refuses it when the name has become another
// song's since, and the notice then says why.

const OLD_PALYN = "window.__OLD_NAMES__ = [['Palyn', 'Pałyn']];"

/** A song's page: Songs on the switch above History's list, then the song. */
async function openSong(page: Page, title: string) {
  await openHistory(page)
  await page.getByRole("radiogroup", { name: "History view" }).getByRole("radio", { name: "Songs" }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator(`[data-song='${title}']`).click()
  await expect(
    page.locator("[data-song-head]").getByRole("heading", { name: title, exact: true })
  ).toBeVisible()
}

const forgetPalyn = (page: Page) =>
  page.locator("[data-song-head] [data-old-names]").getByRole("button", {
    name: "Forget Palyn",
    exact: true,
  })

test("forgetting an old name on a song's page says so, and Undo brings it back", async ({
  page,
}) => {
  await openApp(page, { before: OLD_PALYN })
  await openSong(page, "Pałyn")
  // The song whose page it is: the last one read.
  const palyn = (await calls(page, "get_song")).at(-1)?.args[0]
  expect(typeof palyn).toBe("number")
  await forgetPalyn(page).click()
  await expect(forgetPalyn(page)).toHaveCount(0)

  const notice = said(page, "“Palyn” was forgotten.")
  await expect(notice).toHaveAttribute("data-notice", "done")
  await notice.getByRole("button", { name: "Undo" }).click()

  await expect(forgetPalyn(page)).toBeVisible()
  await expect(notice).toHaveCount(0)
  // Back to that song, spelt as it was.
  expect((await calls(page, "remember_song_name")).map((c) => c.args)).toEqual([[palyn, "Palyn"]])
})

test("Undo of a forgotten name that another song has taken since says why", async ({ page }) => {
  // Nothing stubbed: the fake refuses it as Python does, Daroha being
  // called Palyn by the time Undo is pressed.
  await openApp(page, { before: OLD_PALYN })
  await openSong(page, "Pałyn")
  await forgetPalyn(page).click()
  const notice = said(page, "“Palyn” was forgotten.")
  await expect(notice).toHaveCount(1)
  const renamed = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        pywebview: {
          api: {
            list_songs: () => Promise<{ songs: { id: number; title: string }[] }>
            rename_song: (id: number, title: string) => Promise<{ ok: boolean }>
          }
        }
      }
    ).pywebview.api
    const daroha = (await api.list_songs()).songs.find((s) => s.title === "Daroha")!
    return api.rename_song(daroha.id, "Palyn")
  })
  expect(renamed.ok).toBe(true)
  await notice.getByRole("button", { name: "Undo" }).click()

  const refused = notices(page, "error")
  await expect(refused).toHaveCount(1)
  await expect(refused).toContainText("Could not bring back Palyn: There is already a song called Palyn")
  await expect(forgetPalyn(page)).toHaveCount(0)
})

test("Undo of a forgotten name that has become another song's says why", async ({ page }) => {
  await openApp(page, {
    before: OLD_PALYN,
    after:
      "window.pywebview.api.remember_song_name = async () => ({ok: false, error: 'Palyn is Viasna now'});",
  })
  await openSong(page, "Pałyn")
  await forgetPalyn(page).click()
  await said(page, "“Palyn” was forgotten.").getByRole("button", { name: "Undo" }).click()

  const refused = notices(page, "error")
  await expect(refused).toHaveCount(1)
  await expect(refused).toContainText("Could not bring back Palyn: Palyn is Viasna now")
  await expect(forgetPalyn(page)).toHaveCount(0)
})
