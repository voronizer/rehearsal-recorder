import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { database } from "../worker/shared/db"
import type { Bindings } from "../worker/shared/env"
import { shareLink } from "../worker/shared/schema"
import { putTake, ready } from "../worker/takes/store"
import { ORIGIN, answer, call, commentOn, del, markAt, member, named, post, read, shownTake, signInOwner, takeMeta } from "./helpers"

const bindings = env as unknown as Bindings

const HEARD = { volumes: { Bass: 0.5 }, muted: ["Drums"], soloed: [] }
const PEAKS = Array.from({ length: 1200 }, (_, i) => (i % 10) / 10)
const bytes = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * seed) % 256)
const GONE = { error: "This link no longer works." }

/** A shown take with every file РЭХА sends for it put in R2, generation `gen`. */
async function takeWithFiles(gen = 1, uid?: string) {
  const id = uid ?? (await shownTake())
  for (const [name, type] of [
    ["1.mp3", "audio/mpeg"],
    ["2.mp3", "audio/mpeg"],
    ["1.flac", "audio/flac"],
    ["2.flac", "audio/flac"],
    ["1.peaks", "application/json"],
    ["2.peaks", "application/json"],
    ["3.mid", "audio/midi"],
  ] as const) {
    const body = name.endsWith(".peaks") ? JSON.stringify({ peaks: PEAKS }) : bytes(1000, gen + name.length)
    await env.FILES.put(`takes/${id}/${gen}/${name}`, body, { httpMetadata: { contentType: type } })
  }
  return id
}

async function makeLink(cookie: string, uid: string, over: Record<string, unknown> = {}): Promise<string> {
  const res = await answer<{ id: string }>(
    post(`/api/takes/${uid}/links`, { for: "", shows: "tracks", download: "none", lasts: "never", heard: HEARD, ...over }, cookie)
  )
  expect(res.status).toBe(200)
  return res.body.id
}

async function mixLink(cookie: string, uid: string, download = "none"): Promise<string> {
  const id = await makeLink(cookie, uid, { shows: "mix", download, heard: undefined, peaks: PEAKS })
  const up = await call(`/api/links/${id}/mix`, { method: "PUT", body: bytes(3000, 7), headers: { "Content-Type": "audio/mpeg" } }, cookie)
  expect(up.status).toBe(200)
  return id
}

const status = async (path: string, init: RequestInit = {}) => (await call(path, init)).status

test("a tracks link opens without signing in and shows no member", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  await post(`/api/takes/${uid}/star`, {}, owner)
  const id = await makeLink(owner, uid)
  const page = await read(`/api/l/${id}`)
  expect(page.uid).toBe(uid)
  expect(page.files_at).toBe(`/files/l/${id}/1`)
  expect(page.tracks.map((t: { mp3: string }) => t.mp3)).toEqual([`/files/l/${id}/1/1.mp3`, `/files/l/${id}/1/2.mp3`])
  expect(page.stars).toEqual([])
  expect(page.starred_by_me).toBe(false)
  expect(page.marks).toEqual([])
  expect(page.labels).toEqual([])
  expect(page.files).toEqual([])
  expect(page.link).toEqual({ id, shows: "tracks", download: "none", heard: HEARD, mix: false })
  const text = JSON.stringify(page)
  expect(text).not.toContain("@")
  const { id: ownerId } = await read<{ id: string }>("/api/me", owner)
  expect(text).not.toContain(ownerId)
})

test("a marks link has the marks and their labels, with stand-ins for the members", async () => {
  const owner = await signInOwner()
  await named(owner, "Alex")
  const vik = await member(owner, "vik@example.com")
  await named(vik.cookie, "Vik")
  const uid = await takeWithFiles()
  const first = await markAt(owner, uid, 10, "The bridge drags here")
  await commentOn(vik.cookie, first.id, "Agreed")
  await markAt(owner, uid, 20, "Fill too long?")
  const id = await makeLink(owner, uid, { shows: "marks", download: "all" })
  const page = await read(`/api/l/${id}`)
  expect(page.marks.map((m: { member_id: string; author: string; mine: boolean }) => [m.member_id, m.author, m.mine])).toEqual([
    ["m1", "Alex", false],
    ["m1", "Alex", false],
  ])
  expect(page.marks[0].comments.map((c: { member_id: string; author: string; mine: boolean }) => [c.member_id, c.author, c.mine])).toEqual([
    ["m2", "Vik", false],
  ])
  expect(page.labels.length).toBeGreaterThan(0)
  expect(page.labels.find((l: { id: number }) => l.id === first.label_id).marks).toBe(2)
  expect(page.files.length).toBeGreaterThan(0)
  expect(JSON.stringify(page)).not.toContain(vik.id)
})

test("a mix link is one track, the mix", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  const id = await mixLink(owner, uid)
  const page = await read(`/api/l/${id}`)
  expect(page.tracks).toEqual([
    { position: 1, name: "The mix", icon: null, mp3: `/files/l/${id}/mix.mp3`, peaks: `/files/l/${id}/mix.peaks`, kind: null },
  ])
  expect(page.files_at).toBe(`/files/l/${id}`)
  expect(page.notes).toEqual([])
  expect(page.balance).toEqual({})
  expect(page.gain).toBe(1)
  expect(page.drift).toBeNull()
  expect(page.shape).toHaveLength(120)
  expect(page.link).toEqual({ id, shows: "mix", download: "none", heard: null, mix: true })
})

test("each link reaches only what it allows", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  const other = await takeWithFiles()
  const tracks = await makeLink(owner, uid)
  const at = (link: string, name: string, gen = 1) => `/files/l/${link}/${gen}/${name}`

  expect(await status(at(tracks, "1.mp3"))).toBe(200)
  expect(await status(at(tracks, "1.mp3"), { headers: { Range: "bytes=0-9" } })).toBe(206)
  expect(await status(at(tracks, "1.peaks"))).toBe(200)
  expect(await status(at(tracks, "3.mid"))).toBe(200)
  expect(await status(at(tracks, "1.flac"))).toBe(404)
  expect(await status(`${at(tracks, "1.mp3")}?download=1`)).toBe(404)
  expect(await status(at(tracks, "1.mp3", 2))).toBe(404)
  expect(await status(`/files/l/${tracks}/1/../../${other}/1/1.mp3`)).toBe(404)
  expect(await status(at(tracks, "mix.mp3"))).toBe(404)
  expect(await status(`/files/l/${tracks}/mix.mp3`)).toBe(404)

  const all = await makeLink(owner, uid, { download: "all" })
  expect(await status(at(all, "1.flac"))).toBe(200)
  const saved = await call(`${at(all, "1.flac")}?download=1`)
  expect(saved.status).toBe(200)
  expect(saved.headers.get("Content-Disposition")).toContain("Viasna 12 - Bass.flac")
  expect(new Uint8Array(await saved.arrayBuffer())).toEqual(bytes(1000, 1 + "1.flac".length))

  const mix = await mixLink(owner, uid)
  expect(await status(at(mix, "1.mp3"))).toBe(404)
  expect(await status(`/files/l/${mix}/mix.mp3`)).toBe(200)
  expect(await status(`/files/l/${mix}/mix.peaks`)).toBe(200)
  expect(await status(`/files/l/${mix}/mix.mp3?download=1`)).toBe(404)
  const mixToo = await mixLink(owner, uid, "mix")
  const mp3 = await call(`/files/l/${mixToo}/mix.mp3?download=1`)
  expect(mp3.status).toBe(200)
  expect(mp3.headers.get("Content-Disposition")).toContain("Viasna 12.mp3")
  expect(await status(`/files/l/${mixToo}/mix.peaks?download=1`)).toBe(404)
})

test("a closed, ended, unknown, unfinished or trashed link no longer works", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  const db = database(bindings)
  const closed = await makeLink(owner, uid)
  expect(await status(`/files/l/${closed}/1/1.mp3`)).toBe(200)
  await del(`/api/links/${closed}`, owner)
  const ended = await makeLink(owner, uid)
  await db.update(shareLink).set({ until: "2020-01-01T00:00:00.000Z" }).where(eq(shareLink.id, ended))
  const unfinished = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  const trashedUid = await takeWithFiles()
  const trashed = await makeLink(owner, trashedUid)
  await del(`/api/takes/${trashedUid}`, owner)

  for (const id of [closed, ended, unfinished, trashed, "ABCDEFGHJKLMNPQRSTUVWX"]) {
    expect(await answer(call(`/api/l/${id}`))).toEqual({ status: 404, body: GONE })
    expect(await answer(call(`/files/l/${id}/1/1.mp3`))).toEqual({ status: 404, body: GONE })
    expect(await answer(call(`/files/l/${id}/mix.peaks`))).toEqual({ status: 404, body: GONE })
    expect(await answer(post(`/api/l/${id}/played`, {}))).toEqual({ status: 404, body: GONE })
  }
})

test("after a crop a tracks link plays the new generation and a mix link keeps its mix", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  const tracks = await makeLink(owner, uid)
  const mix = await mixLink(owner, uid)
  const before = (await read(`/api/l/${mix}`)).duration_sec
  await putTake(bindings, uid, takeMeta({ gen: 2, cut_start: 10, duration_sec: 302.48 }) as never)
  await takeWithFiles(2, uid)
  expect(await ready(bindings, uid, 2, "mp3", ORIGIN)).toBe("done")

  const page = await read(`/api/l/${tracks}`)
  expect(page.tracks[0].mp3).toBe(`/files/l/${tracks}/2/1.mp3`)
  expect(page.link.heard).toEqual(HEARD)
  expect(await status(`/files/l/${tracks}/2/1.mp3`)).toBe(200)
  expect(await status(`/files/l/${tracks}/1/1.mp3`)).toBe(404)
  expect(page.duration_sec).toBe(302.48)
  expect(await status(`/files/l/${mix}/mix.mp3`)).toBe(200)
  // The mix keeps the length it was made with, so its clock and wave agree.
  expect(before).not.toBe(302.48)
  expect((await read(`/api/l/${mix}`)).duration_sec).toBe(before)
})

test("a play counts", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  const id = await makeLink(owner, uid)
  expect(await answer(post(`/api/l/${id}/played`, {}))).toEqual({ status: 200, body: { ok: true } })
  expect((await post(`/api/l/${id}/played`, {})).status).toBe(200)
  const [link] = await read<{ plays: number; last_played_at: string | null }[]>("/api/links", owner)
  expect(link.plays).toBe(2)
  expect(link.last_played_at).toEqual(expect.any(String))
})

test("the take page answers as before", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  await post(`/api/takes/${uid}/star`, {}, owner)
  await markAt(owner, uid, 10, "The bridge drags here")
  const page = await read(`/api/takes/${uid}`, owner)
  expect(page.files_at).toBe(`/files/${uid}/1`)
  expect(page.tracks[0].mp3).toBe(`/files/${uid}/1/1.mp3`)
  expect(page.stars).toHaveLength(1)
  expect(page.starred_by_me).toBe(true)
  expect(page.marks[0].mine).toBe(true)
  expect(page.files.length).toBeGreaterThan(0)
  expect(page.link).toBeUndefined()
})

test("a writer who never gave a name is Band member, with B in the circle", async () => {
  const owner = await signInOwner()
  await named(owner, "Alex")
  const vik = await member(owner, "vik@example.com")
  const uid = await takeWithFiles()
  const first = await markAt(vik.cookie, uid, 10, "The bridge drags here")
  await commentOn(vik.cookie, first.id, "Agreed")
  const id = await makeLink(owner, uid, { shows: "marks" })
  const page = await read(`/api/l/${id}`)
  expect([page.marks[0].author, page.marks[0].initial]).toEqual(["Band member", "B"])
  expect([page.marks[0].comments[0].author, page.marks[0].comments[0].initial]).toEqual(["Band member", "B"])
})

test("a link reaches only the files РЭХА sends a take with, whatever else its list names", async () => {
  const owner = await signInOwner()
  const uid = await shownTake({ tracks: [{ position: 1, name: "Bass", icon: "bass", files: ["1.mp3", "1.wav", "1.peaks"] }], notes: [] })
  await env.FILES.put(`takes/${uid}/1/1.wav`, bytes(100, 3))
  const all = await makeLink(owner, uid, { download: "all" })
  expect(await status(`/files/l/${all}/1/1.wav`)).toBe(404)
})

test("an address that is no link says the link no longer works, and a file a link does not reach is no such file", async () => {
  const owner = await signInOwner()
  const uid = await takeWithFiles()
  const tracks = await makeLink(owner, uid)
  const mix = await mixLink(owner, uid)
  const NO_FILE = { status: 404, body: { error: "No such file" } }
  expect(await answer(call(`/api/l/${"A".repeat(65)}`))).toEqual({ status: 404, body: GONE })
  expect(await answer(call(`/files/l/${mix}/1/1.mp3`))).toEqual(NO_FILE)
  expect(await answer(call(`/files/l/${tracks}/mix.mp3`))).toEqual(NO_FILE)
  expect(await answer(call(`/files/l/${tracks}/one/1.mp3`))).toEqual(NO_FILE)
})
