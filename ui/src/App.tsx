import { useCallback, useEffect, useRef, useState } from "react"
import { RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Setup } from "@/screens/Setup"
import { Rehearsal } from "@/screens/Rehearsal"
import { Recording } from "@/screens/Recording"
import { HistoryScreen } from "@/screens/HistoryScreen"
import { DraftsScreen } from "@/screens/DraftsScreen"
import { Settings } from "@/screens/Settings"
import {
  api,
  poll,
  waitForApi,
  type ControlState,
  type Draft,
  type SessionState,
} from "@/lib/api"
import { useDialogFocusKeys } from "@/hooks/useSpacebar"
import { useUndoKey } from "@/hooks/useUndoKey"
import { heard } from "@/lib/listening"
import { notify } from "@/lib/notices"
import { reportBridgeError } from "@/lib/bridgeErrors"
import { loadDeletionKind } from "@/lib/deletion"
import { loadKeys } from "@/lib/keys"
import { loadLabels } from "@/lib/labels"
import { NO_SONG } from "@/lib/takeText"
import { offerUndo } from "@/lib/trash"
import {
  applyAppearance,
  readCachedAppearance,
  type Theme,
} from "@/lib/appearance"

type Screen =
  | { name: "loading" }
  | { name: "drafts"; drafts: Draft[] }
  | { name: "setup" }
  // `open`: the take Stop has just saved, opened to listen to.
  | { name: "rehearsal"; open?: number | null }
  // `takeNumber`: the take recording, which Stop opens once it is saved.
  | { name: "recording"; takeName: string; takeGo: number | null; takeNumber: number | null }
  | { name: "history"; folder?: string; song?: string | null }
  | { name: "settings" }

export function App() {
  // Every dialog in the app, once: moving between a dialog's controls with
  // the keyboard is this app's job, not the browser's — the window it runs
  // in on a Mac will not do it. See useDialogFocusKeys.
  useDialogFocusKeys()
  // ⌘Z / Ctrl+Z, once: it runs the newest notice's action from any screen.
  useUndoKey()

  const [screen, setScreen] = useState<Screen>({ name: "loading" })
  const [session, setSession] = useState<SessionState>({ active: false })
  const [startupError, setStartupError] = useState<string | null>(null)
  // Until Python answers we run on whatever index.html already applied.
  const [appearance, setAppearance] = useState(() => readCachedAppearance())

  const changeAppearance = useCallback((theme: Theme, scale: number) => {
    setAppearance({ theme, scale })
    applyAppearance(theme, scale)
    void api().save_appearance(theme, scale)
  }, [])

  // In "match system" mode, follow the OS switching between light and dark.
  useEffect(() => {
    if (appearance.theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyAppearance("system", appearance.scale)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [appearance.theme, appearance.scale])

  const refreshSession = useCallback(async () => {
    const s = await api().session_state()
    setSession(s)
    return s
  }, [])

  // A take Stop could not save: why, and Unsaved takes, where Recover saves
  // it. With none listed, the rehearsal screen.
  // The screen's Stop and the controller watcher both see a save that
  // failed (the screen's Stop is a control command too): one handles it.
  const failing = useRef(false)
  const saveFailed = useCallback(
    async (error: string) => {
      if (failing.current) return
      failing.current = true
      try {
        notify({ key: "save-take", kind: "warning", text: error })
        let drafts: Draft[] = []
        try {
          drafts = await api().list_drafts()
          await refreshSession()
        } catch {
          // Said on the error bar already (api).
        }
        setScreen(drafts.length ? { name: "drafts", drafts } : { name: "rehearsal" })
      } finally {
        failing.current = false
      }
    },
    [refreshSession]
  )

  // External transport changes navigate the same screens as UI commands.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [controlState, setControlState] = useState<ControlState | null>(null)
  const lastRemoteVolume = useRef<number | undefined>(undefined)
  const externalAction = useRef(0)
  const screenRef = useRef(screen)
  screenRef.current = screen
  useEffect(() => {
    let alive = true
    let timer = 0
    const watch = async () => {
      let delay = 1000
      try {
        // The presence check is cheap; a full snapshot also reads the library.
        const controller = await poll("controller_state")
        if (!alive) return
        if (controller.enabled) {
          delay = 300
          const state = await poll("control_state")
          if (alive) {
            setControlState(state)
            if (typeof state.playback_muted === "boolean") heard({ muted: state.playback_muted })
            if (typeof state.master_volume === "number" && state.master_volume !== lastRemoteVolume.current) {
              lastRemoteVolume.current = state.master_volume
              heard({ volume: state.master_volume })
            }
            const current = screenRef.current
            if (typeof state.rehearsal_active === "boolean" && state.rehearsal_active !== sessionRef.current.active) {
              const latest = await refreshSession()
              if (!alive) return
              if (latest.active && ["setup", "history", "settings"].includes(current.name)) setScreen({ name: "rehearsal" })
              else if (!latest.active && (current.name === "rehearsal" || current.name === "recording")) setScreen({ name: "setup" })
            }
            if (state.action_sequence < externalAction.current) externalAction.current = 0
            if (state.events[0] && state.events[0].sequence > externalAction.current + 1) await refreshSession()
            for (const action of state.events) {
              if (action.sequence <= externalAction.current) continue
              externalAction.current = action.sequence
              if (action.ok && ["previous_take", "next_take", "previous_song", "next_song", "remove_take", "select_take", "select_song", "stop_keep", "record_stop"].includes(action.action)) await refreshSession()
              if (alive && action.ok && action.action === "remove_take" && action.undo) {
                offerUndo({ text: "Take removed", token: action.undo, onUndone: refreshSession })
              }
            }
            if (alive && state.state === "recording" && current.name !== "recording" && state.take_number != null) {
              await refreshSession()
              if (alive) setScreen({ name: "recording",
                takeName: state.take_name ?? NO_SONG, takeGo: state.take_go, takeNumber: state.take_number })
            } else if (alive && current.name === "recording" && state.state === "ready") {
              // Stopped from the controller: saved, and open to listen to,
              // as the screen's own Stop leaves it.
              await refreshSession()
              if (alive) setScreen({ name: "rehearsal", open: current.takeNumber })
            } else if (alive && current.name === "recording" && state.state === "error" &&
                       state.events.some(e => e.sequence === state.action_sequence)) {
              await saveFailed(state.error ?? "Could not save the take")
            }
          }
        } else {
          setControlState(null)
          heard({ muted: false })
          lastRemoteVolume.current = undefined
        }
      } catch { /* temporary port/server interruption */ }
      if (alive) timer = window.setTimeout(watch, delay)
    }
    void watch()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [refreshSession, saveFailed])

  // Unsaved takes again, after an Undo brought back one discarded there
  // once the list had closed. Not over a take in hand.
  const reopenDrafts = useCallback(async () => {
    let drafts: Draft[] = []
    try {
      drafts = await api().list_drafts()
    } catch (e) {
      console.error("Could not read drafts:", e)
    }
    if (drafts.length === 0) return
    setScreen((s) => (s.name === "recording" ? s : { name: "drafts", drafts }))
  }, [])

  const connect = useCallback(async () => {
    setStartupError(null)
    setScreen({ name: "loading" })
    try {
      await waitForApi()

      // Whatever went wrong on the way up — a rehearsal's history that
      // could not be read, say — is said once here, the same bar as any
      // other bridge failure, rather than dropped silently.
      try {
        const problems = await api().startup_problems()
        for (const p of problems) {
          reportBridgeError(
            "startup",
            Object.assign(new Error(p.message), { name: p.name })
          )
        }
      } catch (e) {
        console.error("Could not read startup problems:", e)
      }

      // What deleting does differs by system, and a confirmation must not
      // promise a Trash this machine has not got.
      await loadDeletionKind()
      // What a mark can be called is the library's, and every mark drawn
      // anywhere needs it.
      await loadLabels()

      // The source of truth for appearance is the Python config; localStorage
      // was only a fast cache to avoid flashing on startup. Which keys work
      // is kept there too (Settings › Keys).
      try {
        const saved = await api().get_settings()
        const theme = saved.theme ?? "dark"
        const scale = saved.ui_scale ?? 1
        setAppearance({ theme, scale })
        applyAppearance(theme, scale)
        loadKeys(saved)
      } catch (e) {
        console.error("Could not read appearance or keys:", e)
      }

      // The bridge may have survived a page reload mid-rehearsal — in that
      // case go back into it rather than to the setup screen.
      const s = await api().session_state()
      setSession(s)

      // Unsaved takes come first: ignoring them silently is how a rehearsal
      // gets lost.
      let drafts: Draft[] = []
      try {
        drafts = await api().list_drafts()
      } catch (e) {
        console.error("Could not read drafts:", e)
      }

      if (drafts.length > 0) setScreen({ name: "drafts", drafts })
      else setScreen(s.active ? { name: "rehearsal" } : { name: "setup" })
    } catch (e) {
      setStartupError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void connect()
  }, [connect])

  if (startupError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <TriangleAlert className="size-10 text-destructive" />
        <div>
          <h1 className="text-base font-semibold">
            Could not reach the audio engine
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {startupError}
          </p>
        </div>
        <Button onClick={() => void connect()}>
          <RotateCcw />
          Try again
        </Button>
      </div>
    )
  }

  if (screen.name === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 text-muted-foreground">
        <img src="./logo.svg" alt="" className="size-16" />
        <div className="flex items-center gap-3">
          {/* The words at once, the spinner after a second (B5). */}
          <Spinner className="size-5" />
          <span className="text-sm">Connecting to the audio engine…</span>
        </div>
      </div>
    )
  }

  if (screen.name === "drafts") {
    return (
      // Keyed by the takes it lists: the list opened again by an Undo starts
      // from what is on disk now.
      <DraftsScreen
        key={screen.drafts.map((d) => d.dir).join("\n")}
        drafts={screen.drafts}
        onDone={async () => {
          const s = await refreshSession()
          setScreen(s.active ? { name: "rehearsal" } : { name: "setup" })
        }}
        onReopen={() => void reopenDrafts()}
      />
    )
  }

  const setupScreen = (
    <Setup
      onStarted={async () => {
        await refreshSession()
        setScreen({ name: "rehearsal" })
      }}
      onOpenHistory={() => setScreen({ name: "history" })}
      onOpenRehearsal={(folder) => setScreen({ name: "history", folder })}
      onOpenSong={(song) => setScreen({ name: "history", song })}
      onOpenSettings={() => setScreen({ name: "settings" })}
    />
  )

  if (screen.name === "setup") return setupScreen

  if (screen.name === "history") {
    return (
      <HistoryScreen
        initialFolder={screen.folder}
        initialSong={screen.song}
        onBack={() => setScreen({ name: "setup" })}
      />
    )
  }

  if (screen.name === "settings") {
    return (
      <Settings
        onBack={() => setScreen({ name: "setup" })}
        theme={appearance.theme}
        scale={appearance.scale}
        onAppearanceChange={changeAppearance}
      />
    )
  }

  // Guard against drift: no rehearsal, but the screen needs its data.
  if (!session.active) return setupScreen

  if (screen.name === "rehearsal") {
    return (
      <Rehearsal
        session={session}
        controlState={controlState}
        openTake={screen.open ?? null}
        onStartTake={(takeName, takeGo, takeNumber) =>
          setScreen({ name: "recording", takeName, takeGo, takeNumber })
        }
        // Straight to the start screen: its Last time is the evening just
        // finished, and bands mostly close the app instead anyway.
        onFinished={() => setScreen({ name: "setup" })}
        onChanged={refreshSession}
      />
    )
  }

  const recording = screen
  return (
    <Recording
      takeName={recording.takeName}
      takeGo={recording.takeGo}
      tracks={session.tracks}
      lastAttempt={session.last_attempt}
      // Stop saved the take: the rehearsal screen opens it, paused, to
      // listen to.
      onStopped={async (take) => {
        try {
          await refreshSession()
        } catch {
          // Said on the error bar already (api); the screen moves on all the same.
        }
        setScreen({ name: "rehearsal", open: take?.take_number ?? recording.takeNumber })
      }}
      onSaveFailed={saveFailed}
    />
  )
}
