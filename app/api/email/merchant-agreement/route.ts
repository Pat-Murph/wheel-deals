import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const WHEELDEALS_EMAIL = "pat@wheeldealsapp.com";
const FROM_EMAIL = "Wheel Deals <onboarding@wheeldealsapp.com>";

// Earnings table for email body
const EARNINGS_TABLE = `
<table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:12px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="border:1px solid #ddd;padding:8px;text-align:left;">Unlock Price</th>
      <th style="border:1px solid #ddd;padding:8px;text-align:left;">Merchant Earns (after Stripe fees)</th>
      <th style="border:1px solid #ddd;padding:8px;text-align:left;">Wheel Deals Platform</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border:1px solid #ddd;padding:8px;">$1.35</td>
      <td style="border:1px solid #ddd;padding:8px;">70%</td>
      <td style="border:1px solid #ddd;padding:8px;">30%</td>
    </tr>
    <tr style="background:#fafafa;">
      <td style="border:1px solid #ddd;padding:8px;">$2.00</td>
      <td style="border:1px solid #ddd;padding:8px;">70%</td>
      <td style="border:1px solid #ddd;padding:8px;">30%</td>
    </tr>
    <tr>
      <td style="border:1px solid #ddd;padding:8px;">$3.00</td>
      <td style="border:1px solid #ddd;padding:8px;">70%</td>
      <td style="border:1px solid #ddd;padding:8px;">30%</td>
    </tr>
    <tr style="background:#fafafa;">
      <td style="border:1px solid #ddd;padding:8px;">$5.00</td>
      <td style="border:1px solid #ddd;padding:8px;">75%</td>
      <td style="border:1px solid #ddd;padding:8px;">25%</td>
    </tr>
  </tbody>
</table>
`;

export async function POST(req: NextRequest) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { merchantName, merchantId, merchantEmail, foundingNumber, acceptedAt } = await req.json();

    if (!merchantName || !merchantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const acceptedDate = acceptedAt
      ? new Date(acceptedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      : new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });

    const foundingLine = foundingNumber
      ? `<p><strong>Founding Merchant #${foundingNumber}</strong></p>`
      : "";

    // ── 1. Agreement copy to Wheel Deals ──────────────────────────────────────
    await resend.emails.send({
      from: FROM_EMAIL,
      to: WHEELDEALS_EMAIL,
      subject: `[Agreement] Founding Merchant: ${merchantName} (ID: ${merchantId})`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#d97706;">Wheel Deals — Founding Merchant Agreement Record</h2>
          <p>A new merchant has accepted the Founding Merchant Terms &amp; Conditions.</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:8px;">
            <tr><td style="padding:6px 10px;font-weight:bold;background:#f9f9f9;border:1px solid #ddd;">Business Name</td><td style="padding:6px 10px;border:1px solid #ddd;">${merchantName}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;background:#f9f9f9;border:1px solid #ddd;">Merchant ID</td><td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${merchantId}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;background:#f9f9f9;border:1px solid #ddd;">Merchant Email</td><td style="padding:6px 10px;border:1px solid #ddd;">${merchantEmail || "Not provided"}</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;background:#f9f9f9;border:1px solid #ddd;">Accepted At</td><td style="padding:6px 10px;border:1px solid #ddd;">${acceptedDate} (PT)</td></tr>
            <tr><td style="padding:6px 10px;font-weight:bold;background:#f9f9f9;border:1px solid #ddd;">Terms Version</td><td style="padding:6px 10px;border:1px solid #ddd;">v1.0 — Founding Merchant Agreement</td></tr>
            ${foundingNumber ? `<tr><td style="padding:6px 10px;font-weight:bold;background:#f9f9f9;border:1px solid #ddd;">Founding #</td><td style="padding:6px 10px;border:1px solid #ddd;">#${foundingNumber}</td></tr>` : ""}
          </table>
          <h3 style="margin-top:24px;">Terms Agreed To</h3>
          <ul style="font-size:13px;line-height:1.7;">
            <li>Prizes on the deal wheel are not cash and have no cash value.</li>
            <li>A prize is always awarded on every unlock — no "no prize" outcomes.</li>
            <li>The merchant is responsible for handling all customer disputes related to prize redemption.</li>
            <li>Merchant must be verified before receiving payouts (to prevent ghost merchants).</li>
            <li>Wheel Deals reserves the right to remove any merchant that violates these terms.</li>
            <li>Earnings splits apply after Stripe processing fees.</li>
          </ul>
          <h3>Earnings Split Schedule</h3>
          ${EARNINGS_TABLE}
          <p style="font-size:12px;color:#888;margin-top:24px;">This is an automated record. Keep for your files.</p>
        </div>
      `,
    });

    // ── 2. Welcome email to merchant (only if they have an email) ────────────
    if (merchantEmail) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: merchantEmail,
        subject: `Welcome to Wheel Deals, ${merchantName}! 🎡`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:-0.5px;">Welcome to Wheel Deals!</h1>
              <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:15px;">You're officially a Founding Merchant 🎉</p>
            </div>
            <div style="background:#fff;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
              <p style="font-size:15px;">Hi <strong>${merchantName}</strong>,</p>
              <p style="font-size:14px;line-height:1.7;">Thank you for joining Wheel Deals as a <strong>Founding Merchant</strong>. Your deal wheel is now live on the Discover page and customers can start unlocking deals at your business.</p>
              ${foundingLine}
              <h3 style="color:#d97706;margin-top:24px;">Your Merchant Details</h3>
              <table style="border-collapse:collapse;width:100%;font-size:13px;">
                <tr><td style="padding:6px 10px;font-weight:bold;background:#fafafa;border:1px solid #e5e7eb;">Business Name</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${merchantName}</td></tr>
                <tr><td style="padding:6px 10px;font-weight:bold;background:#fafafa;border:1px solid #e5e7eb;">Merchant ID</td><td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${merchantId}</td></tr>
                <tr><td style="padding:6px 10px;font-weight:bold;background:#fafafa;border:1px solid #e5e7eb;">Terms Accepted</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${acceptedDate} (PT)</td></tr>
              </table>
              <h3 style="color:#d97706;margin-top:24px;">Your Earnings Per Unlock</h3>
              ${EARNINGS_TABLE}
              <h3 style="color:#d97706;margin-top:24px;">What's Next?</h3>
              <ol style="font-size:14px;line-height:1.8;">
                <li>Connect your Stripe account from the <a href="https://wheel-deals-nine.vercel.app/merchant/onboard" style="color:#d97706;">Merchant Dashboard</a> to receive payouts.</li>
                <li>Watch customers unlock deals and earn!</li>
              </ol>
              <p style="font-size:13px;color:#6b7280;margin-top:24px;">Questions? Reply to this email or visit <a href="https://wheel-deals-nine.vercel.app" style="color:#d97706;">wheel-deals-nine.vercel.app</a>.</p>
              <p style="font-size:13px;color:#6b7280;">— The Wheel Deals Team</p>
            </div>
          </div>
        `,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Email send error:", err);
    return NextResponse.json({ error: err.message ?? "Email failed" }, { status: 500 });
  }
}
