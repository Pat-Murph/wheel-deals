/**
 * Wheel Deals — Unlock price tiers and payout splits.
 *
 * Stripe fee estimate: 2.9% + $0.30 flat per transaction.
 * Merchant payout is calculated on the net amount after Stripe fees.
 *
 * Tiers:
 *   $1.35 — 70% to merchant, 30% platform (after Stripe)
 *   $2.00 — 70% to merchant, 30% platform (after Stripe)
 *   $3.00 — 70% to merchant, 30% platform (after Stripe)
 *   $5.00 — 75% to merchant, 25% platform (after Stripe)
 */

export type SpinPriceTier = {
  priceCents: number;
  label: string;
  platformFeeCents: number;
  merchantPayoutCents: number;
};

function estimateStripeFee(amountCents: number): number {
  return Math.round(amountCents * 0.029 + 30);
}

function buildTier(priceCents: number, label: string, merchantSharePct: number): SpinPriceTier {
  const stripeFee = estimateStripeFee(priceCents);
  const netAfterStripe = priceCents - stripeFee;
  const merchantPayoutCents = Math.round(netAfterStripe * merchantSharePct);
  const platformFeeCents = priceCents - merchantPayoutCents;
  return { priceCents, label, platformFeeCents, merchantPayoutCents };
}

export const SPIN_PRICE_TIERS: SpinPriceTier[] = [
  buildTier(135, "$1.35", 0.70),
  buildTier(200, "$2.00", 0.70),
  buildTier(300, "$3.00", 0.70),
  buildTier(500, "$5.00", 0.75),
];

export const DEFAULT_TIER = SPIN_PRICE_TIERS[0];

// Legacy constants kept for backward compatibility
export const SPIN_PRICE_CENTS = DEFAULT_TIER.priceCents;
export const PLATFORM_FEE_CENTS = DEFAULT_TIER.platformFeeCents;
export const MERCHANT_PAYOUT_CENTS = DEFAULT_TIER.merchantPayoutCents;

export function getTierByPrice(priceCents: number): SpinPriceTier {
  return SPIN_PRICE_TIERS.find((t) => t.priceCents === priceCents) ?? DEFAULT_TIER;
}

export const VALID_SPIN_PRICES = SPIN_PRICE_TIERS.map((t) => t.priceCents);
