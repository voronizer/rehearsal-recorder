import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNotNull } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { errors, newApp } from "../shared/openapi"
import { take } from "../shared/schema"
import { needMember } from "../signin/guards"

/** “Viasna 12 - Bass.flac”, with a plain-letters copy for browsers that need one. */
function disposition(file: string): string {
  const plain = file.replace(/[^\x20-\x7e]|["\\]/g, "_")
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(file)}`
}

/**
 * A take's file from R2, to a signed-in member only, in pieces (`Range`)
 * for the player. `?download=1` names it after the take and the track.
 */
export const fileRoutes = newApp().openapi(
  createRoute({
    method: "get",
    path: "/files/{uid}/{gen}/{name}",
    middleware: [needMember] as const,
    request: {
      params: z.object({ uid: z.uuid(), gen: z.coerce.number().int().min(1), name: z.string() }),
      query: z.object({ download: z.literal("1").optional() }),
    },
    responses: {
      200: { description: "The file", content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
      206: { description: "A piece of the file", content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
      ...errors(401, 404),
    },
  }),
  async (c) => {
    const { uid, gen, name } = c.req.valid("param")
    const [t] = await database(c.env)
      .select()
      .from(take)
      .where(and(eq(take.uid, uid), isNotNull(take.shownGen)))
      .limit(1)
    if (!t) return fail(c, 404, "No such file")
    const ranged = c.req.header("Range") !== undefined
    const object = await c.env.FILES.get(`takes/${uid}/${gen}/${name}`, ranged ? { range: c.req.raw.headers } : {})
    if (!object) return fail(c, 404, "No such file")

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set("ETag", object.httpEtag)
    headers.set("Accept-Ranges", "bytes")
    headers.set("Cache-Control", "private, max-age=86400")
    if (c.req.valid("query").download) {
      const position = Number(name.slice(0, name.indexOf(".")))
      const track = t.tracks.find((k) => k.position === position)?.name ?? t.notes.find((n) => n.position === position)?.name
      headers.set("Content-Disposition", disposition(`${t.name} - ${track ?? position}${name.slice(name.indexOf("."))}`))
    }
    const size = object.size
    if (ranged && object.range) {
      const r = object.range as { offset?: number; length?: number; suffix?: number }
      const length = r.suffix !== undefined ? Math.min(r.suffix, size) : (r.length ?? size - (r.offset ?? 0))
      const start = r.suffix !== undefined ? size - length : (r.offset ?? 0)
      headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${size}`)
      headers.set("Content-Length", String(length))
      return new Response(object.body, { status: 206, headers })
    }
    headers.set("Content-Length", String(size))
    return new Response(object.body, { status: 200, headers })
  }
)
