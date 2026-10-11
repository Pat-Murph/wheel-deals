"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LocationState = {
  key: string;
  status: "checking" | "ready" | "error";
  position: { lat: number; lng: number } | null;
  error: string | null;
};

export function useBoostLocation(requestKey: string, autoCheck: boolean) {
  const [result, setResult] = useState<LocationState | null>(null);
  const inFlight = useRef<{ key: string; id: number } | null>(null);
  const nextRequestId = useRef(0);
  const attemptedKey = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestLocation = useCallback(() => {
    if (!requestKey || inFlight.current?.key === requestKey) return;
    const id = ++nextRequestId.current;
    inFlight.current = { key: requestKey, id };
    setResult({ key: requestKey, status: "checking", position: null, error: null });
    const finish = (position: LocationState["position"], error: string | null) => {
      if (!mounted.current || inFlight.current?.id !== id) return;
      inFlight.current = null;
      setResult({ key: requestKey, status: error ? "error" : "ready", position, error });
    };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      finish(null, "Location is unavailable on this device. Use a browser or device with location enabled to claim your free deal.");
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude }, null),
        (error) => finish(null, error.code === 1
          ? "Allow location access in your phone or browser settings, then try again to claim your free deal."
          : error.code === 3
            ? "The location check timed out. Turn on location services and try again."
            : "Could not determine your location. Turn on location services and try again."),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    } catch {
      finish(null, "Could not start the location check. Enable location access in your phone or browser settings and try again.");
    }
  }, [requestKey]);

  useEffect(() => {
    if (!autoCheck || !requestKey || attemptedKey.current === requestKey) return;
    attemptedKey.current = requestKey;
    requestLocation();
  }, [autoCheck, requestKey, requestLocation]);

  const current = result?.key === requestKey ? result : null;
  return {
    userPos: current?.position ?? null,
    // Prevent the first render before useEffect from briefly showing paid checkout.
    geoChecking: current?.status === "checking" || (autoCheck && !current),
    geoError: current?.error ?? null,
    requestLocation,
  };
}
