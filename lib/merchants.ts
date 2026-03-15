// lib/merchants.ts
import { collection, getDocs, query, where } from "firebase/firestore";
import { getDb } from "./firebase";

export type Merchant = {
  id: string;
  name: string;

  category?: string;
  city?: string;
  address?: string;
  about?: string;

  // photos
  photoUrls?: string[];
  photoProcessedUrls?: string[];

  // geo
  lat?: number;
  lng?: number;

  // search helper fields (optional)
  nameLower?: string;
  categoryLower?: string;
  cityLower?: string;

  active?: boolean;
  wheel?: Array<{ label: string; weight: number }>;
  /** Multi-wheel support: up to 3 wheels with different spin prices */
  wheels?: Array<{
    spinPriceCents: number;
    items: Array<{ label: string; weight: number }>;
  }>;
  website?: string;
  phone?: string;
  // Boost / free spin
  boostActive?: boolean;
  boostFreeSpinsRemaining?: number;
  boostWheelPriceCents?: number;
};

export const DISCOVER_CATEGORIES = [
  "food and beverage",
  "health and wellness",
  "tickets and events",
  "things to do",
  "beauty and spa",
  "auto and home",
] as const;

// Cities are dynamic — populated from active merchant profiles.
// This list serves as a fallback / seed for the discover filters.
export const DISCOVER_CITIES: readonly string[] = [];

function normalize(s: string) {
  return (s || "").trim().toLowerCase();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

const CATEGORY_ALIASES: Record<string, string> = {
  // Food & Beverage
  "food and beverage": "food and beverage",
  food: "food and beverage",
  beverage: "food and beverage",
  restaurant: "food and beverage",
  pizza: "food and beverage",
  coffee: "food and beverage",
  cafe: "food and beverage",
  bar: "food and beverage",
  bars: "food and beverage",
  sushi: "food and beverage",
  tacos: "food and beverage",
  burgers: "food and beverage",
  seafood: "food and beverage",
  shrimp: "food and beverage",
  steak: "food and beverage",
  bbq: "food and beverage",
  sandwich: "food and beverage",
  sandwiches: "food and beverage",
  breakfast: "food and beverage",
  brunch: "food and beverage",
  bakery: "food and beverage",
  dessert: "food and beverage",
  ice cream: "food and beverage",
  wings: "food and beverage",

  // Health & Wellness
  "health and wellness": "health and wellness",
  health: "health and wellness",
  wellness: "health and wellness",
  gym: "health and wellness",
  yoga: "health and wellness",
  fitness: "health and wellness",
  massage: "health and wellness",
  chiropractic: "health and wellness",
  chiropractor: "health and wellness",
  physical therapy: "health and wellness",
  nutrition: "health and wellness",
  vitamin: "health and wellness",
  supplements: "health and wellness",

  // Tickets & Events
  "tickets and events": "tickets and events",
  tickets: "tickets and events",
  events: "tickets and events",
  event: "tickets and events",
  concert: "tickets and events",
  show: "tickets and events",
  comedy: "tickets and events",
  theater: "tickets and events",
  theatre: "tickets and events",

  // Things To Do
  "things to do": "things to do",
  "things-to-do": "things to do",
  activity: "things to do",
  activities: "things to do",
  entertainment: "things to do",
  fun: "things to do",
  bowling: "things to do",
  arcade: "things to do",
  escape: "things to do",
  golf: "things to do",
  mini golf: "things to do",
  laser tag: "things to do",
  paintball: "things to do",
  axe throwing: "things to do",

  // Beauty & Spa (formerly Beauty & Hair)
  "beauty and spa": "beauty and spa",
  "beauty and hair": "beauty and spa",
  beauty: "beauty and spa",
  hair: "beauty and spa",
  salon: "beauty and spa",
  nails: "beauty and spa",
  barber: "beauty and spa",
  makeup: "beauty and spa",
  spa: "beauty and spa",
  waxing: "beauty and spa",
  lashes: "beauty and spa",
  eyebrows: "beauty and spa",
  skincare: "beauty and spa",
  facial: "beauty and spa",
  tanning: "beauty and spa",

  // Auto & Home
  "auto and home": "auto and home",
  auto: "auto and home",
  automotive: "auto and home",
  car: "auto and home",
  cars: "auto and home",
  mechanic: "auto and home",
  oil change: "auto and home",
  tires: "auto and home",
  detailing: "auto and home",
  "car wash": "auto and home",
  home: "auto and home",
  plumbing: "auto and home",
  electrician: "auto and home",
  hvac: "auto and home",
  roofing: "auto and home",
  landscaping: "auto and home",
  cleaning: "auto and home",
  handyman: "auto and home",
  flooring: "auto and home",
  painting: "auto and home",
};

const CITY_ALIASES: Record<string, string> = {
  "las vegas": "las vegas",
  vegas: "las vegas",
  henderson: "henderson",
  summerlin: "summerlin",
};

export function parseDiscoverQuery(raw: string): {
  text: string;
  category: string;
  city: string;
} {
  const input = normalize(raw);
  if (!input) return { text: "", category: "", city: "" };

  let working = ` ${input} `;
  let category = "";
  let city = "";

  const cityPhrases = uniq([...Object.keys(CITY_ALIASES), ...DISCOVER_CITIES]).sort(
    (a, b) => b.length - a.length
  );

  for (const phrase of cityPhrases) {
    const p = normalize(phrase);
    if (p && working.includes(` ${p} `)) {
      city = CITY_ALIASES[p] ?? p;
      working = working.replaceAll(` ${p} `, " ");
      break;
    }
  }

  const catPhrases = uniq([
    ...Object.keys(CATEGORY_ALIASES),
    ...DISCOVER_CATEGORIES,
    "italian/pizza",
  ]).sort((a, b) => b.length - a.length);

  for (const phrase of catPhrases) {
    const p = normalize(phrase);
    if (p && working.includes(` ${p} `)) {
      category = CATEGORY_ALIASES[p] ?? p;
      working = working.replaceAll(` ${p} `, " ");
      break;
    }
  }

  const text = working.replace(/\s+/g, " ").trim();
  return { text, category, city };
}

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Returns a sorted, deduplicated list of cities from all active merchants.
 * Used to dynamically populate the city filter on the Discover page.
 */
export async function getDynamicCities(merchants?: Merchant[]): Promise<string[]> {
  const list = merchants ?? await getActiveMerchants();
  const cities = list
    .map((m) => (m.cityLower ?? m.city ?? "").trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(cities)).sort();
}

export async function getActiveMerchants(): Promise<Merchant[]> {
  const q = query(collection(getDb(), "merchants"), where("active", "==", true));
  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data = d.data() as any;

    return {
      id: d.id,
      name: data.name ?? "Unnamed merchant",
      category: data.category,
      city: data.city,
      address: data.address,
      about: data.about,

      photoUrls: safeArray<string>(data.photoUrls),
      photoProcessedUrls: safeArray<string>(data.photoProcessedUrls),

      lat: typeof data.lat === "number" ? data.lat : undefined,
      lng: typeof data.lng === "number" ? data.lng : undefined,

      nameLower: data.nameLower,
      categoryLower: data.categoryLower,
      cityLower: data.cityLower,

      wheel: safeArray<any>(data.wheel),
      wheels: Array.isArray(data.wheels) ? data.wheels : undefined,
      active: data.active,
      website: data.website ?? undefined,
      phone: data.phone ?? undefined,
      boostActive: data.boostActive === true && (data.boostFreeSpinsRemaining ?? 0) > 0,
      boostFreeSpinsRemaining: typeof data.boostFreeSpinsRemaining === "number" ? data.boostFreeSpinsRemaining : 0,
      boostWheelPriceCents: typeof data.boostWheelPriceCents === "number" ? data.boostWheelPriceCents : undefined,
    } satisfies Merchant;
  });
}

export type SearchMerchantsParams = {
  q?: string;
  text?: string; // legacy
  category?: string;
  city?: string;

  near?: { lat: number; lng: number } | null;
  radiusMiles?: number | null;
};

export type MerchantResult = Merchant & {
  distanceMiles?: number;
};

export async function searchMerchants(params: SearchMerchantsParams): Promise<MerchantResult[]> {
  const list = await getActiveMerchants();

  const text = normalize(params.q ?? params.text ?? "");
  const category = normalize(params.category || "");
  const city = normalize(params.city || "");
  const tokens = text ? text.split(/\s+/).filter(Boolean) : [];

  let filtered = list.filter((m) => {
    const name = normalize(m.nameLower ?? m.name ?? "");
    const cat = normalize(m.categoryLower ?? m.category ?? "");
    const cty = normalize(m.cityLower ?? m.city ?? "");
    // Also search the business description (about field)
    const about = normalize(m.about ?? "");

    // Normalize stored category: treat legacy "beauty and hair" as "beauty and spa"
    const normalizedCat = cat === "beauty and hair" ? "beauty and spa" : cat;

    if (category) {
      const filterCat = category === "beauty and hair" ? "beauty and spa" : category;
      if (normalizedCat !== filterCat) return false;
    }
    if (city && cty !== city) return false;

    for (const t of tokens) {
      // Match against name, category, city, OR business description
      const ok = name.includes(t) || normalizedCat.includes(t) || cty.includes(t) || about.includes(t);
      if (!ok) return false;
    }

    return true;
  });

  if (params.near?.lat != null && params.near?.lng != null) {
    const near = params.near;
    const radius = params.radiusMiles ?? null;

    const withDist: MerchantResult[] = filtered.map((m) => {
      if (typeof m.lat === "number" && typeof m.lng === "number") {
        const dist = distanceMiles(near.lat, near.lng, m.lat, m.lng);
        return { ...m, distanceMiles: dist };
      }
      return { ...m, distanceMiles: undefined };
    });

    filtered = withDist
      .filter((m) => {
        if (!radius) return true;
        if (m.distanceMiles == null) return false;
        return m.distanceMiles <= radius;
      })
      .sort((a, b) => {
        const da = a.distanceMiles;
        const db = b.distanceMiles;

        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;

        return da - db;
      }) as any;
  }

  return filtered as MerchantResult[];
}

// Haversine
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(d: number) {
  return d * (Math.PI / 180);
}
