export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, getAdminAuth } from "@/lib/firebaseAdmin";

function bearerToken(req: Request): string | null {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function makeCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let index = 0; index < len; index += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function dateKeyLA(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export async function POST(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const body = await req.json().catch(() => ({}));
    const rewardId = String(body?.rewardId ?? "").trim();
    const merchantId = String(body?.merchantId ?? "").trim();
    const prizeLabel = String(body?.prizeLabel ?? "").trim();
    if (!rewardId || !merchantId || !prizeLabel) {
      return NextResponse.json(
        { ok: false, error: "Missing reward, business, or deal." },
        { status: 400 }
      );
    }

    const rewardRef = adminDb.collection("shareRewards").doc(rewardId);
    const spinRef = adminDb.collection("spins").doc();
    const code = makeCode();
    const codeRef = adminDb.collection("redemptionCodes").doc(code);
    const now = new Date();
    const dealExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const dayKey = dateKeyLA(now);
    const dailyStatsRef = adminDb
      .collection("merchantStats")
      .doc(merchantId)
      .collection("daily")
      .doc(dayKey);

    const result = await adminDb.runTransaction(async (tx) => {
      const rewardSnap = await tx.get(rewardRef);
      if (!rewardSnap.exists) throw new Error("Share reward not found.");
      const reward = rewardSnap.data() as any;

      if (reward.uid !== decoded.uid) throw new Error("This reward belongs to another customer.");
      if (reward.merchantId !== merchantId) throw new Error("Business mismatch.");
      if (reward.status !== "available") throw new Error("This free unlock was already used.");

      const rewardExpiresAt = asDate(reward.expiresAt);
      if (!rewardExpiresAt || rewardExpiresAt <= now) {
        throw new Error("This share reward has expired.");
      }

      tx.update(rewardRef, {
        status: "used",
        usedAt: FieldValue.serverTimestamp(),
        resultingSpinId: spinRef.id,
      });

      tx.set(spinRef, {
        merchantId,
        uid: decoded.uid,
        prizeLabel,
        status: "issued",
        redeemed: false,
        code,
        type: "share-reward",
        shareRewardEligible: false,
        rewardSourceSpinId: String(reward.sourceSpinId ?? rewardId),
        shareRewardId: rewardId,
        spinPriceCents: 0,
        revenueCents: 0,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: dealExpiresAt,
        dateKey: dayKey,
      });

      tx.set(codeRef, {
        merchantId,
        spinId: spinRef.id,
        status: "issued",
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(
        dailyStatsRef,
        {
          dateKey: dayKey,
          spinsCount: FieldValue.increment(1),
          shareRewardUnlocksCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        spinId: spinRef.id,
        code,
        expiresAt: dealExpiresAt.toISOString(),
        type: "share-reward",
      };
    });

    return NextResponse.json({ ok: true, ...result }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    const message = error?.message ?? "Could not use the share reward.";
    const status =
      message.includes("another customer") || message.includes("mismatch") ? 403 :
      message.includes("not found") ? 404 : 400;
    console.error("Share reward consume failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
