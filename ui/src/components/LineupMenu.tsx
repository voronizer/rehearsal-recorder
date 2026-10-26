import { useState, type ReactNode } from "react"
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WholeTip, useCut } from "@/components/ui/whole"
import { ConfirmDialog, PromptDialog } from "@/components/ConfirmDialog"
import { Choice } from "@/components/SetPicker"
import type { Lineup } from "@/lib/api"
import { tracksLabel } from "@/lib/format"
import { keysOn } from "@/lib/keys"
import { focusIsLeftover } from "@/hooks/useSpacebar"
import { LINEUP_NAME_MAX } from "@/lib/lineups"

// The band's named lineups on the setup screen (#13): the title over the
// tracks is the lineup picked, and a menu of them all.

/** What a lineup's window asks: a name for a new one, a new name, or
 *  whether to delete it. */
export type LineupAsk = "new" | "rename" | "delete"

/**
 * The tracks' title, in the heading's size and weight: the lineup picked, or
 * *Tracks* with none, and *· changed* after it while the tracks on screen are
 * not that lineup's. Its menu lists the lineups, each with its tracks
 * counted, the picked one checked, then *Save as new lineup…* and, with one
 * picked, *Rename* and *Delete* it. A long name is cut and shown whole in
 * the shared tip (B6); *changed* is never cut. `keepable` says whether the
 * tracks on screen can be kept as a lineup, as Start says whether they can
 * start.
 */
export function LineupMenu({
  lineups,
  picked,
  changed,
  keepable,
  disabled,
  onPick,
  onAsk,
}: {
  lineups: Lineup[]
  picked: string | null
  changed: boolean
  keepable: boolean
  disabled?: boolean
  onPick: (name: string) => void
  onAsk: (ask: LineupAsk) => void
}) {
  const [nameRef, cut] = useCut<HTMLSpanElement>()
  return (
    // Not modal, as the set picker: Save as new lineup… opens a window as
    // the menu closes, and a modal menu would take the keyboard back from it.
    <DropdownMenu modal={false}>
      <WholeTip cut={cut} text={picked}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="row"
            data-lineup
            disabled={disabled}
            // Focus the mouse left here is not aimed at it: Space starts the
            // rehearsal, as it does from the set picker.
            onKeyDown={(e) => {
              if (e.key === " " && keysOn("space") && focusIsLeftover(e.currentTarget))
                e.preventDefault()
            }}
            className="-ml-3 min-w-0 shrink px-3 text-sm font-semibold has-[>svg]:px-3"
          >
            <span
              ref={nameRef}
              data-lineup-name
              data-cut={cut || undefined}
              className="block min-w-0 truncate"
            >
              {picked ?? "Tracks"}
            </span>
            {changed && (
              <span className="shrink-0 font-normal text-muted-foreground">· changed</span>
            )}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </WholeTip>
      <DropdownMenuContent
        align="start"
        aria-label="Lineups"
        aria-labelledby={undefined}
        // Goes at once, as the set picker's: a window opened from it would
        // otherwise lose its field's focus to the menu fading out under it.
        className="w-72 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] data-[state=closed]:animate-none!"
      >
        {lineups.length > 0 && (
          <>
            <DropdownMenuRadioGroup value={picked ?? ""} onValueChange={onPick}>
              {lineups.map((l) => (
                <Choice
                  key={l.name}
                  value={l.name}
                  label={l.name}
                  detail={tracksLabel(l.tracks.length)}
                />
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!keepable} onSelect={() => onAsk("new")}>
          <Plus />
          Save as new lineup…
        </DropdownMenuItem>
        {picked !== null && (
          <>
            <Action icon={<Pencil />} text={`Rename “${picked}”…`} onSelect={() => onAsk("rename")} />
            <Action
              icon={<Trash2 />}
              text={`Delete “${picked}”…`}
              destructive
              onSelect={() => onAsk("delete")}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Rename or Delete in the menu, with the lineup's name in it: cut at the
 *  menu's width, and whole in its tip. */
function Action({
  icon,
  text,
  destructive,
  onSelect,
}: {
  icon: ReactNode
  text: string
  destructive?: boolean
  onSelect: () => void
}) {
  const [textRef, cut] = useCut<HTMLSpanElement>()
  return (
    <WholeTip cut={cut} text={text}>
      <DropdownMenuItem variant={destructive ? "destructive" : "default"} onSelect={onSelect}>
        {icon}
        <span ref={textRef} data-cut={cut || undefined} className="min-w-0 flex-1 truncate">
          {text}
        </span>
      </DropdownMenuItem>
    </WholeTip>
  )
}

/**
 * The windows the menu opens: *Save as a new lineup* and *Rename* each ask
 * for a name, and stay open saying what is wrong with one refused (a name
 * another lineup has); *Delete* asks first (B2). Each says the lineup it
 * was opened for, while it closes too: a rename answered renames the lineup
 * before the window has gone.
 */
export function LineupDialogs({
  asking,
  current,
  onClose,
  onSaveNew,
  onRename,
  onDelete,
}: {
  asking: LineupAsk | null
  /** The lineup picked. */
  current: string | null
  onClose: () => void
  /** What is wrong with the name, or null once it is kept. */
  onSaveNew: (name: string) => Promise<string | null>
  onRename: (name: string) => Promise<string | null>
  onDelete: () => void
}) {
  const [about, setAbout] = useState("")
  const [was, setWas] = useState<LineupAsk | null>(null)
  if (asking !== was) {
    setWas(asking)
    if (asking !== null) setAbout(current ?? "")
  }
  const shut = (open: boolean) => {
    if (!open) onClose()
  }
  return (
    <>
      <PromptDialog
        open={asking === "new"}
        onOpenChange={shut}
        title="Save as a new lineup"
        label="The tracks on screen, their icons and their inputs."
        fieldLabel="Name"
        maxLength={LINEUP_NAME_MAX}
        initialValue=""
        actionLabel="Save lineup"
        onSubmit={onSaveNew}
      />
      <PromptDialog
        open={asking === "rename"}
        onOpenChange={shut}
        title={`Rename “${about}”`}
        fieldLabel="Name"
        maxLength={LINEUP_NAME_MAX}
        initialValue={about}
        onSubmit={onRename}
      />
      <ConfirmDialog
        open={asking === "delete"}
        onOpenChange={shut}
        title={asking === "delete" ? `Delete “${about}”?` : null}
        description="The tracks on screen stay as they are. Rehearsals recorded with it keep their tracks."
        actionLabel="Delete lineup"
        onConfirm={onDelete}
      />
    </>
  )
}
