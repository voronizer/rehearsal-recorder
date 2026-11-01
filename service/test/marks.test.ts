import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { putTake, trash } from "../worker/takes/store"
import {
  answer,
  commentOn,
  del,
  labelsOf,
  markAt,
  member,
  named,
  open,
  patch,
  post,
  read,
  reha,
  shownTake,
  signInOwner,
  takeMeta,
  TAKE,
} from "./helpers"

const bindings = env as unknown as Bindings

type Mark = {
  id: number
  at: number
  label_id: number
  note: string
  author: string | null
  from_reha: boolean
  closed: boolean
  mine: boolean
  is_new: boolean
  take: { uid: string; name: string; song_title: string | null }
  comments: { id: number; author: string; text: string; mine: boolean }[]
}

const takePage = (cookie: string, uid: string) => read<{ marks: Mark[] }>(`/api/takes/${uid}`, cookie)

async function band() {
  const owner = await signInOwner()
  await named(owner, "Alex")
  const ira = await member(owner, "ira@example.com")
  await named(ira.cookie, "Ira")
  const ivan = await member(owner, "ivan@example.com")
  await named(ivan.cookie, "Ivan")
  return { owner, ira: ira.cookie, ivan: ivan.cookie }
}

test("a mark goes at a moment with a label and a note; the first label when none is said", async () => {
  const { owner, ira } = await band()
  const uid = await shownTake({ duration_sec: 300 })
  const labels = await labelsOf(owner)
  await markAt(ira, uid, 102, "The bridge drags here")
  await markAt(ira, uid, 178, "", labels[1].id)

  const marks = (await takePage(owner, uid)).marks
  expect(marks.map((m) => [m.at, m.label_id, m.note, m.author, m.from_reha, m.mine])).toEqual([
    [102, labels[0].id, "The bridge drags here", "Ira", false, false],
    [178, labels[1].id, "", "Ira", false, false],
  ])
  expect((await takePage(ira, uid)).marks.every((m) => m.mine)).toBe(true)

  for (const bad of [
    { at: 301, note: "Past the end" },
    { at: -1, note: "Before the start" },
    { at: 1, note: "x".repeat(2001) },
    { at: 1, note: "No such label", label_id: 9999 },
  ])
    expect((await post(`/api/takes/${uid}/marks`, bad, ira)).status).toBe(400)
})

test("only who set a mark edits or deletes it, the owner too; anyone closes it", async () => {
  const { owner, ira, ivan } = await band()
  const uid = await shownTake()
  const labels = await labelsOf(owner)
  const mark = await markAt(ira, uid, 42, "Too fast")
  await commentOn(ivan, mark.id, "Agreed")

  for (const who of [owner, ivan]) {
    const edit = await answer(patch(`/api/marks/${mark.id}`, { note: "Mine now" }, who))
    expect(edit).toEqual({ status: 403, body: { error: "Only who wrote it can change it" } })
    expect((await del(`/api/marks/${mark.id}`, who)).status).toBe(403)
  }
  expect((await patch(`/api/marks/${mark.id}`, { closed: true }, ivan)).status).toBe(200)
  expect((await takePage(owner, uid)).marks[0]).toMatchObject({ closed: true, note: "Too fast" })
  expect((await patch(`/api/marks/${mark.id}`, { closed: false }, owner)).status).toBe(200)

  expect((await patch(`/api/marks/${mark.id}`, { note: "Much too fast", label_id: labels[2].id }, ira)).status).toBe(200)
  expect((await takePage(owner, uid)).marks[0]).toMatchObject({ note: "Much too fast", label_id: labels[2].id, closed: false })

  // Deleting a mark takes its comments.
  expect((await del(`/api/marks/${mark.id}`, ira)).status).toBe(200)
  expect((await takePage(owner, uid)).marks).toEqual([])
  expect((await env.DB.prepare("SELECT count(*) AS n FROM comment").first<{ n: number }>())!.n).toBe(0)
})

test("a mark from REHA follows REHA: nobody edits or deletes it, anyone closes it", async () => {
  const { owner } = await band()
  const r = await reha()
  const marks = [{ at: 10, label: "Keep this", colour: "green", note: "This solo" }]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ marks }))).status).toBe(200)
  expect((await r.post(`/api/reha/takes/${TAKE}/ready`, { gen: 1, what: "mp3" })).status).toBe(200)
  const [mark] = (await takePage(owner, TAKE)).marks
  expect(mark).toMatchObject({ author: null, from_reha: true, mine: false, note: "This solo" })

  const edit = await answer(patch(`/api/marks/${mark.id}`, { note: "Mine" }, owner))
  expect(edit).toEqual({ status: 403, body: { error: "A mark from РЭХА follows РЭХА" } })
  expect((await del(`/api/marks/${mark.id}`, owner)).status).toBe(403)
  expect((await patch(`/api/marks/${mark.id}`, { closed: true }, owner)).status).toBe(200)
})

test("comments under a mark: added by anyone, changed and deleted by who wrote them", async () => {
  const { owner, ira, ivan } = await band()
  const uid = await shownTake()
  const mark = await markAt(ira, uid, 42, "Too fast")
  const said = await commentOn(ivan, mark.id, "Keep it. I'll start it two bars later.")
  await commentOn(owner, mark.id, "Two bars it is")

  const page = await takePage(ivan, uid)
  expect(page.marks[0].comments.map((c) => [c.author, c.text, c.mine])).toEqual([
    ["Ivan", "Keep it. I'll start it two bars later.", true],
    ["Alex", "Two bars it is", false],
  ])
  expect((await patch(`/api/comments/${said.id}`, { text: "Mine" }, owner)).status).toBe(403)
  expect((await del(`/api/comments/${said.id}`, ira)).status).toBe(403)
  expect((await patch(`/api/comments/${said.id}`, { text: "Keep it." }, ivan)).status).toBe(200)
  expect((await takePage(owner, uid)).marks[0].comments[0].text).toBe("Keep it.")
  expect((await del(`/api/comments/${said.id}`, ivan)).status).toBe(200)
  expect((await takePage(owner, uid)).marks[0].comments.map((c) => c.text)).toEqual(["Two bars it is"])

  expect((await post(`/api/marks/${mark.id}/comments`, { text: "  " }, ivan)).status).toBe(400)
  // A comment is not a mark, and a mark is not a comment.
  expect((await patch(`/api/marks/${said.id}`, { closed: true }, ivan)).status).toBe(404)
  expect((await patch(`/api/comments/${mark.id}`, { text: "x" }, ira)).status).toBe(404)
})

test("a mark set or commented on after you heard its take is new until you open it again", async () => {
  const { owner, ira, ivan } = await band()
  const uid = await shownTake()
  const early = await markAt(ira, uid, 10, "Before Alex heard it")
  await open(owner, uid)
  expect((await takePage(owner, uid)).marks.map((m) => m.is_new)).toEqual([false])

  const late = await markAt(ira, uid, 20, "After")
  await commentOn(ivan, early.id, "Agreed")
  await markAt(owner, uid, 30, "My own")
  const marks = (await takePage(owner, uid)).marks
  expect(marks.map((m) => [m.note, m.is_new])).toEqual([
    ["Before Alex heard it", true],
    ["After", true],
    ["My own", false],
  ])
  expect(late.id).toBeGreaterThan(early.id)

  await open(owner, uid)
  expect((await takePage(owner, uid)).marks.map((m) => m.is_new)).toEqual([false, false, false])
})

test("the Marks section lists open, closed or all, with their counts and takes", async () => {
  const { owner, ira } = await band()
  const one = await shownTake({ number: 1, name: "Viasna 1" })
  const two = await shownTake({ song: "Pałyn", number: 2, name: "Pałyn 2" })
  const gone = await shownTake({ number: 3, name: "Viasna 3" })
  const a = await markAt(ira, one, 10, "Open one")
  const b = await markAt(ira, two, 20, "Closed one")
  await markAt(ira, gone, 5, "In the trash")
  await trash(bindings, gone)
  await patch(`/api/marks/${b.id}`, { closed: true }, owner)

  type List = { counts: { open: number; closed: number; all: number }; marks: Mark[] }
  const open = await read<List>("/api/marks?show=open", owner)
  expect(open.counts).toEqual({ open: 1, closed: 1, all: 2 })
  expect(open.marks.map((m) => [m.id, m.take.name, m.take.song_title])).toEqual([[a.id, "Viasna 1", "Viasna"]])
  expect((await read<List>("/api/marks?show=closed", owner)).marks.map((m) => m.id)).toEqual([b.id])
  expect((await read<List>("/api/marks?show=all", owner)).marks.length).toBe(2)
})

test("marks on a take not shown yet cannot be set", async () => {
  const { ira } = await band()
  await putTake(bindings, TAKE, takeMeta() as never)
  expect((await post(`/api/takes/${TAKE}/marks`, { at: 1, note: "x" }, ira)).status).toBe(404)
})
