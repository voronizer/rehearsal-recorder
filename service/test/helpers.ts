import { env, exports } from "cloudflare:workers"
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

export async function makeKey(owner: string, name = "Rehearsal room"): Promise<string> {
  const res = await post("/api/keys", { name }, owner)
  expect(res.status).toBe(200)
  const { key } = (await res.json()) as { key: string }
  return key
}

/** A request from РЭХА with the key as pasted, `<host>:<secret>`. */
export function fromReha(
  path: string,
  key: string,
  version: string | null = "0.17.0",
  init: { method?: string; json?: unknown; bytes?: Uint8Array<ArrayBuffer> } = {}
): Promise<Response> {
  const headers = new Headers({ "x-api-key": key.slice(key.lastIndexOf(":") + 1) })
  if (version !== null) headers.set("X-Reha-Version", version)
  let body: BodyInit | undefined
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(init.json)
  } else if (init.bytes !== undefined) {
    headers.set("Content-Type", "application/octet-stream")
    body = init.bytes
  }
  return exports.default.fetch(new Request(ORIGIN + path, { method: init.method ?? "GET", headers, body }))
}

/** РЭХА with a fresh key, for the routes it calls. */
export async function reha() {
  const key = await makeKey(await signInOwner())
  return {
    get: (path: string) => fromReha(path, key),
    put: (path: string, json: unknown) => fromReha(path, key, "0.17.0", { method: "PUT", json }),
    post: (path: string, json: unknown) => fromReha(path, key, "0.17.0", { method: "POST", json }),
    del: (path: string) => fromReha(path, key, "0.17.0", { method: "DELETE" }),
    part: (path: string, bytes: Uint8Array<ArrayBuffer>) => fromReha(path, key, "0.17.0", { method: "PUT", bytes }),
  }
}

export const REHEARSAL = { uid: "6f1c2a7e-5b3d-5c8e-9a41-2d7b6e0f3c19", name: "Thursday", date: "2025-10-30" }

/** A take's details as РЭХА sends them, with two tracks. */
export function takeMeta(over: Record<string, unknown> = {}) {
  return {
    rehearsal: REHEARSAL,
    number: 12,
    name: "Viasna 12",
    song: "Viasna",
    duration_sec: 312.48,
    gen: 1,
    cut_start: 0,
    starred: false,
    balance: { Bass: 0.8 },
    tracks: [
      { position: 1, name: "Bass", icon: "bass", files: ["1.mp3", "1.flac", "1.peaks"] },
      { position: 2, name: "Drums", icon: "drums", files: ["2.mp3", "2.flac", "2.peaks"] },
    ],
    notes: [{ position: 3, name: "Keys", file: "3.mid" }],
    marks: [],
    ...over,
  }
}

export const TAKE = "0b7e4c1a-9d2f-4e6b-8a3c-5f1d7e9b2a40"

const rehearsals = new Map<string, string>()
/** One rehearsal a day. */
const rehearsalOn = (date: string) => {
  if (!rehearsals.has(date)) rehearsals.set(date, crypto.randomUUID())
  return rehearsals.get(date)!
}

/** A take РЭХА sent whose MP3s are up, so the band sees it. */
export async function shownTake(
  over: Record<string, unknown> & { uid?: string; date?: string } = {}
): Promise<string> {
  const { putTake, ready } = await import("../worker/takes/store")
  const uid = over.uid ?? crypto.randomUUID()
  const { uid: _, date, ...meta } = over
  const rehearsal = date ? { uid: rehearsalOn(date), name: "Rehearsal", date } : REHEARSAL
  const bindings = env as never
  await putTake(bindings, uid, takeMeta({ rehearsal, ...meta }) as never)
  await ready(bindings, uid, 1, "mp3", ORIGIN)
  return uid
}

/** Gives the member their name, as the page asks them the first time. */
export async function named(cookie: string, name: string): Promise<void> {
  expect((await put("/api/me", { name }, cookie)).status).toBe(200)
}

export const patch = (path: string, body: unknown, cookie?: string) =>
  call(path, { method: "PATCH", body: JSON.stringify(body) }, cookie)

export const del = (path: string, cookie?: string, body?: unknown) =>
  call(path, { method: "DELETE", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, cookie)

/** A route's answer as JSON, after checking it said 200. */
export async function read<T = any>(path: string, cookie?: string): Promise<T> {
  const res = await call(path, {}, cookie)
  expect(res.status, `GET ${path}`).toBe(200)
  return (await res.json()) as T
}

/** What a change answered: its status, and its JSON. */
export async function answer<T = any>(res: Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res
  return { status: r.status, body: (await r.json().catch(() => null)) as T }
}

/** The member opened the take. */
export const open = async (cookie: string, uid: string) =>
  expect((await post(`/api/takes/${uid}/seen`, {}, cookie)).status).toBe(200)

export const starIt = async (cookie: string, uid: string) =>
  expect((await post(`/api/takes/${uid}/star`, {}, cookie)).status).toBe(200)

/** A member's mark on a take; the first label unless `label_id` says. */
export async function markAt(cookie: string, uid: string, at: number, note: string, label_id?: number) {
  const res = await post(`/api/takes/${uid}/marks`, { at, note, label_id }, cookie)
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as { id: number; at: number; note: string; label_id: number }
}

export async function commentOn(cookie: string, mark: number, text: string) {
  const res = await post(`/api/marks/${mark}/comments`, { text }, cookie)
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as { id: number; text: string }
}

/** The band's labels, in their order. */
export const labelsOf = (cookie: string) =>
  read<{ id: number; name: string; colour: string; position: number; marks: number }[]>("/api/labels", cookie)
