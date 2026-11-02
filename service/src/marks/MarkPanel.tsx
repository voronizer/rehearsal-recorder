import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAddMark, useTake } from "../api"
import { usePanel } from "../shell/panel"
import { Note, Rows, Trouble, Waiting } from "../shell/parts"
import { clock, longDay } from "../shell/words"
import { TakeLink } from "../takes/parts"
import { MarkForm, MarkItem } from "./MarkItem"

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
  if (take.error) return <Trouble error={take.error} retry={() => void take.refetch()} />
  if (!take.data) return <Waiting />
  const mark = id === undefined ? undefined : take.data.marks.find((m) => m.id === id)
  // Deleted, here or by somebody else: nothing left to show.
  if (id !== undefined && !mark) return <Note>This mark is no longer there.</Note>
  const moment = mark?.at ?? at ?? 0
  return (
    <div className="flex flex-col gap-6" aria-label={`Mark at ${clock(moment)}`}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold">
          {mark ? "Mark" : "New mark"} at <span className="tnum">{clock(moment)}</span>
        </h2>
        <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      {/* Whose mark it is, since the panel may cover the take: its take opens in the panel. */}
      <p className="-mt-4 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
        <span>On</span>
        <TakeLink take={take.data} />
        <span>· {longDay(take.data.date)}</span>
      </p>
      {mark ? (
        <Rows>
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
