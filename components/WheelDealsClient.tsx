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

function Pill(props: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "linear-gradient(180deg, #fff, #f9fafb)",
        fontWeight: 900,
        fontSize: 12,
        opacity: 0.9,
      }}
    >
      {props.children}
    </span>
  );
}

function card(): React.CSSProperties {
  return {
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    background: "white",
    overflow: "hidden",
    boxShadow: "0 18px 60px rgba(0,0,0,0.06)",
  };
}

function btnLinkGray(): React.CSSProperties {
  return {
    fontWeight: 900,
    textDecoration: "none",
    color: "#111",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "linear-gradient(180deg, #f3f4f6, #fff)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function btnGray(disabled?: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    background: "linear-gradient(180deg, #f3f4f6, #fff)",
    opacity: disabled ? 0.7 : 1,
  };
}

function btnGoldLink(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    textDecoration: "none",
    color: "#111",
    background:
      "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
    display: "inline-flex",
    alignItems: "center",
  };
}

export default function WheelDealsClient({ initialMerchantId }: Props) {
  // ✅ store uid for Stripe + spin attribution
  const [uid, setUid] = useState<string | null>(null);

  // ✅ Customer-only anon auth
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

  // ✅ ONE redeem code now (comes from /api/spins/consume via Wheel.tsx)
  const [issuedCode, setIssuedCode] = useState("");
  const [lastPrize, setLastPrize] = useState<string | null>(null);
  const [spinError, setSpinError] = useState<string | null>(null);

  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [photoBroken, setPhotoBroken] = useState<Record<string, boolean>>({});

  // Load merchants
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

    return () => {
      mounted = false;
    };
  }, []);

  // ✅ Choose merchant by URL param if present (NO dropdown)
  useEffect(() => {
    if (!merchants.length) return;

    const found =
      (initialMerchantId && merchants.find((m) => m.id === initialMerchantId)) ||
      null;

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

  // If URL param changes while staying on page, update selection safely
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

  // ✅ Report button mailto (change address later)
  const reportHref = useMemo(() => {
    const mid = selectedMerchant?.id ?? "";
    const name = selectedMerchant?.name ?? "";
    const subject = encodeURIComponent("Wheel Deals — Report a merchant");
    const body = encodeURIComponent(
      `Please describe the issue.\n\nMerchant Name: ${name}\nMerchant ID: ${mid}\n\nWhat happened:\n`
    );

    // TODO: swap to your real support email when ready
    return `mailto:support@wheeldeals.app?subject=${subject}&body=${body}`;
  }, [selectedMerchant?.id, selectedMerchant?.name]);

  if (loadingMerchants) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 34, fontWeight: 950, letterSpacing: 0.2 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ fontWeight: 800, opacity: 0.8 }}>Loading merchants…</div>
      </div>
    );
  }

  if (merchantLoadError) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 34, fontWeight: 950, letterSpacing: 0.2 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div
          style={{
            maxWidth: 640,
            border: "1px solid rgba(239,68,68,0.30)",
            background: "rgba(239,68,68,0.08)",
            borderRadius: 14,
            padding: 14,
            fontWeight: 900,
          }}
        >
          ❌ {merchantLoadError}
        </div>
        <div style={{ opacity: 0.75, fontWeight: 700 }}>
          If this says “Missing or insufficient permissions”, it’s Firestore rules blocking reads.
        </div>
        <a href="/discover" style={btnLinkGray()}>
          Go to discovery →
        </a>
      </div>
    );
  }

  if (!merchants.length || !selectedMerchant) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 34, fontWeight: 950, letterSpacing: 0.2 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ fontWeight: 900 }}>No active merchants found.</div>
        <div style={{ opacity: 0.75, fontWeight: 700 }}>
          Add a merchant doc in Firestore: merchants/{`{id}`} with <b>active: true</b>.
        </div>
        <a href="/discover" style={btnLinkGray()}>
          Go to discovery →
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, justifyItems: "center", width: "100%", padding: "18px 12px" }}>
      {/* Header */}
      <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
        <div style={{ fontSize: 34, fontWeight: 950, letterSpacing: 0.2 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>

        {/* ✅ No dropdown now */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontWeight: 800, opacity: 0.8 }}>Merchant:</span>
          <span style={{ fontWeight: 950 }}>{selectedMerchant.name}</span>

          <a
            href="/discover"
            style={{
              ...btnLinkGray(),
              color: "#DC2626", // ✅ Discover in red
              fontWeight: 950,
            }}
          >
            Discover →
          </a>

          <a href={reportHref} style={btnLinkGray()} title="Report this merchant">
            Report
          </a>
        </div>

        <div style={{ fontSize: 13, opacity: 0.7, textAlign: "center", fontWeight: 700 }}>
          Limit: <b>3 spins/day</b> per merchant
        </div>

        <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 800 }}>
          uid: {uid ?? "(loading...)"} • selectedMerchantId: {selectedMerchant.id}
        </div>
      </div>

      {/* Merchant card */}
      <div style={{ width: "min(980px, 100%)" }}>
        <div
          style={{
            ...card(),
            display: "grid",
            gridTemplateColumns: "minmax(280px, 420px) 1fr",
          }}
        >
          {/* Photos */}
          <div style={{ borderRight: "1px solid #e5e7eb", background: "#fafafa" }}>
            <div style={{ position: "relative", width: "100%", height: 260, background: "#f3f4f6" }}>
              {!heroPhoto || heroBroken ? (
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    padding: 14,
                    textAlign: "center",
                    fontWeight: 900,
                    color: "#111",
                  }}
                >
                  {heroPhoto && heroBroken
                    ? "Photo blocked (Storage rules or URL issue)."
                    : "No photos yet. Add some on Merchant Onboarding."}
                </div>
              ) : (
                <img
                  src={heroPhoto}
                  alt={`${selectedMerchant.name} photo`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={() => setPhotoBroken((p) => ({ ...p, [heroPhoto]: true }))}
                />
              )}
            </div>

            {merchantPhotos.length > 1 && (
              <div style={{ display: "flex", gap: 8, padding: 10, overflowX: "auto" }}>
                {merchantPhotos.slice(0, 6).map((src, i) => {
                  const broken = !!photoBroken[src];
                  const active = i === activePhotoIdx;

                  return (
                    <button
                      key={src}
                      onClick={() => setActivePhotoIdx(i)}
                      style={{
                        border: active ? "2px solid rgba(255,155,61,0.95)" : "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 0,
                        overflow: "hidden",
                        width: 78,
                        height: 56,
                        cursor: "pointer",
                        background: "#fff",
                        flex: "0 0 auto",
                      }}
                      title={broken ? "This photo can't be read." : `Photo ${i + 1}`}
                    >
                      {broken ? (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 10,
                            fontWeight: 900,
                            opacity: 0.7,
                          }}
                        >
                          blocked
                        </div>
                      ) : (
                        <img
                          src={src}
                          alt={`thumb-${i}`}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={() => setPhotoBroken((p) => ({ ...p, [src]: true }))}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ padding: 16, display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 26, fontWeight: 950 }}>{selectedMerchant.name}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {category && <Pill>{titleCase(category)}</Pill>}
                {city && <Pill>{titleCase(city)}</Pill>}
              </div>
            </div>

            <div style={{ fontWeight: 950, opacity: 0.75 }}>About</div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, fontWeight: 750, opacity: 0.95 }}>
              {aboutText ? aboutText : "No description yet. Merchants can add this on onboarding."}
            </div>

            <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 800 }}>Customers see photos + About here.</div>
          </div>
        </div>
      </div>

      {/* Wheel */}
      <Wheel
        items={wheelItems}
        size={460}
        merchantId={selectedMerchant.id}
        uid={uid ?? undefined}
        onResult={(label, extra) => {
          setLastPrize(label);
          setSpinError(null);

          // ✅ ONLY use code returned from consume()
          if (extra?.code) setIssuedCode(extra.code);
          else setSpinError("Spin completed but no code returned (check /api/spins/consume response).");
        }}
      />

      {/* Results / code box */}
      <div style={{ width: "min(560px, 100%)", display: "grid", gap: 10 }}>
        {spinError && (
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(239,68,68,0.25)",
              background: "rgba(239,68,68,0.08)",
              fontWeight: 900,
              textAlign: "center",
            }}
          >
            {spinError}
          </div>
        )}

        {issuedCode && (
          <div style={{ marginTop: 4, padding: 14, border: "1px solid #ddd", borderRadius: 14, background: "white" }}>
            <div style={{ fontWeight: 950, fontSize: 18 }}>Redeem Code</div>

            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
              Prize: <b>{lastPrize ?? "—"}</b> • Merchant: <b>{selectedMerchant.name}</b>
            </div>

            <div style={{ fontSize: 28, fontWeight: 950, marginTop: 10, letterSpacing: 1 }}>{issuedCode}</div>

            <div style={{ opacity: 0.75, marginTop: 6 }}>
              Show this code (or QR) to the merchant to redeem (one-time).
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10, justifyItems: "center" }}>
              <QRCodeCanvas value={issuedCode} size={200} />
              <div style={{ fontSize: 12, opacity: 0.75, textAlign: "center" }}>
                Merchant can scan this QR or type the code.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={() => navigator.clipboard.writeText(issuedCode)} style={btnGray()}>
                Copy code
              </button>

              <a href="/redeem" style={btnGoldLink()}>
                Go to merchant redeem page →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
