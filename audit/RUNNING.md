# What's running, 23 Oct 2026

Taken from the live Cloudflare and Stripe accounts with read-only calls. It's here so the owner can mark anything that wasn't agreed. Nothing has been removed because of this list.

- **Requests** are the last 30 days. They count every request, including bots.
- **Pipeline** says whether `deploy-all.sh` in this repo patches and uploads that Worker. Every other Worker is left as it is.
- **Keep?** is for the owner. Write *keep*, *remove* or *ask*. A removal means a backup first, then deletion, and the storage stays (as with `archive/workers/`).

## Workers

### Main account (relentlessbillionaire.com)

| Worker | What it serves | Created | Last changed | Requests (30 days) | Errors | Schedule | Pipeline | Keep? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `artist-router` | The main site, relentlessbillionaire.com (home, store, /create, /badge, /app, RB World, /rewards, /advertise) | 2026-08-09 | 2026-10-23 | 255,010 | 150 | — | yes | |
| `assassin-in-the-room-signal` | /assassin page | 2026-08-18 | 2026-10-14 | 110 | 0 | — | yes | |
| `beatstore` | Beat store catalog | 2026-07-13 | 2026-10-23 | 7,320 | 0 | — | yes | |
| `beatstore-covers` | Beat store cover images | 2026-09-19 | 2026-10-01 | 570 | 10 | — | no | |
| `fuerzas-del-bay` | fdb. site | 2026-10-09 | 2026-10-11 | 1,400 | 0 | — | no | |
| `maison-atelier` | Maison atelier, daily job (no route) | 2026-09-26 | 2026-10-01 | 9,360 | 0 | `17 4 * * *` | no | |
| `rb-autopilot` | Autopilot: talent, pitches, AI Forge ideas, beat files, publish queue (schedules only) | 2026-10-01 | 2026-10-23 | 4,560 | 0 | `*/10 * * * *`, `41 * * * *` | yes | |
| `rb-cloud` | RB Cloud (reached by binding) | 2026-09-24 | 2026-10-02 | 3,220 | 0 | — | no | |
| `rb-command` | RB Command, the admin (team., admin.) | 2026-09-29 | 2026-10-23 | 11,480 | 0 | `52 14 * * *` | yes | |
| `rb-dancer-portal` | xxx. site | 2026-08-22 | 2026-10-01 | 10 | 0 | — | no | |
| `rb-daw` | RB Studio recorder (/record, studio.) | 2026-10-01 | 2026-10-22 | 7,920 | 0 | — | yes | |
| `rb-email` | Email forwarder | 2026-07-21 | 2026-10-17 | 0 | 0 | — | yes | |
| `rb-events-page` | /events | 2026-08-17 | 2026-10-23 | 940 | 0 | — | yes | |
| `rb-favicon` | /favicon.ico | 2026-08-30 | 2026-10-21 | 4,960 | 0 | — | yes | |
| `rb-fund-campaign` | /fund donations | 2026-08-10 | 2026-10-23 | 3,120 | 0 | — | yes | |
| `rb-game` | /game (sends to RB World; serves the old game's files) | 2026-10-01 | 2026-10-23 | 810 | 0 | — | yes | |
| `rb-jobs` | /jobs and job alert emails | 2026-10-01 | 2026-10-23 | 2,440 | 0 | `17 1,7,13,19 * * *` | yes | |
| `rb-live-events` | live. site | 2026-08-22 | 2026-10-14 | 30 | 0 | — | no | |
| `rb-mastering-studio` | /studio mastering | 2026-09-24 | 2026-10-23 | 4,190 | 30 | `13 17 * * *`, `7 * * * *` | yes | |
| `rb-memberships` | /memberships, /book | 2026-10-01 | 2026-10-23 | 1,620 | 0 | — | yes | |
| `rb-partners` | partners. | 2026-10-07 | 2026-10-23 | 2,700 | 0 | — | yes | |
| `rb-public-content` | /api/content (site images, colours, counters) | 2026-09-29 | 2026-10-23 | 9,280 | 0 | — | yes | |
| `rb-radio` | /radio | 2026-10-09 | 2026-10-23 | 37,100 | 0 | — | yes | |
| `rb-radio-hub` | /radio/hub, team./radio-hub | 2026-10-11 | 2026-10-23 | 10,520 | 0 | `24 * * * *` | yes | |
| `rb-release` | /release | 2026-09-20 | 2026-10-23 | 960 | 0 | — | yes | |
| `rb-showcase` | /showcase | 2026-09-24 | 2026-10-11 | 11,020 | 160 | — | yes | |
| `rb-store-payments` | Store checkout and Stripe webhooks (/api/checkout, /api/stripe) | 2026-09-11 | 2026-10-08 | 1,080 | 0 | — | no | |
| `rb-studio` | Donor ledger / AI Forge bridge (binding only) | 2026-08-21 | 2026-10-01 | 0 | 0 | — | no | |
| `rb-tv` | /tv | 2026-09-30 | 2026-10-23 | 18,900 | 0 | — | yes | |
| `rb-tv-redirect` | tv. redirect | 2026-10-14 | 2026-10-14 | 0 | 0 | — | no | |
| `recording-mobile-css` | /record/styles.css | 2026-09-08 | 2026-10-01 | 60 | 0 | — | no | |
| `recording-studio` | Old recording studio (binding only) | 2026-09-05 | 2026-10-01 | 80 | 0 | — | no | |
| `relentless-agent-mcp-server` | Agent MCP server (keeps Durable Object data) | 2026-09-23 | 2026-09-29 | 30 | 0 | — | no | |
| `relentless-backend` | Backend, every 30 minutes (no route) | 2026-09-23 | 2026-10-01 | 5,280 | 0 | `*/30 * * * *` | no | |
| `relentless-billionaire-api` | media., /references, hub. | 2026-04-25 | 2026-10-23 | 37,190 | 110 | — | yes | |
| `relentless-billionaire-game` | The old game (rb-game's GAME binding) | 2026-08-10 | 2026-08-10 | 0 | 0 | — | no | |
| `relentless-hub` | game. (to RB World) | 2026-07-13 | 2026-10-23 | 0 | 0 | — | yes | |
| `relentless-studio` | studio.relentlessbillionaire.com custom domain | 2026-07-13 | 2026-10-01 | 3,230 | 0 | — | no | |
| `slank-customs` | slank. site | 2026-10-07 | 2026-10-11 | 5,720 | 0 | — | no | |
| `sports4all` | sports4all. site | 2026-10-07 | 2026-10-11 | 590 | 0 | — | no | |
| `weed-relentless-billionaire` | weed. site | 2026-05-18 | 2026-10-14 | 60 | 0 | — | yes | |
| `yoshcoastmusic` | /yoshcoastmusic | 2026-08-19 | 2026-10-11 | 60 | 0 | — | yes | |

### RB account (relentlessbillionaire.vip)

| Worker | What it serves | Created | Last changed | Requests (30 days) | Errors | Schedule | Pipeline | Keep? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bruxie-davis-ai` | No route, no traffic | 2026-08-27 | 2026-10-01 | 0 | 0 | — | no | |
| `rb-member-api-staging` | members-staging.….vip | 2026-08-21 | 2026-10-01 | 0 | 0 | — | no | |
| `rb-studio` | Donor ledger / AI Forge bridge (binding only) | 2026-08-21 | 2026-10-17 | 11,200 | 0 | — | yes | |
| `rb-studio-vip-router` | studio.relentlessbillionaire.vip (AI Forge) | 2026-08-26 | 2026-10-01 | 13,260 | 0 | — | no | |

### MAISON NOIR account

| Worker | What it serves | Created | Last changed | Requests (30 days) | Errors | Schedule | Pipeline | Keep? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `maison-atelier-gate` | atelier.maisonerotique.com | 2026-09-26 | 2026-10-01 | 7,310 | 0 | — | no | |
| `maison-hero-proxy` | maisonerotique.com | 2026-09-11 | 2026-10-01 | 26,420 | 0 | — | no | |

### STUDIO DARKSIDE account

| Worker | What it serves | Created | Last changed | Requests (30 days) | Errors | Schedule | Pipeline | Keep? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `autumn-credit-6d51` | *.studiodarkside.com | 2026-08-24 | 2026-10-01 | 0 | 0 | — | no | |

## Storage

- **D1 (main):** `waitlist-db` (the shared database for most sites, 7.6 MB), `rb-donor-ledger`, `relentless-billionaire-db`, `recording-studio-db`, `rb-daw`, `rb-studio-projects`, `rb-membership-db`, `rb-partners-db`, `rb-partners-fullstack-v2-db`, `maison-atelier-db`, `yoshcoastmusic`, `metacity-scores`.
- **D1 (RB account):** `waffle-ai-davis-db`.
- **R2 (main):** `beats-worker`, `beatstore-storage`, `maison-atelier-media`, `rb-assets`, `rb-beat-masters`, `rb-beats`, `rb-cloud-files`, `rb-dancer-submissions`, `rb-daw-media`, `rb-mastering-vault`, `rb-media`, `rb-video`, `rbb`, `rbb-assets`, `recording-studio-media`, `relentless-agent-data`, `relentless-billionaire-beats`, `relentless-billionaire-data`, `relentless-billionaire-media`, `relentless-media`, `relentless-studio-assets`, `relentless-studio-media`, `relentlessbillionaire-models`, `studio-audio`. **R2 (RB account):** `rbb-assets`.
- **KV:** 46 namespaces in the main account, 2 in the RB account, 1 in MAISON NOIR.
- **Backup table to drop when the owner is happy:** `creative_ideas_backup_20261023` in `waitlist-db`.

## Stripe

See `audit/STRIPE_REVIEW.md`.
