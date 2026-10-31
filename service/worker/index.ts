import { isAPIError } from "better-auth/api"
import type { Bindings } from "./shared/env"
import { fail } from "./shared/errors"
import { DOC, newApp } from "./shared/openapi"
import { memberRoutes } from "./members/routes"
import { NO_TOKEN, NoAddressToken, cloudflareAddresses } from "./signin/addresses"
import { makeAuth } from "./signin/auth"
import { cloudflareLetters } from "./signin/letters"
import { meRoutes } from "./signin/routes"
import { standInRoutes, standIns } from "./signin/stand-ins"
import { rehaRoutes } from "./takes/reha-routes"

/**
 * better-auth's routes the pages use. Its others (passwords, changing an
 * address, its admin and key routes) are called only from the service's own
 * routes, as server calls, so they are not open to the web.
 */
const AUTH_PATHS = [
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/sign-in/email-otp",
  "/api/auth/sign-out",
  "/api/auth/get-session",
]

const app = newApp()

app.use("/api/*", async (c, next) => {
  const parts =
    c.env.STAND_INS === "on"
      ? standIns
      : { letters: cloudflareLetters(c.env), addresses: cloudflareAddresses(c.env) }
  c.set("parts", parts)
  c.set("auth", makeAuth(c.env, new URL(c.req.url).origin, parts))
  await next()
})

app.on(["GET", "POST"], AUTH_PATHS, (c) => c.var.auth.handler(c.req.raw))

app.openAPIRegistry.registerComponent("securitySchemes", "rehaKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "The secret part of the key, after the last “:”",
})

const routes = app.route("/", meRoutes).route("/", memberRoutes).route("/", rehaRoutes).route("/", standInRoutes)

app.doc31("/api/openapi.json", DOC)

app.notFound((c) => fail(c, 404, "Not there"))

app.onError((err, c) => {
  if (err instanceof NoAddressToken) return fail(c, 400, NO_TOKEN)
  if (isAPIError(err) && err.statusCode >= 400 && err.statusCode < 500)
    return c.json({ error: err.message }, err.statusCode as 400)
  console.error(err)
  return fail(c, 500, "Something went wrong in the band service")
})

export { app }
export type AppType = typeof routes

export default {
  fetch: app.fetch,
  async scheduled() {},
  async queue(batch) {
    batch.ackAll()
  },
} satisfies ExportedHandler<Bindings>
