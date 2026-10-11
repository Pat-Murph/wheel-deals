# Company Boost controls — deployment notes

## Scope

- Only the canonical, enabled Firebase Auth account for `pat@wheeldealsapp.com` can choose a custom positive whole-number allocation. The server looks up the actual UID; it does not trust browser email, submitted UID, merchant name or profile flags.
- The quantity input starts at 500 as a suggestion. Nothing activates automatically. Other founding merchants retain 10; the paid merchant Boost remains $5 for 10.
- Owners can end their own Boost. New reservations and unfinished claims stop, already-issued deal codes remain valid, and the business listing's live/paused state is unchanged.
- Remaining count is retained for reference on End, but a new campaign replaces the allocation (unused counts do not carry over).
- Current mobile 25-mile service-area and check-in mode choices remain. Customer installation/UID, new cycle plus 24-hour wait rules remain.
- Paid verification uses per-session receipts and a durable manual-end marker, so old confirmation links cannot refill or overwrite the new campaign. No payment is made by this work.

## Required rollout

1. Obtain the user's established approval before production deployment.
2. Inspect **live** Firebase Firestore rules. The browser was not logged into Firebase during implementation; the repository rule file cannot be assumed identical to current live rules.
3. Back up live rules, then merge only the Boost protections from this source diff. Do not overwrite unrelated live rules with the repository file.
   - Block merchant create with Boost fields: `boostActive`, `boostFreeSpinsRemaining`, `boostUnlocksGranted`, `boostWheelPriceCents`, `boostMode`, `boostPurchasedAt`, `boostEndedAt`, `boostPaidSessionId`.
   - On merchant update, block changes to those fields and `ownerUid`, preserving the live owner/staff authorization predicate and other constraints.
   - No client access to `boostPayments` is necessary; only Admin SDK writes it. Check the live rules have no broad wildcard client grants covering it.
4. Deploy the updated application as a coordinated change. If authenticated Git CLI is unavailable, browser-publish the new `lib/boostAdmin.ts` first, then endpoints and dashboard; finally align a clean worktree to `origin/main` and verify each changed file matches. Avoid force pushing local history over browser commits.
5. Verify Vercel succeeds and safe requests without auth to activation/capability/end return 401. Read the company dashboard while signed into its actual owner account; confirm quantity input and 25-mile option, and ordinary owners lack custom controls.
6. Do not activate the company's proposed 500-unlock promotion without separate user instruction. Deployment changes controls only.

## Validation performed locally

- 17 Node regression tests passed: company vs ordinary ownership/quantities, rendered dashboard controls, invalid auth/quantity, End/issued-code retention, paid replay/active campaign preservation, iPhone collision/identity persistence, customer cycle/24-hour limits and reservation restart behavior.
- Separate Firestore emulator test passed: normal merchant create/edit/pause and staff edits allowed; direct Boost creation or update and `ownerUid` changes blocked; public merchant reads preserved.
- Targeted new/changed API helper lint passed. Existing dashboard-wide lint debt was not broadly refactored.
- Next.js production build and TypeScript validation passed; `git diff --check` passed.

To run tests: `node --test tests/boost-controls.test.cjs tests/boost-dashboard.test.cjs tests/ios-free-unlock.test.cjs`.
The isolated rules test needs `BOOST_RULES_TOOLING` pointing to a directory containing `@firebase/rules-unit-testing` and Firebase SDK, with a Firestore emulator on localhost:8093. Validation tooling resides outside this app at `/home/ubuntu/wheel-deals-boost-validation` and is not a production dependency.
