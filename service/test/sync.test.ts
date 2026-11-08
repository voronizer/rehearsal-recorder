import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import {
  answer,
  call,
  del,
  fromReha,
  makeKey,
  member,
  named,
  patch,
  post,
  read,
  reha,
  shownTake,
  signInOwner,
  takeMeta,
} from "./helpers"

type Song = { id: number; title: string; tempo: number | null; signature: string | null; key: string | null; takes: number }
type Songs = { songs: Song[]; not_named: { uid: string; name: string; moved: boolean }[] }
type Listed = {
  songs: {
    id: number
    title: string
    tempo: number | null
    signature: string | null
    trashed: boolean
    title_by: string | null
    meter_by: string | null
    made_by: string | null
    trashed_by: string | null
  }[]
  moved: { uid: string; song_id: number | null; by: string }[]
}

const songs = (cookie: string) => read<Songs>("/api/songs", cookie)
const called = async (cookie: string, title: string) => (await songs(cookie)).songs.find((s) => s.title === title)
const page = (cookie: string, id: number) =>
  read<{ song: Song & { notes: string }; takes: { uid: string; name: string; moved: boolean }[]; files: { url: string }[] }>(
    `/api/songs/${id}`,
    cookie
  )
const takeOf = (uid: string) =>
  env.DB.prepare("SELECT name, song_id, moved_by FROM take WHERE uid = ?")
    .bind(uid)
    .first<{ name: string; song_id: number | null; moved_by: string | null }>()

/** Alex with Ivan in the band, and РЭХА with a key. */
async function band() {
  const alex = await signInOwner()
  const ivan = await member(alex, "ivan@example.com")
  await named(ivan.cookie, "Ivan")
  return { alex, ivan: ivan.cookie, r: await reha() }
}

test("first check: a title in any case is that song, one renamed in РЭХА keeps its song, the rest are made", async () => {
  const { alex, r } = await band()
  const polyn = await shownTake({ song: "Polyn", number: 1, name: "Polyn 1" })
  await shownTake({ song: "ВЯСНА", number: 2, name: "ВЯСНА 1" })
  const old = (await called(alex, "Polyn"))!
  const vy = (await called(alex, "ВЯСНА"))!

  const linked = await answer(
    r.post("/api/reha/songs/link", {
      songs: [
        { title: "Pałyn", old_names: ["Polyn"], tempo: 132, signature: "4/4" },
        { title: "вясна", old_names: [], tempo: null, signature: null },
        { title: "Zorka", old_names: [], tempo: 198, signature: "6/8" },
      ],
    })
  )
  expect(linked.status).toBe(200)
  const zorka = (await called(alex, "Zorka"))!
  expect(linked.body.ids).toEqual([old.id, vy.id, zorka.id])
  expect(await called(alex, "Pałyn")).toMatchObject({ id: old.id, tempo: 132, signature: "4/4", takes: 1 })
  expect(await takeOf(polyn)).toMatchObject({ name: "Pałyn 1", song_id: old.id })
  // A title that differs only in capitals takes РЭХА's.
  expect(await called(alex, "вясна")).toMatchObject({ id: vy.id })
  expect(zorka).toMatchObject({ tempo: 198, signature: "6/8", takes: 0 })
  // Asked again, its first answer lost on the way: the same numbers.
  const again = await answer(
    r.post("/api/reha/songs/link", {
      songs: [
        { title: "Pałyn", old_names: ["Polyn"], tempo: 132, signature: "4/4" },
        { title: "вясна", old_names: [], tempo: null, signature: null },
        { title: "Zorka", old_names: [], tempo: 198, signature: "6/8" },
      ],
    })
  )
  expect(again.body.ids).toEqual(linked.body.ids)
})

test("first check: a song left empty by a rename in РЭХА is merged into the one it became, notes, key and files", async () => {
  const { alex, r } = await band()
  await shownTake({ song: "Pałyn", number: 3, name: "Pałyn 1" })
  const palyn = (await called(alex, "Pałyn"))!
  await patch(`/api/songs/${palyn.id}`, { notes: "Slow intro" }, alex)
  const empty = (await answer(post("/api/songs", { title: "Palyn" }, alex))).body.id
  await patch(`/api/songs/${empty}`, { notes: "Words: verse 2", key: "E minor" }, alex)
  const bytes = new Uint8Array([7, 7, 7])
  const sent = await call(
    `/api/songs/${empty}/files`,
    { method: "POST", body: bytes, headers: { "Content-Type": "application/pdf", "X-File-Name": "words.pdf" } },
    alex
  )
  expect(sent.status).toBe(200)

  const linked = await answer(r.post("/api/reha/songs/link", { songs: [{ title: "Pałyn", old_names: ["Palyn"], tempo: null, signature: null }] }))
  expect(linked.body.ids).toEqual([palyn.id])
  const all = (await songs(alex)).songs
  expect(all.map((s) => s.title)).toEqual(["Pałyn"])
  const one = await page(alex, palyn.id)
  expect(one.song).toMatchObject({ key: "E minor", notes: "Slow intro\n\nWords: verse 2" })
  expect(one.files).toHaveLength(1)
  const file = await call(one.files[0].url, {}, alex)
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
})

test("a song made in РЭХА gets its number; a title the band has is that song, out of the Trash, spelt as in РЭХА", async () => {
  const { alex, r } = await band()
  const made = await answer(r.post("/api/reha/songs", { title: "Zorka", tempo: 128, signature: "4/4" }))
  expect(made.status).toBe(200)
  expect(await called(alex, "Zorka")).toMatchObject({ id: made.body.id, tempo: 128, signature: "4/4" })
  expect((await answer(r.post("/api/reha/songs", { title: "ZORKA", tempo: null, signature: null }))).body).toEqual({ id: made.body.id })
  expect(await called(alex, "ZORKA")).toMatchObject({ id: made.body.id, tempo: 128 })
  // РЭХА's tempo is the song's, as at the first check.
  expect((await answer(r.post("/api/reha/songs", { title: "zorka", tempo: 140, signature: "3/4" }))).body).toEqual({ id: made.body.id })
  expect(await called(alex, "zorka")).toMatchObject({ tempo: 140, signature: "3/4" })
  // Deleted here, then made again in РЭХА: the later change, so it comes back.
  expect((await del(`/api/songs/${made.body.id}`, alex)).status).toBe(200)
  expect(await called(alex, "zorka")).toBeUndefined()
  expect((await answer(r.post("/api/reha/songs", { title: "Zorka", tempo: null, signature: null }))).body).toEqual({ id: made.body.id })
  expect(await called(alex, "Zorka")).toMatchObject({ id: made.body.id })
  // A long title from РЭХА, which has no limit of its own, is taken.
  expect((await r.post("/api/reha/songs", { title: "Doŭhaja ".repeat(20).trim(), tempo: null, signature: null })).status).toBe(200)
  expect((await r.post("/api/reha/songs", { title: "Take 4", tempo: null, signature: null })).status).toBe(400)
  expect((await r.post("/api/reha/songs", { title: "Take #4", tempo: null, signature: null })).status).toBe(400)
  expect((await r.post("/api/reha/songs", { title: "Kupalle", tempo: 128, signature: null })).status).toBe(400)
  expect((await r.post("/api/reha/songs", { title: "Kupalle", tempo: 400, signature: "4/4" })).status).toBe(400)
})

test("a change from РЭХА: the title with its takes' names, the tempo with its signature; another song's title is turned down", async () => {
  const { alex, r } = await band()
  const uid = await shownTake({ song: "Dym", number: 5, name: "Dym 3" })
  await shownTake({ song: "Zorka", number: 6, name: "Zorka 1" })
  const dym = (await called(alex, "Dym"))!

  expect((await r.patch(`/api/reha/songs/${dym.id}`, { title: "Dym nad vadoj" })).status).toBe(200)
  expect(await takeOf(uid)).toMatchObject({ name: "Dym nad vadoj 3" })
  expect((await r.patch(`/api/reha/songs/${dym.id}`, { tempo: 198, signature: "6/8" })).status).toBe(200)
  expect(await called(alex, "Dym nad vadoj")).toMatchObject({ tempo: 198, signature: "6/8" })
  expect(await answer(r.patch(`/api/reha/songs/${dym.id}`, { title: "zorka" }))).toEqual({
    status: 409,
    body: { error: "“Zorka” is another song in the band service now. Merge them in РЭХА if they are one song." },
  })
  // Turned down whole: the tempo sent with the title stays as it was.
  expect((await r.patch(`/api/reha/songs/${dym.id}`, { title: "Zorka", tempo: 100, signature: "4/4" })).status).toBe(409)
  expect(await called(alex, "Dym nad vadoj")).toMatchObject({ tempo: 198, signature: "6/8" })
  const kupalle = (await answer(r.post("/api/reha/songs", { title: "Kupalle", tempo: null, signature: null }))).body.id
  await del(`/api/songs/${kupalle}`, alex)
  expect(await answer(r.patch(`/api/reha/songs/${dym.id}`, { title: "Kupalle" }))).toEqual({
    status: 409,
    body: { error: "“Kupalle” is in the band service's Trash. Restore it there to merge the two in РЭХА." },
  })
  expect((await r.patch(`/api/reha/songs/${dym.id}`, { tempo: 128, signature: null })).status).toBe(400)
  expect((await r.patch("/api/reha/songs/9999", { title: "Kupalle" })).status).toBe(404)
  const listed = (await answer(r.get("/api/reha/songs"))).body as Listed
  expect(listed.songs.find((s) => s.id === dym.id)).toMatchObject({ title: "Dym nad vadoj", title_by: null, meter_by: null })
})

test("songs merged in РЭХА are merged here; asked again, nothing breaks", async () => {
  const { alex, r } = await band()
  const a = await shownTake({ song: "Palyn", number: 1, name: "Palyn 1" })
  await shownTake({ song: "Pałyn", number: 2, name: "Pałyn 1" })
  const from = (await called(alex, "Palyn"))!
  const into = (await called(alex, "Pałyn"))!
  await patch(`/api/songs/${from.id}`, { key: "A minor" }, alex)
  expect((await r.post(`/api/reha/songs/${from.id}/merge`, { into: into.id })).status).toBe(200)
  expect((await songs(alex)).songs.map((s) => [s.title, s.takes, s.key])).toEqual([["Pałyn", 2, "A minor"]])
  expect(await takeOf(a)).toMatchObject({ song_id: into.id })
  expect((await r.post(`/api/reha/songs/${from.id}/merge`, { into: into.id })).status).toBe(200)
  expect((await r.post(`/api/reha/songs/${into.id}/merge`, { into: into.id })).status).toBe(400)
})

test("the band renames a song and sets its tempo where it stands, by РЭХА's rules", async () => {
  const { alex, ivan } = await band()
  await shownTake({ song: "Dym", number: 5, name: "Dym 3" })
  await shownTake({ song: "Viasna", number: 6, name: "Viasna 1" })
  const dym = (await called(alex, "Dym"))!

  expect((await patch(`/api/songs/${dym.id}`, { title: "Dym nad vadoj" }, ivan)).status).toBe(200)
  expect((await page(alex, dym.id)).takes.map((t) => t.name)).toEqual(["Dym nad vadoj 3"])
  expect(await answer(patch(`/api/songs/${dym.id}`, { title: "VIASNA" }, ivan))).toEqual({
    status: 409,
    body: { error: "“Viasna” is another song. Songs are merged in РЭХА: Rename song there." },
  })
  // One in the Trash is restored first, then the two merged in РЭХА.
  const kupalle = (await answer(post("/api/songs", { title: "Kupalle" }, alex))).body.id
  await del(`/api/songs/${kupalle}`, alex)
  expect(await answer(patch(`/api/songs/${dym.id}`, { title: "kupalle" }, ivan))).toEqual({
    status: 409,
    body: { error: "“Kupalle” is in the Trash. Restore it, then merge the two in РЭХА: Rename song there." },
  })
  expect(await answer(patch(`/api/songs/${dym.id}`, { title: "Take 3" }, ivan))).toEqual({
    status: 400,
    body: { error: "Take 3 is what a take with no song is called." },
  })
  // As the pages write it, too.
  expect(await answer(patch(`/api/songs/${dym.id}`, { title: "Take #3" }, ivan))).toEqual({
    status: 400,
    body: { error: "Take #3 is what a take with no song is called." },
  })
  expect((await patch(`/api/songs/${dym.id}`, { title: "Take#3" }, ivan)).status).toBe(400)
  // And the word alone, as a take moved out of its song is called.
  expect(await answer(patch(`/api/songs/${dym.id}`, { title: "Take" }, ivan))).toEqual({
    status: 400,
    body: { error: "Take is what a take with no song is called." },
  })
  // A title that only starts with the word is a song's.
  expect((await patch(`/api/songs/${dym.id}`, { title: "Take Five" }, ivan)).status).toBe(200)
  expect((await patch(`/api/songs/${dym.id}`, { title: "Dym nad vadoj" }, ivan)).status).toBe(200)
  expect(await answer(patch(`/api/songs/${dym.id}`, { tempo: 400, signature: "4/4" }, ivan))).toEqual({
    status: 400,
    body: { error: "A tempo in 4/4 is a whole number from 30 to 300" },
  })
  expect((await patch(`/api/songs/${dym.id}`, { tempo: 400, signature: "6/8" }, ivan)).status).toBe(200)
  expect(await called(alex, "Dym nad vadoj")).toMatchObject({ tempo: 400, signature: "6/8" })
  expect((await patch(`/api/songs/${dym.id}`, { tempo: null }, ivan)).status).toBe(200)
  expect(await called(alex, "Dym nad vadoj")).toMatchObject({ tempo: null, signature: null })
})

test("a take moves to another song here; a ★ from РЭХА leaves it there, РЭХА's number ends the wait", async () => {
  const { alex, ivan, r } = await band()
  const uid = await shownTake({ song: "Viasna", number: 3, name: "Viasna 3" })
  await shownTake({ song: "Pałyn", number: 4, name: "Pałyn 7" })
  const palyn = (await called(alex, "Pałyn"))!

  expect((await patch(`/api/takes/${uid}`, { song: palyn.id }, ivan)).status).toBe(200)
  expect(await takeOf(uid)).toMatchObject({ name: "Pałyn", song_id: palyn.id })
  expect((await page(alex, palyn.id)).takes.find((t) => t.uid === uid)).toMatchObject({ name: "Pałyn", moved: true })
  // A ★ in РЭХА before its check sends the details without the song.
  const { name: _n, song: _s, ...rest } = takeMeta({ number: 3, starred: true })
  expect((await r.put(`/api/reha/takes/${uid}`, rest)).status).toBe(200)
  expect(await takeOf(uid)).toMatchObject({ name: "Pałyn", song_id: palyn.id })
  const listed = (await answer(r.get("/api/reha/songs"))).body as Listed
  expect(listed.moved).toEqual([{ uid, song_id: palyn.id, by: "Ivan" }])

  const done = await answer(r.put(`/api/reha/takes/${uid}`, takeMeta({ number: 3, song: undefined, song_id: palyn.id, name: "Pałyn 8" })))
  expect(done.body).toMatchObject({ ok: true, song_id: palyn.id })
  expect(await takeOf(uid)).toEqual({ name: "Pałyn 8", song_id: palyn.id, moved_by: null })
  expect((await r.put(`/api/reha/takes/${uid}`, takeMeta({ number: 3, song: undefined, song_id: 9999 }))).status).toBe(409)
})

test("a take leaves its song here: Take until REHA numbers it, listed for REHA with no song, the song stays", async () => {
  const { alex, ivan, r } = await band()
  // The 3rd take that evening, Viasna's 13th.
  const uid = await shownTake({ song: "Viasna", number: 3, name: "Viasna 13" })
  const viasna = (await called(alex, "Viasna"))!

  expect(await answer(patch(`/api/takes/${uid}`, { song: null }, ivan))).toEqual({ status: 200, body: { ok: true } })
  // Its number with no song comes from РЭХА: “Take · number from РЭХА” till then, never the 3 of its evening.
  expect(await takeOf(uid)).toMatchObject({ name: "Take", song_id: null })
  expect((await songs(alex)).not_named.find((t) => t.uid === uid)).toMatchObject({ name: "Take", moved: true })
  expect(await read<{ name: string; moved: boolean }>(`/api/takes/${uid}`, alex)).toMatchObject({ name: "Take", moved: true })
  expect(await called(alex, "Viasna")).toMatchObject({ id: viasna.id, takes: 0 })
  expect(((await answer(r.get("/api/reha/songs"))).body as Listed).moved).toEqual([{ uid, song_id: null, by: "Ivan" }])

  // РЭХА numbers it with the takes that have no song and sends it: the wait ends.
  const done = await answer(r.put(`/api/reha/takes/${uid}`, takeMeta({ number: 3, song: null, name: "Take 48" })))
  expect(done.body).toMatchObject({ ok: true, song_id: null })
  expect(await takeOf(uid)).toEqual({ name: "Take 48", song_id: null, moved_by: null })
  expect((await songs(alex)).not_named.find((t) => t.uid === uid)).toMatchObject({ name: "Take 48", moved: false })

  // Again, on a take with no song: nothing changes, nothing is listed.
  expect((await patch(`/api/takes/${uid}`, { song: null }, ivan)).status).toBe(200)
  expect(await takeOf(uid)).toEqual({ name: "Take 48", song_id: null, moved_by: null })
  expect(((await answer(r.get("/api/reha/songs"))).body as Listed).moved).toEqual([])
})

test("moved to a song, then out of it before REHA's check: listed once, with no song", async () => {
  const { alex, ivan, r } = await band()
  const uid = await shownTake({ song: "Viasna", number: 5, name: "Viasna 5" })
  await shownTake({ song: "Pałyn", number: 6, name: "Pałyn 2" })
  const palyn = (await called(alex, "Pałyn"))!

  expect((await patch(`/api/takes/${uid}`, { song: palyn.id }, ivan)).status).toBe(200)
  expect((await patch(`/api/takes/${uid}`, { song: null }, ivan)).status).toBe(200)
  expect(await takeOf(uid)).toMatchObject({ name: "Take", song_id: null })
  expect(((await answer(r.get("/api/reha/songs"))).body as Listed).moved).toEqual([{ uid, song_id: null, by: "Ivan" }])
})

test("a take moves to a new song made here; a title the band has is turned down", async () => {
  const { alex, ivan, r } = await band()
  const uid = await shownTake({ song: null, number: 14, name: "Take 14" })
  expect(await answer(patch(`/api/takes/${uid}`, { new_song: "zorka " }, ivan))).toEqual({ status: 200, body: { ok: true } })
  const zorka = (await called(alex, "zorka"))!
  expect(await takeOf(uid)).toMatchObject({ name: "zorka", song_id: zorka.id })
  expect(await answer(patch(`/api/takes/${uid}`, { new_song: "ZORKA" }, ivan))).toEqual({
    status: 409,
    body: { error: "“zorka” is already a song: pick it in the list." },
  })
  const gone = (await answer(post("/api/songs", { title: "Kupalle" }, alex))).body.id
  await del(`/api/songs/${gone}`, alex)
  expect(await answer(patch(`/api/takes/${uid}`, { new_song: "kupalle" }, ivan))).toEqual({
    status: 409,
    body: { error: "“Kupalle” is in the Trash: restore it to move the take there." },
  })
  const listed = (await answer(r.get("/api/reha/songs"))).body as Listed
  expect(listed.songs.find((s) => s.id === zorka.id)).toMatchObject({ made_by: "Ivan" })
  expect((await patch(`/api/takes/${uid}`, { song: 9999 }, ivan)).status).toBe(404)
})

test("РЭХА reads every song with who changed what here", async () => {
  const { alex, ivan, r } = await band()
  await shownTake({ song: "Dym", number: 5, name: "Dym 3" })
  const dym = (await called(alex, "Dym"))!
  await patch(`/api/songs/${dym.id}`, { title: "Dym nad vadoj", tempo: 132, signature: "4/4" }, ivan)
  const kupalle = (await answer(post("/api/songs", { title: "Kupalle" }, alex))).body.id
  await del(`/api/songs/${kupalle}`, ivan)

  const listed = (await answer(r.get("/api/reha/songs"))).body as Listed
  expect(listed.songs).toEqual(
    expect.arrayContaining([
      {
        id: dym.id,
        title: "Dym nad vadoj",
        tempo: 132,
        signature: "4/4",
        trashed: false,
        title_by: "Ivan",
        meter_by: "Ivan",
        made_by: null,
        trashed_by: null,
      },
      {
        id: kupalle,
        title: "Kupalle",
        tempo: null,
        signature: null,
        trashed: true,
        title_by: null,
        meter_by: null,
        made_by: "alex@example.com",
        trashed_by: "Ivan",
      },
    ])
  )
})

test("РЭХА 0.23 is told to update", async () => {
  const key = await makeKey(await signInOwner())
  expect(await answer(fromReha("/api/reha/songs", key, "0.23.0"))).toEqual({
    status: 426,
    body: { error: "Update РЭХА to send takes here" },
  })
})
