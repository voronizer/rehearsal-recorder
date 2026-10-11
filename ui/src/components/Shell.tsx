import { useEffect, useRef, type ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { ActivityButton } from "@/components/ActivityButton"
import { ListeningVolume } from "@/components/ListeningVolume"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
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
  backKey = false,
  headerAction,
  facts,
  footer,
  aside,
  children,
  className,
  activity = true,
  playback = false,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  onBack?: () => void
  /** Escape goes back right now, so the back button can say so. */
  backKey?: boolean
  headerAction?: ReactNode
  /** What there is to know about the rehearsal on screen, right of its
   *  name (components/EveningFacts). */
  facts?: ReactNode
  footer?: ReactNode
  /** A panel right of the scrollable middle, from the header down to the
   *  footer, scrolling on its own: the rehearsal screen's Next take. */
  aside?: ReactNode
  children: ReactNode
  className?: string
  /** Show long work (components/ActivityButton) on a screen with no header,
   *  in its top corner. Off on Recording: copies wait while a take records,
   *  and the take's own saving is said under its Stop button. */
  activity?: boolean
  /** A take can be played on this screen, so the header has the speaker
   *  that sets how loud (components/ListeningVolume). */
  playback?: boolean
}) {
  // Notices stack above the footer, never on it: the footer holds Start, Stop
  // and Save take, and at a larger scale or in a narrow window its button
  // reaches the corner. So its height is published for components/Notices,
  // and taken back to nothing when this screen goes.
  const footerRef = useRef<HTMLElement>(null)
  const hasFooter = !!footer
  useEffect(() => {
    const root = document.documentElement
    const el = footerRef.current
    if (!hasFooter || !el) {
      root.style.setProperty("--footer-h", "0px")
      return
    }
    const publish = () => root.style.setProperty("--footer-h", `${el.offsetHeight}px`)
    publish()
    const watch = new ResizeObserver(publish)
    watch.observe(el)
    return () => {
      watch.disconnect()
      root.style.setProperty("--footer-h", "0px")
    }
  }, [hasFooter])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {!(title || onBack || headerAction) && activity && (
        // A screen with no header still shows long work, in its corner;
        // Recording turns it off.
        <div className="absolute top-3 right-4 z-10">
          <ActivityButton />
        </div>
      )}
      {(title || onBack || headerAction) && (
        <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
          {onBack && (
            <Button
              variant="ghost"
              size={backKey ? "row" : "icon"}
              onClick={onBack}
              aria-label="Back"
              aria-keyshortcuts={backKey ? "Escape" : undefined}
            >
              <ChevronLeft />
              {backKey && <Kbd aria-hidden>Esc</Kbd>}
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
          {facts}
          {facts && <span aria-hidden className="ml-2 h-8 w-px shrink-0 bg-border" />}
          <ActivityButton />
          {playback && <ListeningVolume />}
          {headerAction}
        </header>
      )}

      {aside ? (
        <div className="flex min-h-0 flex-1">
          <main className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6", className)}>
            {children}
          </main>
          {aside}
        </div>
      ) : (
        <main className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-6", className)}>
          {children}
        </main>
      )}

      {footer && (
        <footer ref={footerRef} className="shrink-0 border-t bg-card/40 px-6 py-5">
          {footer}
        </footer>
      )}
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
