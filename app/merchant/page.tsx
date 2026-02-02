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
} from "../../lib/merchantStats";

const PAY_PER_SPIN = 0.7;

type MerchantDoc = {
  name?: string;
  about?: string;
  photoUrls?: string[];
  active?: boolean;
  ownerUid?: string;
};

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function MerchantDashboardPage() {
  /** 🔒 Merchant pages NEVER allow anon auth */
  useEffect(() => {
    blockAnonAuth().catch(() => {
      // swallow – we never want a hard crash on merchant page
    });
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

  const [spinsToday, setSpinsToday] = useState(0);
  const [spins7d, setSpins7d] = useState(0);

  // NEW
  const [spins30d, setSpins30d] = useState(0);
  const [revenue30d, setRevenue30d] = useState(0); // dollars
  const [spinsYtd, setSpinsYtd] = useState(0);
  const [revenueYtd, setRevenueYtd] = useState(0); // dollars

  /* ---------- AUTH ---------- */

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u?.isAnonymous) {
        setUser(null);
      } else {
        setUser(u);
      }
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

    // reset stats
    setSpinsToday(0);
    setSpins7d(0);
    setSpins30d(0);
    setRevenue30d(0);
    setSpinsYtd(0);
    setRevenueYtd(0);
  }

  /* ---------- LOAD MERCHANT ---------- */

  useEffect(() => {
    if (!user) return;

    (async () => {
      setBusy(true);
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const mid = userSnap.exists()
          ? (userSnap.data() as any)?.merchantId
          : null;
        if (!mid) return;

        setMerchantId(mid);

        const mSnap = await getDoc(doc(db, "merchants", mid));
        setMerchant(mSnap.exists() ? (mSnap.data() as MerchantDoc) : null);

        const name = await getMerchantName(mid);
        setMerchantName(name);

        // ---- today
        const today = todayKeyLocal();
        const t = await getMerchantDaily(mid, today);
        setSpinsToday(t.spinsCount ?? 0);

        // ---- 7 days
        const keys7 = lastNDaysKeysLocal(7);
        const stats7 = await Promise.all(keys7.map((k) => getMerchantDaily(mid, k)));
        setSpins7d(stats7.reduce((s, d) => s + (d.spinsCount ?? 0), 0));

        // ---- 30 days (spins + revenue)
        const keys30 = lastNDaysKeysLocal(30);
        const stats30 = await Promise.all(keys30.map((k) => getMerchantDaily(mid, k)));

        const spins30 = stats30.reduce((s, d) => s + (d.spinsCount ?? 0), 0);
        setSpins30d(spins30);

        // Prefer revenueCents if present; fallback to spins * PAY_PER_SPIN
        const cents30 = stats30.reduce((c, d) => c + (d.revenueCents ?? 0), 0);
        const rev30 =
          cents30 > 0 ? cents30 / 100 : spins30 * PAY_PER_SPIN;
        setRevenue30d(rev30);

        // ---- YTD (spins + revenue)
        const keysYtd = ytdKeysLocal();
        const statsYtd = await Promise.all(keysYtd.map((k) => getMerchantDaily(mid, k)));

        const spinsY = statsYtd.reduce((s, d) => s + (d.spinsCount ?? 0), 0);
        setSpinsYtd(spinsY);

        const centsY = statsYtd.reduce((c, d) => c + (d.revenueCents ?? 0), 0);
        const revY =
          centsY > 0 ? centsY / 100 : spinsY * PAY_PER_SPIN;
        setRevenueYtd(revY);
      } finally {
        setBusy(false);
      }
    })();
  }, [user]);

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
        <input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={doLogin} disabled={busy}>
          Sign in
        </button>
        {status && <div>{status}</div>}
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

  return (
    <main style={{ padding: 24, display: "grid", gap: 14, maxWidth: 960 }}>
      <h1>Merchant Dashboard</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <strong>{merchantName}</strong>
        <span>Status: {merchant.active ? "🟢 Live" : "⏸ Paused"}</span>
        {busy && <span style={{ opacity: 0.7 }}>Loading…</span>}
      </div>

      {/* CONTROLS */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={toggleActive} disabled={busy}>
          {merchant.active ? "Pause merchant" : "Go live"}
        </button>

        <a href="/merchant/onboard">Edit merchant →</a>

        <button
          onClick={deleteMerchantAccount}
          style={{ color: "red" }}
          disabled={busy}
        >
          Delete account
        </button>

        <button onClick={doLogout}>Sign out</button>
      </div>

      {/* STATS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))",
          gap: 12,
        }}
      >
        <Stat title="Spins today" value={String(spinsToday)} />
        <Stat title="Revenue today" value={money(spinsToday * PAY_PER_SPIN)} />

        <Stat title="Spins (7 days)" value={String(spins7d)} />
        <Stat title="Revenue (7 days)" value={money(spins7d * PAY_PER_SPIN)} />

        {/* NEW */}
        <Stat title="Spins (30 days)" value={String(spins30d)} />
        <Stat title="Revenue (30 days)" value={money(revenue30d)} />

        <Stat title="Spins (YTD)" value={String(spinsYtd)} />
        <Stat title="Revenue (YTD)" value={money(revenueYtd)} />
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
