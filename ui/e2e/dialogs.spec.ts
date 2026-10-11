import {
  callCount,
  calls,
  expect,
  nameTake,
  openApp,
  openHistory,
  recordTake,
  startRehearsal,
  test,
} from "./app.ts"
import type { Page } from "@playwright/test"

// The one Dialog (spec C3, P3, B2): its buttons in the system's order, Enter
// pressing the action unless nothing can be undone, a title that keeps its
// words while it closes, and no dialog on the page that is not the shared one.

const WINDOWS = "Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});"
const MAC = "Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});"

/** Two takes kept, on the rehearsal screen, none open. */
async function twoTakesKept(page: Page, system?: string) {
  if (system) await page.addInitScript(system)
  await openApp(page)
  await startRehearsal(page)
  for (const n of [1, 2]) {
    await recordTake(page, n)
    await page.getByRole("button", { name: /Save take/ }).click()
    await expect(page.getByRole("button", { name: new RegExp(`Record take ${n + 1}`) })).toBeVisible()
  }
}

const focusedText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? "")

/** Where a button sits across the dialog: its left edge. */
async function left(dialog: ReturnType<Page["getByRole"]>, name: string) {
  return (await dialog.getByRole("button", { name, exact: true }).boundingBox())!.x
}

test("Escape with takes in the rehearsal asks to finish, on Cancel, and Enter lets it be", async ({
  page,
}) => {
  await twoTakesKept(page)
  const finishes = await callCount(page, "finish_rehearsal")
  await page.keyboard.press("Escape")
  const dialog = page.getByRole("dialog", { name: "Finish this rehearsal?" })
  await expect(dialog).toBeVisible()
  // Nothing in it can be undone: it opens on the answer that changes nothing.
  await expect.poll(() => focusedText(page)).toBe("Cancel")
  // Its words, and the right number of them.
  await expect(dialog).toContainText(
    "2 takes are saved and stay where they are. You cannot add to this rehearsal afterwards — a later one starts its own folder."
  )
  await expect(dialog.getByRole("button")).toHaveText(["Cancel", "Finish"])

  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  // The screen stays: nothing was finished.
  await expect(page.getByRole("button", { name: /Record take 3/ })).toBeVisible()
  expect(await callCount(page, "finish_rehearsal")).toBe(finishes)
})

test("Finish is the answer that finishes, when it is pressed", async ({ page }) => {
  await twoTakesKept(page)
  await page.keyboard.press("Escape")
  const dialog = page.getByRole("dialog", { name: "Finish this rehearsal?" })
  await dialog.getByRole("button", { name: "Finish", exact: true }).click()
  await expect.poll(() => callCount(page, "finish_rehearsal")).toBe(1)
})

test("a rehearsal is renamed by typing its name and pressing Enter", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await page.getByRole("button", { name: "Rename rehearsal" }).click()
  const dialog = page.getByRole("dialog", { name: "Rename rehearsal" })
  // The field has the keyboard, so Enter is the field's.
  const field = dialog.locator("input")
  await expect(field).toBeFocused()
  await field.fill("Tuesday jam")
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(async () => (await calls(page, "rename_rehearsal")).at(-1)?.args[1])
    .toBe("Tuesday jam")
})

test("on a Mac and on anything but Windows the action is right of Cancel", async ({ page }) => {
  await twoTakesKept(page)
  await page.keyboard.press("Escape")
  const dialog = page.getByRole("dialog", { name: "Finish this rehearsal?" })
  expect(await left(dialog, "Finish")).toBeGreaterThan(await left(dialog, "Cancel"))
})

test("on a Mac it is the same", async ({ page }) => {
  await twoTakesKept(page, MAC)
  await page.keyboard.press("Escape")
  const dialog = page.getByRole("dialog", { name: "Finish this rehearsal?" })
  expect(await left(dialog, "Finish")).toBeGreaterThan(await left(dialog, "Cancel"))
})

test("on Windows the action comes first, and the arrows follow what is on screen", async ({
  page,
}) => {
  await twoTakesKept(page, WINDOWS)
  await page.keyboard.press("Escape")
  const dialog = page.getByRole("dialog", { name: "Finish this rehearsal?" })
  await expect(dialog).toBeVisible()
  expect(await left(dialog, "Finish")).toBeLessThan(await left(dialog, "Cancel"))
  // Cancel still has the Enter: where the buttons stand does not change that.
  await expect.poll(() => focusedText(page)).toBe("Cancel")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(() => focusedText(page)).toBe("Finish")
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => focusedText(page)).toBe("Cancel")
})

// What is done to the thing itself stands apart at the far left, whatever
// the system's order of the answers is.
for (const [system, script, order] of [
  ["a Mac", MAC, ["Delete marker", "Cancel", "Save"]],
  ["Windows", WINDOWS, ["Delete marker", "Save", "Cancel"]],
] as const) {
  test(`the marker's buttons on ${system} keep Delete marker apart, and Enter in the note saves`, async ({
    page,
  }) => {
    await page.addInitScript(script)
    await openApp(page)
    await startRehearsal(page)
    await recordTake(page, 1)
    await page.getByRole("button", { name: "Add marker" }).click()
    const dialog = page.getByRole("dialog")
    const names = ["Delete marker", "Cancel", "Save"]
    const xs = await Promise.all(names.map((n) => left(dialog, n)))
    const across = names.map((n, i) => [n, xs[i]] as const).sort((a, b) => a[1] - b[1])
    expect(across.map(([n]) => n)).toEqual(order)
    // The note has the keyboard: Enter there is Save.
    await expect(dialog.getByRole("textbox", { name: "Marker note" })).toBeFocused()
    await page.keyboard.type("guitar drifts")
    await page.keyboard.press("Enter")
    await expect(dialog).toHaveCount(0)
    // The mark is on the take, with what was written.
    await expect(page.getByText("guitar drifts")).toHaveCount(1)
  })
}

test("the title and the text stay while the dialog closes", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "History", exact: true }).click()
  await page.getByRole("button", { name: "Delete rehearsal Tuesday jam" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading")).toHaveText("Delete “Tuesday jam”?")
  // Looked at one frame after Cancel, with the dialog on its way out: what
  // it asked about is already forgotten, and it still says it.
  const seen = await dialog.getByRole("button", { name: "Cancel" }).evaluate(
    (cancel) =>
      new Promise<{ title: string; text: string }>((done) => {
        ;(cancel as HTMLElement).click()
        requestAnimationFrame(() =>
          done({
            title: document.querySelector('[data-slot="dialog-title"]')?.textContent ?? "(gone)",
            text: document.querySelector('[data-slot="dialog-description"]')?.textContent ?? "(gone)",
          })
        )
      })
  )
  expect(seen.title).toBe("Delete “Tuesday jam”?")
  expect(seen.text).toContain("goes to the Trash")
  await expect(dialog).toHaveCount(0)
})

test("a label in use asks Delete with its name in quotes", async ({ page }) => {
  await openApp(page, {
    before:
      "window.__FULL_EVENING__ = true;" +
      "window.__LABELS__ = [{id:1, name:'Note', colour:'grey'}, {id:2, name:'Keep this', colour:'green'}, {id:3, name:'Fix', colour:'red'}];",
  })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Marks", exact: true }).first().click()
  await page.locator("[data-label='Fix']").hover()
  await page.getByRole("button", { name: "Delete Fix" }).click()
  await expect(page.getByRole("dialog", { name: "Delete “Fix”?" })).toBeVisible()
})

// ---------- no dialog on the page that is not the shared one ----------

/**
 * Every Radix dialog is the shared DialogContent, which marks itself
 * data-slot="dialog-content": one built by hand beside it would not carry
 * the mark. (A popover has the role too, and is not open in these.)
 */
async function onlyTheSharedDialog(page: Page) {
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(1)
  const strays = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')]
      .filter((el) => !el.matches('[data-slot="dialog-content"]'))
      .map((el) => el.outerHTML.slice(0, 120))
  )
  expect(strays).toEqual([])
}

const PALYN = `window.__EXTRA_SONGS__ = ["Palyn", "Palyn"]; window.__ACTIVITY__ = [];`

async function openSongPage(page: Page, title: string) {
  await openHistory(page)
  await page.getByRole("button", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator(`[data-song='${title}']`).click()
  await page.locator("[data-song-head]").getByRole("button", { name: `Rename song ${title}`, exact: true }).click()
}

const SETS = [
  { id: 1, name: "Gig on the 25th", songs: ["Pałyn", "Viasna", "Ahoń", "Sonca"] },
  { id: 2, name: "New songs", songs: ["Kupalle", "Dym"] },
]
const withSets = `window.__SETS__ = ${JSON.stringify(SETS)};`

const CONVERTED: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: "Finish",
    open: async (page) => {
      await twoTakesKept(page)
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "Remove from history",
    open: async (page) => {
      await openApp(page, { before: "window.__CANCEL_LOCATE__ = true;" })
      await openHistory(page, "Missing jam")
      await page.getByRole("button", { name: "Remove from history" }).click()
    },
  },
  {
    name: "Rename take",
    open: async (page) => {
      await openApp(page)
      await startRehearsal(page)
      await recordTake(page, 1)
      await page.locator("[data-take-summary]").getByRole("button", { name: "Rename take" }).click()
    },
  },
  {
    name: "Marker",
    open: async (page) => {
      await openApp(page)
      await startRehearsal(page)
      await recordTake(page, 1)
      await page.getByRole("button", { name: "Add marker" }).click()
    },
  },
  {
    name: "Share",
    open: async (page) => {
      await openApp(page)
      await startRehearsal(page)
      await recordTake(page, 1)
      await nameTake(page, "Pałyn")
      await page.getByRole("button", { name: /Save take/ }).click()
      await expect(page.getByRole("button", { name: /Record take 2/ })).toBeVisible()
      await page
        .locator("[aria-label='Rehearsal overview'] button[aria-label^='Take 1 Pałyn']")
        .click()
      await page.getByRole("button", { name: "Copy Pałyn 1 to the cloud" }).click()
    },
  },
  {
    name: "Player keys",
    open: async (page) => {
      await openApp(page)
      await startRehearsal(page)
      await recordTake(page, 1)
      await page.getByRole("button", { name: "Player keys" }).click()
    },
  },
  {
    name: "Rename song",
    open: async (page) => {
      await openApp(page, { before: PALYN })
      await openSongPage(page, "Palyn")
    },
  },
  {
    name: "New set",
    open: async (page) => {
      await openApp(page, { before: withSets })
      await page.locator("[data-set-picker]").click()
      await page.getByRole("menu", { name: "Sets" }).getByRole("menuitem", { name: "New set…" }).click()
    },
  },
  {
    name: "Delete label",
    open: async (page) => {
      await openApp(page, { before: "window.__FULL_EVENING__ = true;" })
      await page.getByRole("button", { name: "Settings" }).click()
      await page.getByRole("button", { name: "Marks", exact: true }).first().click()
      await page.locator("[data-label='Went wrong']").hover()
      await page.getByRole("button", { name: "Delete Went wrong" }).click()
    },
  },
  {
    name: "Delete set",
    open: async (page) => {
      await openApp(page, { before: withSets })
      await page.getByRole("button", { name: "Settings" }).click()
      await page.getByRole("button", { name: "Sets", exact: true }).first().click()
      await page.locator("[data-set-detail]").getByRole("button", { name: "Delete set" }).click()
    },
  },
  {
    name: "Merge",
    open: async (page) => {
      await openApp(page, { before: PALYN })
      await openSongPage(page, "Palyn")
      const rename = page.getByRole("dialog", { name: "Rename song" })
      await rename.locator("[data-song-choice='Pałyn']").click()
      await rename.getByRole("button", { name: "Merge…", exact: true }).click()
    },
  },
]

for (const { name, open } of CONVERTED) {
  test(`${name} is the shared dialog, and the only one`, async ({ page }) => {
    await open(page)
    await onlyTheSharedDialog(page)
  })
}
