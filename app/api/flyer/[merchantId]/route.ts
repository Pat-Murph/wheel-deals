import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  const { merchantId } = await params;

  // Fetch merchant name from Firestore
  let merchantName = "Your Business";
  let merchantCity = "";
  try {
    const db = getAdminDb();
    const snap = await db.collection("merchants").doc(merchantId).get();
    if (snap.exists) {
      const data = snap.data()!;
      merchantName = data.name ?? merchantName;
      merchantCity = data.city ?? "";
    }
  } catch {
    // Non-fatal — use defaults
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://wheel-deals-nine.vercel.app";
  const discoverUrl = `${appUrl}/discover`;

  // QR code via Google Charts API (no extra dependency needed)
  const qrUrl = `https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl=${encodeURIComponent(discoverUrl)}&choe=UTF-8`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WheelDeals In-Store Flyer — ${merchantName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: #fff;
      color: #1a1a1a;
      width: 8.5in;
      min-height: 11in;
      padding: 0.6in 0.7in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
    }
    @media print {
      body { padding: 0.5in 0.6in; }
      .no-print { display: none; }
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
    }
    .logo {
      width: 260px;
      height: auto;
    }

    .headline {
      font-size: 52px;
      font-weight: 900;
      color: #d97706;
      text-align: center;
      line-height: 1.1;
      letter-spacing: -1px;
      margin-bottom: 10px;
    }
    .sub {
      font-size: 26px;
      font-weight: 700;
      color: #374151;
      text-align: center;
      margin-bottom: 28px;
    }

    .wheel-graphic {
      font-size: 90px;
      text-align: center;
      margin-bottom: 20px;
      line-height: 1;
    }

    .steps {
      display: flex;
      gap: 24px;
      justify-content: center;
      margin-bottom: 32px;
      width: 100%;
    }
    .step {
      flex: 1;
      max-width: 200px;
      background: #fef9c3;
      border: 2px solid #fde68a;
      border-radius: 16px;
      padding: 18px 14px;
      text-align: center;
    }
    .step-num {
      font-size: 28px;
      font-weight: 900;
      color: #d97706;
      margin-bottom: 6px;
    }
    .step-text {
      font-size: 14px;
      font-weight: 700;
      color: #374151;
      line-height: 1.4;
    }

    .qr-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin-bottom: 28px;
    }
    .qr-box {
      border: 4px solid #d97706;
      border-radius: 16px;
      padding: 12px;
      background: #fff;
    }
    .qr-box img {
      width: 200px;
      height: 200px;
      display: block;
    }
    .qr-label {
      font-size: 16px;
      font-weight: 800;
      color: #374151;
      text-align: center;
    }
    .qr-url {
      font-size: 13px;
      color: #6b7280;
      text-align: center;
    }

    .merchant-name {
      font-size: 20px;
      font-weight: 900;
      color: #1a1a1a;
      text-align: center;
      margin-bottom: 4px;
    }
    .merchant-city {
      font-size: 15px;
      color: #6b7280;
      text-align: center;
      margin-bottom: 24px;
    }

    .footer {
      border-top: 2px solid #e5e7eb;
      padding-top: 16px;
      text-align: center;
      width: 100%;
    }
    .footer-text {
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.6;
    }
    .footer-brand {
      font-size: 14px;
      font-weight: 900;
      color: #d97706;
      margin-bottom: 4px;
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
    }
  </style>
</head>
<body>
  <button class="no-print print-btn" onclick="window.print()">Print / Save as PDF</button>

  <div class="header">
    <img class="logo" src="${appUrl}/wheel-deals-discover.png" alt="Wheel Deals Discover" />
  </div>

  <div class="headline">Spin to Unlock Deals!</div>
  <div class="sub">Exclusive promotional deals — right here at ${merchantName}</div>

  <div class="wheel-graphic">🎡</div>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">Scan the QR code below</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">Find us on WheelDeals &amp; spin the deal wheel</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">Show your deal code to redeem in store!</div>
    </div>
  </div>

  <div class="qr-section">
    <div class="qr-box">
      <img src="${qrUrl}" alt="QR Code" />
    </div>
    <div class="qr-label">Scan to discover deals near you</div>
    <div class="qr-url">${discoverUrl}</div>
  </div>

  <div class="merchant-name">${merchantName}</div>
  ${merchantCity ? `<div class="merchant-city">${merchantCity}</div>` : ""}

  <div class="footer">
    <div class="footer-brand">WheelDeals</div>
    <div class="footer-text">
      Unlock prices start at $1.35 &nbsp;·&nbsp; Deals are non-cash promotional offers &nbsp;·&nbsp; Must be 18+<br/>
      A deal is always awarded on every spin. No cash value.
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
