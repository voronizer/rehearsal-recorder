import { useEffect, useRef, useState } from "react"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { driftToleranceChanged } from "@/hooks/useTakeDrift"
import {
  api,
  type ClickSound,
  type MetronomeSettings,
  type OutputDevice,
  type Settings,
} from "@/lib/api"
import type { DriftTolerance } from "@/lib/drift"
import { dismiss, notify } from "@/lib/notices"

/** The notice the click's settings say a refusal in. */
const SAID = "click-settings"

/** How long the volume waits after a key press before it is saved and its
 *  bar plays, in ms: the arrows step it, and the bar is for where they
 *  stop. Let go by the pointer, it plays at once. */
const VOLUME_SETTLE_MS = 400

type Answer = { ok: boolean; error?: string; warning?: string }

/**
 * The metronome's four settings as Python keeps them (spec Part 6): where
 * the click is heard, how loud, its sound and the count-in. Each change is
 * saved at once; picking a sound plays a bar of it, and so does letting go
 * of the volume.
 *
 * Until an output of its own is picked, the click goes where the player
 * plays, and its outputs are shown as the ones it uses. Picking outputs
 * then saves that device as the click's first, so what is shown is always
 * what is used. A saved output that is not plugged in keeps its place,
 * under its own name, with its outputs not to be picked: the click never
 * seems to be on the player's device while Python is waiting for its own,
 * and the player's device is never saved over it. Python gives no index for
 * such a device and names it in the settings' `click_device_missing`: an
 * output that is there and will not play is not unplugged, and an output
 * that is not saved is not either.
 */
export function useClickSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  // The volume while it moves, and one waiting to be saved.
  const [sliding, setSliding] = useState<number | null>(null)
  const pending = useRef<number | null>(null)
  const settle = useRef(0)
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
      // A volume still waiting when the settings close is kept, unheard.
      window.clearTimeout(settle.current)
      if (pending.current !== null) void api().set_metronome_setting("click_volume", pending.current)
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
  const save = async <K extends "click_sound" | "click_volume" | "count_in_bars" | "tempo_in_wav" | "drift_tolerance">(
    key: K,
    value: MetronomeSettings[K]
  ) => {
    setSettings((s) => s && { ...s, [key]: value })
    const ok = said(await api().set_metronome_setting(key, value), "Could not save the setting")
    if (!ok) await reread()
    return ok
  }

  const saved = settings?.click_device_index ?? null
  const own = outputs.find((d) => d.index === saved)
  // Saved and not plugged in: named by Python, with no index, or an index
  // the list does not have. One that is there is shown as itself.
  const missingName = settings?.click_device_missing ?? null
  const missing = settings !== null && (missingName !== null || (saved !== null && !own))
  const player = settings?.output_device_index ?? null
  // The device the click plays through now: its own, or the player's.
  const card = missing ? undefined : saved !== null ? own : outputs.find((d) => d.index === player)

  return {
    settings,
    /** The outputs there are. One the click cannot play through (another
     *  ASIO card while one records) says why in `click_unavailable`, and is
     *  listed with its reason, not to be picked. */
    outputs,
    /** The click's own device; null while it goes where the player plays,
     *  and while its own is not plugged in. */
    device: missing ? null : saved,
    /** The saved device when it is not plugged in: its name, if Python
     *  has it, or "" without one. Null while it is there, or none is saved. */
    missing: missing ? (missingName ?? "") : null,
    /** The device the click plays through now, and its outputs in use:
     *  a missing device's as saved. */
    card,
    channels:
      (missing || saved !== null ? settings?.click_channels : settings?.output_channels) ?? [1, 2],
    volume: sliding ?? settings?.click_volume ?? null,
    setDevice: async (index: number | null) => {
      if (said(await api().set_click_device(index), "Could not switch the click's output"))
        await reread()
    },
    setChannels: async (channels: number[]) => {
      // Not while its own device is missing: that stays saved.
      if (missing) return
      // Picked while the click follows the player: the player's device
      // becomes the click's own first, or the outputs would not be used.
      if (saved === null) {
        if (player === null) return
        if (!said(await api().set_click_device(player), "Could not switch the click's output")) return
      }
      said(await api().set_click_channels(channels), "Could not switch the click's outputs")
      await reread()
    },
    setSound: async (sound: ClickSound) => {
      if (await save("click_sound", sound)) void api().metronome_preview(sound)
    },
    slideVolume: setSliding,
    /** The volume let go of: saved, and a bar plays at it. `byKeys` waits
     *  for the keys to stop first. */
    setVolume: (volume: number, byKeys: boolean) => {
      window.clearTimeout(settle.current)
      pending.current = volume
      setSliding(volume)
      const done = async () => {
        pending.current = null
        setSliding(null)
        if (await save("click_volume", volume)) void api().metronome_preview()
      }
      if (byKeys) settle.current = window.setTimeout(() => void done(), VOLUME_SETTLE_MS)
      else void done()
    },
    setCountIn: (bars: MetronomeSettings["count_in_bars"]) => void save("count_in_bars", bars),
    /** Whether a click take's WAVs carry its tempo; Settings › Click & backing track
     *  only. */
    setTempoInWav: (on: boolean) => void save("tempo_in_wav", on),
    /** How far off two bars of the drift line on Master turn amber, said
     *  to every player at once; Settings › Click & backing track only. */
    setDriftTolerance: async (tolerance: DriftTolerance) => {
      if (await save("drift_tolerance", tolerance)) driftToleranceChanged(tolerance)
    },
  }
}

export type ClickSettingsValue = ReturnType<typeof useClickSettings>
