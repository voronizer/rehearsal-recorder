import { createRoute, z } from "@hono/zod-openapi"
import { errors, json, newApp, Ok } from "../shared/openapi"
import { needKey } from "../signin/guards"

/** What РЭХА sends with every request; its key goes in `x-api-key`. */
export const RehaHeaders = z.object({
  "x-reha-version": z.string().openapi({ example: "0.17.0" }),
})

/** The routes РЭХА calls with its key. */
export const rehaRoutes = newApp().openapi(
  createRoute({
    method: "get",
    path: "/api/reha/hello",
    description: "РЭХА checks a key when it is pasted.",
    middleware: [needKey] as const,
    security: [{ rehaKey: [] }],
    request: { headers: RehaHeaders },
    responses: { 200: json(Ok), ...errors(401, 426) },
  }),
  (c) => c.json({ ok: true as const }, 200)
)
