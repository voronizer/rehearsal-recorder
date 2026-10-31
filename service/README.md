# The band service

A private web page at the band's own address, where the band listens to its
takes track by track, stars them and comments at a moment. РЭХА sends the
takes there with a key the owner makes on the **Members** page.

It is one Cloudflare Worker: the pages and the API, with D1 (Cloudflare's
database) for everything but audio and R2 (Cloudflare's file storage) for
the takes' files. Each copy of it runs on its owner's own Cloudflare
account, with its own address, owner and settings.

## Working on it

```bash
npm ci
npm test              # the Worker's tests, inside the Workers runtime
npm run typecheck
npm run dev           # the pages and the Worker on your computer
```

After changing a table in `worker/shared/schema.ts`, run
`npm run migrations` to write its migration into `migrations/`.

After changing a route, run `npm run openapi`. It writes `openapi.json`,
the description of every route, which РЭХА's tests check their requests
against. A test fails while the file is out of date.

`npm run types` writes `worker-configuration.d.ts` again after a change to
`wrangler.jsonc`.

The pages use the interface's components and React from `../ui`, so run
`npm ci` in `ui/` too before the first build.

## Going live

A published release puts the service up, after the apps are built, in the
job `service · deploy` (`.github/workflows/release.yml`). By hand, **Run
workflow** with **Put the service up again** puts up the latest release's
service. The job runs `npm run deploy`, which is `scripts/deploy.mjs`:

1. It finds the database `reha-band`, the bucket `reha-band` and the queue
   `reha-band-chat` on the account, and makes any that is missing.
2. It writes the database's id, and the address when there is one, into
   `wrangler.jsonc`. Only in the job's own copy: the file here keeps
   `local`.
3. It builds the pages and the Worker, applies the migrations D1 has not
   had yet, and puts the Worker up.

The job needs, in the repository's settings on GitHub:

- the secret `CLOUDFLARE_API_TOKEN`: a Cloudflare token that may edit
  Workers, D1, R2, Queues and the domain's Workers routes;
- the secret `CLOUDFLARE_ACCOUNT_ID`, when the token reaches more than one
  account;
- the variable `SERVICE_DOMAIN`, the band's address, such as
  `band.reha.stream`. With it the Worker answers there, and its workers.dev
  address is turned off; without it, the Worker answers at workers.dev.

Without the token the job says the service is not set up, and the release
stays green.

The Worker's own settings (its address, owner, sender, bot) are set on the
Worker in Cloudflare. A deploy keeps them as they are (`keep_vars`).

To change a table, change `worker/shared/schema.ts` and run `npm run
migrations`; the schema and the new migration go in one commit. D1 has no
way back: undoing a change is another migration, and D1's Time Travel can put
the whole database back to an earlier minute, as far back as the account's
Cloudflare plan keeps. A migration only adds tables and columns, so the
Worker of the previous release keeps working in the moments before the new
one is up.

`npm run test:deploy` checks the deploy script against a stand-in Wrangler.

## Licence

The band service is under the Functional Source License, Version 1.1, MIT
Future License (FSL-1.1-MIT): see `LICENSE`. РЭХА itself stays under MIT.
