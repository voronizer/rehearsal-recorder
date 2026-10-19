import {
  callCount,
  calls,
  colour,
  DASH,
  expect,
  nameTake,
  notices,
  openApp,
  recordTake,
  startRehearsal,
  style,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The band's cloud folder: what goes there, and when.

const CLOUD = "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';"

const MIX_HINT = "One stereo file with the balance from the player. This is what you send people."
const TRACKS_HINT = "Every track as recorded, untouched, and the notes as .mid, to open in a DAW later."
/** The three a take can go up as, each with its hint, in their order. */
const OPTIONS = [
  ["The mix", MIX_HINT],
  ["The original tracks", TRACKS_HINT],
  ["Both", "The mix to listen to, the tracks to work from."],
] as const

/** From the start screen: a rehearsal with take 1, Pałyn, saved, and the
 *  take's share dialog open. */
async function openShare(page: Page, justBefore?: () => Promise<unknown>) {
  await startRehearsal(page)
  await recordTake(page, 1)
  await nameTake(page, "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  await justBefore?.()
  await page.getByRole("button", { name: "Copy Pałyn 1 to the cloud" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

/** What the last saved take was told about the cloud: false kept out, null
 *  left to the setting. */
async function sentAs(page: Page) {
  const args = (await calls(page, "keep_take")).at(-1)?.args ?? []
  return args.length > 6 ? args[6] : null
}

test("saving a take says whether it goes to the cloud, take by take", async ({ page }) => {
  await openApp(page, {
    before: `window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';
      window.__AUTO_PUBLISH__ = {on: true, what: 'mix'};`,
  })
  await startRehearsal(page)
  await recordTake(page, 1)
  const box = page.locator("#send-to-cloud")
  await expect(box).toBeChecked()
  const label = page.locator("label[for='send-to-cloud']")
  await expect(label).toContainText("the mix")
  await expect(label).toContainText("WAV")
  await box.uncheck()
  // Space right after clicking the box must still save, not tick it again.
  await page.keyboard.press("Space")
  await expect.poll(() => sentAs(page)).toBe(false)

  // The next take starts from the setting again, not from the last one, and
  // left alone it simply follows the setting.
  await recordTake(page, 2)
  await expect(box).toBeChecked()
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect.poll(async () => (await calls(page, "keep_take")).length).toBe(2)
  expect(await sentAs(page)).toBeNull()
})

test("a take is copied to the cloud from its row, and taken back out again", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page, 1)
  await nameTake(page, "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  await expect(page.getByRole("button", { name: "Mute Guitar" })).toBeVisible()

  await page.getByRole("button", { name: "Copy Pałyn 1 to the cloud" }).click()
  // There is nowhere to copy to yet, and it says so.
  await expect(page.getByText("No cloud folder chosen yet")).toBeVisible()
  await expect(page.getByRole("button", { name: "The mix", exact: true })).toBeDisabled()
  await page.getByText("Choose").click()
  await expect.poll(() => callCount(page, "choose_cloud_dir")).toBe(1)
  await page.getByRole("button", { name: "Both", exact: true }).click()
  // The dialog lets go as soon as the copy is queued.
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const shared = await calls(page, "share_take")
  expect(shared).toHaveLength(1)
  expect(shared[0].args[2]).toBe("both")
  await expect(page.getByRole("button", { name: "Cloud copies of Pałyn 1" })).toHaveCount(1)

  // Deleting a take takes its copy out of the cloud folder too, at once; its
  // Undo puts both back.
  await page.getByRole("button", { name: "Delete take Pałyn 1" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Cloud copies of Pałyn 1" })).toHaveCount(0)
  await notices(page)
    .filter({ hasText: "“Pałyn 1” went to the Trash." })
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(page.getByRole("button", { name: "Cloud copies of Pałyn 1" })).toHaveCount(1)

  await page.getByRole("button", { name: "Cloud copies of Pałyn 1" }).click()
  await expect(page.getByRole("dialog")).toContainText("already there")
  await page.getByText("Remove from the cloud").click()
  await expect.poll(() => callCount(page, "unshare_take")).toBe(1)
  await expect(page.getByRole("button", { name: "Copy Pałyn 1 to the cloud" })).toHaveCount(1)
})

test("a share option is named by its title and described by its hint", async ({ page }) => {
  await openApp(page, { before: "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';" })
  await startRehearsal(page)
  await recordTake(page, 1)
  await nameTake(page, "Pałyn")
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
  await page.locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']").click()
  await page.getByRole("button", { name: "Copy Pałyn 1 to the cloud" }).click()

  // The name is the title alone; the hint is what a screen reader says after
  // it. The option is found by its hint, so the name is what is checked.
  const mix = page.getByRole("dialog").getByRole("button").filter({ hasText: MIX_HINT })
  await expect(mix).toHaveCount(1)
  await expect(mix).toHaveAccessibleName("The mix")
  await expect(mix).toHaveAccessibleDescription(MIX_HINT)
  await expect(page.getByRole("button", { name: "The original tracks", exact: true })).toHaveAccessibleDescription(
    TRACKS_HINT
  )

  // Once the mix is there, the description says so before the hint.
  await mix.click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Cloud copies of Pałyn 1" }).click()
  await expect(mix).toHaveAccessibleName("The mix")
  await expect(mix).toHaveAccessibleDescription(`already there ${MIX_HINT}`)
  await expect(page.getByRole("button", { name: "The original tracks", exact: true })).toHaveAccessibleDescription(
    TRACKS_HINT
  )
})

test("a copy the cloud folder refuses is said in a notice, and the dialog stays", async ({ page }) => {
  await openApp(page, { before: CLOUD })
  const dialog = await openShare(page)
  const close = dialog.getByRole("button", { name: "Close", exact: true })
  const before = await close.boundingBox()
  // The folder will not take the copy.
  await page.evaluate(() => {
    const w = window as unknown as { pywebview: { api: Record<string, unknown> }; __SHARE__: unknown }
    w.__SHARE__ = w.pywebview.api.share_take
    w.pywebview.api.share_take = async () => ({ ok: false, error: "The cloud folder is read-only" })
  })
  await dialog.getByRole("button", { name: "The mix", exact: true }).click()
  const said = notices(page, "error").filter({ hasText: "The cloud folder is read-only" })
  await expect(said).toHaveCount(1)
  // The dialog stays, to try again from, and its own words and buttons
  // stay where they were: nothing is said inside it.
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("The cloud folder is read-only")).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "The mix", exact: true })).toBeEnabled()
  expect(await close.boundingBox()).toEqual(before)

  // A try that works puts the notice away.
  await page.evaluate(() => {
    const w = window as unknown as { pywebview: { api: Record<string, unknown> }; __SHARE__: unknown }
    w.pywebview.api.share_take = w.__SHARE__
  })
  await dialog.getByRole("button", { name: "Both", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(said).toHaveCount(0)
})

test("until the cloud folder is read, the dialog says nothing about it either way", async ({ page }) => {
  await openApp(page)
  // Python is slow to say which folder is set.
  const dialog = await openShare(page, () =>
    page.evaluate(() => {
      const w = window as unknown as {
        pywebview: { api: Record<string, () => Promise<unknown>> }
        __ANSWER__: () => void
      }
      const read = w.pywebview.api.get_settings
      w.pywebview.api.get_settings = () => new Promise((r) => (w.__ANSWER__ = () => r(read())))
    })
  )
  await expect(dialog.locator("svg.lucide-folder-open")).toHaveCount(1)
  await expect(dialog.locator("svg.lucide-triangle-alert")).toHaveCount(0)
  await expect(dialog.getByText("No cloud folder chosen yet")).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Choose", exact: true })).toBeHidden()
  await page.evaluate(() => (window as unknown as { __ANSWER__: () => void }).__ANSWER__())
  await expect(dialog.getByText("No cloud folder chosen yet", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Choose", exact: true })).toBeVisible()
})

test("with no cloud folder the dialog warns with the icon, its words in the text's colour", async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openShare(page)
  const words = dialog.getByText("No cloud folder chosen yet", { exact: true })
  await expect(words).toBeVisible()
  // The shared warning look: the triangle in the warn colour, the words in
  // the text's own, where amber words did not read in the light theme.
  expect(await style(words, "color")).toEqual({ color: await colour(page, "--foreground") })
  const line = words.locator("..")
  await expect(line.locator("svg.lucide-triangle-alert")).toHaveCount(1)
  expect(await style(line.locator("svg.lucide-triangle-alert"), "color")).toEqual({
    color: await colour(page, "--warn"),
  })
  for (const [label] of OPTIONS) {
    await expect(dialog.getByRole("button", { name: label, exact: true })).toBeDisabled()
  }

  // Chosen, the folder is a path like any other, with no warning.
  await dialog.getByRole("button", { name: "Choose" }).click()
  const path = dialog.getByText("/Users/alex/Google Drive/Band", { exact: true })
  await expect(path).toBeVisible()
  await expect(dialog.locator("svg.lucide-triangle-alert")).toHaveCount(0)
  expect(await style(path, "color")).toEqual({ color: await colour(page, "--muted-foreground") })
})

test("the dialog and Folders give the three options the same words, with no dashes", async ({ page }) => {
  // In Settings › Folders: each a choice of What gets sent, with its hint
  // under the row once it is the chosen one.
  await openApp(page, { before: CLOUD })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).first().click()
  const sent = page.getByRole("radiogroup", { name: "What gets sent" })
  await expect(sent.getByRole("radio")).toHaveText(OPTIONS.map(([label]) => label))
  const cloud = page.getByRole("region", { name: "Cloud folder" })
  for (const [label, hint] of OPTIONS) {
    await sent.getByRole("radio", { name: label, exact: true }).click()
    await expect(cloud.getByText(hint, { exact: true }), label).toHaveCount(1)
  }
  expect(await cloud.innerText()).not.toMatch(DASH)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible()

  // In the dialog: each an option named by the same words, its hint the
  // same, and the dialog's own words with no dash either.
  const dialog = await openShare(page)
  await expect(dialog.locator("[data-slot=dialog-description]")).toHaveText(
    "The files are copied into your cloud folder, and the app that syncs it does the uploading."
  )
  for (const [label, hint] of OPTIONS) {
    const option = dialog.getByRole("button", { name: label, exact: true })
    await expect(option).toHaveAccessibleDescription(hint)
  }
  expect(await dialog.innerText()).not.toMatch(DASH)
})
