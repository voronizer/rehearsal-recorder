import type { Context } from "hono"
import { fail } from "../shared/errors"

/** “Viasna 12 - Bass.flac”, with a plain-letters copy for browsers that need one. */
export function disposition(file: string): string {
  const plain = file.replace(/[^\x20-\x7e]|["\\]/g, "_")
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(file)}`
}

/**
 * A take's file from R2 under `key`, in pieces (`Range`) for the player. A
 * wave (`.peaks`) is asked again each time and answers 304 while it is the
 * same. With `download`, the browser saves it under that name.
 */
export async function serveFile(c: Context, key: string, download?: string): Promise<Response> {
  const ranged = c.req.header("Range") !== undefined
  const wave = key.endsWith(".peaks")
  // For a wave, R2 itself checks `If-None-Match` and sends no body when it
  // matches. Only that header: R2 answers a failed `If-Match` with no body too.
  const unchanged = c.req.header("If-None-Match")
  const object = await c.env.FILES.get(key, {
    ...(ranged && { range: c.req.raw.headers }),
    ...(wave && unchanged !== undefined && { onlyIf: new Headers({ "If-None-Match": unchanged }) }),
  })
  if (!object) return fail(c, 404, "No such file")

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("ETag", object.httpEtag)
  headers.set("Accept-Ranges", "bytes")
  // A wave can be sent again, so the browser asks each time and gets a 304 while it is the same.
  headers.set("Cache-Control", wave ? "private, no-cache" : "private, max-age=86400")
  if (!("body" in object)) return new Response(null, { status: 304, headers })
  if (download !== undefined) headers.set("Content-Disposition", disposition(download))
  const size = object.size
  if (ranged && object.range) {
    const r = object.range as { offset?: number; length?: number; suffix?: number }
    const start = r.suffix !== undefined ? size - Math.min(r.suffix, size) : (r.offset ?? 0)
    // R2 sends fewer bytes when more are asked than the file has after `start`: say so.
    const length = Math.min(r.suffix ?? r.length ?? size - start, size - start)
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${size}`)
    headers.set("Content-Length", String(length))
    return new Response(object.body, { status: 206, headers })
  }
  headers.set("Content-Length", String(size))
  return new Response(object.body, { status: 200, headers })
}
