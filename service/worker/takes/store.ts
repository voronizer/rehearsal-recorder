import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { tellChat } from "../chat/tell"
import { database, type Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { labelsFor } from "../labels/match"
import { findSong, songFor } from "../songs/sync"
import { comment, rehearsal, song, take } from "../shared/schema"
import { iso } from "../shared/time"
import type { Drift, TakeMeta } from "./meta"
import { deleteFiles } from "./purge"
import { makeShape } from "./shape"

/** A mark's moment as a key: marks match by `at` rounded to 0.01 s. */
const markKey = (at: number) => Math.round(at * 100)

/**
 * The song a take's details name: by its number, or by its title, made when
 * the band has none (a song РЭХА has no number for yet). Undefined when the
 * details leave the song out; "no song" for a number the service has not.
 */
async function songOf(env: Bindings, meta: TakeMeta): Promise<number | null | undefined | "no song"> {
  const db = database(env)
  if (meta.song_id !== undefined) {
    if (meta.song_id === null) return null
    const [row] = await db.select({ id: song.id }).from(song).where(eq(song.id, meta.song_id)).limit(1)
    return row ? row.id : "no song"
  }
  if (meta.song === undefined) return undefined
  if (meta.song === null) return null
  const found = await findSong(db, meta.song)
  return (found ?? (await songFor(db, meta.song, { tempo: null, signature: null }))).id
}

/**
 * A take РЭХА sent: made or brought up to date, with its rehearsal and song.
 * Details that leave the song out keep the take's song and name: РЭХА sends
 * them only when it changed them, so a ★ does not undo a move made here.
 * Ones that name it end a move made here: РЭХА has numbered the take.
 * Marks from РЭХА replace the earlier ones, matched by their moment, so
 * replies to a mark still there stay; a mark РЭХА no longer sends goes,
 * unless the band talked under it.
 *
 * A take РЭХА removed comes out of the trash. One the band deleted, or one
 * that went with its song, comes out only when it is sent by hand; until
 * then it stays there, its details kept up to date, and the answer says so.
 * It keeps its song meanwhile, so a rename makes no empty song.
 *
 * While a newer generation is on its way, the band still hears the older
 * one, so every comment stays in the older one's time: the new marks are
 * moved on by `cut_start` here, and all of them move back together when the
 * new generation's MP3s are ready.
 */
export async function putTake(
  env: Bindings,
  uid: string,
  meta: TakeMeta
): Promise<{ inTrash: boolean; driftGen: number | null; songId: number | null } | "no song" | "no name"> {
  const db = database(env)
  const [before] = await db.select().from(take).where(eq(take.uid, uid)).limit(1)
  const stays = before?.trashedAt != null && (before.trashedBy !== null || before.withSong) && !meta.by_hand
  const named = stays ? undefined : await songOf(env, meta)
  if (named === "no song") return named
  if (!before && (named === undefined || meta.name === undefined)) return "no name"
  const pending = meta.gen > (before?.shownGen ?? 0)
  const cut = pending ? meta.cut_start : 0
  const fields = {
    rehearsalUid: meta.rehearsal.uid,
    number: meta.number,
    songId: named === undefined ? before!.songId : named,
    name: meta.name ?? before!.name,
    ...(named !== undefined && { movedBy: null }),
    durationSec: meta.duration_sec,
    starredAtRehearsal: meta.starred,
    balance: meta.balance,
    tracks: meta.tracks,
    notes: meta.notes,
    gen: meta.gen,
    ...(meta.meter !== undefined && { meter: meta.meter }),
    ...(meta.peak !== undefined && { peak: meta.peak, peakGen: meta.gen }),
    pendingCut: cut,
    ...(!stays && { trashedAt: null, trashedBy: null, withSong: false }),
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
    // Its song comes out of the trash with it, in the same batch, so a Delete
    // song in between cannot leave the take alone in a song in the trash.
    ...(!stays && fields.songId !== null ? songBack(db, fields.songId) : []),
    ...[...free.values()].filter((id) => !talkedUnder.has(id)).map((id) => db.delete(comment).where(eq(comment.id, id))),
    ...marks.map((m, i) => {
      const id = matched.get(i)
      const row = { text: m.note, labelId: m.labelId }
      return id !== undefined
        ? db.update(comment).set(row).where(eq(comment.id, id))
        : db.insert(comment).values({ ...row, takeUid: uid, at: m.at, fromReha: true, createdAt: iso() })
    }),
  ])
  return { inTrash: stays, driftGen: before?.driftGen ?? null, songId: fields.songId }
}

/**
 * The band's tempo through a take, which РЭХА counts after its files are up.
 * It is kept for the generation it was counted for; one counted for a
 * generation РЭХА has since moved on from is not kept.
 */
export async function putDrift(env: Bindings, uid: string, gen: number, drift: Drift): Promise<"done" | "no take"> {
  const db = database(env)
  const [row] = await db.select({ gen: take.gen }).from(take).where(eq(take.uid, uid)).limit(1)
  if (!row) return "no take"
  if (row.gen === gen) await db.update(take).set({ drift, driftGen: gen }).where(and(eq(take.uid, uid), eq(take.gen, gen)))
  return "done"
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

/**
 * Takes someone deleted in the service go to the trash, at `at`; a take
 * already there stays as it was. `withSong` marks the ones that went with
 * their song, to come back with it.
 */
export function toTrash(db: Database, which: SQL | undefined, by: string, withSong: boolean, at = iso()) {
  return db
    .update(take)
    .set({ trashedAt: at, trashedBy: by, withSong })
    .where(and(which, isNull(take.trashedAt)))
}

/**
 * A song comes out of the trash with one of its takes, the one restored or
 * sent again. The takes that went with it stay in the trash, each on its
 * own line from now on.
 */
export function songBack(db: Database, id: number) {
  return [
    db.update(song).set({ trashedAt: null, trashedBy: null }).where(eq(song.id, id)),
    db.update(take).set({ withSong: false }).where(and(eq(take.songId, id), eq(take.withSong, true))),
  ] as const
}
