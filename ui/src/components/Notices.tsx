import { useEffect, useState } from "react"
import { Check, CircleAlert, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DONE_MS,
  dismissNotice,
  useNotices,
  type Notice,
} from "@/lib/notices"

const LOOK: Record<Notice["kind"], { box: string; icon: React.ReactNode }> = {
  done: {
    box: "border-signal/40",
    icon: <Check className="mt-0.5 size-4 shrink-0 text-signal" />,
  },
  warning: {
    box: "border-warn/40",
    icon: <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />,
  },
  error: {
    box: "border-destructive/40",
    icon: <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />,
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
 */
export function Notices() {
  const notices = useNotices()
  // The time stops for every notice while the pointer is over any of them:
  // somebody reading one is not done with the others either.
  const [paused, setPaused] = useState(false)

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {notices.map((n) => (
        <NoticeItem key={n.id} notice={n} paused={paused} />
      ))}
    </section>
  )
}

function NoticeItem({ notice, paused }: { notice: Notice; paused: boolean }) {
  // Keyed on the notice's id: a notice that replaced this one under the same
  // key is a different element with a timer of its own, and this one's
  // cleanup cannot end it.
  useEffect(() => {
    if (notice.kind !== "done" || paused) return
    const timer = window.setTimeout(() => dismissNotice(notice.id), DONE_MS)
    return () => window.clearTimeout(timer)
  }, [notice.id, notice.kind, paused])

  const look = LOOK[notice.kind]
  return (
    <div
      data-notice={notice.kind}
      role={notice.kind === "error" ? "alert" : undefined}
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg",
        "animate-in fade-in-0 slide-in-from-bottom-2",
        look.box
      )}
    >
      {look.icon}
      <p className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
        {notice.text}
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close notice"
        onClick={() => dismissNotice(notice.id)}
        className="-my-0.5 shrink-0"
      >
        <X />
      </Button>
    </div>
  )
}
