import type { StorybookConfig } from "@storybook/react-vite"

// The showcase: every shared component, on its own, in both themes and both
// systems. It reads vite.config.ts by itself, so the "@" alias, Tailwind and
// React are the app's.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [],
  framework: { name: "@storybook/react-vite", options: {} },
  // Not "react-docgen-typescript": TypeScript 7 has no compiler API for it
  // to call. "react-docgen" reads the source itself.
  typescript: { reactDocgen: "react-docgen" },
  core: { disableTelemetry: true },
}

export default config
