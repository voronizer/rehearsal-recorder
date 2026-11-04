// Puts the band service up on the owner's Cloudflare account. In service.yml
// the job `service · deploy` runs it in service/, with the pages and the
// Worker already built into dist/ by `service · build` and wrangler alone
// installed. On a computer, `npm run deploy` builds first.
//
// It needs CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID when the token
// reaches more than one account; SERVICE_DOMAIN, when set, is the band's
// address (such as band.example.com). Without a token it says so and
// stops, so a fork that runs no service stays green.
//
// The Worker's settings come from the repository too, where it has them
// (service/README.md, step 6): OWNER_EMAIL and LETTERS_FROM, the second
// token CF_ADDRESSES_TOKEN, the bot's TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// and OWNER_TELEGRAM_ID, and CF_ACCOUNT_ID, which is CLOUDFLARE_ACCOUNT_ID.
// They go up with the Worker as its secrets. A setting the repository lacks
// stays as the Worker has it, so one typed into Cloudflare's dashboard
// still counts. BETTER_AUTH_SECRET, which signs the band's sign-ins, is
// made here only for a Worker that is not there yet. A Worker already up
// keeps the one it has, as a secret or as a plain variable typed into the
// dashboard (keep_vars keeps those, and `wrangler secret list` does not
// show them): a new one would sign the whole band out, as the first
// deploy of this script did on 2026-11-04.
//
// In order: the database, the bucket and the queue are found, or made when
// there are none; the database's id and the address are written into the
// build's wrangler.json; the migrations not applied yet are applied; and
// the Worker goes up with its settings. When Cloudflare refuses a step, the
// job says which tick the token most likely lacks.

import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const DATABASE = "reha-band"
const BUCKET = "reha-band"
const QUEUE = "reha-band-chat"
/** What `vite build` writes for the Worker: wrangler.jsonc as it goes up. */
export const BUILT = "dist/reha_band/wrangler.json"

/** The settings the repository may hold, each as the Worker names it. */
const FROM_REPOSITORY = {
  OWNER_EMAIL: "OWNER_EMAIL",
  LETTERS_FROM: "LETTERS_FROM",
  CF_ACCOUNT_ID: "CLOUDFLARE_ACCOUNT_ID",
  CF_ADDRESSES_TOKEN: "CF_ADDRESSES_TOKEN",
  TELEGRAM_BOT_TOKEN: "TELEGRAM_BOT_TOKEN",
  TELEGRAM_CHAT_ID: "TELEGRAM_CHAT_ID",
  OWNER_TELEGRAM_ID: "OWNER_TELEGRAM_ID",
}

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHAT = /^-?\d+$/
/** What each setting must look like, and an example of one that does. */
const SHAPES = {
  OWNER_EMAIL: [ADDRESS, "an address alone, like you@example.com"],
  LETTERS_FROM: [ADDRESS, "an address alone, like band@example.com"],
  TELEGRAM_CHAT_ID: [CHAT, "a number, like -1001234567890"],
  OWNER_TELEGRAM_ID: [CHAT, "a number, like 123456789"],
}

const STEP_5 = "service/README.md, step 5"
const HINTS = {
  token: `Cloudflare refused the token. Check that CLOUDFLARE_API_TOKEN holds the whole token, and that the token has Edit for D1 (${STEP_5}).`,
  bucket: `Cloudflare did not make the bucket ${BUCKET}. Either R2 is not on for the account (service/README.md, step 4), or the token lacks Edit for Workers R2 Storage (${STEP_5}).`,
  queue: `Cloudflare did not make the queue ${QUEUE}. The token needs Edit for Queues (${STEP_5}).`,
  migrations: `The database's tables were not brought up to date. The token needs Edit for D1 (${STEP_5}).`,
  settings: `Cloudflare did not show the Worker's settings. The token needs Edit for Workers Scripts (${STEP_5}).`,
  deploy: `The Worker did not go up. The token needs Edit for Workers Scripts, and for an address of your own, Workers Routes on its domain (${STEP_5}).`,
}

/** Stops the job with `message`, as GitHub shows an error. */
function stop(message) {
  console.log(`::error::${message}`)
  process.exit(1)
}

/** Runs wrangler and stops the job with `hint` when it fails. */
function run(args, { quiet = false, hint } = {}) {
  const done = spawnSync("wrangler", args, {
    stdio: ["ignore", quiet ? "pipe" : "inherit", "inherit"],
    encoding: "utf8",
  })
  if (done.error) throw done.error
  if (done.status !== 0) stop(hint ?? `wrangler ${args.join(" ")} failed`)
  return done.stdout ?? ""
}

/** Whether wrangler finds it: its `info` answers or fails. */
function exists(args) {
  return spawnSync("wrangler", args, { stdio: ["ignore", "ignore", "ignore"] }).status === 0
}

/** The list wrangler printed as JSON, after any warning it printed first. */
function listIn(out, what) {
  const start = out.search(/^\[/m)
  if (start < 0) throw new Error(`wrangler printed no list of ${what}`)
  return JSON.parse(out.slice(start, out.lastIndexOf("]") + 1))
}

const databases = () => listIn(run(["d1", "list", "--json"], { quiet: true, hint: HINTS.token }), "databases")

function databaseId() {
  let found = databases().find((db) => db.name === DATABASE)
  if (!found) {
    console.log(`Making the database ${DATABASE}.`)
    run(["d1", "create", DATABASE], { hint: HINTS.token })
    found = databases().find((db) => db.name === DATABASE)
    if (!found) throw new Error(`${DATABASE} was made but is not in the list`)
  }
  return found.uuid
}

/**
 * Whether the Worker is up already: `wrangler secret list` answers for one
 * that is and says "not found" for one that is not. Anything else stops the
 * job: guessing "not there" would make a new BETTER_AUTH_SECRET and sign
 * the band out.
 */
function workerIsUp(name) {
  const done = spawnSync("wrangler", ["secret", "list", "--name", name, "--config", BUILT], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  })
  if (done.error) throw done.error
  if (done.status === 0) return true
  const said = `${done.stdout ?? ""}${done.stderr ?? ""}`
  process.stderr.write(said)
  if (/Worker "[^"]+".* not found\./.test(said)) return false
  stop(HINTS.settings)
}

/** The settings found in the repository, checked; stops at one that cannot be right. */
export function repositorySettings(env) {
  const settings = {}
  for (const [name, from] of Object.entries(FROM_REPOSITORY)) {
    const value = (env[from] ?? "").trim()
    if (!value) continue
    const shape = SHAPES[name]
    if (shape && !shape[0].test(value)) stop(`${name} should be ${shape[1]}. Check it in the repository's settings on GitHub.`)
    settings[name] = value
  }
  return settings
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.log(
      "::notice::The band service is not set up: the repository has no CLOUDFLARE_API_TOKEN secret, so it was not put up."
    )
    return
  }
  const domain = (process.env.SERVICE_DOMAIN ?? "").trim()
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain))
    stop(`SERVICE_DOMAIN should be an address alone, like band.example.com, not ${domain}`)
  if (!existsSync(BUILT)) stop(`There is no build to put up: ${BUILT} is missing. Run npm run build first.`)
  const settings = repositorySettings(process.env)

  const id = databaseId()
  if (!exists(["r2", "bucket", "info", BUCKET])) {
    console.log(`Making the bucket ${BUCKET}.`)
    run(["r2", "bucket", "create", BUCKET], { hint: HINTS.bucket })
  }
  if (!exists(["queues", "info", QUEUE])) {
    console.log(`Making the queue ${QUEUE}.`)
    run(["queues", "create", QUEUE], { hint: HINTS.queue })
  }

  const config = JSON.parse(readFileSync(BUILT, "utf8"))
  for (const db of config.d1_databases) if (db.database_name === DATABASE) db.database_id = id
  if (domain) {
    // One address for the band: a key carries it, and so does every letter.
    config.routes = [{ pattern: domain, custom_domain: true }]
    config.workers_dev = false
  }
  writeFileSync(BUILT, JSON.stringify(config, null, 2) + "\n")

  if (!workerIsUp(config.name)) {
    settings.BETTER_AUTH_SECRET = randomBytes(20).toString("hex")
    console.log("A new Worker: a BETTER_AUTH_SECRET was made for it.")
  }
  const names = Object.keys(settings)
  console.log(names.length ? `Settings going up with the Worker: ${names.join(", ")}.` : "No settings from the repository.")

  // The migrations not applied yet, as D1's own d1_migrations table says.
  run(["d1", "migrations", "apply", DATABASE, "--remote", "--config", BUILT], { hint: HINTS.migrations })

  // The settings go in a file only this user can read, gone after the deploy.
  const dir = mkdtempSync(join(tmpdir(), "reha-band-"))
  const file = join(dir, "settings.json")
  try {
    writeFileSync(file, JSON.stringify(settings), { mode: 0o600 })
    run(["deploy", "--config", BUILT, ...(names.length ? ["--secrets-file", file] : [])], { hint: HINTS.deploy })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(domain ? `The band service is up at https://${domain}` : "The band service is up on workers.dev.")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main()
