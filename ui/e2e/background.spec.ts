import { callCount, calls, expect, openApp, setFake, startRehearsal, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Long work — a copy to the cloud, saving or cropping a take — runs in the
// background. The fake's list of it is window.__ACTIVITY__.

type Entry = Record<string, unknown>

const entry = (over: Entry = {}): Entry => ({
  id: 1,
  kind: "cloud",
  title: "“Pałyn” → cloud",
  folder: "/rec/X",
  take_number: 1,
  state: "running",
  fraction: 0.64,
  step: "Encoding the mix",
  error: null,
  detail: null,
  retry: null,
  seen: false,
  ...over,
})

const activity = (page: Page, entries: Entry[]) => setFake(page, "__ACTIVITY__", entries)
const workButton = (page: Page) => page.locator("button[aria-label^='Background work']")

/** Until the screen has had its first answer about background work and
 *  asked again. What was already in the first answer is old news and is not
 *  announced (lib/activity.ts), so work scripted before then says nothing. */
async function primed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __ACTIVITY_POLLS__?: number }).__ACTIVITY_POLLS__ ?? 0)
    )
    .toBeGreaterThanOrEqual(2)
}

test.describe("the background work button, from any screen", () => {
  test("comes and goes with the work, and says how far along it is", async ({ page }) => {
    await page.clock.install()
    await openApp(page, { before: "window.__ACTIVITY__ = [];" })
    const button = workButton(page)
    // With nothing running or finished there is no button: two polls' worth.
    await page.clock.fastForward(4500)
    await expect(button).toHaveCount(0)

    await activity(page, [entry()])
    await expect(button).toHaveAttribute("aria-label", /1 running/)
    // In words, not only a ring.
    await expect(button).toHaveText("1 working · 64%")
    await activity(page, [
      entry(),
      entry({ id: 9, take_number: 9, state: "waiting", fraction: 0, step: null }),
    ])
    // A copy that waits is said to wait, and the words count both, and how
    // far along the two are together.
    await expect(button).toHaveAttribute("aria-label", /1 running, 1 waiting/)
    await expect(button).toHaveText("2 working · 32%")
    await activity(page, [entry({ id: 9, take_number: 9, state: "waiting", fraction: 0, step: null })])
    await expect(button).toHaveText("1 waiting")
  })

  test("its list says what is running, what finished and what failed", async ({ page }) => {
    await openApp(page, { before: "window.__ACTIVITY__ = [];" })
    const button = workButton(page)
    await activity(page, [entry()])
    await button.click()
    await expect(page.getByText("Encoding the mix")).toBeVisible()
    expect(await page.getByText("64%").count()).toBeGreaterThanOrEqual(1)
    // Opening the list marks what is in it seen.
    await expect.poll(() => callCount(page, "activity_seen")).toBeGreaterThanOrEqual(1)

    const done = entry({ state: "done", fraction: 1, step: null, detail: "MP3 of the mix" })
    await activity(page, [done])
    await expect(
      page.locator("[data-notice='done']", { hasText: "is in the cloud folder" })
    ).toBeVisible()
    expect(await page.getByText("MP3 of the mix").count()).toBeGreaterThanOrEqual(1)

    const take3 = { id: 2, title: "“Take 3” → cloud", take_number: 3 }
    await activity(page, [done, entry({ ...take3, state: "running" })])
    await expect(page.getByText("“Take 3” → cloud").first()).toBeVisible()
    await activity(page, [
      done,
      entry({
        ...take3,
        state: "failed",
        fraction: 0.2,
        step: null,
        error: "The cloud folder is gone",
        retry: "mix",
      }),
    ])
    const failed = page.locator("[data-notice='error']", { hasText: "Could not copy" })
    await expect(failed).toContainText("The cloud folder is gone")
    // What finishes while the list is open counts as seen.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __ACTIVITY__: { seen: boolean }[] }).__ACTIVITY__.every(
            (e) => e.seen
          )
        )
      )
      .toBe(true)

    await page.getByRole("button", { name: "Retry" }).click()
    await expect.poll(async () => (await calls(page, "retry_cloud")).map((c) => c.args)).toEqual([[2]])
    // Refused — the rehearsal was renamed or the take deleted since — the
    // button must not simply do nothing.
    await setFake(page, "__RETRY_REFUSED__", "Rehearsal not found")
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(
      page.locator("[data-notice='error']", { hasText: "Rehearsal not found" })
    ).toBeVisible()
    await setFake(page, "__RETRY_REFUSED__", null)

    // Clearing the finished ones leaves nothing, and no button.
    await page.getByRole("button", { name: "Clear", exact: true }).click()
    await expect.poll(() => callCount(page, "clear_activity")).toBe(1)
    await expect(button).toHaveCount(0)
  })

  test("says what nobody has looked at yet: a failure, or work done", async ({ page }) => {
    await openApp(page, { before: "window.__ACTIVITY__ = [];" })
    const button = workButton(page)
    await primed(page)
    // A copy that fails between two polls — a cloud folder on a drive that is
    // not plugged in fails in milliseconds — was never seen running, and
    // must still be said.
    await activity(page, [
      entry({
        id: 4,
        title: "“Take 5” → cloud",
        take_number: 5,
        state: "failed",
        fraction: 0,
        step: null,
        error: "Could not open the cloud folder",
        retry: "mix",
      }),
    ])
    await expect(page.locator("[data-notice='error']", { hasText: "Take 5" })).toBeVisible()
    await expect(button).toHaveAttribute("aria-label", /not yet seen/)
    expect(await callCount(page, "activity_seen")).toBe(0)
    await expect(button).toHaveText("1 failed")

    await activity(page, [entry({ id: 5, state: "done", fraction: 1, step: null, detail: "MP3 of the mix" })])
    await expect(button).toHaveText("Done")
    // Once looked at, it stays until Clear, but says nothing.
    await activity(page, [
      entry({ id: 5, state: "done", fraction: 1, step: null, detail: "MP3 of the mix", seen: true }),
    ])
    await expect(button).toHaveText("")
    await expect(button).toHaveCount(1)
  })

  test("is on the Finished screen too, where people decide to quit", async ({ page }) => {
    // Finished has no header of its own, and it is where a copy started by
    // the last take is still running when people decide to quit.
    await openApp(page, { before: "window.__ACTIVITY__ = [];" })
    await startRehearsal(page)
    await page.getByRole("button", { name: /Finish/ }).click()
    await expect(page.getByText("Rehearsal finished")).toBeVisible()
    await activity(page, [entry()])
    await expect(workButton(page)).toBeVisible()
  })
})

test.describe("long work shows its progress where it runs", () => {
  /** Holds a call in the fake where it is until released. */
  const hold = (page: Page, name: string) =>
    page.evaluate((n) => {
      const w = window as unknown as Record<string, unknown> & {
        __HOLD__?: Record<string, Promise<void>>
      }
      w.__HOLD__ = w.__HOLD__ || {}
      w.__HOLD__[n] = new Promise((r) => {
        w["__RELEASE_" + n] = r
      })
    }, name)
  const release = (page: Page, name: string) =>
    page.evaluate((n) => {
      const w = window as unknown as Record<string, unknown> & {
        __HOLD__: Record<string, Promise<void>>
      }
      ;(w["__RELEASE_" + n] as () => void)()
      delete w.__HOLD__[n]
    }, name)
  const running = (page: Page, kind: string, fraction: number, over: Entry = {}) =>
    activity(page, [
      entry({ id: 50, kind, title: kind, folder: null, take_number: null, fraction, step: null, ...over }),
    ])
  const polls = (page: Page) =>
    page.evaluate(() => (window as unknown as { __ACTIVITY_POLLS__?: number }).__ACTIVITY_POLLS__ ?? 0)

  async function drag(page: Page, from: number, to: number) {
    const box = (await page.getByRole("group", { name: "Take timeline" }).boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * from, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * to, y, { steps: 10 })
    await page.mouse.up()
  }

  test("saving a take, and cropping it under review and once saved", async ({ page }) => {
    await openApp(page, { before: "window.__ACTIVITY__ = [];" })
    await startRehearsal(page)
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await hold(page, "stop_take")
    const seen = await polls(page)
    await page.getByRole("button", { name: /^Stop/ }).click()
    // Python registers the entry part-way into the call, after the poll the
    // screen asked for has already come back empty.
    await expect.poll(() => polls(page)).toBeGreaterThan(seen)
    await running(page, "stop", 0.45, { folder: "/tmp/draft", take_number: 1 })
    await expect(page.getByText("Saving the take… 45%")).toBeVisible()
    await release(page, "stop_take")
    await expect(page.getByRole("button", { name: /Save take/ })).toBeVisible()

    await hold(page, "crop_draft")
    await drag(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await expect(page.getByText("Keep only")).toBeVisible()
    await running(page, "crop", 0.4, { folder: "/tmp/draft" })
    await page.getByRole("button", { name: "Crop", exact: true }).click()
    await expect(page.getByText("Cropping… 40%")).toBeVisible()
    await release(page, "crop_draft")
    await activity(page, [])
    await expect(page.getByText("Cropping…")).toHaveCount(0)

    // Saved, and cropped again from the rehearsal screen.
    await page.fill("#take-name", "Pałyn")
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
    await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    await hold(page, "crop_take")
    await drag(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await expect(page.getByText("Keep only")).toBeVisible()
    const startedAs = (await calls(page, "start_rehearsal"))[0].args[0] as string
    await running(page, "crop", 0.4, { folder: "/rec/" + startedAs, take_number: 1 })
    await page.getByRole("button", { name: "Crop", exact: true }).click()
    await expect(page.getByText("Cropping… 40%")).toBeVisible()
    await release(page, "crop_take")
  })

  test("recovering a take, in its row", async ({ page }) => {
    await openApp(page, {
      before: `window.__ACTIVITY__ = [];
        window.__DRAFTS__ = [{dir: '/rec/old/_drafts/take 1', name: 'take 1',
          tracks: ['Guitar', 'Vocals'], duration_sec: 95,
          rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
          created_at: '2026-09-10T19:00:00'}];`,
    })
    await expect(page.getByText("Unsaved takes found")).toBeVisible()
    await hold(page, "recover_draft")
    await running(page, "recover", 0.3, { folder: "/rec/old/_drafts/take 1" })
    await page.getByRole("button", { name: "Recover" }).click()
    await expect(page.getByText("Recovering… 30%")).toBeVisible()
    await release(page, "recover_draft")
  })
})
