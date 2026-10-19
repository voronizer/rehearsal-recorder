import type { Locator, Page } from "@playwright/test"
import {
  callCount,
  calls,
  expect,
  openApp,
  openHistory,
  recordTake,
  settled,
  setFake,
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
  // It grows and slides in as it opens: a slider measured on the way is not
  // where it ends up, and a click there misses it.
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
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
  test("controller mute uses the existing muted icon without changing volume", async ({ page }) => {
    await openApp(page, { before: savedAt(0.4) + ";window.__CONTROLLER_ENABLED__ = true;" })
    await setFake(page, "__CONTROL_STATE__", { playback_muted: true, master_volume: 0.4 })
    await expect(headerVolume(page)).toHaveAccessibleDescription("Playback muted")
    await expect(headerVolume(page).locator("svg")).toHaveClass(/lucide-volume-x/)
    const slider = await openVolume(page)
    await expect(slider).toHaveValue("0.4")
    await page.keyboard.press("Escape")
    await setFake(page, "__CONTROL_STATE__", { playback_muted: false, master_volume: 0.4 })
    await expect(headerVolume(page).locator("svg")).toHaveClass(/lucide-volume-1/)
    await expect(headerVolume(page)).not.toHaveAccessibleDescription("Playback muted")
    await setFake(page, "__CONTROL_STATE__", { playback_muted: true, master_volume: 0.4 })
    await expect(headerVolume(page)).toHaveAccessibleDescription("Playback muted")
    await setFake(page, "__CONTROLLER_ENABLED__", false)
    await expect(headerVolume(page)).not.toHaveAccessibleDescription("Playback muted")
  })

  test("unchanged recorder feedback does not reset a held slider", async ({ page }) => {
    await openApp(page, { before: savedAt(0.4) + ";window.__CONTROLLER_ENABLED__ = true;" })
    await page.evaluate(() => {
      const w = window as unknown as { __VOLUME_POLLS__: number; pywebview: { api: { control_state: () => Promise<Record<string, unknown>> } } }
      const original = w.pywebview.api.control_state
      w.__VOLUME_POLLS__ = 0
      w.pywebview.api.control_state = async () => {
        w.__VOLUME_POLLS__++
        return { ...await original(), master_volume: 0.4 }
      }
    })
    const slider = await openVolume(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as {__VOLUME_POLLS__:number}).__VOLUME_POLLS__)).toBeGreaterThan(1)
    const box = (await slider.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
    await page.mouse.down()
    const value = await slider.inputValue()
    await expect.poll(() => page.evaluate(() => (window as unknown as {__VOLUME_POLLS__:number}).__VOLUME_POLLS__)).toBeGreaterThan(4)
    await expect(slider).toHaveValue(value)
    await page.mouse.up()
  })

  test("is there wherever a take can be played, and not while recording", async ({ page }) => {
    await openApp(page)
    await expect(headerVolume(page)).toBeVisible()

    await startRehearsal(page)
    await expect(headerVolume(page)).toBeVisible()
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
    await expect(headerVolume(page)).toHaveCount(0)
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(page.locator("[data-take-summary]")).toBeVisible()
    await expect(headerVolume(page)).toBeVisible()
  })

  test("is in History, and over a take opened there", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    await expect(headerVolume(page)).toBeVisible()
    await page.getByRole("button", { name: "Take 1 Pałyn 1", exact: true }).click()
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
    await page.getByRole("button", { name: "Take 1 Pałyn 1", exact: true }).click()
    await expect(page.getByRole("slider", { name: "Master volume" })).toHaveValue(String(kept))
  })

  test("is the same level as the master fader under a take, both ways", async ({ page }) => {
    await openApp(page)
    await openHistory(page)
    await page.getByRole("button", { name: "Take 1 Pałyn 1", exact: true }).click()
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
    await page.getByRole("button", { name: "Take 1 Pałyn 1", exact: true }).click()
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
    await overview.getByRole("button", { name: "Play Viasna" }).click()
    await expect(page.getByRole("button", { name: "Pause Viasna" })).toBeVisible()

    await turn(page, await openVolume(page), 0.2)
    await expect.poll(() => lastArg(page, "player_set_master")).toBeLessThan(0.5)
    await expect(page.getByRole("button", { name: "Pause Viasna" })).toBeVisible()
  })

  test("on the review screen too, with the take just recorded", async ({ page }) => {
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page)
    await turn(page, await openVolume(page), 0.25)
    await expect.poll(() => lastArg(page, "player_set_master")).toBeLessThan(0.5)
  })
})

test("a fader shows keyboard focus on its thumb", async ({ page }) => {
  // Its own outline is off, as the thumb is drawn here: the focus is a ring
  // round the thumb, so a keyboard sees which fader the arrows will turn.
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await settled(page)
  const fader = page.getByRole("slider", { name: "Guitar volume" })
  const box = (await fader.boundingBox())!
  // The thumb is a 0.875 rem square that runs from one end of the track to
  // the other as the value goes from 0 to 1, centred on the track's height.
  const thumb = await page.evaluate(
    () => 0.875 * parseFloat(getComputedStyle(document.documentElement).fontSize)
  )
  const value = Number(await fader.inputValue())
  const x = box.x + thumb / 2 + value * (box.width - thumb)
  const y = box.y + box.height / 2
  // The thumb's square with its 3 px ring and a pixel to spare, and the
  // half of the track the thumb is not on, with the input's edges.
  const side = thumb + 8
  const onThumb = { x: x - side / 2, y: y - side / 2, width: side, height: side }
  const away =
    value > 0.5
      ? { x: box.x - 4, y: box.y - 4, width: box.width / 2, height: box.height + 8 }
      : { x: box.x + box.width / 2, y: box.y - 4, width: box.width / 2 + 4, height: box.height + 8 }
  await page.mouse.move(0, 0)
  const resting = [await page.screenshot({ clip: onThumb }), await page.screenshot({ clip: away })]
  await fader.focus()
  // A key down is what tells Chromium the focus is the keyboard's.
  await page.keyboard.press("Shift")
  await expect(fader).toBeFocused()
  expect((await page.screenshot({ clip: onThumb })).equals(resting[0])).toBe(false)
  expect((await page.screenshot({ clip: away })).equals(resting[1])).toBe(true)
})
