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
  state?: string;
  stateLower?: string;
  zip?: string;

  active?: boolean;
  stripeAccountId?: string;
  stripeChargesEnabled?: boolean;
  createdAt?: any; // Firestore Timestamp
  wheel?: Array<{ label: string; weight: number }>;
  /** Multi-wheel support: up to 3 wheels with different spin prices */
  wheels?: Array<{
    spinPriceCents: number;
    items: Array<{ label: string; weight: number }>;
  }>;
  website?: string;
  phone?: string;
  // Boost / free deal
  boostActive?: boolean;
  boostFreeSpinsRemaining?: number;
  boostWheelPriceCents?: number;
  /** For mobile merchants: 'checkin' = 200m geo-gate at check-in location, 'always' = 25mi radius always available */
  boostMode?: 'checkin' | 'always';

  // Founding tier
  foundingNumber?: number;

  // Business hours
  businessHours?: Record<string, { open: string; close: string; closed?: boolean }>;
  showBusinessHours?: boolean;

  // Mobile merchant fields
  isMobile?: boolean;
  mobileLat?: number;
  mobileLng?: number;
  mobileActiveUntil?: any; // Firestore Timestamp
};

export const DISCOVER_CATEGORIES = [
  "food and beverage",
  "health and wellness",
  "tickets and events",
  "things to do",
  "beauty and spa",
  "auto and home",
  "others",
] as const;

// Cities are dynamic — populated from active merchant profiles.
// This list serves as a fallback / seed for the discover filters.
export const DISCOVER_CITIES: readonly string[] = [];

function normalize(s: string) {
  return (s || "").trim().toLowerCase();
}

// US state abbreviation → full name (lowercase)
const STATE_ABBR: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

/** Expand a location query: if it's a 2-letter state abbr return the full name, else return as-is */
function expandLocation(q: string): string {
  const lower = q.trim().toLowerCase();
  return STATE_ABBR[lower] ?? lower;
}

/** Returns true if the string looks like a postal/zip code (digits, letters, spaces, hyphens) */
function looksLikePostalCode(s: string): boolean {
  // US zip: 5 digits or 5+4; UK/CA/AU style: alphanumeric 3-8 chars
  return /^\d{4,6}(-\d{4})?$/.test(s.trim()) || /^[a-z]\d[a-z]\s?\d[a-z]\d$/i.test(s.trim());
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export const CATEGORY_ALIASES: Record<string, string> = {
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
  "ice cream": "food and beverage",
  wings: "food and beverage",
  boba: "food and beverage",
  tea: "food and beverage",
  ramen: "food and beverage",
  pho: "food and beverage",
  thai: "food and beverage",
  chinese: "food and beverage",
  japanese: "food and beverage",
  korean: "food and beverage",
  mexican: "food and beverage",
  italian: "food and beverage",
  indian: "food and beverage",
  mediterranean: "food and beverage",
  greek: "food and beverage",
  vegan: "food and beverage",
  vegetarian: "food and beverage",
  halal: "food and beverage",
  kosher: "food and beverage",
  smoothie: "food and beverage",
  juice: "food and beverage",
  diner: "food and beverage",
  steakhouse: "food and beverage",
  grill: "food and beverage",

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
  "physical therapy": "health and wellness",
  nutrition: "health and wellness",
  vitamin: "health and wellness",
  supplements: "health and wellness",
  pilates: "health and wellness",
  crossfit: "health and wellness",
  meditation: "health and wellness",
  acupuncture: "health and wellness",

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
  festival: "tickets and events",
  sports: "tickets and events",

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
  "mini golf": "things to do",
  "laser tag": "things to do",
  paintball: "things to do",
  "axe throwing": "things to do",
  trampoline: "things to do",
  climbing: "things to do",
  kayak: "things to do",
  kayaking: "things to do",
  hiking: "things to do",
  tour: "things to do",
  tours: "things to do",

  // Beauty & Spa
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
  threading: "beauty and spa",
  microblading: "beauty and spa",
  tattoo: "beauty and spa",
  piercing: "beauty and spa",

  // Others
  others: "others",
  other: "others",
  misc: "others",
  miscellaneous: "others",

  // Auto & Home
  "auto and home": "auto and home",
  auto: "auto and home",
  automotive: "auto and home",
  car: "auto and home",
  cars: "auto and home",
  mechanic: "auto and home",
  "oil change": "auto and home",
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
  moving: "auto and home",
  storage: "auto and home",
  pest: "auto and home",
};

// All category alias keys as a Set for fast lookup
const CATEGORY_ALIAS_KEYS = new Set(Object.keys(CATEGORY_ALIASES));

const CITY_ALIASES: Record<string, string> = {
  "las vegas": "las vegas",
  vegas: "las vegas",
  henderson: "henderson",
  summerlin: "summerlin",
  laughlin: "laughlin",
  mesquite: "mesquite",
  boulder: "boulder city",
  "boulder city": "boulder city",
  reno: "reno",
  "north las vegas": "north las vegas",
  nlv: "north las vegas",
  phoenix: "phoenix",
  scottsdale: "scottsdale",
  tempe: "tempe",
  mesa: "mesa",
  chandler: "chandler",
  gilbert: "gilbert",
  glendale: "glendale",
  tucson: "tucson",
  flagstaff: "flagstaff",
  "los angeles": "los angeles",
  la: "los angeles",
  "san diego": "san diego",
  "san francisco": "san francisco",
  sf: "san francisco",
  sacramento: "sacramento",
  fresno: "fresno",
  bakersfield: "bakersfield",
  anaheim: "anaheim",
  riverside: "riverside",
  irvine: "irvine",
  "long beach": "long beach",
  seattle: "seattle",
  portland: "portland",
  denver: "denver",
  "salt lake city": "salt lake city",
  slc: "salt lake city",
  dallas: "dallas",
  houston: "houston",
  austin: "austin",
  "san antonio": "san antonio",
  chicago: "chicago",
  miami: "miami",
  orlando: "orlando",
  tampa: "tampa",
  atlanta: "atlanta",
  charlotte: "charlotte",
  nashville: "nashville",
  "new york": "new york",
  nyc: "new york",
  brooklyn: "brooklyn",
  bronx: "bronx",
  queens: "queens",
  boston: "boston",
  philadelphia: "philadelphia",
  philly: "philadelphia",
  minneapolis: "minneapolis",
  "kansas city": "kansas city",
  "st louis": "st louis",
  "saint louis": "st louis",
  detroit: "detroit",
  cleveland: "cleveland",
  pittsburgh: "pittsburgh",
  baltimore: "baltimore",
  "washington dc": "washington dc",
  dc: "washington dc",
  "new orleans": "new orleans",
  memphis: "memphis",
  louisville: "louisville",
  indianapolis: "indianapolis",
  columbus: "columbus",
  cincinnati: "cincinnati",
  milwaukee: "milwaukee",
  omaha: "omaha",
  albuquerque: "albuquerque",
  "el paso": "el paso",
  "fort worth": "fort worth",
  "san jose": "san jose",
  jacksonville: "jacksonville",
  "fort lauderdale": "fort lauderdale",
  "boca raton": "boca raton",
  "west palm beach": "west palm beach",
  honolulu: "honolulu",
  anchorage: "anchorage",
  "oklahoma city": "oklahoma city",
  tulsa: "tulsa",
  wichita: "wichita",
  "little rock": "little rock",
  "baton rouge": "baton rouge",
  "virginia beach": "virginia beach",
  richmond: "richmond",
  raleigh: "raleigh",
  durham: "durham",
  greensboro: "greensboro",
  columbia: "columbia",
  charleston: "charleston",
  savannah: "savannah",
  birmingham: "birmingham",
  montgomery: "montgomery",
  jackson: "jackson",
  knoxville: "knoxville",
  chattanooga: "chattanooga",
  lexington: "lexington",
  "des moines": "des moines",
  "sioux falls": "sioux falls",
  "rapid city": "rapid city",
  billings: "billings",
  boise: "boise",
  spokane: "spokane",
  tacoma: "tacoma",
  olympia: "olympia",
  "salt lake": "salt lake city",
  provo: "provo",
  "las cruces": "las cruces",
  "santa fe": "santa fe",
  "colorado springs": "colorado springs",
  aurora: "aurora",
  lakewood: "lakewood",
  "fort collins": "fort collins",
};

/**
 * Given raw search text, split it into:
 *  - category tokens (matched against CATEGORY_ALIASES)
 *  - location tokens (zip codes, state abbrs, city names, or words not matching any category)
 *  - keyword tokens (remaining words that are clearly about the business type/name)
 *
 * Strategy: any word/phrase that is NOT a known category keyword is treated as a potential
 * location token. This means "Laughlin boba" → location="laughlin", keyword="boba".
 */
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

  // 1. Extract zip codes first (they are unambiguous location signals)
  const zipMatch = working.match(/\b(\d{4,6}(-\d{4})?)\b/);
  if (zipMatch) {
    city = zipMatch[1];
    working = working.replace(zipMatch[0], " ");
  }

  // 2. Extract known city phrases (longest match first)
  if (!city) {
    const cityPhrases = uniq([
      ...Object.keys(CITY_ALIASES),
      ...DISCOVER_CITIES,
    ]).sort((a, b) => b.length - a.length);

    for (const phrase of cityPhrases) {
      const p = normalize(phrase);
      if (p && working.includes(` ${p} `)) {
        city = CITY_ALIASES[p] ?? p;
        working = working.replaceAll(` ${p} `, " ");
        break;
      }
    }
  }

  // 3. Extract state abbreviations (2-letter words that are state codes)
  if (!city) {
    const stateMatch = working.match(/\b([a-z]{2})\b/);
    if (stateMatch) {
      const expanded = STATE_ABBR[stateMatch[1]];
      if (expanded) {
        city = expanded;
        working = working.replace(stateMatch[0], " ");
      }
    }
  }

  // 4. Extract known category phrases (longest match first)
  const catPhrases = uniq([
    ...Object.keys(CATEGORY_ALIASES),
    ...DISCOVER_CATEGORIES,
  ]).sort((a, b) => b.length - a.length);

  for (const phrase of catPhrases) {
    const p = normalize(phrase);
    if (p && working.includes(` ${p} `)) {
      category = CATEGORY_ALIASES[p] ?? p;
      working = working.replaceAll(` ${p} `, " ");
      break;
    }
  }

  // 5. Any remaining single words that are NOT category keywords → treat as location
  //    This handles unknown city names like "Laughlin" that aren't in CITY_ALIASES yet
  if (!city) {
    const remaining = working.trim().split(/\s+/).filter(Boolean);
    const locationWords: string[] = [];
    const keywordWords: string[] = [];
    for (const word of remaining) {
      if (CATEGORY_ALIAS_KEYS.has(word)) {
        keywordWords.push(word);
      } else {
        // Could be a city name we don't know about — treat as location
        locationWords.push(word);
      }
    }
    if (locationWords.length > 0) {
      city = locationWords.join(" ");
      working = " " + keywordWords.join(" ") + " ";
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

  return snap.docs
    .filter((d) => !d.data().hidden && (d.data().name ?? '').toLowerCase() !== 'demo pizza')
    .map((d) => {
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
      state: data.state,
      stateLower: data.stateLower,
      zip: data.zip,

      wheel: safeArray<any>(data.wheel),
      wheels: Array.isArray(data.wheels) ? data.wheels : undefined,
      active: data.active,
      stripeAccountId: data.stripeAccountId ?? undefined,
      stripeChargesEnabled: data.stripeChargesEnabled === true,
      createdAt: data.createdAt ?? undefined,
      website: data.website ?? undefined,
      phone: data.phone ?? undefined,
      foundingNumber: typeof data.foundingNumber === 'number' ? data.foundingNumber : undefined,
      boostActive: data.boostActive === true && (data.boostFreeSpinsRemaining ?? 0) > 0,
      boostFreeSpinsRemaining: typeof data.boostFreeSpinsRemaining === "number" ? data.boostFreeSpinsRemaining : 0,
      boostWheelPriceCents: typeof data.boostWheelPriceCents === "number" ? data.boostWheelPriceCents : undefined,
      boostMode: data.boostMode === 'always' ? 'always' : data.boostMode === 'checkin' ? 'checkin' : undefined,
      businessHours: data.businessHours && typeof data.businessHours === 'object' ? data.businessHours : undefined,
      showBusinessHours: data.showBusinessHours !== false,
      isMobile: data.isMobile ?? false,
      mobileLat: typeof data.mobileLat === 'number' ? data.mobileLat : undefined,
      mobileLng: typeof data.mobileLng === 'number' ? data.mobileLng : undefined,
      mobileActiveUntil: data.mobileActiveUntil ?? undefined,
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
  /** 0–100 relevance score used for sorting */
  _score?: number;
};

/**
 * Check if a location query matches a merchant's location fields.
 * Handles: city name, state name, state abbreviation, zip code, address substring.
 * Also handles international: any partial match against city, state, address, or zip.
 */
function locationMatches(locationQuery: string, m: Merchant): boolean {
  if (!locationQuery) return true;

  const q = normalize(locationQuery);
  const expanded = expandLocation(q); // expand state abbr if applicable

  const cty = normalize(m.cityLower ?? m.city ?? "");
  const st = normalize(m.stateLower ?? m.state ?? "");
  const addr = normalize(m.address ?? "");
  const zip = normalize(m.zip ?? "");

  // Zip code match: check stored zip field and address string
  if (looksLikePostalCode(q)) {
    return addr.includes(q) || zip.includes(q) || zip === q;
  }

  // City partial match (both directions: query contains city or city contains query)
  if (cty && (cty.includes(expanded) || expanded.includes(cty))) return true;
  if (cty && (cty.includes(q) || q.includes(cty))) return true;

  // State match (full name or abbreviation)
  if (st && (st.includes(expanded) || expanded.includes(st))) return true;
  if (st && (st.includes(q) || q.includes(st))) return true;

  // Address contains the raw query (handles zip codes, street names, etc.)
  if (addr.includes(q)) return true;

  return false;
}

export async function searchMerchants(params: SearchMerchantsParams): Promise<MerchantResult[]> {
  const list = await getActiveMerchants();

  const text = normalize(params.q ?? params.text ?? "");
  const category = normalize(params.category || "");
  const city = normalize(params.city || "");
  const tokens = text ? text.split(/\s+/).filter(Boolean) : [];

  // Compute distances for ALL merchants if we have user position (even without "Near me" filter)
  const near = params.near;
  const hasNear = near?.lat != null && near?.lng != null;

  let filtered: MerchantResult[] = list
    .map((m): MerchantResult => {
      // Compute distance if we have GPS
      let distanceMiles: number | undefined;
      if (hasNear) {
        const isActiveMobile = m.isMobile && m.mobileActiveUntil &&
          m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > new Date();
        if (isActiveMobile && typeof m.mobileLat === 'number' && typeof m.mobileLng === 'number') {
          // Use check-in location for distance calculation
          distanceMiles = haversine(near!.lat, near!.lng, m.mobileLat, m.mobileLng);
        } else if (typeof m.lat === "number" && typeof m.lng === "number") {
          distanceMiles = haversine(near!.lat, near!.lng, m.lat, m.lng);
        }
      }
      return { ...m, distanceMiles };
    })
    .filter((m) => {
      const name = normalize(m.nameLower ?? m.name ?? "");
      const cat = normalize(m.categoryLower ?? m.category ?? "");
      const cty = normalize(m.cityLower ?? m.city ?? "");
      const about = normalize(m.about ?? "");

      // Normalize stored category: treat legacy "beauty and hair" as "beauty and spa"
      const normalizedCat = cat === "beauty and hair" ? "beauty and spa" : cat;

      // Category filter
      if (category) {
        const filterCat = category === "beauty and hair" ? "beauty and spa" : category;
        if (normalizedCat !== filterCat) return false;
      }

      // Location filter (city/zip/state/address)
      if (city && !locationMatches(city, m)) return false;

      // Near-me radius filter
      // Mobile merchants that are actively checked-in always appear on Discover.
      // If user GPS is available, filter by 25-mile radius from check-in location.
      // If user GPS is NOT available, still show them (don't exclude).
      const isActiveMobile = m.isMobile && m.mobileActiveUntil &&
        m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > new Date();

      if (m.isMobile) {
        // Mobile merchants: always filter by 25-mile service radius
        if (isActiveMobile) {
          // Active: use check-in location
          if (hasNear && typeof m.mobileLat === 'number' && typeof m.mobileLng === 'number') {
            const mobileDistance = haversine(near!.lat, near!.lng, m.mobileLat, m.mobileLng);
            if (mobileDistance > 25) return false;
          }
          // If no user GPS, still show active mobile merchants
        } else {
          // Not checked in: use service location (set when they first checked "mobile")
          const svcLat = (m as any).mobileServiceLat;
          const svcLng = (m as any).mobileServiceLng;
          if (hasNear && typeof svcLat === 'number' && typeof svcLng === 'number') {
            const svcDist = haversine(near!.lat, near!.lng, svcLat, svcLng);
            if (svcDist > 25) return false;
          } else if (hasNear) {
            // No service location set — fall back to regular lat/lng with 25mi
            if (m.distanceMiles == null || m.distanceMiles > 25) return false;
          }
        }
      } else if (hasNear && params.radiusMiles) {
        // Standard near-me radius filter for non-mobile merchants
        if (m.distanceMiles == null) return false;
        if (m.distanceMiles > params.radiusMiles) return false;
      }

      // Keyword tokens: match against name, category, city, or about
      for (const t of tokens) {
        const ok = name.includes(t) || normalizedCat.includes(t) || cty.includes(t) || about.includes(t);
        if (!ok) return false;
      }

      return true;
    });

  // Score each result for relevance + proximity
  filtered = filtered.map((m) => {
    let score = 0;

    // Boost active merchants get a big bonus ONLY when user is within 50 miles of them.
    // If distance is unknown (no GPS) or > 50 miles, no boost to score.
    // For mobile merchants with boostMode='checkin', only boost when checked in.
    const BOOST_RADIUS = 50;
    let boostVisible = m.boostActive === true;
    if (boostVisible && m.isMobile && m.boostMode !== 'always') {
      const checkedIn = m.mobileActiveUntil && m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > new Date();
      if (!checkedIn) boostVisible = false;
    }
    const withinBoost = boostVisible && m.distanceMiles != null && m.distanceMiles <= BOOST_RADIUS;
    if (withinBoost) score += 1000;

    // Location relevance: exact city match scores higher than partial/state match
    if (city) {
      const cty = normalize(m.cityLower ?? m.city ?? "");
      const expanded = expandLocation(city);
      if (cty === expanded || cty === city) score += 500;         // exact city match
      else if (cty.includes(expanded) || expanded.includes(cty)) score += 300; // partial city
      else score += 100; // matched via state or address
    }

    // Keyword relevance: name match scores higher than description match
    for (const t of tokens) {
      const name = normalize(m.nameLower ?? m.name ?? "");
      const cat = normalize(m.categoryLower ?? m.category ?? "");
      if (name.includes(t)) score += 50;
      if (cat.includes(t)) score += 30;
    }

    // Proximity bonus: closer = higher score (max 200 pts for 0 miles, 0 pts at 200+ miles)
    if (m.distanceMiles != null) {
      score += Math.max(0, 200 - m.distanceMiles);
    }

    return { ...m, _score: score };
  });

  // Sort: highest score first; ties broken by distance
  filtered.sort((a, b) => {
    const sa = a._score ?? 0;
    const sb = b._score ?? 0;
    if (sb !== sa) return sb - sa;
    // Tie-break by distance
    const da = a.distanceMiles;
    const db = b.distanceMiles;
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });

  return filtered;
}

// Haversine distance in miles
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deg2rad(d: number) {
  return d * (Math.PI / 180);
}
