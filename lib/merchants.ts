// lib/merchants.ts
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

export type Merchant = {
  id: string;
  name: string;
  category?: string;
  city?: string;
  address?: string;

  // geo
  lat?: number;
  lng?: number;

  // search helper fields (optional)
  nameLower?: string;
  categoryLower?: string;
  cityLower?: string;

  active?: boolean;
  wheel?: Array<{ label: string; weight: number }>;
};

export const DISCOVER_CATEGORIES = [
  "pizza",
  "italian",
  "mexican",
  "chinese",
  "japanese",
  "korean",
  "thai",
  "filipino",
  "vietnamese",
  "burgers",
  "fried chicken",
  "coffee",
  "dessert",
  "bars",
  "tacos",
  "things to do",
  "other",
] as const;

export const DISCOVER_CITIES = ["las vegas", "henderson", "summerlin"] as const;

function normalize(s: string) {
  return (s || "").trim().toLowerCase();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

const CATEGORY_ALIASES: Record<string, string> = {
  pizza: "pizza",
  pizzeria: "pizza",
  italian: "italian",
  "italian/pizza": "pizza",

  mexican: "mexican",
  tacos: "tacos",
  taco: "tacos",
  burrito: "mexican",
  burritos: "mexican",

  chinese: "chinese",
  japanese: "japanese",
  sushi: "japanese",
  ramen: "japanese",
  korean: "korean",
  kbbq: "korean",
  "k-bbq": "korean",
  thai: "thai",
  filipino: "filipino",
  philipino: "filipino",
  vietnamese: "vietnamese",
  pho: "vietnamese",
  banhmi: "vietnamese",
  "banh mi": "vietnamese",

  burgers: "burgers",
  burger: "burgers",
  "fried chicken": "fried chicken",
  chicken: "fried chicken",
  wings: "fried chicken",

  coffee: "coffee",
  cafe: "coffee",
  dessert: "dessert",
  sweets: "dessert",
  bars: "bars",
  bar: "bars",

  "things to do": "things to do",
  "things-to-do": "things to do",
  activity: "things to do",
  activities: "things to do",
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

export async function getActiveMerchants(): Promise<Merchant[]> {
  const q = query(collection(db, "merchants"), where("active", "==", true));
  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      name: data.name ?? "Unnamed merchant",
      category: data.category,
      city: data.city,
      address: data.address,

      lat: typeof data.lat === "number" ? data.lat : undefined,
      lng: typeof data.lng === "number" ? data.lng : undefined,

      nameLower: data.nameLower,
      categoryLower: data.categoryLower,
      cityLower: data.cityLower,

      wheel: data.wheel,
      active: data.active,
    } satisfies Merchant;
  });
}

export type SearchMerchantsParams = {
  q?: string;
  text?: string; // legacy
  category?: string;
  city?: string;

  // near-me
  near?: { lat: number; lng: number } | null;
  radiusMiles?: number | null; // optional filter (ex: 5, 10, 25)
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

    if (category && cat !== category) return false;
    if (city && cty !== city) return false;

    for (const t of tokens) {
      const ok = name.includes(t) || cat.includes(t) || cty.includes(t);
      if (!ok) return false;
    }

    return true;
  });

  // Near-me: compute distances + optional radius + sort
  if (params.near?.lat != null && params.near?.lng != null) {
    const near = params.near;
    const radius = params.radiusMiles ?? null;

    const withDist: MerchantResult[] = filtered.map((m) => {
      if (typeof m.lat === "number" && typeof m.lng === "number") {
        const d = distanceMiles(near.lat, near.lng, m.lat, m.lng);
        return { ...m, distanceMiles: d };
      }
      return { ...m, distanceMiles: undefined };
    });

    filtered = withDist
      .filter((m) => {
        if (!radius) return true;
        if (m.distanceMiles == null) return false; // no coords -> exclude if radius filter is on
        return m.distanceMiles <= radius;
      })
      .sort((a, b) => {
        const da = a.distanceMiles;
        const db = b.distanceMiles;

        // merchants with distance come first
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
  const R = 3958.8; // miles
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(d: number) {
  return d * (Math.PI / 180);
}
