import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { adminDb } from "@/lib/firebaseAdmin";

const FREE_SPINS_GRANTED = 10;

export async function POST(req: Request) {
  try {
    const { merchantId, uid, boostWheelPriceCents, boostMode } = await req.json();

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    const mSnap = await adminDb.collection("merchants").doc(merchantId).get();
    if (!mSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const data = mSnap.data()!;

    // Verify this merchant is a Diamond founding merchant (first 20)
    const foundingNumber = data.foundingNumber;
    if (!foundingNumber || foundingNumber > 20) {
      return NextResponse.json({ error: "Only Diamond founding merchants (first 20) get free boosts" }, { status: 403 });
    }

    // Verify the requesting user is the owner
    if (data.ownerUid !== uid) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Activate boost for free
    await adminDb.collection("merchants").doc(merchantId).update({
      boostActive: true,
      boostFreeSpinsRemaining: FREE_SPINS_GRANTED,
      boostWheelPriceCents: boostWheelPriceCents ?? 135,
      boostMode: boostMode === 'always' ? 'always' : 'checkin',
      boostPurchasedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, message: "Free boost activated for Diamond merchant" });
  } catch (err: any) {
    console.error("Free boost activation error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
