import { useState } from "react"
import {
  FolderOpen,
  Gamepad2,
  Info,
  Keyboard,
  ListMusic,
  Metronome,
  Palette,
  Sliders,
  Tags,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ITEM_CHOSEN, Item } from "@/components/ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AppearanceSettings } from "@/components/AppearanceSettings"
import { AudioSettings } from "@/components/AudioSettings"
import { ControllerSettings } from "@/components/ControllerSettings"
import { FoldersSettings } from "@/components/FoldersSettings"
import { KeysSettings } from "@/components/KeysSettings"
import { MarksSettings } from "@/components/MarksSettings"
import { MetronomeSettings } from "@/components/MetronomeSettings"
import { NewDot } from "@/components/NewDot"
import { SetsSettings } from "@/components/SetsSettings"
import { Shell } from "@/components/Shell"
import { UnderTheHood } from "@/components/UnderTheHood"
import { useEscape } from "@/hooks/useSpacebar"
import type { Theme } from "@/lib/appearance"
import { rise } from "@/lib/motion"
import { useUpdate } from "@/lib/update"
import { cn } from "@/lib/utils"
import { SETTINGS_WIDE_REM, useWide } from "@/lib/wide"

type TabId =
  | "audio"
  | "metronome"
  | "folders"
  | "marks"
  | "sets"
  | "appearance"
  | "keys"
  | "controls"
  | "about"

// Every tab Settings has, in the order the section list gives them: a tab
// added here gets its row, its icon and its tip.
const TABS: {
  id: TabId
  label: string
  icon: React.ReactNode
  blurb: string
  /** The tab fills its body and scrolls its own parts, so the body itself
   *  does not scroll. */
  fills?: boolean
}[] = [
  {
    id: "audio",
    label: "Audio",
    icon: <Sliders className="size-4" />,
    blurb: "Which interface, what quality, where it plays back",
  },
  {
    id: "metronome",
    label: "Click & backing track",
    icon: <Metronome className="size-4" />,
    blurb: "Where the click and the backing track are heard, the click's sound, and the count-in",
  },
  {
    id: "folders",
    label: "Folders",
    icon: <FolderOpen className="size-4" />,
    blurb: "Where rehearsals are kept and what goes to the cloud",
  },
  {
    id: "marks",
    label: "Marks",
    icon: <Tags className="size-4" />,
    blurb: "What a moment in a take can be marked with",
  },
  {
    id: "sets",
    label: "Sets",
    icon: <ListMusic className="size-4" />,
    blurb: "Songs in the order a rehearsal goes through them",
    // The list and the set each scroll on their own.
    fills: true,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette className="size-4" />,
    blurb: "Theme and how big everything is",
  },
  {
    id: "keys",
    label: "Keys",
    icon: <Keyboard className="size-4" />,
    blurb: "Keys that work with one press, and when to turn them off",
  },
  {
    id: "controls",
    label: "Controls",
    icon: <Gamepad2 className="size-4" />,
    blurb: "A dedicated rehearsal controller and its connection",
  },
  {
    id: "about",
    label: "Under the hood",
    icon: <Info className="size-4" />,
    blurb: "What this copy of the app runs on, and where it keeps things",
  },
]

/** A section's row, given to its Button through Item, as History's rows
 *  are (components/HistoryRow): these win over Item's padding and wrapping
 *  and over the Button's own size. */
const ROW = "h-auto min-h-9 w-full flex-nowrap justify-start gap-2.5 px-3 py-2 text-left whitespace-normal"
/** A section as its icon: the icon Button's square, with none of Item's
 *  padding, and room for the new version's dot at its corner. */
const ICON = "relative gap-0 p-0"

export function Settings({
  onBack,
  theme,
  scale,
  onAppearanceChange,
}: {
  onBack: () => void
  theme: Theme
  scale: number
  onAppearanceChange: (theme: Theme, scale: number) => void
}) {
  // Nothing here is a decision in flight — every setting is saved as it is
  // changed — so Escape means what the back button means.
  useEscape(onBack)

  // Six sections in one column was a wall. They are grouped by what a person
  // came here to change, not by the order they happened to be written in.
  const [tab, setTab] = useState<TabId>("audio")
  // Settings opens on Audio, and the new version is said in Under the hood:
  // the dot there says which group to look in.
  const newer = useUpdate().latest !== null
  const flagged = (id: TabId) => newer && id === "about"
  // In a narrow window the list is its icons, each named in its tip, and
  // the tab has the room the names had. Only the list changes: the tab, its
  // scroll and its focus stay as they were.
  const wide = useWide(SETTINGS_WIDE_REM)

  const current = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <Shell
      air
      title="Settings"
      onBack={onBack}
      backKey
      backKeyRoom
      className="flex overflow-hidden p-0"
    >
      {/* The page does not scroll: the list and the tab's head stay where
          they are, and the tab's body scrolls under its head. 32 px round
          the column, 56 rem wide at most. */}
      <div className="flex min-h-0 min-w-0 flex-1 px-8 pt-8">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl gap-8">
          {/* The section list. Nine groups is few enough to show at once,
              so nothing is hidden behind a menu. */}
          <nav
            aria-label="Settings sections"
            data-sections={wide ? "rows" : "icons"}
            className={cn("flex shrink-0 flex-col gap-1", wide && "w-52")}
          >
            {/* One button per section, whatever the list's look, so a
                section with the focus keeps it as the window crosses the
                width. Its tip is there only while it is an icon. */}
            {TABS.map((t) => {
              const chosen = t.id === tab
              const news = flagged(t.id) ? `${t.label}, a new version is out` : undefined
              return (
                <Tooltip key={t.id}>
                  <TooltipTrigger asChild>
                    <Item asChild size="sm">
                      <Button
                        variant="ghost"
                        size={wide ? "default" : "icon"}
                        data-tab={t.id}
                        aria-current={chosen ? "page" : undefined}
                        aria-label={wide ? news : (news ?? t.label)}
                        onClick={() => setTab(t.id)}
                        className={cn(wide ? ROW : ICON, chosen && ITEM_CHOSEN)}
                      >
                        {t.icon}
                        {wide && t.label}
                        {flagged(t.id) && <NewDot className={wide ? "ml-auto" : undefined} />}
                      </Button>
                    </Item>
                  </TooltipTrigger>
                  {/* The tab's name only repeats the button's, so it is for
                      the eyes, and not read out again as its description. */}
                  {!wide && (
                    <TooltipContent side="right">
                      <span aria-hidden>{t.label}</span>
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            })}
          </nav>

          {/* A tab chosen comes in afresh: its head, then its groups, rise
              in, and its body starts at the top. */}
          <div key={tab} className="flex min-h-0 min-w-0 flex-1 flex-col gap-8">
            <div data-tab-head className="animate-rise" style={rise(0)}>
              <h2 className="text-xl font-semibold">{current.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{current.blurb}</p>
            </div>

            {/* 48 px between a tab's groups, and 32 under the last one. It
                reaches 4 px past each side, padded back in, so the scroll
                does not cut a focus ring at its edge; and it keeps the
                scrollbar's room, so nothing moves sideways when a tab grows
                longer than the window. */}
            <div
              data-tab-body
              className={cn(
                "-mx-1 flex min-h-0 flex-1 flex-col gap-12 px-1 pb-8",
                !current.fills && "overflow-y-auto [scrollbar-gutter:stable]"
              )}
            >
              {tab === "audio" && <AudioSettings />}
              {tab === "metronome" && <MetronomeSettings />}
              {tab === "folders" && <FoldersSettings />}
              {tab === "marks" && <MarksSettings />}
              {tab === "sets" && <SetsSettings />}
              {tab === "appearance" && (
                <AppearanceSettings theme={theme} scale={scale} onChange={onAppearanceChange} />
              )}
              {tab === "keys" && <KeysSettings />}
              {tab === "controls" && <ControllerSettings />}
              {tab === "about" && <UnderTheHood />}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
