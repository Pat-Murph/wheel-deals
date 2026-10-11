import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { authenticatedBoostOwner, merchantIdFrom, boostFailure, BoostRequestError } from "@/lib/boostAdmin";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const uid = await authenticatedBoostOwner(req);
    const merchantId = merchantIdFrom((await req.json()).merchantId);
    const merchantRef = adminDb.collection("merchants").doc(merchantId);
    const result = await adminDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(merchantRef);
      if (!snapshot.exists) throw new BoostRequestError("Business not found.", 404);
      const merchant = snapshot.data()!;
      if (merchant.ownerUid !== uid) throw new BoostRequestError("Only the business owner can end this Boost.", 403);
      if (!merchant.boostActive) return { ended: false };
      // Keep the remaining count for reference, but turn off free-deal access
      // atomically. Issued codes and customer usage history are not modified.
      tx.update(merchantRef, { boostActive: false, boostEndedAt: new Date().toISOString() });
      return { ended: true };
    });
    return NextResponse.json({ ok: true, boostActive: false, ...result });
  } catch (error: unknown) {
    const failure = boostFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
