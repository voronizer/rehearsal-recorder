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
  // So the react-docgen-typescript plugin never loads. package.json still
  // sets it to 0.9.1 under "overrides": 0.7.0, the one this Storybook asks
  // for, brings in glob 13 and minimatch 10, which Dependabot flags. Drop the
  // override once Storybook asks for 0.9 or later.
  typescript: { reactDocgen: "react-docgen" },
  core: { disableTelemetry: true },
}

export default config
