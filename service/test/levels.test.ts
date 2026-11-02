import { expect, test } from "vitest"
import { answer, call, member, put, signInOwner } from "./helpers"

const levelsOf = async (cookie: string) => (await answer(call("/api/me/levels", {}, cookie))).body

test("a member's levels are theirs only", async () => {
  const owner = await signInOwner()
  const ira = (await member(owner, "ira@example.com")).cookie
  const vik = (await member(owner, "vik@example.com")).cookie
  expect(await levelsOf(ira)).toEqual({ levels: {} })

  expect(await answer(put("/api/me/levels", { levels: { Vocals: 1, Guitar: 0.4 } }, ira))).toEqual({
    status: 200,
    body: { levels: { Vocals: 1, Guitar: 0.4 } },
  })
  expect(await levelsOf(ira)).toEqual({ levels: { Vocals: 1, Guitar: 0.4 } })
  expect(await levelsOf(vik)).toEqual({ levels: {} })
})

test("a level written again is the last one, and null forgets it", async () => {
  const owner = await signInOwner()
  expect((await put("/api/me/levels", { levels: { Bass: 0.5, Drums: 0.8 } }, owner)).status).toBe(200)
  expect((await put("/api/me/levels", { levels: { Bass: 0.7 } }, owner)).status).toBe(200)
  expect(await levelsOf(owner)).toEqual({ levels: { Bass: 0.7, Drums: 0.8 } })

  expect(await answer(put("/api/me/levels", { levels: { Bass: null, Keys: null } }, owner))).toEqual({
    status: 200,
    body: { levels: { Drums: 0.8 } },
  })
})

test("a level is from 0 to 1, for a track with a name", async () => {
  const owner = await signInOwner()
  expect((await put("/api/me/levels", { levels: { Bass: 1.5 } }, owner)).status).toBe(400)
  expect((await put("/api/me/levels", { levels: { Bass: -0.1 } }, owner)).status).toBe(400)
  expect((await put("/api/me/levels", { levels: { "": 0.5 } }, owner)).status).toBe(400)
  const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`Track ${i}`, 0.5]))
  expect((await put("/api/me/levels", { levels: many }, owner)).status).toBe(400)
  expect((await put("/api/me/levels", { levels: { Bass: 0 } }, owner)).status).toBe(200)
  expect(await levelsOf(owner)).toEqual({ levels: { Bass: 0 } })
})

test("64 levels are kept in one go", async () => {
  const owner = await signInOwner()
  const many = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`Track ${i}`, i / 64]))
  expect((await put("/api/me/levels", { levels: many }, owner)).status).toBe(200)
  expect(await levelsOf(owner)).toEqual({ levels: many })
  const gone = Object.fromEntries(Object.keys(many).map((t) => [t, null]))
  expect(await answer(put("/api/me/levels", { levels: gone }, owner))).toEqual({ status: 200, body: { levels: {} } })
})

test("levels need a member signed in", async () => {
  expect((await call("/api/me/levels")).status).toBe(401)
  expect((await put("/api/me/levels", { levels: { Bass: 0.5 } })).status).toBe(401)
})
