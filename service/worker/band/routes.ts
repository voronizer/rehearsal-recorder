import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNotNull, isNull, max, sql } from "drizzle-orm"
import { database, type Database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { band, comment, take, user } from "../shared/schema"
import { iso } from "../shared/time"
import { needMember, needOwner } from "../signin/guards"
import { sizeOf } from "../songs/files"

const PICTURE = "band/picture"
/** The band's picture is up to 5 MB. */
const MAX_PICTURE = 5 * 1024 * 1024
const PICTURE_RULE = "A picture is PNG, JPEG or WebP, up to 5 MB"
const TYPES = ["image/png", "image/jpeg", "image/webp"]
const NAME = "The band's name is up to 60 characters"

const Band = z.object({ name: z.string(), picture: z.string().nullable() }).openapi("Band")

/** The band's row: made by the migration, and again here should it be gone. */
async function theBand(db: Database) {
  const [row] = await db.select().from(band).where(eq(band.id, 1)).limit(1)
  return row ?? { id: 1, name: "", pictureAt: null }
}

const shown = (row: { name: string; pictureAt: string | null }) => ({
  name: row.name,
  // The time in the address, so a new picture is not the old one from a cache.
  picture: row.pictureAt ? `/files/band/picture?v=${encodeURIComponent(row.pictureAt)}` : null,
})

/** The band's name and picture, and what the frame around every page shows. */
export const bandRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/band",
      description: "The band's name and picture, for the sign-in page too: no sign-in needed.",
      responses: { 200: json(Band) },
    }),
    async (c) => c.json(shown(await theBand(database(c.env))), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/frame",
      description: "What the column and the player bar show: members, open marks, the longest take.",
      middleware: [needMember] as const,
      responses: {
        200: json(
          Band.extend({ members: z.number(), open_marks: z.number(), longest: z.number(), has_takes: z.boolean() }).openapi("Frame")
        ),
        ...errors(401),
      },
    }),
    async (c) => {
      const db = database(c.env)
      const live = and(isNotNull(take.shownGen), isNull(take.trashedAt))
      const [row, [members], [marks], [takes]] = await Promise.all([
        theBand(db),
        db.select({ n: sql<number>`count(*)` }).from(user).where(sql`coalesce(${user.banned}, 0) = 0`),
        db
          .select({ n: sql<number>`count(*)` })
          .from(comment)
          .innerJoin(take, eq(comment.takeUid, take.uid))
          .where(and(isNull(comment.parentId), eq(comment.closed, false), live)),
        db.select({ longest: max(take.durationSec), n: sql<number>`count(*)` }).from(take).where(live),
      ])
      return c.json(
        {
          ...shown(row),
          members: Number(members.n),
          open_marks: Number(marks.n),
          longest: takes.longest ?? 0,
          has_takes: Number(takes.n) > 0,
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/band",
      description: "The band's name, by the owner.",
      middleware: [needOwner] as const,
      request: { body: body(z.object({ name: z.string().trim().max(60, { error: NAME }) })) },
      responses: { 200: json(Ok), ...errors(400, 401, 403) },
    }),
    async (c) => {
      const { name } = c.req.valid("json")
      await database(c.env).insert(band).values({ id: 1, name }).onConflictDoUpdate({ target: band.id, set: { name } })
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/band/picture",
      description: "**Add a picture**: PNG, JPEG or WebP, up to 5 MB, as the body.",
      middleware: [needOwner] as const,
      responses: { 200: json(Ok), ...errors(400, 401, 403, 413) },
    }),
    async (c) => {
      const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase()
      if (!TYPES.includes(type)) return fail(c, 400, PICTURE_RULE)
      const size = sizeOf(c)
      if (size === null) return fail(c, 400, "Send the picture's size")
      if (size > MAX_PICTURE) return fail(c, 413, PICTURE_RULE)
      await c.env.FILES.put(PICTURE, c.req.raw.body ?? new Uint8Array(), { httpMetadata: { contentType: type } })
      const at = iso()
      await database(c.env)
        .insert(band)
        .values({ id: 1, pictureAt: at })
        .onConflictDoUpdate({ target: band.id, set: { pictureAt: at } })
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/band/picture",
      middleware: [needOwner] as const,
      responses: { 200: json(Ok), ...errors(401, 403) },
    }),
    async (c) => {
      await database(c.env).update(band).set({ pictureAt: null }).where(eq(band.id, 1))
      await c.env.FILES.delete(PICTURE)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/files/band/picture",
      description: "The band's picture, shown on the sign-in page too.",
      responses: {
        200: { description: "The picture", content: { "image/*": { schema: z.string().openapi({ format: "binary" }) } } },
        ...errors(404),
      },
    }),
    async (c) => {
      const object = await c.env.FILES.get(PICTURE)
      if (!object) return fail(c, 404, "The band has no picture")
      const headers = new Headers()
      object.writeHttpMetadata(headers)
      headers.set("Content-Length", String(object.size))
      headers.set("Cache-Control", "public, max-age=86400")
      return new Response(object.body, { status: 200, headers })
    }
  )
