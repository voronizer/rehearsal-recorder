import { useEffect, useState } from "react"
import { Mic, RefreshCw } from "lucide-react"
import { Warning } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SAID, SettingsGroup } from "@/components/SettingsGroup"
import { PickRow } from "@/components/ui/pick-row"
import { DevicePicker } from "@/components/DevicePicker"
import { OutputChannels } from "@/components/OutputChannels"
import { useAfter } from "@/hooks/useAfter"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { countOf, describeRescan, inputsLabel, notConnected } from "@/lib/format"
import { dismiss, notify } from "@/lib/notices"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
import { api, type Device, type OutputDevice, type Settings } from "@/lib/api"

// That the open take now plays somewhere else. Its own slot: it stays true
// after "Found …" has gone, and after leaving Settings.
const PLAYBACK = "playback"

/**
 * Settings › Audio: the interface a rehearsal records from, at what rate and
 * depth, and where takes play back, a group each. It reads the settings when
 * it opens.
 */
export function AudioSettings() {
  useNoticesGoWithPage(SAID)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  const [inputs, setInputs] = useState<Device[]>([])
  // What the chosen interface will actually accept: {"44100": [16, 24], ...}
  const [formats, setFormats] = useState<Record<string, number[]>>({})
  // Set when the card would not say what it takes, as against saying it
  // takes none of them. Without this the three below are a guess wearing the
  // card's clothes.
  const [formatTrouble, setFormatTrouble] = useState(false)
  // Looking for interfaces again. `rescans` counts the times it has been
  // done, so the card is asked for its rates again even when it is the same
  // card at the same place in the list.
  const [rescanning, setRescanning] = useState(false)
  const [rescans, setRescans] = useState(0)
  // A look that takes a second turns a spinner in the icon's place (B5).
  const slowLook = useAfter(rescanning, SPINNER_AFTER_MS)

  const readDevices = async () => {
    setOutputs(await api().list_output_devices())
    setInputs(await api().list_input_devices())
  }

  useEffect(() => {
    ;(async () => {
      setSettings(await api().get_settings())
      await readDevices()
    })()
  }, [])

  // PortAudio lists the interfaces once, when the app starts. One plugged in
  // later is found only by asking it to look again: see rescan_devices.
  const lookAgain = async () => {
    dismiss(SAID)
    setRescanning(true)
    try {
      const res = await api().rescan_devices()
      if (!res.ok) {
        notify({
          key: SAID,
          kind: "error",
          text: res.error ?? "Could not look for interfaces",
        })
        return
      }
      await readDevices()
      setSettings(await api().get_settings())
      setRescans((n) => n + 1)
      notify({ key: SAID, kind: "done", text: describeRescan(res.found, res.gone) })
      // The take that was open plays on, but perhaps somewhere else.
      if (res.warning) notify({ key: PLAYBACK, kind: "warning", text: res.warning })
      else dismiss(PLAYBACK)
    } finally {
      setRescanning(false)
    }
  }

  // The card is asked what it can do before anything is offered, and again
  // whenever the interface changes, or has been looked for again, since the
  // rates of a desk are set on the desk.
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
  }, [settings?.device_index, rescans])

  const applyRecording = async (
    deviceIndex: number | null,
    samplerate: number,
    bitDepth: number
  ) => {
    dismiss(SAID)
    const res = await api().set_recording_format(
      deviceIndex,
      samplerate,
      bitDepth
    )
    if (!res.ok) {
      notify({
        key: SAID,
        kind: "error",
        text: res.error ?? "Could not save the recording settings",
      })
      return
    }
    setSettings(await api().get_settings())
  }

  // Whatever the card said, or the usual three while the answer is pending,
  // or while the card refuses to give one: then the warning above says so
  // rather than letting the list pass for the card's own answer.
  const rateOptions = (Object.keys(formats).length
    ? Object.keys(formats).map(Number)
    : [44100, 48000, 96000]
  ).sort((a, b) => a - b)
  const depths = formats[String(settings?.samplerate ?? 44100)] ?? [16, 24]
  const severalInputDrivers = new Set(inputs.map((d) => d.host_api)).size > 1

  return (
    <>
      <SettingsGroup
        rise={1}
        title="Recording"
        hint="Set once for the room and the interface. The start screen shows what is in force but does not change it."
      >
        <div className="flex flex-col gap-2">
          {/* Beside the device, level with it rather than with the driver
              above it on Windows. Recording and playback both: it is one
              list underneath. */}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <DevicePicker
                id="input-device"
                label="Recording"
                devices={inputs}
                value={settings?.device_index ?? null}
                disabled={rescanning}
                placeholder={
                  settings?.missing_device
                    ? notConnected(settings.missing_device, severalInputDrivers)
                    : "Pick an interface"
                }
                detail={(d) => ` · up to ${inputsLabel(d.max_input_channels)}`}
                onChange={(index) =>
                  void applyRecording(
                    index,
                    settings?.samplerate ?? 44100,
                    settings?.bit_depth ?? 24
                  )
                }
              />
            </div>
            {/* It says Look again while it looks, so its words and width
                never change: only the spinner, after a second, in the
                icon's room. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => void lookAgain()}
                  disabled={rescanning}
                  className="shrink-0"
                >
                  {slowLook ? <Spinner after={0} /> : <RefreshCw />}
                  Look again
                </Button>
              </TooltipTrigger>
              <TooltipContent>Find an interface plugged in since the app started</TooltipContent>
            </Tooltip>
          </div>

          {settings?.missing_device && (
            <p className="text-xs text-muted-foreground">
              Plug it in and switch it on, then press Look again, or pick another interface to
              record with.
            </p>
          )}

          {/* Only where there is a choice to make. Somebody who knows their
              desk has sixteen inputs and is offered eight has no way to guess
              that another driver sees the same desk whole. */}
          {severalInputDrivers && (
            <p className="text-xs text-muted-foreground">
              Each driver can offer a different number of inputs. If your interface shows fewer
              than it has, try another driver: ASIO, where there is one, usually offers all of
              them.
            </p>
          )}
        </div>

        {/* Under the interface, so it moves nothing above it as it comes. */}
        {formatTrouble && (
          <Warning>
            This interface did not say which sample rates it takes, so the three below are the
            usual ones rather than its own. Pick the one the interface is set to; if a rehearsal will
            not start at it, try another.
          </Warning>
        )}

        <PickRow
          label="Rate"
          value={settings?.samplerate ?? null}
          options={rateOptions.map((rate) => ({
            value: rate,
            label: <span className="tnum">{rate / 1000} kHz</span>,
          }))}
          onChange={(rate) => {
            const allowed = formats[String(rate)] ?? [16, 24]
            const depth = allowed.includes(settings?.bit_depth ?? 24)
              ? (settings?.bit_depth ?? 24)
              : allowed[0]
            void applyRecording(settings?.device_index ?? null, rate, depth)
          }}
        />

        <div className="flex flex-col gap-2">
          <PickRow
            label="Depth"
            value={settings?.bit_depth ?? null}
            options={[16, 24].map((depth) => ({
              value: depth,
              label: <span className="tnum">{depth} bit</span>,
              disabled: !depths.includes(depth),
            }))}
            onChange={(depth) =>
              void applyRecording(
                settings?.device_index ?? null,
                settings?.samplerate ?? 44100,
                depth
              )
            }
          />
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Mic className="mt-0.5 size-3.5 shrink-0" />
            24 bits leaves enough headroom to set the inputs low and stop worrying about the loud
            chorus, at half again as much disk. Only what this interface accepts is shown.
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup
        rise={2}
        title="Playback output"
        hint="Where takes play back: the headphones on the interface, say, rather than the laptop's speakers."
      >
        <DevicePicker
          id="output-device"
          label="Playback output"
          devices={outputs}
          value={settings?.output_device_index ?? null}
          disabled={rescanning}
          placeholder="System output"
          systemDefault
          // How many outputs each device has under this driver, since that
          // is what decides which pairs there are to choose from below.
          detail={(d) => ` · ${countOf(d.max_output_channels, "output")}`}
          onChange={async (idx) => {
            dismiss(SAID)
            const res = await api().set_output_device(idx)
            if (!res.ok) {
              notify({
                key: SAID,
                kind: "error",
                text: res.error ?? "Could not switch the output",
              })
              return
            }
            if (res.warning) notify({ key: PLAYBACK, kind: "warning", text: res.warning })
            else dismiss(PLAYBACK)
            setSettings(await api().get_settings())
          }}
        />

        {(() => {
          const card = outputs.find(
            (d) => d.index === settings?.output_device_index
          )
          // The system output is the system's: which of its channels are
          // which is not the app's to say, so it always plays through 1–2.
          if (!card) {
            return (
              <div className="flex flex-col gap-2">
                <OutputChannels
                  count={2}
                  value={[1, 2]}
                  onChange={() => {}}
                  disabled
                />
                <p className="text-xs text-muted-foreground">
                  The system output plays through 1–2. To play through
                  other outputs, choose the interface itself above.
                </p>
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-2">
              <OutputChannels
                count={card.max_output_channels}
                value={settings?.output_channels ?? [1, 2]}
                onChange={async (channels) => {
                  dismiss(SAID)
                  const res = await api().set_output_channels(channels)
                  if (!res.ok) {
                    notify({
                      key: SAID,
                      kind: "error",
                      text: res.error ?? "Could not switch the outputs",
                    })
                    return
                  }
                  if (res.warning) {
                    notify({ key: PLAYBACK, kind: "warning", text: res.warning })
                  } else dismiss(PLAYBACK)
                  setSettings(await api().get_settings())
                }}
              />
              {/* The same words as for the inputs, and for the same reason:
                  through MME or WASAPI a desk with sixteen outputs is often
                  a stereo device, and only another driver shows the rest. */}
              {card.max_output_channels <= 2 &&
                new Set(outputs.map((d) => d.host_api)).size > 1 && (
                  <p className="text-xs text-muted-foreground">
                    This driver offers two outputs on it. If your interface has more, choose it
                    under another driver: ASIO, where there is one, usually offers all of them.
                  </p>
                )}
            </div>
          )
        })()}
      </SettingsGroup>
    </>
  )
}
