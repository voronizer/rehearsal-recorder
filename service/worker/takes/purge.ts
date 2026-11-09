import { and, eq, isNotNull, lt, notExists, sql } from "drizzle-orm"
import { database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { bandSet, setSong, song, songFile, take } from "../shared/schema"
import { iso, now } from "../shared/time"

/** A take, a song or a set stays in the trash 30 days. */
const TRASH_DAYS = 30
/** Takes and songs deleted in one day's run. Each is a few calls to the
 *  files and the database, and one run of a Worker may make only so many;
 *  the rest wait for the next day. */
const PER_RUN = 20
const DAY = 24 * 60 * 60 * 1000

/** Deletes the objects under `prefix` that `drop` picks, 1000 to a call. */
export async function deleteFiles(env: Bindings, prefix: string, drop: (key: string) => boolean = () => true) {
  let cursor: string | undefined
  do {
    const page = await env.FILES.list({ prefix, cursor })
    const keys = page.objects.map((o) => o.key).filter(drop)
    if (keys.length) await env.FILES.delete(keys)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

/**
 * Once a day, from the Cron Trigger: takes in the trash for more than 30
 * days are deleted for good, with their files, comments and stars, the
 * longest there first and 20 at most. Then songs 30 days in the trash go
 * the same way with their files, once none of their takes is left, and
 * leave their sets. Sets 30 days in the trash go too, all at once: they
 * have no files. Answers how many takes, songs and sets went.
 */
export async function purgeTrash(env: Bindings): Promise<number> {
  const db = database(env)
  const before = iso(new Date(now().getTime() - TRASH_DAYS * DAY))
  const old = await db
    .select({ uid: take.uid })
    .from(take)
    .where(and(isNotNull(take.trashedAt), lt(take.trashedAt, before)))
    .orderBy(take.trashedAt)
    .limit(PER_RUN)
  // One take at a time: its files first, so a take is never left with
  // files nobody can find.
  for (const { uid } of old) {
    await deleteFiles(env, `takes/${uid}/`)
    await db.delete(take).where(eq(take.uid, uid))
  }
  const songs = await db
    .select({ id: song.id })
    .from(song)
    .where(and(isNotNull(song.trashedAt), lt(song.trashedAt, before), notExists(db.select().from(take).where(eq(take.songId, song.id)))))
    .orderBy(song.trashedAt)
    .limit(PER_RUN - old.length)
  for (const { id } of songs) {
    await deleteFiles(env, `songs/${id}/`)
    await db.batch([
      db.delete(songFile).where(eq(songFile.songId, id)),
      db.delete(setSong).where(eq(setSong.songId, id)),
      db.delete(song).where(eq(song.id, id)),
    ])
  }
  const oldSet = and(isNotNull(bandSet.trashedAt), lt(bandSet.trashedAt, before))
  const [, sets] = await db.batch([
    db.delete(setSong).where(sql`${setSong.setId} IN (SELECT ${bandSet.id} FROM ${bandSet} WHERE ${oldSet})`),
    db.delete(bandSet).where(oldSet).returning({ id: bandSet.id }),
  ])
  return old.length + songs.length + sets.length
}
