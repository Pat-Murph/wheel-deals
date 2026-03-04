"use client";

import { useEffect, useMemo, useState } from "react";
import Wheel, { WheelItem } from "./Wheel";
import { QRCodeCanvas } from "qrcode.react";
import { getActiveMerchants, type Merchant } from "../lib/merchants";

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
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [photoBroken, setPhotoBroken] = useState<Record<string, boolean>>({});

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

  const wheelItems: WheelItem[] = useMemo(() => {
    const fromDoc = selectedMerchant ? getMerchantWheel(selectedMerchant as any) : null;
    if (fromDoc) return fromDoc;
    return [
      { label: "10% OFF", weight: 40 },
      { label: "15% OFF", weight: 25 },
      { label: "20% OFF", weight: 20 },
      { label: "BOGO", weight: 10 },
      { label: "FREE UPGRADE", weight: 5 },
    ];
  }, [selectedMerchant]);

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
      padding: "12px 12px 32px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxSizing: "border-box",
    }}>

      {/* Top nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/discover" style={{
            fontWeight: 900, textDecoration: "none", color: "#DC2626",
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
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        background: "white",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
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
                    color: "#2563EB",
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(37,99,235,0.25)",
                    background: "rgba(37,99,235,0.06)",
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
                    color: "#16a34a",
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(22,163,74,0.25)",
                    background: "rgba(22,163,74,0.06)",
                  }}
                >
                  📞 {phone}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Spin limit note */}
      <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, textAlign: "center" }}>
        Limit: <b>8 spins/day</b> per merchant
      </div>

      {/* Wheel */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Wheel
          items={wheelItems}
          size={Math.min(320, typeof window !== "undefined" ? window.innerWidth - 40 : 320)}
          merchantId={selectedMerchant.id}
          uid={uid ?? undefined}
          onResult={(label, extra) => {
            setLastPrize(label);
            setSpinError(null);
            setEmailInput("");
            setEmailStatus(null);
            if (extra?.code) setIssuedCode(extra.code);
            else setSpinError("Spin completed but no code returned.");
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
        <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 14, background: "white", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>Redeem Code</div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Prize: <b>{lastPrize ?? "—"}</b> · Merchant: <b>{selectedMerchant.name}</b>
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
            <a href="/redeem" style={{
              padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900, textDecoration: "none", color: "#111", fontSize: 13,
              background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
              display: "inline-flex", alignItems: "center",
            }}>
              Go to merchant redeem →
            </a>
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
    </div>
  );
}
