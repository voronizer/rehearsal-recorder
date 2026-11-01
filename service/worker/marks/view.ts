import { z } from "@hono/zod-openapi"
import { aliasedTable, and, asc, eq, isNotNull, isNull, type SQL } from "drizzle-orm"
import type { Database } from "../shared/db"
import { comment, rehearsal, seen, song, take, user } from "../shared/schema"
import { initial, shownName } from "../takes/rows"

/** A comment under a mark. */
export const CommentView = z
  .object({
    id: z.number(),
    author: z.string(),
    initial: z.string(),
    member_id: z.string(),
    text: z.string(),
    created_at: z.string(),
    updated_at: z.string().nullable(),
    /** Yours: you can change it and delete it. */
    mine: z.boolean(),
  })
  .openapi("Comment")

/** A mark: a moment of a take with a label and a note, and the band's comments under it. */
export const MarkView = z
  .object({
    id: z.number(),
    at: z.number(),
    label_id: z.number(),
    note: z.string(),
    /** null for a mark from РЭХА. */
    author: z.string().nullable(),
    initial: z.string().nullable(),
    member_id: z.string().nullable(),
    from_reha: z.boolean(),
    closed: z.boolean(),
    /** It was in the part a crop cut off. */
    cut_off: z.boolean(),
    created_at: z.string(),
    updated_at: z.string().nullable(),
    /** Yours: you can change it and delete it. */
    mine: z.boolean(),
    /** Set or commented on by someone else after you last opened its take. */
    is_new: z.boolean(),
    take: z.object({
      uid: z.string(),
      name: z.string(),
      number: z.number(),
      song_id: z.number().nullable(),
      song_title: z.string().nullable(),
      date: z.string(),
      duration_sec: z.number(),
    }),
    comments: z.array(CommentView),
  })
  .openapi("Mark")

export type MarkView = z.infer<typeof MarkView>

/** When anything last happened to a mark: it was set, or the last comment under it. */
export const lastWord = (m: MarkView) => [m.created_at, ...m.comments.map((c) => c.created_at)].sort().at(-1)!

/**
 * The marks `where` picks, on takes the band can hear, with their comments,
 * for `me`. By take, newest first, then by moment.
 */
export async function loadMarks(db: Database, me: string, where?: SQL): Promise<MarkView[]> {
  const rows = await db
    .select({ mark: comment, take, date: rehearsal.date, title: song.title, name: user.name, email: user.email, seenAt: seen.seenAt })
    .from(comment)
    .innerJoin(take, eq(comment.takeUid, take.uid))
    .innerJoin(rehearsal, eq(take.rehearsalUid, rehearsal.uid))
    .leftJoin(song, eq(take.songId, song.id))
    .leftJoin(user, eq(comment.memberId, user.id))
    .leftJoin(seen, and(eq(seen.takeUid, comment.takeUid), eq(seen.memberId, me)))
    .where(and(isNull(comment.parentId), isNotNull(take.shownGen), where))
  if (!rows.length) return []
  const writer = aliasedTable(user, "writer")
  const under = await db
    .select({ c: comment, name: writer.name, email: writer.email })
    .from(comment)
    .innerJoin(writer, eq(comment.memberId, writer.id))
    // Every comment: a band's are few, and D1 takes 100 values a query at most.
    .where(isNotNull(comment.parentId))
    .orderBy(asc(comment.createdAt), asc(comment.id))
  const others = (at: string, by: string | null, seenAt: string | null) => seenAt !== null && at > seenAt && by !== me
  return rows
    .map(({ mark, take: t, date, title, name, email, seenAt }) => {
      const comments = under.filter((u) => u.c.parentId === mark.id)
      const reha = mark.fromReha || name === null
      return {
        id: mark.id,
        // A mark from a newer generation whose start was put back can be
        // before the start of the one the band still hears: 0:00 till then.
        at: Math.max(0, mark.at),
        label_id: mark.labelId ?? 0,
        note: mark.text,
        author: reha ? null : shownName(name, email ?? ""),
        initial: reha ? null : initial(name, email ?? ""),
        member_id: mark.memberId,
        from_reha: mark.fromReha,
        closed: mark.closed,
        cut_off: mark.cutOff,
        created_at: mark.createdAt,
        updated_at: mark.updatedAt,
        mine: !mark.fromReha && mark.memberId === me,
        is_new:
          others(mark.createdAt, mark.memberId, seenAt) || comments.some((u) => others(u.c.createdAt, u.c.memberId, seenAt)),
        take: {
          uid: t.uid,
          name: t.name,
          number: t.number,
          song_id: t.songId,
          song_title: title,
          date,
          duration_sec: t.durationSec,
        },
        comments: comments.map((u) => ({
          id: u.c.id,
          author: shownName(u.name, u.email),
          initial: initial(u.name, u.email),
          member_id: u.c.memberId!,
          text: u.c.text,
          created_at: u.c.createdAt,
          updated_at: u.c.updatedAt,
          mine: u.c.memberId === me,
        })),
      }
    })
    .sort((a, b) => b.take.date.localeCompare(a.take.date) || b.take.number - a.take.number || a.at - b.at || a.id - b.id)
}
