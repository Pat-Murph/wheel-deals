import { redirect } from "next/navigation";
import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebaseAdmin";

interface Props {
  params: Promise<{ merchantId: string }>;
}

// Generate dynamic metadata for social sharing (OG tags)
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { merchantId } = await params;
  let merchantName = "Wheel Deals";
  let merchantCity = "";
  let description = "Unlock exclusive deals on Wheel Deals!";

  try {
    const db = getAdminDb();
    const snap = await db.collection("merchants").doc(merchantId).get();
    if (snap.exists) {
      const data = snap.data()!;
      merchantName = data.name ?? merchantName;
      merchantCity = data.city ?? "";
      description = `Unlock exclusive deals at ${merchantName}${merchantCity ? ` in ${merchantCity}` : ""} on Wheel Deals!`;
    }
  } catch {
    // Use defaults
  }

  return {
    title: `${merchantName} — Wheel Deals`,
    description,
    openGraph: {
      title: `${merchantName} — Unlock Deals on Wheel Deals`,
      description,
      type: "website",
    },
  };
}

export default async function MerchantLandingPage({ params }: Props) {
  const { merchantId } = await params;

  // Redirect to the wheel page for this merchant
  redirect(`/wheel?merchantId=${merchantId}`);
}
