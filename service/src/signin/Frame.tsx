import type { ReactNode } from "react"

/** A page of its own, before the band's pages: a card in the middle. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-xl bg-card p-6">{children}</div>
    </main>
  )
}
