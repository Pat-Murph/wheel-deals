"use client";
import dynamic from "next/dynamic";

const DiscoverMap = dynamic(() => import("../../components/DiscoverMap"), {
  ssr: false,
});

import { useEffect, useMemo, useState } from "react";
import {
  searchMerchants,
  type MerchantResult,
  parseDiscoverQuery,
  DISCOVER_CATEGORIES,
  DISCOVER_CITIES,
} from "../../lib/merchants";

function titleCase(s: string) {
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtMiles(n?: number) {
  if (n == null) return "";
  if (n < 1) return `${Math.round(n * 10) / 10} mi`;
  return `${Math.round(n * 10) / 10} mi`;
}

export default function DiscoverPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");

  // near me
  const [nearMe, setNearMe] = useState(false);
  const [radius, setRadius] = useState<number>(10); // miles
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);

  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<MerchantResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const queryLabel = useMemo(() => {
    const parts = [q.trim(), category, city].filter(Boolean);
    return parts.length ? parts.join(" • ") : "All merchants";
  }, [q, category, city]);

  async function requestLocationOnce() {
    return new Promise<{ lat: number; lng: number }>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation not supported in this browser."));
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

        // remove detected tokens from free text
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
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  // initial load
  useEffect(() => {
    runSearch({ autoFill: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, display: "grid", gap: 14, maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 950 }}>Discover</h1>
          <div style={{ opacity: 0.75, fontWeight: 700, marginTop: 6 }}>
            Search Wheel Deals merchants (category + city + name).
          </div>
        </div>

        <a href="/" style={{ fontWeight: 900, textDecoration: "none", color: "#111", alignSelf: "center" }}>
          ← Back to Wheel
        </a>
      </div>

      {/* Search controls */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 16,
          padding: 14,
          background: "white",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 240px 240px" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch({ autoFill: true });
            }}
            placeholder='Try: "pizza las vegas" or "sushi vegas" or "demo"'
            style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", fontSize: 16 }}
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", fontSize: 16 }}
          >
            <option value="">All categories</option>
            {DISCOVER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </select>

          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", fontSize: 16 }}
          >
            <option value="">All cities</option>
            {DISCOVER_CITIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </select>
        </div>

        {/* Near me row */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
            <input
              type="checkbox"
              checked={nearMe}
              onChange={async (e) => {
                const on = e.target.checked;
                setNearMe(on);

                // If turning on, ask for location immediately (so it feels instant)
                if (on) {
                  try {
                    const p = pos ?? (await requestLocationOnce());
                    setPos(p);
                    // run search after we have location
                    setTimeout(() => runSearch({ autoFill: true }), 0);
                  } catch (err: any) {
                    setNearMe(false);
                    setError(err?.message ?? "Could not access location.");
                  }
                }
              }}
            />
            Near me
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 800, opacity: 0.8 }}>Radius</span>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              disabled={!nearMe}
              style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", fontWeight: 800 }}
            >
              {[2, 5, 10, 15, 25].map((r) => (
                <option key={r} value={r}>
                  {r} mi
                </option>
              ))}
            </select>

            {nearMe && (
              <button
                onClick={async () => {
                  try {
                    const p = await requestLocationOnce();
                    setPos(p);
                    setTimeout(() => runSearch({ autoFill: true }), 0);
                  } catch (err: any) {
                    setError(err?.message ?? "Could not refresh location.");
                  }
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 900,
                  cursor: "pointer",
                  background: "linear-gradient(180deg, #f3f4f6, #fff)",
                }}
              >
                Update location
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => runSearch({ autoFill: true })}
            disabled={busy}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
            }}
          >
            {busy ? "Searching…" : "Search"}
          </button>

          <button
            onClick={() => {
              setQ("");
              setCategory("");
              setCity("");
              setNearMe(false);
              setTimeout(() => runSearch({ autoFill: false }), 0);
            }}
            disabled={busy}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(180deg, #f3f4f6, #fff)",
            }}
          >
            Clear
          </button>

          <div style={{ alignSelf: "center", opacity: 0.7, fontWeight: 800 }}>Showing: {queryLabel}</div>
        </div>

        {error && <div style={{ color: "#b91c1c", fontWeight: 900 }}>{error}</div>}
      </div>
        <DiscoverMap
  merchants={items}
  nearMeEnabled={nearMe}
  radiusMiles={radius}
  onPickMerchant={(id) => (window.location.href = `/?merchantId=${encodeURIComponent(id)}`)}
/>


      {/* Results */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {items.map((m) => (
          <div
            key={m.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 16,
              padding: 14,
              background: "white",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 950 }}>{m.name ?? m.id}</div>
              {nearMe && m.distanceMiles != null && (
                <div style={{ fontWeight: 900, opacity: 0.75 }}>{fmtMiles(m.distanceMiles)}</div>
              )}
            </div>

            <div style={{ opacity: 0.75, fontWeight: 800 }}>
              {m.category ? titleCase(m.category) : "—"} • {m.city ? titleCase(m.city) : "—"}
            </div>

            {m.address && <div style={{ opacity: 0.7, fontWeight: 700 }}>{m.address}</div>}

            <a
              href={`/?merchantId=${encodeURIComponent(m.id)}`}
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.12)",
                fontWeight: 900,
                textDecoration: "none",
                color: "#111",
                background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                textAlign: "center",
              }}
            >
              Spin this wheel →
            </a>
          </div>
        ))}
      </div>

      {!busy && items.length === 0 && <div style={{ opacity: 0.75, fontWeight: 800 }}>No merchants found.</div>}
    </main>
  );
}
