/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The release's tag, in a release's build; unset in a pull request's. */
  readonly VITE_SITE_VERSION?: string
  /** The site's token in Cloudflare Web Analytics; unset, nothing is counted. */
  readonly VITE_WEB_ANALYTICS_TOKEN?: string
}

/** CHANGELOG.md's section for the version the page is for: see vite.config.ts. */
declare module "virtual:changelog" {
  const text: string
  export default text
}

/** What the main page's block shows of Alex's stories: see vite.config.ts. */
declare module "virtual:stories-block" {
  const block: import("./content/stories").StoriesBlockContent
  export default block
}
