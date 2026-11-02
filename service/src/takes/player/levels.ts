import type { TakePage } from "../../api"

/** A track's level: yours if you have kept one for its name, else РЭХА's balance, else 1. */
export const levelOf = (yours: Record<string, number> | undefined, take: TakePage, name: string) =>
  yours?.[name] ?? take.balance[name] ?? 1
