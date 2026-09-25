import { useEffect, useRef, type ReactNode } from "react"
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
  backKey = false,
  headerAction,
  footer,
  children,
  className,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  onBack?: () => void
  /** Escape goes back right now, so the back button can say so. */
  backKey?: boolean
  headerAction?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
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
    <div className="flex h-full flex-col overflow-hidden">
      {(title || onBack || headerAction) && (
        <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
          {onBack && (
            <Button
              variant="ghost"
              size={backKey ? "sm" : "icon"}
              onClick={onBack}
              aria-label="Back"
              aria-keyshortcuts={backKey ? "Escape" : undefined}
            >
              <ChevronLeft />
              {backKey && <Kbd>Esc</Kbd>}
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
        <footer ref={footerRef} className="shrink-0 border-t bg-card/40 px-6 py-5">
          {footer}
        </footer>
      )}
    </div>
  )
}

/**
 * The key that presses this button, drawn on the button itself.
 *
 * It used to be a line under the main button — "Space: save take" — which
 * said the same thing twice and only for one key per screen. On the button
 * there is no distance between the key and what it does, and every key the
 * screen answers to can say so. Drawn in the button's own colour, so it
 * reads on a red Record as well as on a ghost button. Hidden from screen
 * readers, which get `aria-keyshortcuts` on the button instead.
 *
 * Only shown while the key really does press this button: with a take open
 * on the rehearsal screen Space plays it and Escape closes it, so Record and
 * Finish lose theirs until the take is closed again.
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden
      className="pointer-events-none ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/30 bg-current/10 px-1 font-mono text-[10px] leading-none font-normal opacity-80"
    >
      {children}
    </kbd>
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
