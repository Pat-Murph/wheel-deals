// app/merchant/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  User,
  deleteUser,
} from "firebase/auth";
import { doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
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

function toDateKeyLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
    try {
      await updateDoc(doc(db, "merchants", merchantId), { active: next });
      setMerchant((m) => (m ? { ...m, active: next } : m));
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

  /* ---------- UI ---------- */
  if (!user) {
    return (
      <main style={{ padding: 24, maxWidth: 520 }}>
        <h1>Merchant Sign In</h1>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <input
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button onClick={doLogin} disabled={busy} style={{ padding: 10, borderRadius: 10 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>

        {status && <div style={{ marginTop: 10, fontWeight: 700 }}>{status}</div>}
      </main>
    );
  }

  if (!merchant || !merchantId) {
    return (
      <main style={{ padding: 24 }}>
        <h2>No merchant linked</h2>
        <a href="/merchant/onboard">Create merchant →</a>
      </main>
    );
  }

  const stripeConnected = !!merchant.stripeAccountId;

  // Calendar rendering helpers
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();

  const firstDayDow = new Date(year, month, 1).getDay(); // 0=Sun..6
  const padDays = firstDayDow; // pad before day 1

  const selectedStat = selectedDateKey ? monthMap[selectedDateKey] : undefined;
  const selectedRevenueCents =
    selectedStat && (selectedStat.revenueCents ?? 0) > 0
      ? selectedStat.revenueCents
      : (selectedStat?.spinsCount ?? 0) * REVENUE_CENTS_PER_SPIN;

  return (
    <main style={{ padding: 24, display: "grid", gap: 14, maxWidth: 1100 }}>
      <h1>Merchant Dashboard</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong>{merchantName}</strong>
        <span>Status: {merchant.active ? "🟢 Live" : "⏸ Paused"}</span>
        <span style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
          Limit: {DAILY_LIMIT} spins/day per customer
        </span>
        {busy && <span style={{ opacity: 0.7 }}>Loading…</span>}
      </div>

      {status && (
        <div style={{ fontWeight: 800, padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.04)" }}>
          {status}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={toggleActive} disabled={busy} style={{ padding: "10px 12px", borderRadius: 10 }}>
          {merchant.active ? "Pause merchant" : "Go live"}
        </button>

        <a href="/merchant/onboard" style={{ padding: "10px 12px", borderRadius: 10 }}>
          Edit merchant →
        </a>

        <button
          onClick={deleteMerchantAccount}
          style={{ color: "red", padding: "10px 12px", borderRadius: 10 }}
          disabled={busy}
        >
          Delete account
        </button>

        <button onClick={doLogout} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Sign out
        </button>
      </div>

      {/* STRIPE BLOCK */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 900 }}>Stripe payouts</div>
        <div style={{ marginTop: 6, opacity: 0.8 }}>
          Status: {stripeConnected ? "✅ Connected" : "❌ Not connected"}
          {stripeConnected && (
            <span
              style={{
                marginLeft: 8,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
              }}
            >
              ({merchant.stripeAccountId})
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <button onClick={connectStripe} disabled={busy} style={{ padding: "10px 12px", borderRadius: 10 }}>
            {stripeConnected ? "Finish / Re-open Stripe onboarding" : "Connect Stripe"}
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Note: Even after connecting, Stripe may require onboarding to enable payouts.
        </div>
      </div>

      {/* STATS (keep YTD) */}
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

      {/* CALENDAR VIEW */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>Daily spins calendar</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              style={{ padding: "8px 10px", borderRadius: 10 }}
              disabled={monthLoading}
            >
              ←
            </button>

            <div style={{ fontWeight: 900, minWidth: 180, textAlign: "center" }}>
              {ymLabel(monthCursor)}
            </div>

            <button
              onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              style={{ padding: "8px 10px", borderRadius: 10 }}
              disabled={monthLoading}
            >
              →
            </button>
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, fontWeight: 700 }}>
          Click a day to see totals. (Revenue uses stored <code>revenueCents</code> when available; otherwise
          spins × $0.70.)
        </div>

        {/* Weekday header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 8,
            marginTop: 12,
            fontSize: 12,
            fontWeight: 900,
            opacity: 0.75,
          }}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
            <div key={w} style={{ textAlign: "center" }}>
              {w}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 8,
            marginTop: 8,
          }}
        >
          {/* Padding cells */}
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
                  <div style={{ fontWeight: 950 }}>{dayNum}</div>
                  {isToday && (
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 900,
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

                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, opacity: 0.85 }}>
                  Spins: {spins}
                </div>
                <div style={{ marginTop: 2, fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
                  {moneyFromCents(revCents)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected day details */}
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

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontWeight: 800 }}>
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
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 800, opacity: 0.7 }}>{props.title}</div>
      <div style={{ fontSize: 24, fontWeight: 900 }}>{props.value}</div>
    </div>
  );
}
