import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MidiGlyph } from "@/components/midi/MidiGlyph"
import type { MidiPort, MidiPortRef, MidiPorts } from "@/lib/api"
import { findPort, portRef } from "@/lib/midiPorts"
import { cn } from "@/lib/utils"

/** No port listed in the system: what the picker says instead of a list. */
export const NO_PORTS = "No MIDI ports. Plug one in."

// The tick beside the port picked, in a box as big as it is: nothing in the
// list spills out of its box (spec D5).
const ITEM = "*:data-[slot=select-item-indicator]:size-4"

/** The value of the saved port when it is not one of those listed. */
const SAVED = "saved"

/** An item's value and key: the port's id where the system gives one, which
 *  two ports of the same name never share, else its place in the list. */
const keyOf = (port: MidiPort, at: number) => (port.id ? `id:${port.id}` : `at:${at}:${port.name}`)

/** A port's name after the MIDI sign. A long one goes onto a second line
 *  rather than losing its end (spec D5). */
function PortName({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <MidiGlyph className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 text-left break-words">{name}</span>
    </span>
  )
}

/**
 * The port a track's notes come from: the ports the system lists now, in
 * Python's order (a device's playing port first, P7). The saved port, when it
 * is not plugged in, is listed too and marked "not connected" (D7); two ports
 * it could equally be are both listed and neither is taken for it (P1).
 * During the check, a port notes have come from is marked "✓ notes", which
 * tells a keyboard's playing port from its DAW port.
 *
 * The list drops below the picker rather than over it, as the app's other
 * pickers do, because it can change while it is open (a port plugged in
 * shows up in it) and can be empty.
 */
export function PortPicker({
  label,
  value,
  ports,
  counting,
  warn,
  onChange,
}: {
  /** What the picker is called: "Track 1 MIDI port". */
  label: string
  /** The port the track keeps; null while none is picked. */
  value: MidiPortRef | null | undefined
  /** The ports the system lists; null until they have first been read. */
  ports: MidiPorts | null
  /** During the check: mark the ports that notes have come from. */
  counting: boolean
  /** An amber edge: no port picked yet, or the one picked is not there. */
  warn: boolean
  onChange: (port: MidiPortRef) => void
}) {
  const listed = ports?.ports ?? []
  const found = value ? findPort(value, listed) : null
  const missing = !!value && !!ports && !found?.port && !found?.alike
  const selected = !value
    ? ""
    : found?.port
      ? keyOf(found.port, listed.indexOf(found.port))
      : SAVED
  const none = ports && !listed.length ? (ports.error ?? NO_PORTS) : null

  return (
    <Select
      value={selected}
      onValueChange={(v) => {
        const at = listed.findIndex((p, i) => keyOf(p, i) === v)
        if (at >= 0) onChange(portRef(listed[at]))
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn(
          // Grows to a second line for a long name instead of cutting it.
          "h-auto min-h-8 max-w-sm min-w-0 py-1 text-left whitespace-normal data-[size=sm]:h-auto",
          "*:data-[slot=select-value]:line-clamp-none",
          warn && "border-amber-500/60"
        )}
      >
        <SelectValue placeholder={none ?? "No port"}>
          {value && <PortName name={found?.port?.name ?? value.name} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="max-w-[min(24rem,var(--radix-select-content-available-width))]"
      >
        {missing && (
          <SelectItem value={SAVED} className={ITEM}>
            <PortName name={value.name} />
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
              not connected
            </span>
          </SelectItem>
        )}
        {listed.map((port, at) => (
          <SelectItem key={keyOf(port, at)} value={keyOf(port, at)} className={ITEM}>
            <PortName name={port.name} />
            {counting && port.notes > 0 && (
              <span className="ml-auto shrink-0 pl-2 text-[11px] text-primary">✓ notes</span>
            )}
          </SelectItem>
        ))}
        {none && <p className="px-2 py-1.5 text-sm text-muted-foreground">{none}</p>}
      </SelectContent>
    </Select>
  )
}
