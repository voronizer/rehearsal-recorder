import { createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq } from "drizzle-orm"
import type { Context } from "hono"
import { database, type Database } from "../shared/db"
import { fail } from "../shared/errors"
import { errors, json, newApp, Ok } from "../shared/openapi"
import { song, songFile, user } from "../shared/schema"
import { iso } from "../shared/time"
import { needMember } from "../signin/guards"
import { shownName } from "../takes/rows"

/** A song's file is up to 50 MB. */
export const MAX_FILE = 50 * 1024 * 1024
const TOO_BIG = "A file is up to 50 MB"
const NO_FILE = "No such file"

/** What pressing a file does: a Guitar Pro file downloads, a PDF or picture opens in a tab. */
export function kindOf(name: string): "gp" | "pdf" | "picture" | "other" {
  const ext = name.toLowerCase().split(".").at(-1) ?? ""
  if (/^gp[x345]?$/.test(ext)) return "gp"
  if (ext === "pdf") return "pdf"
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "picture"
  return "other"
}

/** The type it is served with: what the browser sent, or what its name says. */
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }

export const FileView = z
  .object({
    id: z.number(),
    name: z.string(),
    kind: z.enum(["gp", "pdf", "picture", "other"]),
    size: z.number(),
    added_by: z.string().nullable(),
    created_at: z.string(),
    url: z.string(),
  })
  .openapi("SongFile")

const key = (songId: number, id: number) => `songs/${songId}/${id}`

export async function fileViews(db: Database, songId: number): Promise<z.infer<typeof FileView>[]> {
  const rows = await db
    .select({ f: songFile, name: user.name, email: user.email })
    .from(songFile)
    .leftJoin(user, eq(songFile.memberId, user.id))
    .where(eq(songFile.songId, songId))
    .orderBy(asc(songFile.createdAt), asc(songFile.id))
  return rows.map(({ f, name, email }) => ({
    id: f.id,
    name: f.name,
    kind: f.kind as ReturnType<typeof kindOf>,
    size: f.size,
    added_by: name === null ? null : shownName(name, email ?? ""),
    created_at: f.createdAt,
    url: `/files/songs/${songId}/${f.id}`,
  }))
}

/** “Viasna words.pdf”, with a plain-letters copy for browsers that need one. */
export function disposition(how: "inline" | "attachment", file: string): string {
  const plain = file.replace(/[^\x20-\x7e]|["\\]/g, "_")
  return `${how}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(file)}`
}

/** The size the request says it carries, or null when it does not say. */
export const sizeOf = (c: Context) => {
  const n = Number(c.req.header("Content-Length"))
  return Number.isFinite(n) && n >= 0 && c.req.header("Content-Length") !== undefined ? n : null
}

const Ids = z.object({ id: z.coerce.number().int().min(1), file: z.coerce.number().int().min(1) })

/** A song's files: added one at a time through the Worker, kept in R2, served to members. */
export const songFileRoutes = newApp()
  .openapi(
    createRoute({
      method: "post",
      path: "/api/songs/{id}/files",
      description: "**Add a file**: the file itself is the body, its name in `x-file-name`, up to 50 MB.",
      middleware: [needMember] as const,
      request: {
        params: z.object({ id: z.coerce.number().int().min(1) }),
        headers: z.object({ "x-file-name": z.string().min(1, { error: "A file needs its name" }) }),
      },
      responses: { 200: json(FileView), ...errors(400, 401, 404, 413) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const name = decodeURIComponent(c.req.valid("header")["x-file-name"]).trim().slice(0, 200)
      if (!name) return fail(c, 400, "A file needs its name")
      const size = sizeOf(c)
      if (size === null) return fail(c, 400, "Send the file's size")
      if (size > MAX_FILE) return fail(c, 413, TOO_BIG)
      const [s] = await db.select({ id: song.id }).from(song).where(eq(song.id, id)).limit(1)
      if (!s) return fail(c, 404, "No such song")
      const ext = name.toLowerCase().split(".").at(-1) ?? ""
      const type = TYPES[ext] ?? c.req.header("Content-Type") ?? "application/octet-stream"
      const [made] = await db
        .insert(songFile)
        .values({ songId: id, name, kind: kindOf(name), type, size, memberId: c.var.member.id, createdAt: iso() })
        .returning({ id: songFile.id })
      try {
        await c.env.FILES.put(key(id, made.id), c.req.raw.body ?? new Uint8Array(), { httpMetadata: { contentType: type } })
      } catch (e) {
        await db.delete(songFile).where(eq(songFile.id, made.id))
        throw e
      }
      const view = (await fileViews(db, id)).find((f) => f.id === made.id)!
      return c.json(view, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/songs/{id}/files/{file}",
      middleware: [needMember] as const,
      request: { params: Ids },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id, file } = c.req.valid("param")
      const gone = await db
        .delete(songFile)
        .where(and(eq(songFile.id, file), eq(songFile.songId, id)))
        .returning({ id: songFile.id })
      if (!gone.length) return fail(c, 404, NO_FILE)
      await c.env.FILES.delete(key(id, file))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/files/songs/{id}/{file}",
      description: "A PDF or a picture opens in the browser; any other file downloads.",
      middleware: [needMember] as const,
      request: { params: Ids },
      responses: {
        200: { description: "The file", content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
        ...errors(401, 404),
      },
    }),
    async (c) => {
      const { id, file } = c.req.valid("param")
      const [row] = await database(c.env)
        .select()
        .from(songFile)
        .where(and(eq(songFile.id, file), eq(songFile.songId, id)))
        .limit(1)
      const object = row && (await c.env.FILES.get(key(id, file)))
      if (!row || !object) return fail(c, 404, NO_FILE)
      const headers = new Headers()
      headers.set("Content-Type", row.type)
      headers.set("Content-Length", String(object.size))
      headers.set("Cache-Control", "private, max-age=3600")
      headers.set("Content-Disposition", disposition(row.kind === "pdf" || row.kind === "picture" ? "inline" : "attachment", row.name))
      return new Response(object.body, { status: 200, headers })
    }
  )
