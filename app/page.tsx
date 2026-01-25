import WheelDealsClient from "../components/WheelDealsClient";

export default function Page({
  searchParams,
}: {
  searchParams?: { merchantId?: string };
}) {
  const merchantId = searchParams?.merchantId;

  return (
    <main style={{ padding: 24, display: "grid", justifyItems: "center" }}>
      <WheelDealsClient initialMerchantId={merchantId} />
    </main>
  );
}
