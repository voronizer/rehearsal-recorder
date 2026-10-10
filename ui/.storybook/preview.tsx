import type { Preview } from "@storybook/react-vite"
import { setSystem, type System } from "../src/lib/platform.ts"
import "../src/index.css"

// Two switches in the toolbar. The theme is the app's own: a .dark class on
// <html>. The system is told to lib/platform, so the words and keys a
// component shows (⌘ or Ctrl, Finder or Explorer) change with it.
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: ["dark", "light"],
        dynamicTitle: true,
      },
    },
    system: {
      description: "System",
      toolbar: {
        title: "System",
        icon: "browser",
        items: ["mac", "windows"],
        dynamicTitle: true,
      },
    },
  },
  // Dark is where the app starts (index.html).
  initialGlobals: { theme: "dark", system: "mac" },
  decorators: [
    (Story, { globals }) => {
      document.documentElement.classList.toggle("dark", globals.theme === "dark")
      setSystem(globals.system as System)
      return <Story />
    },
  ],
}

export default preview
