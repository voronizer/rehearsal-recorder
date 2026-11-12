import { Check, X } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

/**
 * A name changed where it stands (S7): a song's title, a set's name, a new
 * song's in a take's line. One field with ✓ and ✕ inside its frame; Enter
 * or ✓ does it, Esc or ✕ leaves it, and Esc goes no further, so a panel
 * round it stays open. What it says (why a name is turned down) is the
 * caller's, in its own place.
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
  /** 28 px, in a line of words; else 36 px, a heading's. */
  small?: boolean
  className?: string
  inputClassName?: string
}) {
  return (
    <InputGroup className={cn(small ? "h-7" : "h-9", className)}>
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
        className={cn("h-full min-w-0 px-2", inputClassName)}
      />
      <InputGroupAddon align="inline-end" className={cn("gap-0.5", small && "py-0")}>
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
