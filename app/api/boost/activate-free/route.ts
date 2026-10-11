import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  authenticatedBoostOwner, isCompanyBoostOwner, merchantIdFrom,
  boostQuantity, boostFailure, BoostRequestError,
} from "@/lib/boostAdmin";
export const dynamic = "force-dynamic";

// The dashboard uses this server-owned capability rather than trusting an email
// or privilege flag in the browser or merchant document.
export async function GET(req: Request) {
  try {
    const uid = await authenticatedBoostOwner(req);
    const merchantId = merchantIdFrom(new URL(req.url).searchParams.get("merchantId"));
    const snapshot = await adminDb.collection("merchants").doc(merchantId).get();
    if (!snapshot.exists) throw new BoostRequestError("Business not found.", 404);
    if (snapshot.data()?.ownerUid !== uid) throw new BoostRequestError("Only the business owner can manage Boost.", 403);
    return NextResponse.json(
      { ok: true, customQuantityAllowed: await isCompanyBoostOwner(uid) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const failure = boostFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

export async function POST(req: Request) {
  try {
    const uid = await authenticatedBoostOwner(req);
    const body = await req.json();
    const merchantId = merchantIdFrom(body.merchantId);
    const companyOwner = await isCompanyBoostOwner(uid);
    const quantity = boostQuantity(body.boostUnlockCount, companyOwner);
    const wheelPrice = body.boostWheelPriceCents ?? 135;
    if (typeof wheelPrice !== "number" || !Number.isSafeInteger(wheelPrice) || wheelPrice < 1) {
      throw new BoostRequestError("Choose a valid deal wheel.", 400);
    }
    const merchantRef = adminDb.collection("merchants").doc(merchantId);
    const boost = await adminDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(merchantRef);
      if (!snapshot.exists) throw new BoostRequestError("Business not found.", 404);
      const merchant = snapshot.data()!;
      if (merchant.ownerUid !== uid) throw new BoostRequestError("Only the business owner can manage Boost.", 403);
      const foundingNumber = Number(merchant.foundingNumber);
      if (!companyOwner && !(foundingNumber >= 1 && foundingNumber <= 300)) {
        throw new BoostRequestError("Only founding merchants (first 300) get free boosts.", 403);
      }
      if (merchant.boostActive) throw new BoostRequestError("Boost is already active. End it before starting a new one.", 409);
      const values = {
        boostActive: true,
        boostFreeSpinsRemaining: quantity,
        boostUnlocksGranted: quantity,
        boostWheelPriceCents: wheelPrice,
        boostMode: merchant.isMobile && body.boostMode === "always" ? "always" : "checkin",
        boostPurchasedAt: new Date().toISOString(),
      };
      tx.update(merchantRef, values);
      return values;
    });
    return NextResponse.json({ ok: true, ...boost });
  } catch (error: unknown) {
    const failure = boostFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
