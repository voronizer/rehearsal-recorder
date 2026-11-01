// What the tests' Worker gets on top of wrangler.jsonc: the migrations,
// read in Node by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]
  }
}
