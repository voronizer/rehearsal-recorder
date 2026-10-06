import { cn } from "@/lib/utils"

/**
 * A song's title where a rehearsal is gone over — its overview, Last time —
 * that opens the song's page in History when there is somewhere to open it;
 * null is the takes nobody named, which have a page too. Without `onOpen` it
 * is the title and nothing more.
 */
export function SongName({
  title,
  onOpen,
  className,
}: {
  title: string | null
  onOpen?: (title: string | null) => void
  className?: string
}) {
  const text = title ?? "Not named"
  if (!onOpen) return <span className={className}>{text}</span>
  return (
    <button
      type="button"
      aria-label={title === null ? "Open Not named" : `Open the song ${title}`}
      title={title === null ? "Every take nobody named" : `Every go at ${title}`}
      onClick={() => onOpen(title)}
      className={cn(
        "rounded-sm text-left hover:underline hover:underline-offset-3",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}
    >
      {text}
    </button>
  )
}
