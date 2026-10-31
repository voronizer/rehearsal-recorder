import { createRoute, z } from "@hono/zod-openapi"
import { isAPIError } from "better-auth/api"
import { desc, eq } from "drizzle-orm"
import { database, type Database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { user } from "../shared/schema"
import { needOwner } from "../signin/guards"

const EMAIL = "This is not an email address"
const ALREADY = "This address is already in the band"
const NO_MEMBER = "No such member"
const NO_KEY = "No such key"
const KEY_NAME = "A key's name is 1 to 32 characters"

const Member = z
  .object({
    id: z.string(),
    email: z.string(),
    /** "" until the member signs in and gives one. */
    name: z.string(),
    /** The member pressed the button in Cloudflare's letter. */
    confirmed: z.boolean(),
    /** The member has signed in at least once. */
    signed_in: z.boolean(),
  })
  .openapi("Member")

const Key = z.object({ id: z.string(), name: z.string(), created_at: z.string() }).openapi("Key")

const Id = z.object({ id: z.string() })

type UserRow = typeof user.$inferSelect

const view = (row: UserRow, confirmed: Set<string>) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  confirmed: confirmed.has(row.email),
  signed_in: row.emailVerified,
})

const find = async (db: Database, where: ReturnType<typeof eq>) =>
  (await db.select().from(user).where(where).limit(1))[0]

/** The owner's page: who is in the band, and РЭХА's keys. */
export const memberRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/members",
      middleware: [needOwner] as const,
      responses: { 200: json(z.array(Member)), ...errors(401, 403) },
    }),
    async (c) => {
      const rows = (
        await database(c.env)
          .select()
          .from(user)
          .orderBy(desc(eq(user.role, "admin")), user.createdAt)
      ).filter((row) => !row.banned)
      const confirmed = await c.var.parts.addresses.confirmed(rows.map((row) => row.email))
      return c.json(
        rows.map((row) => view(row, confirmed)),
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/members",
      middleware: [needOwner] as const,
      request: { body: body(z.object({ email: z.string().trim().toLowerCase().email({ error: EMAIL }) })) },
      responses: { 200: json(Member), ...errors(400, 401, 403, 409) },
    }),
    async (c) => {
      const { email } = c.req.valid("json")
      const { addresses } = c.var.parts
      const headers = c.req.raw.headers
      const found = await find(database(c.env), eq(user.email, email))
      if (found && !found.banned) return fail(c, 409, ALREADY)
      // On Cloudflare's list first: without its token nobody is added.
      await addresses.add(email)
      let row: UserRow
      if (found) {
        // A removed member comes back with their stars and comments.
        await c.var.auth.api.unbanUser({ body: { userId: found.id }, headers })
        row = found
      } else {
        const made = await c.var.auth.api.createUser({ body: { email, name: "", role: "user" }, headers })
        row = made.user as UserRow
      }
      return c.json(view(row, await addresses.confirmed([email])), 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/members/{id}/signout",
      middleware: [needOwner] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(400, 401, 403, 404) },
    }),
    async (c) => {
      const target = await find(database(c.env), eq(user.id, c.req.valid("param").id))
      if (!target || target.banned) return fail(c, 404, NO_MEMBER)
      await c.var.auth.api.revokeUserSessions({ body: { userId: target.id }, headers: c.req.raw.headers })
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/members/{id}",
      middleware: [needOwner] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(400, 401, 403, 404) },
    }),
    async (c) => {
      const target = await find(database(c.env), eq(user.id, c.req.valid("param").id))
      if (!target) return fail(c, 404, NO_MEMBER)
      if (target.role === "admin") return fail(c, 400, "The owner cannot be removed")
      // A ban with no end also ends every session. The member stays in the
      // table, so their stars and comments keep their name. The address
      // stays on Cloudflare's list, which is the whole account's: other mail
      // there may go to it.
      if (!target.banned)
        await c.var.auth.api.banUser({ body: { userId: target.id }, headers: c.req.raw.headers })
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/keys",
      middleware: [needOwner] as const,
      responses: { 200: json(z.array(Key)), ...errors(401, 403) },
    }),
    async (c) => {
      const { apiKeys } = await c.var.auth.api.listApiKeys({ headers: c.req.raw.headers })
      return c.json(
        apiKeys.map((key) => ({ id: key.id, name: key.name ?? "", created_at: new Date(key.createdAt).toISOString() })),
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/keys",
      middleware: [needOwner] as const,
      request: {
        body: body(z.object({ name: z.string().trim().min(1, { error: KEY_NAME }).max(32, { error: KEY_NAME }) })),
      },
      responses: {
        200: json(z.object({ key: z.string() }), "The key, shown this once: <host>:<secret>"),
        ...errors(400, 401, 403),
      },
    }),
    async (c) => {
      // A server call with the owner's id: no end, and the plugin's
      // settings in auth.ts turn its limit off.
      const made = await c.var.auth.api.createApiKey({
        body: { name: c.req.valid("json").name, userId: c.var.member.id },
      })
      return c.json({ key: `${new URL(c.req.url).host}:${made.key}` }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/keys/{id}",
      middleware: [needOwner] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(401, 403, 404) },
    }),
    async (c) => {
      try {
        await c.var.auth.api.deleteApiKey({ body: { keyId: c.req.valid("param").id }, headers: c.req.raw.headers })
      } catch (e) {
        if (isAPIError(e) && e.statusCode === 404) return fail(c, 404, NO_KEY)
        throw e
      }
      return c.json({ ok: true as const }, 200)
    }
  )
