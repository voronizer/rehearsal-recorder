/**
 * What the Worker gets: the bindings wrangler.jsonc names, and the settings
 * each copy sets on its Worker in Cloudflare (none of them is in the code).
 */
export type Settings = {
  /** better-auth signs its cookies with it. */
  BETTER_AUTH_SECRET: string
  /** The owner's address: the first code asked for it makes the owner. */
  OWNER_EMAIL: string
  /** The letters' sender, on a domain with Cloudflare's mail on. */
  LETTERS_FROM: string
  /** For Cloudflare's list of confirmed addresses. */
  CF_ACCOUNT_ID?: string
  CF_ADDRESSES_TOKEN?: string
  /** The bot, the band's chat, and the owner for failures. */
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  OWNER_TELEGRAM_ID?: string
  /** "on" only in wrangler.jsonc's `test` environment. */
  STAND_INS?: string
}

export type Bindings = Omit<Env, keyof Settings> & Settings

/** A member as the routes see them, from their session. */
export type Member = { id: string; email: string; name: string; owner: boolean }

/** What each request carries through Hono. */
export type AppEnv = {
  Bindings: Bindings
  Variables: {
    parts: import("../signin/auth").Parts
    auth: import("../signin/auth").Auth
    member: Member
  }
}
