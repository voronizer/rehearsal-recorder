import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { putTake } from "../worker/takes/store"
import { trash } from "../worker/takes/store"
import { call, member, named, post, shownTake, signInOwner, takeMeta } from "./helpers"

const bindings = env as unknown as Bindings

type TakeRow = { uid: string; name: string; stars: { member_id: string; initial: string; name: string }[]; starred_at_rehearsal: boolean; is_new: boolean }
type SongRow = { id: number | "not-named"; title: string; takes: number; last_date: string; best: TakeRow | null; has_new: boolean }
type Feed = {
  new: { takes: TakeRow[]; comments: { id: number; take_name: string; author: string | null; text: string }[] }
  new_count: number
  songs: SongRow[]
  not_named: SongRow | null
  start: { kind: "new" } | { kind: "song"; id: number | "not-named" }
}

const feed = async (cookie: string) => {
  const res = await call("/api/feed", {}, cookie)
  expect(res.status).toBe(200)
  return (await res.json()) as Feed
}

const song = async (cookie: string, id: number | string) =>
  (await (await call(`/api/songs/${id}`, {}, cookie)).json()) as { song: { title: string }; best: TakeRow | null; takes: TakeRow[] }

const seen = async (cookie: string, uid: string) => expect((await post(`/api/takes/${uid}/seen`, {}, cookie)).status).toBe(200)
const star = async (cookie: string, uid: string) => expect((await post(`/api/takes/${uid}/star`, {}, cookie)).status).toBe(200)
const unstar = async (cookie: string, uid: string) =>
  expect((await call(`/api/takes/${uid}/star`, { method: "DELETE" }, cookie)).status).toBe(200)

async function say(cookie: string, uid: string, at: number, text: string, parent_id?: number) {
  const res = await post(`/api/takes/${uid}/comments`, { at, text, parent_id }, cookie)
  expect(res.status).toBe(200)
  return (await res.json()) as { id: number; at: number; text: string; author: string }
}

test("a new take is new until opened", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  await putTake(bindings, crypto.randomUUID(), takeMeta({ number: 13, name: "Viasna 13" }) as never)
  const gone = await shownTake({ number: 14, name: "Viasna 14" })
  await trash(bindings, gone)

  const before = await feed(owner)
  expect(before.new.takes.map((t) => [t.name, t.is_new])).toEqual([["Viasna 12", true]])
  expect(before.new_count).toBe(1)
  expect(before.start).toEqual({ kind: "new" })

  await seen(owner, uid)
  const after = await feed(owner)
  expect(after.new.takes).toEqual([])
  expect(after.new_count).toBe(0)
  expect(after.start).toEqual({ kind: "song", id: after.songs[0].id })
  expect(after.songs.map((s) => [s.title, s.takes, s.has_new])).toEqual([["Viasna", 1, false]])
})

test("a comment is new until its take is opened again", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  const uid = await shownTake()
  await seen(owner, uid)
  await seen(ira.cookie, uid)

  await say(ira.cookie, uid, 102, "The bridge drags here")
  const mine = await feed(owner)
  expect(mine.new.comments.map((c) => [c.take_name, c.author, c.text])).toEqual([
    ["Viasna 12", "Ira", "The bridge drags here"],
  ])
  expect(mine.new_count).toBe(1)
  expect(mine.start).toEqual({ kind: "new" })

  await seen(owner, uid)
  expect((await feed(owner)).new.comments).toEqual([])
})

test("your own comment is never new", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  await seen(owner, uid)

  await say(owner, uid, 42, "Too fast")
  expect((await feed(owner)).new_count).toBe(0)
})

test("songs come by their last take, not named last", async () => {
  const owner = await signInOwner()
  await shownTake({ song: "Viasna", number: 5, name: "Viasna 5", date: "2025-10-23" })
  await shownTake({ song: "Pałyn", number: 3, name: "Pałyn 3", date: "2025-10-30" })
  await shownTake({ song: "Viasna", number: 7, name: "Viasna 7", date: "2025-10-30" })
  await shownTake({ song: "Kałychanka", number: 1, name: "Kałychanka 1", date: "2025-10-16" })
  await shownTake({ song: null, number: 9, name: "Take 9", date: "2025-11-06" })

  const f = await feed(owner)
  expect(f.songs.map((s) => [s.title, s.takes, s.last_date])).toEqual([
    ["Viasna", 2, "2025-10-30"],
    ["Pałyn", 1, "2025-10-30"],
    ["Kałychanka", 1, "2025-10-16"],
  ])
  expect(f.not_named).toMatchObject({ id: "not-named", title: "Not named", takes: 1, last_date: "2025-11-06" })
  expect((await song(owner, "not-named")).takes.map((t) => t.name)).toEqual(["Take 9"])
})

test("the best take is the most starred, newest on a tie", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  const one = await shownTake({ number: 1, name: "Viasna 1" })
  const two = await shownTake({ number: 2, name: "Viasna 2" })
  const three = await shownTake({ number: 3, name: "Viasna 3" })
  const id = (await feed(owner)).songs[0].id

  expect((await song(owner, id)).best!.uid).toBe(three)
  await star(owner, one)
  await star(ira.cookie, one)
  await star(ira.cookie, two)
  expect((await song(owner, id)).best!.uid).toBe(one)
  await unstar(owner, one)
  expect((await song(owner, id)).best!.uid).toBe(two)
  // The page says who starred it, by name; Ira has given none yet.
  expect((await song(owner, id)).best!.stars).toEqual([{ member_id: ira.id, initial: "I", name: "ira@example.com" }])
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

  const page = await song(owner, (await feed(owner)).songs[0].id)
  expect(page.best!.uid).toBe(newer)
  const first = page.takes.find((t) => t.uid === starred)!
  expect(first).toMatchObject({ starred_at_rehearsal: true, stars: [] })
})

test("a reply takes its parent's moment", async () => {
  const owner = await signInOwner()
  const uid = await shownTake({ duration_sec: 300 })
  const first = await say(owner, uid, 42, "Too fast")

  const reply = await say(owner, uid, 100, "Agreed", first.id)
  expect(reply.at).toBe(42)
  const take = (await (await call(`/api/takes/${uid}`, {}, owner)).json()) as {
    comments: { id: number; replies: { id: number; at: number }[] }[]
  }
  expect(take.comments.map((c) => [c.id, c.replies.map((r) => [r.id, r.at])])).toEqual([[first.id, [[reply.id, 42]]]])

  for (const bad of [
    { at: 42, text: "   " },
    { at: 42, text: "x".repeat(2001) },
    { at: 301, text: "Past the end" },
    { at: -1, text: "Before the start" },
  ])
    expect((await post(`/api/takes/${uid}/comments`, bad, owner)).status).toBe(400)
  expect((await post(`/api/takes/${uid}/comments`, { at: 1, text: "x", parent_id: 9999 }, owner)).status).toBe(400)
})

test("a removed member's comments keep their name", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  const uid = await shownTake()
  await say(ira.cookie, uid, 60, "Bass too loud")
  await star(ira.cookie, uid)

  expect((await call(`/api/members/${ira.id}`, { method: "DELETE" }, owner)).status).toBe(200)
  const take = (await (await call(`/api/takes/${uid}`, {}, owner)).json()) as {
    stars: { member_id: string; initial: string; name: string }[]
    comments: { author: string; initial: string; text: string }[]
  }
  expect(take.stars).toEqual([{ member_id: ira.id, initial: "I", name: "Ira" }])
  expect(take.comments).toMatchObject([{ author: "Ira", initial: "I", text: "Bass too loud" }])
})

test("restore puts a take back in its song", async () => {
  const owner = await signInOwner()
  const kept = await shownTake({ number: 1, name: "Viasna 1" })
  const uid = await shownTake({ number: 2, name: "Viasna 2" })
  const id = (await feed(owner)).songs[0].id
  await trash(bindings, uid)

  expect((await song(owner, id)).takes.map((t) => t.uid)).toEqual([kept])
  const bin = (await (await call("/api/trash", {}, owner)).json()) as { uid: string; trashed_at: string }[]
  expect(bin).toMatchObject([{ uid, trashed_at: expect.any(String) }])

  expect((await post(`/api/trash/${uid}/restore`, {}, owner)).status).toBe(200)
  expect((await song(owner, id)).takes.map((t) => t.uid)).toEqual([uid, kept])
  expect(await (await call("/api/trash", {}, owner)).json()).toEqual([])
  expect((await post(`/api/trash/${uid}/restore`, {}, owner)).status).toBe(404)
})
