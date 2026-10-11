import { getAdminAuth } from "@/lib/firebaseAdmin";

const COMPANY_EMAIL = "pat@wheeldealsapp.com";
export const STANDARD_BOOST_UNLOCKS = 10;

export class BoostRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function merchantIdFrom(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("/") || value.length > 1500) {
    throw new BoostRequestError("Missing or invalid business.", 400);
  }
  return value;
}

export async function authenticatedBoostOwner(req: Request): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new BoostRequestError("Please sign in to manage Boost.", 401);
  try {
    return (await getAdminAuth().verifyIdToken(token, true)).uid;
  } catch {
    throw new BoostRequestError("Your session expired. Please sign in again.", 401);
  }
}

// Match the UID of Firebase's real company account, never a client-submitted
// email, merchant name, or editable merchant profile field.
export async function isCompanyBoostOwner(uid: string): Promise<boolean> {
  try {
    const companyAccount = await getAdminAuth().getUserByEmail(COMPANY_EMAIL);
    return !companyAccount.disabled && companyAccount.uid === uid;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found") return false;
    throw error;
  }
}

export function boostQuantity(value: unknown, companyOwner: boolean): number {
  if (value === undefined) return STANDARD_BOOST_UNLOCKS;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new BoostRequestError("Choose a positive whole number of Boost unlocks.", 400);
  }
  if (!companyOwner && value !== STANDARD_BOOST_UNLOCKS) {
    throw new BoostRequestError("Only the Wheel Deals company account can choose a custom Boost quantity.", 403);
  }
  return value;
}

export function boostFailure(error: unknown): { error: string; status: number } {
  if (error instanceof BoostRequestError) return { error: error.message, status: error.status };
  console.error("Boost management failed:", error);
  return { error: "Could not update Boost. Please try again.", status: 500 };
}
