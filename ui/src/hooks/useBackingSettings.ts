import { useEffect, useState } from "react"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { api, type OutputDevice, type Settings } from "@/lib/api"
import { dismiss, notify } from "@/lib/notices"

/** The notice the backing track's settings say a refusal in. */
const SAID = "backing-settings"

type Answer = { ok: boolean; error?: string; warning?: string }

/**
 * Where a song's backing track is heard and how loud, as Python keeps them
 * (backing-track spec Part 8), one for every song. Picking an output plays
 * two seconds of a backing track there, so the band hears where it went.
 *
 * As the click's output (useClickSettings): until one of its own is picked
 * it plays where the player plays, and the outputs shown are the player's.
 * Picking outputs then saves that device as its own first. A saved output
 * that is not plugged in keeps its place under its own name, its outputs
 * not to be picked, and is never saved over.
 */
export function useBackingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  useNoticesGoWithPage(SAID)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [read, devices] = await Promise.all([api().get_settings(), api().list_output_devices()])
        if (!alive) return
        setSettings(read)
        setOutputs(devices)
      } catch {
        /* the bar across the top has said why */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const reread = async () => {
    try {
      setSettings(await api().get_settings())
    } catch {
      /* said in the bar */
    }
  }
  /** Says a refusal or a warning, and whether it was done. */
  const said = (res: Answer, fallback: string) => {
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? fallback })
      return false
    }
    if (res.warning) notify({ key: SAID, kind: "warning", text: res.warning })
    else dismiss(SAID)
    return true
  }
  /** Two seconds of it where it is heard now. Nothing to say when no song
   *  has one yet: the output is saved all the same. */
  const hear = () => void api().backing_preview()

  const saved = settings?.backing_device_index ?? null
  const own = outputs.find((d) => d.index === saved)
  const missingName = settings?.backing_device_missing ?? null
  const missing = settings !== null && (missingName !== null || (saved !== null && !own))
  const player = settings?.output_device_index ?? null
  // The device it plays through now: its own, or the player's.
  const card = missing ? undefined : saved !== null ? own : outputs.find((d) => d.index === player)
  const channels =
    (missing || saved !== null ? settings?.backing_channels : settings?.output_channels) ?? [1, 2]

  return {
    settings,
    /** The outputs there are; one it cannot play through says why in
     *  `backing_unavailable`. */
    outputs,
    /** Its own device; null while it plays where the player plays, and
     *  while its own is not plugged in. */
    device: missing ? null : saved,
    /** The saved device when it is not plugged in: its name, or "" without
     *  one. Null while it is there, or none is saved. */
    missing: missing ? (missingName ?? "") : null,
    card,
    channels,
    volume: settings?.backing_volume ?? null,
    setDevice: async (index: number | null) => {
      if (said(await api().set_backing_device(index), "Could not switch the backing track's output")) {
        await reread()
        hear()
      }
    },
    setChannels: async (next: number[]) => {
      if (missing) return
      // Picked while it plays where the player plays: the player's device
      // becomes its own first, or the outputs would not be used.
      if (saved === null) {
        if (player === null) return
        if (!said(await api().set_backing_device(player), "Could not switch the backing track's output")) return
      }
      const ok = said(await api().set_backing_channels(next), "Could not switch the backing track's outputs")
      await reread()
      if (ok) hear()
    },
    /** The volume let go of (BackingVolume waits for the keys), saved. */
    setVolume: async (volume: number) => {
      setSettings((s) => s && { ...s, backing_volume: volume })
      if (!said(await api().set_backing_setting("backing_volume", volume), "Could not save the setting"))
        await reread()
    },
  }
}

export type BackingSettingsValue = ReturnType<typeof useBackingSettings>
