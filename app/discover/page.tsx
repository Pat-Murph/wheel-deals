"use client";
export const dynamic = "force-dynamic";
import nextDynamic from "next/dynamic";

const DiscoverMap = nextDynamic(() => import("../../components/DiscoverMap"), {
  ssr: false,
});

import { useEffect, useMemo, useState, useRef } from "react";
import {
  searchMerchants,
  type MerchantResult,
  parseDiscoverQuery,
  DISCOVER_CATEGORIES,
} from "../../lib/merchants";
import { getFoundingMerchantCount, FOUNDING_MERCHANT_LIMIT } from "../../lib/founding";

function titleCase(s: string) {
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtMiles(n?: number) {
  if (n == null) return "";
  return `${Math.round(n * 10) / 10} mi`;
}

// Haversine distance in miles (client-side)
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DiscoverPage() {
  // Single unified search query (handles keywords, city, zip, category all at once)
  const [q, setQ] = useState("");
  // Category filter (separate from search box, via filter panel)
  const [category, setCategory] = useState("");
  // Near-me filter
  const [nearMe, setNearMe] = useState(false);
  const [radius, setRadius] = useState<number>(10);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<MerchantResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [foundingRemaining, setFoundingRemaining] = useState<number>(FOUNDING_MERCHANT_LIMIT);
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(false);
  // Track what was actually searched so we can show a label
  const [searchLabel, setSearchLabel] = useState("All merchants");

  useEffect(() => {
    getFoundingMerchantCount()
      .then(({ remaining }) => setFoundingRemaining(remaining))
      .catch(() => {});
  }, []);

  // Silently try to get location on load — used for distance display and sorting
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: false, timeout: 8000 }
      );
    }
  }, []);

  async function requestLocationOnce() {
    return new Promise<{ lat: number; lng: number }>((resolve, reject) => {
      if (!navigator.geolocation)
        return reject(new Error("Geolocation not supported in this browser."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (err) => reject(new Error(err.message || "Location permission denied.")),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function runSearch(opts?: { autoFill?: boolean }) {
    const autoFill = opts?.autoFill ?? true;
    setBusy(true);
    setError(null);
    try {
      let searchQ = q.trim();
      let searchCategory = category;
      let searchCity = "";

      if (autoFill && searchQ) {
        // Smart parse: extract city/zip/state and category from the single search box
        const parsed = parseDiscoverQuery(searchQ);
        if (!searchCategory && parsed.category) searchCategory = parsed.category;
        if (parsed.city) searchCity = parsed.city;
        // Keep remaining keyword text
        searchQ = parsed.text;
      }

      let near = pos;
      if (nearMe && !near) {
        near = await requestLocationOnce();
        setPos(near);
      }

      // Build a human-readable label for what was searched
      const labelParts: string[] = [];
      if (searchQ) labelParts.push(`"${searchQ}"`);
      if (searchCategory) labelParts.push(titleCase(searchCategory));
      if (searchCity) labelParts.push(titleCase(searchCity));
      if (nearMe) labelParts.push(`within ${radius} mi`);
      setSearchLabel(labelParts.length ? labelParts.join(" · ") : "All merchants");

      const res = await searchMerchants({
        q: searchQ,
        category: searchCategory,
        city: searchCity,
        // Always pass user position so server can compute distances + sort by proximity
        near: near,
        radiusMiles: nearMe ? radius : null,
      });

      setItems(res);
    } catch (e: any) {
      setError(e?.message ?? "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  // Load all merchants on mount
  useEffect(() => {
    runSearch({ autoFill: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sort on client side if pos arrives after initial load
  // (searchMerchants already sorts, but pos may have arrived after the initial call)
  const BOOST_RADIUS_MILES = 50;
  const sortedItems = useMemo(() => {
    // If we have GPS, recompute distances client-side and re-sort
    // (this handles the case where pos arrived after the search call)
    const withDist = items.map((m) => {
      if (pos && typeof m.lat === "number" && typeof m.lng === "number") {
        const d = distanceMiles(pos.lat, pos.lng, m.lat, m.lng);
        // Only update if not already set (searchMerchants may have set it)
        return { ...m, distanceMiles: m.distanceMiles ?? d };
      }
      return m;
    });

    return [...withDist].sort((a, b) => {
      // Boosted merchants within 50 miles always first
      const aBoost = (a.boostActive && (a.distanceMiles == null || a.distanceMiles <= BOOST_RADIUS_MILES)) ? 1 : 0;
      const bBoost = (b.boostActive && (b.distanceMiles == null || b.distanceMiles <= BOOST_RADIUS_MILES)) ? 1 : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;

      // Use server-computed score if available
      const sa = (a as any)._score ?? 0;
      const sb = (b as any)._score ?? 0;
      if (sb !== sa) return sb - sa;

      // Fall back to distance
      const da = a.distanceMiles;
      const db = b.distanceMiles;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }, [items, pos]);

  return (
    <main style={{
      display: "block",
      minHeight: "100dvh",
      width: "100%",
      overflowX: "hidden",
      boxSizing: "border-box",
      background: "#ffffff",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>

      {/* TOP HERO HEADER */}
      <div style={{
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        padding: "8px 14px",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}>
        <img
          src="/wheel-deals-discover.png"
          alt="Wheel Deals Discover"
          style={{ height: 160, width: "auto", objectFit: "contain" }}
        />
        <a href="/merchant" style={{
          fontSize: 14,
          fontWeight: 800,
          color: "#1a1a1a",
          textDecoration: "none",
          padding: "10px 20px",
          borderRadius: 12,
          background: "linear-gradient(180deg, #FFD700, #FFA500)",
          border: "1px solid #d4a017",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
          flexShrink: 0,
        }}>
          Merchant
        </a>
      </div>

      {/* FOUNDING BANNER */}
      {foundingRemaining > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #15803d, #16a34a, #22c55e)",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexShrink: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#ffffff", letterSpacing: 0.2 }}>
              Own a business? Get discovered.
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.92)", lineHeight: 1.6 }}>
              Build a promotional deal wheel.<br />
              Customers pay to unlock your deals.<br />
              Earn from each deal unlocked · Bring real customers into your store.<br />
              Free to sign up · {foundingRemaining} founding spots left.
            </div>
          </div>
          <a href="/merchant/onboard" style={{
            fontSize: 12,
            fontWeight: 800,
            color: "#15803d",
            background: "#ffffff",
            padding: "9px 13px",
            borderRadius: 9,
            textDecoration: "none",
            whiteSpace: "nowrap",
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
            flexShrink: 0,
          }}>
            Get started
          </a>
        </div>
      )}

      {/* SEARCH BAR */}
      <div style={{
        padding: "10px 12px",
        background: "#f9fafb",
        borderBottom: "1px solid #e5e7eb",
        flexShrink: 0,
        display: "grid",
        gap: 8,
      }}>
        {/* Single unified search input */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch({ autoFill: true }); }}
            placeholder='City, zip, or "boba Laughlin"...'
            style={{
              minWidth: 0,
              padding: "11px 10px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              fontSize: 14,
              outline: "none",
              background: "#ffffff",
              color: "#111827",
              fontWeight: 500,
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => runSearch({ autoFill: true })}
            disabled={busy}
            style={{
              padding: "11px 14px",
              borderRadius: 10,
              border: "none",
              fontWeight: 800,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(180deg, #FFD700, #FFA500)",
              color: "#1a1a1a",
              whiteSpace: "nowrap",
            }}
          >
            {busy ? "..." : "Search"}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              padding: "11px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              background: showFilters ? "#fef9c3" : "#ffffff",
              color: "#374151",
              whiteSpace: "nowrap",
            }}
          >
            {showFilters ? "✕" : "Filter"}
          </button>
        </div>

        {/* Search hint */}
        <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500, paddingLeft: 2 }}>
          Tip: search by city, zip code, or business type — e.g. "89029", "Laughlin", "boba Las Vegas"
        </div>

        {showFilters && (
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{
              padding: "10px 10px", borderRadius: 8, border: "1px solid #d1d5db",
              fontSize: 14, background: "#ffffff", color: "#111827", fontWeight: 500,
              gridColumn: "span 2",
            }}>
              <option value="">All categories</option>
              {DISCOVER_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: 14, color: "#374151" }}>
              <input type="checkbox" checked={nearMe} onChange={async (e) => {
                const on = e.target.checked;
                setNearMe(on);
                if (on) {
                  try {
                    const p = pos ?? (await requestLocationOnce());
                    setPos(p);
                  } catch (err: any) {
                    setNearMe(false);
                    setError(err?.message ?? "Could not access location.");
                  }
                }
              }} style={{ width: 18, height: 18 }} />
              Near me
            </label>
            {nearMe && (
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{
                padding: "10px 10px", borderRadius: 8, border: "1px solid #d1d5db",
                fontSize: 14, background: "#ffffff", color: "#111827", fontWeight: 500,
              }}>
                {[2, 5, 10, 15, 25, 50].map((r) => <option key={r} value={r}>{r} mi</option>)}
              </select>
            )}
            <button onClick={() => {
              setQ(""); setCategory(""); setNearMe(false);
              setSearchLabel("All merchants");
              setTimeout(() => runSearch({ autoFill: false }), 0);
            }}
              style={{
                padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db",
                fontWeight: 700, fontSize: 14, cursor: "pointer",
                background: "#ffffff", color: "#374151",
                gridColumn: "span 2",
              }}>
              Reset filters
            </button>
          </div>
        )}

        {error && (
          <div style={{
            color: "#dc2626", fontWeight: 700, fontSize: 14,
            background: "#fef2f2", padding: "8px 12px", borderRadius: 8,
            border: "1px solid #fecaca",
          }}>
            {error}
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>
          {sortedItems.length} wheel{sortedItems.length === 1 ? "" : "s"} found — {searchLabel}
        </div>
      </div>

      {/* MAP TOGGLE BUTTON */}
      <div style={{ padding: "8px 12px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        <button
          onClick={() => setShowMap(!showMap)}
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            background: showMap ? "#fef9c3" : "#ffffff",
            color: "#374151",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {showMap ? "🗺 Hide Map" : "🗺 Show Map"}
        </button>
      </div>

      {/* MAP */}
      {showMap && (
        <div style={{ height: 220, position: "relative", borderBottom: "1px solid #e5e7eb" }}>
          <DiscoverMap
            merchants={sortedItems}
            nearMeEnabled={nearMe}
            radiusMiles={radius}
            onPickMerchant={(id) => (window.location.href = `/wheel?merchantId=${encodeURIComponent(id)}`)}
          />
        </div>
      )}

      {/* MERCHANT CARDS */}
      <div style={{
        padding: "12px 12px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#ffffff",
      }}>
        {sortedItems.length === 0 && !busy && (
          <div style={{
            textAlign: "center",
            padding: "30px 20px",
            color: "#9ca3af",
            fontWeight: 600,
            fontSize: 15,
          }}>
            No merchants found. Try a different search — city name, zip code, or business type.
          </div>
        )}

        {sortedItems.map((m) => {
          const photo = (m.photoProcessedUrls?.[0] ?? m.photoUrls?.[0]) || null;
          return (
            <a
              key={m.id}
              href={`/wheel?merchantId=${encodeURIComponent(m.id)}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: m.boostActive ? "#fff7ed" : "#ffffff",
                border: m.boostActive ? "2px solid #f97316" : "1px solid #e5e7eb",
                borderRadius: 16,
                padding: "16px 16px",
                textDecoration: "none",
                color: "#111827",
                boxShadow: m.boostActive ? "0 4px 16px rgba(249,115,22,0.18)" : "0 2px 8px rgba(0,0,0,0.08)",
                minHeight: 90,
                position: "relative",
              }}
            >
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, color: "#111827", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {m.boostActive && <span style={{ fontSize: 18 }}>🔥</span>}
                  {m.name ?? m.id}
                  {m.boostActive && (
                    <span style={{ fontSize: 11, fontWeight: 900, background: "#f97316", color: "#fff", borderRadius: 999, padding: "2px 8px", letterSpacing: 0.3 }}>
                      FREE SPIN
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "#6b7280", marginTop: 5 }}>
                  {m.category ? titleCase(m.category) : ""}
                  {m.city ? ` — ${titleCase(m.city)}` : ""}
                  {m.state ? `, ${m.state.toUpperCase()}` : ""}
                </div>
                {m.distanceMiles != null && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
                    {fmtMiles(m.distanceMiles)} away
                  </div>
                )}
              </div>

              {/* Photo thumbnail */}
              {photo && (
                <img
                  src={photo}
                  alt={m.name ?? "merchant"}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: 130,
                    height: 90,
                    borderRadius: 8,
                    objectFit: "cover",
                    flexShrink: 0,
                    border: "1px solid #e5e7eb",
                  }}
                />
              )}

              {/* View button */}
              <div style={{
                padding: "8px 12px",
                borderRadius: 10,
                background: "linear-gradient(180deg, #FFD700, #FFA500)",
                fontWeight: 800,
                fontSize: 13,
                color: "#1a1a1a",
                whiteSpace: "nowrap",
                flexShrink: 0,
                border: "1px solid #d4a017",
                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              }}>
                View
              </div>
            </a>
          );
        })}
      </div>
    </main>
  );
}
