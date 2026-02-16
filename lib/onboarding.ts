// lib/onboarding.ts
import { db } from "./firebase";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";

type WheelRow = { label: string; weight: number };

type CreateMerchantArgs = {
  uid: string;
  name: string;
  category: string;
  city: string;
  address?: string;
  about?: string;
  lat?: number;
  lng?: number;
  wheel: WheelRow[];
  photoUrls?: string[];
};

export async function createMerchantForUser(args: CreateMerchantArgs) {
  const {
    uid,
    name,
    category,
    city,
    address = "",
    about = "",
    lat,
    lng,
    wheel,
    photoUrls = [],
  } = args;

  if (!uid) throw new Error("Missing uid.");
  if (!name.trim()) throw new Error("Business name is required.");
  if (!category.trim()) throw new Error("Category is required.");
  if (!city.trim()) throw new Error("City is required.");
  if (!Array.isArray(wheel) || wheel.length < 1) throw new Error("Wheel must have at least 1 prize.");

  const cleanedWheel = wheel
    .map((w) => ({
      label: String(w.label ?? "").trim(),
      weight: Number(w.weight ?? 0),
    }))
    .filter((w) => w.label && w.weight > 0);

  if (!cleanedWheel.length) throw new Error("Wheel must have at least 1 prize with weight > 0.");

  const merchantRef = doc(collection(db, "merchants"));
  const staffRef = doc(db, "merchants", merchantRef.id, "staff", uid);
  const userRef = doc(db, "users", uid);
  const wheelRef = doc(db, "merchants", merchantRef.id, "config", "wheel");

  await runTransaction(db, async (tx) => {
    tx.set(merchantRef, {
      active: true,
      ownerUid: uid,
      name: name.trim(),
      nameLower: name.trim().toLowerCase(),
      category: category.trim(),
      categoryLower: category.trim().toLowerCase(),
      city: city.trim(),
      cityLower: city.trim().toLowerCase(),
      address: address.trim(),
      about: about.trim(),
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      photoUrls: photoUrls.slice(0, 12),

      // ✅ ADD THIS so customer pages see the correct wheel
      wheel: cleanedWheel,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    tx.set(staffRef, {
      active: true,
      role: "owner",
      createdAt: serverTimestamp(),
    });

    tx.set(
      userRef,
      { merchantId: merchantRef.id, updatedAt: serverTimestamp() },
      { merge: true }
    );

    // keep your config doc too
    tx.set(wheelRef, {
      items: cleanedWheel,
      updatedAt: serverTimestamp(),
    });
  });

  return { merchantId: merchantRef.id };
}
