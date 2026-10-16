/**
 * Show planner: an event and content calendar that plans RB shows from the Talent section.
 *
 * It suggests a show (date, venue, headliner and support acts) from the artists the talent scout and RB's own
 * submissions brought in, then drafts everything a show needs: a booking email for each artist, the venue and a local
 * promoter; the full scope (run of show, roles, production, tickets, budget lines, risks); the to-do list with due
 * dates; and the content calendar (announcement, artist spotlights, ticket pushes, day-of, recap). All of it lands on
 * RB Command's calendar and in an .ics file for Google or Apple Calendar.
 *
 * Nothing is sent or published on its own. Emails are drafts a person opens in their email app; marking one sent also
 * marks the artist contacted in Talent. A confirmed show goes to /events as a draft for a person to set live.
 * Suggestions use only facts RB already holds (names, cities, genres, a track title, venues); prices, fees and
 * capacities are left for a person to fill in rather than guessed.
 */
import { HttpError } from "./tables.js";

const TZ = "America/Los_Angeles";
const ACTIVE = ["suggested", "planning", "confirmed"];
const STATUSES = ["suggested", "planning", "confirmed", "published", "dropped"];
const ITEM_STATUSES = ["todo", "done", "sent", "skipped"];
const URBAN = /hip-?hop|rap|r&b|rnb|soul|trap|drill/i;
const DANCE = /house|electro|techno|afro|edm|dance|disco|dj\b|club/i;
const BAY = /\b(oakland|vallejo|san francisco|sf|bay area|east bay|richmond|berkeley|san jose|hayward|fremont|sacramento|antioch|pittsburg|fairfield|stockton|san ramon|walnut creek|concord|daly city|alameda)\b/i;

const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const text = (s, n) => String(s == null ? "" : s).replace(/\r\n/g, "\n").trim().slice(0, n);

// ---------------------------------------------------------------- storage
let ready = null;
export function ensure(env) {
  return (ready ||= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS show_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, concept TEXT, category TEXT NOT NULL DEFAULT 'live-music',
      starts_at TEXT NOT NULL, ends_at TEXT, door_time TEXT, venue_id INTEGER, venue_name TEXT, venue_city TEXT, venue_address TEXT,
      lineup TEXT NOT NULL DEFAULT '[]', scope TEXT NOT NULL DEFAULT '{}', score INTEGER NOT NULL DEFAULT 0, reasons TEXT,
      status TEXT NOT NULL DEFAULT 'suggested', rb_event_id INTEGER, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS show_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, due_on TEXT NOT NULL,
      target_type TEXT, target_id TEXT, target_name TEXT, to_email TEXT, subject TEXT, body TEXT, channel TEXT,
      status TEXT NOT NULL DEFAULT 'todo', done_at TEXT, done_by TEXT, sort INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS show_plan_items_plan ON show_plan_items (plan_id, kind, sort)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS show_plan_items_due ON show_plan_items (due_on)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS show_plans_start ON show_plans (status, starts_at)"),
  ])
    // Clicks on each post's link (relentlessbillionaire.com/go/post/<id>, counted by the main site). Already there: fine.
    .then(() => env.DB.prepare("ALTER TABLE show_plan_items ADD COLUMN clicks INTEGER NOT NULL DEFAULT 0").run().catch(() => {}))
    .catch((e) => { ready = null; throw e; }));
}

const log = (env, actor, action, target, detail) =>
  env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, ?, ?, ?)").bind(actor, action, target == null ? null : String(target), String(detail).slice(0, 500)).run();

// ---------------------------------------------------------------- dates (Pacific, as the rest of RB Command)
/** Today's date in Pacific time, "YYYY-MM-DD". */
export function todayPacific(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
export const longDate = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const clock = (hm) => { const [h, m] = hm.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 && h < 24 ? "PM" : "AM"}`; };

// ---------------------------------------------------------------- choosing artists, venue and date
const family = (t) => (URBAN.test(t.genre || "") ? "urban" : DANCE.test(`${t.genre || ""} ${t.name || ""}`) ? "dance" : "other");
const cityOf = (t) => clip(String(t.location || "").split(",")[0], 40) || (t.state ? t.state : "");

/** How well an artist fits an RB show in the Bay Area, with the reasons. */
export function fit(t) {
  let s = Math.min(Number(t.score) || 0, 100) * 0.6;
  const why = [];
  if (BAY.test(t.location || "")) { s += 25; why.push("Bay Area"); } else if (t.state === "CA") { s += 12; why.push("California"); }
  if (/^rb_/.test(t.source || "")) { s += 15; why.push("came to RB directly"); }
  if (t.status === "signed") { s += 30; why.push("signed"); } else if (t.status === "shortlisted") { s += 20; why.push("shortlisted"); } else if (t.status === "contacted") { s += 5; why.push("already in touch"); }
  if (t.email) { s += 5; why.push("has an email"); }
  if (t.sample_title) why.push(`track "${clip(t.sample_title, 40)}"`);
  return { score: Math.round(s), why };
}

/** Pick a headliner and up to two supports from one genre family, skipping anyone already on an active or recent plan. */
export function pickLineup(talent, taken) {
  const pool = talent.filter((t) => t.kind === "artist" && t.status !== "passed" && !taken.has(t.id)).map((t) => ({ t, ...fit(t) })).sort((a, b) => b.score - a.score);
  if (!pool.length) return null;
  const head = pool[0], fam = family(head.t);
  const same = pool.slice(1).filter((x) => family(x.t) === fam);
  const rest = pool.slice(1).filter((x) => family(x.t) !== fam);
  const supports = same.concat(rest).slice(0, 2);
  return { family: fam, acts: [head, ...supports] };
}

/** The first free Friday or Saturday 3 to 13 weeks out, at least 6 days from other planned shows and not on a day RB already has something. */
export function pickDate(today, busy, planned) {
  for (let n = 21; n <= 90; n++) {
    const d = addDays(today, n), wd = weekday(d);
    if (wd !== 5 && wd !== 6) continue;
    if (busy.has(d)) continue;
    if (planned.some((p) => Math.abs(daysBetween(p, d)) < 6)) continue;
    return d;
  }
  return null;
}

/** The live venue used least by plans, oldest use first. */
export function pickVenue(venues, uses) {
  return venues.slice().sort((a, b) => (uses[a.id]?.n || 0) - (uses[b.id]?.n || 0) || String(uses[a.id]?.last || "").localeCompare(String(uses[b.id]?.last || "")) || a.id - b.id)[0] || null;
}

// ---------------------------------------------------------------- the plan
const SLOTS = [["22:30", 45, "Headliner"], ["21:45", 30, "Support"], ["21:00", 30, "Opener"]];

export function buildPlan({ date, venue, acts, fam, promoter, sender = "[Your name]" }) {
  const category = fam === "dance" ? "nightlife" : "live-music";
  const lineup = acts.map((a, i) => ({ talent_id: a.t.id, name: clip(a.t.name, 80), role: SLOTS[i][2], set_start: SLOTS[i][0], set_minutes: SLOTS[i][1],
    city: cityOf(a.t), genre: clip(a.t.genre, 40), profile_url: a.t.profile_url || "", sample: clip(a.t.sample_title, 80), email: a.t.email || "", source: a.t.source || "" }));
  const head = lineup[0];
  const names = lineup.map((l) => l.name);
  const genre = fam === "urban" ? "hip-hop and R&B" : fam === "dance" ? "house and electronic" : "live music";
  const title = clip(`RB Presents: ${head.name} Live at ${venue.name}`, 140);
  const concept = `A ${genre} night at ${venue.name}${venue.city ? " in " + clip(venue.city, 40) : ""} with ${names.join(", ")}. Doors at 8 PM with a DJ, three live sets from 9 PM, done by midnight. RB books the lineup and promotes it; the venue hosts.`;
  const ros = [
    ["18:00", "Load-in, stage and DJ booth set up (venue and RB crew)"], ["19:00", "Line check and sound check, headliner first, opener last"],
    ["19:45", "Doors team briefed: guest list, cover, wristbands"], ["20:00", "Doors open, DJ set"],
    ...lineup.slice().reverse().map((l) => [l.set_start, `${l.name} (${l.role.toLowerCase()}, ${l.set_minutes} min)`]),
    ["23:15", "Headliner done; DJ back on, merch and photos"], ["23:45", "Last song, house lights, thank-yous"], ["00:00", "Venue close; settle with the venue and artists"],
  ].sort((a, b) => (a[0] < "12" ? "24" + a[0] : a[0]).localeCompare(b[0] < "12" ? "24" + b[0] : b[0])).map(([time, item]) => ({ time, label: clock(time), item }));
  const scope = {
    summary: concept, genre, date, date_label: longDate(date), doors: "8 PM", ends: "Midnight",
    run_of_show: ros,
    lineup,
    roles: [
      { role: "Promoter and host", who: "RB", notes: "Books the lineup, runs promotion, MCs between sets." },
      ...(promoter ? [{ role: "Local co-promoter", who: clip(promoter.name, 80), notes: "Invited to co-promote (see their outreach email)." }] : []),
      { role: "Venue contact", who: venue.name, notes: "Hold, terms, bar, security and settlement." },
      { role: "Sound engineer", who: "Ask the venue; book one if they don't supply it", notes: "Runs line check and the night." },
      { role: "DJ", who: "To book", notes: "Doors, between sets and after the headliner." },
      { role: "Door and tickets", who: "RB", notes: "Guest list, cover or ticket scans." },
      { role: "Photo and video", who: "RB", notes: "Clips for the recap and each artist's spotlight." },
      { role: "Stage manager", who: "RB", notes: "Keeps set times; artist contact on the night." },
    ],
    production: [
      `Vocal mics: ${lineup.length + 1} (one per act plus the host), with stands`,
      "Playback: DJ mixer and a laptop or USB input for artists performing to tracks",
      "Stage monitors for the performers",
      "Lighting: the venue's house lights; ask what they have",
      "Each artist's needs (backing tracks, extra mics, hype person): ask in the booking reply",
      "Merch table near the exit, if artists bring merch",
    ],
    tickets: { price: "To set once venue terms are known", capacity: "Ask the venue", link: "Create after the date is confirmed", age: "Ask the venue (21+ if the bar requires it)" },
    budget: ["Artist fees or door split", "Venue rental, bar minimum or door split", "Sound engineer", "DJ", "Door staff and security", "Photo and video", "Flyer design and paid promotion", "Hospitality (water, green room)"].map((line) => ({ line, amount: null, notes: "" })),
    risks: [
      "An artist drops out: keep the next suggestion in Talent as a standby and say so in their email.",
      "Set times overrun: the stage manager calls time; the headliner set is fixed.",
      "Venue curfew or capacity: confirm both before announcing.",
      "Low pre-sales at the ticket push: add a second spotlight round and ask each artist to share.",
    ],
  };
  const fit3 = acts.map((a) => a.score);
  const score = Math.round(fit3.reduce((x, y) => x + y, 0) / fit3.length);
  const reasons = acts.map((a) => `${clip(a.t.name, 40)}: ${a.why.join(", ") || "scored by the scout"}`).join(" · ");
  return { title, concept, category, starts_at: `${date}T21:00:00`, ends_at: `${addDays(date, 1)}T00:00:00`, door_time: "8:00 PM", lineup, scope, score, reasons, items: items({ title, date, venue, lineup, promoter, sender, genre }) };
}

const tagsFor = (venue, genre) => {
  const city = clip(venue.city || "Oakland", 30).replace(/[^A-Za-z]/g, "");
  return ["#RelentlessBillionaire", `#${city}Music`, city.toLowerCase() === "oakland" ? "#OaklandNightlife" : `#${city}Nightlife`, genre.startsWith("hip") ? "#BayAreaHipHop" : genre.startsWith("house") ? "#BayAreaHouse" : "#BayAreaMusic"].join(" ");
};

/** Outreach drafts, tasks and the content calendar, each with a due date counted back from the show. */
export function items({ title, date, venue, lineup, promoter, sender, genre }) {
  const out = [], today = todayPacific();
  const due = (offset) => { const d = addDays(date, offset); return d < today && offset < 0 ? today : d; };
  const when = `${longDate(date)} at ${venue.name}${venue.city ? ", " + clip(venue.city, 40) : ""}`;
  const names = lineup.map((l) => l.name).join(", ");
  const sig = `${sender}\nRelentless Billionaire\nrelentlessbillionaire.com`;
  // Venue first: nothing is announced without the hold.
  out.push({ kind: "outreach", title: `Hold the date with ${venue.name}`, due_on: due(-45), target_type: "venue", target_id: String(venue.id), target_name: venue.name, to_email: "",
    subject: `Date hold request: ${longDate(date)} (Relentless Billionaire)`,
    body: `Hi ${venue.name} team,\n\nI'm with Relentless Billionaire, the Bay Area music and events brand behind relentlessbillionaire.com/events. We'd like to hold ${longDate(date)} for a ${genre} night: doors at 8 PM with a DJ, three live sets from 9 PM (${names}), finished by midnight.\n\nRB books and promotes the lineup. Could you let us know:\n- whether the date is open, and how a hold works\n- your terms (rental, bar minimum or door split)\n- capacity, age policy and curfew\n- sound: is there an engineer and a PA with vocal mics, monitors and a DJ setup?\n\nHappy to call if that's easier.\n\n${sig}` });
  lineup.forEach((l, i) => {
    const how = /^rb_/.test(l.source) ? "your submission to RB" : l.sample ? `"${l.sample}"` : "your music";
    out.push({ kind: "outreach", title: `Book ${l.name} (${l.role.toLowerCase()})`, due_on: due(-40), target_type: "artist", target_id: l.talent_id, target_name: l.name, to_email: l.email,
      subject: `Booking inquiry: ${longDate(date)}, ${venue.name} (Relentless Billionaire)`,
      body: `Hi ${l.name},\n\nI'm with Relentless Billionaire in the Bay Area. We found ${how}${l.profile_url && !/^rb_/.test(l.source) ? ` (${l.profile_url})` : ""} and we're putting together a show on ${when}. We'd like you on the bill as the ${l.role.toLowerCase()}: a ${l.set_minutes}-minute set at about ${clock(l.set_start)}.\n\nThe date and venue are being confirmed now. Terms ([fee or door split]) and any travel are to agree with you before anything is announced.\n\nIf you're interested, reply with:\n- your availability that night\n- what you need on stage (backing tracks, mics, a DJ or hype person)\n- the best contact for booking\n\n${sig}`, sort: i + 1 });
  });
  if (promoter) out.push({ kind: "outreach", title: `Invite ${promoter.name} to co-promote`, due_on: due(-35), target_type: "artist", target_id: promoter.id, target_name: promoter.name, to_email: promoter.email || "",
    subject: `Co-promote a show on ${longDate(date)}? (Relentless Billionaire)`,
    body: `Hi ${promoter.name},\n\nI'm with Relentless Billionaire. We're planning a ${genre} night on ${when} with ${names}. You've put on events in the area, and we'd like to co-promote it with you: shared promotion, your guest list and a share we'd agree together.\n\nWould you be open to a quick call this week?\n\n${sig}`, sort: 9 });
  const tasks = [
    [-42, "Confirm the venue hold and terms in writing"], [-35, "Confirm every act and their stage needs; update the plan if anyone declines"],
    [-32, "Set the ticket or cover price with the venue"], [-30, "Create the ticket or RSVP link"],
    [-28, "Add the show to /events (RB Command: Add to Events, then set it live)"], [-25, "Make the lineup flyer (square and story sizes)"],
    [-14, "Book the DJ, door staff and photo/video"], [-10, "Advance production with the venue: sound, lights, load-in time"],
    [-7, "Send set times and arrival times to every act"], [-2, "Print the guest list and run of show"],
    [0, "Show day: load-in 6 PM, line check 7 PM, doors 8 PM"], [1, "Settle with the venue and artists; save the numbers to this plan"],
  ];
  tasks.forEach(([o, t], i) => out.push({ kind: "task", title: t, due_on: due(o), sort: i }));
  const tags = tagsFor(venue, genre);
  const content = [
    [-28, "Announcement", "Instagram and TikTok post, /events", `${title}. ${longDate(date)} at ${venue.name}${venue.city ? ", " + clip(venue.city, 40) : ""}. Lineup: ${names}. Doors 8 PM. Tickets: link in bio.\n\n${tags}`],
    [-25, "Lineup flyer", "Instagram post and story", `The lineup for ${longDate(date)}: ${names}. ${venue.name}, doors 8 PM.\n\n${tags}`],
    ...lineup.map((l, i) => [-21 + i * 3, `Artist spotlight: ${l.name}`, "Instagram and TikTok (clip of their track)",
      `On the lineup ${longDate(date)}: ${l.name}${l.city ? " from " + l.city : ""}.${l.sample ? ` Listen to "${l.sample}" before the show.` : ""}${l.profile_url ? " " + l.profile_url : ""}\n\n${tags}`]),
    [-10, "Ticket push", "Instagram story and the email list", `10 days until ${title}. ${venue.name}, ${longDate(date)}. Tickets: link in bio.`],
    [-3, "Countdown", "Instagram story", `3 days. ${names} at ${venue.name}. Doors 8 PM.`],
    [0, "Show day", "Instagram story (live clips through the night)", `Tonight at ${venue.name}: ${names}. Doors 8 PM.`],
    [2, "Recap", "Instagram and TikTok post, RB TV", `Thank you to everyone who came out to ${venue.name}, and to ${names}. [Add photos and clips from the night.]\n\n${tags}`],
  ];
  content.forEach(([o, t, ch, cap], i) => out.push({ kind: "content", title: t, due_on: due(o), channel: ch, body: cap, sort: i }));
  return out;
}

// ---------------------------------------------------------------- suggest
export async function suggest(env, actor, count = 1, opts = {}) {
  await ensure(env);
  count = Math.max(1, Math.min(Number(count) || 1, 5));
  const today = todayPacific();
  const wantDate = opts.date ? String(opts.date) : "";
  if (wantDate && (!/^\d{4}-\d{2}-\d{2}$/.test(wantDate) || wantDate <= today)) throw new HttpError(400, "Pick a date after today.");
  if (wantDate) count = 1;
  const [talentRows, venueRows, busyRows, planRows] = await Promise.all([
    env.DB.prepare("SELECT id, source, kind, name, location, state, genre, score, status, email, profile_url, sample_title FROM talent WHERE status <> 'passed'").all(),
    env.DB.prepare("SELECT id, name, address, city FROM rb_events_venues WHERE status = 'live' ORDER BY id").all(),
    env.DB.prepare("SELECT substr(starts_at, 1, 10) AS d FROM rb_events WHERE status = 'live' UNION SELECT substr(starts_at, 1, 10) FROM shows WHERE status = 'live'").all(),
    env.DB.prepare("SELECT id, starts_at, venue_id, lineup, status, created_at FROM show_plans WHERE status IN ('suggested','planning','confirmed') OR created_at >= datetime('now','-30 days')").all(),
  ]);
  const talent = talentRows.results || [], venues = venueRows.results || [];
  if (!venues.length) throw new HttpError(409, "Add a live venue under Events > Venues first.");
  const wantVenue = opts.venue_id ? venues.find((v) => String(v.id) === String(opts.venue_id)) : null;
  if (opts.venue_id && !wantVenue) throw new HttpError(400, "That venue isn't live.");
  const busy = new Set((busyRows.results || []).map((r) => r.d));
  const plans = planRows.results || [];
  const planned = plans.filter((p) => ACTIVE.includes(p.status)).map((p) => p.starts_at.slice(0, 10));
  const taken = new Set(), uses = {};
  for (const p of plans) {
    for (const l of JSON.parse(p.lineup || "[]")) taken.add(l.talent_id);
    if (ACTIVE.includes(p.status) && p.venue_id) { const u = (uses[p.venue_id] ||= { n: 0, last: "" }); u.n++; if (p.starts_at > u.last) u.last = p.starts_at; }
  }
  const promoters = talent.filter((t) => t.kind === "promoter" && (BAY.test(t.location || "") || t.state === "CA"));
  const made = [];
  for (let i = 0; i < count; i++) {
    const pick = pickLineup(talent, taken);
    if (!pick) break;
    const date = wantDate || pickDate(today, busy, planned);
    if (!date) break;
    const venue = wantVenue || pickVenue(venues, uses);
    const promoter = promoters.find((p) => !taken.has(p.id)) || null;
    const plan = buildPlan({ date, venue, acts: pick.acts, fam: pick.family, promoter });
    const r = await env.DB.prepare(
      "INSERT INTO show_plans (title, concept, category, starts_at, ends_at, door_time, venue_id, venue_name, venue_city, venue_address, lineup, scope, score, reasons, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'suggested', ?)",
    ).bind(plan.title, plan.concept, plan.category, plan.starts_at, plan.ends_at, plan.door_time, venue.id, venue.name, venue.city || "", venue.address || "", JSON.stringify(plan.lineup), JSON.stringify(plan.scope), plan.score, plan.reasons, actor).run();
    const id = r.meta.last_row_id;
    await env.DB.batch(plan.items.map((it) => env.DB.prepare(
      "INSERT INTO show_plan_items (plan_id, kind, title, due_on, target_type, target_id, target_name, to_email, subject, body, channel, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(id, it.kind, it.title, it.due_on, it.target_type || null, it.target_id || null, it.target_name || null, it.to_email || null, it.subject || null, it.body || null, it.channel || null, it.sort || 0)));
    for (const l of plan.lineup) taken.add(l.talent_id);
    if (promoter) taken.add(promoter.id);
    planned.push(date); busy.add(date);
    const u = (uses[venue.id] ||= { n: 0, last: "" }); u.n++; u.last = plan.starts_at;
    await log(env, actor, "shows.suggest", `show_plans:${id}`, `Show planner: suggested ${plan.title} on ${date}`);
    made.push({ id, title: plan.title, starts_at: plan.starts_at });
  }
  return { ok: true, made, note: made.length ? "" : "No more shows to suggest: every artist in Talent is on a plan, or there's no free Friday or Saturday in the next 13 weeks." };
}

/** Keeps three suggestions waiting, at most once a day, so the planner fills itself. */
export async function topUp(env) {
  await ensure(env);
  const row = await env.DB.prepare("SELECT (SELECT count(*) FROM show_plans WHERE status = 'suggested' AND starts_at >= ?) AS waiting, (SELECT max(created_at) FROM show_plans WHERE created_by = 'autopilot') AS last").bind(todayPacific()).first();
  if (row.waiting >= 3 || (row.last && Date.now() - Date.parse(row.last.replace(" ", "T") + "Z") < 20 * 3600 * 1000)) return null;
  return suggest(env, "autopilot", 3 - row.waiting).catch(() => null);
}

// ---------------------------------------------------------------- reading
const planOut = (p) => ({ ...p, lineup: JSON.parse(p.lineup || "[]"), scope: JSON.parse(p.scope || "{}") });

export async function list(env, params) {
  const auto = await topUp(env);
  const which = params.get("status") === "all" ? STATUSES : ACTIVE;
  const { results } = await env.DB.prepare(
    `SELECT p.*, (SELECT count(*) FROM show_plan_items i WHERE i.plan_id = p.id AND i.kind = 'outreach') AS outreach,
            (SELECT count(*) FROM show_plan_items i WHERE i.plan_id = p.id AND i.kind = 'outreach' AND i.status IN ('sent','skipped')) AS outreach_done,
            (SELECT count(*) FROM show_plan_items i WHERE i.plan_id = p.id AND i.kind <> 'outreach') AS todo,
            (SELECT count(*) FROM show_plan_items i WHERE i.plan_id = p.id AND i.kind <> 'outreach' AND i.status IN ('done','skipped')) AS todo_done
       FROM show_plans p WHERE p.status IN (${which.map(() => "?").join(",")}) ORDER BY p.status = 'suggested', p.starts_at LIMIT 100`,
  ).bind(...which).all();
  const venues = await env.DB.prepare("SELECT id, name, city FROM rb_events_venues WHERE status = 'live' ORDER BY name").all();
  return { ok: true, plans: (results || []).map(planOut), venues: venues.results || [], added: auto && auto.made ? auto.made.length : 0 };
}

export async function get(env, id) {
  await ensure(env);
  const p = await env.DB.prepare("SELECT * FROM show_plans WHERE id = ?").bind(id).first();
  if (!p) throw new HttpError(404, "That plan doesn't exist.");
  const { results } = await env.DB.prepare("SELECT * FROM show_plan_items WHERE plan_id = ? ORDER BY kind, due_on, sort, id").bind(id).all();
  return { ok: true, plan: planOut(p), items: results || [], today: todayPacific() };
}

/** Everything dated between two days: planned shows, their outreach, tasks and content, and RB's live events and shows. */
export async function calendar(env, params) {
  await ensure(env);
  const today = todayPacific();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "") ? params.get("from") : addDays(today, -7);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "") ? params.get("to") : addDays(today, 90);
  const [plans, items, events, shows] = await Promise.all([
    env.DB.prepare("SELECT id, title, starts_at, venue_name, status FROM show_plans WHERE status IN ('suggested','planning','confirmed','published') AND substr(starts_at,1,10) BETWEEN ? AND ?").bind(from, to).all(),
    env.DB.prepare("SELECT i.id, i.plan_id, i.kind, i.title, i.due_on, i.status, i.channel, p.title AS plan_title, p.status AS plan_status FROM show_plan_items i JOIN show_plans p ON p.id = i.plan_id WHERE p.status IN ('planning','confirmed','published') AND i.due_on BETWEEN ? AND ?").bind(from, to).all(),
    env.DB.prepare("SELECT id, title, starts_at, venue_name FROM rb_events WHERE status = 'live' AND substr(starts_at,1,10) BETWEEN ? AND ?").bind(from, to).all(),
    env.DB.prepare("SELECT id, title, starts_at, venue FROM shows WHERE status = 'live' AND substr(starts_at,1,10) BETWEEN ? AND ?").bind(from, to).all(),
  ]);
  const out = [];
  for (const p of plans.results || []) out.push({ type: "plan", id: p.id, date: p.starts_at.slice(0, 10), time: p.starts_at.slice(11, 16), title: p.title, place: p.venue_name, status: p.status });
  for (const i of items.results || []) out.push({ type: i.kind, id: i.id, plan_id: i.plan_id, date: i.due_on, title: i.title, place: i.plan_title, status: i.status, channel: i.channel });
  for (const e of events.results || []) out.push({ type: "event", id: e.id, date: e.starts_at.slice(0, 10), time: e.starts_at.slice(11, 16), title: e.title, place: e.venue_name, status: "live" });
  for (const s of shows.results || []) out.push({ type: "show", id: s.id, date: String(s.starts_at).slice(0, 10), time: String(s.starts_at).slice(11, 16), title: s.title, place: s.venue, status: "live" });
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  return { ok: true, from, to, today, entries: out };
}

const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };

/** The calendar as an .ics file (shows with times in Pacific; outreach, tasks and content as all-day entries). */
export async function ics(env) {
  const d = await calendar(env, new URLSearchParams({ from: addDays(todayPacific(), -30), to: addDays(todayPacific(), 180) }));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Relentless Billionaire//RB Command//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:RB shows and content", "X-WR-TIMEZONE:" + TZ];
  for (const e of d.entries) {
    if (e.type === "plan" && e.status === "suggested") continue;
    const ymd = e.date.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:rb-${e.type}-${e.id}@relentlessbillionaire.com`, `DTSTAMP:${stamp}`);
    if (e.time) { const hm = e.time.replace(":", ""); lines.push(`DTSTART;TZID=${TZ}:${ymd}T${hm}00`, `DURATION:PT3H`); }
    else lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, "")}`);
    const label = { plan: "Show", event: "Event", show: "Show", outreach: "Email", task: "To do", content: "Post" }[e.type] || "";
    lines.push(fold(`SUMMARY:${icsText(`${label}: ${e.title}`)}`));
    if (e.place) lines.push(fold(`${e.type === "plan" || e.type === "event" || e.type === "show" ? "LOCATION" : "DESCRIPTION"}:${icsText(e.place)}`));
    if (["done", "sent", "skipped"].includes(e.status)) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="rb-shows.ics"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

// ---------------------------------------------------------------- changes
export async function update(env, user, id, body) {
  const { plan } = await get(env, id);
  const sets = [], binds = [], said = [];
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status) || body.status === "published") throw new HttpError(400, "Unknown status.");
    sets.push("status = ?"); binds.push(body.status); said.push(body.status);
  }
  if (body.title !== undefined) { const t = clip(body.title, 140); if (!t) throw new HttpError(400, "The show needs a title."); sets.push("title = ?"); binds.push(t); said.push("title"); }
  if (body.starts_at !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(body.starts_at)) throw new HttpError(400, "Use a date and time like 2026-11-20T21:00.");
    const s = body.starts_at.length === 16 ? body.starts_at + ":00" : body.starts_at;
    const shift = daysBetween(plan.starts_at.slice(0, 10), s.slice(0, 10));
    sets.push("starts_at = ?"); binds.push(s); said.push("date");
    if (shift) await env.DB.prepare("UPDATE show_plan_items SET due_on = date(due_on, ?) WHERE plan_id = ? AND status = 'todo'").bind(`${shift >= 0 ? "+" : ""}${shift} days`, id).run();
  }
  if (body.budget !== undefined || body.tickets !== undefined) {
    const scope = { ...plan.scope };
    if (body.budget !== undefined) {
      if (!Array.isArray(body.budget) || body.budget.length > 30) throw new HttpError(400, "The budget should be a list of up to 30 lines.");
      scope.budget = body.budget.map((b) => {
        const amount = b.amount === "" || b.amount == null ? null : Math.round(Number(b.amount) * 100) / 100;
        if (amount !== null && !(Number.isFinite(amount) && amount >= 0 && amount < 1e7)) throw new HttpError(400, "Budget amounts are dollars, like 250 or 1200.50.");
        return { line: clip(b.line, 80), amount, notes: clip(b.notes, 200) };
      }).filter((b) => b.line);
      said.push("budget");
    }
    if (body.tickets !== undefined) {
      const t = body.tickets || {};
      scope.tickets = { price: clip(t.price, 120), capacity: clip(t.capacity, 120), link: clip(t.link, 300), age: clip(t.age, 120) };
      said.push("tickets");
    }
    sets.push("scope = ?"); binds.push(JSON.stringify(scope));
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change.");
  await env.DB.prepare(`UPDATE show_plans SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...binds, id).run();
  await log(env, user.email, "shows.update", `show_plans:${id}`, `Show planner: ${plan.title}: ${said.join(", ")}`);
  return get(env, id);
}

export async function updateItem(env, user, id, body, autopilot) {
  await ensure(env);
  const it = await env.DB.prepare("SELECT i.*, p.title AS plan_title FROM show_plan_items i JOIN show_plans p ON p.id = i.plan_id WHERE i.id = ?").bind(id).first();
  if (!it) throw new HttpError(404, "That item doesn't exist.");
  const sets = [], binds = [];
  if (body.to_email !== undefined) {
    const e = clip(body.to_email, 200);
    if (e && !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(e)) throw new HttpError(400, "That email address doesn't look right.");
    sets.push("to_email = ?"); binds.push(e || null);
  }
  if (body.subject !== undefined) { sets.push("subject = ?"); binds.push(clip(body.subject, 200)); }
  if (body.body !== undefined) { sets.push("body = ?"); binds.push(text(body.body, 6000)); }
  if (body.due_on !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_on)) throw new HttpError(400, "Use a date like 2026-11-01."); sets.push("due_on = ?"); binds.push(body.due_on); }
  if (body.status !== undefined) {
    if (!ITEM_STATUSES.includes(body.status)) throw new HttpError(400, "Unknown status.");
    sets.push("status = ?", "done_at = CASE WHEN ? = 'todo' THEN NULL ELSE datetime('now') END", "done_by = ?"); binds.push(body.status, body.status, body.status === "todo" ? null : user.email);
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change.");
  await env.DB.prepare(`UPDATE show_plan_items SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
  let talent = null;
  // An artist's booking email marked sent: mark them contacted in Talent too, unless they're further along.
  if (body.status === "sent" && it.kind === "outreach" && it.target_type === "artist" && it.target_id && autopilot) {
    const t = await env.DB.prepare("SELECT status FROM talent WHERE id = ?").bind(it.target_id).first();
    if (t && (t.status === "new" || t.status === "shortlisted")) talent = await autopilot.updateTalent(env, user, { id: it.target_id, status: "contacted" }).then(() => "contacted", () => null);
  }
  if (body.status) await log(env, user.email, "shows.item", `show_plan_items:${id}`, `Show planner: ${it.plan_title}: ${it.title}: ${body.status}`);
  const row = await env.DB.prepare("SELECT * FROM show_plan_items WHERE id = ?").bind(id).first();
  return { ok: true, item: row, talent };
}

/**
 * Someone can't make it: put the next best artist in their slot. Their booking email is replaced (or, if it was already
 * sent, kept and a new one added), and their name is swapped in every email and post that hasn't gone out yet.
 */
export async function swapAct(env, user, id, talentId) {
  const { plan, items: rows } = await get(env, id);
  if (!["suggested", "planning", "confirmed"].includes(plan.status)) throw new HttpError(409, "This show is already on Events or dropped.");
  const slot = plan.lineup.findIndex((l) => String(l.talent_id) === String(talentId));
  if (slot < 0) throw new HttpError(404, "That artist isn't on this show.");
  const old = plan.lineup[slot];
  const [talentRows, planRows] = await Promise.all([
    env.DB.prepare("SELECT id, source, kind, name, location, state, genre, score, status, email, profile_url, sample_title FROM talent WHERE status <> 'passed'").all(),
    env.DB.prepare("SELECT lineup FROM show_plans WHERE status IN ('suggested','planning','confirmed') OR created_at >= datetime('now','-30 days')").all(),
  ]);
  const taken = new Set();
  for (const p of planRows.results || []) for (const l of JSON.parse(p.lineup || "[]")) taken.add(String(l.talent_id));
  const fam = family({ genre: plan.lineup[0].genre, name: plan.lineup[0].name });
  const pool = (talentRows.results || []).filter((t) => t.kind === "artist" && !taken.has(String(t.id))).map((t) => ({ t, ...fit(t) }))
    .sort((a, b) => (family(b.t) === fam) - (family(a.t) === fam) || b.score - a.score);
  if (!pool.length) throw new HttpError(409, "Nobody else in Talent is free for this show. Shortlist more artists first.");
  const pick = pool[0];
  const venue = { id: plan.venue_id, name: plan.venue_name, city: plan.venue_city };
  const fresh = buildPlan({ date: plan.starts_at.slice(0, 10), venue, acts: plan.lineup.map((l, i) => (i === slot ? pick : { t: { id: l.talent_id, name: l.name, location: l.city, genre: l.genre, profile_url: l.profile_url, sample_title: l.sample, email: l.email, source: l.source }, score: 0, why: [] })), fam });
  const now = fresh.lineup[slot];
  plan.lineup[slot] = now;
  plan.scope.lineup = plan.lineup;
  plan.scope.run_of_show = fresh.scope.run_of_show;
  const swapName = (s) => (s == null || !old.name ? s : String(s).split(old.name).join(now.name));
  const stmts = [];
  for (const it of rows) {
    if (it.status !== "todo") continue;
    if (it.kind === "outreach" && it.target_type === "artist" && String(it.target_id) === String(old.talent_id)) { stmts.push(env.DB.prepare("DELETE FROM show_plan_items WHERE id = ?").bind(it.id)); continue; }
    if (it.kind === "content" && it.title === `Artist spotlight: ${old.name}`) {
      const c = fresh.items.find((x) => x.kind === "content" && x.title === `Artist spotlight: ${now.name}`);
      stmts.push(env.DB.prepare("UPDATE show_plan_items SET title = ?, body = ? WHERE id = ?").bind(c.title, c.body, it.id));
      continue;
    }
    const t = swapName(it.title), sub = swapName(it.subject), b = swapName(it.body);
    if (t !== it.title || sub !== it.subject || b !== it.body) stmts.push(env.DB.prepare("UPDATE show_plan_items SET title = ?, subject = ?, body = ? WHERE id = ?").bind(t, sub, b, it.id));
  }
  const mail = fresh.items.find((x) => x.kind === "outreach" && x.target_type === "artist" && String(x.target_id) === String(now.talent_id));
  stmts.push(env.DB.prepare("INSERT INTO show_plan_items (plan_id, kind, title, due_on, target_type, target_id, target_name, to_email, subject, body, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, "outreach", mail.title, todayPacific() > mail.due_on ? todayPacific() : mail.due_on, "artist", String(now.talent_id), now.name, now.email || null, mail.subject, mail.body, slot + 1));
  const reasons = String(plan.reasons || "").split(" · ").filter((r) => !r.startsWith(clip(old.name, 40) + ":")).concat(`${clip(now.name, 40)}: ${pick.why.join(", ") || "scored by the scout"}`).join(" · ");
  stmts.push(env.DB.prepare("UPDATE show_plans SET title = ?, concept = ?, lineup = ?, scope = ?, reasons = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(swapName(plan.title), swapName(plan.concept), JSON.stringify(plan.lineup), JSON.stringify({ ...plan.scope, summary: swapName(plan.scope.summary) }), reasons, id));
  await env.DB.batch(stmts);
  await log(env, user.email, "shows.swap", `show_plans:${id}`, `Show planner: ${plan.title}: ${old.name} out, ${now.name} in`);
  return { ...(await get(env, id)), swapped: { out: old.name, in: now.name } };
}

/** A confirmed show goes to /events as a draft, for a person to check and set live. */
export async function toEvent(env, user, id) {
  const { plan } = await get(env, id);
  if (plan.rb_event_id) return { ok: true, rb_event_id: plan.rb_event_id, existing: true };
  if (plan.status !== "confirmed") throw new HttpError(409, "Confirm the show first (venue and acts agreed).");
  const lineup = plan.lineup.map((l) => `${l.name} (${l.role.toLowerCase()}, ${clock(l.set_start)})`).join("\n");
  const r = await env.DB.prepare(
    "INSERT INTO rb_events (title, subtitle, description, category, starts_at, ends_at, door_time, venue_name, venue_address, lineup, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', datetime('now'), datetime('now'))",
  ).bind(plan.title, "Presented by Relentless Billionaire", plan.concept, plan.category, plan.starts_at, plan.ends_at, plan.door_time, plan.venue_name, plan.venue_address || plan.venue_city || "", lineup).run();
  const ev = r.meta.last_row_id;
  await env.DB.prepare("UPDATE show_plans SET rb_event_id = ?, status = 'published', updated_at = datetime('now') WHERE id = ?").bind(ev, id).run();
  await env.DB.prepare("UPDATE show_plan_items SET status = 'done', done_at = datetime('now'), done_by = ? WHERE plan_id = ? AND kind = 'task' AND title LIKE 'Add the show to /events%'").bind(user.email, id).run();
  await log(env, user.email, "shows.event", `rb_events:${ev}`, `Show planner: added ${plan.title} to Events as a draft`);
  return { ok: true, rb_event_id: ev };
}

/** For the Overview: planned shows for "Coming up", and what needs doing. */
export async function overview(env) {
  try {
    await ensure(env);
    const today = todayPacific();
    const [shows, counts] = await Promise.all([
      env.DB.prepare("SELECT id, title, starts_at, trim(coalesce(venue_name,'') || CASE WHEN coalesce(venue_city,'')<>'' THEN ', ' || venue_city ELSE '' END) AS place FROM show_plans WHERE status IN ('planning','confirmed') AND substr(starts_at,1,10) >= ? ORDER BY starts_at LIMIT 6").bind(today).all(),
      env.DB.prepare("SELECT (SELECT count(*) FROM show_plans WHERE status = 'suggested' AND substr(starts_at,1,10) >= ?1) AS suggested, (SELECT count(*) FROM show_plan_items i JOIN show_plans p ON p.id = i.plan_id WHERE p.status IN ('planning','confirmed','published') AND i.status = 'todo' AND i.due_on <= ?1) AS due").bind(today).first(),
    ]);
    return { shows: (shows.results || []).map((s) => ({ kind: "plan", id: s.id, title: s.title, starts_at: s.starts_at, place: s.place })), suggested: counts.suggested || 0, due: counts.due || 0 };
  } catch { return { shows: [], suggested: 0, due: 0 }; }
}
