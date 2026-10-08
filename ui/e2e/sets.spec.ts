import { expect, openApp, test } from "./app.ts"
import type { Page } from "@playwright/test"

// Song sets (issue #12 step 8): a set is a named list of songs in order,
// kept in the library and picked beside Start rehearsal.

type Bridge = { pywebview: { api: Record<string, (...a: unknown[]) => Promise<unknown>> } }

/** A call straight into the fake Python side. */
const py = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) => (window as unknown as Bridge).pywebview.api[n as string](...(a as unknown[])),
    [name, args] as const
  )

test("sets made through the bridge come back in order", async ({ page }) => {
  await openApp(page)
  await py(page, "add_set", "Gig at Hrodna", ["Pałyn", "Viasna", "Ahoń"])
  await py(page, "add_set", "New songs", ["Kalyханka", "Dym"])
  const sets = (await py(page, "list_sets")) as { id: number; name: string; songs: { title: string; new: boolean }[] }[]
  expect(sets.map((s) => s.name)).toEqual(["Gig at Hrodna", "New songs"])
  expect(sets[0].songs.map((x) => x.title)).toEqual(["Pałyn", "Viasna", "Ahoń"])
  expect(sets[1].songs).toEqual([
    { title: "Kalyханka", new: true },
    { title: "Dym", new: false },
  ])
})
