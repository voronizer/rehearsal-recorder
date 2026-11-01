import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { SortableList } from "@/components/SortableList"
import { Button } from "@/components/ui/button"
import { useAddStatus, useChangeStatus, useDeleteStatus, useOrderStatuses, useSongs } from "../api"
import { EditRow, PanelHead, placed } from "../shell/EditList"
import { Group, Groups } from "../shell/parts"
import { count } from "../shell/words"

/** Where a song stands with the band: the band's own list, changed by anyone in it. */
export function StatusesPanel() {
  const statuses = useSongs().data?.statuses ?? []
  const add = useAddStatus()
  const change = useChangeStatus()
  const order = useOrderStatuses()
  const remove = useDeleteStatus()
  const [added, setAdded] = useState<number | null>(null)
  const [failed, setFailed] = useState<{ id: number; error: string } | null>(null)
  const qc = useQueryClient()
  // In place at once, so the row stays where it was dropped while the order is saved.
  const move = (id: number, to: number) => {
    const next = placed(statuses, id, to)
    qc.setQueryData(["songs"], (old: object | undefined) => old && { ...old, statuses: next })
    order.mutate(
      next.map((s) => s.id),
      { ...said(id), onError: (e: Error) => (setFailed({ id, error: e.message }), void qc.invalidateQueries({ queryKey: ["songs"] })) }
    )
  }
  const said = (id: number) => ({ onError: (e: Error) => setFailed({ id, error: e.message }), onSuccess: () => setFailed(null) })
  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="Statuses" />
      <p className="text-muted-foreground">
        Where a song stands with the band. Everyone in the band sees the same statuses. The Songs page groups songs by them, in this
        order. Statuses live only here: РЭХА has none.
      </p>
      <Groups>
        <Group>
          <SortableList items={statuses} label="Statuses" onMove={move}>
            {(s, handleRef) => (
              <EditRow
                key={`${s.id}-${s.name}`}
                handleRef={handleRef}
                focus={s.id === added}
                name={s.name}
                used={s.songs > 0}
                count={count(s.songs, "song")}
                onName={(name) => change.mutate({ id: s.id, name }, said(s.id))}
                canDelete={statuses.length > 1}
                onDelete={(to) => remove.mutate({ id: s.id, to }, said(s.id))}
                others={statuses.filter((o) => o.id !== s.id).map((o) => ({ id: o.id, name: o.name }))}
                error={failed?.id === s.id ? failed.error : undefined}
              />
            )}
          </SortableList>
          <Button
            variant="outline"
            size="row"
            className="self-start"
            disabled={add.isPending}
            onClick={() => {
              const taken = new Set(statuses.map((s) => s.name.toLowerCase()))
              let name = "New status"
              for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New status ${n}`
              add.mutate(name, { onSuccess: (made) => setAdded((made as { id: number }).id) })
            }}
          >
            <Plus />
            New status
          </Button>
        </Group>
      </Groups>
    </div>
  )
}
