import { createRoute, z } from "@hono/zod-openapi"
import { isNotNull, isNull, sql } from "drizzle-orm"
import { loadMarks, lastWord, MarkView } from "../marks/view"
import { database, type Database } from "../shared/db"
import { errors, json, newApp } from "../shared/openapi"
import { apikey, band, song, take, user } from "../shared/schema"
import { needMember } from "../signin/guards"
import { bare, best, live, takeRows, TakeRow, type Loaded } from "../takes/rows"

/** Home's Latest marks: this many. */
const LATEST = 5
/** A favourite has stars from at least this many members. */
const FAVOURITE = 2

const Steps = z
  .object({ named: z.boolean(), key: z.boolean(), members: z.boolean(), rehearsal: z.boolean() })
  .openapi("FirstSteps")

const HomeSong = z
  .object({
    id: z.number(),
    title: z.string(),
    takes: z.number(),
    last_date: z.string(),
    /** The takes you have not heard, oldest first: “3 not heard yet” opens the first. */
    unheard: z.array(z.string()),
    best: TakeRow,
  })
  .openapi("HomeSong")

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

/** Every song with takes, the most recently played first. */
function homeSongs(rows: Loaded[], titles: Map<number, string>): z.infer<typeof HomeSong>[] {
  const bySong = new Map<number, Loaded[]>()
  for (const r of rows) if (r.song_id !== null) bySong.set(r.song_id, [...(bySong.get(r.song_id) ?? []), r])
  return [...bySong.entries()]
    .map(([id, takes]) => ({
      id,
      title: titles.get(id) ?? "",
      takes: takes.length,
      last_date: takes[0].date,
      unheard: takes.filter((t) => t.is_new).map((t) => t.uid).reverse(),
      best: bare(best(takes)!),
      newest: takes[0],
    }))
    .sort((a, b) => b.last_date.localeCompare(a.last_date) || (b.newest.shown_at ?? "").localeCompare(a.newest.shown_at ?? ""))
    .map(({ newest: _, ...s }) => s)
}

/** Home: what is new for you, the songs, the latest marks, the band's favourites. */
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
            unheard: z.number(),
            new_marks: z.number(),
            songs: z.array(HomeSong),
            latest_marks: z.array(MarkView),
            favourites: z.array(TakeRow),
          })
          .openapi("Home")
      ),
      ...errors(401),
    },
  }),
  async (c) => {
    const db = database(c.env)
    const me = c.var.member.id
    const [rows, marks, songs, first] = await Promise.all([
      takeRows(c.env, me, live()),
      loadMarks(db, me, isNull(take.trashedAt)),
      db.select({ id: song.id, title: song.title }).from(song),
      steps(db, c.var.member.owner),
    ])
    const latest = [...marks].sort((a, b) => lastWord(b).localeCompare(lastWord(a)) || b.id - a.id).slice(0, LATEST)
    return c.json(
      {
        steps: first,
        unheard: rows.filter((r) => r.is_new).length,
        new_marks: marks.filter((m) => m.is_new).length,
        songs: homeSongs(rows, new Map(songs.map((s) => [s.id, s.title]))),
        latest_marks: latest,
        favourites: rows.filter((r) => r.stars.length >= FAVOURITE).map(bare),
      },
      200
    )
  }
)
