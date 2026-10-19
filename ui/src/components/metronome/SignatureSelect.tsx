import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Signature } from "@/lib/api"
import { SIGNATURES } from "@/lib/metronome"

/**
 * The time signature, one of the four, picked from the shared select. The
 * four are as wide as each other in tabular figures, so picking another
 * moves nothing beside it.
 */
export function SignatureSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: Signature
  onChange: (signature: Signature) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Signature)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" aria-label="Time signature" className="tnum gap-1.5 px-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SIGNATURES.map((s) => (
          <SelectItem key={s} value={s} className="tnum">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
