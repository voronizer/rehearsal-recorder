import type { Bindings } from "../shared/env"

/**
 * Cloudflare's list of confirmed addresses: a letter goes only to an address
 * on it whose owner pressed the button in Cloudflare's own letter.
 */
export interface AddressList {
  add(email: string): Promise<void>
  remove(email: string): Promise<void>
  confirmed(emails: string[]): Promise<Set<string>>
}

export const NO_TOKEN = "Add the Cloudflare token for addresses first"

export class NoAddressToken extends Error {
  constructor() {
    super(NO_TOKEN)
  }
}

type Address = { id: string; email: string; verified: string | null }

/** The list, through Cloudflare's API, with a token that may only edit it. */
export function cloudflareAddresses(env: Bindings): AddressList {
  const call = async (path: string, init: RequestInit = {}) => {
    if (!env.CF_ACCOUNT_ID || !env.CF_ADDRESSES_TOKEN) throw new NoAddressToken()
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/routing/addresses${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${env.CF_ADDRESSES_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    )
    const body = (await res.json()) as { success: boolean; result: unknown; errors?: unknown }
    if (!res.ok || !body.success)
      throw new Error(`Cloudflare's address list answered ${res.status}: ${JSON.stringify(body.errors)}`)
    return body.result
  }
  // Page by page, until a page comes back short.
  const all = async (): Promise<Address[]> => {
    const out: Address[] = []
    for (let page = 1; ; page++) {
      const rows = (await call(`?page=${page}&per_page=50`)) as Address[]
      out.push(...rows)
      if (rows.length < 50) return out
    }
  }
  return {
    // Cloudflare's list is the account's, so the address may be on it already.
    async add(email) {
      if ((await all()).some((row) => row.email.toLowerCase() === email)) return
      await call("", { method: "POST", body: JSON.stringify({ email }) })
    },
    async remove(email) {
      for (const row of await all())
        if (row.email.toLowerCase() === email) await call(`/${row.id}`, { method: "DELETE" })
    },
    async confirmed(emails) {
      const wanted = new Set(emails)
      return new Set(
        (await all())
          .filter((row) => row.verified && wanted.has(row.email.toLowerCase()))
          .map((row) => row.email.toLowerCase())
      )
    },
  }
}

/**
 * The tests' stand-in. An address is confirmed when a test says so
 * (POST /api/stand-ins/confirm).
 */
export function keptAddresses(list: Map<string, boolean>, log: string[]): AddressList {
  return {
    async add(email) {
      log.push(`add ${email}`)
      list.set(email, list.get(email) ?? false)
    },
    async remove(email) {
      log.push(`remove ${email}`)
      list.delete(email)
    },
    async confirmed(emails) {
      return new Set(emails.filter((e) => list.get(e)))
    },
  }
}
