"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  merchants?: MapMerchant[]; // can be undefined while loading
  nearMeEnabled?: boolean;
  radiusMiles?: number;
  onPickMerchant?: (id: string) => void;
};

const DEFAULT_CENTER: [number, number] = [36.1699, -115.1398]; // Las Vegas

function isFiniteNum(n: any) {
  return typeof n === "number" && Number.isFinite(n);
}

// Haversine distance in miles
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function deg2rad(d: number) {
  return d * (Math.PI / 180);
}

function FitToPoints({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds.pad(0.25), { animate: true });
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

  // --- Geolocation (only when toggle enabled) ---
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!nearMeEnabled) {
      setUserLoc(null);
      setGeoError(null);
      return;
    }

    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported in this browser.");
      setUserLoc(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoError(null);
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setGeoError("User denied Geolocation");
        setUserLoc(null);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
    );
  }, [nearMeEnabled]);

  // merchants that actually have coords
  const merchantsWithCoords = useMemo(() => {
    return safeMerchants.filter((m) => isFiniteNum(m.lat) && isFiniteNum(m.lng));
  }, [safeMerchants]);

  // apply near-me filtering if enabled and user loc exists
  const visibleMerchants = useMemo(() => {
    if (nearMeEnabled && userLoc) {
      return merchantsWithCoords.filter((m) => {
        const d = distanceMiles(userLoc.lat, userLoc.lng, m.lat!, m.lng!);
        return d <= radiusMiles;
      });
    }
    return merchantsWithCoords;
  }, [nearMeEnabled, userLoc, radiusMiles, merchantsWithCoords]);

  // initial center
  const center = useMemo<[number, number]>(() => {
    if (nearMeEnabled && userLoc) return [userLoc.lat, userLoc.lng];
    if (merchantsWithCoords.length) return [merchantsWithCoords[0].lat!, merchantsWithCoords[0].lng!];
    return DEFAULT_CENTER;
  }, [nearMeEnabled, userLoc, merchantsWithCoords]);

  // points to fit
  const fitPoints = useMemo(() => {
    const pts = visibleMerchants.map((m) => [m.lat!, m.lng!] as [number, number]);
    if (!pts.length && nearMeEnabled && userLoc) return [[userLoc.lat, userLoc.lng]] as [number, number][];
    return pts;
  }, [visibleMerchants, nearMeEnabled, userLoc]);

  return (
    <div style={{ width: "100%" }}>
      {/* “wheel badge + label” CSS */}
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

      {/* Debug (remove later) */}
      <div style={{ fontWeight: 900, opacity: 0.75, marginBottom: 8 }}>
        Merchants: {safeMerchants.length} • With coords: {merchantsWithCoords.length} • Visible: {visibleMerchants.length}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 16, overflow: "hidden", background: "white" }}>
        <MapContainer center={center} zoom={12} scrollWheelZoom style={{ height: 420, width: "100%" }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
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
              {/* Wheel badge + name always visible */}
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
                    href={`/?merchantId=${encodeURIComponent(m.id)}`}
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
