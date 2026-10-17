"""Give rb-command a daily scheduled run. Apply after patch_show_planner.py and patch_analytics.py.

Usage: python3 -I patch_scheduled.py <pulled rb-command dir>

Once a day (the cron trigger is set on the Worker, see deploy-all.sh) RB Command:
- tops up the Show planner to three suggestions, even if nobody opens RB Command;
- checks Cloudflare for Workers that crashed in the last 24 hours and writes any it finds to Activity, so there's a
  record even after the Overview's 24-hour window has moved on.
Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "index.js"
s = p.read_text(encoding="utf-8")
OLD = '''export default {
  fetch(request, env, ctx) {
    return serve(request, env, ctx);
  },
};
'''
NEW = '''export default {
  fetch(request, env, ctx) {
    return serve(request, env, ctx);
  },
  // Daily (cron trigger on the Worker): top up the Show planner and record any Worker crashes in Activity.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env));
  },
};

async function daily(env) {
  await showplanner.topUp(env).catch((e) => console.error("daily: show planner", e && e.message));
  const crash = await analytics.crashes(env).catch((e) => { console.error("daily: crash check", e && e.message); return null; });
  for (const c of crash?.scripts || []) {
    await env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES ('daily check', 'worker.crashes', ?, ?)")
      .bind(c.name, `${c.name}: ${c.errors} of ${c.requests} requests failed in the last 24 hours`).run().catch(() => {});
  }
}
'''
if NEW in s:
    print("index.js: daily run already in place")
else:
    if s.count(OLD) != 1:
        raise SystemExit(f"index.js: anchor found {s.count(OLD)} times")
    p.write_text(s.replace(OLD, NEW), encoding="utf-8")
    print("index.js: daily run added")
