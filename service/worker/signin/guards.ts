import { createMiddleware } from "hono/factory"
import type { Context } from "hono"
import type { AppEnv } from "../shared/env"
import { fail } from "../shared/errors"
import { MIN_REHA_VERSION, tooOld } from "../shared/version"

export { normaliseEmail } from "./auth"

export const NOT_SIGNED_IN = "Sign in first"
export const NOT_OWNER = "Only the owner can do this"
export const BAD_KEY = "This key does not work"
export const UPDATE_REHA = "Update РЭХА to send takes here"

/**
 * The member whose session the request carries, or null. A visit a day or
 * more after the session last moved on moves it on again, and the answer
 * carries the new cookie, so the browser keeps it for another year.
 */
async function sessionMember(c: Context<AppEnv>) {
  const { headers, response } = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  })
  if (!response) return null
  const { user } = response
  c.set("member", { id: user.id, email: user.email, name: user.name, owner: user.role === "admin" })
  return headers.getSetCookie()
}

async function withSession(c: Context<AppEnv>, next: () => Promise<void>, ownerOnly: boolean) {
  const cookies = await sessionMember(c)
  if (!cookies) return fail(c, 401, NOT_SIGNED_IN)
  if (ownerOnly && !c.var.member.owner) return fail(c, 403, NOT_OWNER)
  await next()
  for (const cookie of cookies) c.res.headers.append("Set-Cookie", cookie)
}

/** A signed-in member, or 401. */
export const needMember = createMiddleware<AppEnv>((c, next) => withSession(c, next, false))

/** The owner, or 401 / 403. */
export const needOwner = createMiddleware<AppEnv>((c, next) => withSession(c, next, true))

/** РЭХА with a key that works and a version the service takes, or 401 / 426. */
export const needKey = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header("x-api-key")
  const checked = key ? await c.var.auth.api.verifyApiKey({ body: { key } }) : null
  if (!checked?.valid) return fail(c, 401, BAD_KEY)
  if (tooOld(c.req.header("X-Reha-Version"), MIN_REHA_VERSION)) return fail(c, 426, UPDATE_REHA)
  await next()
})
