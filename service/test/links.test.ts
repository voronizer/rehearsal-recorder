import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { endOf, newLinkId, purgeLinks } from "../worker/links/store"
import { database } from "../worker/shared/db"
import type { Bindings } from "../worker/shared/env"
import { shareLink, take } from "../worker/shared/schema"
import { purgeTrash } from "../worker/takes/purge"
import { answer, call, del, member, post, read, shownTake, signInOwner } from "./helpers"

const bindings = env as unknown as Bindings

const HEARD = { volumes: { Bass: 0.5 }, muted: ["Drums"], soloed: [] }
const PEAKS = Array.from({ length: 1200 }, (_, i) => (i % 10) / 10)
const MP3 = new Uint8Array(2000).map((_, i) => i % 256)

type Item = {
  id: string
  take: { uid: string; name: string }
  by: string
  made_at: string
  for: string
  shows: string
  download: string
  until: string | null
  plays: number
  last_played_at: string | null
}

const makeLink = (cookie: string, uid: string, over: Record<string, unknown> = {}) =>
  answer<Item>(post(`/api/takes/${uid}/links`, { for: "", shows: "tracks", download: "none", lasts: "never", heard: HEARD, ...over }, cookie))

const putMix = (cookie: string, id: string, bytes = MP3) =>
  call(`/api/links/${id}/mix`, { method: "PUT", body: bytes, headers: { "Content-Type": "audio/mpeg" } }, cookie)

const filesOf = async (id: string) => (await env.FILES.list({ prefix: `links/${id}/` })).objects.map((o) => o.key).sort()

test("a member makes each kind of link and every member sees them", async () => {
  const owner = await signInOwner()
  const vik = await member(owner, "vik@example.com")
  const uid = await shownTake()
  const tracks = await makeLink(owner, uid, { for: "  Mum  ", download: "all", lasts: "week" })
  expect(tracks.status).toBe(200)
  expect(tracks.body).toMatchObject({ for: "Mum", shows: "tracks", download: "all", plays: 0, last_played_at: null })
  expect(tracks.body.take).toEqual({ uid, name: "Viasna 12", song_id: expect.any(Number), moved: false })
  expect(tracks.body.until).not.toBeNull()
  const marks = await makeLink(owner, uid, { shows: "marks" })
  expect(marks.status).toBe(200)
  const mix = await makeLink(vik.cookie, uid, { shows: "mix", download: "mix", heard: undefined, peaks: PEAKS })
  expect(mix.status).toBe(200)
  expect((await putMix(vik.cookie, mix.body.id)).status).toBe(200)

  const list = await read<Item[]>("/api/links", vik.cookie)
  expect(list.map((l) => l.id)).toEqual([mix.body.id, marks.body.id, tracks.body.id])
  expect(list[0]).toMatchObject({ shows: "mix", download: "mix", until: null, by: "vik@example.com", plays: 0 })
  expect(list[2]).toMatchObject({ for: "Mum", by: "alex@example.com" })
  expect(await filesOf(mix.body.id)).toEqual([`links/${mix.body.id}/mix.mp3`, `links/${mix.body.id}/mix.peaks`])
})

test("a mix link is listed only once its MP3 is up", async () => {
  const owner = await signInOwner()
  const vik = await member(owner, "vik@example.com")
  const uid = await shownTake()
  const mix = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  expect(mix.status).toBe(200)
  expect(await read<Item[]>("/api/links", owner)).toEqual([])
  expect((await putMix(vik.cookie, mix.body.id)).status).toBe(404)
  expect((await putMix(owner, mix.body.id)).status).toBe(200)
  expect((await read<Item[]>("/api/links", owner)).map((l) => l.id)).toEqual([mix.body.id])
  expect((await putMix(owner, mix.body.id)).status).toBe(404)
  const tracks = await makeLink(owner, uid)
  expect((await putMix(owner, tracks.body.id)).status).toBe(404)
})

test("a link needs what it shows", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const both = await makeLink(owner, uid, { shows: "mix", download: "all", heard: undefined, peaks: PEAKS })
  expect(both).toEqual({ status: 400, body: { error: "A link that shows only the mix cannot let download the tracks." } })
  expect((await makeLink(owner, uid, { shows: "mix", heard: undefined })).status).toBe(400)
  expect((await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS.slice(1) })).status).toBe(400)
  expect((await makeLink(owner, uid, { heard: undefined })).status).toBe(400)
  expect((await makeLink(owner, uid, { for: "x".repeat(61) })).status).toBe(400)
  expect((await makeLink(owner, uid, { for: ` ${"x".repeat(60)} ` })).status).toBe(200)
  expect((await makeLink(owner, crypto.randomUUID())).status).toBe(404)
  expect((await answer(post(`/api/takes/${uid}/links`, { shows: "tracks", download: "none", lasts: "never", heard: HEARD }))).status).toBe(401)
})

test("a mix link's MP3 needs its size and is at most 100 MB", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const mix = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  const big = await call(
    `/api/links/${mix.body.id}/mix`,
    { method: "PUT", body: MP3, headers: { "Content-Type": "audio/mpeg", "Content-Length": String(100 * 1024 * 1024 + 1) } },
    owner
  )
  expect(big.status).toBe(413)
  expect(await read<Item[]>("/api/links", owner)).toEqual([])
})

test("any member closes any link, and closing twice is fine", async () => {
  const owner = await signInOwner()
  const vik = await member(owner, "vik@example.com")
  const uid = await shownTake()
  const mix = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  await putMix(owner, mix.body.id)
  expect((await del(`/api/links/${mix.body.id}`, vik.cookie)).status).toBe(200)
  expect(await read<Item[]>("/api/links", owner)).toEqual([])
  expect(await filesOf(mix.body.id)).toEqual([])
  expect((await del(`/api/links/${mix.body.id}`, vik.cookie)).status).toBe(200)
  expect((await del(`/api/links/${mix.body.id}`)).status).toBe(401)
})

test("links of a take in the Trash leave the list and come back", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const link = await makeLink(owner, uid)
  expect((await del(`/api/takes/${uid}`, owner)).status).toBe(200)
  expect(await read<Item[]>("/api/links", owner)).toEqual([])
  expect((await makeLink(owner, uid)).status).toBe(404)
  expect((await post(`/api/trash/${uid}/restore`, {}, owner)).status).toBe(200)
  expect((await read<Item[]>("/api/links", owner)).map((l) => l.id)).toEqual([link.body.id])
})

test("the end of a link", () => {
  const at = new Date("2026-11-15T22:00:00.000Z")
  expect(endOf("day", at)).toBe("2026-11-16T22:00:00.000Z")
  expect(endOf("week", at)).toBe("2026-11-22T22:00:00.000Z")
  expect(endOf("month", at)).toBe("2026-12-15T22:00:00.000Z")
  expect(endOf("month", new Date("2026-01-31T10:00:00.000Z"))).toBe("2026-02-28T10:00:00.000Z")
  expect(endOf("month", new Date("2028-01-31T10:00:00.000Z"))).toBe("2028-02-29T10:00:00.000Z")
  expect(endOf("month", new Date("2026-12-31T10:00:00.000Z"))).toBe("2027-01-31T10:00:00.000Z")
  expect(endOf("never", at)).toBeNull()
})

test("an ended link leaves the list", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const link = await makeLink(owner, uid, { lasts: "day" })
  await database(bindings).update(shareLink).set({ until: "2020-01-01T00:00:00.000Z" }).where(eq(shareLink.id, link.body.id))
  expect(await read<Item[]>("/api/links", owner)).toEqual([])
})

test("the daily run deletes ended and unfinished links", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const db = database(bindings)
  const ended = await makeLink(owner, uid, { lasts: "day" })
  await db.update(shareLink).set({ until: "2020-01-01T00:00:00.000Z" }).where(eq(shareLink.id, ended.body.id))
  const unfinished = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  await db
    .update(shareLink)
    .set({ madeAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
    .where(eq(shareLink.id, unfinished.body.id))
  const fresh = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  const open = await makeLink(owner, uid)

  expect(await purgeLinks(bindings)).toBe(2)
  const left = (await db.select({ id: shareLink.id }).from(shareLink)).map((r) => r.id).sort()
  expect(left).toEqual([fresh.body.id, open.body.id].sort())
  expect(await filesOf(unfinished.body.id)).toEqual([])
  expect(await filesOf(fresh.body.id)).toEqual([`links/${fresh.body.id}/mix.peaks`])
})

test("a take deleted for good takes its links", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const mix = await makeLink(owner, uid, { shows: "mix", heard: undefined, peaks: PEAKS })
  await putMix(owner, mix.body.id)
  await makeLink(owner, uid)
  const db = database(bindings)
  await db
    .update(take)
    .set({ trashedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })
    .where(eq(take.uid, uid))
  await purgeTrash(bindings)
  expect(await db.select().from(shareLink)).toEqual([])
  expect(await filesOf(mix.body.id)).toEqual([])
})

test("link ids are 22 characters from the 57", () => {
  const ids = Array.from({ length: 200 }, newLinkId)
  for (const id of ids) expect(id).toMatch(/^[A-HJ-NP-Za-km-z2-9]{22}$/)
  expect(new Set(ids).size).toBe(200)
})
