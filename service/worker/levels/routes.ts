import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, inArray, sql } from "drizzle-orm"
import { database, type Database } from "../shared/db"
import { body, errors, json, newApp } from "../shared/openapi"
import { level } from "../shared/schema"
import { needMember } from "../signin/guards"

const LEVEL = "A level is from 0 to 1"
const TRACK = "A track's name is 1 to 200 characters"
const MANY = "Up to 64 levels at a time"

/** A track's name, as РЭХА names it in a take's balance. */
const Track = z.string().min(1, { error: TRACK }).max(200, { error: TRACK })
/** As far as РЭХА's fader goes: 0 is silent, 1 is as recorded. */
const Level = z.number({ error: LEVEL }).min(0, { error: LEVEL }).max(1, { error: LEVEL })

const Levels = z
  .object({ levels: z.record(z.string(), z.number()).openapi({ example: { Vocals: 1, Guitar: 0.4 } }) })
  .openapi("Levels")

const levelsOf = async (db: Database, memberId: string) =>
  Object.fromEntries(
    (await db.select({ track: level.track, level: level.level }).from(level).where(eq(level.memberId, memberId))).map(
      (r) => [r.track, r.level]
    )
  )

/** The member's own levels for tracks, by name: they hear a take with them, nobody else does. */
export const levelRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/me/levels",
      middleware: [needMember] as const,
      responses: { 200: json(Levels), ...errors(401) },
    }),
    async (c) => c.json({ levels: await levelsOf(database(c.env), c.var.member.id) }, 200)
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/me/levels",
      description: "Keeps these levels for the member; a level of `null` forgets that track's. Answers all of the member's levels after.",
      middleware: [needMember] as const,
      request: {
        body: body(
          z.object({
            levels: z
              .record(Track, Level.nullable())
              .refine((l) => Object.keys(l).length <= 64, { error: MANY })
              .openapi({ example: { Vocals: 1, Guitar: null } }),
          })
        ),
      },
      responses: { 200: json(Levels), ...errors(400, 401) },
    }),
    async (c) => {
      const db = database(c.env)
      const memberId = c.var.member.id
      const given = Object.entries(c.req.valid("json").levels)
      const kept = given.filter((e): e is [string, number] => e[1] !== null)
      const forgot = given.filter(([, v]) => v === null).map(([track]) => track)
      const writes = [
        ...(kept.length
          ? [
              db
                .insert(level)
                .values(kept.map(([track, v]) => ({ memberId, track, level: v })))
                .onConflictDoUpdate({ target: [level.memberId, level.track], set: { level: sql`excluded.level` } }),
            ]
          : []),
        ...(forgot.length
          ? [db.delete(level).where(and(eq(level.memberId, memberId), inArray(level.track, forgot)))]
          : []),
      ]
      if (writes.length) await db.batch(writes as never)
      return c.json({ levels: await levelsOf(db, memberId) }, 200)
    }
  )
