import { useState } from "react"
import { Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useKey } from "@/hooks/useSpacebar"
import { useKeysOn } from "@/lib/keys"
import { useSystem, words } from "@/lib/platform"

/**
 * The player's keys, listed behind "?" rather than drawn on its buttons.
 *
 * Drawn on them they were tried twice — a boxed key on each, then a small
 * index in each corner — and both turned a row of small icons into clutter.
 * The transport stays as plain as it was, and anyone who wants the keys asks
 * for them once: with the ? key or the button at the end of the row.
 *
 * The list has only what works now. With the player's keys off in Settings ›
 * Keys, that is Space, where it plays, and the wheel. `spaceKey` says Space
 * plays here, with Settings' switch already counted.
 */
export function PlayerKeys({ spaceKey, goKeys }: { spaceKey: boolean; goKeys?: boolean }) {
  const [open, setOpen] = useState(false)
  const { mod } = words(useSystem())
  const playerKeys = useKeysOn("player")
  const spaceKeys = useKeysOn("space")
  // With both off only the wheel is left, which works while typing too;
  // with the player's off, the list says where its keys went.
  const off = !playerKeys
    ? spaceKeys
      ? "The player's keys are off in Settings › Keys."
      : "Space, Esc and the player's keys are off in Settings › Keys."
    : null
  useKey("?", () => setOpen(true), !open)

  const playerRows: [string[], string][] = [
    [["←", "→"], "10 seconds back / forward"],
    [["Home"], "To the start"],
    // Only where the take strip is, with the song's other takes.
    ...(goKeys
      ? [[["↑", "↓"], "Previous / next take of this song"] as [string[], string]]
      : []),
    [["M"], "Mark this spot"],
    [["R"], "Repeat on / off"],
  ]
  const rows: [string[], string][] = [
    ...(spaceKey ? [[["Space"], "Play / pause"] as [string[], string]] : []),
    ...(playerKeys ? playerRows : []),
    // Not keys, but the other thing nobody finds without being told: the
    // wheel on its own scrolls the page.
    [[`${mod} + wheel`], "Zoom in / out"],
    [["Shift + wheel"], "Along the take"],
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-row"
              aria-label="Player keys"
              aria-keyshortcuts={playerKeys ? "?" : undefined}
            >
              <Keyboard />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{playerKeys ? "Keys (?)" : "Keys"}</TooltipContent>
      </Tooltip>
      <DialogContent size="narrow">
        <DialogHeader>
          <DialogTitle>Keys in the player</DialogTitle>
          <DialogDescription>
            {off ?? "Not while typing a name."}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {rows.map(([keys, what]) => (
            <div key={what} className="contents">
              <dt className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
