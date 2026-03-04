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
    <main style={{
      display: "flex",
      flexDirection: "column",
      minHeight: "100dvh",
      background: "linear-gradient(180deg, #1a4a1a 0%, #0f2d0f 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>

      {/* TOP HERO HEADER */}
      <div style={{
        background: "linear-gradient(180deg, #1e5c1e 0%, #154015 100%)",
        borderBottom: "3px solid #c8a84b",
        padding: "12px 14px 10px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}>
        <img
          src="/wheel-deals-discover.png"
          alt="Wheel Deals Discover"
          style={{ width: 72, height: 72, objectFit: "contain", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 22, lineHeight: 1.1, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
            <span style={{ color: "#FFD700" }}>Wheel</span>{" "}
            <span style={{ color: "#7EC8E3" }}>Deals</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#c8e6c8", opacity: 0.9, marginTop: 2 }}>
            Spin a local wheel. Unlock a deal.
          </div>
        </div>
        <a href="/merchant" style={{
          fontSize: 13,
          fontWeight: 900,
          color: "#1a1a1a",
          textDecoration: "none",
          padding: "8px 14px",
          borderRadius: 10,
          background: "linear-gradient(180deg, #FFD700, #FFA500)",
          border: "2px solid #c8a84b",
          boxShadow: "0 3px 10px rgba(0,0,0,0.3)",
          whiteSpace: "nowrap",
        }}>
          Merchant
        </a>
      </div>

      {/* FOUNDING BANNER - GREEN */}
      {foundingRemaining > 0 && (
        <div style={{
          background: "linear-gradient(90deg, #1a6b1a, #2d8a2d)",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
          borderBottom: "2px solid #4caf50",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#FFD700", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
            Founding Merchant — {foundingRemaining}/{FOUNDING_MERCHANT_LIMIT} spots left
          </div>
          <a href="/merchant/onboard" style={{
            fontSize: 12,
            fontWeight: 900,
            color: "#1a1a1a",
            background: "linear-gradient(180deg, #FFD700, #FFA500)",
            padding: "7px 12px",
            borderRadius: 9,
            textDecoration: "none",
            whiteSpace: "nowrap",
            border: "2px solid #c8a84b",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}>
            Claim spot
          </a>
        </div>
      )}

      {/* SEARCH BAR */}
      <div style={{
        padding: "10px 12px",
        background: "rgba(0,0,0,0.25)",
        borderBottom: "1px solid rgba(200,168,75,0.3)",
        flexShrink: 0,
        display: "grid",
        gap: 8,
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch({ autoFill: true }); }}
            placeholder='Search "boba", "pizza", "sushi"...'
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 12,
              border: "2px solid rgba(200,168,75,0.5)",
              fontSize: 15,
              outline: "none",
              background: "rgba(255,255,255,0.95)",
              color: "#1a1a1a",
              fontWeight: 600,
            }}
          />
          <button
            onClick={() => runSearch({ autoFill: true })}
            disabled={busy}
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              border: "2px solid #c8a84b",
              fontWeight: 900,
              fontSize: 15,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(180deg, #FFD700, #FFA500)",
              color: "#1a1a1a",
              whiteSpace: "nowrap",
              boxShadow: "0 3px 10px rgba(0,0,0,0.3)",
            }}
          >
            {busy ? "..." : "Search"}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "2px solid rgba(200,168,75,0.4)",
              fontWeight: 900,
              fontSize: 16,
              cursor: "pointer",
              background: showFilters ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.1)",
              color: "#FFD700",
            }}
          >
            Filters
          </button>
        </div>

        {showFilters && (
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{
              padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(200,168,75,0.4)",
              fontSize: 14, background: "rgba(255,255,255,0.95)", color: "#1a1a1a", fontWeight: 600,
            }}>
              <option value="">All categories</option>
              {DISCOVER_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
            <select value={city} onChange={(e) => setCity(e.target.value)} style={{
              padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(200,168,75,0.4)",
              fontSize: 14, background: "rgba(255,255,255,0.95)", color: "#1a1a1a", fontWeight: 600,
            }}>
              <option value="">All cities</option>
              {dynamicCities.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800, fontSize: 14, color: "#c8e6c8" }}>
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
              }} style={{ width: 18, height: 18 }} />
              Near me
            </label>
            {nearMe && (
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{
                padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(200,168,75,0.4)",
                fontSize: 14, background: "rgba(255,255,255,0.95)", color: "#1a1a1a", fontWeight: 600,
              }}>
                {[2, 5, 10, 15, 25].map((r) => <option key={r} value={r}>{r} mi</option>)}
              </select>
            )}
            <button onClick={() => { setQ(""); setCategory(""); setCity(""); setNearMe(false); setTimeout(() => runSearch({ autoFill: false }), 0); }}
              style={{
                padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(200,168,75,0.4)",
                fontWeight: 800, fontSize: 14, cursor: "pointer",
                background: "rgba(255,255,255,0.1)", color: "#FFD700",
                gridColumn: "span 2",
              }}>
              Reset filters
            </button>
          </div>
        )}

        {error && (
          <div style={{
            color: "#ff6b6b", fontWeight: 900, fontSize: 14,
            background: "rgba(255,0,0,0.1)", padding: "8px 12px", borderRadius: 8,
          }}>
            {error}
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 800, color: "#a8d5a8" }}>
          {items.length} wheel{items.length === 1 ? "" : "s"} found — {queryLabel}
        </div>
      </div>

      {/* MAP */}
      <div style={{ height: "28vh", minHeight: 160, maxHeight: 220, position: "relative", flexShrink: 0, borderBottom: "2px solid rgba(200,168,75,0.3)" }}>
        <DiscoverMap
          merchants={items}
          nearMeEnabled={nearMe}
          radiusMiles={radius}
          onPickMerchant={(id) => (window.location.href = `/wheel?merchantId=${encodeURIComponent(id)}`)}
        />
      </div>

      {/* MERCHANT CARDS - vertical scrollable list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {items.length === 0 && !busy && (
          <div style={{
            textAlign: "center",
            padding: "30px 20px",
            color: "#a8d5a8",
            fontWeight: 800,
            fontSize: 15,
          }}>
            No merchants found. Try a different search.
          </div>
        )}

        {items.map((m) => (
          <a
            key={m.id}
            href={`/wheel?merchantId=${encodeURIComponent(m.id)}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              background: "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
              border: "2px solid rgba(200,168,75,0.4)",
              borderRadius: 16,
              padding: "14px 16px",
              textDecoration: "none",
              color: "#fff",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            {/* Prize Wheel icon */}
            <div style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #FFD700, #FFA500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 3px 10px rgba(0,0,0,0.3)",
              border: "2px solid #c8a84b",
              padding: 4,
            }}>
              <svg viewBox="0 0 100 100" width="40" height="40">
                {/* Prize wheel segments */}
                <circle cx="50" cy="50" r="48" fill="#8B0000" stroke="#c8a84b" strokeWidth="2"/>
                {[0,1,2,3,4,5,6,7].map((i) => {
                  const colors = ["#FF4444","#FFD700","#4CAF50","#2196F3","#FF9800","#9C27B0","#00BCD4","#FF5722"];
                  const angle = (i * 45) * Math.PI / 180;
                  const nextAngle = ((i + 1) * 45) * Math.PI / 180;
                  const x1 = 50 + 48 * Math.cos(angle);
                  const y1 = 50 + 48 * Math.sin(angle);
                  const x2 = 50 + 48 * Math.cos(nextAngle);
                  const y2 = 50 + 48 * Math.sin(nextAngle);
                  return <path key={i} d={`M50,50 L${x1},${y1} A48,48 0 0,1 ${x2},${y2} Z`} fill={colors[i]} stroke="#c8a84b" strokeWidth="1"/>;
                })}
                {/* Center hub */}
                <circle cx="50" cy="50" r="10" fill="#FFD700" stroke="#c8a84b" strokeWidth="2"/>
                {/* Pointer */}
                <polygon points="50,2 46,14 54,14" fill="#FFD700" stroke="#c8a84b" strokeWidth="1"/>
              </svg>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.2, color: "#FFD700", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                {m.name ?? m.id}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#c8e6c8", marginTop: 3 }}>
                {m.category ? titleCase(m.category) : ""}
                {m.city ? ` — ${titleCase(m.city)}` : ""}
              </div>
              {nearMe && m.distanceMiles != null && (
                <div style={{ fontSize: 12, fontWeight: 800, color: "#a8d5a8", marginTop: 2 }}>
                  {fmtMiles(m.distanceMiles)} away
                </div>
              )}
            </div>

            {/* Spin button */}
            <div style={{
              padding: "10px 16px",
              borderRadius: 12,
              background: "linear-gradient(180deg, #FFD700, #FFA500)",
              fontWeight: 900,
              fontSize: 14,
              color: "#1a1a1a",
              whiteSpace: "nowrap",
              flexShrink: 0,
              boxShadow: "0 3px 8px rgba(0,0,0,0.3)",
              border: "2px solid #c8a84b",
            }}>
              Spin
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
