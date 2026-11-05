import { useRef, useState } from "react"
import { Ellipsis } from "lucide-react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useDeleteTake, useMoveTake } from "../api"
import { quoted } from "../shell/words"
import { MoveSub, type Movable } from "./move"

/**
 * ⋯ by a take, with **Move to song** and **Delete take**. The take goes to
 * the Trash, where anyone can put it back for 30 days, so the button is the
 * accent, not red. `onGone` takes the panel or page away from the take
 * before it goes. `row`: the menu of a take in a list.
 */
export function TakeMenu({ take, onGone, row }: { take: Movable & { name: string }; onGone?: () => void; row?: boolean }) {
  const remove = useDeleteTake()
  const move = useMoveTake()
  const [asking, setAsking] = useState(false)
  // New song… puts the focus in its field; the menu, closing, must not take it back to ⋯.
  const naming = useRef(false)
  const error = remove.error ?? move.error
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-row" aria-label={`What to do with ${take.name}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => {
            if (naming.current) e.preventDefault()
            naming.current = false
          }}
        >
          <MoveSub take={take} move={move} row={row} onNew={() => (naming.current = true)} />
          <DropdownMenuItem onSelect={() => setAsking(true)}>Delete take</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error.message}
        </span>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={asking ? `Delete ${quoted(take.name)}?` : null}
        description={asking ? "It goes to the Trash, where anyone in the band can put it back for 30 days. In РЭХА it stays as it is." : null}
        actionLabel="Delete take"
        destructive={false}
        onConfirm={() => {
          onGone?.()
          remove.mutate(take.uid)
        }}
      />
    </>
  )
}
