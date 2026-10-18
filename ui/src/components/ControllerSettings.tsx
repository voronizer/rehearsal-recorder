import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { api, poll, type ControllerState, type ControllerPorts } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useAfter } from "@/hooks/useAfter"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { SAID, SettingsGroup } from "@/components/SettingsGroup"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
import { dismiss, notify } from "@/lib/notices"

const ACTION_LABELS: Record<string, string> = {
  record_stop: "Record/Stop", play_stop: "Play/Stop", restart: "Go to start",
  previous_take: "Previous take", next_take: "Next take", previous_song: "Previous song",
  next_song: "Next song", seek_back: "Seek backward", seek_forward: "Seek forward",
  start_rehearsal: "Start rehearsal", stop_rehearsal: "Stop rehearsal", remove_take: "Remove take",
  select_take: "Select take", select_song: "Select song", mute_toggle: "Mute playback",
}

export function ControllerSettings() {
  const [ports, setPorts] = useState<ControllerPorts>({ system: null, inputs: [], outputs: [] })
  const [state, setState] = useState<ControllerState | null>(null)
  const [input, setInput] = useState("")
  const [output, setOutput] = useState("")
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const here = useRef(false)
  const saving = useRef(false)
  const refreshingNow = useRef(false)
  const initialReadDone = useRef(false)
  const selectionLoaded = useRef(false)
  const generation = useRef(0)
  const previousError = useRef<string | null>(null)
  useNoticesGoWithPage(SAID)
  const sayError = useCallback((text: string) => {
    if (here.current) notify({ key: SAID, kind: "error", text })
  }, [])
  const refreshSpinner = useAfter(refreshing, SPINNER_AFTER_MS)
  const refreshSlow = useAfter(refreshing, 10000)

  const load = useCallback(async (selection: boolean) => {
    const request = ++generation.current
    const [listed, status] = await Promise.all([api().controller_ports(), poll("controller_state")])
    if (!here.current || request !== generation.current) return
    setPorts(listed)
    setState(status)
    if (selection) {
      selectionLoaded.current = true
      setInput(status.selected ? JSON.stringify(status.selected.input) : "")
      setOutput(status.selected ? JSON.stringify(status.selected.output) : "")
    }
  }, [])

  useEffect(() => {
    let alive = true
    here.current = true
    initialReadDone.current = false
    void load(true).catch(() => sayError("Could not list controller ports. Try Look again."))
      .finally(() => { if (alive) initialReadDone.current = true })
    const timer = window.setInterval(() => {
      if (initialReadDone.current && !saving.current && !refreshingNow.current) {
        void load(!selectionLoaded.current).catch(() => {})
      }
    }, 1000)
    return () => {
      alive = false
      here.current = false
      generation.current++
      window.clearInterval(timer)
    }
  }, [load, sayError])

  useEffect(() => {
    const error = state?.error ?? null
    if (error && error !== previousError.current) sayError(error)
    previousError.current = error
  }, [state?.error, sayError])

  const save = async (nextInput: string, nextOutput: string) => {
    if (saving.current) return
    saving.current = true
    selectionLoaded.current = true
    generation.current++
    setBusy(true)
    setInput(nextInput)
    setOutput(nextOutput)
    dismiss(SAID)
    try {
      const result = await api().set_controller(
        nextInput ? JSON.parse(nextInput) : null,
        nextOutput ? JSON.parse(nextOutput) : null,
      )
      if (!here.current) return
      if (!result.ok) {
        // Keep the input visible so an ambiguous match can be completed by
        // choosing its feedback output; the refusal remains in the notice.
        sayError(result.error ?? "Could not select the controller")
        return
      }
      setState(result)
      setInput(result.selected ? JSON.stringify(result.selected.input) : "")
      setOutput(result.selected ? JSON.stringify(result.selected.output) : "")
    } catch {
      sayError("Could not save the controller. Pick it again to retry.")
    } finally {
      saving.current = false
      if (here.current) setBusy(false)
    }
  }

  const lookAgain = async () => {
    if (refreshingNow.current || saving.current) return
    dismiss(SAID)
    refreshingNow.current = true
    setRefreshing(true)
    try {
      await load(!selectionLoaded.current)
      if (here.current) notify({ key: SAID, kind: "done", text: "Controller ports updated" })
    } catch {
      sayError("Could not list controller ports. Try Look again.")
    } finally {
      refreshingNow.current = false
      if (here.current) setRefreshing(false)
    }
  }

  const pair = async () => {
    dismiss(SAID)
    try {
      const result = await api().open_controller_bluetooth()
      if (!result.ok) sayError(result.error ?? "Could not open Bluetooth setup")
    } catch {
      sayError("Could not open Bluetooth setup")
    }
  }

  return (
    <>
      <SettingsGroup
        rise={1}
        title="Controller"
        hint="Record/Stop starts a take or saves it. Play/Stop plays a kept take or stops playback. Controller messages are kept out of instrument recordings."
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" disabled={refreshing || busy} onClick={() => void lookAgain()} className="shrink-0">
                {refreshSpinner ? <Spinner after={0} /> : <RefreshCw />}
                Look again
              </Button>
            </TooltipTrigger>
            <TooltipContent>Find a controller connected since Settings opened</TooltipContent>
          </Tooltip>
        }
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="controller-input">Controller</Label>
          <Select value={input || "disabled"} disabled={busy || refreshing || !state} onValueChange={value => void save(value === "disabled" ? "" : value, "")}>
            <SelectTrigger id="controller-input"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              {state?.selected && input && !ports.inputs.some(p => JSON.stringify(p) === input) && <SelectItem value={input}>{state.selected.input.name} (not connected)</SelectItem>}
              {ports.inputs.map(p => <SelectItem key={JSON.stringify(p)} value={JSON.stringify(p)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {ports.bluetooth_setup && <Button variant="outline" className="self-start" onClick={() => void pair()}>Pair Bluetooth MIDI controller</Button>}
        <p role="status" className="min-h-5 text-sm">{refreshSlow ? "Looking for controller ports…" : !state ? "" : !state.enabled ? "Controller disabled" : state.synchronized ? "Controller ready" : state.port_open ? "Waiting for the controller to respond" : "Connect the controller and check the selected MIDI ports"}</p>
        {state?.last_action && <p className="text-xs text-muted-foreground">{state.last_action.ok ? "Last completed command: " : "Could not complete: "}{ACTION_LABELS[state.last_action.action] ?? "Controller command"}{!state.last_action.ok && `. ${state.last_action.error || "Check the recorder and try again."}`}</p>}
      </SettingsGroup>
      <SettingsGroup
        rise={2}
        title="Feedback output"
        hint="Matched automatically when you pick a controller. Change this only if the controller needs a different output for its lights and display."
      >
        <Select value={output || "automatic"} disabled={!input || busy || refreshing} onValueChange={value => void save(input, value === "automatic" ? "" : value)}>
          <SelectTrigger id="controller-output" aria-label="Controller feedback output"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="automatic">Match automatically</SelectItem>
            {state?.selected && output && !ports.outputs.some(p => JSON.stringify(p) === output) && <SelectItem value={output}>{state.selected.output.name} (not connected)</SelectItem>}
            {ports.outputs.map(p => <SelectItem key={JSON.stringify(p)} value={JSON.stringify(p)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingsGroup>
    </>
  )
}
