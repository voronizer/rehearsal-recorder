import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { trash } from "../worker/takes/store"
import { answer, call, del, member, open, patch, post, read, shownTake, signInOwner, starIt } from "./helpers"

const bindings = env as unknown as Bindings
const put = (path: string, body: unknown, cookie: string) => call(path, { method: "PUT", body: JSON.stringify(body) }, cookie)

type TakeRow = { uid: string; name: string; duration_sec: number; is_new: boolean }
type SongItem = {
  id: number
  title: string
  status_id: number
  key: string | null
  tempo: number | null
  takes: number
  rehearsals: number
  last_date: string | null
  length: number | null
  best: TakeRow | null
  best_why: "most stars" | "latest" | null
  has_new: boolean
}
type Songs = { statuses: { id: number; name: string; songs: number }[]; songs: SongItem[]; not_named: TakeRow[] }
type SongPage = { song: SongItem & { notes: string }; takes: TakeRow[]; files: FileView[] }
type FileView = { id: number; name: string; kind: string; size: number; url: string; added_by: string }

const songs = (cookie: string) => read<Songs>("/api/songs", cookie)
const song = (cookie: string, id: number) => read<SongPage>(`/api/songs/${id}`, cookie)

test("the songs table: every song with its status, takes, length and best take", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  const one = await shownTake({ number: 1, name: "Viasna 1", duration_sec: 245, date: "2025-10-23", tempo: 120 })
  const two = await shownTake({ number: 2, name: "Viasna 2", duration_sec: 250, date: "2025-10-30" })
  await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1", duration_sec: 200, date: "2025-10-30" })
  await shownTake({ song: null, number: 7, name: "Take 7", date: "2025-10-30" })
  await starIt(ira.cookie, one)
  await open(owner, one)
  await open(owner, two)

  const list = await songs(owner)
  expect(list.statuses.map((s) => [s.name, s.songs])).toEqual([
    ["Learning", 2],
    ["Ready", 0],
    ["Archive", 0],
  ])
  const viasna = list.songs.find((s) => s.title === "Viasna")!
  expect(viasna).toMatchObject({
    status_id: list.statuses[0].id,
    key: null,
    tempo: 120,
    takes: 2,
    rehearsals: 2,
    last_date: "2025-10-30",
    length: 245,
    best_why: "most stars",
    has_new: false,
  })
  expect(viasna.best!.uid).toBe(one)
  const palyn = list.songs.find((s) => s.title === "Pałyn")!
  expect(palyn).toMatchObject({ best_why: "latest", has_new: true, length: 200 })
  expect(list.not_named.map((t) => t.name)).toEqual(["Take 7"])
})

test("a new song: its title once in any case, the first status, and its own panel's facts", async () => {
  const owner = await signInOwner()
  await shownTake({ song: "Zorka", number: 1, name: "Zorka 1" })
  expect(await answer(post("/api/songs", { title: "zorka" }, owner))).toEqual({
    status: 409,
    body: { error: "There is already a song called “Zorka”." },
  })
  const made = await answer(post("/api/songs", { title: "  Kupalle " }, owner))
  expect(made.status).toBe(200)
  const page = await song(owner, made.body.id)
  expect(page.song).toMatchObject({ title: "Kupalle", takes: 0, best: null, best_why: null, notes: "", length: null })
  expect(page.song.status_id).toBe((await songs(owner)).statuses[0].id)
  expect((await post("/api/songs", { title: "" }, owner)).status).toBe(400)
})

test("any member sets a song's status, key and notes; a key is one of the 24", async () => {
  const owner = await signInOwner()
  const ira = (await member(owner, "ira@example.com")).cookie
  const id = (await answer(post("/api/songs", { title: "Kupalle" }, owner))).body.id
  const ready = (await songs(ira)).statuses[1].id

  expect((await patch(`/api/songs/${id}`, { status_id: ready, key: "E minor", notes: "Vik counts in." }, ira)).status).toBe(200)
  expect((await song(ira, id)).song).toMatchObject({ status_id: ready, key: "E minor", notes: "Vik counts in." })
  expect((await patch(`/api/songs/${id}`, { key: null }, ira)).status).toBe(200)
  expect((await song(ira, id)).song.key).toBeNull()
  expect((await patch(`/api/songs/${id}`, { key: "H major" }, ira)).status).toBe(400)
  expect((await patch(`/api/songs/${id}`, { status_id: 9999 }, ira)).status).toBe(400)
  expect((await patch(`/api/songs/9999`, { notes: "" }, ira)).status).toBe(404)
})

test("a song with no takes can be deleted, one with takes cannot", async () => {
  const owner = await signInOwner()
  const id = (await answer(post("/api/songs", { title: "Kupalle" }, owner))).body.id
  const gone = await shownTake({ song: "Viasna", number: 1, name: "Viasna 1" })
  await trash(bindings, gone)
  const viasna = (await songs(owner)).songs.find((s) => s.title === "Viasna")!

  expect(await answer(del(`/api/songs/${viasna.id}`, owner))).toEqual({
    status: 400,
    body: { error: "A song with takes cannot be deleted" },
  })
  expect((await del(`/api/songs/${id}`, owner)).status).toBe(200)
  expect((await songs(owner)).songs.map((s) => s.title)).toEqual(["Viasna"])
})

test("statuses: renamed, ordered and deleted, their songs moved; the last one stays", async () => {
  const owner = await signInOwner()
  const id = (await answer(post("/api/songs", { title: "Kupalle" }, owner))).body.id
  const [learning, ready, archive] = (await songs(owner)).statuses
  expect((await patch(`/api/statuses/${learning.id}`, { name: "Working on it" }, owner)).status).toBe(200)
  expect((await patch(`/api/statuses/${ready.id}`, { name: "archive" }, owner)).status).toBe(409)
  const gig = await answer(post("/api/statuses", { name: "Gig" }, owner))
  expect(gig.status).toBe(200)
  expect((await put("/api/statuses/order", { ids: [gig.body.id, learning.id, ready.id, archive.id] }, owner)).status).toBe(200)
  expect((await songs(owner)).statuses.map((s) => s.name)).toEqual(["Gig", "Working on it", "Ready", "Archive"])

  expect(await answer(del(`/api/statuses/${learning.id}`, owner))).toEqual({
    status: 400,
    body: { error: "Say which status its songs get" },
  })
  expect((await del(`/api/statuses/${learning.id}`, owner, { to: ready.id })).status).toBe(200)
  expect((await song(owner, id)).song.status_id).toBe(ready.id)
  for (const s of [gig.body.id, archive.id]) expect((await del(`/api/statuses/${s}`, owner)).status).toBe(200)
  expect(await answer(del(`/api/statuses/${ready.id}`, owner, { to: ready.id }))).toEqual({
    status: 400,
    body: { error: "The band needs at least one status" },
  })
  // A song made now gets the first status there is.
  const late = (await answer(post("/api/songs", { title: "Zorka" }, owner))).body.id
  expect((await song(owner, late)).song.status_id).toBe(ready.id)
})

const upload = (cookie: string, id: number, name: string, type: string, bytes: Uint8Array<ArrayBuffer>) =>
  call(`/api/songs/${id}/files`, { method: "POST", body: bytes, headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(name) } }, cookie)

test("a song's files: up, served as each kind wants, and deleted", async () => {
  const owner = await signInOwner()
  const ira = (await member(owner, "ira@example.com")).cookie
  const id = (await answer(post("/api/songs", { title: "Viasna" }, owner))).body.id
  const bytes = new Uint8Array([1, 2, 3, 4])
  const files: [string, string, string, string][] = [
    ["Viasna.gp", "application/octet-stream", "gp", "attachment"],
    ["Viasna words.pdf", "application/pdf", "pdf", "inline"],
    ["Chorus chords.jpg", "image/jpeg", "picture", "inline"],
    ["Click.wav", "audio/wav", "other", "attachment"],
  ]
  for (const [name, type] of files) expect((await upload(ira, id, name, type, bytes)).status).toBe(200)

  const shown = (await song(owner, id)).files
  expect(shown.map((f) => [f.name, f.kind, f.size])).toEqual(files.map(([name, , kind]) => [name, kind, 4]))
  for (const [i, f] of shown.entries()) {
    const res = await call(f.url, {}, owner)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toMatch(new RegExp(`^${files[i][3]};`))
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  }
  expect((await call(shown[0].url)).status).toBe(401)

  expect((await del(`/api/songs/${id}/files/${shown[0].id}`, owner)).status).toBe(200)
  expect((await song(owner, id)).files.length).toBe(3)
  expect((await call(shown[0].url, {}, owner)).status).toBe(404)
})

test("a file over 50 MB is refused before it is kept", async () => {
  const owner = await signInOwner()
  const id = (await answer(post("/api/songs", { title: "Viasna" }, owner))).body.id
  const big = upload(owner, id, "big.pdf", "application/pdf", new Uint8Array(50 * 1024 * 1024 + 1))
  expect(await answer(big)).toEqual({ status: 413, body: { error: "A file is up to 50 MB" } })
  expect((await env.FILES.list({ prefix: "songs/" })).objects).toEqual([])
  expect((await upload(owner, id, "", "application/pdf", new Uint8Array(4))).status).toBe(400)
})
