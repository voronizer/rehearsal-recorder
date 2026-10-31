import { eq } from "drizzle-orm"
import { database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { failureNotice } from "../shared/schema"
import { iso, now } from "../shared/time"
import type { Telegram } from "./telegram"
import { tellChat } from "./tell"
import { escape, moment } from "./words"

const HOUR = 60 * 60 * 1000

/** Whether Alex was told of a failure of `what` within the hour before `at`. */
async function toldLately(env: Bindings, what: string, at: Date): Promise<boolean> {
  const [told] = await database(env).select().from(failureNotice).where(eq(failureNotice.what, what)).limit(1)
  return Boolean(told && at.getTime() - new Date(told.toldAt).getTime() < HOUR)
}

/**
 * A failure on the server: logged, and told to Alex alone through the bot,
 * once an hour at most for the same `what` (a route or a job). It never
 * throws, so it can be called from any error handler.
 */
export async function reportFailure(env: Bindings, what: string, error: unknown): Promise<void> {
  try {
    console.error(`The band service failed: ${what}`, error)
    if (!env.TELEGRAM_BOT_TOKEN || !env.OWNER_TELEGRAM_ID) return
    const at = now()
    if (await toldLately(env, what, at)) return
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300)
    await tellChat(env, { kind: "failure", what, detail, at: iso(at) })
  } catch (e) {
    console.error("Could not report a failure", e)
  }
}

/** The queue's side: the message to Alex, unless he was told lately. */
export async function tellOwner(
  env: Bindings,
  telegram: Telegram,
  event: { what: string; detail: string; at: string }
): Promise<void> {
  if (!env.OWNER_TELEGRAM_ID) return
  const at = new Date(event.at)
  if (await toldLately(env, event.what, at)) return
  await telegram.send(env.OWNER_TELEGRAM_ID, escape(`The band service failed: ${event.what} at ${moment(at)}. ${event.detail}`))
  await database(env)
    .insert(failureNotice)
    .values({ what: event.what, toldAt: event.at })
    .onConflictDoUpdate({ target: failureNotice.what, set: { toldAt: event.at } })
}
