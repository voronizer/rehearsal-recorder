import { z } from "@hono/zod-openapi"
import { and, eq, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm"
import { database, type Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { shareLink, take, type LinkDownload, type LinkShows } from "../shared/schema"
import { iso, now } from "../shared/time"
import { deleteFiles } from "../takes/purge"

/*
  Links to a take for someone outside the band (#106). A link is open while
  it is ready, has not reached its end, and its take is shown and not in the
  Trash; everything else about it answers as if it never was.
*/

export type Shows = LinkShows
export type Takes = LinkDownload
export type Lasts = "never" | "month" | "week" | "day"

/** The most tracks a take's levels name, and the longest name: far more than a band records. */
const MOST_TRACKS = 64
const TrackName = z.string().max(200)

/** The levels, M and S the maker heard, by track name. */
export const Heard = z
  .object({
    volumes: z
      .record(TrackName, z.number().min(0).max(1))
      .refine((v) => Object.keys(v).length <= MOST_TRACKS, { error: `At most ${MOST_TRACKS} tracks` }),
    muted: z.array(TrackName).max(MOST_TRACKS),
    soloed: z.array(TrackName).max(MOST_TRACKS),
  })
  .openapi("LinkHeard")

/** The letters and digits no one mistakes for another: no I, O, l, 0 or 1. */
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
const LENGTH = 22
/** The bytes below this are an even number of turns of the alphabet. */
const FAIR = 256 - (256 % ALPHABET.length)

/** A new link's id: 22 characters, each as likely as any other, about 128 bits. */
export function newLinkId(): string {
  let id = ""
  while (id.length < LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < FAIR && id.length < LENGTH) id += ALPHABET[b % ALPHABET.length]
    }
  }
  return id
}

const DAY = 24 * 60 * 60 * 1000

/** When a link made at `from` stops working; null for no end. A month is the
 *  same day and time next month, or that month's last day when it has none. */
export function endOf(lasts: Lasts, from: Date): string | null {
  if (lasts === "never") return null
  if (lasts === "day") return iso(new Date(from.getTime() + DAY))
  if (lasts === "week") return iso(new Date(from.getTime() + 7 * DAY))
  const next = new Date(from)
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(from.getUTCDate(), last))
  return iso(next)
}

/** The rule for an open link, in SQL, over `share_link` joined with `take`. */
export const isOpen = () =>
  and(
    eq(shareLink.ready, true),
    or(isNull(shareLink.until), gt(shareLink.until, iso(now()))),
    isNotNull(take.shownGen),
    isNull(take.trashedAt)
  )

/** The link and its take while the link is open; null for any other. */
export async function openLink(
  db: Database,
  id: string
): Promise<{ link: typeof shareLink.$inferSelect; take: typeof take.$inferSelect } | null> {
  const [row] = await db
    .select({ link: shareLink, take })
    .from(shareLink)
    .innerJoin(take, eq(shareLink.takeUid, take.uid))
    .where(and(eq(shareLink.id, id), isOpen()))
    .limit(1)
  return row ?? null
}

/** A link and its mix's files, the files first so none is left that no row finds. */
export async function deleteLink(env: Bindings, id: string): Promise<void> {
  await deleteFiles(env, `links/${id}/`)
  await database(env).delete(shareLink).where(eq(shareLink.id, id))
}

/** Once a day: links past their end, and mix links whose MP3 never came in a
 *  day, go with their files. Answers how many went. */
export async function purgeLinks(env: Bindings): Promise<number> {
  const at = now()
  const gone = await database(env)
    .select({ id: shareLink.id })
    .from(shareLink)
    .where(
      or(
        and(isNotNull(shareLink.until), lte(shareLink.until, iso(at))),
        and(eq(shareLink.ready, false), lt(shareLink.madeAt, iso(new Date(at.getTime() - DAY))))
      )
    )
  for (const { id } of gone) await deleteLink(env, id)
  return gone.length
}

/** A take's links' files, before the take goes for good; its rows go with it. */
export async function deleteTakeLinks(env: Bindings, uid: string): Promise<void> {
  const links = await database(env).select({ id: shareLink.id }).from(shareLink).where(eq(shareLink.takeUid, uid))
  for (const { id } of links) await deleteLink(env, id)
}
