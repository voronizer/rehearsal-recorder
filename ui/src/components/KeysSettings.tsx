import { Fragment, type ReactNode } from "react"
import { SettingsGroup } from "@/components/SettingsGroup"
import { Kbd } from "@/components/ui/kbd"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import type { KeyKind } from "@/lib/api"
import { KEYS_SAID, switchKeys, useKeysOn } from "@/lib/keys"
import { rise as riseAt } from "@/lib/motion"
import { useSystem, words } from "@/lib/platform"

/** A screen, and what each of its keys does there: the keys of a use first,
 *  then its words. */
type Row = { screen: string; uses: [string[], string][] }

const SPACE_ROWS: Row[] = [
  { screen: "Start screen", uses: [[["Space"], "start the rehearsal"]] },
  {
    screen: "Rehearsal",
    uses: [
      [["Space"], "record a take"],
      [["Esc"], "finish"],
    ],
  },
  { screen: "Recording", uses: [[["Space"], "stop the take"]] },
  {
    screen: "After a take",
    uses: [
      [["Space"], "save the take"],
      [["Esc"], "discard it"],
    ],
  },
  {
    screen: "Listening",
    uses: [
      [["Space"], "play or pause"],
      [["Esc"], "close the take"],
    ],
  },
  { screen: "History, Settings", uses: [[["Esc"], "back to the start screen"]] },
]

const PLAYER_ROWS: Row[] = [
  {
    screen: "Rehearsal",
    uses: [
      [["↑", "↓"], "next song"],
      [["T"], "tap the tempo"],
    ],
  },
  {
    screen: "Listening",
    uses: [
      [["←", "→"], "10 seconds"],
      [["Home"], "start"],
      [["↑", "↓"], "next take of the song"],
      [["M"], "mark"],
      [["R"], "repeat"],
      [["?"], "keys"],
    ],
  },
  {
    screen: "History",
    uses: [
      [["↑", "↓"], "next in the list"],
      [["T"], "tap a song's tempo"],
    ],
  },
]

/**
 * Settings › Keys: Space and Esc, and the player's keys, each turned on or
 * off with one switch (lib/keys.ts). It is in force at once and Python keeps
 * it. Under each switch, what those keys do on each screen, so a person
 * knows what they turn off.
 */
export function KeysSettings() {
  const { undoKey } = words(useSystem())
  useNoticesGoWithPage(KEYS_SAID)
  return (
    <>
      <KeysGroup
        kind="space"
        title="Space and Esc"
        hint="Start and stop a take, save or discard it, and finish the rehearsal."
        rows={SPACE_ROWS}
        rise={1}
      />
      <KeysGroup
        kind="player"
        title="The player's keys"
        hint="Arrows, Home, M, R and ? in the player; ↑ and ↓ in the lists; T to tap a tempo."
        rows={PLAYER_ROWS}
        rise={2}
      />
      <p className="animate-rise text-xs text-muted-foreground" style={riseAt(3)}>
        When a switch is off, its keys no longer show on the buttons.
        Undo ({undoKey}), and Esc in a window or a field, work either way.
      </p>
    </>
  )
}

/** One kind of keys: its switch at the head's right, named by the title,
 *  and a row a screen under it. */
function KeysGroup({
  kind,
  title,
  hint,
  rows,
  rise,
}: {
  kind: KeyKind
  title: string
  hint: ReactNode
  rows: Row[]
  rise: number
}) {
  const on = useKeysOn(kind)
  return (
    <SettingsGroup
      title={title}
      hint={hint}
      rise={rise}
      action={
        <ToggleGroup
          type="single"
          variant="switch"
          aria-label={title}
          value={on ? "on" : "off"}
          // The one that is on, pressed again, sends "": one is always on.
          onValueChange={(next) => {
            if (next) void switchKeys(kind, next === "on")
          }}
        >
          <ToggleGroupItem value="on">On</ToggleGroupItem>
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {/* The screen in grey, then its keys, each with a few words. A screen
          with more keys than its line has room for goes on to the next. */}
      <dl className="text-sm">
        {rows.map(({ screen, uses }) => (
          <div
            key={screen}
            data-keys-row
            className="grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-x-4 not-first:border-t not-first:pt-3 not-last:pb-3"
          >
            <dt className="text-muted-foreground">{screen}</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
              {uses.map(([keys, what]) => (
                // The spaces are for a screen reader and a copy: on screen
                // the gaps set them apart.
                <span key={what} className="flex items-center gap-1">
                  {keys.map((k) => (
                    <Fragment key={k}>
                      <Kbd>{k}</Kbd>{" "}
                    </Fragment>
                  ))}
                  <span className="ml-1">{what}</span>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </SettingsGroup>
  )
}
