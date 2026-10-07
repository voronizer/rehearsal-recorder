import { useEffect, useState } from "react"
import { api } from "@/lib/api"

/** What sorting an evening goes by, from Settings. */
export type EveningSettings = { falseStartSec: number; cloudDir: string | null }

// The last read, so a screen mounted again (the rehearsal screen, after
// every take) draws its false starts and buttons at once rather than a
// moment later, the overview shifting under them.
let known: EveningSettings | null = null
const screens = new Set<(s: EveningSettings) => void>()

/** Reads them again, for every screen showing them. */
export function reloadEveningSettings(): Promise<void> {
  return api()
    .get_settings()
    .then((s) => {
      known = { falseStartSec: s.false_start_sec ?? 30, cloudDir: s.cloud_dir }
      for (const show of screens) show(known)
    })
    // Without them the overview draws no false starts and no buttons.
    .catch(() => {})
}

/**
 * The false-start limit and the cloud folder, read from Settings when the
 * screen opens. The limit changes only on the Settings page, which no screen
 * using it is open over; the cloud folder can also be chosen from a take's
 * cloud button, which reads them again. Null until the first read.
 */
export function useEveningSettings(): EveningSettings | null {
  const [settings, setSettings] = useState(known)
  useEffect(() => {
    screens.add(setSettings)
    void reloadEveningSettings()
    return () => {
      screens.delete(setSettings)
    }
  }, [])
  return settings
}
