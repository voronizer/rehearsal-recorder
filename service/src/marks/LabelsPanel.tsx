import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { SortableList } from "@/components/SortableList"
import { Button } from "@/components/ui/button"
import { colourName, firstFreeColour, LABEL_COLOURS, labelLook } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useAddLabel, useChangeLabel, useDeleteLabel, useLabels, useOrderLabels, type Label } from "../api"
import { EditRow, PanelHead, placed } from "../shell/EditList"
import { Group, Groups } from "../shell/parts"
import { count } from "../shell/words"
import { colourCss, Diamond } from "../takes/parts"

const diamond = (l: Label) => <Diamond colour={colourCss(l)} />

/** The band's labels for marks, as РЭХА's Settings › Marks: any member changes them. */
export function LabelsPanel() {
  const labels = useLabels().data ?? []
  const add = useAddLabel()
  const change = useChangeLabel()
  const order = useOrderLabels()
  const remove = useDeleteLabel()
  const [added, setAdded] = useState<number | null>(null)
  const [failed, setFailed] = useState<{ id: number; error: string } | null>(null)
  const qc = useQueryClient()
  // In place at once, so the row stays where it was dropped while the order is saved.
  const move = (id: number, to: number) => {
    const next = placed(labels, id, to)
    qc.setQueryData(["labels"], next)
    order.mutate(
      next.map((l) => l.id),
      { ...said(id), onError: (e: Error) => (setFailed({ id, error: e.message }), void qc.invalidateQueries({ queryKey: ["labels"] })) }
    )
  }
  const said = (id: number) => ({ onError: (e: Error) => setFailed({ id, error: e.message }), onSuccess: () => setFailed(null) })
  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="Labels" />
      <p className="text-muted-foreground">
        What a moment in a take can be marked with. The whole band has the same labels. Renaming or recolouring one changes every mark
        that has it. A mark from РЭХА with a label the band has not got yet adds that label here. A label renamed here still gets the
        marks РЭХА sends under its old name.
      </p>
      <Groups>
        <Group>
          <SortableList items={labels} label="Labels" onMove={move}>
            {(l, handleRef) => (
              <EditRow
                key={`${l.id}-${l.name}`}
                handleRef={handleRef}
                focus={l.id === added}
                name={l.name}
                used={l.marks > 0}
                count={count(l.marks, "mark")}
                swatch={diamond(l)}
                swatches={LABEL_COLOURS.map((c) => ({
                  value: c,
                  name: colourName(c),
                  className: cn(labelLook(c).swatch, c === l.colour && "ring-2 ring-ring ring-offset-2 ring-offset-panel"),
                }))}
                onColour={(colour) => change.mutate({ id: l.id, colour: colour as Label["colour"] }, said(l.id))}
                onName={(name) => change.mutate({ id: l.id, name }, said(l.id))}
                canDelete={labels.length > 1}
                onDelete={(to) => remove.mutate({ id: l.id, to }, said(l.id))}
                others={labels.filter((o) => o.id !== l.id).map((o) => ({ id: o.id, name: o.name, swatch: diamond(o) }))}
                error={failed?.id === l.id ? failed.error : undefined}
              />
            )}
          </SortableList>
          <Button
            variant="outline"
            size="row"
            className="self-start"
            disabled={add.isPending}
            onClick={() => {
              const taken = new Set(labels.map((l) => l.name.toLowerCase()))
              let name = "New label"
              for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New label ${n}`
              add.mutate({ name, colour: firstFreeColour(labels) }, { onSuccess: (made) => setAdded(made.id) })
            }}
          >
            <Plus />
            New label
          </Button>
        </Group>
      </Groups>
    </div>
  )
}
