"use client";
export const dynamic = "force-dynamic";
// app/merchant/page.tsx


import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  User,
  deleteUser,
} from "firebase/auth";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { app, getDb } from "../../lib/firebase";
import { blockAnonAuth, fullSignOut } from "../../lib/auth";
import {
  getMerchantDaily,
  getMerchantName,
  lastNDaysKeysLocal,
  todayKeyLocal,
  ytdKeysLocal,
  getMerchantMonthDailyMap,
  type MerchantDailyStat,
} from "../../lib/merchantStats";


type MerchantDoc = {
  name?: string;
  about?: string;
  photoUrls?: string[];
  active?: boolean;
  ownerUid?: string;
  stripeAccountId?: string;
  // Founding tier
  foundingMerchant?: boolean;
  foundingNumber?: number;
  // Boost / free deal fields
  boostActive?: boolean;
  boostFreeSpinsRemaining?: number;
  boostWheelPriceCents?: number;
  boostPurchasedAt?: string;
  boostMode?: 'checkin' | 'always';
  // Mobile
  isMobile?: boolean;
  // Wheels
  wheels?: Array<{ spinPriceCents: number; items: Array<{ label: string; weight: number }> }>;
  wheel?: Array<{ label: string; weight: number }>;
};

function getFoundingTier(n?: number): { icon: string; label: string; color: string } | null {
  if (!n) return null;
  if (n <= 20)  return { icon: "💎", label: "Diamond",  color: "#0ea5e9" };
  if (n <= 100) return { icon: "🏆", label: "Platinum", color: "#d97706" };
  if (n <= 300) return { icon: "🥇", label: "Gold",     color: "#ca8a04" };
  if (n <= 1000) return { icon: "🥈", label: "Silver",  color: "#64748b" };
  return null;
}

function moneyFromCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function ymLabel(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function parseDateKeyToLocalDate(dateKey: string) {
  // dateKey is YYYY-MM-DD
  const [y, m, d] = dateKey.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function sumRevenueCents(stats: { spinsCount?: number; revenueCents?: number }[]) {
  // Use stored revenueCents (accurate per-tier payout) — no flat fallback
  return stats.reduce((c, s) => c + Number(s.revenueCents ?? 0), 0);
}

/* ---------------- UI helpers ---------------- */
function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.10)",
    borderRadius: 14,
    background: "white",
    padding: 14,
    boxShadow: "0 18px 60px rgba(0,0,0,0.06)",
  };
}

function btnPrimary(disabled?: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 950,
    cursor: disabled ? "not-allowed" : "pointer",
    background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
    boxShadow: disabled ? "none" : "0 12px 30px rgba(0,0,0,0.12)",
    opacity: disabled ? 0.7 : 1,
  };
}

function btnSecondary(disabled?: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    background: "linear-gradient(180deg, #f3f4f6, #fff)",
    opacity: disabled ? 0.7 : 1,
  };
}

function btnDanger(disabled?: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(239,68,68,0.30)",
    fontWeight: 950,
    cursor: disabled ? "not-allowed" : "pointer",
    background: "linear-gradient(180deg, rgba(239,68,68,0.12), rgba(255,255,255,1))",
    color: "#b91c1c",
    opacity: disabled ? 0.7 : 1,
  };
}

function pill(text: string, tone: "green" | "gray" | "yellow" = "gray") {
  const bg =
    tone === "green"
      ? "rgba(34,197,94,0.16)"
      : tone === "yellow"
      ? "rgba(255,217,61,0.20)"
      : "rgba(0,0,0,0.06)";
  const fg = tone === "green" ? "#0a7a2a" : "#111";
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 950,
        border: "1px solid rgba(0,0,0,0.10)",
      }}
    >
      {text}
    </span>
  );
}

/* ---------------- QR Scanner ----------------
   Uses html5-qrcode (install: npm i html5-qrcode)
------------------------------------------------ */
function QrScanner(props: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const mountId = "wd-qr-reader";
  const qrRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!props.open) return;

      // dynamic import so it never touches SSR
      const mod = await import("html5-qrcode");
      if (cancelled) return;

      const Html5Qrcode = mod.Html5Qrcode;
      const qr = new Html5Qrcode(mountId);
      qrRef.current = qr;

      try {
        // Prefer back camera when available
        await qr.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            aspectRatio: 1,
          },
          (decodedText: string) => {
            const code = String(decodedText || "").trim();
            if (!code) return;
            props.onCode(code);
            props.onClose();
          },
          () => {
            // ignore scan errors to keep camera running
          }
        );
      } catch (e) {
        console.error("QR start failed", e);
      }
    }

    async function stop() {
      const qr = qrRef.current;
      if (!qr) return;
      try {
        await qr.stop();
      } catch {}
      try {
        await qr.clear();
      } catch {}
      qrRef.current = null;
    }

    if (props.open) start();
    else stop();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div style={{ ...card(), width: "min(520px, 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Scan QR code</div>
          <button onClick={props.onClose} style={btnSecondary(false)}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
          Point the camera at the customer’s QR. It will auto-fill the code.
        </div>

        <div
          id={mountId}
          style={{
            marginTop: 12,
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
        />
      </div>
    </div>
  );
}

export default function MerchantDashboardPage() {
  useEffect(() => {
    blockAnonAuth().catch(() => {});
  }, []);

  const auth = useMemo(() => getAuth(app), []);
  const [user, setUser] = useState<User | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<MerchantDoc | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Stats
  const [spinsToday, setSpinsToday] = useState(0);
  const [spins7d, setSpins7d] = useState(0);
  const [spins30d, setSpins30d] = useState(0);
  const [revenue30dCents, setRevenue30dCents] = useState(0);
  const [spinsYtd, setSpinsYtd] = useState(0);
  const [revenueYtdCents, setRevenueYtdCents] = useState(0);
  const [redemptionsYtd, setRedemptionsYtd] = useState(0);
  const [redemptions30d, setRedemptions30d] = useState(0);

  // Calendar month data
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [monthKeys, setMonthKeys] = useState<string[]>([]);
  const [monthMap, setMonthMap] = useState<Record<string, MerchantDailyStat>>({});
  const [monthLoading, setMonthLoading] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(todayKeyLocal());

  // Redeem
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Boost
  const [boostWheelPriceCents, setBoostWheelPriceCents] = useState<number>(135);
  const [boostMode, setBoostMode] = useState<'checkin' | 'always'>('checkin');
  const [boostBusy, setBoostBusy] = useState(false);

  /* ---------- AUTH ---------- */
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u?.isAnonymous) setUser(null);
      else setUser(u);
    });
  }, [auth]);

  async function doLogin() {
    setBusy(true);
    setStatus(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: any) {
      setStatus(e?.message ?? "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  async function doResetPassword() {
    const trimmed = resetEmail.trim() || email.trim();
    if (!trimmed) {
      setResetStatus("Please enter your email address.");
      return;
    }
    setResetBusy(true);
    setResetStatus(null);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setResetStatus("Password reset email sent! Check your inbox (and spam folder).");
    } catch (e: any) {
      setResetStatus(e?.message ?? "Failed to send reset email.");
    } finally {
      setResetBusy(false);
    }
  }

  async function doLogout() {
    await fullSignOut();
    setUser(null);
    setMerchant(null);
    setMerchantId(null);
    setMerchantName(null);

    setSpinsToday(0);
    setSpins7d(0);
    setSpins30d(0);
    setRevenue30dCents(0);
    setSpinsYtd(0);
    setRevenueYtdCents(0);
    setRedemptionsYtd(0);
    setRedemptions30d(0);

    setMonthKeys([]);
    setMonthMap({});
    setSelectedDateKey(todayKeyLocal());

    setRedeemCode("");
    setRedeemMsg(null);
    setScannerOpen(false);
  }

  /* ---------- LOAD MERCHANT ---------- */
  async function reloadMerchant(mid: string) {
    const mSnap = await getDoc(doc(getDb(), "merchants", mid));
    setMerchant(mSnap.exists() ? (mSnap.data() as MerchantDoc) : null);
  }

  useEffect(() => {
    if (!user) return;

    (async () => {
      setBusy(true);
      setStatus(null);

      try {
        const userSnap = await getDoc(doc(getDb(), "users", user.uid));
        const mid = userSnap.exists() ? (userSnap.data() as any)?.merchantId : null;
        if (!mid) return;

        setMerchantId(mid);

        await reloadMerchant(mid);

        const name = await getMerchantName(mid);
        setMerchantName(name);

        // Today
        const today = todayKeyLocal();
        const t = await getMerchantDaily(mid, today);
        setSpinsToday(t.spinsCount ?? 0);

        // 7 days
        const keys7 = lastNDaysKeysLocal(7);
        const stats7 = await Promise.all(keys7.map((k) => getMerchantDaily(mid, k)));
        setSpins7d(stats7.reduce((s, d) => s + (d.spinsCount ?? 0), 0));

        // 30 days
        const keys30 = lastNDaysKeysLocal(30);
        const stats30 = await Promise.all(keys30.map((k) => getMerchantDaily(mid, k)));
        const spins30 = stats30.reduce((s, d) => s + (d.spinsCount ?? 0), 0);
        setSpins30d(spins30);
        setRevenue30dCents(sumRevenueCents(stats30));

        // YTD
        const keysY = ytdKeysLocal();
        const statsY = await Promise.all(keysY.map((k) => getMerchantDaily(mid, k)));
        const spinsY = statsY.reduce((s, d) => s + (d.spinsCount ?? 0), 0);
        setSpinsYtd(spinsY);
        setRevenueYtdCents(sumRevenueCents(statsY));

        // Redemptions (count spins with status=redeemed)
        try {
          const ytdStart = `${new Date().getFullYear()}-01-01`;
          const ytdEnd = todayKeyLocal();
          const redeemedYtdSnap = await getDocs(
            query(
              collection(getDb(), "spins"),
              where("merchantId", "==", mid),
              where("status", "==", "redeemed"),
              where("dateKey", ">=", ytdStart),
              where("dateKey", "<=", ytdEnd)
            )
          );
          setRedemptionsYtd(redeemedYtdSnap.size);

          const days30Start = lastNDaysKeysLocal(30).at(-1) ?? ytdStart;
          const redeemedSnap30 = await getDocs(
            query(
              collection(getDb(), "spins"),
              where("merchantId", "==", mid),
              where("status", "==", "redeemed"),
              where("dateKey", ">=", days30Start),
              where("dateKey", "<=", ytdEnd)
            )
          );
          setRedemptions30d(redeemedSnap30.size);
        } catch {
          // Non-fatal — redemption count unavailable
        }
      } catch (e: any) {
        setStatus(e?.message ?? "Failed loading merchant stats.");
      } finally {
        setBusy(false);
      }
    })();
  }, [user]);

  /* ---------- CALENDAR LOAD (month query) ---------- */
  useEffect(() => {
    if (!merchantId) return;

    (async () => {
      setMonthLoading(true);
      try {
        const year = monthCursor.getFullYear();
        const month = monthCursor.getMonth(); // 0-based
        const { keys, map } = await getMerchantMonthDailyMap(merchantId, year, month);
        setMonthKeys(keys);
        setMonthMap(map);

        // If selected day isn't in this month, default to first day of month
        if (selectedDateKey) {
          const sd = parseDateKeyToLocalDate(selectedDateKey);
          if (sd.getFullYear() !== year || sd.getMonth() !== month) {
            setSelectedDateKey(keys[0] ?? null);
          }
        } else {
          setSelectedDateKey(keys[0] ?? null);
        }
      } catch (e: any) {
        setStatus(e?.message ?? "Could not load month stats.");
        setMonthKeys([]);
        setMonthMap({});
      } finally {
        setMonthLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, monthCursor]);

  /* ---------- STRIPE ---------- */
  async function connectStripe() {
    if (!merchantId || !user) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/stripe/connect/create-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, ownerUid: user.uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not create Stripe link");
      window.location.href = data.url;
    } catch (e: any) {
      setStatus(e?.message ?? "Stripe connect failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!merchantId) return;
    const params = new URLSearchParams(window.location.search);
    const stripeFlag = params.get("stripe");
    if (stripeFlag === "return" || stripeFlag === "refresh") {
      reloadMerchant(merchantId).catch(() => {});
    }
    // Handle boost return
    if (params.get("boost_success") === "1") {
      reloadMerchant(merchantId).catch(() => {});
      setStatus("🔥 Boost activated! You have 10 free deals ready. Your listing now shows a fire badge.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("boost_error")) {
      setStatus(`❌ Boost payment failed: ${params.get("boost_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [merchantId]);

  async function purchaseBoost() {
    if (!merchantId || !user) return;
    setBoostBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/stripe/boost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, uid: user.uid, boostWheelPriceCents, boostMode: merchant?.isMobile ? boostMode : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not create boost checkout");
      window.location.href = data.url;
    } catch (e: any) {
      setStatus(e?.message ?? "Boost purchase failed.");
    } finally {
      setBoostBusy(false);
    }
  }

  /* ---------- CONTROLS ---------- */
  async function toggleActive() {
    if (!merchantId || !merchant) return;
    const next = !merchant.active;
    setBusy(true);
    setStatus(null);
    try {
      await updateDoc(doc(getDb(), "merchants", merchantId), { active: next });
      setMerchant((m) => (m ? { ...m, active: next } : m));
    } catch (e: any) {
      setStatus(e?.message ?? "Could not update status (rules?).");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMerchantAccount() {
    if (!merchantId || !user) return;
    const ok = confirm(
      "This will permanently delete your merchant, dashboard access, and account.\n\nThis CANNOT be undone. Continue?"
    );
    if (!ok) return;

    setBusy(true);
    try {
      await deleteDoc(doc(getDb(), "merchants", merchantId));
      await deleteDoc(doc(getDb(), "users", user.uid));
      await deleteUser(user);
      await fullSignOut();
    } catch (e: any) {
      alert(e?.message ?? "Could not delete account.");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- REDEEM ---------- */
  function normalizeCode(s: string) {
    // Keep it forgiving: trim + upper. (If your codes are case-sensitive, remove .toUpperCase())
    return String(s || "").trim().toUpperCase();
  }

  async function redeemByCode(raw: string) {
    if (!merchantId) return;
    const code = normalizeCode(raw);
    if (!code) {
      setRedeemMsg("Enter a code first.");
      return;
    }

    setRedeemBusy(true);
    setRedeemMsg(null);

    try {
      // Find the spin for THIS merchant + code
      const qRef = query(
        collection(getDb(), "spins"),
        where("merchantId", "==", merchantId),
        where("code", "==", code),
        limit(1)
      );

      const snap = await getDocs(qRef);
      if (snap.empty) {
        setRedeemMsg("❌ Invalid code for this merchant.");
        return;
      }

      const spinDoc = snap.docs[0];
      const data = spinDoc.data() as any;

      if (data.status === "redeemed") {
        setRedeemMsg("⚠️ This code was already redeemed.");
        return;
      }
      if (data.status !== "issued") {
        setRedeemMsg(`⚠️ This code is not redeemable (status: ${String(data.status)}).`);
        return;
      }

      // Optional expiry check (client-side convenience)
      const exp = data.expiresAt?.toDate?.() ? data.expiresAt.toDate() : null;
      if (exp && Date.now() > exp.getTime()) {
        setRedeemMsg("❌ This code is expired.");
        return;
      }

      // Redeem (one-time). Rules should allow merchant staff.
      // If your rules currently require ALL fields unchanged, this may fail with permissions.
      // Recommended rules: allow updating only status + redeemedAt.
      await updateDoc(doc(getDb(), "spins", spinDoc.id), {
        status: "redeemed",
        redeemedAt: serverTimestamp(),
      });

      // ✅ Increment daily redemptionsCount so conversion rate stays accurate
      try {
        const dayKey = data.dateKey ?? todayKeyLocal();
        const dailyRef = doc(getDb(), "merchantStats", merchantId, "daily", dayKey);
        await updateDoc(dailyRef, { redemptionsCount: increment(1) });
        // Also bump local state so conversion card updates immediately
        setRedemptionsYtd((n) => n + 1);
        setRedemptions30d((n) => n + 1);
      } catch {
        // Non-fatal — stat increment failed silently
      }

      setRedeemMsg(`✅ Customer gained! Deal: ${data.prizeLabel ?? "—"}`);
      setRedeemCode("");
    } catch (e: any) {
      console.error(e);
      setRedeemMsg(e?.message ?? "❌ Could not redeem (permissions/rules?).");
    } finally {
      setRedeemBusy(false);
    }
  }

  /* ---------- UI ---------- */
  if (!user) {
    return (
      <main style={{ padding: "14px 14px 40px", maxWidth: 600, margin: "0 auto", boxSizing: "border-box", width: "100%" }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 1000 }}>Merchant Sign In</h1>

        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <input
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
          />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
          />
          <button onClick={doLogin} disabled={busy} style={btnPrimary(busy)}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <button
            onClick={() => { setShowForgot(true); setResetEmail(email); setResetStatus(null); }}
            style={{ background: "none", border: "none", color: "#E08A00", fontWeight: 700, cursor: "pointer", fontSize: 14, textAlign: "center", padding: "4px 0" }}
          >
            Forgot password?
          </button>
        </div>

        {showForgot && (
          <div style={{ marginTop: 16, padding: 16, borderRadius: 12, border: "2px solid #F59E0B", background: "#FFFBEB" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>Reset Password</h3>
            <p style={{ margin: "0 0 12px", fontSize: 14, opacity: 0.8 }}>Enter your email and we'll send you a link to reset your password.</p>
            <input
              placeholder="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={doResetPassword} disabled={resetBusy} style={{ ...btnPrimary(resetBusy), flex: 1 }}>
                {resetBusy ? "Sending…" : "Send Reset Link"}
              </button>
              <button
                onClick={() => setShowForgot(false)}
                style={{ flex: 0, padding: "10px 16px", borderRadius: 12, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                Cancel
              </button>
            </div>
            {resetStatus && (
              <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14, padding: 10, borderRadius: 8, background: resetStatus.includes("sent") ? "#D1FAE5" : "#FEE2E2" }}>
                {resetStatus}
              </div>
            )}
          </div>
        )}

        {status && (
          <div style={{ marginTop: 12, fontWeight: 850, padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.04)" }}>
            {status}
          </div>
        )}
      </main>
    );
  }

  if (!merchant || !merchantId) {
    return (
      <main style={{ padding: "14px 14px 40px", maxWidth: 600, margin: "0 auto", boxSizing: "border-box", width: "100%" }}>
        <h2 style={{ margin: 0 }}>No merchant linked</h2>
        <div style={{ marginTop: 8, opacity: 0.75, fontWeight: 800 }}>
          If you just created a merchant, make sure <code>/users/{`{uid}`}.merchantId</code> exists.
        </div>
        <div style={{ marginTop: 12 }}>
          <a href="/merchant/onboard" style={{ ...btnPrimary(false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Create merchant →
          </a>
        </div>
      </main>
    );
  }

  const stripeConnected = !!merchant.stripeAccountId;

  // Calendar rendering helpers
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDayDow = new Date(year, month, 1).getDay(); // 0=Sun..6
  const padDays = firstDayDow;

  const selectedStat = selectedDateKey ? monthMap[selectedDateKey] : undefined;
  const selectedRevenueCents = selectedStat?.revenueCents ?? 0;

  return (
    <main style={{ padding: "14px 14px 40px", display: "grid", gap: 14, maxWidth: 600, margin: "0 auto", boxSizing: "border-box", width: "100%", overflowX: "hidden" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ fontSize: 26, fontWeight: 1000, lineHeight: 1.2 }}>Merchant Dashboard</div>
          <a
            href="/discover"
            style={{ fontWeight: 950, textDecoration: "none", color: "#111", fontSize: 14, whiteSpace: "nowrap", paddingTop: 4 }}
          >
            ← Discover
          </a>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          <strong style={{ fontSize: 15 }}>{merchantName}</strong>
          {merchant.active ? pill("Live", "green") : pill("Paused", "gray")}
          {(() => {
            const tier = getFoundingTier(merchant.foundingNumber);
            return tier ? (
              <span style={{
                fontSize: 11,
                fontWeight: 900,
                color: tier.color,
                background: tier.color + "18",
                border: `1px solid ${tier.color}44`,
                borderRadius: 999,
                padding: "2px 8px",
                letterSpacing: 0.2,
              }}>
                {tier.icon} {tier.label} Founding #{merchant.foundingNumber}
              </span>
            ) : null;
          })()}

          {busy && <span style={{ opacity: 0.7, fontWeight: 800, fontSize: 12 }}>Loading…</span>}
        </div>
      </div>

      {status && (
        <div style={{ fontWeight: 850, padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.04)" }}>
          {status}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button onClick={toggleActive} disabled={busy} style={{ ...btnSecondary(busy), width: "100%" }}>
          {merchant.active ? "Pause" : "Go live"}
        </button>
        <a
          href="/merchant/onboard"
          style={{ ...btnSecondary(false), textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", boxSizing: "border-box" }}
        >
          Edit merchant
        </a>
        <button onClick={doLogout} style={{ ...btnSecondary(false), width: "100%" }}>
          Sign out
        </button>
        <button onClick={deleteMerchantAccount} style={{ ...btnDanger(busy), width: "100%" }} disabled={busy}>
          Delete account
        </button>
      </div>

      {/* Redeem (manual + QR scan) */}
      <div style={card()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Redeem a customer code</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setScannerOpen(true)} style={btnSecondary(false)}>
              Scan QR (camera)
            </button>
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
          Enter the code or scan the QR. Once redeemed, it can’t be used again.
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "1fr" }}>
          <input
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value)}
            placeholder="Enter code (ex: A1B2C3)"
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              fontSize: 16,
              fontWeight: 850,
              letterSpacing: 0.5,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") redeemByCode(redeemCode);
            }}
          />

          <button onClick={() => redeemByCode(redeemCode)} disabled={redeemBusy} style={{ ...btnPrimary(redeemBusy), width: "100%" }}>
            {redeemBusy ? "Redeeming…" : "Redeem"}
          </button>
        </div>

        {redeemMsg && (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: redeemMsg.startsWith("✅")
                ? "1px solid rgba(34,197,94,0.30)"
                : redeemMsg.startsWith("⚠️")
                ? "1px solid rgba(255,155,61,0.30)"
                : "1px solid rgba(239,68,68,0.30)",
              background: redeemMsg.startsWith("✅")
                ? "rgba(34,197,94,0.10)"
                : redeemMsg.startsWith("⚠️")
                ? "rgba(255,155,61,0.10)"
                : "rgba(239,68,68,0.08)",
              fontWeight: 900,
            }}
          >
            {redeemMsg}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72, fontWeight: 800 }}>
          If you see “Missing or insufficient permissions” here, it means the current user is not recognized as staff
          for this merchant, or your unlocks update rule is too strict for updating only <code>status</code>.
        </div>
      </div>

      <QrScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCode={(code) => {
          const cleaned = code.trim();
          setRedeemCode(cleaned);
          setRedeemMsg(`Scanned: ${cleaned}`);
          // Optional auto-redeem:
          // redeemByCode(cleaned);
        }}
      />

      {/* Stripe */}
      <div style={card()}>
        <div style={{ fontWeight: 950 }}>Stripe payouts</div>
        <div style={{ marginTop: 6, opacity: 0.82, fontWeight: 850 }}>
          Status: {stripeConnected ? "✅ Connected" : "❌ Not connected"}
          {stripeConnected && (
            <div
              style={{
                marginTop: 4,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                opacity: 0.7,
                wordBreak: "break-all",
              }}
            >
              {merchant.stripeAccountId}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <button onClick={connectStripe} disabled={busy} style={btnSecondary(busy)}>
            {stripeConnected ? "Finish / Re-open Stripe onboarding" : "Connect Stripe"}
          </button>
        </div>

         <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
          Note: Even after connecting, Stripe may require onboarding to enable payouts.
        </div>
      </div>

      {/* Free Deal Boost */}
      <div style={{ ...card(), border: merchant.boostActive ? "2px solid #f97316" : "1px solid rgba(0,0,0,0.10)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 950, fontSize: 16 }}>
          <span style={{ fontSize: 22 }}>🔥</span>
          Free Deal Boost
          {merchant.boostActive && (
            <span style={{ marginLeft: 4, background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 900 }}>
              ACTIVE — {merchant.boostFreeSpinsRemaining ?? 0} deals left
            </span>
          )}
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
          Pay <b>$5.00</b> to unlock <b>10 free deals</b> on a wheel of your choice.
          Your listing gets a <b>fire badge</b> and appears at the top of the Discover page
          (sorted by proximity to each customer). Customers must be within <b>200 meters</b> of your store to claim the free deal — driving foot traffic directly to you.
        </div>

        {merchant.boostActive ? (
          <div style={{ marginTop: 10, padding: "10px 14px", background: "#fff7ed", borderRadius: 10, fontSize: 13, fontWeight: 800, color: "#c2410c" }}>
            Boost is active! Once all {10} free deals are claimed, your listing returns to normal. Purchase another boost anytime.
            {merchant.isMobile && merchant.boostMode && (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#92400e" }}>
                Mode: {merchant.boostMode === 'always' ? '25-mile radius (always available)' : 'Check-in only (200m proximity)'}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Choose which wheel to unlock for free deals:</div>
            <select
              value={boostWheelPriceCents}
              onChange={(e) => setBoostWheelPriceCents(Number(e.target.value))}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, fontWeight: 800, background: "#fff" }}
            >
              {/* Show wheels the merchant has configured */}
              {(merchant.wheels && merchant.wheels.length > 0 ? merchant.wheels : [
                { spinPriceCents: merchant.wheel && merchant.wheel.length > 0 ? 135 : 135 }
              ]).map((w: { spinPriceCents: number }) => (
                <option key={w.spinPriceCents} value={w.spinPriceCents}>
                  ${(w.spinPriceCents / 100).toFixed(2)} wheel
                </option>
              ))}
            </select>

            {/* Boost mode selector for mobile merchants */}
            {merchant.isMobile && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Free deal availability:</div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 10, border: boostMode === 'checkin' ? "2px solid #f97316" : "1px solid #ddd", background: boostMode === 'checkin' ? "#fff7ed" : "#fff", cursor: "pointer" }}>
                  <input type="radio" name="boostMode" value="checkin" checked={boostMode === 'checkin'} onChange={() => setBoostMode('checkin')} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>Check-in only (200m proximity)</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Free deals only available when you are checked in. Customers must be within 200 meters of your check-in location.</div>
                  </div>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 10, border: boostMode === 'always' ? "2px solid #f97316" : "1px solid #ddd", background: boostMode === 'always' ? "#fff7ed" : "#fff", cursor: "pointer" }}>
                  <input type="radio" name="boostMode" value="always" checked={boostMode === 'always'} onChange={() => setBoostMode('always')} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>25-mile radius (always available)</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Free deals available to all customers within 25 miles of your service area at all times, even when not checked in.</div>
                  </div>
                </label>
              </div>
            )}

            <button
              onClick={purchaseBoost}
              disabled={boostBusy}
              style={{ ...btnPrimary(boostBusy), display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {boostBusy ? "Redirecting to payment…" : "🔥 Unlock 10 Free Deals — $5.00"}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
        <Stat title="Unlocks today" value={String(spinsToday)} />
        <Stat title="Unlocks (7 days)" value={String(spins7d)} />
        <Stat title="Unlocks (30 days)" value={String(spins30d)} />
        <Stat title="Revenue (30 days)" value={moneyFromCents(revenue30dCents)} />
        <Stat title="Unlocks (YTD)" value={String(spinsYtd)} />
        <Stat title="Revenue (YTD)" value={moneyFromCents(revenueYtdCents)} />
      </div>

      {/* Customer Conversion Rate */}
      <div style={{ ...card(), background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)", border: "1px solid #86efac" }}>
        <div style={{ fontWeight: 1000, fontSize: 16, color: "#15803d", marginBottom: 8 }}>
          👥 Customer Conversion
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "white", borderRadius: 12, padding: "12px 14px", border: "1px solid #bbf7d0" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#166534", opacity: 0.8 }}>Customers Gained (30d)</div>
            <div style={{ fontSize: 26, fontWeight: 1000, color: "#15803d" }}>{redemptions30d}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginTop: 2 }}>
              out of {spins30d} unlocks
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 12, padding: "12px 14px", border: "1px solid #bbf7d0" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#166534", opacity: 0.8 }}>Conversion Rate (30d)</div>
            <div style={{ fontSize: 26, fontWeight: 1000, color: "#15803d" }}>
              {spins30d > 0 ? `${Math.round((redemptions30d / spins30d) * 100)}%` : "—"}
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginTop: 2 }}>deals redeemed in store</div>
          </div>
          <div style={{ background: "white", borderRadius: 12, padding: "12px 14px", border: "1px solid #bbf7d0" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#166534", opacity: 0.8 }}>Customers Gained (YTD)</div>
            <div style={{ fontSize: 26, fontWeight: 1000, color: "#15803d" }}>{redemptionsYtd}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginTop: 2 }}>
              out of {spinsYtd} unlocks
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 12, padding: "12px 14px", border: "1px solid #bbf7d0" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#166534", opacity: 0.8 }}>Conversion Rate (YTD)</div>
            <div style={{ fontSize: 26, fontWeight: 1000, color: "#15803d" }}>
              {spinsYtd > 0 ? `${Math.round((redemptionsYtd / spinsYtd) * 100)}%` : "—"}
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginTop: 2 }}>deals redeemed in store</div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "#166534", opacity: 0.75, lineHeight: 1.5 }}>
          Every redeemed deal = a real customer who walked into your store.
        </div>
      </div>

      {/* Calendar */}
      <div style={{ ...card(), padding: "14px 8px" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 1000, fontSize: 16 }}>Daily unlocks calendar</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
            <button
              onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              style={{ ...btnSecondary(monthLoading), padding: "8px 14px" }}
              disabled={monthLoading}
            >
              ←
            </button>
            <div style={{ fontWeight: 950, flex: 1, textAlign: "center", fontSize: 15 }}>{ymLabel(monthCursor)}</div>
            <button
              onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              style={{ ...btnSecondary(monthLoading), padding: "8px 14px" }}
              disabled={monthLoading}
            >
              →
            </button>
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
          Click a day to see totals.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 3,
            marginTop: 12,
            fontSize: 10,
            fontWeight: 950,
            opacity: 0.75,
          }}
        >
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
            <div key={w} style={{ textAlign: "center" }}>
              {w}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 3,
            marginTop: 4,
          }}
        >
          {Array.from({ length: padDays }).map((_, i) => (
            <div key={`pad-${i}`} style={{ borderRadius: 8, background: "rgba(0,0,0,0.03)", aspectRatio: "1" }} />
          ))}

          {monthKeys.map((dateKey) => {
            const d = parseDateKeyToLocalDate(dateKey);
            const dayNum = d.getDate();
            const s = monthMap[dateKey];
            const spins = s?.spinsCount ?? 0;

            const revCents = s?.revenueCents ?? 0;

            const isSelected = selectedDateKey === dateKey;
            const isToday = todayKeyLocal() === dateKey;

            return (
              <button
                key={dateKey}
                onClick={() => setSelectedDateKey(dateKey)}
                style={{
                  borderRadius: 8,
                  border: isSelected ? "2px solid rgba(255,155,61,0.95)" : "1px solid rgba(0,0,0,0.10)",
                  background: isToday ? "rgba(34,197,94,0.10)" : isSelected ? "rgba(255,217,61,0.18)" : "white",
                  cursor: "pointer",
                  padding: "5px 3px",
                  textAlign: "center",
                  boxShadow: isSelected ? "0 4px 12px rgba(0,0,0,0.10)" : "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  minHeight: 60,
                }}
                title={`${dateKey} • Unlocks: ${spins} • Revenue: ${moneyFromCents(revCents)}`}
              >
                <div style={{ fontWeight: 1000, fontSize: 13, lineHeight: 1 }}>
                  {dayNum}{isToday ? " •" : ""}
                </div>
                <div style={{ fontSize: 9, fontWeight: 950, opacity: 0.8, lineHeight: 1 }}>
                  {spins}u
                </div>
                <div style={{ fontSize: 9, fontWeight: 900, opacity: 0.65, lineHeight: 1 }}>
                  {moneyFromCents(revCents)}
                </div>
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "rgba(0,0,0,0.03)",
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 950 }}>
            Selected day:{" "}
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {selectedDateKey ?? "(none)"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontWeight: 850 }}>
            <span>Unlocks: {selectedStat?.spinsCount ?? 0}</span>
            <span>Revenue: {moneyFromCents(selectedRevenueCents)}</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat(props: { title: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.10)",
        borderRadius: 14,
        padding: 14,
        background: "white",
      }}
    >
      <div style={{ fontWeight: 900, opacity: 0.7 }}>{props.title}</div>
      <div style={{ fontSize: 24, fontWeight: 1000 }}>{props.value}</div>
    </div>
  );
}
