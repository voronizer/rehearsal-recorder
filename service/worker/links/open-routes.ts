import { createRoute, z } from "@hono/zod-openapi"
import { asc, eq, sql } from "drizzle-orm"
import type { Context } from "hono"
import { downloadName } from "../files/routes"
import { serveFile } from "../files/serve"
import { LabelView } from "../labels/routes"
import type { MarkView } from "../marks/view"
import { database, type Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { fail } from "../shared/errors"
import { Ok, errors, json, newApp } from "../shared/openapi"
import { label, shareLink } from "../shared/schema"
import { iso } from "../shared/time"
import { TakePage, takePage } from "../takes/page"
import { shapeOf } from "../takes/shape"
import { Heard, openLink } from "./store"

/*
  What the person with a link reaches, without signing in: the take's page
  cut down to what the link shows, and the files it allows. A link that is
  closed, past its end, unknown, not ready yet, or whose take is in the
  Trash answers the same 404 everywhere.
*/

export const GONE = "This link no longer works."
/** What a mark's or comment's writer is called where they never gave a name. */
const NAMELESS = "Band member"

export const LinkPage = TakePage.extend({
  link: z.object({
    id: z.string(),
    shows: z.enum(["mix", "tracks", "marks"]),
    download: z.enum(["none", "mix", "all"]),
    /** The maker's levels, M and S; null for a link that shows only the mix. */
    heard: Heard.nullable(),
    /** It plays one MP3, the mix the maker's page made. */
    mix: z.boolean(),
  }),
  /** The band's labels, for the marks' colours; none unless it shows the marks. */
  labels: z.array(LabelView),
}).openapi("LinkPage")
type LinkPage = z.infer<typeof LinkPage>

type LabelView = z.infer<typeof LabelView>
type Open = NonNullable<Awaited<ReturnType<typeof openLink>>>

/** The marks with a stand-in for each member's id, the same member the same
 *  one, so a page tells them apart with no id of the band's in it. */
function withStandIns(marks: MarkView[]): MarkView[] {
  const ids = new Map<string, string>()
  const standIn = (id: string) => {
    if (!ids.has(id)) ids.set(id, `m${ids.size + 1}`)
    return ids.get(id)!
  }
  // shownName and the initial fall back to the address for a member with no name.
  const nameless = (author: string | null) => author !== null && author.includes("@")
  const writer = <W extends { author: string | null; initial: string | null }>(w: W) =>
    nameless(w.author) ? { author: NAMELESS, initial: NAMELESS[0] } : { author: w.author, initial: w.initial }
  return marks.map((m) => ({
    ...m,
    ...writer(m),
    member_id: m.member_id === null ? null : standIn(m.member_id),
    mine: false,
    comments: m.comments.map((c) => ({ ...c, ...(writer(c) as { author: string; initial: string }), member_id: standIn(c.member_id), mine: false })),
  }))
}

/** The band's labels, each with how many of these marks it has. */
async function labelsFor(db: Database, marks: MarkView[]) {
  const rows = await db.select().from(label).orderBy(asc(label.position))
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    colour: l.colour as LabelView["colour"],
    position: l.position,
    marks: marks.filter((m) => m.label_id === l.id).length,
  }))
}
/** A link's page: the take's, with only what the link shows. */
async function linkPage(env: Bindings, db: Database, { link, take: t }: Open): Promise<LinkPage> {
  const mix = link.shows === "mix"
  const page = await takePage(env, db, t, "", mix ? `/files/l/${link.id}` : `/files/l/${link.id}/${t.shownGen}`)
  const marks = link.shows === "marks" ? withStandIns(page.marks) : []
  const common = {
    ...page,
    stars: [],
    starred_by_me: false,
    starred_at_rehearsal: false,
    trashed_at: null,
    marks,
    files: link.download === "all" ? page.files : [],
    flac_coming: link.download === "all" && page.flac_coming,
    labels: marks.length ? await labelsFor(db, marks) : [],
    link: { id: link.id, shows: link.shows, download: link.download, heard: mix ? null : link.heard, mix },
  }
  if (!mix) return common
  const object = await env.FILES.get(`links/${link.id}/mix.peaks`)
  const { peaks } = ((await object?.json().catch(() => ({}))) ?? {}) as { peaks?: number[] }
  return {
    ...common,
    duration_sec: link.mixSec ?? page.duration_sec,
    tracks: [{ position: 1, name: "The mix", icon: null, mp3: `/files/l/${link.id}/mix.mp3`, peaks: `/files/l/${link.id}/mix.peaks`, kind: null }],
    notes: [],
    balance: {},
    gain: 1,
    drift: null,
    meter: null,
    shape: shapeOf(Array.isArray(peaks) ? [peaks] : []),
  }
}

// Any address answers: one that is no link, however long, no longer works.
const Id = z.object({ id: z.string() })
const FILE = {
  304: { description: "The wave is the one the browser has" },
  200: { description: "The file", content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
  206: { description: "A piece of the file", content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
  ...errors(404),
}
const Download = z.object({ download: z.literal("1").optional() })

const gone = (c: Context) => fail(c, 404, GONE)

/** The kinds of file РЭХА sends a take with: `<position>.<mp3|peaks|flac|mid>`. */
const TAKE_FILE = /^\d+\.(mp3|peaks|flac|mid)$/

/** A take's own file, as РЭХА sent it, and of a kind it sends: nothing else its list may name. */
const isTakeFile = (t: Open["take"], name: string) =>
  TAKE_FILE.test(name) && (t.tracks.some((k) => k.files.includes(name)) || t.notes.some((n) => n.file === name))

/** The routes open to whoever has a link's address. */
export const openLinkRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/l/{id}",
      description: "The page of a link to a take, for someone outside the band: what the link shows, without signing in.",
      request: { params: Id },
      responses: { 200: json(LinkPage), ...errors(404) },
    }),
    async (c) => {
      const db = database(c.env)
      const open = await openLink(db, c.req.valid("param").id)
      if (!open) return gone(c)
      return c.json(await linkPage(c.env, db, open), 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/files/l/{id}/{gen}/{name}",
      description:
        "A track's file through a link with tracks, from the generation the band hears: its MP3, wave and MIDI; its FLAC and `?download=1` only when the link lets download everything.",
      request: { params: Id.extend({ gen: z.string(), name: z.string() }), query: Download },
      responses: FILE,
    }),
    async (c) => {
      const { id, gen, name } = c.req.valid("param")
      const download = c.req.valid("query").download !== undefined
      const open = await openLink(database(c.env), id)
      if (!open) return gone(c)
      const { link, take: t } = open
      const everything = link.download === "all"
      if (link.shows === "mix" || gen !== String(t.shownGen) || !isTakeFile(t, name) || ((name.endsWith(".flac") || download) && !everything))
        return fail(c, 404, "No such file")
      return serveFile(c, `takes/${t.uid}/${gen}/${name}`, download ? downloadName(t, name) : undefined)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/files/l/{id}/{name}",
      description: "The mix of a link that shows only the mix, and its wave; `?download=1` on the MP3 when the link lets download it.",
      request: { params: Id.extend({ name: z.string() }), query: Download },
      responses: FILE,
    }),
    async (c) => {
      const { id, name } = c.req.valid("param")
      const download = c.req.valid("query").download !== undefined
      const open = await openLink(database(c.env), id)
      if (!open) return gone(c)
      const ok = name === "mix.mp3" ? !download || open.link.download !== "none" : name === "mix.peaks" && !download
      if (open.link.shows !== "mix" || !ok) return fail(c, 404, "No such file")
      return serveFile(c, `links/${id}/${name}`, download ? `${open.take.name}.mp3` : undefined)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/l/{id}/played",
      description: "One play of the take through the link: its page's first ▶.",
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(404) },
    }),
    async (c) => {
      const db = database(c.env)
      const open = await openLink(db, c.req.valid("param").id)
      if (!open) return gone(c)
      await db
        .update(shareLink)
        .set({ plays: sql`${shareLink.plays} + 1`, lastPlayedAt: iso() })
        .where(eq(shareLink.id, open.link.id))
      return c.json({ ok: true as const }, 200)
    }
  )
