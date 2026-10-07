import {
  TAKE_SECONDS,
  callCount,
  calls,
  dragRegion,
  expect,
  keyOn,
  openApp,
  openHistory,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The player: a take's tracks on one timeline, the region on it, the zoom —
// on the review screen after a take, and for a saved take.

/** The first take, stopped and up for review. */
async function review(page: Page) {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
}

/** Take 1 saved as "Pałyn", and take 2 recorded and up for review. */
async function secondTake(page: Page) {
  await review(page)
  await page.fill("#take-name", "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await recordTake(page, 2)
}

const transport = (page: Page) => page.getByRole("toolbar", { name: "Transport" })
const keysList = (page: Page) => page.getByRole("dialog").filter({ hasText: "Keys in the player" })

test.describe("the review screen", () => {
  test("names a first take, and puts its keys on its buttons", async ({ page }) => {
    await review(page)
    await expect(page.locator("#take-name")).toHaveValue("Take 1")
    // The keys are on the buttons they press, not in a line underneath.
    await expect.poll(() => keyOn(page.getByRole("button", { name: /Save take/ }))).toBe("Space")
    await expect.poll(() => keyOn(page.getByRole("button", { name: /Discard/ }))).toBe("Esc")
    await expect(page.getByText("save take", { exact: true })).toHaveCount(0)
    // With no cloud folder it says the take stays on this computer.
    await expect(page.getByText("Stays on this computer")).toHaveCount(1)
    await expect(page.locator("#send-to-cloud")).toHaveCount(0)
  })

  test("can play the take before it is saved, from its button", async ({ page }) => {
    // Space saves here, so the button is the way to listen.
    await review(page)
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect.poll(() => callCount(page, "player_toggle")).toBe(1)
    await page.getByRole("button", { name: "Pause", exact: true }).click()
  })

  test("keeps the transport plain, with Repeat by the time and Mark at the end", async ({
    page,
  }) => {
    await review(page)
    // A key drawn on each small button was clutter however it was drawn.
    await expect(transport(page).locator(":is(kbd, [data-key])")).toHaveCount(0)
    // Repeat is part of how the take plays, so it sits with the playing.
    const repeatAt = (await transport(page).getByRole("button", { name: "Repeat" }).boundingBox())!
    const markAt = (await transport(page)
      .locator("button[aria-label='Add marker'], button[aria-label='Edit marker']")
      .first()
      .boundingBox())!
    const timeAt = (await transport(page).locator("span.tnum").first().boundingBox())!
    expect(timeAt.x).toBeLessThan(repeatAt.x)
    expect(repeatAt.x).toBeLessThan(markAt.x)
  })

  test("lists its keys behind ?, and Escape closes the list, not the take", async ({ page }) => {
    // Ctrl, as everywhere but a Mac, on whatever machine runs the tests: on
    // a Mac this said ⌘ and failed. The Mac's own list is the next test's.
    await page.addInitScript(
      "Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});"
    )
    await review(page)
    await page.keyboard.press("?")
    const listed = keysList(page)
    for (const k of ["Home", "To the start", "Mark", "Repeat", "10 seconds"]) {
      await expect(listed).toContainText(k)
    }
    // The wheel is not a key, but it is the other thing nobody finds without
    // being told: on its own it scrolls, with Ctrl it zooms.
    await expect(listed).toContainText("Ctrl + wheel")
    await expect(listed).toContainText("Zoom in / out")
    await expect(listed).toContainText("Shift + wheel")
    // Without Space here, where Space saves the take.
    await expect(listed).not.toContainText("Play / pause")
    await page.keyboard.press("Escape")
    await expect(listed).toHaveCount(0)
    await expect(page.getByText("Discard this take?")).toHaveCount(0)

    // Radix closes the dialog on Escape without stopping the keydown, so the
    // app's own Escape runs too and decided by looking at what had focus —
    // which it held here and lost on CI. With focus taken off the list,
    // whatever the app does with Escape cannot be reading focus to decide.
    await page.keyboard.press("?")
    await expect(listed).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press("Escape")
    await expect(listed).toHaveCount(0)
    await expect(page.getByText("Discard this take?")).toHaveCount(0)
  })

  test("on a Mac the list says Cmd for the zoom", async ({ page }) => {
    // The way the Mac's own menus write it.
    await page.addInitScript(
      "Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});"
    )
    await review(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press("?")
    await expect(keysList(page)).toContainText("⌘ + wheel")
    await expect(keysList(page)).not.toContainText("Ctrl + wheel")
  })

  test("R turns repeat on and off", async ({ page }) => {
    await review(page)
    const repeat = transport(page).getByRole("button", { name: "Repeat" })
    await page.keyboard.press("r")
    await expect(repeat).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("r")
    await expect(repeat).toHaveAttribute("aria-pressed", "false")
  })

  test("a space typed in the take's name is a space, and saves nothing", async ({ page }) => {
    await review(page)
    await page.fill("#take-name", "Pałyn")
    await page.keyboard.press("Space")
    await expect(page.locator("#take-name")).toHaveValue("Pałyn ")
    expect(await callCount(page, "keep_take")).toBe(0)
  })

  test("can crop a take before it is ever saved", async ({ page }) => {
    // The dead air at the start of a take is visible the moment recording
    // stops, which makes this the screen where trimming is most wanted.
    await review(page)
    await expect(page.getByRole("button", { name: "Crop to the region" })).toHaveCount(0)
    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await expect(page.getByText("Keep only")).toBeVisible()
    await page.getByRole("button", { name: "Crop", exact: true }).click()
    await expect.poll(() => callCount(page, "crop_draft")).toBe(1)
    const [, , from, to] = (await calls(page, "crop_draft"))[0].args as number[]
    expect(Math.abs(from - TAKE_SECONDS * 0.25)).toBeLessThan(0.4)
    expect(Math.abs(to - TAKE_SECONDS * 0.75)).toBeLessThan(0.4)
    // And the take on screen is that region now.
    await expect(page.locator("span", { hasText: "/ 0:03" }).first()).toBeVisible()
  })

  test("Escape leaves the name field without asking to discard, and Space then saves", async ({
    page,
  }) => {
    // Everywhere else space runs the screen's main action, and here that is
    // saving the take. Escape takes the name field's keys back first — only
    // that: a name just typed is no reason to be asked to throw the take away.
    await review(page)
    await page.fill("#take-name", "Pałyn")
    await page.keyboard.press("Escape")
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).not.toBe("take-name")
    await expect(page.getByText("Discard this take?")).toHaveCount(0)
    await expect(page.locator("#take-name")).toHaveValue("Pałyn")
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "keep_take")).toBe(1)
    // A saved take says it is on its way to the cloud, and stops saying so
    // once the queue drains, as the real one does once the copy is done.
    await expect(page.getByText("Waiting for the cloud").first()).toBeVisible()
    await expect(page.getByText("Waiting for the cloud")).toHaveCount(0)
  })

  test("the next take takes the last one's name, numbered", async ({ page }) => {
    await secondTake(page)
    await expect(page.locator("#take-name")).toHaveValue("Pałyn")
    await expect(
      page.getByRole("group", { name: "Take name" }).locator("[data-take-go]")
    ).toHaveText("2")
  })

  test("Escape asks before dropping a take, and a second Escape answers nothing", async ({
    page,
  }) => {
    // The take was played seconds ago and cannot be played again, and a
    // stray key is exactly the accident a confirmation is for.
    await secondTake(page)
    await page.keyboard.press("Escape")
    await expect(page.getByText("Discard this take?")).toBeVisible()
    expect(await callCount(page, "discard_take")).toBe(0)
    await page.keyboard.press("Escape")
    await expect(page.getByText("Discard this take?")).toHaveCount(0)
    expect(await callCount(page, "discard_take")).toBe(0)
    await expect(page.locator("#take-name")).toHaveValue("Pałyn")
  })

  test("a mark made before saving goes with the take when it is saved", async ({ page }) => {
    // There is no folder for it yet, so it rides along with keep_take.
    await secondTake(page)
    await page.getByRole("button", { name: "Add marker" }).click()
    await expect(page.getByText("Marker at")).toBeVisible()
    await page.getByRole("button", { name: "Keep this" }).click()
    await page.fill("input[aria-label='Marker note']", "this one is the take")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(page.getByText("this one is the take")).toHaveCount(1)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(page.getByRole("button", { name: /Record take 3/ })).toBeVisible()
    const kept = (await calls(page, "keep_take")).at(-1)!.args
    const marks = kept[5] as { note: string; label_id: number }[]
    expect(marks[0].note).toBe("this one is the take")
    expect(marks[0].label_id).toBe(2)
  })
})

/** Two takes saved — "Pałyn", and "Pałyn 2" with a keeper's mark at its
 *  start — and "Pałyn 2" open in the player. */
async function savedTake(page: Page) {
  await review(page)
  await page.fill("#take-name", "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await recordTake(page, 2)
  await page.getByRole("button", { name: "Add marker" }).click()
  await page.getByRole("button", { name: "Keep this" }).click()
  await page.fill("input[aria-label='Marker note']", "this one is the take")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 3/ })).toBeVisible()
  // A prefix: right after a take is saved its pill can still say "Waiting
  // for the cloud" after its name, and it is the same take either way.
  await page.locator("button[aria-label^='Take 2 Pałyn 2']").click()
  await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()
}

const timeline = (page: Page) => page.getByRole("group", { name: "Take timeline" })

test.describe("a saved take", () => {
  test("opens in the player below its pill, with the mark made before it was saved", async ({
    page,
  }) => {
    await savedTake(page)
    await expect(timeline(page)).toHaveCount(1)
    const strip = page.getByRole("group", { name: "Take strip" })
    await expect(
      strip.locator("[data-tab='song:Pałyn'][aria-current='true'] [data-tab-line]")
    ).toContainText("2")
    // Same take, same marker, one player.
    await expect(page.getByText("this one is the take")).toHaveCount(1)
    // Space plays here, and says so; Record and Finish give their keys up.
    await page.getByRole("button", { name: "Player keys" }).click()
    await expect(keysList(page)).toContainText("Play / pause")
    await page.keyboard.press("Escape")
    await expect(keysList(page)).toHaveCount(0)
    expect(await keyOn(page.getByRole("button", { name: /Record take/ }))).toBeNull()
    expect(await keyOn(page.getByRole("button", { name: /Finish/ }))).toBeNull()
  })

  test("M drops a marker where the take is, and opens its note straight away", async ({
    page,
  }) => {
    await savedTake(page)
    await page.getByRole("button", { name: "Forward 10 seconds" }).click()
    await page.keyboard.press("m")
    await expect.poll(() => callCount(page, "add_take_marker")).toBe(1)
    expect(((await calls(page, "add_take_marker"))[0].args[2] as number) > 0).toBe(true)
    // The thought about what just went wrong does not survive a hunt through
    // the interface.
    await expect(page.getByText("Marker at")).toBeVisible()
    await page.getByRole("button", { name: "Went wrong" }).click()
    await page.fill("input[aria-label='Marker note']", "guitar drifts here")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect
      .poll(async () => (await calls(page, "update_take_marker")).at(-1)?.args.slice(3))
      .toEqual(["guitar drifts here", 3])
    // On the chip without ever going away from the take and back.
    await expect(page.getByText("guitar drifts here").first()).toBeVisible()

    // On top of an existing mark the button opens it rather than adding a
    // second one; somewhere else it adds, and both live side by side.
    await page.getByRole("button", { name: "To start" }).click()
    await expect(page.getByRole("button", { name: "Edit marker", exact: true })).toHaveCount(1)
    await page.getByRole("button", { name: "Edit marker", exact: true }).click()
    await expect(page.getByText("Marker at")).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Back 10 seconds" }).click()
    await page.getByRole("button", { name: "Forward 10 seconds" }).click()
    await expect(page.locator("button[aria-label^='Remove marker at']")).toHaveCount(2)
    await expect(page.locator("button[aria-label^='Edit marker at']")).toHaveCount(2)
  })

  test("still opens when the chosen output is gone, and says where the sound went", async ({
    page,
  }) => {
    // A saved device index goes stale the moment the interface is unplugged.
    await savedTake(page)
    await page.getByRole("button", { name: "Songs", exact: true }).click()
    await page.locator("button[aria-label^='Take 1 Pałyn']").click()
    await expect(page.locator("button[aria-label^='Take 1 Pałyn']")).toHaveAttribute(
      "aria-current",
      "true"
    )
    await page.evaluate(() => {
      ;(window as unknown as { __OUTPUT_GONE__: boolean }).__OUTPUT_GONE__ = true
    })
    await page.locator("button[aria-label^='Take 2 Pałyn 2']").click()
    await expect(page.getByText("using the system output")).toBeVisible()
    await expect(page.getByRole("button", { name: "Mute Guitar" })).toHaveCount(1)
  })

  test("Escape closes a dialog first, and the take second", async ({ page }) => {
    await savedTake(page)
    await page.getByRole("button", { name: "Delete take Pałyn 2" }).click()
    // Radix's own focus lands on Cancel; a click on the words moves it to the
    // dialog itself, a DIV, which a guard by tag could not see.
    await page.getByText("go to the Trash").click()
    // A take that is not in the cloud says nothing about the cloud.
    await expect(page.getByRole("dialog")).not.toContainText("cloud")
    // The keydown itself, as the window sees it: a real press would also work
    // whatever button had focus and confound this.
    const toggles = await callCount(page, "player_toggle")
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }))
    )
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(await callCount(page, "player_toggle")).toBe(toggles)
    expect(await callCount(page, "delete_take")).toBe(0)
    await expect(timeline(page)).toHaveCount(1)

    // With no dialog left to claim it, the same key gives the take up, and
    // Space and Escape go back to Record and Finish.
    await page.keyboard.press("Escape")
    await expect(timeline(page)).toHaveCount(0)
    await expect.poll(() => keyOn(page.getByRole("button", { name: /Record take/ }))).toBe("Space")
    await expect.poll(() => keyOn(page.getByRole("button", { name: /Finish/ }))).toBe("Esc")

    // Played from its row, a take has Space until Escape puts it away.
    await page
      .locator("[aria-label='Rehearsal overview']")
      .getByRole("button", { name: "Play Pałyn 2" })
      .click()
    await expect(page.getByRole("button", { name: "Pause Pałyn 2" })).toBeVisible()
    await expect(timeline(page)).toHaveCount(0)
    await expect.poll(() => keyOn(page.getByRole("button", { name: /Record take/ }))).toBeNull()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Play Pałyn 2" })).toBeVisible()
    await expect.poll(() => keyOn(page.getByRole("button", { name: /Record take/ }))).toBe("Space")
  })

  test("renames the take and the rehearsal, and keeps the player on screen", async ({ page }) => {
    await savedTake(page)
    await page.getByRole("button", { name: "Rename take Pałyn 2" }).click()
    await page.getByRole("dialog").locator("input").fill("Pałyn (best)")
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click()
    await expect.poll(async () => (await calls(page, "rename_take")).at(-1)?.args[2]).toBe("Pałyn (best)")
    await page.getByRole("button", { name: "Rename rehearsal" }).click()
    await page.getByRole("dialog").locator("input").fill("Tuesday jam")
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click()
    await expect
      .poll(async () => (await calls(page, "rename_rehearsal")).at(-1)?.args[1])
      .toBe("Tuesday jam")
    // Renaming reopens the player from zero; the take stays picked and on
    // screen through that.
    await expect(transport(page).getByRole("button", { name: "Repeat" })).toHaveCount(1)
  })
})

test.describe("the region", () => {
  const lastLoop = async (page: Page) =>
    (await calls(page, "player_set_loop")).at(-1)?.args as (number | null)[] | undefined

  test("is drawn across the tracks, and a press that does not travel seeks", async ({ page }) => {
    await savedTake(page)
    await transport(page).getByRole("button", { name: "Repeat" }).click()
    // Repeat with no region covers the whole take.
    await expect.poll(() => lastLoop(page)).toEqual([0, TAKE_SECONDS])
    // One surface serves both, sitting exactly over the lanes.
    const box = (await timeline(page).boundingBox())!
    const lane = (await page.locator("canvas").first().locator("xpath=..").boundingBox())!
    expect(Math.abs(lane.x - box.x)).toBeLessThan(1.5)
    expect(Math.abs(lane.width - box.width)).toBeLessThan(1.5)

    await dragRegion(page, 0.25, 0.75)
    await expect.poll(async () => (await lastLoop(page))?.[0] as number).toBeCloseTo(TAKE_SECONDS * 0.25, 0)
    expect(((await lastLoop(page))![1] as number)).toBeCloseTo(TAKE_SECONDS * 0.75, 0)
    const drawn = (await lastLoop(page))!
    // Cleared, Python is told there is no region left: the loop is the whole
    // take again.
    await page.getByRole("button", { name: "Clear the loop region" }).click()
    await expect
      .poll(async () => {
        const v = await lastLoop(page)
        return (v?.[0] === null && v?.[1] === null) || (v?.[0] === 0 && v?.[1] === TAKE_SECONDS)
      })
      .toBe(true)
    await dragRegion(page, 0.75, 0.25)
    // The other way gives the same region.
    await expect.poll(async () => (await lastLoop(page))?.[0] as number).toBeCloseTo(drawn[0] as number, 0)
    expect(((await lastLoop(page))![1] as number)).toBeCloseTo(drawn[1] as number, 0)

    const loops = await callCount(page, "player_set_loop")
    const seeks = await callCount(page, "player_seek")
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
    expect(await callCount(page, "player_set_loop")).toBe(loops)
  })

  test("carries its times, a loop and a cross, and Crop under them", async ({ page }) => {
    // Clear and Crop are about the region, so they are on it. In the
    // transport they were far from the stretch they act on. Clear is a cross
    // beside the times, the way a tag is closed: a button that said Clear
    // under them read as clearing that part of the take. The loop beside it
    // is Repeat, so the hand that drew the region need not go up for it.
    await savedTake(page)
    await dragRegion(page, 0.25, 0.75)
    await expect(transport(page).getByRole("button", { name: "Clear the loop region" })).toHaveCount(0)
    await expect(transport(page).getByRole("button", { name: "Crop to the region" })).toHaveCount(0)
    const chip = (await page.locator("[data-region-span]").boundingBox())!
    const clear = page.getByRole("button", { name: "Clear the loop region" })
    const loop = page.getByRole("button", { name: "Loop the region" })
    const clearAt = (await clear.boundingBox())!
    const loopAt = (await loop.boundingBox())!
    const cropAt = (await page.getByRole("button", { name: "Crop to the region" }).boundingBox())!
    const beside = (b: { x: number; y: number; height: number }) =>
      b.x >= chip.x + chip.width - 1 && Math.abs(b.y + b.height / 2 - (chip.y + chip.height / 2)) < 4
    expect(beside(clearAt)).toBe(true)
    expect((await clear.innerText()).trim()).toBe("")
    expect(beside(loopAt)).toBe(true)
    expect(loopAt.x).toBeLessThan(clearAt.x)
    expect(cropAt.y).toBeGreaterThanOrEqual(chip.y + chip.height - 1)
    expect(Math.abs(cropAt.x - chip.x)).toBeLessThan(2)

    const repeat = transport(page).getByRole("button", { name: "Repeat" })
    await expect(repeat).toHaveAttribute("aria-pressed", "false")
    await loop.click()
    await expect(repeat).toHaveAttribute("aria-pressed", "true")
    await expect(loop).toHaveAttribute("aria-pressed", "true")
    await loop.click()
    await expect(repeat).toHaveAttribute("aria-pressed", "false")

    // They sit on the tracks, where a press starts a region and a click
    // seeks: a press on them is theirs alone.
    const seeks = await callCount(page, "player_seek")
    await clear.click()
    await expect(clear).toHaveCount(0)
    await expect(page.locator("[data-region-span]")).toHaveCount(0)
    expect(await callCount(page, "player_seek")).toBe(seeks)

    // Near the right edge they stay on the timeline rather than off its end.
    await dragRegion(page, 0.9, 0.99)
    const edge = (await timeline(page).boundingBox())!
    for (const name of ["Crop to the region", "Clear the loop region"]) {
      const b = (await page.getByRole("button", { name }).boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(edge.x + edge.width)
    }
    await page.getByRole("button", { name: "Clear the loop region" }).click()
    await expect(page.locator("[data-region-span]")).toHaveCount(0)
  })

  test("moves one edge at a time, taken hold of on the ruler", async ({ page }) => {
    // Grabbing B must not drag A along with it. The grip lives in the ruler
    // band, not down the whole lane height. With Repeat on, so that each
    // change goes to Python and can be read there.
    await savedTake(page)
    await transport(page).getByRole("button", { name: "Repeat" }).click()
    await dragRegion(page, 0.25, 0.75)
    await expect.poll(async () => (await lastLoop(page))?.[1] as number).toBeCloseTo(TAKE_SECONDS * 0.75, 0)
    const box = (await timeline(page).boundingBox())!
    await page.mouse.move(box.x + box.width * 0.75, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.5, box.y + 12, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await lastLoop(page))?.[1] as number).toBeCloseTo(TAKE_SECONDS * 0.5, 0)
    expect(Math.abs(((await lastLoop(page))![0] as number) - TAKE_SECONDS * 0.25)).toBeLessThan(0.05)
    // A six-second take across this width gets one-second steps on the ruler.
    await expect(page.getByRole("group", { name: "Timeline clock" })).toContainText("0:05")
  })
})

test.describe("the mix", () => {
  test("a track's meter says what came out, after its mute", async ({ page }) => {
    // Measured in the mix rather than from the picture, so it says nothing
    // until something plays.
    await savedTake(page)
    const meter = page.getByRole("meter", { name: "Guitar level" })
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect.poll(async () => Number(await meter.getAttribute("aria-valuenow"))).toBeGreaterThan(0)
    await page.getByRole("button", { name: "Mute Guitar" }).click()
    await expect(meter).toHaveAttribute("aria-valuenow", "0")
    await page.getByRole("button", { name: "Mute Guitar" }).click()
    await page.getByRole("button", { name: "Pause", exact: true }).click()
    await expect(meter).toHaveAttribute("aria-valuenow", "0")
  })

  test("mute and solo reach Python, and Space plays rather than pressing them again", async ({
    page,
  }) => {
    await savedTake(page)
    await page.getByRole("button", { name: "Mute Guitar" }).click()
    await page.getByRole("button", { name: "Solo Vocals" }).click()
    await expect.poll(async () => (await calls(page, "player_set_muted")).at(-1)?.args).toEqual(["Guitar", true])
    await expect.poll(async () => (await calls(page, "player_set_solo")).at(-1)?.args).toEqual(["Vocals"])

    // Solo was clicked last and keeps focus; Space is the player's.
    const toggles = await callCount(page, "player_toggle")
    const solos = await callCount(page, "player_set_solo")
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
    expect(await callCount(page, "player_set_solo")).toBe(solos)
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 2)

    // Reached with Tab, a button is what Space is aimed at: that is how a
    // keyboard presses one.
    await page.focus("button[aria-label='Mute Guitar']")
    await page.keyboard.press("Tab")
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "Solo Guitar"
    )
    await page.keyboard.press("Space")
    await expect.poll(async () => (await calls(page, "player_set_solo")).at(-1)?.args).toEqual(["Guitar"])
    expect(await callCount(page, "player_toggle")).toBe(toggles + 2)
  })

  test("one master turns the whole take down, for listening only", async ({ page }) => {
    await savedTake(page)
    const master = page.getByRole("slider", { name: "Master volume", exact: true })
    await expect(master).toHaveValue("1")
    // Under the tracks, below the last of them.
    const vocals = (await page.getByRole("slider", { name: "Vocals volume" }).boundingBox())!
    const spot = (await master.boundingBox())!
    expect(spot.y).toBeGreaterThan(vocals.y)

    const mixes = await callCount(page, "save_mix")
    await page.mouse.click(spot.x + spot.width * 0.3, spot.y + spot.height / 2)
    await expect.poll(async () => (await calls(page, "player_set_master")).at(-1)?.args[0] as number).toBeLessThan(0.5)
    const turned = (await calls(page, "player_set_master")).at(-1)!.args[0]
    // Kept for the next take without being asked, while the balance the
    // cloud mix is made from is left alone.
    await expect.poll(async () => (await calls(page, "save_master_volume")).at(-1)?.args[0]).toBe(turned)
    expect(await callCount(page, "save_mix")).toBe(mixes)

    // A fader is an input, and every key used to go dead once one had been
    // touched.
    const toggles = await callCount(page, "player_toggle")
    await page.keyboard.press("Space")
    await expect.poll(() => callCount(page, "player_toggle")).toBe(toggles + 1)
    const masterMeter = page.getByRole("meter", { name: "Master level" })
    await expect.poll(async () => Number(await masterMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(0)
    await page.keyboard.press("Space")
    await expect(masterMeter).toHaveAttribute("aria-valuenow", "0")
    const level = await master.inputValue()

    // The same for every other key: a fader dragged with the mouse keeps none.
    await page.mouse.click(spot.x + spot.width * 0.3, spot.y + spot.height / 2)
    let seeks = await callCount(page, "player_seek")
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
    await expect(master).toHaveValue(level)
    await page.mouse.click(spot.x + spot.width * 0.3, spot.y + spot.height / 2)
    seeks = await callCount(page, "player_seek")
    await page.keyboard.press("Home")
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
    await expect(master).toHaveValue(level)

    // Reached with the keyboard, the fader is what the arrows are aimed at.
    await page.focus("input[aria-label='Vocals volume']")
    await page.keyboard.press("Tab")
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "Master volume"
    )
    seeks = await callCount(page, "player_seek")
    await page.keyboard.press("ArrowLeft")
    await expect.poll(async () => Number(await master.inputValue())).toBeLessThan(Number(level))
    expect(await callCount(page, "player_seek")).toBe(seeks)

    // And another take opens at the volume the last one was left at.
    const left = await master.inputValue()
    await page.getByRole("button", { name: "Songs", exact: true }).click()
    await page.locator("button[aria-label^='Take 1 Pałyn']").click()
    await expect(page.locator("button[aria-label^='Take 1 Pałyn']")).toHaveAttribute("aria-current", "true")
    await expect(master).toHaveValue(left)
  })
})

test.describe("a track's plate", () => {
  test("says what the track is: its icon, and one channel or two", async ({ page }) => {
    await openApp(page, {
      before: `window.__BAND_ICONS__ = {Guitar: 'guitar-electric'};
        window.__STEREO_TRACKS__ = ['Vocals'];`,
    })
    await startRehearsal(page)
    await recordTake(page, 1)
    const guitar = page.locator("[data-plate='Guitar']")
    const vocals = page.locator("[data-plate='Vocals']")
    await expect(guitar.locator("[data-icon]")).toHaveAttribute("data-icon", "guitar-electric")
    await expect(vocals.locator("[data-icon]")).toHaveAttribute("data-icon", "other")
    // Read from the file: how many channels it has, not how it was set up.
    await expect(guitar).toContainText("Mono")
    await expect(vocals).toContainText("Stereo")

    // A stereo track's meter is in two, left above right, so a dead side
    // shows while it plays.
    const fills = (name: string) =>
      page.getByRole("meter", { name: `${name} level` }).locator("[data-fill]")
    await expect(fills("Guitar")).toHaveCount(1)
    await expect(fills("Vocals")).toHaveCount(2)
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect
      .poll(async () => {
        const [left, right] = await fills("Vocals").evaluateAll((els) =>
          els.map((e) => e.getBoundingClientRect().width)
        )
        return left > 0 && right > 0 && right < left
      })
      .toBe(true)
  })

  test("is no taller than it needs, however tall the window", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 1400 })
    await review(page)
    for (const name of ["Guitar", "Vocals"]) {
      const box = (await page.locator(`[data-plate='${name}']`).boundingBox())!
      expect(box.height).toBeLessThanOrEqual(96)
    }
  })
})

test.describe("zooming the timeline", () => {
  // Fifteen seconds of a nine-minute take is twenty pixels wide: drawing a
  // region is at its worst exactly where it is needed most.

  /** Where a click at this fraction of the width lands, in seconds. */
  async function seekAt(page: Page, ratio: number) {
    const box = (await timeline(page).boundingBox())!
    const seeks = await callCount(page, "player_seek")
    await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
    await expect.poll(() => callCount(page, "player_seek")).toBe(seeks + 1)
    return (await calls(page, "player_seek")).at(-1)!.args[0] as number
  }

  async function wheelAt(page: Page, ratio: number, dx: number, dy: number, holding?: string) {
    const box = (await timeline(page).boundingBox())!
    await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2)
    if (holding) await page.keyboard.down(holding)
    await page.mouse.wheel(dx, dy)
    if (holding) await page.keyboard.up(holding)
  }

  const zoomAt = (page: Page, ratio: number, dy: number) => wheelAt(page, ratio, 0, dy, "Control")
  const whole = (page: Page) => page.getByRole("button", { name: "Whole take" })
  const clock = (page: Page) => page.getByRole("group", { name: "Timeline clock" })

  /** The times written on the ruler, in seconds. */
  const clockLabels = async (page: Page) =>
    (await clock(page).locator("span.tnum").allInnerTexts()).map((t) => {
      const [m, s] = t.trim().split(":")
      return Number(m) * 60 + Number(s)
    })

  /** Where the window starts and how long it is, from where clicks near
   *  its two ends land. */
  async function viewNow(page: Page) {
    const t02 = await seekAt(page, 0.02)
    const t98 = await seekAt(page, 0.98)
    const length = (t98 - t02) / 0.96
    return { start: t02 - 0.02 * length, length }
  }

  test("the wheel on its own is the page's, and Ctrl and the wheel zoom about the pointer", async ({
    page,
  }) => {
    await savedTake(page)
    const wholeLabels = await clockLabels(page)
    // It used to zoom, and a page with the tracks below the fold could not
    // be scrolled from the middle of it.
    await wheelAt(page, 0.3, 0, -500)
    await expect(whole(page)).toHaveCount(0)
    expect(await clockLabels(page)).toEqual(wholeLabels)
    const leftToPage = await timeline(page).evaluate((el) =>
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))
    )
    expect(leftToPage).toBe(true)

    const before = await seekAt(page, 0.3)
    await zoomAt(page, 0.3, -500)
    await expect(whole(page)).toHaveCount(1)
    // A ruler with nothing left on it also reads differently from the whole
    // take's, so the zoomed ruler has to have a clock of the part shown.
    const zoomed = await clockLabels(page)
    expect(zoomed).not.toEqual(wholeLabels)
    const from = await seekAt(page, 0.02)
    const to = await seekAt(page, 0.98)
    expect(zoomed.length).toBeGreaterThan(0)
    expect(zoomed[0]).toBeGreaterThanOrEqual(from - 0.1)
    expect(zoomed[0]).toBeLessThanOrEqual(to + 0.1)
    // Anchored, not centred: the second under the pointer stays under it,
    // which is the difference between aiming and hunting.
    expect(Math.abs((await seekAt(page, 0.3)) - before)).toBeLessThan(0.2)
  })

  test("sideways, or Shift and the wheel, moves along the take", async ({ page }) => {
    await savedTake(page)
    await zoomAt(page, 0.3, -500)
    await expect(whole(page)).toHaveCount(1)
    const mid = await seekAt(page, 0.6)
    await wheelAt(page, 0.6, 200, 0)
    await expect.poll(() => seekAt(page, 0.6)).toBeGreaterThan(mid)
    // The same gesture on a mouse, but not the same event: Chromium leaves
    // the value in deltaY, while WebKit, which this app runs in on macOS,
    // moves it to deltaX. Dispatched as WebKit sends it.
    const shifted = await seekAt(page, 0.6)
    await timeline(page).evaluate((el) =>
      el.dispatchEvent(
        new WheelEvent("wheel", { shiftKey: true, deltaX: 200, deltaY: 0, bubbles: true, cancelable: true })
      )
    )
    await expect.poll(() => seekAt(page, 0.6)).toBeGreaterThan(shifted)
  })

  test("Whole take gives the whole take back, and on a Mac Cmd zooms too", async ({ page }) => {
    await savedTake(page)
    const wholeClock = await clock(page).innerText()
    await zoomAt(page, 0.3, -500)
    await whole(page).click()
    await expect(whole(page)).toHaveCount(0)
    await expect.poll(() => clock(page).innerText()).toBe(wholeClock)
    // Dispatched from the page: headless Chromium sends no wheel with Meta.
    const box = (await timeline(page).boundingBox())!
    await timeline(page).evaluate(
      (el, [x, y]) =>
        el.dispatchEvent(
          new WheelEvent("wheel", { metaKey: true, deltaY: -500, clientX: x, clientY: y, bubbles: true, cancelable: true })
        ),
      [box.x + box.width * 0.5, box.y + box.height / 2]
    )
    await expect(whole(page)).toHaveCount(1)
  })

  test.describe("the map of the whole take", () => {
    // Zoomed in, only two times in a corner said which part of the take was
    // on screen. The map above the ruler says it at a glance, and goes
    // elsewhere by dragging the frame or clicking the map. It is there zoomed
    // out too, with nothing framed: a row that came and went with the zoom
    // moved every track down, and a frame round all of it was only an edge.
    const map = (page: Page) => page.getByRole("scrollbar", { name: "Part of the take on screen" })
    const frame = (page: Page) => map(page).locator("[data-view-frame]")

    async function frameOnMap(page: Page) {
      const strip = (await map(page).boundingBox())!
      const f = (await frame(page).boundingBox())!
      return {
        a: (f.x - strip.x) / strip.width,
        b: (f.x + f.width - strip.x) / strip.width,
        strip,
        f,
      }
    }

    test("is there zoomed out with nothing framed, and moves nothing down when zoomed", async ({
      page,
    }) => {
      await savedTake(page)
      await expect(map(page)).toHaveCount(1)
      await expect(frame(page)).toHaveCount(0)
      await expect(whole(page)).toHaveCount(0)
      const before = (await timeline(page).boundingBox())!.y
      await zoomAt(page, 0.5, -500)
      await expect(whole(page)).toHaveCount(1)
      expect(Math.abs((await timeline(page).boundingBox())!.y - before)).toBeLessThan(1)
      // Its frame is the part on screen.
      const { start, length } = await viewNow(page)
      const { a, b } = await frameOnMap(page)
      expect(Math.abs(a - start / TAKE_SECONDS)).toBeLessThan(0.02)
      expect(Math.abs(b - (start + length) / TAKE_SECONDS)).toBeLessThan(0.02)
      // Whole take is beside the map, where the eye already is, and gives the
      // whole take back with the frame gone.
      const w = (await whole(page).boundingBox())!
      const m = (await map(page).boundingBox())!
      expect(w.x + w.width).toBeLessThanOrEqual(m.x)
      expect(Math.abs(w.y + w.height / 2 - (m.y + m.height / 2))).toBeLessThan(8)
      await whole(page).click()
      await expect(frame(page)).toHaveCount(0)
    })

    test("moves the window by its frame, or to where it is clicked", async ({ page }) => {
      await savedTake(page)
      await zoomAt(page, 0.5, -500)
      await expect(frame(page)).toHaveCount(1)
      const { start, length } = await viewNow(page)
      const { strip, f } = await frameOnMap(page)
      const cx = f.x + f.width / 2
      const cy = f.y + f.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx - strip.width * 0.2, cy, { steps: 8 })
      await page.mouse.up()
      const moved = await viewNow(page)
      expect(Math.abs(start - moved.start - 0.2 * TAKE_SECONDS)).toBeLessThan(0.3)
      expect(Math.abs(moved.length - length)).toBeLessThan(0.2)

      await page.mouse.click(strip.x + strip.width * 0.9, strip.y + strip.height / 2)
      const expected = Math.min(TAKE_SECONDS - length, Math.max(0, 0.9 * TAKE_SECONDS - length / 2))
      await expect.poll(async () => Math.abs((await viewNow(page)).start - expected)).toBeLessThan(0.3)
    })
  })

  test("the region's buttons go with its times when the view is elsewhere", async ({ page }) => {
    // Zoomed to another part of the take there is nothing for them to sit
    // under; the map still shows where the region is.
    await savedTake(page)
    await dragRegion(page, 0.55, 0.72)
    await expect(page.getByRole("button", { name: "Clear the loop region" })).toHaveCount(1)
    await zoomAt(page, 0.05, -900)
    await expect(page.getByRole("button", { name: "Clear the loop region" })).toHaveCount(0)
    await expect(page.locator("[data-region-span]")).toHaveCount(0)
    await expect(
      page.getByRole("scrollbar", { name: "Part of the take on screen" }).locator("[data-map-region]")
    ).toHaveCount(1)
    await whole(page).click()
    await expect(page.getByRole("button", { name: "Clear the loop region" })).toHaveCount(1)
  })

  test("draws only the marks inside the window, and says when it is at its closest", async ({
    page,
  }) => {
    await savedTake(page)
    // A second mark, at the end, beside the one at the start.
    await page.getByRole("button", { name: "Forward 10 seconds" }).click()
    await page.keyboard.press("m")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    const marks = () =>
      page.locator("[data-marker-at]").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.markerAt)))
    await expect.poll(async () => (await marks()).length).toBe(2)

    await zoomAt(page, 0.98, -900)
    // Past this the wheel simply stops answering, and without a word saying
    // so that reads as the zoom having broken. Said on the map: beside Whole
    // take, "0:04 – 0:06 · closest" broke over two lines.
    await expect(page.getByText("closest")).toHaveCount(1)
    const range = page.locator("[data-view-range]")
    expect((await range.boundingBox())!.height).toBeLessThan(20)
    await expect(range).not.toContainText("closest")
    // Right up against the end: the mark there is still drawn, the one at the
    // start is not, pinned to the edge pointing at the wrong second.
    await wheelAt(page, 0.5, 300, 0)
    await expect.poll(marks).toEqual([expect.any(Number)])
    expect((await marks())[0]).toBeGreaterThanOrEqual(TAKE_SECONDS / 2)
  })

  test("drops the region's times once the view has nothing to do with it", async ({ page }) => {
    // A chip pinned to the edge of the wrong part of the take is worse than
    // no chip.
    await savedTake(page)
    await dragRegion(page, 0.05, 0.2)
    await expect(page.locator("[data-region-span]")).toHaveCount(1)
    await zoomAt(page, 0.98, -900)
    await expect(page.locator("[data-region-span]")).toHaveCount(0)
    // Another go at the song keeps the zoom and the region (goes in the
    // player, D2), so the chip stays away there too.
    await page.getByRole("button", { name: "Songs", exact: true }).click()
    await page.locator("button[aria-label^='Take 1 Pałyn']").click()
    await expect(page.locator("button[aria-label^='Take 1 Pałyn']")).toHaveAttribute("aria-current", "true")
    await expect(whole(page)).toHaveCount(1)
    await expect(page.locator("[data-region-span]")).toHaveCount(0)
  })

  test("fetches the waveform again for the part on screen, once the wheel settles", async ({
    page,
  }) => {
    // Stretching the same bars over two seconds shows no more than over nine
    // minutes. Not on every notch, though: that would be a burst of calls
    // for a picture nobody has finished aiming yet. Six notches 16 ms apart,
    // sent from inside the page the way a wheel sends them: six separate
    // wheel calls from the test came further apart than the settle time on a
    // busy runner, and failed the macOS build of 0.7.13.
    await savedTake(page)
    const ranged = async () =>
      (await calls(page, "take_media")).filter((c) => c.args.length > 2 && c.args[2] !== null)
    const before = (await ranged()).length
    const box = (await timeline(page).boundingBox())!
    await page.evaluate(
      ([x, y]) =>
        new Promise<void>((done) => {
          const el = document.querySelector("[aria-label='Take timeline']")!
          let left = 6
          const notch = () => {
            el.dispatchEvent(
              new WheelEvent("wheel", { deltaY: -120, clientX: x, clientY: y, ctrlKey: true, bubbles: true, cancelable: true })
            )
            if (--left > 0) setTimeout(notch, 16)
            else done()
          }
          notch()
        }),
      [box.x + box.width * 0.5, box.y + box.height / 2]
    )
    await expect.poll(async () => (await ranged()).length - before).toBeGreaterThanOrEqual(1)
    // Give it the settle time again, then count.
    await page.waitForTimeout(600)
    const fresh = (await ranged()).length - before
    expect(fresh).toBeLessThanOrEqual(3)
    const last = (await ranged()).at(-1)!.args as number[]
    expect(last[3]).toBeGreaterThan(last[2])
  })
})

test.describe("cropping a saved take", () => {
  // Trimming a take to the region is what makes a nine-minute take that
  // holds three minutes of music into a three-minute take.

  test("says why Crop is off, in the two opposite ways it can be", async ({ page }) => {
    // The button's own title cannot say it: a disabled button is never
    // hovered, so the reason is on screen beside it.
    await savedTake(page)
    await dragRegion(page, 0.0, 1.0)
    await expect(page.getByRole("button", { name: "Crop to the region" })).toBeDisabled()
    await expect(page.getByText("that is the whole take")).toHaveCount(1)
    // A slip of the mouse is the opposite mistake, and the advice for one is
    // no use for the other.
    await dragRegion(page, 0.4, 0.45)
    await expect(page.getByRole("button", { name: "Crop to the region" })).toBeDisabled()
    await expect(page.getByText("at least a second to crop")).toHaveCount(1)
  })

  test("trims the take to the region, and asks first", async ({ page }) => {
    await savedTake(page)
    await dragRegion(page, 0.25, 0.75)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    const asked = page.getByRole("dialog")
    // It names the part being kept, and where what it removes is going.
    await expect(asked).toContainText("Keep only 0:01")
    await expect(asked).toContainText(/Trash|_deleted/)
    await page.getByRole("button", { name: "Crop", exact: true }).click()
    await expect.poll(() => callCount(page, "crop_take")).toBe(1)
    const [, , from, to] = (await calls(page, "crop_take"))[0].args as number[]
    expect(Math.abs(from - TAKE_SECONDS * 0.25)).toBeLessThan(0.4)
    expect(Math.abs(to - TAKE_SECONDS * 0.75)).toBeLessThan(0.4)
    // Three seconds, not six, and the region gone: the take is that region.
    await expect(page.locator("span", { hasText: "/ 0:03" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear the loop region" })).toHaveCount(0)
  })

  test("says where the original is when it could not be moved out of the way", async ({
    page,
  }) => {
    // A crop can go through while the sweep of the original fails — a full
    // disk, a permissions problem — and that must not vanish: the take as it
    // was recorded is somewhere outside the Trash, and this is the only thing
    // that says where. The answer is held back meanwhile, which is also the
    // way to see the screen while long tracks are rewritten.
    await savedTake(page)
    await page.evaluate(() => {
      const w = window as unknown as {
        pywebview: { api: Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>> }
        __RELEASE_CROP__: (() => void) | null
      }
      const real = w.pywebview.api.crop_take
      w.pywebview.api.crop_take = async (...args: unknown[]) => {
        await new Promise<void>((go) => {
          w.__RELEASE_CROP__ = go
        })
        const res = await real(...args)
        return {
          ...res,
          error: "Could not remove it: no space left on device",
          location: "/rec/Tuesday jam/_deleted/take 2 (original)",
        }
      }
    })
    await dragRegion(page, 0.2, 0.8)
    await page.getByRole("button", { name: "Crop to the region" }).click()
    await page.getByRole("button", { name: "Crop", exact: true }).click()
    // A crop already running does not offer to run again: a second one would
    // cut the take the first one made.
    await expect(page.getByRole("button", { name: "Crop to the region" })).toBeDisabled()
    await page.evaluate(() => (window as unknown as { __RELEASE_CROP__: () => void }).__RELEASE_CROP__())
    const swept = page
      .locator("section[aria-label='Notifications'] [data-notice='warning']")
      .filter({ hasText: "could not be moved out of the way" })
    await expect(swept).toHaveCount(1)
    await expect(swept).toContainText("/rec/Tuesday jam/_deleted/take 2 (original)")
    // A warning, since the crop itself went through.
    await expect(page.getByRole("button", { name: "Crop to the region" })).toHaveCount(0)
    await expect(page.locator(".text-destructive", { hasText: "could not be moved out of the way" })).toHaveCount(0)
  })
})

test("a tick at the very end of the ruler does not push the lanes sideways", async ({ page }) => {
  // 10:06 puts the 10:00 tick at 99% of the ruler. Its label used to hang
  // past the edge, and the lanes' scroll container — overflow-y: auto makes
  // overflow-x auto as well — grew a horizontal scrollbar under the last
  // track. Headless Chromium hides scrollbars, so the overflow is measured.
  await openApp(page, { before: "window.__OLD_LENGTH_SEC__ = 606;" })
  await openHistory(page)
  await page.getByRole("button", { name: "Take 1 Pałyn" }).click()
  const ruler = page.getByRole("group", { name: "Timeline clock" })
  await expect(ruler.getByText("10:00")).toBeVisible()
  const sideways = await ruler.evaluate((r) => {
    let el = r.parentElement
    while (el && getComputedStyle(el).overflowY !== "auto") el = el.parentElement
    return el ? el.scrollWidth - el.clientWidth : 1
  })
  expect(sideways).toBeLessThanOrEqual(0)
  const inside = await ruler.evaluate((r) => {
    const edge = r.getBoundingClientRect().right
    return [...r.querySelectorAll("span")]
      .filter((s) => s.textContent === "10:00")
      .every((s) => s.getBoundingClientRect().right <= edge + 0.5)
  })
  expect(inside).toBe(true)
})
