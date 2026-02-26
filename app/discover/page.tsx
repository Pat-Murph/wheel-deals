"use client";
import dynamic from "next/dynamic";

const DiscoverMap = dynamic(() => import("../../components/DiscoverMap"), {
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

/** ---------- Hero Logo (decorative) ---------- */
function HeroLogo() {
  return (
    <div
      style={{
        width: 320,
        display: "grid",
        justifyItems: "center",
        gap: 12,
        marginInline: "auto",
      }}
      aria-hidden
    >
      <div
        style={{
          width: 300,
          height: 300,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background:
            "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.18), rgba(255,255,255,0) 55%), radial-gradient(circle at 55% 65%, rgba(255,0,0,0.16), rgba(255,0,0,0) 60%)",
          boxShadow:
            "0 26px 70px rgba(0,0,0,0.10), 0 0 48px rgba(255,0,0,0.18)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* subtle animated sheen */}
        <div
          style={{
            position: "absolute",
            inset: -80,
            background:
              "conic-gradient(from 180deg, rgba(255,255,255,0.00), rgba(255,255,255,0.10), rgba(255,255,255,0.00))",
            animation: "wdSheen 8s linear infinite",
            opacity: 0.65,
          }}
        />

        <img
          src="/wheel-deals-logo.png"
          alt="Wheel Deals"
          style={{
            width: 240,
            height: "auto",
            position: "relative",
            zIndex: 2,
            filter:
              "drop-shadow(0 18px 40px rgba(0,0,0,0.22)) drop-shadow(0 0 28px rgba(255,0,0,0.22))",
          }}
        />
      </div>

      <style>{`
        @keyframes wdSheen {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
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
  const [dynamicCities, setDynamicCities] = useState<string[]>([]);

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

      // Populate city filter dynamically from all active merchants (not just filtered)
      if (dynamicCities.length === 0) {
        try {
          const cities = await getDynamicCities();
          setDynamicCities(cities);
        } catch {
          // non-critical — city filter just stays empty
        }
      }
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

  const wheelsFoundLabel = `${items.length} wheel${items.length === 1 ? "" : "s"} found`;

  return (
    <main
      style={{
        padding: 24,
        display: "grid",
        gap: 14,
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      {/* HERO */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 22,
          overflow: "hidden",
          background:
            "radial-gradient(900px 380px at 22% 10%, rgba(255,217,61,0.22), transparent 58%), radial-gradient(900px 420px at 85% 20%, rgba(255,0,0,0.14), transparent 55%), linear-gradient(180deg, #fff, #fafafa)",
          boxShadow: "0 18px 70px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 18,
            padding: 22,
            alignItems: "center",
          }}
        >
          {/* Left */}
          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                fontSize: 46,
                fontWeight: 1000,
                letterSpacing: -0.6,
                lineHeight: 1.02,
              }}
            >
              <span style={{ color: "#EF4444" }}>Discover</span>{" "}
  <span style={{ color: "#F6C453" }}>Wheel</span>{" "}
  <span style={{ color: "#2563EB" }}>Deals</span>
            </div>

            <div style={{ fontSize: 18, fontWeight: 850, opacity: 0.86 }}>
              Spin a local wheel. Unlock a deal.
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: 6,
              }}
            >
              <button
                onClick={async () => {
                  setNearMe(true);
                  try {
                    const p = pos ?? (await requestLocationOnce());
                    setPos(p);
                    setTimeout(() => runSearch({ autoFill: true }), 0);
                  } catch (err: any) {
                    setNearMe(false);
                    setError(err?.message ?? "Could not access location.");
                  }
                }}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 950,
                  cursor: "pointer",
                  background:
                    "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                  boxShadow: "0 14px 34px rgba(0,0,0,0.12)",
                }}
              >
                Find deals near me
              </button>

              <button
                onClick={() => setTimeout(() => runSearch({ autoFill: true }), 0)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 950,
                  cursor: "pointer",
                  background: "linear-gradient(180deg, #f3f4f6, #fff)",
                }}
              >
                Explore deals
              </button>

              <div style={{ fontWeight: 900, opacity: 0.7 }}>
                {wheelsFoundLabel}
              </div>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(255,255,255,0.75)",
                width: "fit-content",
                fontWeight: 900,
                fontSize: 13,
                opacity: 0.9,
                marginTop: 4,
              }}
            >
              🎉 Local businesses • Real prizes
            </div>

            <div style={{ opacity: 0.72, fontWeight: 800 }}>
              Tip: search “boba”, “pizza”, “sushi”, or click a wheel pin on the
              map.
            </div>

            {/* Merchant CTA */}
            <div
              style={{
                marginTop: 6,
                borderRadius: 18,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(255,255,255,0.72)",
                padding: 14,
                display: "grid",
                gap: 6,
                maxWidth: 520,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 1000 }}>
                Own a business?
              </div>
              <div style={{ fontWeight: 800, opacity: 0.82 }}>
                Get discovered by locals and turn spins into new customers.
              </div>
              <div style={{ fontWeight: 850, opacity: 0.75 }}>
                Set up in minutes • Control your wheel
              </div>

              {/* CTA buttons */}
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <a
                  href="/merchant/onboard"
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(0,0,0,0.12)",
                    fontWeight: 1000,
                    textDecoration: "none",
                    color: "#111",
                    background:
                      "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                    boxShadow: "0 14px 34px rgba(0,0,0,0.12)",
                  }}
                >
                  Become a merchant →
                </a>

                <a
                  href="/merchant"
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(0,0,0,0.12)",
                    fontWeight: 1000,
                    textDecoration: "none",
                    color: "#111",
                    background: "linear-gradient(180deg, #f3f4f6, #fff)",
                  }}
                >
                  Merchant login →
                </a>
              </div>
            </div>
          </div>

          {/* Right */}
          <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
            <HeroLogo />
            <div style={{ fontWeight: 900, opacity: 0.75, textAlign: "center" }}>
              Click a wheel pin to spin that merchant.
            </div>
          </div>
        </div>

        {/* Responsive */}
        <style>{`
          @media (max-width: 860px) {
            section > div {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </section>

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
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "1fr 240px 240px",
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch({ autoFill: true });
            }}
            placeholder='What are you craving? Try: "boba", "pizza las vegas", "sushi"'
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              fontSize: 16,
            }}
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              fontSize: 16,
            }}
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
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              fontSize: 16,
            }}
          >
            <option value="">All cities</option>
            {dynamicCities.map((c) => (
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
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #ddd",
                fontWeight: 800,
              }}
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

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => runSearch({ autoFill: true })}
            disabled={busy}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              background:
                "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
            }}
          >
            {busy ? "Searching…" : "Explore deals"}
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
            Reset
          </button>

          <div style={{ opacity: 0.7, fontWeight: 800 }}>
            Showing: {queryLabel}
          </div>
        </div>

        {error && <div style={{ color: "#b91c1c", fontWeight: 900 }}>{error}</div>}
      </div>

      {/* Map (keep your wheel pins) */}
      <DiscoverMap
        merchants={items}
        nearMeEnabled={nearMe}
        radiusMiles={radius}
        onPickMerchant={(id) =>
          (window.location.href = `/?merchantId=${encodeURIComponent(id)}`)
        }
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
              {m.category ? titleCase(m.category) : "—"} •{" "}
              {m.city ? titleCase(m.city) : "—"}
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
                background:
                  "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                textAlign: "center",
              }}
            >
              Spin this wheel →
            </a>
          </div>
        ))}
      </div>

      {!busy && items.length === 0 && (
        <div style={{ opacity: 0.75, fontWeight: 800 }}>No merchants found.</div>
      )}
    </main>
  );
}
