import { expect, openApp, test } from "./app.ts"
import type { Page } from "@playwright/test"

// The fake Python side's metronome (fake-bridge.js), which the interface's
// own tests are written against: it follows the next take's name, holds the
// row's change, and runs a take's count-in and click by the clock. These
// call it straight, as the interface does, with no screen in between.

type Answer = { ok: boolean; error?: string } & Record<string, unknown>
type State = {
  phase: string
  tempo: number | null
  signature: string
  per_bar: number
  on: boolean
  case: string
  song: { id: number; title: string; tempo: number | null; signature: string | null } | null
  held: boolean
  last_take: { folder: string; take_number: number; name: string } | null
  upcoming: [number, number][]
  count: number
  since_count_in_ms: number | null
  output_missing: string | null
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
  await rehearse(page)
  expect(await state(page)).toMatchObject({
    phase: "idle", case: "free", song: null, tempo: null, signature: "4/4", per_bar: 4,
    on: true, held: false, count: 0, since_count_in_ms: null, output_missing: null,
  })
  await name(page, "Pałyn")
  expect(await state(page)).toMatchObject({
    case: "song", tempo: 128, signature: "4/4", held: false,
    song: { title: "Pałyn", tempo: 128, signature: "4/4" },
  })
  await name(page, "Ahoń")
  expect(await state(page)).toMatchObject({
    case: "song", tempo: 198, signature: "6/8", per_bar: 6,
    song: { title: "Ahoń", tempo: 198, signature: "6/8" },
  })
  await name(page, "Sonca")
  expect(await state(page)).toMatchObject({ tempo: 96, signature: "3/4", per_bar: 3 })
  await name(page, "Dym")
  expect(await state(page)).toMatchObject({
    case: "song_without", tempo: null, held: false,
    song: { title: "Dym", tempo: null, signature: null },
  })
  await name(page, "Take 4")
  expect(await state(page)).toMatchObject({ case: "free", song: null, tempo: null })
  // A title no song has: still a song, which the library does not know yet.
  await name(page, "Zorka")
  expect(await state(page)).toMatchObject({ case: "song_without", song: null, tempo: null })
})

test("a change in the row is held until another song, and saves to the song", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  await call(page, "metronome_set", 120, "4/4")
  expect(await state(page)).toMatchObject({ tempo: 120, held: true, song: { tempo: 128 } })
  // A keystroke in the same song's name changes nothing.
  await name(page, "Pałyn 3")
  expect(await state(page)).toMatchObject({ tempo: 120, held: true })
  // Another song takes its own, and the song it left is back as it was.
  await name(page, "Viasna")
  expect(await state(page)).toMatchObject({ tempo: 128, held: false })
  await name(page, "Pałyn")
  expect(await state(page)).toMatchObject({ tempo: 128, held: false })
  // Saved, the row and the song agree, and the song's page says so.
  await call(page, "metronome_set", 140, "3/4")
  expect(await state(page)).toMatchObject({ held: true, per_bar: 3 })
  expect((await call(page, "metronome_save_to_song")).ok).toBe(true)
  expect(await state(page)).toMatchObject({
    tempo: 140, signature: "3/4", held: false, song: { tempo: 140, signature: "3/4" },
  })
  const songs = (await call<{ songs: { title: string; tempo: number; signature: string }[] }>(page, "list_songs")).songs
  expect(songs.find((s) => s.title === "Pałyn")).toMatchObject({ tempo: 140, signature: "3/4" })
})

test("a song with no tempo takes the row's, and a free take keeps its own", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Dym")
  await call(page, "metronome_set", 104, "6/8")
  expect(await state(page)).toMatchObject({ case: "song_without", tempo: 104, held: true })
  expect((await call(page, "metronome_save_to_song")).ok).toBe(true)
  expect(await state(page)).toMatchObject({ case: "song", held: false, song: { tempo: 104, signature: "6/8" } })
  await name(page, "Take 4")
  await call(page, "metronome_set", 110, "4/4")
  expect(await state(page)).toMatchObject({ case: "free", tempo: 110, held: false })
  await name(page, "Take 5")
  expect(await state(page)).toMatchObject({ tempo: 110 })
  expect((await call(page, "metronome_save_to_song")).ok).toBe(false)
  await name(page, "Viasna")
  expect(await state(page)).toMatchObject({ tempo: 128 })
})

test("the row refuses a tempo outside its range, and clears with none", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  expect((await call(page, "metronome_set", 301, "4/4")).ok).toBe(false)
  expect((await call(page, "metronome_set", 450, "6/8")).ok).toBe(true)
  expect((await call(page, "metronome_set", 59, "6/8")).ok).toBe(false)
  expect((await call(page, "metronome_set", 120, "5/4")).ok).toBe(false)
  expect((await call(page, "metronome_set", 120.5, "4/4")).ok).toBe(false)
  expect((await call(page, "metronome_set", null, "4/4")).ok).toBe(true)
  expect(await state(page)).toMatchObject({ tempo: null, held: true })
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
  for (const [inMs, index] of counting.upcoming) {
    expect(inMs).toBeGreaterThanOrEqual(0)
    expect(inMs).toBeLessThanOrEqual(1500)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(4)
  }
  expect(counting.upcoming.length).toBeGreaterThan(0)
  // A bar of four at 300 a minute is 0.8 s.
  await expect.poll(async () => (await state(page)).phase).toBe("take")
  const taking = await state(page)
  expect(taking.count).toBe(0)
  expect(taking.since_count_in_ms).toBeGreaterThanOrEqual(0)
  const draft = (await call(page, "stop_take")) as Answer
  expect(draft).toMatchObject({ ok: true, tempo: 300, signature: "4/4", click: true })
  expect((await state(page)).phase).toBe("idle")
  const kept = (await call(page, "keep_take", draft.take_number, draft.temp_dir, "Pałyn", 6, draft.tracks, [])) as Answer
  expect(kept.take).toMatchObject({ tempo: 300, signature: "4/4", click: true })
})

test("the count-in follows its setting, and 6/8 counts to six", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Ahoń")
  await call(page, "metronome_set", 600, "6/8")
  await call(page, "set_metronome_setting", "count_in_bars", 2)
  await call(page, "start_take")
  const seen = new Set<number>()
  await expect
    .poll(async () => {
      const s = await state(page)
      if (s.phase === "count") seen.add(s.count)
      expect(s.per_bar).toBe(6)
      return s.phase
    }, { intervals: [20] })
    .toBe("take")
  // Two bars of six: the clicks are counted on through the second bar.
  expect(Math.max(...seen)).toBeGreaterThan(6)
  await call(page, "stop_take")
  await call(page, "set_metronome_setting", "count_in_bars", 0)
  await call(page, "start_take")
  expect(await state(page)).toMatchObject({ phase: "take", count: 0 })
  expect((await state(page)).since_count_in_ms).toBeGreaterThanOrEqual(0)
})

test("with the switch off a take keeps its tempo and not the click", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  await call(page, "metronome_set_on", false)
  expect((await state(page)).on).toBe(false)
  await call(page, "start_take")
  expect(await state(page)).toMatchObject({ phase: "take", on: false, tempo: 128, since_count_in_ms: null, upcoming: [] })
  const draft = (await call(page, "stop_take")) as Answer
  expect(draft).toMatchObject({ tempo: 128, signature: "4/4", click: false })
})

test("switching the click off mid-take silences it and the take stays a click take", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  await call(page, "metronome_set", 300, "4/4")
  await call(page, "start_take")
  await expect.poll(async () => (await state(page)).phase).toBe("take")
  expect((await state(page)).upcoming.length).toBeGreaterThan(0)
  await call(page, "metronome_set_on", false)
  expect(await state(page)).toMatchObject({ phase: "take", on: false, upcoming: [] })
  expect((await state(page)).since_count_in_ms).not.toBeNull()
  const draft = (await call(page, "stop_take")) as Answer
  expect(draft).toMatchObject({ tempo: 300, click: true })
})

test("a take with no tempo has no click", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Take 1")
  await call(page, "start_take")
  expect(await state(page)).toMatchObject({ phase: "take", tempo: null, since_count_in_ms: null, upcoming: [] })
  const draft = (await call(page, "stop_take")) as Answer
  expect(draft).toMatchObject({ tempo: null, signature: null, click: false })
})

test("the first click take of a song gives it a tempo, and a false start does not", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Dym")
  await call(page, "metronome_set", 104, "4/4")
  await call(page, "start_take")
  const thrown = (await call(page, "stop_take")) as Answer
  await call(page, "discard_take", thrown.temp_dir)
  expect(await state(page)).toMatchObject({ case: "song_without", held: true, song: { tempo: null } })
  await call(page, "start_take")
  const draft = (await call(page, "stop_take")) as Answer
  await call(page, "keep_take", draft.take_number, draft.temp_dir, "Dym", 6, draft.tracks, [])
  expect(await state(page)).toMatchObject({
    case: "song", held: false, song: { tempo: 104, signature: "4/4" },
    last_take: { name: "Dym 1", take_number: 2 },
  })
})

test("the click runs between takes, retimes in step and stops at Record", async ({ page }) => {
  await openApp(page)
  await rehearse(page, "Pałyn")
  expect((await call(page, "metronome_play")).ok).toBe(true)
  const running = await state(page)
  expect(running.phase).toBe("preview")
  expect(running.upcoming.length).toBeGreaterThan(0)
  await call(page, "metronome_set", 240, "4/4")
  const faster = await state(page)
  expect(faster).toMatchObject({ phase: "preview", tempo: 240 })
  // Clicks every 0.25 s at 240 a minute.
  const gaps = faster.upcoming.slice(1).map((c, i) => c[0] - faster.upcoming[i][0])
  expect(gaps.length).toBeGreaterThan(0)
  for (const g of gaps) expect(g).toBeCloseTo(250, 0)
  await call(page, "metronome_stop")
  expect((await state(page)).phase).toBe("idle")
  await call(page, "metronome_play")
  await call(page, "start_take")
  expect((await state(page)).phase).toBe("count")
  await call(page, "stop_take")
  expect((await call(page, "metronome_play", 1)).ok).toBe(true)
  await call(page, "metronome_stop")
  // No tempo, no click to run.
  await call(page, "metronome_set", null, "4/4")
  expect((await call(page, "metronome_play")).ok).toBe(false)
})

test("a click output that is missing is told, and the click goes on", async ({ page }) => {
  await openApp(page, { before: "window.__CLICK_MISSING__ = 'X18';" })
  await rehearse(page, "Pałyn")
  expect((await state(page)).output_missing).toBe("X18")
})

test("the settings are kept with their defaults, and refuse what is out of range", async ({ page }) => {
  await openApp(page)
  const settings = await call<Record<string, unknown>>(page, "get_settings")
  expect(settings).toMatchObject({
    click_device_index: null, click_channels: null, click_sound: "click", click_volume: 0.7,
    count_in_bars: 1, tempo_in_wav: true, metronome_on: true,
  })
  expect((await call(page, "set_metronome_setting", "click_sound", "wood")).ok).toBe(true)
  expect((await call(page, "set_metronome_setting", "click_volume", 0.4)).ok).toBe(true)
  expect((await call(page, "set_metronome_setting", "tempo_in_wav", false)).ok).toBe(true)
  expect((await call(page, "set_metronome_setting", "click_sound", "gong")).ok).toBe(false)
  expect((await call(page, "set_metronome_setting", "click_volume", 2)).ok).toBe(false)
  expect((await call(page, "set_metronome_setting", "count_in_bars", 3)).ok).toBe(false)
  expect((await call(page, "set_metronome_setting", "nonsense", 1)).ok).toBe(false)
  expect((await call(page, "set_click_device", 1)).ok).toBe(true)
  expect((await call(page, "set_click_channels", [3, 4])).ok).toBe(true)
  expect((await call(page, "set_click_device", 77)).ok).toBe(false)
  expect((await call(page, "set_click_channels", [0, 2])).ok).toBe(false)
  await call(page, "metronome_set_on", false)
  expect(await call(page, "get_settings")).toMatchObject({
    click_device_index: 1, click_channels: [3, 4], click_sound: "wood", click_volume: 0.4,
    count_in_bars: 1, tempo_in_wav: false, metronome_on: false,
  })
  // They survive a reload, as the config does.
  await page.reload()
  expect(await call(page, "get_settings")).toMatchObject({ click_sound: "wood", metronome_on: false })
})

test("the output list says which device cannot play the click", async ({ page }) => {
  await openApp(page, { before: "window.__HOST_API__ = 'Windows WASAPI';" })
  const devices = await call<{ name: string; host_api: string; click_unavailable: string | null }[]>(page, "list_output_devices")
  const refused = devices.filter((d) => d.click_unavailable)
  expect(refused).toHaveLength(1)
  expect(refused[0]).toMatchObject({ name: "X32 USB", host_api: "ASIO" })
  expect(refused[0].click_unavailable).toBe("Another ASIO card can't play while one records.")
  expect((await call(page, "set_click_device", 3)).ok).toBe(false)
})

test("counting a tempo and setting a song's, as Part 10 and Part 7 have them", async ({ page }) => {
  await openApp(page)
  expect(await call(page, "count_tempo", "/rec/old", 1, "4/4")).toMatchObject({ ok: true, tempo: 128 })
  expect((await call(page, "count_tempo", "/rec/nowhere", 1, "4/4")).ok).toBe(false)
  const songs = (await call<{ songs: { id: number; title: string }[] }>(page, "list_songs")).songs
  const id = songs.find((s) => s.title === "Pałyn")!.id
  expect((await call(page, "set_song_tempo", id, 150, "2/4")).ok).toBe(true)
  const page150 = await call<{ tempo: number; signature: string }>(page, "get_song", id)
  expect(page150).toMatchObject({ tempo: 150, signature: "2/4" })
  expect((await call(page, "set_song_tempo", id, 150, "5/4")).ok).toBe(false)
  expect((await call(page, "set_song_tempo", id, 20, "4/4")).ok).toBe(false)
  expect((await call(page, "set_song_tempo", 9999, 120, "4/4")).ok).toBe(false)
  expect((await call(page, "set_song_tempo", id, null, null)).ok).toBe(true)
  expect(await call(page, "get_song", id)).toMatchObject({ tempo: null, signature: null })
})

test("the count comes from the song's take: Dym 104, Ptuska 86", async ({ page }) => {
  await openApp(page, { before: "window.__TONIGHT__ = [{name:'Dym', duration_sec:200}, {name:'Ptuška', duration_sec:200}];" })
  await call(page, "start_rehearsal", "Tuesday", 0, 44100, [], 24, null)
  const folder = ((await call(page, "session_state")) as unknown as { folder: string }).folder
  expect(await call(page, "count_tempo", folder, 1, "4/4")).toMatchObject({ ok: true, tempo: 104 })
  expect(await call(page, "count_tempo", folder, 2, "4/4")).toMatchObject({ ok: true, tempo: 86 })
  // In 6/8 the number counts eighths, twice the quarters.
  expect(await call(page, "count_tempo", folder, 1, "6/8")).toMatchObject({ ok: true, tempo: 208 })
  expect((await call(page, "count_tempo", folder, 77, "4/4")).ok).toBe(false)
})

test("pads tap after Tap is pressed, and each tap is read once", async ({ page }) => {
  await openApp(page)
  const tap = () => page.evaluate(() => (window as unknown as { __PAD_TAP__: () => void }).__PAD_TAP__())
  // Not listening: a hit is not a tap.
  await tap()
  expect(await call(page, "metronome_taps")).toEqual({ ms_ago: [] })
  expect((await call(page, "metronome_tap_listen")).ok).toBe(true)
  await tap()
  await page.waitForTimeout(60)
  await tap()
  const heard = (await call<{ ms_ago: number[] }>(page, "metronome_taps")).ms_ago
  expect(heard).toHaveLength(2)
  expect(heard[0]).toBeGreaterThan(heard[1])
  expect(heard[1]).toBeGreaterThanOrEqual(0)
  expect(await call(page, "metronome_taps")).toEqual({ ms_ago: [] })
})

test("the player's click holds, and preview and the rest answer", async ({ page }) => {
  await openApp(page)
  expect((await call(page, "player_set_click", true)).ok).toBe(true)
  expect((await call(page, "metronome_preview")).ok).toBe(true)
  expect((await call(page, "metronome_preview", "hihat")).ok).toBe(true)
  expect((await call(page, "metronome_preview", "gong")).ok).toBe(false)
})

test("takes and songs carry their tempo, the past rehearsals' takes too", async ({ page }) => {
  await openApp(page)
  const old = await call<{ takes: { name: string; tempo: number | null; signature: string | null; click: boolean }[] }>(
    page, "get_rehearsal", "/rec/old")
  expect(old.takes[0]).toMatchObject({ name: "Pałyn 1", tempo: 128, signature: "4/4", click: true })
  const older = await call<{ takes: { song: string | null; tempo: number | null; click: boolean }[] }>(
    page, "get_rehearsal", "/rec/older")
  expect(older.takes.find((t) => t.song === "Daroha")).toMatchObject({ tempo: 118, click: true })
  const quiet = await call<{ takes: { tempo: number | null; signature: string | null; click: boolean }[] }>(
    page, "get_rehearsal", "/rec/quiet")
  expect(quiet.takes[0]).toMatchObject({ tempo: null, signature: null, click: false })
  const index = await call<{ songs: { id: number; title: string; tempo: number | null; signature: string | null }[] }>(
    page, "list_songs")
  const by = (title: string) => index.songs.find((s) => s.title === title)
  expect(by("Pałyn")).toMatchObject({ tempo: 128, signature: "4/4" })
  expect(by("Daroha")).toMatchObject({ tempo: 118, signature: "4/4" })
  const choices = await call<{ other: { song: string; tempo: number | null; signature: string | null }[] }>(
    page, "song_choices")
  expect(choices.other.find((c) => c.song === "Ahoń")).toMatchObject({ tempo: 198, signature: "6/8" })
  expect(choices.other.find((c) => c.song === "Dym")).toMatchObject({ tempo: null, signature: null })
})

test("a rename keeps a song's tempo, and a merge keeps the target's or takes the merged song's", async ({ page }) => {
  await openApp(page, { before: "window.__EXTRA_SONGS__ = ['Zorka'];" })
  const ids = async () =>
    Object.fromEntries(
      (await call<{ songs: { id: number; title: string }[] }>(page, "list_songs")).songs.map((s) => [s.title, s.id])
    )
  const { Daroha, Zorka, Pałyn } = await ids()
  expect((await call(page, "rename_song", Daroha, "Daroha nova")).ok).toBe(true)
  expect(await call(page, "get_song", Daroha)).toMatchObject({ title: "Daroha nova", tempo: 118 })
  // Zorka has no tempo, so it takes the merged song's.
  expect((await call(page, "merge_songs", Daroha, Zorka)).ok).toBe(true)
  expect(await call(page, "get_song", Zorka)).toMatchObject({ title: "Zorka", tempo: 118, signature: "4/4" })
  // Pałyn has one, and keeps it.
  expect((await call(page, "merge_songs", Zorka, Pałyn)).ok).toBe(true)
  expect(await call(page, "get_song", Pałyn)).toMatchObject({ tempo: 128, signature: "4/4" })
})
