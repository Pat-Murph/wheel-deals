// Spin price charged to customer
export const SPIN_PRICE_CENTS = 135; // $1.35

// Stripe fee: ~2.9% + $0.30 flat = ~$0.34 at this price point
// Merchant payout
export const MERCHANT_PAYOUT_CENTS = 70;  // $0.70 to merchant

// Wheel Deals platform take: $1.35 - $0.34 (Stripe) - $0.70 (merchant) = ~$0.31
export const PLATFORM_FEE_CENTS = 31;     // ~$0.31 platform revenue
