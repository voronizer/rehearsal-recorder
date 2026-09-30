import {
  callCount,
  expect,
  expectedError,
  notices,
  openApp,
  problemBar,
  recordTake,
  setFake,
  startRehearsal,
  test,
} from "./app.ts"

// When something goes wrong: in Python, at startup, or with the card.

test("a call that fails in Python says what failed, and leaves the screen usable", async ({
  page,
  pageErrors,
}) => {
  // Save take on Windows raised inside Python; the promise rejected, no
  // screen caught it, and the button just dimmed and stayed dimmed.
  await openApp(page, {
    before: `window.__FAIL__ = {keep_take: "'charmap' codec can't encode characters"};`,
  })
  await startRehearsal(page)
  await recordTake(page)
  await page.getByRole("button", { name: /Save take/ }).click()
  const bar = problemBar(page)
  await expect(bar).toContainText("charmap")
  await expect(bar).toContainText("UnicodeEncodeError")
  // And where the whole of it is written down.
  await expect(bar).toContainText("crash.log")
  // The screen gets an answer, so Save take is not left dimmed, and it says
  // it could not save in its own place too.
  await expect(page.getByRole("button", { name: /Save take/ })).toBeEnabled()
  expect(await page.getByText("charmap").count()).toBeGreaterThanOrEqual(2)
  await page.getByRole("button", { name: "Dismiss" }).click()
  await expect(bar).toHaveCount(0)
  expectedError(pageErrors, /keep_take failed/)
})

test("a problem while starting is shown in the same bar, and asked for once", async ({
  page,
  pageErrors,
}) => {
  await openApp(page, {
    before: `window.__STARTUP_PROBLEM__ = {name: 'OperationalError',
      message: 'Could not read the history of Tuesday jam.'};`,
  })
  const bar = problemBar(page)
  await expect(bar).toContainText("Could not read the history")
  await expect(bar).toContainText("Tuesday jam")
  await expect(bar).toContainText("OperationalError")
  expect(await callCount(page, "startup_problems")).toBe(1)
  expectedError(pageErrors, /startup failed/)
})

test("a card that goes away mid-take stops it, and says why", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await setFake(
    page,
    "__IFACE_GONE__",
    "Recording stopped: no sound has come from the audio interface for 3 seconds."
  )
  await expect(page.getByRole("button", { name: /Save take/ })).toBeVisible()
  // Stopped without anyone pressing Stop, and the reason stays on screen
  // once the take is up for review.
  expect(await callCount(page, "stop_take")).toBe(1)
  const said = notices(page, "warning")
  await expect(said).toHaveCount(1)
  await expect(said).toContainText("no sound has come")

  // Plugged back in, the next take starts clean: "Recording stopped" in the
  // corner over a take that is recording would be a lie.
  await setFake(page, "__IFACE_GONE__", null)
  await page.getByRole("button", { name: /Save take/ }).click()
  await page.getByRole("button", { name: /Record take 2/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await expect(said).toHaveCount(0)
})

test("a card gone quiet during the signal check stops it, and says so in place", async ({
  page,
}) => {
  await openApp(page)
  await page.getByRole("button", { name: /Check signal/ }).click()
  await expect(page.getByText("Stop checking")).toBeVisible()
  await setFake(
    page,
    "__CHECK_QUIET__",
    "No sound from “Interface” for 3 seconds — it was unplugged, switched off or " +
      "stopped answering. Plug it back in and press Check signal."
  )
  await expect(page.getByRole("status").filter({ hasText: "No sound from" })).toHaveCount(1)
  await expect(page.getByRole("button", { name: /Check signal/ })).toHaveCount(1)
  expect(await callCount(page, "stop_monitor")).toBeGreaterThanOrEqual(1)
  await expect(notices(page)).toHaveCount(0)

  // Checking again clears it.
  await setFake(page, "__CHECK_QUIET__", null)
  await page.getByRole("button", { name: /Check signal/ }).click()
  await expect(page.getByText("Stop checking")).toBeVisible()
  await expect(page.getByText("No sound from")).toHaveCount(0)
})

test("a card gone quiet during playback pauses the take, and play tries it again", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  const play = page.getByRole("button", { name: "Play", exact: true })
  const pause = page.getByRole("button", { name: "Pause", exact: true })
  await play.click()
  await expect(pause).toBeVisible()
  await setFake(
    page,
    "__OUTPUT_QUIET__",
    "Playback stopped: nothing has gone out through “Interface” for 3 seconds — it " +
      "was unplugged, switched off or stopped answering. Press play to try it again."
  )
  await expect(page.getByText("Playback stopped")).toBeVisible()
  await expect(play).toHaveCount(1)
  await setFake(page, "__OUTPUT_QUIET__", null)
  await play.click()
  await expect(pause).toBeVisible()
  await expect(page.getByText("Playback stopped")).toHaveCount(0)
})
