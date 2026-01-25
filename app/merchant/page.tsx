"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { app } from "../../lib/firebase";
import {
  findMerchantIdForUser,
  getMerchantDaily,
  getMerchantName,
  lastNDaysKeysLocal,
  todayKeyLocal,
} from "../../lib/merchantStats";

const PAY_PER_SPIN = 0.7;

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function MerchantPage() {
  const auth = useMemo(() => getAuth(app), []);
  const [user, setUser] = useState<User | null>(null);

  // login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // dashboard
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [spinsToday, setSpinsToday] = useState(0);
  const [spins7d, setSpins7d] = useState(0);

  // Redemption rate requires querying spins; we’ll do last 7 days (good enough).
  const [redeemRate7d, setRedeemRate7d] = useState<number | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, [auth]);

  async function doLogin() {
    setBusy(true);
    setStatus(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setStatus("✅ Signed in.");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "❌ Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
    setMerchantId(null);
    setMerchantName(null);
    setSpinsToday(0);
    setSpins7d(0);
    setRedeemRate7d(null);
    setStatus(null);
  }

  async function refreshDashboard(u: User) {
    setBusy(true);
    setStatus(null);

    try {
      const mid = await findMerchantIdForUser(u.uid);
      if (!mid) {
        setMerchantId(null);
        setMerchantName(null);
        setStatus(
          "❌ This account is not authorized for any merchant. (Missing merchants/{merchantId}/staff/{uid})"
        );
        return;
      }

      setMerchantId(mid);
      const name = await getMerchantName(mid);
      setMerchantName(name);

      const today = todayKeyLocal();
      const todayStat = await getMerchantDaily(mid, today);
      setSpinsToday(todayStat.spinsCount ?? 0);

      const keys = lastNDaysKeysLocal(7);
      const stats = await Promise.all(keys.map((k) => getMerchantDaily(mid, k)));
      const total7 = stats.reduce((sum, s) => sum + (s.spinsCount ?? 0), 0);
      setSpins7d(total7);

      // Redemption rate (last 7 days) — optional upgrade:
      // We’ll compute this by querying spins collection for merchantId + dateKey in last 7 keys.
      // This requires an index? Usually not for simple where+in.
      // If you hit an index error, tell me and I’ll give the exact index to create.
      try {
        const { getRedeemRateForMerchantLast7Days } = await import("../../lib/redeemRate");
        const rate = await getRedeemRateForMerchantLast7Days(mid, keys);
        setRedeemRate7d(rate);
      } catch {
        // If helper not added yet, we just skip.
        setRedeemRate7d(null);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "❌ Could not load dashboard.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) refreshDashboard(user);
  }, [user]);

  const revenueToday = spinsToday * PAY_PER_SPIN;
  const revenue7d = spins7d * PAY_PER_SPIN;

  return (
    <main style={{ padding: 24, display: "grid", gap: 12, maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>
        Merchant Dashboard
      </h1>

      {!user ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "white" }}>
          <div style={{ fontWeight: 900 }}>Merchant sign in</div>

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="merchant email"
            style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #ddd", width: "100%" }}
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            type="password"
            style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #ddd", width: "100%" }}
          />

          <button
            onClick={doLogin}
            disabled={busy || !email.trim() || !password}
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
              width: "100%",
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {status && <div style={{ marginTop: 10, fontWeight: 800 }}>{status}</div>}
        </div>
      ) : (
        <>
          <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "white" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 900 }}>Signed in</div>
                <div style={{ opacity: 0.7, fontWeight: 700 }}>
                  {user.email ?? user.uid}
                </div>
                <div style={{ marginTop: 6, fontWeight: 900 }}>
                  Merchant: {merchantName ?? (merchantId ? merchantId : "—")}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  onClick={() => user && refreshDashboard(user)}
                  disabled={busy}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.12)",
                    fontWeight: 900,
                    cursor: busy ? "not-allowed" : "pointer",
                    background: "linear-gradient(180deg, #f3f4f6, #fff)",
                  }}
                >
                  {busy ? "Refreshing…" : "Refresh"}
                </button>

                <a
                  href="/redeem"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.12)",
                    fontWeight: 900,
                    textDecoration: "none",
                    color: "#111",
                    background: "linear-gradient(180deg, #f3f4f6, #fff)",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Redeem →
                </a>

                <button
                  onClick={doLogout}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.12)",
                    fontWeight: 900,
                    cursor: "pointer",
                    background: "linear-gradient(180deg, #f3f4f6, #fff)",
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>

            {status && <div style={{ marginTop: 10, fontWeight: 800 }}>{status}</div>}
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Card title="Spins today" value={String(spinsToday)} sub={`Paid per spin: ${money(PAY_PER_SPIN)}`} />
            <Card title="Revenue today" value={money(revenueToday)} sub="Revenue = issued spins × $0.70" />
            <Card title="Spins (7 days)" value={String(spins7d)} sub="Sum of last 7 days issued" />
            <Card title="Revenue (7 days)" value={money(revenue7d)} sub="Sum of last 7 days × $0.70" />
            <Card
              title="Redemption rate (7 days)"
              value={redeemRate7d === null ? "—" : `${Math.round(redeemRate7d * 100)}%`}
              sub="Redeemed ÷ Issued (last 7 days)"
            />
          </div>
        </>
      )}
    </main>
  );
}

function Card(props: { title: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "white" }}>
      <div style={{ fontWeight: 900, opacity: 0.7 }}>{props.title}</div>
      <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{props.value}</div>
      {props.sub && <div style={{ marginTop: 6, opacity: 0.7, fontWeight: 700 }}>{props.sub}</div>}
    </div>
  );
}
