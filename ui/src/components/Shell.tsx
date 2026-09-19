import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * One frame for every screen: a header (back + title + action), a scrollable
 * middle and a pinned area for the main action at the bottom. Each screen
 * used to draw this its own way, which is where the "assembled from
 * different pieces" feeling came from.
 */
export function Shell({
  title,
  subtitle,
  onBack,
  headerAction,
  footer,
  children,
  className,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  onBack?: () => void
  headerAction?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {(title || onBack || headerAction) && (
        <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back"
            >
              <ChevronLeft />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            {subtitle && (
              <div className="text-xs tracking-wide text-muted-foreground uppercase">
                {subtitle}
              </div>
            )}
            {title && (
              <h1 className="truncate text-lg leading-tight font-semibold">
                {title}
              </h1>
            )}
          </div>
          {headerAction}
        </header>
      )}

      <main className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-6", className)}>
        {children}
      </main>

      {footer && (
        <footer className="shrink-0 border-t bg-card/40 px-6 py-5">
          {footer}
        </footer>
      )}
    </div>
  )
}

/** The "Space — does this" hint next to the main button. */
export function SpaceHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <kbd className="inline-flex h-5 min-w-7 items-center justify-center rounded border bg-background px-1.5 font-mono text-[11px]">
        Space
      </kbd>
      <span>{children}</span>
    </div>
  )
}

/** Empty list state — the same everywhere. */
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-xs text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
