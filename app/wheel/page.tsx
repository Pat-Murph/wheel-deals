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
    <main style={{ width: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <WheelDealsClient initialMerchantId={merchantId} />
    </main>
  );
}
