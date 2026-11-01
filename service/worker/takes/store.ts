import { and, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { tellChat } from "../chat/tell"
import { database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { firstStatus, labelsFor } from "../labels/match"
import { comment, rehearsal, song, take } from "../shared/schema"
import { iso } from "../shared/time"
import type { TakeMeta } from "./meta"
import { deleteFiles } from "./purge"
import { makeShape } from "./shape"

/** A mark's moment as a key: marks match by `at` rounded to 0.01 s. */
const markKey = (at: number) => Math.round(at * 100)

/**
 * The song with this title, whatever its case, made with the first status
 * if there is none. The song's tempo is the one its newest take carries
 * (the latest rehearsal, then the highest number): an older take sent
 * again, from a computer whose РЭХА has an old tempo, leaves it.
 */
async function songId(env: Bindings, uid: string, meta: TakeMeta): Promise<number | null> {
  const { song: title, tempo } = meta
  if (title === null) return null
  const db = database(env)
  await db
    .insert(song)
    .values({ title, statusId: await firstStatus(db), createdAt: iso() })
    .onConflictDoNothing()
  const named = sql`${song.title} = ${title} COLLATE NOCASE`
  const [row] = await db.select({ id: song.id }).from(song).where(named).limit(1)
  if (tempo === undefined) return row.id
  const { date } = meta.rehearsal
  const [newer] = await db
    .select({ uid: take.uid })
    .from(take)
    .innerJoin(rehearsal, eq(take.rehearsalUid, rehearsal.uid))
    .where(
      and(
        eq(take.songId, row.id),
        ne(take.uid, uid),
        or(gt(rehearsal.date, date), and(eq(rehearsal.date, date), gt(take.number, meta.number)))
      )
    )
    .limit(1)
  if (!newer) await db.update(song).set({ tempo }).where(eq(song.id, row.id))
  return row.id
}

/**
 * A take РЭХА sent: made or brought up to date, with its rehearsal and song.
 * A take in the trash comes out of it. Marks from РЭХА replace the earlier
 * ones, matched by their moment, so replies to a mark still there stay; a
 * mark РЭХА no longer sends goes, unless the band talked under it.
 *
 * While a newer generation is on its way, the band still hears the older
 * one, so every comment stays in the older one's time: the new marks are
 * moved on by `cut_start` here, and all of them move back together when the
 * new generation's MP3s are ready.
 */
export async function putTake(env: Bindings, uid: string, meta: TakeMeta): Promise<void> {
  const db = database(env)
  const [before] = await db.select().from(take).where(eq(take.uid, uid)).limit(1)
  const pending = meta.gen > (before?.shownGen ?? 0)
  const cut = pending ? meta.cut_start : 0
  const fields = {
    rehearsalUid: meta.rehearsal.uid,
    number: meta.number,
    songId: await songId(env, uid, meta),
    name: meta.name,
    durationSec: meta.duration_sec,
    starredAtRehearsal: meta.starred,
    balance: meta.balance,
    tracks: meta.tracks,
    notes: meta.notes,
    gen: meta.gen,
    pendingCut: cut,
    trashedAt: null,
    updatedAt: iso(),
  }

  const kept = await db
    .select({ id: comment.id, at: comment.at })
    .from(comment)
    .where(and(eq(comment.takeUid, uid), eq(comment.fromReha, true), isNull(comment.parentId)))
  // A mark the band talked under stays when РЭХА stops sending it, with the talk.
  const talkedUnder = new Set(
    (await db.selectDistinct({ id: comment.parentId }).from(comment).where(and(eq(comment.takeUid, uid), isNotNull(comment.parentId)))).map(
      (c) => c.id
    )
  )
  // A mark is the same mark a hundredth away: РЭХА rounds the crop and the
  // mark each, so one moved by a crop can land a hundredth off. The exact
  // moment goes first, so two marks a hundredth apart keep their own.
  const free = new Map(kept.map((c) => [markKey(c.at), c.id]))
  const labelIds = await labelsFor(db, meta.marks)
  const marks = meta.marks.map((m, i) => ({ ...m, at: m.at + cut, labelId: labelIds[i] }))
  const matched = new Map<number, number>()
  for (const near of [0, -1, 1])
    marks.forEach((m, i) => {
      const key = markKey(m.at) + near
      const id = free.get(key)
      if (matched.has(i) || id === undefined) return
      matched.set(i, id)
      free.delete(key)
    })

  await db.batch([
    db
      .insert(rehearsal)
      .values(meta.rehearsal)
      .onConflictDoUpdate({ target: rehearsal.uid, set: { name: meta.rehearsal.name, date: meta.rehearsal.date } }),
    db
      .insert(take)
      .values({ uid, ...fields })
      .onConflictDoUpdate({ target: take.uid, set: fields }),
    ...[...free.values()].filter((id) => !talkedUnder.has(id)).map((id) => db.delete(comment).where(eq(comment.id, id))),
    ...marks.map((m, i) => {
      const id = matched.get(i)
      const row = { text: m.note, labelId: m.labelId }
      return id !== undefined
        ? db.update(comment).set(row).where(eq(comment.id, id))
        : db.insert(comment).values({ ...row, takeUid: uid, at: m.at, fromReha: true, createdAt: iso() })
    }),
  ])
}

/**
 * Moves the take's comments back by what a crop took off the start. One in
 * the part cut off stays at 0:00, marked.
 */
export function shiftComments(env: Bindings, uid: string, cutStart: number) {
  return database(env)
    .update(comment)
    .set({
      at: sql`max(${comment.at} - ${cutStart}, 0)`,
      cutOff: sql`case when ${comment.at} < ${cutStart} then 1 else ${comment.cutOff} end`,
    })
    .where(eq(comment.takeUid, uid))
}

/**
 * All of a generation's MP3s, or all its FLAC files, are up. The MP3s show
 * the take to the band: a newer generation takes the older one's place, its
 * comments move back by the crops, and the older files go. The band's chat
 * hears of a take the first time it is shown. `ready` for a generation
 * РЭХА has since moved on from does nothing.
 */
export async function ready(
  env: Bindings,
  uid: string,
  gen: number,
  what: "mp3" | "flac",
  origin: string
): Promise<"done" | "no take"> {
  const db = database(env)
  const [row] = await db.select().from(take).where(eq(take.uid, uid)).limit(1)
  if (!row) return "no take"
  if (gen !== row.gen) return "done"
  if (what === "flac") {
    await db.update(take).set({ flacGen: gen }).where(eq(take.uid, uid))
    return "done"
  }
  if (row.shownGen !== null && gen <= row.shownGen) return "done"
  const shape = await makeShape(env.FILES, { uid, gen, tracks: row.tracks })
  await db.batch([
    shiftComments(env, uid, row.pendingCut),
    db
      .update(take)
      .set({
        shownGen: gen,
        shownAt: row.shownAt ?? iso(),
        pendingCut: 0,
        flacGen: row.flacGen === gen ? gen : null,
        shape,
      })
      .where(eq(take.uid, uid)),
  ])
  await deleteFiles(env, `takes/${uid}/`, (key) => Number(key.split("/")[2]) < gen)
  if (row.shownGen === null) await tellChat(env, { kind: "take", take_uid: uid, origin })
  return "done"
}

/** A take deleted in РЭХА goes to the trash, with its comments and stars. */
export async function trash(env: Bindings, uid: string): Promise<void> {
  await database(env)
    .update(take)
    .set({ trashedAt: iso() })
    .where(and(eq(take.uid, uid), isNull(take.trashedAt)))
}
