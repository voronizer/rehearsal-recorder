import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { putTake, trash } from "../worker/takes/store"
import { call, commentOn, markAt, member, named, open, post, read, shownTake, signInOwner, starIt, takeMeta } from "./helpers"

const bindings = env as unknown as Bindings

type Star = { member_id: string; initial: string; name: string }
type TakeRow = { uid: string; name: string; stars: Star[]; starred_at_rehearsal: boolean; is_new: boolean }

const songId = async (cookie: string, title = "Viasna") =>
  (await read<{ songs: { id: number; title: string }[] }>("/api/songs", cookie)).songs.find((s) => s.title === title)!.id
const song = (cookie: string, id: number) => read<{ song: { best: TakeRow | null }; takes: TakeRow[] }>(`/api/songs/${id}`, cookie)
const unstar = async (cookie: string, uid: string) =>
  expect((await call(`/api/takes/${uid}/star`, { method: "DELETE" }, cookie)).status).toBe(200)

test("a new take is new until opened; one not shown or in the trash is not there", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  await putTake(bindings, crypto.randomUUID(), takeMeta({ number: 13, name: "Viasna 13" }) as never)
  const gone = await shownTake({ number: 14, name: "Viasna 14" })
  await trash(bindings, gone)

  const before = await song(owner, await songId(owner))
  expect(before.takes.map((t) => [t.name, t.is_new])).toEqual([["Viasna 12", true]])
  expect((await read<{ unheard: number }>("/api/home", owner)).unheard).toBe(1)
  await open(owner, uid)
  expect((await song(owner, await songId(owner))).takes[0].is_new).toBe(false)
  expect((await read<{ unheard: number }>("/api/home", owner)).unheard).toBe(0)
})

test("the best take is the most starred, newest on a tie", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  const one = await shownTake({ number: 1, name: "Viasna 1" })
  const two = await shownTake({ number: 2, name: "Viasna 2" })
  const three = await shownTake({ number: 3, name: "Viasna 3" })
  const id = await songId(owner)

  expect((await song(owner, id)).song.best!.uid).toBe(three)
  await starIt(owner, one)
  await starIt(ira.cookie, one)
  await starIt(ira.cookie, two)
  expect((await song(owner, id)).song.best!.uid).toBe(one)
  await unstar(owner, one)
  expect((await song(owner, id)).song.best!.uid).toBe(two)
  // The page says who starred it, by name; Ira has given none yet.
  expect((await song(owner, id)).song.best!.stars).toEqual([{ member_id: ira.id, initial: "I", name: "ira@example.com" }])
  expect((await song(owner, id)).takes.map((t) => [t.name, t.stars.length])).toEqual([
    ["Viasna 3", 0],
    ["Viasna 2", 1],
    ["Viasna 1", 1],
  ])
})

test("the star at rehearsal does not count for the best take", async () => {
  const owner = await signInOwner()
  const starred = await shownTake({ number: 1, name: "Viasna 1", starred: true })
  const newer = await shownTake({ number: 2, name: "Viasna 2" })

  const page = await song(owner, await songId(owner))
  expect(page.song.best!.uid).toBe(newer)
  expect(page.takes.find((t) => t.uid === starred)).toMatchObject({ starred_at_rehearsal: true, stars: [] })
})

test("while a crop is on its way, a mark goes by the take the band hears", async () => {
  const owner = await signInOwner()
  const uid = await shownTake({ duration_sec: 300 })
  // The cropped generation's MP3s are not up yet: the band still hears all 300 s.
  await putTake(bindings, uid, takeMeta({ gen: 2, cut_start: 0, duration_sec: 200 }) as never)
  expect((await post(`/api/takes/${uid}/marks`, { at: 250, note: "The end drags" }, owner)).status).toBe(200)
})

test("a removed member's marks and comments keep their name", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  const uid = await shownTake()
  const mark = await markAt(ira.cookie, uid, 60, "Bass too loud")
  await commentOn(ira.cookie, mark.id, "Or the drums")
  await starIt(ira.cookie, uid)

  expect((await call(`/api/members/${ira.id}`, { method: "DELETE" }, owner)).status).toBe(200)
  const take = await read<{ stars: Star[]; marks: { author: string; note: string; comments: { author: string }[] }[] }>(`/api/takes/${uid}`, owner)
  expect(take.stars).toEqual([{ member_id: ira.id, initial: "I", name: "Ira" }])
  expect(take.marks).toMatchObject([{ author: "Ira", note: "Bass too loud", comments: [{ author: "Ira" }] }])
})

test("restore puts a take back in its song", async () => {
  const owner = await signInOwner()
  const kept = await shownTake({ number: 1, name: "Viasna 1" })
  const uid = await shownTake({ number: 2, name: "Viasna 2" })
  const id = await songId(owner)
  await trash(bindings, uid)

  expect((await song(owner, id)).takes.map((t) => t.uid)).toEqual([kept])
  expect(await read("/api/trash", owner)).toMatchObject([{ uid, trashed_at: expect.any(String) }])

  expect((await post(`/api/trash/${uid}/restore`, {}, owner)).status).toBe(200)
  expect((await song(owner, id)).takes.map((t) => t.uid)).toEqual([uid, kept])
  expect(await read("/api/trash", owner)).toEqual([])
  expect((await post(`/api/trash/${uid}/restore`, {}, owner)).status).toBe(404)
})
