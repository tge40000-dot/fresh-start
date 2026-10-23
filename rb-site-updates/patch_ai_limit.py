"""A real rate limit for the free AI endpoints (relentless-billionaire-api: /ai/platform/* and /ai/studio/*).

Usage: python3 -I patch_ai_limit.py <pulled relentless-billionaire-api dir>

The old cooldowns wrote a KV key that expired after 8 to 20 seconds. KV refuses expiry under 60 seconds, so every
write threw, the error was swallowed and every request was let through: in practice there was no limit at all.

This counts requests in the Worker's existing D1 database (env.DB). One table, rb_ai_usage, is created if it is missing:
one row per (feature, visitor, window), and each count is a single atomic upsert, so the counts are exact. Visitors
are stored as a SHA-256 hash of their IP, never the IP itself. Every visitor gets a per-minute, per-hour and
per-day allowance for each feature, and each feature has a site-wide daily cap that protects the AI bill. Over a
limit, the endpoint answers 429 with Retry-After and a plain message saying when to try again. Old rows are swept
now and then. If the database can't be reached, requests are let through as before, so the tools never go down
because of the limit.
Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "script.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"relentless-billionaire-api: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


LIMITER = r'''// Per visitor: [per minute, per hour, per day]; "all" is the site-wide daily cap for the feature.
var RB_AI_LIMITS = {
  image: { minute: 6, hour: 40, day: 120, all: 3000 },
  speech: { minute: 20, hour: 200, day: 600, all: 20000 },
  transcription: { minute: 6, hour: 60, day: 200, all: 5000 },
  text: { minute: 20, hour: 200, day: 600, all: 20000 },
  vision: { minute: 10, hour: 100, day: 300, all: 5000 },
  safety: { minute: 30, hour: 300, day: 1000, all: 30000 },
  embeddings: { minute: 30, hour: 300, day: 1000, all: 30000 },
  studio: { minute: 6, hour: 60, day: 200, all: 5000 }
};
var rbAiLimitReady = null;
// Counts one request; returns { ok } or { ok: false, retry (seconds), scope }. Lets the request through if D1 fails.
async function rbAiLimit(request, env, feature) {
  const lim = RB_AI_LIMITS[feature];
  if (!lim || !env.DB) return { ok: true };
  try {
    await (rbAiLimitReady ||= env.DB.prepare("CREATE TABLE IF NOT EXISTS rb_ai_usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)").run().catch((e) => { rbAiLimitReady = null; throw e; }));
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rb-ai-limit:" + ip)));
    const who = Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
    const now = Math.floor(Date.now() / 1000);
    const upsert = "INSERT INTO rb_ai_usage (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n";
    const count = (name, len, id) => { const start = Math.floor(now / len) * len; return env.DB.prepare(upsert).bind(feature + ":" + name + ":" + id + ":" + start, start + len); };
    const over = (name, len, n, max) => n > max ? { ok: false, scope: name, retry: Math.max(1, Math.floor(now / len) * len + len - now) } : null;
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rb_ai_usage WHERE exp < ?").bind(now).run().catch(() => {});
    // The visitor's own allowances first. Only a request inside them counts toward the site-wide cap, so one client
    // hammering the endpoint can't use up the day's cap for everyone else.
    const mine = [["minute", 60, lim.minute], ["hour", 3600, lim.hour], ["day", 86400, lim.day]];
    const res = await env.DB.batch(mine.map(([name, len]) => count(name, len, who)));
    for (let i = 0; i < mine.length; i++) { const v = over(mine[i][0], mine[i][1], res[i]?.results?.[0]?.n || 0, mine[i][2]); if (v) return v; }
    const all = await count("all", 86400, "all").first();
    return over("all", 86400, all?.n || 0, lim.all) || { ok: true };
  } catch (_) { return { ok: true }; }
}
function rbAiLimitMessage(v) {
  const wait = v.retry < 90 ? `${v.retry} seconds` : v.retry < 5400 ? `${Math.ceil(v.retry / 60)} minutes` : `${Math.ceil(v.retry / 3600)} hours`;
  return v.scope === "all" ? `This free AI tool has reached today's limit for the whole site. Try again in ${wait}.` : `You've reached the free limit for now. Try again in ${wait}.`;
}
'''

OLD_COUNTING = '    const windows = [["minute", 60, lim.minute, who], ["hour", 3600, lim.hour, who], ["day", 86400, lim.day, who], ["all", 86400, lim.all, "all"]];\n    const upsert = "INSERT INTO rb_ai_usage (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n";\n    const res = await env.DB.batch(windows.map(([name, len, , id]) => {\n      const start = Math.floor(now / len) * len;\n      return env.DB.prepare(upsert).bind(feature + ":" + name + ":" + id + ":" + start, start + len);\n    }));\n    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rb_ai_usage WHERE exp < ?").bind(now).run().catch(() => {});\n    for (let i = 0; i < windows.length; i++) {\n      const [name, len, max] = windows[i], n = res[i]?.results?.[0]?.n || 0;\n      if (n > max) return { ok: false, scope: name, retry: Math.max(1, Math.floor(now / len) * len + len - now) };\n    }\n    return { ok: true };\n'
if OLD_COUNTING in s:
    s = s.replace(OLD_COUNTING, '    const upsert = "INSERT INTO rb_ai_usage (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n";\n    const count = (name, len, id) => { const start = Math.floor(now / len) * len; return env.DB.prepare(upsert).bind(feature + ":" + name + ":" + id + ":" + start, start + len); };\n    const over = (name, len, n, max) => n > max ? { ok: false, scope: name, retry: Math.max(1, Math.floor(now / len) * len + len - now) } : null;\n    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rb_ai_usage WHERE exp < ?").bind(now).run().catch(() => {});\n    // The visitor\'s own allowances first. Only a request inside them counts toward the site-wide cap, so one client\n    // hammering the endpoint can\'t use up the day\'s cap for everyone else.\n    const mine = [["minute", 60, lim.minute], ["hour", 3600, lim.hour], ["day", 86400, lim.day]];\n    const res = await env.DB.batch(mine.map(([name, len]) => count(name, len, who)));\n    for (let i = 0; i < mine.length; i++) { const v = over(mine[i][0], mine[i][1], res[i]?.results?.[0]?.n || 0, mine[i][2]); if (v) return v; }\n    const all = await count("all", 86400, "all").first();\n    return over("all", 86400, all?.n || 0, lim.all) || { ok: true };\n')
    changed.append("visitor limits before the site-wide cap")
rep("async function rbAiAllowRequest(request, env, feature) {\n", LIMITER + "async function rbAiAllowRequest(request, env, feature) {\n", "D1 limiter")
rep('  if (!await rbAiAllowRequest(request, env, feature)) return rbAiJson({ ok: false, error: { code: "rate_limited", message: "Please wait before retrying." } }, 429, origin);\n',
    '  const rbLimit = await rbAiLimit(request, env, feature);\n'
    '  if (!rbLimit.ok) return new Response(JSON.stringify({ ok: false, error: { code: "rate_limited", message: rbAiLimitMessage(rbLimit), retry_after: rbLimit.retry } }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rbLimit.retry), "Access-Control-Expose-Headers": "Retry-After", ...rbAiCorsHeaders(origin) } });\n',
    "platform limit")
rep('  if (!await allowStudioAiRequest(request, env)) return studioAiJson({ ok: false, error: { code: "rate_limited", message: "Please wait a few seconds before generating again." } }, 429);\n',
    '  const rbLimit = await rbAiLimit(request, env, "studio");\n'
    '  if (!rbLimit.ok) return studioAiJson({ ok: false, error: { code: "rate_limited", message: rbAiLimitMessage(rbLimit), retry_after: rbLimit.retry } }, 429);\n',
    "studio limit")
p.write_text(s, encoding="utf-8")
print("relentless-billionaire-api: " + (", ".join(changed) + " updated" if changed else "limit already in place"))
