import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

/**
 * Fires when an unlock is created.
 * Updates merchant daily stats server-side.
 */
export const onSpinCreated = onDocumentCreated(
  "spins/{spinId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    const merchantId = data.merchantId;
    const dateKey = data.dateKey;

    if (!merchantId || !dateKey) return;

    const statsRef = db
      .collection("merchantStats")
      .doc(merchantId)
      .collection("daily")
      .doc(dateKey);

    await db.runTransaction(async (tx) => {
      const statsSnap = await tx.get(statsRef);

      if (!statsSnap.exists) {
        tx.set(statsRef, {
          merchantId,
          dateKey,
          spinsCount: 1,
          revenueCents: 70,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        const d = statsSnap.data()!;
        tx.update(statsRef, {
          spinsCount: (d.spinsCount ?? 0) + 1,
          revenueCents: (d.revenueCents ?? 0) + 70,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
  }
);
