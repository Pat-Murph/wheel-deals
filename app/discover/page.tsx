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
  const [foundingTotal, setFoundingTotal] = useState<number>(0);
  const [foundingRemaining, setFoundingRemaining] = useState<number>(FOUNDING_MERCHANT_LIMIT);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    getFoundingMerchantCount()
      .then(({ total, remaining }) => {
        setFoundingTotal(total);
        setFoundingRemaining(remaining);
      })
      .catch(() => {});
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

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "#f8f9fa" }}>
      {/* ── TOP BAR ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "white",
        borderBottom: "1px solid #e5e7eb",
        flexShrink: 0,
      }}>
        {/* Logo + title */}
        <img src="/wheel-deals-logo.png" alt="Wheel Deals" style={{ width: 36, height: 36, objectFit: "contain" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 1000, fontSize: 17, lineHeight: 1.1 }}>
            <span style={{ color: "#F6C453" }}>Wheel</span>{" "}
            <span style={{ color: "#2563EB" }}>Deals</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.6 }}>Spin a local wheel. Unlock a deal.</div>
        </div>
        <a href="/merchant" style={{ fontSize: 12, fontWeight: 900, color: "#2563EB", textDecoration: "none", padding: "6px 10px", borderRadius: 8, border: "1px solid #2563EB" }}>
          Merchant
        </a>
      </div>

      {/* ── FOUNDING BANNER (slim) ── */}
      {foundingRemaining > 0 && (
        <div style={{
          background: "linear-gradient(90deg, #0a1628, #1a2f55)",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#F4B400" }}>
            🎉 Founding Merchant — {foundingRemaining}/{FOUNDING_MERCHANT_LIMIT} spots left
          </div>
          <a href="/merchant/onboard" style={{
            fontSize: 11,
            fontWeight: 950,
            color: "#111",
            background: "linear-gradient(180deg, #F4B400, #FF9B3D)",
            padding: "5px 10px",
            borderRadius: 8,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}>
            Claim spot →
          </a>
        </div>
      )}

      {/* ── SEARCH BAR ── */}
      <div style={{
        padding: "8px 10px",
        background: "white",
        borderBottom: "1px solid #e5e7eb",
        flexShrink: 0,
        display: "grid",
        gap: 6,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch({ autoFill: true }); }}
            placeholder='Search "boba", "pizza", "sushi"…'
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            onClick={() => runSearch({ autoFill: true })}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              fontWeight: 900,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(180deg, #F6C453, #FF9B3D)",
              color: "#111",
              whiteSpace: "nowrap",
            }}
          >
            {busy ? "…" : "Search"}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              fontWeight: 900,
              fontSize: 13,
              cursor: "pointer",
              background: showFilters ? "#f3f4f6" : "white",
            }}
          >
            ⚙
          </button>
        </div>

        {/* Collapsible filters */}
        {showFilters && (
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All categories</option>
              {DISCOVER_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
            <select value={city} onChange={(e) => setCity(e.target.value)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All cities</option>
              {dynamicCities.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 800, fontSize: 13 }}>
              <input type="checkbox" checked={nearMe} onChange={async (e) => {
                const on = e.target.checked;
                setNearMe(on);
                if (on) {
                  try {
                    const p = pos ?? (await requestLocationOnce());
                    setPos(p);
                    setTimeout(() => runSearch({ autoFill: true }), 0);
                  } catch (err: any) {
                    setNearMe(false);
                    setError(err?.message ?? "Could not access location.");
                  }
                }
              }} />
              Near me
            </label>
            {nearMe && (
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13 }}>
                {[2, 5, 10, 15, 25].map((r) => <option key={r} value={r}>{r} mi</option>)}
              </select>
            )}
            <button onClick={() => { setQ(""); setCategory(""); setCity(""); setNearMe(false); setTimeout(() => runSearch({ autoFill: false }), 0); }}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontWeight: 800, fontSize: 13, cursor: "pointer", background: "#f3f4f6", gridColumn: "span 2" }}>
              Reset filters
            </button>
          </div>
        )}

        {error && <div style={{ color: "#b91c1c", fontWeight: 900, fontSize: 13 }}>{error}</div>}
        <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.6 }}>
          {items.length} wheel{items.length === 1 ? "" : "s"} found • {queryLabel}
        </div>
      </div>

      {/* ── MAP (fills remaining space) ── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <DiscoverMap
          merchants={items}
          nearMeEnabled={nearMe}
          radiusMiles={radius}
          onPickMerchant={(id) => (window.location.href = `/wheel?merchantId=${encodeURIComponent(id)}`)}
        />
      </div>

      {/* ── BOTTOM SHEET: results (scrollable strip) ── */}
      {items.length > 0 && (
        <div style={{
          flexShrink: 0,
          maxHeight: "28vh",
          overflowX: "auto",
          overflowY: "hidden",
          display: "flex",
          gap: 10,
          padding: "10px 12px",
          background: "white",
          borderTop: "1px solid #e5e7eb",
        }}>
          {items.map((m) => (
            <a
              key={m.id}
              href={`/wheel?merchantId=${encodeURIComponent(m.id)}`}
              style={{
                flexShrink: 0,
                width: 160,
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 10,
                background: "white",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                textDecoration: "none",
                color: "#111",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 950, lineHeight: 1.2 }}>{m.name ?? m.id}</div>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
                {m.category ? titleCase(m.category) : ""}{m.city ? ` • ${titleCase(m.city)}` : ""}
              </div>
              {nearMe && m.distanceMiles != null && (
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>{fmtMiles(m.distanceMiles)}</div>
              )}
              <div style={{
                marginTop: "auto",
                padding: "6px 8px",
                borderRadius: 8,
                background: "linear-gradient(180deg, #F6C453, #FF9B3D)",
                fontWeight: 900,
                fontSize: 12,
                textAlign: "center",
              }}>
                Spin →
              </div>
            </a>
          ))}
        </div>
      )}

      {!busy && items.length === 0 && (
        <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800, opacity: 0.6, background: "white", borderTop: "1px solid #e5e7eb", flexShrink: 0 }}>
          No merchants found. Try a different search.
        </div>
      )}
    </main>
  );
}
