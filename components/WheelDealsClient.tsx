"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Wheel, { WheelItem } from "./Wheel";
import { QRCodeCanvas } from "qrcode.react";
import { getActiveMerchants, type Merchant } from "../lib/merchants";
import SpinCelebration, { getRandomBeast, type Beast, type RarityTier } from "./SpinCelebration";
import { hasClaimedBoostLocally } from "../lib/deviceFingerprint";

import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { app } from "../lib/firebase";

type Props = {
  initialMerchantId?: string;
  initialEventId?: string;
};

type ActiveDeal = {
  spinId: string;
  prizeLabel: string;
  code: string;
  expiresAt: string;
  createdAt?: string | null;
  type?: string;
};

function titleCase(s: string) {
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function getBoostCycleId(value: any): string {
  const date = value?.toDate?.() ?? (value instanceof Date ? value : value ? new Date(value) : null);
  const ms = date instanceof Date ? date.getTime() : Number.NaN;
  return Number.isFinite(ms) ? `boost-${ms}` : `boost-${String(value ?? "unknown")}`;
}

function getMerchantPhotos(m: any) {
  const originals = safeArray<string>(m?.photoUrls);
  const processed = safeArray<string>(m?.photoProcessedUrls);
  // Prefer original full-res photos (pipeline not yet connected)
  return originals.length ? originals : processed;
}

function getMerchantWheel(m: any): WheelItem[] | null {
  const raw = safeArray<any>(m?.wheel);
  if (!raw.length) return null;

  const items: WheelItem[] = raw
    .map((r) => ({
      label: String(r?.label ?? "").trim(),
      weight: Number(r?.weight ?? 0),
    }))
    .filter((r) => r.label && r.weight > 0);

  return items.length ? items : null;
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return "https://" + url;
}

export default function WheelDealsClient({ initialMerchantId, initialEventId }: Props) {
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const auth = getAuth(app);
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        try {
          const cred = await signInAnonymously(auth);
          setUid(cred.user.uid);
          return;
        } catch (e) {
          console.error("Anonymous sign-in failed", e);
          return;
        }
      }
      setUid(u.uid);
    });
    return () => unsub();
  }, []);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [merchantLoadError, setMerchantLoadError] = useState<string | null>(null);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>("");
  const [issuedCode, setIssuedCode] = useState("");
  const [lastPrize, setLastPrize] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [spinError, setSpinError] = useState<string | null>(null);
  // Celebration overlay state
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [celebrationWeightPct, setCelebrationWeightPct] = useState(50);
  const [celebrationLabel, setCelebrationLabel] = useState("");
  // Pending result — shown after celebration dismisses
  const pendingResultRef = useRef<{ label: string; code: string; spinId?: string; expiresAt?: string } | null>(null);
  const [activeDeals, setActiveDeals] = useState<ActiveDeal[]>([]);
  const [selectedActiveSpinId, setSelectedActiveSpinId] = useState<string>("");
  const [activeDealsLoading, setActiveDealsLoading] = useState(false);
  const [activeDealsError, setActiveDealsError] = useState<string | null>(null);
  const activeDealRequestRef = useRef(0);
  // Beast info for share card — saved when celebration fires
  const [lastBeast, setLastBeast] = useState<{ beast: Beast; tier: RarityTier } | null>(null);
  const [lastBeastSpinId, setLastBeastSpinId] = useState("");
  const [beastActionStatus, setBeastActionStatus] = useState<string | null>(null);
  const [beastActionBusy, setBeastActionBusy] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  // Support modal state
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportName, setSupportName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportMsg, setSupportMsg] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const [supportStatus, setSupportStatus] = useState<string | null>(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [photoBroken, setPhotoBroken] = useState<Record<string, boolean>>({});
  // Geolocation for free deal proximity gate
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoChecking, setGeoChecking] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [freeBoostClaimed, setFreeBoostClaimed] = useState(false);

  // Ticket Event state
  const [ticketEvent, setTicketEvent] = useState<any>(null);
  const [ticketEventLoading, setTicketEventLoading] = useState(!!initialEventId);
  const [ticketUserSpots, setTicketUserSpots] = useState(0);
  const [ticketBuyCount, setTicketBuyCount] = useState(1);
  const [ticketBuying, setTicketBuying] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketCountdown, setTicketCountdown] = useState('');
  const [ticketSpinResults, setTicketSpinResults] = useState<any[]>([]);
  const [ticketEventEnded, setTicketEventEnded] = useState(false);

  async function sendCodeByEmail() {
    if (!emailInput.trim() || !issuedCode) return;
    setEmailSending(true);
    setEmailStatus(null);
    try {
      const subject = encodeURIComponent(`Your Wheel Deals Deal Code — ${lastPrize ?? "Deal"}`);
      const body = encodeURIComponent(
        `Hi!\n\nYour deal: ${lastPrize ?? "a deal"} at ${selectedMerchant?.name ?? "Wheel Deals"}!\n\nYour redemption code: ${issuedCode}\n\nShow this code (or the QR) to the merchant to redeem. One-time use only.\n\n⏳ This code expires ${expiresAt ? new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "30 days from now"}. Please redeem before it expires.\n\n— Wheel Deals`
      );
      window.open(`mailto:${emailInput.trim()}?subject=${subject}&body=${body}`, "_blank");
      setEmailStatus("✅ Email app opened with the code ready to send!");
    } catch {
      setEmailStatus("❌ Could not open email app. Please copy the code manually.");
    } finally {
      setEmailSending(false);
    }
  }

  const applyActiveDeal = useCallback((deal: ActiveDeal | null) => {
    if (!deal) {
      setSelectedActiveSpinId("");
      setIssuedCode("");
      setLastPrize(null);
      setExpiresAt(null);
      return;
    }

    setSelectedActiveSpinId(deal.spinId);
    setIssuedCode(deal.code);
    setLastPrize(deal.prizeLabel);
    setExpiresAt(deal.expiresAt);
  }, []);

  const loadActiveDeals = useCallback(async () => {
    if (!uid || !selectedMerchantId || initialEventId) return;

    const requestId = ++activeDealRequestRef.current;
    setActiveDealsLoading(true);
    setActiveDealsError(null);

    try {
      const currentUser = getAuth(app).currentUser;
      if (!currentUser || currentUser.uid !== uid) return;
      const idToken = await currentUser.getIdToken();
      const response = await fetch(`/api/spins/active?merchantId=${encodeURIComponent(selectedMerchantId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== activeDealRequestRef.current) return;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "Could not load saved deal codes");
      }

      const deals = Array.isArray(data.deals) ? (data.deals as ActiveDeal[]) : [];
      setActiveDeals(deals);
      applyActiveDeal(deals[0] ?? null);
    } catch (error: any) {
      if (requestId !== activeDealRequestRef.current) return;
      console.error("Active deal restore failed:", error);
      setActiveDealsError(error?.message ?? "Could not load saved deal codes");
    } finally {
      if (requestId === activeDealRequestRef.current) setActiveDealsLoading(false);
    }
  }, [applyActiveDeal, initialEventId, selectedMerchantId, uid]);

  useEffect(() => {
    void loadActiveDeals();
  }, [loadActiveDeals]);

  useEffect(() => {
    if (initialEventId) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadActiveDeals();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [initialEventId, loadActiveDeals]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingMerchants(true);
      setMerchantLoadError(null);
      try {
        const list = await getActiveMerchants();
        if (!mounted) return;
        setMerchants(list);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setMerchantLoadError(e?.message ?? "Could not load merchants.");
      } finally {
        if (!mounted) return;
        setLoadingMerchants(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!merchants.length) return;
    const found = (initialMerchantId && merchants.find((m) => m.id === initialMerchantId)) || null;
    const next = found?.id ?? merchants[0].id;
    if (!selectedMerchantId) {
      setSelectedMerchantId(next);
      setIssuedCode("");
      setLastPrize(null);
      setExpiresAt(null);
      setActiveDeals([]);
      setSelectedActiveSpinId("");
      setLastBeast(null);
      setLastBeastSpinId("");
      setSpinError(null);
      setActivePhotoIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchants, initialMerchantId]);

  const selectedMerchant = useMemo(() => {
    if (!merchants.length) return null;
    if (!selectedMerchantId) return null; // Don't fall back to merchants[0] before ID is set
    return merchants.find((m) => m.id === selectedMerchantId) ?? null;
  }, [merchants, selectedMerchantId, merchants.length]);

  useEffect(() => {
    if (!merchants.length) return;
    if (!initialMerchantId) return;
    const found = merchants.find((m) => m.id === initialMerchantId);
    if (!found) return;
    if (found.id !== selectedMerchantId) {
      setSelectedMerchantId(found.id);
      setIssuedCode("");
      setLastPrize(null);
      setExpiresAt(null);
      setActiveDeals([]);
      setSelectedActiveSpinId("");
      setLastBeast(null);
      setLastBeastSpinId("");
      setSpinError(null);
      setActivePhotoIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMerchantId, merchants]);

  const merchantPhotos = useMemo(() => {
    if (!selectedMerchant) return [];
    return getMerchantPhotos(selectedMerchant);
  }, [selectedMerchant]);

  useEffect(() => {
    setActivePhotoIdx(0);
    setPhotoBroken({});
  }, [selectedMerchantId]);

  const heroPhoto = merchantPhotos[activePhotoIdx] || merchantPhotos[0] || "";
  const heroBroken = heroPhoto ? !!photoBroken[heroPhoto] : false;

  const aboutText = (selectedMerchant as any)?.about || "";
  const category = (selectedMerchant as any)?.category || "";
  const city = (selectedMerchant as any)?.city || "";
  const website = (selectedMerchant as any)?.website || "";
  const phone = (selectedMerchant as any)?.phone || "";

  // Multi-wheel support: derive list of wheels from merchant doc
  const merchantWheels = useMemo(() => {
    const m = selectedMerchant as any;
    const rawWheels = Array.isArray(m?.wheels) ? m.wheels : [];
    // Filter to valid wheels
    const valid = rawWheels.filter(
      (wc: any) => Array.isArray(wc?.items) && wc.items.length > 0
    );
    if (valid.length > 0) return valid as Array<{ spinPriceCents: number; items: WheelItem[] }>;
    // Fall back to legacy single wheel
    const legacy = getMerchantWheel(m);
    if (legacy) return [{ spinPriceCents: 135, items: legacy }];
    return [{
      spinPriceCents: 135,
      items: [
        { label: "10% OFF", weight: 40 },
        { label: "15% OFF", weight: 25 },
        { label: "20% OFF", weight: 20 },
        { label: "BOGO", weight: 10 },
        { label: "FREE UPGRADE", weight: 5 },
      ],
    }];
  }, [selectedMerchant]);

  const [selectedWheelIdx, setSelectedWheelIdx] = useState(0);
  // Locked to the tier that was actually paid — prevents switching to a different tier after payment
  const [paidTierCents, setPaidTierCents] = useState<number | null>(null);
  const wheelContainerRef = useRef<HTMLDivElement>(null);
  const [wheelContainerWidth, setWheelContainerWidth] = useState(0);
  useEffect(() => {
    if (!wheelContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWheelContainerWidth(e.contentRect.width);
    });
    ro.observe(wheelContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset wheel selection and payment lock when merchant changes
  useEffect(() => {
    setSelectedWheelIdx(0);
    setPaidTierCents(null);
  }, [selectedMerchantId]);

  const activeWheel = merchantWheels[selectedWheelIdx] ?? merchantWheels[0];
  const wheelItems: WheelItem[] = activeWheel?.items ?? [];

  // Haversine distance in meters
  function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Is the active wheel a boosted free-deal wheel?
  const isFreeSpinWheel = useMemo(() => {
    if (!(selectedMerchant as any)?.boostActive) return false;
    // Mobile merchants must be checked in (active mobile session) to show boost on wheel page
    const m = selectedMerchant as any;
    if (m?.isMobile) {
      const activeUntil = m?.mobileActiveUntil?.toDate?.();
      if (!activeUntil || activeUntil <= new Date()) return false;
    }
    const boostPrice = m?.boostWheelPriceCents;
    return boostPrice != null && activeWheel?.spinPriceCents === boostPrice;
  }, [selectedMerchant, activeWheel]);

  const boostCycleId = useMemo(
    () => getBoostCycleId((selectedMerchant as any)?.boostPurchasedAt),
    [selectedMerchant]
  );

  useEffect(() => {
    if (!isFreeSpinWheel || !selectedMerchant?.id) {
      setFreeBoostClaimed(false);
      return;
    }
    setFreeBoostClaimed(hasClaimedBoostLocally(selectedMerchant.id, boostCycleId));
  }, [isFreeSpinWheel, selectedMerchant?.id, boostCycleId]);

  const freeBoostAvailable = isFreeSpinWheel && !freeBoostClaimed;

  // Distance from user to merchant in meters (uses storefront lat/lng)
  const distanceToMerchantMeters = useMemo(() => {
    if (!userPos) return null;
    const m = selectedMerchant as any;
    if (typeof m?.lat !== "number" || typeof m?.lng !== "number") return null;
    return haversineMeters(userPos.lat, userPos.lng, m.lat, m.lng);
  }, [userPos, selectedMerchant]);

  // Distance from user to mobile check-in point (for mobile merchants)
  const distanceToMobileCheckinMeters = useMemo(() => {
    if (!userPos) return null;
    const m = selectedMerchant as any;
    if (!m?.isMobile) return null;
    if (typeof m?.mobileLat !== "number" || typeof m?.mobileLng !== "number") return null;
    return haversineMeters(userPos.lat, userPos.lng, m.mobileLat, m.mobileLng);
  }, [userPos, selectedMerchant]);

  const isWithin200m = distanceToMerchantMeters != null && distanceToMerchantMeters <= 200;
  const isWithin200mOfCheckin = distanceToMobileCheckinMeters != null && distanceToMobileCheckinMeters <= 200;
  const isWithin25mi = distanceToMerchantMeters != null && distanceToMerchantMeters <= 25 * 1609.34;

  // For mobile merchants with boostMode='always', the free deal is available within 25mi with no geo-gate.
  // For boostMode='checkin' (default), the 200m proximity gate applies to the check-in location.
  const boostMode = (selectedMerchant as any)?.boostMode as string | undefined;
  const isMobileAlwaysBoost = (selectedMerchant as any)?.isMobile && boostMode === 'always';
  // Whether the free deal geo-gate is satisfied
  const freeSpinGatePassed = isMobileAlwaysBoost
    ? isWithin25mi
    : (selectedMerchant as any)?.isMobile
      ? isWithin200mOfCheckin
      : isWithin200m;

  async function requestLocationForFreeSpin() {
    setGeoChecking(true);
    setGeoError(null);
    return new Promise<void>((resolve) => {
      if (!navigator.geolocation) {
        setGeoError("Geolocation is not supported by your browser.");
        setGeoChecking(false);
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude });
          setGeoChecking(false);
          resolve();
        },
        (err) => {
          setGeoError("Location permission denied. Please allow location access to claim your free deal.");
          setGeoChecking(false);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // ===== TICKET EVENT LOGIC =====
  // Load ticket event data when eventId is provided
  useEffect(() => {
    if (!initialEventId || !uid) return;
    setTicketEventLoading(true);
    fetch(`/api/ticket-events/status?eventId=${initialEventId}&uid=${uid}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.event) {
          setTicketEvent(data.event);
          setTicketUserSpots(data.userSpots || 0);
          // Check if event has ended
          if (data.event.status === 'completed' || data.event.status === 'spinning') {
            setTicketEventEnded(true);
            // Auto-load results if event is completed and user had entries
            if (data.event.status === 'completed' && data.event.results) {
              const myResults = data.event.results.filter((r: any) => r.uid === uid);
              if (myResults.length > 0) {
                setTicketSpinResults(myResults);
              }
            }
          } else if (new Date(data.event.spinTime).getTime() <= Date.now()) {
            setTicketEventEnded(true);
            // Spin time passed but event not yet completed — trigger spin
            triggerTicketSpin();
          }
        }
      })
      .catch(() => {})
      .finally(() => setTicketEventLoading(false));
  }, [initialEventId, uid]);

  // Countdown timer for ticket events
  useEffect(() => {
    if (!ticketEvent || ticketEventEnded) return;
    const interval = setInterval(() => {
      const spinTime = new Date(ticketEvent.spinTime).getTime();
      const msLeft = spinTime - Date.now();
      if (msLeft <= 0) {
        setTicketCountdown('Spinning now!');
        setTicketEventEnded(true);
        clearInterval(interval);
        // Auto-trigger spin
        triggerTicketSpin();
        return;
      }
      const totalSec = Math.floor(msLeft / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setTicketCountdown(
        h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
      );
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketEvent, ticketEventEnded]);

  async function triggerTicketSpin() {
    if (!initialEventId || !uid) return;
    try {
      const res = await fetch('/api/ticket-events/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: initialEventId, uid }),
      });
      const data = await res.json();
      if (data.ok && data.results && data.results.length > 0) {
        // Results are already filtered by uid server-side
        setTicketSpinResults(data.results);
      } else if (data.ok && data.results && data.results.length === 0) {
        // User had no entries
        setTicketError('You did not have any entries in this spin.');
      }
    } catch {
      // If spin already happened, try to get results from status endpoint
      try {
        const statusRes = await fetch(`/api/ticket-events/status?eventId=${initialEventId}&uid=${uid}`);
        const statusData = await statusRes.json();
        if (statusData.ok && statusData.event?.results) {
          const myResults = statusData.event.results.filter((r: any) => r.uid === uid);
          if (myResults.length > 0) {
            setTicketSpinResults(myResults);
          }
        }
      } catch {
        setTicketError('Spin completed — check back shortly for results!');
      }
    }
  }

  async function buyTicketSpots() {
    if (!initialEventId || !uid || !selectedMerchant) return;
    setTicketBuying(true);
    setTicketError(null);
    try {
      const res = await fetch('/api/ticket-events/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: initialEventId,
          uid,
          spotCount: ticketBuyCount,
          returnUrl: window.location.href,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not purchase tickets');
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (data.ok) {
        // Free entry or already handled
        setTicketUserSpots(prev => prev + ticketBuyCount);
        // Reload event data
        const statusRes = await fetch(`/api/ticket-events/status?eventId=${initialEventId}&uid=${uid}`);
        const statusData = await statusRes.json();
        if (statusData.ok && statusData.event) setTicketEvent(statusData.event);
      }
    } catch (e: any) {
      setTicketError(e?.message ?? 'Purchase failed');
    } finally {
      setTicketBuying(false);
    }
  }

  // Check for ticket event payment return (event_success in URL)
  useEffect(() => {
    if (!initialEventId || !uid) return;
    const params = new URLSearchParams(window.location.search);
    const eventSuccess = params.get('event_success');
    if (!eventSuccess) return;
    // Reload event data to get updated spots
    fetch(`/api/ticket-events/status?eventId=${initialEventId}&uid=${uid}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.event) {
          setTicketEvent(data.event);
          setTicketUserSpots(data.userSpots || 0);
        }
      })
      .catch(() => {});
    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete('event_success');
    window.history.replaceState({}, '', url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEventId, uid]);

  function loadShareImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load a share-card image."));
      image.src = src;
    });
  }

  function roundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fitCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    startSize: number,
    minSize: number,
    weight = 900,
  ) {
    let size = startSize;
    while (size > minSize) {
      ctx.font = `${weight} ${size}px Arial, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return size;
  }

  function ellipsizeCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let shortened = text;
    while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    return `${shortened.trimEnd()}…`;
  }

  async function createBrandedBeastCard(): Promise<File> {
    if (!lastBeast) throw new Error("No Beast is ready to share.");

    const { beast, tier } = lastBeast;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the branded share card.");

    const [beastImage, logoImage] = await Promise.all([
      loadShareImage(beast.imagePath),
      loadShareImage("/icon-512.png"),
    ]);

    const merchantName = selectedMerchant?.name?.trim() || "a local business";
    const locationParts = [selectedMerchant?.city?.trim(), selectedMerchant?.state?.trim()].filter(Boolean);
    const merchantLocation = locationParts.join(", ");
    const dealName = lastPrize?.trim() || "a local deal";

    const background = ctx.createLinearGradient(0, 0, 1080, 1350);
    background.addColorStop(0, "#07142e");
    background.addColorStop(0.6, "#0d234b");
    background.addColorStop(1, "#050b19");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 1080, 1350);

    const glow = ctx.createRadialGradient(540, 560, 40, 540, 560, 620);
    glow.addColorStop(0, `${tier.glowColor}66`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1080, 1120);

    ctx.save();
    roundedRectPath(ctx, 52, 42, 124, 124, 28);
    ctx.clip();
    ctx.drawImage(logoImage, 52, 42, 124, 124);
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 54px Arial, sans-serif";
    ctx.fillText("WHEEL DEALS", 202, 100);
    ctx.fillStyle = "#f6a000";
    ctx.font = "800 28px Arial, sans-serif";
    ctx.fillText("UNLOCK LOCAL SAVINGS", 204, 142);

    const imageX = 52;
    const imageY = 196;
    const imageWidth = 976;
    const imageHeight = 830;
    ctx.save();
    roundedRectPath(ctx, imageX, imageY, imageWidth, imageHeight, 40);
    ctx.clip();
    const scale = Math.max(imageWidth / beastImage.naturalWidth, imageHeight / beastImage.naturalHeight);
    const drawWidth = beastImage.naturalWidth * scale;
    const drawHeight = beastImage.naturalHeight * scale;
    ctx.drawImage(
      beastImage,
      imageX + (imageWidth - drawWidth) / 2,
      imageY + (imageHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );

    const imageShade = ctx.createLinearGradient(0, imageY + 500, 0, imageY + imageHeight);
    imageShade.addColorStop(0, "rgba(3,8,18,0)");
    imageShade.addColorStop(1, "rgba(3,8,18,0.94)");
    ctx.fillStyle = imageShade;
    ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
    ctx.restore();

    ctx.save();
    roundedRectPath(ctx, 84, 226, 390, 66, 33);
    ctx.fillStyle = "rgba(4,10,24,0.84)";
    ctx.fill();
    ctx.strokeStyle = tier.glowColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = tier.glowColor;
    ctx.font = "900 28px Arial, sans-serif";
    ctx.fillText(tier.label.toUpperCase(), 110, 269);
    ctx.restore();

    const beastName = beast.name.toUpperCase();
    const beastSize = fitCanvasText(ctx, beastName, 860, 76, 46);
    ctx.textAlign = "center";
    ctx.font = `900 ${beastSize}px Arial, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = tier.glowColor;
    ctx.shadowBlur = 22;
    ctx.fillText(beastName, 540, 925);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#f6a000";
    ctx.font = "900 28px Arial, sans-serif";
    ctx.fillText("DEAL UNLOCKED", 540, 1082);

    const dealSize = fitCanvasText(ctx, dealName, 920, 50, 30);
    ctx.font = `900 ${dealSize}px Arial, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ellipsizeCanvasText(ctx, dealName, 920), 540, 1140);

    const merchantLine = merchantLocation ? `${merchantName} • ${merchantLocation}` : merchantName;
    const merchantSize = fitCanvasText(ctx, merchantLine, 920, 33, 23, 800);
    ctx.font = `800 ${merchantSize}px Arial, sans-serif`;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(ellipsizeCanvasText(ctx, merchantLine, 920), 540, 1192);

    ctx.save();
    roundedRectPath(ctx, 190, 1232, 700, 76, 38);
    const websiteGradient = ctx.createLinearGradient(190, 1232, 890, 1308);
    websiteGradient.addColorStop(0, "#ffd93d");
    websiteGradient.addColorStop(1, "#ff8a00");
    ctx.fillStyle = websiteGradient;
    ctx.fill();
    ctx.fillStyle = "#101827";
    ctx.font = "900 34px Arial, sans-serif";
    ctx.fillText("wheeldealsapp.com", 540, 1281);
    ctx.restore();
    ctx.textAlign = "start";

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not export the branded share card.")), "image/png", 0.95);
    });
    const filename = `${beast.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-wheel-deals.png`;
    return new File([blob], filename, { type: "image/png" });
  }

  async function fileBase64(file: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("Could not prepare the branded share card."));
      reader.readAsDataURL(file);
    });
  }

  async function writeNativeShareFile(file: File): Promise<string> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const data = await fileBase64(file);
    const saved = await Filesystem.writeFile({
      path: `wheel-deals-share/${file.name}`,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    return saved.uri;
  }

  async function saveBrandedBeastImage(file: File): Promise<string | null> {
    const isNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
    if (isNative) {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const data = await fileBase64(file);
      const saved = await Filesystem.writeFile({
        path: `WheelDeals/${file.name}`,
        data,
        directory: Directory.Documents,
        recursive: true,
      });
      return saved.uri;
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return null;
  }

  function beastShareCopy() {
    if (!lastBeast) return { title: "Wheel Deals", text: "Find local deals at https://wheeldealsapp.com" };
    const merchantName = selectedMerchant?.name?.trim() || "a local business";
    const locationParts = [selectedMerchant?.city?.trim(), selectedMerchant?.state?.trim()].filter(Boolean);
    const merchantLocation = locationParts.join(", ");
    const where = merchantLocation ? `${merchantName} in ${merchantLocation}` : merchantName;
    const dealName = lastPrize?.trim() || "a local deal";
    return {
      title: `I unlocked ${lastBeast.beast.name} on Wheel Deals!`,
      text: `I unlocked ${dealName} at ${where} and revealed ${lastBeast.beast.name} (${lastBeast.tier.label}) on Wheel Deals!\n\nFind local deals: https://wheeldealsapp.com`,
    };
  }

  async function shareBeast() {
    if (!lastBeast || beastActionBusy) return;
    setBeastActionBusy(true);
    setBeastActionStatus("Preparing your branded share card…");
    const { title, text } = beastShareCopy();

    try {
      const file = await createBrandedBeastCard();
      const isNative = Boolean((window as any).Capacitor?.isNativePlatform?.());

      if (isNative) {
        try {
          const fileUri = await writeNativeShareFile(file);
          const { Share } = await import("@capacitor/share");
          await Share.share({
            title,
            text,
            files: [fileUri],
            dialogTitle: "Share your Wheel Deals Beast",
          });
          setBeastActionStatus("Share options opened.");
          return;
        } catch (nativeError: any) {
          if (nativeError?.message?.toLowerCase?.().includes("cancel")) return;
          // Some Android WebView/Capacitor combinations reject a native file URI.
          // Fall through to the Web Share API with the same in-memory PNG.
        }
      }

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title, text, files: [file] });
        setBeastActionStatus("Share options opened.");
        return;
      }

      await saveBrandedBeastImage(file);
      setBeastActionStatus("Branded image saved. Share it from your Photos or Files app.");
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.message?.toLowerCase?.().includes("cancel")) {
        setBeastActionStatus(null);
        return;
      }
      setBeastActionStatus("Could not open sharing. Try Save Image, then share it from Photos or Files.");
    } finally {
      setBeastActionBusy(false);
    }
  }

  async function saveCurrentBeast() {
    if (!lastBeast || beastActionBusy) return;
    setBeastActionBusy(true);
    setBeastActionStatus("Creating your branded Beast image…");
    try {
      const file = await createBrandedBeastCard();
      await saveBrandedBeastImage(file);
      const isNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
      setBeastActionStatus(isNative ? "Branded image saved in your WheelDeals Documents folder." : "Branded image download started.");
    } catch {
      setBeastActionStatus("Could not save the image. Please try again.");
    } finally {
      setBeastActionBusy(false);
    }
  }

  async function sendSupportMessage() {
    if (!supportMsg.trim()) return;
    setSupportSending(true);
    setSupportStatus(null);
    try {
      const res = await fetch("/api/email/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: supportName.trim(),
          email: supportEmail.trim(),
          message: supportMsg.trim(),
          merchantId: selectedMerchant?.id ?? "",
          merchantName: selectedMerchant?.name ?? "",
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setSupportStatus("sent");
      setSupportMsg("");
    } catch {
      setSupportStatus("error");
    } finally {
      setSupportSending(false);
    }
  }

  if (loadingMerchants) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ fontWeight: 800, opacity: 0.8 }}>Loading…</div>
      </div>
    );
  }

  if (merchantLoadError) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ maxWidth: 640, border: "1px solid rgba(239,68,68,0.30)", background: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 14, fontWeight: 900 }}>
          ❌ {merchantLoadError}
        </div>
        <a href="/discover" style={{ fontWeight: 900, textDecoration: "none", color: "#111", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "linear-gradient(180deg, #f3f4f6, #fff)" }}>
          Go to discovery →
        </a>
      </div>
    );
  }

  if (!merchants.length || !selectedMerchant) {
    return (
      <div style={{ width: "100%", display: "grid", justifyItems: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>
          <span style={{ color: "#F4B400" }}>Wheel</span>{" "}
          <span style={{ color: "#2563EB" }}>Deals</span>
        </div>
        <div style={{ fontWeight: 900 }}>No active merchants found.</div>
        <a href="/discover" style={{ fontWeight: 900, textDecoration: "none", color: "#111", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "linear-gradient(180deg, #f3f4f6, #fff)" }}>
          Go to discovery →
        </a>
      </div>
    );
  }

  return (
    <div style={{
      width: "100%",
      maxWidth: 520,
      margin: "0 auto",
      padding: "12px 6px 32px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxSizing: "border-box",
    }}>

      {/* Top nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div />
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/discover" style={{
            fontWeight: 900, textDecoration: "none", color: "#111",
            padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(180deg, #f3f4f6, #fff)", fontSize: 13,
          }}>
            ← Discover
          </a>
          <button onClick={() => { setSupportOpen(true); setSupportStatus(null); }} style={{
            fontWeight: 900, color: "#111",
            padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(180deg, #f3f4f6, #fff)", fontSize: 13, cursor: "pointer",
          }}>
            Support
          </button>
        </div>
      </div>

      {/* Merchant info card */}
      <div style={{
        border: "2px solid #C8960C",
        borderRadius: 16,
        background: "white",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(200,150,12,0.18), 0 2px 8px rgba(0,0,0,0.08)",
      }}>
        {/* Hero photo */}
        {heroPhoto && !heroBroken ? (
          <div style={{ width: "100%", height: 280, overflow: "hidden", borderRadius: "14px 14px 0 0" }}>
            <img
              src={heroPhoto}
              alt={`${selectedMerchant.name} photo`}
              style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
              onError={() => setPhotoBroken((p) => ({ ...p, [heroPhoto]: true }))}
            />
          </div>
        ) : null}

        {/* Thumbnail strip */}
        {merchantPhotos.length > 1 && (
          <div style={{ display: "flex", gap: 6, padding: "8px 10px", overflowX: "auto" }}>
            {merchantPhotos.slice(0, 6).map((src, i) => {
              const broken = !!photoBroken[src];
              const active = i === activePhotoIdx;
              return (
                <button
                  key={src}
                  onClick={() => setActivePhotoIdx(i)}
                  style={{
                    border: active ? "2px solid #F4B400" : "1px solid #e5e7eb",
                    borderRadius: 8, padding: 0, overflow: "hidden",
                    width: 60, height: 44, cursor: "pointer", background: "#fff", flexShrink: 0,
                  }}
                >
                  {broken ? (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, opacity: 0.5 }}>blocked</div>
                  ) : (
                    <img src={src} alt={`thumb-${i}`} style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={() => setPhotoBroken((p) => ({ ...p, [src]: true }))} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Info section */}
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 950, lineHeight: 1.2 }}>{selectedMerchant.name}</div>

          {/* Category + City pills */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {category && (
              <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.12)", background: "#f9fafb", fontWeight: 800, fontSize: 12 }}>
                {titleCase(category)}
              </span>
            )}
            {city && (
              <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.12)", background: "#f9fafb", fontWeight: 800, fontSize: 12 }}>
                {titleCase(city)}
              </span>
            )}
          </div>

          {/* About */}
          {aboutText ? (
            <div style={{ fontSize: 14, lineHeight: 1.5, fontWeight: 600, color: "#374151" }}>
              {aboutText}
            </div>
          ) : null}

          {/* Website + Phone clickable links */}
          {(website || phone) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
              {website && (
                <a
                  href={normalizeUrl(website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#111",
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "#f9fafb",
                  }}
                >
                  🌐 {website.replace(/^https?:\/\//, "")}
                </a>
              )}
              {phone && (
                <a
                  href={`tel:${phone.replace(/\D/g, "")}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#111",
                    textDecoration: "none",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "#f9fafb",
                  }}
                >
                  📞 {phone}
                </a>
              )}
            </div>
          )}

          {/* Mobile merchant "Available Now" badge */}
          {(selectedMerchant as any)?.isMobile && (selectedMerchant as any)?.mobileActiveUntil?.toDate && (selectedMerchant as any).mobileActiveUntil.toDate() > new Date() && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #fef3c7, #fde68a)",
              border: "1px solid #f59e0b",
              marginTop: 4,
            }}>
              <span style={{ fontSize: 20 }}>🚚</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14, color: "#92400e" }}>Available Now</div>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#b45309" }}>
                  {(() => {
                    const ms = (selectedMerchant as any).mobileActiveUntil.toDate().getTime() - Date.now();
                    const totalSec = Math.floor(ms / 1000);
                    const h = Math.floor(totalSec / 3600);
                    const m = Math.floor((totalSec % 3600) / 60);
                    const s = totalSec % 60;
                    if (h > 0) return `${h}h ${m}m remaining`;
                    if (m > 0) return `${m}m ${s}s remaining`;
                    return `${s}s remaining`;
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Business Hours — respect showBusinessHours opt-in */}
          {(() => {
            if ((selectedMerchant as any)?.showBusinessHours === false) return null;
            const bh = (selectedMerchant as any)?.businessHours;
            if (!bh || typeof bh !== "object") return null;
            const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const now = new Date();
            const todayIdx = now.getDay();
            return (
              <div style={{ marginTop: 4, padding: "10px 14px", borderRadius: 12, background: "#f9fafb", border: "1px solid #e5e7eb" }}>
                <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 6, color: "#111" }}>🕒 Business Hours</div>
                <div style={{ display: "grid", gap: 3 }}>
                  {dayNames.map((day, i) => {
                    const dh = bh[day];
                    const isToday = i === todayIdx;
                    if (!dh) return null;
                    const fmtTime = (t: string) => {
                      const [h, mi] = t.split(":").map(Number);
                      const ampm = h >= 12 ? "PM" : "AM";
                      const h12 = h % 12 || 12;
                      return `${h12}:${String(mi).padStart(2, "0")} ${ampm}`;
                    };
                    return (
                      <div key={day} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: isToday ? 900 : 600, color: isToday ? "#111" : "#6b7280" }}>
                        <span>{day.slice(0, 3)}{isToday ? " (Today)" : ""}</span>
                        <span style={{ color: dh.closed ? "#dc2626" : undefined }}>
                          {dh.closed ? "Closed" : `${fmtTime(dh.open)} – ${fmtTime(dh.close)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Directions + distance */}
          {(() => {
            const m = selectedMerchant as any;
            const isActiveMobile = m?.isMobile && m?.mobileActiveUntil?.toDate && m.mobileActiveUntil.toDate() > new Date();

            // Hide directions for mobile merchants unless they are checked in
            if (m?.isMobile && !isActiveMobile) return null;

            const dirLat = isActiveMobile && typeof m.mobileLat === 'number' ? m.mobileLat : m?.lat;
            const dirLng = isActiveMobile && typeof m.mobileLng === 'number' ? m.mobileLng : m?.lng;
            if (dirLat == null || dirLng == null) return null;

            let distLabel = "";
            if (distanceToMerchantMeters != null && !isActiveMobile) {
              distLabel = distanceToMerchantMeters < 1000
                ? `${Math.round(distanceToMerchantMeters)} m away`
                : `${(distanceToMerchantMeters / 1609.34).toFixed(1)} mi away`;
            } else if (isActiveMobile && userPos && typeof m.mobileLat === 'number' && typeof m.mobileLng === 'number') {
              const d = haversineMeters(userPos.lat, userPos.lng, m.mobileLat, m.mobileLng);
              distLabel = d < 1000
                ? `${Math.round(d)} m away`
                : `${(d / 1609.34).toFixed(1)} mi away`;
            }

            return (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${dirLat},${dirLng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#111",
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#f9fafb",
                  marginTop: 2,
                }}
              >
                📍 Get Directions
                {distLabel && (
                  <span style={{ fontWeight: 700, fontSize: 12, opacity: 0.7, marginLeft: 4 }}>
                    {distLabel}
                  </span>
                )}
              </a>
            );
          })()}

          {/* Disclaimer */}
          <p style={{ fontSize: 10, lineHeight: 1.4, color: "#9ca3af", marginTop: 10, fontWeight: 500 }}>
            Based on standard retail pricing. Not combinable unless stated. Terms and availability may vary—contact merchant for details.
          </p>
        </div>
      </div>

      {/* ===== TICKET EVENT MODE ===== */}
      {initialEventId && ticketEvent && (
        <div style={{
          background: "linear-gradient(135deg, #faf5ff 0%, #ede9fe 50%, #ddd6fe 100%)",
          border: "2px solid #8b5cf6",
          borderRadius: 16,
          padding: "18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          {/* Event header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#6b21a8" }}>Limited Deal Unlock</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                Unlocks on {ticketEvent.eventDate}
                {ticketEvent.validFrom && (
                  <span> · Deal valid: {ticketEvent.validFrom}{ticketEvent.validTo && ticketEvent.validTo !== ticketEvent.validFrom ? ` – ${ticketEvent.validTo}` : ''}</span>
                )}
              </div>
            </div>
          </div>

          {/* Countdown */}
          {!ticketEventEnded && (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280", marginBottom: 4 }}>Deal unlocks in</div>
              <div style={{ fontSize: 28, fontWeight: 1000, color: "#7c3aed", fontFamily: "ui-monospace, monospace" }}>
                {ticketCountdown || 'Loading...'}
              </div>
            </div>
          )}

          {/* Spots progress */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
              <span style={{ color: (ticketEvent.totalSpots - ticketEvent.spotsTaken) <= 5 ? "#dc2626" : "#7c3aed" }}>
                {ticketEvent.totalSpots - ticketEvent.spotsTaken} spots left
              </span>
              <span style={{ color: "#6b7280" }}>{ticketEvent.spotsTaken}/{ticketEvent.totalSpots} joined</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: "rgba(139,92,246,0.15)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.round((ticketEvent.spotsTaken / ticketEvent.totalSpots) * 100)}%`,
                background: "linear-gradient(90deg, #8b5cf6, #7c3aed)",
                borderRadius: 5,
                transition: "width 0.3s",
              }} />
            </div>
          </div>

          {/* User's entries */}
          {ticketUserSpots > 0 && (
            <div style={{
              background: "rgba(34,197,94,0.10)",
              border: "1px solid rgba(34,197,94,0.30)",
              borderRadius: 12,
              padding: "10px 14px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#16a34a" }}>
                ✅ You have {ticketUserSpots} spot{ticketUserSpots > 1 ? 's' : ''} reserved!
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginTop: 4 }}>
                {ticketEventEnded ? 'Your deal has been unlocked!' : 'Deals unlock for everyone at the scheduled time.'}
              </div>
            </div>
          )}

          {/* Join the unlock (only if event is active and not ended) */}
          {!ticketEventEnded && ticketUserSpots < 4 && (ticketEvent.totalSpots - ticketEvent.spotsTaken) > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>
                Unlock a deal — ${(ticketEvent.spotPriceCents / 100).toFixed(2)} each (max 4 per person)
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 13, fontWeight: 800, color: "#6b7280" }}>Qty:</label>
                <select
                  value={ticketBuyCount}
                  onChange={(e) => setTicketBuyCount(Number(e.target.value))}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, fontWeight: 800, background: "#fff" }}
                >
                  {Array.from({ length: Math.min(4 - ticketUserSpots, ticketEvent.totalSpots - ticketEvent.spotsTaken) }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n} spot{n > 1 ? 's' : ''} — ${((ticketEvent.spotPriceCents * n) / 100).toFixed(2)}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={buyTicketSpots}
                disabled={ticketBuying}
                style={{
                  padding: "14px 20px",
                  borderRadius: 12,
                  border: "none",
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: ticketBuying ? "not-allowed" : "pointer",
                  background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(139,92,246,0.30)",
                }}
              >
                {ticketBuying ? 'Processing...' : `Unlock ${ticketBuyCount} Spot${ticketBuyCount > 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {/* Sold out */}
          {!ticketEventEnded && (ticketEvent.totalSpots - ticketEvent.spotsTaken) <= 0 && ticketUserSpots === 0 && (
            <div style={{ textAlign: "center", padding: "12px", background: "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid rgba(239,68,68,0.20)" }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#dc2626" }}>All Spots Taken!</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginTop: 4 }}>All spots have been claimed for this unlock.</div>
            </div>
          )}

          {/* Event ended — show results */}
          {ticketEventEnded && ticketSpinResults.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#16a34a", textAlign: "center" }}>Your Deal!</div>
              {ticketSpinResults.map((r: any, i: number) => (
                <div key={i} style={{
                  background: "white",
                  border: "1px solid #bbf7d0",
                  borderRadius: 12,
                  padding: "14px 16px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#15803d" }}>{r.prize}</div>
                  {r.code && (
                    <>
                      <div style={{ marginTop: 8 }}>
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(r.code)}`}
                          alt="QR Code"
                          style={{ width: 150, height: 150, margin: "0 auto", display: "block" }}
                        />
                      </div>
                      <div style={{ marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 20, fontWeight: 1000, letterSpacing: 2 }}>
                        {r.code}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280", fontWeight: 600 }}>
                        Show this code or QR to the merchant to redeem. One-time use only.
                      </div>
                      <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                        <button
                          onClick={() => { navigator.clipboard.writeText(r.code); alert('Code copied!'); }}
                          style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", fontWeight: 800, fontSize: 12, cursor: "pointer" }}
                        >
                          Copy Code
                        </button>
                        {typeof navigator !== 'undefined' && navigator.share && (
                          <button
                            onClick={() => navigator.share({ title: `Wheel Deals - ${r.prize}`, text: `My deal code: ${r.code}\nDeal: ${r.prize}\nShow this to the merchant to redeem.` })}
                            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", fontWeight: 800, fontSize: 12, cursor: "pointer" }}
                          >
                            Save / Share
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {r.expiresAt && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>
                      Expires: {new Date(r.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>
                  )}
                  {ticketEvent.validFrom && (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#6b7280" }}>
                      Deal valid: {ticketEvent.validFrom}{ticketEvent.validTo && ticketEvent.validTo !== ticketEvent.validFrom ? ` \u2013 ${ticketEvent.validTo}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Event ended but no results yet (user didn't have spots) */}
          {ticketEventEnded && ticketSpinResults.length === 0 && ticketUserSpots === 0 && (
            <div style={{ textAlign: "center", padding: "12px", background: "rgba(0,0,0,0.04)", borderRadius: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#6b7280" }}>This event has ended.</div>
              {ticketEvent.recurring && ticketEvent.recurrencePattern && (
                <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginTop: 6 }}>
                  🔄 Next event: {ticketEvent.recurrencePattern} — check back soon!
                </div>
              )}
            </div>
          )}

          {/* Event ended, user had spots but results not loaded yet */}
          {ticketEventEnded && ticketSpinResults.length === 0 && ticketUserSpots > 0 && (
            <div style={{ textAlign: "center", padding: "12px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#7c3aed" }}>Resolving your deal...</div>
              <button
                onClick={triggerTicketSpin}
                style={{
                  marginTop: 8,
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "1px solid #8b5cf6",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                  background: "white",
                  color: "#7c3aed",
                }}
              >
                View Deal
              </button>
            </div>
          )}

          {ticketError && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)", fontWeight: 800, fontSize: 13, color: "#dc2626" }}>
              {ticketError}
            </div>
          )}
        </div>
      )}

      {/* Ticket event loading state */}
      {initialEventId && ticketEventLoading && (
        <div style={{ textAlign: "center", padding: "20px", fontWeight: 800, color: "#7c3aed" }}>
          Loading event...
        </div>
      )}

      {/* Normal wheel flow — show for regular merchants OR for event pages (wheel is visual only in event mode) */}
      {(!initialEventId || (initialEventId && ticketEvent)) && (
        <>
      {/* Unlock limit note — hide in event mode */}
      {!initialEventId && (
      <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, textAlign: "center" }}>
        Limit: <b>3 unlocks/day</b> per merchant
      </div>
      )}

      {/* Wheel selector tabs (only shown when merchant has multiple wheels, hidden in event mode) */}
      {!initialEventId && merchantWheels.length > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {merchantWheels.map((wc, idx) => {
            const label = wc.spinPriceCents === 135 ? "$1.35"
              : wc.spinPriceCents === 200 ? "$2.00"
              : wc.spinPriceCents === 300 ? "$3.00"
              : wc.spinPriceCents === 500 ? "$5.00"
              : `$${(wc.spinPriceCents / 100).toFixed(2)}`;
            const active = idx === selectedWheelIdx;
            // If payment has been verified, only the paid tier is selectable
            // Also lock tabs while a session_id is present (payment being verified)
            const isVerifying = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('session_id');
            const isLocked = isVerifying || (paidTierCents !== null && wc.spinPriceCents !== paidTierCents);
            return (
              <button
                key={idx}
                onClick={() => {
                  if (isLocked) return; // can't switch tiers after paying
                  setSelectedWheelIdx(idx);
                }}
                disabled={isLocked}
                style={{
                  padding: "10px 18px",
                  borderRadius: 12,
                  border: active ? "2px solid #F4B400" : "1px solid #e5e7eb",
                  fontWeight: 900,
                  fontSize: 14,
                  cursor: isLocked ? "not-allowed" : "pointer",
                  background: isLocked
                    ? "linear-gradient(180deg, #f3f4f6, #e5e7eb)"
                    : active
                    ? "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))"
                    : "linear-gradient(180deg, #f9fafb, #fff)",
                  boxShadow: active ? "0 4px 12px rgba(244,180,0,0.25)" : "none",
                  color: isLocked ? "#9ca3af" : "#111",
                  opacity: isLocked ? 0.5 : 1,
                }}
              >
                🔒 {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Set boostCycleId on window for client-side anti-abuse tracking */}
      {freeBoostAvailable && (() => {
        try { (window as any).__boostCycleId = boostCycleId; } catch {}
        return null;
      })()}

      {/* Free deal proximity gate banner — hidden in event mode */}
      {!initialEventId && freeBoostAvailable && (
        <div style={{
          background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
          border: "2px solid #f97316",
          borderRadius: 14,
          padding: "14px 16px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#c2410c" }}>
            🔥 Free Deal Available!
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#7c2d12" }}>
            {(selectedMerchant as any)?.boostFreeSpinsRemaining ?? 0} free deals remaining
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", opacity: 0.8 }}>
            Limit: 1 free deal per customer
          </div>
          {!userPos && (
            <>
              <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                {isMobileAlwaysBoost
                  ? "Allow location access to claim your free deal (within 25 miles)."
                  : "You must be within 200m of the store to claim your free deal."}
              </div>
              <button
                onClick={requestLocationForFreeSpin}
                disabled={geoChecking}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "none",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: geoChecking ? "not-allowed" : "pointer",
                  background: "linear-gradient(180deg, #f97316, #ea580c)",
                  color: "#fff",
                  alignSelf: "center",
                }}
              >
                {geoChecking ? "Checking location…" : "Check my location"}
              </button>
              {geoError && (
                <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 700 }}>{geoError}</div>
              )}
            </>
          )}
          {userPos && !freeSpinGatePassed && (
            <>
              <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 700 }}>
                {isMobileAlwaysBoost
                  ? `You are ${distanceToMerchantMeters != null ? `${(distanceToMerchantMeters / 1609.34).toFixed(1)} mi` : "too far"} away. You must be within 25 miles to claim the free deal.`
                  : `You are ${(() => {
                      const d = (selectedMerchant as any)?.isMobile ? distanceToMobileCheckinMeters : distanceToMerchantMeters;
                      return d != null ? `${Math.round(d)}m` : "too far";
                    })()} away. Drive to ${selectedMerchant.name} to unlock your free deal!`}
              </div>
              {!isMobileAlwaysBoost && (() => {
                const m = selectedMerchant as any;
                const useMobile = m?.isMobile && typeof m?.mobileLat === 'number' && typeof m?.mobileLng === 'number';
                const dLat = useMobile ? m.mobileLat : m?.lat;
                const dLng = useMobile ? m.mobileLng : m?.lng;
                return dLat != null && dLng != null;
              })() && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${(() => {
                    const m = selectedMerchant as any;
                    const useMobile = m?.isMobile && typeof m?.mobileLat === 'number' && typeof m?.mobileLng === 'number';
                    return useMobile ? `${m.mobileLat},${m.mobileLng}` : `${m.lat},${m.lng}`;
                  })()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    padding: "10px 20px",
                    borderRadius: 10,
                    background: "linear-gradient(180deg, #1d4ed8, #1e40af)",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 13,
                    textDecoration: "none",
                    alignSelf: "center",
                  }}
                >
                  📍 Get Directions
                </a>
              )}
              <button
                onClick={requestLocationForFreeSpin}
                disabled={geoChecking}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: "1px solid #f97316",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: geoChecking ? "not-allowed" : "pointer",
                  background: "transparent",
                  color: "#c2410c",
                  alignSelf: "center",
                }}
              >
                {geoChecking ? "Checking…" : "Re-check location"}
              </button>
            </>
          )}
          {userPos && freeSpinGatePassed && (
            <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 800 }}>
              {isMobileAlwaysBoost
                ? "✅ You're within range! Unlock the wheel below for your free deal!"
                : "✅ You're here! Unlock the wheel below for your free deal!"}
            </div>
          )}
        </div>
      )}

      {/* Wheel — hidden behind geo gate if free deal and not within range */}
      <div id="wheel-section" ref={wheelContainerRef} style={{ display: "flex", justifyContent: "center", position: "relative", width: "100%", overflow: "visible" }}>
        {/* Event mode — wheel is fully visible so customers can see possible deals */}
        {!initialEventId && freeBoostAvailable && userPos && !freeSpinGatePassed && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.75)",
            backdropFilter: "blur(4px)",
            borderRadius: 16,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 900,
            color: "#c2410c",
          }}>
            {isMobileAlwaysBoost ? "🔒 Get within 25 miles to unlock" : "🔒 Drive to the store to unlock"}
          </div>
        )}
        <Wheel
          items={wheelItems}
          merchantId={selectedMerchant.id}
          merchantName={(selectedMerchant as any)?.name ?? undefined}
          uid={uid ?? undefined}
          spinPriceCents={initialEventId ? 99999 : (freeBoostAvailable && freeSpinGatePassed ? 0 : (activeWheel?.spinPriceCents ?? 135))}
          hideControls={!!initialEventId}
          isFreeSpinBoost={!initialEventId && freeBoostAvailable && freeSpinGatePassed}
          onPaymentVerified={(priceCents) => {
            if (initialEventId) return; // no payment in event mode
            // Lock the tier tabs to the tier that was actually paid
            setPaidTierCents(priceCents);
            // Also auto-select the correct wheel tab for this tier
            const idx = merchantWheels.findIndex((w) => w.spinPriceCents === priceCents);
            if (idx >= 0) setSelectedWheelIdx(idx);
          }}
          onSpinLand={(label) => {
            if (initialEventId) return; // no spin in event mode
            // ✅ Fire celebration INSTANTLY when wheel stops — no server delay
            const totalWeight = wheelItems.reduce((s, it) => s + (Number(it.weight) || 0), 0);
            const winningItem = wheelItems.find((it) => it.label === label);
            const weightPct = totalWeight > 0 && winningItem
              ? (Number(winningItem.weight) / totalWeight) * 100
              : 50;
            setCelebrationLabel(label);
            setCelebrationWeightPct(weightPct);
            // Save beast info for share card
            const beastResult = getRandomBeast(weightPct);
            setLastBeast(beastResult);
            setCelebrationVisible(true);
          }}
          onResult={(label, extra) => {
            if (initialEventId) return; // no result in event mode
            setSpinError(null);
            setEmailInput("");
            setEmailStatus(null);
            if (!extra?.code) {
              setSpinError("Unlock completed but no code returned.");
              return;
            }
            // Store result for after celebration (code card shown when celebration dismisses)
            pendingResultRef.current = {
              label,
              code: extra.code,
              spinId: extra.spinId ?? undefined,
              expiresAt: extra.expiresAt ?? undefined,
            };
            setLastBeastSpinId(extra.spinId ?? "");

            // A confirmed free result must disappear immediately, even before a
            // navigation refreshes the merchant document from Firestore.
            if (isFreeSpinWheel) {
              setFreeBoostClaimed(true);
              setMerchants((current) => current.map((merchant) => {
                if (merchant.id !== selectedMerchant.id) return merchant;
                const remaining = Math.max(0, Number((merchant as any).boostFreeSpinsRemaining ?? 0) - 1);
                return {
                  ...merchant,
                  boostFreeSpinsRemaining: remaining,
                  boostActive: remaining > 0 && (merchant as any).boostActive === true,
                } as Merchant;
              }));
              void getActiveMerchants().then(setMerchants).catch(() => {});
            }
          }}
        />
      </div>

      {/* Results / code box */}
      {spinError && (
        <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", fontWeight: 900, textAlign: "center", fontSize: 14 }}>
          {spinError}
        </div>
      )}

      </>
      )}

      {activeDealsLoading && !issuedCode && !initialEventId && (
        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15,59,111,0.07)", border: "1px solid rgba(15,59,111,0.15)", fontSize: 13, fontWeight: 850, textAlign: "center", color: "#0f3b6f", width: "100%", boxSizing: "border-box" }}>
          Checking for your saved deal codes…
        </div>
      )}

      {activeDealsError && !issuedCode && !initialEventId && (
        <div style={{ padding: 12, borderRadius: 12, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)", fontSize: 13, fontWeight: 800, textAlign: "center", width: "100%", boxSizing: "border-box" }}>
          <div>{activeDealsError}</div>
          <button onClick={() => void loadActiveDeals()} style={{ marginTop: 8, padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", fontWeight: 900, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      )}

      {issuedCode && (
        <div style={{ padding: 14, border: "2px solid #C8960C", borderRadius: 14, background: "white", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 4px 24px rgba(200,150,12,0.18), 0 2px 8px rgba(0,0,0,0.06)", width: "100%", boxSizing: "border-box" }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>Your Active Deal</div>
          <div style={{ padding: "9px 12px", borderRadius: 10, background: "rgba(34,197,94,0.09)", border: "1px solid rgba(34,197,94,0.24)", fontSize: 13, fontWeight: 850, color: "#166534" }}>
            Saved to your Wheel Deals account. This QR code will reappear here until it is redeemed or expires.
          </div>
          {activeDeals.length > 1 && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 900, color: "#374151" }}>
              You have {activeDeals.length} active deals for this merchant
              <select
                value={selectedActiveSpinId}
                onChange={(event) => {
                  const deal = activeDeals.find((item) => item.spinId === event.target.value) ?? null;
                  applyActiveDeal(deal);
                  setEmailInput("");
                  setEmailStatus(null);
                }}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", fontSize: 14, fontWeight: 800 }}
              >
                {activeDeals.map((deal) => (
                  <option key={deal.spinId} value={deal.spinId}>
                    {deal.prizeLabel} — expires {new Date(deal.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Deal: <b>{lastPrize ?? "—"}</b> · Merchant: <b>{selectedMerchant.name}</b>
          </div>
          <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: 1 }}>{issuedCode}</div>
          <div style={{ opacity: 0.7, fontSize: 13 }}>Show this code (or QR) to the merchant to redeem (one-time use).</div>
          <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 13, fontWeight: 800, color: "#b91c1c" }}>
            ⏳ Expires: {expiresAt ? new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "30 days from now"} — Redeem before it expires!
          </div>

          <div style={{ display: "flex", justifyContent: "center", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <QRCodeCanvas value={issuedCode} size={180} />
            <div style={{ fontSize: 11, opacity: 0.65, textAlign: "center" }}>Merchant can scan this QR or type the code.</div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => navigator.clipboard.writeText(issuedCode)} style={{
              padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
              fontWeight: 900, cursor: "pointer", background: "linear-gradient(180deg, #f3f4f6, #fff)", fontSize: 13,
            }}>
              Copy code
            </button>
          </div>

          {/* Email code */}
          <div style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.10)", background: "rgba(246,196,83,0.08)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 950, fontSize: 14 }}>Email this code to yourself</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="your@email.com"
                style={{ flex: 1, minWidth: 160, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, fontWeight: 700 }}
              />
              <button
                onClick={sendCodeByEmail}
                disabled={emailSending || !emailInput.trim()}
                style={{
                  padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
                  fontWeight: 950, cursor: emailSending || !emailInput.trim() ? "not-allowed" : "pointer", fontSize: 13,
                  background: emailSending || !emailInput.trim()
                    ? "linear-gradient(180deg, #f3f4f6, #fff)"
                    : "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                  opacity: emailSending || !emailInput.trim() ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {emailSending ? "Sending…" : "✉️ Send"}
              </button>
            </div>
            {emailStatus && <div style={{ fontWeight: 800, fontSize: 13, opacity: 0.85 }}>{emailStatus}</div>}
          </div>
        </div>
      )}

      {/* Share Your Beast card — shown after unlock */}
      {issuedCode && lastBeast && lastBeastSpinId === selectedActiveSpinId && (
        <div style={{
          padding: 16, borderRadius: 14, background: lastBeast.tier.bgGradient,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          width: "100%", boxSizing: "border-box",
          boxShadow: `0 4px 24px ${lastBeast.tier.glowColor}33`,
          border: `2px solid ${lastBeast.tier.glowColor}44`,
        }}>
          <div style={{ fontWeight: 950, fontSize: 16, color: lastBeast.tier.glowColor, letterSpacing: 1, textTransform: "uppercase" }}>
            {lastBeast.tier.label}
          </div>
          <img
            src={lastBeast.beast.imagePath}
            alt={lastBeast.beast.name}
            style={{
              width: 200, height: 200, objectFit: "contain",
              filter: `drop-shadow(0 0 16px ${lastBeast.tier.glowColor})`,
              borderRadius: 12,
            }}
          />
          <div style={{ fontWeight: 950, fontSize: 20, color: "#fff", letterSpacing: 2, textTransform: "uppercase",
            textShadow: `0 0 12px ${lastBeast.tier.glowColor}` }}>
            {lastBeast.beast.name}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={shareBeast}
              disabled={beastActionBusy}
              style={{
                padding: "10px 20px", borderRadius: 10, border: "none", fontWeight: 950, fontSize: 14,
                cursor: beastActionBusy ? "wait" : "pointer", color: "#111",
                opacity: beastActionBusy ? 0.7 : 1,
                background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
              }}
            >
              {beastActionBusy ? "Preparing…" : "Share Deal & Beast"}
            </button>
            <button
              onClick={saveCurrentBeast}
              disabled={beastActionBusy}
              style={{
                padding: "10px 20px", borderRadius: 10, border: `1px solid ${lastBeast.tier.glowColor}66`,
                fontWeight: 950, fontSize: 14, cursor: beastActionBusy ? "wait" : "pointer",
                opacity: beastActionBusy ? 0.7 : 1,
                color: "#fff", background: "rgba(255,255,255,0.1)",
              }}
            >
              Save Branded Image
            </button>
          </div>
          {beastActionStatus && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", textAlign: "center", fontWeight: 750 }}>
              {beastActionStatus}
            </div>
          )}
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)", textAlign: "center", fontWeight: 650, lineHeight: 1.45 }}>
            Your branded image includes the deal, merchant, Beast, Wheel Deals logo, and wheeldealsapp.com.<br />
            Collect all 100 Wheel Deals Beasts!
          </div>
        </div>
      )}

      {/* Support modal */}
      {supportOpen && (
        <div onClick={() => setSupportOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 420,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 950, fontSize: 18 }}>Contact Support</div>
              <button onClick={() => setSupportOpen(false)} style={{
                background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280", padding: 4,
              }}>✕</button>
            </div>
            {supportStatus === "sent" ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>Message Sent!</div>
                <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>We'll get back to you as soon as possible. {supportEmail.trim() ? "Check your email for a confirmation." : ""}</div>
                <button onClick={() => setSupportOpen(false)} style={{
                  marginTop: 16, padding: "10px 24px", borderRadius: 10, border: "none", fontWeight: 900,
                  background: "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                  cursor: "pointer", fontSize: 14,
                }}>Done</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                  Having an issue? Let us know and we'll help you out.
                </div>
                <input
                  type="text" placeholder="Your name (optional)"
                  value={supportName} onChange={(e) => setSupportName(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, fontWeight: 700 }}
                />
                <input
                  type="email" placeholder="Your email (optional, for reply)"
                  value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, fontWeight: 700 }}
                />
                <textarea
                  placeholder="Describe your issue..."
                  value={supportMsg} onChange={(e) => setSupportMsg(e.target.value)}
                  rows={4}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, fontWeight: 700, resize: "vertical", fontFamily: "inherit" }}
                />
                {supportStatus === "error" && (
                  <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 800 }}>Failed to send. Please try again.</div>
                )}
                <button
                  onClick={sendSupportMessage}
                  disabled={supportSending || !supportMsg.trim()}
                  style={{
                    padding: "12px 16px", borderRadius: 10, border: "none", fontWeight: 950, fontSize: 14,
                    cursor: supportSending || !supportMsg.trim() ? "not-allowed" : "pointer",
                    background: supportSending || !supportMsg.trim()
                      ? "linear-gradient(180deg, #e5e7eb, #d1d5db)"
                      : "linear-gradient(180deg, rgba(255,217,61,0.95), rgba(255,155,61,0.95))",
                    color: "#111",
                  }}
                >
                  {supportSending ? "Sending..." : "Send Message"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Animal celebration overlay — shown immediately after unlock, dismissed after ~2.8s or tap */}
      {celebrationVisible && (
        <SpinCelebration
          sliceWeightPct={celebrationWeightPct}
          dealLabel={celebrationLabel}
          selectedBeast={lastBeast ?? undefined}
          onDone={() => {
            setCelebrationVisible(false);
            // Now reveal the code card
            const pending = pendingResultRef.current;
            if (pending) {
              const activeDeal: ActiveDeal = {
                spinId: pending.spinId ?? pending.code,
                prizeLabel: pending.label,
                code: pending.code,
                expiresAt: pending.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date().toISOString(),
              };
              setActiveDeals((current) => [
                activeDeal,
                ...current.filter((deal) => deal.spinId !== activeDeal.spinId && deal.code !== activeDeal.code),
              ]);
              setSelectedActiveSpinId(activeDeal.spinId);
              setLastPrize(activeDeal.prizeLabel);
              setIssuedCode(activeDeal.code);
              setExpiresAt(activeDeal.expiresAt);
              pendingResultRef.current = null;
            }
          }}
        />
      )}
    </div>
  );
}
