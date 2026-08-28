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

export async function POST(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const body = await req.json().catch(() => ({}));
    const sourceSpinId = String(body?.sourceSpinId ?? "").trim();
    const merchantId = String(body?.merchantId ?? "").trim();

    if (!sourceSpinId || !merchantId) {
      return NextResponse.json(
        { ok: false, error: "Missing source unlock or business." },
        { status: 400 }
      );
    }

    const sourceRef = adminDb.collection("spins").doc(sourceSpinId);
    const rewardRef = adminDb.collection("shareRewards").doc(sourceSpinId);
    const now = new Date();
    const rewardExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const result = await adminDb.runTransaction(async (tx) => {
      const [sourceSnap, rewardSnap] = await Promise.all([
        tx.get(sourceRef),
        tx.get(rewardRef),
      ]);

      if (!sourceSnap.exists) throw new Error("Source unlock not found.");
      const source = sourceSnap.data() as any;

      if (source.uid !== decoded.uid) throw new Error("This unlock belongs to another customer.");
      if (source.merchantId !== merchantId) throw new Error("Business mismatch.");

      const sourceExpiresAt = asDate(source.expiresAt);
      const sourceIsActive =
        source.status === "issued" &&
        source.redeemed !== true &&
        (!sourceExpiresAt || sourceExpiresAt > now);
      if (!sourceIsActive) throw new Error("This deal is no longer active.");

      const sourceType = String(source.type ?? "");
      const isPaid =
        sourceType === "paid" ||
        (!sourceType && Boolean(source.sessionId) && Number(source.spinPriceCents ?? 0) > 0);
      const isBoost = sourceType === "free-boost";
      if (!isPaid && !isBoost) {
        return {
          eligible: false,
          alreadyClaimed: false,
          status: "ineligible",
          message: "This unlock can be shared, but it cannot earn another free unlock.",
        };
      }

      if (rewardSnap.exists) {
        const reward = rewardSnap.data() as any;
        return {
          eligible: true,
          alreadyClaimed: true,
          status: String(reward.status ?? "available"),
          rewardId: rewardRef.id,
          expiresAt: asDate(reward.expiresAt)?.toISOString() ?? null,
          message:
            reward.status === "used"
              ? "The free unlock from this share has already been used."
              : "Your free unlock from this share is ready.",
        };
      }

      tx.set(rewardRef, {
        sourceSpinId,
        sourceType: isBoost ? "free-boost" : "paid",
        sourceSpinPriceCents: isPaid ? Number(source.spinPriceCents ?? 135) : 0,
        merchantId,
        uid: decoded.uid,
        status: "available",
        earnedAt: FieldValue.serverTimestamp(),
        expiresAt: rewardExpiresAt,
      });
      tx.set(
        sourceRef,
        {
          shareRewardClaimed: true,
          shareRewardClaimedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        eligible: true,
        alreadyClaimed: false,
        status: "available",
        rewardId: rewardRef.id,
        expiresAt: rewardExpiresAt.toISOString(),
        message: "Shared! Your free unlock is ready.",
      };
    });

    return NextResponse.json({ ok: true, ...result }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    const message = error?.message ?? "Could not create the share reward.";
    const status =
      message.includes("another customer") || message.includes("mismatch") ? 403 :
      message.includes("not found") ? 404 : 400;
    console.error("Share reward claim failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
