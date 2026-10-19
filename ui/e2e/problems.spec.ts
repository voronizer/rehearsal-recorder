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

test("two problems while starting are both shown, and one Dismiss puts both away", async ({
  page,
  pageErrors,
}) => {
  // The bar used to keep only the last thing said, so a second problem at
  // start hid the first.
  await openApp(page, {
    before: `window.__STARTUP_PROBLEM__ = [
      {name: 'RemovalKept', message: 'A take you removed is still in its folder.'},
      {name: 'OperationalError', message: 'Could not read the history of Tuesday jam.'}];`,
  })
  const bar = problemBar(page)
  const said = bar.getByRole("listitem")
  await expect(said).toHaveCount(2)
  // In the order said, each with its own title line and its words.
  await expect(said.nth(0)).toContainText("Something went wrong in startup")
  await expect(said.nth(0)).toContainText("RemovalKept: A take you removed is still in its folder.")
  await expect(said.nth(1)).toContainText("Something went wrong in startup")
  await expect(said.nth(1)).toContainText(
    "OperationalError: Could not read the history of Tuesday jam."
  )
  // A screen reader says only the problem just added, not the whole list
  // again: an alert is read whole unless told otherwise.
  await expect(bar).toHaveAttribute("aria-atomic", "false")
  // Where the whole of them is written, once for all. Not spoken each time
  // its count goes up: it is read with the bar.
  await expect(bar.getByText(/crash\.log/)).toHaveCount(1)
  await expect(bar.getByText(/crash\.log/)).toHaveAttribute("aria-live", "off")
  await expect(bar.getByRole("button", { name: "Dismiss" })).toHaveCount(1)

  await bar.getByRole("button", { name: "Dismiss" }).click()
  await expect(bar).toHaveCount(0)
  expectedError(pageErrors, /startup failed/)
})

test("a long list of problems lists the first 20, counts the rest, and scrolls inside the bar", async ({
  page,
  pageErrors,
}) => {
  const many = Array.from(
    { length: 30 },
    (_, i) => `{name: 'OperationalError', message: 'Could not read rehearsal ${i + 1}.'}`
  )
  await openApp(page, { before: `window.__STARTUP_PROBLEM__ = [${many.join(",")}];` })
  const bar = problemBar(page)
  const said = bar.getByRole("listitem")
  // The first 20, since in a cascade the first is the cause; the other 10
  // are counted under them.
  await expect(said).toHaveCount(20)
  await expect(said.first()).toContainText("Could not read rehearsal 1.")
  await expect(said.last()).toContainText("Could not read rehearsal 20.")
  await expect(bar).toContainText(
    "and 10 more; all of them are in ~/.rehearsal-recorder/crash.log."
  )
  const view = page.viewportSize()!
  const box = (await bar.boundingBox())!
  // About 40% of the window at most, the crash.log line and Dismiss in it.
  expect(box.height).toBeLessThan(view.height / 2)
  await expect(bar.getByText(/crash\.log/)).toBeInViewport()
  await expect(bar.getByRole("button", { name: "Dismiss" })).toBeInViewport()
  // The last one is reached by scrolling the list, not the page.
  const last = said.last()
  await expect(last).not.toBeInViewport()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  // One Dismiss puts the list and the count away.
  await bar.getByRole("button", { name: "Dismiss" }).click()
  await expect(bar).toHaveCount(0)
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

test("a card that goes away and a Stop that fails are both said", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  await page.evaluate(() => {
    const w = window as unknown as { pywebview: { api: Record<string, unknown> } }
    w.pywebview.api.stop_take = async () => ({ ok: false, error: "The disk is full" })
  })
  await setFake(
    page,
    "__IFACE_GONE__",
    "Recording stopped: no sound has come from the audio interface for 3 seconds."
  )
  // Why the take ended, and why it could not be saved, are two things: the
  // second must not take the first one's place in the corner.
  await expect(notices(page, "error").filter({ hasText: "The disk is full" })).toHaveCount(1)
  await expect(notices(page, "warning").filter({ hasText: "no sound has come" })).toHaveCount(1)
})

test("a laptop that went to sleep ends the take, and says when", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
  // What the take says once the laptop is awake again.
  await setFake(
    page,
    "__IFACE_GONE__",
    "The laptop went to sleep at 21:14, so the take ends there. " +
      "Everything up to that moment is saved."
  )
  await expect(page.getByRole("button", { name: /Save take/ })).toBeVisible()
  expect(await callCount(page, "stop_take")).toBe(1)
  const said = notices(page, "warning")
  await expect(said).toHaveCount(1)
  await expect(said).toContainText("went to sleep at 21:14")
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
    "No sound from “Interface” for 3 seconds. It was unplugged, switched off or " +
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
    "Playback stopped: nothing has gone out through “Interface” for 3 seconds. It " +
      "was unplugged, switched off or stopped answering. Press play to try it again."
  )
  await expect(page.getByText("Playback stopped")).toBeVisible()
  await expect(play).toHaveCount(1)
  await setFake(page, "__OUTPUT_QUIET__", null)
  await play.click()
  await expect(pause).toBeVisible()
  await expect(page.getByText("Playback stopped")).toHaveCount(0)
})

test("a screen that cannot open keeps the window, says why on the bar, and can try again", async ({
  page,
  pageErrors,
}) => {
  // A take whose length cannot be read: the screen after it cannot be
  // drawn. Before, the whole window went blank, the bar with it.
  await openApp(page, {
    after:
      "const api = window.pywebview.api; const stop = api.stop_take;" +
      " api.stop_take = async (...a) => { const t = await stop(...a);" +
      " Object.defineProperty(t, 'duration_sec', { get() { throw new Error('no length') } }); return t; };",
  })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  const guard = page.locator("[data-crash-guard]")
  await expect(guard).toContainText("This screen could not open.")
  const bar = problemBar(page)
  await expect(bar).toContainText("this screen")
  await expect(bar).toContainText("crash.log")
  // The details went to crash.log too.
  expect(await callCount(page, "log_problem")).toBe(1)
  // Try again draws the app anew.
  await guard.getByRole("button", { name: "Try again" }).click()
  await expect(guard).toHaveCount(0)
  expectedError(pageErrors, /this screen failed/)
  expectedError(pageErrors, /no length/)
})
