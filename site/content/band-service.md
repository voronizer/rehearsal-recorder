---
date: 2026-10-31
description: A private page for your band, where everyone hears each take track by track, stars the good ones and comments at the second it went wrong. How our band uses it, and how to run one of your own.
---

<!-- reha.stream/band-service, written like a story (site/content/stories/)
     with its chapters, chats and big lines, and one thing a story has not:
     numbered steps, under ## Run your own. РЭХА's key line in Settings ›
     Folders links here (SERVICE_HELP_URL in sending/band_service.py). -->

# A band service of your own

A band service is a private web page for your band, at its own address. РЭХА sends it your takes: one at a time, every ★ take at the end of the evening, or each take as you save it, false starts aside.

The band opens it on a phone or a computer. Each take plays track by track, with a lane for each of you, so you can hear the bass on its own. Anyone in the band can star a take and leave a comment at a second of it. Nobody outside the band gets in: each of you signs in with your email address and a code from a letter.

It runs on your own Cloudflare account, so the takes are on your account and nobody else's. There is nothing to sign up for: you add each member's address yourself.

## How we use it

For a long time our good takes went to a cloud folder. They got there quickly, and then we talked about them in the band's chat.

> **Guitarist:** In Viasna, the bit after the second chorus. Is that me?\
> **Me:** Which Viasna?\
> **Guitarist:** Thursday's. The good one. Around two minutes in. Or three.\
> **Drummer:** It's me. It's always me.\
> **Singer:** There are four Viasnas from Thursday.

A take in the folder was one file, the mix. You could not hear the guitar on its own, and nobody could point at a second of it.

Now the takes go to our band service. On Thursday night the bot writes in our group: “New takes from Thursday, 29 October: Viasna 11, Viasna 12, Pałyn 9”. On the bus home the guitarist opens Viasna 12, presses S on the guitar's lane to hear it alone, and stops at 1:42.

> **Guitarist:** 1:42. The bridge drags here.\
> **Drummer:** Not the drums. I soloed them.\
> **Me:** It's the bass. Sorry.

**We still argue. Now we argue about 1:42.**

Anyone can answer a comment, and close it once the place is fixed. A mark left in РЭХА at the rehearsal comes along with its take, so the whole band sees what we said in the room.

On Sunday the singer goes through the week and stars the takes worth keeping. A song's page puts the take with the most stars on top, so before the next rehearsal everyone knows which Viasna we are aiming for.

The drummer listens with the drums soloed, to check the kick, the drummer says. We think it's the fills.

## Run your own

You need a Cloudflare account, a domain of your own and a GitHub account. Cloudflare runs the service, its pages, its database and the takes' files, and its free plan is enough. The domain has to be on that Cloudflare account, since the sign-in letters can only come from an address on a domain where Cloudflare's mail is on. The service itself can stay at the address Cloudflare gives it, on workers.dev. On GitHub, also free, you keep your own copy of РЭХА's repository, and the service is put up from there. A Telegram bot is only needed if you want the band's group to hear about new takes and comments.

It costs nothing on Cloudflare's free plan except the files: they are free up to 10 GB, then $0.015 per GB a month. A two-hour rehearsal on six tracks is about 1 GB of MP3 and 3 GB of FLAC, so after a year of weekly rehearsals that comes to about $3 a month. The domain you pay for to whoever sells it.

1. Make an account on GitHub if you have none, and open [РЭХА's repository](https://github.com/voronizer/rehearsal-recorder). Press **Fork**, then **Create fork**. Your copy is what the service is put up from.
2. Make an account on Cloudflare and add your domain to it. Cloudflare gives you two nameservers: put them in place of the old ones, where you bought the domain. It can take a few hours before Cloudflare says the domain is active.
3. Turn on Cloudflare's mail for the domain: open the domain's **Email Routing**, turn it on, and let Cloudflare add the records it asks for. Nothing else on the domain changes.
4. Make two API tokens in Cloudflare, on the **Account API tokens** page. The first puts the service up: start it from the template **Edit Cloudflare Workers**, and make sure it has **D1**, **Workers R2 Storage** and **Queues**, each set to **Edit**, and **Workers Routes** set to **Edit** on your domain. The second lets the service keep Cloudflare's list of addresses it may send letters to, and nothing else: give it **Email Routing Addresses** set to **Edit**, and that alone.
5. In your fork on GitHub, open **Settings › Secrets and variables › Actions** and press **New repository secret**. Add `CLOUDFLARE_API_TOKEN`, the first token, and `CLOUDFLARE_ACCOUNT_ID`, your account's id ([where Cloudflare shows it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)). To have the service at an address on your domain, such as band.example.com, add that address under **Variables** as `SERVICE_DOMAIN`. Without it the service answers on workers.dev.
6. Put the service up: in your fork, open **Actions**. GitHub keeps a fork's workflows off until you press **I understand my workflows, go ahead and enable them**. Then pick **Release**, press **Run workflow**, choose **Put the service up again** and press **Run workflow** again. When the run turns green, the service is up.
7. Give the service its settings in Cloudflare: open **Workers & Pages**, then **reha-band**, then **Settings › Variables and Secrets**, and add each as a secret. `OWNER_EMAIL` is your own address: whoever signs in with it is the owner and sees **Members**. `LETTERS_FROM` is the address the letters come from, on your domain, such as band@example.com. `BETTER_AUTH_SECRET` is 40 or so random letters and digits that nobody ever types: it signs the band's sign-ins. `CF_ACCOUNT_ID` is your account's id again, and `CF_ADDRESSES_TOKEN` the second token.
8. This step is for the band's group in Telegram; skip it if you have none. Make a bot with @BotFather, which gives you its token, and add the bot to the group. Write /start in the group, and to the bot in a chat of its own. Then open `https://api.telegram.org/bot<the token>/getUpdates` in a browser: each chat's id is the number after `"chat":{"id":`, and the group's starts with a minus. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, the group's id, and `OWNER_TELEGRAM_ID`, your own: when something on the server fails, the bot tells you alone.
9. Open the service's address. Type your own address and press **Send code**. The first time, Cloudflare sends a letter of its own: press **Verify email address** in it, then **Send code** again. Type the six digits from the service's letter, and tell it what the band should call you.
10. On **Members**, press **Add member** for each of the band's addresses. Cloudflare sends each of them its letter; once they have pressed the button in it, they sign in the same way, with their own address.
11. On **Members**, under **Where РЭХА runs**, type “Rehearsal room” or wherever the laptop lives, press **Make a key for РЭХА** and copy the key: it is shown only once. In РЭХА, open **Settings › Folders**, press **I have a band service key**, paste it and press **Connect**.

From then on, takes go to the band service. **Send takes to** in **Settings › Folders** switches between the band service and the cloud folder whenever you like.

For a newer service later, press **Sync fork** on your fork's page, then run **Put the service up again**.

## The code

The service's code is open, beside РЭХА's, in [the repository's service folder](https://github.com/voronizer/rehearsal-recorder/tree/main/service). It's under the Functional Source License (FSL-1.1-MIT): you can run it for your band, read it and change it, but not offer it to others as a commercial service that does the same job. Each version becomes MIT two years after it came out. РЭХА itself is MIT already.
