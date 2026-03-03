export const dynamic = "force-dynamic";
import WheelDealsClient from "../../components/WheelDealsClient";

export default async function WheelPage({
  searchParams,
}: {
  searchParams?: Promise<{ merchantId?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const merchantId = sp.merchantId;

  return (
    <main style={{ padding: 24, display: "grid", justifyItems: "center" }}>
      <WheelDealsClient initialMerchantId={merchantId} />
    </main>
  );
}
