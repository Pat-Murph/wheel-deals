"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapMerchant = {
  id: string;
  name?: string;
  category?: string;
  city?: string;
  lat?: number;
  lng?: number;
};

type Props = {
  merchants?: MapMerchant[];
  nearMeEnabled?: boolean;
  radiusMiles?: number;
  onPickMerchant?: (id: string) => void;
};

const DEFAULT_CENTER: [number, number] = [36.1699, -115.1398]; // Las Vegas

function isFiniteNum(n: any) {
  return typeof n === "number" && Number.isFinite(n);
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function FitToPoints({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const prev = useRef<string>("");

  useEffect(() => {
    if (!points.length) return;
    const key = points.map((p) => p.join(",")).join("|");
    if (key === prev.current) return;
    prev.current = key;
    try {
      const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
      map.fitBounds(bounds.pad(0.35), { animate: false, maxZoom: 14 });
    } catch {
      // map may not be ready yet — safe to ignore
    }
  }, [points, map]);

  return null;
}

export default function DiscoverMap({
  merchants,
  nearMeEnabled = false,
  radiusMiles = 10,
  onPickMerchant,
}: Props) {
  const safeMerchants = Array.isArray(merchants) ? merchants : [];

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Only run on client — avoids SSR issues with Leaflet
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!nearMeEnabled) {
      setUserLoc(null);
      setGeoError(null);
      return;
    }
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoError(null);
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setGeoError("Location permission denied.");
        setUserLoc(null);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
    );
  }, [nearMeEnabled]);

  const merchantsWithCoords = useMemo(
    () => safeMerchants.filter((m) => isFiniteNum(m.lat) && isFiniteNum(m.lng)),
    [safeMerchants]
  );

  const visibleMerchants = useMemo(() => {
    if (nearMeEnabled && userLoc) {
      return merchantsWithCoords.filter(
        (m) => distanceMiles(userLoc.lat, userLoc.lng, m.lat!, m.lng!) <= radiusMiles
      );
    }
    return merchantsWithCoords;
  }, [nearMeEnabled, userLoc, radiusMiles, merchantsWithCoords]);

  const center = useMemo<[number, number]>(() => {
    if (nearMeEnabled && userLoc) return [userLoc.lat, userLoc.lng];
    if (merchantsWithCoords.length)
      return [merchantsWithCoords[0].lat!, merchantsWithCoords[0].lng!];
    return DEFAULT_CENTER;
  }, [nearMeEnabled, userLoc, merchantsWithCoords]);

  const fitPoints = useMemo(() => {
    const pts = visibleMerchants.map((m) => [m.lat!, m.lng!] as [number, number]);
    if (!pts.length && nearMeEnabled && userLoc)
      return [[userLoc.lat, userLoc.lng]] as [number, number][];
    return pts;
  }, [visibleMerchants, nearMeEnabled, userLoc]);

  // Stable key: only changes when center changes meaningfully.
  // This forces Leaflet to fully unmount + remount instead of
  // trying to reuse the same container — fixes "Map container is
  // being reused by another instance".
  const mapKey = `${center[0].toFixed(4)},${center[1].toFixed(4)}`;

  if (!mounted) {
    // Render a placeholder with the same dimensions to avoid layout shift
    return (
      <div
        style={{
          width: "100%",
          height: 220,
          background: "#f3f4f6",
          display: "grid",
          placeItems: "center",
          fontWeight: 900,
          opacity: 0.6,
        }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <style>{`
        .wd-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .wd-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.95);
          border: 1px solid rgba(0,0,0,0.12);
          border-radius: 14px;
          padding: 6px 10px;
          font-weight: 900;
          white-space: nowrap;
          box-shadow: 0 10px 24px rgba(0,0,0,0.14);
        }
        .wd-wheel {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 2px solid rgba(0,0,0,0.20);
          background: conic-gradient(
            #ff3b3b, #ffb020, #ffd93d, #35d07f, #2db7ff, #8b5cf6, #ff3b3b
          );
          position: relative;
        }
        .wd-wheel:after {
          content: "";
          position: absolute;
          inset: 5px;
          border-radius: 999px;
          background: rgba(255,255,255,0.9);
          border: 2px solid rgba(0,0,0,0.12);
        }
      `}</style>

      {nearMeEnabled && geoError && (
        <div style={{ color: "#b91c1c", fontWeight: 900, marginBottom: 10 }}>
          {geoError}
        </div>
      )}

      <div
        style={{
          border: "none",
          borderRadius: 0,
          overflow: "hidden",
          background: "white",
        }}
      >
        <MapContainer
          key={mapKey}
          center={center}
          zoom={12}
          scrollWheelZoom
          style={{ height: 220, width: "100%" }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitToPoints points={fitPoints} />

          {visibleMerchants.map((m) => (
            <CircleMarker
              key={m.id}
              center={[m.lat!, m.lng!]}
              radius={10}
              eventHandlers={{
                click: () => onPickMerchant?.(m.id),
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -8]}
                opacity={1}
                permanent
                className="wd-tooltip"
              >
                <span className="wd-badge">
                  <span className="wd-wheel" />
                  {m.name ?? m.id}
                </span>
              </Tooltip>

              <Popup>
                <div style={{ fontWeight: 900 }}>{m.name ?? m.id}</div>
                <div style={{ opacity: 0.75, fontWeight: 700, marginTop: 4 }}>
                  {m.category ?? "—"} • {m.city ?? "—"}
                </div>
                <div style={{ marginTop: 10 }}>
                  <a
                    href={`/wheel?merchantId=${encodeURIComponent(m.id)}`}
                    style={{ fontWeight: 900, textDecoration: "none" }}
                  >
                    Spin this wheel →
                  </a>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
