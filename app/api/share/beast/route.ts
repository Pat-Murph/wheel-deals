import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import React from "react";
import sharp from "sharp";
import QRCode from "qrcode";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminDb, getAdminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const PUBLIC_BASE_URL = "https://wheel-deals-nine.vercel.app";
const WEBSITE_URL = "https://wheeldealsapp.com";
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

function clean(value: string | null, fallback: string, maxLength: number) {
  const normalized = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, maxLength);
}

function validHex(value: string | null) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? String(value) : "#9966ff";
}

function validBeastPath(value: string | null) {
  const path = value ?? "";
  if (!/^\/animals\/[a-z0-9-]+\.webp$/i.test(path)) return "/animals/wolf-chains.webp";
  return path;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") {
      const date = (toDate as () => unknown).call(value);
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function signingSecret() {
  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!value) throw new Error("Missing server signing configuration");
  return value;
}

function downloadSignature(spinId: string, merchantId: string, exp: number) {
  return createHmac("sha256", signingSecret())
    .update(`${spinId}.${merchantId}.${exp}`)
    .digest("hex");
}

function validSignature(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function validDocumentId(value: string) {
  return value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    if (!token) return noStoreJson({ ok: false, error: "Authentication required" }, 401);

    const decoded = await getAdminAuth().verifyIdToken(token);
    const body = await request.json().catch(() => ({}));
    const spinId = clean(typeof body?.spinId === "string" ? body.spinId : null, "", 180);
    const merchantId = clean(typeof body?.merchantId === "string" ? body.merchantId : null, "", 180);
    if (!validDocumentId(spinId) || !validDocumentId(merchantId)) {
      return noStoreJson({ ok: false, error: "Missing or invalid deal information" }, 400);
    }

    const spinSnapshot = await adminDb.collection("spins").doc(spinId).get();
    if (!spinSnapshot.exists) return noStoreJson({ ok: false, error: "Deal not found" }, 404);

    const spin = spinSnapshot.data() as Record<string, unknown>;
    const expiresAt = asDate(spin.expiresAt);
    const active = String(spin.status ?? "") === "issued"
      && spin.redeemed !== true
      && expiresAt
      && expiresAt.getTime() > Date.now();

    if (String(spin.uid ?? "") !== decoded.uid || String(spin.merchantId ?? "") !== merchantId) {
      return noStoreJson({ ok: false, error: "Deal not found" }, 404);
    }
    if (!active) return noStoreJson({ ok: false, error: "This deal has been redeemed or expired" }, 409);

    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_URL_TTL_SECONDS;
    const sig = downloadSignature(spinId, merchantId, exp);
    const url = new URL("/api/share/beast", PUBLIC_BASE_URL);
    url.searchParams.set("mode", "deal");
    url.searchParams.set("spinId", spinId);
    url.searchParams.set("merchantId", merchantId);
    url.searchParams.set("exp", String(exp));
    url.searchParams.set("sig", sig);

    return noStoreJson({ ok: true, url: `${url.pathname}${url.search}`, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const isAuthError = errorCode.startsWith("auth/");
    console.error("Deal QR download authorization failed:", error);
    return noStoreJson(
      { ok: false, error: isAuthError ? "Authentication expired" : "Could not prepare the Deal QR" },
      isAuthError ? 401 : 500,
    );
  }
}

async function renderDealDownload(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const spinId = clean(params.get("spinId"), "", 180);
  const merchantId = clean(params.get("merchantId"), "", 180);
  const exp = Number(params.get("exp") ?? "0");
  const sig = params.get("sig") ?? "";

  if (!validDocumentId(spinId) || !validDocumentId(merchantId) || !Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) {
    return new Response("This download link has expired. Return to Wheel Deals and tap Download Deal QR again.", { status: 403 });
  }
  const expected = downloadSignature(spinId, merchantId, exp);
  if (!validSignature(sig, expected)) return new Response("Invalid download link.", { status: 403 });

  const [spinSnapshot, merchantSnapshot] = await Promise.all([
    adminDb.collection("spins").doc(spinId).get(),
    adminDb.collection("merchants").doc(merchantId).get(),
  ]);
  if (!spinSnapshot.exists) return new Response("Deal not found.", { status: 404 });

  const spin = spinSnapshot.data() as Record<string, unknown>;
  const expiresAt = asDate(spin.expiresAt);
  const active = String(spin.status ?? "") === "issued"
    && spin.redeemed !== true
    && expiresAt
    && expiresAt.getTime() > Date.now();
  if (String(spin.merchantId ?? "") !== merchantId || !active) {
    return new Response("This deal has been redeemed or expired.", { status: 410 });
  }

  const merchant = merchantSnapshot.exists ? (merchantSnapshot.data() as Record<string, unknown>) : {};
  const code = clean(String(spin.code ?? ""), "", 80);
  if (!code) return new Response("Deal code not found.", { status: 404 });

  const deal = clean(String(spin.prizeLabel ?? ""), "Unlocked deal", 100);
  const merchantName = clean(String(merchant.name ?? spin.merchantName ?? ""), "Wheel Deals merchant", 80);
  const location = [merchant.city, merchant.state]
    .map((value) => clean(typeof value === "string" ? value : null, "", 40))
    .filter(Boolean)
    .join(", ");
  const expirationLabel = (expiresAt as Date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const qrDataUrl = await QRCode.toDataURL(code, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 620,
    color: { dark: "#000000", light: "#ffffff" },
    type: "image/png",
  });

  return new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          color: "#0b1220",
          background: "linear-gradient(160deg, #ffffff 0%, #fffaf0 58%, #eef5ff 100%)",
          fontFamily: "Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
          padding: "54px 62px 48px",
        },
      },
      React.createElement("div", {
        style: {
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: 350,
          right: -300,
          top: -320,
          background: "radial-gradient(circle, rgba(255,183,0,0.28) 0%, rgba(255,183,0,0) 70%)",
        },
      }),
      React.createElement(
        "div",
        { style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" } },
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center" } },
          React.createElement("img", {
            src: `${PUBLIC_BASE_URL}/icon-512.png`,
            width: 104,
            height: 104,
            style: { borderRadius: 24 },
          }),
          React.createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", marginLeft: 24 } },
            React.createElement("div", { style: { fontSize: 48, fontWeight: 900, color: "#0b2d5c" } }, "WHEEL DEALS"),
            React.createElement("div", { style: { fontSize: 25, fontWeight: 800, color: "#f59e0b" } }, "YOUR SAVED DEAL"),
          ),
        ),
        React.createElement(
          "div",
          { style: { padding: "12px 22px", borderRadius: 28, background: "#0b2d5c", color: "#fff", fontSize: 22, fontWeight: 900 } },
          "ONE-TIME USE",
        ),
      ),
      React.createElement(
        "div",
        { style: { marginTop: 34, fontSize: deal.length > 52 ? 38 : 48, lineHeight: 1.08, fontWeight: 900, textAlign: "center", color: "#0b1220" } },
        deal,
      ),
      React.createElement(
        "div",
        { style: { marginTop: 13, fontSize: merchantName.length > 48 ? 27 : 33, fontWeight: 850, textAlign: "center", color: "#334155" } },
        location ? `${merchantName} • ${location}` : merchantName,
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 680,
            height: 680,
            marginTop: 28,
            borderRadius: 42,
            background: "#ffffff",
            border: "4px solid #d5a100",
            boxShadow: "0 20px 45px rgba(15, 23, 42, 0.16)",
          },
        },
        React.createElement("img", { src: qrDataUrl, width: 620, height: 620 }),
      ),
      React.createElement(
        "div",
        { style: { marginTop: 22, fontSize: 23, fontWeight: 750, color: "#475569", textAlign: "center" } },
        "Merchant can scan the QR code or enter the code below.",
      ),
      React.createElement(
        "div",
        { style: { marginTop: 10, fontSize: 56, fontWeight: 950, letterSpacing: 6, color: "#0b2d5c" } },
        code,
      ),
      React.createElement(
        "div",
        {
          style: {
            marginTop: 22,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 28px",
            borderRadius: 22,
            background: "#fff1f2",
            border: "2px solid #fecdd3",
            color: "#b91c1c",
            fontSize: 25,
            fontWeight: 900,
          },
        },
        React.createElement("span", null, `EXPIRES ${expirationLabel.toUpperCase()}`),
        React.createElement("span", null, "REDEEM BEFORE EXPIRATION"),
      ),
      React.createElement(
        "div",
        {
          style: {
            marginTop: 26,
            width: 720,
            height: 70,
            borderRadius: 35,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#101827",
            background: "linear-gradient(90deg, #ffd93d 0%, #ff9b00 100%)",
            fontSize: 31,
            fontWeight: 900,
          },
        },
        WEBSITE_URL.replace("https://", ""),
      ),
    ),
    {
      width: 1080,
      height: 1350,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="wheel-deals-${spinId.replace(/[^a-z0-9_-]/gi, "-")}.png"`,
      },
    },
  );
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("mode") === "deal") {
    try {
      return await renderDealDownload(request);
    } catch (error) {
      console.error("Deal QR image generation failed:", error);
      return new Response("Could not create the Deal QR image. Return to Wheel Deals and try again.", { status: 500 });
    }
  }

  const params = request.nextUrl.searchParams;
  const beast = clean(params.get("beast"), "Wheel Deals Beast", 48);
  const rarity = clean(params.get("rarity"), "DEAL UNLOCKED", 36).toUpperCase();
  const deal = clean(params.get("deal"), "A local deal", 84);
  const merchant = clean(params.get("merchant"), "A local business", 64);
  const location = clean(params.get("location"), "", 64);
  const glow = validHex(params.get("glow"));
  const imagePath = validBeastPath(params.get("image"));
  const merchantLine = location ? `${merchant} • ${location}` : merchant;

  const beastSourceUrl = new URL(imagePath, request.nextUrl.origin).toString();
  const beastResponse = await fetch(beastSourceUrl, { cache: "force-cache" });
  if (!beastResponse.ok) {
    return new Response("Beast artwork could not be loaded.", { status: 502 });
  }
  const beastSource = Buffer.from(await beastResponse.arrayBuffer());
  const beastPng = await sharp(beastSource)
    .resize(976, 820, { fit: "cover", position: "centre" })
    .png({ quality: 94 })
    .toBuffer();
  const beastImageData = `data:image/png;base64,${beastPng.toString("base64")}`;

  return new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          color: "white",
          background: "linear-gradient(145deg, #07142e 0%, #0d234b 58%, #050b19 100%)",
          fontFamily: "Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
        },
      },
      React.createElement("div", {
        style: {
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: 450,
          left: 90,
          top: 130,
          background: `radial-gradient(circle, ${glow}66 0%, ${glow}22 42%, rgba(0,0,0,0) 72%)`,
        },
      }),
      React.createElement(
        "div",
        {
          style: {
            height: 190,
            display: "flex",
            alignItems: "center",
            padding: "34px 52px",
            position: "relative",
          },
        },
        React.createElement("img", {
          src: `${PUBLIC_BASE_URL}/icon-512.png`,
          width: 122,
          height: 122,
          style: { borderRadius: 28 },
        }),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", marginLeft: 28 } },
          React.createElement("div", { style: { fontSize: 54, fontWeight: 900, letterSpacing: 1 } }, "WHEEL DEALS"),
          React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: "#f6a000", letterSpacing: 1 } }, "UNLOCK LOCAL SAVINGS"),
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            width: 976,
            height: 820,
            marginLeft: 52,
            borderRadius: 40,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            border: `3px solid ${glow}88`,
            background: "#060b17",
          },
        },
        React.createElement("img", {
          src: beastImageData,
          width: 976,
          height: 820,
          style: { objectFit: "cover" },
        }),
        React.createElement("div", {
          style: {
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(3,8,18,0) 48%, rgba(3,8,18,0.96) 100%)",
          },
        }),
        React.createElement(
          "div",
          {
            style: {
              position: "absolute",
              left: 32,
              top: 30,
              display: "flex",
              padding: "14px 28px",
              borderRadius: 34,
              background: "rgba(4,10,24,0.86)",
              border: `3px solid ${glow}`,
              color: glow,
              fontSize: 27,
              fontWeight: 900,
              letterSpacing: 1,
            },
          },
          rarity,
        ),
        React.createElement(
          "div",
          {
            style: {
              position: "absolute",
              left: 40,
              right: 40,
              bottom: 48,
              display: "flex",
              justifyContent: "center",
              textAlign: "center",
              fontSize: beast.length > 22 ? 54 : 72,
              fontWeight: 900,
              letterSpacing: 3,
              textTransform: "uppercase",
              textShadow: `0 0 24px ${glow}`,
            },
          },
          beast,
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            height: 340,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "34px 52px 32px",
          },
        },
        React.createElement("div", { style: { fontSize: 28, color: "#f6a000", fontWeight: 900, letterSpacing: 1 } }, "DEAL UNLOCKED"),
        React.createElement(
          "div",
          {
            style: {
              marginTop: 12,
              maxWidth: 940,
              fontSize: deal.length > 48 ? 34 : 46,
              fontWeight: 900,
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          deal,
        ),
        React.createElement(
          "div",
          {
            style: {
              marginTop: 14,
              maxWidth: 940,
              fontSize: merchantLine.length > 52 ? 24 : 31,
              fontWeight: 800,
              color: "#cbd5e1",
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          merchantLine,
        ),
        React.createElement(
          "div",
          {
            style: {
              width: 700,
              height: 76,
              marginTop: 26,
              borderRadius: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#101827",
              background: "linear-gradient(90deg, #ffd93d 0%, #ff8a00 100%)",
              fontSize: 34,
              fontWeight: 900,
            },
          },
          "wheeldealsapp.com",
        ),
      ),
    ),
    {
      width: 1080,
      height: 1350,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
