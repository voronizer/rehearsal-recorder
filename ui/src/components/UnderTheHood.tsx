import { Fragment, useEffect, useRef, useState } from "react"
import { Activity, Check, CircleCheck, Copy, Info, TriangleAlert, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Whole } from "@/components/ui/whole"
import { SettingsGroup } from "@/components/SettingsGroup"
import { useAfter } from "@/hooks/useAfter"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import {
  api,
  type CheckRow,
  type InterfaceCheck,
  type OwnFile,
  type UnderTheHood as Hood,
  type UpdateStatus,
} from "@/lib/api"
import { countOf, formatBytes } from "@/lib/format"
import { QUIET_THRESHOLD } from "@/lib/levels"
import { dismiss } from "@/lib/notices"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
import { useSystem, words } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { restartNow, startDownload, startUpdate, switchUpdates, useUpdate } from "@/lib/update"

// How often a running check is asked how far it has got.
const CHECK_POLL_MS = 400
// How long "Copied" stays on the button.
const COPIED_MS = 2000
// From the tenth second of asking, the page says what it is waiting for (B5).
const SAY_AFTER_MS = 10_000
// The slot of the check's error notice.
const HOOD = "hood"

const FILE_LABELS: Record<OwnFile["key"], { label: string; name: string; note: string }> = {
  settings: {
    label: "Settings",
    name: "the settings",
    note: "The interface, the tracks, the folders, the balance",
  },
  history: {
    label: "History",
    name: "the history",
    note: "Every rehearsal and take, with their names and marks",
  },
  crash_log: {
    label: "Crash log",
    name: "the crash log",
    note: "Written if the app ever dies. Send it with a bug report",
  },
}

/** "the settings in force" -> "The settings in force". */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const kHz = (rate: number) => `${rate / 1000} kHz`

/**
 * The text on the clipboard. The bridge's page is served from 127.0.0.1,
 * which counts as secure, so the clipboard API is there; the old way is kept
 * for a webview that says otherwise.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* fall through to the old way */
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const done = document.execCommand("copy")
    area.remove()
    return done
  } catch {
    return false
  }
}

/** A button that copies the report, and says so for a moment. */
function CopyReport({ label, variant = "outline", size }: {
  label: string
  variant?: "outline" | "ghost"
  size?: "row"
}) {
  const [copied, setCopied] = useState<boolean | null>(null)
  const copy = async () => {
    const res = await api().bug_report()
    const done = !!res.ok && !!res.text && (await copyText(res.text))
    setCopied(done)
    window.setTimeout(() => setCopied(null), COPIED_MS)
  }
  return (
    <Button variant={variant} size={size} onClick={() => void copy()} aria-label={label}>
      {copied ? <Check /> : <Copy />}
      {copied === true ? "Copied" : copied === false ? "Could not copy" : label}
    </Button>
  )
}

/** A label and what it names, as one row of the page. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

/**
 * Figures with a dot between them, each kept whole: a line breaks only
 * between two of them, never inside "16 inputs". `afterName` when they
 * follow a name, which wraps as words do: a dot comes first, kept on the
 * name's last line.
 */
function Facts({ parts, afterName = false }: { parts: string[]; afterName?: boolean }) {
  return parts.map((part, i) => (
    <Fragment key={i}>
      {(afterName || i > 0) && " · "}
      <span className="whitespace-nowrap">{part}</span>
    </Fragment>
  ))
}

/**
 * Settings › Under the hood, Updates: whether a newer version is out,
 * getting it, and the switch for asking at all. A group of its own, so the
 * one above only says what this copy is.
 *
 * "This is the latest version" is said only once GitHub has answered: before
 * the first check, or in a room with no internet, nobody knows. The zip is
 * checked before it is called downloaded; see updates.py.
 *
 * Update gets the new version ready beside this copy, then Restart now puts
 * it in place (docs/superpowers/specs/2026-10-25-self-update-design.md). A
 * copy that cannot write beside itself says how to make Update appear, and
 * keeps Download, which only puts the zip in Downloads.
 */
function Updates({ hood, update }: { hood: Hood; update: UpdateStatus }) {
  const latest = update.latest
  const mine = latest && update.download?.version === latest.version ? update.download : null
  const install = update.install ?? null
  const ours = hood.version.split("+")[0]
  const fileManager = words(useSystem()).fileManager
  // Pressed once, Restart now waits for the window to close.
  const [restarting, setRestarting] = useState(false)
  const whatsNew = (
    <Button variant="outline" size="row" onClick={() => void api().open_releases(true)}>
      What's new
    </Button>
  )
  const restart = async () => {
    setRestarting(true)
    const said = await restartNow()
    if (!said.ok) setRestarting(false)
  }

  let status
  if (install?.state === "downloading") {
    const pct = Math.round((install.fraction ?? 0) * 100)
    status = (
      <>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="font-semibold">Downloading {install.version}…</div>
          <Progress value={pct} aria-label="Download" className="max-w-80" />
        </div>
        <span className="tnum text-muted-foreground">{pct}%</span>
      </>
    )
  } else if (install?.state === "preparing") {
    status = (
      <>
        <Spinner />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Getting {install.version} ready…</div>
          <div className="text-xs text-muted-foreground">
            Unpacking it beside this copy and checking that it starts
          </div>
        </div>
      </>
    )
  } else if (install?.state === "ready") {
    status = (
      <>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{install.version} is ready</div>
          <div className="text-xs text-muted-foreground">
            The app closes and opens again as {install.version}, in a few seconds.
          </div>
        </div>
        <Button size="row" disabled={restarting} onClick={() => void restart()}>
          Restart now
        </Button>
        {whatsNew}
      </>
    )
  } else if (install?.state === "failed" || install?.state === "place_failed") {
    const ready = install.state === "failed"
    status = (
      <>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {ready
              ? `Could not get ${install.version} ready`
              : `Could not put ${install.version} in place`}
          </div>
          <div className="text-xs text-destructive">{install.error}</div>
        </div>
        <Button
          variant="outline"
          size="row"
          disabled={!ready && restarting}
          onClick={() => void (ready ? startUpdate() : restart())}
        >
          Try again
        </Button>
        {whatsNew}
      </>
    )
  } else if (latest && mine?.state === "running") {
    const pct = Math.round((mine.fraction ?? 0) * 100)
    status = (
      <>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="font-semibold">Downloading {latest.version}…</div>
          <Progress value={pct} aria-label="Download" className="max-w-80" />
        </div>
        <span className="tnum text-muted-foreground">{pct}%</span>
      </>
    )
  } else if (latest && mine?.state === "done") {
    status = (
      <>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{latest.version} is in Downloads</div>
          <div className="text-xs text-muted-foreground">
            {mine.file}: unpack it, close this copy and open the new one.
          </div>
        </div>
        <Button variant="outline" size="row" onClick={() => void api().show_update()}>
          Show in folder
        </Button>
      </>
    )
  } else if (latest && mine?.state === "failed") {
    status = (
      <>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Could not download {latest.version}</div>
          <div className="text-xs text-destructive">{mine.error}</div>
        </div>
        <Button variant="outline" size="row" onClick={() => void startDownload()}>
          Try again
        </Button>
        {whatsNew}
      </>
    )
  } else if (latest && update.replace === false) {
    // Download stays, outlined: the way out is to move the app, said under it.
    const fix =
      fileManager === "Explorer"
        ? "Move the app's folder to Documents in Explorer, open it from there, and the Update button appears."
        : `Move the app to Applications in ${fileManager}, open it from there, and the Update button appears.`
    status = (
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Version {latest.version} is out</div>
            <div className="text-xs text-muted-foreground">You have {ours}</div>
          </div>
          <Button variant="outline" size="row" onClick={() => void startDownload()}>
            Download
          </Button>
          {whatsNew}
        </div>
        <Alert role="status">
          <Info />
          <AlertDescription>This copy can't replace itself where it is. {fix}</AlertDescription>
        </Alert>
      </div>
    )
  } else if (latest) {
    // The one button in the accent on the page while a new version is out.
    status = (
      <>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Version {latest.version} is out</div>
          <div className="text-xs text-muted-foreground">You have {ours}</div>
        </div>
        <Button size="row" onClick={() => void startUpdate()}>
          Update
        </Button>
        {whatsNew}
      </>
    )
  } else {
    status = (
      <p className="text-muted-foreground">
        {!update.on
          ? "Not checking for new versions."
          : hood.running_as !== "built"
            ? "Run from source, so the app does not check."
            : update.checked
              ? "This is the latest version."
              : "Not checked yet."}
      </p>
    )
  }

  return (
    <SettingsGroup rise={2} title="Updates" hint="Whether a newer version is out, and getting it.">
      <div className="flex flex-wrap items-center gap-3 text-sm">{status}</div>
      {/* The one thing the app sends anywhere, said where it is switched
          off. See updates.py. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Checkbox
            id="check-updates"
            checked={update.on}
            onCheckedChange={(on) => void switchUpdates(on === true)}
          />
          <Label htmlFor="check-updates">Check for new versions</Label>
        </div>
        <p className="pl-7 text-xs text-muted-foreground">
          When the app starts, and once a day while it stays open, it asks GitHub which version
          is the latest. It sends nothing else, and downloads a new version only when you ask.
        </p>
      </div>
    </SettingsGroup>
  )
}

/**
 * Settings › Under the hood: what this copy of the app is and runs on, where
 * it keeps things, a report to paste into a message, and the check of the
 * interface (--audio-probe, for someone at a rehearsal with no command
 * line), a group each. It asks the machine when it opens.
 */
export function UnderTheHood() {
  const [hood, setHood] = useState<Hood | null>(null)
  // Python did not answer: the bar says why, and the page stops waiting.
  const [failed, setFailed] = useState(false)
  const update = useUpdate()
  const { trash } = words(useSystem())
  const slow = useAfter(hood === null && !failed, SAY_AFTER_MS)

  useEffect(() => {
    let alive = true
    api()
      .under_the_hood()
      .then((h) => alive && setHood(h))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        This page could not open. Open it again to try once more.
      </p>
    )
  }

  // The spinner from the first second, the words beside it from the tenth.
  // The row is as tall with them as without, so neither moves the other.
  if (!hood) {
    return (
      <div className="flex h-5 items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {slow && <span>Asking the machine…</span>}
      </div>
    )
  }

  const rec = hood.audio.recording

  return (
    <>
      {/* This copy, and nothing else: what it is, and the two things to do
          about it from here. The tab's head names the page, so it has no
          heading. */}
      <SettingsGroup
        rise={1}
        role="region"
        aria-label="About this copy"
        className="flex-row flex-wrap items-center"
      >
        <img src="./logo.svg" alt="" className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">РЭХА</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="tnum break-all">{hood.version}</span>
            {hood.running_as !== "built" && <Badge variant="outline">Run from source</Badge>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <CopyReport label="Copy details for a bug report" />
          {/* Bare words, flush with the button above: no padding (a link
              has no frame either, so nothing sets the words in). */}
          <Button
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => void api().open_releases()}
          >
            All releases on GitHub
          </Button>
        </div>
      </SettingsGroup>

      <Updates hood={hood} update={update} />

      <SettingsGroup
        rise={3}
        title="Sound"
        hint="What the app records through, and what it can see on this machine."
      >
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <Row label="Recording with">
            {rec ? (
              <>
                {rec.name}
                <span className="text-muted-foreground">
                  <Facts
                    afterName
                    parts={
                      rec.missing
                        ? ["not plugged in"]
                        : [
                            rec.host_api,
                            countOf(rec.inputs, "input"),
                            kHz(rec.samplerate),
                            `${rec.bit_depth} bit`,
                          ]
                    }
                  />
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Nothing chosen yet: pick an interface in Audio
              </span>
            )}
          </Row>
          <Row label="Playback">{hood.audio.playback}</Row>
          <Row label="Audio systems">
            <ul aria-label="Audio systems" className="flex flex-wrap gap-1.5">
              {hood.audio.systems.map((s) => {
                const inUse = !!rec && !rec.missing && s.name === rec.host_api
                const item = (
                  <li data-in-use={inUse || undefined} className="flex">
                    <Badge variant={inUse ? "secondary" : "outline"}>
                      {s.name}
                      <span className="tnum font-normal text-muted-foreground">{s.devices}</span>
                    </Badge>
                  </li>
                )
                // The tip hangs from the row: on the badge itself, the
                // trigger's data-slot would take the place of the badge's.
                return inUse ? (
                  <Tooltip key={s.name}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    <TooltipContent>The interface records through this one</TooltipContent>
                  </Tooltip>
                ) : (
                  <Fragment key={s.name}>{item}</Fragment>
                )
              })}
              {hood.audio.systems.length === 0 && (
                <li className="text-muted-foreground">None found</li>
              )}
            </ul>
          </Row>
          <Row label="Audio engine">
            <span className="tnum text-xs">{hood.audio.engine ?? "unknown"}</span>
          </Row>
          <Row label="MIDI">
            {hood.midi.system ?? (
              <span className="text-muted-foreground">{hood.midi.error}</span>
            )}
          </Row>
        </dl>

        <Separator />

        <CheckTheInterface disabled={!rec || !!rec.missing} name={rec?.name} />
      </SettingsGroup>

      <SettingsGroup
        rise={4}
        title="Files"
        hint="Where the app keeps its own things. The recordings are in Folders."
      >
        <div className="flex flex-col gap-4">
          {hood.files.map((f) => {
            const said = FILE_LABELS[f.key]
            return (
              <div
                key={f.key}
                className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-x-4 text-sm"
              >
                <span className="text-muted-foreground">{said.label}</span>
                <div className="min-w-0">
                  {/* Nothing else on the page says the path whole, so a cut
                      one is a Tab stop, with the whole path in its tip. */}
                  <Whole text={f.path} reach className="truncate font-mono text-xs" />
                  <div className="text-xs text-muted-foreground">
                    {f.exists ? (
                      <>
                        {said.note}
                        <Facts afterName parts={[formatBytes(f.size ?? 0)]} />
                      </>
                    ) : f.key === "crash_log" ? (
                      "Not written yet: the app has had nothing to put in it"
                    ) : (
                      "Not there yet"
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="row"
                  aria-label={`Show ${said.name}`}
                  onClick={() => void api().show_file(f.key)}
                >
                  Show
                </Button>
              </div>
            )
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup rise={5} title="System">
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <Row label="System">{hood.system}</Row>
          <Row label="Running as">
            {hood.running_as === "built" ? "The built app" : "From source"}
            <span className="text-muted-foreground">
              <Facts afterName parts={[hood.executable]} />
            </span>
          </Row>
          <Row label="Deleting">
            {hood.deleting === "system"
              ? `Goes to ${trash}`
              : `Moves to the ${hood.fallback_trash} folder in your recordings`}
          </Row>
          <Row label="Cloud copies">
            {hood.libsndfile ? (
              <>
                WAV, FLAC and MP3
                <span className="text-muted-foreground">
                  <Facts afterName parts={[`through libsndfile ${hood.libsndfile}`]} />
                </span>
              </>
            ) : (
              "WAV only: compressing needs the soundfile package"
            )}
          </Row>
          <Row label="Local server">
            <span className="font-mono text-xs">{hood.server_url}</span>
            <p className="mt-1 text-xs text-muted-foreground">
              The server hands the app's screens and the audio to this machine only (127.0.0.1)
              and lives as long as the app is open.
            </p>
          </Row>
        </dl>
      </SettingsGroup>
    </>
  )
}

/** One way the card was opened, and what came of it, as a line. */
function Attempt({ row }: { row: CheckRow }) {
  const what = row.flowing
    ? "sound arrives"
    : row.opened
      ? `opens, but sent ${row.frames.toLocaleString()} of ~${row.expected.toLocaleString()} frames`
      : row.error || "refused"
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      {row.flowing ? (
        <Check className="mt-0.5 size-4 shrink-0 text-signal" />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <span className="min-w-0 break-words">
        <span className="text-foreground">{sentence(row.label)}:</span> {what}
      </span>
    </li>
  )
}

/** Every way the card was opened so far. */
function Attempts({ rows }: { rows: CheckRow[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <Attempt key={r.label} row={r} />
      ))}
    </ul>
  )
}

/**
 * The check: the settings in force first, then one change at a time, as
 * --audio-probe does, polled while it runs. Nothing to check with no
 * interface chosen, or one that is not plugged in.
 *
 * Its button stays where it is, with its word, the whole time: what the
 * check says comes under it. While the check runs the button waits, and
 * after a second a spinner takes its icon's place.
 */
function CheckTheInterface({ disabled, name }: { disabled: boolean; name?: string }) {
  const [check, setCheck] = useState<InterfaceCheck | null>(null)
  const timer = useRef(0)
  const cannot = useErrorNotice(HOOD)
  // From the click until Python answers, so a quick second click starts
  // nothing more.
  const [starting, setStarting] = useState(false)

  // A check left running from before this page opened is picked up again.
  useEffect(() => {
    void api().interface_check().then((c) => {
      if (c.running || c.checked_at) setCheck(c)
      if (c.running) follow()
    })
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function follow() {
    window.clearTimeout(timer.current)
    const poll = async () => {
      const c = await api().interface_check()
      setCheck(c)
      if (c.running) timer.current = window.setTimeout(poll, CHECK_POLL_MS)
    }
    timer.current = window.setTimeout(poll, CHECK_POLL_MS)
  }

  // A check that cannot start is said in a notice, and the page stays as
  // it was.
  const start = async () => {
    dismiss(HOOD)
    setStarting(true)
    try {
      const res = await api().start_interface_check()
      if (!res.ok) {
        cannot(res.error ?? "Could not start the check")
        return
      }
      setCheck(await api().interface_check())
      follow()
    } finally {
      setStarting(false)
    }
  }

  const running = !!check?.running
  const slow = useAfter(running, SPINNER_AFTER_MS)
  const done = !!check && !running && !!check.checked_at
  const opens = done && check?.verdict?.cause === "none"
  // The card is fine and the band is not in it: nothing plugged in, or its
  // routing sends the inputs elsewhere. Not "works" for a band recording.
  const heardAny = (check?.peaks ?? []).some((p) => p > QUIET_THRESHOLD)
  const works = opens && heardAny
  const silent = opens && !heardAny
  const failed = done && !check?.stopped && !!check?.verdict && !opens
  const device = check?.device
  const rows = check?.rows ?? []
  const when = check?.checked_at?.slice(11, 16)
  const state = running
    ? "running"
    : works
      ? "works"
      : silent
        ? "silent"
        : failed
          ? "failed"
          : check?.stopped
            ? "stopped"
            : "idle"

  return (
    <div role="group" aria-label="Interface check" data-state={state} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Check the interface</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Opens {name ?? "the interface"} the way a take does and listens for a few seconds.
            Play or talk into the inputs while it runs. If something refuses, it tries again
            another way and says what made the difference.
          </p>
        </div>
        <Button variant="outline" onClick={() => void start()} disabled={disabled || running || starting}>
          {slow ? <Spinner after={0} /> : <Activity />}
          Check the interface
        </Button>
      </div>

      {running && (
        <>
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              Listening to {device?.name}… play or talk into the inputs
            </p>
            <Button variant="outline" size="row" onClick={() => void api().stop_interface_check()}>
              Stop
            </Button>
          </div>
          {rows.length > 0 && <Attempts rows={rows} />}
        </>
      )}

      {/* What came of it, on the group's own fill: the icon alone says how
          it went. */}
      {opens && device && (
        <Alert role="status" className={works ? "[&>svg]:text-signal" : "[&>svg]:text-warn"}>
          {works ? <CircleCheck /> : <TriangleAlert />}
          <AlertTitle className="line-clamp-none">
            {works
              ? `${device.name} works: it opens with these settings and sound arrives`
              : `${device.name} opens and sends, but every input is silent`}
          </AlertTitle>
          <AlertDescription className="gap-2">
            <p className="text-xs">
              <Facts
                parts={[
                  device.host_api,
                  countOf(device.channels, "input"),
                  kHz(device.samplerate),
                  `${device.bit_depth} bit`,
                  `checked at ${when}`,
                ]}
              />
            </p>
            <p>
              {works
                ? sentence(check?.signal ?? "")
                : "The interface is fine; the band is not reaching it. Play or talk into the inputs while it listens, or look at where the interface's own routing sends them, and check again."}
            </p>
            <ul
              aria-label="Inputs with signal"
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, device.channels)}, minmax(0, 2.25rem))`,
              }}
            >
              {Array.from({ length: device.channels }, (_, i) => {
                const heard = (check?.peaks?.[i] ?? 0) > QUIET_THRESHOLD
                return (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <li
                        data-signal={heard || undefined}
                        className={cn(
                          "tnum flex h-7 items-center justify-center rounded-md text-xs",
                          heard ? "bg-signal/25 text-signal" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {i + 1}
                      </li>
                    </TooltipTrigger>
                    <TooltipContent>
                      {heard ? `Signal on input ${i + 1}` : `Input ${i + 1} silent`}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {failed && (
        <Alert role="status" className="[&>svg]:text-destructive">
          <TriangleAlert />
          <AlertTitle className="line-clamp-none">
            {check?.verdict?.headline.replace(/\.$/, "")}
          </AlertTitle>
          <AlertDescription className="gap-2">
            <p>{check?.verdict?.advice}</p>
            {rows.length > 0 && <Attempts rows={rows} />}
          </AlertDescription>
        </Alert>
      )}

      {done && check?.stopped && (
        <Alert role="status">
          <AlertTitle className="line-clamp-none">Stopped before it finished</AlertTitle>
          {rows.length > 0 && (
            <AlertDescription>
              <Attempts rows={rows} />
            </AlertDescription>
          )}
        </Alert>
      )}

      {done && (
        <div>
          <CopyReport label="Copy the report" size="row" />
        </div>
      )}
    </div>
  )
}
