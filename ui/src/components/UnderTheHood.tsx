import { useEffect, useRef, useState } from "react"
import {
  Activity,
  Check,
  CircleCheck,
  Copy,
  Loader2,
  TriangleAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  api,
  type CheckRow,
  type InterfaceCheck,
  type OwnFile,
  type UnderTheHood as Hood,
} from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { QUIET_THRESHOLD } from "@/lib/levels"
import { cn } from "@/lib/utils"

// How often a running check is asked how far it has got.
const CHECK_POLL_MS = 400
// How long "Copied" stays on the button.
const COPIED_MS = 2000

const FILE_LABELS: Record<OwnFile["key"], { label: string; name: string; note: string }> = {
  settings: {
    label: "Settings",
    name: "the settings",
    note: "The interface, the tracks, the folders, the balance",
  },
  history: {
    label: "History",
    name: "the history",
    note: "Every rehearsal and take, with their names and markers",
  },
  crash_log: {
    label: "Crash log",
    name: "the crash log",
    note: "Written if the app ever dies — send it with a bug report",
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
  size?: "sm"
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
 * Settings › Under the hood: what this copy of the app is and runs on, where
 * it keeps things, a report to paste into a message, and the check of the
 * interface — --audio-probe, for someone at a rehearsal with no command line.
 */
export function UnderTheHood() {
  const [hood, setHood] = useState<Hood | null>(null)

  useEffect(() => {
    let alive = true
    void api()
      .under_the_hood()
      .then((h) => alive && setHood(h))
    return () => {
      alive = false
    }
  }, [])

  if (!hood) {
    return <p className="text-sm text-muted-foreground">Asking the machine…</p>
  }

  const rec = hood.audio.recording
  const windows = hood.system.startsWith("Windows")

  return (
    <div className="flex flex-col gap-7">
      <section
        aria-label="About this copy"
        className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-5 py-4"
      >
        <img src="./logo.svg" alt="" className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">Rehearsal Recorder</div>
          <div className="text-sm text-muted-foreground">
            <span className="tnum">{hood.version}</span>
            {" · "}
            {hood.running_as === "built" ? "the built app" : "run from source"}
            {" · "}
            <Button
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => void api().open_releases()}
            >
              Releases on GitHub
            </Button>
          </div>
        </div>
        <CopyReport label="Copy details for a bug report" />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <Label>Sound</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            What the app records through, and what it can see on this machine
          </p>
        </div>
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
          <Row label="Recording with">
            {rec ? (
              <>
                {rec.name}
                <span className="text-muted-foreground">
                  {rec.missing
                    ? " · not plugged in"
                    : ` · ${rec.host_api} · ${rec.inputs} inputs · ${kHz(rec.samplerate)} · ${rec.bit_depth} bit`}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Nothing chosen yet — pick an interface in Audio
              </span>
            )}
          </Row>
          <Row label="Playback">{hood.audio.playback}</Row>
          <Row label="Audio systems">
            <ul aria-label="Audio systems" className="flex flex-wrap gap-1.5">
              {hood.audio.systems.map((s) => {
                const inUse = rec && !rec.missing && s.name === rec.host_api
                return (
                  <li
                    key={s.name}
                    data-in-use={inUse || undefined}
                    title={inUse ? "The interface records through this one" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
                      inUse && "border-signal/60"
                    )}
                  >
                    {s.name}
                    <span className="tnum text-muted-foreground">{s.devices}</span>
                  </li>
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
        </dl>

        <CheckTheInterface disabled={!rec || !!rec.missing} name={rec?.name} />
      </section>

      <hr />

      <section className="flex flex-col gap-3">
        <div>
          <Label>Files</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Where the app keeps its own things. The recordings are in Folders.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {hood.files.map((f) => {
            const said = FILE_LABELS[f.key]
            return (
              <div
                key={f.key}
                className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-x-4 text-sm"
              >
                <span className="text-muted-foreground">{said.label}</span>
                <div className="min-w-0">
                  <div className="tnum truncate text-xs" title={f.path}>
                    {f.path}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {f.exists
                      ? `${said.note} · ${formatBytes(f.size ?? 0)}`
                      : f.key === "crash_log"
                        ? "Not written yet — the app has had nothing to put in it"
                        : "Not there yet"}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Show ${said.name}`}
                  onClick={() => void api().show_file(f.key)}
                >
                  Show
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <hr />

      <section className="flex flex-col gap-3">
        <Label>System</Label>
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
          <Row label="System">{hood.system}</Row>
          <Row label="Running as">
            {hood.running_as === "built" ? "The built app" : "From source"}
            <span className="text-muted-foreground"> · {hood.executable}</span>
          </Row>
          <Row label="Deleting">
            {hood.deleting === "system"
              ? windows
                ? "Goes to the Recycle Bin"
                : "Goes to the Trash"
              : `Moves to the ${hood.fallback_trash} folder in your recordings`}
          </Row>
          <Row label="Cloud copies">
            {hood.libsndfile ? (
              <>
                WAV, FLAC and MP3
                <span className="text-muted-foreground">
                  {" "}
                  · through libsndfile {hood.libsndfile}
                </span>
              </>
            ) : (
              "WAV only — compressing needs the soundfile package"
            )}
          </Row>
        </dl>
      </section>

      <hr />

      <section className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div>
          <span className="text-sm text-foreground">Local server</span>
          <span className="tnum ml-3">{hood.server_url}</span>
        </div>
        <p>
          The server hands the interface and the audio to this machine only
          (127.0.0.1) and lives as long as the app is open.
        </p>
      </section>
    </div>
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
    <li className="flex gap-3 text-sm">
      <span
        className={cn(
          "w-6 shrink-0 font-semibold",
          row.flowing ? "text-signal" : "text-destructive"
        )}
      >
        {row.flowing ? "ok" : "no"}
      </span>
      <span className="min-w-0">
        {sentence(row.label)}
        <span className="break-words text-muted-foreground"> — {what}</span>
      </span>
    </li>
  )
}

/**
 * The check: the settings in force first, then one change at a time, as
 * --audio-probe does, polled while it runs. Nothing to check with no
 * interface chosen, or one that is not plugged in.
 */
function CheckTheInterface({ disabled, name }: { disabled: boolean; name?: string }) {
  const [check, setCheck] = useState<InterfaceCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef(0)

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

  const start = async () => {
    setError(null)
    const res = await api().start_interface_check()
    if (!res.ok) {
      setError(res.error ?? "Could not start the check")
      return
    }
    setCheck(await api().interface_check())
    follow()
  }

  const running = !!check?.running
  const done = !!check && !running && !!check.checked_at
  const opens = done && check?.verdict?.cause === "none"
  // The card is fine and the band is not in it: nothing plugged in, or its
  // routing sends the inputs elsewhere. Not "works" for a band recording.
  const heardAny = (check?.peaks ?? []).some((p) => p > QUIET_THRESHOLD)
  const works = opens && heardAny
  const silent = opens && !heardAny
  const failed = done && !check?.stopped && !!check?.verdict && !opens
  const device = check?.device
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
    <div
      aria-label="Interface check"
      data-state={state}
      className={cn(
        "mt-1 flex flex-col gap-3.5 rounded-xl border px-4 py-4",
        works && "border-signal/45 bg-signal/5",
        silent && "border-warn/50 bg-warn/5",
        failed && "border-destructive/50 bg-destructive/5"
      )}
    >
      {!check && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Check the interface</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Opens {name ?? "the interface"} the way a take does and listens for a
              few seconds. Play or talk into the inputs while it runs. If something
              refuses, it tries again another way and says what made the difference.
            </p>
          </div>
          <Button onClick={() => void start()} disabled={disabled}>
            <Activity />
            Check the interface
          </Button>
        </div>
      )}

      {running && (
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <div className="min-w-0 flex-1 text-sm font-semibold">
            Listening to {device?.name}… play or talk into the inputs
          </div>
          <Button variant="outline" size="sm" onClick={() => void api().stop_interface_check()}>
            Stop
          </Button>
        </div>
      )}

      {opens && device && (
        <>
          <div className="flex items-start gap-2.5">
            {works ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-signal" />
            ) : (
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
            )}
            <div>
              <div className="text-sm font-semibold">
                {works
                  ? `${device.name} works: it opens with these settings and sound arrives`
                  : `${device.name} opens and sends, but every input is silent`}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {device.host_api} · {device.channels} inputs · {kHz(device.samplerate)} ·{" "}
                {device.bit_depth} bit · checked at {when}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm">
              {works
                ? sentence(check?.signal ?? "")
                : "The card is fine; the band is not reaching it. Play or talk into the inputs while it listens, or look at where the card's own routing sends them, and check again."}
            </div>
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
                  <li
                    key={i}
                    data-signal={heard || undefined}
                    title={heard ? `Signal on input ${i + 1}` : `Input ${i + 1} silent`}
                    className={cn(
                      "tnum flex h-7 items-center justify-center rounded-md text-[11px]",
                      heard ? "bg-signal/25 text-signal" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {failed && (
        <div className="flex items-start gap-2.5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {check?.verdict?.headline.replace(/\.$/, "")}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {check?.verdict?.advice}
            </p>
          </div>
        </div>
      )}

      {done && check?.stopped && (
        <div className="text-sm font-semibold">Stopped before it finished</div>
      )}

      {(running || failed || check?.stopped) && (check?.rows?.length ?? 0) > 0 && (
        <ul className={cn("flex flex-col gap-1.5", failed && "pl-7")}>
          {check?.rows?.map((r) => <Attempt key={r.label} row={r} />)}
        </ul>
      )}

      {done && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void start()} disabled={disabled}>
            Check again
          </Button>
          <CopyReport label="Copy the report" size="sm" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
