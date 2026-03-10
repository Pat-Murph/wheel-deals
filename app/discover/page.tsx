"use client";
export const dynamic = "force-dynamic";
import nextDynamic from "next/dynamic";

const DiscoverMap = nextDynamic(() => import("../../components/DiscoverMap"), {
  ssr: false,
});

import { useEffect, useMemo, useState } from "react";
import {
  searchMerchants,
  getDynamicCities,
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

// Haversine distance in miles (client-side, for sorting without "Near me" filter)
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
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [nearMe, setNearMe] = useState(false);
  const [radius, setRadius] = useState<number>(10);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<MerchantResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dynamicCities, setDynamicCities] = useState<string[]>([]);
  const [foundingRemaining, setFoundingRemaining] = useState<number>(FOUNDING_MERCHANT_LIMIT);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    getFoundingMerchantCount()
      .then(({ remaining }) => setFoundingRemaining(remaining))
      .catch(() => {});
  }, []);

  // Silently try to get location on load for distance sorting (no filter applied)
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {}, // silently ignore if denied
        { enableHighAccuracy: false, timeout: 8000 }
      );
    }
  }, []);

  const queryLabel = useMemo(() => {
    const parts = [q.trim(), category, city].filter(Boolean);
    return parts.length ? parts.join(" • ") : "All merchants";
  }, [q, category, city]);

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
      let nextQ = q;
      let nextCategory = category;
      let nextCity = city;

      if (autoFill) {
        const parsed = parseDiscoverQuery(q);
        if (!nextCategory && parsed.category) nextCategory = parsed.category;
        if (!nextCity && parsed.city) nextCity = parsed.city;
        nextQ = parsed.text;
        if (nextQ !== q) setQ(nextQ);
        if (nextCategory !== category) setCategory(nextCategory);
        if (nextCity !== city) setCity(nextCity);
      }

      let near = pos;
      if (nearMe && !near) {
        near = await requestLocationOnce();
        setPos(near);
      }

      const res = await searchMerchants({
        q: nextQ,
        category: nextCategory,
        city: nextCity,
        near: nearMe ? near : null,
        radiusMiles: nearMe ? radius : null,
      });

      setItems(res);

      if (dynamicCities.length === 0) {
        try {
          const cities = await getDynamicCities();
          setDynamicCities(cities);
        } catch {}
      }
    } catch (e: any) {
      setError(e?.message ?? "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    runSearch({ autoFill: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sort items by distance from user's location (when not using "Near me" filter)
  const sortedItems = useMemo(() => {
    if (nearMe || !pos) return items; // already sorted by searchMerchants when nearMe
    return [...items].map((m) => {
      if (typeof m.lat === "number" && typeof m.lng === "number") {
        return { ...m, distanceMiles: distanceMiles(pos.lat, pos.lng, m.lat, m.lng) };
      }
      return m;
    }).sort((a, b) => {
      const da = a.distanceMiles;
      const db = b.distanceMiles;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }, [items, pos, nearMe]);

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
        {/* Logo — left */}
        <img
          src="/wheel-deals-discover.png"
          alt="Wheel Deals Discover"
          style={{ height: 160, width: "auto", objectFit: "contain" }}
        />
        {/* Merchant button — right */}
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
              🎡 Own a business? Build a spin wheel.
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.92)", lineHeight: 1.4 }}>
              Earn from every spin · Free to sign up · {foundingRemaining} founding spots left
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch({ autoFill: true }); }}
            placeholder='Search "boba", "pizza"...'
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

        {showFilters && (
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{
              padding: "10px 10px", borderRadius: 8, border: "1px solid #d1d5db",
              fontSize: 14, background: "#ffffff", color: "#111827", fontWeight: 500,
            }}>
              <option value="">All categories</option>
              {DISCOVER_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
            <select value={city} onChange={(e) => setCity(e.target.value)} style={{
              padding: "10px 10px", borderRadius: 8, border: "1px solid #d1d5db",
              fontSize: 14, background: "#ffffff", color: "#111827", fontWeight: 500,
            }}>
              <option value="">All cities</option>
              {dynamicCities.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
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
                {[2, 5, 10, 15, 25].map((r) => <option key={r} value={r}>{r} mi</option>)}
              </select>
            )}
            <button onClick={() => { setQ(""); setCategory(""); setCity(""); setNearMe(false); setTimeout(() => runSearch({ autoFill: false }), 0); }}
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
          {sortedItems.length} wheel{sortedItems.length === 1 ? "" : "s"} found — {queryLabel}
        </div>
      </div>

      {/* MAP */}
      <div style={{ height: 220, position: "relative", borderBottom: "1px solid #e5e7eb" }}>
        <DiscoverMap
          merchants={sortedItems}
          nearMeEnabled={nearMe}
          radiusMiles={radius}
          onPickMerchant={(id) => (window.location.href = `/wheel?merchantId=${encodeURIComponent(id)}`)}
        />
      </div>

      {/* MERCHANT CARDS - vertical scrollable list */}
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
            No merchants found. Try a different search.
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
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: "16px 16px",
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              minHeight: 90,
            }}
          >
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>  
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, color: "#111827" }}>
                {m.name ?? m.id}
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, color: "#6b7280", marginTop: 5 }}>
                {m.category ? titleCase(m.category) : ""}
                {m.city ? ` — ${titleCase(m.city)}` : ""}
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
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 14,
                  objectFit: "cover",
                  flexShrink: 0,
                  border: "1px solid #e5e7eb",
                }}
              />
            )}

            {/* Spin button */}
            <div style={{
              padding: "14px 20px",
              borderRadius: 12,
              background: "linear-gradient(180deg, #FFD700, #FFA500)",
              fontWeight: 800,
              fontSize: 16,
              color: "#1a1a1a",
              whiteSpace: "nowrap",
              flexShrink: 0,
              border: "1px solid #d4a017",
              boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
            }}>
              Spin
            </div>
          </a>
          );
        })}
      </div>
    </main>
  );
}
