import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { request, type APIRequestContext } from "@playwright/test"
import { addMember, as, BASE, confirm, HEADERS, signIn, STATE, type Band } from "./band"

/*
  A made-up band, made once before the page tests through the service's own
  routes, as its people and РЭХА would: Alex signs in first and is the owner,
  adds the others and makes a key, РЭХА sends two rehearsals' takes, and the
  members star and comment. The tests run one at a time on it (see
  playwright.config.ts), and each changes only what no other test reads.

  Who reads what:
    Paŭlik   only Home's tests; he opened Viasna 12 before the others
             marked it, so its marks are new for him.
    Ira      stars Pałyn 3, which nobody else stars.
    Dzima    marks Pałyn 9, and comments on, closes and opens again
             Ira's mark on Kupalle 2.
    Alex     the owner's pages, labels, songs, the trash, and pages only
             looked at.
*/

const REHEARSALS = {
  first: { uid: "3c1f6a2e-8b4d-4e7a-9c35-1d2e3f4a5b6c", name: "Thursday", date: "2025-10-23" },
  second: { uid: "7a9b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", name: "Thursday", date: "2025-10-30" },
}

// The six tracks of test/fixtures, 10.032 s each, made by the playback
// test's make_tracks.py.
const TRACKS = ["Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"]
const ICONS = ["drums", "bass", "guitar", "keys", "vocals", "shaker"]
const LENGTH = 10.032

type Mark = { at: number; label: string; colour: string; note: string }
type Seeded = {
  name: string
  song: string | null
  number: number
  rehearsal: keyof typeof REHEARSALS
  tracks: number
  starred?: boolean
  notes?: boolean
  flac?: boolean
  marks?: Mark[]
  balance?: Record<string, number>
}

const TAKES: Seeded[] = [
  { name: "Viasna 4", song: "Viasna", number: 4, rehearsal: "first", tracks: 1 },
  { name: "Viasna 5", song: "Viasna", number: 5, rehearsal: "first", tracks: 2 },
  { name: "Pałyn 3", song: "Pałyn", number: 3, rehearsal: "first", tracks: 2 },
  { name: "Kupalle 2", song: "Kupalle", number: 2, rehearsal: "second", tracks: 2, starred: true, flac: true,
    marks: [{ at: 2, label: "Again", colour: "red", note: "Count it in" }] },
  { name: "Take 7", song: null, number: 7, rehearsal: "second", tracks: 1 },
  { name: "Pałyn 9", song: "Pałyn", number: 9, rehearsal: "second", tracks: 2, notes: true },
  { name: "Viasna 11", song: "Viasna", number: 11, rehearsal: "second", tracks: 2 },
  { name: "Viasna 12", song: "Viasna", number: 12, rehearsal: "second", tracks: 6, balance: { Vocals: 0.7 },
    marks: [{ at: 1.5, label: "Good", colour: "green", note: "" }] },
]

const mp3 = (i: number) => new Uint8Array(readFileSync(new URL(`../test/fixtures/t${i}.mp3`, import.meta.url)))

/** A waveform as РЭХА draws it: 1200 numbers from 0 to 1. */
const peaks = (seed: number) =>
  JSON.stringify({
    peaks: Array.from({ length: 1200 }, (_, i) => Math.round((0.15 + 0.7 * Math.abs(Math.sin(i / 40 + seed))) * 1000) / 1000),
  })

/** РЭХА with a key, as its sending module calls the service. */
export function reha(api: APIRequestContext, key: string) {
  const headers = { "x-api-key": key.slice(key.lastIndexOf(":") + 1), "X-Reha-Version": "0.17.0" }
  const ok = async (res: Awaited<ReturnType<APIRequestContext["fetch"]>>) => {
    if (!res.ok()) throw new Error(`${res.url()}: ${res.status()} ${await res.text()}`)
    return res.json() as Promise<Record<string, string>>
  }
  return {
    put: (path: string, data: unknown) => api.put(path, { headers, data }).then(ok),
    post: (path: string, data: unknown) => api.post(path, { headers, data }).then(ok),
    del: (path: string) => api.delete(path, { headers }).then(ok),
    async file(uid: string, name: string, bytes: Uint8Array | string) {
      const body = Buffer.from(bytes)
      const { upload_id } = await this.post(`/api/reha/takes/${uid}/files`, { gen: 1, name, size: body.length })
      const part = `/api/reha/takes/${uid}/files/${upload_id}/1?gen=1&name=${name}`
      const { etag } = await ok(
        await api.put(part, { headers: { ...headers, "Content-Type": "application/octet-stream" }, data: body })
      )
      await this.post(`/api/reha/takes/${uid}/files/${upload_id}/done`, { gen: 1, name, parts: [[1, etag]] })
    },
  }
}

/** The owner adds a member, who confirms, signs in and is named; their sign-in is kept in `file`. */
export async function member(owner: APIRequestContext, email: string, name: string, file: string) {
  await addMember(owner, email)
  const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS })
  await confirm(api, email)
  await signIn(api, email)
  await api.put("/api/me", { data: { name } })
  await api.storageState({ path: file })
  return api
}

export default async function seed() {
  mkdirSync(STATE, { recursive: true })
  const owner = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS })
  await owner.delete("/api/stand-ins")

  // The owner's first code makes the owner; Cloudflare asks him to confirm first.
  await confirm(owner, "alex@example.com")
  await signIn(owner, "alex@example.com")
  await owner.put("/api/me", { data: { name: "Alex" } })
  await owner.storageState({ path: as("alex") })

  const dzima = await member(owner, "dzima@example.com", "Dzima", as("dzima"))
  const ira = await member(owner, "ira@example.com", "Ira", as("ira"))
  const paulik = await member(owner, "paulik@example.com", "Paŭlik", as("paulik"))
  // One who has not pressed Cloudflare's button, one who has and never signed in.
  await addMember(owner, "nina@example.com")
  await addMember(owner, "ales@example.com")
  await confirm(owner, "ales@example.com")

  const { key } = (await (await owner.post("/api/keys", { data: { name: "Rehearsal room" } })).json()) as { key: string }
  const send = reha(owner, key)
  const takes: Band["takes"] = {}
  for (const t of TAKES) {
    const uid = crypto.randomUUID()
    takes[t.name] = uid
    const tracks = TRACKS.slice(0, t.tracks).map((name, i) => ({
      position: i + 1,
      name,
      icon: ICONS[i],
      files: [`${i + 1}.mp3`, `${i + 1}.flac`, `${i + 1}.peaks`],
    }))
    const notes = t.notes ? [{ position: t.tracks + 1, name: "Keys", file: `${t.tracks + 1}.mid` }] : []
    await send.put(`/api/reha/takes/${uid}`, {
      rehearsal: REHEARSALS[t.rehearsal],
      number: t.number,
      name: t.name,
      song: t.song,
      duration_sec: LENGTH,
      gen: 1,
      cut_start: 0,
      starred: t.starred ?? false,
      balance: t.balance ?? {},
      tracks,
      notes,
      marks: t.marks ?? [],
    })
    // As РЭХА sends them: every MP3 and waveform first, then the originals.
    for (const k of tracks) {
      await send.file(uid, `${k.position}.mp3`, mp3(k.position))
      await send.file(uid, `${k.position}.peaks`, peaks(k.position))
    }
    for (const n of notes) await send.file(uid, n.file, "MThd made up")
    await send.post(`/api/reha/takes/${uid}/ready`, { gen: 1, what: "mp3" })
    if (t.flac) {
      for (const k of tracks) await send.file(uid, `${k.position}.flac`, "fLaC made up")
      await send.post(`/api/reha/takes/${uid}/ready`, { gen: 1, what: "flac" })
    }
  }
  // Deleted in РЭХА: it waits in the trash.
  await send.del(`/api/reha/takes/${takes["Viasna 4"]}`)

  // Paŭlik opens Viasna 12 before the others mark it.
  await paulik.post(`/api/takes/${takes["Viasna 12"]}/seen`)
  const ok = async (res: Awaited<ReturnType<APIRequestContext["fetch"]>>) => {
    if (!res.ok()) throw new Error(`${res.url()}: ${res.status()} ${await res.text()}`)
    return (await res.json()) as { id: number }
  }
  const mark = async (api: APIRequestContext, take: string, at: number, note: string) =>
    (await ok(await api.post(`/api/takes/${takes[take]}/marks`, { data: { at, note } }))).id
  const drags = await mark(dzima, "Viasna 12", 4, "The bridge drags here")
  await ok(await owner.post(`/api/marks/${drags}/comments`, { data: { text: "It's us waiting for the vocal. Let's count it in." } }))
  await mark(ira, "Viasna 12", 7.5, "Fill too long?")
  await mark(ira, "Kupalle 2", 3, "Too quiet here")
  await dzima.post(`/api/takes/${takes["Viasna 11"]}/star`)
  await ira.post(`/api/takes/${takes["Viasna 11"]}/star`)

  const list = (await (await owner.get("/api/songs")).json()) as { songs: { id: number; title: string }[] }
  const songs = Object.fromEntries(list.songs.map((s) => [s.title, s.id]))
  const rehearsals = { first: REHEARSALS.first.uid, second: REHEARSALS.second.uid }
  writeFileSync(new URL("band.json", STATE), JSON.stringify({ takes, songs, rehearsals } satisfies Band, null, 2))
  for (const api of [owner, dzima, ira, paulik]) await api.dispose()
}
