"use client";

/**
 * SpinCelebration
 * ---------------
 * Full-screen overlay that pops up for ~2.8 seconds when the wheel lands.
 * The animal shown is determined by the winning slice's weight (probability).
 *
 * ANIMAL TIER MAP  (weight = share of total wheel weight, i.e. probability)
 * ─────────────────────────────────────────────────────────────────────────
 * ≥ 50 %   →  Gorilla   (breaking chains)   — common win, big energy
 * 25–49 %  →  Bull      (charging)          — solid win
 * 10–24 %  →  Wolf      (howling)           — uncommon win
 *  5–9 %   →  Tiger     (pouncing)          — rare win
 *  2–4 %   →  Eagle     (diving)            — very rare
 *  1–1.9 % →  Phoenix   (rising from fire)  — ultra rare
 *  < 1 %   →  Dragon    (breathing fire)    — legendary
 *
 * Only the gorilla asset is bundled now; others fall back to an emoji + label
 * until their images are added to /public/animals/.
 */

import React, { useEffect, useRef, useState } from "react";

export type AnimalTier = {
  id: string;
  name: string;
  emoji: string;
  imagePath: string | null;   // null = emoji fallback
  minWeightPct: number;       // minimum slice weight % to trigger this tier
  maxWeightPct: number;       // maximum slice weight % (inclusive)
  label: string;              // flavour text shown under the animal
  bgGradient: string;
  glowColor: string;
};

export const ANIMAL_TIERS: AnimalTier[] = [
  {
    id: "dragon",
    name: "Dragon",
    emoji: "🐉",
    imagePath: "/animals/dragon-chains.png",
    minWeightPct: 0,
    maxWeightPct: 0.99,
    label: "LEGENDARY!",
    bgGradient: "linear-gradient(135deg, #1a0000 0%, #3d0000 50%, #1a0000 100%)",
    glowColor: "#ff2200",
  },
  {
    id: "phoenix",
    name: "Phoenix",
    emoji: "🔥",
    imagePath: "/animals/phoenix-chains.png",
    minWeightPct: 1,
    maxWeightPct: 1.99,
    label: "ULTRA RARE!",
    bgGradient: "linear-gradient(135deg, #1a0a00 0%, #4d1a00 50%, #1a0a00 100%)",
    glowColor: "#ff6600",
  },
  {
    id: "eagle",
    name: "Eagle",
    emoji: "🦅",
    imagePath: "/animals/eagle-chains.png",
    minWeightPct: 2,
    maxWeightPct: 4.99,
    label: "VERY RARE!",
    bgGradient: "linear-gradient(135deg, #000d1a 0%, #001a3d 50%, #000d1a 100%)",
    glowColor: "#0099ff",
  },
  {
    id: "tiger",
    name: "Tiger",
    emoji: "🐯",
    imagePath: "/animals/tiger-chains.png",
    minWeightPct: 5,
    maxWeightPct: 9.99,
    label: "RARE!",
    bgGradient: "linear-gradient(135deg, #1a0d00 0%, #3d2000 50%, #1a0d00 100%)",
    glowColor: "#ff8800",
  },
  {
    id: "wolf",
    name: "Wolf",
    emoji: "🐺",
    imagePath: "/animals/wolf-chains.png",
    minWeightPct: 10,
    maxWeightPct: 24.99,
    label: "UNCOMMON!",
    bgGradient: "linear-gradient(135deg, #0d0d1a 0%, #1a1a3d 50%, #0d0d1a 100%)",
    glowColor: "#9966ff",
  },
  {
    id: "bull",
    name: "Bull",
    emoji: "🐂",
    imagePath: "/animals/bull-chains.png",
    minWeightPct: 25,
    maxWeightPct: 49.99,
    label: "SOLID WIN!",
    bgGradient: "linear-gradient(135deg, #0d1a00 0%, #1a3d00 50%, #0d1a00 100%)",
    glowColor: "#44cc00",
  },
  {
    id: "gorilla",
    name: "Gorilla",
    emoji: "🦍",
    imagePath: "/animals/gorilla-chains.png",
    minWeightPct: 50,
    maxWeightPct: 100,
    label: "UNLOCKED!",
    bgGradient: "linear-gradient(135deg, #0a0a1a 0%, #1a1000 40%, #2a1800 100%)",
    glowColor: "#F4B400",
  },
];

/** Pick the right animal tier for a given slice weight percentage */
export function getAnimalTier(sliceWeightPct: number): AnimalTier {
  // Find the matching tier (sorted from rarest to most common)
  for (const tier of ANIMAL_TIERS) {
    if (sliceWeightPct >= tier.minWeightPct && sliceWeightPct <= tier.maxWeightPct) {
      return tier;
    }
  }
  // Fallback: gorilla
  return ANIMAL_TIERS[ANIMAL_TIERS.length - 1];
}

type Props = {
  /** Slice weight as a percentage of total wheel weight (0–100) */
  sliceWeightPct: number;
  /** The deal label that was won */
  dealLabel: string;
  /** Called when the overlay finishes and should be dismissed */
  onDone: () => void;
};

export default function SpinCelebration({ sliceWeightPct, dealLabel, onDone }: Props) {
  const tier = getAnimalTier(sliceWeightPct);
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; size: number; color: string; vx: number; vy: number }[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Generate burst particles
  useEffect(() => {
    const colors = [tier.glowColor, "#ffffff", "#FFD700", "#ffffff", tier.glowColor];
    const pts = Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: 50,
      y: 50,
      size: Math.random() * 8 + 4,
      color: colors[i % colors.length],
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14,
    }));
    setParticles(pts);
  }, [tier.glowColor]);

  // Animate particles
  useEffect(() => {
    let frame = 0;
    const animate = () => {
      frame++;
      setParticles((prev) =>
        prev.map((p) => ({
          ...p,
          x: p.x + p.vx * 0.9,
          y: p.y + p.vy * 0.9,
          vx: p.vx * 0.92,
          vy: p.vy * 0.92 + 0.15,
          size: Math.max(0, p.size - 0.08),
        }))
      );
      if (frame < 80) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Phase transitions: enter → hold → exit → onDone
  useEffect(() => {
    // enter for 300ms, hold for 2000ms, exit for 500ms
    timerRef.current = setTimeout(() => setPhase("hold"), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    if (phase === "hold") {
      timerRef.current = setTimeout(() => setPhase("exit"), 2000);
    } else if (phase === "exit") {
      timerRef.current = setTimeout(() => onDone(), 500);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, onDone]);

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: tier.bgGradient,
    transition: phase === "enter" ? "opacity 0.3s ease, transform 0.3s ease" : phase === "exit" ? "opacity 0.5s ease, transform 0.5s ease" : "none",
    opacity: phase === "hold" ? 1 : phase === "enter" ? 0 : 0,
    transform: phase === "hold" ? "scale(1)" : phase === "enter" ? "scale(0.95)" : "scale(1.05)",
    cursor: "pointer",
    userSelect: "none",
  };

  return (
    <div style={overlayStyle} onClick={onDone}>
      {/* Particle burst */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {particles.map((p) => (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              background: p.color,
              boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
              transform: "translate(-50%, -50%)",
              opacity: p.size > 1 ? 1 : 0,
            }}
          />
        ))}
      </div>

      {/* Glow ring behind animal */}
      <div style={{
        position: "absolute",
        width: 320,
        height: 320,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${tier.glowColor}33 0%, ${tier.glowColor}11 50%, transparent 70%)`,
        boxShadow: `0 0 80px 40px ${tier.glowColor}44`,
        animation: "pulse-glow 0.6s ease-in-out infinite alternate",
      }} />

      {/* Animal image or emoji */}
      {tier.imagePath ? (
        <img
          src={tier.imagePath}
          alt={tier.name}
          style={{
            width: Math.min(320, window.innerWidth - 48),
            height: Math.min(320, window.innerWidth - 48),
            objectFit: "contain",
            position: "relative",
            zIndex: 2,
            filter: `drop-shadow(0 0 24px ${tier.glowColor}) drop-shadow(0 0 48px ${tier.glowColor}88)`,
            animation: "animal-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          }}
        />
      ) : (
        <div style={{
          fontSize: 120,
          position: "relative",
          zIndex: 2,
          filter: `drop-shadow(0 0 24px ${tier.glowColor})`,
          animation: "animal-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          lineHeight: 1,
        }}>
          {tier.emoji}
        </div>
      )}

      {/* Tier label */}
      <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 16,
        fontSize: 32,
        fontWeight: 950,
        color: tier.glowColor,
        textShadow: `0 0 20px ${tier.glowColor}, 0 0 40px ${tier.glowColor}88`,
        letterSpacing: 3,
        fontFamily: "system-ui, sans-serif",
        animation: "label-pop 0.35s 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      }}>
        {tier.label}
      </div>

      {/* Deal won */}
      <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 10,
        fontSize: 18,
        fontWeight: 800,
        color: "#ffffff",
        textShadow: "0 2px 8px rgba(0,0,0,0.8)",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "0 24px",
        animation: "label-pop 0.35s 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      }}>
        {dealLabel}
      </div>

      {/* Tap to continue hint */}
      <div style={{
        position: "absolute",
        bottom: 40,
        fontSize: 13,
        color: "rgba(255,255,255,0.45)",
        fontFamily: "system-ui, sans-serif",
        fontWeight: 600,
        letterSpacing: 1,
        zIndex: 2,
      }}>
        Tap anywhere to continue
      </div>

      {/* CSS keyframes injected inline */}
      <style>{`
        @keyframes pulse-glow {
          from { transform: scale(0.95); opacity: 0.7; }
          to   { transform: scale(1.05); opacity: 1; }
        }
        @keyframes animal-bounce {
          0%   { transform: scale(0.3) translateY(40px); opacity: 0; }
          60%  { transform: scale(1.12) translateY(-8px); opacity: 1; }
          80%  { transform: scale(0.96) translateY(2px); }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes label-pop {
          0%   { transform: scale(0.5) translateY(10px); opacity: 0; }
          70%  { transform: scale(1.08) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
