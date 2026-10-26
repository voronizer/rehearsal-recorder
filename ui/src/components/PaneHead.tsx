import type { ComponentProps, ReactNode } from "react"
import { FolderOpen, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GoTitle } from "@/components/TakeTitle"
import { showFolder } from "@/lib/folder"
import { useSystem, words } from "@/lib/platform"
import { cn } from "@/lib/utils"

/**
 * The head of a page in History, the same for a rehearsal, a song and a
 * label: what leads it (a song's ▶, a label's dot), the title, the lines
 * under it, and what can be done with it at the right.
 *
 * The title takes up to two lines, then is cut, whole in the shared tooltip,
 * with the pencil right after its last word, as Review's take name has it
 * (TakeName), and a rehearsal's folder button after the pencil. With
 * `actions` beside it the title has its room first and the actions get what
 * it leaves: the figures among them give way to it whole, before it takes a
 * second line. The heading is named by the whole title, cut or not, and the
 * pencil by its own name. `muted` is a title in grey, such as Not named.
 * Anything else given goes on the header, such as a `data-` mark for a test.
 */
export function PaneHead({
  lead,
  title,
  muted = false,
  rename,
  folder,
  lines,
  actions,
  className,
  ...props
}: Omit<ComponentProps<"header">, "title" | "children"> & {
  lead?: ReactNode
  title: string
  muted?: boolean
  /** The pencil after the title: its name, its tip, and what it opens. */
  rename?: { label: string; tip: string; onClick: () => void }
  /** The folder the button after the pencil opens. */
  folder?: string
  lines?: ReactNode
  actions?: ReactNode
}) {
  const { folderButton } = words(useSystem())
  // The tip only repeats the button's name, so it is for the eyes.
  const pencil = rename && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-row"
          aria-label={rename.label}
          onClick={rename.onClick}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span aria-hidden>{rename.tip}</span>
      </TooltipContent>
    </Tooltip>
  )
  // Its name in the system's words, "Show in Finder"; the tip has the path
  // under them, as the path is nowhere else on the page.
  const opener = folder !== undefined && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-row"
          aria-label={folderButton}
          onClick={() => void showFolder(folder)}
          className="text-muted-foreground hover:text-foreground"
        >
          <FolderOpen />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="break-words">
        <span aria-hidden className="block">
          {folderButton}
        </span>
        <span className="block font-mono">{folder}</span>
      </TooltipContent>
    </Tooltip>
  )
  const after = (pencil || opener) && (
    <span className="flex items-center gap-1">
      {pencil}
      {opener}
    </span>
  )
  return (
    <header data-pane-head {...props} className={cn("flex min-w-0 items-start gap-4", className)}>
      {lead && <div className="shrink-0">{lead}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          {/* Named by the whole title alone: the pencil drawn after its last
              word is inside the heading, and would otherwise lend it its
              name ("Pałyn Rename song Pałyn"). The pencil keeps its own. */}
          <h2
            aria-label={title}
            className={cn(
              "min-w-0 text-xl font-semibold",
              actions ? "flex-[0_1_auto]" : "flex-1",
              muted && "text-muted-foreground"
            )}
          >
            <GoTitle title={title} go={null} cut lines={2} start after={after || undefined} />
          </h2>
          {/* Not narrower than what cannot give way, such as Delete: the
              title is cut before it would push that out of the head. */}
          {actions && (
            <div className="flex flex-1 items-start justify-end gap-2">{actions}</div>
          )}
        </div>
        {lines && <div className="mt-2 flex min-w-0 flex-col gap-1">{lines}</div>}
      </div>
    </header>
  )
}
