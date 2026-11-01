import { Hono } from "hono"
import type { AppEnv } from "../shared/env"
import { keptAddresses } from "./addresses"
import type { Parts } from "./auth"
import { normaliseEmail } from "./auth"
import { keptLetters, type KeptLetter } from "./letters"

/**
 * With STAND_INS "on" (wrangler.jsonc's `test` environment), letters and
 * Cloudflare's list are kept here in memory, and /api/stand-ins/* reads
 * them: the page tests and the Worker's tests sign in through them.
 */
const kept = { letters: [] as KeptLetter[], list: new Map<string, boolean>(), log: [] as string[] }

export const standIns: Parts = {
  letters: keptLetters(kept.letters),
  addresses: keptAddresses(kept.list, kept.log),
}

const onlyWithStandIns = async (c: { env: AppEnv["Bindings"]; notFound: () => Response | Promise<Response> }, next: () => Promise<void>) => {
  if (c.env.STAND_INS !== "on") return c.notFound()
  await next()
}

export const standInRoutes = new Hono<AppEnv>()
  .use("/api/stand-ins", onlyWithStandIns)
  .use("/api/stand-ins/*", onlyWithStandIns)
  .get("/api/stand-ins/letters", (c) => c.json(kept.letters))
  .get("/api/stand-ins/addresses", (c) => c.json({ list: Object.fromEntries(kept.list), log: kept.log }))
  // The member presses the button in Cloudflare's letter.
  .post("/api/stand-ins/confirm", async (c) => {
    const { email } = await c.req.json<{ email: string }>()
    kept.list.set(normaliseEmail(email), true)
    return c.json({ ok: true })
  })
  .delete("/api/stand-ins", (c) => {
    kept.letters.length = 0
    kept.list.clear()
    kept.log.length = 0
    return c.json({ ok: true })
  })
