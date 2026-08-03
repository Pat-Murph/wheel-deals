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
import { app, storage, getDb } from "../../../lib/firebase";
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
type WheelConfig = { spinPriceCents: number; items: WheelRow[] };

const SPIN_PRICE_OPTIONS = [
  { cents: 135, label: "$1.35 unlock" },
  { cents: 200, label: "$2.00 unlock" },
  { cents: 300, label: "$3.00 unlock" },
  { cents: 500, label: "$5.00 unlock" },
];

const DEFAULT_PRIZES: WheelRow[] = [
  { label: "10% off", weight: 50 },
  { label: "Free Drink", weight: 30 },
  { label: "BOGO", weight: 15 },
  { label: "Free item", weight: 5 },
];

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
  website?: string;
  phone?: string;
  lat?: number;
  lng?: number;

  wheel: WheelRow[];
  wheels: WheelConfig[];
  photoUrls: string[];
  termsAccepted: boolean;
  isMobile?: boolean;
  mobileLat?: number | null;
  mobileLng?: number | null;
  mobileActiveUntil?: Date | null;
  mobileServiceLat?: number | null;
  mobileServiceLng?: number | null;
  mobileServiceRadiusMiles?: number | null;
  businessHours?: Record<string, { open: string; close: string; closed?: boolean }>;
  showBusinessHours?: boolean;
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
    website = "",
    phone = "",
    lat,
    lng,
    wheel,
    wheels,
    photoUrls,
    termsAccepted,
    isMobile = false,
    mobileLat,
    mobileLng,
    mobileActiveUntil,
    mobileServiceLat,
    mobileServiceLng,
    mobileServiceRadiusMiles,
    businessHours,
    showBusinessHours = true,
  } = args;

  const wheelItems = (Array.isArray(wheel) ? wheel : [])
    .map((r) => ({
      label: String(r.label ?? "").trim(),
      weight: Number(r.weight ?? 0),
    }))
    .filter((r) => r.label && Number.isFinite(r.weight) && r.weight > 0);

  if (!wheelItems.length)
    throw new Error("Add at least 1 wheel prize with a weight > 0.");

  // Clean and validate the multi-wheel configs
  const cleanedWheels = (Array.isArray(wheels) ? wheels : []).map((wc) => ({
    spinPriceCents: Number(wc.spinPriceCents),
    items: (Array.isArray(wc.items) ? wc.items : [])
      .map((r) => ({ label: String(r.label ?? "").trim(), weight: Number(r.weight ?? 0) }))
      .filter((r) => r.label && r.weight > 0),
  })).filter((wc) => [135, 200, 300, 500].includes(wc.spinPriceCents) && wc.items.length > 0);

  const isEdit = !!merchantId;

  const merchantRef = isEdit
    ? doc(getDb(), "merchants", merchantId!)
    : doc(collection(getDb(), "merchants"));

  const staffRef = doc(getDb(), "merchants", merchantRef.id, "staff", uid);
  const userRef = doc(getDb(), "users", uid);
  const wheelRef = doc(getDb(), "merchants", merchantRef.id, "config", "wheel");

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
    website: website.trim(),
    phone: phone.trim(),
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    photoUrls: photoUrls.slice(0, 12),
    wheel: wheelItems,
    wheels: cleanedWheels,
    termsAccepted: !!termsAccepted,
    termsAcceptedVersion: 1,
    termsAcceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isMobile: !!isMobile,
    mobileLat: typeof mobileLat === 'number' ? mobileLat : null,
    mobileLng: typeof mobileLng === 'number' ? mobileLng : null,
    mobileServiceLat: typeof mobileServiceLat === 'number' ? mobileServiceLat : null,
    mobileServiceLng: typeof mobileServiceLng === 'number' ? mobileServiceLng : null,
    mobileServiceRadiusMiles: typeof mobileServiceRadiusMiles === 'number' ? mobileServiceRadiusMiles : 25,
    businessHours: businessHours ?? {},
    showBusinessHours: showBusinessHours !== false,
  };

  if (isEdit) {
    // ── EDIT PATH ──────────────────────────────────────────────────────────
    // Only update the merchant doc. Staff and user docs do not need to change
    // on edit — and their rules explicitly block updates (staff: update=false,
    // user: only the owner can update their own doc which is fine but unnecessary).
    await runTransaction(getDb(), async (tx) => {
      tx.update(merchantRef, sharedFields);
    });
  } else {
    // ── CREATE PATH ────────────────────────────────────────────────────────
    // Use tx.set() for new docs. ownerUid is included to satisfy create rule.
    await runTransaction(getDb(), async (tx) => {
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
  const snap = await getDoc(doc(getDb(), "users", uid));
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
  website?: string;
  phone?: string;
  lat?: number | null;
  lng?: number | null;
  wheel?: Array<{ label: string; weight: number }>;
  wheels?: Array<{ spinPriceCents: number; items: Array<{ label: string; weight: number }> }>;
  photoUrls?: string[];

  // ✅ NEW: terms acceptance (read for edit mode)
  termsAccepted?: boolean;
  termsAcceptedVersion?: number;
  termsAcceptedAt?: any;

  // Mobile merchant fields
  isMobile?: boolean;
  mobileLat?: number | null;
  mobileLng?: number | null;
  mobileActiveUntil?: any;
  mobileServiceLat?: number | null;
  mobileServiceLng?: number | null;
  mobileServiceRadiusMiles?: number | null;

  // Business hours
  businessHours?: Record<string, { open: string; close: string; closed?: boolean }>;
  showBusinessHours?: boolean;
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
  const [mobileLat, setMobileLat] = useState<number | null>(null);
  const [mobileLng, setMobileLng] = useState<number | null>(null);

  const [about, setAbout] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [mobileServiceLat, setMobileServiceLat] = useState<number | null>(null);
  const [mobileServiceLng, setMobileServiceLng] = useState<number | null>(null);
  const [mobileServiceSet, setMobileServiceSet] = useState(false);
  const [mobileActiveUntil, setMobileActiveUntil] = useState<Date | null>(null);
  const [mobileDurationHours, setMobileDurationHours] = useState<number>(2);
  const [showBusinessHours, setShowBusinessHours] = useState(true);
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
  const defaultHours = () => Object.fromEntries(DAYS.map(d => [d, { open: "09:00", close: "17:00", closed: false }]));
  const [businessHours, setBusinessHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>(defaultHours());

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]);
  const [uploadedPhotoUrls, setUploadedPhotoUrls] = useState<string[]>([]);

  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");

  // Multi-wheel state: up to 3 wheels, each with a price and prize list
  const [wheels, setWheels] = useState<WheelConfig[]>([
    { spinPriceCents: 135, items: [...DEFAULT_PRIZES] },
  ]);
  // Keep legacy single-wheel state in sync with first wheel for backward compat
  const wheel = wheels[0]?.items ?? DEFAULT_PRIZES;

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

        const msnap = await getDoc(doc(getDb(), "merchants", mid));
        if (!msnap.exists()) return;

        const m = msnap.data() as MerchantDoc;

        setName(m.name ?? "");
        setCategory(m.category ?? "");
        setCity(m.city ?? "");
        setStateName(m.state ?? "");
        setAddress(m.address ?? "");
        setAbout(m.about ?? "");
        setWebsite(m.website ?? "");
        setPhone(m.phone ?? "");
        setIsMobile(m.isMobile ?? false);
        setShowBusinessHours(m.showBusinessHours !== false);
        setMobileActiveUntil(m.mobileActiveUntil?.toDate() ?? null);
        setMobileServiceLat(m.mobileServiceLat ?? null);

        // Load business hours
        if (m.businessHours && typeof m.businessHours === "object") {
          setBusinessHours(prev => {
            const merged = { ...prev };
            for (const day of DAYS) {
              if (m.businessHours![day]) {
                merged[day] = {
                  open: m.businessHours![day].open ?? "09:00",
                  close: m.businessHours![day].close ?? "17:00",
                  closed: m.businessHours![day].closed ?? false,
                };
              }
            }
            return merged;
          });
        }
        setMobileServiceLng(m.mobileServiceLng ?? null);
        if (m.mobileServiceLat != null && m.mobileServiceLng != null) setMobileServiceSet(true);

        setLat(typeof m.lat === "number" ? String(m.lat) : "");
        setLng(typeof m.lng === "number" ? String(m.lng) : "");
        setMobileLat(m.mobileLat ?? null);
        setMobileLng(m.mobileLng ?? null);

        setUploadedPhotoUrls(Array.isArray(m.photoUrls) ? m.photoUrls : []);
        setPhotoPreviewUrls(Array.isArray(m.photoUrls) ? m.photoUrls : []);

        // Prefill multi-wheel config if available, else fall back to legacy single wheel
        if (Array.isArray(m.wheels) && m.wheels.length) {
          setWheels(m.wheels.map((wc) => ({
            spinPriceCents: Number(wc.spinPriceCents),
            items: (Array.isArray(wc.items) ? wc.items : []).map((r) => ({
              label: String((r as any)?.label ?? "").trim(),
              weight: Number((r as any)?.weight ?? 0),
            })),
          })));
        } else if (Array.isArray(m.wheel) && m.wheel.length) {
          setWheels([{
            spinPriceCents: 135,
            items: m.wheel.map((r) => ({
              label: String((r as any)?.label ?? "").trim(),
              weight: Number((r as any)?.weight ?? 0),
            })),
          }]);
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
    // Create blob URLs for newly selected files
    const newBlobUrls = photoFiles.map((f) => URL.createObjectURL(f));

    // Combine: existing uploaded photos (minus removed) + new blob previews
    const existingKept = uploadedPhotoUrls.filter(u => !photosToRemove.includes(u));
    setPhotoPreviewUrls([...existingKept, ...newBlobUrls]);

    return () => {
      newBlobUrls.forEach((u) => URL.revokeObjectURL(u));
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

  // Multi-wheel helpers
  function updateWheelItem(wi: number, ii: number, patch: Partial<WheelRow>) {
    setWheels((prev) => prev.map((wc, wIdx) =>
      wIdx !== wi ? wc : { ...wc, items: wc.items.map((r, rIdx) => rIdx === ii ? { ...r, ...patch } : r) }
    ));
  }

  function removeWheelItem(wi: number, ii: number) {
    setWheels((prev) => prev.map((wc, wIdx) =>
      wIdx !== wi ? wc : { ...wc, items: wc.items.filter((_, rIdx) => rIdx !== ii) }
    ));
  }

  function addWheelItem(wi: number) {
    setWheels((prev) => prev.map((wc, wIdx) =>
      wIdx !== wi ? wc : { ...wc, items: [...wc.items, { label: "", weight: 10 }] }
    ));
  }

  function updateWheelPrice(wi: number, cents: number) {
    setWheels((prev) => prev.map((wc, wIdx) => wIdx !== wi ? wc : { ...wc, spinPriceCents: cents }));
  }

  function addNewWheel() {
    if (wheels.length >= 3) return;
    // Pick a price not already used
    const usedPrices = new Set(wheels.map((wc) => wc.spinPriceCents));
    const nextPrice = SPIN_PRICE_OPTIONS.find((o) => !usedPrices.has(o.cents));
    if (!nextPrice) return;
    setWheels((prev) => [...prev, { spinPriceCents: nextPrice.cents, items: [...DEFAULT_PRIZES] }]);
  }

  function removeWheelConfig(wi: number) {
    if (wheels.length <= 1) return;
    setWheels((prev) => prev.filter((_, wIdx) => wIdx !== wi));
  }

  // Compress image client-side before upload (max 1200px, JPEG quality 0.8)
  async function compressImage(file: File): Promise<Blob> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => resolve(blob || file),
          "image/jpeg",
          0.8
        );
      };
      img.onerror = () => resolve(file); // fallback to original on error
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadPhotos(uid: string) {
    if (!photoFiles.length) return [];

    const files = photoFiles.slice(0, 6);
    const urls: string[] = [];

    for (const file of files) {
      // Compress before upload
      const compressed = await compressImage(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `merchant_photos/${uid}/${Date.now()}_${safeName}`;
      const r = ref(storage, path);

      await uploadBytes(r, compressed, {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=3600",
      });

      const url = await getDownloadURL(r);
      urls.push(url);
    }

    return urls;
  }

  function removePhoto(url: string) {
    setPhotosToRemove(prev => [...prev, url]);
    setPhotoPreviewUrls(prev => prev.filter(u => u !== url));
    setUploadedPhotoUrls(prev => prev.filter(u => u !== url));
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

  async function checkInMobile() {
    if (!user || !merchantId) return;
    setBusy(true);
    setStatus("Getting your location...");
    try {
      if (!navigator.geolocation) throw new Error("Geolocation not supported.");
      const p = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      });
      const lat = p.coords.latitude;
      const lng = p.coords.longitude;
      const activeUntil = new Date(Date.now() + mobileDurationHours * 60 * 60 * 1000);

      const merchantRef = doc(getDb(), "merchants", merchantId);
      await runTransaction(getDb(), async (tx) => {
        tx.update(merchantRef, { mobileLat: lat, mobileLng: lng, mobileActiveUntil: activeUntil });
      });

      setMobileLat(lat);
      setMobileLng(lng);
      setMobileActiveUntil(activeUntil);
      setStatus(`✅ Checked in! You are active until ${activeUntil.toLocaleTimeString()}`);
    } catch (e: any) {
      setStatus(e?.message ?? "Could not check in.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateMobile() {
    if (!user || !merchantId) return;
    setBusy(true);
    setStatus("Deactivating mobile session...");
    try {
      const merchantRef = doc(getDb(), "merchants", merchantId);
      await runTransaction(getDb(), async (tx) => {
        tx.update(merchantRef, { mobileActiveUntil: new Date() });
      });
      setMobileActiveUntil(new Date());
      setStatus("✅ Mobile session deactivated.");
    } catch (e: any) {
      setStatus(e?.message ?? "Could not deactivate.");
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

      const cleanedWheel = (wheels[0]?.items ?? [])
        .map((r) => ({
          label: String(r.label ?? "").trim(),
          weight: Number(r.weight ?? 0),
        }))
        .filter((r) => r.label && r.weight > 0);

      if (!cleanedWheel.length)
        throw new Error("Add at least 1 prize to your first wheel.");

      const latNum = lat.trim() ? Number(lat) : undefined;
      const lngNum = lng.trim() ? Number(lng) : undefined;

      if (lat.trim() && Number.isNaN(latNum)) throw new Error("Lat must be a number.");
      if (lng.trim() && Number.isNaN(lngNum)) throw new Error("Lng must be a number.");

      // Photos behavior:
      // - If they selected new photos, upload and overwrite
      // - If they didn't, keep existing uploadedPhotoUrls (from merchant doc)
      let urls = uploadedPhotoUrls;

      let finalUrls = uploadedPhotoUrls.filter(u => !photosToRemove.includes(u));

      if (photoFiles.length) {
        setStatus("📸 Uploading photos…");
        try {
          // Timeout photo upload after 30s — don't let it block merchant creation
          const uploadPromise = uploadPhotos(user.uid);
          const timeoutPromise = new Promise<string[]>((_, reject) =>
            setTimeout(() => reject(new Error("Photo upload timed out")), 30000)
          );
          const newUrls = await Promise.race([uploadPromise, timeoutPromise]);
          finalUrls = [...finalUrls, ...newUrls];
          setUploadedPhotoUrls(finalUrls);
        } catch (photoErr: any) {
          // Photo upload failed or timed out — proceed without photos
          console.warn("Photo upload failed, creating merchant without photos:", photoErr);
          setStatus("⚠️ Photos couldn't upload — creating your profile without them (you can add photos later)…");
          // Keep finalUrls as-is (existing photos only, no new ones)
        }
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
        website: website.trim(),
        phone: phone.trim(),
        lat: latNum,
        lng: lngNum,
        wheel: cleanedWheel,
        wheels,
        photoUrls: finalUrls,
        mobileLat,
        mobileLng,
        mobileActiveUntil,
        isMobile,
        mobileServiceLat,
        mobileServiceLng,
        mobileServiceRadiusMiles: 25,
        businessHours,
        showBusinessHours,

        // ✅ NEW
        termsAccepted: true,
      });

      setMerchantId(res.merchantId);

      // ✅ Claim a founding merchant spot for NEW merchants only (not edits)
      if (!merchantId) {
        let foundingNum: number | null = null;
        try {
          foundingNum = await claimFoundingSpot(res.merchantId);
          if (foundingNum !== null) {
            setStatus(
              `✅ Merchant created! You're the owner. 🎉 You are Founding Merchant #${foundingNum} — welcome to the founding tier program!`
            );
          } else {
            setStatus("✅ Merchant created! You're the owner.");
          }
        } catch {
          setStatus("✅ Merchant created! You're the owner.");
        }
        // Send agreement emails (fire-and-forget — don't block UI)
        try {
          await fetch("/api/email/merchant-agreement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              merchantName: name.trim(),
              merchantId: res.merchantId,
              merchantEmail: user.email ?? "",
              foundingNumber: foundingNum,
              acceptedAt: new Date().toISOString(),
            }),
          });
        } catch (emailErr) {
          // Email failure is non-fatal — merchant is still created
          console.warn("Agreement email failed:", emailErr);
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
        padding: "14px 14px 40px",
        display: "grid",
        gap: 14,
        maxWidth: 600,
        margin: "0 auto",
        boxSizing: "border-box",
        width: "100%",
        overflowX: "hidden",
        contain: "layout",
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

      {/* FOUNDING TIER BRACKET */}
      <div style={{
        background: "linear-gradient(135deg, #15803d, #16a34a, #22c55e)",
        borderRadius: 14,
        padding: "14px 16px",
        color: "#ffffff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      }}>
        <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 10, letterSpacing: 0.2 }}>
          🏅 Founding Merchant Tier Program
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "3px 0", background: "rgba(255,255,255,0.12)", borderRadius: 10, overflow: "hidden", fontSize: 12 }}>
          {/* Header */}
          <div style={{ padding: "5px 8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>Tier</div>
          <div style={{ padding: "5px 8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>Merchants</div>
          <div style={{ padding: "5px 8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>Recognition</div>
          {/* Diamond */}
          <div style={{ padding: "6px 8px", fontWeight: 700 }}>💎 Diamond</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>First 20</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>Highest</div>
          {/* Platinum */}
          <div style={{ padding: "6px 8px", fontWeight: 700 }}>🏆 Platinum</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>#21–100</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>Early pioneer</div>
          {/* Gold */}
          <div style={{ padding: "6px 8px", fontWeight: 700 }}>🥇 Gold</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>#101–300</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>Early adopter</div>
          {/* Silver */}
          <div style={{ padding: "6px 8px", fontWeight: 700 }}>🥈 Silver</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>#301–1,000</div>
          <div style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>Founding member</div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
          Sign up now to lock in your tier. Founding merchants may receive future benefits, promotional advantages, or recognition as the platform grows.
        </div>
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
                gridTemplateColumns: "1fr",
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
            gridTemplateColumns: "1fr",
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
            gridTemplateColumns: "1fr",
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

        <div
          style={{
            display: "grid",
            gap: 10,
            marginTop: 10,
            gridTemplateColumns: "1fr",
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

        {/* Mobile business checkbox */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontWeight: 800 }}>
          <input
            type="checkbox"
            checked={isMobile}
            onChange={async (e) => {
              const checked = e.target.checked;
              setIsMobile(checked);
              if (checked && !mobileServiceSet) {
                try {
                  if (!navigator.geolocation) throw new Error("Geolocation not supported.");
                  setStatus("📍 Setting your 25-mile service area...");
                  const p = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
                  });
                  setMobileServiceLat(p.coords.latitude);
                  setMobileServiceLng(p.coords.longitude);
                  setMobileServiceSet(true);
                  if (!lat) setLat(String(p.coords.latitude));
                  if (!lng) setLng(String(p.coords.longitude));
                  setStatus("✅ Service area set — 25-mile radius from your current location. You can check in below when you're ready to go live.");
                } catch (err: any) {
                  setStatus(err?.message ?? "Could not get location for service area.");
                }
              }
            }}
            disabled={!user || busy}
            style={{ width: 18, height: 18 }}
          />
          <span>🚚 This is a mobile business (e.g., food truck)</span>
        </label>
        {isMobile && mobileServiceSet && (
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#16a34a' }}>
            ✅ Service area: 25-mile radius from your location
          </div>
        )}

        {isMobile && (
          <div style={{ marginTop: 14, padding: 14, border: '1px solid #ddd', borderRadius: 12, background: '#f9fafb' }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Mobile Check-in</div>
            {mobileActiveUntil && mobileActiveUntil > new Date() ? (
              <div>
                <div style={{ marginTop: 8, fontWeight: 700, color: '#16a34a' }}>
                  Active until {mobileActiveUntil.toLocaleTimeString()}
                </div>
                <button onClick={deactivateMobile} disabled={busy} style={{...btnRed(busy), marginTop: 10}}>
                  Deactivate Mobile Session
                </button>
              </div>
            ) : (
              <div>
                <div style={{ marginTop: 4, opacity: 0.8, fontSize: 14 }}>
                  Check in at your current location to appear on the Discover map for a set duration.
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="number"
                    value={mobileDurationHours}
                    onChange={e => setMobileDurationHours(Number(e.target.value))}
                    style={{...inputStyle(), width: '80px'}}
                    disabled={!user || busy}
                  />
                  <span style={{fontWeight: 700}}>hours</span>
                  <button onClick={checkInMobile} disabled={!user || busy} style={btnGold(busy)}>
                    Check-in Now
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="Additional terms and instructions (shown to customers)"
            style={{ ...inputStyle(), minHeight: 110, resize: "vertical" }}
            disabled={!user || busy}
            maxLength={1200}
          />
          <div style={{ fontWeight: 800, opacity: 0.7 }}>{about.length}/1200</div>

          {/* Optional website + phone */}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr" }}>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="Website (optional, e.g. yoursite.com)"
              style={inputStyle()}
              disabled={!user || busy}
              type="url"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number (optional)"
              style={inputStyle()}
              disabled={!user || busy}
              type="tel"
            />
          </div>
          <div style={{ fontWeight: 800, opacity: 0.6, fontSize: 13 }}>
            Website and phone are optional — if added, customers can tap to visit your site or call you directly from the wheel page.
          </div>

          {/* Business Hours — optional for mobile businesses */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 950, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
              Business Hours
              {isMobile && (
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "#6b7280" }}>
                  <input
                    type="checkbox"
                    checked={showBusinessHours}
                    onChange={(e) => setShowBusinessHours(e.target.checked)}
                    disabled={!user || busy}
                  />
                  Show hours publicly
                </label>
              )}
            </div>
            {(!isMobile || showBusinessHours) && <div style={{ display: "grid", gap: 6 }}>
              {DAYS.map((day) => (
                <div key={day} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label style={{ width: 90, fontWeight: 800, fontSize: 14 }}>{day.slice(0, 3)}</label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={businessHours[day]?.closed ?? false}
                      onChange={(e) => setBusinessHours(prev => ({ ...prev, [day]: { ...prev[day], closed: e.target.checked } }))}
                      disabled={!user || busy}
                    />
                    Closed
                  </label>
                  {!businessHours[day]?.closed && (
                    <>
                      <input
                        type="time"
                        value={businessHours[day]?.open ?? "09:00"}
                        onChange={(e) => setBusinessHours(prev => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))}
                        style={{ ...inputStyle(), width: 110, padding: "6px 8px", fontSize: 13 }}
                        disabled={!user || busy}
                      />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>to</span>
                      <input
                        type="time"
                        value={businessHours[day]?.close ?? "17:00"}
                        onChange={(e) => setBusinessHours(prev => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))}
                        style={{ ...inputStyle(), width: 110, padding: "6px 8px", fontSize: 13 }}
                        disabled={!user || busy}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>}
            <div style={{ fontWeight: 800, opacity: 0.6, fontSize: 13, marginTop: 6 }}>
              {isMobile ? "Optional — check the box above to display hours on your listing." : "Set your hours so customers know when you're open. Shown on Discover and your wheel page."}
            </div>
          </div>

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
                gridTemplateColumns: "repeat(2, 1fr)",
                width: "100%",
                boxSizing: "border-box",
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
                    minWidth: 0,
                    position: "relative",
                  }}
                >
                  <img
                    src={src}
                    alt={`preview-${i}`}
                    style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }}
                  />
                  <button
                    onClick={() => removePhoto(src)}
                    disabled={busy}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      border: "none",
                      background: "rgba(0,0,0,0.65)",
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 900,
                      cursor: busy ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      padding: 0,
                    }}
                    title="Remove photo"
                  >
                    ×
                  </button>
                  <div
                    style={{
                      padding: 10,
                      fontWeight: 900,
                      fontSize: 12,
                      opacity: 0.7,
                    }}
                  >
                    Photo {i + 1}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Note: existing uploaded photos are now shown in the preview grid above with delete buttons */}
        </div>

      </div>

      {/* Step 3: Wheels */}
      <div style={{ ...card(), opacity: locked ? 0.6 : 1 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Step 3 — Wheels (up to 3)</div>
        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 14 }}>
          Each wheel has its own unlock price and deal list. Higher weight = more likely.
        </div>

        {wheels.map((wc, wi) => {
          const usedPrices = new Set(wheels.map((w, idx) => idx !== wi ? w.spinPriceCents : null));
          return (
            <div key={wi} style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
              {/* Wheel header: price selector + remove */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 15 }}>Wheel {wi + 1}</div>
                <select
                  value={wc.spinPriceCents}
                  onChange={(e) => updateWheelPrice(wi, Number(e.target.value))}
                  disabled={!user || busy}
                  style={{ ...inputStyle(), width: "auto", flex: 1 }}
                >
                  {SPIN_PRICE_OPTIONS.map((opt) => (
                    <option key={opt.cents} value={opt.cents} disabled={usedPrices.has(opt.cents)}>
                      {opt.label}{usedPrices.has(opt.cents) ? " (in use)" : ""}
                    </option>
                  ))}
                </select>
                {wheels.length > 1 && (
                  <button onClick={() => removeWheelConfig(wi)} disabled={!user || busy} style={btnRed(!user || busy)}>
                    Remove wheel
                  </button>
                )}
              </div>

              {/* Prize rows */}
              <div style={{ display: "grid", gap: 8 }}>
                {wc.items.map((row, ii) => (
                  <div key={ii} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 80px auto", alignItems: "center" }}>
                    <input
                      value={row.label}
                      onChange={(e) => updateWheelItem(wi, ii, { label: e.target.value })}
                      placeholder="Deal label"
                      style={inputStyle()}
                      disabled={!user || busy}
                    />
                    <input
                      value={String(row.weight)}
                      onChange={(e) => updateWheelItem(wi, ii, { weight: Number(e.target.value || 0) })}
                      placeholder="Weight"
                      style={inputStyle()}
                      disabled={!user || busy}
                    />
                    <button
                      onClick={() => removeWheelItem(wi, ii)}
                      disabled={!user || busy || wc.items.length <= 1}
                      style={btnRed(!user || busy || wc.items.length <= 1)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button onClick={() => addWheelItem(wi)} disabled={!user || busy} style={{ ...btnGray(!user || busy), marginTop: 10, fontSize: 13 }}>
                + Add deal
              </button>
            </div>
          );
        })}

        {wheels.length < 3 && (
          <button
            onClick={addNewWheel}
            disabled={!user || busy}
            style={{ ...btnGold(!user || busy), marginTop: 14, width: "100%" }}
          >
            + Add another wheel
          </button>
        )}
      </div>

      {/* ✅ NEW: Merchant Terms */}
      <div style={{ ...card(), opacity: locked ? 0.6 : 1 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Step 4 — Founding Merchant Agreement</div>
        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 8 }}>
          Required to publish a wheel.
        </div>

        {/* Terms summary bullets */}
        <ul style={{ fontSize: 13, lineHeight: 1.7, marginTop: 12, paddingLeft: 18, color: "#374151" }}>
          <li>Deals are <b>not cash</b> and have no cash value.</li>
          <li>A <b>deal is always awarded</b> on every unlock — no "no deal" outcomes.</li>
          <li>Your business handles all <b>customer disputes</b> related to redemption.</li>
          <li><b>Free to sign up</b> — WheelDeals earns only from the platform split per deal unlocked.</li>
        </ul>

        {/* Founding Tier summary */}
        <div style={{ marginTop: 12, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>🏅 Founding Merchant Tier Program</div>
          <div style={{ lineHeight: 1.65 }}>
            <div>💎 <b>Diamond</b> — First 20 merchants</div>
            <div>🏆 <b>Platinum</b> — Merchants #21–100</div>
            <div>🥇 <b>Gold</b> — Merchants #101–300</div>
            <div>🥈 <b>Silver</b> — Merchants #301–1,000</div>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#0369a1" }}>
            Founding merchants may receive future benefits, promotional advantages, or recognition based on the success and growth of the Wheel Deals platform.
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 13 }}>
          <a href="/merchant/terms" target="_blank" style={{ color: "#d97706", fontWeight: 800, textDecoration: "underline" }}>
            Read the full Founding Merchant Terms &amp; Conditions ↗
          </a>
        </div>

        <label
          style={{
            marginTop: 14,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            fontWeight: 850,
            lineHeight: 1.35,
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={acceptMerchantTerms}
            onChange={(e) => setAcceptMerchantTerms(e.target.checked)}
            disabled={!user || busy}
            style={{ marginTop: 3, width: 16, height: 16 }}
          />
          <span>
            I have read and agree to the{" "}
            <a href="/merchant/terms" target="_blank" style={{ color: "#d97706" }}>Founding Merchant Terms &amp; Conditions</a>.
          </span>
        </label>

        {!acceptMerchantTerms && user && (
          <div style={{ marginTop: 10, fontWeight: 900, color: "#b91c1c", fontSize: 13 }}>
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

            {/* Flyer & Shareable Link Section */}
            <div style={{ width: "100%", marginTop: 16, padding: 16, background: "#fffbeb", border: "2px solid #fde68a", borderRadius: 14 }}>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8, color: "#92400e" }}>📄 Your In-Store Flyer & Shareable Link</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <a
                  href={`/api/flyer/${merchantId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...btnGold(false), textDecoration: "none", display: "inline-block", textAlign: "center" } as any}
                >
                  🖨️ Print In-Store Flyer
                </a>
                <a
                  href={`/m/${merchantId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...linkGold(), display: "inline-block" } as any}
                >
                  🔗 View Shareable Page →
                </a>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                <strong>Share this link online:</strong>{" "}
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#d97706", wordBreak: "break-all" }}>
                  {typeof window !== "undefined" ? window.location.origin : ""}/m/{merchantId}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
                Print the flyer and put it in your store — customers scan the QR to find your deals!
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
