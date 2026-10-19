import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AudioLines,
  Check,
  History,
  PanelLeftOpen,
  Plus,
  Radio,
  RefreshCw,
  Mic,
  Settings as SettingsIcon,
} from "lucide-react"
import { Warning } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FigureLine, Figures, WholeTip, useCut } from "@/components/ui/whole"
import { FooterRow } from "@/components/FooterRow"
import { DiskLine } from "@/components/HealthLine"
import { LastTime } from "@/components/LastTime"
import { NewDot } from "@/components/NewDot"
import { NewSetDialog, SetPicker } from "@/components/SetPicker"
import { Shell } from "@/components/Shell"
import { TrackRow } from "@/components/TrackRow"
import { useAfter } from "@/hooks/useAfter"
import { useSteady } from "@/hooks/useSteady"
import { chosenSet, useSets } from "@/hooks/useSets"
import { useSongChoices } from "@/hooks/useSongChoices"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useEscape, useSpacebar } from "@/hooks/useSpacebar"
import { byFiles, useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import { dismiss, notify } from "@/lib/notices"
import { rise } from "@/lib/motion"
import { useUpdate } from "@/lib/update"
import { useWide } from "@/lib/wide"
import { diskLine, inputsLabel, notConnected } from "@/lib/format"
import { QUIET_THRESHOLD, fallBack } from "@/lib/levels"
import { modeOf, notesProblem, recordsAudio, recordsNotes } from "@/lib/midi"
import { findPort, portLine, type PortStanding } from "@/lib/midiPorts"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
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
 *  plugged in or pulled out shows on the rows by itself (spec P4). */
const MIDI_PORTS_POLL_MS = 1000

/** The notices' slots this screen says things in, a track taken off in each:
 *  one of its own per track, so each keeps its Undo (`setup-track:{n}`). */
const SAID = "setup-track"

/** The notice a button's failure is said in: Look again, Check signal, Start. */
const ERROR = "setup"

/** What a track's band entry keeps across interfaces: what is on screen when
 *  a card found by looking again is laid out. */
type BandMember = Pick<Track, "name" | "stereo" | "icon" | "mode" | "midi_port">

/** The name of the port a track keeps, or null while none is picked. */
const portName = (t: Track) => (t.midi_port?.name?.trim() ? t.midi_port.name : null)

/** A track's name in a sentence, or what stands for it while it has none. */
const named = (name: string) => name.trim() || "An unnamed track"

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

  // Signal check: listen to the inputs without recording, so everyone can
  // confirm they land on their own track.
  const [checking, setChecking] = useState(false)
  // Why the check stopped by itself: the card went quiet. True until the
  // next check, so it is said in place rather than as a notice.
  const [checkProblem, setCheckProblem] = useState<string | null>(null)
  // Where each bar stands, falling back from its peaks as on the recording
  // screen, and when it was last moved; by the names Python knows the inputs
  // by.
  const [levels, setLevels] = useState<Record<string, number[]>>({})
  const levelsAt = useRef(0)
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  // Those names, by each track's place in the band: the names the tracks had
  // when the check began, null for one that recorded no sound then. A track
  // named again keeps its meter and its "signal", and one taken off takes
  // its own with it, so the others keep theirs.
  const [checkedNames, setCheckedNames] = useState<(string | null)[]>([])
  const checkingRef = useRef(false)
  // How many checks have begun. A track put back by Undo brings what the
  // check heard from it only into the check that heard it: one begun since
  // never opened its input or its port.
  const checkRun = useRef(0)
  // Python is opening the inputs for a check: a press meanwhile opens no
  // second one, nor a second chain of reads. The ref is for the press, read
  // at once; the state turns the button's icon into a spinner once it has
  // taken a second (B5), as Start's does while the rehearsal opens.
  const opening = useRef(false)
  const [openingCheck, setOpeningCheck] = useState(false)
  const slowCheck = useAfter(openingCheck, SPINNER_AFTER_MS)
  // What the check hears from each track's port (P5, P8) and where its bar
  // stands, by the names the tracks had when it began, as Python has them;
  // and, by each track's place in the band, that name and what the track
  // recorded and from which port then: the ports the check opened. What the
  // check says of a track is about that port, never one picked since, and
  // holds while the track is named again.
  const [heard, setHeard] = useState<MidiActivity>({})
  const [notesShown, setNotesShown] = useState<Record<string, number>>({})
  const [checkedPorts, setCheckedPorts] = useState<
    ({ name: string; mode: RecordMode; port: string | null } | null)[]
  >([])

  // The MIDI ports the system lists; null until they have first been read.
  const [midiPorts, setMidiPorts] = useState<MidiPorts | null>(null)

  const [disk, setDisk] = useState<DiskEstimate | null>(null)

  // Last time, beside the setup: the rehearsal before this one, song by
  // song, to listen to before starting. Takes from several rehearsals, so
  // two takes 2 are told apart by their files.
  const [lastTime, setLastTime] = useState<LastTimeData | null>(null)
  const { cued, playInOverview, uncue, player } = useTakeStripPlayer(byFiles)
  // In a window too narrow for it beside the setup (lib/wide), Last time is
  // a panel from the left, opened by its button in the header (Q4). The
  // player is the screen's, not the panel's: a take plays on as it closes.
  const wide = useWide()
  const [pastOpen, setPastOpen] = useState(false)
  const pastButton = useRef<HTMLButtonElement>(null)
  // Widened, Last time is beside the setup again, so an open panel closes,
  // and stays shut when the window narrows once more. Set as this renders,
  // not after: React renders again at once, before anything is drawn.
  if (wide && pastOpen) setPastOpen(false)

  // The interface that was chosen and is not plugged in. Not the same as
  // none chosen: the desk is often switched on after the laptop.
  const [missing, setMissing] = useState<SettingsData["missing_device"]>(null)
  // The interface's name, cut past two lines, and whether a figure beside it
  // has given way to it: Recording with's button then says them whole in its
  // tip, on hover and on keyboard focus (Q3).
  const [deviceRef, deviceCut] = useCut<HTMLSpanElement>()
  const [deviceDropped, setDeviceDropped] = useState(false)
  const deviceNameId = useId()
  const deviceFiguresId = useId()
  // The set Start plays by (S1–S2), kept across restarts, and New set…
  // over this screen (S3), with the band's songs to add.
  const sets = useSets()
  const [makingSet, setMakingSet] = useState(false)
  const songChoices = useSongChoices(makingSet, null, null)
  const [rescanning, setRescanning] = useState(false)
  const slowLook = useAfter(rescanning, SPINNER_AFTER_MS)
  const slowStart = useAfter(starting, SPINNER_AFTER_MS)
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
  const checkOpened = (t: Track, i: number) => {
    const began = checking ? checkedPorts[i] : null
    return (
      !!began && began.port !== null && began.mode === modeOf(t) && began.port === portName(t)
    )
  }
  /** The name the check knows the track at place `i` by, when it opened its port. */
  const checkedName = (t: Track, i: number) =>
    checkOpened(t, i) ? checkedPorts[i]!.name : null
  /** What the check last heard from a track's port, when it opened it. */
  const heardFrom = (t: Track, i: number) => {
    const name = checkedName(t, i)
    return name === null ? undefined : heard[name]
  }

  /**
   * How a track's port stands: null for a track that takes no notes, "none"
   * while none is picked (P3). The check says best how an open port is; the
   * list says whether the port is there at all (P1), and two alike that
   * nothing tells apart count as not there. Before the list is first read,
   * nothing is said against a port.
   */
  const portStanding = (t: Track, i: number): PortStanding => {
    if (!recordsNotes(t)) return null
    if (!t.midi_port || portName(t) === null) return "none"
    const state = heardFrom(t, i)?.state
    if (state === "in_use") return "in_use"
    if (state === "missing" || state === "ambiguous") return "missing"
    if (state === "ok" || !midiPorts) return "ok"
    return findPort(t.midi_port, midiPorts.ports).port ? "ok" : "missing"
  }
  // The tracks the check hears the same notes from as from another: one
  // instrument plugged in twice, perhaps (P8). Said, and nothing stopped.
  // Python names the other by the name it had when the check began; the
  // sentence names it as it is now. An other that no longer takes notes from
  // the port the check opened is not asked about.
  const echoes = tracks.flatMap((t, i) => {
    const echo = heardFrom(t, i)?.echo
    const other = checkedPorts.findIndex((b, j) => j !== i && b !== null && b.name === echo)
    return typeof echo === "string" && tracks[other] && checkOpened(tracks[other], other)
      ? [{ track: t, echo: tracks[other] }]
      : []
  })

  // The tracks as last drawn, for an Undo that runs later: the place its
  // track is put back in is worked out from the band as it is then.
  const tracksNow = useRef(tracks)
  useLayoutEffect(() => {
    tracksNow.current = tracks
  })
  // The notices this screen has raised, one per track taken off, so that
  // two taken off one after the other (a double click on a bin) each keep
  // their Undo, and leaving the screen takes all of them with it.
  const saidKeys = useRef(new Set<string>())
  const saidCount = useRef(0)
  // A button's failure, said until it is closed, tried again or the screen
  // goes.
  const sayError = useErrorNotice(ERROR)
  // Each track taken off, with the one that came after it then (null when
  // it was the last): an Undo follows this chain to find its place.
  const nextOf = useRef(new WeakMap<Track, Track | null>())

  /**
   * Takes a track off at once, and says so with an Undo (B1) that puts it
   * back in its place: before the first track after it that is on screen,
   * passing those taken off too, or last when none of them is; so Undos
   * run in any order put each where it was. At its old place when the track
   * after it has changed or the band was read again. What the check opened
   * and heard is kept by place: those after it move up with their tracks,
   * and it comes back with its own.
   */
  const removeTrack = (i: number) => {
    const gone = tracks[i]
    const next = tracks[i + 1] ?? null
    nextOf.current.set(gone, next)
    const port = checkedPorts[i] ?? null
    const heardAs = checkedNames[i] ?? null
    const run = checkRun.current
    setTracks((prev) => prev.filter((_, j) => j !== i))
    setCheckedPorts((prev) => prev.filter((_, j) => j !== i))
    setCheckedNames((prev) => prev.filter((_, j) => j !== i))
    // What the check opened, into place `at`: these lists are padded out to
    // it, as they are shorter than the band when a track was added since the
    // check began.
    const put = <T,>(list: (T | null)[], at: number, v: T | null) => {
      const out = [...list]
      while (out.length < at) out.push(null)
      out.splice(at, 0, v)
      return out
    }
    const key = `${SAID}:${++saidCount.current}`
    saidKeys.current.add(key)
    notify({
      key,
      kind: "done",
      text: `${named(gone.name)} was taken off.`,
      action: {
        label: "Undo",
        run: () => {
          saidKeys.current.delete(key)
          const band = tracksNow.current
          // Past each track after it that is taken off too, once each.
          let after: Track | null = next
          const passed = new Set<Track>()
          const off = (t: Track) => !band.includes(t) && nextOf.current.has(t) && !passed.has(t)
          while (after && off(after)) {
            passed.add(after)
            after = nextOf.current.get(after) ?? null
          }
          const at =
            after === null
              ? band.length
              : band.includes(after)
                ? band.indexOf(after)
                : Math.min(i, band.length)
          const same = checkRun.current === run
          setTracks((prev) => [...prev.slice(0, at), gone, ...prev.slice(at)])
          setCheckedPorts((prev) => put(prev, at, same ? port : null))
          setCheckedNames((prev) => put(prev, at, same ? heardAs : null))
        },
      },
    })
  }

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

  /**
   * A track in stereo or back to mono. Turning stereo on claims the input
   * after this one. Where that input is somebody else's, or past the end of
   * the card, the track is left waiting for one rather than quietly
   * recording the same signal twice.
   */
  const setStereo = (i: number) =>
    setTracks((prev) =>
      prev.map((t, j) => {
        if (j !== i) return t
        const stereo = !t.stereo
        const clash =
          stereo &&
          t.channel !== null &&
          (t.channel + 1 > maxChannels ||
            prev.some(
              (o, k) =>
                k !== i &&
                o.channel !== null &&
                (o.channel === t.channel! + 1 || (!!o.stereo && o.channel + 1 === t.channel! + 1))
            ))
        return { ...t, stereo, channel: clash ? null : t.channel }
      })
    )

  // PortAudio lists the interfaces once, when the app starts, so a desk
  // switched on afterwards is found only by looking again.
  const lookAgain = async () => {
    dismiss(ERROR)
    setStillMissing(false)
    if (checking) await stopCheck()
    setRescanning(true)
    try {
      const res = await api().rescan_devices()
      if (!res.ok) {
        sayError(res.error ?? "Could not look for interfaces")
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
    if (deviceIndex === null || !tracks.length || opening.current) return
    // Listening to last time and to the inputs at once is one sound too
    // many to tell which track is which.
    uncue()
    dismiss(ERROR)
    setCheckProblem(null)
    // What this check opens, by each track's place, is set down before
    // Python is asked, from the tracks it is given. A track taken off, added
    // or put back while it opens then takes its own along, as it does while
    // the check runs; one put back from before the check has nothing in it.
    const band = tracks
    checkRun.current += 1
    setCheckedNames(band.map((t) => (recordsAudio(t) ? t.name : null)))
    setCheckedPorts(
      band.map((t) =>
        recordsNotes(t) ? { name: t.name, mode: modeOf(t), port: portName(t) } : null
      )
    )
    // Asked before the press is counted as opening: a bridge that is not
    // there throws here, and leaves the button free for another press.
    const asked = api().start_monitor(deviceIndex, samplerate, band)
    opening.current = true
    setOpeningCheck(true)
    const res = await asked.finally(() => {
      opening.current = false
      setOpeningCheck(false)
    })
    if (!res.ok) {
      sayError(res.error ?? "Could not open the input for checking")
      return
    }
    setSeen({})
    setHeard({})
    setNotesShown({})
    const noted = band.filter(recordsNotes)
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

  // Turn the check off when leaving the screen. A track taken off can be put
  // back only here: its Undo goes with the screen.
  useEffect(() => {
    const said = saidKeys.current
    return () => {
      checkingRef.current = false
      void stopMonitorQuietly()
      for (const key of said) dismiss(key)
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
    dismiss(ERROR)
    const res = await api().control_command("start_rehearsal", {
      name: name.trim() || "Rehearsal", device_index: deviceIndex,
      samplerate, tracks, bit_depth: bitDepth, set_id: await chosenSet(),
    })
    setStarting(false)
    if (!res.ok) {
      // No rehearsal took the ports the check left open: they go, or one
      // another app could use stays held with nothing listening to it.
      await stopMonitorQuietly()
      sayError(res.error ?? "Could not start the rehearsal")
      return
    }
    onStarted()
  }

  // Something from last time playing has Space and Escape, as a take
  // playing in history's overview does; Start gets them back once it stops.
  const inHand = cued !== null
  useSpacebar(inHand ? player.toggle : start, (inHand || canStart) && !makingSet)
  useEscape(uncue, inHand)
  // Off in Settings › Keys, Start has no chip and keeps no room for one.
  const spaceKeys = useKeysOn("space")

  // Last time's handlers keep their identity while the check reads the
  // levels every 80 ms and this screen is drawn again for each reading:
  // Last time (memo) is then drawn again only when what plays changes, and
  // does not measure its two dozen names and figure lines each time.
  const playLastTime = useSteady((take: Take) => {
    if (checking) void stopCheck()
    playInOverview(take)
  })
  const openRehearsal = useSteady((folder: string) => onOpenRehearsal(folder))
  const openHistory = useSteady(() => onOpenHistory())
  const openSong = useSteady((title: string | null) => onOpenSong?.(title))
  const pastPlayback = useMemo(
    () =>
      cued && {
        take: cued,
        playing: player.playing,
        loading: player.loading,
        position: player.position,
      },
    [cued, player.playing, player.loading, player.position]
  )

  const saveTemplate = async () => {
    // device_index says which card this layout is for. It does not change the
    // chosen recording device — that lives in Settings.
    await api().save_default_tracks({ tracks, device_index: deviceIndex ?? undefined })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  // Tonight's name, in the footer beside the set and Start (Q1): it is the
  // last thing filled in before starting.
  const nameField = (
    <div className="flex items-center gap-3">
      <Label htmlFor="rehearsal-name" className="shrink-0">
        Rehearsal name
      </Label>
      <Input
        id="rehearsal-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Rehearsal"
        className="max-w-sm"
      />
    </div>
  )

  const deviceText = device
    ? device.name
    : missing
      ? notConnected(missing, new Set(devices.map((d) => d.host_api)).size > 1)
      : "No interface chosen"
  // The figures beside it, which give way to the name, the inputs last (Q3):
  // a long name keeps its width, and the figures drop whole.
  const deviceFigures = [
    ...(device ? [{ text: inputsLabel(device.max_input_channels), keep: 2 }] : []),
    { text: `${samplerate / 1000} kHz`, keep: 1 },
    { text: `${bitDepth} bit`, keep: 0 },
  ]

  // The tracks group's first row: what they are recorded with, which is the
  // room's, not one rehearsal's. The words under the button line up with it.
  const recordingWith = (
    <div
      data-recording-with
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t px-6 py-4"
    >
      <Label>Recording with</Label>
      <WholeTip
        cut={deviceCut}
        text={deviceText}
        figures={deviceDropped ? <FigureLine parts={deviceFigures} /> : null}
      >
        <Button
          variant="outline"
          onClick={onOpenSettings}
          aria-label="Change the interface and quality"
          // What it is now, read after what it does: its label stands for
          // what is written on it.
          aria-describedby={`${deviceNameId} ${deviceFiguresId}`}
          className="h-auto min-w-0 items-baseline justify-start gap-2 px-3 py-2 text-left whitespace-normal has-[>svg]:px-3"
        >
          <Mic className="size-3.5 self-center text-muted-foreground" />
          <span
            ref={deviceRef}
            id={deviceNameId}
            data-cut={deviceCut || undefined}
            className="block min-w-0 flex-[0_1_auto] line-clamp-2 break-words"
          >
            {deviceText}
          </span>
          <Figures
            parts={deviceFigures}
            id={deviceFiguresId}
            onDropped={setDeviceDropped}
            tip={false}
            className="tnum text-right text-xs text-muted-foreground"
          />
        </Button>
      </WholeTip>
      {!device && missing ? (
        <div className="col-span-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Plug it in and switch it on, then look again.
            </p>
            <Button
              variant="outline"
              size="row"
              onClick={() => void lookAgain()}
              disabled={rescanning}
              className="shrink-0"
            >
              {/* A look that takes a second turns a spinner in its icon's
                  place (B5). */}
              {slowLook ? <Spinner after={0} /> : <RefreshCw />}
              {/* As wide whichever it says, so nothing beside it moves. */}
              <span className="grid">
                <span className={cn("col-start-1 row-start-1", rescanning && "invisible")}>
                  Look again
                </span>
                <span className={cn("col-start-1 row-start-1", !rescanning && "invisible")}>
                  Looking…
                </span>
              </span>
            </Button>
          </div>
          {stillMissing && !rescanning && (
            <Warning>
              Still not there. Check that it is switched on and its cable is in this computer —
              some desks take a minute to start.
            </Warning>
          )}
        </div>
      ) : (
        <p className="col-start-2 text-xs text-muted-foreground">
          Changed in Settings — it belongs to the room, not to one rehearsal.
        </p>
      )}
    </div>
  )

  // What is wrong for the band as a whole, over the rows. What is wrong with
  // one track's port is said in that track's own line instead, so none of it
  // keeps a place above the rows or moves one as it comes.
  const warnings = (
    <>
      {checkProblem && <Warning>{checkProblem}</Warning>}

      {needInput.length > 0 && (
        <Warning>
          {tooManyTracks ? (
            <>
              “{device?.name}” has {inputsLabel(maxChannels)} — not enough for {soundTracks}{" "}
              tracks. Record fewer at once, or use an interface with more inputs.
            </>
          ) : (
            <>
              {needInput.map((t) => named(t.name)).join(", ")}
              {needInput.length === 1 ? " has" : " have"} no input on “{device?.name}” — it
              has {inputsLabel(maxChannels)}. Pick one below.
            </>
          )}
        </Warning>
      )}

      {/* Only the note that is about no one track: none of them records
          sound (A1). */}
      {notesSay && !tracks.some(recordsAudio) && <Warning>{notesSay}</Warning>}
    </>
  )

  // The check's own words take this line's place while it runs, in a place
  // as tall as the longer of the two, so the rows under it never move.
  const hint = (
    <p className="grid text-xs text-muted-foreground">
      <span className={cn("col-start-1 row-start-1", checking && "invisible")}>
        One per musician: a track name and the interface input it comes
        from.
      </span>
      <span className={cn("col-start-1 row-start-1", !checking && "invisible")}>
        Have everyone play in turn — the bar should move next to their own
        track. If the wrong one moves, change the input number.
      </span>
    </p>
  )

  const tracksHead = (
    <div className="flex flex-col gap-1 px-6 pt-6 pb-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">Tracks</h2>
        <div className="flex shrink-0 items-center gap-2">
          {/* It says what pressing it does, so it is a button, not a
              toggle; grey while it runs, as what is on is (F2), under the
              pointer too. A running check can always be stopped, even with
              every track taken off. */}
          <Button
            variant="outline"
            size="row"
            onClick={checking ? stopCheck : startCheck}
            disabled={!checking && (!tracks.length || deviceIndex === null)}
            className={cn(
              checking && "bg-selected hover:bg-selected dark:bg-selected dark:hover:bg-selected"
            )}
          >
            {/* A check that takes a second to open turns a spinner in its
                icon's place (B5). */}
            {slowCheck ? <Spinner after={0} /> : <Activity />}
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
          <Button variant="outline" size="row" onClick={saveTemplate}>
            {/* As wide whichever it says, so Check signal beside it never
                moves (B4). */}
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", saved && "invisible")}>
                Save as template
              </span>
              <span
                className={cn(
                  "col-start-1 row-start-1 flex items-center gap-2",
                  !saved && "invisible"
                )}
              >
                <Check />
                Template saved
              </span>
            </span>
          </Button>
        </div>
      </div>
      {hint}
    </div>
  )

  const trackRows = tracks.map((track, i) => {
    const standing = portStanding(track, i)
    const ear = heardFrom(track, i)
    const listed =
      track.midi_port && midiPorts ? findPort(track.midi_port, midiPorts.ports).port : null
    // The name the check hears this track's input by, while it runs.
    const heardAs = checking ? (checkedNames[i] ?? null) : null
    // What is the matter with its port, said in its own line beside the
    // picker, naming any other track as it is called now.
    const sharing =
      recordsNotes(track) && portName(track) !== null
        ? tracks.find((o, j) => j !== i && recordsNotes(o) && portName(o) === portName(track))
        : undefined
    const echo = echoes.find((e) => e.track === track)?.echo
    return (
      <TrackRow
        key={i}
        n={i + 1}
        track={track}
        inputs={maxChannels}
        waiting={waiting(track)}
        checking={checking}
        level={(heardAs !== null && levels[heardAs]) || [0]}
        signal={heardAs !== null && !!seen[heardAs]}
        ports={midiPorts}
        portWarn={standing === "none" || standing === "missing" || standing === "in_use"}
        portNote={portLine(standing, {
          sharing: sharing && named(sharing.name),
          echo: echo && named(echo.name),
        })}
        notes={
          checkOpened(track, i)
            ? {
                seen: (ear?.notes ?? 0) > 0 || (listed?.notes ?? 0) > 0,
                vel: ear ? (notesShown[checkedName(track, i)!] ?? 0) : 0,
              }
            : null
        }
        onChange={(patch) => setTrack(i, patch)}
        onMode={(mode) => setMode(i, mode)}
        onStereo={() => setStereo(i)}
        onRemove={() => removeTrack(i)}
      />
    )
  })

  // A band with nobody in it says what goes here and how (B7): Add track is
  // under it, in the group's foot.
  const noTracks = (
    <div className="border-t px-6 py-8">
      <Empty className="p-0 md:p-0">
        <EmptyHeader>
          <EmptyTitle className="text-sm">No tracks yet</EmptyTitle>
          <EmptyDescription>
            Add one per musician, then pick the input they plug into.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  const tracksFoot = (
    <div className="flex items-center justify-between gap-4 border-t px-6 py-4">
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

      {/* On screen while any track records sound, which is what fills a
          disk, whether or not space runs low. Low space is a warning, in the
          recording screen's look (DiskLine). */}
      {disk?.ok && disk.minutes !== undefined && channelCount > 0 && (
        <DiskLine text={diskLine(disk.minutes, !!disk.low)} tone={disk.low ? "warn" : "quiet"} />
      )}
    </div>
  )

  // Last time: beside the setup in a wide window, in the panel otherwise.
  const pastPart = lastTime?.last ? (
    <LastTime
      data={lastTime}
      playback={pastPlayback}
      problem={cued ? player.loadError : null}
      onPlay={playLastTime}
      onOpen={openRehearsal}
      onAll={openHistory}
      onOpenSong={onOpenSong ? openSong : undefined}
    />
  ) : null
  const pastPlaying = cued !== null && player.playing

  return (
    <Shell
      air
      playback
      // The one screen that says the app's name, so the logo goes with it —
      // the small drawing, the one that still reads at this size.
      title={
        <span className="flex items-center gap-2">
          <img src="./favicon.svg" alt="" className="size-6 shrink-0" />
          РЭХА
        </span>
      }
      headerAction={
        <div className="flex items-center gap-2">
          {!wide && pastPart && (
            <Button
              ref={pastButton}
              variant="outline"
              onClick={() => setPastOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={pastOpen}
              data-playing={pastPlaying || undefined}
            >
              {/* While a take from it plays, the icon says so in the accent
                  (F2), in the same place: the button keeps its width and
                  nothing in the header moves (B4). */}
              {pastPlaying ? <AudioLines className="text-primary" /> : <PanelLeftOpen />}
              Last time
              {pastPlaying && <span className="sr-only">, playing</span>}
            </Button>
          )}
          <Button variant="outline" onClick={onOpenHistory}>
            <History />
            History
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenSettings}
                aria-label={update.latest ? "Settings, a new version is out" : "Settings"}
                className="relative"
              >
                <SettingsIcon />
                {update.latest && <NewDot />}
              </Button>
            </TooltipTrigger>
            {/* "Settings" only repeats the button's name, so it is for the
                eyes, and not read out again as its description; a new
                version is news, and is. */}
            <TooltipContent>
              {update.latest ? (
                `${update.latest.version} is out`
              ) : (
                <span aria-hidden>Settings</span>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      }
      // In a wide window the screen is two columns, each scrolling on its
      // own; each part pads itself, by the same 32 px as the header and the
      // footer.
      className={cn("p-0", wide && "flex overflow-hidden")}
      footer={
        <div className="animate-rise" style={rise(2)}>
          <FooterRow rule left={nameField}>
            <div className="flex items-center gap-3">
              <SetPicker
                sets={sets.sets}
                chosen={sets.chosen}
                onChoose={sets.choose}
                onNew={() => setMakingSet(true)}
              />
              <Button
                size="footer"
                onClick={start}
                disabled={!canStart}
                aria-keyshortcuts={spaceKeys && !inHand ? "Space" : undefined}
              >
                {/* A rehearsal that takes a second to open turns a spinner
                    in the icon's place (B5): Start keeps its words and its
                    width. */}
                {slowStart ? <Spinner after={0} className="size-5" /> : <Radio />}
                Start rehearsal
                {/* Kept unseen while Space is the take's, so Start keeps its
                    width and the set beside it stays where it is (B4). */}
                {spaceKeys && (
                  <Kbd aria-hidden className={cn(inHand && "invisible")}>
                    Space
                  </Kbd>
                )}
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
        </div>
      }
    >
      {/* Last time beside the setup when the window is wide enough for both
          — on the left, so that the setup is over Start rehearsal — and
          behind its button in the header when it is not. */}
      <div
        data-part="setup"
        className={cn("px-8 py-8", wide && "min-w-0 flex-1 overflow-y-auto")}
      >
        <div className="mx-auto max-w-3xl min-w-0">
          {/* The tracks as one group, headed by what they record with, a
              line between each row (Q1). */}
          <section
            data-tracks
            className="flex animate-rise flex-col rounded-xl bg-card"
            style={rise(1)}
          >
            {tracksHead}
            {recordingWith}
            <div className="flex flex-col gap-3 px-6 pb-4 empty:hidden">{warnings}</div>
            <div className="flex flex-col">{tracks.length ? trackRows : noTracks}</div>
            {tracksFoot}
          </section>
        </div>
      </div>
      {/* The past set back from the rehearsal about to start: a panel of its
          own, darker, down the side, as history's list is. With both on the
          same background the two columns ran into one. */}
      {wide && pastPart && (
        <div
          data-part="past"
          className="order-first w-[28rem] shrink-0 overflow-y-auto border-r bg-panel px-8 py-8"
        >
          <div className="animate-rise" style={rise(0)}>
            {pastPart}
          </div>
        </div>
      )}
      {!wide && pastPart && (
        <Sheet open={pastOpen} onOpenChange={setPastOpen}>
          <SheetContent
            side="left"
            // Its button is in the header, not the Sheet's own trigger, so
            // focus is sent back to it here.
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              pastButton.current?.focus()
            }}
          >
            <SheetTitle className="sr-only">Last time</SheetTitle>
            <SheetDescription className="sr-only">
              The last rehearsal, the songs not played in it, and earlier ones.
            </SheetDescription>
            <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-1 pb-8">{pastPart}</div>
          </SheetContent>
        </Sheet>
      )}
    </Shell>
  )
}
