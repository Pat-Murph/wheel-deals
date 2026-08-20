"use client";
import { useEffect, useState } from "react";

// Stripe success_url lands here.
// We verify the payment then redirect straight back to the wheel page
// with session_id in the URL so the wheel can grant the unlock.
export default function PayReturnPage() {
  const [status, setStatus] = useState("Verifying payment…");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get("session_id");
    const merchantId = sp.get("merchantId");

    if (!sessionId || !merchantId) {
      setStatus("Missing payment info — redirecting…");
      setTimeout(() => {
        window.location.href = "/discover";
      }, 1500);
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

        // Write to localStorage as a backup signal for any open wheel tabs
        try {
          localStorage.setItem("wd_paid_session", JSON.stringify({
            sessionId,
            merchantId,
            uid: data.uid ?? null,
            ts: Date.now(),
          }));
        } catch { /* ignore if localStorage unavailable */ }

        setStatus("✅ Payment verified! Returning to wheel…");

        // Redirect back to the wheel page with session_id so it can unlock
        window.location.href = `/wheel?merchantId=${encodeURIComponent(merchantId)}&session_id=${encodeURIComponent(sessionId)}`;
      } catch (e: any) {
        // Keep the session ID on the wheel URL. The wheel has a retrying verifier,
        // so a brief Stripe/app handoff delay cannot strand a completed payment.
        setStatus("Confirming your payment — returning to the wheel…");
        setTimeout(() => {
          window.location.href = `/wheel?merchantId=${encodeURIComponent(merchantId)}&session_id=${encodeURIComponent(sessionId)}`;
        }, 900);
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
      <div style={{ fontSize: 20, fontWeight: 800, color: "#111" }}>{status}</div>
    </div>
  );
}
