import type { Locator, Page } from "@playwright/test"
import {
  callCount,
  calls,
  expect,
  openApp,
  openHistory,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"

/** The level Python kept from last time, set before the app opens. */
const savedAt = (volume: number) =>
  `localStorage.setItem('mock-python-config', JSON.stringify({theme:'dark', ui_scale:1, master_volume:${volume}}))`

function headerVolume(page: Page): Locator {
  return page.locator("header").getByRole("button", { name: "Playback volume" })
}

/** Opens the header's speaker and returns the slider behind it. */
async function openVolume(page: Page): Promise<Locator> {
  await headerVolume(page).click()
  const panel = page.getByRole("dialog", { name: "Playback volume" })
  await expect(panel).toBeVisible()
  return panel.getByRole("slider", { name: "Master volume" })
}

/** Clicks a slider at a fraction of its width, the way a person turns it. */
async function turn(page: Page, slider: Locator, fraction: number) {
  const box = (await slider.boundingBox())!
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
}

async function lastArg(page: Page, name: string): Promise<number | undefined> {
  return (await calls(page, name)).at(-1)?.args[0] as number | undefined
}

test.describe("Playback volume in the header", () => {
  test("is there wherever a take can be played, and not while recording", async ({ page }) => {
    await openApp(page)
    await expect(headerVolume(page)).toBeVisible()

    await startRehearsal(page)
    await expect(headerVolume(page)).toBeVisible()
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    await expect(headerVolume(page)).toHaveCount(0)
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(page.locator("#take-name")).toBeVisible()
    await expect(headerVolume(page)).toBeVisible()
  })

  test("is in History, and over a take opened there", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    await expect(headerVolume(page)).toBeVisible()
    await page.getByRole("button", { name: "Take 1 Polyn", exact: true }).click()
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    await expect(headerVolume(page)).toBeVisible()
  })

  test("opens at the level kept from last time, before anything plays", async ({ page }) => {
    await openApp(page, { before: savedAt(0.4) })
    const slider = await openVolume(page)
    await expect(slider).toHaveValue("0.4")
    expect(await callCount(page, "player_open")).toBe(0)
  })

  test("turned with nothing open, it is kept and the next take opens at it", async ({ page }) => {
    await openApp(page)
    const slider = await openVolume(page)
    await turn(page, slider, 0.3)
    await expect.poll(() => lastArg(page, "save_master_volume")).toBeLessThan(0.5)
    const kept = (await lastArg(page, "save_master_volume"))!
    // There was no take to send it to.
    expect(await callCount(page, "player_set_master")).toBe(0)

    await page.keyboard.press("Escape")
    await openHistory(page)
    await page.getByRole("button", { name: "Take 1 Polyn", exact: true }).click()
    await expect(page.getByRole("slider", { name: "Master volume" })).toHaveValue(String(kept))
  })

  test("is the same level as the master fader under a take, both ways", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    await page.getByRole("button", { name: "Take 1 Polyn", exact: true }).click()
    const fader = page.getByRole("slider", { name: "Master volume" })
    await expect(fader).toHaveValue("1")

    await turn(page, await openVolume(page), 0.3)
    await expect.poll(() => lastArg(page, "player_set_master")).toBeLessThan(0.5)
    const fromHeader = (await lastArg(page, "player_set_master"))!
    await expect.poll(() => lastArg(page, "save_master_volume")).toBe(fromHeader)
    // Escape shuts the slider, not the take.
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Playback volume" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    await expect(fader).toHaveValue(String(fromHeader))

    await turn(page, fader, 0.8)
    await expect.poll(() => lastArg(page, "player_set_master")).toBeGreaterThan(0.5)
    const fromFader = (await lastArg(page, "player_set_master"))!
    await expect(await openVolume(page)).toHaveValue(String(fromFader))
  })

  test("leaves Space with the screen once it is shut, whichever way", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    await page.getByRole("button", { name: "Take 1 Polyn", exact: true }).click()
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
    const panel = page.getByRole("dialog", { name: "Playback volume" })

    // Shut with Escape: Space plays the take, it does not open the slider
    // again from the speaker focus went back to.
    await openVolume(page)
    await page.keyboard.press("Escape")
    await expect(panel).toHaveCount(0)
    let toggles = await callCount(page, "player_toggle")
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
    await expect(panel).toHaveCount(0)

    // Turned, then shut by a click anywhere else: the first click does it.
    await turn(page, await openVolume(page), 0.6)
    await page.mouse.click(400, 650)
    await expect(panel).toHaveCount(0)
    toggles = await callCount(page, "player_toggle")
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
  })

  test("opened from the keyboard, the arrows turn it", async ({ page }) => {
    await openApp(page)
    await headerVolume(page).focus()
    await page.keyboard.press("Enter")
    const slider = page.getByRole("dialog", { name: "Playback volume" }).getByRole("slider")
    await expect(slider).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(slider).toHaveValue("0.99")
    await expect.poll(() => lastArg(page, "save_master_volume")).toBe(0.99)
  })

  test("turns a take playing from a row down at once", async ({ page }) => {
    await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
    await openHistory(page)
    const overview = page.locator("[aria-label='Rehearsal overview']")
    await overview.getByRole("button", { name: "Play Vesna" }).click()
    await expect(page.getByRole("button", { name: "Pause Vesna" })).toBeVisible()

    await turn(page, await openVolume(page), 0.2)
    await expect.poll(() => lastArg(page, "player_set_master")).toBeLessThan(0.5)
    await expect(page.getByRole("button", { name: "Pause Vesna" })).toBeVisible()
  })

  test("on the review screen too, with the take just recorded", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await turn(page, await openVolume(page), 0.25)
    await expect.poll(() => lastArg(page, "player_set_master")).toBeLessThan(0.5)
  })
})
