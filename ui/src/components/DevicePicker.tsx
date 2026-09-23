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
  devices,
  value,
  onChange,
  placeholder,
  systemDefault = false,
  detail,
}: {
  id: string
  devices: Device[]
  value: number | null
  onChange: (index: number | null) => void
  placeholder: string
  /** Offer "System output" first, under any driver. */
  systemDefault?: boolean
  detail?: (d: Device) => string
}) {
  const drivers = useMemo(
    () => [...new Set(devices.map((d) => d.host_api))],
    [devices]
  )
  const current = devices.find((d) => d.index === value)
  const [driver, setDriver] = useState<string | null>(null)

  // Follow the saved device until the person picks a driver themselves.
  useEffect(() => {
    if (driver === null && drivers.length) {
      setDriver(current?.host_api ?? drivers[0])
    }
  }, [driver, drivers, current])

  const several = drivers.length > 1
  const shown = several ? devices.filter((d) => d.host_api === driver) : devices
  const selected =
    value === null
      ? systemDefault
        ? SYSTEM
        : ""
      : shown.some((d) => d.index === value)
        ? String(value)
        : ""

  return (
    <div className="flex flex-col gap-2">
      {several && (
        <Select value={driver ?? ""} onValueChange={setDriver}>
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
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {systemDefault && <SelectItem value={SYSTEM}>System output</SelectItem>}
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
