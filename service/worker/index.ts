import { isAPIError } from "better-auth/api"
import { createMiddleware } from "hono/factory"
import type { AppEnv, Bindings } from "./shared/env"
import { fail } from "./shared/errors"
import { DOC, newApp } from "./shared/openapi"
import { memberRoutes } from "./members/routes"
import { NO_TOKEN, NoAddressToken, cloudflareAddresses } from "./signin/addresses"
import { makeAuth } from "./signin/auth"
import { cloudflareLetters } from "./signin/letters"
import { meRoutes } from "./signin/routes"
import { standInRoutes, standIns } from "./signin/stand-ins"
import { rehaRoutes } from "./takes/reha-routes"
import { purgeTrash } from "./takes/purge"
import { uploadRoutes } from "./uploads/routes"
import { takeRoutes } from "./takes/band-routes"
import { bandRoutes } from "./band/routes"
import { homeRoutes } from "./home/routes"
import { labelRoutes } from "./labels/routes"
import { levelRoutes } from "./levels/routes"
import { markRoutes } from "./marks/routes"
import { rehearsalRoutes } from "./rehearsals/routes"
import { songFileRoutes } from "./songs/files"
import { songRoutes } from "./songs/routes"
import { fileRoutes } from "./files/routes"
import { consumeChat } from "./chat/consume"
import { reportFailure } from "./chat/failures"
import { botApi, keptTelegram, type KeptMessage } from "./chat/telegram"
import type { ChatEvent } from "./chat/tell"

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

/** The settings the service cannot work without (service/README.md, step 7). */
const NEEDED = ["OWNER_EMAIL", "LETTERS_FROM", "BETTER_AUTH_SECRET"] as const

const requestParts = createMiddleware<AppEnv>(async (c, next) => {
  // Without them nobody could sign in, or the first to try could become
  // the owner: say which are missing, to whoever sets the service up.
  const missing = NEEDED.filter((name) => !c.env[name]?.trim())
  if (missing.length) {
    const names = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]
    console.error(`The band service's settings lack ${names}`)
    return fail(c, 500, `The band service is not set up yet: its settings lack ${names}.`)
  }
  const parts =
    c.env.STAND_INS === "on"
      ? standIns
      : { letters: cloudflareLetters(c.env), addresses: cloudflareAddresses(c.env) }
  c.set("parts", parts)
  c.set("auth", makeAuth(c.env, new URL(c.req.url).origin, parts))
  await next()
})
app.use("/api/*", requestParts)
app.use("/files/*", requestParts)

app.on(["GET", "POST"], AUTH_PATHS, (c) => c.var.auth.handler(c.req.raw))

app.openAPIRegistry.registerComponent("securitySchemes", "rehaKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "The secret part of the key, after the last “:”",
})

// The band's picture and a song's files come before a take's files, whose
// path would take theirs.
const routes = app
  .route("/", meRoutes)
  .route("/", memberRoutes)
  .route("/", rehaRoutes)
  .route("/", uploadRoutes)
  .route("/", bandRoutes)
  .route("/", homeRoutes)
  .route("/", rehearsalRoutes)
  .route("/", songRoutes)
  .route("/", songFileRoutes)
  .route("/", labelRoutes)
  .route("/", levelRoutes)
  .route("/", markRoutes)
  .route("/", takeRoutes)
  .route("/", fileRoutes)
  .route("/", standInRoutes)

app.doc31("/api/openapi.json", DOC)

app.notFound((c) => fail(c, 404, "Not there"))

app.onError((err, c) => {
  if (err instanceof NoAddressToken) return fail(c, 400, NO_TOKEN)
  if (isAPIError(err) && err.statusCode >= 400 && err.statusCode < 500)
    return c.json({ error: err.message }, err.statusCode as 400)
  c.executionCtx.waitUntil(reportFailure(c.env, `${c.req.method} ${c.req.routePath}`, err))
  return fail(c, 500, "Something went wrong in the band service")
})

/** With STAND_INS on, the bot's messages are kept here instead. */
const keptMessages: KeptMessage[] = []

export { app }
export type AppType = typeof routes

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    try {
      await purgeTrash(env)
    } catch (e) {
      await reportFailure(env, "emptying the trash", e)
    }
  },
  async queue(batch, env) {
    const telegram = env.STAND_INS === "on" ? keptTelegram(keptMessages) : botApi(env.TELEGRAM_BOT_TOKEN ?? "")
    await consumeChat(batch as MessageBatch<ChatEvent>, env, telegram)
  },
} satisfies ExportedHandler<Bindings>
