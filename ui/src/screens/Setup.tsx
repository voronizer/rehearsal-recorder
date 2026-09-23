import { useEffect, useRef, useState } from "react"
import {
  Activity,
  Check,
  HardDrive,
  History,
  Plus,
  Radio,
  Mic,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Shell, SpaceHint } from "@/components/Shell"
import { useSpacebar } from "@/hooks/useSpacebar"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/format"
import { api, type Device, type DiskEstimate, type Track, poll as pollPython } from "@/lib/api"

/** How often levels are polled during the signal check. */
const MONITOR_POLL_MS = 80

export function Setup({
  onStarted,
  onOpenHistory,
  onOpenSettings,
}: {
  onStarted: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
}) {
  const [devices, setDevices] = useState<Device[]>([])
  // The interface, rate and depth are settings, not per-rehearsal choices —
  // this screen reads them and shows what is in force.
  const [deviceIndex, setDeviceIndex] = useState<number | null>(null)
  const [samplerate, setSamplerate] = useState(44100)
  const [bitDepth, setBitDepth] = useState(24)
  const [name, setName] = useState("")
  const [tracks, setTracks] = useState<Track[]>([])
  const [saved, setSaved] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Signal check: listen to the inputs without recording, so everyone can
  // confirm they land on their own track.
  const [checking, setChecking] = useState(false)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const checkingRef = useRef(false)

  const [disk, setDisk] = useState<DiskEstimate | null>(null)

  useEffect(() => {
    ;(async () => {
      const devs = await api().list_input_devices()
      setDevices(devs)

      const cfg = await api().get_settings()
      const savedDeviceExists =
        cfg.device_index != null &&
        devs.some((d) => d.index === cfg.device_index)
      // A Windows choice saved before driver identities existed is dropped
      // on purpose (see audio/devices.py) — it can no longer be told apart
      // from a card that is simply unplugged. Guessing devs[0] here would
      // undo that: with several drivers it is usually an MME entry nobody
      // chose. With one driver (every Mac) there is nothing to guess
      // between, so the first-run behaviour is unchanged.
      const oneDriver = devs.every((d) => d.host_api === devs[0]?.host_api)

      setDeviceIndex(
        savedDeviceExists
          ? cfg.device_index
          : oneDriver
            ? (devs[0]?.index ?? null)
            : null
      )
      setSamplerate(cfg.samplerate ?? 44100)
      setBitDepth(cfg.bit_depth ?? 24)

      const tpl = await api().load_default_tracks()
      setTracks(
        tpl?.tracks?.length
          ? tpl.tracks
          : [
              { name: "Guitar 1", channel: 1 },
              { name: "Vocals", channel: 2 },
            ]
      )

      const today = new Date()
      setName(
        `Rehearsal ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(today.getDate()).padStart(2, "0")}`
      )
    })()
  }, [])

  // How much more fits on disk with these settings — worked out up front so
  // the space does not run out mid-rehearsal.
  useEffect(() => {
    if (!tracks.length) return
    let cancelled = false
    ;(async () => {
      try {
        const est = await api().disk_estimate(
          tracks.length,
          samplerate,
          bitDepth
        )
        if (!cancelled) setDisk(est)
      } catch {
        /* not critical */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tracks.length, samplerate, bitDepth])

  const device = devices.find((d) => d.index === deviceIndex)
  const maxChannels = device?.max_input_channels ?? 16
  const canStart =
    tracks.length > 0 &&
    tracks.every((t) => t.name.trim()) &&
    deviceIndex !== null &&
    !starting

  // Stopping the check is incidental: if it fails, that is no reason to block
  // someone from starting the rehearsal.
  const stopMonitorQuietly = async () => {
    try {
      await api().stop_monitor()
    } catch (e) {
      console.error("stop_monitor:", e)
    }
  }

  const stopCheck = async () => {
    checkingRef.current = false
    setChecking(false)
    setLevels({})
    await stopMonitorQuietly()
  }

  const startCheck = async () => {
    if (deviceIndex === null || !tracks.length) return
    setError(null)
    const res = await api().start_monitor(deviceIndex, samplerate, tracks)
    if (!res.ok) {
      setError(res.error ?? "Could not open the input for checking")
      return
    }
    setSeen({})
    setChecking(true)
    checkingRef.current = true

    // Poll in a chain rather than on an interval, so slow answers do not pile
    // requests on top of each other.
    const poll = async () => {
      if (!checkingRef.current) return
      try {
        const next = await pollPython("monitor_levels")
        if (!checkingRef.current) return
        setLevels(next)
        setSeen((prev) => {
          const merged = { ...prev }
          for (const [trackName, peak] of Object.entries(next)) {
            if (peak > 0.02) merged[trackName] = true
          }
          return merged
        })
      } catch {
        /* the bridge blinked — skip this tick */
      }
      if (checkingRef.current) window.setTimeout(poll, MONITOR_POLL_MS)
    }
    poll()
  }

  // Turn the check off when leaving the screen
  useEffect(() => {
    return () => {
      checkingRef.current = false
      void stopMonitorQuietly()
    }
  }, [])

  const start = async () => {
    if (!canStart || deviceIndex === null) return
    checkingRef.current = false
    setChecking(false)
    await stopMonitorQuietly()
    setStarting(true)
    setError(null)
    const res = await api().start_rehearsal(
      name.trim() || "Rehearsal",
      deviceIndex,
      samplerate,
      tracks,
      bitDepth
    )
    setStarting(false)
    if (!res.ok) {
      setError(res.error ?? "Could not start the rehearsal")
      return
    }
    onStarted()
  }

  useSpacebar(start, canStart)

  const saveTemplate = async () => {
    await api().save_default_tracks({ tracks })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  return (
    <Shell
      title="Rehearsal Recorder"
      headerAction={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onOpenHistory}>
            <History />
            History
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <SettingsIcon />
          </Button>
        </div>
      }
      footer={
        <div className="flex flex-col items-center gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button size="xl" onClick={start} disabled={!canStart}>
            <Radio />
            Start rehearsal
          </Button>
          <SpaceHint>starts the rehearsal</SpaceHint>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rehearsal-name">Rehearsal name</Label>
            <Input
              id="rehearsal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rehearsal"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Recording with</Label>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Change the interface and quality"
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Mic className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {device ? device.name : "No interface chosen"}
              </span>
              <span className="tnum shrink-0 text-xs text-muted-foreground">
                {samplerate / 1000} kHz · {bitDepth} bit
              </span>
            </button>
            <p className="text-xs text-muted-foreground">
              Changed in Settings — it belongs to the room, not to one
              rehearsal.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between">
            <div>
              <Label>Tracks</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                One per musician: a track name and the interface input it comes
                from.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={checking ? "default" : "outline"}
                size="sm"
                onClick={checking ? stopCheck : startCheck}
                disabled={!tracks.length || deviceIndex === null}
              >
                <Activity />
                {checking ? "Stop checking" : "Check signal"}
              </Button>
              <Button variant="outline" size="sm" onClick={saveTemplate}>
                {saved ? <Check /> : null}
                {saved ? "Template saved" : "Save as template"}
              </Button>
            </div>
          </div>

          {checking && (
            <p className="text-xs text-muted-foreground">
              Have everyone play in turn — the bar should move next to their own
              track. If the wrong one moves, change the input number.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {tracks.map((track, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
              >
                <Input
                  value={track.name}
                  aria-label={`Track ${i + 1} name`}
                  placeholder="Track name"
                  onChange={(e) =>
                    setTracks((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, name: e.target.value } : t
                      )
                    )
                  }
                  className="flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
                <Select
                  value={track.channel.toString()}
                  onValueChange={(v) =>
                    setTracks((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, channel: Number(v) } : t
                      )
                    )
                  }
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: maxChannels }, (_, c) => c + 1).map(
                      (c) => (
                        <SelectItem key={c} value={c.toString()}>
                          Input {c}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>

                {checking && (
                  <div className="flex w-40 shrink-0 items-center gap-2">
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full border bg-background">
                      <div
                        className="absolute inset-y-0 left-0 bg-signal transition-[width] duration-75"
                        style={{
                          width: `${Math.min(100, (levels[track.name] ?? 0) * 100)}%`,
                        }}
                      />
                    </div>
                    {seen[track.name] ? (
                      <span
                        className="flex items-center gap-1 text-[11px] text-signal"
                        title="Signal has arrived on this input"
                      >
                        <Check className="size-3" />
                        signal
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        silent
                      </span>
                    )}
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove track ${track.name}`}
                  onClick={() =>
                    setTracks((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={() =>
                setTracks((prev) => [
                  ...prev,
                  { name: "", channel: Math.min(prev.length + 1, maxChannels) },
                ])
              }
            >
              <Plus />
              Add track
            </Button>

            {/* Always on screen, not just when space runs low. */}
            {disk?.ok && disk.minutes !== undefined && (
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  disk.low ? "text-destructive" : "text-muted-foreground"
                )}
              >
                <HardDrive className="size-3.5" />
                {disk.low
                  ? `Low disk space: room for about ${formatDuration(disk.minutes)}`
                  : `Room for about ${formatDuration(disk.minutes)} of recording`}
              </span>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
