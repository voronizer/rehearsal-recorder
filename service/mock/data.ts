import { useSyncExternalStore } from "react"

/*
  Made-up data in place of the service's API (service/src/api.ts). The names
  and the band are the demo band's: Alex bass, Vik drums, Ivan guitar, Ira
  vocals. Songs are in Belarusian Łacinka, as in РЭХА's demo.
*/

export type Member = { id: string; name: string; initial: string; email: string; owner?: boolean; unconfirmed?: boolean }
export type Label = { name: string; colour: string; was?: string[] }
export type Comment = { id: string; by: string; when: string; text: string }
export type Mark = {
  id: string
  take: string
  at: number
  label: number
  note: string
  by: string
  fromReha?: boolean
  when: string
  comments: Comment[]
  closed?: boolean
}
export type Take = { uid: string; song: string | null; n: number; day: string; order: number; len: number; stars: string[]; atReh?: boolean }
export type FileRow = { kind: "GP" | "PDF" | "JPG"; name: string; note: string }
export type Song = { id: string; title: string; status: string; key: string; bpm: number | null; notes: string; files: FileRow[] }
export type Day = { id: string; short: string; long: string }
export type Trashed = { uid: string; removed: string; left: number }
export type Key = { id: string; name: string }

const m = (s: string) => {
  const [a, b] = s.split(":").map(Number)
  return a * 60 + b
}

const DAYS: Day[] = [
  { id: "2026-10-29", short: "Thu 29 Oct", long: "Thursday, 29 October" },
  { id: "2026-10-22", short: "Thu 22 Oct", long: "Thursday, 22 October" },
  { id: "2026-10-15", short: "Thu 15 Oct", long: "Thursday, 15 October" },
  { id: "2026-10-08", short: "Thu 8 Oct", long: "Thursday, 8 October" },
]

// Oldest first; `order` is the order they were recorded in.
const RAW: [string | null, number, string, string, string?][] = [
  ["Viasna", 1, "2026-10-08", "4:12"],
  ["Viasna", 2, "2026-10-08", "4:09"],
  ["Viasna", 3, "2026-10-08", "4:07", "AI"],
  ["Viasna", 4, "2026-10-15", "4:11"],
  ["Viasna", 5, "2026-10-15", "4:06"],
  ["Viasna", 6, "2026-10-22", "4:08"],
  ["Viasna", 7, "2026-10-22", "4:03"],
  ["Viasna", 8, "2026-10-22", "4:06", "V"],
  [null, 7, "2026-10-22", "1:48"],
  ["Viasna", 9, "2026-10-29", "4:10"],
  ["Viasna", 10, "2026-10-29", "4:08"],
  ["Viasna", 11, "2026-10-29", "4:04"],
  ["Viasna", 12, "2026-10-29", "4:05", "AIV"],
  ["Pałyn", 1, "2026-10-29", "3:31"],
  ["Pałyn", 2, "2026-10-29", "3:26", "I"],
  ["Pałyn", 3, "2026-10-29", "3:24"],
  ["Kupalle", 1, "2026-10-29", "5:12"],
  ["Kupalle", 2, "2026-10-29", "5:05"],
  ["Kupalle", 3, "2026-10-29", "4:58"],
  ["Pałyn", 4, "2026-10-29", "0:41"],
]

export const uidOf = (song: string | null, n: number) => `${(song ?? "take").toLowerCase().replace("ł", "l")}-${n}`

const TAKES: Take[] = RAW.map(([song, n, day, len, stars], order) => ({
  uid: uidOf(song, n),
  song,
  n,
  day,
  order,
  len: m(len),
  stars: [...(stars ?? "")].map((l) => ({ A: "alex", I: "ira", V: "vik" })[l]!),
  atReh: song === "Viasna" && n === 12,
}))

export type State = {
  me: string
  owner: boolean
  bandName: string
  members: Member[]
  days: Day[]
  takes: Take[]
  songs: Song[]
  labels: Label[]
  statuses: string[]
  marks: Mark[]
  unheard: Set<string>
  trash: Trashed[]
  keys: Key[]
  /** A band that has just started: no takes, songs or marks yet. */
  fresh: boolean
}

let state: State = {
  me: "ira",
  owner: false,
  bandName: "",
  members: [
    { id: "alex", name: "Alex", initial: "A", email: "alex@example.com", owner: true },
    { id: "vik", name: "Vik", initial: "V", email: "vik@example.com" },
    { id: "ivan", name: "Ivan", initial: "I", email: "ivan@example.com" },
    { id: "ira", name: "Ira", initial: "I", email: "ira@example.com" },
    { id: "sasha", name: "", initial: "", email: "sasha@example.com", unconfirmed: true },
  ],
  days: DAYS,
  takes: TAKES,
  songs: [
    {
      id: "viasna",
      title: "Viasna",
      status: "Ready",
      key: "E minor",
      bpm: 120,
      notes: "Vik counts in, four clicks.\nIntro twice, then the verse.\nIra sings the second verse alone; bass comes back on the chorus.\nEnd on the last chord, Vik cuts it.",
      files: [
        { kind: "GP", name: "Viasna.gp", note: "Guitar Pro · downloads to open in Guitar Pro" },
        { kind: "PDF", name: "Viasna words.pdf", note: "PDF · opens in a new tab" },
        { kind: "JPG", name: "Chorus chords.jpg", note: "Picture · opens in a new tab" },
      ],
    },
    {
      id: "palyn",
      title: "Pałyn",
      status: "Learning",
      key: "A minor",
      bpm: 96,
      notes: "Words still change.",
      files: [{ kind: "GP", name: "Pałyn.gp", note: "Guitar Pro · downloads to open in Guitar Pro" }],
    },
    { id: "kupalle", title: "Kupalle", status: "Learning", key: "D major", bpm: 132, notes: "", files: [] },
    {
      id: "zorka",
      title: "Zorka",
      status: "Learning",
      key: "G major",
      bpm: null,
      notes: "Ivan's riff. Ira writes the words.",
      files: [{ kind: "GP", name: "Zorka riff.gp", note: "Guitar Pro · downloads to open in Guitar Pro" }],
    },
  ],
  labels: [
    { name: "Note", colour: "var(--label-grey)" },
    { name: "Keep this", colour: "var(--label-green)" },
    { name: "Went wrong", colour: "var(--label-red)" },
    { name: "Do again", colour: "var(--label-amber)" },
  ],
  statuses: ["Learning", "Ready", "Archive"],
  marks: [
    {
      id: "m1",
      take: "viasna-12",
      at: m("2:58"),
      label: 1,
      note: "This solo",
      by: "РЭХА",
      fromReha: true,
      when: "Thu 29 Oct",
      comments: [{ id: "c1", by: "ivan", when: "Thu 29 Oct", text: "Keep it. I'll start it two bars later next time." }],
    },
    {
      id: "k1",
      take: "kupalle-1",
      at: m("4:40"),
      label: 0,
      note: "The ending is long. Two bars less?",
      by: "alex",
      when: "Thu 29 Oct",
      comments: [{ id: "c2", by: "ira", when: "Fri 30 Oct", text: "Two bars less, and I hold the last word." }],
    },
    { id: "k2", take: "viasna-8", at: m("2:10"), label: 0, note: "Let's take this bit faster next time.", by: "vik", when: "Thu 22 Oct", comments: [] },
  ],
  unheard: new Set(["viasna-9", "viasna-10", "viasna-11", "viasna-12", "palyn-3", "kupalle-2", "m1", "k1"]),
  trash: [
    { uid: "kupalle-3", removed: "Fri 30 Oct", left: 28 },
    { uid: "palyn-4", removed: "Sat 31 Oct", left: 29 },
  ],
  keys: [{ id: "k1", name: "Rehearsal room" }],
  fresh: false,
}
const kept = state

const subs = new Set<() => void>()
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

/** Everything, re-read when anything changes. */
export const useData = () => useSyncExternalStore(subscribe, () => state)

export function change(f: (s: State) => Partial<State>) {
  state = { ...state, ...f(state) }
  subs.forEach((s) => s())
}

// ---- derived, as the API would hand them over ----

export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
export const inTrash = (s: State, uid: string) => s.trash.some((t) => t.uid === uid)
export const takeOf = (s: State, uid: string) => s.takes.find((t) => t.uid === uid)!
export const dayOf = (s: State, id: string) => s.days.find((d) => d.id === id)!
export const memberOf = (s: State, id: string) => s.members.find((m) => m.id === id)
export const takesOf = (s: State, title: string) => s.takes.filter((t) => t.song === title && !inTrash(s, t.uid))
export const songOf = (s: State, id: string) => s.songs.find((g) => g.id === id)!

/** Part 1's rule: most members' stars, the newest on a tie, the newest when none has any. */
export function bestOf(s: State, title: string) {
  const ts = takesOf(s, title)
  if (!ts.length) return null
  const t = [...ts].sort((a, b) => b.stars.length - a.stars.length || b.order - a.order)[0]
  return { take: t, why: t.stars.length ? "most stars" : "latest, no stars yet" }
}

export const rehearsalsOf = (s: State, title: string) => new Set(takesOf(s, title).map((t) => t.day)).size
export const lastOf = (s: State, title: string) => {
  const ts = takesOf(s, title)
  return ts.length ? dayOf(s, ts[ts.length - 1].day).short : ""
}
export const isNew = (s: State, id: string) => s.unheard.has(id)
export const songIsNew = (s: State, title: string) => takesOf(s, title).some((t) => isNew(s, t.uid))
export const marksOf = (s: State, uid: string) => s.marks.filter((k) => k.take === uid).sort((a, b) => a.at - b.at)

// ---- changes ----

export const seen = (uid: string) =>
  change((s) => {
    const u = new Set(s.unheard)
    u.delete(uid)
    s.marks.filter((k) => k.take === uid).forEach((k) => u.delete(k.id))
    return { unheard: u }
  })
export const toggleStar = (uid: string) =>
  change((s) => ({
    takes: s.takes.map((t) =>
      t.uid !== uid ? t : { ...t, stars: t.stars.includes(s.me) ? t.stars.filter((x) => x !== s.me) : [...t.stars, s.me] },
    ),
  }))
export const setSong = (id: string, part: Partial<Song>) =>
  change((s) => ({ songs: s.songs.map((g) => (g.id === id ? { ...g, ...part } : g)) }))
export const addMark = (take: string, at: number, label: number, note: string) =>
  change((s) => ({
    marks: [...s.marks, { id: `n${Date.now()}`, take, at, label, note, by: s.me, when: "Sun 1 Nov", comments: [] }],
  }))
export const addComment = (mark: string, text: string) =>
  change((s) => ({
    marks: s.marks.map((k) =>
      k.id === mark ? { ...k, comments: [...k.comments, { id: `c${Date.now()}`, by: s.me, when: "Sun 1 Nov", text }] } : k,
    ),
  }))
export const restore = (uid: string) => change((s) => ({ trash: s.trash.filter((t) => t.uid !== uid) }))
export const setFresh = (fresh: boolean) =>
  change((s) =>
    fresh
      ? { fresh, owner: true, me: "alex", bandName: "", takes: [], songs: [], marks: [], trash: [], keys: [], unheard: new Set<string>(), members: s.members.filter((m) => m.owner) }
      : { ...kept, me: s.me, owner: s.owner },
  )
export const setMarkClosed = (mark: string, closed: boolean) =>
  change((s) => ({ marks: s.marks.map((k) => (k.id === mark ? { ...k, closed } : k)) }))
