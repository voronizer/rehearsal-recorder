import { createRoute, z } from "@hono/zod-openapi"
import { and, eq } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { errors, json, newApp } from "../shared/openapi"
import { rehearsal, song, take } from "../shared/schema"
import { needMember } from "../signin/guards"
import { bare, live, takeRows, TakeRow, type Loaded } from "../takes/rows"

const Rehearsal = z.object({ uid: z.string(), name: z.string(), date: z.string() }).openapi("Rehearsal")

const RehearsalItem = Rehearsal.extend({
  /** The songs played, in the order first played. */
  songs: z.array(z.string()),
  /** Some take has no song. */
  not_named: z.boolean(),
  /** Its takes as Rehearsals draws them: small columns by length, green when starred. */
  takes: z.array(z.object({ uid: z.string(), duration_sec: z.number(), starred: z.boolean() })),
  starred: z.number(),
  marks: z.number(),
  /** A take you have not heard. */
  has_new: z.boolean(),
}).openapi("RehearsalItem")

/** In the order they were played. */
const played = (a: Loaded, b: Loaded) => a.number - b.number || (a.shown_at ?? "").localeCompare(b.shown_at ?? "")

/** The Rehearsals table and a rehearsal's page. */
export const rehearsalRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/rehearsals",
      description: "Every rehearsal with a take the band hears, newest first.",
      middleware: [needMember] as const,
      responses: { 200: json(z.array(RehearsalItem)), ...errors(401) },
    }),
    async (c) => {
      const db = database(c.env)
      const [rows, rehearsals, songs] = await Promise.all([
        takeRows(c.env, c.var.member.id, live()),
        db.select().from(rehearsal),
        db.select({ id: song.id, title: song.title }).from(song),
      ])
      const titles = new Map(songs.map((s) => [s.id, s.title]))
      const items = rehearsals
        .map((r) => {
          const takes = rows.filter((t) => t.rehearsal_uid === r.uid).sort(played)
          return {
            uid: r.uid,
            name: r.name,
            date: r.date,
            songs: [...new Set(takes.flatMap((t) => (t.song_id === null ? [] : [titles.get(t.song_id) ?? ""])))],
            not_named: takes.some((t) => t.song_id === null),
            takes: takes.map((t) => ({ uid: t.uid, duration_sec: t.duration_sec, starred: t.stars.length > 0 })),
            starred: takes.filter((t) => t.stars.length > 0).length,
            marks: takes.reduce((n, t) => n + t.marks.length, 0),
            has_new: takes.some((t) => t.is_new),
          }
        })
        .filter((r) => r.takes.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
      return c.json(items, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/rehearsals/{uid}",
      description: "A rehearsal's page: its takes in the order played; the page groups them by song.",
      middleware: [needMember] as const,
      request: { params: z.object({ uid: z.uuid() }) },
      responses: { 200: json(z.object({ rehearsal: Rehearsal, takes: z.array(TakeRow) })), ...errors(401, 404) },
    }),
    async (c) => {
      const { uid } = c.req.valid("param")
      const [r] = await database(c.env).select().from(rehearsal).where(eq(rehearsal.uid, uid)).limit(1)
      const takes = r ? await takeRows(c.env, c.var.member.id, and(live(), eq(take.rehearsalUid, uid))) : []
      if (!r || !takes.length) return fail(c, 404, "No such rehearsal")
      return c.json({ rehearsal: { uid: r.uid, name: r.name, date: r.date }, takes: takes.sort(played).map(bare) }, 200)
    }
  )
