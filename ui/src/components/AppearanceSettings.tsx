import { SettingsGroup } from "@/components/SettingsGroup"
import { PickRow } from "@/components/ui/pick-row"
import { SCALE_OPTIONS, THEME_LABELS, type Theme } from "@/lib/appearance"

const THEMES: Theme[] = ["dark", "light", "system"]

/**
 * Settings › Appearance: the theme and how big everything is. Each applies
 * as it is picked, and Python keeps it for the next launch (App's
 * changeAppearance). One group, with no title of its own: the tab's head
 * names it.
 */
export function AppearanceSettings({
  theme,
  scale,
  onChange,
}: {
  theme: Theme
  scale: number
  onChange: (theme: Theme, scale: number) => void
}) {
  // A scale read back from the config can be a hair off its option.
  const chosen = SCALE_OPTIONS.find((s) => Math.abs(scale - s) < 0.001) ?? scale
  return (
    <SettingsGroup rise={1}>
      <PickRow
        label="Theme"
        value={theme}
        options={THEMES.map((t) => ({ value: t, label: THEME_LABELS[t] }))}
        onChange={(t) => onChange(t, scale)}
      />
      <PickRow
        label="Scale"
        value={chosen}
        options={SCALE_OPTIONS.map((s) => {
          const percent = Math.round(s * 100)
          return {
            value: s,
            label: <span className="tnum">{percent}%</span>,
            name: `Scale ${percent} percent`,
          }
        })}
        onChange={(s) => onChange(theme, s)}
      />
    </SettingsGroup>
  )
}
