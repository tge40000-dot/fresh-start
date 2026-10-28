// RB World empire: the city's lots, districts and businesses. Shared word for word by the game (empire.js imports it)
// and by the server (patch_badge.py pastes it into artist-router without the `export` keywords), so prices, rent and
// limits are the same on both sides. Everything here is game money.

// The city is a GRID x GRID of blocks with roads between them; each block is one lot, except RB Plaza in the middle.
export const GRID = 6;
export const BLOCK = 28;
export const ROAD = 10;
export const PITCH = BLOCK + ROAD;
export const HALF = (GRID * PITCH - ROAD) / 2; // the city's edge, from the centre
export const PLAZA = [14, 15, 20, 21]; // the four middle blocks
export const MAX_LOTS_PER_PLAYER = 12;
export const RENT_COOLDOWN_S = 60;

// Monopoly-style districts: four lots each; own all four for the set bonus.
export const DISTRICTS = [
  { key: "block", name: "The Block", color: 0x8B5A2B, css: "#8B5A2B", price: 8000, tier: 1 },
  { key: "southside", name: "Southside", color: 0x7FD3F7, css: "#7FD3F7", price: 12000, tier: 1 },
  { key: "arts", name: "Arts District", color: 0xE05AA8, css: "#E05AA8", price: 18000, tier: 2 },
  { key: "market", name: "Market Row", color: 0xF39C34, css: "#F39C34", price: 25000, tier: 2 },
  { key: "midtown", name: "Midtown", color: 0xE53935, css: "#E53935", price: 35000, tier: 3 },
  { key: "uptown", name: "Uptown", color: 0xF5D547, css: "#F5D547", price: 50000, tier: 3 },
  { key: "financial", name: "Financial District", color: 0x2EB872, css: "#2EB872", price: 75000, tier: 4 },
  { key: "row", name: "Billionaire Row", color: 0x2F55D4, css: "#2F55D4", price: 120000, tier: 4 },
];

// Which district each block belongs to: cheap round the edge, dear by the plaza (-1 = the plaza).
const LAYOUT = [
  0, 0, 1, 1, 2, 2,
  0, 7, 6, 6, 7, 2,
  1, 5, -1, -1, 6, 3,
  1, 5, -1, -1, 7, 3,
  0, 5, 4, 4, 7, 3,
  2, 4, 5, 4, 6, 3,
];
export const LOTS = LAYOUT.map((d, i) => {
  const gx = i % GRID, gz = Math.floor(i / GRID);
  return { id: i, gx, gz, district: d, x: -HALF + BLOCK / 2 + gx * PITCH, z: -HALF + BLOCK / 2 + gz * PITCH, price: d < 0 ? 0 : DISTRICTS[d].price };
}).filter((l) => l.district >= 0);

// Tycoon businesses. fair = the price customers think is right; cap = customers an hour at level 1; upkeep an hour.
// tier = the cheapest district tier it can be built in; night = how busy it is at night (1 = same as day).
export const BUSINESSES = [
  { key: "foodtruck", name: "Food Truck", icon: "🚚", cost: 5000, fair: 12, cap: 60, upkeep: 40, tier: 1, night: 0.8, role: "chef", h: 4, color: 0xF39C34 },
  { key: "coffee", name: "Coffee Shop", icon: "☕", cost: 12000, fair: 6, cap: 120, upkeep: 90, tier: 1, night: 0.4, role: "barista", h: 7, color: 0x8B5A2B },
  { key: "barber", name: "Barbershop", icon: "💈", cost: 15000, fair: 30, cap: 30, upkeep: 120, tier: 1, night: 0.6, role: "stylist", h: 6, color: 0xE53935 },
  { key: "boutique", name: "Boutique", icon: "👗", cost: 30000, fair: 80, cap: 20, upkeep: 250, tier: 2, night: 0.7, role: "stylist", h: 9, color: 0xE05AA8 },
  { key: "gym", name: "Gym", icon: "🏋️", cost: 40000, fair: 45, cap: 40, upkeep: 300, tier: 2, night: 0.9, role: "trainer", h: 10, color: 0x7FD3F7 },
  { key: "studio", name: "Recording Studio", icon: "🎙️", cost: 60000, fair: 200, cap: 12, upkeep: 400, tier: 2, night: 1.3, role: "producer", h: 12, color: 0xC9A84C },
  { key: "club", name: "Nightclub", icon: "🪩", cost: 90000, fair: 40, cap: 150, upkeep: 900, tier: 3, night: 2.2, role: "dj", h: 14, color: 0x9B59B6 },
  { key: "dealer", name: "Car Dealership", icon: "🏎️", cost: 150000, fair: 3000, cap: 2, upkeep: 1500, tier: 3, night: 0.5, role: "manager", h: 11, color: 0x2F55D4 },
  { key: "hotel", name: "Hotel", icon: "🏨", cost: 250000, fair: 320, cap: 25, upkeep: 2000, tier: 4, night: 1.2, role: "concierge", h: 30, color: 0xF5D547 },
  { key: "tech", name: "Tech Startup", icon: "💻", cost: 300000, fair: 900, cap: 10, upkeep: 3000, tier: 4, night: 1, role: "engineer", h: 26, color: 0x2EB872 },
  { key: "park", name: "Theme Park", icon: "🎢", cost: 500000, fair: 100, cap: 150, upkeep: 6000, tier: 4, night: 0.9, role: "promoter", h: 18, color: 0xFF6B6B },
];
export const BUSINESS_KEYS = BUSINESSES.map((b) => b.key);
export const MAX_LEVEL = 5; // like houses up to a hotel

export function lotById(id) { return LOTS.find((l) => l.id === Number(id)) || null; }
export function businessByKey(k) { return BUSINESSES.find((b) => b.key === k) || null; }
// Rent another player pays for stopping at your lot: 2% of the deed a level, 1% for an empty lot.
export function rentFor(lot, level, business) {
  const l = lotById(lot);
  if (!l) return 0;
  return Math.round(l.price * (business ? 0.02 * Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1)) : 0.01));
}
export function upgradeCost(b, level) { return Math.round(b.cost * 0.6 * level); }
// What a lot is worth: the deed, plus its business and the upgrades on it (takeover bids start at TAKEOVER_MIN of this).
export function lotValue(lot, business, level) {
  const l = lotById(lot), b = businessByKey(business); if (!l) return 0;
  let v = l.price; if (b) { v += b.cost; for (let i = 1; i < Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1)); i++) v += upgradeCost(b, i); }
  return v;
}

// Deals between players (deals.js, and the server's checks): an offer to buy someone's lot, or a hostile takeover bid.
// A takeover bid starts at 1.5x what the lot is worth; if its owner doesn't answer within a day and the lot is empty
// (no business: not doing anything with it), it goes to the bidder anyway. A lot with a business can only be bought.
export const DEAL_OFFER_H = 48;
export const DEAL_TAKEOVER_H = 24;
export const TAKEOVER_MIN = 1.5;
export const DEALS_OPEN_MAX = 10;

// Empire Nodes (nodes.js): real places on the real map, one in each cell of about 330 m, the same for everyone.
// Get within NODE_RADIUS of one (walking with your phone's location, or driving there in the game) to claim it; an
// owner is safe for NODE_SHIELD_H hours, then anyone close enough can take it over for a quarter more than it last
// cost (the owner it's taken from gets half of that). It earns NODE_INCOME of its price an hour, up to a day at a time.
export const NODE_CELL = [0.0038, 0.003];
export const NODE_RADIUS = 90;
export const NODE_BASE = 10000;
export const NODE_STEP = 1.25;
export const NODE_SHIELD_H = 6;
export const NODE_INCOME = 0.02;
export const NODE_CAP_H = 24;
export const NODE_MAX = 10;
export const WALK_DAY_M = 1000; // metres walked (phone location, walking pace) that count a day for the streak
function nodeHash(a, b, salt) { let h = 2166136261 ^ salt; h = Math.imul(h ^ a, 16777619); h = Math.imul(h ^ b, 16777619); h ^= h >>> 13; h = Math.imul(h, 2246822507); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function nodeAt(cx, cy) {
  const lng = (cx + 0.15 + 0.7 * nodeHash(cx, cy, 11)) * NODE_CELL[0], lat = (cy + 0.15 + 0.7 * nodeHash(cx, cy, 23)) * NODE_CELL[1];
  const code = Math.floor(nodeHash(cx, cy, 37) * 46656).toString(36).toUpperCase().padStart(3, "0");
  return { id: `n_${cx}_${cy}`, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, name: "Empire Node " + code };
}
export function nodeById(id) { const m = /^n_(-?\d{1,6})_(-?\d{1,6})$/.exec(String(id || "")); return m ? nodeAt(Number(m[1]), Number(m[2])) : null; }
export function nodesNear(lat, lng, r = 2) {
  const cx = Math.floor(lng / NODE_CELL[0]), cy = Math.floor(lat / NODE_CELL[1]), out = [];
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) out.push(nodeAt(cx + i, cy + j));
  return out;
}
export function metresBetween(lat1, lng1, lat2, lng2) {
  const R = 6371e3, p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180, dp = p2 - p1, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The market (market.js): every half hour something happens somewhere, the same for everyone at the same time, and
// it changes how many customers some businesses get for that half hour. Made-up game events, not real news.
export const MARKET_SLOT_MIN = 30;
export const MARKET = [
  { key: "techboom", text: "Tech boom: startups and hotels are packed", biz: ["tech", "hotel"], k: 1.4 },
  { key: "foodfest", text: "Food festival weekend: food trucks and coffee shops are busy", biz: ["foodtruck", "coffee"], k: 1.35 },
  { key: "concert", text: "Big concert night: nightclubs and studios fill up", biz: ["club", "studio"], k: 1.5 },
  { key: "carshow", text: "Car show in town: dealerships get the buyers", biz: ["dealer"], k: 1.6 },
  { key: "fitness", text: "New-year fitness rush: gyms are full", biz: ["gym", "barber"], k: 1.3 },
  { key: "fashion", text: "Fashion week: boutiques and barbers are booked", biz: ["boutique", "barber"], k: 1.35 },
  { key: "tourists", text: "Tourist season: theme parks and hotels are busy", biz: ["park", "hotel"], k: 1.3 },
  { key: "rain", text: "Storm rolls in: fewer people out at the food trucks and the theme park", biz: ["foodtruck", "park"], k: 0.7 },
  { key: "inspect", text: "City health inspections: food trucks and coffee shops slow down", biz: ["foodtruck", "coffee"], k: 0.75 },
  { key: "techdip", text: "Tech stocks dip: startups and dealerships go quiet", biz: ["tech", "dealer"], k: 0.75 },
  { key: "noise", text: "Noise crackdown: nightclubs have to close early", biz: ["club"], k: 0.7 },
  { key: "calm", text: "A normal half hour in the city", biz: [], k: 1 },
];
export function marketAt(ms) { const slot = Math.floor(ms / (MARKET_SLOT_MIN * 60000)); return { ...MARKET[Math.floor(nodeHash(slot, 7, 91) * MARKET.length)], slot, ends: (slot + 1) * MARKET_SLOT_MIN * 60000 }; }

// Street races: the same tracks for solo time trials and multiplayer races, and the server's checks.
// A track is a start point and the checkpoints in order (turns on real Midtown streets); the start faces the first
// checkpoint. Generated from the road network by rb-tools/bake_city.mjs: don't edit by hand, re-bake.
// BEGIN BAKED TRACKS (rb-tools/bake_city.mjs)
export const RACE_TRACKS = [
  {"key":"vloop","name":"Downtown Loop","par":77,"start":[85.6,-198.4],"cps":[[78.5,183],[368.4,189.4],[377.8,-211],[85.8,-210.4]]},
  {"key":"vzig","name":"Heritage District Zigzag","par":90,"start":[-343.2,-635.5],"cps":[[-343.6,-537.1],[93.3,-528.7],[88.2,-310.3],[379.9,-301.1],[373.5,-27.7],[526.3,-26.9]]},
  {"key":"vring","name":"Vallejo Ring","par":220,"start":[-331.2,-647.2],"cps":[[536,-627],[506.5,627.4],[-195.2,452.6],[-343.2,-647.5]]},
  {"key":"vgp","name":"RB Grand Prix (2 laps)","par":262,"start":[-39.4,-530.5],"cps":[[533,-517],[515,189.1],[-68.1,179.6],[-51.4,-530.7],[533,-517],[515,189.1],[-68.1,179.6],[-51.4,-530.7]]},
];
// END BAKED TRACKS
export const RACE_LOBBY_S = 20;        // a hosted race starts this long after it's made; others can join until then
export const RACE_SOLO_S = 3;          // a solo time trial's countdown
export const RACE_MAX = 8;             // racers in one race
export const RACE_MAX_SPEED = 50;      // m/s; the server refuses a checkpoint reached faster than this (top speed is 44 with nitro)
export const RACE_CP_RADIUS = 10;      // how close to a checkpoint counts, on the server (the game uses 7)
export const RACE_PRIZES = [25000, 15000, 8000]; // game money for 1st, 2nd, 3rd with two or more racers; everyone else who finishes gets 3000
export function raceTrack(key) { return RACE_TRACKS.find((t) => t.key === key) || null; }
// The distance from the point before checkpoint i (the start for 0) to checkpoint i.
export function raceLeg(t, i) { const a = i === 0 ? t.start : t.cps[i - 1], b = t.cps[i]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }
