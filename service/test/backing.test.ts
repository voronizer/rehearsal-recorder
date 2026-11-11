import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import { answer, call, del, member, put, read, reha, shownTake, signInOwner, takeMeta, TAKE } from "./helpers"

const heardBy = async (cookie: string) => (await answer(call("/api/me/backing", {}, cookie))).body

async function songId(owner: string, uid: string): Promise<number> {
  return (await read(`/api/takes/${uid}`, owner)).song.id
}

test("a take keeps a track's kind, shows it, and the answer says it is kept", async () => {
  const owner = await signInOwner()
  const r = await reha()
  const tracks = [
    { position: 1, name: "Bass", icon: "bass", files: ["1.mp3", "1.peaks"] },
    { position: 2, name: "Backing", icon: null, files: ["2.mp3", "2.peaks"], kind: "backing" },
  ]
  const res = await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ tracks, notes: [] }))
  expect(res.status).toBe(200)
  expect(((await res.json()) as { kind: boolean }).kind).toBe(true)

  await env.DB.prepare("UPDATE take SET shown_gen = 1 WHERE uid = ?").bind(TAKE).run()
  const page = await read(`/api/takes/${TAKE}`, owner)
  expect(page.tracks.map((t: { kind: string | null }) => t.kind)).toEqual([null, "backing"])
})

test("a track with a kind that is not backing is refused", async () => {
  await signInOwner()
  const r = await reha()
  const tracks = [{ position: 1, name: "Bass", icon: null, files: ["1.mp3"], kind: "lead" }]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ tracks }))).status).toBe(400)
})

test("an older РЭХА sends no kind and the page says null", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const page = await read(`/api/takes/${uid}`, owner)
  expect(page.tracks.every((t: { kind: unknown }) => t.kind === null)).toBe(true)
})

test("a wave is asked again each time and answers 304 while it is the same", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  await env.FILES.put(`takes/${uid}/1/1.peaks`, JSON.stringify({ peaks: [0.5], sides: [[0.5], [0.4]] }))
  await env.FILES.put(`takes/${uid}/1/1.mp3`, new Uint8Array(8))

  const first = await call(`/files/${uid}/1/1.peaks`, {}, owner)
  expect(first.status).toBe(200)
  expect(first.headers.get("Cache-Control")).toBe("private, no-cache")
  const etag = first.headers.get("ETag")!
  await first.arrayBuffer()

  const again = await call(`/files/${uid}/1/1.peaks`, { headers: { "If-None-Match": etag } }, owner)
  expect(again.status).toBe(304)
  expect(again.headers.get("ETag")).toBe(etag)
  expect(again.headers.get("Cache-Control")).toBe("private, no-cache")

  await env.FILES.put(`takes/${uid}/1/1.peaks`, JSON.stringify({ peaks: [0.9] }))
  expect((await call(`/files/${uid}/1/1.peaks`, { headers: { "If-None-Match": etag } }, owner)).status).toBe(200)

  const mp3 = await call(`/files/${uid}/1/1.mp3`, {}, owner)
  expect(mp3.headers.get("Cache-Control")).toBe("private, max-age=86400")
  await mp3.arrayBuffer()
})

test("a member's Backing choices are theirs only", async () => {
  const owner = await signInOwner()
  const ira = (await member(owner, "ira@example.com")).cookie
  const vik = (await member(owner, "vik@example.com")).cookie
  const id = await songId(owner, await shownTake())
  expect(await heardBy(ira)).toEqual({ heard: {} })

  expect(await answer(put("/api/me/backing", { song_id: id, heard: true }, ira))).toEqual({
    status: 200,
    body: { heard: { [id]: true } },
  })
  expect(await heardBy(ira)).toEqual({ heard: { [id]: true } })
  expect(await heardBy(vik)).toEqual({ heard: {} })

  expect((await answer(put("/api/me/backing", { song_id: id, heard: false }, ira))).body).toEqual({ heard: { [id]: false } })
})

test("a song the band does not have, or one in the Trash, is a 404", async () => {
  const owner = await signInOwner()
  const id = await songId(owner, await shownTake())
  expect((await put("/api/me/backing", { song_id: 9999, heard: true }, owner)).status).toBe(404)
  expect((await put("/api/me/backing", { song_id: 0, heard: true }, owner)).status).toBe(400)
  expect((await put("/api/me/backing", { song_id: id }, owner)).status).toBe(400)
  expect((await del(`/api/songs/${id}`, owner)).status).toBe(200)
  expect((await put("/api/me/backing", { song_id: id, heard: true }, owner)).status).toBe(404)
})

test("a song deleted for good takes its rows, and a member gone takes theirs", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  const id = await songId(owner, await shownTake())
  expect((await put("/api/me/backing", { song_id: id, heard: true }, ira.cookie)).status).toBe(200)
  expect((await put("/api/me/backing", { song_id: id, heard: true }, owner)).status).toBe(200)
  const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM backing_heard").first<{ n: number }>())!.n
  expect(await count()).toBe(2)

  await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(ira.id).run()
  expect(await count()).toBe(1)
  await env.DB.prepare("DELETE FROM take").run()
  await env.DB.prepare("DELETE FROM song WHERE id = ?").bind(id).run()
  expect(await count()).toBe(0)
})

test("Backing choices need a member signed in", async () => {
  expect((await call("/api/me/backing")).status).toBe(401)
  expect((await put("/api/me/backing", { song_id: 1, heard: true })).status).toBe(401)
})
