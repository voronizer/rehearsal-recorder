import { createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { errors, json, newApp, Ok } from "../shared/openapi"
import { comment, rehearsal, seen, song, star, take, user } from "../shared/schema"
import { iso } from "../shared/time"
import { CommentView, commentView } from "../comments/view"
import { needMember } from "../signin/guards"
import {
  CommentRow,
  SongRow,
  TakeRow,
  bare,
  best,
  initial,
  newComments,
  newest,
  shownName,
  songRow,
  songTitles,
  takeRows,
} from "./rows"

const NOT_NAMED = "Not named"
const NO_TAKE = "No such take"

const Uid = z.object({ uid: z.uuid() })

const Start = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("song"), id: z.union([z.number(), z.literal("not-named")]) }),
])

const Feed = z
  .object({
    new: z.object({ takes: z.array(TakeRow), comments: z.array(CommentRow) }),
    new_count: z.number(),
    songs: z.array(SongRow),
    not_named: SongRow.nullable(),
    start: Start,
  })
  .openapi("Feed")

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
    comments: z.array(CommentView.extend({ replies: z.array(CommentView) })),
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

/** What the band reads and does: the feed, the songs, a take, stars, the trash. */
export const bandRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/feed",
      middleware: [needMember] as const,
      responses: { 200: json(Feed), ...errors(401) },
    }),
    async (c) => {
      const db = database(c.env)
      const me = c.var.member.id
      const [rows, comments, titles] = await Promise.all([
        takeRows(db, me, isNull(take.trashedAt)),
        newComments(db, me),
        songTitles(db),
      ])
      const bySong = new Map<number, typeof rows>()
      for (const r of rows) if (r.song_id !== null) bySong.set(r.song_id, [...(bySong.get(r.song_id) ?? []), r])
      const songs = [...bySong].map(([id, list]) => songRow(id, titles.get(id) ?? "", list)).sort((a, b) => newest(a.last, b.last))
      const loose = rows.filter((r) => r.song_id === null)
      const notNamed = loose.length ? songRow("not-named", NOT_NAMED, loose) : null
      const takes = rows.filter((r) => r.is_new).map(bare)
      const count = takes.length + comments.length
      const last = [...songs, ...(notNamed ? [notNamed] : [])].sort((a, b) => newest(a.last, b.last))[0]
      const start = count || !last ? { kind: "new" as const } : { kind: "song" as const, id: last.id }
      const plain = ({ last: _, ...s }: ReturnType<typeof songRow>) => s
      return c.json(
        {
          new: { takes, comments },
          new_count: count,
          songs: songs.map(plain),
          not_named: notNamed && plain(notNamed),
          start,
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/songs/{id}",
      description: "A song's page; `not-named` for the takes nobody named.",
      middleware: [needMember] as const,
      request: { params: z.object({ id: z.union([z.literal("not-named"), z.coerce.number().int().min(1)]) }) },
      responses: {
        200: json(
          z.object({
            song: z.object({ id: z.union([z.number(), z.literal("not-named")]), title: z.string() }),
            best: TakeRow.nullable(),
            takes: z.array(TakeRow),
          })
        ),
        ...errors(401, 404),
      },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const which = id === "not-named" ? isNull(take.songId) : eq(take.songId, id)
      const rows = await takeRows(db, c.var.member.id, and(isNull(take.trashedAt), which))
      if (!rows.length) return fail(c, 404, "No such song")
      const title = id === "not-named" ? NOT_NAMED : ((await songTitles(db)).get(id) ?? "")
      const top = best(rows)
      return c.json({ song: { id, title }, best: top && bare(top), takes: rows.map(bare) }, 200)
    }
  )
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
      const [[r], songs, stars, rows] = await db.batch([
        db.select().from(rehearsal).where(eq(rehearsal.uid, t.rehearsalUid)),
        db.select().from(song).where(eq(song.id, t.songId ?? -1)),
        db
          .select({ memberId: user.id, name: user.name, email: user.email })
          .from(star)
          .innerJoin(user, eq(star.memberId, user.id))
          .where(eq(star.takeUid, uid))
          .orderBy(user.name, user.email),
        db
          .select({ comment, name: user.name, email: user.email })
          .from(comment)
          .leftJoin(user, eq(comment.memberId, user.id))
          .where(eq(comment.takeUid, uid))
          .orderBy(asc(comment.at), asc(comment.createdAt), asc(comment.id)),
      ])
      const all = rows.map((row) => ({
        parentId: row.comment.parentId,
        view: commentView({ ...row.comment, name: row.name, email: row.email }),
      }))
      const comments = all
        .filter((top) => top.parentId === null)
        .map((top) => ({
          ...top.view,
          replies: all
            .filter((reply) => reply.parentId === top.view.id)
            .map((reply) => reply.view)
            .sort((a, b) => a.created_at.localeCompare(b.created_at)),
        }))
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
          song: songs[0] ?? null,
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
          comments,
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
      description: "The member opened the take: it and its comments are no longer new for them.",
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
      const rows = await takeRows(database(c.env), c.var.member.id, isNotNull(take.trashedAt))
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
