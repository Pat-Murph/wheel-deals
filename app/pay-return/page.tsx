"use client";
import { useEffect, useState } from "react";

// This page is the Stripe success_url target.
// It verifies the payment, writes the result to localStorage so the
// original wheel tab can pick it up, then closes itself.
export default function PayReturnPage() {
  const [status, setStatus] = useState("Verifying payment…");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get("session_id");
    const merchantId = sp.get("merchantId");

    if (!sessionId || !merchantId) {
      setStatus("Missing payment info. You can close this tab.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/stripe/spin/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok) {
          throw new Error(data?.error ?? "Payment not verified");
        }

        // ✅ Write verified session to localStorage so the wheel tab picks it up
        const payload = JSON.stringify({
          sessionId,
          merchantId,
          uid: data.uid ?? null,
          ts: Date.now(),
        });
        localStorage.setItem("wd_paid_session", payload);
        setStatus("✅ Payment verified! Returning to wheel…");

        // Give localStorage a moment to flush, then close this tab
        setTimeout(() => {
          window.close();
          // Fallback: if window.close() is blocked (e.g. not opened by script),
          // redirect back to the wheel page instead
          window.location.href = `/wheel?merchantId=${encodeURIComponent(merchantId)}`;
        }, 800);
      } catch (e: any) {
        setStatus("Payment verify failed: " + (e?.message ?? "Unknown error"));
        // Still try to redirect back on error
        setTimeout(() => {
          window.location.href = `/wheel?merchantId=${encodeURIComponent(merchantId)}&pay_error=1`;
        }, 2000);
      }
    })();
  }, []);

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
      background: "#fff",
      padding: 24,
      textAlign: "center",
      gap: 16,
    }}>
      <div style={{ fontSize: 48 }}>🎡</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#111" }}>{status}</div>
      <div style={{ fontSize: 14, color: "#666" }}>This tab will close automatically.</div>
    </div>
  );
}
