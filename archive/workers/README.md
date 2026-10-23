# Deleted Workers (23 Oct 2026)

These Workers on the main Cloudflare account were deleted with the owner's OK. Before deleting, each was checked:

- no requests since at least 24 Sep 2026 (`rb-studio-root-proxy` had 31 that day and none since);
- no route, no custom domain, no workers.dev address in use;
- no other Worker binding to it, and no cron schedule.

Each folder has the code as it was live (`cfworker.py pull`) and `settings.json`: the compatibility date and the bindings by
name and id. Secret and plain-text values were not saved. The D1 databases, KV namespaces and R2 buckets they were bound to
were **not** deleted.

To bring one back: `python3 -I rb-tools/cfworker.py push <name> archive/workers/<name>`, then recreate its bindings from
`settings.json` in the dashboard.

| Worker | What the code is |
| --- | --- |
| `dry-pond-c4b6`, `green-unit-8a77` | Small dashboard-made Workers. |
| `media-worker`, `ops-worker` | The Cloudflare "Hello World" starter. |
| `soft-violet-13f4` | No code at all (the API returned an empty script). |
| `rb-worker` | An older site Worker that proxied `relentless-billionaire.pages.dev`. |
| `rb-studio-root-proxy` | A proxy from `/studio` to an outside host. `/studio` is served by `rb-mastering-studio` today. |
| `rb-operations-admin` | An earlier content admin panel. Its D1 and KV are kept. |
| `relentless-billionaire-gateway` | An older gateway Worker. |
| `relentless-club-boundary` | A club app. Its D1, R2 and KV are kept. |
| `waitlist-api` | The old waitlist API. Its D1 is `waitlist-db` (820b8c2f…), the same database `artist-router` uses, and is kept. |

Kept, although they look quiet: `recording-mobile-css` (route `relentlessbillionaire.com/record/styles.css`),
`relentless-billionaire-game` (rb-game's `GAME` binding serves the old game's sounds), and `relentless-agent-mcp-server`.
That last one has its own Durable Object store, and deleting the Worker would wipe that data permanently.
