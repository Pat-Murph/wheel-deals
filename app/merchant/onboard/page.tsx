"use client";
export const dynamic = "force-dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { app, storage, db } from "../../../lib/firebase";
import { DISCOVER_CATEGORIES } from "../../../lib/merchants";
import { claimFoundingSpot } from "../../../lib/founding";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc, // ✅ ADDED
} from "firebase/firestore";

type WheelRow = { label: string; weight: number };

function titleCase(s: string) {
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function isRealMerchantUser(u: User | null) {
  return !!u && !u.isAnonymous;
}

function card(): React.CSSProperties {
  return {
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 16,
    background: "white",
    boxShadow: "0 18px 60px rgba(0,0,0,0.06)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #ddd",
    fontSize: 16,
    width: "100%",
  };
}

function btnGold(disabled: boolean): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 950,
    cursor: disabled ? "not-allowed" : "pointer",
    background:
      "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
    opacity: disabled ? 0.75 : 1,
  };
}

function btnGray(disabled: boolean): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    background: "linear-gradient(180deg, #f3f4f6, #fff)",
    opacity: disabled ? 0.75 : 1,
  };
}

function btnRed(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    background:
      "linear-gradient(180deg, rgba(239,68,68,0.16), rgba(255,255,255,1))",
    opacity: disabled ? 0.75 : 1,
  };
}

function linkGold(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 950,
    textDecoration: "none",
    color: "#111",
    background:
      "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function linkGray(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    textDecoration: "none",
    color: "#111",
    background: "linear-gradient(180deg, #f3f4f6, #fff)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

// -------------------- Firestore save (create OR update) --------------------
// Properly separates CREATE vs UPDATE so Firestore rules evaluate correctly.
// tx.set() with merge on an existing doc is ambiguous to rules — use tx.update() for edits.
async function saveMerchantForUser(args: {
  uid: string;
  merchantId?: string | null;

  name: string;
  category: string;
  city: string;
  state?: string;

  address?: string;
  about?: string;
  lat?: number;
  lng?: number;

  wheel: WheelRow[];
  photoUrls: string[];
  termsAccepted: boolean;
}) {
  const {
    uid,
    merchantId,
    name,
    category,
    city,
    state = "",
    address = "",
    about = "",
    lat,
    lng,
    wheel,
    photoUrls,
    termsAccepted,
  } = args;

  const wheelItems = (Array.isArray(wheel) ? wheel : [])
    .map((r) => ({
      label: String(r.label ?? "").trim(),
      weight: Number(r.weight ?? 0),
    }))
    .filter((r) => r.label && Number.isFinite(r.weight) && r.weight > 0);

  if (!wheelItems.length)
    throw new Error("Add at least 1 wheel prize with a weight > 0.");

  const isEdit = !!merchantId;

  const merchantRef = isEdit
    ? doc(db, "merchants", merchantId!)
    : doc(collection(db, "merchants"));

  const staffRef = doc(db, "merchants", merchantRef.id, "staff", uid);
  const userRef = doc(db, "users", uid);
  const wheelRef = doc(db, "merchants", merchantRef.id, "config", "wheel");

  // Shared fields for both create and update
  const sharedFields = {
    active: true,
    name: name.trim(),
    nameLower: name.trim().toLowerCase(),
    category: category.trim(),
    categoryLower: category.trim().toLowerCase(),
    city: city.trim(),
    cityLower: city.trim().toLowerCase(),
    state: state.trim(),
    stateLower: state.trim().toLowerCase(),
    address: address.trim(),
    about: about.trim(),
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    photoUrls: photoUrls.slice(0, 12),
    wheel: wheelItems,
    termsAccepted: !!termsAccepted,
    termsAcceptedVersion: 1,
    termsAcceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (isEdit) {
    // ── EDIT PATH ──────────────────────────────────────────────────────────
    // Only update the merchant doc. Staff and user docs do not need to change
    // on edit — and their rules explicitly block updates (staff: update=false,
    // user: only the owner can update their own doc which is fine but unnecessary).
    await runTransaction(db, async (tx) => {
      tx.update(merchantRef, sharedFields);
    });
  } else {
    // ── CREATE PATH ────────────────────────────────────────────────────────
    // Use tx.set() for new docs. ownerUid is included to satisfy create rule.
    await runTransaction(db, async (tx) => {
      tx.set(merchantRef, {
        ...sharedFields,
        ownerUid: uid,
        createdAt: serverTimestamp(),
      });
      tx.set(staffRef, {
        active: true,
        role: "owner",
        createdAt: serverTimestamp(),
      });
      tx.set(userRef, {
        merchantId: merchantRef.id,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
  }

  // Write wheel config AFTER transaction so staff doc is fully committed
  // and visible to Firestore rules when isMerchantStaff() is evaluated.
  await setDoc(
    wheelRef,
    { items: wheelItems, updatedAt: serverTimestamp() },
    { merge: true }
  );

  return { merchantId: merchantRef.id };
}

async function getMerchantIdForUser(uid: string) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return ((snap.data() as any)?.merchantId as string) ?? null;
}

type MerchantDoc = {
  name?: string;
  category?: string;
  city?: string;
  state?: string;
  address?: string;
  about?: string;
  lat?: number | null;
  lng?: number | null;
  wheel?: Array<{ label: string; weight: number }>;
  photoUrls?: string[];

  // ✅ NEW: terms acceptance (read for edit mode)
  termsAccepted?: boolean;
  termsAcceptedVersion?: number;
  termsAcceptedAt?: any;
};

export default function MerchantOnboardPage() {
  const auth = useMemo(() => getAuth(app), []);
  const [user, setUser] = useState<User | null>(null);
  const [rawAuthUser, setRawAuthUser] = useState<User | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState(""); // ✅ new (optional)
  const [address, setAddress] = useState("");

  const [about, setAbout] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [uploadedPhotoUrls, setUploadedPhotoUrls] = useState<string[]>([]);

  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");

  const [wheel, setWheel] = useState<WheelRow[]>([
    { label: "10% off", weight: 50 },
    { label: "Free Drink", weight: 30 },
    { label: "BOGO slice", weight: 15 },
    { label: "Free appetizer", weight: 5 },
  ]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // ✅ now represents existing merchant too (not only "created")
  const [merchantId, setMerchantId] = useState<string | null>(null);

  // ✅ NEW: Merchant must accept terms
  const [acceptMerchantTerms, setAcceptMerchantTerms] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setRawAuthUser(u); // track anon too
      setUser(isRealMerchantUser(u) ? u : null);
    });
  }, [auth]);

  // Load merchant if already linked -> prefill -> become "edit mode"
  useEffect(() => {
    if (!user) return;

    (async () => {
      setBusy(true);
      setStatus(null);
      try {
        const mid = await getMerchantIdForUser(user.uid);
        setMerchantId(mid);

        if (!mid) return;

        const msnap = await getDoc(doc(db, "merchants", mid));
        if (!msnap.exists()) return;

        const m = msnap.data() as MerchantDoc;

        setName(m.name ?? "");
        setCategory(m.category ?? "");
        setCity(m.city ?? "");
        setStateName(m.state ?? "");
        setAddress(m.address ?? "");
        setAbout(m.about ?? "");

        setLat(typeof m.lat === "number" ? String(m.lat) : "");
        setLng(typeof m.lng === "number" ? String(m.lng) : "");

        setUploadedPhotoUrls(Array.isArray(m.photoUrls) ? m.photoUrls : []);

        if (Array.isArray(m.wheel) && m.wheel.length) {
          setWheel(
            m.wheel.map((r) => ({
              label: String((r as any)?.label ?? "").trim(),
              weight: Number((r as any)?.weight ?? 0),
            }))
          );
        }

        // ✅ NEW: if they already accepted before, keep it checked
        if (m.termsAccepted === true) setAcceptMerchantTerms(true);
      } catch (e: any) {
        console.error(e);
        setStatus(e?.message ?? "❌ Could not load merchant.");
      } finally {
        setBusy(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    // revoke old previews
    photoPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    const next = photoFiles.map((f) => URL.createObjectURL(f));
    setPhotoPreviewUrls(next);

    return () => {
      next.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoFiles]);

  async function doSignIn() {
    setBusy(true);
    setStatus(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setStatus("✅ Signed in.");
    } catch (e: any) {
      setStatus(e?.message ?? "❌ Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doCreateAccount() {
    setBusy(true);
    setStatus(null);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      setStatus("✅ Account created + signed in.");

      // Auto-fill city from geolocation on new account creation
      try {
        if (navigator.geolocation && !city) {
          const p = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 8000,
            });
          });
          const latNum = p.coords.latitude;
          const lngNum = p.coords.longitude;
          setLat(String(latNum));
          setLng(String(lngNum));

          const res = await fetch("/api/geocode/reverse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latNum, lng: lngNum }),
          });
          const data = await res.json();
          if (res.ok && data?.ok) {
            if (data.city) setCity(String(data.city));
            if (data.state) setStateName(String(data.state));
            setStatus("✅ Account created + location auto-filled!");
          }
        }
      } catch {
        // location permission denied or unavailable — that's fine
      }
    } catch (e: any) {
      setStatus(e?.message ?? "❌ Create account failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doSignOut() {
    await signOut(auth);
    setMerchantId(null);
    setStatus(null);
    setUploadedPhotoUrls([]);
    setPhotoFiles([]);
    setAcceptMerchantTerms(false); // ✅ reset on signout
  }

  async function signOutCustomerSession() {
    setBusy(true);
    setStatus(null);
    try {
      await signOut(auth);
      setMerchantId(null);
      setStatus("✅ Signed out of customer session. Now sign in with email.");
    } catch (e: any) {
      setStatus(e?.message ?? "❌ Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function useMyLocation() {
    setStatus(null);
    setBusy(true);
    try {
      if (!navigator.geolocation) throw new Error("Geolocation not supported.");
      const p = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const latNum = p.coords.latitude;
      const lngNum = p.coords.longitude;

      setLat(String(latNum));
      setLng(String(lngNum));

      // ✅ auto-fill city/state (best effort)
      try {
        const res = await fetch("/api/geocode/reverse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: latNum, lng: lngNum }),
        });
        const data = await res.json();
        if (res.ok && data?.ok) {
          if (data.city && !city) setCity(String(data.city));
          if (data.state && !stateName) setStateName(String(data.state));
        }
      } catch {
        // ignore; location still captured
      }

      setStatus("📍 Location captured.");
    } catch (e: any) {
      setStatus(e?.message ?? "Could not get location.");
    } finally {
      setBusy(false);
    }
  }

  function updateWheel(i: number, patch: Partial<WheelRow>) {
    setWheel((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeWheel(i: number) {
    setWheel((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addWheel() {
    setWheel((prev) => [...prev, { label: "", weight: 10 }]);
  }

  async function uploadPhotos(uid: string) {
    if (!photoFiles.length) return [];

    const files = photoFiles.slice(0, 6);
    const urls: string[] = [];

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `merchant_photos/${uid}/${Date.now()}_${safeName}`;
      const r = ref(storage, path);

      await uploadBytes(r, file, {
        contentType: file.type || "image/jpeg",
        cacheControl: "public,max-age=3600",
      });

      const url = await getDownloadURL(r);
      urls.push(url);
    }

    return urls;
  }

  function resetSelectedPhotos() {
    setPhotoFiles([]);
    // IMPORTANT: do NOT wipe uploadedPhotoUrls here; merchants may want to keep existing.
    // If they truly want to wipe, you can add a "Remove all uploaded" later.
  }

  // ✅ Stripe connect (safe: uses merchantId)
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

  async function submit() {
    if (!user) {
      setStatus("❌ Please sign in with email (not anonymous) first.");
      return;
    }

    // ✅ NEW: enforce merchant terms acceptance
    if (!acceptMerchantTerms) {
      setStatus("❌ Please agree to the merchant terms to continue.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      if (!name.trim()) throw new Error("Business name is required.");
      if (!category.trim()) throw new Error("Category is required.");
      if (!city.trim()) throw new Error("City is required.");

      const cleanedWheel = wheel
        .map((r) => ({
          label: String(r.label ?? "").trim(),
          weight: Number(r.weight ?? 0),
        }))
        .filter((r) => r.label && r.weight > 0);

      if (!cleanedWheel.length)
        throw new Error("Add at least 1 wheel prize with a weight > 0.");

      const latNum = lat.trim() ? Number(lat) : undefined;
      const lngNum = lng.trim() ? Number(lng) : undefined;

      if (lat.trim() && Number.isNaN(latNum)) throw new Error("Lat must be a number.");
      if (lng.trim() && Number.isNaN(lngNum)) throw new Error("Lng must be a number.");

      // Photos behavior:
      // - If they selected new photos, upload and overwrite
      // - If they didn't, keep existing uploadedPhotoUrls (from merchant doc)
      let urls = uploadedPhotoUrls;

      if (photoFiles.length) {
        setStatus("📸 Uploading photos…");
        urls = await uploadPhotos(user.uid);
        setUploadedPhotoUrls(urls);
      }

      setStatus(merchantId ? "💾 Saving changes…" : "🏪 Creating merchant profile…");

      const res = await saveMerchantForUser({
        uid: user.uid,
        merchantId,
        name: name.trim(),
        category: category.trim(),
        city: city.trim(),
        state: stateName.trim(), // optional
        address: address.trim(),
        about: about.trim(),
        lat: latNum,
        lng: lngNum,
        wheel: cleanedWheel,
        photoUrls: urls,

        // ✅ NEW
        termsAccepted: true,
      });

      setMerchantId(res.merchantId);

      // ✅ Claim a founding merchant spot for NEW merchants only (not edits)
      if (!merchantId) {
        try {
          const foundingNumber = await claimFoundingSpot(res.merchantId);
          if (foundingNumber !== null) {
            setStatus(
              `✅ Merchant created! You're the owner. 🎉 You are Founding Merchant #${foundingNumber} — you qualify for the 20% profit share program!`
            );
          } else {
            setStatus("✅ Merchant created! You're the owner.");
          }
        } catch {
          setStatus("✅ Merchant created! You're the owner.");
        }
      } else {
        setStatus("✅ Saved! Changes live now.");
      }
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "❌ Could not save merchant.");
    } finally {
      setBusy(false);
    }
  }

  const locked = !user;
  const isEdit = !!merchantId;

  // ✅ NEW: submit is disabled if merchant terms not accepted
  const submitDisabled = !user || busy || !acceptMerchantTerms;

  return (
    <main
      style={{
        padding: 22,
        display: "grid",
        gap: 14,
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 950 }}>Merchant Onboarding</h1>
          <div style={{ opacity: 0.75, fontWeight: 800, marginTop: 6 }}>
            {isEdit ? "Edit your merchant profile + wheel." : "Create your merchant profile + wheel in a couple minutes."}
          </div>
        </div>

        <a
          href="/discover"
          style={{
            fontWeight: 950,
            textDecoration: "none",
            color: "#111",
            alignSelf: "center",
          }}
        >
          ← Back to Discover
        </a>
      </div>

      {/* Step 1: Auth */}
      <div style={card()}>
        {!user ? (
          <>
            <div style={{ fontWeight: 950, fontSize: 18 }}>
              Step 1 — Sign in (or create account)
            </div>

            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 8 }}>
              Customer anonymous sessions don’t count here — sign in with email.
            </div>

            {rawAuthUser?.isAnonymous && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(239,68,68,0.28)",
                  background: "rgba(239,68,68,0.08)",
                  fontWeight: 900,
                }}
              >
                You’re currently signed in as a <b>customer (anonymous)</b>, so onboarding is locked.
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    onClick={signOutCustomerSession}
                    disabled={busy}
                    style={btnGray(busy)}
                  >
                    Sign out customer session
                  </button>
                </div>
              </div>
            )}

            <div
              style={{
                display: "grid",
                gap: 10,
                marginTop: 12,
                gridTemplateColumns: "1fr 1fr",
              }}
            >
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="merchant email"
                style={inputStyle()}
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password (6+ chars)"
                type="password"
                style={inputStyle()}
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <button
                onClick={doSignIn}
                disabled={busy || !email.trim() || password.length < 6}
                style={btnGold(busy || !email.trim() || password.length < 6)}
              >
                {busy ? "Working…" : "Sign in"}
              </button>

              <button
                onClick={doCreateAccount}
                disabled={busy || !email.trim() || password.length < 6}
                style={btnGray(busy || !email.trim() || password.length < 6)}
              >
                {busy ? "Working…" : "Create account"}
              </button>
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 950 }}>Signed in</div>
              <div style={{ opacity: 0.75, fontWeight: 800 }}>{user.email ?? user.uid}</div>
              {isEdit && (
                <div style={{ marginTop: 6, fontWeight: 900, opacity: 0.7 }}>
                  Editing Merchant ID:{" "}
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {merchantId}
                  </span>
                </div>
              )}
            </div>
            <button onClick={doSignOut} style={btnGray(false)}>
              Sign out
            </button>
          </div>
        )}

        {status && (
          <div
            style={{
              marginTop: 12,
              fontWeight: 900,
              padding: 12,
              borderRadius: 14,
              background: "rgba(0,0,0,0.04)",
            }}
          >
            {status}
          </div>
        )}
      </div>

      {/* Step 2: Business */}
      <div style={{ ...card(), opacity: locked ? 0.6 : 1 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Step 2 — Business info</div>

        <div
          style={{
            display: "grid",
            gap: 10,
            marginTop: 12,
            gridTemplateColumns: "1fr 240px 240px",
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Business name"
            style={inputStyle()}
            disabled={!user || busy}
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={inputStyle()}
            disabled={!user || busy}
          >
            <option value="">Select category</option>
            {DISCOVER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </select>

          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City (auto-fills from location)"
            style={inputStyle()}
            disabled={!user || busy}
          />
        </div>

        {/* ✅ optional state */}
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gap: 10,
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <input
            value={stateName}
            onChange={(e) => setStateName(e.target.value)}
            placeholder="State (optional, auto-fills from location)"
            style={inputStyle()}
            disabled={!user || busy}
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address (optional)"
            style={inputStyle()}
            disabled={!user || busy}
          />
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="About your business (shown to customers)"
            style={{ ...inputStyle(), minHeight: 110, resize: "vertical" }}
            disabled={!user || busy}
            maxLength={1200}
          />
          <div style={{ fontWeight: 800, opacity: 0.7 }}>{about.length}/1200</div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 950 }}>Business photos (up to 6)</div>
            {photoFiles.length > 0 && (
              <button
                onClick={resetSelectedPhotos}
                disabled={!user || busy}
                style={btnGray(!user || busy)}
              >
                Clear selected photos
              </button>
            )}
          </div>

          <input
            type="file"
            accept="image/*"
            multiple
            disabled={!user || busy}
            onChange={(e) => setPhotoFiles(Array.from(e.target.files || []).slice(0, 6))}
          />

          {photoPreviewUrls.length > 0 && (
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              }}
            >
              {photoPreviewUrls.map((src, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "#fff",
                  }}
                >
                  <img
                    src={src}
                    alt={`preview-${i}`}
                    style={{ width: "100%", height: 120, objectFit: "cover" }}
                  />
                  <div
                    style={{
                      padding: 10,
                      fontWeight: 900,
                      fontSize: 12,
                      opacity: 0.7,
                    }}
                  >
                    New Photo {i + 1}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* show existing uploaded photos when editing */}
          {uploadedPhotoUrls.length > 0 && photoPreviewUrls.length === 0 && (
            <div style={{ fontWeight: 900, opacity: 0.75 }}>
              ✅ Using {uploadedPhotoUrls.length} existing uploaded photo(s)
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            marginTop: 10,
            gridTemplateColumns: "1fr 1fr auto",
          }}
        >
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="Latitude"
            style={inputStyle()}
            disabled={!user || busy}
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="Longitude"
            style={inputStyle()}
            disabled={!user || busy}
          />
          <button onClick={useMyLocation} disabled={!user || busy} style={btnGray(!user || busy)}>
            Use my location
          </button>
        </div>
      </div>

      {/* Step 3: Wheel */}
      <div style={{ ...card(), opacity: locked ? 0.6 : 1 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Step 3 — Wheel prizes + odds</div>
        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 8 }}>
          Higher weight = more likely. Example: 50 is more common than 5.
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {wheel.map((row, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "1fr 160px auto",
                alignItems: "center",
              }}
            >
              <input
                value={row.label}
                onChange={(e) => updateWheel(i, { label: e.target.value })}
                placeholder="Prize label"
                style={inputStyle()}
                disabled={!user || busy}
              />
              <input
                value={String(row.weight)}
                onChange={(e) => updateWheel(i, { weight: Number(e.target.value || 0) })}
                placeholder="Weight"
                style={inputStyle()}
                disabled={!user || busy}
              />
              <button
                onClick={() => removeWheel(i)}
                disabled={!user || busy || wheel.length <= 1}
                style={btnRed(!user || busy || wheel.length <= 1)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={addWheel} disabled={!user || busy} style={btnGray(!user || busy)}>
            + Add prize
          </button>
        </div>
      </div>

      {/* ✅ NEW: Merchant Terms */}
      <div style={{ ...card(), opacity: locked ? 0.6 : 1 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Step 4 — Merchant terms</div>
        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 8 }}>
          Required to publish a wheel.
        </div>

        <label
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            fontWeight: 850,
            lineHeight: 1.35,
          }}
        >
          <input
            type="checkbox"
            checked={acceptMerchantTerms}
            onChange={(e) => setAcceptMerchantTerms(e.target.checked)}
            disabled={!user || busy}
            style={{ marginTop: 4 }}
          />
          <span>
            I agree that my Wheel Deals prizes are <b>not cash</b>, a <b>prize is always awarded</b> on every spin,
            and my business will <b>handle any customer disputes</b> related to redemption.
          </span>
        </label>

        {!acceptMerchantTerms && user && (
          <div style={{ marginTop: 10, fontWeight: 900, color: "#b91c1c" }}>
            Please check the box to continue.
          </div>
        )}
      </div>

      {/* Submit */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={submit} disabled={submitDisabled} style={btnGold(submitDisabled)}>
          {busy ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create merchant"}
        </button>

        {merchantId && (
          <>
            <button onClick={connectStripe} disabled={!user || busy} style={btnGray(!user || busy)}>
              Connect Stripe (get paid)
            </button>

            <a href="/merchant" style={linkGold()}>
              Go to Merchant Dashboard →
            </a>
            <a href="/discover" style={linkGray()}>
              View on Discover →
            </a>
            <button onClick={doSignOut} style={btnGray(false)}>
              Sign out
            </button>

            <div style={{ fontWeight: 900, opacity: 0.7 }}>
              Merchant ID:{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {merchantId}
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
