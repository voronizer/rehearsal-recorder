import { cn } from "@/lib/utils"

/**
 * A name that goes onto a second line when it is longer than its place is
 * wide, rather than losing its end (spec D5): a track's on its setup card.
 * One line all the same: Enter finishes it, and a line break pasted into it
 * becomes a space.
 *
 * The field takes its height from a copy of its text laid out the same way
 * beside it, unseen, so the browser grows it as it wraps: nothing is measured
 * by a script, and nothing jumps when it is first drawn.
 */
export function NameField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  /** What the field is called: "Track 1 name". */
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  // The same box for both: padding, size, line height and where lines break.
  const text = "px-0 py-1.5 text-sm leading-5 break-words whitespace-pre-wrap"
  return (
    <div className={cn("grid min-w-0 flex-1", className)}>
      {/* The space after it keeps an empty field one line tall. */}
      <span aria-hidden className={cn("invisible col-start-1 row-start-1", text)}>
        {value + " "}
      </span>
      <textarea
        rows={1}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className={cn(
          "col-start-1 row-start-1 block size-full min-w-0 resize-none overflow-hidden border-0 bg-transparent outline-none",
          "selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground",
          text
        )}
      />
    </div>
  )
}
