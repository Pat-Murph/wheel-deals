"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo } from "react";

type Props = {
  clientSecret: string;
  publishableKey: string;
  onComplete: () => void;
  onClose: () => void;
};

const stripePromises = new Map<string, ReturnType<typeof loadStripe>>();

function getStripe(publishableKey: string) {
  const existing = stripePromises.get(publishableKey);
  if (existing) return existing;
  const created = loadStripe(publishableKey);
  stripePromises.set(publishableKey, created);
  return created;
}

export default function EmbeddedCheckoutModal({ clientSecret, publishableKey, onComplete, onClose }: Props) {
  const stripe = useMemo(() => getStripe(publishableKey), [publishableKey]);
  const options = useMemo(() => ({ clientSecret, onComplete }), [clientSecret, onComplete]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Secure payment checkout"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        overflowY: "auto",
        background: "rgba(4, 12, 30, 0.92)",
        padding: "max(18px, env(safe-area-inset-top)) 14px max(18px, env(safe-area-inset-bottom))",
      }}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          minHeight: "100%",
          margin: "0 auto",
          borderRadius: 22,
          overflow: "hidden",
          background: "#ffffff",
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            background: "linear-gradient(135deg, #071a3a, #102a57)",
            color: "#ffffff",
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>Secure Checkout</div>
            <div style={{ marginTop: 2, fontSize: 12, opacity: 0.78 }}>Complete your unlock without leaving Wheel Deals</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            style={{
              minWidth: 38,
              minHeight: 38,
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 10,
              background: "rgba(255,255,255,0.12)",
              color: "#ffffff",
              fontSize: 24,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "12px 8px 22px" }}>
          <EmbeddedCheckoutProvider stripe={stripe} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}
