import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  const { merchantId } = await params;

  // Fetch merchant info from Firestore
  let merchantName = "Your Business";
  let merchantCity = "";
  let merchantCategory = "";
  let merchantState = "";
  try {
    const db = getAdminDb();
    const snap = await db.collection("merchants").doc(merchantId).get();
    if (snap.exists) {
      const data = snap.data()!;
      merchantName = data.name ?? merchantName;
      merchantCity = data.city ?? "";
      merchantState = data.state ?? "";
      merchantCategory = data.category ?? "";
    }
  } catch {
    // Non-fatal — use defaults
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://wheel-deals-nine.vercel.app";
  const websiteUrl = "https://wheeldealsapp.com";
  const playStoreUrl = "https://play.google.com/store/apps/details?id=com.wheeldealsapp.app";

  // Direct link to this merchant's wheel page
  const merchantPageUrl = `${appUrl}/wheel?merchantId=${merchantId}`;
  // Shareable landing page
  const merchantLandingUrl = `${appUrl}/m/${merchantId}`;

  // QR codes via Google Charts API
  const merchantQr = `https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=${encodeURIComponent(merchantLandingUrl)}&choe=UTF-8`;
  const playStoreQr = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodeURIComponent(playStoreUrl)}&choe=UTF-8`;
  const websiteQr = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodeURIComponent(websiteUrl)}&choe=UTF-8`;

  const location = [merchantCity, merchantState].filter(Boolean).join(", ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Find us on Wheel Deals — ${merchantName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: #fff;
      color: #1a1a1a;
      width: 8.5in;
      min-height: 11in;
      padding: 0.4in 0.6in;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    @media print {
      body { padding: 0.35in 0.5in; }
      .no-print { display: none !important; }
    }

    /* ── Hero Banner ── */
    .hero {
      width: 100%;
      background: linear-gradient(135deg, #1e3a5f 0%, #0a1628 100%);
      border-radius: 16px;
      padding: 24px 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      margin-bottom: 20px;
    }
    .hero-logo {
      height: 80px;
      width: auto;
    }
    .hero-text {
      color: #fff;
    }
    .hero-text h1 {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: -0.5px;
      line-height: 1.1;
    }
    .hero-text p {
      font-size: 14px;
      color: rgba(255,255,255,0.8);
      margin-top: 4px;
    }

    /* ── Merchant Info ── */
    .merchant-banner {
      width: 100%;
      background: linear-gradient(180deg, #FFD700, #FFA500);
      border-radius: 12px;
      padding: 16px 24px;
      text-align: center;
      margin-bottom: 20px;
    }
    .merchant-banner h2 {
      font-size: 32px;
      font-weight: 900;
      color: #1a1a1a;
      line-height: 1.1;
    }
    .merchant-banner .location {
      font-size: 16px;
      font-weight: 600;
      color: #4a3500;
      margin-top: 4px;
    }
    .merchant-banner .category {
      font-size: 13px;
      color: #6b4e00;
      margin-top: 2px;
    }

    /* ── Find Us Section ── */
    .find-us {
      text-align: center;
      margin-bottom: 16px;
    }
    .find-us h3 {
      font-size: 22px;
      font-weight: 900;
      color: #d97706;
    }
    .find-us p {
      font-size: 14px;
      color: #6b7280;
      margin-top: 4px;
    }

    /* ── Main QR ── */
    .main-qr {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 20px;
    }
    .main-qr .qr-box {
      border: 4px solid #d97706;
      border-radius: 16px;
      padding: 12px;
      background: #fff;
    }
    .main-qr .qr-box img {
      width: 200px;
      height: 200px;
      display: block;
    }
    .main-qr .qr-label {
      font-size: 15px;
      font-weight: 800;
      color: #1a1a1a;
      margin-top: 10px;
    }
    .main-qr .qr-url {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 2px;
      word-break: break-all;
    }

    /* ── Steps ── */
    .steps {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 20px;
      width: 100%;
    }
    .step {
      flex: 1;
      max-width: 180px;
      background: #fef9c3;
      border: 2px solid #fde68a;
      border-radius: 14px;
      padding: 14px 12px;
      text-align: center;
    }
    .step-num {
      font-size: 24px;
      font-weight: 900;
      color: #d97706;
      margin-bottom: 4px;
    }
    .step-text {
      font-size: 13px;
      font-weight: 700;
      color: #374151;
      line-height: 1.3;
    }

    /* ── Bottom QR Row ── */
    .qr-row {
      display: flex;
      gap: 40px;
      justify-content: center;
      align-items: flex-start;
      margin-bottom: 20px;
      width: 100%;
    }
    .qr-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .qr-item .qr-small {
      border: 3px solid #e5e7eb;
      border-radius: 12px;
      padding: 8px;
      background: #fff;
    }
    .qr-item .qr-small img {
      width: 120px;
      height: 120px;
      display: block;
    }
    .qr-item .label {
      font-size: 12px;
      font-weight: 700;
      color: #374151;
      text-align: center;
    }
    .qr-item .sub-label {
      font-size: 10px;
      color: #9ca3af;
      text-align: center;
    }

    /* ── Share Link ── */
    .share-link {
      width: 100%;
      background: #f3f4f6;
      border-radius: 10px;
      padding: 12px 20px;
      text-align: center;
      margin-bottom: 16px;
    }
    .share-link .title {
      font-size: 13px;
      font-weight: 700;
      color: #374151;
      margin-bottom: 4px;
    }
    .share-link .url {
      font-size: 12px;
      color: #d97706;
      font-weight: 600;
      word-break: break-all;
    }

    /* ── Footer ── */
    .footer {
      border-top: 2px solid #e5e7eb;
      padding-top: 12px;
      text-align: center;
      width: 100%;
    }
    .footer-brand {
      font-size: 14px;
      font-weight: 900;
      color: #d97706;
      margin-bottom: 4px;
    }
    .footer-text {
      font-size: 10px;
      color: #9ca3af;
      line-height: 1.6;
    }

    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(180deg, #FFD700, #FFA500);
      color: #1a1a1a;
      font-weight: 900;
      font-size: 15px;
      padding: 12px 24px;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 100;
    }
  </style>
</head>
<body>
  <button class="no-print print-btn" onclick="window.print()">Print / Save as PDF</button>

  <!-- Hero Banner -->
  <div class="hero">
    <img class="hero-logo" src="${appUrl}/wd-hero-logo.png" alt="Wheel Deals" />
    <div class="hero-text">
      <h1>Wheel Deals</h1>
      <p>Unlock Local Savings</p>
    </div>
  </div>

  <!-- Merchant Name Banner -->
  <div class="merchant-banner">
    <h2>${merchantName}</h2>
    ${location ? `<div class="location">${location}</div>` : ""}
    ${merchantCategory ? `<div class="category">${merchantCategory}</div>` : ""}
  </div>

  <!-- Find Us -->
  <div class="find-us">
    <h3>Find Us on Wheel Deals!</h3>
    <p>Scan the QR code to unlock exclusive deals at our store</p>
  </div>

  <!-- Main QR Code — links to merchant's page -->
  <div class="main-qr">
    <div class="qr-box">
      <img src="${merchantQr}" alt="QR Code — ${merchantName}" />
    </div>
    <div class="qr-label">Scan to see our deals</div>
    <div class="qr-url">${merchantLandingUrl}</div>
  </div>

  <!-- How It Works -->
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">Scan the QR code or visit the link</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">Spin the wheel &amp; unlock a deal</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">Show your deal code to redeem!</div>
    </div>
  </div>

  <!-- Google Play & Website QR codes -->
  <div class="qr-row">
    <div class="qr-item">
      <div class="qr-small">
        <img src="${playStoreQr}" alt="Google Play Store" />
      </div>
      <div class="label">Get it on Google Play</div>
      <div class="sub-label">Download the app</div>
    </div>
    <div class="qr-item">
      <div class="qr-small">
        <img src="${websiteQr}" alt="Wheel Deals Website" />
      </div>
      <div class="label">Visit Our Website</div>
      <div class="sub-label">wheeldealsapp.com</div>
    </div>
  </div>

  <!-- Shareable Link -->
  <div class="share-link">
    <div class="title">Share this link online — customers go straight to your deals:</div>
    <div class="url">${merchantLandingUrl}</div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="footer-brand">Wheel Deals — Unlock Local Savings</div>
    <div class="footer-text">
      Unlock prices start at $1.35 &nbsp;·&nbsp; Deals are non-cash promotional offers &nbsp;·&nbsp; Must be 18+<br/>
      A deal is always awarded on every unlock. No cash value. Terms may vary — contact merchant for details.
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
