import { readFileSync } from "node:fs"
import { expect, request, type APIRequestContext } from "@playwright/test"

/** The Worker the page tests run against (playwright.config.ts starts it). */
export const BASE = "http://localhost:8799"

/** Where the seed leaves what the tests read: who is signed in, and the band's ids. */
export const STATE = new URL("./.state/", import.meta.url)

/** A seeded member's sign-in, for `test.use({ storageState })`. */
export const as = (who: "alex" | "dzima" | "ira" | "paulik") => new URL(`${who}.json`, STATE).pathname

export type Band = {
  takes: Record<string, string>
  songs: Record<string, number>
}

/** The ids the seed made: a take's uid by its name, a song's id by its title. */
export const band = (): Band => JSON.parse(readFileSync(new URL("band.json", STATE), "utf-8"))

/** A browser's requests, as the band's own page sends them. */
export const HEADERS = { Origin: BASE }

/** Requests as a seeded member, outside any page. */
export const asMember = (who: Parameters<typeof as>[0]): Promise<APIRequestContext> =>
  request.newContext({ baseURL: BASE, storageState: as(who), extraHTTPHeaders: HEADERS })

/** The code in the newest letter to `email`, read from the letters' stand-in. */
export async function codeFor(api: APIRequestContext, email: string): Promise<string> {
  const letters = (await (await api.get("/api/stand-ins/letters")).json()) as { to: string; subject: string }[]
  const mine = letters.filter((l) => l.to === email)
  expect(mine.length).toBeGreaterThan(0)
  return /^(\d{6}) is your code for /.exec(mine[mine.length - 1].subject)![1]
}

/** The member presses the button in Cloudflare's letter. */
export async function confirm(api: APIRequestContext, email: string): Promise<void> {
  expect((await api.post("/api/stand-ins/confirm", { data: { email } })).ok()).toBe(true)
}

/** Signs `api` in as `email`, which is in the band and confirmed. */
export async function signIn(api: APIRequestContext, email: string): Promise<void> {
  expect((await api.post("/api/auth/email-otp/send-verification-otp", { data: { email, type: "sign-in" } })).ok()).toBe(true)
  const otp = await codeFor(api, email)
  expect((await api.post("/api/auth/sign-in/email-otp", { data: { email, otp } })).ok()).toBe(true)
}

/** The owner adds `email` to the band; its id. */
export async function addMember(owner: APIRequestContext, email: string): Promise<string> {
  const res = await owner.post("/api/members", { data: { email } })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { id: string }).id
}
