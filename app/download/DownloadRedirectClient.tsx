"use client";

import { useEffect, useMemo, useState } from "react";

const APP_STORE_URL = "https://apps.apple.com/us/app/wheel-deals/id6776004051";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.wheeldealsapp.app";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";

  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIPadOS = platform === "MacIntel" && navigator.maxTouchPoints > 1;

  if (/iPhone|iPad|iPod/i.test(userAgent) || isIPadOS) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

export default function DownloadRedirectClient() {
  const [platform, setPlatform] = useState<Platform>("other");
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const detected = detectPlatform();
    setPlatform(detected);

    if (detected === "ios" || detected === "android") {
      setRedirecting(true);
      const destination = detected === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
      const timer = window.setTimeout(() => window.location.replace(destination), 500);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const statusText = useMemo(() => {
    if (platform === "ios") return "Opening Wheel Deals in the App Store…";
    if (platform === "android") return "Opening Wheel Deals in Google Play…";
    return "Choose your app store";
  }, [platform]);

  return (
    <main className="min-h-screen bg-[#071733] text-white flex items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-[28px] border border-white/15 bg-white/[0.06] p-7 text-center shadow-2xl shadow-black/30 backdrop-blur">
        <img
          src="/icon-512.png"
          alt="Wheel Deals"
          className="mx-auto h-24 w-24 rounded-2xl shadow-lg shadow-black/30"
        />
        <h1 className="mt-5 text-3xl font-black tracking-tight">Download Wheel Deals</h1>
        <p className="mt-3 text-base leading-7 text-white/75">
          Discover local businesses and unlock promotional deals near you.
        </p>

        <div className="mt-7 rounded-2xl bg-white/10 px-4 py-3 font-bold text-[#ffbe2e]">
          {statusText}
        </div>

        <div className="mt-6 grid gap-3">
          <a
            href={APP_STORE_URL}
            className="rounded-xl bg-white px-5 py-4 font-extrabold text-[#071733] transition hover:bg-white/90"
          >
            Download on the App Store
          </a>
          <a
            href={PLAY_STORE_URL}
            className="rounded-xl bg-[#ff9d00] px-5 py-4 font-extrabold text-[#071733] transition hover:bg-[#ffb02e]"
          >
            Get it on Google Play
          </a>
        </div>

        {redirecting ? (
          <p className="mt-5 text-sm text-white/55">
            If your app store does not open automatically, tap the matching button above.
          </p>
        ) : null}

        <a href="/discover" className="mt-7 inline-block text-sm font-semibold text-white/65 underline underline-offset-4">
          Continue on the website
        </a>
      </section>
    </main>
  );
}
