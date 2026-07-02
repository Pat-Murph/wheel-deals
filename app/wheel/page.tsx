export const dynamic = "force-dynamic";
import WheelDealsClient from "../../components/WheelDealsClient";

export default async function WheelPage({
  searchParams,
}: {
  searchParams?: Promise<{ merchantId?: string; eventId?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const merchantId = sp.merchantId;
  const eventId = sp.eventId;

  return (
    <main style={{ width: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <WheelDealsClient initialMerchantId={merchantId} initialEventId={eventId} />
    </main>
  );
}
