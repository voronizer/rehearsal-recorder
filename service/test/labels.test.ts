import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import { answer, call, del, labelsOf, markAt, member, patch, post, reha, shownTake, signInOwner, takeMeta, TAKE } from "./helpers"

const put = (path: string, body: unknown, cookie: string) => call(path, { method: "PUT", body: JSON.stringify(body) }, cookie)

test("the band starts with REHA's four labels, and any member changes them", async () => {
  const owner = await signInOwner()
  const ira = (await member(owner, "ira@example.com")).cookie
  expect((await labelsOf(ira)).map((l) => [l.name, l.colour, l.marks])).toEqual([
    ["Note", "grey", 0],
    ["Keep this", "green", 0],
    ["Went wrong", "red", 0],
    ["Do again", "amber", 0],
  ])

  const made = await answer(post("/api/labels", { name: "Tempo", colour: "teal" }, ira))
  expect(made.status).toBe(200)
  expect(made.body).toMatchObject({ name: "Tempo", colour: "teal", position: 4 })
  expect(await answer(post("/api/labels", { name: "tempo", colour: "red" }, ira))).toEqual({
    status: 409,
    body: { error: "There is already a label called “Tempo”." },
  })
  expect((await post("/api/labels", { name: "Odd", colour: "orange" }, ira)).status).toBe(400)
  expect((await post("/api/labels", { name: " ", colour: "grey" }, ira)).status).toBe(400)

  expect((await patch(`/api/labels/${made.body.id}`, { colour: "violet" }, ira)).status).toBe(200)
  expect((await labelsOf(ira)).at(-1)).toMatchObject({ name: "Tempo", colour: "violet" })
})

test("a renamed label keeps its old names for the marks REHA still sends", async () => {
  const owner = await signInOwner()
  const keep = (await labelsOf(owner))[1]
  expect((await patch(`/api/labels/${keep.id}`, { name: "Good" }, owner)).status).toBe(200)
  expect((await patch(`/api/labels/${keep.id}`, { name: "Great" }, owner)).status).toBe(200)
  expect((await patch(`/api/labels/${keep.id}`, { name: "Note" }, owner)).status).toBe(409)

  const r = await reha()
  const marks = [
    { at: 10, label: "Keep this", colour: "green", note: "One" },
    { at: 20, label: "Good", colour: "green", note: "Two" },
  ]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ marks }))).status).toBe(200)
  const labels = await labelsOf(owner)
  expect(labels.map((l) => l.name)).toEqual(["Note", "Great", "Went wrong", "Do again"])
  expect(labels[1].marks).toBe(2)
})

test("labels go in the order given; the order must name every label once", async () => {
  const owner = await signInOwner()
  const ids = (await labelsOf(owner)).map((l) => l.id)
  expect((await put("/api/labels/order", { ids: [ids[3], ids[0], ids[1], ids[2]] }, owner)).status).toBe(200)
  expect((await labelsOf(owner)).map((l) => l.name)).toEqual(["Do again", "Note", "Keep this", "Went wrong"])
  expect((await put("/api/labels/order", { ids: [ids[0], ids[1]] }, owner)).status).toBe(400)
  expect((await put("/api/labels/order", { ids: [ids[0], ids[0], ids[1], ids[2]] }, owner)).status).toBe(400)
})

test("deleting a label with marks says which label they get; the last label stays", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  const [note, keep, wrong, again] = await labelsOf(owner)
  await markAt(owner, uid, 10, "Fix the count-in", wrong.id)

  expect(await answer(del(`/api/labels/${wrong.id}`, owner))).toEqual({
    status: 400,
    body: { error: "Say which label its marks get" },
  })
  expect((await del(`/api/labels/${wrong.id}`, owner, { to: wrong.id })).status).toBe(400)
  expect((await del(`/api/labels/${wrong.id}`, owner, { to: again.id })).status).toBe(200)
  const after = await labelsOf(owner)
  expect(after.map((l) => [l.name, l.position, l.marks])).toEqual([
    ["Note", 0, 0],
    ["Keep this", 1, 0],
    ["Do again", 2, 1],
  ])
  // The name it had now finds the label its marks went to.
  const r = await reha()
  const marks = [{ at: 10, label: "Went wrong", colour: "red", note: "Late" }]
  expect((await r.put(`/api/reha/takes/${TAKE}`, takeMeta({ marks }))).status).toBe(200)
  expect((await labelsOf(owner)).length).toBe(3)

  expect((await del(`/api/labels/${keep.id}`, owner)).status).toBe(200)
  expect((await del(`/api/labels/${note.id}`, owner, { to: again.id })).status).toBe(200)
  const last = await answer(del(`/api/labels/${again.id}`, owner, { to: again.id }))
  expect(last).toEqual({ status: 400, body: { error: "The band needs at least one label" } })
  const rows = await env.DB.prepare("SELECT count(*) AS n FROM comment WHERE label_id IS NULL AND parent_id IS NULL").first<{ n: number }>()
  expect(rows!.n).toBe(0)
})

test("a name in any case clashes, in any alphabet, whether new or renamed", async () => {
  const owner = await signInOwner()
  const made = (await answer(post("/api/labels", { name: "Ціха", colour: "teal" }, owner))).body
  expect((await post("/api/labels", { name: "ЦІХА", colour: "red" }, owner)).status).toBe(409)
  const other = (await answer(post("/api/labels", { name: "Loud", colour: "red" }, owner))).body
  expect(await answer(patch(`/api/labels/${other.id}`, { name: "ціха" }, owner))).toEqual({
    status: 409,
    body: { error: "There is already a label called “Ціха”." },
  })
  expect(made.name).toBe("Ціха")
})
