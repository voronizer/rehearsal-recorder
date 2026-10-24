import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { SongSummary } from "@/lib/api"
import { NewSongDialog } from "./NewSongDialog"
import { stubBackingBridge } from "./storyBridge"

/** Pałyn, once typed "Palyn", and Viasna: the titles New song refuses. */
const SONGS: SongSummary[] = [
  { id: 1, title: "Pałyn", goes: 7, rehearsals: 3, first_played: null, last_played: null, starred: 1, also: ["Palyn"] },
  { id: 2, title: "Viasna", goes: 4, rehearsals: 2, first_played: null, last_played: null, starred: 0, also: [] },
]

const meta = {
  title: "Backing track/NewSongDialog",
  component: NewSongDialog,
  args: { open: true, songs: SONGS, onOpenChange: () => {}, onMade: () => {} },
  decorators: [
    (Story) => {
      stubBackingBridge()
      return <Story />
    },
  ],
} satisfies Meta<typeof NewSongDialog>

export default meta
type Story = StoryObj<typeof meta>

function Made() {
  const [open, setOpen] = useState(true)
  const [made, setMade] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        New song
      </Button>
      {made && <p className="text-sm text-muted-foreground">Opened: {made}</p>}
      <NewSongDialog songs={SONGS} open={open} onOpenChange={setOpen} onMade={(song) => setMade(song.title)} />
    </div>
  )
}

/** Type a title and press Create. Type "palyn" or "Viasna": the line says
 *  it is a song already, Create waits, and Open it goes to that song.
 *  "Take 3" is what a take with no song is called. */
export const Default: Story = { render: () => <Made /> }
