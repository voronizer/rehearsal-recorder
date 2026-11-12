import type { ReactNode } from "react"
import { useAddMark, useTake } from "../api"
import { usePanel } from "../shell/panel"
import { Note, PanelClose, Rows, Trouble, Waiting } from "../shell/parts"
import { clock, longDay } from "../shell/words"
import { TakeLink } from "../takes/parts"
import { MarkForm, MarkItem, TakeMarks } from "./MarkItem"

/** What a panel holds under a row with its ✕ alone: a list, or why there is nothing to show. */
function Closing({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="-mt-1 flex justify-end">
        <PanelClose />
      </div>
      {children}
    </div>
  )
}

/**
 * One mark of a take in the panel, opened from its chip in the take's
 * player: its label, its note and the talk under it. Opened from **Mark**,
 * a new mark at `at`, its label and note to fill in; once added, the panel
 * shows it.
 */
export function MarkPanel({ uid, id, at }: { uid: string; id?: number; at?: number }) {
  const { open, close } = usePanel()
  const take = useTake(uid)
  const add = useAddMark()
  if (take.error) return <Closing><Trouble error={take.error} retry={() => void take.refetch()} /></Closing>
  if (!take.data) return <Closing><Waiting /></Closing>
  const mark = id === undefined ? undefined : take.data.marks.find((m) => m.id === id)
  // Deleted, here or by somebody else: nothing left to show.
  if (id !== undefined && !mark)
    return (
      <Closing>
        <Note>This mark is no longer there.</Note>
      </Closing>
    )
  const moment = mark?.at ?? at ?? 0
  return (
    <div className="flex flex-col gap-6" aria-label={`Mark at ${clock(moment)}`}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">
          {mark ? "Mark" : "New mark"} at <span className="tnum">{clock(moment)}</span>
        </h2>
        <PanelClose />
      </div>
      {/* Whose mark it is, since the panel may cover the take: its name opens the take's page. */}
      <p className="-mt-4 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
        <span>On</span>
        <TakeLink take={take.data} />
        <span>· {longDay(take.data.date)}</span>
      </p>
      {mark ? (
        <Rows talk>
          <MarkItem mark={mark} />
        </Rows>
      ) : (
        <MarkForm
          title={
            <>
              A mark at <span className="tnum text-foreground">{clock(moment)}</span>
            </>
          }
          note=""
          busy={add.isPending}
          error={add.error?.message}
          button="Add mark"
          done={close}
          submit={(label_id, note) =>
            add.mutate({ uid, at: moment, label_id, note }, { onSuccess: (made) => open({ kind: "mark", uid, id: made.id }, { replace: true }) })
          }
        />
      )}
    </div>
  )
}

/** A take's marks alone: what the drawer on the take's page holds. */
export function TakeMarksPanel({ uid }: { uid: string }) {
  const take = useTake(uid)
  return (
    <Closing>
      {take.error ? (
        <Trouble error={take.error} retry={() => void take.refetch()} />
      ) : take.data ? (
        <TakeMarks take={take.data} />
      ) : (
        <Waiting />
      )}
    </Closing>
  )
}
