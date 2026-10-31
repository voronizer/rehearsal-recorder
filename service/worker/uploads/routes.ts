import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { eq } from "drizzle-orm"
import { database } from "../shared/db"
import type { AppEnv } from "../shared/env"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok, RehaHeaders } from "../shared/openapi"
import { take } from "../shared/schema"
import { needKey } from "../signin/guards"
import { fileNames } from "../takes/meta"

/** A part is 10 MiB; the last part of a file may be smaller. */
export const PART_BYTES = 10 * 1024 * 1024

const NOT_IN_TAKE = "This file is not part of the take as sent"
const GONE = "This upload is gone: send the file again from the start"

const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  peaks: "application/json",
  mid: "audio/midi",
}

/** `gone` is set for an upload R2 no longer has. */
const Gone = z.object({ error: z.string(), gone: z.literal(true).optional() }).openapi("Gone")

const File = z.object({ gen: z.int().min(1), name: z.string() })
const Params = z.object({ uid: z.uuid() })
const UploadParams = Params.extend({ upload_id: z.string().min(1) })

/** R2's own words for an upload it no longer has. */
const isGone = (e: unknown) => e instanceof Error && /NoSuchUpload|10024/.test(e.message)

/**
 * The take's R2 key for one of its files, or an error answer: the take must
 * exist, and the file must be one its details list for that generation.
 */
async function fileKey(c: Context<AppEnv>, uid: string, gen: number, name: string) {
  const [row] = await database(c.env).select().from(take).where(eq(take.uid, uid)).limit(1)
  if (!row) return { error: fail(c, 404, "No such take") }
  if (gen !== row.gen || !fileNames(row).has(name)) return { error: fail(c, 400, NOT_IN_TAKE) }
  return { key: `takes/${uid}/${gen}/${name}` }
}

const gone = (c: Context<AppEnv>) => c.json({ error: GONE, gone: true as const }, 404)

/** A take's files go up through R2's multipart API: start, parts, done. */
export const uploadRoutes = newApp()
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/takes/{uid}/files",
      middleware: [needKey] as const,
      security: [{ rehaKey: [] }],
      request: {
        headers: RehaHeaders,
        params: Params,
        body: body(File.extend({ size: z.int().min(0) })),
      },
      responses: {
        200: json(z.object({ upload_id: z.string() }), "An upload, to send the file's parts to"),
        ...errors(400, 401, 404, 426),
      },
    }),
    async (c) => {
      const { gen, name } = c.req.valid("json")
      const found = await fileKey(c, c.req.valid("param").uid, gen, name)
      if (found.error) return found.error
      const contentType = TYPES[name.slice(name.lastIndexOf(".") + 1)] ?? "application/octet-stream"
      const upload = await c.env.FILES.createMultipartUpload(found.key, { httpMetadata: { contentType } })
      return c.json({ upload_id: upload.uploadId }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/reha/takes/{uid}/files/{upload_id}/{part}",
      middleware: [needKey] as const,
      security: [{ rehaKey: [] }],
      request: {
        headers: RehaHeaders,
        params: UploadParams.extend({ part: z.coerce.number().int().min(1).max(10000) }),
        query: z.object({ gen: z.coerce.number().int().min(1), name: z.string() }),
        body: {
          required: true,
          content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
        },
      },
      responses: {
        200: json(z.object({ etag: z.string() }), "The part is up"),
        404: json(Gone, "No such take, or the upload is gone"),
        413: json(z.object({ error: z.string() }), "The part is over 10 MiB"),
        ...errors(400, 401, 426),
      },
    }),
    async (c) => {
      const { uid, upload_id, part } = c.req.valid("param")
      const { gen, name } = c.req.valid("query")
      const tooBig = () => c.json({ error: "A part is at most 10 MiB" }, 413)
      if (Number(c.req.header("Content-Length") ?? 0) > PART_BYTES) return tooBig()
      const found = await fileKey(c, uid, gen, name)
      if (found.error) return found.error
      const bytes = await c.req.arrayBuffer()
      if (bytes.byteLength > PART_BYTES) return tooBig()
      try {
        const up = await c.env.FILES.resumeMultipartUpload(found.key, upload_id).uploadPart(part, bytes)
        return c.json({ etag: up.etag }, 200)
      } catch (e) {
        if (isGone(e)) return gone(c)
        throw e
      }
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/takes/{uid}/files/{upload_id}/done",
      middleware: [needKey] as const,
      security: [{ rehaKey: [] }],
      request: {
        headers: RehaHeaders,
        params: UploadParams,
        body: body(File.extend({ parts: z.array(z.tuple([z.int().min(1), z.string()])).min(1) })),
      },
      responses: {
        200: json(Ok, "The file is whole"),
        404: json(Gone, "No such take, or the upload is gone"),
        ...errors(400, 401, 426),
      },
    }),
    async (c) => {
      const { uid, upload_id } = c.req.valid("param")
      const { gen, name, parts } = c.req.valid("json")
      const found = await fileKey(c, uid, gen, name)
      if (found.error) return found.error
      try {
        await c.env.FILES.resumeMultipartUpload(found.key, upload_id).complete(
          parts.map(([partNumber, etag]) => ({ partNumber, etag }))
        )
      } catch (e) {
        if (isGone(e)) return gone(c)
        throw e
      }
      return c.json({ ok: true as const }, 200)
    }
  )
