"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type WheelItem = {
  label: string;
  weight: number;
};

type Props = {
  items: WheelItem[];
  size?: number; // wheel diameter in px

  /**
   * ✅ Called when the spin finishes.
   * label = winning slice label
   * extra = { code, spinId } if consume succeeded
   */
  onResult?: (
    label: string,
    extra?: { code?: string | null; spinId?: string | null }
  ) => void;

  // needed for payouts + attribution
  merchantId?: string;

  // ✅ needed for Stripe spin route + entitlement checks
  uid?: string;

  // ✅ spin price in cents (135, 200, 300, or 500); defaults to 135
  spinPriceCents?: number;

  // ✅ when true, this is a free boost spin (no Stripe charge, calls boost/consume instead)
  isFreeSpinBoost?: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Bright “Vegas” palette (cycles)
const COLORS = [
  "#FF4D6D",
  "#FFD93D",
  "#34D399",
  "#60A5FA",
  "#A78BFA",
  "#FB923C",
  "#22C55E",
  "#F472B6",
];

// ✅ price label is now dynamic (see spinPriceLabel() helper below)

// ✅ Background music (put the mp3 at: public/audio/renaissance.mp3)
const BG_MUSIC_SRC = "/audio/renaissance.mp3";

/** ---------------------------
 *  WebAudio (persistent + unlock)
 *  --------------------------- */
function getAudioContext(ref: React.MutableRefObject<AudioContext | null>): AudioContext {
  if (!ref.current) {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    ref.current = new AudioCtx();
  }
  return ref.current!;
}

async function unlockAudio(
  audioCtxRef: React.MutableRefObject<AudioContext | null>,
  unlockedRef: React.MutableRefObject<boolean>
) {
  const ctx = getAudioContext(audioCtxRef);

  if (ctx.state !== "running") {
    await ctx.resume();
  }

  // One-time "unlock blip" (Safari/iOS sometimes needs a scheduled sound)
  if (!unlockedRef.current) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 200;
    g.gain.value = 0.0001; // essentially silent

    o.connect(g).connect(ctx.destination);

    const t = ctx.currentTime;
    o.start(t);
    o.stop(t + 0.02);

    unlockedRef.current = true;
  }
}

function beep(
  ctx: AudioContext,
  opts: { freq: number; duration?: number; type?: OscillatorType; gain?: number }
) {
  const { freq, duration = 0.03, type = "square", gain = 0.05 } = opts;

  const o = ctx.createOscillator();
  const g = ctx.createGain();

  o.type = type;
  o.frequency.value = freq;

  const t = ctx.currentTime;
  // envelope to avoid pops
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + duration);
}

function playTick(ctx: AudioContext) {
  beep(ctx, { freq: 900, duration: 0.02, type: "square", gain: 0.03 });
}

function playWin(ctx: AudioContext) {
  // quick 2-note "ding"
  beep(ctx, { freq: 880, duration: 0.08, type: "sine", gain: 0.06 });

  const t = ctx.currentTime;
  const delay = 0.09;

  const o = ctx.createOscillator();
  const g = ctx.createGain();

  o.type = "sine";
  o.frequency.setValueAtTime(1320, t + delay);

  g.gain.setValueAtTime(0.0001, t + delay);
  g.gain.exponentialRampToValueAtTime(0.06, t + delay + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.12);

  o.connect(g).connect(ctx.destination);
  o.start(t + delay);
  o.stop(t + delay + 0.14);
}

/** ---------------------------
 *  Confetti (DOM based, no libs)
 *  --------------------------- */
function burstConfetti(container: HTMLElement, count = 80) {
  const rect = container.getBoundingClientRect();
  const originX = rect.width / 2;
  const originY = rect.height / 2;

  const confettiWrap = document.createElement("div");
  confettiWrap.style.position = "absolute";
  confettiWrap.style.inset = "0";
  confettiWrap.style.pointerEvents = "none";
  confettiWrap.style.overflow = "hidden";

  container.appendChild(confettiWrap);

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    const color = COLORS[i % COLORS.length];

    piece.style.position = "absolute";
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${10 + Math.random() * 14}px`;
    piece.style.background = color;
    piece.style.borderRadius = "2px";
    piece.style.opacity = "0.95";
    piece.style.transform = `translate(-50%, -50%) rotate(${
      Math.random() * 360
    }deg)`;

    const dx = (Math.random() - 0.5) * rect.width * 0.9;
    const dy = -rect.height * (0.35 + Math.random() * 0.35);
    const drift = (Math.random() - 0.5) * 120;

    const dur = 900 + Math.random() * 600;

    piece.animate(
      [
        { transform: `translate(-50%, -50%) rotate(0deg)`, offset: 0 },
        {
          transform: `translate(${dx}px, ${dy}px) rotate(360deg)`,
          offset: 0.55,
        },
        {
          transform: `translate(${dx + drift}px, ${
            rect.height + 80
          }px) rotate(820deg)`,
          offset: 1,
        },
      ],
      {
        duration: dur,
        easing: "cubic-bezier(.15,.85,.2,1)",
        fill: "forwards",
      }
    );

    confettiWrap.appendChild(piece);
  }

  setTimeout(() => confettiWrap.remove(), 1800);
}

/** ---------------------------
 *  Helpers: read current CSS rotation
 *  --------------------------- */
function getRotationDegFromElement(el: HTMLElement): number {
  const st = window.getComputedStyle(el);
  const tr = st.transform;
  if (!tr || tr === "none") return 0;

  const m = tr.match(/^matrix\((.+)\)$/);
  if (!m) {
    const m3 = tr.match(/^matrix3d\((.+)\)$/);
    if (!m3) return 0;
    const parts = m3[1].split(",").map((p) => parseFloat(p.trim()));
    const a = parts[0];
    const b = parts[1];
    const rad = Math.atan2(b, a);
    let deg = (rad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  const a = parts[0];
  const b = parts[1];
  const rad = Math.atan2(b, a);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

// Map cents to display label
function spinPriceLabel(cents: number | undefined): string {
  switch (cents) {
    case 200: return "$2.00";
    case 300: return "$3.00";
    case 500: return "$5.00";
    default:  return "$1.35";
  }
}

export default function Wheel({
  items,
  size = 420,
  onResult,
  merchantId,
  uid,
  spinPriceCents,
  isFreeSpinBoost = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // wrapper (scale only)
  const wheelWinWrapRef = useRef<HTMLDivElement | null>(null);

  // rotation element (rotate only)
  const wheelRotRef = useRef<HTMLDivElement | null>(null);

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winnerText, setWinnerText] = useState<string>("");

  // winner slice highlight
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);

  // sparkle shimmer
  const [sparkleKey, setSparkleKey] = useState(0);
  const [winAnimKey, setWinAnimKey] = useState(0);

  const spinningRef = useRef(false);

  // store winner until end
  const pendingWinnerRef = useRef<string | null>(null);
  const pendingWinnerIdxRef = useRef<number | null>(null);

  // WebAudio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  // tick tracking
  const lastSliceIdxRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // shimmer animation state
  const shimmerStartRef = useRef<number>(0);
  const shimmerRafRef = useRef<number | null>(null);

  const totalWeight = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.weight) || 0), 0),
    [items]
  );

  // ✅ payment gating (1 paid spin per verified Checkout session)
  const [payBusy, setPayBusy] = useState(false);
  const [paidSpinReady, setPaidSpinReady] = useState(false);
  const [payStatus, setPayStatus] = useState<string | null>(null);

  // ✅ store the verified sessionId so we can consume entitlement after spinning
  const [verifiedSessionId, setVerifiedSessionId] = useState<string | null>(
    null
  );
  // ✅ uid from the verified Stripe session (may differ from prop uid after page reload)
  const [verifiedUid, setVerifiedUid] = useState<string | null>(null);

  // ✅ store redemption info returned from consume
  const [redeemCode, setRedeemCode] = useState<string | null>(null);
  const [spinId, setSpinId] = useState<string | null>(null);

  // ✅ Background music refs/state (plays only on this component/screen)
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const [musicOn, setMusicOn] = useState(true);

  // ✅ Prize list overlay
  const [showPrizes, setShowPrizes] = useState(false);

  const startBgMusic = async () => {
    try {
      if (!musicOn) return;

      if (!bgAudioRef.current) {
        const a = new Audio(BG_MUSIC_SRC);
        a.loop = true;
        a.preload = "auto";
        a.volume = 0.18; // subtle
        bgAudioRef.current = a;
      }

      const a = bgAudioRef.current;

      // ensure correct volume/mute based on current state
      a.muted = !musicOn;
      a.volume = 0.18;

      // play may be blocked unless called from a user gesture (we call this from button handlers)
      await a.play();
    } catch {
      // ignore autoplay blocks; user can try again by clicking buttons
    }
  };

  const stopBgMusic = () => {
    try {
      const a = bgAudioRef.current;
      if (!a) return;
      a.pause();
      a.currentTime = 0;
    } catch {}
  };

  // ✅ Auto-start music on first user interaction with the page
  useEffect(() => {
    let started = false;

    const tryStart = async () => {
      if (started) return;
      started = true;
      await startBgMusic();
      document.removeEventListener("click", tryStart);
      document.removeEventListener("touchstart", tryStart);
      document.removeEventListener("keydown", tryStart);
    };

    document.addEventListener("click", tryStart, { once: true });
    document.addEventListener("touchstart", tryStart, { once: true });
    document.addEventListener("keydown", tryStart, { once: true });

    return () => {
      document.removeEventListener("click", tryStart);
      document.removeEventListener("touchstart", tryStart);
      document.removeEventListener("keydown", tryStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicOn]);

  // stop music when leaving wheel screen
  useEffect(() => {
    return () => {
      stopBgMusic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slice boundaries as degrees from TOP (0°=12 o'clock), increasing clockwise.
  const slices = useMemo(() => {
    if (!items.length || totalWeight <= 0) return [];

    let start = 0;
    return items.map((it, idx) => {
      const w = clamp(Number(it.weight) || 0, 0, 1e9);
      const deg = (w / totalWeight) * 360;
      const end = start + deg;
      const mid = (start + end) / 2;

      const slice = { idx, label: it.label ?? "", weight: w, start, end, mid };
      start = end;
      return slice;
    });
  }, [items, totalWeight]);

  const findSliceIndexAtPointer = (pointerDegFromTopClockwise: number) => {
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (
        pointerDegFromTopClockwise >= s.start &&
        pointerDegFromTopClockwise < s.end
      ) {
        return i;
      }
    }
    return slices.length ? slices.length - 1 : null;
  };

  const stopTickRAF = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  const startSliceTickRAF = () => {
    stopTickRAF();
    lastSliceIdxRef.current = null;

    const loop = () => {
      if (!spinningRef.current) return;

      const el = wheelRotRef.current;
      if (el && slices.length) {
        const rotNow = getRotationDegFromElement(el); // 0..360
        const pointerDeg = (360 - rotNow + 360) % 360;

        const idx = findSliceIndexAtPointer(pointerDeg);
        const prev = lastSliceIdxRef.current;

        if (idx !== null && idx !== prev) {
          lastSliceIdxRef.current = idx;

          try {
            const ctx = getAudioContext(audioCtxRef);
            if (ctx.state === "running") playTick(ctx);
          } catch {}
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);
  };

  /** Sparkle shimmer: animate a moving bright band clipped to the winning wedge */
  const stopShimmer = () => {
    if (shimmerRafRef.current !== null) {
      cancelAnimationFrame(shimmerRafRef.current);
      shimmerRafRef.current = null;
    }
  };

  const startShimmer = () => {
    stopShimmer();
    shimmerStartRef.current = performance.now();

    const step = () => {
      setSparkleKey((k) => k + 1);
      const elapsed = performance.now() - shimmerStartRef.current;

      if (elapsed < 900) shimmerRafRef.current = requestAnimationFrame(step);
      else shimmerRafRef.current = null;
    };

    shimmerRafRef.current = requestAnimationFrame(step);
  };

  // ✅ After Stripe returns, verify checkout session once
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get("session_id");
    if (!sessionId) return;

    (async () => {
      setPayBusy(true);
      setPayStatus("Verifying payment…");
      try {
        // IMPORTANT: verify route path must match your app/api structure
        const res = await fetch("/api/stripe/spin/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok)
          throw new Error(data?.error ?? "Payment not verified");

        // ✅ allow exactly 1 spin after verified payment
        setPaidSpinReady(true);
        setVerifiedSessionId(sessionId);
        // ✅ store the uid from the session record so consume uses the right uid
        // even if anonymous auth re-generated a different uid on this page load
        if (data.uid) setVerifiedUid(data.uid);
        setPayStatus("✅ Payment verified — spin now!");

        // clean URL (removes session_id)
        sp.delete("session_id");
        const next = sp.toString();
        const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}`;
        window.history.replaceState({}, "", newUrl);
      } catch (e: any) {
        setPayStatus(e?.message ?? "Payment verify failed.");
        setPaidSpinReady(false);
        setVerifiedSessionId(null);
      } finally {
        setPayBusy(false);
      }
    })();
  }, []);

  // Draw wheel to canvas
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
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 10;

    // outer base + glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
    ctx.fillStyle = "#0B0B0F";
    ctx.shadowColor = "rgba(255, 217, 61, 0.35)";
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.restore();

    // base circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();

    if (!slices.length) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
      ctx.fillStyle = "#f3f4f6";
      ctx.fill();
      return;
    }

    // top-based clockwise degrees -> canvas radians
    const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

    // Draw slices
    for (const s of slices) {
      const a0 = toRad(s.start);
      const a1 = toRad(s.end);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius - 6, a0, a1);
      ctx.closePath();
      ctx.fillStyle = COLORS[s.idx % COLORS.length];
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // text
      const mid = toRad(s.mid);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const displayLabel = (s.label || "").length > 8 ? (s.label || "").slice(0, 8) + "\u2026" : (s.label || "");
      // draw text in the outer 45% of the slice only (from 55% radius to edge)
      ctx.fillText(displayLabel, radius - 18, 0);

      ctx.restore();
    }

    // Winning slice overlay (full wedge lit)
    if (winnerIdx !== null && slices[winnerIdx]) {
      const s = slices[winnerIdx];
      const a0 = toRad(s.start);
      const a1 = toRad(s.end);

      // bright translucent fill
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius - 6, a0, a1);
      ctx.closePath();

      const grad = ctx.createRadialGradient(cx, cy, 30, cx, cy, radius - 6);
      grad.addColorStop(0, "rgba(255,217,61,0.14)");
      grad.addColorStop(0.55, "rgba(255,217,61,0.26)");
      grad.addColorStop(1, "rgba(255,255,255,0.08)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // neon rim glow
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 9, a0, a1);
      ctx.strokeStyle = "rgba(255,217,61,0.95)";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(255,217,61,0.9)";
      ctx.shadowBlur = 28;
      ctx.stroke();
      ctx.restore();

      // crisp white rim
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 9, a0, a1);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // Sparkle shimmer sweep (clipped to wedge)
      const elapsed = performance.now() - shimmerStartRef.current;
      if (elapsed >= 0 && elapsed <= 900) {
        const p = clamp(elapsed / 900, 0, 1);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius - 6, a0, a1);
        ctx.closePath();
        ctx.clip();

        const mid = toRad(s.mid);
        ctx.translate(cx, cy);
        ctx.rotate(mid);

        const r0 = 40 + p * (radius - 70);
        const bandW = 26;

        const band = ctx.createLinearGradient(r0 - bandW, 0, r0 + bandW, 0);
        band.addColorStop(0, "rgba(255,255,255,0)");
        band.addColorStop(0.45, "rgba(255,255,255,0.35)");
        band.addColorStop(0.5, "rgba(255,255,255,0.85)");
        band.addColorStop(0.55, "rgba(255,255,255,0.35)");
        band.addColorStop(1, "rgba(255,255,255,0)");

        ctx.fillStyle = band;
        ctx.globalCompositeOperation = "screen";
        ctx.fillRect(
          r0 - bandW,
          -(radius - 10),
          bandW * 2,
          (radius - 10) * 2
        );

        // tiny sparkles
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 8; i++) {
          const rr = r0 + (Math.random() - 0.5) * 40;
          const yy = (Math.random() - 0.5) * 60;
          ctx.beginPath();
          ctx.arc(rr, yy, 1.2 + Math.random() * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.fill();
        }

        ctx.restore();
      }
    }

    // inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, Math.PI * 2);
    ctx.fillStyle = "#0B0B0F";
    ctx.fill();

    // center button
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.font = "900 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SPIN", cx, cy);
  }, [size, slices, winnerIdx, sparkleKey]);

  function pickWeightedIndex() {
    const r = Math.random() * totalWeight;
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      acc += clamp(Number(items[i].weight) || 0, 0, 1e9);
      if (r < acc) return i;
    }
    return Math.max(0, items.length - 1);
  }

  // ✅ create checkout + redirect (uses your server route)
  async function payForSpin() {
    // ✅ start background music on user gesture
    await startBgMusic();

    setPayBusy(true);
    setPayStatus(null);

    if (!merchantId) {
      setPayBusy(false);
      setPayStatus("Missing merchantId on wheel.");
      return;
    }
    if (!uid) {
      setPayBusy(false);
      setPayStatus("Missing uid (sign-in required).");
      return;
    }

    // ✅ Free boost spin path — no Stripe charge, just grant entitlement directly
    if (isFreeSpinBoost) {
      try {
        const res = await fetch("/api/boost/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantId, uid }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Could not claim free spin");
        // Grant entitlement so spin() can proceed
        setPaidSpinReady(true);
        setVerifiedSessionId(data.sessionId ?? "free-boost-" + Date.now());
        setPayStatus(null);
      } catch (e: any) {
        setPayStatus(e?.message ?? "Could not claim free spin.");
      } finally {
        setPayBusy(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/stripe/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, uid, spinPriceCents: spinPriceCents ?? 135 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not start checkout");
      if (!data?.url) throw new Error("Missing checkout url");

      window.location.href = data.url;
    } catch (e: any) {
      setPayStatus(e?.message ?? "Checkout failed.");
    } finally {
      setPayBusy(false);
    }
  }

  const spin = async () => {
    // ✅ start background music on user gesture (if not already playing)
    await startBgMusic();

    if (spinningRef.current) return;
    if (!slices.length) return;

    // ✅ require verified entitlement
    if (!paidSpinReady || !verifiedSessionId) {
      setPayStatus(`Pay ${spinPriceLabel(spinPriceCents)} to spin.`);
      return;
    }

    try {
      await unlockAudio(audioCtxRef, audioUnlockedRef);
    } catch {}

    setWinnerText("");
    setRedeemCode(null);
    setSpinId(null);
    setWinnerIdx(null);

    setSpinning(true);
    spinningRef.current = true;

    const winnerIndex = pickWeightedIndex();
    const winner = slices[winnerIndex];
    const winnerLabel = winner?.label ?? "Unknown";

    pendingWinnerRef.current = winnerLabel;
    pendingWinnerIdxRef.current = winnerIndex;

    // Winner.mid under TOP pointer:
    // R mod 360 = 360 - winner.mid
    const winnerMid = winner.mid;
    const desiredMod = (360 - winnerMid + 360) % 360;

    startSliceTickRAF();

    setRotation((prev) => {
      const prevMod = ((prev % 360) + 360) % 360;
      const delta = (desiredMod - prevMod + 360) % 360;

      const fullSpins = 6;
      const nudge = (Math.random() - 0.5) * 3;

      return prev + fullSpins * 360 + delta + nudge;
    });
  };

  const onSpinEnd = async () => {
    if (!spinningRef.current) return;

    setSpinning(false);
    spinningRef.current = false;
    stopTickRAF();

    const resLabel = pendingWinnerRef.current;
    const idx = pendingWinnerIdxRef.current;

    pendingWinnerRef.current = null;
    pendingWinnerIdxRef.current = null;

    if (!resLabel) return;

    setWinnerText(`🎉 You won: ${resLabel}`);

    // play win sound
    try {
      const ctx = getAudioContext(audioCtxRef);
      if (ctx.state === "running") playWin(ctx);
    } catch {}

    // visuals
    if (wrapRef.current) burstConfetti(wrapRef.current, 90);
    if (typeof idx === "number") setWinnerIdx(idx);

    setWinAnimKey((k) => k + 1);
    shimmerStartRef.current = performance.now();
    startShimmer();

    // ✅ consume entitlement on server + create spin record + code
    // lock out additional spins immediately (one entitlement = one spin)
    setPaidSpinReady(false);

    try {
      if (!merchantId) throw new Error("Missing merchantId");
      // ✅ prefer verifiedUid (from the Stripe session record) over the prop uid.
      // Anonymous auth can re-generate a new uid on page reload after Stripe redirect,
      // which would cause a 'User mismatch' error in the consume route.
      const effectiveUid = verifiedUid ?? uid;
      if (!effectiveUid) throw new Error("Missing uid");
      if (!verifiedSessionId) throw new Error("Missing sessionId");

      const consumeRes = await fetch(isFreeSpinBoost ? "/api/boost/consume" : "/api/spins/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isFreeSpinBoost
            ? { merchantId, uid: effectiveUid, prizeLabel: resLabel, finalize: true }
            : { sessionId: verifiedSessionId, merchantId, uid: effectiveUid, prizeLabel: resLabel }
        ),
      });

      const consumeData = await consumeRes.json().catch(() => ({}));
      if (!consumeRes.ok)
        throw new Error(consumeData?.error ?? "Failed to finalize spin");

      const nextSpinId = consumeData?.spinId ?? null;
      const nextCode = consumeData?.code ?? null;

      setSpinId(nextSpinId);
      setRedeemCode(nextCode);
      setPayStatus("✅ Spin saved. Show your code to redeem!");
      setVerifiedSessionId(null); // prevent reuse
      setVerifiedUid(null); // clear verified uid after use

      // ✅ notify parent so you can show ONE unified code + QR in WheelDealsClient
      onResult?.(resLabel, { code: nextCode, spinId: nextSpinId });
    } catch (e: any) {
      setPayStatus(
        e?.message ?? "Spin finalize failed. Please contact support."
      );
    }
  };

  useEffect(() => {
    return () => {
      stopTickRAF();
      stopShimmer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fancyContainerStyle: React.CSSProperties = {
    position: "relative",
    width: size,
    height: size,
    display: "grid",
    placeItems: "center",
    filter: spinning ? "drop-shadow(0 0 18px rgba(255,217,61,0.25))" : "none",
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        display: "grid",
        gap: 14,
        justifyItems: "center",
        padding: 16,
        borderRadius: 18,
        background:
          "radial-gradient(1200px 500px at 50% -20%, rgba(255,217,61,0.15), transparent 45%), linear-gradient(180deg, rgba(17,24,39,0.04), rgba(255,255,255,1))",
      }}
    >
      {/* Title / winner */}
      <div style={{ textAlign: "center" }}>
        {/* Colored title + glow */}
        <div
          style={{
            position: "relative",
            display: "inline-block",
            padding: "6px 12px",
            borderRadius: 14,
          }}
        >
          {/* glow behind */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: -10,
              borderRadius: 18,
              background:
                "radial-gradient(circle at 35% 40%, rgba(255,217,61,0.28), transparent 55%), radial-gradient(circle at 70% 55%, rgba(37,99,235,0.22), transparent 58%)",
              filter: "blur(10px)",
              opacity: 0.95,
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 1,
              fontWeight: 1000,
              letterSpacing: 0.4,
              fontSize: 16,
              textTransform: "uppercase",
              lineHeight: 1,
              textShadow:
                "0 10px 30px rgba(0,0,0,0.10), 0 0 18px rgba(255,217,61,0.18), 0 0 18px rgba(37,99,235,0.14)",
            }}
          >
            <span style={{ color: "rgb(234,179,8)" }}>Wheel</span>{" "}
            <span style={{ color: "rgb(37,99,235)" }}>Deals</span>
          </div>
        </div>

        <div
          style={{
            minHeight: 22,
            marginTop: 8,
            fontWeight: 800,
            color: winnerText ? "#111" : "rgba(17,17,17,0.55)",
          }}
        >
          {winnerText || (spinning ? "Spinning..." : "Spin to win a deal")}
        </div>

        {redeemCode && (
          <div style={{ marginTop: 8, fontWeight: 900, letterSpacing: 1 }}>
            Code: <span style={{ userSelect: "all" }}>{redeemCode}</span>
          </div>
        )}

        {payStatus && (
          <div style={{ marginTop: 8, fontWeight: 800, opacity: 0.85 }}>
            {payStatus}
          </div>
        )}

        {spinId && (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
            Spin ID: {spinId}
          </div>
        )}
      </div>

      {/* ✅ "Tap to enlarge prizes" hint */}
      <button
        onClick={() => setShowPrizes(true)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 800,
          opacity: 0.65,
          color: "#111",
          padding: "2px 6px",
          marginTop: -6,
          letterSpacing: 0.2,
          textDecoration: "underline dotted",
        }}
      >
        Tap here to see prizes
      </button>

      {/* ✅ Prize enlarger overlay */}
      {showPrizes && (
        <div
          onClick={() => setShowPrizes(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(255,255,255,0.97)",
              borderRadius: 22,
              padding: "20px 18px",
              maxWidth: 360,
              width: "100%",
              boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 950, fontSize: 17 }}>Prize List</div>
              <button
                onClick={() => setShowPrizes(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 22,
                  cursor: "pointer",
                  lineHeight: 1,
                  color: "#555",
                  padding: "2px 6px",
                }}
              >
                ×
              </button>
            </div>

            {/* Prize rows */}
            {items.map((item, idx) => {
              const pct = totalWeight > 0
                ? ((Number(item.weight) / totalWeight) * 100).toFixed(1)
                : "0.0";
              const color = ["#FF4D6D","#FFD93D","#34D399","#60A5FA","#A78BFA","#FB923C","#22C55E","#F472B6"][idx % 8];
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, fontWeight: 900, fontSize: 15 }}>{item.label}</div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 13,
                      color: "#6b7280",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pct}% chance
                  </div>
                </div>
              );
            })}

            <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textAlign: "center" }}>
              Tap anywhere outside to close
            </div>
          </div>
        </div>
      )}

      {/* Wheel + pointer */}
      <div
        style={{ ...fancyContainerStyle, cursor: "pointer" }}
        onClick={() => setShowPrizes(true)}
        title="Tap to see prizes"
      >
        {/* Pointer triangle (points UP) */}
        <div
          style={{
            position: "absolute",
            top: -2,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "12px solid transparent",
            borderRight: "12px solid transparent",
            borderTop: "22px solid #111",
            zIndex: 5,
            filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.18))",
          }}
        />

        {/* neon dot on pointer */}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "rgba(255,217,61,0.9)",
            boxShadow: "0 0 18px rgba(255,217,61,0.75)",
            zIndex: 6,
            animation: "wdPulse 1.2s ease-in-out infinite",
          }}
        />

        {/* Win wrapper */}
        <div
          ref={wheelWinWrapRef}
          key={winAnimKey}
          style={{
            width: size,
            height: size,
            display: "grid",
            placeItems: "center",
            animation:
              !spinning && winAnimKey > 0
                ? "wdWinPop 760ms cubic-bezier(0.16, 0.9, 0.2, 1)"
                : "none",
          }}
        >
          {/* Rotation element */}
          <div
            ref={wheelRotRef}
            style={{
              width: size,
              height: size,
              transform: `rotate(${rotation}deg)`,
              transition: spinning
                ? "transform 4.2s cubic-bezier(0.12, 0.88, 0.1, 1)"
                : "transform 0.2s ease-out",
            }}
            onTransitionEnd={onSpinEnd}
            onClick={(e) => e.stopPropagation()}
          >
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {!paidSpinReady ? (
          <button
            onClick={payForSpin}
            disabled={payBusy}
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.12)",
              background: payBusy
                ? "linear-gradient(180deg, #f3f4f6, #fff)"
                : "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
              cursor: payBusy ? "not-allowed" : "pointer",
              fontWeight: 900,
              letterSpacing: 0.2,
              color: "#111",
              boxShadow: payBusy
                ? "none"
                : "0 12px 30px rgba(0,0,0,0.12), 0 0 20px rgba(255,217,61,0.22)",
            }}
          >
            {payBusy ? (isFreeSpinBoost ? "Claiming free spin…" : "Opening checkout…") : (isFreeSpinBoost ? "🔥 Claim Free Spin" : `Pay ${spinPriceLabel(spinPriceCents)} to spin`)}
          </button>
        ) : (
          <button
            onClick={spin}
            disabled={spinning || !slices.length}
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.12)",
              background: spinning
                ? "linear-gradient(180deg, #f3f4f6, #fff)"
                : "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
              cursor: spinning ? "not-allowed" : "pointer",
              fontWeight: 900,
              letterSpacing: 0.2,
              color: "#111",
              boxShadow: spinning
                ? "none"
                : "0 12px 30px rgba(0,0,0,0.12), 0 0 20px rgba(255,217,61,0.22)",
            }}
          >
            {spinning ? "Spinning..." : `Spin (${spinPriceLabel(spinPriceCents)})`}
          </button>
        )}

        {/* ✅ Music toggle */}
        <button
          onClick={async () => {
            const next = !musicOn;
            setMusicOn(next);

            try {
              // if turning ON, start music (user gesture)
              if (next) {
                await startBgMusic();
              } else {
                stopBgMusic();
              }
            } catch {}
          }}
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(180deg, #f3f4f6, #fff)",
            cursor: "pointer",
            fontWeight: 900,
            opacity: 0.95,
          }}
        >
          {musicOn ? "🔊 Music on" : "🔇 Music off"}
        </button>
      </div>

      {/* Disclaimer line (replaces checkbox gating) */}
      <div
        style={{
          marginTop: 6,
          fontSize: 12,
          fontWeight: 800,
          opacity: 0.7,
          textAlign: "center",
          maxWidth: 520,
          lineHeight: 1.35,
        }}
      >
        By spinning, you agree all spins are final. No cash value. Must be 18+.
      </div>

      <style>{`
        @keyframes wdPulse {
          0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.9; }
          50% { transform: translateX(-50%) scale(1.25); opacity: 1; }
        }

        @keyframes wdWinPop {
          0%   { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,217,61,0)); }
          35%  { transform: scale(1.055); filter: drop-shadow(0 0 22px rgba(255,217,61,0.28)); }
          65%  { transform: scale(0.995); filter: drop-shadow(0 0 28px rgba(255,217,61,0.22)); }
          100% { transform: scale(1); filter: drop-shadow(0 0 18px rgba(255,217,61,0.16)); }
        }
      `}</style>
    </div>
  );
}
