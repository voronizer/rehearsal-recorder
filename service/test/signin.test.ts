import { env } from "cloudflare:workers"
import { expect, test, vi } from "vitest"
import {
  OWNER,
  addresses,
  call,
  codeFor,
  confirm,
  letters,
  me,
  member,
  post,
  sendCode,
  sessionCookie,
  signIn,
  signInOwner,
  signInWith,
} from "./helpers"

const CONFIRM_FIRST = "First confirm your address: look for a letter from Cloudflare, then press Send code again"
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const userRow = (email: string) =>
  env.DB.prepare("SELECT id, name, role, banned FROM user WHERE email = ?")
    .bind(email)
    .first<{ id: string; name: string; role: string; banned: number }>()

test("the owner's first code makes the owner", async () => {
  expect(await userRow(OWNER)).toBeNull()

  const first = await sendCode(OWNER)
  expect(first.status).toBe(400)
  expect(await first.json()).toMatchObject({ code: "CONFIRM_FIRST", message: CONFIRM_FIRST })
  expect(await userRow(OWNER)).toMatchObject({ role: "admin", name: "" })
  expect((await addresses()).log).toEqual([`remove ${OWNER}`, `add ${OWNER}`])

  await confirm(OWNER)
  expect((await sendCode(OWNER)).status).toBe(200)
  const res = await signInWith(OWNER, await codeFor(OWNER))
  expect(res.status).toBe(200)
  expect(await (await me(sessionCookie(res))).json()).toMatchObject({ name: "", owner: true })
})

test("a member gets a code and signs in", async () => {
  const owner = await signInOwner()
  expect((await post("/api/members", { email: "ira@example.com" }, owner)).status).toBe(200)
  await confirm("ira@example.com")

  const sent = await sendCode("ira@example.com")
  expect(sent.status).toBe(200)
  expect(await sent.json()).toEqual({ success: true })
  const letter = (await letters()).find((l) => l.to === "ira@example.com")!
  expect(letter.subject).toMatch(/^\d{6} is your code for band\.test$/)
  const code = await codeFor("ira@example.com")
  expect(letter.text).toBe(
    `Your code is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, you can ignore this letter.`
  )

  const res = await signInWith("ira@example.com", code)
  expect(res.status).toBe(200)
  const cookie = sessionCookie(res)
  expect(await (await me(cookie)).json()).toMatchObject({ name: "", owner: false })
})

test("an address not in the band gets the same answer and no letter", async () => {
  await signInOwner()
  const before = (await letters()).length

  const res = await sendCode("nobody@example.com")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ success: true })
  expect((await letters()).length).toBe(before)
  expect(await userRow("nobody@example.com")).toBeNull()
})

test("an address is the same whatever its case", async () => {
  const owner = await signInOwner()
  expect((await post("/api/members", { email: "ira@gmail.com" }, owner)).status).toBe(200)
  await confirm("ira@gmail.com")

  expect((await sendCode(" Ira@Gmail.com ")).status).toBe(200)
  const code = await codeFor("ira@gmail.com")
  const res = await signInWith(" IRA@gmail.com ", code)
  expect(res.status).toBe(200)
  expect((await me(sessionCookie(res))).status).toBe(200)
  expect(Object.keys((await addresses()).list).sort()).toEqual([OWNER, "ira@gmail.com"])
})

test("an unconfirmed address is told to confirm first", async () => {
  const owner = await signInOwner()
  expect((await post("/api/members", { email: "ira@example.com" }, owner)).status).toBe(200)
  const logBefore = (await addresses()).log.length

  const res = await sendCode("ira@example.com")
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ code: "CONFIRM_FIRST", message: CONFIRM_FIRST })
  expect((await addresses()).log.slice(logBefore)).toEqual(["remove ira@example.com", "add ira@example.com"])
  expect((await letters()).filter((l) => l.to === "ira@example.com")).toEqual([])
})

test("a code runs out after 10 minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2026-11-02T18:00:00Z")
  vi.setSystemTime(start)
  await confirm(OWNER)
  expect((await sendCode(OWNER)).status).toBe(200)
  const code = await codeFor(OWNER)

  vi.setSystemTime(new Date(start.getTime() + 10 * MINUTE + 1000))
  const res = await signInWith(OWNER, code)
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ code: "OTP_EXPIRED" })
})

test("five wrong codes kill it", async () => {
  await confirm(OWNER)
  expect((await sendCode(OWNER)).status).toBe(200)
  const code = await codeFor(OWNER)
  const wrong = code === "000000" ? "111111" : "000000"

  for (let i = 0; i < 5; i++) expect((await signInWith(OWNER, wrong)).status).toBe(400)
  const res = await signInWith(OWNER, code)
  expect(res.status).toBe(403)
  expect(await res.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" })
})

test("a newer code replaces the older", async () => {
  await confirm(OWNER)
  expect((await sendCode(OWNER)).status).toBe(200)
  const older = await codeFor(OWNER)
  let newer = older
  // Two codes in a row can match by chance; ask again until they differ.
  while (newer === older) {
    expect((await sendCode(OWNER)).status).toBe(200)
    newer = await codeFor(OWNER)
  }

  expect((await signInWith(OWNER, older)).status).toBe(400)
  expect((await signInWith(OWNER, newer)).status).toBe(200)
})

test("the session moves on with a visit a day later", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2026-11-02T18:00:00Z")
  vi.setSystemTime(start)
  const cookie = await signInOwner()
  const expiry = () =>
    env.DB.prepare("SELECT expires_at FROM session").first<{ expires_at: number }>()
  expect((await expiry())!.expires_at).toBe(start.getTime() + 365 * DAY)

  const visit = new Date(start.getTime() + DAY + MINUTE)
  vi.setSystemTime(visit)
  const res = await me(cookie)
  expect(res.status).toBe(200)
  expect((await expiry())!.expires_at).toBe(visit.getTime() + 365 * DAY)
  // The browser is told too, or it would drop the cookie a year after sign-in.
  const again = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-better-auth.session_token="))
  expect(again).toMatch(/Max-Age=31536000/)
})

test("a banned member gets no code", async () => {
  const owner = await signInOwner()
  const { id } = (await (await post("/api/members", { email: "ira@example.com" }, owner)).json()) as {
    id: string
  }
  await confirm("ira@example.com")
  expect((await call(`/api/members/${id}`, { method: "DELETE" }, owner)).status).toBe(200)
  await confirm("ira@example.com")

  const res = await sendCode("ira@example.com")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ success: true })
  expect((await letters()).filter((l) => l.to === "ira@example.com")).toEqual([])
  expect(await userRow("ira@example.com")).toMatchObject({ banned: 1 })
})

test("a member's name is 1 to 40 characters", async () => {
  const cookie = await signIn(OWNER)
  expect((await call("/api/me", { method: "PUT", body: JSON.stringify({ name: "   " }) }, cookie)).status).toBe(400)
  expect(
    (await call("/api/me", { method: "PUT", body: JSON.stringify({ name: "x".repeat(41) }) }, cookie)).status
  ).toBe(400)
  expect((await call("/api/me", { method: "PUT", body: JSON.stringify({ name: "  Alex " }) }, cookie)).status).toBe(
    200
  )
  expect(await (await me(cookie)).json()).toMatchObject({ name: "Alex", owner: true })
  expect((await me()).status).toBe(401)
})

test("a service missing its settings says which, and lets nobody in", async () => {
  const { app } = await import("../worker/index")
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} }
  const res = await app.request(
    "/api/auth/email-otp/send-verification-otp",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: OWNER, type: "sign-in" }) },
    { ...env, OWNER_EMAIL: "", LETTERS_FROM: " " },
    ctx as never
  )
  expect(res.status).toBe(500)
  expect(await res.json()).toEqual({
    error: "The band service is not set up yet: its settings lack OWNER_EMAIL and LETTERS_FROM.",
  })
  expect(await letters()).toEqual([])
})

test("better-auth's own routes for keys, admin and passwords are not open", async () => {
  const owner = await signInOwner()
  const { id, cookie } = await member(owner, "vera@example.com")
  const tries: [string, unknown][] = [
    ["/api/auth/api-key/create", { name: "Mine" }],
    ["/api/auth/api-key/list", undefined],
    ["/api/auth/admin/set-role", { userId: id, role: "admin" }],
    ["/api/auth/admin/unban-user", { userId: id }],
    ["/api/auth/admin/list-users", undefined],
    ["/api/auth/sign-up/email", { email: "eve@example.com", password: "a-long-password", name: "Eve" }],
    ["/api/auth/sign-in/email", { email: OWNER, password: "a-long-password" }],
    ["/api/auth/change-email", { newEmail: "eve@example.com" }],
  ]
  for (const who of [owner, cookie])
    for (const [path, body] of tries) {
      const res = body === undefined ? await call(path, {}, who) : await post(path, body, who)
      expect(res.status, path).toBe(404)
    }
  expect(await (await call("/api/keys", {}, owner)).json()).toEqual([])
  expect(await userRow("vera@example.com")).toMatchObject({ role: "user" })
})
