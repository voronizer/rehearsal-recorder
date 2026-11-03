/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The latest release's tag; unset in a local build, or where there is
   *  no release, and the newest version in CHANGELOG.md stands in. */
  readonly VITE_SITE_VERSION?: string
  /** 1: the blocks that wait for a newer version are in too. */
  readonly VITE_SITE_ALL_BLOCKS?: string
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
