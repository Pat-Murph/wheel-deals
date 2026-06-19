"use client";
export const dynamic = "force-dynamic";
import nextDynamic from "next/dynamic";

const DiscoverMap = nextDynamic(() => import("../../components/DiscoverMap"), {
  ssr: false,
});

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  searchMerchants,
  type MerchantResult,
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
function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

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
  // Box 1: keyword / food type (pizza, boba, tacos, etc.)
  const [keyword, setKeyword] = useState("");
  // Box 2: location (city, zip, state)
  const [location, setLocation] = useState("");
  // Category filter (via Filter panel)
  const [category, setCategory] = useState("");
  // Near-me filter
  const [nearMe, setNearMe] = useState(false);
  const [radius, setRadius] = useState<number>(10);
  // --- GPS POSITION: cached in sessionStorage so it survives back-navigation ---
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(() => {
    // Initialize from sessionStorage cache (instant on return visits)
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem('wd_gps');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.lat && parsed?.lng) return parsed;
        }
      } catch {}
    }
    return null;
  });
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<MerchantResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [foundingRemaining, setFoundingRemaining] = useState<number>(FOUNDING_MERCHANT_LIMIT);
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [time, setTime] = useState(new Date());

  // Helper: update pos state AND persist to sessionStorage
  function updatePos(newPos: { lat: number; lng: number }) {
    setPos(newPos);
    try { sessionStorage.setItem('wd_gps', JSON.stringify(newPos)); } catch {}
  }

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    getFoundingMerchantCount()
      .then(({ remaining }) => setFoundingRemaining(remaining))
      .catch(() => {});
  }, []);

  // Request fresh GPS on every mount with retry logic + IP fallback.
  // If we already have a cached position, distances show instantly;
  // fresh GPS updates the cache in the background.
  useEffect(() => {
    let cancelled = false;

    function tryGps(attempt: number) {
      if (cancelled || !navigator.geolocation) {
        // No geolocation API — try IP fallback
        if (!cancelled) ipFallback();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (!cancelled) updatePos({ lat: p.coords.latitude, lng: p.coords.longitude });
        },
        () => {
          if (cancelled) return;
          if (attempt < 3) {
            // Retry after a short delay
            setTimeout(() => tryGps(attempt + 1), 1000);
          } else {
            // All GPS attempts failed — try IP-based fallback
            ipFallback();
          }
        },
        { enableHighAccuracy: attempt > 1, timeout: 5000, maximumAge: 300000 }
      );
    }

    function ipFallback() {
      if (cancelled) return;
      // Only use IP fallback if we don't already have a cached position
      if (pos) return;
      fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) })
        .then(r => r.json())
        .then(data => {
          if (!cancelled && data?.latitude && data?.longitude) {
            updatePos({ lat: data.latitude, lng: data.longitude });
          }
        })
        .catch(() => { /* IP fallback also failed — no distances */ });
    }

    tryGps(1);
    return () => { cancelled = true; };
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

  async function runSearch() {
    setBusy(true);
    setError(null);
    try {
      let near = pos;
      if (nearMe && !near) {
        near = await requestLocationOnce();
        updatePos(near);
      }

      const res = await searchMerchants({
        q: keyword.trim(),
        category,
        city: location.trim(),
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

  // Load merchants on mount
  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run search when GPS position first becomes available so server-side
  // mobile-merchant distance filtering is applied correctly.
  const posReadyRef = useRef(false);
  useEffect(() => {
    if (pos && !posReadyRef.current) {
      posReadyRef.current = true;
      // pos just resolved for the first time — re-fetch with location
      runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  // The boost radius: a boosted merchant only gets priority if user is within 50 miles of IT
  const BOOST_RADIUS_MILES = 50;

  // Client-side mobile merchant distance threshold (miles).
  // Mobile merchants beyond this radius are hidden from the discover list.
  const MOBILE_HIDE_RADIUS = 25;

  // Compute distances CLIENT-SIDE from pos state. This is reactive:
  // when pos changes (GPS arrives), this memo re-runs and distances appear.
  // No race condition possible because it's purely derived from state.
  const sortedItems = useMemo(() => {
    const withDist = items.map((m) => {
      if (!pos) return m; // No GPS yet — no distances
      let d: number | undefined;
      const isActiveMobile = m.isMobile && m.mobileActiveUntil &&
        m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > time;
      if (isActiveMobile && typeof m.mobileLat === 'number' && typeof m.mobileLng === 'number') {
        d = distanceMiles(pos.lat, pos.lng, m.mobileLat, m.mobileLng);
      } else if (typeof m.lat === 'number' && typeof m.lng === 'number') {
        d = distanceMiles(pos.lat, pos.lng, m.lat, m.lng);
      }
      return { ...m, distanceMiles: d ?? m.distanceMiles };
    })
    // Client-side safety net: hide mobile merchants that are too far away.
    // The server-side filter handles this when GPS is passed, but on initial
    // load GPS may not be available yet. Once pos resolves, this kicks in.
    .filter((m) => {
      if (!m.isMobile || !pos) return true; // non-mobile always shown; no GPS = show all
      if (m.distanceMiles == null) return false; // mobile with no distance info = hide
      return m.distanceMiles <= MOBILE_HIDE_RADIUS;
    });

    return [...withDist].sort((a, b) => {
      // Boost only SORTS a merchant to the top if the user is within 50 miles of it.
      // For mobile merchants with boostMode='checkin', only boost when checked in.
      function isBoostVisible(m: MerchantResult) {
        if (!m.boostActive) return false;
        if (m.isMobile && m.boostMode !== 'always') {
          const checkedIn = m.mobileActiveUntil && m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > time;
          if (!checkedIn) return false;
        }
        return true;
      }
      const aWithinBoost = isBoostVisible(a) && a.distanceMiles != null && a.distanceMiles <= BOOST_RADIUS_MILES;
      const bWithinBoost = isBoostVisible(b) && b.distanceMiles != null && b.distanceMiles <= BOOST_RADIUS_MILES;
      const aBoost = aWithinBoost ? 1 : 0;
      const bBoost = bWithinBoost ? 1 : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;

      // Fall back to distance (closest first)
      const da = a.distanceMiles;
      const db = b.distanceMiles;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }, [items, pos, time]);

  const queryLabel = useMemo(() => {
    const parts = [keyword.trim(), category, location.trim()].filter(Boolean);
    return parts.length ? parts.join(" · ") : "All merchants";
  }, [keyword, category, location]);

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
          src="/wd-hero-logo.png"
          alt="Wheel Deals — Unlock Local Savings"
          style={{ height: 140, width: "auto", maxWidth: "70%", objectFit: "contain" }}
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
          background: "linear-gradient(135deg, #0f172a, #1e3a5f, #1e40af)",
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
              Build promotional deals.<br />
              Customers pay to unlock your deals.<br />
              Earn from each deal unlocked · Bring real customers into your store.<br />
              Free to sign up · {foundingRemaining} founding spots left.
            </div>
          </div>
          <a href="/merchant/onboard" style={{
            fontSize: 12,
            fontWeight: 800,
            color: "#1e3a5f",
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


      {/* SEARCH BARS */}
      <div style={{
        padding: "10px 12px",
        background: "#f9fafb",
        borderBottom: "1px solid #e5e7eb",
        flexShrink: 0,
        display: "grid",
        gap: 8,
      }}>
        {/* Row 1: Keyword search */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            placeholder='What? e.g. "pizza", "boba", "tacos"...'
            style={{
              minWidth: 0,
              padding: "11px 12px",
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

        {/* Row 2: Location search + Search button */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            placeholder='Where? City, zip, or state...'
            style={{
              minWidth: 0,
              padding: "11px 12px",
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
            onClick={() => runSearch()}
            disabled={busy}
            style={{
              padding: "11px 18px",
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
        </div>

        {/* Filter panel */}
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
              setKeyword(""); setLocation(""); setCategory(""); setNearMe(false);
              setTimeout(() => runSearch(), 0);
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
          {sortedItems.length} deal{sortedItems.length === 1 ? "" : "s"} found — {queryLabel}
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
            No merchants found. Try a different search.
          </div>
        )}

        {sortedItems.map((m) => {
          const photo = (m.photoProcessedUrls?.[0] ?? m.photoUrls?.[0]) || null;
          // For mobile merchants with boostMode='checkin', only show boost when checked in
          const isActiveMobile = m.isMobile && m.mobileActiveUntil && m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > time;
          const showBoost = m.boostActive === true && (
            !m.isMobile || m.boostMode === 'always' || isActiveMobile
          );
          // Coming Soon: merchant hasn't fully connected Stripe (charges not enabled)
          const isComingSoon = !m.stripeAccountId || !m.stripeChargesEnabled;
          return (
            <a
              key={m.id}
              href={isComingSoon ? undefined : `/wheel?merchantId=${encodeURIComponent(m.id)}`}
              onClick={isComingSoon ? (e: React.MouseEvent) => e.preventDefault() : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: isComingSoon ? "#f9fafb" : showBoost ? "#fff7ed" : "#ffffff",
                border: isComingSoon ? "1px solid #d1d5db" : showBoost ? "2px solid #f97316" : "1px solid #e5e7eb",
                borderRadius: 16,
                padding: "16px 16px",
                textDecoration: "none",
                color: "#111827",
                boxShadow: showBoost ? "0 4px 16px rgba(249,115,22,0.18)" : "0 2px 8px rgba(0,0,0,0.08)",
                minHeight: 90,
                position: "relative",
                opacity: isComingSoon ? 0.8 : 1,
                cursor: isComingSoon ? "default" : "pointer",
              }}
            >
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, color: "#111827", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {showBoost && <span style={{ fontSize: 18 }}>🔥</span>}
                  {m.name ?? m.id}
                  {showBoost && (
                    <span style={{ fontSize: 11, fontWeight: 900, background: "#f97316", color: "#fff", borderRadius: 999, padding: "2px 8px", letterSpacing: 0.3 }}>
                      FREE DEAL
                    </span>
                  )}
                  {isComingSoon && (
                    <span style={{ fontSize: 11, fontWeight: 900, background: "#6366f1", color: "#fff", borderRadius: 999, padding: "2px 8px", letterSpacing: 0.3 }}>
                      COMING SOON
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "#6b7280", marginTop: 5 }}>
                  {m.category ? titleCase(m.category) : ""}
                  {m.city ? ` — ${titleCase(m.city)}` : ""}
                  {m.state ? `, ${m.state.toUpperCase()}` : ""}
                </div>
                {/* Mobile merchant badges */}
                {m.isMobile && m.mobileActiveUntil && m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > time ? (
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#d97706", marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🚚</span>
                    <span>Available Now — {formatDuration(m.mobileActiveUntil.toDate().getTime() - time.getTime())} left</span>
                  </div>
                ) : m.isMobile ? (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🚚</span>
                    <span>Mobile</span>
                  </div>
                ) : null}

                {(() => {
                  const isActiveMobile = m.isMobile && m.mobileActiveUntil && m.mobileActiveUntil.toDate && m.mobileActiveUntil.toDate() > time;
                  const showDist = m.distanceMiles != null && (!m.isMobile || isActiveMobile);
                  return showDist ? (
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
                      {fmtMiles(m.distanceMiles)} away
                    </div>
                  ) : null;
                })()}

                {/* Business hours */}
                {(() => {
                  const bh = (m as any).businessHours;
                  if (!bh || typeof bh !== "object") return null;
                  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                  const today = dayNames[time.getDay()];
                  const todayHours = bh[today];
                  if (!todayHours) return null;
                  if (todayHours.closed) return (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", marginTop: 3 }}>Closed today</div>
                  );
                  const fmtTime = (t: string) => {
                    const [h, mi] = t.split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(mi).padStart(2, "0")} ${ampm}`;
                  };
                  return (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginTop: 3 }}>
                      🕒 {fmtTime(todayHours.open)} – {fmtTime(todayHours.close)}
                    </div>
                  );
                })()}
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

              {/* View / Coming Soon button */}
              <div style={{
                padding: "8px 12px",
                borderRadius: 10,
                background: isComingSoon
                  ? "linear-gradient(180deg, #e0e7ff, #c7d2fe)"
                  : "linear-gradient(180deg, #FFD700, #FFA500)",
                fontWeight: 800,
                fontSize: 13,
                color: isComingSoon ? "#4338ca" : "#1a1a1a",
                whiteSpace: "nowrap",
                flexShrink: 0,
                border: isComingSoon ? "1px solid #a5b4fc" : "1px solid #d4a017",
                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              }}>
                {isComingSoon ? "Soon" : "View"}
              </div>
            </a>
          );
        })}
      </div>
    </main>
  );
}
