// components/WheelDealsClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Wheel, { WheelItem } from "./Wheel";
import { createSpin } from "../lib/spins";
import { QRCodeCanvas } from "qrcode.react";
import { getActiveMerchants, type Merchant } from "../lib/merchants";

type Props = {
  initialMerchantId?: string;
};

export default function WheelDealsClient({ initialMerchantId }: Props) {
  // merchants (from Firestore)
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [merchantLoadError, setMerchantLoadError] = useState<string | null>(null);

  // selection
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>("");

  // spin result UI
  const [savingSpin, setSavingSpin] = useState(false);
  const [issuedCode, setIssuedCode] = useState("");
  const [lastPrize, setLastPrize] = useState<string | null>(null);
  const [spinsLeft, setSpinsLeft] = useState<number | null>(null);

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

  // Default selection + URL merchantId selection
  useEffect(() => {
    if (!merchants.length) return;

    // if URL has merchantId and it exists, select it
    if (initialMerchantId) {
      const found = merchants.find((m) => m.id === initialMerchantId);
      if (found) {
        setSelectedMerchantId(found.id);
        // reset UI on merchant change via URL
        setIssuedCode("");
        setSpinsLeft(null);
        setLastPrize(null);
        return;
      }
    }

    // otherwise select first merchant if none selected yet or selected is invalid
    if (!selectedMerchantId || !merchants.some((m) => m.id === selectedMerchantId)) {
      setSelectedMerchantId(merchants[0].id);
      setIssuedCode("");
      setSpinsLeft(null);
      setLastPrize(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchants, initialMerchantId]);

  const selectedMerchant = useMemo(() => {
    if (!merchants.length) return null;
    return merchants.find((m) => m.id === selectedMerchantId) ?? merchants[0];
  }, [merchants, selectedMerchantId]);

  // Wheel items (still hardcoded for now; later you can read from merchant.wheel)
  const wheelItems: WheelItem[] = useMemo(
    () => [
      { label: "10% OFF", weight: 40 },
      { label: "15% OFF", weight: 25 },
      { label: "20% OFF", weight: 20 },
      { label: "BOGO", weight: 10 },
      { label: "FREE UPGRADE", weight: 5 },
    ],
    []
  );

  // Loading / empty states
  if (loadingMerchants) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 900 }}>Wheel Deals</div>
        <div style={{ fontWeight: 800, opacity: 0.8 }}>Loading merchants…</div>
      </div>
    );
  }

  if (merchantLoadError) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 900 }}>Wheel Deals</div>
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
          If this says “Missing or insufficient permissions”, we’ll adjust Firestore rules for merchants read.
        </div>
      </div>
    );
  }

  if (!merchants.length || !selectedMerchant) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 900 }}>Wheel Deals</div>
        <div style={{ fontWeight: 900 }}>No active merchants found.</div>
        <div style={{ opacity: 0.75, fontWeight: 700 }}>
          Add a merchant doc in Firestore: merchants/{`{id}`} with <b>active: true</b>.
        </div>
        <a
          href="/discover"
          style={{
            marginTop: 8,
            fontWeight: 900,
            textDecoration: "none",
            color: "#111",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(180deg, #f3f4f6, #fff)",
          }}
        >
          Go to discovery →
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, justifyItems: "center", width: "100%" }}>
      {/* Header */}
      <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
        <div style={{ fontSize: 28, fontWeight: 900 }}>Wheel Deals</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontWeight: 800, opacity: 0.8 }}>Merchant:</span>
          <select
            value={selectedMerchantId}
            onChange={(e) => {
              setSelectedMerchantId(e.target.value);
              setIssuedCode("");
              setSpinsLeft(null);
              setLastPrize(null);
            }}
            style={{ padding: 8, borderRadius: 10 }}
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <a
            href="/discover"
            style={{
              fontWeight: 900,
              textDecoration: "none",
              color: "#111",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "linear-gradient(180deg, #f3f4f6, #fff)",
            }}
          >
            Discover →
          </a>
        </div>

        <div style={{ fontSize: 13, opacity: 0.7, textAlign: "center" }}>
          Limit: <b>3 spins/day</b> per merchant
        </div>
      </div>

      {/* Wheel */}
      <Wheel
        items={wheelItems}
        size={460}
        onResult={async (label) => {
          setLastPrize(label);
          setSavingSpin(true);
          setIssuedCode("");
          setSpinsLeft(null);

          try {
            const { code, remainingAfter } = await createSpin({
              merchantId: selectedMerchant.id,
              prizeLabel: label,
              dailyLimit: 3,
            });

            setIssuedCode(code);
            setSpinsLeft(remainingAfter);
          } catch (e: any) {
            const msg = e?.message ?? "Could not save spin. Check console for details.";
            alert(msg);
          } finally {
            setSavingSpin(false);
          }
        }}
      />

      {/* Results / code box */}
      <div style={{ width: "min(560px, 100%)", display: "grid", gap: 10 }}>
        {savingSpin && (
          <div style={{ fontWeight: 800, opacity: 0.8, textAlign: "center" }}>
            Saving spin…
          </div>
        )}

        {issuedCode && (
          <div
            style={{
              marginTop: 4,
              padding: 14,
              border: "1px solid #ddd",
              borderRadius: 14,
              background: "white",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 18 }}>Redeem Code</div>

            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
              Prize: <b>{lastPrize ?? "—"}</b> • Merchant: <b>{selectedMerchant.name}</b>
            </div>

            <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, letterSpacing: 1 }}>
              {issuedCode}
            </div>

            <div style={{ opacity: 0.75, marginTop: 6 }}>
              Show this code (or QR) to the merchant to redeem (one-time).
            </div>

            {spinsLeft !== null && (
              <div style={{ marginTop: 8, fontWeight: 800, opacity: 0.8 }}>
                Spins left today for {selectedMerchant.name}: {spinsLeft}
              </div>
            )}

            {/* QR */}
            <div style={{ marginTop: 14, display: "grid", gap: 10, justifyItems: "center" }}>
              <QRCodeCanvas value={issuedCode} size={200} />
              <div style={{ fontSize: 12, opacity: 0.75, textAlign: "center" }}>
                Merchant can scan this QR or type the code.
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => navigator.clipboard.writeText(issuedCode)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 900,
                  cursor: "pointer",
                  background: "linear-gradient(180deg, #f3f4f6, #fff)",
                }}
              >
                Copy code
              </button>

              <a
                href="/redeem"
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 900,
                  textDecoration: "none",
                  color: "#111",
                  background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                }}
              >
                Go to merchant redeem page →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
