import { callCount, calls, expect, keyOn, openApp, setFake, startButton, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Settings: the card, the folders, the appearance, and Under the hood.

async function openSettings(page: Page, before?: string) {
  await openApp(page, { before })
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page.locator("#input-device")).toBeVisible()
}

const group = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).first()

test("Settings has a way back on the keyboard too", async ({ page }) => {
  await openSettings(page)
  await expect.poll(() => keyOn(page.getByRole("button", { name: "Back" }))).toBe("Esc")
  await page.keyboard.press("Escape")
  await expect(startButton(page)).toBeVisible()
  await expect(page.locator("#input-device")).toHaveCount(0)
})

test("Settings is in groups, not one long column", async ({ page }) => {
  await openSettings(page, "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';")
  // It opens on Audio, with the folders not on that page.
  await expect(page.locator("#recordings-dir")).toHaveCount(0)
  for (const name of ["Audio", "Folders", "Appearance", "Under the hood"]) {
    await expect(group(page, name)).toHaveCount(1)
  }
  // The version belongs with the paths: both are what somebody quotes when
  // something has gone wrong.
  await group(page, "Under the hood").click()
  await expect(
    page.locator("[aria-label='About this copy']").getByText("0.2.0", { exact: true })
  ).toHaveCount(1)

  await group(page, "Folders").click()
  await expect(page.locator("#recordings-dir")).toHaveValue(/RehearsalRecordings/)
  await expect(page.locator("#cloud-dir")).toHaveValue(/Google Drive/)
  await expect(page.locator("#input-device")).toHaveCount(0)
  await page.getByRole("button", { name: "Choose recordings folder" }).click()
  await expect.poll(() => callCount(page, "choose_recordings_dir")).toBe(1)
})

test("the recording card and its rates are set in Settings", async ({ page }) => {
  await openSettings(page)
  // One audio system: choosing it would be a question with one answer.
  await expect(page.locator("#input-device-driver")).toHaveCount(0)
  await expect(page.locator("#output-device-driver")).toHaveCount(0)
  await expect(page.getByText("Each driver can offer")).toHaveCount(0)
  // Shown only where there was a choice, the outputs were a setting nobody
  // knew existed. With the system output there is nothing to pick, and it
  // says what to pick instead.
  const channels = page.locator("#output-channels")
  await expect(channels).toBeDisabled()
  await expect(channels).toContainText("1–2")
  await expect(page.getByText("choose the interface itself")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "44.1 kHz" })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "96 kHz" })).toHaveCount(1)

  await page.getByRole("button", { name: "48 kHz" }).click()
  await expect
    .poll(async () => (await calls(page, "set_recording_format")).at(-1)?.args.slice(1))
    .toEqual([48000, 24])
  // This card does 96 kHz only at 24 bit, so 16 stops being offered.
  await page.getByRole("button", { name: "96 kHz" }).click()
  await expect(page.getByRole("button", { name: "16 bit" })).toBeDisabled()
})

test("what cloud copies are written as, and nothing about copies without a folder", async ({
  page,
}) => {
  await openSettings(page, "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';")
  await group(page, "Folders").click()
  await page.getByRole("button", { name: "Lossless (FLAC)" }).click()
  await expect.poll(async () => (await calls(page, "set_cloud_format")).at(-1)?.args[0]).toBe("flac")
  await page.getByText("Send saved takes automatically").click()
  await expect.poll(async () => (await calls(page, "set_auto_publish")).at(-1)?.args[0]).toBe(true)
  await page.getByText("The original tracks").click()
  await expect.poll(async () => (await calls(page, "set_auto_publish")).at(-1)?.args[1]).toBe("tracks")

  // Turning sending off does not take the question with it: it also says
  // what Send starred sends, so it stays live, and its answer says what goes.
  await page.getByText("Send saved takes automatically").click()
  await expect(page.getByText("What gets published")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "The mix" })).toBeEnabled()
  await expect(page.getByText("Every track as recorded")).toHaveCount(1)

  // The cloud folder is the gate. Without one none of the questions about a
  // copy have a subject: they are not greyed out but gone, and the folder
  // says the whole of it.
  await page.getByText("Forget the cloud folder").click()
  await expect.poll(() => callCount(page, "clear_cloud_dir")).toBe(1)
  const field = page.locator("#cloud-dir")
  const says = (await field.inputValue()) + " " + ((await field.getAttribute("placeholder")) ?? "")
  expect(says).toContain("Not set")
  await expect(page.getByRole("button", { name: "Lossless (FLAC)" })).toHaveCount(0)
  await expect(page.locator("#auto-publish")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "The mix" })).toHaveCount(0)
  await expect(page.getByText("Only the copies are affected")).toHaveCount(0)
})

test("the theme and the scale apply at once, and are kept", async ({ page }) => {
  await openSettings(page)
  await group(page, "Appearance").click()
  await page.getByRole("button", { name: "Light", exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
  await page.getByRole("button", { name: "Scale 130 percent" }).click()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
    .toBe("20.8px")
  expect(await callCount(page, "save_appearance")).toBeGreaterThanOrEqual(2)
})

test.describe("Under the hood", () => {
  // The page someone opens when something has gone wrong: what this copy is
  // and runs on, where it keeps things, a report to paste into a message,
  // and --audio-probe for someone with no command line.
  test.use({
    viewport: { width: 1180, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  })

  async function underTheHood(page: Page) {
    await openApp(page, { before: "window.__CHECK_MS__ = 900;" })
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("button", { name: "Under the hood", exact: true }).first().click()
    await expect(page.locator("[aria-label='About this copy']")).toBeVisible()
  }

  const check = (page: Page) => page.locator("[aria-label='Interface check']")

  test("says which copy this is, what it runs on, and what it records with", async ({ page }) => {
    await underTheHood(page)
    const about = page.locator("[aria-label='About this copy']")
    await expect(about).toContainText("0.2.0")
    await expect(about).toContainText("from source")
    // The audio systems on the machine, each with its devices, and the one
    // the interface records through standing out.
    const systems = page.getByRole("list", { name: "Audio systems" })
    await expect(systems.getByRole("listitem")).toHaveCount(3)
    await expect(systems).toContainText("ASIO")
    await expect(systems.getByRole("listitem").filter({ hasText: "ASIO" })).toHaveAttribute(
      "data-in-use"
    )
    await expect(page.locator("main")).toContainText("X32 USB")
  })

  test("copies a report for a bug, and opens what it points at", async ({ page }) => {
    await underTheHood(page)
    await page.getByRole("button", { name: "Copy details for a bug report" }).click()
    // Said on the button itself, whose name stays what it does.
    await expect(page.locator("button", { hasText: "Copied" })).toBeVisible()
    expect(await callCount(page, "bug_report")).toBe(1)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /^РЭХА 0\.2\.0/
    )

    await page.getByRole("button", { name: "Show the crash log" }).click()
    await expect.poll(async () => (await calls(page, "show_file")).map((c) => c.args)).toEqual([
      ["crash_log"],
    ])
    // The releases page opens in the browser, not in the window.
    await page.getByRole("button", { name: "Releases on GitHub" }).click()
    await expect.poll(() => callCount(page, "open_releases")).toBe(1)
  })

  test("checks the interface, and says what came of it", async ({ page }) => {
    await underTheHood(page)
    await page.getByRole("button", { name: "Check the interface" }).click()
    // While it listens it says so, and it can be stopped.
    await expect(check(page)).toContainText("Listening to X32 USB")
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(1)
    await expect(check(page)).toContainText("X32 USB works")
    // With each input it opened, and the ones sound came in on lit.
    const inputs = check(page).getByRole("list", { name: "Inputs with signal" })
    await expect(inputs.getByRole("listitem")).toHaveCount(6)
    await expect(inputs.locator("[data-signal]")).toHaveCount(3)

    // A card that sends only silence is not called working.
    await setFake(page, "__CHECK_RESULT__", "silent")
    await page.getByRole("button", { name: "Check again" }).click()
    await expect(check(page)).toContainText("X32 USB opens and sends, but every input is silent")
    await expect(check(page)).toHaveAttribute("data-state", "silent")

    // A card that does not work says what is wrong, what to do, and every
    // way it was tried.
    await setFake(page, "__CHECK_RESULT__", "no_sound")
    await page.getByRole("button", { name: "Check again" }).click()
    await expect(check(page)).toContainText("The card opens, but sends no sound")
    await expect(check(page)).toContainText("delivers little or nothing")
    await expect(check(page)).toContainText("The first two channels only")
  })

  test("stops a check that is taking long, and says it was stopped", async ({ page }) => {
    await underTheHood(page)
    await setFake(page, "__CHECK_MS__", 60_000)
    await page.getByRole("button", { name: "Check the interface" }).click()
    await page.getByRole("button", { name: "Stop", exact: true }).click()
    await expect(check(page)).toContainText("Stopped")
    expect(await callCount(page, "stop_interface_check")).toBe(1)
  })
})

test("an open dropdown keeps its keys", async ({ page }) => {
  // A dropdown's list is not a dialog, and the screen's keys used to reach
  // through it: Space picking an input started the rehearsal, and Escape
  // closing a list left Settings along with it.
  await openApp(page)
  await expect(startButton(page)).toBeVisible()
  await page.locator("button[role='combobox']").first().click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Space")
  await expect(page.getByRole("listbox")).toHaveCount(0)
  expect(await callCount(page, "start_rehearsal")).toBe(0)

  await page.getByRole("button", { name: "Settings" }).click()
  await page.click("#output-device")
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await expect(page.locator("#output-device")).toHaveCount(1)
  // And the next Escape leaves Settings.
  await page.keyboard.press("Escape")
  await expect(page.locator("#output-device")).toHaveCount(0)
})

test("says so when a card will not say which rates it takes", async ({ page }) => {
  // The list fell back to the usual three in silence, so a card that
  // answered nothing looked exactly like one that answered "all of them" —
  // which is how an XR18, with no 96 kHz and only the rate its own mixer is
  // set to, came to have every one of them on screen as though it had said
  // so itself.
  await openApp(page, { before: "window.__FORMATS_REFUSED__ = true;" })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Audio", exact: true }).first().click()
  await expect(page.locator("#input-device")).toBeVisible()
  const note = page.getByRole("status").filter({ hasText: "did not say" })
  await expect(note).toHaveCount(1)
  // Without making the person read the driver's error code, and without
  // passing the usual three off as the card's own answer.
  await expect(note).not.toContainText("-9999")
  await expect(note).not.toContainText("PaErrorCode")
  await expect(note).toContainText("rather than its own")
  await expect(page.getByRole("button", { name: "44.1 kHz" })).toHaveCount(1)
})

test.describe("on a machine shaped like Windows", () => {
  // Windows without send2trash, with no encoder for compressed copies,
  // several audio systems, and a recordings folder whose path is already
  // long. Automatic sending is on with no cloud folder, set to MP3: the
  // state a config left behind by an older version can be in.
  const WINDOWS = `window.__TRASH_KIND__ = 'folder';
    window.__NO_ENCODER__ = true;
    window.__HOST_API__ = 'Windows WASAPI';
    window.__PATH_WARNING__ = "This folder's path is already 214 characters.";
    window.__AUTO_PUBLISH__ = {on: true, what: 'mix'};
    window.__CLOUD_FORMAT__ = 'mp3';`

  test("deleting names the _deleted folder rather than promising a Trash", async ({ page }) => {
    await openApp(page, { before: WINDOWS })
    await page.getByRole("button", { name: "History", exact: true }).click()
    await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
    await expect(page.getByText("_deleted folder")).toBeVisible()
    await expect(page.getByText("goes to the Trash")).toHaveCount(0)
    await expect(page.getByText("Nothing is destroyed")).toHaveCount(1)
  })

  test("the recording card is chosen by driver first", async ({ page }) => {
    await openApp(page, { before: WINDOWS })
    await page.getByRole("button", { name: "Settings" }).click()
    const driver = page.locator("#input-device-driver")
    await expect(driver).toHaveCount(1)
    // Starting from the one the saved card is on, which the card no longer
    // repeats, with a line on why the driver matters.
    await expect(driver).toContainText("MME")
    await expect(page.locator("#input-device")).not.toContainText("(MME)")
    await expect(page.getByText("Each driver can offer")).toHaveCount(1)

    await driver.click()
    expect((await page.getByRole("option").allInnerTexts()).sort()).toEqual([
      "ASIO",
      "MME",
      "Windows WASAPI",
    ])
    await page.getByRole("option", { name: "ASIO" }).click()
    await page.click("#input-device")
    await expect(page.getByRole("option")).toHaveText(["X32 USB · up to 16 ch"])
    // Changing the driver saved nothing on its own; picking the card does.
    expect((await calls(page, "set_recording_format")).some((c) => c.args[0] === 3)).toBe(false)
    await page.getByRole("option").first().click()
    await expect
      .poll(async () => (await calls(page, "set_recording_format")).at(-1)?.args[0])
      .toBe(3)
  })

  test("playback is chosen the same way, and a desk's outputs by pair or one", async ({ page }) => {
    await openApp(page, { before: WINDOWS })
    await page.getByRole("button", { name: "Settings" }).click()
    const driver = page.locator("#output-device-driver")
    await expect(driver).toHaveCount(1)
    // With nothing saved the first driver is shown.
    await expect(driver).toContainText("MME")
    await driver.click()
    expect((await page.getByRole("option").allInnerTexts()).sort()).toEqual(["ASIO", "MME"])
    await page.getByRole("option", { name: "ASIO" }).click()
    await page.click("#output-device")
    await expect(page.getByRole("option")).toHaveText(["System output", "X32 USB · 16 outputs"])
    await page.getByRole("option", { name: "X32 USB" }).click()
    await expect.poll(async () => (await calls(page, "set_output_device")).at(-1)?.args[0]).toBe(3)

    // A 16-output desk: which of its outputs the mix comes out of. Pairs
    // first, the way cards label them, then each output on its own.
    const channels = page.locator("#output-channels")
    await expect(channels).toContainText("1–2")
    await channels.click()
    const offered = await page.getByRole("option").allInnerTexts()
    expect(offered.slice(0, 3)).toEqual(["1–2", "3–4", "5–6"])
    expect(offered).not.toContain("2–3")
    expect(offered).toContain("1 (mono)")
    expect(offered).toContain("16 (mono)")
    expect(offered).toHaveLength(8 + 16)
    await expect(page.getByText("This driver offers two outputs")).toHaveCount(0)
    await page.getByRole("option", { name: "3–4", exact: true }).click()
    await expect
      .poll(async () => (await calls(page, "set_output_channels")).at(-1)?.args[0])
      .toEqual([3, 4])
    await expect(channels).toContainText("3–4")

    // The chosen card is on ASIO; switching to a driver that does not carry
    // it must not read as "System output" — nothing was unchosen.
    await driver.click()
    await page.getByRole("option", { name: "MME" }).click()
    const device = page.locator("#output-device")
    await expect(device).not.toContainText("System output")
    await expect(device).toContainText("Pick an output")

    // Through MME a desk is often a stereo device. Whoever picked it there
    // saw no outputs to choose and had no reason to look under ASIO.
    await device.click()
    await page.getByRole("option", { name: "Speakers" }).click()
    await expect(channels).toBeEnabled()
    await expect(page.getByText("This driver offers two outputs")).toHaveCount(1)
  })

  test("the folders say what this machine cannot do", async ({ page }) => {
    await openApp(page, { before: WINDOWS })
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("button", { name: "Folders", exact: true }).first().click()
    await expect(page.getByText("214 characters")).toHaveCount(1)

    // Nothing offers to publish automatically while there is nowhere to
    // publish to — every take would only collect "No cloud folder chosen".
    await expect(page.locator("#auto-publish")).toHaveCount(0)
    for (const label of ["The mix", "The original tracks", "Both"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole("button", { name: "Compressed (MP3)" })).toHaveCount(0)

    // Pick one and all of it appears — including what this machine has to
    // say about the format it was already set to.
    await page.getByRole("button", { name: "Choose cloud folder" }).click()
    await expect(page.getByRole("button", { name: "Compressed (MP3)" })).toBeEnabled()
    await expect(page.locator("#auto-publish")).toHaveCount(1)
    await expect(page.getByText("soundfile package is missing")).toHaveCount(1)
  })
})

test.describe("a newer version", () => {
  // Asked of GitHub by Python, at start and once a day (updates.py). Said
  // beside the version in Under the hood, with a dot on the way there: the
  // gear, then the group, since Settings opens on Audio.
  test.use({ viewport: { width: 1180, height: 900 } })

  test("is said beside the version, with a dot on the way there", async ({ page }) => {
    await openApp(page, { before: "window.__LATEST__ = {version: '0.3.0'};" })
    const gear = page.getByRole("button", { name: /^Settings/ })
    await expect(gear).toHaveAccessibleName("Settings, a new version is out")
    await gear.click()
    const hood = page.getByRole("button", { name: /^Under the hood/ }).first()
    await expect(hood).toHaveAccessibleName("Under the hood, a new version is out")
    await hood.click()
    // In a section of its own under the card, which says only what this
    // copy is: the news, what to do with it, and the switch together.
    const updates = page.getByRole("region", { name: "Updates" })
    await expect(updates).toContainText("Version 0.3.0 is out")
    await expect(updates).toContainText("You have 0.2.0")
    await expect(page.locator("[aria-label='About this copy']")).not.toContainText("is out")
    // The newest release's own page, in the browser.
    await updates.getByRole("button", { name: "What's new" }).click()
    await expect
      .poll(async () => (await calls(page, "open_releases")).map((c) => c.args))
      .toEqual([[true]])

    // Switched off, nothing is said, and the dot goes with it.
    const box = page.getByRole("checkbox", { name: "Check for new versions" })
    await expect(box).toBeChecked()
    await box.uncheck()
    await expect
      .poll(async () => (await calls(page, "set_check_updates")).map((c) => c.args))
      .toEqual([[false]])
    await expect(updates).not.toContainText(/\d is out/)
    await expect(updates).toContainText("Not checking for new versions")
    await expect(hood).toHaveAccessibleName("Under the hood")
    await box.check()
    await expect(updates).toContainText("Version 0.3.0 is out")
  })

  test("is fetched into Downloads when asked, and shown there", async ({ page }) => {
    await openApp(page, { before: "window.__LATEST__ = {version: '0.3.0'};" })
    await page.getByRole("button", { name: /^Settings/ }).click()
    await page.getByRole("button", { name: /^Under the hood/ }).first().click()
    const updates = page.getByRole("region", { name: "Updates" })
    // Only when asked: on a phone's internet at the rehearsal space, thirty
    // megabytes is not the app's to spend.
    expect(await callCount(page, "download_update")).toBe(0)
    await updates.getByRole("button", { name: "Download", exact: true }).click()
    await expect.poll(() => callCount(page, "download_update")).toBe(1)
    await expect(updates).toContainText("Downloading 0.3.0…")
    await expect(updates.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45")
    await expect(updates.getByRole("button", { name: "Download", exact: true })).toHaveCount(0)

    await setFake(page, "__DOWNLOAD__", {
      state: "done",
      version: "0.3.0",
      fraction: 1,
      file: "RehearsalRecorder-0.3.0-windows.zip",
    })
    await expect(updates).toContainText("0.3.0 is in Downloads")
    await expect(updates).toContainText(
      "RehearsalRecorder-0.3.0-windows.zip — unpack it, close this copy and open the new one"
    )
    await updates.getByRole("button", { name: "Show in folder" }).click()
    await expect.poll(() => callCount(page, "show_update")).toBe(1)
  })

  test("says why a download failed, and tries again", async ({ page }) => {
    await openApp(page, {
      before: `window.__LATEST__ = {version: '0.3.0'};
        window.__DOWNLOAD__ = {state: 'failed', version: '0.3.0',
          error: 'The download does not match the release'};`,
    })
    await page.getByRole("button", { name: /^Settings/ }).click()
    await page.getByRole("button", { name: /^Under the hood/ }).first().click()
    const updates = page.getByRole("region", { name: "Updates" })
    await expect(updates).toContainText("Could not download 0.3.0")
    await expect(updates).toContainText("The download does not match the release")
    await updates.getByRole("button", { name: "Try again" }).click()
    await expect.poll(() => callCount(page, "download_update")).toBe(1)
    await expect(updates).toContainText("Downloading 0.3.0…")
  })

  // "The latest" only once GitHub has answered: before the first check, or in
  // a room with no internet, nobody knows.
  for (const [before, said] of [
    ["window.__BUILT__ = true; window.__CHECKED__ = true;", "This is the latest version"],
    ["window.__BUILT__ = true;", "Not checked yet"],
    ["", "Run from source, the app does not check"],
  ]) {
    test(`with none newer, there is no dot, and it says: ${said}`, async ({ page }) => {
      await openApp(page, { before })
      await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Settings" }).click()
      await group(page, "Under the hood").click()
      const updates = page.getByRole("region", { name: "Updates" })
      await expect(updates).toContainText(said)
      await expect(updates).not.toContainText(/\d is out/)
      await expect(page.getByRole("checkbox", { name: "Check for new versions" })).toBeChecked()
    })
  }
})

test("what gets published is chosen with sending off, and leaves it off", async ({ page }) => {
  // Send starred sends what it says, so it is a choice even while nothing
  // goes on its own; choosing must not switch automatic sending on.
  await openSettings(page, "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';")
  await group(page, "Folders").click()
  await expect(page.locator("#auto-publish")).not.toBeChecked()
  const tracks = page.getByRole("button", { name: "The original tracks" })
  await expect(tracks).toBeEnabled()
  await tracks.click()
  await expect
    .poll(async () => (await calls(page, "set_auto_publish")).at(-1)?.args)
    .toEqual([false, "tracks"])
  await expect(tracks).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator("#auto-publish")).not.toBeChecked()
  await expect(page.getByText("Every track as recorded")).toHaveCount(1)
})

test("the false-start limit is on the Folders page, saved when the field is left", async ({
  page,
}) => {
  await openSettings(page)
  await group(page, "Folders").click()
  const field = page.locator("#false-start")
  await expect(field).toHaveValue("30")
  await field.fill("45")
  await field.press("Tab")
  await expect.poll(async () => (await calls(page, "set_false_start")).at(-1)?.args).toEqual([45])
  // Kept within 5 to 120 by Python, and the field says what was kept.
  await field.fill("500")
  await field.press("Enter")
  await expect.poll(async () => (await calls(page, "set_false_start")).at(-1)?.args).toEqual([500])
  await expect(field).toHaveValue("120")
  // Emptied, it goes back to what it was.
  await field.fill("")
  await field.press("Tab")
  await expect(field).toHaveValue("120")
  expect(await callCount(page, "set_false_start")).toBe(2)
})
