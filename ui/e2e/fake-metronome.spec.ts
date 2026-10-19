import { expect, openApp, test } from "./app.ts"
import type { Page } from "@playwright/test"

// A smoke test of the fake Python side's metronome (fake-bridge.js), which
// the screens' own specs are written against: it follows the next take's
// name, counts in and clicks a take by the clock, and gives a song its tempo.
// These call it straight, as the interface does, with no screen in between;
// the screens exercise the rest of it.

type Answer = { ok: boolean; error?: string } & Record<string, unknown>
type State = {
  phase: string
  tempo: number | null
  signature: string
  per_bar: number
  case: string
  song: { id: number; title: string; tempo: number | null; signature: string | null } | null
  held: boolean
  last_take: { folder: string; take_number: number; name: string } | null
  upcoming: [number, number][]
  count: number
  since_count_in_ms: number | null
}

const call = <T = Answer>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) =>
      (window as unknown as { pywebview: { api: Record<string, (...x: unknown[]) => unknown> } })
        .pywebview.api[n as string](...(a as unknown[])),
    [name, args] as const
  ) as Promise<T>
const state = (page: Page) => call<State>(page, "metronome_state")

/** A rehearsal on, no takes in it, and the next take named `name`. */
async function rehearse(page: Page, name = "") {
  await call(page, "start_rehearsal", "Tuesday", 0, 44100, [], 24, null)
  await call(page, "set_next_take_name", name)
}
const name = (page: Page, text: string) => call(page, "set_next_take_name", text)

test("the row follows the next take's name through Part 2's three cases", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  expect(await state(page)).toMatchObject({
    case: "song", tempo: 128, signature: "4/4", held: false,
    song: { title: "Pałyn", tempo: 128, signature: "4/4" },
  })
  await name(page, "Ahoń")
  expect(await state(page)).toMatchObject({ case: "song", tempo: 198, signature: "6/8", per_bar: 6 })
  await name(page, "Dym")
  expect(await state(page)).toMatchObject({
    case: "song_without", tempo: null, held: false,
    song: { title: "Dym", tempo: null, signature: null },
  })
  await name(page, "Take 4")
  expect(await state(page)).toMatchObject({ case: "free", song: null, tempo: null })
})

test("Record counts in, clicks to Stop and leaves a click take", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  await call(page, "metronome_set", 300, "4/4")
  expect((await call(page, "start_take")).ok).toBe(true)
  const counting = await state(page)
  expect(counting).toMatchObject({ phase: "count", tempo: 300, per_bar: 4 })
  expect(counting.count).toBeGreaterThanOrEqual(1)
  expect(counting.since_count_in_ms).toBeLessThan(0)
  expect(counting.upcoming.length).toBeGreaterThan(0)
  // A bar of four at 300 a minute is 0.8 s.
  await expect.poll(async () => (await state(page)).phase).toBe("take")
  expect(await state(page)).toMatchObject({ count: 0 })
  const draft = (await call(page, "stop_take")) as Answer
  expect(draft).toMatchObject({ ok: true, tempo: 300, signature: "4/4", click: true })
  expect((await state(page)).phase).toBe("idle")
  const kept = (await call(page, "keep_take", draft.take_number, draft.temp_dir, "Pałyn", 6, draft.tracks, [])) as Answer
  expect(kept.take).toMatchObject({ tempo: 300, signature: "4/4", click: true })
})

test("the first kept click take of a song with no tempo gives it the row's", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Dym")
  await call(page, "metronome_set", 104, "4/4")
  expect(await state(page)).toMatchObject({ case: "song_without", held: true, song: { tempo: null } })
  await call(page, "start_take")
  const draft = (await call(page, "stop_take")) as Answer
  await call(page, "keep_take", draft.take_number, draft.temp_dir, "Dym", 6, draft.tracks, [])
  expect(await state(page)).toMatchObject({
    case: "song", held: false, song: { tempo: 104, signature: "4/4" },
    last_take: { name: "Dym 1" },
  })
})

test("a change is held only for a song, and an emptied row is not held", async ({ page }) => {
  await openApp(page)
  // A title no song has yet: there is no song to save to, so nothing is
  // held, as Python's _held says.
  await rehearse(page, "Novaja")
  await call(page, "metronome_set", 120, "4/4")
  expect(await state(page)).toMatchObject({ case: "song_without", song: null, tempo: 120, held: false })
  // An emptied row is not held either: a song's tempo is taken away on its
  // page, not by Save to song.
  await name(page, "Pałyn")
  await call(page, "metronome_set", null, "4/4")
  expect(await state(page)).toMatchObject({ case: "song", tempo: null, held: false })
})
