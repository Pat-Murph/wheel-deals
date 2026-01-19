"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type WheelItem = {
  label: string;
  weight: number;
};

type Props = {
  items: WheelItem[];
  size?: number;            // wheel diameter in px
  onResult?: (label: string) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Some nice, distinct colors (we’ll cycle)
const COLORS = [
  "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF",
  "#A66CFF", "#FF8E3C", "#2EC4B6", "#E71D36",
];

export default function Wheel({ items, size = 360, onResult }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Rotation in degrees for the container
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);

  // Precompute total weight and slice angles
  const totalWeight = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.weight) || 0), 0),
    [items]
  );

  // Draw wheel whenever items change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 8;

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();

    // If no items
    if (!items.length || totalWeight <= 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#eee";
      ctx.fill();
      return;
    }

    // Start at top (-90deg)
    let startAngle = -Math.PI / 2;

    items.forEach((it, idx) => {
      const w = clamp(Number(it.weight) || 0, 0, 1e9);
      const slice = (w / totalWeight) * Math.PI * 2;
      const endAngle = startAngle + slice;

      // Slice
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = COLORS[idx % COLORS.length];
      ctx.fill();

      // Slice border line
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Text
      const mid = (startAngle + endAngle) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#111";
      ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const label = it.label ?? "";
      ctx.fillText(label, radius - 18, 0);

      ctx.restore();

      startAngle = endAngle;
    });

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.fillStyle = "#111";
    ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SPIN", cx, cy);

  }, [items, size, totalWeight]);

  function pickWeightedIndex() {
    // Random in [0, totalWeight)
    const r = Math.random() * totalWeight;
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      acc += clamp(Number(items[i].weight) || 0, 0, 1e9);
      if (r < acc) return i;
    }
    return items.length - 1;
  }

  function sliceCenterAngleDeg(index: number) {
    // returns center angle (degrees) from top (-90deg baseline),
    // but we’ll convert to rotation needed to land at the pointer.
    let start = -90; // top
    for (let i = 0; i < items.length; i++) {
      const w = clamp(Number(items[i].weight) || 0, 0, 1e9);
      const sliceDeg = (w / totalWeight) * 360;
      const end = start + sliceDeg;
      if (i === index) return (start + end) / 2;
      start = end;
    }
    return 0;
  }

  const spin = () => {
    if (spinning) return;
    if (!items.length || totalWeight <= 0) return;

    setSpinning(true);

    const winnerIndex = pickWeightedIndex();
    const winnerLabel = items[winnerIndex]?.label ?? "Unknown";

    // We want the winner slice center to land at the pointer (top).
    // Pointer is at 0deg (top). Our wheel drawing starts at -90deg top,
    // but the center angles we computed are relative to that, so:
    // To bring winnerCenter to 0, rotate by (0 - winnerCenter).
    const winnerCenter = sliceCenterAngleDeg(winnerIndex);

    // Add multiple full spins for drama + a tiny random nudge
    const extraSpins = 5 * 360;
    const nudge = (Math.random() - 0.5) * 8; // +-4deg

    // Current rotation might be big; keep it manageable
    const current = rotation % 360;

    // Target: current + extra spins + (0 - winnerCenter) correction
    const target = rotation + extraSpins + (0 - winnerCenter) + nudge - current;

    setRotation(target);

    // Match the CSS duration below
    window.setTimeout(() => {
      setSpinning(false);
      onResult?.(winnerLabel);
    }, 4200);
  };

  return (
    <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
      {/* Pointer */}
      <div style={{ position: "relative", width: size, height: size }}>
        <div
          style={{
            position: "absolute",
            top: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "10px solid transparent",
            borderRight: "10px solid transparent",
            borderBottom: "18px solid #111",
            zIndex: 2,
          }}
        />

        {/* Wheel container rotates */}
        <div
          style={{
            width: size,
            height: size,
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? "transform 4.2s cubic-bezier(0.15, 0.85, 0.1, 1)"
              : "transform 0.2s ease-out",
          }}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>

      <button
        onClick={spin}
        disabled={spinning}
        style={{
          padding: "10px 16px",
          borderRadius: 10,
          border: "1px solid #ddd",
          background: spinning ? "#f3f3f3" : "white",
          cursor: spinning ? "not-allowed" : "pointer",
          fontWeight: 700,
        }}
      >
        {spinning ? "Spinning..." : "Spin ($1)"}
      </button>
    </div>
  );
}
