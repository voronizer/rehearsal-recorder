import { expect, openApp, openHistory, setFake, startButton, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Notices: what happened goes in the corner. A message that appeared in the
// middle of Settings pushed the whole panel down a line, and a few seconds
// later let it jump back up.

const notices = (page: Page, kind?: string) =>
  page.locator(
    kind
      ? `section[aria-label='Notifications'] [data-notice='${kind}']`
      : "section[aria-label='Notifications'] [data-notice]"
  )

const topOf = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())?.y

async function openSettings(page: Page) {
  // The page's own clock, so a notice's seconds on screen can be gone
  // through at once rather than waited out.
  await page.clock.install()
  await openApp(page)
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page.locator("#input-device")).toBeVisible()
}

async function saveFolder(page: Page, path: string) {
  await page.fill("#recordings-dir", path)
  await page.keyboard.press("Tab")
}

test("a notice moves nothing, and a done one goes by itself", async ({ page }) => {
  await openSettings(page)
  const before = await topOf(page, "#input-device")
  await page.getByRole("button", { name: "Look again" }).click()
  await expect(page.locator("[data-notice='done']", { hasText: "No new interfaces" })).toBeVisible()
  expect(await topOf(page, "#input-device")).toBe(before)
  await page.clock.fastForward(6000)
  await expect(notices(page)).toHaveCount(0)
  expect(await topOf(page, "#input-device")).toBe(before)
  // The corner the notices sit in takes no clicks of its own.
  await expect(page.locator("section[aria-label='Notifications']")).toHaveCSS(
    "pointer-events",
    "none"
  )
})

test("a done notice under the pointer waits to be read", async ({ page }) => {
  await openSettings(page)
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  const field = await topOf(page, "#recordings-dir")
  await saveFolder(page, "/Users/alex/Band")
  const saved = page.locator("[data-notice='done']", { hasText: "Folder saved" })
  await expect(saved).toBeVisible()
  expect(await topOf(page, "#recordings-dir")).toBe(field)
  await saved.hover()
  await page.clock.fastForward(6000)
  await expect(saved).toHaveCount(1)
  await page.mouse.move(20, 20)
  await page.clock.fastForward(6000)
  await expect(saved).toHaveCount(0)
})

test("a notice closed under the pointer does not hold the next ones up", async ({ page }) => {
  // Taking a notice away from under the pointer fires no mouseleave: the
  // pause for "somebody is reading" must end with the notice that earned it.
  await openSettings(page)
  const look = page.getByRole("button", { name: "Look again" })
  await look.click()
  const first = page.locator("[data-notice='done']", { hasText: "No new interfaces" })
  await expect(first).toBeVisible()
  await first.hover()
  await first.getByRole("button", { name: "Close notice" }).click()
  await expect(notices(page)).toHaveCount(0)
  await page.mouse.move(20, 20)

  await look.click()
  await expect(first).toBeVisible()
  await page.mouse.move(20, 20)
  await page.clock.fastForward(6000)
  await expect(notices(page)).toHaveCount(0)
})

test("a failure stays until it is closed, and is one notice however often it happens", async ({
  page,
}) => {
  await openSettings(page)
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()

  await saveFolder(page, "/nope/" + "x".repeat(200))
  const failed = notices(page, "error")
  await expect(failed).toBeVisible()
  // Said to a screen reader, and wrapped inside itself however long.
  await expect(failed).toHaveAttribute("role", "alert")
  expect(await failed.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  const box = await failed.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(1180)

  await saveFolder(page, "/nope/again")
  await expect(page.locator("[data-notice='error']", { hasText: "/nope/again" })).toBeVisible()
  await expect(notices(page)).toHaveCount(1)
  await page.clock.fastForward(6000)
  await expect(failed).toHaveCount(1)

  // A retry that works leaves only its success.
  await saveFolder(page, "/Users/alex/Band 2")
  await expect(page.locator("[data-notice='done']", { hasText: "Folder saved" })).toBeVisible()
  await expect(notices(page)).toHaveCount(1)
  await expect(notices(page, "error")).toHaveCount(0)

  // The success's seconds must not end the failure that took its place.
  await saveFolder(page, "/nope/third")
  await expect(page.locator("[data-notice='error']", { hasText: "/nope/third" })).toBeVisible()
  await page.clock.fastForward(4500)
  await expect(notices(page, "error")).toHaveCount(1)

  // Focus is on Browse after the Tab, so Escape is not typing: it leaves
  // Settings in one press, and the notice stays.
  await page.keyboard.press("Escape")
  await expect(startButton(page)).toBeVisible()
  await expect(page.locator("#recordings-dir")).toHaveCount(0)
  await expect(notices(page, "error")).toHaveCount(1)

  // The corner is clear of a footer's buttons only in a wide window at 100%.
  // A notice that stays must never sit on Start, Stop or Save take, so it
  // goes above the footer.
  await page.setViewportSize({ width: 960, height: 680 })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const b = [...document.querySelectorAll("footer button")].find((x) =>
          x.textContent?.includes("Start rehearsal")
        )!
        const r = b.getBoundingClientRect()
        return b.contains(document.elementFromPoint(r.right - 4, r.top + r.height / 2))
      })
    )
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const n = document.querySelector("section[aria-label='Notifications'] [data-notice]")!
        const f = document.querySelector("footer")!
        return n.getBoundingClientRect().bottom <= f.getBoundingClientRect().top
      })
    )
    .toBe(true)
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.getByRole("button", { name: "Close notice" }).click()
  await expect(notices(page)).toHaveCount(0)
})

test("an output that falls back says so, and a second one takes the first's place", async ({
  page,
}) => {
  // Changing the output while a take is open can land somewhere else.
  // Python has always said so; the screen used to read only `ok`.
  await openApp(page, { before: "window.__OUTPUT_FALLBACK__ = true;" })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.click("#output-device")
  await page.getByRole("option", { name: "UA Monitors" }).click()
  const warned = page.locator("[data-notice='warning']")
  await expect(warned).toContainText("using the system output")
  await expect(page.locator("[data-notice='error']")).toHaveCount(0)
  await page.click("#output-device")
  await page.getByRole("option", { name: "MacBook Speakers" }).click()
  await expect(page.locator("[data-notice='warning']", { hasText: "MacBook Speakers" })).toBeVisible()
  await expect(page.locator("[data-notice]")).toHaveCount(1)
})

test("History says in the corner when a rehearsal will not open", async ({ page }) => {
  await openApp(page, { before: "window.__REHEARSAL_UNREADABLE__ = true;" })
  await page.getByRole("button", { name: "History", exact: true }).click()
  const row = page.getByText("Tuesday jam").first()
  await expect(row).toBeVisible()
  const rowTop = (await row.boundingBox())?.y
  await row.click()
  const failed = notices(page, "error")
  await expect(failed).toContainText("session.json is damaged")
  await expect(failed).toHaveAttribute("role", "alert")
  expect((await row.boundingBox())?.y).toBe(rowTop)

  // A dialog opened while a notice is showing keeps its own Escape.
  await page.getByRole("button", { name: "Rename rehearsal Tuesday jam" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("Tuesday jam").first()).toBeVisible()
  await expect(startButton(page)).toHaveCount(0)
  await expect(failed).toHaveCount(1)
})

test("a take that will not recover says so, and is still offered", async ({ page }) => {
  await openApp(page, {
    before: `window.__RECOVER_FAILS__ = true;
      window.__DRAFTS__ = [{dir: '/rec/old/_drafts/take 1', name: 'take 1',
        tracks: ['Guitar', 'Vocals'], duration_sec: 95,
        rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
        created_at: '2026-09-10T19:00:00'}];`,
  })
  await expect(page.getByText("Unsaved takes found")).toBeVisible()
  await page.getByRole("button", { name: "Recover" }).click()
  await expect(notices(page, "error")).toContainText("read-only")
  await expect(page.getByText("Unsaved takes found")).toHaveCount(1)
})

test("a notice stands above an open dialog, and closing it leaves the dialog open", async ({
  page,
}) => {
  // Work that is still running keeps the app asking about it often, so the
  // failure below arrives within a moment.
  const copy = {
    id: 1,
    kind: "cloud",
    title: "“Pałyn” → cloud",
    folder: "/rec/X",
    take_number: 1,
    state: "running",
    fraction: 0.4,
    step: "Encoding the mix",
    error: null,
    detail: null,
    retry: null,
    seen: false,
  }
  await openApp(page, { before: "window.__ACTIVITY__ = [];" })
  await setFake(page, "__ACTIVITY__", [copy])
  await expect(page.locator("button[aria-label^='Background work']")).toBeVisible()
  await openHistory(page)
  await page.getByRole("button", { name: "Rename rehearsal Tuesday jam" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  // The copy fails while the dialog is open: its notice is raised behind the
  // veil unless it stands above it.
  await setFake(page, "__ACTIVITY__", [
    { ...copy, state: "failed", step: null, error: "The cloud folder is gone" },
  ])
  const failed = notices(page, "error")
  await expect(failed).toContainText("The cloud folder is gone")
  await expect
    .poll(() =>
      failed.evaluate((n) => {
        const r = n.getBoundingClientRect()
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return top !== null && n.contains(top)
      })
    )
    .toBe(true)
  // A modal dialog hides the rest of the page from a screen reader, but never
  // a live region: the notice is still announced.
  expect(
    await page.evaluate(
      () =>
        document.querySelector("section[aria-label='Notifications']")!.closest("[aria-hidden='true']") ===
        null
    )
  ).toBe(true)

  // A click on it is not a click outside the dialog: the dialog stays and
  // the notice goes.
  await failed.getByRole("button", { name: "Close notice" }).click()
  await expect(failed).toHaveCount(0)
  // Open, not merely still on screen: a closing dialog is drawn for 220 ms.
  await expect(dialog).toHaveAttribute("data-state", "open")
  await expect(dialog).toBeVisible()
})
