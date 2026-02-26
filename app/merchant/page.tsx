// app/merchant/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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
} from "firebase/firestore";
import { app, db } from "../../lib/firebase";
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

const REVENUE_CENTS_PER_SPIN = 70; // ✅ keep merchant revenue at $0.70 per spin
const DAILY_LIMIT = 3;

type MerchantDoc = {
  name?: string;
  about?: string;
  photoUrls?: string[];
  active?: boolean;
  ownerUid?: string;
  stripeAccountId?: string;
};

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
  // Prefer stored revenueCents if present; otherwise fallback to spins * 70c
  const centsStored = stats.reduce((c, s) => c + Number(s.revenueCents ?? 0), 0);
  if (centsStored > 0) return centsStored;

  const spins = stats.reduce((s, d) => s + Number(d.spinsCount ?? 0), 0);
  return spins * REVENUE_CENTS_PER_SPIN;
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

    setMonthKeys([]);
    setMonthMap({});
    setSelectedDateKey(todayKeyLocal());

    setRedeemCode("");
    setRedeemMsg(null);
    setScannerOpen(false);
  }

  /* ---------- LOAD MERCHANT ---------- */
  async function reloadMerchant(mid: string) {
    const mSnap = await getDoc(doc(db, "merchants", mid));
    setMerchant(mSnap.exists() ? (mSnap.data() as MerchantDoc) : null);
  }

  useEffect(() => {
    if (!user) return;

    (async () => {
      setBusy(true);
      setStatus(null);

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
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
  }, [merchantId]);

  /* ---------- CONTROLS ---------- */
  async function toggleActive() {
    if (!merchantId || !merchant) return;
    const next = !merchant.active;
    setBusy(true);
    setStatus(null);
    try {
      await updateDoc(doc(db, "merchants", merchantId), { active: next });
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
      await deleteDoc(doc(db, "merchants", merchantId));
      await deleteDoc(doc(db, "users", user.uid));
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
        collection(db, "spins"),
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
      await updateDoc(doc(db, "spins", spinDoc.id), {
        status: "redeemed",
        redeemedAt: serverTimestamp(),
      });

      setRedeemMsg(`✅ Redeemed! Prize: ${data.prizeLabel ?? "—"}`);
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
      <main style={{ padding: 24, maxWidth: 520 }}>
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
        </div>

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
      <main style={{ padding: 24 }}>
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
  const selectedRevenueCents =
    selectedStat && (selectedStat.revenueCents ?? 0) > 0
      ? selectedStat.revenueCents
      : (selectedStat?.spinsCount ?? 0) * REVENUE_CENTS_PER_SPIN;

  return (
    <main style={{ padding: 24, display: "grid", gap: 14, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 30, fontWeight: 1000 }}>Merchant Dashboard</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ fontSize: 16 }}>{merchantName}</strong>
            {merchant.active ? pill("Live", "green") : pill("Paused", "gray")}
            <span style={{ fontSize: 12, opacity: 0.75, fontWeight: 850 }}>
              Limit: {DAILY_LIMIT} spins/day per customer
            </span>
            {busy && <span style={{ opacity: 0.7, fontWeight: 800 }}>Loading…</span>}
          </div>
        </div>
      </div>

      {status && (
        <div style={{ fontWeight: 850, padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.04)" }}>
          {status}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={toggleActive} disabled={busy} style={btnSecondary(busy)}>
          {merchant.active ? "Pause merchant" : "Go live"}
        </button>

        {/* NOTE:
            Your current "Edit merchant" points to onboarding, which is typically CREATE.
            If you have (or will make) an edit page, change href to /merchant/edit
        */}
        <a
          href="/merchant/onboard"
          style={{
            ...btnSecondary(false),
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Edit merchant →
        </a>

        <button onClick={deleteMerchantAccount} style={btnDanger(busy)} disabled={busy}>
          Delete account
        </button>

        <button onClick={doLogout} style={btnSecondary(false)}>
          Sign out
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

        <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "1fr auto" }}>
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

          <button onClick={() => redeemByCode(redeemCode)} disabled={redeemBusy} style={btnPrimary(redeemBusy)}>
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
          for this merchant, or your spins update rule is too strict for updating only <code>status</code>.
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
            <span
              style={{
                marginLeft: 8,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                opacity: 0.8,
              }}
            >
              ({merchant.stripeAccountId})
            </span>
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

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
        <Stat title="Spins today" value={String(spinsToday)} />
        <Stat title="Revenue today" value={moneyFromCents(spinsToday * REVENUE_CENTS_PER_SPIN)} />

        <Stat title="Spins (7 days)" value={String(spins7d)} />
        <Stat title="Revenue (7 days)" value={moneyFromCents(spins7d * REVENUE_CENTS_PER_SPIN)} />

        <Stat title="Spins (30 days)" value={String(spins30d)} />
        <Stat title="Revenue (30 days)" value={moneyFromCents(revenue30dCents)} />

        <Stat title="Spins (YTD)" value={String(spinsYtd)} />
        <Stat title="Revenue (YTD)" value={moneyFromCents(revenueYtdCents)} />
      </div>

      {/* Calendar */}
      <div style={card()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 1000, fontSize: 16 }}>Daily spins calendar</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              style={btnSecondary(monthLoading)}
              disabled={monthLoading}
            >
              ←
            </button>

            <div style={{ fontWeight: 950, minWidth: 180, textAlign: "center" }}>{ymLabel(monthCursor)}</div>

            <button
              onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              style={btnSecondary(monthLoading)}
              disabled={monthLoading}
            >
              →
            </button>
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
          Click a day to see totals. (Revenue uses stored <code>revenueCents</code> when available; otherwise spins ×
          $0.70.)
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 8,
            marginTop: 12,
            fontSize: 12,
            fontWeight: 950,
            opacity: 0.75,
          }}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
            <div key={w} style={{ textAlign: "center" }}>
              {w}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 8,
            marginTop: 8,
          }}
        >
          {Array.from({ length: padDays }).map((_, i) => (
            <div key={`pad-${i}`} style={{ height: 76, borderRadius: 12, background: "rgba(0,0,0,0.03)" }} />
          ))}

          {monthKeys.map((dateKey) => {
            const d = parseDateKeyToLocalDate(dateKey);
            const dayNum = d.getDate();
            const s = monthMap[dateKey];
            const spins = s?.spinsCount ?? 0;

            const revCents =
              s && (s.revenueCents ?? 0) > 0 ? s.revenueCents : spins * REVENUE_CENTS_PER_SPIN;

            const isSelected = selectedDateKey === dateKey;
            const isToday = todayKeyLocal() === dateKey;

            return (
              <button
                key={dateKey}
                onClick={() => setSelectedDateKey(dateKey)}
                style={{
                  height: 76,
                  borderRadius: 12,
                  border: isSelected ? "2px solid rgba(255,155,61,0.95)" : "1px solid rgba(0,0,0,0.10)",
                  background: isSelected ? "rgba(255,217,61,0.18)" : "white",
                  cursor: "pointer",
                  padding: 10,
                  textAlign: "left",
                  boxShadow: isSelected ? "0 10px 24px rgba(0,0,0,0.10)" : "none",
                }}
                title={`${dateKey} • Spins: ${spins} • Revenue: ${moneyFromCents(revCents)}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 1000 }}>{dayNum}</div>
                  {isToday && (
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 950,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(34,197,94,0.16)",
                        color: "#0a7a2a",
                      }}
                    >
                      Today
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 950, opacity: 0.85 }}>
                  Spins: {spins}
                </div>
                <div style={{ marginTop: 2, fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
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
            <span>Spins: {selectedStat?.spinsCount ?? 0}</span>
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
