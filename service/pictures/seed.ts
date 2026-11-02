import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { request, type APIRequestContext } from "@playwright/test"
import { BASE, confirm, HEADERS, signIn } from "../e2e/band"
import { member, reha } from "../e2e/seed"

/*
  The band the pictures on reha.stream/band-service show: four people, named
  as in Alex's band (the parts and what they write are made up), and a
  month of Thursday rehearsals, the last one this week, so the dates on the
  pictures read as they would on the evening. Made through the service's own
  routes, as in the page tests (e2e/seed.ts), but with takes of a song's
  length and waveforms shaped like a band's.

  Who plays what, and who sees what:
    Vik      drums.
    Alex     bass; the owner.
    Ivan     guitar. The pictures of a take, a song and the marks are
             his: he has heard everything, and marked Viasna 12.
    Ira      vocals. The first page is hers: she has not opened this
             week's takes yet, and the others marked takes she had heard.
*/

export const STATE = new URL("./.state/", import.meta.url)
export const as = (who: "alex" | "ivan" | "ira" | "vik") => new URL(`${who}.json`, STATE).pathname
export type Pictured = { takes: Record<string, string>; songs: Record<string, number> }
export const pictured = (): Pictured => JSON.parse(readFileSync(new URL("band.json", STATE), "utf-8"))

/** The rehearsal `back` weeks before this week's Thursday (today, if it is one). */
function thursday(back: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 3) % 7) - back * 7)
  return d.toISOString().slice(0, 10)
}

const TRACKS = [
  { name: "Drums", icon: "drums" },
  { name: "Bass", icon: "bass" },
  { name: "Guitar", icon: "guitar" },
  { name: "Vocals", icon: "vocals" },
] as const
type Part = (typeof TRACKS)[number]["name"]

type Seeded = {
  song: string
  number: number
  /** Weeks before this week's rehearsal. */
  back: number
  /** m:ss */
  length: string
  starred?: boolean
  marks?: { at: number; label: string; colour: string; note: string }[]
}

// The order РЭХА would send them in: rehearsal by rehearsal, take by take.
const TAKES: Seeded[] = [
  { song: "Viasna", number: 1, back: 3, length: "4:21" },
  { song: "Viasna", number: 2, back: 3, length: "4:09" },
  { song: "Viasna", number: 3, back: 3, length: "4:02" },
  { song: "Pałyn", number: 1, back: 3, length: "3:31" },
  { song: "Viasna", number: 4, back: 2, length: "4:14" },
  { song: "Pałyn", number: 2, back: 2, length: "3:26" },
  { song: "Viasna", number: 5, back: 2, length: "4:07" },
  { song: "Kupalle", number: 1, back: 1, length: "5:12" },
  { song: "Viasna", number: 6, back: 1, length: "4:11" },
  { song: "Viasna", number: 7, back: 1, length: "4:03" },
  { song: "Viasna", number: 8, back: 1, length: "4:06" },
  { song: "Pałyn", number: 3, back: 0, length: "3:24" },
  { song: "Viasna", number: 9, back: 0, length: "4:10" },
  { song: "Viasna", number: 10, back: 0, length: "4:08" },
  { song: "Viasna", number: 11, back: 0, length: "4:04" },
  {
    song: "Viasna",
    number: 12,
    back: 0,
    length: "4:05",
    marks: [{ at: 178, label: "Keep this", colour: "green", note: "This solo" }],
  },
  { song: "Kupalle", number: 2, back: 0, length: "5:05", starred: true },
]

const seconds = (length: string) => {
  const [m, s] = length.split(":").map(Number)
  return m * 60 + s
}

/** A made-up waveform for a part over a take: 1200 numbers from 0 to 1, a
 *  song's parts in it (intro, verses, choruses, a bridge, a solo, the end),
 *  the same every time it is drawn. */
function peaks(part: Part, length: number, seed: number): string {
  let state = seed * 7919 + part.length * 104729
  const noise = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648)
  // Where each part of the song starts, as a share of the take, and how loud it is.
  const form: [number, number][] = [
    [0, 0.35], [0.04, 0.55], [0.2, 0.85], [0.33, 0.55], [0.41, 0.45],
    [0.51, 0.85], [0.67, 0.75], [0.8, 0.9], [0.94, 0.5], [0.995, 0],
  ]
  const loud = (share: number) => form.filter(([at]) => at <= share).at(-1)![1]
  const values = Array.from({ length: 1200 }, (_, i) => {
    const share = i / 1200
    const t = share * length
    const energy = loud(share)
    let v: number
    if (part === "Drums") v = t < 2 ? 0.12 : energy * (0.7 + 0.3 * noise()) * (i % 5 === 0 ? 1.15 : 0.9)
    else if (part === "Bass") v = share < 0.04 ? 0.03 : energy * 0.75 * (0.85 + 0.15 * noise())
    else if (part === "Guitar") v = (share >= 0.67 && share < 0.8 ? 1.1 : 0.8) * Math.max(energy, 0.45) * (0.7 + 0.3 * noise())
    else {
      const sings = (share >= 0.04 && share < 0.41) || (share >= 0.51 && share < 0.67) || (share >= 0.8 && share < 0.94)
      v = sings && t % 8 < 6.2 ? energy * (0.55 + 0.45 * noise()) : 0.03 * noise()
    }
    return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000
  })
  return JSON.stringify({ peaks: values })
}

const mp3 = (i: number) => new Uint8Array(readFileSync(new URL(`../test/fixtures/t${i}.mp3`, import.meta.url)))

export default async function seed() {
  mkdirSync(STATE, { recursive: true })
  const owner = await request.newContext({ baseURL: BASE, extraHTTPHeaders: HEADERS })
  await owner.delete("/api/stand-ins")
  await confirm(owner, "alex@example.com")
  await signIn(owner, "alex@example.com")
  await owner.put("/api/me", { data: { name: "Alex" } })
  // A name for the pictures' band, made up for them.
  await owner.put("/api/band", { data: { name: "Kapela" } })
  await owner.storageState({ path: as("alex") })
  const vik = await member(owner, "vik@example.com", "Vik", as("vik"))
  const ivan = await member(owner, "ivan@example.com", "Ivan", as("ivan"))
  const ira = await member(owner, "ira@example.com", "Ira", as("ira"))
  const band = [owner, vik, ivan, ira]

  const { key } = (await (await owner.post("/api/keys", { data: { name: "Rehearsal room" } })).json()) as { key: string }
  const send = reha(owner, key)
  const rehearsals = [0, 1, 2, 3].map(() => crypto.randomUUID())
  const takes: Record<string, string> = {}
  const sendTake = async (t: Seeded, n: number) => {
    const uid = crypto.randomUUID()
    const name = `${t.song} ${t.number}`
    takes[name] = uid
    const length = seconds(t.length)
    const tracks = TRACKS.map((k, i) => ({
      position: i + 1,
      name: k.name,
      icon: k.icon,
      files: [`${i + 1}.mp3`, `${i + 1}.flac`, `${i + 1}.peaks`],
    }))
    await send.put(`/api/reha/takes/${uid}`, {
      rehearsal: { uid: rehearsals[t.back], name: "Thursday", date: thursday(t.back) },
      number: t.number,
      name,
      song: t.song,
      duration_sec: length,
      gen: 1,
      cut_start: 0,
      starred: t.starred ?? false,
      // As the band's mix in РЭХА had it: the guitar and the vocals down a little.
      balance: { Guitar: 0.8, Vocals: 0.8 },
      tracks,
      notes: [],
      marks: t.marks ?? [],
    })
    // The pictures play nothing, so the page tests' short tracks stand in for the sound.
    for (const k of tracks) {
      await send.file(uid, `${k.position}.mp3`, mp3(k.position))
      await send.file(uid, `${k.position}.peaks`, peaks(TRACKS[k.position - 1].name, length, n))
    }
    await send.post(`/api/reha/takes/${uid}/ready`, { gen: 1, what: "mp3" })
    for (const k of tracks) await send.file(uid, `${k.position}.flac`, "fLaC made up")
    await send.post(`/api/reha/takes/${uid}/ready`, { gen: 1, what: "flac" })
  }
  const labels = (await (await owner.get("/api/labels")).json()) as { id: number; name: string }[]
  const label = (name: string) => labels.find((l) => l.name === name)!.id
  const ok = async (res: Awaited<ReturnType<APIRequestContext["fetch"]>>) => {
    if (!res.ok()) throw new Error(`${res.url()}: ${res.status()} ${await res.text()}`)
    return (await res.json()) as { id: number }
  }
  /** A mark at `at` with one of the band's four labels. */
  const mark = async (api: APIRequestContext, take: string, at: number, name: string, note: string) =>
    (await ok(await api.post(`/api/takes/${takes[take]}/marks`, { data: { at, label_id: label(name), note } }))).id
  /** A comment under a mark. */
  const talk = (api: APIRequestContext, id: number, text: string) => api.post(`/api/marks/${id}/comments`, { data: { text } }).then(ok)
  const see = async (api: APIRequestContext, names: string[]) => {
    for (const name of names) await api.post(`/api/takes/${takes[name]}/seen`)
  }
  const star = (api: APIRequestContext, take: string) => api.post(`/api/takes/${takes[take]}/star`)

  // The three rehearsals before this week's, heard by everyone.
  const earlier = TAKES.filter((t) => t.back > 0)
  for (const [n, t] of earlier.entries()) await sendTake(t, n)
  const bridge = await mark(ira, "Viasna 3", 104, "Keep this", "The bridge, finally! Let's play it like this every time.")
  await talk(owner, bridge, "Same tempo next week, then.")
  for (const api of band) await see(api, Object.keys(takes))
  await star(ira, "Viasna 3")
  await star(owner, "Viasna 3")
  await star(vik, "Viasna 8")
  await star(ira, "Pałyn 2")
  // Written after Ira had heard those takes: new for her.
  await mark(vik, "Viasna 8", 130, "Do again", "Let's take this bit faster next time.")
  await mark(owner, "Kupalle 1", 280, "Note", "The ending is long. Two bars less?")

  // This week's rehearsal. Ira has not opened it yet; the others have.
  const now = TAKES.filter((t) => t.back === 0)
  for (const [n, t] of now.entries()) await sendTake(t, earlier.length + n)
  const tonight = now.map((t) => `${t.song} ${t.number}`)
  for (const api of [owner, vik, ivan]) await see(api, tonight)
  const drags = await mark(ivan, "Viasna 12", 102, "Went wrong", "The bridge drags here.")
  await talk(vik, drags, "Not the drums. I soloed them.")
  await talk(owner, drags, "It's the bass. Sorry.")
  await mark(owner, "Viasna 12", 231, "Do again", "Let's end all together on four.")
  for (const api of [vik, ivan, owner]) await star(api, "Viasna 12")

  const list = (await (await owner.get("/api/songs")).json()) as { songs: { id: number; title: string }[] }
  const songs = Object.fromEntries(list.songs.map((s) => [s.title, s.id]))
  writeFileSync(new URL("band.json", STATE), JSON.stringify({ takes, songs } satisfies Pictured, null, 2))
  for (const api of band) await api.dispose()
}
