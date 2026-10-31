import { z } from "@hono/zod-openapi"
import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import type { Database } from "../shared/db"
import { comment, rehearsal, seen, song, star, take, user } from "../shared/schema"

/** A member's first letter, as the stars show it. */
export const initial = (name: string, email: string) => (Array.from((name || email).trim())[0] ?? "?").toUpperCase()

/** The name the band sees for a member: their own, or their address until they give one. */
export const shownName = (name: string, email: string) => name || email

const Star = z.object({ member_id: z.string(), initial: z.string(), name: z.string() })

export const TakeRow = z
  .object({
    uid: z.string(),
    name: z.string(),
    song_id: z.number().nullable(),
    /** The rehearsal's day. */
    date: z.string(),
    duration_sec: z.number(),
    /** How many marks РЭХА sent with it. */
    marks: z.number(),
    stars: z.array(Star),
    starred_at_rehearsal: z.boolean(),
    is_new: z.boolean(),
  })
  .openapi("TakeRow")

export type TakeRow = z.infer<typeof TakeRow>

export const SongRow = z
  .object({
    id: z.union([z.number(), z.literal("not-named")]),
    title: z.string(),
    takes: z.number(),
    last_date: z.string(),
    best: TakeRow.nullable(),
    has_new: z.boolean(),
  })
  .openapi("SongRow")

export type SongRow = z.infer<typeof SongRow>

export const CommentRow = z
  .object({
    id: z.number(),
    take_uid: z.string(),
    take_name: z.string(),
    at: z.number(),
    text: z.string(),
    /** null for a mark from РЭХА. */
    author: z.string().nullable(),
    label: z.string().nullable(),
    colour: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("CommentRow")

/** A take row with what sorts it. */
export type Loaded = TakeRow & { number: number; shown_at: string | null; trashed_at: string | null }

/** Newest first: by the rehearsal's day, then the take's number. */
export const newest = (a: Loaded, b: Loaded) =>
  b.date.localeCompare(a.date) || b.number - a.number || (b.shown_at ?? "").localeCompare(a.shown_at ?? "")

/** The take the band likes best: most members' stars, newest on a tie; with none, the newest. */
export const best = (rows: Loaded[]) =>
  rows.length ? [...rows].sort((a, b) => b.stars.length - a.stars.length || newest(a, b))[0] : null

export const bare = ({ number: _n, shown_at: _s, trashed_at: _t, ...row }: Loaded): TakeRow => row

/**
 * The takes the band sees that `where` picks, newest first, as rows for
 * `me`: their stars, marks, and whether each is new for `me`.
 */
export async function takeRows(db: Database, me: string, where?: SQL): Promise<Loaded[]> {
  const takes = await db
    .select({
      uid: take.uid,
      name: take.name,
      songId: take.songId,
      number: take.number,
      durationSec: take.durationSec,
      starredAtRehearsal: take.starredAtRehearsal,
      shownAt: take.shownAt,
      trashedAt: take.trashedAt,
      date: rehearsal.date,
    })
    .from(take)
    .innerJoin(rehearsal, eq(take.rehearsalUid, rehearsal.uid))
    .where(and(isNotNull(take.shownGen), where))
  if (!takes.length) return []
  const [stars, marks, mine] = await db.batch([
    db
      .select({ takeUid: star.takeUid, memberId: user.id, name: user.name, email: user.email })
      .from(star)
      .innerJoin(user, eq(star.memberId, user.id))
      .orderBy(user.name, user.email),
    db
      .select({ takeUid: comment.takeUid, count: sql<number>`count(*)` })
      .from(comment)
      .where(and(eq(comment.fromReha, true), isNull(comment.parentId)))
      .groupBy(comment.takeUid),
    db.select({ takeUid: seen.takeUid }).from(seen).where(eq(seen.memberId, me)),
  ])
  const starsOf = new Map<string, z.infer<typeof Star>[]>()
  for (const s of stars)
    starsOf.set(s.takeUid, [
      ...(starsOf.get(s.takeUid) ?? []),
      { member_id: s.memberId, initial: initial(s.name, s.email), name: shownName(s.name, s.email) },
    ])
  const marksOf = new Map(marks.map((m) => [m.takeUid, Number(m.count)]))
  const opened = new Set(mine.map((s) => s.takeUid))
  return takes
    .map((t) => ({
      uid: t.uid,
      name: t.name,
      song_id: t.songId,
      date: t.date,
      duration_sec: t.durationSec,
      marks: marksOf.get(t.uid) ?? 0,
      stars: starsOf.get(t.uid) ?? [],
      starred_at_rehearsal: t.starredAtRehearsal,
      is_new: !opened.has(t.uid),
      number: t.number,
      shown_at: t.shownAt,
      trashed_at: t.trashedAt,
    }))
    .sort(newest)
}

/** A song's row for the list, from its takes (newest first). */
export function songRow(id: number | "not-named", title: string, rows: Loaded[]): SongRow & { last: Loaded } {
  const top = best(rows)
  return {
    id,
    title,
    takes: rows.length,
    last_date: rows[0].date,
    best: top && bare(top),
    has_new: rows.some((r) => r.is_new),
    last: rows[0],
  }
}

/** The songs' titles by id. */
export async function songTitles(db: Database) {
  return new Map((await db.select().from(song)).map((s) => [s.id, s.title]))
}

/**
 * Comments new for `me`: by someone else, on a take `me` has opened, made
 * after `me` last opened it. A take not opened yet is new itself.
 */
export async function newComments(db: Database, me: string) {
  const rows = await db
    .select({
      id: comment.id,
      takeUid: comment.takeUid,
      takeName: take.name,
      at: comment.at,
      text: comment.text,
      fromReha: comment.fromReha,
      name: user.name,
      email: user.email,
      label: comment.label,
      colour: comment.colour,
      createdAt: comment.createdAt,
    })
    .from(comment)
    .innerJoin(take, eq(comment.takeUid, take.uid))
    .innerJoin(seen, and(eq(seen.takeUid, comment.takeUid), eq(seen.memberId, me)))
    .leftJoin(user, eq(comment.memberId, user.id))
    .where(
      and(
        isNotNull(take.shownGen),
        isNull(take.trashedAt),
        or(isNull(comment.memberId), ne(comment.memberId, me)),
        gt(comment.createdAt, seen.seenAt)
      )
    )
    .orderBy(desc(comment.createdAt))
  return rows.map((c) => ({
    id: c.id,
    take_uid: c.takeUid,
    take_name: c.takeName,
    at: c.at,
    text: c.text,
    author: c.fromReha || c.name === null ? null : shownName(c.name, c.email ?? ""),
    label: c.label,
    colour: c.colour,
    created_at: c.createdAt,
  }))
}
