// deploy.mjs without Cloudflare: a stand-in `wrangler` on PATH writes down
// what it was asked and answers from a small file of what the account has.
// Each test runs the script in a folder of its own, with a build's
// wrangler.json made from the real wrangler.jsonc.
//
//   node --test scripts/deploy.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILT } from "./deploy.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const script = join(here, "deploy.mjs")

/** wrangler.jsonc read as JSON: its comments left out, strings kept whole. */
function readJsonc(text) {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++
      out += text.slice(start, i + 1)
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else {
      out += ch
    }
  }
  return JSON.parse(out)
}

// The build's wrangler.json is wrangler.jsonc's top level, as vite build
// writes it (with more keys this script leaves alone).
const { env: _environments, ...topLevel } = readJsonc(readFileSync(join(here, "..", "wrangler.jsonc"), "utf8"))

// The account, as the stand-in keeps it: databases with their ids, the
// names of the buckets and queues, the Worker's secrets (none: no Worker
// yet), and what it refuses. A create adds to it. A deploy keeps the
// settings file's names and values, as the script left the file.
const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs")
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"))
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_LOG, "wrangler " + args.join(" ") + "\\n")
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state))
const refuse = (what) => { if (state.refuses.includes(what)) { console.error("Authentication error [code: 10000]"); process.exit(1) } }
const [a, b, c, d] = args
if (a === "d1" && b === "list") {
  refuse("d1")
  // As Wrangler does: a warning before the list.
  console.log("▲ [WARNING] Proxy environment variables detected.")
  console.log(JSON.stringify(state.d1))
} else if (a === "d1" && b === "create") {
  state.d1.push({ uuid: "made-" + c, name: c })
  save()
} else if (a === "r2" && b === "bucket" && c === "info") {
  if (!state.buckets.includes(d)) { console.error("The specified bucket does not exist."); process.exit(1) }
} else if (a === "r2" && b === "bucket" && c === "create") {
  refuse("r2")
  state.buckets.push(d)
  save()
} else if (a === "queues" && b === "info") {
  if (!state.queues.includes(c)) { console.error("Queue not found"); process.exit(1) }
} else if (a === "queues" && b === "create") {
  refuse("queues")
  state.queues.push(c)
  save()
} else if (a === "secret" && b === "list") {
  refuse("secrets")
  if (state.secrets === null) {
    console.error('✘ [ERROR] Worker "reha-band" not found.\\n\\nIf this is a new Worker, run \`wrangler deploy\` first to create it.')
    process.exit(1)
  }
  console.log("▲ [WARNING] Proxy environment variables detected.")
  console.log(JSON.stringify(state.secrets.map((name) => ({ name, type: "secret_text" })), null, "  "))
} else if (a === "deploy") {
  const i = args.indexOf("--secrets-file")
  state.sent = i < 0 ? null : JSON.parse(fs.readFileSync(args[i + 1], "utf8"))
  state.mode = i < 0 ? null : (fs.statSync(args[i + 1]).mode & 0o777).toString(8)
  state.config = JSON.parse(fs.readFileSync(args[args.indexOf("--config") + 1], "utf8"))
  save()
}
`

/** Runs deploy.mjs against an account that has `has`, with `env` on top of
 *  a token and an account id. Returns what was asked, in order, what
 *  went up with the Worker, and what it printed. */
function deploy(has, env = {}, { built = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-"))
  const bin = join(dir, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "wrangler"), STAND_IN)
  chmodSync(join(bin, "wrangler"), 0o755)
  if (built) {
    mkdirSync(join(dir, "dist", "reha_band"), { recursive: true })
    writeFileSync(join(dir, BUILT), JSON.stringify(topLevel))
  }
  const state = join(dir, "state.json")
  writeFileSync(state, JSON.stringify({ d1: [], buckets: [], queues: [], secrets: null, refuses: [], ...has }))
  const log = join(dir, "log")
  writeFileSync(log, "")
  const run = (extra) =>
    execFileSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_STATE: state,
        FAKE_LOG: log,
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "account",
        ...extra,
      },
    })
  let out
  let failed = null
  try {
    out = run(env)
  } catch (e) {
    failed = e
    out = e.stdout
  }
  const after = JSON.parse(readFileSync(state, "utf8"))
  return {
    out,
    failed,
    asked: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
    sent: after.sent,
    mode: after.mode,
    config: after.config,
  }
}

const ALL_THERE = {
  d1: [{ uuid: "1111-db", name: "reha-band" }, { uuid: "2222-other", name: "other" }],
  buckets: ["reha-band"],
  queues: ["reha-band-chat"],
  secrets: ["BETTER_AUTH_SECRET", "OWNER_EMAIL", "LETTERS_FROM"],
}

test("the database id and the domain go into the build's config", () => {
  const { asked, config } = deploy(ALL_THERE, { SERVICE_DOMAIN: "band.reha.stream" })
  assert.equal(config.d1_databases[0].database_id, "1111-db")
  assert.deepEqual(config.routes, [{ pattern: "band.reha.stream", custom_domain: true }])
  assert.equal(config.workers_dev, false)
  assert.equal(asked.at(-2), `wrangler d1 migrations apply reha-band --remote --config ${BUILT}`)
  assert.ok(asked.at(-1).startsWith(`wrangler deploy --config ${BUILT} --secrets-file `), asked.at(-1))
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
  const migrations = asked.findIndex((line) => line.includes("migrations apply"))
  for (const made of [
    "wrangler d1 create reha-band",
    "wrangler r2 bucket create reha-band",
    "wrangler queues create reha-band-chat",
  ])
    assert.ok(asked.indexOf(made) >= 0 && asked.indexOf(made) < migrations, made)
  assert.equal(config.d1_databases[0].database_id, "made-reha-band")
})

test("the repository's settings go up with the Worker, in a file only its user reads", () => {
  const { sent, mode, out } = deploy(ALL_THERE, {
    OWNER_EMAIL: " alex@example.com ",
    LETTERS_FROM: "band@example.com",
    CF_ADDRESSES_TOKEN: "second-token",
    TELEGRAM_BOT_TOKEN: "123:bot",
    TELEGRAM_CHAT_ID: "-1002003004005",
    OWNER_TELEGRAM_ID: "42",
  })
  assert.deepEqual(sent, {
    OWNER_EMAIL: "alex@example.com",
    LETTERS_FROM: "band@example.com",
    CF_ACCOUNT_ID: "account",
    CF_ADDRESSES_TOKEN: "second-token",
    TELEGRAM_BOT_TOKEN: "123:bot",
    TELEGRAM_CHAT_ID: "-1002003004005",
    OWNER_TELEGRAM_ID: "42",
  })
  assert.equal(mode, "600")
  // Names only: a value never reaches the log.
  assert.match(out, /Settings going up with the Worker: OWNER_EMAIL, LETTERS_FROM, CF_ACCOUNT_ID, CF_ADDRESSES_TOKEN/)
  assert.doesNotMatch(out, /second-token|123:bot|alex@example\.com/)
})

test("settings the repository lacks stay as the Worker has them", () => {
  const { sent, asked } = deploy(ALL_THERE, { CLOUDFLARE_ACCOUNT_ID: "", OWNER_EMAIL: "", TELEGRAM_CHAT_ID: "  " })
  assert.equal(sent, null)
  assert.equal(asked.at(-1), `wrangler deploy --config ${BUILT}`)
})

test("a new Worker gets a BETTER_AUTH_SECRET; one it has is never replaced", () => {
  const first = deploy({ ...ALL_THERE, secrets: null })
  assert.match(first.sent.BETTER_AUTH_SECRET, /^[0-9a-f]{40}$/)
  assert.doesNotMatch(first.out, new RegExp(first.sent.BETTER_AUTH_SECRET))
  const without = deploy({ ...ALL_THERE, secrets: ["OWNER_EMAIL"] })
  assert.match(without.sent.BETTER_AUTH_SECRET, /^[0-9a-f]{40}$/)
  const kept = deploy(ALL_THERE)
  assert.equal(kept.sent.BETTER_AUTH_SECRET, undefined)
})

test("when the Worker's settings cannot be read, nothing goes up and no secret is made", () => {
  const { failed, asked } = deploy({ ...ALL_THERE, refuses: ["secrets"] })
  assert.equal(failed?.status, 1)
  assert.match(failed.stdout, /::error::Cloudflare did not show the Worker's settings\. The token needs Edit for Workers Scripts/)
  assert.ok(!asked.some((line) => line.startsWith("wrangler deploy")))
})

test("a refusal says which tick the token most likely lacks", () => {
  for (const [what, says] of [
    ["d1", /::error::Cloudflare refused the token\. .* Edit for D1/],
    ["r2", /::error::Cloudflare did not make the bucket reha-band\. Either R2 is not on/],
    ["queues", /::error::Cloudflare did not make the queue reha-band-chat\. The token needs Edit for Queues/],
  ]) {
    const { failed, asked } = deploy({ refuses: [what] })
    assert.equal(failed?.status, 1, what)
    assert.match(failed.stdout, says)
    assert.ok(!asked.some((line) => line.startsWith("wrangler deploy")), what)
  }
})

test("a setting that cannot be right stops the deploy before Cloudflare is asked", () => {
  for (const [name, value, says] of [
    ["OWNER_EMAIL", "Alex", /::error::OWNER_EMAIL should be an address alone, like you@example\.com/],
    ["LETTERS_FROM", "mailto:band@example.com x", /::error::LETTERS_FROM should be an address alone/],
    ["TELEGRAM_CHAT_ID", "@band", /::error::TELEGRAM_CHAT_ID should be a number, like -1001234567890/],
  ]) {
    const { failed, asked } = deploy(ALL_THERE, { [name]: value })
    assert.equal(failed?.status, 1, name)
    assert.match(failed.stdout, says)
    assert.deepEqual(asked, [], name)
  }
})

test("no build: an error that says to build first", () => {
  const { failed, asked } = deploy(ALL_THERE, {}, { built: false })
  assert.equal(failed?.status, 1)
  assert.match(failed.stdout, /::error::There is no build to put up: dist\/reha_band\/wrangler\.json is missing/)
  assert.deepEqual(asked, [])
})

test("no token: a notice and no deploy", () => {
  const { out, asked, config } = deploy(ALL_THERE, { CLOUDFLARE_API_TOKEN: "" })
  assert.match(out, /^::notice::/m)
  assert.deepEqual(asked, [])
  assert.equal(config, undefined)
})

test("an address given as a link stops the deploy, with an example of one's own", () => {
  const { failed } = deploy(ALL_THERE, { SERVICE_DOMAIN: "https://band.example.com/" })
  assert.equal(failed?.status, 1)
  assert.match(failed.stdout, /::error::SERVICE_DOMAIN should be an address alone, like band\.example\.com, not https/)
})
