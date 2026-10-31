import { OpenAPIHono, z } from "@hono/zod-openapi"
import type { AppEnv } from "./env"

/** What every error answer looks like. */
export const ErrorSchema = z.object({ error: z.string() }).openapi("Error")

const WORDS: Record<number, string> = {
  400: "Not as the service expects",
  401: "Not signed in, or the key does not work",
  403: "Only the owner can do this",
  404: "Not there",
  409: "Already there",
  426: "РЭХА is too old for the service",
}

/** The error answers a route can give, for its description. */
export function errors<C extends keyof typeof WORDS & number>(...codes: C[]) {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      { description: WORDS[code], content: { "application/json": { schema: ErrorSchema } } },
    ])
  ) as Record<C, { description: string; content: { "application/json": { schema: typeof ErrorSchema } } }>
}

/** A JSON answer or body with this schema. */
export const json = <T extends z.ZodType>(schema: T, description = "Done") => ({
  description,
  content: { "application/json": { schema } },
})

export const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
})

export const Ok = z.object({ ok: z.literal(true) }).openapi("Ok")

/**
 * A feature's routes. What comes in is checked by the routes' zod schemas;
 * what fails a check is answered 400 with the schema's own words.
 */
export function newApp() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? WORDS[400] }, 400)
    },
  })
}

/** The head of /api/openapi.json. */
export const DOC = {
  openapi: "3.1.0",
  info: { title: "The band service", version: "1" },
} as const
