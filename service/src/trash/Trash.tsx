import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useRestore, useTrash, type Trashed } from "../api"
import { Group, Note, Page, Rows, Tile } from "../shell/parts"
import { count, day, longDay, quoted } from "../shell/words"
import { Play, TakeLink } from "../takes/parts"

/** A take waits this many days in the trash. */
const KEPT = 30
const DAY = 24 * 60 * 60 * 1000

/** “deleted for good in 28 days”, counted from when РЭХА removed it. */
function left(t: Trashed, now = Date.now()) {
  const days = KEPT - Math.floor((now - Date.parse(t.trashed_at)) / DAY)
  return days > 0 ? `deleted for good in ${count(days, "day")}` : "deleted for good today"
}

/**
 * **Trash**: the takes removed in РЭХА, with their files, marks and stars.
 * Anyone in the band can listen to one or press **Restore**. After 30 days
 * a take is deleted for good.
 */
export function Trash() {
  const trash = useTrash()
  const restore = useRestore()
  const [back, setBack] = useState<string | null>(null)
  return (
    <Page title="Trash" sub="Takes removed in РЭХА wait here for 30 days, then they are deleted for good. Anyone in the band can put one back.">
      {back && (
        <Tile boxed className="border-primary/40">
          <span role="status">{back}</span>
        </Tile>
      )}
      {trash.error && <Note>{trash.error.message}</Note>}
      {trash.data &&
        (trash.data.length ? (
          <Group>
            <Rows>
              {trash.data.map((t) => (
                <div key={t.uid} className="flex items-center gap-3" data-take={t.name}>
                  <Play take={t} />
                  <div className="min-w-0 flex-1">
                    <TakeLink take={t} />
                    <div className="text-xs text-muted-foreground">
                      {day(t.date)} · removed in РЭХА {day(t.trashed_at.slice(0, 10))} · {left(t)}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="row"
                    disabled={restore.isPending}
                    onClick={() =>
                      restore.mutate(t.uid, { onSuccess: () => setBack(`${quoted(t.name)} is back with the takes of ${longDay(t.date)}.`) })
                    }
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </Rows>
          </Group>
        ) : (
          <p className="text-muted-foreground">The trash is empty.</p>
        ))}
    </Page>
  )
}
