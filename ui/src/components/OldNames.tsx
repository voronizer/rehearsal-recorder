import { X } from "lucide-react"

/**
 * A song's old names, under its title: the titles it had and the songs
 * merged into it, which typed in a name field are this song (rename and
 * merge songs spec, D6-D8). Each has × to forget it: typed again, it is a
 * new song. Nothing with none.
 */
export function OldNames({
  names,
  onForget,
}: {
  names: string[]
  onForget: (name: string) => void
}) {
  if (names.length === 0) return null
  return (
    <div
      data-old-names
      className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span>Also typed as</span>
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-full border py-0.5 pr-0.5 pl-2.5 text-foreground"
        >
          <span className="truncate">{name}</span>
          <button
            type="button"
            aria-label={`Forget ${name}`}
            title={`Forget ${name}: typed again, it is a new song`}
            onClick={() => onForget(name)}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
