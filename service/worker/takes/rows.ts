import { z } from "@hono/zod-openapi"
import { and, asc, eq, isNotNull, isNull, type SQL } from "drizzle-orm"
import { database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { comment, rehearsal, seen, star, take, user } from "../shared/schema"
import { fillShapes } from "./shape"

/** A member's first letter, as the stars show it. */
export const initial = (name: string, email: string) => (Array.from((name || email).trim())[0] ?? "?").toUpperCase()

/** The name the band sees for a member: their own, or their address until they give one. */
export const shownName = (name: string, email: string) => name || email

export const Star = z.object({ member_id: z.string(), initial: z.string(), name: z.string() }).openapi("Star")

/** A take's mark as a list draws it: a tick on its bar, a line under it. */
export const MarkTick = z
  .object({ id: z.number(), at: z.number(), label_id: z.number(), note: z.string(), closed: z.boolean() })
  .openapi("MarkTick")

export const TakeRow = z
  .object({
    uid: z.string(),
    name: z.string(),
    number: z.number(),
    song_id: z.number().nullable(),
    rehearsal_uid: z.string(),
    /** The rehearsal's day. */
    date: z.string(),
    duration_sec: z.number(),
    /** Its wave, 120 values from 0 to 1; empty when РЭХА sent no peaks. */
    shape: z.array(z.number()),
    /** Its marks, by their moment. */
    marks: z.array(MarkTick),
    stars: z.array(Star),
    starred_at_rehearsal: z.boolean(),
    is_new: z.boolean(),
  })
  .openapi("TakeRow")

export type TakeRow = z.infer<typeof TakeRow>

/** A take row with what sorts it. */
export type Loaded = TakeRow & { shown_at: string | null; trashed_at: string | null }

/** Newest first: by the rehearsal's day, then the take's number. */
export const newest = (a: Loaded, b: Loaded) =>
  b.date.localeCompare(a.date) || b.number - a.number || (b.shown_at ?? "").localeCompare(a.shown_at ?? "")

/** The take the band likes best: most members' stars, newest on a tie; with none, the newest. */
export const best = (rows: Loaded[]) =>
  rows.length ? [...rows].sort((a, b) => b.stars.length - a.stars.length || newest(a, b))[0] : null

/** Why the best take is the best: “most stars”, or “latest” when none has any. */
export const bestWhy = (top: Loaded | null) => (top === null ? null : top.stars.length ? ("most stars" as const) : ("latest" as const))

export const bare = ({ shown_at: _s, trashed_at: _t, ...row }: Loaded): TakeRow => row

/**
 * The takes the band sees that `where` picks, newest first, as rows for
 * `me`: their stars, marks, and whether each is new for `me`.
 */
export async function takeRows(env: Bindings, me: string, where?: SQL): Promise<Loaded[]> {
  const db = database(env)
  const takes = await db
    .select({
      uid: take.uid,
      name: take.name,
      songId: take.songId,
      rehearsalUid: take.rehearsalUid,
      number: take.number,
      durationSec: take.durationSec,
      starredAtRehearsal: take.starredAtRehearsal,
      shownAt: take.shownAt,
      trashedAt: take.trashedAt,
      date: rehearsal.date,
      gen: take.shownGen,
      tracks: take.tracks,
      shape: take.shape,
    })
    .from(take)
    .innerJoin(rehearsal, eq(take.rehearsalUid, rehearsal.uid))
    .where(and(isNotNull(take.shownGen), where))
  if (!takes.length) return []
  await fillShapes(env, db, takes.map((t) => Object.assign(t, { gen: t.gen! })))
  const [stars, marks, mine] = await db.batch([
    db
      .select({ takeUid: star.takeUid, memberId: user.id, name: user.name, email: user.email })
      .from(star)
      .innerJoin(user, eq(star.memberId, user.id))
      .orderBy(user.name, user.email),
    db
      .select({ id: comment.id, takeUid: comment.takeUid, at: comment.at, labelId: comment.labelId, text: comment.text, closed: comment.closed })
      .from(comment)
      .where(isNull(comment.parentId))
      .orderBy(asc(comment.at), asc(comment.id)),
    db.select({ takeUid: seen.takeUid }).from(seen).where(eq(seen.memberId, me)),
  ])
  const starsOf = new Map<string, z.infer<typeof Star>[]>()
  for (const s of stars)
    starsOf.set(s.takeUid, [
      ...(starsOf.get(s.takeUid) ?? []),
      { member_id: s.memberId, initial: initial(s.name, s.email), name: shownName(s.name, s.email) },
    ])
  const marksOf = new Map<string, z.infer<typeof MarkTick>[]>()
  for (const m of marks)
    marksOf.set(m.takeUid, [
      ...(marksOf.get(m.takeUid) ?? []),
      { id: m.id, at: Math.max(0, m.at), label_id: m.labelId ?? 0, note: m.text, closed: m.closed },
    ])
  const opened = new Set(mine.map((s) => s.takeUid))
  return takes
    .map((t) => ({
      uid: t.uid,
      name: t.name,
      number: t.number,
      song_id: t.songId,
      rehearsal_uid: t.rehearsalUid,
      date: t.date,
      duration_sec: t.durationSec,
      shape: t.shape ?? [],
      marks: marksOf.get(t.uid) ?? [],
      stars: starsOf.get(t.uid) ?? [],
      starred_at_rehearsal: t.starredAtRehearsal,
      is_new: !opened.has(t.uid),
      shown_at: t.shownAt,
      trashed_at: t.trashedAt,
    }))
    .sort(newest)
}

/** The takes the band hears now: shown, and not in the trash. */
export const live = () => isNull(take.trashedAt)
