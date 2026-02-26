// lib/onboarding.ts
import { db } from "./firebase";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

type WheelRow = { label: string; weight: number };

type UpdateMerchantArgs = {
  uid: string;
  merchantId: string;
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

export async function updateMerchantForUser(args: UpdateMerchantArgs) {
  const {
    uid,
    merchantId,
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
  if (!merchantId) throw new Error("Missing merchantId.");
  if (!name.trim()) throw new Error("Business name is required.");
  if (!category.trim()) throw new Error("Category is required.");
  if (!city.trim()) throw new Error("City is required.");
  if (!Array.isArray(wheel) || wheel.length < 1) throw new Error("Wheel must have at least 1 prize.");

  const merchantRef = doc(db, "merchants", merchantId);
  const staffRef = doc(db, "merchants", merchantId, "staff", uid);
  const wheelRef = doc(db, "merchants", merchantId, "config", "wheel");

  await runTransaction(db, async (tx) => {
    // Ensure caller is staff (rules also enforce, but this gives clearer errors)
    const staffSnap = await tx.get(staffRef);
    if (!staffSnap.exists() || staffSnap.data()?.active !== true) {
      throw new Error("You do not have permission to edit this merchant (staff missing/inactive).");
    }

    tx.update(merchantRef, {
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
      updatedAt: serverTimestamp(),
    });

    tx.set(
      wheelRef,
      {
        items: wheel.map((w) => ({
          label: String(w.label ?? "").trim(),
          weight: Number(w.weight ?? 0),
        })),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { merchantId };
}
