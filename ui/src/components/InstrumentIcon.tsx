import { instrument } from "@/lib/instruments"

/** A member's icon — see lib/instruments. data-icon says which was drawn,
 *  after the fallback. */
export function InstrumentIcon({
  icon,
  className,
}: {
  icon?: string | null
  className?: string
}) {
  const { key, Glyph } = instrument(icon)
  return <Glyph className={className} data-icon={key} />
}
