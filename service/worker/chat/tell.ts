import type { Bindings } from "../shared/env"

/**
 * What the band's chat hears about. `origin` is the service's own address,
 * from the request that made the event, for the links.
 */
export type ChatEvent =
  | { kind: "take"; take_uid: string; origin: string }
  | { kind: "comment"; comment_id: number; origin: string }
  | { kind: "failure"; what: string; detail: string; at: string }

/**
 * Puts an event on the queue; its consumer writes to Telegram, so a
 * Telegram failure is tried again. Without a bot token nothing is put.
 */
export async function tellChat(env: Bindings, event: ChatEvent): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  await env.CHAT.send(event)
}
