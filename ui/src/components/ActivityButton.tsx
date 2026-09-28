import { useEffect, useState } from "react"
import { Popover } from "radix-ui"
import { Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { api, type ActivityEntry } from "@/lib/api"
import { pollSoon, setListOpen, useActivity } from "@/lib/activity"
import { notify } from "@/lib/notices"
import { cn } from "@/lib/utils"

const RING_R = 7
const RING_C = 2 * Math.PI * RING_R

function isActive(e: ActivityEntry) {
  return e.state === "running" || e.state === "waiting"
}

/**
 * What long work is running and how it ended, in the header of every screen
 * — see lib/activity.ts and activity.py. There only when there is something
 * to show: while anything waits or runs, a ring filled to how far along it
 * all is; once it has finished and nobody has looked, a dot, red if anything
 * failed. Pressed, the list: what is running with a bar each, what finished
 * with what it came to, and Retry on a cloud copy that failed.
 *
 * Escape closes the list and nothing else: Radix gives its content
 * role="dialog", which useEscape (hooks/useSpacebar.ts) already leaves alone.
 */
export function ActivityButton() {
  const { entries, recording } = useActivity()
  const [open, setOpen] = useState(false)
  // A screen that goes takes its open list with it.
  useEffect(() => () => setListOpen(false), [])
  if (entries.length === 0) return null

  const show = (next: boolean) => {
    setOpen(next)
    setListOpen(next)
  }

  const active = entries.filter(isActive)
  const finished = entries.filter((e) => !isActive(e))
  const unseen = finished.filter((e) => !e.seen)
  const failedUnseen = unseen.some((e) => e.state === "failed")
  const overall = active.length
    ? active.reduce((sum, e) => sum + (e.state === "running" ? e.fraction : 0), 0) /
      active.length
    : 1

  const waiting = active.filter((e) => e.state === "waiting").length
  const label =
    `Background work: ${active.length - waiting} running, ${waiting} waiting, ` +
    `${finished.length} finished` +
    (unseen.length ? `, ${unseen.length} not yet seen` : "")

  return (
    <Popover.Root open={open} onOpenChange={show}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="gap-1.5">
          {active.length > 0 ? (
            <>
              <svg viewBox="0 0 18 18" className="size-4.5 -rotate-90" aria-hidden>
                <circle cx="9" cy="9" r={RING_R} className="fill-none stroke-muted" strokeWidth="2.5" />
                <circle
                  cx="9"
                  cy="9"
                  r={RING_R}
                  className="fill-none stroke-primary transition-[stroke-dashoffset]"
                  strokeWidth="2.5"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - overall)}
                />
              </svg>
              <span className="tnum text-xs">{active.length}</span>
            </>
          ) : (
            <span
              aria-hidden
              className={cn(
                "size-2.5 rounded-full",
                unseen.length === 0
                  ? "bg-muted-foreground/40"
                  : failedUnseen
                    ? "bg-destructive"
                    : "bg-signal"
              )}
            />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          aria-label="Background work"
          className="z-50 flex max-h-[70vh] w-80 flex-col gap-4 overflow-y-auto rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
        >
          {active.length > 0 && (
            <section aria-label="Working" className="flex flex-col gap-3">
              <h2 className="text-xs tracking-wide text-muted-foreground uppercase">Working</h2>
              {active.map((e) => (
                <Running key={e.id} entry={e} recording={recording} />
              ))}
            </section>
          )}
          {finished.length > 0 && (
            <section aria-label="Done" className="flex flex-col gap-3">
              <h2 className="text-xs tracking-wide text-muted-foreground uppercase">Done</h2>
              {finished.map((e) => (
                <Finished key={e.id} entry={e} />
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="self-end"
                onClick={async () => {
                  await api().clear_activity()
                  // Nothing left to list: the button goes, and its list is
                  // closed rather than left counted as open — that kept the
                  // poll fast and marked later failures seen unseen.
                  if (active.length === 0) show(false)
                }}
              >
                Clear
              </Button>
            </section>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Running({ entry, recording }: { entry: ActivityEntry; recording: boolean }) {
  const pct = Math.round(entry.fraction * 100)
  const waiting = entry.state === "waiting"
  const step = waiting
    ? recording && entry.kind === "cloud"
      ? "After the take"
      : "Waiting"
    : (entry.step ?? "Working")
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {!waiting && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{entry.title}</span>
        {!waiting && <span className="tnum text-xs text-muted-foreground">{pct}%</span>}
      </div>
      <div className="text-xs text-muted-foreground">{step}</div>
      {!waiting && <Progress value={pct} className="h-1" />}
    </div>
  )
}

function Finished({ entry }: { entry: ActivityEntry }) {
  const failed = entry.state === "failed"
  return (
    <div className="flex items-start gap-2">
      {failed ? (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <Check className="mt-0.5 size-4 shrink-0 text-signal" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate">{entry.title}</div>
        {(failed ? entry.error : entry.detail) && (
          <div
            className={cn(
              "text-xs break-words",
              failed ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {failed ? entry.error : entry.detail}
          </div>
        )}
      </div>
      {failed && entry.kind === "cloud" && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const res = await api().retry_cloud(entry.id)
            if (!res.ok) {
              // Refused — the rehearsal was renamed or the take deleted since
              // it failed. Said in the same slot as the failure it retried.
              notify({
                key: `cloud:${entry.folder}:${entry.take_number}`,
                kind: "error",
                text: `Could not copy ${entry.title.replace(/ → cloud$/, "")} again: ${
                  res.error ?? "it was refused"
                }`,
              })
              return
            }
            pollSoon()
          }}
        >
          Retry
        </Button>
      )}
    </div>
  )
}
