import {
  callCount,
  calls,
  expect,
  openApp,
  recordTake,
  setFake,
  startRehearsal,
  test,
  themed,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The band service: Settings › Folders with and without its key, a take's
// cloud button when takes go there, its lines in the background list, and
// closing the window while takes are still going up.

const KEY = "band.example:reha_secret"
const WITH_KEY = `window.__SERVICE_KEY__ = '${KEY}';`
const CLOUD = "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';"

async function openFolders(page: Page, before = "") {
  await openApp(page, { before })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
}

/** A rehearsal with two takes in it already, takes going where `before`
 *  says, and its overview. */
async function openTonight(page: Page, before = "", tonight: object[] = TONIGHT) {
  await openApp(page, { before: `window.__TONIGHT__ = ${JSON.stringify(tonight)}; ${before}` })
  await startRehearsal(page, tonight.length + 1)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

const TONIGHT = [
  { name: "Pałyn", duration_sec: 200, starred: true },
  { name: "Viasna", duration_sec: 180 },
]

type Entry = Record<string, unknown>
const entry = (over: Entry = {}): Entry => ({
  id: 1,
  kind: "service",
  title: "“Pałyn 1” → band service",
  folder: "/rec/X",
  take_number: 1,
  state: "running",
  fraction: 0.4,
  step: "MP3s: 4 of 6",
  error: null,
  detail: null,
  retry: null,
  seen: false,
  ...over,
})
const workButton = (page: Page) => page.locator("button[aria-label^='Background work']")

test("without a key the cloud folder group is as before", async ({ page }) => {
  await openFolders(page, CLOUD)
  const group = page.getByRole("region", { name: "Cloud folder" })
  await expect(group).toBeVisible()
  await expect(group.locator("#cloud-dir")).toHaveValue(/Google Drive/)
  await expect(group.getByLabel("Send saved takes automatically")).toBeVisible()
  await expect(group.getByRole("button", { name: "I have a band service key" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Sending takes" })).toHaveCount(0)
})

test("the key line explains the key and links to how it works", async ({ page }) => {
  await openFolders(page)
  await page.getByRole("button", { name: "I have a band service key" }).click()
  const group = page.getByRole("region", { name: "Cloud folder" })
  await expect(group).toContainText(
    "A band service is a private web page where your band listens to its takes track by track, stars the good ones and talks about them. Whoever runs it gives you a key to paste here. You can run one for your own band too: How it works."
  )
  await expect(group.getByLabel("Band service key")).toBeFocused()
  await expect(group.getByRole("button", { name: "Connect" })).toBeDisabled()
  await group.getByRole("button", { name: "How it works" }).click()
  await expect.poll(() => callCount(page, "open_service_help")).toBe(1)
})

test("a wrong key says why", async ({ page }) => {
  await openFolders(page)
  await page.getByRole("button", { name: "I have a band service key" }).click()
  const field = page.getByLabel("Band service key")
  await field.fill("nonsense")
  await page.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "This is not a band service key" })).toBeVisible()
  await setFake(page, "__SERVICE_REFUSES__", "This key does not work")
  await field.fill(KEY)
  await field.press("Enter")
  await expect(page.getByRole("alert").filter({ hasText: "This key does not work" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Cloud folder" })).toBeVisible()
})

test("a key turns the group into Sending takes with a switch", async ({ page }) => {
  await openFolders(page, CLOUD)
  await page.getByRole("button", { name: "I have a band service key" }).click()
  await page.getByLabel("Band service key").fill(KEY)
  await page.getByRole("button", { name: "Connect" }).click()
  const group = page.getByRole("region", { name: "Sending takes" })
  await expect(group).toBeVisible()
  await expect(page.getByRole("region", { name: "Cloud folder" })).toHaveCount(0)
  await expect(group.getByRole("radio", { name: "Band service" })).toBeChecked()
  await expect(group.getByRole("radio", { name: "Cloud folder" })).not.toBeChecked()
  await expect(group.locator("[data-service-address]")).toHaveText("band.example")
  await expect(group).toContainText(
    "Every track goes up as MP3 to listen to and FLAC as recorded, with its notes as .mid and the take's marks."
  )
  await expect(group).not.toContainText("Not checked yet")
})

test("a key kept without the service answering says so", async ({ page }) => {
  await openFolders(page, "window.__SERVICE_OFFLINE__ = true;")
  await page.getByRole("button", { name: "I have a band service key" }).click()
  await page.getByLabel("Band service key").fill(KEY)
  await page.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByRole("region", { name: "Sending takes" })).toContainText(
    "Not checked yet: the band service could not be reached."
  )
})

test("the switch shows only the chosen module's panel", async ({ page }) => {
  await openFolders(page, WITH_KEY + CLOUD)
  const group = page.getByRole("region", { name: "Sending takes" })
  await expect(group.getByRole("button", { name: "Disconnect" })).toBeVisible()
  await expect(group.locator("#cloud-dir")).toHaveCount(0)
  await group.getByRole("radio", { name: "Cloud folder" }).click()
  await expect.poll(async () => (await calls(page, "set_send_to")).at(-1)?.args[0]).toBe("cloud")
  await expect(group.locator("#cloud-dir")).toHaveValue(/Google Drive/)
  await expect(group.getByRole("button", { name: "Disconnect" })).toHaveCount(0)
  await group.getByRole("radio", { name: "Band service" }).click()
  await expect(group.getByRole("button", { name: "Disconnect" })).toBeVisible()
})

test("each panel keeps its own settings", async ({ page }) => {
  await openFolders(page, WITH_KEY + CLOUD + "window.__AUTO_PUBLISH__ = {on: true, what: 'mix'};")
  const group = page.getByRole("region", { name: "Sending takes" })
  const own = group.getByLabel("Send saved takes automatically")
  await expect(own).not.toBeChecked()
  await own.click()
  await expect.poll(async () => (await calls(page, "set_service_auto_publish")).at(-1)?.args[0]).toBe(true)
  await expect(own).toBeChecked()
  await group.getByRole("radio", { name: "Cloud folder" }).click()
  await expect(group.locator("#auto-publish")).toBeChecked()
  expect(await callCount(page, "set_auto_publish")).toBe(0)
})

test("disconnect puts the group back as it was", async ({ page }) => {
  await openFolders(page, WITH_KEY + CLOUD)
  await page.getByRole("button", { name: "Disconnect" }).click()
  await expect.poll(() => callCount(page, "disconnect_service")).toBe(1)
  const group = page.getByRole("region", { name: "Cloud folder" })
  await expect(group).toBeVisible()
  await expect(group.locator("#cloud-dir")).toHaveValue(/Google Drive/)
  await expect(group.getByRole("button", { name: "I have a band service key" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Sending takes" })).toHaveCount(0)
})

test("the cloud button sends to the service at once", async ({ page }) => {
  const overview = await openTonight(page, WITH_KEY)
  await overview.getByRole("button", { name: "Send Pałyn 1 to the band service" }).click()
  await expect.poll(async () => (await calls(page, "share_take")).at(-1)?.args[1]).toBe(1)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("a take in the service opens its dialog with Remove", async ({ page }) => {
  const overview = await openTonight(page, WITH_KEY, [
    { ...TONIGHT[0], service: { up: true, flac: false, error: null } },
    TONIGHT[1],
  ])
  await overview.getByRole("button", { name: "“Pałyn 1” in the band service" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading")).toHaveText("“Pałyn 1” in the band service")
  await expect(dialog.locator("[data-service-tracks] li")).toHaveText(["GuitarMP3, FLAC on its way"])
  await dialog.getByRole("button", { name: "Remove from the band service" }).click()
  await expect.poll(async () => (await calls(page, "unshare_take")).at(-1)?.args[1]).toBe(1)
  await expect(dialog).toHaveCount(0)
  await expect(overview.getByRole("button", { name: "Send Pałyn 1 to the band service" })).toBeVisible()
})

test("the take says it is waiting for the band service", async ({ page }) => {
  const overview = await openTonight(page, WITH_KEY)
  await overview.getByRole("button", { name: "Send Viasna 1 to the band service" }).click()
  await expect(overview.getByText("Waiting for the band service")).toBeVisible()
  await expect(overview.getByRole("button", { name: /^Take 2 Viasna 1, waiting for the band service/ })).toBeVisible()
  await page.evaluate(() => (window as unknown as { __serviceUp: (n: number) => void }).__serviceUp(2))
  await expect(overview.getByText("Waiting for the band service")).toHaveCount(0)
  await expect(overview.getByLabel("In the band service", { exact: true })).toBeVisible()
})

test("the background list shows MP3s and FLAC counts", async ({ page }) => {
  await openApp(page, {
    before: `window.__ACTIVITY__ = ${JSON.stringify([
      entry(),
      entry({ id: 2, take_number: 2, title: "“Viasna 1” → band service", step: "FLAC: 2 of 6", fraction: 0.8 }),
    ])};`,
  })
  await workButton(page).click()
  const list = page.getByRole("dialog")
  await expect(list.getByText("MP3s: 4 of 6")).toBeVisible()
  await expect(list.getByText("FLAC: 2 of 6")).toBeVisible()
  await expect(list.getByText("“Pałyn 1” → band service")).toBeVisible()
})

test("no internet is said, not failed", async ({ page }) => {
  await openApp(page, {
    before: `window.__ACTIVITY__ = ${JSON.stringify([
      entry({ step: "No internet: carries on when it is back" }),
    ])};`,
  })
  await expect(workButton(page)).not.toContainText("failed")
  await workButton(page).click()
  const list = page.getByRole("dialog")
  await expect(list.getByText("No internet: carries on when it is back")).toBeVisible()
  await expect(list.getByRole("button", { name: "Retry" })).toHaveCount(0)
})

test("a failed send has Retry", async ({ page }) => {
  await openApp(page, {
    before: `window.__ACTIVITY__ = ${JSON.stringify([
      entry({
        id: 7,
        state: "failed",
        step: null,
        error: "The band service does not know this key any more",
        retry: "service",
      }),
      entry({ id: 8, title: "“Viasna 1” → band service trash", state: "failed", step: null, error: "No such take" }),
    ])};`,
  })
  await workButton(page).click()
  const list = page.getByRole("dialog")
  await expect(list.getByText("The band service does not know this key any more")).toBeVisible()
  // The trash line has nothing to send again.
  await expect(list.getByRole("button", { name: "Retry" })).toHaveCount(1)
  await list.getByRole("button", { name: "Retry" }).click()
  await expect.poll(async () => (await calls(page, "retry_cloud")).at(-1)?.args[0]).toBe(7)
})

/** Python asks the interface when the window is closed with takes left. */
const closeWindow = (page: Page) =>
  page.evaluate(() => (window as unknown as { __rehaClosing: () => void }).__rehaClosing())

test("closing with takes left asks first", async ({ page }) => {
  await openApp(page, { before: "window.__SENDING_LEFT__ = {takes: 3, bytes: 1200000000};" })
  await closeWindow(page)
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(
    "Still sending 3 takes to the band service, 1.2 GB left. The rest goes the next time РЭХА is open."
  )
  await expect(dialog.getByRole("button", { name: "Close anyway" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Keep sending" })).toBeVisible()
})

test("close anyway closes, keep sending stays", async ({ page }) => {
  await openApp(page, { before: "window.__SENDING_LEFT__ = {takes: 1, bytes: 52000000};" })
  await closeWindow(page)
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Still sending 1 take to the band service, 52 MB left.")
  await dialog.getByRole("button", { name: "Keep sending" }).click()
  await expect(dialog).toHaveCount(0)
  expect(await callCount(page, "close_anyway")).toBe(0)
  await closeWindow(page)
  await page.getByRole("button", { name: "Close anyway" }).click()
  await expect.poll(() => callCount(page, "close_anyway")).toBe(1)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("the keep line sends to the band service as its setting says", async ({ page }) => {
  // The fake's takes are 6 s, false starts under the 30 s the setting starts
  // at; with the limit at its lowest they are takes like any other.
  await openApp(page, { before: WITH_KEY + "window.__SERVICE_AUTO__ = true; window.__FALSE_START__ = 5;" })
  await startRehearsal(page)
  await recordTake(page)
  const box = page.getByRole("checkbox", { name: /^Send to the band service/ })
  await expect(box).toBeChecked()
  await page.getByRole("button", { name: "Save take" }).click()
  await expect.poll(() => callCount(page, "keep_take")).toBe(1)
  // The box as the setting has it: Python follows its own rule.
  expect((await calls(page, "keep_take"))[0].args[6]).toBeNull()
  await expect(page.getByText("Waiting for the band service")).toBeVisible()
})

test("send starred names the band service", async ({ page }) => {
  const overview = await openTonight(page, WITH_KEY)
  const send = overview.getByRole("button", { name: /Send starred/ })
  await expect(send).toHaveAccessibleDescription("Send every ★ take to the band service")
  await send.click()
  await expect.poll(() => callCount(page, "send_starred")).toBe(1)
  await expect(send).toHaveAccessibleDescription(/^Every ★ take is in the band service/)
})

for (const theme of ["light", "dark"] as const)
  for (const [width, height] of [
    [1180, 820],
    [960, 680],
  ])
    test(`1180x820 and 960x680, light and dark: ${theme} at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await openFolders(page, themed(theme) + WITH_KEY + CLOUD)
      const group = page.getByRole("region", { name: "Sending takes" })
      await expect(group).toBeVisible()
      for (const which of ["Band service", "Cloud folder"]) {
        await group.getByRole("radio", { name: which }).click()
        // Nothing runs out of the group, and the page does not scroll sideways.
        const fits = await group.evaluate((el) => el.scrollWidth <= el.clientWidth)
        expect(fits).toBe(true)
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        )
        expect(sideways).toBe(false)
      }
    })
