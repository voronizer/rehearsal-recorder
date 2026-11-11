import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNull, sql } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp } from "../shared/openapi"
import { backingHeard, song } from "../shared/schema"
import { needMember } from "../signin/guards"

const Heard = z
  .object({ heard: z.record(z.string(), z.boolean()).openapi({ example: { "3": true, "7": false } }) })
  .openapi("BackingHeard")

/** The member's songs by number, each with whether they have the Backing track on. */
const heardBy = async (db: ReturnType<typeof database>, memberId: string) =>
  Object.fromEntries(
    (
      await db
        .select({ songId: backingHeard.songId, heard: backingHeard.heard })
        .from(backingHeard)
        .where(eq(backingHeard.memberId, memberId))
    ).map((r) => [String(r.songId), r.heard])
  )

/** Whether the member hears a song's Backing track: theirs only, as with their levels. */
export const backingRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/me/backing",
      description: "Every song the member has chosen for, by its number. A song not listed has not been chosen.",
      middleware: [needMember] as const,
      responses: { 200: json(Heard), ...errors(401) },
    }),
    async (c) => c.json({ heard: await heardBy(database(c.env), c.var.member.id) }, 200)
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/me/backing",
      description: "Keeps whether the member hears this song's Backing track. 404 for a song the band does not have, or one in the Trash. Answers all of the member's songs after.",
      middleware: [needMember] as const,
      request: { body: body(z.object({ song_id: z.int().min(1), heard: z.boolean() })) },
      responses: { 200: json(Heard), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const memberId = c.var.member.id
      const { song_id, heard } = c.req.valid("json")
      const [found] = await db
        .select({ id: song.id })
        .from(song)
        .where(and(eq(song.id, song_id), isNull(song.trashedAt)))
        .limit(1)
      if (!found) return fail(c, 404, "No such song")
      await db
        .insert(backingHeard)
        .values({ memberId, songId: song_id, heard })
        .onConflictDoUpdate({ target: [backingHeard.memberId, backingHeard.songId], set: { heard: sql`excluded.heard` } })
      return c.json({ heard: await heardBy(db, memberId) }, 200)
    }
  )
