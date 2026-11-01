import type { ReactNode } from "react"
import { Link, type LinkProps } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWide } from "./useWide"

/** Something new for you: a take not opened yet, or a song with one. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full bg-primary", className)} />
}

type Starred = { member_id: string; initial: string; name: string }

/** Who starred a take: a ★ and their first letters; nothing when nobody has. */
export function Stars({ stars, ring = "ring-card" }: { stars: Starred[]; ring?: string }) {
  if (stars.length === 0) return null
  return (
    <span role="img" aria-label={`Starred by ${stars.map((s) => s.name).join(", ")}`} className="flex items-center gap-1">
      <Star className="size-3.5 fill-current text-signal" />
      <span className="flex -space-x-1">
        {stars.map((s) => (
          <span
            key={s.member_id}
            className={cn("flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold ring-2", ring)}
          >
            {s.initial}
          </span>
        ))}
      </span>
    </span>
  )
}

export type Step = { label: string; to?: LinkProps }

/**
 * The bar above a page. On a computer it is the path to the page
 * (Viasna › Viasna 12), each step back a link; on a phone, a back arrow to
 * the step before, or to the first screen.
 */
export function PageHead({ path, aside }: { path: Step[]; aside?: ReactNode }) {
  const wide = useWide()
  if (wide)
    return (
      <header className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-3 border-b bg-panel/90 px-5 backdrop-blur">
        <nav aria-label="Where you are" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {path.map((step, i) => (
            <span key={`${i}-${step.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
              {step.to && i < path.length - 1 ? (
                <Link {...step.to} className="truncate text-muted-foreground hover:text-foreground">
                  {step.label}
                </Link>
              ) : (
                <span className="truncate font-medium">{step.label}</span>
              )}
            </span>
          ))}
        </nav>
        {aside}
      </header>
    )
  const back = [...path.slice(0, -1)].reverse().find((s) => s.to)
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-1 border-b bg-panel/90 px-2 backdrop-blur">
      {path.length > 0 ? (
        <Link
          {...(back?.to ?? { to: "/" })}
          aria-label={`Back to ${back?.label ?? "РЭХА"}`}
          className="flex min-w-0 items-center gap-1 rounded-md px-1 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
          <span className="truncate">{back?.label ?? "РЭХА"}</span>
        </Link>
      ) : (
        <span className="px-2 text-sm font-semibold">РЭХА</span>
      )}
      <span className="flex-1" />
      {aside}
    </header>
  )
}

/** A page's words while it loads, or what went wrong. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="p-5 text-sm text-muted-foreground">{children}</p>
}
