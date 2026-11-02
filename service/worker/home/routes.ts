import { createRoute, z } from "@hono/zod-openapi"
import { eq, isNotNull, isNull, sql } from "drizzle-orm"
import { loadMarks, lastWord, MarkView } from "../marks/view"
import { database, type Database } from "../shared/db"
import { errors, json, newApp } from "../shared/openapi"
import { apikey, band, rehearsal, song, status, take, user } from "../shared/schema"
import { needMember } from "../signin/guards"
import { bare, best, live, newest, played, takeRows, TakeRow, type Loaded } from "../takes/rows"

/** Home's Latest marks: this many. */
const LATEST = 5
/** A favourite has stars from at least this many members. */
const FAVOURITE = 2
/** Home's favourites: the latest this many. */
const FAVOURITES = 5

const Steps = z
  .object({ named: z.boolean(), key: z.boolean(), members: z.boolean(), rehearsal: z.boolean() })
  .openapi("FirstSteps")

const HomeSong = z
  .object({
    id: z.number(),
    title: z.string(),
    takes: z.number(),
    last_date: z.string(),
    best: TakeRow,
  })
  .openapi("HomeSong")

const LastRehearsal = z
  .object({
    uid: z.string(),
    date: z.string(),
    /** Its takes in the order they were played. */
    takes: z.array(TakeRow),
  })
  .openapi("LastRehearsal")

const count = async (db: Database, table: typeof user | typeof apikey) =>
  Number((await db.select({ n: sql<number>`count(*)` }).from(table))[0].n)

/** The owner's four first steps while the band has no take yet; null after, and for a member. */
async function steps(db: Database, owner: boolean): Promise<z.infer<typeof Steps> | null> {
  if (!owner) return null
  const [any] = await db.select({ uid: take.uid }).from(take).where(isNotNull(take.shownGen)).limit(1)
  if (any) return null
  const [[row], keys, people] = await Promise.all([db.select({ name: band.name }).from(band).limit(1), count(db, apikey), count(db, user)])
  return { named: Boolean(row?.name), key: keys > 0, members: people > 1, rehearsal: false }
}

/**
 * Every song with takes, the most recently played first, but the songs in
 * the last status (Archive) when the band has more than one: Songs keeps
 * those folded too.
 */
function homeSongs(rows: Loaded[], titles: Map<number, string>, archived: Set<number>): z.infer<typeof HomeSong>[] {
  const bySong = new Map<number, Loaded[]>()
  for (const r of rows) if (r.song_id !== null && !archived.has(r.song_id)) bySong.set(r.song_id, [...(bySong.get(r.song_id) ?? []), r])
  // The song played last first: by the day, then the order of the evening.
  return [...bySong.entries()]
    .sort(([, a], [, b]) => newest(a[0], b[0]))
    .map(([id, takes]) => ({ id, title: titles.get(id) ?? "", takes: takes.length, last_date: takes[0].date, best: bare(best(takes)!) }))
}

/** The rehearsal of the newest take, with its takes as they were played. */
async function lastRehearsal(db: Database, rows: Loaded[]): Promise<z.infer<typeof LastRehearsal> | null> {
  if (!rows.length) return null
  const uid = rows[0].rehearsal_uid
  const [r] = await db.select({ date: rehearsal.date }).from(rehearsal).where(eq(rehearsal.uid, uid)).limit(1)
  return { uid, date: r?.date ?? rows[0].date, takes: rows.filter((t) => t.rehearsal_uid === uid).sort(played).map(bare) }
}

/** The songs in the band's last status, when it has more than one. */
function archivedSongs(songs: { id: number; statusId: number | null }[], statuses: { id: number; position: number }[]) {
  if (statuses.length < 2) return new Set<number>()
  const last = [...statuses].sort((a, b) => b.position - a.position)[0].id
  return new Set(songs.filter((s) => s.statusId === last).map((s) => s.id))
}

/** Home: the last rehearsal, the songs, the latest marks, the band's favourites. */
export const homeRoutes = newApp().openapi(
  createRoute({
    method: "get",
    path: "/api/home",
    middleware: [needMember] as const,
    responses: {
      200: json(
        z
          .object({
            steps: Steps.nullable(),
            last_rehearsal: LastRehearsal.nullable(),
            songs: z.array(HomeSong),
            latest_marks: z.array(MarkView),
            /** The latest favourites, newest first. */
            favourites: z.array(TakeRow),
            /** Every favourite the band has. */
            favourite_count: z.number(),
          })
          .openapi("Home")
      ),
      ...errors(401),
    },
  }),
  async (c) => {
    const db = database(c.env)
    const me = c.var.member.id
    const [rows, marks, songs, statuses, first] = await Promise.all([
      takeRows(c.env, live()),
      loadMarks(db, me, isNull(take.trashedAt)),
      db.select({ id: song.id, title: song.title, statusId: song.statusId }).from(song),
      db.select({ id: status.id, position: status.position }).from(status),
      steps(db, c.var.member.owner),
    ])
    const favourites = rows.filter((r) => r.stars.length >= FAVOURITE)
    const latest = [...marks].sort((a, b) => lastWord(b).localeCompare(lastWord(a)) || b.id - a.id).slice(0, LATEST)
    return c.json(
      {
        steps: first,
        last_rehearsal: await lastRehearsal(db, rows),
        songs: homeSongs(rows, new Map(songs.map((s) => [s.id, s.title])), archivedSongs(songs, statuses)),
        latest_marks: latest,
        favourites: favourites.slice(0, FAVOURITES).map(bare),
        favourite_count: favourites.length,
      },
      200
    )
  }
)
