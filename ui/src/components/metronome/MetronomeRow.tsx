import { useEffect, useRef, useState, type ReactNode } from "react"
import { Play, Settings2, Square } from "lucide-react"
import { BeatDots } from "@/components/metronome/BeatDots"
import { ClickSettings } from "@/components/metronome/ClickSettings"
import { ClickSwitch } from "@/components/metronome/ClickSwitch"
import { SignatureSelect } from "@/components/metronome/SignatureSelect"
import { StatusLine } from "@/components/metronome/StatusLine"
import { TapButton } from "@/components/metronome/TapButton"
import { TempoField } from "@/components/metronome/TempoField"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useMetronome } from "@/hooks/useMetronome"
import { api, type MetronomeState, type Signature } from "@/lib/api"
import {
  clampTempo,
  statusLine,
  type Counting,
  type StatusLine as Line,
} from "@/lib/metronome"
import { dismiss } from "@/lib/notices"

/** The notice the row says a refusal in. */
const SAID = "metronome"

type LinkAction = NonNullable<Line["link"]>["action"]

/**
 * The metronome's row as it is drawn, from what it is given: the switch,
 * the tempo with − and + and its unit, the signature, Tap, ▶ or ■, the beat
 * and the gear, on one line, and the status line under them (spec Part 4,
 * Q7 B). It calls nothing itself but Tap's pads, so a still picture of it
 * needs only its props. `state` is null until Python has answered; the row
 * keeps its room meanwhile, with nothing to press.
 */
export function MetronomeRowView({
  state,
  lit,
  line,
  onSwitch,
  onTempo,
  onPlay,
  onLink,
  settings,
}: {
  state: MetronomeState | null
  lit: number | null
  line: Line
  onSwitch: (on: boolean) => void
  /** A new tempo or signature, the other as it was. */
  onTempo: (tempo: number | null, signature: Signature) => void
  /** ▶ or ■, by the phase. */
  onPlay: () => void
  onLink: (action: LinkAction) => void
  /** What the gear opens on: the click's settings. */
  settings: ReactNode
}) {
  const tempo = state?.tempo ?? null
  const signature = state?.signature ?? "4/4"
  const running = state?.phase === "preview"
  const off = state === null
  // Opened from the keyboard, the focus goes into the settings; with the
  // pointer it stays on the gear, so Esc and Space are the screen's again.
  const byPointer = useRef(false)

  return (
    <section aria-label="Metronome" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <ClickSwitch on={state?.on ?? true} onChange={onSwitch} disabled={off} />
        <TempoField
          tempo={tempo}
          signature={signature}
          disabled={off}
          onChange={(next) => onTempo(next, signature)}
        />
        <SignatureSelect
          value={signature}
          disabled={off}
          // The number stays, brought into the new signature's range.
          onChange={(next) => onTempo(tempo === null ? null : clampTempo(tempo, next), next)}
        />
        <TapButton signature={signature} disabled={off} onTempo={(next) => onTempo(next, signature)} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-row"
              aria-label={running ? "Stop the click" : "Play the click"}
              disabled={off || tempo === null}
              onClick={onPlay}
            >
              {running ? <Square className="fill-current" /> : <Play className="fill-current" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span aria-hidden>{running ? "Stop the click" : "Play the click"}</span>
          </TooltipContent>
        </Tooltip>
        <BeatDots signature={signature} lit={running ? lit : null} />
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-row"
                  aria-label="Metronome settings"
                  onPointerDown={() => (byPointer.current = true)}
                  onKeyDown={() => (byPointer.current = false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Settings2 />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <span aria-hidden>Metronome settings</span>
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            side="top"
            aria-label="Metronome settings"
            className="w-[23rem] p-4"
            onOpenAutoFocus={(e) => {
              if (byPointer.current) e.preventDefault()
            }}
          >
            {settings}
          </PopoverContent>
        </Popover>
      </div>
      <StatusLine line={line} onLink={onLink} />
    </section>
  )
}

/**
 * The metronome's row on the rehearsal screen, at the footer's left beside
 * Finish and Record. Python keeps the tempo and the signature and follows
 * the next take's name with them; the row shows what it says and sends
 * each change, which Python holds until the name names another song. The
 * click run with ▶ stops at ■, at Record, and when the screen is left.
 */
export function MetronomeRow() {
  const metronome = useMetronome()
  const { refresh } = metronome
  const sayError = useErrorNotice(SAID)
  // What was last sent, shown until Python's answer to it is in, so the
  // field does not show the old number for a moment.
  const [sent, setSent] = useState<{ tempo: number | null; signature: Signature } | null>(null)
  const [switched, setSwitched] = useState<boolean | null>(null)
  // "Count it from the last take", kept for the song it was done for while
  // the row is open.
  const [counting, setCounting] = useState<{ song: string; value: Counting } | null>(null)

  const answer = metronome.state
  const state: MetronomeState | null = answer && {
    ...answer,
    ...(sent ?? {}),
    on: switched ?? answer.on,
  }
  const song = answer?.song?.title ?? null
  const counted = counting && counting.song === song ? counting.value : null

  // The click run between takes stops with the screen. Record has stopped
  // it already, in Python, when the take is what took the screen's place.
  const phase = useRef(answer?.phase)
  useEffect(() => {
    phase.current = answer?.phase
  })
  useEffect(
    () => () => {
      if (phase.current === "preview") void api().metronome_stop()
    },
    []
  )

  /** Sends a change, says a refusal, and asks Python again. */
  const send = async (call: Promise<{ ok: boolean; error?: string }>, fallback: string) => {
    dismiss(SAID)
    const res = await call
    if (!res.ok) sayError(res.error ?? fallback)
    await refresh()
    return res.ok
  }

  const setTempo = async (tempo: number | null, signature: Signature) => {
    setSent({ tempo, signature })
    await send(api().metronome_set(tempo, signature), "Could not set the tempo")
    setSent(null)
  }

  const onLink = async (action: LinkAction) => {
    if (action === "save") {
      await send(api().metronome_save_to_song(), "Could not save the tempo to the song")
      return
    }
    const from = answer?.last_take
    if (!answer || !from || !song) return
    setCounting({ song, value: "running" })
    dismiss(SAID)
    const res = await api().count_tempo(from.folder, from.take_number, answer.signature)
    if (!res.ok || res.tempo == null) {
      setCounting(null)
      sayError(res.error ?? "Could not count the tempo")
      return
    }
    await setTempo(res.tempo, answer.signature)
    setCounting({ song, value: { from: from.name } })
  }

  return (
    <MetronomeRowView
      state={state}
      lit={metronome.lit}
      line={state ? statusLine(state, counted) : { text: "" }}
      onSwitch={async (on) => {
        setSwitched(on)
        await send(api().metronome_set_on(on), "Could not switch the click")
        setSwitched(null)
      }}
      onTempo={(tempo, signature) => void setTempo(tempo, signature)}
      onPlay={() =>
        void send(
          state?.phase === "preview" ? api().metronome_stop() : api().metronome_play(),
          "Could not play the click"
        )
      }
      onLink={(action) => void onLink(action)}
      settings={<ClickSettings />}
    />
  )
}
