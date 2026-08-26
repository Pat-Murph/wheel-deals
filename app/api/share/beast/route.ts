import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import React from "react";
import sharp from "sharp";

export const runtime = "nodejs";

const PUBLIC_BASE_URL = "https://wheel-deals-nine.vercel.app";
const WEBSITE_URL = "https://wheeldealsapp.com";

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

export async function GET(request: NextRequest) {
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
