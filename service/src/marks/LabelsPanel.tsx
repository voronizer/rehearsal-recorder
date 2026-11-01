import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { colourName, firstFreeColour, LABEL_COLOURS, labelLook } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useAddLabel, useChangeLabel, useDeleteLabel, useLabels, useOrderLabels, type Label } from "../api"
import { EditRow, moved, PanelHead } from "../shell/EditList"
import { Group, Groups, Rows } from "../shell/parts"
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
  const ids = labels.map((l) => l.id)
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
          <Rows>
            {labels.map((l, i) => (
              <EditRow
                key={`${l.id}-${l.name}`}
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
                onUp={i > 0 ? () => order.mutate(moved(ids, l.id, -1)) : undefined}
                onDown={i < labels.length - 1 ? () => order.mutate(moved(ids, l.id, 1)) : undefined}
                canDelete={labels.length > 1}
                onDelete={(to) => remove.mutate({ id: l.id, to }, said(l.id))}
                others={labels.filter((o) => o.id !== l.id).map((o) => ({ id: o.id, name: o.name, swatch: diamond(o) }))}
                error={failed?.id === l.id ? failed.error : undefined}
              />
            ))}
          </Rows>
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
