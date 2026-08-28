export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
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

export async function GET(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const merchantId = new URL(req.url).searchParams.get("merchantId")?.trim() ?? "";
    if (!merchantId) {
      return NextResponse.json({ ok: false, error: "Missing business." }, { status: 400 });
    }

    const snapshot = await adminDb
      .collection("shareRewards")
      .where("uid", "==", decoded.uid)
      .get();
    const now = new Date();

    const rewards = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((reward: any) => {
        const expiresAt = asDate(reward.expiresAt);
        return (
          reward.merchantId === merchantId &&
          reward.status === "available" &&
          Boolean(expiresAt && expiresAt > now)
        );
      })
      .sort((a: any, b: any) => {
        const aTime = asDate(a.earnedAt)?.getTime() ?? 0;
        const bTime = asDate(b.earnedAt)?.getTime() ?? 0;
        return aTime - bTime;
      });

    const reward: any = rewards[0] ?? null;
    return NextResponse.json(
      {
        ok: true,
        reward: reward
          ? {
              rewardId: reward.id,
              sourceSpinId: String(reward.sourceSpinId ?? reward.id),
              spinPriceCents: Number(reward.sourceSpinPriceCents ?? 0),
              expiresAt: asDate(reward.expiresAt)?.toISOString() ?? null,
            }
          : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("Share reward lookup failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Could not load the share reward." },
      { status: 400 }
    );
  }
}
