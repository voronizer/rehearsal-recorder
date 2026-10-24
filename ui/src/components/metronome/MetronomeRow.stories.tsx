import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { ClickSettings } from "./ClickSettings"
import { MetronomeRowView } from "./MetronomeRow"
import { stubBridge } from "./storyBridge"
import type { MetronomeState, Signature } from "@/lib/api"
import { statusLine } from "@/lib/metronome"

/** Python's answer for the row: Pałyn at 128 in 4/4, between takes. */
const PALYN: MetronomeState = {
  phase: "idle",
  tempo: 128,
  signature: "4/4",
  per_bar: 4,
  on: true,
  case: "song",
  song: { id: 1, title: "Pałyn", tempo: 128, signature: "4/4" },
  held: false,
  last_take: null,
  upcoming: [],
  count: 0,
  since_count_in_ms: null,
  output_missing: null,
  // No song has a backing track yet: the row is not shown.
  backing: {
    song: null,
    on: true,
    volume: 0.8,
    row: false,
    playing: false,
    position_sec: 0,
    output_missing: null,
    getting_ready: false,
    free: false,
  },
}

const meta = {
  title: "Metronome/MetronomeRow",
  component: MetronomeRowView,
  args: {
    state: PALYN,
    lit: null,
    line: statusLine(PALYN),
    onSwitch: () => {},
    onTempo: () => {},
    onPlay: () => {},
    onLink: () => {},
    settings: <ClickSettings />,
  },
  decorators: [
    (Story) => {
      stubBridge()
      return (
        // As wide as the footer leaves it beside Finish and Record at 960.
        <div className="w-[28.5rem] pt-96">
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof MetronomeRowView>

export default meta
type Story = StoryObj<typeof meta>

/** The row as the rehearsal screen draws it, kept here as Python would:
 *  the tempo and signature change, the switch, ▶ and ■. */
function Live({ start }: { start: MetronomeState }) {
  const [state, setState] = useState(start)
  const set = (patch: Partial<MetronomeState>) => setState((s) => ({ ...s, ...patch }))
  return (
    <MetronomeRowView
      state={state}
      lit={null}
      line={statusLine(state)}
      onSwitch={(on) => set({ on })}
      onTempo={(tempo: number | null, signature: Signature) => {
        const song = state.song
        set({
          tempo,
          signature,
          per_bar: signature === "6/8" ? 6 : Number(signature[0]),
          held: !!song && (song.tempo !== tempo || song.signature !== signature),
        })
      }}
      onPlay={() => set({ phase: state.phase === "preview" ? "idle" : "preview" })}
      onLink={() =>
        set({
          held: false,
          song: state.song && { ...state.song, tempo: state.tempo, signature: state.signature },
        })
      }
      settings={<ClickSettings />}
    />
  )
}

/** Pałyn: the song's tempo. Change it and the line offers to save it. */
export const SongsTempo: Story = { render: () => <Live start={PALYN} /> }

/** A change held until another song is picked. */
export const Held: Story = {
  args: {
    state: { ...PALYN, tempo: 129, held: true },
    line: statusLine({ ...PALYN, tempo: 129, held: true }),
  },
}

/** The click running between takes, its second click lit. */
export const Running: Story = { args: { state: { ...PALYN, phase: "preview" }, lit: 1 } }

/** Ahoń in 6/8: the drawn eighth, and six dots in two groups. */
export const SixEight: Story = {
  args: {
    state: { ...PALYN, tempo: 198, signature: "6/8", per_bar: 6, song: { id: 3, title: "Ahoń", tempo: 198, signature: "6/8" } },
    line: { text: "The song's tempo." },
  },
}

/** A song with no tempo yet, played before. */
export const NoTempoYet: Story = {
  args: {
    state: { ...PALYN, tempo: null, case: "song_without", song: { id: 5, title: "Dym", tempo: null, signature: null },
      last_take: { folder: "/rec/sat", take_number: 5, name: "Dym 5" } },
    line: statusLine({ ...PALYN, tempo: null, case: "song_without", song: { id: 5, title: "Dym", tempo: null, signature: null },
      last_take: { folder: "/rec/sat", take_number: 5, name: "Dym 5" } }),
  },
}

/** The click's output is not there: the warning line. */
export const OutputMissing: Story = {
  args: { line: statusLine({ ...PALYN, output_missing: "X18" }) },
}

/** Off: takes record without the click. */
export const Off: Story = {
  args: { state: { ...PALYN, on: false }, line: statusLine({ ...PALYN, on: false }) },
}

/** Before Python has answered: the row's room, nothing to press. */
export const NotYet: Story = { args: { state: null, line: { text: "" } } }
