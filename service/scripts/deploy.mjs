// Puts the band service up on the owner's Cloudflare account: the release's
// `service · deploy` job runs it in service/, as `npm run deploy`.
//
// It needs CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID when the token
// reaches more than one account; SERVICE_DOMAIN, when set, is the band's
// address (band.reha.stream). Without a token it says so and stops, so a
// release made before the service is set up is not red.
//
// In order: the database, the bucket and the queue are found, or made when
// there are none; the database's id and the address are written into
// wrangler.jsonc (in the job's checkout only, never committed); the pages
// and the Worker are built; the migrations not applied yet are applied; and
// the Worker goes up. The Worker's own settings (its address, owner, sender,
// bot) are set in Cloudflare and kept through a deploy by `keep_vars`.

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const DATABASE = "reha-band"
const BUCKET = "reha-band"
const QUEUE = "reha-band-chat"
const CONFIG = "wrangler.jsonc"

/** wrangler.jsonc read as JSON: its comments left out, strings kept whole. */
export function readConfig(text) {
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
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1
      if (i === 0) throw new Error(`${CONFIG}: a comment is not closed`)
    } else {
      out += ch
    }
  }
  return JSON.parse(out)
}

/** Runs wrangler (or npm) and fails the job with it when it fails. */
function run(command, args, { quiet = false } = {}) {
  const done = spawnSync(command, args, {
    stdio: ["ignore", quiet ? "pipe" : "inherit", "inherit"],
    encoding: "utf8",
  })
  if (done.error) throw done.error
  if (done.status !== 0) {
    console.log(`::error::${command} ${args.join(" ")} failed`)
    process.exit(done.status ?? 1)
  }
  return done.stdout ?? ""
}

/** Whether wrangler finds it: its `info` answers or fails. */
function exists(args) {
  return spawnSync("wrangler", args, { stdio: ["ignore", "ignore", "ignore"] }).status === 0
}

/** The D1 databases on the account. Wrangler can print a warning before
 *  the list, so the list is read from its first line that opens one. */
function databases() {
  const out = run("wrangler", ["d1", "list", "--json"], { quiet: true })
  const start = out.search(/^\[/m)
  if (start < 0) throw new Error("wrangler d1 list --json printed no list")
  return JSON.parse(out.slice(start, out.lastIndexOf("]") + 1))
}

function databaseId() {
  let found = databases().find((db) => db.name === DATABASE)
  if (!found) {
    console.log(`Making the database ${DATABASE}.`)
    run("wrangler", ["d1", "create", DATABASE])
    found = databases().find((db) => db.name === DATABASE)
    if (!found) throw new Error(`${DATABASE} was made but is not in the list`)
  }
  return found.uuid
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.log(
      "::notice::The band service is not set up: the repository has no CLOUDFLARE_API_TOKEN secret, so it was not put up."
    )
    return
  }
  const domain = (process.env.SERVICE_DOMAIN ?? "").trim()
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    console.log(`::error::SERVICE_DOMAIN should be an address alone, like band.reha.stream, not ${domain}`)
    process.exit(1)
  }

  const id = databaseId()
  if (!exists(["r2", "bucket", "info", BUCKET])) {
    console.log(`Making the bucket ${BUCKET}.`)
    run("wrangler", ["r2", "bucket", "create", BUCKET])
  }
  if (!exists(["queues", "info", QUEUE])) {
    console.log(`Making the queue ${QUEUE}.`)
    run("wrangler", ["queues", "create", QUEUE])
  }

  const config = readConfig(readFileSync(CONFIG, "utf8"))
  for (const db of config.d1_databases) if (db.database_name === DATABASE) db.database_id = id
  if (domain) {
    // One address for the band: a key carries it, and so does every letter.
    config.routes = [{ pattern: domain, custom_domain: true }]
    config.workers_dev = false
  }
  writeFileSync(CONFIG, `// Written by scripts/deploy.mjs for this deploy.\n${JSON.stringify(config, null, 2)}\n`)

  run("npm", ["run", "build"])
  // The migrations not applied yet, as D1's own d1_migrations table says.
  run("wrangler", ["d1", "migrations", "apply", DATABASE, "--remote", "--config", CONFIG])
  run("wrangler", ["deploy"])
  console.log(domain ? `The band service is up at https://${domain}` : "The band service is up on workers.dev.")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main()
