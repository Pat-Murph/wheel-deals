"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Wheel, { WheelItem } from "./Wheel";
import { QRCodeCanvas } from "qrcode.react";
import { getActiveMerchants, type Merchant } from "../lib/merchants";
import SpinCelebration from "./SpinCelebration";

import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { app } from "../lib/firebase";

type Props = {
  initialMerchantId?: string;
};

function titleCase(s: string) {
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function getMerchantPhotos(m: any) {
  const processed = safeArray<string>(m?.photoProcessedUrls);
  const originals = safeArray<string>(m?.photoUrls);
  return processed.length ? processed : originals;
}

function getMerchantWheel(m: any): WheelItem[] | null {
  const raw = safeArray<any>(m?.wheel);
  if (!raw.length) return null;

  const items: WheelItem[] = raw
    .map((r) => ({
      label: String(r?.label ?? "").trim(),
      weight: Number(r?.weight ?? 0),
    }))
    .filter((r) => r.label && r.weight > 0);

  return items.length ? items : null;
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return "https://" + url;
}

export default function WheelDealsClient({ initialMerchantId }: Props) {
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const auth = getAuth(app);
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        try {
          const cred = await signInAnonymously(auth);
          setUid(cred.user.uid);
          return;
        } catch (e) {
          console.error("Anonymous sign-in failed", e);
          return;
        }
      }
      setUid(u.uid);
    });
    return () => unsub();
  }, []);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [merchantLoadError, setMerchantLoadError] = useState<string | null>(null);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>("");
  const [issuedCode, setIssuedCode] = useState("");
  const [lastPrize, setLastPrize] = useState<string | null>(null);
  const [spinError, setSpinError] = useState<string | null>(null);
  // Celebration overlay state
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [celebrationWeightPct, setCelebrationWeightPct] = useState(50);
  const [celebrationLabel, setCelebrationLabel] = useState("");
  // Pending result — shown after celebration dismisses
  const pendingResultRef = useRef<{ label: string; code: string } | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [photoBroken, setPhotoBroken] = useState<Record<string, boolean>>({});
  // Geolocation for free spin proximity gate
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoChecking, setGeoChecking] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  async function sendCodeByEmail() {
    if (!emailInput.trim() || !issuedCode) return;
    setEmailSending(true);
    setEmailStatus(null);
    try {
      const subject = encodeURIComponent(`Your Wheel Deals Prize Code — ${lastPrize ?? "Prize"}`);
      const body = encodeURIComponent(
        `Hi!\n\nYou won: ${lastPrize ?? "a prize"} at ${selectedMerchant?.name ?? "Wheel Deals"}!\n\nYour redemption code: ${issuedCode}\n\nShow this code (or the QR) to the merchant to redeem. One-time use only.\n\n— Wheel Deals`
      );
      window.open(`mailto:${emailInput.trim()}?subject=${subject}&body=${body}`, "_blank");
      setEmailStatus("✅ Email app opened with the code ready to send!");
    } catch {
      setEmailStatus("❌ Could not open email app. Please copy the code manually.");
    } finally {
      setEmailSending(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingMerchants(true);
      setMerchantLoadError(null);
      try {
        const list = await getActiveMerchants();
        if (!mounted) return;
        setMerchants(list);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setMerchantLoadError(e?.message ?? "Could not load merchants.");
      } finally {
        if (!mounted) return;
        setLoadingMerchants(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!merchants.length) return;
    const found = (initialMerchantId && merchants.find((m) => m.id === initialMerchantId)) || null;
    const next = found?.id ?? merchants[0].id;
    if (!selectedMerchantId) {
      setSelectedMerchantId(next);
      setIssuedCode("");
      setLastPrize(null);
      setSpinError(null);
      setActivePhotoIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchants, initialMerchantId]);

  const selectedMerchant = useMemo(() => {
    if (!merchants.length) return null;
    return merchants.find((m) => m.id === selectedMerchantId) ?? merchants[0];
  }, [merchants, selectedMerchantId, merchants.length]);

  useEffect(() => {
    if (!merchants.length) return;
    if (!initialMerchantId) return;
    const found = merchants.find((m) => m.id === initialMerchantId);
    if (!found) return;
    if (found.id !== selectedMerchantId) {
      setSelectedMerchantId(found.id);
      setIssuedCode("");
      setLastPrize(null);
      setSpinError(null);
      setActivePhotoIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMerchantId, merchants]);

  const merchantPhotos = useMemo(() => {
    if (!selectedMerchant) return [];
    return getMerchantPhotos(selectedMerchant);
  }, [selectedMerchant]);

  useEffect(() => {
    setActivePhotoIdx(0);
    setPhotoBroken({});
  }, [selectedMerchantId]);

  const heroPhoto = merchantPhotos[activePhotoIdx] || merchantPhotos[0] || "";
  const heroBroken = heroPhoto ? !!photoBroken[heroPhoto] : false;

  const aboutText = (selectedMerchant as any)?.about || "";
  const category = (selectedMerchant as any)?.category || "";
  const city = (selectedMerchant as any)?.city || "";
  const website = (selectedMerchant as any)?.website || "";
  const phone = (selectedMerchant as any)?.phone || "";

  // Multi-wheel support: derive list of wheels from merchant doc
  const merchantWheels = useMemo(() => {
    const m = selectedMerchant as any;
    const rawWheels = Array.isArray(m?.wheels) ? m.wheels : [];
    // Filter to valid wheels
    const valid = rawWheels.filter(
      (wc: any) => Array.isArray(wc?.items) && wc.items.length > 0
    );
    if (valid.length > 0) return valid as Array<{ spinPriceCents: number; items: WheelItem[] }>;
    // Fall back to legacy single wheel
    const legacy = getMerchantWheel(m);
    if (legacy) return [{ spinPriceCents: 135, items: legacy }];
    return [{
      spinPriceCents: 135,
      items: [
        { label: "10% OFF", weight: 40 },
        { label: "15% OFF", weight: 25 },
        { label: "20% OFF", weight: 20 },
        { label: "BOGO", weight: 10 },
        { label: "FREE UPGRADE", weight: 5 },
      ],
    }];
  }, [selectedMerchant]);

  const [selectedWheelIdx, setSelectedWheelIdx] = useState(0);
  // Locked to the tier that was actually paid — prevents switching to a different tier after payment
  const [paidTierCents, setPaidTierCents] = useState<number | null>(null);
  const wheelContainerRef = useRef<HTMLDivElement>(null);
  const [wheelContainerWidth, setWheelContainerWidth] = useState(0);
  useEffect(() => {
    if (!wheelContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWheelContainerWidth(e.contentRect.width);
    });
    ro.observe(wheelContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset wheel selection and payment lock when merchant changes
  useEffect(() => {
    setSelectedWheelIdx(0);
    setPaidTierCents(null);
  }, [selectedMerchantId]);

  const activeWheel = merchantWheels[selectedWheelIdx] ?? merchantWheels[0];
  const wheelItems: WheelItem[] = activeWheel?.items ?? [];

  // Haversine distance in meters
  function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Is the active wheel a boosted free-spin wheel?
  const isFreeSpinWheel = useMemo(() => {
    if (!(selectedMerchant as any)?.boostActive) return false;
    const boostPrice = (selectedMerchant as any)?.boostWheelPriceCents;
    return boostPrice != null && activeWheel?.spinPriceCents === boostPrice;
  }, [selectedMerchant, activeWheel]);

  // Distance from user to merchant in meters
  const distanceToMerchantMeters = useMemo(() => {
    if (!userPos) return null;
    const m = selectedMerchant as any;
    if (typeof m?.lat !== "number" || typeof m?.lng !== "number") return null;
    return haversineMeters(userPos.lat, userPos.lng, m.lat, m.lng);
  }, [userPos, selectedMerchant]);

  const isWithin200m = distanceToMerchantMeters != null && distanceToMerchantMeters <= 200;

  async function requestLocationForFreeSpin() {
    setGeoChecking(true);
    setGeoError(null);
    return new Promise<void>((resolve) => {
      if (!navigator.geolocation) {
        setGeoError("Geolocation is not supported by your browser.");
        setGeoChecking(false);
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude });
          setGeoChecking(false);
          resolve();
        },
        (err) => {
          setGeoError("Location permission denied. Please allow location access to claim your free deal.");
          setGeoChecking(false);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  const reportHref = useMemo(() => {
    const mid = selectedMerchant?.id ?? "";
    const name = selectedMerchant?.name ?? "";
    const subject = encodeURIComponent("Wheel Deals — Report a merchant");
    const body = encodeURIComponent(`Please describe the issue.\n\nMerchant Name: ${name}\nMerchant ID: ${mid}\n\nWhat happened:\n`);
    return `mailto:support@wheeldeals.app?subject=${subject}&body=${body}`;
  }, [selectedMerchant?.id, selectedMerchant?.name]);

  if (loadingMerchants) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ fontWeight: 800, opacity: 0.8 }}>Loading…</div>
      </div>
    );
  }

  if (merchantLoadError) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ maxWidth: 640, border: "1px solid rgba(239,68,68,0.30)", background: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 14, fontWeight: 900 }}>
          ❌ {merchantLoadError}
        </div>
        <a href="/discover" style={{ fontWeight: 900, textDecoration: "none", color: "#111", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "linear-gradient(180deg, #f3f4f6, #fff)" }}>
          Go to discovery →
        </a>
      </div>
    );
  }

  if (!merchants.length || !selectedMerchant) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ fontWeight: 900 }}>No active merchants found.</div>
        <a href="/discover" style={{ fontWeight: 900, textDecoration: "none", color: "#111", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "linear-gradient(180deg, #f3f4f6, #fff)" }}>
          Go to discovery →
        </a>
      </div>
    );
  }

  return (
    <div style={{
      width: "100%",
      maxWidth: 520,
      margin: "0 auto",
      padding: "12px 6px 32px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxSizing: "border-box",
    }}>

      {/* Top nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div />
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/discover" style={{
            fontWeight: 900, textDecoration: "none", color: "#111",
            padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(180deg, #f3f4f6, #fff)", fontSize: 13,
          }}>
            ← Discover
          </a>
          <a href={reportHref} style={{
            fontWeight: 900, textDecoration: "none", color: "#111",
            padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(180deg, #f3f4f6, #fff)", fontSize: 13,
          }}>
            Report
          </a>
        </div>
      </div>

      {/* Merchant info card */}
      <div style={{
        border: "2px solid #C8960C",
        borderRadius: 16,
        background: "white",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(200,150,12,0.18), 0 2px 8px rgba(0,0,0,0.08)",
      }}>
        {/* Hero photo */}
        {heroPhoto && !heroBroken ? (
          <div style={{ width: "100%", height: 180, background: "#f3f4f6", overflow: "hidden" }}>
            <img
              src={heroPhoto}
              alt={`${selectedMerchant.name} photo`}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={() => setPhotoBroken((p) => ({ ...p, [heroPhoto]: true }))}
            />
          </div>
        ) : null}

        {/* Thumbnail strip */}
        {merchantPhotos.length > 1 && (
          <div style={{ display: "flex", gap: 6, padding: "8px 10px", overflowX: "auto" }}>
            {merchantPhotos.slice(0, 6).map((src, i) => {
              const broken = !!photoBroken[src];
              const active = i === activePhotoIdx;
              return (
                <button
                  key={src}
                  onClick={() => setActivePhotoIdx(i)}
                  style={{
                    border: active ? "2px solid #F4B400" : "1px solid #e5e7eb",
                    borderRadius: 8, padding: 0, overflow: "hidden",
                    width: 60, height: 44, cursor: "pointer", background: "#fff", flexShrink: 0,
                  }}
                >
                  {broken ? (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, opacity: 0.5 }}>blocked</div>
                  ) : (
                    <img src={src} alt={`thumb-${i}`} style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={() => setPhotoBroken((p) => ({ ...p, [src]: true }))} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Info section */}
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 950, lineHeight: 1.2 }}>{selectedMerchant.name}</div>

          {/* Category + City pills */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {category && (
              <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.12)", background: "#f9fafb", fontWeight: 800, fontSize: 12 }}>
                {titleCase(category)}
              </span>
            )}
            {city && (
              <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.12)", background: "#f9fafb", fontWeight: 800, fontSize: 12 }}>
                {titleCase(city)}
              </span>
            )}
          </div>

          {/* About */}
          {aboutText ? (
            <div style={{ fontSize: 14, lineHeight: 1.5, fontWeight: 600, color: "#374151" }}>
              {aboutText}
            </div>
          ) : null}

          {/* Website + Phone clickable links */}
          {(website || phone) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
              {website && (
                <a
                  href={normalizeUrl(website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#111",
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "#f9fafb",
                  }}
                >
                  🌐 {website.replace(/^https?:\/\//, "")}
                </a>
              )}
              {phone && (
                <a
                  href={`tel:${phone.replace(/\D/g, "")}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#111",
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "#f9fafb",
                  }}
                >
                  📞 {phone}
                </a>
              )}
            </div>
          )}

          {/* Mobile merchant "Available Now" badge */}
          {(selectedMerchant as any)?.isMobile && (selectedMerchant as any)?.mobileActiveUntil?.toDate && (selectedMerchant as any).mobileActiveUntil.toDate() > new Date() && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #fef3c7, #fde68a)",
              border: "1px solid #f59e0b",
              marginTop: 4,
            }}>
              <span style={{ fontSize: 20 }}>🚚</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14, color: "#92400e" }}>Available Now</div>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#b45309" }}>
                  {(() => {
                    const ms = (selectedMerchant as any).mobileActiveUntil.toDate().getTime() - Date.now();
                    const totalSec = Math.floor(ms / 1000);
                    const h = Math.floor(totalSec / 3600);
                    const m = Math.floor((totalSec % 3600) / 60);
                    const s = totalSec % 60;
                    if (h > 0) return `${h}h ${m}m remaining`;
                    if (m > 0) return `${m}m ${s}s remaining`;
                    return `${s}s remaining`;
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Business Hours */}
          {(() => {
            const bh = (selectedMerchant as any)?.businessHours;
            if (!bh || typeof bh !== "object") return null;
            const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const now = new Date();
            const todayIdx = now.getDay();
            return (
              <div style={{ marginTop: 4, padding: "10px 14px", borderRadius: 12, background: "#f9fafb", border: "1px solid #e5e7eb" }}>
                <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 6, color: "#111" }}>🕒 Business Hours</div>
                <div style={{ display: "grid", gap: 3 }}>
                  {dayNames.map((day, i) => {
                    const dh = bh[day];
                    const isToday = i === todayIdx;
                    if (!dh) return null;
                    const fmtTime = (t: string) => {
                      const [h, mi] = t.split(":").map(Number);
                      const ampm = h >= 12 ? "PM" : "AM";
                      const h12 = h % 12 || 12;
                      return `${h12}:${String(mi).padStart(2, "0")} ${ampm}`;
                    };
                    return (
                      <div key={day} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: isToday ? 900 : 600, color: isToday ? "#111" : "#6b7280" }}>
                        <span>{day.slice(0, 3)}{isToday ? " (Today)" : ""}</span>
                        <span style={{ color: dh.closed ? "#dc2626" : undefined }}>
                          {dh.closed ? "Closed" : `${fmtTime(dh.open)} – ${fmtTime(dh.close)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Directions + distance */}
          {(() => {
            const m = selectedMerchant as any;
            const isActiveMobile = m?.isMobile && m?.mobileActiveUntil?.toDate && m.mobileActiveUntil.toDate() > new Date();
            const dirLat = isActiveMobile && typeof m.mobileLat === 'number' ? m.mobileLat : m?.lat;
            const dirLng = isActiveMobile && typeof m.mobileLng === 'number' ? m.mobileLng : m?.lng;
            if (dirLat == null || dirLng == null) return null;

            let distLabel = "";
            if (distanceToMerchantMeters != null && !isActiveMobile) {
              distLabel = distanceToMerchantMeters < 1000
                ? `${Math.round(distanceToMerchantMeters)} m away`
                : `${(distanceToMerchantMeters / 1609.34).toFixed(1)} mi away`;
            } else if (isActiveMobile && userPos && typeof m.mobileLat === 'number' && typeof m.mobileLng === 'number') {
              const d = haversineMeters(userPos.lat, userPos.lng, m.mobileLat, m.mobileLng);
              distLabel = d < 1000
                ? `${Math.round(d)} m away`
                : `${(d / 1609.34).toFixed(1)} mi away`;
            }

            return (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${dirLat},${dirLng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#111",
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#f9fafb",
                  marginTop: 2,
                }}
              >
                📍 Get Directions
                {distLabel && (
                  <span style={{ fontWeight: 700, fontSize: 12, opacity: 0.7, marginLeft: 4 }}>
                    {distLabel}
                  </span>
                )}
              </a>
            );
          })()}
        </div>
      </div>

      {/* Unlock limit note */}
      <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, textAlign: "center" }}>
        Limit: <b>8 unlocks/day</b> per merchant
      </div>

      {/* Wheel selector tabs (only shown when merchant has multiple wheels) */}
      {merchantWheels.length > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {merchantWheels.map((wc, idx) => {
            const label = wc.spinPriceCents === 135 ? "$1.35"
              : wc.spinPriceCents === 200 ? "$2.00"
              : wc.spinPriceCents === 300 ? "$3.00"
              : wc.spinPriceCents === 500 ? "$5.00"
              : `$${(wc.spinPriceCents / 100).toFixed(2)}`;
            const active = idx === selectedWheelIdx;
            // If payment has been verified, only the paid tier is selectable
            const isLocked = paidTierCents !== null && wc.spinPriceCents !== paidTierCents;
            return (
              <button
                key={idx}
                onClick={() => {
                  if (isLocked) return; // can't switch tiers after paying
                  setSelectedWheelIdx(idx);
                }}
                disabled={isLocked}
                style={{
                  padding: "10px 18px",
                  borderRadius: 12,
                  border: active ? "2px solid #F4B400" : "1px solid #e5e7eb",
                  fontWeight: 900,
                  fontSize: 14,
                  cursor: isLocked ? "not-allowed" : "pointer",
                  background: isLocked
                    ? "linear-gradient(180deg, #f3f4f6, #e5e7eb)"
                    : active
                    ? "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))"
                    : "linear-gradient(180deg, #f9fafb, #fff)",
                  boxShadow: active ? "0 4px 12px rgba(244,180,0,0.25)" : "none",
                  color: isLocked ? "#9ca3af" : "#111",
                  opacity: isLocked ? 0.5 : 1,
                }}
              >
                🔒 {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Free deal proximity gate banner */}
      {isFreeSpinWheel && (
        <div style={{
          background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
          border: "2px solid #f97316",
          borderRadius: 14,
          padding: "14px 16px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#c2410c" }}>
            🔥 Free Deal Available!
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#7c2d12" }}>
            {(selectedMerchant as any)?.boostFreeSpinsRemaining ?? 0} free deals remaining
          </div>
          {!userPos && (
            <>
              <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                You must be within 200m of the store to claim your free deal.
              </div>
              <button
                onClick={requestLocationForFreeSpin}
                disabled={geoChecking}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "none",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: geoChecking ? "not-allowed" : "pointer",
                  background: "linear-gradient(180deg, #f97316, #ea580c)",
                  color: "#fff",
                  alignSelf: "center",
                }}
              >
                {geoChecking ? "Checking location…" : "Check my location"}
              </button>
              {geoError && (
                <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 700 }}>{geoError}</div>
              )}
            </>
          )}
          {userPos && !isWithin200m && (
            <>
              <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 700 }}>
                You are {distanceToMerchantMeters != null ? `${Math.round(distanceToMerchantMeters)}m` : "too far"} away. Drive to {selectedMerchant.name} to unlock your free deal!
              </div>
              {(selectedMerchant as any)?.lat != null && (selectedMerchant as any)?.lng != null && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${(selectedMerchant as any).lat},${(selectedMerchant as any).lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    padding: "10px 20px",
                    borderRadius: 10,
                    background: "linear-gradient(180deg, #1d4ed8, #1e40af)",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 13,
                    textDecoration: "none",
                    alignSelf: "center",
                  }}
                >
                  📍 Get Directions
                </a>
              )}
              <button
                onClick={requestLocationForFreeSpin}
                disabled={geoChecking}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: "1px solid #f97316",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: geoChecking ? "not-allowed" : "pointer",
                  background: "transparent",
                  color: "#c2410c",
                  alignSelf: "center",
                }}
              >
                {geoChecking ? "Checking…" : "Re-check location"}
              </button>
            </>
          )}
          {userPos && isWithin200m && (
            <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 800 }}>
              ✅ You&apos;re here! Unlock the wheel below for your free deal!
            </div>
          )}
        </div>
      )}

      {/* Wheel — hidden behind geo gate if free deal and not within 200m */}
      <div ref={wheelContainerRef} style={{ display: "flex", justifyContent: "center", position: "relative", width: "100%", overflow: "visible" }}>
        {isFreeSpinWheel && userPos && !isWithin200m && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.75)",
            backdropFilter: "blur(4px)",
            borderRadius: 16,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 900,
            color: "#c2410c",
          }}>
            🔒 Drive to the store to unlock
          </div>
        )}
        <Wheel
          items={wheelItems}
          merchantId={selectedMerchant.id}
          merchantName={(selectedMerchant as any)?.name ?? undefined}
          uid={uid ?? undefined}
          spinPriceCents={isFreeSpinWheel && isWithin200m ? 0 : (activeWheel?.spinPriceCents ?? 135)}
          isFreeSpinBoost={isFreeSpinWheel && isWithin200m}
          onPaymentVerified={(priceCents) => {
            // Lock the tier tabs to the tier that was actually paid
            setPaidTierCents(priceCents);
            // Also auto-select the correct wheel tab for this tier
            const idx = merchantWheels.findIndex((w) => w.spinPriceCents === priceCents);
            if (idx >= 0) setSelectedWheelIdx(idx);
          }}
          onResult={(label, extra) => {
            setSpinError(null);
            setEmailInput("");
            setEmailStatus(null);
            if (!extra?.code) {
              setSpinError("Unlock completed but no code returned.");
              return;
            }
            // Calculate the winning slice's weight percentage
            const totalWeight = wheelItems.reduce((s, it) => s + (Number(it.weight) || 0), 0);
            const winningItem = wheelItems.find((it) => it.label === label);
            const weightPct = totalWeight > 0 && winningItem
              ? (Number(winningItem.weight) / totalWeight) * 100
              : 50;
            // Store result for after celebration
            pendingResultRef.current = { label, code: extra.code };
            setCelebrationLabel(label);
            setCelebrationWeightPct(weightPct);
            setCelebrationVisible(true);
          }}
        />
      </div>

      {/* Results / code box */}
      {spinError && (
        <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", fontWeight: 900, textAlign: "center", fontSize: 14 }}>
          {spinError}
        </div>
      )}

      {issuedCode && (
        <div style={{ padding: 14, border: "2px solid #C8960C", borderRadius: 14, background: "white", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 4px 24px rgba(200,150,12,0.18), 0 2px 8px rgba(0,0,0,0.06)", width: "100%", boxSizing: "border-box" }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>Redeem Code</div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Deal: <b>{lastPrize ?? "—"}</b> · Merchant: <b>{selectedMerchant.name}</b>
          </div>
          <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: 1 }}>{issuedCode}</div>
          <div style={{ opacity: 0.7, fontSize: 13 }}>Show this code (or QR) to the merchant to redeem (one-time use).</div>

          <div style={{ display: "flex", justifyContent: "center", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <QRCodeCanvas value={issuedCode} size={180} />
            <div style={{ fontSize: 11, opacity: 0.65, textAlign: "center" }}>Merchant can scan this QR or type the code.</div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => navigator.clipboard.writeText(issuedCode)} style={{
              padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900, cursor: "pointer", background: "linear-gradient(180deg, #f3f4f6, #fff)", fontSize: 13,
            }}>
              Copy code
            </button>
          </div>

          {/* Email code */}
          <div style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.10)", background: "rgba(246,196,83,0.08)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 950, fontSize: 14 }}>Email this code to yourself</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="your@email.com"
                style={{ flex: 1, minWidth: 160, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, fontWeight: 700 }}
              />
              <button
                onClick={sendCodeByEmail}
                disabled={emailSending || !emailInput.trim()}
                style={{
                  padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 950, cursor: emailSending || !emailInput.trim() ? "not-allowed" : "pointer", fontSize: 13,
                  background: emailSending || !emailInput.trim()
                    ? "linear-gradient(180deg, #f3f4f6, #fff)"
                    : "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                  opacity: emailSending || !emailInput.trim() ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {emailSending ? "Sending…" : "✉️ Send"}
              </button>
            </div>
            {emailStatus && <div style={{ fontWeight: 800, fontSize: 13, opacity: 0.85 }}>{emailStatus}</div>}
          </div>
        </div>
      )}

      {/* Animal celebration overlay — shown immediately after unlock, dismissed after ~2.8s or tap */}
      {celebrationVisible && (
        <SpinCelebration
          sliceWeightPct={celebrationWeightPct}
          dealLabel={celebrationLabel}
          onDone={() => {
            setCelebrationVisible(false);
            // Now reveal the code card
            const pending = pendingResultRef.current;
            if (pending) {
              setLastPrize(pending.label);
              setIssuedCode(pending.code);
              pendingResultRef.current = null;
            }
          }}
        />
      )}
    </div>
  );
}
