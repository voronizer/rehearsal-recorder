import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

/** An error the band reads: `{"error": "<words>"}`. */
export const fail = <S extends ContentfulStatusCode>(c: Context, status: S, error: string) =>
  c.json({ error }, status)
