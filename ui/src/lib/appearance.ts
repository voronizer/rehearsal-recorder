/**
 * Theme and interface scale.
 *
 * Stored in two places on purpose: the real home is the config on the Python
 * side (it sits with the other settings and survives a reinstall of the
 * interface), while the copy in localStorage exists so the theme can be
 * applied before the first paint. The bridge to Python is not ready
 * instantly, and without the copy the window would flash dark for a moment
 * for someone who chose the light theme.
 */

export type Theme = "dark" | "light" | "system"

export const DEFAULT_THEME: Theme = "dark"
export const DEFAULT_SCALE = 1

/** Base font size: Tailwind derives every rem size from it. */
const BASE_FONT_PX = 16

export const SCALE_OPTIONS = [0.9, 1, 1.15, 1.3, 1.5]

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  system: "Match system",
}

const THEME_KEY = "rr-theme"
const SCALE_KEY = "rr-scale"

export function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
}

export function applyAppearance(theme: Theme, scale: number): void {
  const root = document.documentElement
  const dark = theme === "system" ? prefersDark() : theme === "dark"
  root.classList.toggle("dark", dark)
  root.style.fontSize = `${BASE_FONT_PX * scale}px`

  try {
    localStorage.setItem(THEME_KEY, theme)
    localStorage.setItem(SCALE_KEY, String(scale))
  } catch {
    // Private mode or blocked storage — not a problem, the theme will just
    // be applied a moment later, once Python answers.
  }
}

export function readCachedAppearance(): { theme: Theme; scale: number } {
  let theme: Theme = DEFAULT_THEME
  let scale = DEFAULT_SCALE
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === "dark" || t === "light" || t === "system") theme = t
    const s = Number(localStorage.getItem(SCALE_KEY))
    if (Number.isFinite(s) && s > 0) scale = s
  } catch {
    /* see above */
  }
  return { theme, scale }
}
