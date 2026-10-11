const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Use the isolated validation tooling; it is intentionally not an app dependency.
const tooling = process.env.BOOST_RULES_TOOLING;
if (!tooling) {
  test('Firestore emulator security coverage (run with BOOST_RULES_TOOLING)', { skip: true }, () => {});
} else {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require(path.join(tooling, '@firebase/rules-unit-testing'));
  const { doc, setDoc, updateDoc, getDoc } = require(path.join(tooling, 'firebase/firestore'));
  test('Firestore keeps Boost server-owned while preserving merchant onboarding, editing and pause controls', async () => {
    const env = await initializeTestEnvironment({
      projectId: 'demo-wheel-deals-boost',
      firestore: { host: '127.0.0.1', port: 8093, rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
    });
    try {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'merchants/shop'), { ownerUid: 'owner', active: true, name: 'Shop', boostActive: true, boostFreeSpinsRemaining: 10 });
        await setDoc(doc(db, 'merchants/shop/staff/staff'), { active: true });
      });
      const owner = env.authenticatedContext('owner').firestore();
      const staff = env.authenticatedContext('staff').firestore();
      const other = env.authenticatedContext('other').firestore();
      await assertSucceeds(updateDoc(doc(owner, 'merchants/shop'), { about: 'Updated description', active: false }));
      await assertSucceeds(updateDoc(doc(staff, 'merchants/shop'), { name: 'Updated Shop' }));
      await assertFails(updateDoc(doc(other, 'merchants/shop'), { name: 'Intruder' }));
      for (const field of ['boostActive', 'boostFreeSpinsRemaining', 'boostUnlocksGranted', 'boostWheelPriceCents', 'boostMode', 'boostPurchasedAt', 'boostEndedAt', 'boostPaidSessionId', 'ownerUid']) {
        await assertFails(updateDoc(doc(owner, 'merchants/shop'), { [field]: field === 'ownerUid' ? 'other' : 500 }));
        await assertFails(updateDoc(doc(staff, 'merchants/shop'), { [field]: 500 }));
      }
      const base = { ownerUid: 'owner', active: true, name: 'New Shop', category: 'Food', city: 'Las Vegas' };
      await assertSucceeds(setDoc(doc(owner, 'merchants/newshop'), base));
      await assertFails(setDoc(doc(owner, 'merchants/minted'), { ...base, boostActive: true, boostFreeSpinsRemaining: 500 }));
      await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'merchants/shop')));
      assert.equal((await getDoc(doc(owner, 'merchants/shop'))).data().boostFreeSpinsRemaining, 10);
    } finally {
      await env.cleanup();
    }
  });
}
