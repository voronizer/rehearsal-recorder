import { useEffect, useRef, useState } from "react"
import {
  Activity,
  Check,
  HardDrive,
  History,
  Plus,
  Radio,
  RefreshCw,
  Mic,
  Settings as SettingsIcon,
  Trash2,
  TriangleAlert,
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
import { FooterRow } from "@/components/FooterRow"
import { IconPicker } from "@/components/IconPicker"
import { LastTime } from "@/components/LastTime"
import { NameField } from "@/components/NameField"
import { END_COLUMN, ModeSwitch } from "@/components/midi/ModeSwitch"
import { NotesCheck } from "@/components/midi/NotesCheck"
import { PortPicker } from "@/components/midi/PortPicker"
import { NewDot } from "@/components/NewDot"
import { NewSetDialog, SetPicker } from "@/components/SetPicker"
import { Kbd, Shell } from "@/components/Shell"
import { chosenSet, useSets } from "@/hooks/useSets"
import { useSongChoices } from "@/hooks/useSongChoices"
import { useEscape, useSpacebar } from "@/hooks/useSpacebar"
import { byFiles, useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { cn } from "@/lib/utils"
import { useUpdate } from "@/lib/update"
import { aboutDuration, notConnected } from "@/lib/format"
import { QUIET_THRESHOLD, fallBack, meterReach } from "@/lib/levels"
import { modeOf, notesProblem, recordsAudio, recordsNotes } from "@/lib/midi"
import { findPort } from "@/lib/midiPorts"
import {
  api,
  type Device,
  type DiskEstimate,
  type LastTime as LastTimeData,
  type MidiActivity,
  type MidiPorts,
  type RecordMode,
  type Settings as SettingsData,
  type Take,
  type Track,
  poll as pollPython,
} from "@/lib/api"

/** How often levels are polled during the signal check. */
const MONITOR_POLL_MS = 80
// Whether the card is still sending — every couple of seconds, not a hot path.
const MONITOR_HEALTH_MS = 2000
/** How often the MIDI ports are read while a track takes notes: a port
 *  plugged in or pulled out shows on the cards by itself (spec P4). */
const MIDI_PORTS_POLL_MS = 1000

/** What a track's band entry keeps across interfaces: what is on screen when
 *  a card found by looking again is laid out. */
type BandMember = Pick<Track, "name" | "stereo" | "icon" | "mode" | "midi_port">

/** The name of the port a track keeps, or null while none is picked. */
const portName = (t: Track) => (t.midi_port?.name?.trim() ? t.midi_port.name : null)

/** The longest of these tracks' names, or null when there are none. */
const longestName = (ts: Track[]) =>
  ts.reduce<string | null>((a, t) => (a === null || t.name.length > a.length ? t.name : a), null)

/** One instrument plugged in twice, said beside a track's port (P8). */
function EchoNote({ name, echo, className }: { name: string; echo: string; className?: string }) {
  return (
    <p
      className={cn(
        "col-start-1 row-start-1 flex items-start gap-1.5 text-[11px] leading-3.5",
        className
      )}
    >
      <TriangleAlert className="size-3.5 shrink-0 text-warn" />
      {name} gets the same notes as {echo}. Is it one instrument plugged in twice?
    </p>
  )
}

export function Setup({
  onStarted,
  onOpenHistory,
  onOpenRehearsal,
  onOpenSong,
  onOpenSettings,
}: {
  onStarted: () => void
  onOpenHistory: () => void
  /** History, with that rehearsal chosen. */
  onOpenRehearsal: (folder: string) => void
  /** A song's page in History, from Last time; null is Not named's. The
   *  site's demo has no History to open, and leaves it out. */
  onOpenSong?: (title: string | null) => void
  onOpenSettings: () => void
}) {
  const [devices, setDevices] = useState<Device[]>([])
  const update = useUpdate()
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
  // Why the check stopped by itself: the card went quiet. True until the
  // next check, so it is said in place rather than as a notice.
  const [checkProblem, setCheckProblem] = useState<string | null>(null)
  // Where each bar stands, falling back from its peaks as on the recording
  // screen, and when it was last moved.
  const [levels, setLevels] = useState<Record<string, number[]>>({})
  const levelsAt = useRef(0)
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const checkingRef = useRef(false)
  // What the check hears from each track's port (P5, P8), where its bar
  // stands, and what each track recorded and from which port when the check
  // began: the ports the check opened. What the check says of a track is
  // about that port, never one picked since.
  const [heard, setHeard] = useState<MidiActivity>({})
  const [notesShown, setNotesShown] = useState<Record<string, number>>({})
  const [checkedPorts, setCheckedPorts] = useState<
    Record<string, { mode: RecordMode; port: string | null }>
  >({})

  // The MIDI ports the system lists; null until they have first been read.
  const [midiPorts, setMidiPorts] = useState<MidiPorts | null>(null)

  const [disk, setDisk] = useState<DiskEstimate | null>(null)

  // Last time, beside the setup: the rehearsal before this one, song by
  // song, to listen to before starting. Takes from several rehearsals, so
  // two takes 2 are told apart by their files.
  const [lastTime, setLastTime] = useState<LastTimeData | null>(null)
  const { cued, playInOverview, uncue, player } = useTakeStripPlayer(byFiles)

  // The interface that was chosen and is not plugged in. Not the same as
  // none chosen: the desk is often switched on after the laptop.
  const [missing, setMissing] = useState<SettingsData["missing_device"]>(null)
  // The set Start plays by (S1–S2), kept across restarts, and New set…
  // over this screen (S3), with the band's songs to add.
  const sets = useSets()
  const [makingSet, setMakingSet] = useState(false)
  const songChoices = useSongChoices(makingSet, null, null)
  const [rescanning, setRescanning] = useState(false)
  const [stillMissing, setStillMissing] = useState(false)

  /**
   * The interface in force and the tracks placed on it. `band` is what is on
   * screen, when there is something: a card found by looking again takes
   * the names as they have been edited, not as they were saved.
   *
   * Returns whether the chosen interface is still missing.
   */
  const loadInterface = async (band?: BandMember[]) => {
    const devs = await api().list_input_devices()
    setDevices(devs)

    const cfg = await api().get_settings()
    setMissing(cfg.missing_device)
    const savedDeviceExists =
      cfg.device_index != null &&
      devs.some((d) => d.index === cfg.device_index)
    // A Windows choice saved before driver identities existed is dropped
    // on purpose (see audio/devices.py) — it can no longer be told apart
    // from a card that is simply unplugged. Guessing devs[0] here would
    // undo that: with several drivers it is usually an MME entry nobody
    // chose. With one driver (every Mac) there is nothing to guess
    // between, so the first-run behaviour is unchanged — but only on a
    // first run. A card that was chosen and is not plugged in is not
    // swapped for the laptop's own microphone without a word.
    const oneDriver = devs.every((d) => d.host_api === devs[0]?.host_api)

    setDeviceIndex(
      savedDeviceExists
        ? cfg.device_index
        : oneDriver && !cfg.missing_device
          ? (devs[0]?.index ?? null)
          : null
    )
    setSamplerate(cfg.samplerate ?? 44100)
    setBitDepth(cfg.bit_depth ?? 24)

    // Which tracks these are — this card's own layout, another card's
    // names, or the first-run pair — is decided in one place, Python's
    // layouts.for_device(). The screen does not second-guess it.
    const tpl = await api().load_default_tracks(band)
    setTracks(tpl?.tracks ?? [])
    return cfg.missing_device !== null
  }

  useEffect(() => {
    void api()
      .last_time()
      .then(setLastTime)
      .catch((e) => console.error("Could not read last time:", e))
  }, [])

  // The ports, read while any track takes notes: at once when the first is
  // set to Both or MIDI, so its picker is ready, then every second. A band
  // with no MIDI never asks. In a chain rather than on an interval, so a slow
  // answer does not pile requests on top of each other.
  const anyNotes = tracks.some(recordsNotes)
  useEffect(() => {
    if (!anyNotes) return
    let on = true
    let timer = 0
    const read = async () => {
      try {
        const next = await pollPython("list_midi_ports")
        if (on) setMidiPorts(next)
      } catch {
        /* the bridge blinked — read them again next time */
      }
      if (on) timer = window.setTimeout(read, MIDI_PORTS_POLL_MS)
    }
    void read()
    return () => {
      on = false
      window.clearTimeout(timer)
    }
  }, [anyNotes])

  useEffect(() => {
    ;(async () => {
      await loadInterface()

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
  // the space does not run out mid-rehearsal. Counted in channels: a stereo
  // track writes two, and a track of notes alone none (its .mid is tiny).
  const channelCount = tracks.filter(recordsAudio).reduce((n, t) => n + (t.stereo ? 2 : 1), 0)
  useEffect(() => {
    if (!channelCount) return
    let cancelled = false
    ;(async () => {
      try {
        const est = await api().disk_estimate(
          channelCount,
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
  }, [channelCount, samplerate, bitDepth])

  const device = devices.find((d) => d.index === deviceIndex)
  const maxChannels = device?.max_input_channels ?? 16
  // A track waiting for an input: either the layout had more names than this
  // card has inputs, or a saved number is past what the driver now reports.
  // Both are the same thing to the person — nowhere to plug this musician in.
  // A track of notes alone has no input to wait for.
  const waiting = (t: Track) =>
    recordsAudio(t) && !!device && (t.channel === null || t.channel > maxChannels)
  const needInput = tracks.filter(waiting)
  const soundTracks = tracks.filter(recordsAudio).length
  // Two ways to not fit, and only one is fixable by renumbering. Five tracks
  // on a two-input card fit in no arrangement, so "pick one below" would be
  // asking for the impossible.
  const tooManyTracks = needInput.length > 0 && soundTracks > maxChannels
  // What stops Start for the notes (A1, P3, P2), in Python's own words, so
  // pressing Start would not say something else.
  const notesSay = notesProblem(
    tracks.map((t) => ({ ...t, name: t.name.trim() || "An unnamed track" }))
  )
  const canStart =
    tracks.length > 0 &&
    tracks.every((t) => t.name.trim()) &&
    needInput.length === 0 &&
    notesSay === null &&
    deviceIndex !== null &&
    !starting

  /**
   * Whether the check opened this track's port: the track records as it did
   * when the check began, from the same port. Only then does the check say
   * anything of it; a port picked since, which nothing listens to, says
   * nothing until the next check (it would say "no notes" while notes come).
   */
  const checkOpened = (t: Track) => {
    const began = checking ? checkedPorts[t.name] : undefined
    return (
      !!began && began.port !== null && began.mode === modeOf(t) && began.port === portName(t)
    )
  }
  /** What the check last heard from a track's port, when it opened it. */
  const heardFrom = (t: Track) => (checkOpened(t) ? heard[t.name] : undefined)

  /**
   * How a track's port stands: null for a track that takes no notes, "none"
   * while none is picked (P3). The check says best how an open port is; the
   * list says whether the port is there at all (P1), and two alike that
   * nothing tells apart count as not there. Before the list is first read,
   * nothing is said against a port.
   */
  const portStanding = (t: Track): "none" | "ok" | "missing" | "in_use" | null => {
    if (!recordsNotes(t)) return null
    if (!t.midi_port || portName(t) === null) return "none"
    const state = heardFrom(t)?.state
    if (state === "in_use") return "in_use"
    if (state === "missing" || state === "ambiguous") return "missing"
    if (state === "ok" || !midiPorts) return "ok"
    return findPort(t.midi_port, midiPorts.ports).port ? "ok" : "missing"
  }
  // The tracks whose port is picked and not to be had: they wait, and Start
  // goes ahead (D7, P5).
  const portsAway = tracks.flatMap((t) => {
    const standing = portStanding(t)
    return standing === "missing" || standing === "in_use" ? [{ track: t, standing }] : []
  })

  const setTrack = (i: number, patch: Partial<Track>) =>
    setTracks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  /**
   * What a track records. Notes start with no port picked, so nobody's notes
   * land on a port they did not choose (P3); a track that records sound
   * again from notes alone takes the first input nobody has.
   */
  const setMode = (i: number, mode: RecordMode) =>
    setTracks((prev) =>
      prev.map((t, j) => {
        if (j !== i) return t
        const port = mode !== "audio" && recordsNotes(t) ? (t.midi_port ?? null) : null
        if (mode === "midi") return { ...t, mode, midi_port: port, channel: null, stereo: false }
        const taken = (c: number) =>
          prev.some(
            (o, k) =>
              k !== i &&
              recordsAudio(o) &&
              o.channel !== null &&
              (o.channel === c || (!!o.stereo && o.channel + 1 === c))
          )
        const free = Array.from({ length: maxChannels }, (_, c) => c + 1).find((c) => !taken(c))
        const channel = recordsAudio(t) ? t.channel : (free ?? null)
        return { ...t, mode, midi_port: port, channel }
      })
    )

  // PortAudio lists the interfaces once, when the app starts, so a desk
  // switched on afterwards is found only by looking again.
  const lookAgain = async () => {
    setError(null)
    setStillMissing(false)
    if (checking) await stopCheck()
    setRescanning(true)
    try {
      const res = await api().rescan_devices()
      if (!res.ok) {
        setError(res.error ?? "Could not look for interfaces")
        return
      }
      setStillMissing(
        await loadInterface(
          tracks.map((t) => ({
            name: t.name,
            stereo: t.stereo,
            icon: t.icon,
            mode: t.mode,
            midi_port: t.midi_port,
          }))
        )
      )
      // Looking again reads the MIDI ports again too (P4), when a track
      // takes notes.
      if (anyNotes) {
        void pollPython("list_midi_ports")
          .then(setMidiPorts)
          .catch(() => {})
      }
    } finally {
      setRescanning(false)
    }
  }

  // Stopping the check is incidental: if it fails, that is no reason to block
  // someone from starting the rehearsal. `keepPorts`: the rehearsal about to
  // start takes the check's MIDI ports as they are, open.
  const stopMonitorQuietly = async (keepPorts?: boolean) => {
    try {
      await (keepPorts ? api().stop_monitor(true) : api().stop_monitor())
    } catch (e) {
      console.error("stop_monitor:", e)
    }
  }

  const stopCheck = async () => {
    checkingRef.current = false
    setChecking(false)
    setLevels({})
    setHeard({})
    setNotesShown({})
    levelsAt.current = 0
    await stopMonitorQuietly()
  }

  const startCheck = async () => {
    if (deviceIndex === null || !tracks.length) return
    // Listening to last time and to the inputs at once is one sound too
    // many to tell which track is which.
    uncue()
    setError(null)
    setCheckProblem(null)
    const res = await api().start_monitor(deviceIndex, samplerate, tracks)
    if (!res.ok) {
      setError(res.error ?? "Could not open the input for checking")
      return
    }
    setSeen({})
    setHeard({})
    setNotesShown({})
    const noted = tracks.filter(recordsNotes)
    setCheckedPorts(
      Object.fromEntries(noted.map((t) => [t.name, { mode: modeOf(t), port: portName(t) }]))
    )
    setChecking(true)
    checkingRef.current = true

    // Poll in a chain rather than on an interval, so slow answers do not pile
    // requests on top of each other. The notes are asked for with the levels,
    // and only when a track takes any.
    const poll = async () => {
      if (!checkingRef.current) return
      try {
        const [next, notes] = await Promise.all([
          pollPython("monitor_levels"),
          noted.length ? pollPython("midi_activity").catch(() => null) : null,
        ])
        if (!checkingRef.current) return
        const now = Date.now()
        const since = levelsAt.current ? now - levelsAt.current : 0
        levelsAt.current = now
        if (notes) {
          setHeard(notes)
          // Each note's velocity, falling back between notes as a level does.
          setNotesShown((prev) =>
            Object.fromEntries(
              Object.entries(notes).map(([trackName, a]) => [
                trackName,
                fallBack(prev[trackName] ?? 0, a.vel, since),
              ])
            )
          )
        }
        setLevels((prev) =>
          Object.fromEntries(
            Object.entries(next).map(([trackName, sides]) => [
              trackName,
              sides.map((p, i) => fallBack(prev[trackName]?.[i] ?? 0, p, since)),
            ])
          )
        )
        setSeen((prev) => {
          const merged = { ...prev }
          for (const [trackName, sides] of Object.entries(next)) {
            // Every side has to arrive before a track counts as checked: half
            // a stereo pair is exactly what this screen is here to catch.
            if (sides.length && sides.every((p) => p > QUIET_THRESHOLD)) {
              merged[trackName] = true
            }
          }
          return merged
        })
      } catch {
        /* the bridge blinked — skip this tick */
      }
      if (checkingRef.current) window.setTimeout(poll, MONITOR_POLL_MS)
    }
    poll()

    // Unplugged mid-check, a card leaves every bar at rest and says nothing;
    // Python notices, and the check stops and says so.
    const watch = async () => {
      if (!checkingRef.current) return
      try {
        const h = await pollPython("monitor_health")
        if (!checkingRef.current) return
        if (h.problem) {
          setCheckProblem(h.problem)
          await stopCheck()
          return
        }
      } catch {
        /* the bridge blinked — ask again next time */
      }
      if (checkingRef.current) window.setTimeout(watch, MONITOR_HEALTH_MS)
    }
    window.setTimeout(watch, MONITOR_HEALTH_MS)
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
    uncue()
    checkingRef.current = false
    setChecking(false)
    // The ports the check opened go to the rehearsal still open: a pedal held
    // down is still held, and nothing is missed while they would reopen.
    await stopMonitorQuietly(true)
    setStarting(true)
    setError(null)
    const res = await api().start_rehearsal(
      name.trim() || "Rehearsal",
      deviceIndex,
      samplerate,
      tracks,
      bitDepth,
      await chosenSet()
    )
    setStarting(false)
    if (!res.ok) {
      // No rehearsal took the ports the check left open: they go, or one
      // another app could use stays held with nothing listening to it.
      await stopMonitorQuietly()
      setError(res.error ?? "Could not start the rehearsal")
      return
    }
    onStarted()
  }

  // Something from last time playing has Space and Escape, as a take
  // playing in history's overview does; Start gets them back once it stops.
  const inHand = cued !== null
  useSpacebar(inHand ? player.toggle : start, (inHand || canStart) && !makingSet)
  useEscape(uncue, inHand)

  const playLastTime = (take: Take) => {
    if (checking) void stopCheck()
    playInOverview(take)
  }

  const saveTemplate = async () => {
    // device_index says which card this layout is for. It does not change the
    // chosen recording device — that lives in Settings.
    await api().save_default_tracks({ tracks, device_index: deviceIndex ?? undefined })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  return (
    <Shell
      playback
      // The one screen that says the app's name, so the logo goes with it —
      // the small drawing, the one that still reads at this size.
      title={
        <span className="flex items-center gap-2.5">
          <img src="./favicon.svg" alt="" className="size-6 shrink-0" />
          РЭХА
        </span>
      }
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
            aria-label={update.latest ? "Settings, a new version is out" : "Settings"}
            title={update.latest ? `${update.latest.version} is out` : undefined}
            className="relative"
          >
            <SettingsIcon />
            {update.latest && <NewDot />}
          </Button>
        </div>
      }
      // With last time beside it the screen is two columns, each scrolling
      // on its own; the Shell's padding moves into them.
      className={
        lastTime?.last
          ? "p-0 min-[1100px]:flex min-[1100px]:overflow-hidden"
          : undefined
      }
      footer={
        <FooterRow error={error}>
          <div className="flex items-center gap-3">
            <SetPicker
              sets={sets.sets}
              chosen={sets.chosen}
              onChoose={sets.choose}
              onNew={() => setMakingSet(true)}
            />
            <Button
              size="xl"
              onClick={start}
              disabled={!canStart}
              aria-keyshortcuts={inHand ? undefined : "Space"}
            >
              <Radio />
              Start rehearsal
              {!inHand && <Kbd>Space</Kbd>}
            </Button>
          </div>
          <NewSetDialog
            open={makingSet}
            onOpenChange={setMakingSet}
            choices={songChoices}
            onCreated={(all, id) => {
              sets.replace(all)
              sets.choose(id)
            }}
          />
        </FooterRow>
      }
    >
      {/* Last time beside the setup when the window is wide enough for both
          — on the left, so that the setup is over Start rehearsal — and
          under it when it is not. */}
      <div
        className={cn(
          lastTime?.last &&
            "px-6 py-6 min-[1100px]:min-w-0 min-[1100px]:flex-1 min-[1100px]:overflow-y-auto"
        )}
      >
        <div className="mx-auto flex max-w-3xl min-w-0 flex-col gap-8">
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
                  {device
                    ? device.name
                    : missing
                      ? notConnected(
                          missing,
                          new Set(devices.map((d) => d.host_api)).size > 1
                        )
                      : "No interface chosen"}
                </span>
                <span className="tnum shrink-0 text-xs text-muted-foreground">
                  {device
                    ? `${device.max_input_channels} ${
                        device.max_input_channels === 1 ? "input" : "inputs"
                      } · `
                    : ""}
                  {samplerate / 1000} kHz · {bitDepth} bit
                </span>
              </button>
              {!device && missing ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Plug it in and switch it on, then look again.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void lookAgain()}
                      disabled={rescanning}
                      className="shrink-0"
                    >
                      <RefreshCw className={cn(rescanning && "animate-spin")} />
                      {rescanning ? "Looking…" : "Look again"}
                    </Button>
                  </div>
                  {stillMissing && !rescanning && (
                    <p
                      role="status"
                      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
                    >
                      Still not there. Check that it is switched on and its cable
                      is in this computer — some desks take a minute to start.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Changed in Settings — it belongs to the room, not to one
                  rehearsal.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between">
              <div>
                <Label>Tracks</Label>
                {/* The check's own words take this line's place while it
                    runs, in a place as tall as the longer of the two, so the
                    cards under it never move. */}
                <p className="mt-1 grid text-xs text-muted-foreground">
                  <span className={cn("col-start-1 row-start-1", checking && "invisible")}>
                    One per musician: a track name and the interface input it comes
                    from.
                  </span>
                  <span className={cn("col-start-1 row-start-1", !checking && "invisible")}>
                    Have everyone play in turn — the bar should move next to their own
                    track. If the wrong one moves, change the input number.
                  </span>
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
                  {/* As wide whichever it says, so nothing beside it moves. */}
                  <span className="grid">
                    <span className={cn("col-start-1 row-start-1", checking && "invisible")}>
                      Check signal
                    </span>
                    <span className={cn("col-start-1 row-start-1", !checking && "invisible")}>
                      Stop checking
                    </span>
                  </span>
                </Button>
                <Button variant="outline" size="sm" onClick={saveTemplate}>
                  {saved ? <Check /> : null}
                  {saved ? "Template saved" : "Save as template"}
                </Button>
              </div>
            </div>

            {checkProblem && (
              <p
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
              >
                {checkProblem}
              </p>
            )}

            {needInput.length > 0 && (
              <p
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
              >
                {tooManyTracks ? (
                  <>
                    “{device?.name}” has {maxChannels}{" "}
                    {maxChannels === 1 ? "input" : "inputs"} — not enough for{" "}
                    {soundTracks} tracks. Record fewer at once, or use an
                    interface with more inputs.
                  </>
                ) : (
                  <>
                    {needInput.map((t) => t.name || "An unnamed track").join(", ")}
                    {needInput.length === 1 ? " has" : " have"} no input on “
                    {device?.name}” — it has {maxChannels}{" "}
                    {maxChannels === 1 ? "input" : "inputs"}. Pick one below.
                  </>
                )}
              </p>
            )}

            {/* The notes' own notes, in a place one note tall kept while any
                track takes notes, so one that comes by itself (a port pulled
                out, another app taking it) moves no card. It grows only
                while two are up at once. A band with no MIDI has no place. */}
            {anyNotes && (
              <div data-notes-strip className="grid">
                <p
                  aria-hidden
                  className="invisible col-start-1 row-start-1 border px-3 py-2 text-xs"
                >
                  &nbsp;
                </p>
                <div className="col-start-1 row-start-1 flex flex-col gap-3">
                  {notesSay && (
                    <p
                      role="status"
                      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
                    >
                      {notesSay}
                    </p>
                  )}

                  {/* A port picked and not to be had stops nothing: the track
                      takes its notes from the moment it is (D7, P5). */}
                  {portsAway.length > 0 && (
                    <p
                      role="status"
                      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
                    >
                      {portsAway.map(({ track, standing }, k) => (
                        <span key={k} className="block">
                          {standing === "in_use"
                            ? `“${portName(track)}” is in use by another app.`
                            : `“${portName(track)}” is not connected. ${
                                track.name.trim() || "An unnamed track"
                              } records its notes from the moment it is plugged in.`}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {tracks.map((track, i) => {
                const standing = portStanding(track)
                const away = standing === "missing" || standing === "in_use"
                const ear = heardFrom(track)
                // What P8 says of this track; and the longest it could say,
                // while another track takes notes too, to keep its place.
                const echo = ear?.echo ?? null
                const echoRoom = recordsNotes(track)
                  ? longestName(tracks.filter((o, k) => k !== i && recordsNotes(o)))
                  : null
                const echoWith = echo ?? echoRoom
                const listed = track.midi_port && midiPorts
                  ? findPort(track.midi_port, midiPorts.ports).port
                  : null
                return (
                  <div
                    key={i}
                    data-track-card
                    className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3"
                  >
                    {/* Who it is and what it records. A long name goes onto a
                        second line rather than losing its end (D5). */}
                    <div className="flex items-start gap-3">
                      <IconPicker
                        label={`Track ${i + 1} icon`}
                        name={track.name || `track ${i + 1}`}
                        value={track.icon}
                        onChange={(icon) => setTrack(i, { icon })}
                      />
                      <NameField
                        label={`Track ${i + 1} name`}
                        placeholder="Track name"
                        value={track.name}
                        onChange={(name) => setTrack(i, { name })}
                      />
                      <ModeSwitch
                        label={`Track ${i + 1} records`}
                        value={modeOf(track)}
                        onChange={(mode) => setMode(i, mode)}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove track ${track.name}`}
                        onClick={() =>
                          setTracks((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    </div>

                    {/* Under the name, a line for each thing it records, the
                        check's meter at the end. The meter's place is kept
                        while nothing is checked, so a check moves nothing. */}
                    {recordsAudio(track) && (
                      <div className="flex items-center gap-3 px-11">
                        <Select
                          value={waiting(track) ? "" : String(track.channel ?? "")}
                          onValueChange={(v) => setTrack(i, { channel: Number(v) })}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Track ${i + 1} input`}
                            className={
                              "w-32" +
                              (waiting(track)
                                ? " border-amber-500/60 text-muted-foreground"
                                : "")
                            }
                          >
                            <SelectValue placeholder="No input" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: maxChannels }, (_, c) => c + 1)
                              // A stereo track takes the input after its own, so the
                              // last input is not somewhere it can start.
                              .filter((c) => !track.stereo || c < maxChannels)
                              .map((c) => (
                                <SelectItem key={c} value={c.toString()}>
                                  {track.stereo ? `Inputs ${c}–${c + 1}` : `Input ${c}`}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>

                        <Button
                          type="button"
                          size="sm"
                          variant={track.stereo ? "default" : "outline"}
                          aria-pressed={!!track.stereo}
                          aria-label={`Track ${i + 1} in stereo`}
                          title="Two adjacent inputs, written as one stereo file"
                          onClick={() =>
                            setTracks((prev) =>
                              prev.map((t, j) => {
                                if (j !== i) return t
                                const stereo = !t.stereo
                                // Turning stereo on claims the input after this one.
                                // Where that input is somebody else's, or past the
                                // end of the card, the track is left waiting for one
                                // rather than quietly recording the same signal twice.
                                const clash =
                                  stereo &&
                                  t.channel !== null &&
                                  (t.channel + 1 > maxChannels ||
                                    prev.some(
                                      (o, k) =>
                                        k !== i &&
                                        o.channel !== null &&
                                        (o.channel === t.channel! + 1 ||
                                          (!!o.stereo && o.channel + 1 === t.channel! + 1))
                                    ))
                                return { ...t, stereo, channel: clash ? null : t.channel }
                              })
                            )
                          }
                        >
                          Stereo
                        </Button>

                        <div
                          data-check-slot="signal"
                          className={cn("ml-auto flex shrink-0", END_COLUMN)}
                        >
                          <div
                            className={cn(
                              "flex flex-1 items-center gap-2",
                              !checking && "invisible"
                            )}
                          >
                            {/* One bar of the usual height, split along its length for
                                a stereo track: left above, right below. A dead half
                                of a pair has to be visible here or the check has not
                                done its job. In dB, as on the recording screen and
                                the desk. */}
                            <div
                              data-meter={track.name}
                              className="relative h-2 flex-1 overflow-hidden rounded-full border bg-background"
                            >
                              {(levels[track.name] ?? [0]).map((side, k, all) => (
                                <div
                                  key={k}
                                  className="absolute left-0 bg-signal transition-[width] duration-75"
                                  style={{
                                    width: `${meterReach(side) * 100}%`,
                                    top: all.length > 1 && k === 1 ? "50%" : 0,
                                    bottom: all.length > 1 && k === 0 ? "50%" : 0,
                                  }}
                                />
                              ))}
                            </div>
                            {seen[track.name] ? (
                              <span
                                className="flex w-12 items-center gap-1 text-[11px] text-signal"
                                title="Signal has arrived on this input"
                              >
                                <Check className="size-3" />
                                signal
                              </span>
                            ) : (
                              <span className="w-12 text-[11px] text-muted-foreground">
                                silent
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {recordsNotes(track) && (
                      <div className="flex items-center gap-3 px-11">
                        <PortPicker
                          label={`Track ${i + 1} MIDI port`}
                          value={track.midi_port}
                          ports={midiPorts}
                          counting={checking}
                          warn={standing === "none" || away}
                          onChange={(port) => setTrack(i, { midi_port: port })}
                        />
                        {/* One instrument plugged in twice: said, and nothing
                            stopped (P8). Beside the port, in a place kept
                            while another track takes notes too: the longest
                            it could say lies there unseen, so the card is as
                            tall, and the port as wide, before it is said as
                            after. */}
                        <div
                          className={cn("grid min-w-0 flex-1", echoWith !== null && "min-w-40")}
                        >
                          {echoWith !== null && (
                            <EchoNote
                              name={track.name}
                              echo={echoWith}
                              className={cn(!echo && "invisible")}
                            />
                          )}
                          {echo && echoRoom !== null && echoRoom !== echo && (
                            <EchoNote
                              name={track.name}
                              echo={echoRoom}
                              className="invisible"
                            />
                          )}
                        </div>
                        <div
                          data-check-slot="notes"
                          className={cn("ml-auto grid shrink-0 items-center", END_COLUMN)}
                        >
                          {/* Only for a port the check opened: one picked
                              since says nothing until the next check. */}
                          <NotesCheck
                            seen={(ear?.notes ?? 0) > 0 || (listed?.notes ?? 0) > 0}
                            vel={ear ? (notesShown[track.name] ?? 0) : 0}
                            className={cn(
                              "col-start-1 row-start-1",
                              (!checkOpened(track) || away) && "invisible"
                            )}
                          />
                          <span
                            className={cn(
                              "col-start-1 row-start-1 text-[11px] text-muted-foreground",
                              !away && "invisible"
                            )}
                          >
                            not connected
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                // A new track records Audio, on the input after the others'.
                onClick={() =>
                  setTracks((prev) => [
                    ...prev,
                    {
                      name: "",
                      channel: Math.min(prev.filter(recordsAudio).length + 1, maxChannels),
                    },
                  ])
                }
              >
                <Plus />
                Add track
              </Button>

              {/* Always on screen, not just when space runs low — while
                  any track records sound, which is what fills a disk. */}
              {disk?.ok && disk.minutes !== undefined && channelCount > 0 && (
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs",
                    disk.low ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  <HardDrive className="size-3.5" />
                  {disk.low
                    ? `Low disk space: room for ${aboutDuration(disk.minutes)}`
                    : `Room for ${aboutDuration(disk.minutes)} of recording`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* The past set back from the rehearsal about to start: a panel of its
          own, darker, down the side, as history's list is. With both on the
          same background the two columns ran into one. */}
      {lastTime?.last && (
        <div className="border-t bg-panel px-6 py-6 min-[1100px]:order-first min-[1100px]:w-[26rem] min-[1100px]:shrink-0 min-[1100px]:overflow-y-auto min-[1100px]:border-t-0 min-[1100px]:border-r min-[1100px]:px-5">
          {/* Under the tracks, as wide as they are. */}
          <div className="mx-auto max-w-3xl">
            <LastTime
              data={lastTime}
              playback={
                cued && {
                  take: cued,
                  playing: player.playing,
                  loading: player.loading,
                  position: player.position,
                }
              }
              problem={cued ? player.loadError : null}
              onPlay={playLastTime}
              onOpen={onOpenRehearsal}
              onAll={onOpenHistory}
              onOpenSong={onOpenSong}
            />
          </div>
        </div>
      )}
    </Shell>
  )
}
