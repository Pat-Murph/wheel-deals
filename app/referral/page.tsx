"use client";

import { useRef } from "react";

export default function ReferralPage() {
  const flyerRef = useRef<HTMLDivElement>(null);

  function printFlyer() {
    if (!flyerRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Wheel Deals Referral Flyer</title>
      <style>
        body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        @media print { body { padding: 0; } }
      </style>
      </head><body>${flyerRef.current.innerHTML}</body></html>
    `);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 400);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", padding: "0 0 60px" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1e3a5f, #0f172a)",
        padding: "40px 20px 30px",
        textAlign: "center",
        color: "#fff",
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>
          💰 Wheel Deals Referral Program
        </h1>
        <p style={{ fontSize: 15, opacity: 0.9, marginTop: 8, fontWeight: 600 }}>
          Earn cash for every business you refer!
        </p>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>

        {/* Payout cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 28 }}>
          <div style={{
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            border: "2px solid #f59e0b",
            borderRadius: 16,
            padding: "20px 16px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#92400e" }}>$100</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#78350f", marginTop: 4 }}>Las Vegas Area</div>
            <div style={{ fontSize: 11, color: "#92400e", marginTop: 4 }}>Per qualified referral</div>
          </div>
          <div style={{
            background: "linear-gradient(135deg, #e0f2fe, #bae6fd)",
            border: "2px solid #0ea5e9",
            borderRadius: 16,
            padding: "20px 16px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#0c4a6e" }}>$50</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#075985", marginTop: 4 }}>Anywhere Else</div>
            <div style={{ fontSize: 11, color: "#0c4a6e", marginTop: 4 }}>Per qualified referral</div>
          </div>
        </div>

        {/* How it works */}
        <div style={{
          background: "#fff",
          borderRadius: 16,
          padding: "24px 20px",
          border: "1px solid #e5e7eb",
          marginBottom: 20,
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: "#111827", margin: "0 0 16px" }}>
            How It Works
          </h2>
          <div style={{ display: "grid", gap: 14 }}>
            {[
              { step: "1", text: "Share Wheel Deals with a local business owner — use the flyer below or just tell them about us" },
              { step: "2", text: "The business signs up at wheeldealsapp.com and enters YOUR email as the referrer during onboarding" },
              { step: "3", text: "Once the business connects their Stripe account (goes live), your referral is qualified" },
              { step: "4", text: "We'll email you with payment details — you get paid!" },
            ].map((item) => (
              <div key={item.step} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  minWidth: 32, height: 32, borderRadius: "50%",
                  background: "#f59e0b", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 900, fontSize: 15,
                }}>
                  {item.step}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", lineHeight: 1.5, paddingTop: 4 }}>
                  {item.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rules */}
        <div style={{
          background: "#fff",
          borderRadius: 16,
          padding: "24px 20px",
          border: "1px solid #e5e7eb",
          marginBottom: 20,
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: "#111827", margin: "0 0 16px" }}>
            Program Rules
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "#374151", lineHeight: 2 }}>
            <li><b>Limited time offer</b> — This referral program may end at any time</li>
            <li>A referral only qualifies when the business <b>connects their Stripe account</b> (goes live on the platform)</li>
            <li>The business must enter your email as the referrer <b>during their sign-up process</b></li>
            <li><b>$100 payout</b> for businesses in the Las Vegas metro area (Las Vegas, Henderson, North Las Vegas, Summerlin, Boulder City)</li>
            <li><b>$50 payout</b> for businesses located anywhere else</li>
            <li>One payout per unique business referred — duplicate or fraudulent sign-ups do not count</li>
            <li>The referred business must be a <b>legitimate, operating business</b></li>
            <li>Self-referrals (referring your own business) do not qualify</li>
            <li>Payouts are processed within 14 business days of qualification</li>
            <li>We will contact you via the referrer email on file to arrange payment</li>
            <li>Wheel Deals reserves the right to modify or end this program at any time</li>
          </ul>
        </div>

        {/* Print flyer button */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <button
            onClick={printFlyer}
            style={{
              padding: "14px 32px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(180deg, #f59e0b, #d97706)",
              color: "#fff",
              fontWeight: 900,
              fontSize: 16,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(245,158,11,0.3)",
            }}
          >
            🖨️ Print Referral Flyer
          </button>
        </div>

        {/* Flyer preview */}
        <div ref={flyerRef}>
          <div style={{
            background: "#fff",
            borderRadius: 16,
            border: "2px solid #e5e7eb",
            padding: "32px 24px",
            textAlign: "center",
          }}>
            {/* Flyer header */}
            <div style={{ fontSize: 26, fontWeight: 900, color: "#1e3a5f", marginBottom: 4 }}>
              Wheel Deals
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b", marginBottom: 20 }}>
              The Smartest Way to Promote Your Business
            </div>

            {/* Value props */}
            <div style={{
              background: "#f8fafc",
              borderRadius: 12,
              padding: "20px 16px",
              marginBottom: 20,
              textAlign: "left",
            }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#111827", marginBottom: 12 }}>
                Why Business Owners Love Wheel Deals:
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  "✅ 100% FREE to sign up — no monthly fees, no contracts",
                  "✅ Only pay when customers actually engage with your deals",
                  "✅ Drive real foot traffic to your location",
                  "✅ Customers unlock deals on a fun, interactive wheel",
                  "✅ Built-in scarcity creates urgency — customers come NOW",
                  "✅ Track redemptions and see real ROI on every promotion",
                  "✅ Perfect for restaurants, shops, services, food trucks & more",
                ].map((item, i) => (
                  <div key={i} style={{ fontSize: 13, fontWeight: 600, color: "#374151", lineHeight: 1.5 }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* How it works for the business */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginBottom: 20,
            }}>
              {[
                { num: "1", text: "Sign up free at wheeldealsapp.com" },
                { num: "2", text: "Set up your deal wheel with your promotions" },
                { num: "3", text: "Customers discover you & unlock deals" },
              ].map((s) => (
                <div key={s.num} style={{
                  border: "2px solid #f59e0b",
                  borderRadius: 12,
                  padding: "14px 10px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "#f59e0b" }}>{s.num}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginTop: 4 }}>{s.text}</div>
                </div>
              ))}
            </div>

            {/* QR Code */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#111827", marginBottom: 8 }}>
                Scan to Sign Up — It&apos;s Free!
              </div>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent("https://wheel-deals-nine.vercel.app/merchant/onboard")}`}
                alt="Sign up QR code"
                style={{ width: 150, height: 150 }}
              />
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginTop: 6 }}>
                wheel-deals-nine.vercel.app/merchant/onboard
              </div>
            </div>

            {/* Bottom CTA */}
            <div style={{
              background: "linear-gradient(135deg, #1e3a5f, #0f172a)",
              borderRadius: 12,
              padding: "16px 20px",
              color: "#fff",
            }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>
                Your next promotion starts here.
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9, marginTop: 4 }}>
                Join hundreds of local businesses already growing with Wheel Deals.
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8, color: "#fbbf24" }}>
                No fees to join · No contracts · Cancel anytime
              </div>
            </div>
          </div>
        </div>

        {/* Back link */}
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a href="/discover" style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f", textDecoration: "none" }}>
            ← Back to Discover
          </a>
        </div>
      </div>
    </div>
  );
}
