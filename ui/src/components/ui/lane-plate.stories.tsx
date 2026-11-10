import type { ReactNode } from "react"
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite"
import { LaneControls, MasterControls } from "@/components/LaneControls"
import { NotesLane } from "@/components/midi/NotesLane"
import { NotesPlate } from "@/components/midi/NotesPlate"
import { Waveform } from "@/components/Waveform"
import type { TakeNotes } from "@/lib/api"
import { LanePlate } from "./lane-plate"

const meta = {
  title: "UI/LanePlate",
  component: LanePlate,
  // The width of the player's column of plates.
  decorators: [
    (Story) => (
      <div className="w-50">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LanePlate>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/* The lanes group's fill, which a track's plate is on in the player: the
   plate has none of its own. */
function Fill({ children }: { children: ReactNode }) {
  return <div className="flex flex-col rounded-lg bg-card">{children}</div>
}

/* The audio plate and the master are LanePlate with their things in it; the
   stories show them as the player does, an audio plate in its 56 px row on
   the group's fill. */
function Audio({ name = "Guitar", paired = false }: { name?: string; paired?: boolean }) {
  return (
    <div className="h-14">
      <LaneControls
        name={name}
        icon={name === "Drums" ? "drums" : "guitar-electric"}
        paired={paired}
        channels={1}
        muted={false}
        soloed={false}
        dimmed={false}
        volume={0.8}
        levels={[0.45]}
        onToggleMute={noop}
        onToggleSolo={noop}
        onVolume={noop}
        onVolumeCommit={noop}
      />
    </div>
  )
}

/* The primitive on its own: the card's fill, 12 px across and 8 above and
   below, and whatever the caller puts in it. */
function Bare() {
  return (
    <div className="h-14">
      <LanePlate>
        <span className="text-sm">A plate</span>
        <span className="text-xs text-muted-foreground">Whatever the caller puts in</span>
      </LanePlate>
    </div>
  )
}

/** The plate with nothing of ours in it: a card of 12 px corners, no frame. */
export const Plain: Story = { render: () => <Bare /> }
export const PlainLight: Story = { ...Plain, globals: { theme: "light" } }

/** A track's plate in its row of 56 px, on the lanes group's fill: the name
 *  on a row of its own, and under it the fader with M and S after it. */
export const Single: Story = {
  render: () => (
    <Fill>
      <Audio />
    </Fill>
  ),
}
/** The same on the light theme, whatever the toolbar says. */
export const SingleLight: Story = { ...Single, globals: { theme: "light" } }

/** A name past the plate's width (about 152 px) is cut to its row and whole in
 *  the shared tip on hover; Tab reaches it while it is cut. The notes plate's
 *  name and port are the same. */
export const LongName: Story = {
  render: () => (
    <Fill>
      <div className="h-14">
        <LaneControls
          name="Lead and backing vocals (Hanna)"
          icon="vocals"
          channels={1}
          muted={false}
          soloed={false}
          dimmed={false}
          volume={0.8}
          levels={[0.45]}
          onToggleMute={noop}
          onToggleSolo={noop}
          onVolume={noop}
          onVolumeCommit={noop}
        />
      </div>
      <NotesPlate name="Keys (Nord Stage 3 MIDI)" icon="keys" port="Nord Stage 3 MIDI Output" />
    </Fill>
  ),
}

/** The notes' plate is a variant of the same one: on its own for a track that
 *  records MIDI only, and the same for a port that was not there. It is as tall
 *  as what it holds, and no less than its lane and the well round it need to
 *  name a kit's rows. */
export const Notes: Story = {
  render: () => (
    <Fill>
      <NotesPlate name="Keys" icon="keys" port="Launchkey Mini MK3" />
      <NotesPlate name="Pads" icon="keys" port="Pad box" missing />
    </Fill>
  ),
}
export const NotesLight: Story = { ...Notes, globals: { theme: "light" } }

/** In the player every lane of notes opens folded, its port left out, and the
 *  arrow after M opens it; open, the port is back. */
export const NotesFolded: Story = {
  render: () => (
    <Fill>
      <NotesPlate name="Keys" icon="keys" port="Launchkey Mini MK3" fold={{ open: false, onToggle: noop }} />
      <NotesPlate name="Keys" icon="keys" port="Launchkey Mini MK3" fold={{ open: true, onToggle: noop }} />
    </Fill>
  ),
}

/** The master's plate, under the tracks, is the third use of it: a group of
 *  its own, so it keeps its box. */
export const Master: Story = {
  render: () => (
    <MasterControls volume={0.8} level={0.5} onVolume={noop} onVolumeCommit={noop} />
  ),
}
export const MasterLight: Story = { ...Master, globals: { theme: "light" } }

const PEAKS = [Array.from({ length: 160 }, (_, i) => Math.abs(Math.sin(i / 7)) * 0.85)]

const KIT: TakeNotes = {
  name: "Drums",
  drums: true,
  rows: ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"],
  notes: [
    [0.4, 0.1, 0, 100],
    ...Array.from({ length: 20 }, (_, i): [number, number, number, number] => [i * 0.5, 0.1, 2, 80]),
    ...Array.from({ length: 10 }, (_, i): [number, number, number, number] => [i, 0.1, i % 2 ? 4 : 5, 110]),
  ],
}

/* A row of the lanes group as Timeline lays it out: the plate, 12 px, the
   picture, and the group's 12 px after it. The picture's cell pads it 3 px
   from the row's edges, but where a Both track's audio and notes meet. In
   the player the grey is the plates' (Timeline's PlateGrey) and the pictures
   have none; here each picture keeps the well it has on its own. */
const ROW = "grid grid-cols-[12.5rem_minmax(0,1fr)] gap-x-3 pr-3"

function Wave({ paired = false }: { paired?: boolean }) {
  return (
    <div className={paired ? "pt-[3px]" : "py-[3px]"}>
      <Waveform
        peaks={PEAKS}
        peaksFrom={0}
        peaksTo={10}
        viewFrom={0}
        viewTo={10}
        position={3}
        className={paired ? "h-full rounded-b-none" : "h-full"}
      />
    </div>
  )
}

/** A Both track: its audio row, and its notes' row under it, with the MIDI
 *  sign and no name. The two pictures meet at a 1 px line: the waveform's
 *  lower corners square, the notes lane's upper ones square under the line. */
function BothTrack() {
  return (
    <>
      <div className={`${ROW} h-14 grid-rows-[minmax(0,1fr)]`}>
        <Audio name="Drums" paired />
        <Wave paired />
      </div>
      <div className={ROW}>
        <NotesPlate name="Drums" port="TD-17" paired />
        <div className="pb-[3px]">
          <NotesLane
            name="Drums"
            data={KIT}
            duration={10}
            playhead={3}
            className="h-full rounded-t-none border-t"
          />
        </div>
      </div>
    </>
  )
}

const wide: Decorator[] = [
  (Story) => (
    <div className="w-3xl">
      <Story />
    </div>
  ),
]

/** The lanes group in the player: three rows on one fill, with no line
 *  between them. Each picture sits on its own well, the side panel's colour
 *  (`--well`, `var(--panel)`) with 8 px corners and 3 px of the group's fill
 *  above and below it; the second row is a Both track's notes, sharing the
 *  first's well under its line. */
export const Grouped: Story = {
  decorators: wide,
  render: () => (
    <Fill>
      <BothTrack />
      <div className={`${ROW} h-14 grid-rows-[minmax(0,1fr)]`}>
        <Audio />
        <Wave />
      </div>
    </Fill>
  ),
}
export const GroupedLight: Story = { ...Grouped, globals: { theme: "light" } }

/** A Both track up close: its two rows, one well. */
export const Both: Story = {
  decorators: wide,
  render: () => (
    <Fill>
      <BothTrack />
    </Fill>
  ),
}
export const BothLight: Story = { ...Both, globals: { theme: "light" } }
