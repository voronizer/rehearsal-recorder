import { useSyncExternalStore, type ReactNode } from "react"
import { Check, X } from "lucide-react"
import { FieldError } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

/** What a name being changed says, for the one with `id`: `bad`, why it is turned down. */
export type Said = { id: number; text: string; bad: boolean }

/**
 * The line under a name changed where it stands, on its page: a song's
 * facts, a set's songs and length. While the name is a field, what it says
 * takes that line's place, so nothing below moves (S11). The field `say`s
 * it, `null` once it closes; the page draws `Line` with its own line
 * inside. One for each kind of name, as a song and a set can share an id.
 */
export function lineUnder() {
  let line: Said | null = null
  const heard = new Set<() => void>()
  const subscribe = (f: () => void) => {
    heard.add(f)
    return () => void heard.delete(f)
  }
  const say = (next: Said | null) => {
    line = next
    heard.forEach((f) => f())
  }
  /** The page's own line, or what the name says: why it is turned down as under any field, anything else small. */
  function Line({ id, children }: { id: number; children: ReactNode }) {
    const said = useSyncExternalStore(subscribe, () => (line && line.id === id ? line : null))
    if (said === null || !said.text) return <>{children}</>
    if (said.bad) return <FieldError>{said.text}</FieldError>
    return <span className="text-xs">{said.text}</span>
  }
  return { say, Line }
}

/**
 * A name changed where it stands (S7): a song's title, a set's name, a new
 * song's in a take's line. One field with ✓ and ✕ inside its frame; Enter
 * or ✓ does it, Esc or ✕ leaves it, and Esc goes no further, so a panel
 * round it stays open. What it says (why a name is turned down) is the
 * caller's, in its own place: on a page, in the line under the name
 * (`lineUnder`).
 */
export function InPlace({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  invalid,
  selectAll,
  ok,
  onOk,
  leave,
  onLeave,
  small,
  className,
  inputClassName,
}: {
  /** The field's name. */
  label: string
  value: string
  onChange: (value: string) => void
  maxLength: number
  placeholder?: string
  invalid?: boolean
  /** The name is selected as it opens, to be typed over. */
  selectAll?: boolean
  /** ✓'s name, and whether it can be pressed now. */
  ok: { label: string; disabled?: boolean }
  onOk: () => void
  /** ✕'s name. */
  leave: string
  onLeave: () => void
  /**
   * 28 px, in a line of words; else 32 px, as tall as a heading's row, so
   * opening it moves nothing, its name in the heading's own letters.
   */
  small?: boolean
  className?: string
  inputClassName?: string
}) {
  return (
    <InputGroup className={cn(small ? "h-7" : "h-8", className)}>
      <InputGroupInput
        aria-label={label}
        autoFocus
        onFocus={selectAll ? (e) => e.currentTarget.select() : undefined}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onOk()
          } else if (e.key === "Escape") {
            // Esc closes a panel too; here it only leaves the field.
            e.preventDefault()
            e.stopPropagation()
            onLeave()
          }
        }}
        // In a heading, the heading's size at every width, over the shared field's 14 px from 768 px.
        className={cn("h-full min-w-0 px-2", !small && "py-0 text-[length:inherit] md:text-[length:inherit]", inputClassName)}
      />
      <InputGroupAddon align="inline-end" className="gap-0.5 py-0">
        <InputGroupButton size="icon-xs" aria-label={ok.label} disabled={ok.disabled} onClick={onOk}>
          <Check />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label={leave} onClick={onLeave}>
          <X className="text-muted-foreground" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
