import { env } from "cloudflare:workers"
import { expect, test, vi } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { commentView } from "../worker/comments/view"
import { purgeTrash } from "../worker/takes/purge"
import { TAKE, reha, takeMeta } from "./helpers"

const MiB = 1024 * 1024
const PART = 10 * MiB
const DAY = 24 * 60 * 60 * 1000

const takeRow = () =>
  env.DB.prepare("SELECT * FROM take WHERE uid = ?").bind(TAKE).first<Record<string, unknown>>()

const comments = async () =>
  (
    await env.DB.prepare("SELECT id, parent_id, at, text, label, colour, from_reha, cut_off FROM comment ORDER BY at, id").all()
  ).results

async function addMember() {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO user (id, name, email, email_verified) VALUES (?, 'Ira', ?, 1)")
    .bind(id, `${id}@example.com`)
    .run()
  return id
}

async function comment(at: number, text: string, parent: number | null = null) {
  const member = await addMember()
  await env.DB.prepare(
    "INSERT INTO comment (take_uid, parent_id, member_id, at, text, created_at) VALUES (?, ?, ?, ?, ?, '2025-10-30T21:00:00.000Z')"
  )
    .bind(TAKE, parent, member, at, text)
    .run()
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

const sha256 = async (data: BufferSource) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("")

/** A file sent whole in one part, as РЭХА sends a small one. */
async function upload(r: Awaited<ReturnType<typeof reha>>, gen: number, name: string, data: Uint8Array<ArrayBuffer>) {
  const started = await r.post(`/api/reha/takes/${TAKE}/files`, { gen, name, size: data.length })
  expect(started.status).toBe(200)
  const { upload_id } = (await started.json()) as { upload_id: string }
  const part = await r.part(`/api/reha/takes/${TAKE}/files/${upload_id}/1?gen=${gen}&name=${name}`, data)
  expect(part.status).toBe(200)
  const { etag } = (await part.json()) as { etag: string }
  const done = await r.post(`/api/reha/takes/${TAKE}/files/${upload_id}/done`, { gen, name, parts: [[1, etag]] })
  expect(done.status).toBe(200)
}

test("a take is hidden until its MP3s are ready", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  expect(await takeRow()).toMatchObject({ shown_gen: null, shown_at: null, name: "Viasna 12", gen: 1 })

  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  const shown = (await takeRow())!
  expect(shown).toMatchObject({ shown_gen: 1, flac_gen: null })
  expect(shown.shown_at).toEqual(expect.any(String))

  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "flac" })).status).toBe(200)
  expect(await takeRow()).toMatchObject({ shown_gen: 1, flac_gen: 1, shown_at: shown.shown_at })
})

test("a file goes up in parts and completes", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  const file = new Uint8Array(2 * PART + 1000)
  file.fill(1, 0, PART)
  file.fill(2, PART, 2 * PART)
  file.fill(3, 2 * PART)

  const started = await r.post(`/api/reha/takes/${TAKE}/files`, { gen: 1, name: "1.flac", size: file.length })
  expect(started.status).toBe(200)
  const { upload_id } = (await started.json()) as { upload_id: string }
  const parts: [number, string][] = []
  for (let n = 1; n <= 3; n++) {
    const res = await r.part(
      `/api/reha/takes/${TAKE}/files/${upload_id}/${n}?gen=1&name=1.flac`,
      file.slice((n - 1) * PART, n * PART)
    )
    expect(res.status).toBe(200)
    parts.push([n, ((await res.json()) as { etag: string }).etag])
  }
  const done = await r.post(`/api/reha/takes/${TAKE}/files/${upload_id}/done`, { gen: 1, name: "1.flac", parts })
  expect(done.status).toBe(200)

  const kept = await env.FILES.get(`takes/${TAKE}/1/1.flac`)
  expect(kept!.size).toBe(file.length)
  expect(kept!.httpMetadata?.contentType).toBe("audio/flac")
  // Compared by their hashes: a diff of 20 MiB would not fit in the test's memory.
  expect(await sha256(await kept!.arrayBuffer())).toBe(await sha256(file))

  // Only the take's own files, for the generation it is on.
  expect((await r.post(`/api/reha/takes/${TAKE}/files`, { gen: 1, name: "9.mp3", size: 10 })).status).toBe(400)
  expect((await r.post(`/api/reha/takes/${TAKE}/files`, { gen: 2, name: "1.mp3", size: 10 })).status).toBe(400)
  const other = crypto.randomUUID()
  expect((await r.post(`/api/reha/takes/${other}/files`, { gen: 1, name: "1.mp3", size: 10 })).status).toBe(404)
})

test("a part over 10 MiB is refused", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  const started = await r.post(`/api/reha/takes/${TAKE}/files`, { gen: 1, name: "1.flac", size: PART + 1 })
  const { upload_id } = (await started.json()) as { upload_id: string }

  const res = await r.part(`/api/reha/takes/${TAKE}/files/${upload_id}/1?gen=1&name=1.flac`, bytes(PART + 1, 7))
  expect(res.status).toBe(413)
  expect(await res.json()).toEqual({ error: "A part is at most 10 MiB" })
})

test("a gone upload says so", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  const started = await r.post(`/api/reha/takes/${TAKE}/files`, { gen: 1, name: "1.mp3", size: 100 })
  const { upload_id } = (await started.json()) as { upload_id: string }
  await env.FILES.resumeMultipartUpload(`takes/${TAKE}/1/1.mp3`, upload_id).abort()

  const part = await r.part(`/api/reha/takes/${TAKE}/files/${upload_id}/1?gen=1&name=1.mp3`, bytes(100, 1))
  expect(part.status).toBe(404)
  expect(await part.json()).toMatchObject({ gone: true })
  const done = await r.post(`/api/reha/takes/${TAKE}/files/${upload_id}/done`, {
    gen: 1,
    name: "1.mp3",
    parts: [[1, "nothing"]],
  })
  expect(done.status).toBe(404)
  expect(await done.json()).toMatchObject({ gone: true })
})

test("a take sent again leaves the trash with its comments", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  await comment(42, "The bridge drags here")

  expect((await r.del(`/api/reha/takes/${TAKE}`)).status).toBe(200)
  expect((await takeRow())!.trashed_at).toEqual(expect.any(String))

  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  expect((await takeRow())!.trashed_at).toBeNull()
  expect((await comments()).map((c) => c.text)).toEqual(["The bridge drags here"])
})

test("a crop shifts comments when its MP3s are ready", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  await upload(r, 1, "1.mp3", bytes(10, 1))
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  await comment(30, "Fill too long?")

  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ gen: 2, cut_start: 10, duration_sec: 302.48 }))).status).toBe(200)
  expect((await comments())[0]).toMatchObject({ at: 30 })
  await upload(r, 2, "1.mp3", bytes(10, 2))
  expect(await env.FILES.head(`takes/${TAKE}/1/1.mp3`)).not.toBeNull()

  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 2, what: "mp3" })).status).toBe(200)
  expect((await comments())[0]).toMatchObject({ at: 20, cut_off: 0 })
  expect(await takeRow()).toMatchObject({ shown_gen: 2, pending_cut: 0 })
  // The older generation's files go.
  expect(await env.FILES.head(`takes/${TAKE}/1/1.mp3`)).toBeNull()
  expect(await env.FILES.head(`takes/${TAKE}/2/1.mp3`)).not.toBeNull()
})

test("a comment in the cut part stays at 0:00, marked", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  await comment(5, "Count-in too fast")

  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ gen: 2, cut_start: 10 }))).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 2, what: "mp3" })).status).toBe(200)
  expect((await comments())[0]).toMatchObject({ at: 0, cut_off: 1, text: "Count-in too fast" })
})

test("an undone crop moves the comments on", async () => {
  const r = await reha()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  await comment(30, "Fill too long?")

  // The start put back: the new generation begins 4 s before the one the band hears.
  const marks = [{ at: 1, label: "Count", colour: "grey", note: "Sticks" }]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ gen: 2, cut_start: -4, marks }))).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 2, what: "mp3" })).status).toBe(200)
  expect((await comments()).map((c) => [c.at, c.text, c.cut_off])).toEqual([
    [1, "Sticks", 0],
    [34, "Fill too long?", 0],
  ])
})

test("a mark before the start of the take the band hears shows at 0:00", () => {
  const row = { id: 1, takeUid: TAKE, parentId: null, memberId: null, at: -3, text: "Sticks", label: "Count", colour: "grey" }
  const view = commentView({ ...row, fromReha: true, closed: false, cutOff: false, createdAt: "", name: null, email: null })
  expect(view.at).toBe(0)
})

test("a mark a hundredth away after a crop is the same mark, its replies stay", async () => {
  const r = await reha()
  const marks = [{ at: 2, label: "Fix", colour: "red", note: "Too fast" }]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ marks }))).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  const fix = (await comments())[0]
  await comment(2, "Agreed", fix.id as number)

  // РЭХА rounds the crop and the mark to hundredths each: 1.66 + 0.33 is 1.99.
  const moved = [{ at: 1.66, label: "Fix", colour: "red", note: "Too fast" }]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ gen: 2, cut_start: 0.33, marks: moved }))).status).toBe(200)
  const now = await comments()
  expect(now.map((c) => c.text)).toEqual(["Too fast", "Agreed"])
  expect(now[0].id).toBe(fix.id)
})

test("marks from REHA replace the earlier ones, replies stay", async () => {
  const r = await reha()
  const marks = [
    { at: 10, label: "Fix", colour: "#e5484d", note: "Too fast" },
    { at: 20, label: "Solo", colour: "#3e63dd", note: "" },
  ]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ marks }))).status).toBe(200)
  const fix = (await comments()).find((c) => c.text === "Too fast")!
  expect(fix).toMatchObject({ at: 10, label: "Fix", colour: "#e5484d", from_reha: 1 })
  await comment(10, "Agreed", fix.id as number)

  const again = [
    { at: 10.001, label: "Fix", colour: "#e5484d", note: "Much too fast" },
    { at: 30, label: "End", colour: "#30a46c", note: "Ring out" },
  ]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ marks: again }))).status).toBe(200)
  const now = await comments()
  expect(now.map((c) => [c.at, c.text, c.from_reha])).toEqual([
    [10, "Much too fast", 1],
    [10, "Agreed", 0],
    [30, "Ring out", 1],
  ])
  expect(now.find((c) => c.text === "Much too fast")!.id).toBe(fix.id)
  expect(now.find((c) => c.text === "Agreed")!.parent_id).toBe(fix.id)
})

test("songs match by title, case-blind", async () => {
  const r = await reha()
  const other = crypto.randomUUID()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ song: "Viasna" }))).status).toBe(200)
  expect(
    (await r.put(`/api/reha/takes/${other}`, takeMeta({ song: "viasna ", number: 13, name: "Viasna 13" }))).status
  ).toBe(200)
  const nobody = crypto.randomUUID()
  expect((await r.put(`/api/reha/takes/${nobody}`, takeMeta({ song: null, number: 14, name: "Take 14" }))).status).toBe(200)

  const songs = (await env.DB.prepare("SELECT id, title FROM song").all()).results
  expect(songs).toEqual([{ id: expect.any(Number), title: "Viasna" }])
  const ids = (await env.DB.prepare("SELECT song_id FROM take ORDER BY number").all()).results.map((t) => t.song_id)
  expect(ids).toEqual([songs[0].id, songs[0].id, null])
})

test("the trash is emptied after 30 days, files and all", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-11-01T12:00:00Z")
  vi.setSystemTime(start)
  const r = await reha()
  const kept = crypto.randomUUID()
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta())).status).toBe(200)
  await upload(r, 1, "1.mp3", bytes(10, 1))
  await upload(r, 1, "1.peaks", bytes(10, 2))
  expect((await r.del(`/api/reha/takes/${TAKE}`)).status).toBe(200)
  vi.setSystemTime(new Date(start.getTime() + 2 * DAY))
  expect((await r.put(`/api/reha/takes/${kept}`, takeMeta({ number: 13, name: "Viasna 13" }))).status).toBe(200)
  expect((await r.del(`/api/reha/takes/${kept}`)).status).toBe(200)

  vi.setSystemTime(new Date(start.getTime() + 30 * DAY + 60 * 1000))
  await purgeTrash(env as unknown as Bindings)

  expect(await takeRow()).toBeNull()
  expect((await env.FILES.list({ prefix: `takes/${TAKE}/` })).objects).toEqual([])
  expect(await env.DB.prepare("SELECT uid FROM take").all()).toMatchObject({ results: [{ uid: kept }] })
})

test("a day's emptying of the trash deletes 20 takes at most, the rest the next day", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-11-01T12:00:00Z")
  vi.setSystemTime(start)
  const r = await reha()
  for (let n = 1; n <= 22; n++) {
    const uid = crypto.randomUUID()
    expect((await r.put(`/api/reha/takes/${uid}`, takeMeta({ number: n, name: `Viasna ${n}` }))).status).toBe(200)
    expect((await r.del(`/api/reha/takes/${uid}`)).status).toBe(200)
  }
  const left = async () => (await env.DB.prepare("SELECT count(*) AS n FROM take").first<{ n: number }>())!.n

  vi.setSystemTime(new Date(start.getTime() + 31 * DAY))
  expect(await purgeTrash(env as unknown as Bindings)).toBe(20)
  expect(await left()).toBe(2)
  vi.setSystemTime(new Date(start.getTime() + 32 * DAY))
  expect(await purgeTrash(env as unknown as Bindings)).toBe(2)
  expect(await left()).toBe(0)
  vi.useRealTimers()
})
