import { createRoute, z } from "@hono/zod-openapi"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { needMember } from "./guards"

const NAME = "A name is 1 to 40 characters"

const Me = z
  .object({
    id: z.string(),
    /** "" until the member gives one. */
    name: z.string(),
    owner: z.boolean(),
  })
  .openapi("Me")

/** The signed-in member: who they are, and the name the band calls them. */
export const meRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/me",
      middleware: [needMember] as const,
      responses: { 200: json(Me), ...errors(401) },
    }),
    (c) => {
      const { id, name, owner } = c.var.member
      return c.json({ id, name, owner }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/me",
      middleware: [needMember] as const,
      request: {
        body: body(z.object({ name: z.string().trim().min(1, { error: NAME }).max(40, { error: NAME }) })),
      },
      responses: { 200: json(Ok), ...errors(400, 401) },
    }),
    async (c) => {
      const { name } = c.req.valid("json")
      await c.var.auth.api.updateUser({ body: { name }, headers: c.req.raw.headers })
      return c.json({ ok: true as const }, 200)
    }
  )
