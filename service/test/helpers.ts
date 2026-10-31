import { exports } from "cloudflare:workers"
import { expect } from "vitest"

export const ORIGIN = "https://band.test"
export const OWNER = "alex@example.com"

/** A request to the Worker, as a browser on the band's address sends it. */
export function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("Origin", ORIGIN)
  if (cookie) headers.set("Cookie", cookie)
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  return exports.default.fetch(new Request(ORIGIN + path, { ...init, headers }))
}

export const post = (path: string, body: unknown, cookie?: string) =>
  call(path, { method: "POST", body: JSON.stringify(body) }, cookie)

export const put = (path: string, body: unknown, cookie?: string) =>
  call(path, { method: "PUT", body: JSON.stringify(body) }, cookie)

export const sendCode = (email: string) =>
  post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" })

export const signInWith = (email: string, otp: string) =>
  post("/api/auth/sign-in/email-otp", { email, otp })

export type Letter = { to: string; subject: string; text: string }

export async function letters(): Promise<Letter[]> {
  return (await (await call("/api/stand-ins/letters")).json()) as Letter[]
}

/** The code in the newest letter to `email`. */
export async function codeFor(email: string): Promise<string> {
  const mine = (await letters()).filter((l) => l.to === email)
  expect(mine.length).toBeGreaterThan(0)
  const code = /^(\d{6}) is your code for /.exec(mine[mine.length - 1].subject)
  expect(code).not.toBeNull()
  return code![1]
}

export async function addresses(): Promise<{ list: Record<string, boolean>; log: string[] }> {
  return (await (await call("/api/stand-ins/addresses")).json()) as never
}

/** The member presses the button in Cloudflare's letter. */
export async function confirm(email: string): Promise<void> {
  expect((await post("/api/stand-ins/confirm", { email })).status).toBe(200)
}

/** The session cookie a response sets, ready for a Cookie header. */
export function sessionCookie(res: Response): string {
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("__Secure-better-auth.session_token="))
  expect(cookie).toBeDefined()
  return cookie!
}

/** Signs in with a code from a letter; the address is confirmed first. */
export async function signIn(email: string): Promise<string> {
  await confirm(email)
  expect((await sendCode(email)).status).toBe(200)
  const res = await signInWith(email, await codeFor(email))
  expect(res.status).toBe(200)
  return sessionCookie(res)
}

export const signInOwner = () => signIn(OWNER)

/** The owner adds a member and the member signs in. */
export async function member(owner: string, email: string): Promise<{ id: string; cookie: string }> {
  const res = await post("/api/members", { email }, owner)
  expect(res.status).toBe(200)
  const { id } = (await res.json()) as { id: string }
  return { id, cookie: await signIn(email) }
}

export const me = (cookie?: string) => call("/api/me", {}, cookie)
