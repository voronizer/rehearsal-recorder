import { useEffect, useMemo, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Device } from "@/lib/api"

const SYSTEM = "default"

/**
 * A device, chosen through its driver when there is more than one.
 *
 * On Windows one card appears once per audio system — MME, WASAPI, ASIO —
 * with the same name and a different number of channels each time. In one
 * flat list that reads as copies of one card, and the useful copy is lost
 * among them. So the driver is chosen first, as in every other audio
 * program, and the devices under it are then all different things. With one
 * driver (every Mac) there is nothing to choose and only the devices show.
 *
 * Changing the driver saves nothing: nothing is chosen until a device is.
 */
export function DevicePicker({
  id,
  label,
  devices,
  value,
  onChange,
  placeholder,
  systemDefault = false,
  systemLabel = "System output",
  missing,
  detail,
  disabled = false,
}: {
  id: string
  /** The device list's name, for a screen reader: the group it is in says
   *  it on screen. */
  label: string
  devices: Device[]
  value: number | null
  onChange: (index: number | null) => void
  placeholder: string
  /** Offer "System output" first, under any driver. */
  systemDefault?: boolean
  /** That first item's words, where it means something else than the
   *  system's output: the click's "Where the player plays". */
  systemLabel?: string
  /** The saved device is not plugged in: these words show in its place,
   *  said under its own name (`notConnected`), whatever `value` is (Python
   *  gives no index for a device that is not there). */
  missing?: string
  detail?: (d: Device) => string
  /** While the list is being rebuilt: an index picked now may mean another
   *  device a moment later. */
  disabled?: boolean
}) {
  const drivers = useMemo(
    () => [...new Set(devices.map((d) => d.host_api))],
    [devices]
  )
  const current = devices.find((d) => d.index === value)
  const [driver, setDriver] = useState<string | null>(null)

  // Follow the saved device until the person picks a driver themselves, and
  // reset the same way if the driver they were on stops being offered — which
  // looking for interfaces again can do: a driver that is gone is no more
  // choosable than one never set.
  useEffect(() => {
    if (drivers.length && (driver === null || !drivers.includes(driver))) {
      setDriver(current?.host_api ?? drivers[0])
    }
  }, [driver, drivers, current])

  const several = drivers.length > 1
  const shown = several ? devices.filter((d) => d.host_api === driver) : devices
  const inShown = value !== null && shown.some((d) => d.index === value)
  // Nothing shows as chosen while the saved device is missing.
  const chosen = value === null ? (systemDefault ? SYSTEM : "") : inShown ? String(value) : ""
  const selected = missing ? "" : chosen
  // A device chosen on another driver than the one shown is not "nothing
  // chosen" — "System output" must only appear when it is actually
  // selected (value null). One saved but not plugged in is said as
  // `missing` says it. With no device to show, the ordinary placeholder
  // still applies.
  const devicePlaceholder =
    missing ?? (value !== null && !inShown && systemDefault ? "Pick an output" : placeholder)

  return (
    <div className="flex flex-col gap-2">
      {several && (
        <Select value={driver ?? ""} onValueChange={setDriver} disabled={disabled}>
          <SelectTrigger
            id={`${id}-driver`}
            aria-label="Driver"
            className="w-full"
          >
            <SelectValue placeholder="Pick a driver" />
          </SelectTrigger>
          <SelectContent>
            {drivers.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={selected}
        onValueChange={(v) => onChange(v === SYSTEM ? null : Number(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label={label} className="w-full">
          <SelectValue placeholder={devicePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {systemDefault && <SelectItem value={SYSTEM}>{systemLabel}</SelectItem>}
          {shown.map((d) => (
            <SelectItem key={d.index} value={String(d.index)}>
              {d.name}
              {detail ? detail(d) : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
