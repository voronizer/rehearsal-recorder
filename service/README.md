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

## Licence

The band service is under the Functional Source License, Version 1.1, MIT
Future License (FSL-1.1-MIT): see `LICENSE`. РЭХА itself stays under MIT.
