/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The release's tag, in a release's build; unset in a pull request's. */
  readonly VITE_SITE_VERSION?: string
}

/** CHANGELOG.md's section for the version the page is for: see vite.config.ts. */
declare module "virtual:changelog" {
  const text: string
  export default text
}
