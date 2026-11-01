import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { trash } from "../worker/takes/store"
import {
  answer,
  call,
  commentOn,
  makeKey,
  markAt,
  member,
  named,
  open,
  patch,
  put,
  read,
  shownTake,
  signInOwner,
  starIt,
} from "./helpers"

const bindings = env as unknown as Bindings

type TakeRow = { uid: string; name: string; is_new: boolean; marks: { at: number }[] }
type Home = {
  unheard: number
  new_marks: number
  songs: { title: string; takes: number; last_date: string; unheard: string[]; best: TakeRow }[]
  latest_marks: { note: string; closed: boolean; comments: { text: string }[] }[]
  favourites: TakeRow[]
  steps: { named: boolean; key: boolean; members: boolean; rehearsal: boolean } | null
}

const home = (cookie: string) => read<Home>("/api/home", cookie)

test("before anything arrives, the owner's Home lists four steps, a member's none", async () => {
  const owner = await signInOwner()
  expect((await home(owner)).steps).toEqual({ named: false, key: false, members: false, rehearsal: false })
  expect((await put("/api/band", { name: "Pałac" }, owner)).status).toBe(200)
  await makeKey(owner)
  const ira = await member(owner, "ira@example.com")
  expect((await home(owner)).steps).toEqual({ named: true, key: true, members: true, rehearsal: false })
  expect((await home(ira.cookie)).steps).toBeNull()
  await shownTake()
  expect((await home(owner)).steps).toBeNull()
})

test("Home: what you have not heard, songs most recently played first, latest marks, favourites", async () => {
  const owner = await signInOwner()
  await named(owner, "Alex")
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  const old = await shownTake({ number: 1, name: "Viasna 1", date: "2025-10-23" })
  const v2 = await shownTake({ number: 2, name: "Viasna 2", date: "2025-10-30" })
  const v3 = await shownTake({ number: 3, name: "Viasna 3", date: "2025-10-30" })
  const p1 = await shownTake({ song: "Pałyn", number: 1, name: "Pałyn 1", date: "2025-10-23" })
  const gone = await shownTake({ song: "Kupalle", number: 1, name: "Kupalle 1", date: "2025-11-06" })
  await trash(bindings, gone)
  await open(owner, old)
  await open(owner, p1)
  await starIt(owner, v2)
  await starIt(ira.cookie, v2)
  await starIt(ira.cookie, v3)

  const marks = []
  for (let i = 1; i <= 6; i++) marks.push(await markAt(ira.cookie, old, i * 10, `Mark ${i}`))
  await commentOn(owner, marks[0].id, "Latest word")
  await patch(`/api/marks/${marks[1].id}`, { closed: true }, owner)

  const h = await home(owner)
  expect(h.unheard).toBe(2)
  expect(h.new_marks).toBe(6)
  expect(h.songs.map((s) => [s.title, s.takes, s.last_date, s.unheard])).toEqual([
    ["Viasna", 3, "2025-10-30", [v2, v3]],
    ["Pałyn", 1, "2025-10-23", []],
  ])
  expect(h.songs[0].best.uid).toBe(v2)
  expect(h.latest_marks.map((m) => [m.note, m.closed])).toEqual([
    ["Mark 1", false],
    ["Mark 6", false],
    ["Mark 5", false],
    ["Mark 4", false],
    ["Mark 3", false],
  ])
  expect(h.latest_marks[0].comments.map((c) => c.text)).toEqual(["Latest word"])
  expect(h.favourites.map((t) => t.uid)).toEqual([v2])

  await open(owner, old)
  expect((await home(owner)).new_marks).toBe(0)
})

test("Rehearsals: newest first, each with its songs, its takes as bars, stars and marks", async () => {
  const owner = await signInOwner()
  const a = await shownTake({ number: 1, name: "Viasna 1", date: "2025-10-23", duration_sec: 200 })
  const b = await shownTake({ number: 2, name: "Viasna 2", date: "2025-10-30", duration_sec: 210 })
  const c = await shownTake({ song: null, number: 3, name: "Take 3", date: "2025-10-30", duration_sec: 30 })
  await starIt(owner, b)
  await markAt(owner, a, 10, "Count-in")
  await open(owner, a)

  type Rehearsal = {
    uid: string
    date: string
    songs: string[]
    not_named: boolean
    takes: { uid: string; duration_sec: number; starred: boolean }[]
    starred: number
    marks: number
    has_new: boolean
  }
  const list = await read<Rehearsal[]>("/api/rehearsals", owner)
  expect(list.map((r) => [r.date, r.songs, r.not_named, r.takes.map((t) => [t.uid, t.starred]), r.starred, r.marks, r.has_new])).toEqual([
    ["2025-10-30", ["Viasna"], true, [[b, true], [c, false]], 1, 0, true],
    ["2025-10-23", ["Viasna"], false, [[a, false]], 0, 1, false],
  ])

  const page = await read<{ rehearsal: { date: string }; takes: TakeRow[] }>(`/api/rehearsals/${list[1].uid}`, owner)
  expect(page.rehearsal.date).toBe("2025-10-23")
  expect(page.takes.map((t) => [t.name, t.marks.map((m) => m.at)])).toEqual([["Viasna 1", [10]]])
  expect((await call(`/api/rehearsals/${crypto.randomUUID()}`, {}, owner)).status).toBe(404)
})

test("the band's name and picture: Alex sets them, the sign-in page shows them", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  expect((await put("/api/band", { name: "Pałac" }, ira.cookie)).status).toBe(403)
  expect((await put("/api/band", { name: " Pałac " }, owner)).status).toBe(200)

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const picture = (cookie: string, type: string, body: Uint8Array<ArrayBuffer>) =>
    call("/api/band/picture", { method: "PUT", body, headers: { "Content-Type": type } }, cookie)
  expect((await picture(ira.cookie, "image/png", png)).status).toBe(403)
  expect(await answer(picture(owner, "image/gif", png))).toEqual({
    status: 400,
    body: { error: "A picture is PNG, JPEG or WebP, up to 5 MB" },
  })
  expect((await picture(owner, "image/png", new Uint8Array(5 * 1024 * 1024 + 1))).status).toBe(413)
  expect((await picture(owner, "image/png", png)).status).toBe(200)

  // Before signing in: the card shows the band's name and picture.
  const band = await read<{ name: string; picture: string | null }>("/api/band")
  expect(band.name).toBe("Pałac")
  const shown = await call(band.picture!)
  expect(shown.status).toBe(200)
  expect(shown.headers.get("Content-Type")).toBe("image/png")
  expect(new Uint8Array(await shown.arrayBuffer())).toEqual(png)

  expect((await call("/api/band/picture", { method: "DELETE" }, owner)).status).toBe(200)
  expect((await read<{ picture: string | null }>("/api/band")).picture).toBeNull()
})

test("the frame: how many members, open marks, and the longest take", async () => {
  const owner = await signInOwner()
  await named(owner, "Alex")
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  // Added, but not signed in with a name yet: not counted, as People does not show them.
  await member(owner, "ivan@example.com")
  const uid = await shownTake({ duration_sec: 312 })
  await shownTake({ number: 2, name: "Viasna 2", duration_sec: 100 })
  const m = await markAt(ira.cookie, uid, 10, "x")
  await markAt(ira.cookie, uid, 20, "y")
  await patch(`/api/marks/${m.id}`, { closed: true }, owner)
  expect(await read("/api/frame", ira.cookie)).toEqual({
    name: "",
    picture: null,
    members: 2,
    open_marks: 1,
    longest: 312,
    has_takes: true,
  })
})

test("every member sees the band's people by name; addresses stay the owner's", async () => {
  const owner = await signInOwner()
  await named(owner, "Alex")
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  await member(owner, "ivan@example.com")
  await call("/api/members", { method: "POST", body: JSON.stringify({ email: "vik@example.com" }) }, owner)

  const people = await read<{ name: string; initial: string; me: boolean; owner: boolean }[]>("/api/people", ira.cookie)
  expect(people).toEqual([
    { id: expect.any(String), name: "Alex", initial: "A", me: false, owner: true },
    { id: expect.any(String), name: "Ira", initial: "I", me: true, owner: false },
  ])
  expect(JSON.stringify(people)).not.toContain("@")
  expect((await call("/api/members", {}, ira.cookie)).status).toBe(403)
})
