import { useState } from "react"
import { Ellipsis } from "lucide-react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useDeleteTake } from "../api"
import { quoted } from "../shell/words"

/**
 * ⋯ by a take, with **Delete take**. The take goes to the Trash, where
 * anyone can put it back for 30 days, so the button is the accent, not red.
 * `onGone` takes the panel or page away from the take before it goes.
 */
export function TakeMenu({ take, onGone }: { take: { uid: string; name: string }; onGone?: () => void }) {
  const remove = useDeleteTake()
  const [asking, setAsking] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-row" aria-label={`What to do with ${take.name}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAsking(true)}>Delete take</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {remove.error && (
        <span role="alert" className="text-xs text-destructive">
          {remove.error.message}
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
