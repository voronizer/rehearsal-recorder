import { useEffect, useState } from "react"
import { api } from "@/lib/api"

/** What sorting an evening goes by, from Settings. */
export type EveningSettings = { falseStartSec: number; cloudDir: string | null }

// The last read, so a screen mounted again (the rehearsal screen, after
// every take) draws its false starts and buttons at once rather than a
// moment later, the overview shifting under them.
let known: EveningSettings | null = null

/**
 * The false-start limit and the cloud folder, read from Settings when the
 * screen opens: both change only on the Settings page, which no screen
 * using them is open over. Null until the first read.
 */
export function useEveningSettings(): EveningSettings | null {
  const [settings, setSettings] = useState(known)
  useEffect(() => {
    let current = true
    api()
      .get_settings()
      .then((s) => {
        known = { falseStartSec: s.false_start_sec ?? 30, cloudDir: s.cloud_dir }
        if (current) setSettings(known)
      })
      // Without them the overview draws no false starts and no buttons.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [])
  return settings
}
