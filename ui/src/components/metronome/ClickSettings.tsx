import { useRef } from "react"
import { DevicePicker } from "@/components/DevicePicker"
import { OutputChannels } from "@/components/OutputChannels"
import { Label } from "@/components/ui/label"
import { PickRow } from "@/components/ui/pick-row"
import { Slider } from "@/components/ui/slider"
import { useClickSettings, type ClickSettingsValue } from "@/hooks/useClickSettings"
import type { MetronomeSettings } from "@/lib/api"
import { notConnected } from "@/lib/format"
import { CLICK_SOUNDS } from "@/lib/metronome"

const COUNT_INS: { value: MetronomeSettings["count_in_bars"]; label: string }[] = [
  { value: 0, label: "None" },
  { value: 1, label: "1 bar" },
  { value: 2, label: "2 bars" },
]

/** The device picker's first item: the click follows the player (Part 6). */
const WITH_THE_PLAYER = "Where the player plays"

/** How many outputs a device has, for the list. */
const outputsOf = (n: number) => ` · ${n} ${n === 1 ? "output" : "outputs"}`

/** Where the click is heard: a device and its outputs, with the player's
 *  own pickers. The outputs shown are always the ones the click uses: the
 *  player's while it follows the player, and none to pick while that is
 *  the system output, which plays through 1–2. */
export function ClickOutputPickers({ c }: { c: ClickSettingsValue }) {
  const missing = c.missing
  return (
    <div className="flex flex-col gap-2">
      <DevicePicker
        id="click-device"
        label="Click output"
        devices={c.outputs}
        value={c.device}
        placeholder={WITH_THE_PLAYER}
        systemDefault
        systemLabel={WITH_THE_PLAYER}
        missing={
          missing === null
            ? undefined
            : missing
              ? notConnected({ name: missing, host_api: "" }, false)
              : "The click's output is not connected"
        }
        detail={(d) => outputsOf(d.max_output_channels)}
        onChange={(index) => void c.setDevice(index)}
        disabled={!c.settings}
      />
      <OutputChannels
        count={c.card ? c.card.max_output_channels : Math.max(2, ...c.channels)}
        value={c.channels}
        onChange={(channels) => void c.setChannels(channels)}
        disabled={!c.card}
      />
    </div>
  )
}

/** How loud the click is: the shared slider, saved when it is let go and
 *  heard then, once the keys stop when it is stepped with them. */
export function ClickVolumeRow({ c }: { c: ClickSettingsValue }) {
  const volume = c.volume ?? 0
  const byKeys = useRef(false)
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
        onPointerDown={() => (byKeys.current = false)}
        onKeyDown={() => (byKeys.current = true)}
        onValueChange={([v]) => c.slideVolume(v)}
        onValueCommit={([v]) => c.setVolume(v, byKeys.current)}
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
