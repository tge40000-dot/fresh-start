"""A publish queue for RB Command > Create (rb-autopilot). Code only: no route, binding, secret or schedule changes.

Usage: python3 -I patch_publish_queue.py <pulled rb-autopilot dir>

Publishing a finished beat, song or video normally happens when the owner presses Publish in RB Command, which calls
rb-autopilot through its service binding. This adds a second way for the owner: a row in the D1 table
creative_publish_queue (id = the creative idea's id, by = who approved it). On its existing 10-minute schedule
rb-autopilot publishes each queued idea with the same publish step RB Command uses, so the same checks apply (it has
to be "ready", it can't be published twice, and a failed copy publishes nothing). The row then records the result and
when it ran, and the run shows in Autopilot's history as "publish".
Running it twice changes nothing.
"""
import json
import pathlib
import sys

d = pathlib.Path(sys.argv[1])
if json.loads((d / "manifest.json").read_text())["script"] != "rb-autopilot":
    raise SystemExit(f"patch_publish_queue.py: {d} isn't rb-autopilot")
p = d / "index.js"
s = p.read_text(encoding="utf-8")
if "async function publishQueue(env)" in s:
    print("rb-autopilot: publish queue already in place")
    sys.exit(0)
ANCHOR = """    if (controller.cron === RENDER_CRON) {
"""
if s.count(ANCHOR) != 1:
    raise SystemExit("rb-autopilot: render schedule not found")
s = s.replace(ANCHOR, ANCHOR + """      ctx.waitUntil(publishQueue(env).catch((e) => console.error("rb-autopilot publish queue", e && e.stack || e)));
""")
FN = '''
// Publishing the owner approved outside RB Command: a row in creative_publish_queue (id = the idea, by = who approved
// it) is published on the next 10-minute tick with the same step as RB Command's Publish button, and keeps the result.
async function publishQueue(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS creative_publish_queue (id TEXT PRIMARY KEY, by TEXT NOT NULL, fields TEXT, requested_at TEXT NOT NULL DEFAULT (datetime('now')), result TEXT, done_at TEXT)").run();
  const { results } = await env.DB.prepare("SELECT id, by, fields FROM creative_publish_queue WHERE done_at IS NULL ORDER BY requested_at LIMIT 3").all();
  for (const q of results) {
    let fields = {}; try { fields = q.fields ? JSON.parse(q.fields) : {}; } catch (e) {}
    const started = nowIso();
    let r; try { r = await creative.publish(env, q.id, q.by, fields); } catch (e) { r = { error: String((e && e.message) || e) }; }
    const summary = (r.error ? "Not published: " + r.error : "Published: " + JSON.stringify(r.published)).slice(0, 500);
    await env.DB.prepare("UPDATE creative_publish_queue SET result = ?, done_at = ? WHERE id = ?").bind(summary, nowIso(), q.id).run();
    try { await logRun(env, "publish", q.by, started, !r.error, summary.slice(0, 200), { id: q.id }); } catch (e) {}
  }
}
'''
ANCHOR2 = "async function logRun(env, task, trigger, started, ok, summary, result) {"
if s.count(ANCHOR2) != 1:
    raise SystemExit("rb-autopilot: logRun not found")
s = s.replace(ANCHOR2, FN.lstrip("\n") + ANCHOR2)
p.write_text(s, encoding="utf-8")
print("rb-autopilot: publish queue (creative_publish_queue, run every 10 minutes)")
