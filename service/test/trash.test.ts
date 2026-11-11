import { env } from "cloudflare:workers"
import { expect, test, vi } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { purgeTrash } from "../worker/takes/purge"
import { answer, call, del, member, named, patch, post, read, reha, shownTake, signInOwner, takeMeta } from "./helpers"

const bindings = env as unknown as Bindings
const DAY = 24 * 60 * 60 * 1000

type Gone = { uid: string; name: string; trashed_at: string; by: string | null }
type TrashedSong = { id: number; title: string; takes: number; trashed_at: string; by: string | null }
type Trash = { songs: TrashedSong[]; takes: Gone[] }
type Songs = { songs: { id: number; title: string; takes: number }[] }
type SongPage = { song: { id: number; takes: number; trashed_takes: number; coming_takes: number }; takes: { uid: string }[] }

const trash = (cookie: string) => read<Trash>("/api/trash", cookie)
const songs = (cookie: string) => read<Songs>("/api/songs", cookie)
const songCalled = async (cookie: string, title: string) => (await songs(cookie)).songs.find((s) => s.title === title)

/** Alex, who owns the band, and Ivan, a member with his name given. */
async function band() {
  const alex = await signInOwner()
  const ivan = (await member(alex, "ivan@example.com")).cookie
  await named(ivan, "Ivan")
  return { alex, ivan }
}

test("a take deleted in the service waits in the trash with who deleted it", async () => {
  const { alex, ivan } = await band()
  const uid = await shownTake({ song: "Viasna", name: "Viasna 12" })
  const viasna = (await songCalled(alex, "Viasna"))!

  expect(await answer(del(`/api/takes/${uid}`, ivan))).toEqual({ status: 200, body: { ok: true } })
  expect((await trash(alex)).takes).toMatchObject([{ uid, name: "Viasna 12", by: "Ivan" }])
  const page = await read<SongPage>(`/api/songs/${viasna.id}`, alex)
  expect(page.takes).toEqual([])
  expect(page.song).toMatchObject({ takes: 0, trashed_takes: 1 })
  expect(JSON.stringify(await read("/api/home", alex))).not.toContain(uid)

  // A second press, from someone whose page was behind, leaves it as it is.
  const first = (await trash(alex)).takes[0].trashed_at
  expect((await del(`/api/takes/${uid}`, alex)).status).toBe(200)
  expect((await trash(alex)).takes).toMatchObject([{ uid, by: "Ivan", trashed_at: first }])
  expect((await del(`/api/takes/${crypto.randomUUID()}`, alex)).status).toBe(404)
})

test("a change from РЭХА leaves a take the band deleted in the trash", async () => {
  const { alex, ivan } = await band()
  const r = await reha()
  const uid = await shownTake({ name: "Viasna 12" })
  expect((await del(`/api/takes/${uid}`, ivan)).status).toBe(200)

  expect(await answer(r.put(`/api/reha/takes/${uid}`, takeMeta({ name: "Viasna 12b" })))).toEqual({
    status: 200,
    body: { ok: true, in_trash: true, drift_gen: null, song_id: expect.any(Number), kind: true },
  })
  // Its details are kept up to date, so it comes back as РЭХА has it.
  expect((await trash(alex)).takes).toMatchObject([{ uid, name: "Viasna 12b", by: "Ivan" }])

  expect(await answer(r.put(`/api/reha/takes/${uid}`, takeMeta({ name: "Viasna 12b", by_hand: true })))).toEqual({
    status: 200,
    body: { ok: true, in_trash: false, drift_gen: null, song_id: expect.any(Number), kind: true },
  })
  expect((await trash(alex)).takes).toEqual([])
})

test("a take РЭХА removed comes out on any change, as before", async () => {
  const alex = await signInOwner()
  const r = await reha()
  const uid = await shownTake({ name: "Viasna 12" })
  expect((await r.del(`/api/reha/takes/${uid}`)).status).toBe(200)
  expect((await trash(alex)).takes).toMatchObject([{ uid, by: null }])

  expect(await answer(r.put(`/api/reha/takes/${uid}`, takeMeta()))).toEqual({ status: 200, body: { ok: true, in_trash: false, drift_gen: null, song_id: expect.any(Number), kind: true } })
  expect((await trash(alex)).takes).toEqual([])
})

test("a song goes to the trash with its takes and comes back whole", async () => {
  const { alex, ivan } = await band()
  const alone = await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1" })
  const withIt = await shownTake({ song: "Pałyn", number: 2, name: "Pałyn 2" })
  expect((await del(`/api/takes/${alone}`, alex)).status).toBe(200)
  const { id } = (await songCalled(alex, "Pałyn"))!

  expect(await answer(del(`/api/songs/${id}`, ivan))).toEqual({ status: 200, body: { ok: true } })
  const gone = await trash(alex)
  expect(gone.songs).toMatchObject([{ id, title: "Pałyn", takes: 1, by: "Ivan" }])
  expect(gone.takes.map((t) => t.uid)).toEqual([alone])
  expect(await songCalled(alex, "Pałyn")).toBeUndefined()
  expect((await call(`/api/songs/${id}`, {}, alex)).status).toBe(404)
  // A take's page in the trash does not lead to its song, which is there too.
  expect(await read(`/api/takes/${withIt}`, alex)).toMatchObject({ song: null, trashed_at: expect.any(String) })
  // A panel left open elsewhere cannot write into it.
  expect((await patch(`/api/songs/${id}`, { notes: "Slower" }, alex)).status).toBe(404)
  const file = call(
    `/api/songs/${id}/files`,
    { method: "POST", body: new Uint8Array([1]), headers: { "Content-Type": "application/pdf", "X-File-Name": "Chords.pdf" } },
    alex
  )
  expect((await file).status).toBe(404)
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)
  expect((await trash(alex)).songs).toMatchObject([{ id, by: "Ivan" }])

  expect(await answer(post(`/api/trash/songs/${id}/restore`, {}, alex))).toEqual({ status: 200, body: { ok: true } })
  const page = await read<SongPage>(`/api/songs/${id}`, alex)
  expect(page.takes.map((t) => t.uid)).toEqual([withIt])
  expect(page.song.trashed_takes).toBe(1)
  const after = await trash(alex)
  expect(after.songs).toEqual([])
  expect(after.takes.map((t) => t.uid)).toEqual([alone])
  expect((await post(`/api/trash/songs/${id}/restore`, {}, alex)).status).toBe(404)
})

test("restoring one take of a song in the trash brings the song back with that take", async () => {
  const { alex, ivan } = await band()
  const one = await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1" })
  const two = await shownTake({ song: "Pałyn", number: 2, name: "Pałyn 2" })
  const { id } = (await songCalled(alex, "Pałyn"))!
  expect((await del(`/api/songs/${id}`, ivan)).status).toBe(200)

  expect((await post(`/api/trash/${one}/restore`, {}, alex)).status).toBe(200)
  expect(await songCalled(alex, "Pałyn")).toMatchObject({ id, takes: 1 })
  const gone = await trash(alex)
  expect(gone.songs).toEqual([])
  expect(gone.takes).toMatchObject([{ uid: two, by: "Ivan" }])

  // The take left behind is on its own now: deleting the song again takes only the one back.
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)
  const again = await trash(alex)
  expect(again.songs).toMatchObject([{ id, takes: 1 }])
  expect(again.takes.map((t) => t.uid)).toEqual([two])
})

test("a new take of a song in the trash brings the song back", async () => {
  const { alex, ivan } = await band()
  const r = await reha()
  const old = await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1" })
  const { id } = (await songCalled(alex, "Pałyn"))!
  expect((await del(`/api/songs/${id}`, ivan)).status).toBe(200)

  const fresh = crypto.randomUUID()
  expect(await answer(r.put(`/api/reha/takes/${fresh}`, takeMeta({ song: "Pałyn", number: 3, name: "Pałyn 3" })))).toEqual({
    status: 200,
    body: { ok: true, in_trash: false, drift_gen: null, song_id: expect.any(Number), kind: true },
  })
  expect((await r.post(`/api/reha/takes/${fresh}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  expect(await songCalled(alex, "Pałyn")).toMatchObject({ id, takes: 1 })
  const gone = await trash(alex)
  expect(gone.songs).toEqual([])
  expect(gone.takes.map((t) => t.uid)).toEqual([old])
})

test("a song whose only take is still on its way says so, and goes to the trash", async () => {
  const alex = await signInOwner()
  const r = await reha()
  const uid = crypto.randomUUID()
  expect((await r.put(`/api/reha/takes/${uid}`, takeMeta({ song: "Zorka", number: 1, name: "Zorka 1" }))).status).toBe(200)
  const { id } = (await songCalled(alex, "Zorka"))!
  expect((await read<SongPage>(`/api/songs/${id}`, alex)).song).toMatchObject({ takes: 0, trashed_takes: 0, coming_takes: 1 })
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)
  expect((await trash(alex)).songs).toMatchObject([{ id, title: "Zorka" }])
})

test("a song that never had a take goes to the trash too, for РЭХА to learn of it, and comes back", async () => {
  const alex = await signInOwner()
  const { id } = (await answer(post("/api/songs", { title: "Kupalle" }, alex))).body
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)
  expect(await songCalled(alex, "Kupalle")).toBeUndefined()
  expect((await trash(alex)).songs).toMatchObject([{ id, title: "Kupalle", takes: 0 }])
  expect((await post(`/api/trash/songs/${id}/restore`, {}, alex)).status).toBe(200)
  expect(await songCalled(alex, "Kupalle")).toMatchObject({ id, takes: 0 })
})

test("New song with the title of a song in the trash says so", async () => {
  const alex = await signInOwner()
  await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1" })
  const { id } = (await songCalled(alex, "Pałyn"))!
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)
  expect(await answer(post("/api/songs", { title: "pałyn" }, alex))).toEqual({
    status: 409,
    body: { error: "“Pałyn” is in the Trash. Restore it there." },
  })
})

test("a status whose only song is in the trash goes, and the song takes the first status", async () => {
  const alex = await signInOwner()
  await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1" })
  const { id } = (await songCalled(alex, "Pałyn"))!
  const [learning, ready] = (await read<{ statuses: { id: number }[] }>("/api/songs", alex)).statuses
  expect((await patch(`/api/songs/${id}`, { status_id: ready.id }, alex)).status).toBe(200)
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)

  // Songs counts no song in Ready, so the page does not ask where they go.
  expect((await del(`/api/statuses/${ready.id}`, alex)).status).toBe(200)
  expect((await post(`/api/trash/songs/${id}/restore`, {}, alex)).status).toBe(200)
  expect(await read(`/api/songs/${id}`, alex)).toMatchObject({ song: { status_id: learning.id } })
})

test("РЭХА lists its takes with what is up, whether each is in the trash, and whose tempo it has", async () => {
  const alex = await signInOwner()
  const r = await reha()
  const live = await shownTake({ number: 1, name: "Viasna 1" })
  const gone = await shownTake({ number: 2, name: "Viasna 2" })
  expect((await del(`/api/takes/${gone}`, alex)).status).toBe(200)

  const list = await answer<{ uid: string }[]>(r.get("/api/reha/takes"))
  expect(list.status).toBe(200)
  const byUid = (a: { uid: string }, b: { uid: string }) => a.uid.localeCompare(b.uid)
  expect(list.body.sort(byUid)).toEqual(
    [
      { uid: live, trashed: false, mp3_gen: 1, flac_gen: null, drift_gen: null },
      { uid: gone, trashed: true, mp3_gen: 1, flac_gen: null, drift_gen: null },
    ].sort(byUid)
  )
})

test("songs 30 days in the trash are deleted with their files", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-11-01T12:00:00Z")
  vi.setSystemTime(start)
  const alex = await signInOwner()
  await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1" })
  const { id } = (await songCalled(alex, "Pałyn"))!
  const file = await call(
    `/api/songs/${id}/files`,
    { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "Content-Type": "application/pdf", "X-File-Name": "Chords.pdf" } },
    alex
  )
  expect(file.status).toBe(200)
  expect((await del(`/api/songs/${id}`, alex)).status).toBe(200)

  vi.setSystemTime(new Date(start.getTime() + 30 * DAY + 60 * 1000))
  expect(await purgeTrash(bindings)).toBe(2)

  expect((await env.DB.prepare("SELECT id FROM song").all()).results).toEqual([])
  expect((await env.DB.prepare("SELECT id FROM song_file").all()).results).toEqual([])
  expect((await env.FILES.list({ prefix: `songs/${id}/` })).objects).toEqual([])
  vi.useRealTimers()
})
