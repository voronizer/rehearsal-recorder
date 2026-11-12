import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * A name that goes onto a second line when it is longer than its place is
 * wide, rather than losing its end (spec D5): a track's in its row.
 * One line all the same: Enter does what it did in the one-line field this
 * replaced, nothing (focus stays, so a Space after it is typed, and does not
 * start the rehearsal), and a line break pasted into it becomes a space.
 *
 * The field takes its height from a copy of its text laid out the same way
 * beside it, unseen, so the browser grows it as it wraps: nothing is measured
 * by a script, and nothing jumps when it is first drawn.
 *
 * No frame: one round every name in a band's rows would read as a form. A
 * faint line under it says it can be written in (owner's pick C,
 * 2026-11-02): the shared text area's `line`. Its own growing stays, as
 * WebKit before Safari 26.2 cannot grow a field with its text (field-sizing).
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
  return (
    <div className={cn("grid min-w-0 flex-1", className)}>
      {/* The same box as the field's `line`: padding, size, line height, the
          line under it and where lines break. The space after it keeps an
          empty field one line tall. */}
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 border-b border-transparent py-1.5 text-sm leading-5 break-words whitespace-pre-wrap"
      >
        {value + " "}
      </span>
      <Textarea
        variant="line"
        rows={1}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault()
        }}
        className="col-start-1 row-start-1 block size-full min-w-0 field-sizing-fixed overflow-hidden transition-colors"
      />
    </div>
  )
}
