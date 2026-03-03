import { collection, getCountFromServer, query, where } from "firebase/firestore";
import { getDb } from "./firebase";

export async function getRedeemRateForMerchantLast7Days(
  merchantId: string,
  dateKeys: string[]
) {
  // issued count
  const issuedQ = query(
    collection(getDb(), "spins"),
    where("merchantId", "==", merchantId),
    where("dateKey", "in", dateKeys)
  );
  const issuedSnap = await getCountFromServer(issuedQ);
  const issued = issuedSnap.data().count;

  if (!issued) return 0;

  // redeemed count
  const redeemedQ = query(
    collection(getDb(), "spins"),
    where("merchantId", "==", merchantId),
    where("dateKey", "in", dateKeys),
    where("status", "==", "redeemed")
  );
  const redeemedSnap = await getCountFromServer(redeemedQ);
  const redeemed = redeemedSnap.data().count;

  return redeemed / issued;
}
