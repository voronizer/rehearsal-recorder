import { useEffect, useState } from "react"
import { DevicePicker } from "@/components/DevicePicker"
import { OutputChannels } from "@/components/OutputChannels"
import { Label } from "@/components/ui/label"
import { PickRow } from "@/components/ui/pick-row"
import { Slider } from "@/components/ui/slider"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { api, type ClickSound, type MetronomeSettings, type OutputDevice, type Settings } from "@/lib/api"
import { CLICK_SOUNDS } from "@/lib/metronome"
import { dismiss, notify } from "@/lib/notices"

/** The notice the click's settings say a refusal in. */
const SAID = "click-settings"

const COUNT_INS: { value: MetronomeSettings["count_in_bars"]; label: string }[] = [
  { value: 0, label: "None" },
  { value: 1, label: "1 bar" },
  { value: 2, label: "2 bars" },
]

type Answer = { ok: boolean; error?: string; warning?: string }

/**
 * The metronome's four settings as Python keeps them (spec Part 6): where
 * the click is heard, how loud, its sound and the count-in. Each change is
 * saved at once; picking a sound plays a bar of it, and so does letting go
 * of the volume. While no output of its own is saved, the click goes where
 * the player plays, and the pickers show that one.
 */
export function useClickSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  // The volume while the slider moves: saved only when it is let go.
  const [sliding, setSliding] = useState<number | null>(null)
  useNoticesGoWithPage(SAID)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [read, devices] = await Promise.all([api().get_settings(), api().list_output_devices()])
        if (!alive) return
        setSettings(read)
        setOutputs(devices)
      } catch {
        /* the bar across the top has said why */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const reread = async () => {
    try {
      setSettings(await api().get_settings())
    } catch {
      /* said in the bar */
    }
  }
  /** Says a refusal or a warning, and whether it was done. */
  const said = (res: Answer, fallback: string) => {
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? fallback })
      return false
    }
    if (res.warning) notify({ key: SAID, kind: "warning", text: res.warning })
    else dismiss(SAID)
    return true
  }
  const save = async <K extends "click_sound" | "click_volume" | "count_in_bars">(
    key: K,
    value: MetronomeSettings[K]
  ) => {
    setSettings((s) => s && { ...s, [key]: value })
    const ok = said(await api().set_metronome_setting(key, value), "Could not save the setting")
    if (!ok) await reread()
    return ok
  }

  return {
    settings,
    /** The outputs the click can play through: another ASIO card cannot
     *  while one records, and is not offered. */
    outputs: outputs.filter((d) => !d.click_unavailable),
    device: settings ? (settings.click_device_index ?? settings.output_device_index) : null,
    channels: settings ? (settings.click_channels ?? settings.output_channels) : [1, 2],
    volume: sliding ?? settings?.click_volume ?? null,
    setDevice: async (index: number | null) => {
      if (said(await api().set_click_device(index), "Could not switch the click's output"))
        await reread()
    },
    setChannels: async (channels: number[]) => {
      if (said(await api().set_click_channels(channels), "Could not switch the click's outputs"))
        await reread()
    },
    setSound: async (sound: ClickSound) => {
      if (await save("click_sound", sound)) void api().metronome_preview(sound)
    },
    slideVolume: setSliding,
    setVolume: async (volume: number) => {
      setSliding(null)
      if (await save("click_volume", volume)) void api().metronome_preview()
    },
    setCountIn: (bars: MetronomeSettings["count_in_bars"]) => void save("count_in_bars", bars),
  }
}

export type ClickSettingsValue = ReturnType<typeof useClickSettings>

/** How many outputs a device has, for the list. */
const outputsOf = (n: number) => ` · ${n} ${n === 1 ? "output" : "outputs"}`

/** Where the click is heard: a device and its outputs, with the player's
 *  own pickers. */
export function ClickOutputPickers({ c }: { c: ClickSettingsValue }) {
  const card = c.outputs.find((d) => d.index === c.device)
  return (
    <div className="flex flex-col gap-2">
      <DevicePicker
        id="click-device"
        label="Click output"
        devices={c.outputs}
        value={c.device}
        placeholder="System output"
        systemDefault
        detail={(d) => outputsOf(d.max_output_channels)}
        onChange={(index) => void c.setDevice(index)}
        disabled={!c.settings}
      />
      {/* The system output plays through 1–2, as the player's does. */}
      <OutputChannels
        count={card ? card.max_output_channels : 2}
        value={card ? c.channels : [1, 2]}
        onChange={(channels) => void c.setChannels(channels)}
        disabled={!card}
      />
    </div>
  )
}

/** How loud the click is: the shared slider, saved when it is let go. */
export function ClickVolumeRow({ c }: { c: ClickSettingsValue }) {
  const volume = c.volume ?? 0
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="min-w-20 text-sm">
        Volume
      </span>
      <Slider
        aria-label="Click volume"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        value={[volume]}
        disabled={c.volume === null}
        onValueChange={([v]) => c.slideVolume(v)}
        onValueCommit={([v]) => void c.setVolume(v)}
        className="min-w-0 flex-1"
      />
      <span className="tnum w-10 shrink-0 text-right text-sm text-muted-foreground">
        {Math.round(volume * 100)}%
      </span>
    </div>
  )
}

/** Click, Woodblock or Hi-hat: picking one plays a bar of it. */
export function ClickSoundRow({ c }: { c: ClickSettingsValue }) {
  return (
    <PickRow
      label="Sound"
      value={c.settings?.click_sound ?? null}
      options={CLICK_SOUNDS.map((s) => ({ value: s.id, label: s.label }))}
      onChange={(sound) => void c.setSound(sound)}
    />
  )
}

/** None, one bar or two before a take that has the click. */
export function CountInRow({ c }: { c: ClickSettingsValue }) {
  return (
    <PickRow
      label="Count-in"
      value={c.settings?.count_in_bars ?? null}
      options={COUNT_INS}
      onChange={c.setCountIn}
    />
  )
}

/**
 * The four settings together, as the gear in the metronome's row shows
 * them, with the line that says where else they are. Settings › Metronome
 * lays the same pieces out in its groups.
 */
export function ClickSettings() {
  const c = useClickSettings()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="click-device">Click output</Label>
        <ClickOutputPickers c={c} />
      </div>
      <ClickVolumeRow c={c} />
      <ClickSoundRow c={c} />
      <CountInRow c={c} />
      <p className="text-xs text-muted-foreground">The same settings are in Settings › Metronome.</p>
    </div>
  )
}
