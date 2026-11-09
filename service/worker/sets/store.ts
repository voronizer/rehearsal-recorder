import { and, asc, desc, eq, isNull } from "drizzle-orm"
import type { Database } from "../shared/db"
import { same } from "../shared/names"
import { bandSet, setSong, song } from "../shared/schema"
import { iso } from "../shared/time"

/**
 * A set is a name and songs in an order. It is the same set in РЭХА and
 * here by its number, which the service gives and РЭХА keeps, as a song's.
 * Its name and songs change on either side: РЭХА sends its own changes at
 * once and reads the rest at its check, so the change that reaches the
 * service last is what stands. Who changed it here is kept, for РЭХА to say.
 *
 * Two sets in use never share a name, compared as the band would compare
 * them (shared/names.ts). The unique index on the name, which folds only A
 * to Z, catches two requests giving one name at the same moment.
 *
 * A song in the trash keeps its place in its sets, left out of every list
 * until it is restored.
 */

/** As long as РЭХА lets a set's name be (its LABEL_NAME_MAX). */
export const NAME_MAX = 40
export const NAME = `A set's name is 1 to ${NAME_MAX} characters`
export const NO_SET = "No such set"
export const taken = (name: string) => `There is already a set called ${name}.`
export const noSong = (id: number) => `No such song: ${id}`

export type SetRow = typeof bandSet.$inferSelect & { songs: number[] }
/** Why a change is turned down: the answer's code and words. */
export type Refused<C extends 400 | 404 | 409> = { code: C; words: string }
export type SetChange = { name?: string; songs?: number[] }

/** Each song once, at its first place, as РЭХА keeps a set's songs. */
const once = (songs: number[]) => [...new Set(songs)]

/** D1 takes up to 100 values in one statement: 30 rows of 3. */
const chunks = <T>(rows: T[], size = 30) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

/** The unique name turned the write down: another request gave the name a moment before. */
function nameClash(e: unknown) {
  for (let x: unknown = e; x instanceof Error; x = x.cause) if (/UNIQUE constraint failed/.test(x.message)) return true
  return false
}

/** The set, in the trash or not, or undefined. */
export async function findSet(db: Database, id: number) {
  const [s] = await db.select().from(bandSet).where(eq(bandSet.id, id)).limit(1)
  return s
}

/** The set in use with this name, whatever its case, but `except`. */
async function inUse(db: Database, name: string, except?: number) {
  const used = await db.select({ id: bandSet.id, name: bandSet.name }).from(bandSet).where(isNull(bandSet.trashedAt))
  return used.find((s) => s.id !== except && same(s.name, name))
}

/** Why these songs cannot be a set's: the first number the service has no song for. A song in the trash is one it has. */
async function songsRefused(db: Database, songs: number[]): Promise<Refused<400> | null> {
  if (!songs.length) return null
  const known = new Set((await db.select({ id: song.id }).from(song)).map((s) => s.id))
  const unknown = songs.find((id) => !known.has(id))
  return unknown === undefined ? null : { code: 400, words: noSong(unknown) }
}

/**
 * Every set in its order, each with its songs' numbers in their order,
 * songs in the trash left out; the sets in the trash too with `withTrashed`.
 */
export async function listSets(db: Database, { withTrashed = false } = {}): Promise<SetRow[]> {
  const [sets, rows] = await db.batch([
    db
      .select()
      .from(bandSet)
      .where(withTrashed ? undefined : isNull(bandSet.trashedAt))
      .orderBy(asc(bandSet.position), asc(bandSet.id)),
    db
      .select({ setId: setSong.setId, songId: setSong.songId })
      .from(setSong)
      .innerJoin(song, eq(setSong.songId, song.id))
      .where(isNull(song.trashedAt))
      .orderBy(asc(setSong.position)),
  ])
  return sets.map((s) => ({ ...s, songs: rows.filter((r) => r.setId === s.id).map((r) => r.songId) }))
}

/**
 * What gives set `id` the songs `next`, in their order, or null when it has
 * them already. A song in the trash that `next` leaves out stays where it
 * was among the others: whoever sent `next` could not see it, and it is
 * back in its place when restored.
 */
async function newSongs(db: Database, id: number, next: number[]) {
  const old = await db
    .select({ songId: setSong.songId, trashedAt: song.trashedAt })
    .from(setSong)
    .innerJoin(song, eq(setSong.songId, song.id))
    .where(eq(setSong.setId, id))
    .orderBy(asc(setSong.position))
  const wanted = once(next)
  const hidden = new Set(old.filter((r) => r.trashedAt !== null && !wanted.includes(r.songId)).map((r) => r.songId))
  const shown = old.filter((r) => !hidden.has(r.songId)).map((r) => r.songId)
  if (shown.length === wanted.length && shown.every((s, i) => s === wanted[i])) return null
  const queue = [...wanted]
  const all = old.flatMap((r) => (hidden.has(r.songId) ? [r.songId] : queue.length ? [queue.shift()!] : []))
  all.push(...queue)
  const rows = all.map((songId, position) => ({ setId: id, songId, position }))
  return [db.delete(setSong).where(eq(setSong.setId, id)), ...chunks(rows).map((c) => db.insert(setSong).values(c))]
}

/**
 * A new set at the end of the list, with these songs; `by` the member who
 * made it, null for РЭХА. Null when a set in use has the name: one a
 * request running at the same time gave it a moment before.
 */
export async function makeSet(db: Database, name: string, songs: number[], by: string | null): Promise<number | null> {
  const [last] = await db.select({ position: bandSet.position }).from(bandSet).orderBy(desc(bandSet.position)).limit(1)
  const [made] = await db
    .insert(bandSet)
    .values({ name, position: (last?.position ?? -1) + 1, createdAt: iso(), madeBy: by, changedBy: by })
    .onConflictDoNothing()
    .returning({ id: bandSet.id })
  if (!made) return null
  const rows = once(songs).map((songId, position) => ({ setId: made.id, songId, position }))
  if (rows.length) await db.batch(chunks(rows).map((c) => db.insert(setSong).values(c)) as never)
  return made.id
}

/** **New set** in the service, with no songs, by member `by`; turned down when a set in use has the name. */
export async function makeBandSet(db: Database, name: string, by: string): Promise<Refused<409> | { id: number }> {
  const clash = await inUse(db, name)
  if (clash) return { code: 409, words: taken(clash.name) }
  const id = await makeSet(db, name, [], by)
  return id === null ? { code: 409, words: taken((await inUse(db, name))?.name ?? name) } : { id }
}

/**
 * Set `s` renamed, given new songs, or both; `by` the member, null for
 * РЭХА. Turned down whole when either part cannot be: a song the service
 * does not have, or a name another set in use has. A set in the trash
 * takes the change and stays there; its name is looked at on Restore.
 */
export async function changeSet(
  db: Database,
  s: typeof bandSet.$inferSelect,
  change: SetChange,
  by: string | null
): Promise<Refused<400 | 409> | null> {
  const refused = change.songs ? await songsRefused(db, change.songs) : null
  if (refused) return refused
  const renamed = change.name !== undefined && change.name !== s.name
  const clash = renamed && s.trashedAt === null ? await inUse(db, change.name!, s.id) : undefined
  if (clash) return { code: 409, words: taken(clash.name) }
  const songs = change.songs ? await newSongs(db, s.id, change.songs) : null
  if (!renamed && !songs) return null
  try {
    await db.batch([
      db
        .update(bandSet)
        .set({ ...(renamed && { name: change.name }), changedBy: by })
        .where(eq(bandSet.id, s.id)),
      ...(songs ?? []),
    ])
  } catch (e) {
    if (!nameClash(e)) throw e
    return { code: 409, words: taken((await inUse(db, change.name!, s.id))?.name ?? change.name!) }
  }
  return null
}

/** **Delete set**: to the trash, at most once; `by` the member, null for РЭХА. */
export async function trashSet(db: Database, id: number, by: string | null) {
  await db
    .update(bandSet)
    .set({ trashedAt: iso(), trashedBy: by })
    .where(and(eq(bandSet.id, id), isNull(bandSet.trashedAt)))
}

/** **Restore** on a set: back in its place, unless a set in use has taken its name meanwhile. */
export async function restoreSet(db: Database, id: number): Promise<Refused<404 | 409> | null> {
  const s = await findSet(db, id)
  if (!s?.trashedAt) return { code: 404, words: "This set is not in the trash" }
  const clash = await inUse(db, s.name)
  if (clash) return { code: 409, words: taken(clash.name) }
  try {
    await db.update(bandSet).set({ trashedAt: null, trashedBy: null }).where(eq(bandSet.id, id))
  } catch (e) {
    if (!nameClash(e)) throw e
    return { code: 409, words: taken((await inUse(db, s.name))?.name ?? s.name) }
  }
  return null
}

/** A set as РЭХА sends it: its name, and its songs' numbers in order. */
export type RehaSet = { name: string; songs: number[] }

/**
 * A set made in РЭХА: the set in use with its name, whatever its case,
 * which takes РЭХА's spelling and songs; otherwise a new one at the end.
 * Its number either way, so a second ask after a lost answer gets the same.
 * The songs are looked at first.
 */
async function rehaSet(db: Database, sent: RehaSet): Promise<number> {
  let found = await inUse(db, sent.name)
  if (!found) {
    const id = await makeSet(db, sent.name, sent.songs, null)
    if (id !== null) return id
    // A request running at the same time made it a moment before: it is that set.
    found = (await inUse(db, sent.name))!
  }
  await changeSet(db, (await findSet(db, found.id))!, sent, null)
  return found.id
}

/** A set made in РЭХА, as `rehaSet`; refused when one of its songs is not the service's. */
export async function makeRehaSet(db: Database, sent: RehaSet): Promise<Refused<400> | { id: number }> {
  return (await songsRefused(db, sent.songs)) ?? { id: await rehaSet(db, sent) }
}

/**
 * РЭХА's first check with this service: each of its sets gets its number,
 * in the same order. A set in use with the name is that set, and takes
 * РЭХА's spelling and songs: before numbers, only РЭХА changed them. A set
 * that matches nothing is made; one in the trash is left there. Asked again
 * after an answer that never came, it gives the same numbers. Nothing is
 * kept when one set's songs are refused.
 */
export async function linkSets(db: Database, sets: RehaSet[]): Promise<Refused<400> | { ids: number[] }> {
  const twice = sets.find((s, i) => sets.some((o, j) => j > i && same(o.name, s.name)))
  if (twice) return { code: 400, words: `Two of the sets are called ${twice.name}` }
  const refused = await songsRefused(db, sets.flatMap((s) => s.songs))
  if (refused) return refused
  const ids: number[] = []
  for (const s of sets) ids.push(await rehaSet(db, s))
  return { ids }
}
