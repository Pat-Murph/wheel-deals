type Point = { lat: number; lng: number };
type BoostMerchant = {
  isMobile?: boolean;
  boostMode?: string;
  boostActive?: boolean;
  boostFreeSpinsRemaining?: number;
  boostWheelPriceCents?: number;
  mobileActiveUntil?: { toDate?: () => Date } | Date | string;
  lat?: number;
  lng?: number;
  mobileLat?: number;
  mobileLng?: number;
  mobileServiceLat?: number;
  mobileServiceLng?: number;
};

export function isAlwaysRadiusBoost(merchant: BoostMerchant | null | undefined): boolean {
  return merchant?.isMobile === true && merchant.boostMode === "always";
}

export function hasAvailableBoostWheel(merchant: BoostMerchant | null | undefined, wheelPrice: number | undefined): boolean {
  if (!merchant?.boostActive || (merchant.boostFreeSpinsRemaining ?? 0) <= 0) return false;
  if (merchant.boostWheelPriceCents == null || merchant.boostWheelPriceCents !== wheelPrice) return false;
  if (merchant.isMobile && !isAlwaysRadiusBoost(merchant)) {
    const until = merchant.mobileActiveUntil;
    const end = typeof until === "object" && until !== null && "toDate" in until
      ? until.toDate?.() : until ? new Date(until as Date | string) : null;
    if (!end || end <= new Date() || !Number.isFinite(end.getTime())) return false;
  }
  return true;
}

export function boostCenter(merchant: BoostMerchant | null | undefined): Point | null {
  if (!merchant) return null;
  const hasServiceCenter = typeof merchant.mobileServiceLat === "number" && Number.isFinite(merchant.mobileServiceLat)
    && typeof merchant.mobileServiceLng === "number" && Number.isFinite(merchant.mobileServiceLng);
  const pair = isAlwaysRadiusBoost(merchant)
    ? hasServiceCenter ? [merchant.mobileServiceLat, merchant.mobileServiceLng] : [merchant.lat, merchant.lng]
    : merchant.isMobile ? [merchant.mobileLat, merchant.mobileLng] : [merchant.lat, merchant.lng];
  if (typeof pair[0] !== "number" || typeof pair[1] !== "number" || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return null;
  return { lat: pair[0], lng: pair[1] };
}

export function distanceMeters(from: Point, to: Point): number {
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function boostDistance(merchant: BoostMerchant | null | undefined, position: Point | null): number | null {
  const center = boostCenter(merchant);
  return position && center ? distanceMeters(position, center) : null;
}

export function withinBoostArea(merchant: BoostMerchant | null | undefined, position: Point | null): boolean {
  const distance = boostDistance(merchant, position);
  return distance !== null && distance <= (isAlwaysRadiusBoost(merchant) ? 25 * 1609.34 : 200);
}
