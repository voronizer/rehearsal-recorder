import { test as base, expect, type Locator, type Page } from "@playwright/test"
import { fileURLToPath } from "node:url"

export { expect }

/** How long the fake's own takes are: TAKE in fake-bridge.js. */
export const TAKE_SECONDS = 6

const FAKE = fileURLToPath(new URL("./fake-bridge.js", import.meta.url))

/**
 * Every test fails on an error in the page: an exception, or anything the
 * app writes to the console as an error. /api/... is not served here, on
 * purpose — the interface polls over the bridge then — so the browser's own
 * complaint about that is not one.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = []
      const watch = (page: Page) => {
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
        page.on("console", (m) => {
          if (
            m.type() === "error" &&
            !m.location().url.includes("/api/") &&
            !m.text().includes("Failed to load resource")
          ) {
            errors.push(`console.error: ${m.text()}`)
          }
        })
      }
      context.pages().forEach(watch)
      context.on("page", watch)
      await use(errors)
      expect(errors, "errors in the page").toEqual([])
    },
    { auto: true },
  ],
})

/**
 * For a test where an error in the console is the point: a call into Python
 * that fails is written there by the bridge. Checks it was, and takes it off
 * the list the test fails on.
 */
export function expectedError(errors: string[], pattern: RegExp) {
  expect(errors.some((e) => pattern.test(e)), `an error like ${pattern}`).toBe(true)
  for (let i = errors.length - 1; i >= 0; i--) if (pattern.test(errors[i])) errors.splice(i, 1)
}

/**
 * Opens the app against the fake Python side.
 *
 * `before` runs ahead of the fake, to set it up: window.__LEVELS__,
 * window.__DRAFTS__ and the rest that fake-bridge.js reads. `after` runs once
 * the fake is in place, to change one of its answers.
 */
export async function openApp(
  page: Page,
  {
    before,
    after,
    waitUntil = "load",
  }: {
    before?: string
    after?: string
    waitUntil?: "load" | "domcontentloaded" | "networkidle"
  } = {}
) {
  if (before) await page.addInitScript(before)
  await page.addInitScript({ path: FAKE })
  if (after) await page.addInitScript(after)
  await page.goto("/", { waitUntil })
}

type Call = { name: string; args: unknown[] }

/** The calls the interface made into the fake Python side, by name. */
export function calls(page: Page, name: string): Promise<Call[]> {
  return page.evaluate(
    (n) => (window as unknown as { __CALLS__: Call[] }).__CALLS__.filter((c) => c.name === n),
    name
  )
}

/** How many times the interface has called that, for expect.poll. */
export async function callCount(page: Page, name: string): Promise<number> {
  return (await calls(page, name)).length
}

/** The key a button shows it answers to, or null when it shows none. */
export async function keyOn(button: Locator): Promise<string | null> {
  const key = button.locator(":is(kbd, [data-key])")
  return (await key.count()) ? (await key.first().innerText()).trim() : null
}

/** The setup screen, as the app opens on it. */
export function startButton(page: Page): Locator {
  return page.getByRole("button", { name: /Start rehearsal/ })
}

/**
 * History, from the setup screen. It opens on the newest rehearsal, beside
 * the list; `name` chooses another from the list. Returns the list.
 */
export async function openHistory(page: Page, name?: string): Promise<Locator> {
  await page.getByRole("button", { name: "History", exact: true }).click()
  const list = page.getByRole("navigation", { name: "Rehearsals" })
  await expect(list).toBeVisible()
  if (name) await list.getByRole("button", { name: new RegExp(`^${name}`) }).click()
  return list
}

/** From the setup screen into a rehearsal, ready to record take `n`. */
export async function startRehearsal(page: Page, n = 1) {
  await startButton(page).click()
  await expect(page.getByRole("button", { name: new RegExp(`Record take ${n}`) })).toBeVisible()
}

/** Records take `n` and stops it, leaving it up for review. */
export async function recordTake(page: Page, n = 1) {
  await page.getByRole("button", { name: new RegExp(`Record take ${n}`) }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(page.locator("#take-name")).toBeVisible()
}

/** Draws a region across the timeline, the way a person does: pressed,
 *  dragged and let go, between two fractions of its width. */
export async function dragRegion(page: Page, from: number, to: number) {
  const box = (await page.getByRole("group", { name: "Take timeline" }).boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * from, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to, y, { steps: 10 })
  await page.mouse.up()
}

/** The bar across the top that says something failed in Python. */
export function problemBar(page: Page): Locator {
  return page.locator("[role='alert'][aria-label='Something went wrong']")
}

/** The notices in the corner, or those of one kind. */
export function notices(page: Page, kind?: string): Locator {
  return page.locator(
    kind
      ? `section[aria-label='Notifications'] [data-notice='${kind}']`
      : "section[aria-label='Notifications'] [data-notice]"
  )
}

/** Sets something on the fake while the page runs: window.__IFACE_GONE__
 *  and the rest in fake-bridge.js. */
export async function setFake(page: Page, name: string, value: unknown) {
  await page.evaluate(
    ([n, v]) => {
      ;(window as unknown as Record<string, unknown>)[n as string] = v
    },
    [name, value] as const
  )
}
