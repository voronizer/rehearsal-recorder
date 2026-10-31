/** What the band's chat needs from Telegram. */
export interface Telegram {
  /** Sends a message and answers its id. */
  send(chatId: string, text: string): Promise<number>
  edit(chatId: string, messageId: number, text: string): Promise<void>
}

/** The Bot API: HTML text, link previews off. */
export function botApi(token: string): Telegram {
  const call = async (method: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
    })
    const answer = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string }
    if (!answer.ok) throw new Error(`Telegram ${method}: ${answer.description ?? res.status}`)
    return answer.result
  }
  return {
    async send(chatId, text) {
      return (await call("sendMessage", { chat_id: chatId, text }))!.message_id
    },
    async edit(chatId, messageId, text) {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text })
    },
  }
}

export type KeptMessage = { chat: string; id: number; text: string; edited: boolean }

/** The stand-in, with STAND_INS on: messages kept in memory. */
export function keptTelegram(kept: KeptMessage[]): Telegram {
  return {
    async send(chat, text) {
      const id = kept.length + 1
      kept.push({ chat, id, text, edited: false })
      return id
    },
    async edit(chat, id, text) {
      const message = kept.find((m) => m.chat === chat && m.id === id)
      if (message) Object.assign(message, { text, edited: true })
    },
  }
}
