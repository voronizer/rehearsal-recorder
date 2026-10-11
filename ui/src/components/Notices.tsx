import { useEffect, useState } from "react"
import { Check, CircleAlert, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import {
  dismissNotice,
  lifetime,
  runAction,
  useNotices,
  type Notice,
} from "@/lib/notices"
import { useSystem, words } from "@/lib/platform"

const LOOK: Record<Notice["kind"], { box: string; icon: React.ReactNode }> = {
  done: {
    box: "border-signal/40",
    icon: <Check className="size-4 shrink-0 text-signal" />,
  },
  warning: {
    box: "border-warn/40",
    icon: <TriangleAlert className="size-4 shrink-0 text-warn" />,
  },
  error: {
    box: "border-destructive/40",
    icon: <CircleAlert className="size-4 shrink-0 text-destructive" />,
  },
}

/**
 * The notices, in the bottom right-hand corner, over whatever screen is open.
 * See lib/notices.ts for what goes here and what does not.
 *
 * Plain markup rather than Radix Toast, on purpose. A Radix toast is a
 * dismissable layer: it closes on an Escape pressed anywhere, lets the key
 * carry on to the screen underneath — which then leaves — and, raised while a
 * dialog is open, takes Escape away from the dialog. Here Escape means one
 * level up (hooks/useSpacebar.ts), and a notice takes no part in that: it is
 * closed by its button and by nothing else.
 *
 * The region itself takes no clicks, only the notices in it, so the empty
 * part of the corner never swallows a click meant for what is underneath.
 *
 * It stands above a dialog's veil (z-60 against the dialog's 50): a notice
 * with an Undo must be reachable while a dialog is open, and a click on it
 * is not a click outside the dialog (see ui/dialog.tsx).
 *
 * It stands on the footer rather than in the corner: Shell publishes the
 * footer's height as --footer-h, and a notice that stays must never sit on
 * Start, Stop or Save take.
 */
export function Notices() {
  const notices = useNotices()
  // The time stops for every notice while the pointer is over any of them:
  // somebody reading one is not done with the others either. What is kept is
  // which notice the pointer is on, not that it is on one: a notice taken
  // away from under the pointer (its ✕, its Undo, ⌘Z) fires no mouseleave,
  // and a flag set by the mouse would stay set and stop every later notice.
  const [hovered, setHovered] = useState<number | null>(null)
  const paused = notices.some((n) => n.id === hovered)

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      style={{ bottom: "calc(var(--footer-h, 0px) + 1rem)" }}
      className="pointer-events-none fixed right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {notices.map((n) => (
        <NoticeItem
          key={n.id}
          notice={n}
          paused={paused}
          onEnter={() => setHovered(n.id)}
          onLeave={() => setHovered((h) => (h === n.id ? null : h))}
        />
      ))}
    </section>
  )
}

function NoticeItem({
  notice,
  paused,
  onEnter,
  onLeave,
}: {
  notice: Notice
  paused: boolean
  onEnter: () => void
  onLeave: () => void
}) {
  const system = useSystem()
  // Keyed on the notice's id: a notice that replaced this one under the same
  // key is a different element with a timer of its own, and this one's
  // cleanup cannot end it. A notice is never changed once raised, so
  // `notice` itself is the dependency.
  useEffect(() => {
    const ms = lifetime(notice)
    if (ms === null || paused) return
    const timer = window.setTimeout(() => dismissNotice(notice.id), ms)
    return () => window.clearTimeout(timer)
  }, [notice, paused])

  const look = LOOK[notice.kind]
  return (
    <div
      data-notice={notice.kind}
      role={notice.kind === "error" ? "alert" : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        "pointer-events-auto flex gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg",
        "animate-in fade-in-0 slide-in-from-bottom-2",
        // Words keep the icon on their first line. With a button beside them
        // the row is as tall as the button and all of it is centred.
        notice.action ? "items-center" : "items-start [&>svg]:mt-0.5",
        look.box
      )}
    >
      {look.icon}
      <p className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
        {notice.text}
      </p>
      {notice.action && (
        <Button
          variant="outline"
          size="row"
          aria-keyshortcuts={system === "mac" ? "Meta+Z" : "Control+Z"}
          onClick={() => runAction(notice.id)}
        >
          {notice.action.label}
          <Kbd aria-hidden>{words(system).undoKey}</Kbd>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-tiny"
        aria-label="Close notice"
        onClick={() => dismissNotice(notice.id)}
        className="-my-0.5 shrink-0"
      >
        <X />
      </Button>
    </div>
  )
}
