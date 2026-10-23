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
