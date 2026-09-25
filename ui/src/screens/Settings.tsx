import { useEffect, useState } from "react"
import {
  Check,
  CloudUpload,
  FolderOpen,
  Mic,
  Info,
  Palette,
  RotateCcw,
  Sliders,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DevicePicker } from "@/components/DevicePicker"
import { OutputChannels } from "@/components/OutputChannels"
import { Shell } from "@/components/Shell"
import { useEscape } from "@/hooks/useSpacebar"
import { cn } from "@/lib/utils"
import { SCALE_OPTIONS, THEME_LABELS, type Theme } from "@/lib/appearance"
import {
  api,
  type CloudFormat,
  type Device,
  type OutputDevice,
  type Settings as SettingsData,
  type ShareWhat,
} from "@/lib/api"

type TabId = "audio" | "folders" | "appearance" | "about"

const TABS: { id: TabId; label: string; icon: React.ReactNode; blurb: string }[] = [
  {
    id: "audio",
    label: "Audio",
    icon: <Sliders className="size-4" />,
    blurb: "Which interface, what quality, where it plays back",
  },
  {
    id: "folders",
    label: "Folders",
    icon: <FolderOpen className="size-4" />,
    blurb: "Where rehearsals are kept and what goes to the cloud",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette className="size-4" />,
    blurb: "Theme and how big everything is",
  },
  {
    id: "about",
    label: "Under the hood",
    icon: <Info className="size-4" />,
    blurb: "Paths and the local server",
  },
]

// Wording matches ShareDialog's manual share options, since the two places
// talk about the same three choices.
const AUTO_PUBLISH_OPTIONS: { id: ShareWhat; label: string; hint: string }[] = [
  {
    id: "mix",
    label: "The mix",
    hint: "One stereo file with the balance you set here. This is what you send people.",
  },
  {
    id: "tracks",
    label: "The original tracks",
    hint: "Every track as recorded, untouched — for opening in a DAW later.",
  },
  {
    id: "both",
    label: "Both",
    hint: "The mix to listen to, the tracks to work from.",
  },
]

export function Settings({
  onBack,
  theme,
  scale,
  onAppearanceChange,
}: {
  onBack: () => void
  theme: Theme
  scale: number
  onAppearanceChange: (theme: Theme, scale: number) => void
}) {
  // Nothing here is a decision in flight — every setting is saved as it is
  // changed — so Escape means what the back button means.
  useEscape(onBack)

  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  const [inputs, setInputs] = useState<Device[]>([])
  // What the chosen interface will actually accept: {"44100": [16, 24], ...}
  const [formats, setFormats] = useState<Record<string, number[]>>({})
  // Set when the card would not say what it takes — as against saying it
  // takes none of them. Without this the three below are a guess wearing the
  // card's clothes.
  const [formatTrouble, setFormatTrouble] = useState(false)
  const [dir, setDir] = useState("")
  const [cloudDir, setCloudDir] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Six sections in one column was a wall. They are grouped by what a person
  // came here to change, not by the order they happened to be written in.
  const [tab, setTab] = useState<TabId>("audio")

  useEffect(() => {
    ;(async () => {
      const s = await api().get_settings()
      setSettings(s)
      setDir(s.recordings_dir)
      setCloudDir(s.cloud_dir ?? "")
      setOutputs(await api().list_output_devices())
      setInputs(await api().list_input_devices())
    })()
  }, [])

  // The card is asked what it can do before anything is offered, and again
  // whenever the interface changes.
  useEffect(() => {
    if (!settings || settings.device_index === null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api().recording_formats(settings.device_index!, 2)
        if (cancelled || !res.ok) return
        if (res.formats) setFormats(res.formats)
        // The driver's own words are for a bug report, not for the screen.
        if (res.trouble) console.warn("[rates] the card would not answer:", res.trouble)
        setFormatTrouble(res.trouble ? true : false)
      } catch {
        /* the choice just stays as it is */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [settings?.device_index])

  const applyRecording = async (
    deviceIndex: number | null,
    samplerate: number,
    bitDepth: number
  ) => {
    setError(null)
    const res = await api().set_recording_format(
      deviceIndex,
      samplerate,
      bitDepth
    )
    if (!res.ok) {
      setError(res.error ?? "Could not save the recording settings")
      return
    }
    setSettings(await api().get_settings())
  }

  const applyDir = async (path: string) => {
    setError(null)
    const res = await api().set_recordings_dir(path)
    if (!res.ok) {
      setError(res.error ?? "Could not use that folder")
      return
    }
    setDir(res.recordings_dir ?? path)
    setStatus("Folder saved")
    window.setTimeout(() => setStatus(null), 2500)
  }

  const applyCloudDir = async (path: string) => {
    setError(null)
    const res = await api().set_cloud_dir(path)
    if (!res.ok) {
      setError(res.error ?? "Could not use that folder")
      return
    }
    setCloudDir(res.cloud_dir ?? path)
    setSettings(await api().get_settings())
    setStatus("Cloud folder saved")
    window.setTimeout(() => setStatus(null), 2500)
  }

  const browseCloud = async () => {
    setError(null)
    const res = await api().choose_cloud_dir()
    if (res.cancelled) return
    if (!res.ok) {
      setError(res.error ?? "Could not open the folder picker")
      return
    }
    setCloudDir(res.cloud_dir ?? cloudDir)
    setSettings(await api().get_settings())
    setStatus("Cloud folder saved")
    window.setTimeout(() => setStatus(null), 2500)
  }

  const browse = async () => {
    setError(null)
    const res = await api().choose_recordings_dir()
    if (res.cancelled) return
    if (!res.ok) {
      setError(res.error ?? "Could not open the folder picker")
      return
    }
    setDir(res.recordings_dir ?? dir)
    setStatus("Folder saved")
    window.setTimeout(() => setStatus(null), 2500)
  }

  // Whatever the card said, or the usual three while the answer is pending —
  // or while the card refuses to give one, in which case the note below says
  // so rather than letting the list pass for the card's own answer.
  const rateOptions = (Object.keys(formats).length
    ? Object.keys(formats).map(Number)
    : [44100, 48000, 96000]
  ).sort((a, b) => a - b)

  const current = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <Shell title="Settings" onBack={onBack} backKey>
      <div className="mx-auto flex w-full max-w-4xl gap-8">
        {/* The section list. Four groups is few enough to show at once, so
            nothing is hidden behind a menu. */}
        <nav className="hidden w-52 shrink-0 flex-col gap-1 sm:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                tab === t.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <span className="shrink-0">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* On a narrow window the list becomes a row above the panel. */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex gap-1 overflow-x-auto sm:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  tab === t.id
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div>
            <h2 className="text-base font-semibold">{current.label}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {current.blurb}
            </p>
          </div>

          {/* Saved / failed messages belong where they can be seen from any
              section, not buried inside the one that raised them. */}
          {status && (
            <p className="flex items-center gap-1.5 text-xs text-signal">
              <Check className="size-3.5" />
              {status}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

        {tab === "appearance" && (
        <section className="flex flex-col gap-3">
          <div>
            <Label>Appearance</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              The theme and scale are remembered and applied on the next launch.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["dark", "light", "system"] as Theme[]).map((t) => (
              <Button
                key={t}
                variant={theme === t ? "default" : "outline"}
                size="sm"
                aria-pressed={theme === t}
                onClick={() => onAppearanceChange(t, scale)}
              >
                {THEME_LABELS[t]}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-muted-foreground">Scale</span>
            {SCALE_OPTIONS.map((s) => (
              <Button
                key={s}
                variant={Math.abs(scale - s) < 0.001 ? "default" : "outline"}
                size="sm"
                aria-pressed={Math.abs(scale - s) < 0.001}
                aria-label={`Scale ${Math.round(s * 100)} percent`}
                onClick={() => onAppearanceChange(theme, s)}
                className={cn("tnum")}
              >
                {Math.round(s * 100)}%
              </Button>
            ))}
          </div>
        </section>
        )}

        {tab === "audio" && (<>

        <section className="flex flex-col gap-3">
          <div>
            <Label htmlFor="input-device">Recording</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Set once for the room and the card. The setup screen shows what
              is in force but does not change it.
            </p>
          </div>

          <DevicePicker
            id="input-device"
            devices={inputs}
            value={settings?.device_index ?? null}
            placeholder="Pick an interface"
            detail={(d) => ` · up to ${d.max_input_channels} ch`}
            onChange={(index) =>
              void applyRecording(
                index,
                settings?.samplerate ?? 44100,
                settings?.bit_depth ?? 24
              )
            }
          />

          {/* Only where there is a choice to make. Somebody who knows their
              desk has sixteen inputs and is offered eight has no way to guess
              that another driver sees the same desk whole. */}
          {new Set(inputs.map((d) => d.host_api)).size > 1 && (
            <p className="text-xs text-muted-foreground">
              Each driver can offer a different number of inputs. If your
              interface shows fewer than it has, try another driver — ASIO,
              where there is one, usually offers all of them.
            </p>
          )}

          {formatTrouble && (
            <p
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
            >
              This interface did not say which sample rates it takes, so the
              three below are the usual ones rather than its own. Pick the one
              the card is set to; if a rehearsal will not start at it, try
              another.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-muted-foreground">Rate</span>
            {rateOptions.map((rate) => (
              <Button
                key={rate}
                variant={settings?.samplerate === rate ? "default" : "outline"}
                size="sm"
                aria-pressed={settings?.samplerate === rate}
                aria-label={`${rate / 1000} kHz`}
                onClick={() => {
                  const allowed = formats[String(rate)] ?? [16, 24]
                  const depth = allowed.includes(settings?.bit_depth ?? 24)
                    ? settings!.bit_depth
                    : allowed[0]
                  void applyRecording(
                    settings?.device_index ?? null,
                    rate,
                    depth
                  )
                }}
                className="tnum"
              >
                {rate / 1000} kHz
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-muted-foreground">Depth</span>
            {[16, 24].map((depth) => {
              const allowed =
                formats[String(settings?.samplerate ?? 44100)] ?? [16, 24]
              return (
                <Button
                  key={depth}
                  variant={settings?.bit_depth === depth ? "default" : "outline"}
                  size="sm"
                  aria-pressed={settings?.bit_depth === depth}
                  aria-label={`${depth} bit`}
                  disabled={!allowed.includes(depth)}
                  onClick={() =>
                    void applyRecording(
                      settings?.device_index ?? null,
                      settings?.samplerate ?? 44100,
                      depth
                    )
                  }
                  className="tnum"
                >
                  {depth} bit
                </Button>
              )
            })}
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Mic className="mt-0.5 size-3.5 shrink-0" />
            24 bits leaves enough headroom to set the inputs low and stop
            worrying about the loud chorus, at half again as much disk. Only
            what this interface accepts is shown.
          </p>
        </section>

        <section className="flex flex-col gap-3 border-t pt-6">
          <div>
            <Label htmlFor="output-device">Playback output</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Where takes are played back — the headphones on the interface
              itself, for instance, rather than the laptop speakers.
            </p>
          </div>
          <DevicePicker
            id="output-device"
            devices={outputs}
            value={settings?.output_device_index ?? null}
            placeholder="System output"
            systemDefault
            onChange={async (idx) => {
              const res = await api().set_output_device(idx)
              if (!res.ok) {
                setError(res.error ?? "Could not switch the output")
                return
              }
              setSettings(await api().get_settings())
            }}
          />

          {/* Only for a card with more than a pair: on a stereo output there
              is nothing to choose, and the system output is the system's. */}
          {(() => {
            const card = outputs.find(
              (d) => d.index === settings?.output_device_index
            )
            if (!card || card.max_output_channels <= 2) return null
            return (
              <OutputChannels
                count={card.max_output_channels}
                value={settings?.output_channels ?? [1, 2]}
                onChange={async (channels) => {
                  const res = await api().set_output_channels(channels)
                  if (!res.ok) {
                    setError(res.error ?? "Could not switch the outputs")
                    return
                  }
                  setSettings(await api().get_settings())
                }}
              />
            )
          })()}
        </section>
        </>)}

        {tab === "folders" && (<>

        <section className="flex flex-col gap-3">
          <div>
            <Label htmlFor="recordings-dir">Recordings folder</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Where everything is recorded to.
            </p>
          </div>

          <div className="flex gap-2">
            <Input
              id="recordings-dir"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              onBlur={() => {
                if (settings && dir !== settings.recordings_dir) applyDir(dir)
              }}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={browse}
              aria-label="Choose recordings folder"
              className="shrink-0"
            >
              <FolderOpen />
              Browse
            </Button>
          </div>

          {settings?.path_warning && (
            <p className="text-xs text-warn">{settings.path_warning}</p>
          )}

          {settings && dir !== settings.default_recordings_dir && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              onClick={() => applyDir(settings.default_recordings_dir)}
            >
              <RotateCcw />
              Back to the default folder
            </Button>
          )}

        </section>

        <section className="flex flex-col gap-3 border-t pt-6">
          <div>
            <Label htmlFor="cloud-dir">Cloud folder</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Where the takes you pick out are copied. Point it at a Drive or
              Dropbox folder — deliberately not the recordings folder, so only
              the takes worth keeping go up, one at a time.
            </p>
          </div>

          <div className="flex gap-2">
            <Input
              id="cloud-dir"
              value={cloudDir}
              onChange={(e) => setCloudDir(e.target.value)}
              onBlur={() => {
                if (settings && cloudDir !== (settings.cloud_dir ?? ""))
                  applyCloudDir(cloudDir)
              }}
              placeholder="Not set — nothing is copied anywhere"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={browseCloud}
              aria-label="Choose cloud folder"
              className="shrink-0"
            >
              <CloudUpload />
              Browse
            </Button>
          </div>

          {settings?.cloud_dir && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              onClick={async () => {
                await api().clear_cloud_dir()
                setCloudDir("")
                setSettings(await api().get_settings())
              }}
            >
              <RotateCcw />
              Forget the cloud folder
            </Button>
          )}

          {/* The cloud folder is the gate. Without one there are no copies,
              so none of the questions below have a subject: what a copy is
              written as, whether it goes on its own, what of it goes. They
              are not greyed out but absent — the field above says the whole
              of it, "Not set, nothing is copied anywhere", with its own
              Browse beside it. Greyed out they were five dead rows and three
              sentences explaining copies that cannot happen, which is not
              what "say why it will not work" is for: that is for a control
              somebody is reaching for, not for a subject that does not exist
              yet. */}
          {settings?.cloud_dir && (
            <>
          {/* What a copy is written as comes first, right under the folder:
              it is the one setting here that holds whether or not anything is
              sent automatically, since it governs the takes sent by hand too.
              Sending on its own, and what it sends, follow.

              Both questions are a heading, their choices, and the word on the
              choice in force — the heading carrying the weight of one, the
              line under the row reading as its answer. All in the same muted
              grey with the same gap above and below, the lines ran together
              into one block nobody could parse.

              Neither is hidden when it stops applying: a block that comes and
              goes moves everything under it out from beneath the pointer, and
              says nothing about what would happen if the switch above went
              back on. They grey out, the way the checkbox between them
              already does. */}
          <div className="mt-5 flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              What the copies are written as
            </span>
            <div
              role="group"
              aria-label="What the copies are written as"
              className="flex flex-wrap items-center gap-2"
            >
              {(settings?.cloud_formats ?? []).map((f) => (
                <Button
                  key={f.id}
                  variant={settings?.cloud_format === f.id ? "default" : "outline"}
                  size="sm"
                  aria-label={f.label}
                  aria-pressed={settings?.cloud_format === f.id}
                  // Only copies are written in these; with no cloud folder
                  // there are none, and this was a live choice about files
                  // nothing was going to write.
                  onClick={async () => {
                    const res = await api().set_cloud_format(f.id as CloudFormat)
                    if (!res.ok) {
                      setError(res.error ?? "Could not save that")
                      return
                    }
                    setSettings(await api().get_settings())
                  }}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            {(settings?.cloud_formats ?? []).find(
              (f) => f.id === settings?.cloud_format
            ) && (
              <p className="text-xs text-muted-foreground">
                {
                  (settings?.cloud_formats ?? []).find(
                    (f) => f.id === settings?.cloud_format
                  )?.hint
                }
              </p>
            )}

            {settings?.encoder_hint && settings.cloud_format !== "wav" && (
              <p className="text-xs text-warn">{settings.encoder_hint}</p>
            )}
            {/* Not about the choice above but about all of them, so it is set
                apart rather than stacked under the answer as a second
                sentence of it. */}
            <p className="mt-3 text-xs text-muted-foreground">
              Only the copies are affected. What was recorded stays untouched
              WAV on disk: it is the one thing here that cannot be made again.
            </p>
          </div>

          <div className="mt-4 flex items-start gap-3">
            <input
              id="auto-publish"
              type="checkbox"
              className="mt-1 size-4"
              checked={settings?.auto_publish ?? false}
              onChange={async (e) => {
                const on = e.target.checked
                await api().set_auto_publish(on, settings?.auto_publish_what)
                setSettings(await api().get_settings())
              }}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-publish">Send saved takes automatically</Label>
              <p className="text-xs text-muted-foreground">
                Every take you keep is copied to the cloud folder on its own,
                between takes rather than while one is recording.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1.5">
              <span className="text-sm font-medium">What gets published</span>
              {/* A row of choices rather than a stack of cards, the way the
                  theme and the scale are chosen: three of these with their
                  explanations under each took most of the screen, and this
                  is a decision made once. The explanation that is worth
                  reading is the one belonging to the choice in force, so
                  that is the one kept. */}
              <div
                role="group"
                aria-label="What gets published"
                className="flex flex-wrap items-center gap-2"
              >
                {AUTO_PUBLISH_OPTIONS.map((o) => (
                  <Button
                    key={o.id}
                    variant={
                      settings?.auto_publish_what === o.id ? "default" : "outline"
                    }
                    size="sm"
                    aria-label={o.label}
                    aria-pressed={settings?.auto_publish_what === o.id}
                    // This says what automatic sending sends, so it is live
                    // only while automatic sending is: without a cloud folder
                    // it is the same mistake the checkbox above is greyed out
                    // to prevent, and with sending switched off it would be a
                    // choice about something that is not happening.
                    disabled={!settings?.auto_publish}
                    onClick={async () => {
                      const res = await api().set_auto_publish(true, o.id)
                      if (!res.ok) {
                        setError(res.error ?? "Could not save that")
                        return
                      }
                      setSettings(await api().get_settings())
                    }}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            <p className="text-xs text-muted-foreground">
              {settings?.auto_publish
                ? AUTO_PUBLISH_OPTIONS.find(
                    (o) => o.id === settings?.auto_publish_what
                  )?.hint
                : "Not while sending is off — this is what would go."}
            </p>
          </div>

            </>
          )}

        </section>
        </>)}

        {tab === "about" && (

        <section className="flex flex-col gap-2">
          <Label>Under the hood</Label>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            <dt>Version</dt>
            <dd>{settings?.version}</dd>
            <dt>Settings</dt>
            <dd className="break-all">{settings?.config_path}</dd>
            <dt>Local server</dt>
            <dd>{settings?.server_url}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            The server hands the interface and the audio to this machine only
            (127.0.0.1) and lives as long as the app is open.
          </p>
        </section>
        )}
        </div>
      </div>
    </Shell>
  )
}
