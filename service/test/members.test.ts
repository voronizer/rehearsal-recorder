import { env, exports } from "cloudflare:workers"
import { expect, test } from "vitest"
import { app } from "../worker/index"
import { MIN_REHA_VERSION, tooOld } from "../worker/shared/version"
import { OWNER, addresses, call, confirm, me, member, post, signIn, signInOwner } from "./helpers"

type Member = { id: string; email: string; name: string; confirmed: boolean; signed_in: boolean }

const members = async (owner: string) => (await (await call("/api/members", {}, owner)).json()) as Member[]

async function makeKey(owner: string, name = "Rehearsal room"): Promise<string> {
  const res = await post("/api/keys", { name }, owner)
  expect(res.status).toBe(200)
  const { key } = (await res.json()) as { key: string }
  return key
}

/** A request from РЭХА with the key as pasted, `<host>:<secret>`. */
function fromReha(path: string, key: string, version: string | null = "0.17.0") {
  const secret = key.slice(key.lastIndexOf(":") + 1)
  const headers: Record<string, string> = { "x-api-key": secret }
  if (version !== null) headers["X-Reha-Version"] = version
  return exports.default.fetch(new Request(`https://band.test${path}`, { headers }))
}

test("only the owner sees members", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")

  expect((await call("/api/members", {}, ira.cookie)).status).toBe(403)
  expect((await post("/api/members", { email: "olga@example.com" }, ira.cookie)).status).toBe(403)
  expect((await call("/api/keys", {}, ira.cookie)).status).toBe(403)
  expect((await call("/api/members")).status).toBe(401)
})

test("add member puts the address on the list", async () => {
  const owner = await signInOwner()

  const res = await post("/api/members", { email: " Ira@Example.com" }, owner)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    email: "ira@example.com",
    name: "",
    confirmed: false,
    signed_in: false,
  })
  expect((await addresses()).log).toContain("add ira@example.com")
  const row = await env.DB.prepare("SELECT role, name FROM user WHERE email = ?").bind("ira@example.com").first()
  expect(row).toEqual({ role: "user", name: "" })
})

test("the same address twice is refused", async () => {
  const owner = await signInOwner()
  expect((await post("/api/members", { email: "ira@example.com" }, owner)).status).toBe(200)

  const again = await post("/api/members", { email: "IRA@example.com " }, owner)
  expect(again.status).toBe(409)
  expect(await again.json()).toEqual({ error: "This address is already in the band" })
  expect((await post("/api/members", { email: "not an address" }, owner)).status).toBe(400)
})

test("members show who has confirmed and signed in", async () => {
  const owner = await signInOwner()
  await member(owner, "ira@example.com")
  expect((await post("/api/members", { email: "olga@example.com" }, owner)).status).toBe(200)

  const list = await members(owner)
  expect(list.map(({ email, confirmed, signed_in }) => ({ email, confirmed, signed_in }))).toEqual([
    { email: OWNER, confirmed: true, signed_in: true },
    { email: "ira@example.com", confirmed: true, signed_in: true },
    { email: "olga@example.com", confirmed: false, signed_in: false },
  ])
})

test("sign out everywhere ends every session", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  const phone = await signIn("ira@example.com")
  expect((await me(ira.cookie)).status).toBe(200)
  expect((await me(phone)).status).toBe(200)

  expect((await post(`/api/members/${ira.id}/signout`, {}, owner)).status).toBe(200)
  expect((await me(ira.cookie)).status).toBe(401)
  expect((await me(phone)).status).toBe(401)
  expect((await me(owner)).status).toBe(200)
})

test("remove ends the sessions and keeps the comments", async () => {
  const owner = await signInOwner()
  const ira = await member(owner, "ira@example.com")
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rehearsal (uid, name, date) VALUES ('r1', 'Thursday', '2026-10-30')"),
    env.DB.prepare(
      `INSERT INTO take (uid, rehearsal_uid, number, name, duration_sec, balance, tracks, notes, gen, updated_at)
       VALUES ('t1', 'r1', 1, 'Take 1', 60, '{}', '[]', '[]', 1, '2026-10-30T20:00:00.000Z')`
    ),
    env.DB.prepare(
      `INSERT INTO comment (take_uid, member_id, at, text, created_at)
       VALUES ('t1', ?, 12.5, 'Bass too loud', '2026-10-30T21:00:00.000Z')`
    ).bind(ira.id),
  ])

  const res = await call(`/api/members/${ira.id}`, { method: "DELETE" }, owner)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect((await me(ira.cookie)).status).toBe(401)
  expect((await addresses()).list["ira@example.com"]).toBeUndefined()
  expect((await members(owner)).map((m) => m.email)).toEqual([OWNER])
  const kept = await env.DB.prepare("SELECT member_id, text FROM comment").first()
  expect(kept).toEqual({ member_id: ira.id, text: "Bass too loud" })

  // Added again, the same member comes back with their comments.
  expect((await post("/api/members", { email: "ira@example.com" }, owner)).status).toBe(200)
  await confirm("ira@example.com")
  expect((await members(owner)).map((m) => m.id)).toContain(ira.id)
})

test("the owner cannot be removed", async () => {
  const owner = await signInOwner()
  const id = (await members(owner))[0].id

  const removed = await call(`/api/members/${id}`, { method: "DELETE" }, owner)
  expect(removed.status).toBe(400)
  expect(await removed.json()).toEqual({ error: "The owner cannot be removed" })
  const signedOut = await post(`/api/members/${id}/signout`, {}, owner)
  expect(signedOut.status).toBe(400)
  expect(await signedOut.json()).toEqual({ error: "The owner cannot be signed out from here" })
  expect((await me(owner)).status).toBe(200)
})

test("a key is shown once and works for /api/reha/hello", async () => {
  const owner = await signInOwner()
  const key = await makeKey(owner)
  expect(key).toMatch(/^band\.test:[A-Za-z]+$/)

  const listed = await (await call("/api/keys", {}, owner)).json()
  expect(listed).toEqual([{ id: expect.any(String), name: "Rehearsal room", created_at: expect.any(String) }])
  expect(JSON.stringify(listed)).not.toContain(key.split(":")[1])

  const res = await fromReha("/api/reha/hello", key)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect((await fromReha("/api/reha/hello", "band.test:nonsense")).status).toBe(401)
})

test("a key is not limited", async () => {
  const owner = await signInOwner()
  const key = await makeKey(owner)

  for (let i = 0; i < 30; i++) expect((await fromReha("/api/reha/hello", key)).status).toBe(200)
})

test("a removed key no longer works", async () => {
  const owner = await signInOwner()
  const key = await makeKey(owner)
  const [{ id }] = (await (await call("/api/keys", {}, owner)).json()) as { id: string }[]

  expect((await call(`/api/keys/${id}`, { method: "DELETE" }, owner)).status).toBe(200)
  expect((await fromReha("/api/reha/hello", key)).status).toBe(401)
  expect(await (await call("/api/keys", {}, owner)).json()).toEqual([])
})

test("a request with no version is told to update", async () => {
  const owner = await signInOwner()
  const key = await makeKey(owner)

  const res = await fromReha("/api/reha/hello", key, null)
  expect(res.status).toBe(426)
  expect(await res.json()).toEqual({ error: "Update РЭХА to send takes here" })
})

test("versions compare by their release", () => {
  expect(tooOld("0.16.1", "0.17.0")).toBe(true)
  expect(tooOld("0.17.0", "0.17.0")).toBe(false)
  expect(tooOld("0.17.1.dev4+gabc", "0.17.1")).toBe(false)
  expect(tooOld("0.9.0", "0.10.0")).toBe(true)
  expect(tooOld("unknown", "0.17.0")).toBe(false)
  expect(tooOld(undefined, MIN_REHA_VERSION)).toBe(true)
  expect(tooOld("0.0.1", MIN_REHA_VERSION)).toBe(false)
})

test("stand-in routes are not there without STAND_INS", async () => {
  const res = await app.fetch(
    new Request("https://band.test/api/stand-ins/letters"),
    { ...env, STAND_INS: undefined },
    { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
  )
  expect(res.status).toBe(404)
  expect((await call("/api/stand-ins/letters")).status).toBe(200)
})
