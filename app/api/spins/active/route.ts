import { NextRequest, NextResponse } from "next/server";
import { adminDb, getAdminAuth } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof (value as any)?.toDate === "function") {
    const date = (value as any).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = req.nextUrl.searchParams.get("merchantId")?.trim();
    if (!merchantId) {
      return noStoreJson({ ok: false, error: "Missing merchantId" }, 400);
    }

    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    if (!token) {
      return noStoreJson({ ok: false, error: "Authentication required" }, 401);
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const snapshot = await adminDb.collection("spins").where("uid", "==", decoded.uid).get();
    const nowMs = Date.now();

    const deals = snapshot.docs
      .map((doc) => {
        const data = doc.data() as Record<string, any>;
        const expiresAt = asDate(data.expiresAt);
        const createdAt = asDate(data.createdAt);
        return {
          spinId: doc.id,
          merchantId: String(data.merchantId ?? ""),
          prizeLabel: String(data.prizeLabel ?? "Deal"),
          code: String(data.code ?? ""),
          status: String(data.status ?? ""),
          redeemed: data.redeemed === true,
          expiresAt,
          createdAt,
          type: String(data.type ?? "paid"),
        };
      })
      .filter((deal) => {
        return (
          deal.merchantId === merchantId &&
          deal.code.length > 0 &&
          deal.status === "issued" &&
          !deal.redeemed &&
          Boolean(deal.expiresAt) &&
          (deal.expiresAt as Date).getTime() > nowMs
        );
      })
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .map((deal) => ({
        spinId: deal.spinId,
        prizeLabel: deal.prizeLabel,
        code: deal.code,
        expiresAt: (deal.expiresAt as Date).toISOString(),
        createdAt: deal.createdAt?.toISOString() ?? null,
        type: deal.type,
      }));

    return noStoreJson({ ok: true, deals });
  } catch (error: any) {
    const isAuthError = String(error?.code ?? "").startsWith("auth/");
    console.error("Active deals lookup failed:", error);
    return noStoreJson(
      { ok: false, error: isAuthError ? "Authentication expired" : "Could not load active deals" },
      isAuthError ? 401 : 500
    );
  }
}
