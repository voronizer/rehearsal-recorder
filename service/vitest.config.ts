import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Two kinds of test. The Worker's run inside the Workers runtime, on the
// `test` environment of wrangler.jsonc, with every migration applied to a
// fresh database before each test (test/apply-migrations.ts). The pages'
// own logic, such as finding an MP3's frames, runs in Node.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations")
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/**/*.test.ts"],
            setupFiles: ["./test/apply-migrations.ts"],
          },
        },
        { test: { name: "pages", include: ["src/**/*.test.ts"], environment: "node" } },
      ],
    },
  }
})
