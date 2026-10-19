import {
  ClickOutputPickers,
  ClickSoundRow,
  ClickVolumeRow,
  CountInRow,
} from "@/components/metronome/ClickSettings"
import { SettingsGroup } from "@/components/SettingsGroup"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useClickSettings } from "@/hooks/useClickSettings"
import { rise } from "@/lib/motion"

/**
 * Settings › Metronome (spec Part 6): where the click is heard, how loud,
 * its sound and the count-in, the same four settings as behind the gear in
 * the metronome's row and read and saved through the same hook, so a change
 * in one is what the other shows. Below them, in the tab only, whether a
 * click take's WAVs carry its tempo. Each is saved as it is changed, and a
 * refusal is said in the settings' notice (useClickSettings).
 */
export function MetronomeSettings() {
  const c = useClickSettings()
  return (
    <>
      <SettingsGroup
        rise={1}
        title="Click output"
        hint="Where the click is heard. A pair of outputs that feeds only the headphones keeps it off the mics."
      >
        <ClickOutputPickers c={c} />
      </SettingsGroup>

      <SettingsGroup rise={2} title="The click">
        <ClickVolumeRow c={c} />
        {/* The hints under the switches, in line with them: the row's name
            is 80 px and 16 px from its switch. */}
        <div className="flex flex-col gap-2">
          <ClickSoundRow c={c} />
          <p className="pl-24 text-xs text-muted-foreground">
            The first beat of a bar is higher, in 6/8 the fourth too. Pick one to hear it.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <CountInRow c={c} />
          <p className="pl-24 text-xs text-muted-foreground">
            Clicked before every take that has the click. It is in the recording; the take's clock
            starts after it.
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup rise={3}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Checkbox
              id="tempo-in-wav"
              checked={c.settings?.tempo_in_wav ?? true}
              disabled={!c.settings}
              onCheckedChange={(on) => c.setTempoInWav(on === true)}
            />
            <Label htmlFor="tempo-in-wav">Write the tempo into WAV files</Label>
          </div>
          <p className="pl-7 text-xs text-muted-foreground">
            Takes recorded to the click get their tempo and time signature in each WAV. Cubase, Pro
            Tools, Studio One and FL Studio then fit them to the project's tempo, so set the project
            to the song's tempo first. Ableton Live and Logic ignore it.
          </p>
        </div>
      </SettingsGroup>

      <p className="animate-rise text-xs text-muted-foreground" style={rise(4)}>
        The same settings are behind the gear in the metronome row, on the rehearsal screen.
      </p>
    </>
  )
}
