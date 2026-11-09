import { env } from "cloudflare:workers"
import { expect, test, vi } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { purgeTrash } from "../worker/takes/purge"
import { answer, call, del, member, named, patch, post, read, reha, signInOwner } from "./helpers"

const bindings = env as unknown as Bindings
const DAY = 24 * 60 * 60 * 1000

type BandSet = { id: number; name: string; songs: number[] }
type TrashedSet = { id: number; name: string; songs: number; trashed_at: string; by: string | null }

const sets = async (cookie: string) => (await read<{ sets: BandSet[] }>("/api/sets", cookie)).sets
const trashed = async (cookie: string) => (await read<{ sets: TrashedSet[] }>("/api/trash", cookie)).sets
const songItem = async (cookie: string, id: number) =>
  (await read<{ songs: { id: number; typed_length: number | null; length: number | null }[] }>("/api/songs", cookie)).songs.find(
    (s) => s.id === id
  )

/** Alex with Ivan in the band, РЭХА with a key, and three songs. */
async function band() {
  const alex = await signInOwner()
  const ivan = (await member(alex, "ivan@example.com")).cookie
  await named(ivan, "Ivan")
  const r = await reha()
  const song = async (title: string) => (await answer<{ id: number }>(post("/api/songs", { title }, alex))).body.id
  return { alex, ivan, r, a: await song("Viasna"), b: await song("Pałyn"), c: await song("Kryły") }
}

async function makeSet(cookie: string, name: string, songs?: number[]) {
  const made = await answer<{ id: number }>(post("/api/sets", { name }, cookie))
  expect(made.status).toBe(200)
  if (songs) expect((await patch(`/api/sets/${made.body.id}`, { songs }, cookie)).status).toBe(200)
  return made.body.id
}

const taken = (name: string) => ({ status: 409, body: { error: `There is already a set called ${name}.` } })

test("a new set goes to the end and is listed with its songs in order", async () => {
  const { alex, ivan, a, b } = await band()
  const gig = await makeSet(ivan, " Club gig ")
  const thursday = await makeSet(alex, "Thursday")
  expect(await sets(alex)).toEqual([
    { id: gig, name: "Club gig", songs: [] },
    { id: thursday, name: "Thursday", songs: [] },
  ])

  // A song is in a set once, at its first place.
  expect(await answer(patch(`/api/sets/${gig}`, { songs: [b, a, b] }, ivan))).toEqual({ status: 200, body: { ok: true } })
  expect(await sets(alex)).toEqual([
    { id: gig, name: "Club gig", songs: [b, a] },
    { id: thursday, name: "Thursday", songs: [] },
  ])
  expect((await patch(`/api/sets/${gig}`, { name: "Club gig, 13 December", songs: [a] }, ivan)).status).toBe(200)
  expect((await sets(alex))[0]).toEqual({ id: gig, name: "Club gig, 13 December", songs: [a] })

  expect((await patch("/api/sets/9999", { name: "Gig" }, ivan)).status).toBe(404)
  expect(await answer(post("/api/sets", { name: "  " }, ivan))).toEqual({
    status: 400,
    body: { error: "A set's name is 1 to 40 characters" },
  })
  expect((await post("/api/sets", { name: "x".repeat(41) }, ivan)).status).toBe(400)
  expect((await call("/api/sets")).status).toBe(401)
})

test("set names are unique case-blind among sets in use", async () => {
  const { alex } = await band()
  const gig = await makeSet(alex, "Club gig")
  const other = await makeSet(alex, "New set")
  expect(await answer(patch(`/api/sets/${other}`, { name: "club gig" }, alex))).toEqual(taken("Club gig"))
  expect(await answer(post("/api/sets", { name: "CLUB GIG " }, alex))).toEqual(taken("Club gig"))
  // Folded as the band would, in any alphabet.
  await makeSet(alex, "Łaŭka")
  expect(await answer(post("/api/sets", { name: "łaŭka" }, alex))).toEqual(taken("Łaŭka"))
  // Its own name in other capitals is no clash.
  expect((await patch(`/api/sets/${gig}`, { name: "Club Gig" }, alex)).status).toBe(200)
  // A set in the trash leaves its name free.
  expect((await del(`/api/sets/${gig}`, alex)).status).toBe(200)
  expect((await post("/api/sets", { name: "Club gig" }, alex)).status).toBe(200)
})

test("two sets given one name at once: one is turned down", async () => {
  const { alex, ivan } = await band()
  const made = await Promise.all([answer(post("/api/sets", { name: "Club gig" }, alex)), answer(post("/api/sets", { name: "club gig" }, ivan))])
  expect(made.map((m) => m.status).sort()).toEqual([200, 409])
  expect((await sets(alex)).map((s) => s.name.toLowerCase())).toEqual(["club gig"])

  const one = await makeSet(alex, "One")
  const two = await makeSet(alex, "Two")
  const renamed = await Promise.all([
    answer(patch(`/api/sets/${one}`, { name: "Encore" }, alex)),
    answer(patch(`/api/sets/${two}`, { name: "encore" }, ivan)),
  ])
  expect(renamed.map((m) => m.status).sort()).toEqual([200, 409])
  expect((await sets(alex)).filter((s) => s.name.toLowerCase() === "encore")).toHaveLength(1)
})

test("a deleted set is in the trash and Restore brings it back", async () => {
  const { alex, ivan, a, b } = await band()
  const thursday = await makeSet(alex, "Thursday")
  const gig = await makeSet(alex, "Club gig", [a, b])
  const encore = await makeSet(alex, "Encore")

  expect(await answer(del(`/api/sets/${gig}`, ivan))).toEqual({ status: 200, body: { ok: true } })
  expect((await sets(alex)).map((s) => s.id)).toEqual([thursday, encore])
  expect(await trashed(alex)).toEqual([{ id: gig, name: "Club gig", songs: 2, trashed_at: expect.any(String), by: "Ivan" }])
  // A page left open elsewhere cannot change it there.
  expect((await patch(`/api/sets/${gig}`, { name: "Gig" }, alex)).status).toBe(404)
  // A second press, from someone whose page was behind, leaves it as it is.
  expect((await del(`/api/sets/${gig}`, alex)).status).toBe(200)
  expect((await trashed(alex))[0].by).toBe("Ivan")
  expect((await del("/api/sets/9999", alex)).status).toBe(404)

  expect(await answer(post(`/api/trash/sets/${gig}/restore`, {}, alex))).toEqual({ status: 200, body: { ok: true } })
  expect(await sets(alex)).toEqual([
    { id: thursday, name: "Thursday", songs: [] },
    { id: gig, name: "Club gig", songs: [a, b] },
    { id: encore, name: "Encore", songs: [] },
  ])
  expect(await trashed(alex)).toEqual([])
  expect(await answer(post(`/api/trash/sets/${gig}/restore`, {}, alex))).toEqual({
    status: 404,
    body: { error: "This set is not in the trash" },
  })
})

test("Restore is turned down when the name was taken meanwhile", async () => {
  const { alex, ivan } = await band()
  const gig = await makeSet(alex, "Club gig")
  expect((await del(`/api/sets/${gig}`, alex)).status).toBe(200)
  const fresh = await makeSet(ivan, "club gig")

  expect(await answer(post(`/api/trash/sets/${gig}/restore`, {}, alex))).toEqual(taken("club gig"))
  expect((await trashed(alex)).map((s) => s.id)).toEqual([gig])
  // Once the other is renamed, the name is free again.
  expect((await patch(`/api/sets/${fresh}`, { name: "Club gig 2" }, ivan)).status).toBe(200)
  expect((await post(`/api/trash/sets/${gig}/restore`, {}, alex)).status).toBe(200)
  expect((await sets(alex)).map((s) => s.name)).toEqual(["Club gig", "Club gig 2"])
})

test("a song in the trash is left out of its sets and back when restored", async () => {
  const { alex, r, a, b, c } = await band()
  const gig = await makeSet(alex, "Club gig", [a, b, c])
  expect((await del(`/api/songs/${b}`, alex)).status).toBe(200)

  expect((await sets(alex))[0].songs).toEqual([a, c])
  expect((await answer(r.get("/api/reha/sets"))).body.sets[0].songs).toEqual([a, c])
  // Ordered meanwhile by someone who could not see it: it keeps its place.
  expect((await patch(`/api/sets/${gig}`, { songs: [c, a] }, alex)).status).toBe(200)
  expect((await r.patch(`/api/reha/sets/${gig}`, { songs: [c, a] })).status).toBe(200)
  expect((await sets(alex))[0].songs).toEqual([c, a])

  expect((await post(`/api/trash/songs/${b}/restore`, {}, alex)).status).toBe(200)
  expect((await sets(alex))[0].songs).toEqual([c, b, a])
})

test("a song deleted for good leaves its sets", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-11-01T12:00:00Z")
  vi.setSystemTime(start)
  const { alex, a, b } = await band()
  const gig = await makeSet(alex, "Club gig", [a, b])
  const old = await makeSet(alex, "Old gig", [b])
  expect((await del(`/api/songs/${b}`, alex)).status).toBe(200)
  expect((await del(`/api/sets/${old}`, alex)).status).toBe(200)

  vi.setSystemTime(new Date(start.getTime() + 30 * DAY + 60 * 1000))
  // The song and the set that waited 30 days in the trash.
  expect(await purgeTrash(bindings)).toBe(2)
  expect((await env.DB.prepare("SELECT id FROM band_set").all()).results).toEqual([{ id: gig }])
  expect((await env.DB.prepare("SELECT set_id, song_id FROM set_song").all()).results).toEqual([{ set_id: gig, song_id: a }])
  vi.useRealTimers()
})

test("a typed length is kept on the song and null goes back", async () => {
  const { alex, ivan, r, a } = await band()
  expect(await songItem(alex, a)).toMatchObject({ typed_length: null, length: null })

  expect(await answer(patch(`/api/songs/${a}`, { typed_length: 245 }, ivan))).toEqual({ status: 200, body: { ok: true } })
  expect(await songItem(alex, a)).toMatchObject({ typed_length: 245, length: null })
  expect((await read(`/api/songs/${a}`, alex)).song).toMatchObject({ typed_length: 245 })
  for (const bad of [0, 3600, 12.5, -60, "4:05"])
    expect(await answer(patch(`/api/songs/${a}`, { typed_length: bad }, ivan))).toEqual({
      status: 400,
      body: { error: "A length is a whole number of seconds, from 1 to 3599" },
    })
  expect((await patch(`/api/songs/${a}`, { typed_length: 3599 }, ivan)).status).toBe(200)
  expect(await songItem(alex, a)).toMatchObject({ typed_length: 3599 })

  expect((await patch(`/api/songs/${a}`, { typed_length: null }, ivan)).status).toBe(200)
  expect(await songItem(alex, a)).toMatchObject({ typed_length: null })
  // It lives in the service only: РЭХА's list of songs has no lengths.
  expect(JSON.stringify((await answer(r.get("/api/reha/songs"))).body)).not.toContain("length")
})

test("reha: link matches names case-blind and takes its songs", async () => {
  const { alex, ivan, r, a, b, c } = await band()
  const gig = await makeSet(ivan, "Club gig", [c])
  const mine = await makeSet(ivan, "Only here")
  // A set in the trash is not matched: it waits there, and the name is made anew.
  const gone = await makeSet(ivan, "Encore")
  expect((await del(`/api/sets/${gone}`, ivan)).status).toBe(200)

  const linked = await answer<{ ids: number[] }>(
    r.post("/api/reha/sets/link", {
      sets: [
        { name: "club gig", songs: [a, b] },
        { name: "Thursday", songs: [b] },
        { name: "Encore", songs: [] },
      ],
    })
  )
  expect(linked.status).toBe(200)
  const all = await sets(alex)
  const id = (name: string) => all.find((s) => s.name === name)!.id
  expect(linked.body.ids).toEqual([gig, id("Thursday"), id("Encore")])
  expect(id("Encore")).not.toBe(gone)
  expect(all).toEqual([
    // РЭХА's spelling and songs: before numbers, only РЭХА changed them.
    { id: gig, name: "club gig", songs: [a, b] },
    { id: mine, name: "Only here", songs: [] },
    { id: id("Thursday"), name: "Thursday", songs: [b] },
    { id: id("Encore"), name: "Encore", songs: [] },
  ])
  expect(await answer(r.post("/api/reha/sets/link", { sets: [{ name: "Gig", songs: [] }, { name: "GIG", songs: [] }] }))).toEqual({
    status: 400,
    body: { error: "Two of the sets are called Gig" },
  })
})

test("reha: link asked again gives the same numbers", async () => {
  const { alex, r, a, b } = await band()
  const sent = { sets: [{ name: "Club gig", songs: [a, b] }, { name: "Thursday", songs: [b] }] }
  const first = await answer<{ ids: number[] }>(r.post("/api/reha/sets/link", sent))
  expect(first.status).toBe(200)
  // Its first answer lost on the way.
  expect(await answer(r.post("/api/reha/sets/link", sent))).toEqual({ status: 200, body: first.body })
  // Sent twice at once.
  const both = await Promise.all([answer(r.post("/api/reha/sets/link", sent)), answer(r.post("/api/reha/sets/link", sent))])
  expect(both.map((x) => x.body)).toEqual([first.body, first.body])
  expect(await sets(alex)).toEqual([
    { id: first.body.ids[0], name: "Club gig", songs: [a, b] },
    { id: first.body.ids[1], name: "Thursday", songs: [b] },
  ])
})

test("reha: a set made in reha with a name the service has is that set", async () => {
  const { alex, ivan, r, a, b, c } = await band()
  const gig = await makeSet(ivan, "Club gig", [c])
  expect(await answer(r.post("/api/reha/sets", { name: "CLUB GIG", songs: [a, b] }))).toEqual({ status: 200, body: { id: gig } })
  expect(await sets(alex)).toEqual([{ id: gig, name: "CLUB GIG", songs: [a, b] }])

  const fresh = await answer<{ id: number }>(r.post("/api/reha/sets", { name: "Thursday", songs: [] }))
  expect(fresh.status).toBe(200)
  expect(fresh.body.id).not.toBe(gig)
  // Sent again, its answer lost: the same number.
  expect(await answer(r.post("/api/reha/sets", { name: "Thursday", songs: [] }))).toEqual({ status: 200, body: fresh.body })

  // Renamed in РЭХА to a name another set has here: turned down whole, songs too.
  expect(await answer(r.patch(`/api/reha/sets/${fresh.body.id}`, { name: "club gig", songs: [a] }))).toEqual(taken("CLUB GIG"))
  expect((await sets(alex))[1]).toEqual({ id: fresh.body.id, name: "Thursday", songs: [] })
  // РЭХА renames its own and sends that.
  expect(await answer(r.patch(`/api/reha/sets/${fresh.body.id}`, { name: "club gig 2", songs: [a] }))).toEqual({
    status: 200,
    body: { ok: true },
  })
  expect((await sets(alex))[1]).toEqual({ id: fresh.body.id, name: "club gig 2", songs: [a] })

  // Deleted in РЭХА: to the trash, by nobody here.
  expect(await answer(r.del(`/api/reha/sets/${gig}`))).toEqual({ status: 200, body: { ok: true } })
  expect(await trashed(alex)).toMatchObject([{ id: gig, by: null }])
  expect((await r.del(`/api/reha/sets/${gig}`)).status).toBe(200)
  expect(await answer(r.del("/api/reha/sets/9999"))).toEqual({ status: 404, body: { error: "No such set" } })
  expect((await r.patch("/api/reha/sets/9999", { name: "Gig" })).status).toBe(404)
})

test("reha: the list says who changed what by name, and what is in the trash", async () => {
  const { alex, ivan, r, a, b } = await band()
  const gig = await makeSet(ivan, "Club gig", [a, b])
  const thursday = (await answer<{ id: number }>(r.post("/api/reha/sets", { name: "Thursday", songs: [b] }))).body.id
  expect((await patch(`/api/sets/${thursday}`, { name: "Thursday rehearsal" }, alex)).status).toBe(200)
  const old = (await answer<{ id: number }>(r.post("/api/reha/sets", { name: "Old gig", songs: [] }))).body.id
  expect((await del(`/api/sets/${old}`, ivan)).status).toBe(200)

  expect(await answer(r.get("/api/reha/sets"))).toEqual({
    status: 200,
    body: {
      sets: [
        { id: gig, name: "Club gig", songs: [a, b], trashed: false, made_by: "Ivan", changed_by: "Ivan", trashed_by: null },
        {
          id: thursday,
          name: "Thursday rehearsal",
          songs: [b],
          trashed: false,
          made_by: null,
          changed_by: "alex@example.com",
          trashed_by: null,
        },
        { id: old, name: "Old gig", songs: [], trashed: true, made_by: null, changed_by: null, trashed_by: "Ivan" },
      ],
    },
  })
  // A change from РЭХА is nobody's here.
  expect((await r.patch(`/api/reha/sets/${gig}`, { songs: [b] })).status).toBe(200)
  expect((await answer(r.get("/api/reha/sets"))).body.sets[0]).toMatchObject({ songs: [b], made_by: "Ivan", changed_by: null })
})

test("reha: a change to a set in the Trash is not found, so РЭХА makes the set again", async () => {
  const { alex, ivan, r, a, b } = await band()
  const gig = (await answer<{ id: number }>(r.post("/api/reha/sets", { name: "Club gig", songs: [a] }))).body.id
  expect((await del(`/api/sets/${gig}`, ivan)).status).toBe(200)
  expect((await r.patch(`/api/reha/sets/${gig}`, { songs: [a, b] })).status).toBe(404)
  // The name is free while the old one is in the Trash.
  const again = (await answer<{ id: number }>(r.post("/api/reha/sets", { name: "Club gig", songs: [a, b] }))).body.id
  expect(again).not.toBe(gig)
  expect(await sets(alex)).toEqual([{ id: again, name: "Club gig", songs: [a, b] }])
})

test("reha: an unknown song number is turned down", async () => {
  const { alex, r, a } = await band()
  const unknown = { status: 400, body: { error: "No such song: 9999" } }
  expect(await answer(r.post("/api/reha/sets/link", { sets: [{ name: "Club gig", songs: [a] }, { name: "Encore", songs: [a, 9999] }] }))).toEqual(
    unknown
  )
  // Nothing was made: the whole link is turned down.
  expect(await sets(alex)).toEqual([])
  expect(await answer(r.post("/api/reha/sets", { name: "Club gig", songs: [9999] }))).toEqual(unknown)
  const gig = (await answer<{ id: number }>(r.post("/api/reha/sets", { name: "Club gig", songs: [a] }))).body.id
  expect(await answer(r.patch(`/api/reha/sets/${gig}`, { songs: [a, 9999] }))).toEqual(unknown)
  expect(await answer(patch(`/api/sets/${gig}`, { songs: [9999] }, alex))).toEqual(unknown)
  expect(await sets(alex)).toEqual([{ id: gig, name: "Club gig", songs: [a] }])
  expect((await r.post("/api/reha/sets", { name: "x".repeat(41), songs: [] })).status).toBe(400)
})

test("a merge keeps the target in its place and drops the merged song", async () => {
  const { alex, r, a, b, c } = await band()
  const gig = await makeSet(alex, "Club gig", [a, b, c])
  expect((await r.post(`/api/reha/songs/${a}/merge`, { into: c })).status).toBe(200)
  expect(await sets(alex)).toEqual([{ id: gig, name: "Club gig", songs: [b, c] }])
})

test("a merge keeps the merged song's typed length when the target has none", async () => {
  const { alex, ivan, r, a, b, c } = await band()
  expect((await patch(`/api/songs/${a}`, { typed_length: 245 }, ivan)).status).toBe(200)
  expect((await r.post(`/api/reha/songs/${a}/merge`, { into: c })).status).toBe(200)
  expect(await songItem(alex, c)).toMatchObject({ typed_length: 245 })
  // The target's own typed length stays.
  expect((await patch(`/api/songs/${b}`, { typed_length: 200 }, ivan)).status).toBe(200)
  expect((await r.post(`/api/reha/songs/${c}/merge`, { into: b })).status).toBe(200)
  expect(await songItem(alex, b)).toMatchObject({ typed_length: 200 })
})

test("a merge puts the target in the merged song's place when the set lacks it", async () => {
  const { alex, r, a, b, c } = await band()
  const gig = await makeSet(alex, "Club gig", [a, b])
  expect((await r.post(`/api/reha/songs/${a}/merge`, { into: c })).status).toBe(200)
  expect(await sets(alex)).toEqual([{ id: gig, name: "Club gig", songs: [c, b] }])
})
