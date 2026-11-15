import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNotNull } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { errors, newApp } from "../shared/openapi"
import { take } from "../shared/schema"
import { needMember } from "../signin/guards"
import { serveFile } from "./serve"

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
      304: { description: "The wave is the one the browser has" },
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
    const download = c.req.valid("query").download ? downloadName(t, name) : undefined
    return serveFile(c, `takes/${uid}/${gen}/${name}`, download)
  }
)

/** A track's file as the browser saves it: “Viasna 12 - Bass.flac”. */
export function downloadName(t: Pick<typeof take.$inferSelect, "name" | "tracks" | "notes">, name: string): string {
  const position = Number(name.slice(0, name.indexOf(".")))
  const track = t.tracks.find((k) => k.position === position)?.name ?? t.notes.find((n) => n.position === position)?.name
  return `${t.name} - ${track ?? position}${name.slice(name.indexOf("."))}`
}
