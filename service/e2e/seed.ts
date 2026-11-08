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
/** A note of a .mid: when it starts and how long it lasts, in seconds, its note, and its channel from 0. */
type Note = [at: number, length: number, note: number, channel?: number]
type Seeded = {
  name: string
  song: string | null
  number: number
  rehearsal: keyof typeof REHEARSALS
  tracks: number
  starred?: boolean
  /** The tracks that recorded notes, their icons, and their notes. */
  notes?: { name: string; icon: string; notes: Note[] }[]
  /** The click the take was recorded to; a take РЭХА 0.21 sent has none. */
  meter?: { tempo: number | null; signature: "4/4" | "3/4" | "2/4" | "6/8" | null; click: boolean }
  /** The band's tempo through the take, bar by bar, as РЭХА counts it once the files are up. */
  bars?: (number | null)[]
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
  // РЭХА numbers the takes with no song as it numbers a song's, across the
  // whole library: the 7th take that evening is the 3rd with no song. The
  // pages write “Take #3”.
  { name: "Take 3", song: null, number: 7, rehearsal: "second", tracks: 1 },
  // The keys recorded only their notes: a chord a bar.
  { name: "Pałyn 9", song: "Pałyn", number: 9, rehearsal: "second", tracks: 2,
    notes: [{ name: "Keys", icon: "keys", notes: [0, 2, 4, 6, 8].flatMap((at) => [60, 64, 67].map((n): Note => [at, 1.8, n])) }] },
  // РЭХА sends a take's number in its rehearsal, not at its song: the 10th
  // take that evening, and Viasna's 11th. The pages write “Viasna #11”.
  { name: "Viasna 11", song: "Viasna", number: 10, rehearsal: "second", tracks: 2 },
  // The kit sent its notes as well as its sound: kick, snare and hi-hat on
  // channel 10. To the click at 120, 4/4, a bar every 2 s; the band rushed
  // from the third bar on.
  { name: "Viasna 12", song: "Viasna", number: 12, rehearsal: "second", tracks: 6, balance: { Vocals: 0.7 },
    marks: [{ at: 1.5, label: "Good", colour: "green", note: "" }],
    meter: { tempo: 120, signature: "4/4", click: true }, bars: [120.2, 120.8, 125.6, 126.4, 126.1],
    notes: [{ name: "Drums", icon: "drums", notes: Array.from({ length: 20 }, (_, k): Note[] => [[k / 2, 0.1, 42, 9], [k / 2, 0.1, k % 2 ? 38 : 36, 9]]).flat() }] },
]

const mp3 = (i: number) => new Uint8Array(readFileSync(new URL(`../test/fixtures/t${i}.mp3`, import.meta.url)))

/** A number as a .mid's variable-length quantity. */
function vlq(n: number): number[] {
  const out = [n & 0x7f]
  for (n >>= 7; n > 0; n >>= 7) out.unshift((n & 0x7f) | 0x80)
  return out
}

/** A .mid as РЭХА writes a take's: one track, 960 ticks to the beat at 120 a minute, so 1920 to a second. */
export function smf(notes: Note[]): Uint8Array {
  const events: [number, number[]][] = notes.flatMap(([at, length, note, channel = 0]): [number, number[]][] => [
    [Math.round(at * 1920), [0x90 | channel, note, 100]],
    [Math.round((at + length) * 1920), [0x80 | channel, note, 0]],
  ])
  // A release before a strike on the same tick.
  events.sort((a, b) => a[0] - b[0] || a[1][0] - b[1][0])
  const body: number[] = []
  let last = 0
  for (const [tick, bytes] of events) {
    body.push(...vlq(tick - last), ...bytes)
    last = tick
  }
  body.push(0, 0xff, 0x2f, 0)
  const n = body.length
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 960 >> 8, 960 & 0xff]
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...body])
}

/** A waveform as РЭХА draws it: 1200 numbers from 0 to 1. */
const peaks = (seed: number) =>
  JSON.stringify({
    peaks: Array.from({ length: 1200 }, (_, i) => Math.round((0.15 + 0.7 * Math.abs(Math.sin(i / 40 + seed))) * 1000) / 1000),
  })

/** РЭХА with a key, as its sending module calls the service. */
export function reha(api: APIRequestContext, key: string) {
  const headers = { "x-api-key": key.slice(key.lastIndexOf(":") + 1), "X-Reha-Version": "0.24.0" }
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
    // Numbered on from the tracks of sound, as РЭХА numbers them.
    const notes = (t.notes ?? []).map((n, i) => ({
      position: t.tracks + 1 + i,
      name: n.name,
      icon: n.icon,
      file: `${t.tracks + 1 + i}.mid`,
    }))
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
      ...(t.meter && { meter: t.meter }),
    })
    // As РЭХА sends them: every MP3 and waveform first, then the originals.
    for (const k of tracks) {
      await send.file(uid, `${k.position}.mp3`, mp3(k.position))
      await send.file(uid, `${k.position}.peaks`, peaks(k.position))
    }
    for (const [i, n] of notes.entries()) await send.file(uid, n.file, smf(t.notes![i].notes))
    await send.post(`/api/reha/takes/${uid}/ready`, { gen: 1, what: "mp3" })
    if (t.meter?.tempo && t.meter.signature && t.bars) {
      const per = (60 / t.meter.tempo) * Number(t.meter.signature.split("/")[0])
      const bars = t.bars.map((tempo, i) => ({ n: i + 1, start: i * per, end: (i + 1) * per, tempo }))
      const counted = bars.map((b) => b.tempo).filter((b): b is number => b !== null).sort((a, b) => a - b)
      await send.put(`/api/reha/takes/${uid}/drift`, {
        gen: 1,
        drift: {
          ok: true,
          source: "drums",
          per_bar: Number(t.meter.signature.split("/")[0]),
          middle: counted[counted.length >> 1],
          aim: { tempo: t.meter.tempo, signature: t.meter.signature, from: t.meter.click ? "click" : "take", song: t.song },
          bars,
        },
      })
    }
    if (t.flac) {
      for (const k of tracks) await send.file(uid, `${k.position}.flac`, "fLaC made up")
      await send.post(`/api/reha/takes/${uid}/ready`, { gen: 1, what: "flac" })
    }
  }
  // Deleted in РЭХА: it waits in the trash.
  await send.del(`/api/reha/takes/${takes["Viasna 4"]}`)

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
