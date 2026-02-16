// app/api/geocode/reverse/route.ts
import { NextResponse } from "next/server";

// Dev-friendly reverse geocode using OpenStreetMap Nominatim (no key).
// Note: rate-limited. For production scale later, swap to Google/Mapbox.
export async function POST(req: Request) {
  try {
    const { lat, lng } = await req.json();

    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ ok: false, error: "Missing lat/lng" }, { status: 400 });
    }

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "WheelDeals/1.0 (dev)",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "Geocode failed" }, { status: 500 });
    }

    const data: any = await res.json();
    const a = data?.address ?? {};

    const city = a.city || a.town || a.village || a.suburb || a.county || "";
    const state = a.state || a.region || "";

    return NextResponse.json(
      {
        ok: true,
        city: String(city || "").trim().toLowerCase(),
        state: String(state || "").trim().toLowerCase(),
        displayName: String(data?.display_name || "").trim(),
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}
