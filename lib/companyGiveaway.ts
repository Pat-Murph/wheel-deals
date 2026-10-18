// Public Firebase account UID verified from the Wheel Deals company merchant.
// UID is not a secret. Merchant ownership is protected by Firestore rules.
// Matching the account, not its editable business name/email, keeps this policy
// exclusive to pat@wheeldealsapp.com's existing company account across renames.
export const WHEEL_DEALS_COMPANY_OWNER_UID = "qB7Qs2LInwfkIWPjxbewKoGSJIi2";
export const COMPANY_GIVEAWAY_COMING_SOON = "More giveaways coming soon";

export function isCompanyGiveaway(merchant: { ownerUid?: unknown } | null | undefined): boolean {
  return merchant?.ownerUid === WHEEL_DEALS_COMPANY_OWNER_UID;
}
