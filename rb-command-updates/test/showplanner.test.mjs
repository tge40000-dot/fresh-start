// Usage: node --no-warnings rb-command-updates/test/showplanner.test.mjs <patched rb-command dir>
// Runs the show planner against an in-memory copy of RB's tables (talent, venues, events, shows), through the patched
// RB Command request handler where it can, and checks that the page renders and its script parses.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
const sp = await import(join(dir, "showplanner.js"));
const { handle } = await import(join(dir, "index.js"));
const { renderPage } = await import(join(dir, "ui.js"));

// ---------------------------------------------------------------- pure parts
assert.equal(sp.addDays("2026-10-30", 3), "2026-11-02");
assert.equal(sp.todayPacific(new Date("2026-10-17T05:30:00Z")), "2026-10-16", "dates are Pacific");
assert.equal(sp.longDate("2026-11-07"), "Saturday, November 7");
// From Fri 16 Oct: day 21 is Fri 6 Nov. Busy that day, so Sat 7 Nov.
assert.equal(sp.pickDate("2026-10-16", new Set(), []), "2026-11-06");
assert.equal(sp.pickDate("2026-10-16", new Set(["2026-11-06"]), []), "2026-11-07");
assert.equal(sp.pickDate("2026-10-16", new Set(), ["2026-11-07"]), "2026-11-13", "at least 6 days from another planned show");
const bay = sp.fit({ score: 80, location: "Oakland, CA", state: "CA", source: "rb_studio", status: "shortlisted", email: "a@b.co" });
const far = sp.fit({ score: 80, location: "Miami, FL", state: "FL", source: "audius", status: "new" });
assert.ok(bay.score > far.score && bay.why.includes("Bay Area") && bay.why.includes("shortlisted"));
assert.equal(sp.pickVenue([{ id: 1 }, { id: 2 }], { 1: { n: 2, last: "x" } }).id, 2, "least-used venue");

// ---------------------------------------------------------------- an in-memory D1
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE talent ( id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'artist', name TEXT NOT NULL, handle TEXT, location TEXT, state TEXT, genre TEXT, bio TEXT, followers INTEGER, plays INTEGER, tracks INTEGER, profile_url TEXT, sample_title TEXT, sample_url TEXT, instagram TEXT, tiktok TEXT, twitter TEXT, website TEXT, email TEXT, score INTEGER NOT NULL DEFAULT 0, reasons TEXT, ai_note TEXT, ai_message TEXT, ai_at TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'contacted', 'signed', 'passed')));
CREATE TABLE rb_events_venues (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, city TEXT DEFAULT "Oakland", icon TEXT DEFAULT "mic", status TEXT DEFAULT "live", created_at TEXT);
CREATE TABLE rb_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subtitle TEXT, description TEXT, category TEXT DEFAULT "comedy", starts_at TEXT NOT NULL, ends_at TEXT, door_time TEXT, venue_name TEXT, venue_address TEXT, cover_charge TEXT, ticket_url TEXT, image_url TEXT, lineup TEXT, featured INTEGER DEFAULT 0, ab_variant TEXT DEFAULT "A", sort_order INTEGER DEFAULT 0, status TEXT DEFAULT "live", created_at TEXT, updated_at TEXT);
CREATE TABLE shows (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, artist_handle TEXT, venue TEXT, city TEXT, starts_at TEXT NOT NULL, ticket_url TEXT, status TEXT DEFAULT 'live', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')));
INSERT INTO rb_events_venues (name, address, city, status) VALUES ('The New Parish', '1743 San Pablo Ave', 'Oakland', 'live'), ('Old Venue', '', 'Oakland', 'hidden'), ('Starline Social Club', '2236 MLK Jr Way', 'Oakland', 'live');
INSERT INTO talent (id, source, kind, name, location, state, genre, score, status, email, profile_url, sample_title) VALUES
 ('au_1', 'audius', 'artist', 'Lil Nova', 'Oakland, CA', 'CA', 'Hip-Hop/Rap', 82, 'shortlisted', 'nova@example.com', 'https://audius.co/lilnova', 'Lake Merritt'),
 ('au_2', 'audius', 'artist', 'Vallejo Vee', 'Vallejo, CA', 'CA', 'R&B/Soul', 70, 'new', '', 'https://audius.co/vvee', 'Slow Burn'),
 ('rb_3', 'rb_studio', 'artist', 'Sunny Keyz', 'Richmond, CA', 'CA', 'Hip-Hop/Rap', 55, 'new', 'keyz@example.com', '', 'Keys Out'),
 ('au_4', 'audius', 'artist', 'DJ Pulse', 'San Jose, CA', 'CA', 'House', 75, 'new', 'pulse@example.com', 'https://audius.co/pulse', 'Deep End'),
 ('au_5', 'audius', 'artist', 'Far Away', 'Miami, FL', 'FL', 'Trap', 60, 'new', '', 'https://audius.co/far', 'Heat'),
 ('au_6', 'audius', 'artist', 'Passed Pat', 'Oakland, CA', 'CA', 'Hip-Hop/Rap', 99, 'passed', 'p@example.com', '', ''),
 ('au_7', 'audius', 'artist', 'Techno Tee', 'Berkeley, CA', 'CA', 'Techno', 50, 'new', '', 'https://audius.co/tee', 'Loop'),
 ('au_8', 'audius', 'artist', 'Hayward Hal', 'Hayward, CA', 'CA', 'Rap', 40, 'new', '', '', ''),
 ('rb_9', 'rb_events', 'promoter', 'Town Nights', 'Oakland, CA', 'CA', '', 30, 'new', 'town@example.com', '', '');
`);
const today = sp.todayPacific();
const firstFree = sp.pickDate(today, new Set(), []);
db.prepare("INSERT INTO rb_events (title, starts_at, venue_name, status) VALUES (?, ?, 'The New Parish', 'live')").run("Comedy Night", firstFree + "T20:00:00");
db.prepare("INSERT INTO shows (title, venue, city, starts_at, status) VALUES ('Opal live', 'Yoshi''s', 'Oakland', ?, 'live')").run(sp.addDays(today, 5) + "T21:00:00");

class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a.map((v) => (v === undefined ? null : v))); }
  async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
const talentCalls = [];
const env = {
  DB: { prepare: (s) => new Stmt(s), batch: async (list) => { const out = []; db.exec("BEGIN"); try { for (const s of list) out.push(s.sql.trim().toUpperCase().startsWith("SELECT") ? await s.all() : await s.run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return out; } },
  AUTOPILOT: { updateTalent: async (id, patch) => { talentCalls.push([id, patch]); db.prepare("UPDATE talent SET status = ? WHERE id = ?").run(patch.status, id); return { ok: true, row: db.prepare("SELECT id, name FROM talent WHERE id = ?").get(id) }; } },
};
const owner = { email: "owner@example.com", name: "Owner", role: "owner" };
const call = async (method, path, body, user = owner) => {
  const init = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; init.headers["X-RB-Command"] = "1"; }
  try {
    const res = await handle(new Request("https://command.relentlessbillionaire.com" + path, init), env, { waitUntil() {} }, user);
    return { status: res.status, type: res.headers.get("Content-Type"), data: /json/.test(res.headers.get("Content-Type") || "") ? await res.json() : await res.text() };
  } catch (e) { return { status: e.status || 500, error: e.message }; }
};

// ---------------------------------------------------------------- suggesting
let r = await call("GET", "/api/shows/plans");
assert.equal(r.status, 200, JSON.stringify(r));
assert.equal(r.data.added, 3, "opening the planner tops it up to three suggestions");
assert.equal(r.data.plans.length, 3);
assert.deepEqual(r.data.venues.map((v) => v.name), ["Starline Social Club", "The New Parish"], "only live venues");
const plans = r.data.plans;
const [p1] = plans;
assert.ok(p1.lineup.length === 3 && p1.lineup[0].role === "Headliner");
assert.equal(p1.lineup[0].name, "Lil Nova", "best fit headlines");
assert.deepEqual(p1.lineup.slice(1).map((l) => l.name).sort(), ["Sunny Keyz", "Vallejo Vee"], "supports from the same genre family");
const names = plans.flatMap((p) => p.lineup.map((l) => l.name));
assert.equal(new Set(names).size, names.length, "nobody is on two plans");
assert.ok(!names.includes("Passed Pat") && !names.includes("Town Nights"), "passed artists and promoters aren't booked");
const dates = plans.map((p) => p.starts_at.slice(0, 10)).sort();
for (const d of dates) {
  const wd = new Date(d + "T12:00:00Z").getUTCDay();
  assert.ok(wd === 5 || wd === 6, `${d} is a Friday or Saturday`);
  assert.ok(d >= sp.addDays(today, 21) && d <= sp.addDays(today, 90));
  assert.notEqual(d, firstFree, "skips the day RB already has an event");
}
for (let i = 1; i < dates.length; i++) assert.ok((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000 >= 6, "shows are spread out");
assert.notEqual(plans[0].venue_id, plans[1].venue_id, "venues take turns");
assert.match(p1.starts_at, /T21:00:00$/); assert.equal(p1.door_time, "8:00 PM");
assert.ok(p1.scope.run_of_show.length >= 10 && p1.scope.run_of_show.at(-1).label === "12 AM", "run of show ends at midnight");
assert.equal(p1.scope.run_of_show.find((x) => x.item.startsWith("Lil Nova")).time, "22:30");
assert.ok(p1.scope.budget.every((b) => b.amount === null), "no invented amounts");
assert.match(p1.scope.tickets.price, /To set/);

r = await call("GET", "/api/shows/plans");
assert.equal(r.data.added, 0, "tops up at most once a day");

// ---------------------------------------------------------------- the plan's emails, tasks and posts
r = await call("GET", `/api/shows/plan/${p1.id}`);
const items = r.data.items;
const mails = items.filter((i) => i.kind === "outreach");
assert.equal(mails.length, 5, "venue, three artists and the local promoter");
const venueMail = mails.find((i) => i.target_type === "venue");
assert.match(venueMail.subject, /Date hold request/); assert.ok(venueMail.body.includes("Lil Nova") && /capacity, age policy and curfew/.test(venueMail.body));
const nova = mails.find((i) => i.target_id === "au_1");
assert.equal(nova.to_email, "nova@example.com");
assert.match(nova.body, /\[fee or door split\]/, "fees left for a person to fill in");
assert.match(nova.body, /"Lake Merritt"/); assert.match(nova.body, /10:30 PM/);
assert.ok(!/\$\d/.test(items.map((i) => i.body || "").join(" ")), "no prices anywhere");
assert.ok(mails.find((i) => i.target_name === "Town Nights"), "local promoter invited to co-promote");
assert.equal(mails.find((i) => i.target_id === "rb_3").body.includes("your submission to RB"), true);
assert.equal(items.filter((i) => i.kind === "task").length, 12);
const posts = items.filter((i) => i.kind === "content");
assert.equal(posts.length, 9, "announcement, flyer, three spotlights, ticket push, countdown, show day, recap");
assert.ok(posts.every((i) => i.channel && i.body));
assert.ok(items.every((i) => i.due_on >= today), "nothing is due in the past");
assert.equal(posts.find((i) => i.title === "Show day").due_on, p1.starts_at.slice(0, 10));

// ---------------------------------------------------------------- calendar and .ics
r = await call("GET", "/api/shows/calendar");
assert.ok(r.data.entries.some((e) => e.type === "plan" && e.status === "suggested"));
assert.ok(r.data.entries.some((e) => e.type === "event" && e.title === "Comedy Night") && r.data.entries.some((e) => e.type === "show"));
assert.ok(!r.data.entries.some((e) => e.type === "outreach"), "a suggestion's emails stay off the calendar until it's planned");

r = await call("POST", `/api/shows/plan/${p1.id}`, { status: "planning" });
assert.equal(r.data.plan.status, "planning");
r = await call("GET", "/api/shows/calendar");
assert.ok(r.data.entries.filter((e) => e.plan_id === p1.id).length === items.length, "planned: every email, task and post is on the calendar");
r = await call("GET", "/api/shows/calendar.ics");
assert.match(r.type, /text\/calendar/);
assert.ok(r.data.startsWith("BEGIN:VCALENDAR\r\n") && r.data.trimEnd().endsWith("END:VCALENDAR"));
assert.ok(r.data.includes(`DTSTART;TZID=America/Los_Angeles:${p1.starts_at.slice(0, 10).replace(/-/g, "")}T210000`));
assert.ok(r.data.split("\r\n").every((l) => l.length <= 75), "lines are folded");
assert.ok(!r.data.includes(plans[1].title.slice(0, 30)), "suggestions stay out of the .ics");

// ---------------------------------------------------------------- working the plan
r = await call("POST", `/api/shows/item/${nova.id}`, { to_email: "not an email" });
assert.equal(r.status, 400);
r = await call("POST", `/api/shows/item/${nova.id}`, { status: "sent", subject: nova.subject + " (v2)" });
assert.equal(r.data.item.status, "sent"); assert.equal(r.data.item.done_by, owner.email); assert.match(r.data.item.subject, /\(v2\)$/);
assert.equal(r.data.talent, "contacted");
assert.equal(db.prepare("SELECT status FROM talent WHERE id = 'au_1'").get().status, "contacted", "Talent shows them contacted");
const editorEvents = { email: "ev@example.com", name: "Ev", role: "events" };
const auth = await import(join(dir, "auth.js")), evRole = auth.ROLES;
const eventsOnly = Object.keys(evRole).find((k) => auth.can(k, "Events", "edit") && !auth.can(k, "CRM", "edit"));
if (eventsOnly) {
  const mail2 = mails.find((i) => i.target_id === "au_2");
  r = await call("POST", `/api/shows/item/${mail2.id}`, { status: "sent" }, { ...editorEvents, role: eventsOnly });
  assert.equal(r.status, 200); assert.equal(r.data.talent, null, "people without Talent edit rights don't change Talent");
}
r = await call("POST", `/api/shows/item/${posts[0].id}`, { status: "done" });
assert.ok(r.data.item.done_at);

// Move the show a week: open items move with it, finished ones don't.
const task = items.find((i) => i.kind === "task" && i.status === "todo");
const newStart = sp.addDays(p1.starts_at.slice(0, 10), 7) + "T21:00";
r = await call("POST", `/api/shows/plan/${p1.id}`, { starts_at: newStart });
assert.equal(r.data.plan.starts_at, newStart + ":00");
assert.equal(r.data.items.find((i) => i.id === task.id).due_on, sp.addDays(task.due_on, 7));
assert.equal(r.data.items.find((i) => i.id === nova.id).due_on, nova.due_on, "sent email keeps its date");

// Budget and tickets
r = await call("POST", `/api/shows/plan/${p1.id}`, { budget: [{ line: "Sound engineer", amount: "250", notes: "quoted" }, { line: "DJ", amount: "", notes: "" }], tickets: { price: "$15 door", capacity: "400", link: "", age: "21+" } });
assert.deepEqual(r.data.plan.scope.budget, [{ line: "Sound engineer", amount: 250, notes: "quoted" }, { line: "DJ", amount: null, notes: "" }]);
assert.equal(r.data.plan.scope.tickets.age, "21+");
r = await call("POST", `/api/shows/plan/${p1.id}`, { budget: [{ line: "x", amount: "-4" }] });
assert.equal(r.status, 400);

// Swap: Vallejo Vee can't make it. The next free artist takes the slot; unsent emails and posts follow.
assert.equal((await call("POST", `/api/shows/plan/${p1.id}/swap`, { talent_id: "au_2" })).status, 409, "every artist is booked, so nobody to swap in");
db.prepare("INSERT INTO talent (id, source, kind, name, location, state, genre, score, status, email) VALUES ('au_10', 'audius', 'artist', 'Town Ty', 'Oakland, CA', 'CA', 'Hip-Hop/Rap', 65, 'new', 'ty@example.com'), ('au_11', 'audius', 'artist', 'Disco Dee', 'Oakland, CA', 'CA', 'Disco', 90, 'new', '')").run();
const before = (await call("GET", `/api/shows/plan/${p1.id}`)).data;
const vee = before.plan.lineup.find((l) => l.talent_id === "au_2");
r = await call("POST", `/api/shows/plan/${p1.id}/swap`, { talent_id: "au_2" });
assert.equal(r.status, 200, JSON.stringify(r));
const incoming = r.data.swapped.in;
assert.equal(r.data.swapped.out, "Vallejo Vee");
assert.equal(incoming, "Town Ty", "same genre family first, even over a higher score");
const now = r.data.plan.lineup.find((l) => l.name === incoming);
assert.equal(now.role, vee.role); assert.equal(now.set_start, vee.set_start);
const after = r.data.items;
assert.ok(after.find((i) => i.kind === "outreach" && i.target_name === incoming && i.status === "todo"), "a booking email for the new act");
if (eventsOnly) assert.ok(after.find((i) => i.target_id === "au_2" && i.status === "sent"), "an email already sent stays on record");
const openText = after.filter((i) => i.status === "todo").map((i) => `${i.title} ${i.subject || ""} ${i.body || ""}`).join(" ");
assert.ok(!openText.includes("Vallejo Vee"), "the old name is gone from everything not yet sent");
assert.ok(after.find((i) => i.title === `Artist spotlight: ${incoming}`));
assert.ok(!r.data.plan.reasons.includes("Vallejo Vee:"));
r = await call("POST", `/api/shows/plan/${p1.id}/swap`, { talent_id: "nobody" });
assert.equal(r.status, 404);

// Targeted suggestion: a chosen venue and date.
const venue = (await call("GET", "/api/shows/plans")).data.venues[0];
const want = sp.addDays(today, 50);
r = await call("POST", "/api/shows/suggest", { date: want, venue_id: venue.id });
assert.equal(r.status, 200, JSON.stringify(r));
if (r.data.made.length) {
  const g = (await call("GET", `/api/shows/plan/${r.data.made[0].id}`)).data.plan;
  assert.equal(g.starts_at.slice(0, 10), want); assert.equal(g.venue_id, venue.id);
}
assert.equal((await call("POST", "/api/shows/suggest", { date: today })).status, 400);
assert.equal((await call("POST", "/api/shows/suggest", { venue_id: 2 })).status, 400, "hidden venue refused");

// ---------------------------------------------------------------- to Events
r = await call("POST", `/api/shows/plan/${p1.id}/event`, {});
assert.equal(r.status, 409, "has to be confirmed first");
await call("POST", `/api/shows/plan/${p1.id}`, { status: "confirmed" });
r = await call("POST", `/api/shows/plan/${p1.id}/event`, {});
assert.equal(r.status, 200);
const ev = db.prepare("SELECT * FROM rb_events WHERE id = ?").get(r.data.rb_event_id);
assert.equal(ev.status, "draft", "goes to Events as a draft, not live");
assert.equal(ev.venue_name, p1.venue_name); assert.match(ev.lineup, /Lil Nova \(headliner, 10:30 PM\)/); assert.equal(ev.category, "live-music");
r = await call("GET", `/api/shows/plan/${p1.id}`);
assert.equal(r.data.plan.status, "published");
assert.equal(r.data.items.find((i) => i.title.startsWith("Add the show to /events")).status, "done");
assert.equal((await call("POST", `/api/shows/plan/${p1.id}/event`, {})).data.existing, true, "never adds it twice");
assert.equal((await call("POST", `/api/shows/plan/${p1.id}/swap`, { talent_id: "au_1" })).status, 409);

// ---------------------------------------------------------------- overview, permissions, log
const ov = await sp.overview(env);
assert.ok(ov.suggested >= 2 && ov.shows.every((s) => s.kind === "plan"));
assert.equal((await call("POST", `/api/shows/plan/${p1.id}`, { status: "planning" }, { ...owner, role: "support" })).status, 403);
const viewerRole = Object.keys(evRole).find((k) => !auth.can(k, "Events", "view") && !evRole[k].limited);
if (viewerRole) assert.equal((await call("GET", "/api/shows/plans", undefined, { ...owner, role: viewerRole })).status, 403, "no Events access, no planner");
assert.ok(db.prepare("SELECT count(*) AS n FROM command_log WHERE action LIKE 'shows.%'").get().n >= 6, "every change is logged");
assert.equal(talentCalls.length, 1);

// ---------------------------------------------------------------- the page
const tables = { rb_events: { label: "Events", group: "Events", canEdit: true, fields: {} }, ads: { label: "Ads", group: "Money", canEdit: true, fields: {} } };
const html = renderPage("N0NCE", { me: { email: "o@x", name: "O", role: "owner", caps: { groups: { Events: "edit", Money: "edit", Content: "edit", CRM: "edit" }, label: "Owner" } }, links: {}, media: "", tables, groups: ["Events"], uploads: true, autopilot: true });
const script = html.match(/<script nonce="N0NCE">([\s\S]*?)<\/script>/);
assert.ok(script, "page has its script");
const f = join(mkdtempSync(join(tmpdir(), "rbc-")), "client.js");
writeFileSync(f, script[1]);
execFileSync(process.execPath, ["--check", f]);
assert.ok(html.includes('NAV_TOP.push(["shows", "Show planner"])') && html.includes("function viewShows(params)") && html.includes("function viewShowPlan(id, focus)"));
assert.ok(html.includes('e.kind === "plan" ? "#/shows?id="'), "Overview links planned shows to their plan");
assert.ok(html.includes(".calgrid{"), "styles are in the stylesheet");
console.log(`show planner ok: suggestions (${plans.length}, dates, venues, lineups), emails, tasks, posts, calendar, .ics, Talent sync, moving, budget, swap (${incoming}), Events draft, permissions, page script parses`);
