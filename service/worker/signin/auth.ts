import { apiKey } from "@better-auth/api-key"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { admin, emailOTP } from "better-auth/plugins"
import { database } from "../shared/db"
import type { Bindings } from "../shared/env"
import * as schema from "../shared/schema"
import { NO_TOKEN, NoAddressToken, type AddressList } from "./addresses"
import type { Letters } from "./letters"

export type Parts = { letters: Letters; addresses: AddressList }

const DAY = 24 * 60 * 60
/** A code lasts 10 minutes. */
export const CODE_SECONDS = 10 * 60

export const CONFIRM_FIRST =
  "First confirm your address: look for a letter from Cloudflare, then press Send code again"

/** Trimmed and lower-cased, wherever an address comes in. */
export const normaliseEmail = (s: string) => s.trim().toLowerCase()

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/**
 * Before a code is made: the owner's first request makes the owner, a
 * removed member gets the answer a member gets and no letter, and an
 * address Cloudflare has not had confirmed is put on its list again, so
 * Cloudflare sends its own letter again. An address not in the band goes
 * on to better-auth, which answers the same and sends nothing.
 */
async function beforeCode(ctx: HookContext, ownerEmail: string, addresses: AddressList) {
  const email = normaliseEmail(String(ctx.body?.email ?? ""))
  const goOn = { context: { body: { ...ctx.body, email } } }
  const adapter = ctx.context.internalAdapter
  const found = await adapter.findUserByEmail(email)
  if (!found) {
    if (email !== normaliseEmail(ownerEmail)) return goOn
    await adapter.createUser({ email, name: "", role: "admin", emailVerified: false }, { method: "admin" })
  } else if ((found.user as { banned?: boolean | null }).banned) return ctx.json({ success: true })
  try {
    if (!(await addresses.confirmed([email])).has(email)) {
      await addresses.remove(email)
      await addresses.add(email)
      throw new APIError("BAD_REQUEST", { code: "CONFIRM_FIRST", message: CONFIRM_FIRST })
    }
  } catch (e) {
    if (e instanceof NoAddressToken) throw new APIError("BAD_REQUEST", { code: "NO_ADDRESS_TOKEN", message: NO_TOKEN })
    throw e
  }
  return goOn
}

/**
 * better-auth as the band service uses it: a 6-digit code by email for
 * members already in the band (no sign-up), a session of a year from the
 * last visit, the owner as its admin, and РЭХА's keys.
 */
export function authOptions(origin: string, env: Pick<Bindings, "BETTER_AUTH_SECRET" | "OWNER_EMAIL">, parts: Parts, db: unknown) {
  const host = new URL(origin).host
  return {
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db as never, { provider: "sqlite", schema }),
    session: { expiresIn: 365 * DAY, updateAge: DAY },
    // A Worker keeps nothing between requests, so the tries are counted in D1.
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    hooks: {
      // These run after better-auth's rate limit and before its own route.
      // What sendVerificationOTP throws, better-auth only logs, so who gets a
      // code is settled here.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp") return beforeCode(ctx, env.OWNER_EMAIL, parts.addresses)
        if (ctx.path === "/sign-in/email-otp" && typeof ctx.body?.email === "string")
          return { context: { body: { ...ctx.body, email: normaliseEmail(ctx.body.email) } } }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_SECONDS,
        allowedAttempts: 5,
        disableSignUp: true,
        storeOTP: "hashed",
        // Counted by IP address and path, not by email address, and the band
        // may all sign in at once from the rehearsal room's one connection;
        // the plugin's own limit is 3 a minute.
        rateLimit: { window: 60, max: 10 },
        async sendVerificationOTP({ email, otp }) {
          await parts.letters.send(
            email,
            `${otp} is your code for ${host}`,
            `Your code is ${otp}. It works for 10 minutes.\n\nIf you did not ask for it, you can ignore this letter.`
          )
        },
      }),
      admin(),
      // РЭХА's keys: no end and no limit, since sending a rehearsal is a few
      // hundred requests and the plugin's own limit is 10 a day.
      apiKey({ rateLimit: { enabled: false } }),
    ],
  } satisfies BetterAuthOptions
}

/** Made anew for each request: a Worker's bindings exist only inside one. */
export function makeAuth(env: Bindings, origin: string, parts: Parts) {
  return betterAuth(authOptions(origin, env, parts, database(env)))
}

export type Auth = ReturnType<typeof makeAuth>
