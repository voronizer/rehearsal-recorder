import { useCallback, useEffect, useState } from "react"
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Setup } from "@/screens/Setup"
import { Rehearsal } from "@/screens/Rehearsal"
import { Recording } from "@/screens/Recording"
import { Review } from "@/screens/Review"
import { HistoryScreen } from "@/screens/HistoryScreen"
import { DraftsScreen } from "@/screens/DraftsScreen"
import { Settings } from "@/screens/Settings"
import { Finished } from "@/screens/Finished"
import {
  api,
  waitForApi,
  type Draft,
  type PendingTake,
  type SessionState,
} from "@/lib/api"
import { loadDeletionKind } from "@/lib/deletion"
import {
  applyAppearance,
  readCachedAppearance,
  type Theme,
} from "@/lib/appearance"

type Screen =
  | { name: "loading" }
  | { name: "drafts"; drafts: Draft[] }
  | { name: "setup" }
  | { name: "rehearsal" }
  | { name: "recording"; takeNumber: number; takeName: string }
  | { name: "review"; take: PendingTake }
  | { name: "history" }
  | { name: "settings" }
  | { name: "finished"; folder: string; takeCount: number }

export function App() {
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

  const connect = useCallback(async () => {
    setStartupError(null)
    setScreen({ name: "loading" })
    try {
      await waitForApi()

      // What deleting does differs by system, and a confirmation must not
      // promise a Trash this machine has not got.
      await loadDeletionKind()

      // The source of truth for appearance is the Python config; localStorage
      // was only a fast cache to avoid flashing on startup.
      try {
        const saved = await api().get_settings()
        const theme = saved.theme ?? "dark"
        const scale = saved.ui_scale ?? 1
        setAppearance({ theme, scale })
        applyAppearance(theme, scale)
      } catch (e) {
        console.error("Could not read appearance:", e)
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
      <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Connecting to the audio engine…</span>
      </div>
    )
  }

  if (screen.name === "drafts") {
    return (
      <DraftsScreen
        drafts={screen.drafts}
        onDone={async () => {
          const s = await refreshSession()
          setScreen(s.active ? { name: "rehearsal" } : { name: "setup" })
        }}
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
      onOpenSettings={() => setScreen({ name: "settings" })}
    />
  )

  if (screen.name === "setup") return setupScreen

  if (screen.name === "history") {
    return <HistoryScreen onBack={() => setScreen({ name: "setup" })} />
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

  if (screen.name === "finished") {
    return (
      <Finished
        folder={screen.folder}
        takeCount={screen.takeCount}
        onNewRehearsal={() => setScreen({ name: "setup" })}
        onOpenHistory={() => setScreen({ name: "history" })}
      />
    )
  }

  // Guard against drift: no rehearsal, but the screen needs its data.
  if (!session.active) return setupScreen

  if (screen.name === "rehearsal") {
    return (
      <Rehearsal
        session={session}
        onStartTake={(takeNumber, takeName) =>
          setScreen({ name: "recording", takeNumber, takeName })
        }
        onFinished={(folder, takeCount) =>
          setScreen({ name: "finished", folder, takeCount })
        }
        onChanged={() => void refreshSession()}
      />
    )
  }

  if (screen.name === "recording") {
    return (
      <Recording
        takeNumber={screen.takeNumber}
        takeName={screen.takeName}
        tracks={session.tracks}
        onStopped={(take) => setScreen({ name: "review", take })}
      />
    )
  }

  return (
    <Review
      take={screen.take}
      rehearsalName={session.name}
      onKept={async () => {
        await refreshSession()
        setScreen({ name: "rehearsal" })
      }}
      onDiscarded={async () => {
        await refreshSession()
        setScreen({ name: "rehearsal" })
      }}
      onCropped={(take) => setScreen({ name: "review", take })}
    />
  )
}
