export type UserRole = 'player' | 'owner';
export type PaymentStatus = 'pending' | 'confirmed' | 'correction_requested';
export type SessionStatus = 'scheduled' | 'attended' | 'late_cancel' | 'no_show' | 'cancelled_on_time_pending' | 'cancelled_on_time' | 'cancelled_by_club';
export type SportType = 'volleyball' | 'futsal' | 'other';
export type BookingStatus = 'pending' | 'awaiting_payment' | 'payment_submitted' | 'needs_correction' | 'booked' | 'rejected' | 'expired' | 'cancelled';
export type BookingDeadlineKind = 'initial_review' | 'payment' | 'correction';
export type BookingNotificationType = 'booking_request' | 'booking_balance_applied' | 'initial_approved' | 'initial_rejected' | 'payment_reported' | 'payment_correction' | 'booking_confirmed' | 'booking_rejected' | 'booking_cancelled' | 'booking_expired' | 'booking_message';
export type PublicScheduleStatus = 'booked' | 'cancelled';

export interface ClubMembershipRecord {
  clubId: string;
  clubName: string;
  uid: string;
  email: string;
  role: UserRole;
  active: boolean;
  joinedAt?: string;
}

export interface CourtInfo {
  id: string;
  name: string;
}

export interface ArchivedCourtInfo extends CourtInfo {
  archivedAt: string;
  archivedByUid: string;
}

export interface BookingRecord {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  courtId: string;
  courtName: string;
  sport: SportType;
  bookedForName: string;
  priceToman: number;
  note: string;
  status: BookingStatus;
  lockIds: string[];
  createdAt: string;
  createdByUid: string;
  accountUid?: string;
  createdByEmail?: string;
  attachmentPath?: string;
  attachmentName?: string;
  attachmentContentType?: string;
  attachmentSize?: number;
  attachmentDataUrl?: string;
  phaseDeadlineAt?: string;
  phaseDeadlineKind?: BookingDeadlineKind;
  initialApprovedAt?: string;
  initialApprovedByUid?: string;
  paymentReportedAt?: string;
  paymentNote?: string;
  correctionRequestedAt?: string;
  correctionRequestedByUid?: string;
  correctionNote?: string;
  approvedAt?: string;
  approvedByUid?: string;
  rejectedAt?: string;
  rejectedByUid?: string;
  rejectionReason?: string;
  expiredAt?: string;
  expiryReason?: string;
  cancelledAt?: string;
  archivedAt?: string;
  accountBalanceAppliedToman?: number;
  balanceHoldToman?: number;
  paymentReportedAmountToman?: number;
  paymentLedgerId?: string;
  sessionRecordId?: string;
  sessionSettledAt?: string;
}

// This public projection contains only court/time availability, never booking lifecycle or customer details.
export interface PublicScheduleRecord {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  courtId: string;
  courtName: string;
  status: PublicScheduleStatus;
}

export interface BookingMessageRecord {
  id: string;
  bookingId: string;
  body: string;
  senderUid: string;
  senderRole: UserRole;
  createdAt: string;
  kind?: 'text' | 'payment_report' | 'status';
  attachmentPath?: string;
  attachmentName?: string;
  attachmentContentType?: string;
  attachmentSize?: number;
  attachmentDataUrl?: string;
}

export interface AppNotificationRecord {
  id: string;
  recipientUid: string;
  bookingId: string;
  type: BookingNotificationType;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
}

export interface PaymentRevision {
  amountToman: number;
  note: string;
  paidAt: string;
  changedAt: string;
  changedByUid: string;
}

export interface PaymentRecord {
  id: string;
  amountToman: number;
  note: string;
  paidAt: string;
  status: PaymentStatus;
  createdAt: string;
  bookingId?: string;
  createdByUid: string;
  accountUid?: string;
  createdByEmail: string;
  history: PaymentRevision[];
  reviewNote?: string;
  reviewedByUid?: string;
  reviewedAt?: string;
}

export interface SessionRecord {
  id: string;
  date: string;
  priceToman: number;
  status: SessionStatus;
  note: string;
  createdAt: string;
  bookingId?: string;
  createdByUid: string;
  accountUid?: string;
  createdByEmail: string;
  reviewNote?: string;
  reviewedByUid?: string;
  reviewedAt?: string;
}

export interface ClubSettings {
  clubName: string;
  defaultSessionPriceToman: number;
  publicScheduleEnabled: boolean;
  ownerPhone: string;
  courts: CourtInfo[];
  archivedCourts: ArchivedCourtInfo[];
  ownerUid?: string;
}

export interface DemoData {
  payments: PaymentRecord[];
  sessions: SessionRecord[];
  bookings: BookingRecord[];
  bookingMessages: BookingMessageRecord[];
  notifications: AppNotificationRecord[];
  settings: ClubSettings;
}

export const DEMO_CLUB_ID = 'demo-volleyball-ledger';
export const DEMO_STORAGE_KEY = 'sansyar-demo-data-v4';

export const DEFAULT_SETTINGS: ClubSettings = {
  clubName: 'باشگاه ورزشی',
  defaultSessionPriceToman: 0,
  publicScheduleEnabled: false,
  ownerPhone: '',
  courts: [{ id: 'court-1', name: 'زمین ۱' }],
  archivedCourts: [],
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'در انتظار تأیید',
  confirmed: 'تأیید شده',
  correction_requested: 'نیازمند اصلاح',
};

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: 'برنامه‌ریزی‌شده',
  attended: 'حضور داشتم',
  late_cancel: 'لغو دیرهنگام',
  no_show: 'غیبت / لغو نکردم',
  cancelled_on_time_pending: 'در انتظار تأیید لغو',
  cancelled_on_time: 'لغو به‌موقع تأیید شد',
  cancelled_by_club: 'لغو توسط باشگاه',
};

export function isChargeable(status: SessionStatus): boolean {
  return status === 'attended' || status === 'late_cancel' || status === 'no_show';
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(Math.max(0, Math.trunc(value || 0)));
}

export function formatToman(value: number): string {
  return `${formatNumber(Math.abs(value))} تومان`;
}

export function signedToman(value: number): string {
  if (value > 0) return `+ ${formatToman(value)}`;
  if (value < 0) return `− ${formatToman(value)}`;
  return '۰ تومان';
}

export function parseToman(value: string): number {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const latinized = value
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)));
  const digits = latinized.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

export function todayISO(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function relativeDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(value: string): string {
  if (!value) return '—';
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fa-IR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function makeDemoData(): DemoData {
  const now = new Date().toISOString();
  return {
    settings: {
      clubName: 'باشگاه ورزشی',
      defaultSessionPriceToman: 350_000,
      publicScheduleEnabled: true,
      ownerPhone: '',
      courts: [
        { id: 'court-1', name: 'زمین ۱' },
        { id: 'court-2', name: 'زمین ۲' },
      ],
      archivedCourts: [],
      ownerUid: 'demo-owner',
    },
    notifications: [],
    bookings: [
      {
        id: 'demo-booking-1',
        date: todayISO(),
        startTime: '09:00',
        endTime: '10:30',
        courtId: 'court-1',
        courtName: 'زمین ۱',
        sport: 'volleyball',
        bookedForName: 'علی رضایی',
        priceToman: 350_000,
        note: '',
        status: 'booked',
        lockIds: [],
        createdAt: now,
        createdByUid: 'demo-owner',
      },
      {
        id: 'demo-booking-2',
        date: todayISO(),
        startTime: '09:00',
        endTime: '10:30',
        courtId: 'court-2',
        courtName: 'زمین ۲',
        sport: 'futsal',
        bookedForName: 'گروه فوتسال آذر',
        priceToman: 600_000,
        note: 'نمونهٔ رزرو فوتسال',
        status: 'booked',
        lockIds: [],
        createdAt: now,
        createdByUid: 'demo-owner',
      },
      {
        id: 'demo-booking-cancelled',
        date: relativeDate(-1),
        startTime: '18:00',
        endTime: '19:30',
        courtId: 'court-1',
        courtName: 'زمین ۱',
        sport: 'volleyball',
        bookedForName: 'مریم احمدی',
        priceToman: 350_000,
        note: '',
        status: 'cancelled',
        lockIds: [],
        createdAt: now,
        createdByUid: 'demo-owner',
      },
    ],
    bookingMessages: [],
    payments: [
      {
        id: 'demo-payment-confirmed',
        amountToman: 2_000_000,
        note: 'پیش‌پرداخت چند جلسه',
        paidAt: relativeDate(8),
        status: 'confirmed',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
        history: [],
      },
      {
        id: 'demo-payment-pending',
        amountToman: 400_000,
        note: 'رسید متنی: کارت‌به‌کارت',
        paidAt: relativeDate(1),
        status: 'pending',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
        history: [],
      },
    ],
    sessions: [
      {
        id: 'demo-session-1',
        date: relativeDate(14),
        priceToman: 350_000,
        status: 'attended',
        note: 'سانس هفتگی',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
      },
      {
        id: 'demo-session-2',
        date: relativeDate(7),
        priceToman: 350_000,
        status: 'attended',
        note: 'سانس هفتگی',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
      },
      {
        id: 'demo-session-3',
        date: relativeDate(3),
        priceToman: 350_000,
        status: 'late_cancel',
        note: 'نمونهٔ لغو دیرهنگام',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
      },
      {
        id: 'demo-session-4',
        date: relativeDate(1),
        priceToman: 350_000,
        status: 'cancelled_on_time_pending',
        note: 'لغو به‌موقع؛ منتظر بررسی صاحب باشگاه',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
      },
      {
        id: 'demo-session-5',
        date: relativeDate(5),
        priceToman: 350_000,
        status: 'cancelled_on_time',
        note: 'لغو به‌موقع تأییدشده',
        createdAt: now,
        createdByUid: 'demo-player',
        createdByEmail: 'player@example.com',
      },
    ],
  };
}

export function readDemoData(): DemoData {
  if (typeof window === 'undefined') return makeDemoData();
  try {
    const saved = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!saved) return makeDemoData();
    const parsed = JSON.parse(saved) as Partial<DemoData>;
    if (!Array.isArray(parsed.payments) || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.bookings) || !Array.isArray(parsed.bookingMessages)) return makeDemoData();
    return {
      payments: parsed.payments as PaymentRecord[],
      sessions: parsed.sessions as SessionRecord[],
      bookings: parsed.bookings as BookingRecord[],
      bookingMessages: parsed.bookingMessages as BookingMessageRecord[],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications as AppNotificationRecord[] : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}), archivedCourts: Array.isArray(parsed.settings?.archivedCourts) ? parsed.settings.archivedCourts : [] },
    };
  } catch {
    return makeDemoData();
  }
}
