// deploy.mjs without Cloudflare: a stand-in `wrangler` and `npm` on PATH
// write down what they were asked and answer from a small file of what the
// account has. Each test runs the script in a copy of the real wrangler.jsonc.
//
//   node --test scripts/deploy.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readConfig } from "./deploy.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const script = join(here, "deploy.mjs")
const realConfig = join(here, "..", "wrangler.jsonc")

// The account, as the stand-in keeps it: databases with their ids, and the
// names of the buckets and queues. A create adds to it.
const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs")
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"))
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_LOG, "wrangler " + args.join(" ") + "\\n")
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state))
const [a, b, c, d] = args
if (a === "d1" && b === "list") {
  // As Wrangler does: a warning before the list.
  console.log("▲ [WARNING] Proxy environment variables detected.")
  console.log(JSON.stringify(state.d1))
} else if (a === "d1" && b === "create") {
  state.d1.push({ uuid: "made-" + c, name: c })
  save()
} else if (a === "r2" && b === "bucket" && c === "info") {
  if (!state.buckets.includes(d)) { console.error("The specified bucket does not exist."); process.exit(1) }
} else if (a === "r2" && b === "bucket" && c === "create") {
  state.buckets.push(d)
  save()
} else if (a === "queues" && b === "info") {
  if (!state.queues.includes(c)) { console.error("Queue not found"); process.exit(1) }
} else if (a === "queues" && b === "create") {
  state.queues.push(c)
  save()
}
`

const NPM = `#!/usr/bin/env node
require("node:fs").appendFileSync(process.env.FAKE_LOG, "npm " + process.argv.slice(2).join(" ") + "\\n")
`

/** Runs deploy.mjs against an account that has `has`, with `env` on top of
 *  a token and an account id. Returns what was asked, in order, and the
 *  config as the script left it. */
function deploy(has, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-"))
  const bin = join(dir, "bin")
  execFileSync("mkdir", [bin])
  writeFileSync(join(bin, "wrangler"), STAND_IN)
  writeFileSync(join(bin, "npm"), NPM)
  chmodSync(join(bin, "wrangler"), 0o755)
  chmodSync(join(bin, "npm"), 0o755)
  copyFileSync(realConfig, join(dir, "wrangler.jsonc"))
  const state = join(dir, "state.json")
  writeFileSync(state, JSON.stringify({ d1: [], buckets: [], queues: [], ...has }))
  const log = join(dir, "log")
  writeFileSync(log, "")
  const out = execFileSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_STATE: state,
      FAKE_LOG: log,
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      ...env,
    },
  })
  return {
    out,
    asked: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
    config: readConfig(readFileSync(join(dir, "wrangler.jsonc"), "utf8")),
  }
}

const ALL_THERE = {
  d1: [{ uuid: "1111-db", name: "reha-band" }, { uuid: "2222-other", name: "other" }],
  buckets: ["reha-band"],
  queues: ["reha-band-chat"],
}

test("the database id and the domain go into the config", () => {
  const { asked, config } = deploy(ALL_THERE, { SERVICE_DOMAIN: "band.reha.stream" })
  assert.equal(config.d1_databases[0].database_id, "1111-db")
  assert.deepEqual(config.routes, [{ pattern: "band.reha.stream", custom_domain: true }])
  assert.equal(config.workers_dev, false)
  // The test environment's database stays the local one.
  assert.equal(config.env.test.d1_databases[0].database_id, "local")
  assert.deepEqual(asked.slice(-3), [
    "npm run build",
    "wrangler d1 migrations apply reha-band --remote --config wrangler.jsonc",
    "wrangler deploy",
  ])
  assert.ok(!asked.some((line) => line.includes(" create ")))
})

test("no domain keeps workers.dev only", () => {
  const { config } = deploy(ALL_THERE, { SERVICE_DOMAIN: "" })
  assert.equal(config.routes, undefined)
  assert.equal(config.workers_dev, true)
  assert.equal(config.d1_databases[0].database_id, "1111-db")
})

test("a missing database, bucket or queue is made first", () => {
  const { asked, config } = deploy({})
  for (const made of [
    "wrangler d1 create reha-band",
    "wrangler r2 bucket create reha-band",
    "wrangler queues create reha-band-chat",
  ])
    assert.ok(asked.indexOf(made) >= 0 && asked.indexOf(made) < asked.indexOf("npm run build"), made)
  assert.equal(config.d1_databases[0].database_id, "made-reha-band")
})

test("no token: a notice and no deploy", () => {
  const { out, asked, config } = deploy(ALL_THERE, { CLOUDFLARE_API_TOKEN: "" })
  assert.match(out, /^::notice::/m)
  assert.deepEqual(asked, [])
  assert.equal(config.d1_databases[0].database_id, "local")
})

test("an address given as a link stops the deploy, with an example of one's own", () => {
  let failed
  try {
    deploy(ALL_THERE, { SERVICE_DOMAIN: "https://band.example.com/" })
  } catch (e) {
    failed = e
  }
  assert.equal(failed?.status, 1)
  assert.match(failed.stdout, /::error::SERVICE_DOMAIN should be an address alone, like band\.example\.com, not https/)
})
