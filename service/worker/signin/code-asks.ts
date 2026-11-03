import { lte, sql } from "drizzle-orm"
import type { Database } from "../shared/db"
import { codeAsk } from "../shared/schema"
import { now } from "../shared/time"

/** Codes one address may ask for in an hour. */
export const CODES_AN_HOUR = 5
const HOUR = 60 * 60 * 1000

export const TOO_MANY_CODES = "Too many codes for this address. Wait an hour, then press Send code again."

/**
 * Counts a code asked for `email`, and answers whether it may be sent.
 * better-auth's own limit counts by the visitor's IP address, so from many
 * addresses at once someone could fill a member's inbox with codes, or try
 * codes until one fits. With 5 an hour, guessing a 6-digit code would take
 * years. The count starts again an hour after its first code.
 */
export async function mayAskCode(db: Database, email: string): Promise<boolean> {
  const at = now().getTime()
  const stale = sql`${codeAsk.since} <= ${at - HOUR}`
  const [row] = await db
    .insert(codeAsk)
    .values({ email, since: at, count: 1 })
    .onConflictDoUpdate({
      target: codeAsk.email,
      set: {
        count: sql`CASE WHEN ${stale} THEN 1 ELSE ${codeAsk.count} + 1 END`,
        since: sql`CASE WHEN ${stale} THEN ${at} ELSE ${codeAsk.since} END`,
      },
    })
    .returning({ count: codeAsk.count })
  return row.count <= CODES_AN_HOUR
}

/** Once a day: the counts whose hour is over, so addresses typed in once are not kept. */
export async function forgetCodeAsks(db: Database): Promise<void> {
  await db.delete(codeAsk).where(lte(codeAsk.since, now().getTime() - HOUR))
}
