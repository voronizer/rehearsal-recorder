# The band service

A private web page at the band's own address, where the band listens to its
takes track by track, stars them and marks a moment to talk about. РЭХА
sends the takes there with a key the owner makes on the **Members** page.

It is one Cloudflare Worker: the pages and the API, with D1 (Cloudflare's
database) for everything but audio and R2 (Cloudflare's file storage) for
the takes' files. Each copy of it runs on its owner's own Cloudflare
account, with its own address, owner and settings.

## Run one for your band

This is for whoever looks after the band's service. What a band service
does for the band is on [reha.stream](https://reha.stream/band-service).

You need three things:

- **A Cloudflare account.** Cloudflare runs the service: its pages, its
  database and the takes' files. Its free plan is enough.
- **A domain of your own, on that Cloudflare account.** The sign-in letters
  can only come from an address on a domain where Cloudflare's mail is on.
  The service itself can stay at the address Cloudflare gives it, on
  workers.dev.
- **A GitHub account,** also free. You keep your own copy of РЭХА's
  repository there, and the service is put up from it.

A Telegram bot is only needed if you want the band's group to hear about
new takes, marks and comments.

It costs nothing on Cloudflare's free plan except the files: they are free
up to 10 GB, then $0.015 per GB a month. A two-hour rehearsal on six tracks
is about 1 GB of MP3 and 3 GB of FLAC, so after a year of weekly rehearsals
that comes to about $3 a month. The domain you pay for to whoever sells it.

1. Make an account on GitHub if you have none, and open
   [РЭХА's repository](https://github.com/voronizer/rehearsal-recorder).
   Press **Fork**, then **Create fork**. Your copy, the fork, is what the
   service is put up from.
2. Make an account on Cloudflare and add your domain to it. Cloudflare
   gives you two nameservers: put them in place of the old ones, where you
   bought the domain. It can take a few hours before Cloudflare says the
   domain is active.
3. Turn on Cloudflare's mail for the domain. In the menu on the left, open
   **Compute › Email Service › Email Routing**, press **Onboard Domain**,
   pick your domain and press **Done**. Cloudflare adds the records mail
   needs, and the rest of the domain stays as it is. If it says
   “Non-Cloudflare MX records exist”, the domain already gets mail
   somewhere else, and this would take that mail over: sort it out first.
4. Turn on R2, Cloudflare's file storage: open **R2** in the menu on the
   left and turn it on. Cloudflare asks for a card or PayPal first, even
   though the first 10 GB are free. Without R2 the service cannot be put
   up.
5. Make the two tokens. A token is a long password for one job, and
   Cloudflare shows it only once, so have step 6 open in another tab.

   The first token puts the service up. On the **Account API Tokens**
   page, press **Create Token** and pick the template **Edit Cloudflare
   Workers**. Press the pencil on the policy for your account and tick
   **Edit** for **D1** and for **Queues**, which the template lacks. Leave
   the rest as it is, **No expiration** too: a token that runs out would
   one day stop the service being put up, with no warning. Press **Review
   token**, then **Create token**, and copy the token. Cloudflare also
   shows an Access Key ID, a Secret Access Key and an S3 endpoint; the
   service needs none of them.

   The second token lets the service keep Cloudflare's list of addresses
   it may send letters to, and nothing else. Press **Create Token** again,
   this time without a template, and give it one policy for your account:
   **Email Routing Addresses** set to **Edit**.
6. In your fork on GitHub, open **Settings › Secrets and variables ›
   Actions**. Everything the service needs from you goes here. A secret
   is hidden once saved; a variable stays readable, so you can check it
   later.

   Press **New repository secret** for each of these:
   - `CLOUDFLARE_API_TOKEN`: the first token.
   - `CLOUDFLARE_ACCOUNT_ID`: your account's id
     ([where Cloudflare shows it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)).
   - `CF_ADDRESSES_TOKEN`: the second token.

   Then open the **Variables** tab and press **New repository variable**
   for each of these:
   - `OWNER_EMAIL`: your own address. Whoever signs in with it is the
     owner: they add the band's members and make keys for РЭХА on
     **Members**.
   - `LETTERS_FROM`: the address the letters come from, on your domain,
     such as band@example.com.
   - `SERVICE_DOMAIN`, if you want the service at an address on your
     domain, such as band.example.com. Without it the service answers on
     workers.dev.

   The secret that signs the band's sign-ins is made by the service
   itself, the first time it goes up.
7. Put the service up: in your fork, open **Actions**. GitHub keeps a
   fork's workflows off until you press **I understand my workflows, go
   ahead and enable them**. Then pick **Service**, press **Run workflow**,
   leave the branch on `main` and press **Run workflow** again. When the
   run turns green, the service is up. If it turns red, open the run: the
   red step says which setting or which tick on the token is missing.
8. Open the service's address. Type your own address and press **Send
   code**. The first time, Cloudflare sends a letter of its own: press
   **Verify email address** in it, then **Send code** again. Type the six
   digits from the service's letter, and tell it what the band should
   call you. If no letter comes within a minute, press **Send code** once
   more.
9. On **Members**, press **Add member** for each of the band's addresses.
   Cloudflare sends each of them its letter; once they have pressed the
   button in it, they sign in the same way, with their own address.
10. On **Members**, under **Keys for РЭХА**, type where the laptop lives,
    such as “Rehearsal room”, press **Make a key for РЭХА** and copy the
    key: it is shown only once. In РЭХА, open **Settings › Folders**, press
    **I have a band service key**, paste it and press **Connect**.

From then on, takes go to the band service. **Send takes to** in
**Settings › Folders** switches between the band service and the cloud
folder whenever you like.

For a newer service later, press **Sync fork** on your fork's page. If no
**Service** run starts by itself under **Actions**, run it as in step 7.

To change a setting, change it on GitHub and run **Service** again. A
setting you typed into the Worker in Cloudflare before stays as it is
until you set the same one on GitHub; then GitHub's wins.

### The band's group in Telegram

The service can tell the band's group in Telegram about new takes, marks
and comments, and tell you alone when something on the server fails. Skip
this if you have no group.

1. Write `/newbot` to @BotFather and give the bot a name and a username
   that ends in `bot`; BotFather answers with the bot's token.
2. Add the bot to the group: tap the group's name, then **Add Members**,
   and find the bot by its username. The group then says the bot “has no
   access to messages”, which is right: it only writes there.
3. In the group, send `/start@` with the bot's username, such as
   `/start@band_reha_bot`. A plain /start never reaches a bot that does
   not read the group. Write the bot anything in a chat of its own too.
4. Open `https://api.telegram.org/bot<the token>/getUpdates` in a
   browser: each chat's id is the number after `"chat":{"id":`. The
   group's id starts with a minus: copy it with the minus. That page's
   address holds the bot's token, so never share a picture of it. If you
   did, `/revoke` in BotFather gives the bot a new token and stops the
   old one.
5. In your fork's **Settings › Secrets and variables › Actions**, add
   three secrets: `TELEGRAM_BOT_TOKEN`, the bot's token;
   `TELEGRAM_CHAT_ID`, the group's id; and `OWNER_TELEGRAM_ID`, your own.
   Then run **Service** again, as in step 7.

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

A merge into main that changes `service/` or `ui/` (the pages draw with the
interface's components) puts the service up, once its checks pass
(`.github/workflows/service.yml`), so the service is always main's. By
hand, **Run workflow** under **Actions › Service** puts main up; on another
branch it only runs the checks.

Two jobs do it. `service · build` builds the pages and the Worker into
`dist/` on a machine that never holds the Cloudflare token, since the build
runs hundreds of packages from npm. `service · deploy` installs wrangler
alone and runs `scripts/deploy.mjs` on that build:

1. It finds the database `reha-band`, the bucket `reha-band` and the queue
   `reha-band-chat` on the account, and makes any that is missing.
2. It writes the database's id, and the address when there is one, into
   the build's `dist/reha_band/wrangler.json`. `wrangler.jsonc` here keeps
   `local`.
3. It applies the migrations D1 has not had yet, and puts the Worker up
   with the settings the repository has. When the Worker has no
   `BETTER_AUTH_SECRET`, it makes one; one the Worker has is never
   replaced, since a new one would sign the whole band out.

When Cloudflare refuses a step, the job's error says which tick the token
most likely lacks. On a computer, `npm run deploy` builds and then does the
same, with the same settings in the shell's environment.

The job reads, from the repository's settings on GitHub:

- the secret `CLOUDFLARE_API_TOKEN`: a Cloudflare token that may edit
  Workers, D1, R2, Queues and the domain's Workers routes;
- the secret `CLOUDFLARE_ACCOUNT_ID`, when the token reaches more than one
  account. It also goes to the Worker as `CF_ACCOUNT_ID`;
- the variable `SERVICE_DOMAIN`, the band's address, such as
  `band.reha.stream`. With it the Worker answers there, and its workers.dev
  address is turned off; without it, the Worker answers at workers.dev;
- the Worker's own settings, each where it is set: the variables
  `OWNER_EMAIL` and `LETTERS_FROM`, and the secrets `CF_ADDRESSES_TOKEN`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `OWNER_TELEGRAM_ID`. They go
  up with the Worker as its secrets. One the repository lacks stays as the
  Worker has it, so settings typed into Cloudflare's dashboard still count.

Without the token the job says the service is not set up, and the run stays
green.

The secrets can live in the environment `service` instead of the
repository (**Settings › Environments** on GitHub), with **Deployment
branches** set to `main` alone. Then a workflow on any other branch cannot
read the token. reha.stream's own repository keeps them there.

To change a table, change `worker/shared/schema.ts` and run `npm run
migrations`; the schema and the new migration go in one commit. D1 has no
way back: undoing a change is another migration, and D1's Time Travel can put
the whole database back to an earlier minute, as far back as the account's
Cloudflare plan keeps. A migration only adds tables and columns, so the
Worker before keeps working in the moments before the new one is up.

`npm run test:deploy` checks the deploy script against a stand-in Wrangler.

## Licence

The band service is under the Functional Source License, Version 1.1, MIT
Future License (FSL-1.1-MIT): see `LICENSE`. You can run it for your band,
read it and change it, but not offer it to others as a commercial service
that does the same job. Each version becomes MIT two years after it came
out. РЭХА itself stays under MIT.

**The mix** on a take's page is encoded by LAME, the MP3 encoder, which is
under the GNU LGPL. It comes built for the browser by the
`wasm-media-encoders` package (MIT) and is served as a file of its own.
