"use client";

import { useEffect, useState } from "react";
import { redeemSpinByCode } from "../../lib/spins";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { app } from "../../lib/firebase";

type Status =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "err"; message: string };

export default function RedeemPage() {
  const auth = getAuth(app);

  const [user, setUser] = useState<User | null>(null);

  // login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // redeem form
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const cleaned = code.trim().toUpperCase();

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, [auth]);

  async function doLogin() {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setStatus({ kind: "ok", message: "✅ Signed in as merchant." });
    } catch (e: any) {
      console.error(e);
      setStatus({ kind: "err", message: e?.message ?? "❌ Login failed." });
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
    setStatus({ kind: "idle" });
    setCode("");
  }

  async function onRedeem() {
    if (!cleaned) return;

    setStatus({ kind: "idle" });
    setBusy(true);

    try {
      const res = await redeemSpinByCode(cleaned);

      if (!res.ok) {
        if (res.reason === "not_found") setStatus({ kind: "err", message: "❌ Code not found." });
        else if (res.reason === "already_redeemed") setStatus({ kind: "warn", message: "⚠️ Already redeemed." });
        else if (res.reason === "expired") setStatus({ kind: "err", message: "⏳ Code expired (7 days after issue)." });
        else setStatus({ kind: "err", message: "❌ Redeem failed." });
        return;
      }

      setStatus({ kind: "ok", message: `✅ Redeemed: ${res.prizeLabel}` });
      setCode("");
    } catch (e: any) {
      console.error(e);
      // If rules are correct and the user isn't staff, you'll see permission-denied
      setStatus({ kind: "err", message: e?.message ?? "❌ Redeem failed." });
    } finally {
      setBusy(false);
    }
  }

  const statusStyle: React.CSSProperties =
    status.kind === "ok"
      ? { background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)" }
      : status.kind === "warn"
      ? { background: "rgba(251,146,60,0.14)", border: "1px solid rgba(251,146,60,0.35)" }
      : status.kind === "err"
      ? { background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)" }
      : {};

  return (
    <main style={{ padding: 24, display: "grid", gap: 12, maxWidth: 560 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Merchant Redeem</h1>

      {!user ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "white" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Sign in</div>

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
        </div>
      ) : (
        <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "white" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>Signed in</div>
            <button
              onClick={doLogout}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.12)",
                fontWeight: 900,
                cursor: "pointer",
                background: "linear-gradient(180deg, #f3f4f6, #fff)",
              }}
            >
              Sign out
            </button>
          </div>

          <div style={{ marginTop: 6, opacity: 0.75, fontWeight: 700 }}>
            {user.email ?? user.uid}
          </div>

          <div style={{ marginTop: 12, fontWeight: 900 }}>Enter code</div>

          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRedeem();
            }}
            placeholder="WD-ABC123"
            style={{
              marginTop: 8,
              padding: 12,
              fontSize: 16,
              borderRadius: 12,
              border: "1px solid #ddd",
              letterSpacing: 1,
              width: "100%",
            }}
          />

          <button
            onClick={onRedeem}
            disabled={busy || !cleaned}
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
            {busy ? "Redeeming…" : "Redeem"}
          </button>
        </div>
      )}

      {status.kind !== "idle" && (
        <div style={{ fontWeight: 900, padding: 12, borderRadius: 14, ...statusStyle }}>
          {status.message}
        </div>
      )}

      <a href="/" style={{ fontWeight: 900, textDecoration: "none", color: "#111" }}>
        ← Back to Wheel
      </a>
    </main>
  );
}
