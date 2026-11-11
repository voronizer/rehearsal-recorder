import { readFileSync } from "node:fs"
import { afterEach, expect, test, vi } from "vitest"
import { backingQuery, channelsQuery, keepBackingHeard, peaksQuery, queryClient, SignedOut } from "./api"

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url)))
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
const row = (n: number, v: number) => Array.from({ length: n }, () => v)

afterEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
})

test("a wave is asked of the service past the browser's copy, with both sides when they are right", async () => {
  const asked: RequestInit[] = []
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    asked.push(init)
    return json({ peaks: row(4, 0.8), sides: [row(4, 0.8), row(4, 0.2)] })
  })
  expect(await queryClient.fetchQuery(peaksQuery("/files/t/1/1.peaks"))).toEqual({
    peaks: row(4, 0.8),
    sides: [row(4, 0.8), row(4, 0.2)],
  })
  expect(asked).toEqual([{ cache: "no-cache" }])
})

test("sides that are not two rows as long as the wave are left out", async () => {
  const peaks = row(4, 0.8)
  for (const sides of [[row(4, 0.8)], [row(4, 0.8), row(3, 0.2)], [row(4, 0.8), row(4, 0.2), row(4, 0.1)], "both", [row(4, 0.8), ["a", "b", "c", "d"]], null]) {
    vi.stubGlobal("fetch", async () => json({ peaks, sides }))
    expect(await queryClient.fetchQuery(peaksQuery("/w.peaks"))).toEqual({ peaks })
    queryClient.clear()
  }
  // A wave sent by an older РЭХА has none.
  vi.stubGlobal("fetch", async () => json({ peaks }))
  expect(await queryClient.fetchQuery(peaksQuery("/w.peaks"))).toEqual({ peaks })
})

test("a wave that is not there, or is no wave, is none", async () => {
  vi.stubGlobal("fetch", async () => new Response("gone", { status: 404 }))
  expect(await queryClient.fetchQuery(peaksQuery("/a.peaks"))).toBeNull()
  vi.stubGlobal("fetch", async () => json({ sides: [[1], [1]] }))
  expect(await queryClient.fetchQuery(peaksQuery("/b.peaks"))).toBeNull()
})

/** The service's file route, as far as a ranged GET of a track needs it. */
const ranged = (file: Uint8Array, asked: string[] = []) =>
  vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
    asked.push(init.headers.Range)
    const [from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range)!.slice(1).map(Number)
    const last = Math.min(to, file.length - 1)
    return new Response(file.slice(from, last + 1), { status: 206, headers: { "Content-Range": `bytes ${from}-${last}/${file.length}` } })
  })

test("a track's channels are read from its MP3's first bytes, once for the page", async () => {
  const asked: string[] = []
  vi.stubGlobal("fetch", ranged(fixture("t7.mp3"), asked))
  expect(await queryClient.fetchQuery(channelsQuery("/files/t/1/1.mp3"))).toBe(2)
  expect(await queryClient.fetchQuery(channelsQuery("/files/t/1/1.mp3"))).toBe(2)
  expect(asked).toEqual(["bytes=0-16383"])
  vi.stubGlobal("fetch", ranged(fixture("t1.mp3")))
  expect(await queryClient.fetchQuery(channelsQuery("/files/t/1/2.mp3"))).toBe(1)
  // A server that sends the whole file is read as far.
  vi.stubGlobal("fetch", async () => new Response(fixture("t7.mp3")))
  expect(await queryClient.fetchQuery(channelsQuery("/files/t/1/3.mp3"))).toBe(2)
})

test("an MP3 that cannot be read, or did not come, has 0 channels, and is not asked for again", async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array(2000)))
  vi.stubGlobal("fetch", fetch)
  expect(await queryClient.fetchQuery(channelsQuery("/junk.mp3"))).toBe(0)
  vi.stubGlobal("fetch", async () => new Response("gone", { status: 404 }))
  expect(await queryClient.fetchQuery(channelsQuery("/gone.mp3"))).toBe(0)
  const offline = vi.fn(async () => {
    throw new TypeError("Failed to fetch")
  })
  vi.stubGlobal("fetch", offline)
  expect(await queryClient.fetchQuery(channelsQuery("/offline.mp3"))).toBe(0)
  expect(offline).toHaveBeenCalledTimes(1)
  // Signed out, the page goes to sign-in.
  vi.stubGlobal("fetch", async () => new Response("", { status: 401 }))
  await expect(queryClient.fetchQuery(channelsQuery("/out.mp3"))).rejects.toBeInstanceOf(SignedOut)
})

test("Backing's M kept in quick presses ends as the last press left it, and is what is read after", async () => {
  const answers: Array<(heard: Record<string, boolean>) => void> = []
  const sent: unknown[] = []
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return json({ heard: await new Promise<Record<string, boolean>>((done) => answers.push(done)) })
  })
  const first = keepBackingHeard(3, true)
  const second = keepBackingHeard(3, false)
  await vi.waitFor(() => expect(answers).toHaveLength(1))
  await new Promise((done) => setTimeout(done, 20))
  // The next goes only once the first is answered, so they reach the service in order.
  expect(sent).toEqual([{ song_id: 3, heard: true }])
  answers[0]({ "3": true })
  await vi.waitFor(() => expect(answers).toHaveLength(2))
  answers[1]({ "3": false })
  await Promise.all([first, second])
  expect(sent).toEqual([{ song_id: 3, heard: true }, { song_id: 3, heard: false }])
  expect(queryClient.getQueryData(backingQuery.queryKey)).toEqual({ heard: { "3": false } })
})
