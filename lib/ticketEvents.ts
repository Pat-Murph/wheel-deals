// lib/ticketEvents.ts
// Shared types and helpers for the Ticket Event feature

export type TicketEvent = {
  id: string;
  merchantId: string;
  merchantName?: string;

  // Event config
  totalSpots: number;
  spotsTaken: number;
  spinTime: string; // ISO datetime string — when the wheel spins for all entrants
  
  // Validity / scheduling
  eventDate: string; // YYYY-MM-DD — the date this event is for
  validDates?: string[]; // If multiple dates, list them here
  
  // Recurring
  recurring: boolean;
  recurrencePattern?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  recurrenceDays?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat (for weekly)
  
  // Status
  status: 'active' | 'spinning' | 'completed' | 'paused';
  
  // Pricing — uses the merchant's existing wheel price
  spotPriceCents: number;
  
  // Timestamps
  createdAt?: any;
  updatedAt?: any;
  completedAt?: any;
  
  // Results (populated after spin)
  results?: TicketEventResult[];
};

export type TicketEventEntry = {
  id: string;
  eventId: string;
  merchantId: string;
  uid: string;
  spotCount: number; // 1-4
  purchasedAt?: any;
  sessionId?: string; // Stripe session ID
  deviceFingerprint?: string;
};

export type TicketEventResult = {
  entryId: string;
  uid: string;
  spotIndex: number; // which spot (if user bought multiple)
  prizeLabel: string;
  code: string;
  expiresAt: string; // ISO
};

// Helper: check if an event is currently active (not past spin time, not completed)
export function isEventActive(event: TicketEvent): boolean {
  if (event.status !== 'active') return false;
  const spinTime = new Date(event.spinTime);
  return spinTime.getTime() > Date.now();
}

// Helper: check if event is full
export function isEventFull(event: TicketEvent): boolean {
  return event.spotsTaken >= event.totalSpots;
}

// Helper: get time remaining until spin
export function getTimeUntilSpin(event: TicketEvent): number {
  const spinTime = new Date(event.spinTime);
  return Math.max(0, spinTime.getTime() - Date.now());
}

// Helper: format countdown
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Spinning now!";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
