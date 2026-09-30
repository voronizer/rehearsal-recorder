import type { ComponentType } from "react"
import {
  AudioLines,
  Drum,
  Guitar,
  KeyboardMusic,
  Laptop,
  Metronome,
  Mic,
  MicVocal,
  Piano,
} from "lucide-react"
import { Bass, ElectricGuitar, Maracas, Saxophone, Violin } from "@/components/DrawnIcons"

/**
 * The icon a member of the band is shown by: beside their row on the setup
 * screen, in the corner of their tile while recording, and on their plate in
 * the player.
 *
 * Chosen from this list, never guessed from the name: a track called "Dave"
 * is somebody's bass, and no rule could know it. The choice is kept with the
 * band in Python, as a key from here; a key this list does not have (a later
 * version's, or a hand-edited config) is drawn as the neutral one, the same
 * as none.
 *
 * Most come from lucide, like every other icon in the app. Five it does not
 * have, and no open set has them drawn in lines: those are drawn in
 * components/DrawnIcons on lucide's grid — 24 units, a stroke of 2, round
 * ends — so that the set reads as one. The guitars lie corner to corner as
 * lucide's does; the violin stands, with its bow beside it rather than
 * across, which read as a guitar struck out.
 */

type Glyph = ComponentType<{ className?: string }>

export type Instrument = { key: string; label: string; Glyph: Glyph }

/** In the order the grid shows them: voices, strings plucked, drums, keys,
 *  the rest, and the neutral one last. */
export const INSTRUMENTS: Instrument[] = [
  { key: "vocals", label: "Vocals", Glyph: MicVocal },
  { key: "mic", label: "Microphone", Glyph: Mic },
  { key: "guitar-electric", label: "Electric guitar", Glyph: ElectricGuitar },
  { key: "guitar-acoustic", label: "Acoustic guitar", Glyph: Guitar },
  { key: "bass", label: "Bass", Glyph: Bass },
  { key: "drums", label: "Drums", Glyph: Drum },
  { key: "percussion", label: "Percussion", Glyph: Maracas },
  { key: "keys", label: "Keys", Glyph: Piano },
  { key: "synth", label: "Synth", Glyph: KeyboardMusic },
  { key: "winds", label: "Winds", Glyph: Saxophone },
  { key: "strings", label: "Strings", Glyph: Violin },
  { key: "click", label: "Click", Glyph: Metronome },
  { key: "backing", label: "Backing track", Glyph: Laptop },
  { key: "other", label: "Other", Glyph: AudioLines },
]

const NEUTRAL = INSTRUMENTS[INSTRUMENTS.length - 1]

/** The entry for a key, and the neutral one for none or one not listed. */
export function instrument(key?: string | null): Instrument {
  return INSTRUMENTS.find((i) => i.key === key) ?? NEUTRAL
}
