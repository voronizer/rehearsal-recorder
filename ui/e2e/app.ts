import type { Page } from "@playwright/test"
import { fileURLToPath } from "node:url"

/** How long the fake's own takes are: TAKE in fake-bridge.js. */
export const TAKE_SECONDS = 6

const FAKE = fileURLToPath(new URL("./fake-bridge.js", import.meta.url))

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

/** The calls the interface made into the fake Python side, by name. */
export function calls(page: Page, name: string): Promise<{ name: string; args: unknown[] }[]> {
  return page.evaluate(
    (n) =>
      (window as unknown as { __CALLS__: { name: string; args: unknown[] }[] }).__CALLS__.filter(
        (c) => c.name === n
      ),
    name
  )
}
