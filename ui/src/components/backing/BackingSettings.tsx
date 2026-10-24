import { useId } from "react"
import { BackingVolume } from "@/components/backing/BackingRow"
import { DevicePicker } from "@/components/DevicePicker"
import { OutputChannels } from "@/components/OutputChannels"
import { Label } from "@/components/ui/label"
import { useBackingSettings } from "@/hooks/useBackingSettings"
import { notConnected } from "@/lib/format"

/** The device picker's first item: it plays where the player plays until
 *  it has an output of its own, as the click does. */
const WITH_THE_PLAYER = "Where the player plays"

/** How many outputs a device has, for the list. */
const outputsOf = (n: number) => ` · ${n} ${n === 1 ? "output" : "outputs"}`

/**
 * Where a song's backing track is heard and how loud (backing-track spec
 * Part 8, the Q7 mockup's B): a device and its outputs, with the player's
 * own pickers, and its line; on one output, the line that a stereo file is
 * played in mono. Picking either plays two seconds of it. Then the volume,
 * the same as the slider in its row on the rehearsal screen.
 *
 * Settings › Click & backing track shows all of it, in its group "Backing
 * track". Behind the metronome's gear it is `compact`: the output alone,
 * under its label, after the click's four settings.
 */
export function BackingSettings({ compact = false }: { compact?: boolean }) {
  const b = useBackingSettings()
  const id = useId()
  const missing = b.missing
  const single = b.card !== undefined && b.channels.length === 1
  const output = (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <Label id={`${id}-label`} htmlFor={`${id}-device`}>
        Backing track output
      </Label>
      <DevicePicker
        id={`${id}-device`}
        label="Backing track output"
        devices={b.outputs}
        value={b.device}
        placeholder={WITH_THE_PLAYER}
        systemDefault
        systemLabel={WITH_THE_PLAYER}
        missing={
          missing === null
            ? undefined
            : missing
              ? notConnected({ name: missing, host_api: "" }, false)
              : "The backing track's output is not connected"
        }
        detail={(d) => outputsOf(d.max_output_channels)}
        unavailable={(d) => d.backing_unavailable ?? null}
        onChange={(index) => void b.setDevice(index)}
        disabled={!b.settings}
      />
      <OutputChannels
        id={`${id}-outputs`}
        count={b.card ? b.card.max_output_channels : Math.max(2, ...b.channels)}
        value={b.channels}
        onChange={(channels) => void b.setChannels(channels)}
        disabled={!b.card}
      />
      {!compact && (
        <p className="text-xs text-muted-foreground">
          Where the backing track is heard: the speakers the band plays to, or the mix for in-ear
          monitors. Picking one plays two seconds of it.
          {single && " One output: a stereo backing track is played in mono."}
        </p>
      )}
      {compact && single && (
        <p className="text-xs text-muted-foreground">One output: a stereo backing track is played in mono.</p>
      )}
    </div>
  )
  if (compact) return output
  return (
    <>
      {output}
      <div className="flex items-center gap-4">
        <span aria-hidden className="min-w-20 text-sm">
          Volume
        </span>
        <BackingVolume
          value={b.volume ?? 0}
          disabled={b.volume === null}
          onVolume={(volume) => void b.setVolume(volume)}
          percent
          className="min-w-0 flex-1"
        />
      </div>
    </>
  )
}
