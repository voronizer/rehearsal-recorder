import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { errors, json, newApp, Ok } from "../shared/openapi"
import { loadMarks, MarkView } from "../marks/view"
import { rehearsal, seen, song, star, take, user } from "../shared/schema"
import { iso } from "../shared/time"
import { needMember } from "../signin/guards"
import { bare, initial, shownName, takeRows, TakeRow } from "./rows"

const NO_TAKE = "No such take"

const Uid = z.object({ uid: z.uuid() })

const TakePage = z
  .object({
    uid: z.string(),
    name: z.string(),
    number: z.number(),
    date: z.string(),
    rehearsal: z.object({ uid: z.string(), name: z.string(), date: z.string() }),
    song: z.object({ id: z.number(), title: z.string() }).nullable(),
    duration_sec: z.number(),
    /** The generation the band hears; the files' paths carry it. */
    gen: z.number(),
    balance: z.record(z.string(), z.number()),
    tracks: z.array(
      z.object({ position: z.number(), name: z.string(), icon: z.string().nullable(), mp3: z.string(), peaks: z.string() })
    ),
    stars: z.array(z.object({ member_id: z.string(), initial: z.string(), name: z.string() })),
    starred_by_me: z.boolean(),
    starred_at_rehearsal: z.boolean(),
    /** Its marks by their moment, each with the comments under it. */
    marks: z.array(MarkView),
    /** What **Download tracks** offers; `mid` is null for a track with no notes. */
    files: z.array(
      z.object({ position: z.number(), name: z.string(), mp3: z.boolean(), flac: z.boolean(), mid: z.boolean().nullable() })
    ),
    /** The originals are still on their way. */
    flac_coming: z.boolean(),
    trashed_at: z.string().nullable(),
  })
  .openapi("TakePage")

/** A take the band sees, or undefined. */
async function shown(db: ReturnType<typeof database>, uid: string, alsoTrashed = false) {
  const [row] = await db
    .select()
    .from(take)
    .where(and(eq(take.uid, uid), isNotNull(take.shownGen), alsoTrashed ? undefined : isNull(take.trashedAt)))
    .limit(1)
  return row
}

/** A take: its page, stars, opening it, the trash. */
export const takeRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/takes/{uid}",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(TakePage), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      const t = await shown(db, uid, true)
      if (!t) return fail(c, 404, NO_TAKE)
      const gen = t.shownGen!
      const [[[r], songs, stars], marks] = await Promise.all([
        db.batch([
          db.select().from(rehearsal).where(eq(rehearsal.uid, t.rehearsalUid)),
          db.select().from(song).where(eq(song.id, t.songId ?? -1)),
          db
            .select({ memberId: user.id, name: user.name, email: user.email })
            .from(star)
            .innerJoin(user, eq(star.memberId, user.id))
            .where(eq(star.takeUid, uid))
            .orderBy(user.name, user.email),
        ]),
        loadMarks(db, c.var.member.id, eq(take.uid, uid)),
      ])
      const path = (name: string) => `/files/${uid}/${gen}/${name}`
      const flacUp = t.flacGen === gen
      const positions = [...new Set([...t.tracks.map((k) => k.position), ...t.notes.map((n) => n.position)])].sort(
        (a, b) => a - b
      )
      const files = positions.map((position) => {
        const audio = t.tracks.find((k) => k.position === position)
        const notes = t.notes.find((n) => n.position === position)
        return {
          position,
          name: audio?.name ?? notes!.name,
          mp3: Boolean(audio?.files.includes(`${position}.mp3`)),
          flac: flacUp && Boolean(audio?.files.includes(`${position}.flac`)),
          mid: notes ? true : null,
        }
      })
      return c.json(
        {
          uid,
          name: t.name,
          number: t.number,
          date: r.date,
          rehearsal: r,
          song: songs[0] ? { id: songs[0].id, title: songs[0].title } : null,
          duration_sec: t.durationSec,
          gen,
          balance: t.balance,
          tracks: t.tracks
            .filter((k) => k.files.includes(`${k.position}.mp3`))
            .map((k) => ({
              position: k.position,
              name: k.name,
              icon: k.icon,
              mp3: path(`${k.position}.mp3`),
              peaks: path(`${k.position}.peaks`),
            })),
          stars: stars.map((s) => ({ member_id: s.memberId, initial: initial(s.name, s.email), name: shownName(s.name, s.email) })),
          starred_by_me: stars.some((s) => s.memberId === c.var.member.id),
          starred_at_rehearsal: t.starredAtRehearsal,
          marks: marks.sort((a, b) => a.at - b.at || a.id - b.id),
          files,
          flac_coming: files.some((f) => f.mp3) && !flacUp,
          trashed_at: t.trashedAt,
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/takes/{uid}/star",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      if (!(await shown(db, uid))) return fail(c, 404, NO_TAKE)
      await db.insert(star).values({ takeUid: uid, memberId: c.var.member.id }).onConflictDoNothing()
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/takes/{uid}/star",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401) },
    }),
    async (c) => {
      await database(c.env)
        .delete(star)
        .where(and(eq(star.takeUid, c.req.valid("param").uid), eq(star.memberId, c.var.member.id)))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/takes/{uid}/seen",
      description: "The member opened or played the take: it and its marks are no longer new for them.",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      if (!(await shown(db, uid, true))) return fail(c, 404, NO_TAKE)
      const at = iso()
      await db
        .insert(seen)
        .values({ memberId: c.var.member.id, takeUid: uid, seenAt: at })
        .onConflictDoUpdate({ target: [seen.memberId, seen.takeUid], set: { seenAt: at } })
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/trash",
      middleware: [needMember] as const,
      responses: { 200: json(z.array(TakeRow.extend({ trashed_at: z.string() }))), ...errors(401) },
    }),
    async (c) => {
      const rows = await takeRows(c.env, c.var.member.id, isNotNull(take.trashedAt))
      return c.json(
        rows
          .sort((a, b) => b.trashed_at!.localeCompare(a.trashed_at!))
          .map((r) => ({ ...bare(r), trashed_at: r.trashed_at! })),
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/trash/{uid}/restore",
      description: "**Restore**: the take goes back in its song as it was.",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const back = await database(c.env)
        .update(take)
        .set({ trashedAt: null })
        .where(and(eq(take.uid, c.req.valid("param").uid), isNotNull(take.trashedAt)))
        .returning({ uid: take.uid })
      if (!back.length) return fail(c, 404, "This take is not in the trash")
      return c.json({ ok: true as const }, 200)
    }
  )
