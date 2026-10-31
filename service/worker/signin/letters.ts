import type { Bindings } from "../shared/env"

/** Where the sign-in letters go. */
export interface Letters {
  send(to: string, subject: string, text: string): Promise<void>
}

/** Cloudflare's Email Service, which sends only to confirmed addresses. */
export function cloudflareLetters(env: Bindings): Letters {
  return {
    async send(to, subject, text) {
      await env.LETTERS.send({ to, from: env.LETTERS_FROM, subject, text })
    },
  }
}

export type KeptLetter = { to: string; subject: string; text: string }

/** The tests' stand-in: letters kept in memory, newest last. */
export function keptLetters(kept: KeptLetter[]): Letters {
  return {
    async send(to, subject, text) {
      kept.push({ to, subject, text })
    },
  }
}
