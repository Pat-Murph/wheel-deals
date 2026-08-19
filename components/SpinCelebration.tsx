"use client";

/**
 * SpinCelebration
 * ---------------
 * Full-screen overlay that pops up for ~2.8 seconds when the wheel lands.
 * The beast shown is determined by the winning slice's weight (probability).
 * Each rarity tier contains multiple beasts — one is randomly selected per unlock.
 *
 * RARITY TIERS  (weight = share of total wheel weight, i.e. probability)
 * ─────────────────────────────────────────────────────────────────────────
 * Legendary   < 1 %     — rarest beasts
 * Ultra Rare  1–1.99 %  — very special
 * Very Rare   2–4.99 %  — special
 * Rare        5–9.99 %  — exciting
 * Uncommon   10–24.99 %  — nice
 * Solid      25–49.99 %  — good
 * Common     50–100 %    — standard
 */

import React, { useEffect, useRef, useState } from "react";

export type Beast = {
  id: string;
  name: string;
  emoji: string;
  imagePath: string;
};

export type RarityTier = {
  id: string;
  label: string;
  minWeightPct: number;
  maxWeightPct: number;
  bgGradient: string;
  glowColor: string;
  beasts: Beast[];
};

const beast = (id: string, name: string, emoji: string): Beast => ({
  id,
  name,
  emoji,
  imagePath: `/animals/${id}-chains.webp`,
});

export const RARITY_TIERS: RarityTier[] = [
  {
    id: "legendary", label: "LEGENDARY UNLOCK!", minWeightPct: 0, maxWeightPct: 0.99,
    bgGradient: "linear-gradient(135deg, #1a0000 0%, #3d0000 50%, #1a0000 100%)", glowColor: "#ff2200",
    beasts: [
      beast("dragon", "Infernox", "🐉"), beast("demon-lord", "Hellrend", "👹"),
      beast("hydra", "Venomspew", "🐍"), beast("bone-dragon", "Deathwyrm", "💀"),
      beast("thunder-god", "Stormborn", "⚡"), beast("celestial-angel", "Divinewrath", "👼"),
      beast("void-walker", "Oblivion", "🌑"), beast("chaos-knight", "Riftbreaker", "🌀"),
    ],
  },
  {
    id: "ultra-rare", label: "ULTRA RARE UNLOCK!", minWeightPct: 1, maxWeightPct: 1.99,
    bgGradient: "linear-gradient(135deg, #1a0a00 0%, #4d1a00 50%, #1a0a00 100%)", glowColor: "#ff6600",
    beasts: [
      beast("phoenix", "Emberwing", "🔥"), beast("chimera", "Triflame", "🦁"),
      beast("valkyrie", "Brightblade", "⚔️"), beast("serpent-king", "Coilstrike", "🐍"),
      beast("storm-dragon", "Tempestclaw", "🐉"), beast("dark-samurai", "Oniblader", "⚔️"),
      beast("fire-giant", "Surtr", "🔥"), beast("ancient-sphinx", "Goldriddle", "🦁"),
      beast("phoenix-queen", "Emberstorm", "🔥"), beast("hellhound", "Cerberus", "🐕"),
    ],
  },
  {
    id: "very-rare", label: "VERY RARE UNLOCK!", minWeightPct: 2, maxWeightPct: 4.99,
    bgGradient: "linear-gradient(135deg, #000d1a 0%, #001a3d 50%, #000d1a 100%)", glowColor: "#0099ff",
    beasts: [
      beast("eagle", "Skypiercer", "🦅"), beast("griffin", "Talon Rex", "🦅"),
      beast("thunder-hawk", "Voltstrike", "⚡"), beast("ice-golem", "Glacius", "🧊"),
      beast("kitsune", "Sakura", "🦊"), beast("jade-dragon", "Emeraldscale", "🐉"),
      beast("kraken", "Abyssal", "🐙"), beast("plasma-wolf", "Neonhowl", "🐺"),
      beast("death-knight", "Doomguard", "⚔️"), beast("shadow-assassin", "Phantomblade", "🗡️"),
      beast("lava-titan", "Magmacrusher", "🌋"), beast("dark-paladin", "Doomsworn", "⚔️"),
      beast("bone-reaper", "Soulharvest", "💀"), beast("necromancer", "Gravecaller", "💀"),
      beast("ice-witch", "Frostweaver", "❄️"),
    ],
  },
  {
    id: "rare", label: "RARE UNLOCK!", minWeightPct: 5, maxWeightPct: 9.99,
    bgGradient: "linear-gradient(135deg, #1a0d00 0%, #3d2000 50%, #1a0d00 100%)", glowColor: "#ff8800",
    beasts: [
      beast("tiger", "Voltclaw", "🐆"), beast("shadow-panther", "Voidfang", "🐆"),
      beast("dark-elf", "Shadowveil", "🗡️"), beast("fairy-queen", "Frostbane", "❄️"),
      beast("fox-enchantress", "Crimsonveil", "🦊"), beast("snow-leopard", "Frostpaw", "🐆"),
      beast("shadow-cat", "Nightshade", "🐈‍⬛"), beast("serpent-dancer", "Venomcharm", "🐍"),
      beast("wolf-queen", "Moonhowl", "🐺"), beast("tiger-empress", "Amberclaw", "🐯"),
      beast("blood-elf", "Scarletmage", "🧝"), beast("moon-elf", "Lunarblade", "🌙"),
      beast("storm-witch", "Tempestra", "⚡"), beast("shadow-wizard", "Voidcaster", "🧙"),
      beast("frost-elf", "Glacialblade", "❄️"), beast("dark-ranger", "Shadowarrow", "🏹"),
      beast("death-moth", "Gravewing", "🦋"),
    ],
  },
  {
    id: "uncommon", label: "UNCOMMON UNLOCK!", minWeightPct: 10, maxWeightPct: 24.99,
    bgGradient: "linear-gradient(135deg, #0d0d1a 0%, #1a1a3d 50%, #0d0d1a 100%)", glowColor: "#9966ff",
    beasts: [
      beast("wolf", "Spirithowl", "🐺"), beast("werewolf", "Bloodmaw", "🐺"),
      beast("harpy", "Stormscreech", "🦅"), beast("forest-sprite", "Thornroot", "🌿"),
      beast("scorpion-warlord", "Venomstrike", "🦂"), beast("frost-bear", "Glacialmaw", "🐻"),
      beast("raven-lord", "Darkwing", "🐦‍⬛"), beast("rhino-tank", "Ironhorn", "🦏"),
      beast("spider-queen", "Webweaver", "🕷️"), beast("blood-wolf", "Crimsonmaw", "🐺"),
      beast("crystal-golem", "Amethyst", "💎"), beast("siren", "Abyssong", "🧜"),
      beast("war-fairy", "Thornsting", "🧚"), beast("ember-fairy", "Sparkblaze", "🧚"),
      beast("poison-fairy", "Toxicbloom", "🧚"), beast("berserker-viking", "Ragnar", "⚔️"),
      beast("wild-druid", "Oakfury", "🌿"), beast("inferno-fox", "Helltail", "🦊"),
      beast("gargoyle", "Stonewake", "🗿"), beast("warg-rider", "Packleader", "🐺"),
    ],
  },
  {
    id: "solid", label: "SOLID UNLOCK!", minWeightPct: 25, maxWeightPct: 49.99,
    bgGradient: "linear-gradient(135deg, #0d1a00 0%, #1a3d00 50%, #0d1a00 100%)", glowColor: "#44cc00",
    beasts: [
      beast("bull", "Ironcharge", "🐂"), beast("minotaur", "Ironhoof", "🐂"),
      beast("centaur", "Goldstrike", "🐴"), beast("shark-berserker", "Bloodfin", "🦈"),
      beast("bat-lord", "Nightfang", "🦇"), beast("croc-hunter", "Swampjaw", "🐊"),
      beast("storm-ram", "Thunderhorn", "🐏"), beast("viper-assassin", "Fangstrike", "🐍"),
      beast("doom-stag", "Shadowrack", "🦌"), beast("blood-hawk", "Crimsonwing", "🦅"),
      beast("iron-dwarf", "Forgehammer", "⚒️"), beast("stone-dwarf", "Magmabeard", "⚒️"),
      beast("shadow-fox", "Duskfang", "🦊"), beast("magma-drake", "Cinderjaw", "🐉"),
      beast("war-elephant", "Titanstep", "🐘"),
    ],
  },
  {
    id: "common", label: "UNLOCKED!", minWeightPct: 50, maxWeightPct: 100,
    bgGradient: "linear-gradient(135deg, #0a0a1a 0%, #1a1000 40%, #2a1800 100%)", glowColor: "#F4B400",
    beasts: [
      beast("gorilla", "Thunderfist", "🦍"), beast("orc", "Skullcrusher", "👹"),
      beast("goblin-shaman", "Hexclaw", "🧙"), beast("mermaid", "Riptide", "🧜"),
      beast("iron-boar", "Tuskbreaker", "🐗"), beast("plague-rat", "Rotfang", "🐀"),
      beast("flame-stallion", "Hellrider", "🐴"), beast("nightmare-horse", "Dreadmane", "🐴"),
      beast("mantis-blade", "Scytheclaw", "🦗"), beast("sand-wurm", "Dunebreaker", "🪱"),
      beast("mountain-troll", "Bouldersmash", "🧌"), beast("goblin-king", "Grimecrown", "👑"),
      beast("acid-toad", "Toxicroak", "🐸"), beast("cursed-pirate", "Deadtide", "🏴‍☠️"),
      beast("thunder-ape", "Stormfist", "🦍"),
    ],
  },
];

/**
 * Beast assets load only when selected. This avoids downloading the entire
 * 100-image collection on every wheel-page visit while keeping the short
 * celebration timing unchanged.
 */

/** Pick the right rarity tier for a given slice weight percentage */
export function getRarityTier(sliceWeightPct: number): RarityTier {
  for (const tier of RARITY_TIERS) {
    if (sliceWeightPct >= tier.minWeightPct && sliceWeightPct <= tier.maxWeightPct) {
      return tier;
    }
  }
  return RARITY_TIERS[RARITY_TIERS.length - 1];
}

/** Pick a random beast from the matching rarity tier */
export function getRandomBeast(sliceWeightPct: number): { tier: RarityTier; beast: Beast } {
  const tier = getRarityTier(sliceWeightPct);
  const beast = tier.beasts[Math.floor(Math.random() * tier.beasts.length)];
  return { tier, beast };
}

// Legacy export for backward compatibility
export type AnimalTier = {
  id: string;
  name: string;
  emoji: string;
  imagePath: string | null;
  minWeightPct: number;
  maxWeightPct: number;
  label: string;
  bgGradient: string;
  glowColor: string;
};

export const ANIMAL_TIERS: AnimalTier[] = RARITY_TIERS.map((t) => ({
  id: t.beasts[0].id,
  name: t.beasts[0].name,
  emoji: t.beasts[0].emoji,
  imagePath: t.beasts[0].imagePath,
  minWeightPct: t.minWeightPct,
  maxWeightPct: t.maxWeightPct,
  label: t.label,
  bgGradient: t.bgGradient,
  glowColor: t.glowColor,
}));

export function getAnimalTier(sliceWeightPct: number): AnimalTier {
  const { tier, beast } = getRandomBeast(sliceWeightPct);
  return {
    id: beast.id,
    name: beast.name,
    emoji: beast.emoji,
    imagePath: beast.imagePath,
    minWeightPct: tier.minWeightPct,
    maxWeightPct: tier.maxWeightPct,
    label: tier.label,
    bgGradient: tier.bgGradient,
    glowColor: tier.glowColor,
  };
}

type Props = {
  /** Slice weight as a percentage of total wheel weight (0–100) */
  sliceWeightPct: number;
  /** The deal label that was won */
  dealLabel: string;
  /** Preselected Beast, used when a post-unlock share card needs to match the celebration exactly */
  selectedBeast?: { tier: RarityTier; beast: Beast };
  /** Called when the overlay finishes and should be dismissed */
  onDone: () => void;
};

export default function SpinCelebration({ sliceWeightPct, dealLabel, selectedBeast, onDone }: Props) {
  // Use the preselected Beast when supplied; otherwise choose one once on mount.
  const fallbackPick = useRef(getRandomBeast(sliceWeightPct));
  const { tier, beast } = selectedBeast ?? fallbackPick.current;

  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("hold");
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

  // Phase transitions: hold → exit → onDone
  useEffect(() => {
    if (phase === "hold") {
      timerRef.current = setTimeout(() => setPhase("exit"), 2400);
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
    transition: phase === "exit" ? "opacity 0.5s ease" : "none",
    opacity: phase === "exit" ? 0 : 1,
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

      {/* Glow ring behind beast */}
      <div style={{
        position: "absolute",
        width: 320,
        height: 320,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${tier.glowColor}33 0%, ${tier.glowColor}11 50%, transparent 70%)`,
        boxShadow: `0 0 80px 40px ${tier.glowColor}44`,
        animation: "pulse-glow 0.6s ease-in-out infinite alternate",
      }} />

      {/* Beast image */}
      <img
        src={beast.imagePath}
        alt={beast.name}
        style={{
          width: Math.min(320, typeof window !== "undefined" ? window.innerWidth - 48 : 320),
          height: Math.min(320, typeof window !== "undefined" ? window.innerWidth - 48 : 320),
          objectFit: "contain",
          position: "relative",
          zIndex: 2,
          filter: `drop-shadow(0 0 24px ${tier.glowColor}) drop-shadow(0 0 48px ${tier.glowColor}88)`,
          animation: "animal-bounce 0.25s ease-out forwards",
        }}
      />

      {/* Beast name */}
      <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 8,
        fontSize: 22,
        fontWeight: 950,
        color: "#ffffff",
        textShadow: `0 0 12px ${tier.glowColor}, 0 2px 8px rgba(0,0,0,0.8)`,
        letterSpacing: 2,
        fontFamily: "system-ui, sans-serif",
        textTransform: "uppercase",
      }}>
        {beast.name}
      </div>

      {/* Rarity label */}
      <div style={{
        position: "relative",
        zIndex: 2,
        marginTop: 6,
        fontSize: 28,
        fontWeight: 950,
        color: tier.glowColor,
        textShadow: `0 0 20px ${tier.glowColor}, 0 0 40px ${tier.glowColor}88`,
        letterSpacing: 3,
        fontFamily: "system-ui, sans-serif",
        animation: "label-pop 0.2s ease-out forwards",
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
        animation: "label-pop 0.2s ease-out forwards",
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
          0%   { transform: scale(0.85); }
          50%  { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        @keyframes label-pop {
          0%   { transform: scale(0.85); }
          60%  { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
