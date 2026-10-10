import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Clock3,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  Info,
  LoaderCircle,
  LogOut,
  Link2,
  MapPin,
  MessageCircle,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  RefreshCcw,
  Send,
  Settings2,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  or,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  updateDoc,
  where,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  auth,
  db,
  storage,
  firebaseApp,
  firebaseConfig,
  vapidKey,
  firebaseReady,
  getCurrentFirebaseSettings,
  hasFirebaseConfig,
  saveFirebaseSettings,
  type FirebaseLocalSettings,
} from './firebase';
import {
  DEMO_CLUB_ID,
  DEFAULT_SETTINGS,
  DEMO_STORAGE_KEY,
  PAYMENT_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  formatDate,
  formatNumber,
  formatToman,
  isChargeable,
  parseToman,
  readDemoData,
  todayISO,
  type AppNotificationRecord,
  type ArchivedCourtInfo,
  type BookingRecord,
  type BookingDeadlineKind,
  type BookingMessageRecord,
  type BookingNotificationType,
  type BookingStatus,
  type ClubMembershipRecord,
  type ClubSettings,
  type CourtInfo,
  type DemoData,
  type PaymentRecord,
  type PublicScheduleRecord,
  type PaymentRevision,
  type PaymentStatus,
  type SessionRecord,
  type SessionStatus,
  type SportType,
  type UserRole,
} from './domain';
import { JalaliCalendar } from './JalaliCalendar';
import { ScheduleBoard } from './ScheduleBoard';
import { bookingOverlaps, formatJalaliDate, formatTimeRange, getWeeklyDates, makeSlotLockIds, shiftISODate, timeToMinutes } from './scheduleUtils';

type TabName = 'activity' | 'payments' | 'sessions';
type MainView = 'ledger' | 'schedule' | 'archive';
type AppModal =
  | { type: 'payment'; payment?: PaymentRecord }
  | { type: 'session'; session?: SessionRecord }
  | { type: 'booking'; date: string; courtId: string; startTime: string; endTime: string }
  | { type: 'requestBooking'; date: string; courtId: string; startTime: string; endTime: string }
  | { type: 'bookingConversation'; booking: BookingRecord }
  | { type: 'bookingReview'; booking: BookingRecord }
  | { type: 'review'; payment: PaymentRecord }
  | { type: 'settings' }
  | { type: 'firebase' }
  | null;

type PaymentInput = { amountToman: number; note: string; paidAt: string };
type SessionInput = { date: string; priceToman: number; status: SessionStatus; note: string };
type BookingInput = {
  accountUid?: string;
  date: string;
  startTime: string;
  endTime: string;
  courtId: string;
  courtName: string;
  sport: SportType;
  bookedForName: string;
  priceToman: number;
  note: string;
  repeatWeekly: boolean;
  repeatUntil: string;
};

type BookingDraft = Pick<BookingInput, 'date' | 'courtId' | 'startTime' | 'endTime'>;

const ActiveClubIdContext = createContext(DEMO_CLUB_ID);

function timestampToIso(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return typeof value === 'string' ? value : new Date().toISOString();
}

function mapPayment(id: string, data: DocumentData): PaymentRecord {
  return {
    id,
    amountToman: Number(data.amountToman ?? 0),
    note: String(data.note ?? ''),
    paidAt: String(data.paidAt ?? ''),
    status: (data.status ?? 'pending') as PaymentStatus,
    createdAt: timestampToIso(data.createdAt),
    createdByUid: String(data.createdByUid ?? ''),
    accountUid: typeof data.accountUid === 'string' ? data.accountUid : undefined,
    createdByEmail: String(data.createdByEmail ?? ''),
    history: Array.isArray(data.history) ? (data.history as PaymentRevision[]) : [],
    bookingId: typeof data.bookingId === 'string' ? data.bookingId : '',
    reviewNote: typeof data.reviewNote === 'string' ? data.reviewNote : '',
    reviewedByUid: typeof data.reviewedByUid === 'string' ? data.reviewedByUid : '',
    reviewedAt: data.reviewedAt ? timestampToIso(data.reviewedAt) : '',
  };
}

function mapSession(id: string, data: DocumentData): SessionRecord {
  return {
    id,
    date: String(data.date ?? ''),
    priceToman: Number(data.priceToman ?? 0),
    status: (data.status ?? 'attended') as SessionStatus,
    note: String(data.note ?? ''),
    createdAt: timestampToIso(data.createdAt),
    createdByUid: String(data.createdByUid ?? ''),
    accountUid: typeof data.accountUid === 'string' ? data.accountUid : undefined,
    createdByEmail: String(data.createdByEmail ?? ''),
    reviewNote: typeof data.reviewNote === 'string' ? data.reviewNote : '',
    reviewedByUid: typeof data.reviewedByUid === 'string' ? data.reviewedByUid : '',
    reviewedAt: data.reviewedAt ? timestampToIso(data.reviewedAt) : '',
    bookingId: typeof data.bookingId === 'string' ? data.bookingId : '',
  };
}

function mapBooking(id: string, data: DocumentData): BookingRecord {
  return {
    id,
    date: String(data.date ?? ''),
    startTime: String(data.startTime ?? ''),
    endTime: String(data.endTime ?? ''),
    courtId: String(data.courtId ?? ''),
    courtName: String(data.courtName ?? 'زمین'),
    sport: (data.sport ?? 'volleyball') as SportType,
    bookedForName: String(data.bookedForName ?? ''),
    priceToman: Number(data.priceToman ?? 0),
    note: String(data.note ?? ''),
    status: (data.status ?? 'booked') as BookingStatus,
    lockIds: Array.isArray(data.lockIds) ? data.lockIds.map(String) : [],
    createdAt: timestampToIso(data.createdAt),
    createdByUid: String(data.createdByUid ?? ''),
    accountUid: typeof data.accountUid === 'string' ? data.accountUid : undefined,
    createdByEmail: typeof data.createdByEmail === 'string' ? data.createdByEmail : '',
    attachmentPath: typeof data.attachmentPath === 'string' ? data.attachmentPath : '',
    attachmentName: typeof data.attachmentName === 'string' ? data.attachmentName : '',
    attachmentContentType: typeof data.attachmentContentType === 'string' ? data.attachmentContentType : '',
    attachmentSize: Number(data.attachmentSize ?? 0),
    phaseDeadlineAt: data.phaseDeadlineAt ? timestampToIso(data.phaseDeadlineAt) : '',
    phaseDeadlineKind: ['initial_review', 'payment', 'correction'].includes(String(data.phaseDeadlineKind)) ? data.phaseDeadlineKind as BookingDeadlineKind : undefined,
    initialApprovedAt: data.initialApprovedAt ? timestampToIso(data.initialApprovedAt) : '',
    initialApprovedByUid: typeof data.initialApprovedByUid === 'string' ? data.initialApprovedByUid : '',
    paymentReportedAt: data.paymentReportedAt ? timestampToIso(data.paymentReportedAt) : '',
    paymentNote: typeof data.paymentNote === 'string' ? data.paymentNote : '',
    correctionRequestedAt: data.correctionRequestedAt ? timestampToIso(data.correctionRequestedAt) : '',
    correctionRequestedByUid: typeof data.correctionRequestedByUid === 'string' ? data.correctionRequestedByUid : '',
    correctionNote: typeof data.correctionNote === 'string' ? data.correctionNote : '',
    approvedAt: data.approvedAt ? timestampToIso(data.approvedAt) : '',
    approvedByUid: typeof data.approvedByUid === 'string' ? data.approvedByUid : '',
    rejectedAt: data.rejectedAt ? timestampToIso(data.rejectedAt) : '',
    rejectedByUid: typeof data.rejectedByUid === 'string' ? data.rejectedByUid : '',
    rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : '',
    expiredAt: data.expiredAt ? timestampToIso(data.expiredAt) : '',
    expiryReason: typeof data.expiryReason === 'string' ? data.expiryReason : '',
    cancelledAt: data.cancelledAt ? timestampToIso(data.cancelledAt) : '',
    archivedAt: data.archivedAt ? timestampToIso(data.archivedAt) : '',
    accountBalanceAppliedToman: Number(data.accountBalanceAppliedToman ?? 0),
    balanceHoldToman: Number(data.balanceHoldToman ?? 0),
    paymentReportedAmountToman: Number(data.paymentReportedAmountToman ?? 0),
    paymentLedgerId: typeof data.paymentLedgerId === 'string' ? data.paymentLedgerId : '',
    sessionRecordId: typeof data.sessionRecordId === 'string' ? data.sessionRecordId : '',
    sessionSettledAt: data.sessionSettledAt ? timestampToIso(data.sessionSettledAt) : '',
  };
}

function mapPublicSchedule(id: string, data: DocumentData): PublicScheduleRecord {
  return {
    id,
    date: String(data.date ?? ''),
    startTime: String(data.startTime ?? ''),
    endTime: String(data.endTime ?? ''),
    courtId: String(data.courtId ?? ''),
    courtName: String(data.courtName ?? 'زمین'),
    status: data.status === 'cancelled' ? 'cancelled' : 'booked',
  };
}

function mapNotification(id: string, data: DocumentData): AppNotificationRecord {
  return {
    id,
    recipientUid: String(data.recipientUid ?? ''),
    bookingId: String(data.bookingId ?? ''),
    type: data.type as BookingNotificationType,
    title: String(data.title ?? 'به‌روزرسانی رزرو'),
    body: String(data.body ?? ''),
    createdAt: timestampToIso(data.createdAt),
    readAt: data.readAt ? timestampToIso(data.readAt) : '',
  };
}

function makeNotification(
  recipientUid: string,
  booking: Pick<BookingRecord, 'id' | 'courtName' | 'startTime' | 'endTime'>,
  type: BookingNotificationType,
  title: string,
  body: string,
  messageId?: string,
): Omit<AppNotificationRecord, 'createdAt'> & { createdAt?: string; messageId?: string } {
  return { id: crypto.randomUUID(), recipientUid, bookingId: booking.id, type, title, body, readAt: '', ...(messageId ? { messageId } : {}) };
}

function timeRemaining(deadline?: string, now = Date.now()): string {
  if (!deadline) return '';
  const milliseconds = new Date(deadline).getTime() - now;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'مهلت تمام شده';
  const minutes = Math.ceil(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${formatNumber(hours)} ساعت و ${formatNumber(rest)} دقیقه باقی‌مانده` : `${formatNumber(minutes)} دقیقه باقی‌مانده`;
}

function isBookingActive(status: BookingStatus): boolean {
  return ['pending', 'awaiting_payment', 'payment_submitted', 'needs_correction', 'booked'].includes(status);
}

function bookingStatusLabel(status: BookingStatus): string {
  if (status === 'pending') return 'در انتظار تأیید اولیه';
  if (status === 'awaiting_payment') return 'در انتظار پرداخت';
  if (status === 'payment_submitted') return 'در انتظار تأیید پرداخت';
  if (status === 'needs_correction') return 'نیازمند اصلاح پرداخت';
  if (status === 'booked') return 'رزرو قطعی';
  if (status === 'rejected') return 'رد نهایی';
  if (status === 'expired') return 'منقضی شده';
  return 'لغو شده';
}

function sportName(sport: SportType): string {
  if (sport === 'volleyball') return 'والیبال';
  if (sport === 'futsal') return 'فوتسال';
  return 'ورزش دیگر';
}

function getFriendlyError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'auth/account-exists-with-different-credential') return 'این ایمیل از قبل با روش ورود دیگری حساب دارد. با روش قبلی وارد شو و سپس Google را از حساب کاربری پیوند بده تا UID و عضویت‌ها حفظ شوند.';
  if (code === 'auth/email-already-in-use') return 'این ایمیل از قبل حساب دارد؛ با روش ورود قبلی وارد شو.';
  if (code === 'auth/credential-already-in-use') return 'این حساب Google به یک حساب Firebase دیگر متصل است و دو حساب به‌صورت خودکار ادغام نمی‌شوند.';
  if (code === 'auth/provider-already-linked') return 'این روش ورود از قبل به حساب متصل است.';
  if (code === 'auth/popup-blocked') return 'پنجرهٔ ورود Google مسدود شد؛ اجازهٔ بازشدن پنجره را بده و دوباره تلاش کن.';
  if (code === 'auth/popup-closed-by-user') return 'پنجرهٔ ورود Google پیش از پایان بسته شد.';
  if (code === 'auth/requires-recent-login') return 'برای تغییر روش‌های ورود، یک‌بار خارج شو و دوباره وارد شو.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'ایمیل یا رمز عبور درست نیست.';
  if (code === 'auth/weak-password') return 'رمز عبور باید حداقل ۶ نویسه باشد.';
  if (code === 'auth/invalid-email') return 'فرمت ایمیل درست نیست.';
  if (code === 'auth/operation-not-allowed') return 'روش ورود انتخاب‌شده را در Firebase Authentication فعال کن.';
  if (code === 'auth/unauthorized-domain') return 'دامنهٔ فعلی را به Authorized domains در تنظیمات Firebase Authentication اضافه کن.';
  if (code === 'auth/invalid-api-key') return 'Firebase API key نادرست است؛ تنظیمات Web App را دوباره بررسی کن.';
  if (code === 'auth/network-request-failed' || code === 'unavailable' || code === 'firestore/unavailable' || code === 'deadline-exceeded') {
    return 'ارتباط مستقیم با Firebase برقرار نشد؛ اینترنت و دسترسی این سرویس را از همین شبکه بررسی کن.';
  }
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'Firebase Storage اجازه نداد؛ ورود، مسیر رسید و ایمیل‌ها در storage.rules را بررسی کن.';
  }
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Firestore اجازه نداد؛ ایمیل‌ها و قواعد firestore.rules را بررسی کن.';
  }
  return (error as { message?: string })?.message ?? 'یک خطای پیش‌بینی‌نشده رخ داد.';
}

type BookingDetails = Omit<BookingInput, 'repeatWeekly' | 'repeatUntil'>;
type RequestFormInput = { bookedForName: string; sport: SportType; message: string };

async function reserveRemoteBooking(firestore: Firestore, clubId: string, userUid: string, input: BookingDetails, userEmail = ''): Promise<string> {
  const lockIds = makeSlotLockIds(input.courtId, input.date, input.startTime, input.endTime);
  const bookingRef = doc(collection(firestore, 'clubs', clubId, 'bookings'));
  const publicRef = doc(firestore, 'clubs', clubId, 'publicSchedule', bookingRef.id);
  const sessionRef = doc(collection(firestore, 'clubs', clubId, 'sessions'));
  const lockRefs = lockIds.map((lockId) => doc(firestore, 'clubs', clubId, 'slotLocks', lockId));
  await runTransaction(firestore, async (transaction) => {
    const lockSnapshots = await Promise.all(lockRefs.map((lockRef) => transaction.get(lockRef)));
    if (lockSnapshots.some((snapshot) => snapshot.exists())) {
      throw Object.assign(new Error('slot is already occupied'), { code: 'booking-slot-conflict' });
    }
    lockRefs.forEach((lockRef) => transaction.set(lockRef, {
      bookingId: bookingRef.id,
      courtId: input.courtId,
      date: input.date,
      createdAt: serverTimestamp(),
    }));
    transaction.set(bookingRef, {
      ...input,
      accountUid: input.accountUid || userUid,
      status: 'booked',
      lockIds,
      accountBalanceAppliedToman: 0,
      balanceHoldToman: 0,
      paymentReportedAmountToman: 0,
      paymentLedgerId: null,
      sessionRecordId: sessionRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: userUid,
      createdByEmail: userEmail,
    });
    transaction.set(publicRef, {
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      courtId: input.courtId,
      courtName: input.courtName,
      status: 'booked',
      updatedAt: serverTimestamp(),
    });
    transaction.set(sessionRef, {
      bookingId: bookingRef.id,
      date: input.date,
      priceToman: input.priceToman,
      status: 'scheduled',
      note: `رزرو قطعی · ${input.courtName} · ${formatTimeRange(input.startTime, input.endTime)}`,
      createdAt: serverTimestamp(),
      createdByUid: userUid,
      accountUid: input.accountUid || userUid,
      createdByEmail: userEmail,
    });
  });
  return bookingRef.id;
}

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const MAX_DEMO_RECEIPT_BYTES = 2 * 1024 * 1024;
const RECEIPT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

type BookingAttachment = { path: string; name: string; contentType: string; size: number };

async function createRemoteBookingRequest(
  firestore: Firestore,
  clubId: string,
  userUid: string,
  userEmail: string,
  ownerUid: string,
  input: BookingDetails,
  initialMessage: string,
): Promise<string> {
  const lockIds = makeSlotLockIds(input.courtId, input.date, input.startTime, input.endTime);
  const bookingRef = doc(collection(firestore, 'clubs', clubId, 'bookings'));
  const publicRef = doc(firestore, 'clubs', clubId, 'publicSchedule', bookingRef.id);
  const lockRefs = lockIds.map((lockId) => doc(firestore, 'clubs', clubId, 'slotLocks', lockId));
  const messageRef = initialMessage.trim()
    ? doc(collection(firestore, 'clubs', clubId, 'bookings', bookingRef.id, 'messages'))
    : null;
  const deadline = Timestamp.fromDate(new Date(Date.now() + 30 * 60_000));
  const notification = makeNotification(
    ownerUid,
    { id: bookingRef.id, courtName: input.courtName, startTime: input.startTime, endTime: input.endTime },
    'booking_request',
    'درخواست رزرو جدید',
    `${input.courtName} · ${formatTimeRange(input.startTime, input.endTime)} · ${formatToman(input.priceToman)} · برای تأیید اولیه ۳۰ دقیقه فرصت داری.`,
  );
  const notificationRef = doc(firestore, 'clubs', clubId, 'notifications', notification.id);

  await runTransaction(firestore, async (transaction) => {
    // The player does not read lock documents (which would expose lock metadata).
    // A collision is denied atomically by the create-only slotLocks rule.
    transaction.set(bookingRef, {
      ...input,
      accountUid: userUid,
      status: 'pending',
      lockIds,
      phaseDeadlineAt: deadline,
      phaseDeadlineKind: 'initial_review',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: userUid,
      createdByEmail: userEmail,
    });
    transaction.set(publicRef, {
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      courtId: input.courtId,
      courtName: input.courtName,
      status: 'booked',
      updatedAt: serverTimestamp(),
    });
    lockRefs.forEach((lockRef) => transaction.set(lockRef, {
      bookingId: bookingRef.id,
      courtId: input.courtId,
      date: input.date,
      createdAt: serverTimestamp(),
    }));
    if (messageRef) transaction.set(messageRef, {
      bookingId: bookingRef.id,
      body: initialMessage.trim(),
      senderUid: userUid,
      senderRole: 'player',
      createdAt: serverTimestamp(),
    });
    transaction.set(notificationRef, { ...notification, createdAt: serverTimestamp(), readAt: null });
  });
  return bookingRef.id;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('فایل خوانده نشد.'));
    reader.onerror = () => reject(new Error('فایل خوانده نشد.'));
    reader.readAsDataURL(file);
  });
}

function safeAttachmentName(file: File): string {
  return [...file.name.trim()].slice(0, 40).join('') || 'receipt';
}

function buildRecurrenceReport(
  total: number,
  succeeded: number,
  conflictDates: string[],
  details: BookingDetails,
  fatalError: string,
  failedDates: string[] = [],
): string {
  const parts = [`از ${formatNumber(total)} نوبت، ${formatNumber(succeeded)} نوبت ثبت شد.`];
  if (conflictDates.length) {
    const dates = conflictDates.map(formatJalaliDate).join('، ');
    parts.push(`${formatNumber(conflictDates.length)} تداخل برای ${details.courtName} در ساعت ${formatTimeRange(details.startTime, details.endTime)} بود و ثبت نشد: ${dates}.`);
  }
  if (failedDates.length) {
    parts.push(`ثبت در ${formatNumber(failedDates.length)} تاریخ با خطا روبه‌رو شد: ${fatalError}`);
  }
  const notAttempted = total - succeeded - conflictDates.length - failedDates.length;
  if (fatalError && notAttempted > 0) parts.push(`${formatNumber(notAttempted)} نوبت بعدی به‌دلیل توقف سری بررسی نشد.`);
  return parts.join(' ');
}

function App() {
  const [demoData, setDemoData] = useState<DemoData>(() => readDemoData());
  const [demoRole, setDemoRole] = useState<UserRole>('player');
  const [user, setUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(!firebaseReady);
  const [memberships, setMemberships] = useState<ClubMembershipRecord[]>([]);
  const [membershipsResolved, setMembershipsResolved] = useState(!firebaseReady);
  const [activeClubId, setActiveClubId] = useState('');
  const [showClubHub, setShowClubHub] = useState(false);
  const [clubHubBusy, setClubHubBusy] = useState(false);
  const [clubHubError, setClubHubError] = useState('');
  const [remoteClubMembers, setRemoteClubMembers] = useState<ClubMembershipRecord[]>([]);
  const [remotePayments, setRemotePayments] = useState<PaymentRecord[]>([]);
  const [remoteSessions, setRemoteSessions] = useState<SessionRecord[]>([]);
  const [remoteSettings, setRemoteSettings] = useState<ClubSettings>(DEFAULT_SETTINGS);
  const [remoteBookings, setRemoteBookings] = useState<BookingRecord[]>([]);
  const [remotePublicSchedule, setRemotePublicSchedule] = useState<PublicScheduleRecord[]>([]);
  const [remoteNotifications, setRemoteNotifications] = useState<AppNotificationRecord[]>([]);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const initialNotificationIds = useRef<Set<string> | null>(null);
  const initialDemoNotificationIds = useRef<Set<string> | null>(null);
  const expiringBookingIds = useRef<Set<string>>(new Set());
  const [dataLoading, setDataLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleReport, setScheduleReport] = useState('');
  const [dataError, setDataError] = useState('');
  const [modal, setModal] = useState<AppModal>(null);
  const [view, setView] = useState<MainView>('ledger');
  const [scheduleDate, setScheduleDate] = useState(todayISO());
  const [tab, setTab] = useState<TabName>('activity');
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);

  const isDemo = !firebaseReady;
  const activeMembership = memberships.find((membership) => membership.clubId === activeClubId && membership.active);
  const clubId = isDemo ? DEMO_CLUB_ID : activeMembership?.clubId ?? '';
  const currentRole: UserRole = isDemo ? demoRole : activeMembership?.role ?? 'player';
  const isAllowedUser = isDemo || Boolean(user && activeMembership);
  const payments = isDemo
    ? currentRole === 'owner' ? demoData.payments : demoData.payments.filter((payment) => (payment.accountUid || payment.createdByUid) === 'demo-player')
    : remotePayments;
  const sessions = isDemo
    ? currentRole === 'owner' ? demoData.sessions : demoData.sessions.filter((session) => (session.accountUid || session.createdByUid) === 'demo-player')
    : remoteSessions;
  const settings = isDemo ? demoData.settings : remoteSettings;
  const bookings = isDemo
    ? currentRole === 'owner' ? demoData.bookings : demoData.bookings.filter((booking) => (booking.accountUid || booking.createdByUid) === 'demo-player')
    : remoteBookings;
  const publicSchedule = isDemo
    ? demoData.bookings.map((booking): PublicScheduleRecord => ({
        id: booking.id,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        courtId: booking.courtId,
        courtName: booking.courtName,
        status: isBookingActive(booking.status) ? 'booked' : 'cancelled',
      }))
    : remotePublicSchedule;
  const userNotifications = isDemo
    ? demoData.notifications.filter((item) => item.recipientUid === (currentRole === 'owner' ? 'demo-owner' : 'demo-player'))
    : remoteNotifications;

  useEffect(() => {
    if (!isDemo) return;
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(demoData));
    } catch {
      setToast('حافظهٔ محلی پر شده است؛ در حالت نمایشی فایل کوچک‌تری انتخاب کن.');
    }
  }, [demoData, isDemo]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isDemo || demoData.bookings.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setDemoData((current) => {
        const expired = current.bookings.filter((booking) => isBookingActive(booking.status)
          && booking.status !== 'booked'
          && booking.phaseDeadlineAt
          && new Date(booking.phaseDeadlineAt).getTime() <= now);
        if (!expired.length) return current;
        const expiredIds = new Set(expired.map((booking) => booking.id));
        const notices: AppNotificationRecord[] = expired.flatMap((booking) => {
          const body = `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)} منقضی شد و سانس آزاد است.`;
          return ['demo-owner', booking.accountUid || booking.createdByUid].map((recipientUid) => ({
            id: crypto.randomUUID(), recipientUid, bookingId: booking.id, type: 'booking_expired' as const,
            title: 'مهلت رزرو تمام شد', body, createdAt: new Date().toISOString(), readAt: '',
          }));
        });
        return {
          ...current,
          bookings: current.bookings.map((booking) => expiredIds.has(booking.id)
            ? { ...booking, status: 'expired', expiredAt: new Date(now).toISOString(), expiryReason: 'مهلت این مرحله به پایان رسید.', balanceHoldToman: 0, phaseDeadlineAt: '', phaseDeadlineKind: undefined }
            : booking),
          notifications: [...notices, ...current.notifications],
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isDemo, demoData.bookings.length]);

  useEffect(() => {
    if (!isDemo) {
      initialDemoNotificationIds.current = null;
      return;
    }
    const currentIds = new Set(demoData.notifications.map((item) => item.id));
    if (initialDemoNotificationIds.current && browserNotificationPermission === 'granted') {
      for (const item of demoData.notifications) {
        if (!initialDemoNotificationIds.current.has(item.id) && item.recipientUid === (currentRole === 'owner' ? 'demo-owner' : 'demo-player')) {
          try { new Notification(item.title, { body: item.body, tag: item.id }); } catch { /* browser notifications are optional */ }
        }
      }
    }
    initialDemoNotificationIds.current = currentIds;
  }, [isDemo, demoData.notifications, currentRole, browserNotificationPermission]);

  useEffect(() => {
    if (isDemo || !db || !user || !isAllowedUser || !clubId) {
      setRemoteNotifications([]);
      initialNotificationIds.current = null;
      return;
    }
    const notificationsQuery = query(
      collection(db, 'clubs', clubId, 'notifications'),
      where('recipientUid', '==', user.uid),
    );
    return onSnapshot(notificationsQuery, (snapshot) => {
      const next = snapshot.docs.map((item) => mapNotification(item.id, item.data()))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
      if (initialNotificationIds.current && browserNotificationPermission === 'granted') {
        for (const item of next) {
          if (!initialNotificationIds.current.has(item.id) && document.visibilityState === 'visible') {
            try { new Notification(item.title, { body: item.body, tag: item.id }); } catch { /* browser notifications are optional */ }
          }
        }
      }
      initialNotificationIds.current = new Set(next.map((item) => item.id));
      setRemoteNotifications(next);
    }, (error) => setDataError(getFriendlyError(error)));
  }, [isDemo, user?.uid, isAllowedUser, browserNotificationPermission, clubId]);

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setAuthResolved(true);
      return;
    }
    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setMemberships([]);
        setActiveClubId('');
        setShowClubHub(false);
        setMembershipsResolved(!nextUser);
        setClubHubError('');
        setAuthResolved(true);
        setAuthError('');
      },
      (error) => {
        setAuthError(getFriendlyError(error));
        setAuthResolved(true);
      },
    );
  }, []);

  useEffect(() => {
    if (isDemo) {
      setMembershipsResolved(true);
      return;
    }
    if (!db || !user) {
      setMemberships([]);
      setMembershipsResolved(true);
      return;
    }
    setMembershipsResolved(false);
    const membershipQuery = query(collection(db, 'users', user.uid, 'clubMemberships'));
    return onSnapshot(membershipQuery, (snapshot) => {
      const next = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          clubId: item.id,
          clubName: String(data.clubName ?? 'باشگاه'),
          uid: user.uid,
          email: user.email ?? '',
          role: data.role === 'owner' ? 'owner' as const : 'player' as const,
          active: data.active === true,
          joinedAt: data.joinedAt ? timestampToIso(data.joinedAt) : '',
        };
      }).filter((membership) => membership.active);
      setMemberships(next);
      setMembershipsResolved(true);
      const savedId = window.localStorage.getItem(`sansyar-active-club-${user.uid}`) ?? '';
      const savedMembership = next.find((membership) => membership.clubId === savedId);
      const selectedId = savedMembership?.clubId ?? (next.length === 1 ? next[0].clubId : '');
      setActiveClubId(selectedId);
      setShowClubHub(false);
    }, (error) => {
      setMemberships([]);
      setMembershipsResolved(true);
      setClubHubError(getFriendlyError(error));
    });
  }, [isDemo, user?.uid]);

  useEffect(() => {
    if (isDemo || !firebaseReady || !db || !user || !isAllowedUser || !clubId) {
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    setDataError('');
    let paymentsLoaded = false;
    let sessionsLoaded = false;
    let settingsLoaded = false;
    const updateLoading = () => {
      if (paymentsLoaded && sessionsLoaded && settingsLoaded) setDataLoading(false);
    };

    const clubRef = doc(db, 'clubs', clubId);
    const paymentsCollection = collection(db, 'clubs', clubId, 'payments');
    const sessionsCollection = collection(db, 'clubs', clubId, 'sessions');
    const paymentsQuery = currentRole === 'owner'
      ? query(paymentsCollection, orderBy('createdAt', 'desc'))
      : query(paymentsCollection, or(where('accountUid', '==', user.uid), where('createdByUid', '==', user.uid)));
    const sessionsQuery = currentRole === 'owner'
      ? query(sessionsCollection, orderBy('createdAt', 'desc'))
      : query(sessionsCollection, or(where('accountUid', '==', user.uid), where('createdByUid', '==', user.uid)));

    const unlistenClub = onSnapshot(
      clubRef,
      (snapshot) => {
        settingsLoaded = true;
        if (snapshot.exists()) {
          const data = snapshot.data();
          const courts = Array.isArray(data.courts)
            ? data.courts.filter((court: unknown) => Boolean(court && typeof court === 'object' && 'id' in court && 'name' in court)).map((court: { id: string; name: string }) => ({ id: String(court.id), name: String(court.name) }))
            : DEFAULT_SETTINGS.courts;
          const archivedCourts = Array.isArray(data.archivedCourts)
            ? data.archivedCourts.filter((court: unknown) => Boolean(court && typeof court === 'object' && 'id' in court && 'name' in court)).map((court: { id: string; name: string; archivedAt?: string; archivedByUid?: string }) => ({ id: String(court.id), name: String(court.name), archivedAt: typeof court.archivedAt === 'string' ? court.archivedAt : '', archivedByUid: typeof court.archivedByUid === 'string' ? court.archivedByUid : '' }))
            : [];
          setRemoteSettings({
            clubName: String(data.clubName ?? DEFAULT_SETTINGS.clubName),
            defaultSessionPriceToman: Number(data.defaultSessionPriceToman ?? 0),
            publicScheduleEnabled: Boolean(data.publicScheduleEnabled ?? false),
            ownerPhone: typeof data.ownerPhone === 'string' ? data.ownerPhone : '',
            courts,
            archivedCourts,
            ownerUid: typeof data.createdByUid === 'string' ? data.createdByUid : '',
          });
        } else {
          setRemoteSettings(DEFAULT_SETTINGS);
          setDataError('باشگاه انتخاب‌شده پیدا نشد؛ دوباره با کد عضویت وارد شو.');
        }
        updateLoading();
      },
      (error) => {
        setDataError(getFriendlyError(error));
        setDataLoading(false);
      },
    );

    const unlistenPayments = onSnapshot(
      paymentsQuery,
      (snapshot) => {
        paymentsLoaded = true;
        setRemotePayments(snapshot.docs.map((item) => mapPayment(item.id, item.data())));
        updateLoading();
      },
      (error) => {
        setDataError(getFriendlyError(error));
        setDataLoading(false);
      },
    );

    const unlistenSessions = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        sessionsLoaded = true;
        setRemoteSessions(snapshot.docs.map((item) => mapSession(item.id, item.data())));
        updateLoading();
      },
      (error) => {
        setDataError(getFriendlyError(error));
        setDataLoading(false);
      },
    );

    setRemoteClubMembers([]);
    const unlistenMembers = currentRole === 'owner'
      ? onSnapshot(collection(db, 'clubs', clubId, 'members'), (snapshot) => {
          setRemoteClubMembers(snapshot.docs.map((item) => {
            const data = item.data();
            return {
              clubId,
              clubName: remoteSettings.clubName,
              uid: String(data.uid ?? item.id),
              email: String(data.email ?? ''),
              role: data.role === 'owner' ? 'owner' as const : 'player' as const,
              active: data.active === true,
              joinedAt: data.joinedAt ? timestampToIso(data.joinedAt) : '',
            };
          }).filter((member) => member.active));
        }, (error) => setDataError(getFriendlyError(error)))
      : undefined;

    return () => {
      unlistenClub();
      unlistenPayments();
      unlistenSessions();
      unlistenMembers?.();
    };
  }, [isDemo, user?.uid, isAllowedUser, currentRole, clubId, remoteSettings.clubName]);

  useEffect(() => {
    setRemoteBookings([]);
    if (isDemo) {
      setRemotePublicSchedule([]);
      setScheduleLoading(false);
      setScheduleError('');
      return;
    }
    if (!firebaseReady || !db || !user || !isAllowedUser || !clubId) {
      setScheduleLoading(false);
      return;
    }

    const firestore = db;
    const userUid = user.uid;
    const canReadPublicSchedule = currentRole === 'owner' || remoteSettings.publicScheduleEnabled;
    setScheduleLoading(true);
    setScheduleError('');
    let publicLoaded = !canReadPublicSchedule;
    let bookingsLoaded = false;
    const maybeFinish = () => {
      if (publicLoaded && bookingsLoaded) setScheduleLoading(false);
    };
    let unlistenPublic: (() => void) | undefined;
    if (canReadPublicSchedule) {
      const publicQuery = query(
        collection(firestore, 'clubs', clubId, 'publicSchedule'),
        where('date', '==', scheduleDate),
      );
      unlistenPublic = onSnapshot(
        publicQuery,
        (snapshot) => {
          publicLoaded = true;
          setRemotePublicSchedule(snapshot.docs.map((item) => mapPublicSchedule(item.id, item.data())));
          maybeFinish();
        },
        (error) => {
          setScheduleError(getFriendlyError(error));
          setScheduleLoading(false);
        },
      );
    } else {
      setRemotePublicSchedule([]);
    }

    const bookingsCollection = collection(firestore, 'clubs', clubId, 'bookings');
    const bookingsQuery = currentRole === 'owner'
      ? query(bookingsCollection, orderBy('createdAt', 'desc'))
      : query(bookingsCollection, or(where('accountUid', '==', userUid), where('createdByUid', '==', userUid)));
    const unlistenBookings = onSnapshot(
      bookingsQuery,
      (snapshot) => {
        bookingsLoaded = true;
        setRemoteBookings(snapshot.docs.map((item) => mapBooking(item.id, item.data())));
        maybeFinish();
      },
      (error) => {
        setScheduleError(getFriendlyError(error));
        setScheduleLoading(false);
      },
    );
    return () => {
      unlistenPublic?.();
      unlistenBookings();
    };
  }, [isDemo, user?.uid, isAllowedUser, currentRole, remoteSettings.publicScheduleEnabled, scheduleDate, clubId]);

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('booking');
    if (!requestedId) return;
    const booking = bookings.find((item) => item.id === requestedId);
    if (!booking) return;
    openBookingFromNotification(booking);
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, [bookings, currentRole, settings.archivedCourts, settings.publicScheduleEnabled]);

  useEffect(() => {
    if (isDemo || !user) return;
    for (const booking of remoteBookings) {
      if (!['pending', 'awaiting_payment', 'needs_correction'].includes(booking.status)
        || !booking.phaseDeadlineAt
        || new Date(booking.phaseDeadlineAt).getTime() > clockNow
        || expiringBookingIds.current.has(booking.id)) continue;
      expiringBookingIds.current.add(booking.id);
      void expireRemoteBooking(booking);
    }
  }, [isDemo, remoteBookings, clockNow, user?.uid]);

  useEffect(() => {
    if (currentRole === 'player' && !settings.publicScheduleEnabled && view === 'schedule') setView('ledger');
  }, [currentRole, settings.publicScheduleEnabled, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const chargeTotal = useMemo(
    () => sessions.reduce((sum, session) => sum + (isChargeable(session.status) ? session.priceToman : 0), 0),
    [sessions],
  );
  const confirmedPayments = useMemo(
    () => payments.filter((payment) => payment.status === 'confirmed').reduce((sum, payment) => sum + payment.amountToman, 0),
    [payments],
  );
  const pendingPayments = useMemo(
    () => payments.filter((payment) => payment.status !== 'confirmed'),
    [payments],
  );
  const pendingTotal = pendingPayments.reduce((sum, payment) => sum + payment.amountToman, 0);
  const pendingCancellations = sessions.filter((session) => session.status === 'cancelled_on_time_pending');
  const pendingCancellationTotal = pendingCancellations.reduce((sum, session) => sum + session.priceToman, 0);
  const balanceHoldToman = bookings.reduce((sum, booking) => sum + Math.max(0, booking.balanceHoldToman ?? 0), 0);
  const balance = confirmedPayments - chargeTotal - balanceHoldToman;

  async function handleAuthSubmit(email: string, password: string, createAccount: boolean) {
    if (!auth) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (createAccount) await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      else await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error) {
      setAuthError(getFriendlyError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!auth) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
    } catch (error) {
      setAuthError(getFriendlyError(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleLink() {
    const currentUser = auth?.currentUser;
    if (!currentUser) return;
    if (currentUser.providerData.some((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID)) {
      setToast('حساب Google از قبل به این حساب پیوند است.');
      return;
    }
    setAuthBusy(true);
    setClubHubError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await linkWithPopup(currentUser, provider);
      setUser(result.user);
      setToast('حساب Google پیوند شد؛ شناسه و عضویت‌های باشگاه حفظ شدند.');
    } catch (error) {
      const message = getFriendlyError(error);
      setClubHubError(message);
      setToast(message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  function activateClub(nextClubId: string) {
    setActiveClubId(nextClubId);
    setShowClubHub(false);
    setClubHubError('');
    if (user && nextClubId) window.localStorage.setItem(`sansyar-active-club-${user.uid}`, nextClubId);
  }

  async function createClubFromHub(name: string) {
    if (!db || !user) return;
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 100) {
      setClubHubError('نام باشگاه را تا ۱۰۰ نویسه وارد کن.');
      return;
    }
    setClubHubBusy(true);
    setClubHubError('');
    try {
      const clubRef = doc(collection(db, 'clubs'));
      const inviteRef = doc(db, 'clubInvites', clubRef.id);
      const memberRef = doc(db, 'clubs', clubRef.id, 'members', user.uid);
      const indexRef = doc(db, 'users', user.uid, 'clubMemberships', clubRef.id);
      const joinedAt = serverTimestamp();
      const membership: ClubMembershipRecord = {
        clubId: clubRef.id,
        clubName: cleanName,
        uid: user.uid,
        email: user.email ?? '',
        role: 'owner',
        active: true,
      };
      const batch = writeBatch(db);
      batch.set(clubRef, {
        clubName: cleanName,
        defaultSessionPriceToman: 0,
        publicScheduleEnabled: false,
        ownerPhone: '',
        courts: DEFAULT_SETTINGS.courts,
        archivedCourts: [],
        joinEnabled: true,
        createdByUid: user.uid,
        createdAt: joinedAt,
      });
      batch.set(memberRef, {
        uid: user.uid,
        email: user.email ?? '',
        role: 'owner',
        active: true,
        joinedAt,
      });
      batch.set(indexRef, {
        clubId: clubRef.id,
        clubName: cleanName,
        role: 'owner',
        active: true,
        joinedAt,
      });
      batch.set(inviteRef, {
        clubId: clubRef.id,
        clubName: cleanName,
        joinEnabled: true,
        createdAt: joinedAt,
      });
      await batch.commit();
      setMemberships((current) => [membership, ...current.filter((item) => item.clubId !== membership.clubId)]);
      activateClub(clubRef.id);
    } catch (error) {
      setClubHubError(getFriendlyError(error));
    } finally {
      setClubHubBusy(false);
    }
  }

  async function joinClubFromHub(rawCode: string) {
    if (!db || !user) return;
    const targetClubId = rawCode.trim();
    if (!targetClubId || targetClubId.includes('/') || targetClubId.length > 150) {
      setClubHubError('کد باشگاه معتبر نیست.');
      return;
    }
    setClubHubBusy(true);
    setClubHubError('');
    try {
      const inviteRef = doc(db, 'clubInvites', targetClubId);
      const memberRef = doc(db, 'clubs', targetClubId, 'members', user.uid);
      const indexRef = doc(db, 'users', user.uid, 'clubMemberships', targetClubId);
      const membership = await runTransaction(db, async (transaction) => {
        const [inviteSnapshot, memberSnapshot] = await Promise.all([
          transaction.get(inviteRef),
          transaction.get(memberRef),
        ]);
        if (!inviteSnapshot.exists()) throw new Error('باشگاهی با این کد پیدا نشد؛ کد عضویت را بررسی کن.');
        const invite = inviteSnapshot.data();
        const clubName = String(invite.clubName ?? 'باشگاه');
        const existingMember = memberSnapshot.exists() ? memberSnapshot.data() : null;
        if (existingMember && existingMember.active !== true) throw new Error('عضویت این حساب در باشگاه فعال نیست؛ با مالک تماس بگیر.');
        const role: UserRole = existingMember?.role === 'owner' ? 'owner' : 'player';
        if (!existingMember && invite.joinEnabled !== true) {
          throw new Error('عضویت با کد در این باشگاه غیرفعال است.');
        }
        const joinedAt = existingMember?.joinedAt ?? serverTimestamp();
        if (!existingMember) {
          transaction.set(memberRef, {
            uid: user.uid,
            email: user.email ?? '',
            role,
            active: true,
            joinedAt,
          });
        }
        transaction.set(indexRef, {
          clubId: targetClubId,
          clubName,
          role,
          active: true,
          joinedAt,
        });
        return {
          clubId: targetClubId,
          clubName,
          uid: user.uid,
          email: user.email ?? '',
          role,
          active: true,
        } satisfies ClubMembershipRecord;
      });
      setMemberships((current) => [membership, ...current.filter((item) => item.clubId !== targetClubId)]);
      activateClub(targetClubId);
    } catch (error) {
      setClubHubError(getFriendlyError(error));
    } finally {
      setClubHubBusy(false);
    }
  }

  async function enableBrowserNotifications() {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
      setBrowserNotificationPermission('unsupported');
      setToast('این مرورگر اعلان سیستمی را پشتیبانی نمی‌کند؛ اعلان‌های داخل برنامه فعال‌اند.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setBrowserNotificationPermission(permission);
      if (permission !== 'granted') {
        setToast('اجازهٔ اعلان مرورگر داده نشد؛ اعلان‌ها داخل برنامه دیده می‌شوند.');
        return;
      }
      if (isDemo) {
        setToast('اعلان مرورگر فعال شد؛ پیش‌نمایش را در همین مرورگر باز نگه دار.');
        return;
      }
      if (!firebaseApp || !firebaseConfig || !firebaseConfig.messagingSenderId || !db || !user || !vapidKey) {
        setToast('اعلان داخل برنامه فعال است؛ برای ارسال اعلان وقتی برنامه بسته است، Web Push VAPID key را از تنظیمات Firebase وارد کن.');
        return;
      }
      if (!await isSupported()) {
        setToast('اعلان داخل برنامه فعال است؛ این مرورگر Firebase Web Push را پشتیبانی نمی‌کند.');
        return;
      }
      const encodedConfig = encodeURIComponent(JSON.stringify(firebaseConfig));
      const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?firebaseConfig=${encodedConfig}`, { scope: '/' });
      const token = await getToken(getMessaging(firebaseApp), { vapidKey, serviceWorkerRegistration: registration });
      if (!token) {
        setToast('مجوز داده شد، اما مرورگر توکن اعلان صادر نکرد؛ تنظیم Web Push را بررسی کن.');
        return;
      }
      const storageKey = `sansyar-push-token-id-${user.uid}`;
      let tokenDocId = window.localStorage.getItem(storageKey) ?? '';
      if (!tokenDocId) {
        tokenDocId = crypto.randomUUID();
        window.localStorage.setItem(storageKey, tokenDocId);
      }
      await setDoc(doc(db, 'clubs', clubId, 'pushTokens', tokenDocId), {
        recipientUid: user.uid,
        token,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setToast('اعلان مرورگر فعال شد؛ از این پس رویدادهای رزرو برایت ارسال می‌شود.');
    } catch (error) {
      setToast(`فعال‌سازی اعلان مرورگر ناموفق بود: ${getFriendlyError(error)}`);
    }
  }

  async function markNotificationRead(notification: AppNotificationRecord) {
    if (notification.readAt) return;
    if (isDemo) {
      setDemoData((current) => ({
        ...current,
        notifications: current.notifications.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item),
      }));
      return;
    }
    if (!db) return;
    try {
      await updateDoc(doc(db, 'clubs', clubId, 'notifications', notification.id), { readAt: serverTimestamp() });
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  function openBookingFromNotification(booking: BookingRecord) {
    const archived = settings.archivedCourts.some((court) => court.id === booking.courtId);
    const needsOwnerReview = currentRole === 'owner'
      && !archived
      && ['pending', 'payment_submitted', 'needs_correction'].includes(booking.status);
    setView(archived ? 'archive' : 'schedule');
    if (!archived) setScheduleDate(booking.date);
    setModal(needsOwnerReview
      ? { type: 'bookingReview', booking }
      : { type: 'bookingConversation', booking });
  }

  function openNotification(notification: AppNotificationRecord) {
    void markNotificationRead(notification);
    const booking = bookings.find((item) => item.id === notification.bookingId);
    if (!booking) {
      setView('schedule');
      setToast(notification.body);
      return;
    }
    openBookingFromNotification(booking);
  }

  async function savePayment(input: PaymentInput, existing?: PaymentRecord) {
    if (isDemo) {
      const createdAt = new Date().toISOString();
      if (existing) {
        setDemoData((current) => ({
          ...current,
          payments: current.payments.map((item) => item.id === existing.id
            ? {
                ...item,
                amountToman: input.amountToman,
                note: input.note,
                paidAt: input.paidAt,
                status: 'pending',
                reviewNote: '',
                history: [...item.history, {
                  amountToman: item.amountToman,
                  note: item.note,
                  paidAt: item.paidAt,
                  changedAt: createdAt,
                  changedByUid: 'demo-player',
                }],
              }
            : item),
        }));
        setToast('اصلاح پرداخت برای تأیید دوباره ارسال شد.');
      } else {
        const newPayment: PaymentRecord = {
          id: crypto.randomUUID(),
          ...input,
          status: 'pending',
          createdAt,
          createdByUid: 'demo-player',
          accountUid: 'demo-player',
          createdByEmail: 'player@example.com',
          history: [],
        };
        setDemoData((current) => ({ ...current, payments: [newPayment, ...current.payments] }));
        setToast('پرداخت به فهرست در انتظار تأیید اضافه شد.');
      }
      setModal(null);
      return;
    }

    if (!db || !user) return;
    try {
      if (existing) {
        const oldRevision: PaymentRevision = {
          amountToman: existing.amountToman,
          note: existing.note,
          paidAt: existing.paidAt,
          changedAt: new Date().toISOString(),
          changedByUid: user.uid,
        };
        await updateDoc(doc(db, 'clubs', clubId, 'payments', existing.id), {
          amountToman: input.amountToman,
          note: input.note,
          paidAt: input.paidAt,
          status: 'pending',
          reviewNote: '',
          history: arrayUnion(oldRevision),
          updatedAt: serverTimestamp(),
        });
        setToast('اصلاح پرداخت برای تأیید دوباره ارسال شد.');
      } else {
        await addDoc(collection(db, 'clubs', clubId, 'payments'), {
          ...input,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: user.uid,
          accountUid: user.uid,
          createdByEmail: user.email ?? '',
          history: [],
        });
        setToast('پرداخت ثبت شد و برای صاحب باشگاه فرستاده شد.');
      }
      setModal(null);
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function reviewPayment(payment: PaymentRecord, status: 'confirmed' | 'correction_requested', reviewNote = '') {
    if (isDemo) {
      setDemoData((current) => ({
        ...current,
        payments: current.payments.map((item) => item.id === payment.id
          ? { ...item, status, reviewNote, reviewedByUid: 'demo-owner', reviewedAt: new Date().toISOString() }
          : item),
      }));
      setModal(null);
      setToast(status === 'confirmed' ? 'پرداخت تأیید شد؛ مانده حساب به‌روز شد.' : 'درخواست اصلاح برای بازیکن ثبت شد.');
      return;
    }

    if (!db || !user) return;
    try {
      const paymentRef = doc(db, 'clubs', clubId, 'payments', payment.id);
      const paymentAccountUid = payment.accountUid || payment.createdByUid;
      const balanceLockRef = doc(db, 'clubs', clubId, 'accountBalanceLocks', paymentAccountUid);
      await runTransaction(db, async (transaction) => {
        await transaction.get(balanceLockRef);
        const snapshot = await transaction.get(paymentRef);
        if (!snapshot.exists() || snapshot.data().status !== 'pending') throw new Error('این پرداخت قبلاً بررسی شده است.');
        transaction.update(paymentRef, {
          status,
          reviewNote,
          reviewedByUid: user.uid,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.set(balanceLockRef, { uid: paymentAccountUid, updatedAt: serverTimestamp() }, { merge: true });
      });
      setModal(null);
      setToast(status === 'confirmed' ? 'پرداخت تأیید شد؛ مانده حساب به‌روز شد.' : 'درخواست اصلاح برای بازیکن ثبت شد.');
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function saveSession(input: SessionInput, existing?: SessionRecord) {
    const finalizedStatuses: SessionStatus[] = ['attended', 'late_cancel', 'no_show', 'cancelled_on_time'];
    if (isDemo) {
      const createdAt = new Date().toISOString();
      if (existing) {
        if (existing.bookingId && currentRole === 'player') return;
        const statusChangedByOwner = currentRole === 'owner' && input.status !== existing.status;
        const settlesLinkedBooking = Boolean(existing.bookingId && statusChangedByOwner && finalizedStatuses.includes(input.status));
        const cancelsLinkedBooking = settlesLinkedBooking && ['cancelled_on_time', 'late_cancel'].includes(input.status);
        const freeCancellation = settlesLinkedBooking && input.status === 'cancelled_on_time';
        setDemoData((current) => ({
          ...current,
          sessions: current.sessions.map((item) => item.id === existing.id ? {
            ...item,
            ...input,
            ...(statusChangedByOwner ? {
              reviewedByUid: 'demo-owner',
              reviewedAt: createdAt,
              reviewNote: input.status === 'cancelled_on_time' ? 'لغو به‌موقع تأیید شد؛ هزینه منظور نشد.' : input.status === 'late_cancel' ? 'لغو دیرهنگام بوده و هزینهٔ سانس منظور شد.' : 'وضعیت سانس توسط صاحب باشگاه ثبت شد.',
            } : {}),
          } : item),
          bookings: settlesLinkedBooking ? current.bookings.map((item) => item.id === existing.bookingId ? {
            ...item,
            balanceHoldToman: 0,
            sessionSettledAt: createdAt,
            ...(cancelsLinkedBooking ? { status: 'cancelled', cancelledAt: createdAt } : {}),
          } : item) : current.bookings,
        }));
        setToast(freeCancellation
          ? 'لغو به‌موقع ثبت شد و ماندهٔ رزرو آزاد شد.'
          : cancelsLinkedBooking ? 'لغو دیرهنگام ثبت شد؛ هزینه اعمال و سانس آزاد شد.' : 'اطلاعات سانس به‌روز شد.');
      } else {
        const ownerConfirmedFreeCancel = currentRole === 'owner' && input.status === 'cancelled_on_time';
        const newSession: SessionRecord = {
          id: crypto.randomUUID(),
          ...input,
          createdAt,
          createdByUid: currentRole === 'owner' ? 'demo-owner' : 'demo-player',
          accountUid: currentRole === 'owner' ? 'demo-owner' : 'demo-player',
          createdByEmail: currentRole === 'owner' ? 'owner@example.com' : 'player@example.com',
          ...(ownerConfirmedFreeCancel ? {
            reviewedByUid: 'demo-owner',
            reviewedAt: createdAt,
            reviewNote: 'لغو به‌موقع توسط صاحب باشگاه ثبت شد.',
          } : {}),
        };
        setDemoData((current) => ({ ...current, sessions: [newSession, ...current.sessions] }));
        setToast('سانس به گردش حساب اضافه شد.');
      }
      setModal(null);
      return;
    }

    if (!db || !user) return;
    try {
      if (existing) {
        if (existing.bookingId && currentRole === 'player') return;
        const sessionRef = doc(db, 'clubs', clubId, 'sessions', existing.id);
        const balanceUid = existing.accountUid || existing.createdByUid || user.uid;
        const balanceLockRef = doc(db, 'clubs', clubId, 'accountBalanceLocks', balanceUid);
        const statusChangedByOwner = currentRole === 'owner' && input.status !== existing.status;
        const settlesLinkedBooking = Boolean(existing.bookingId && statusChangedByOwner && finalizedStatuses.includes(input.status));
        const cancelsLinkedBooking = settlesLinkedBooking && ['cancelled_on_time', 'late_cancel'].includes(input.status);
        const freeCancellation = settlesLinkedBooking && input.status === 'cancelled_on_time';
        const linkedBookingRef = existing.bookingId ? doc(db, 'clubs', clubId, 'bookings', existing.bookingId) : null;
        await runTransaction(db, async (transaction) => {
          await transaction.get(balanceLockRef);
          const sessionSnapshot = await transaction.get(sessionRef);
          if (!sessionSnapshot.exists()) throw new Error('سانس پیدا نشد.');
          const currentSession = sessionSnapshot.data();
          const sessionBookingId = typeof currentSession.bookingId === 'string' ? currentSession.bookingId : '';
          let bookingSnapshot: DocumentSnapshot<DocumentData> | null = null;
          let publicRef: DocumentReference<DocumentData> | null = null;
          let lockRefs: DocumentReference<DocumentData>[] = [];
          let lockSnapshots: DocumentSnapshot<DocumentData>[] = [];
          if (settlesLinkedBooking && linkedBookingRef && sessionBookingId) {
            bookingSnapshot = await transaction.get(linkedBookingRef);
            if (!bookingSnapshot.exists() || bookingSnapshot.data().status !== 'booked') throw new Error('رزرو مرتبط دیگر فعال نیست.');
            if (cancelsLinkedBooking) {
              publicRef = doc(db!, 'clubs', clubId, 'publicSchedule', sessionBookingId);
              const ids: string[] = Array.isArray(bookingSnapshot.data().lockIds) ? bookingSnapshot.data().lockIds.map((id: unknown) => String(id)) : [];
              lockRefs = ids.map((id: string) => doc(db!, 'clubs', clubId, 'slotLocks', id));
              lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
            }
          }
          const reviewFields = statusChangedByOwner ? {
            reviewedByUid: user!.uid,
            reviewedAt: serverTimestamp(),
            reviewNote: input.status === 'cancelled_on_time' ? 'لغو به‌موقع تأیید شد؛ هزینه منظور نشد.' : input.status === 'late_cancel' ? 'لغو دیرهنگام بوده و هزینهٔ سانس منظور شد.' : 'وضعیت سانس توسط صاحب باشگاه ثبت شد.',
          } : {};
          transaction.update(sessionRef, { ...input, ...reviewFields, updatedAt: serverTimestamp() });
          if (bookingSnapshot?.exists() && linkedBookingRef && settlesLinkedBooking) {
            transaction.update(linkedBookingRef, {
              balanceHoldToman: 0,
              sessionSettledAt: serverTimestamp(),
              ...(cancelsLinkedBooking ? { status: 'cancelled', cancelledAt: serverTimestamp() } : {}),
              updatedAt: serverTimestamp(),
            });
            if (cancelsLinkedBooking && publicRef) {
              transaction.set(publicRef, {
                date: String(bookingSnapshot.data().date),
                startTime: String(bookingSnapshot.data().startTime),
                endTime: String(bookingSnapshot.data().endTime),
                courtId: String(bookingSnapshot.data().courtId),
                courtName: String(bookingSnapshot.data().courtName),
                status: 'cancelled',
                updatedAt: serverTimestamp(),
              });
              lockSnapshots.forEach((snapshot, index) => {
                if (snapshot.exists() && snapshot.data().bookingId === sessionBookingId) transaction.delete(lockRefs[index]);
              });
            }
          }
          transaction.set(balanceLockRef, { uid: balanceUid, updatedAt: serverTimestamp() }, { merge: true });
        });
        setToast(freeCancellation
          ? 'لغو به‌موقع ثبت شد و ماندهٔ رزرو آزاد شد.'
          : cancelsLinkedBooking ? 'لغو دیرهنگام ثبت شد؛ هزینه اعمال و سانس آزاد شد.' : 'اطلاعات سانس به‌روز شد.');
      } else {
        const sessionRef = doc(collection(db, 'clubs', clubId, 'sessions'));
        const balanceUid = user.uid;
        const balanceLockRef = doc(db, 'clubs', clubId, 'accountBalanceLocks', balanceUid);
        const ownerConfirmedFreeCancel = currentRole === 'owner' && input.status === 'cancelled_on_time';
        await runTransaction(db, async (transaction) => {
          await transaction.get(balanceLockRef);
          transaction.set(sessionRef, {
            ...input,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdByUid: user!.uid,
            accountUid: user!.uid,
            createdByEmail: user!.email ?? '',
            ...(ownerConfirmedFreeCancel ? {
              reviewedByUid: user!.uid,
              reviewedAt: serverTimestamp(),
              reviewNote: 'لغو به‌موقع توسط صاحب باشگاه ثبت شد.',
            } : {}),
          });
          transaction.set(balanceLockRef, { uid: balanceUid, updatedAt: serverTimestamp() }, { merge: true });
        });
        setToast('سانس به گردش حساب اضافه شد.');
      }
      setModal(null);
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function requestScheduledSessionCancellation(session: SessionRecord) {
    if (!session.bookingId || session.status !== 'scheduled') return;
    if (isDemo) {
      setDemoData((current) => ({
        ...current,
        sessions: current.sessions.map((item) => item.id === session.id && item.status === 'scheduled'
          ? { ...item, status: 'cancelled_on_time_pending', note: `${item.note} · درخواست لغو به‌موقع ثبت شد.` }
          : item),
      }));
      setToast('درخواست لغو ثبت شد؛ تا بررسی باشگاه هزینه‌ای محاسبه نمی‌شود.');
      return;
    }
    if (!db || !user || currentRole !== 'player') return;
    try {
      const sessionRef = doc(db, 'clubs', clubId, 'sessions', session.id);
      const bookingRef = doc(db, 'clubs', clubId, 'bookings', session.bookingId);
      const balanceLockRef = doc(db, 'clubs', clubId, 'accountBalanceLocks', user.uid);
      await runTransaction(db, async (transaction) => {
        await transaction.get(balanceLockRef);
        const sessionSnapshot = await transaction.get(sessionRef);
        const bookingSnapshot = await transaction.get(bookingRef);
        if (!sessionSnapshot.exists() || sessionSnapshot.data().status !== 'scheduled' || (sessionSnapshot.data().accountUid || sessionSnapshot.data().createdByUid) !== user!.uid) {
          throw new Error('سانس دیگر برای درخواست لغو در دسترس نیست.');
        }
        if (!bookingSnapshot.exists() || bookingSnapshot.data().status !== 'booked') throw new Error('رزرو مرتبط فعال نیست.');
        transaction.update(sessionRef, {
          status: 'cancelled_on_time_pending',
          note: `${String(sessionSnapshot.data().note ?? '')} · درخواست لغو به‌موقع ثبت شد.`,
          updatedAt: serverTimestamp(),
        });
        transaction.set(balanceLockRef, { uid: user!.uid, updatedAt: serverTimestamp() }, { merge: true });
      });
      setToast('درخواست لغو ثبت شد؛ تا بررسی باشگاه هزینه‌ای محاسبه نمی‌شود.');
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function reviewSession(session: SessionRecord, status: 'cancelled_on_time' | 'late_cancel') {
    const reviewNote = status === 'cancelled_on_time'
      ? 'لغو به‌موقع تأیید شد؛ هزینه منظور نشد.'
      : 'لغو دیرهنگام بوده و هزینهٔ سانس منظور شد.';
    if (isDemo) {
      const reviewedAt = new Date().toISOString();
      const cancelsLinkedBooking = Boolean(session.bookingId && ['cancelled_on_time', 'late_cancel'].includes(status));
      setDemoData((current) => ({
        ...current,
        sessions: current.sessions.map((item) => item.id === session.id
          ? { ...item, status, reviewedByUid: 'demo-owner', reviewedAt, reviewNote }
          : item),
        bookings: session.bookingId ? current.bookings.map((item) => item.id === session.bookingId ? {
          ...item,
          balanceHoldToman: 0,
          sessionSettledAt: reviewedAt,
          ...(cancelsLinkedBooking ? { status: 'cancelled', cancelledAt: reviewedAt } : {}),
        } : item) : current.bookings,
      }));
      setToast(status === 'cancelled_on_time' ? 'لغو به‌موقع تأیید شد؛ اعتبار رزرو آزاد شد.' : 'لغو دیرهنگام ثبت شد؛ هزینه اعمال و سانس آزاد شد.');
      return;
    }
    if (!db || !user || currentRole !== 'owner') return;
    try {
      const sessionRef = doc(db, 'clubs', clubId, 'sessions', session.id);
      const balanceUid = session.accountUid || session.createdByUid;
      const balanceLockRef = doc(db, 'clubs', clubId, 'accountBalanceLocks', balanceUid);
      const bookingRef = session.bookingId ? doc(db, 'clubs', clubId, 'bookings', session.bookingId) : null;
      await runTransaction(db, async (transaction) => {
        await transaction.get(balanceLockRef);
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists() || sessionSnapshot.data().status !== 'cancelled_on_time_pending') {
          throw new Error('درخواست لغو قبلاً بررسی شده است.');
        }
        let bookingSnapshot: DocumentSnapshot<DocumentData> | null = null;
        let publicRef: DocumentReference<DocumentData> | null = null;
        let lockRefs: DocumentReference<DocumentData>[] = [];
        let lockSnapshots: DocumentSnapshot<DocumentData>[] = [];
        if (bookingRef && session.bookingId) {
          bookingSnapshot = await transaction.get(bookingRef);
          if (!bookingSnapshot.exists() || bookingSnapshot.data().status !== 'booked') throw new Error('رزرو مرتبط دیگر فعال نیست.');
          if (['cancelled_on_time', 'late_cancel'].includes(status)) {
            publicRef = doc(db!, 'clubs', clubId, 'publicSchedule', session.bookingId);
            const ids: string[] = Array.isArray(bookingSnapshot.data().lockIds) ? bookingSnapshot.data().lockIds.map((id: unknown) => String(id)) : [];
            lockRefs = ids.map((id: string) => doc(db!, 'clubs', clubId, 'slotLocks', id));
            lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
          }
        }
        transaction.update(sessionRef, {
          status,
          reviewNote,
          reviewedByUid: user!.uid,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (bookingRef && bookingSnapshot?.exists() && session.bookingId) {
          const cancelsLinkedBooking = ['cancelled_on_time', 'late_cancel'].includes(status);
          transaction.update(bookingRef, {
            balanceHoldToman: 0,
            sessionSettledAt: serverTimestamp(),
            ...(cancelsLinkedBooking ? { status: 'cancelled', cancelledAt: serverTimestamp() } : {}),
            updatedAt: serverTimestamp(),
          });
          if (cancelsLinkedBooking && publicRef) {
            transaction.set(publicRef, {
              date: String(bookingSnapshot.data().date),
              startTime: String(bookingSnapshot.data().startTime),
              endTime: String(bookingSnapshot.data().endTime),
              courtId: String(bookingSnapshot.data().courtId),
              courtName: String(bookingSnapshot.data().courtName),
              status: 'cancelled',
              updatedAt: serverTimestamp(),
            });
            lockSnapshots.forEach((lockSnapshot, index) => {
              if (lockSnapshot.exists() && lockSnapshot.data().bookingId === session.bookingId) transaction.delete(lockRefs[index]);
            });
          }
        }
        transaction.set(balanceLockRef, { uid: balanceUid, updatedAt: serverTimestamp() }, { merge: true });
      });
      setToast(status === 'cancelled_on_time' ? 'لغو به‌موقع تأیید شد؛ اعتبار رزرو آزاد شد.' : 'لغو دیرهنگام ثبت شد؛ هزینه اعمال و سانس آزاد شد.');
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function saveBooking(input: BookingInput) {
    const start = timeToMinutes(input.startTime);
    const end = timeToMinutes(input.endTime);
    if (!input.date || !Number.isFinite(start) || !Number.isFinite(end) || start % 90 !== 0 || end - start !== 90 || end > 24 * 60) {
      setToast('یک سانس معتبر ۱.۵ ساعته را انتخاب کن.');
      return;
    }
    if (input.priceToman < 0 || input.priceToman > 1_000_000_000) {
      setToast('مبلغ رزرو باید بین صفر تا یک میلیارد تومان باشد.');
      return;
    }
    if (!input.bookedForName.trim()) {
      setToast('نام رزروکننده را وارد کن.');
      return;
    }
    if (input.repeatWeekly && input.repeatUntil <= input.date) {
      setToast('تاریخ پایان تکرار باید دست‌کم یک هفته بعد از تاریخ سانس باشد.');
      return;
    }

    const { repeatWeekly, repeatUntil, ...details } = input;
    const occurrenceDates = repeatWeekly ? getWeeklyDates(input.date, repeatUntil) : [input.date];
    const overlapsOnDate = (booking: BookingRecord, date: string) =>
      isBookingActive(booking.status) &&
      booking.date === date &&
      booking.courtId === details.courtId &&
      bookingOverlaps(details, booking);

    if (!repeatWeekly && bookings.some((booking) => overlapsOnDate(booking, input.date))) {
      setToast('این سانس همین حالا رزرو شده است؛ تقویم را تازه بررسی کن.');
      return;
    }
    if (!db && !isDemo) return;
    if (!isDemo && (!user || currentRole !== 'owner')) return;
    if (!isDemo && input.accountUid && !remoteClubMembers.some((member) => member.uid === input.accountUid && member.role === 'player' && member.active)) {
      setToast('حساب بازیکن انتخاب‌شده عضو فعال این باشگاه نیست.');
      return;
    }

    setBookingSaving(true);
    try {
      if (isDemo) {
        const accepted: BookingRecord[] = [];
        const conflictDates: string[] = [];
        for (const date of occurrenceDates) {
          const candidate = { ...details, date };
          if ([...bookings, ...accepted].some((booking) => overlapsOnDate(booking, date))) {
            conflictDates.push(date);
            continue;
          }
          const bookingId = crypto.randomUUID();
          const sessionId = crypto.randomUUID();
          accepted.push({
            id: bookingId,
            ...candidate,
            status: 'booked',
            lockIds: makeSlotLockIds(candidate.courtId, candidate.date, candidate.startTime, candidate.endTime),
            createdAt: new Date().toISOString(),
            createdByUid: 'demo-owner',
            accountBalanceAppliedToman: 0,
            balanceHoldToman: 0,
            paymentReportedAmountToman: 0,
            sessionRecordId: sessionId,
          });
        }
        if (accepted.length) {
          const plannedSessions: SessionRecord[] = accepted.map((item) => ({
            id: item.sessionRecordId ?? crypto.randomUUID(),
            bookingId: item.id,
            date: item.date,
            priceToman: item.priceToman,
            status: 'scheduled',
            note: `رزرو قطعی · ${item.courtName} · ${formatTimeRange(item.startTime, item.endTime)}`,
            createdAt: item.createdAt,
            createdByUid: item.createdByUid,
            accountUid: item.accountUid || item.createdByUid,
            createdByEmail: 'owner@example.com',
          }));
          setDemoData((current) => ({
            ...current,
            bookings: [...accepted, ...current.bookings],
            sessions: [...plannedSessions, ...current.sessions],
          }));
        }
        setModal(null);
        if (repeatWeekly) {
          const report = buildRecurrenceReport(occurrenceDates.length, accepted.length, conflictDates, details, '');
          setScheduleReport(conflictDates.length ? report : '');
          setToast(`${formatNumber(accepted.length)} سانس تکرارشونده ثبت شد${conflictDates.length ? `؛ ${formatNumber(conflictDates.length)} تداخل گزارش شد` : '؛ بدون تداخل'}.`);
        } else {
          setToast('رزرو سانس در برنامه ثبت شد.');
        }
        return;
      }

      const firestore = db;
      const signedInUser = user;
      if (!firestore || !signedInUser) return;

      if (!repeatWeekly) {
        try {
          await reserveRemoteBooking(firestore, clubId, signedInUser.uid, details, signedInUser.email ?? '');
          setModal(null);
          setToast('رزرو سانس در برنامه ثبت شد.');
        } catch (error) {
          if ((error as { code?: string })?.code === 'booking-slot-conflict') {
            setToast('این سانس همین حالا رزرو شده است؛ زمان دیگری را انتخاب کن.');
          } else {
            setToast(getFriendlyError(error));
          }
        }
        return;
      }

      let successCount = 0;
      const conflictDates: string[] = [];
      const failedDates: string[] = [];
      let fatalError = '';
      const concurrency = 4;
      for (let index = 0; index < occurrenceDates.length; index += concurrency) {
        const chunk = occurrenceDates.slice(index, index + concurrency);
        const results = await Promise.all(chunk.map(async (date) => {
          if (bookings.some((booking) => overlapsOnDate(booking, date))) return { date, kind: 'conflict' as const };
          try {
            await reserveRemoteBooking(firestore, clubId, signedInUser.uid, { ...details, date }, signedInUser.email ?? '');
            return { date, kind: 'saved' as const };
          } catch (error) {
            if ((error as { code?: string })?.code === 'booking-slot-conflict') return { date, kind: 'conflict' as const };
            return { date, kind: 'error' as const, message: getFriendlyError(error) };
          }
        }));
        for (const result of results) {
          if (result.kind === 'saved') successCount += 1;
          if (result.kind === 'conflict') conflictDates.push(result.date);
          if (result.kind === 'error') {
            failedDates.push(result.date);
            fatalError ||= result.message;
          }
        }
        if (fatalError) break;
      }
      setModal(null);
      const report = buildRecurrenceReport(occurrenceDates.length, successCount, conflictDates, details, fatalError, failedDates);
      setScheduleReport(conflictDates.length || fatalError ? report : '');
      setToast(`${formatNumber(successCount)} سانس تکرارشونده ثبت شد${conflictDates.length ? `؛ ${formatNumber(conflictDates.length)} تداخل گزارش شد` : ''}${fatalError ? '؛ ثبت سری به‌دلیل خطا متوقف شد' : ''}.`);
    } finally {
      setBookingSaving(false);
    }
  }

  async function submitBookingRequest(draft: BookingDraft, input: RequestFormInput) {
    const bookedForName = input.bookedForName.trim();
    const message = input.message.trim();
    if (!bookedForName) {
      setToast('نام و نام خانوادگی را وارد کن.');
      return;
    }
    if (message.length > 1500) {
      setToast('پیام درخواست حداکثر ۱۵۰۰ نویسه باشد.');
      return;
    }

    const court = settings.courts.find((item) => item.id === draft.courtId);
    if (!court) {
      setToast('زمین انتخاب‌شده دیگر فعال نیست.');
      return;
    }
    const details: BookingDetails = {
      ...draft,
      courtName: court.name,
      sport: input.sport,
      bookedForName,
      priceToman: settings.defaultSessionPriceToman,
      note: '',
    };
    const occupied = [
      ...publicSchedule.filter((booking) => booking.status === 'booked'),
      ...bookings.filter((booking) => isBookingActive(booking.status)),
    ];
    if (occupied.some((booking) => booking.courtId === details.courtId && booking.date === details.date && bookingOverlaps(booking, details))) {
      setToast('این سانس همین حالا در انتظار بررسی یا رزرو شده است؛ زمان دیگری را انتخاب کن.');
      return;
    }
    if (!isDemo && (!db || !user || currentRole !== 'player')) return;

    setBookingSaving(true);
    try {
      if (isDemo) {
        const playerUid = 'demo-player';
        const id = crypto.randomUUID();
        const now = new Date();
        const nowIso = now.toISOString();
        const deadlineAt = new Date(now.getTime() + 30 * 60_000).toISOString();
        const booking: BookingRecord = {
          id,
          ...details,
          status: 'pending',
          lockIds: makeSlotLockIds(details.courtId, details.date, details.startTime, details.endTime),
          phaseDeadlineAt: deadlineAt,
          phaseDeadlineKind: 'initial_review',
          createdAt: nowIso,
          createdByUid: playerUid,
          createdByEmail: 'demo.player@example.test',
        };
        const notice = makeNotification(
          'demo-owner', booking, 'booking_request', 'درخواست رزرو جدید',
          `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)} · ${formatToman(booking.priceToman)} · برای تأیید اولیه ۳۰ دقیقه فرصت داری.`,
        );
        setDemoData((current) => ({
          ...current,
          bookings: [booking, ...current.bookings],
          bookingMessages: message
            ? [{ id: crypto.randomUUID(), bookingId: id, body: message, senderUid: playerUid, senderRole: 'player', createdAt: nowIso, kind: 'text' }, ...current.bookingMessages]
            : current.bookingMessages,
          notifications: [{ ...notice, createdAt: nowIso }, ...current.notifications],
        }));
        setModal({ type: 'bookingConversation', booking });
        setToast('درخواست ارسال شد؛ باشگاه ۳۰ دقیقه برای تأیید اولیه فرصت دارد.');
        return;
      }

      const firestore = db;
      const signedInUser = user;
      if (!firestore || !signedInUser || !settings.ownerUid) {
        setToast('اطلاعات مالک باشگاه هنوز در تنظیمات Firebase ثبت نشده است.');
        return;
      }
      const id = await createRemoteBookingRequest(firestore, clubId, signedInUser.uid, signedInUser.email ?? '', settings.ownerUid, details, message);
      const booking: BookingRecord = {
        id,
        ...details,
        status: 'pending',
        lockIds: makeSlotLockIds(details.courtId, details.date, details.startTime, details.endTime),
        phaseDeadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        phaseDeadlineKind: 'initial_review',
        createdAt: new Date().toISOString(),
        createdByUid: signedInUser.uid,
        createdByEmail: signedInUser.email ?? '',
      };
      setModal({ type: 'bookingConversation', booking });
      setToast('درخواست ارسال شد؛ باشگاه ۳۰ دقیقه برای تأیید اولیه فرصت دارد.');
    } catch (error) {
      if ((error as { code?: string })?.code === 'booking-slot-conflict') {
        setToast('در همین لحظه درخواست دیگری برای این سانس ثبت شده است؛ سانس را تازه‌سازی کن.');
      } else if (['permission-denied', 'firestore/permission-denied'].includes((error as { code?: string })?.code ?? '')) {
        setToast('درخواست ثبت نشد؛ ممکن است سانس هم‌زمان قفل شده باشد یا Rules فایربیس نیاز به بررسی داشته باشد.');
      } else {
        setToast(getFriendlyError(error));
      }
    } finally {
      setBookingSaving(false);
    }
  }

  async function applyBookingBalance(booking: BookingRecord) {
    if (currentRole !== 'player' || !['awaiting_payment', 'needs_correction'].includes(booking.status)) return;
    if (settings.archivedCourts.some((court) => court.id === booking.courtId)) return;
    const alreadyApplied = booking.accountBalanceAppliedToman ?? 0;

    if (isDemo) {
      const additional = Math.min(Math.max(0, booking.priceToman - alreadyApplied), Math.max(0, balance));
      if (additional <= 0) {
        setToast('ماندهٔ قابل‌استفاده برای این رزرو کافی نیست.');
        return;
      }
      const now = new Date().toISOString();
      const totalApplied = alreadyApplied + additional;
      const remaining = Math.max(0, booking.priceToman - totalApplied);
      const fullyCovered = remaining === 0;
      const notice = makeNotification(
        'demo-owner', booking,
        fullyCovered ? 'payment_reported' : 'booking_balance_applied',
        fullyCovered ? 'پرداخت از ماندهٔ حساب' : 'بخشی از مانده برای رزرو کنار گذاشته شد',
        `${booking.courtName} · ${formatJalaliDate(booking.date)} · ${formatTimeRange(booking.startTime, booking.endTime)} · ${formatToman(additional)} از مانده منظور شد${remaining ? `؛ ${formatToman(remaining)} باقی مانده.` : '؛ برای تأیید نهایی بررسی کن.'}`,
      );
      setDemoData((current) => ({
        ...current,
        bookings: current.bookings.map((item) => item.id === booking.id ? {
          ...item,
          accountBalanceAppliedToman: totalApplied,
          balanceHoldToman: (item.balanceHoldToman ?? 0) + additional,
          ...(fullyCovered ? {
            status: 'payment_submitted',
            paymentReportedAmountToman: 0,
            paymentReportedAt: now,
            paymentNote: 'پرداخت کامل از اعتبار ماندهٔ حساب.',
            phaseDeadlineAt: '',
            phaseDeadlineKind: undefined,
          } : {}),
        } : item),
        notifications: [{ ...notice, createdAt: now }, ...current.notifications],
      }));
      setToast(fullyCovered
        ? 'ماندهٔ حساب برای رزرو استفاده شد؛ درخواست برای تأیید نهایی به باشگاه رفت.'
        : `${formatToman(additional)} از مانده کنار گذاشته شد؛ ${formatToman(remaining)} باقی‌مانده را پرداخت و اعلام کن.`);
      return;
    }

    if (!firebaseApp || !user) {
      setToast('اتصال به Firebase برای استفاده از ماندهٔ حساب آماده نیست.');
      return;
    }
    setBookingSaving(true);
    try {
      const functions = getFunctions(firebaseApp, 'europe-west1');
      const applyBalance = httpsCallable<
        { clubId: string; bookingId: string },
        { appliedToman: number; totalAppliedToman: number; remainingToman: number; fullyCovered: boolean }
      >(functions, 'applyBookingBalance');
      const result = await applyBalance({ clubId, bookingId: booking.id });
      const { appliedToman, remainingToman, fullyCovered } = result.data;
      setToast(fullyCovered
        ? 'ماندهٔ حساب برای رزرو استفاده شد؛ درخواست برای تأیید نهایی به باشگاه رفت.'
        : `${formatToman(appliedToman)} از مانده کنار گذاشته شد؛ ${formatToman(remainingToman)} باقی‌مانده را پرداخت و اعلام کن.`);
    } catch (error) {
      setToast(getFriendlyError(error));
    } finally {
      setBookingSaving(false);
    }
  }

  async function submitBookingPayment(booking: BookingRecord, note: string, file: File | null) {
    if (settings.archivedCourts.some((court) => court.id === booking.courtId)) {
      setToast('این زمین بایگانی شده و درخواست جدیدی برای آن پذیرفته نمی‌شود.');
      return;
    }
    if (currentRole !== 'player' || !['awaiting_payment', 'needs_correction'].includes(booking.status)) return;
    if (booking.phaseDeadlineAt && new Date(booking.phaseDeadlineAt).getTime() <= Date.now()) {
      setToast('مهلت این مرحله تمام شده است؛ سانس آزاد خواهد شد.');
      return;
    }
    const cleanNote = note.trim();
    if (booking.priceToman > 0 && !cleanNote && !file) {
      setToast('یک پیام پرداخت بنویس یا رسید پرداخت را پیوست کن.');
      return;
    }
    if (cleanNote.length > 1500) {
      setToast('پیام پرداخت حداکثر ۱۵۰۰ نویسه باشد.');
      return;
    }
    if (file && (!RECEIPT_CONTENT_TYPES.includes(file.type) || file.size > MAX_RECEIPT_BYTES)) {
      setToast('رسید باید JPG، PNG، WebP یا PDF و حداکثر ۸ مگابایت باشد.');
      return;
    }
    if (file && isDemo && file.size > MAX_DEMO_RECEIPT_BYTES) {
      setToast('در حالت نمایشی به‌دلیل محدودیت مرورگر، فایل رسید باید حداکثر ۲ مگابایت باشد.');
      return;
    }
    if (file && !isDemo && !storage) {
      setToast('برای بارگذاری رسید، Firebase Storage را فعال و storageBucket را در تنظیمات وارد کن.');
      return;
    }

    if (isDemo) {
      try {
        const now = new Date().toISOString();
        const attachmentDataUrl = file ? await readFileAsDataUrl(file) : '';
        const message: BookingMessageRecord = {
          id: crypto.randomUUID(), bookingId: booking.id,
          body: cleanNote || 'پرداخت انجام شد؛ لطفاً بررسی و تأیید کن.',
          senderUid: 'demo-player', senderRole: 'player', createdAt: now, kind: 'payment_report',
          attachmentName: file ? safeAttachmentName(file) : '',
          attachmentContentType: file?.type ?? '', attachmentSize: file?.size ?? 0,
          attachmentDataUrl,
        };
        const reportedAmountToman = Math.max(0, booking.priceToman - (booking.accountBalanceAppliedToman ?? 0));
        const notification = makeNotification(
          'demo-owner', booking, 'payment_reported', 'اعلام پرداخت بازیکن',
          `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)} · ${formatToman(reportedAmountToman)} پرداخت بیرونی${(booking.accountBalanceAppliedToman ?? 0) > 0 ? ` و ${formatToman(booking.accountBalanceAppliedToman ?? 0)} از مانده` : ''} · برای تأیید نهایی بررسی کن.`,
        );
        setDemoData((current) => ({
          ...current,
          bookings: current.bookings.map((item) => item.id === booking.id
            ? { ...item, status: 'payment_submitted', paymentReportedAt: now, paymentReportedAmountToman: reportedAmountToman, paymentNote: cleanNote, phaseDeadlineAt: '', phaseDeadlineKind: undefined }
            : item),
          bookingMessages: [...current.bookingMessages, message],
          notifications: [{ ...notification, createdAt: now }, ...current.notifications],
        }));
        setToast('اعلام پرداخت برای تأیید نهایی به باشگاه فرستاده شد.');
      } catch (error) {
        setToast(getFriendlyError(error));
      }
      return;
    }

    if (!db || !user || (booking.accountUid || booking.createdByUid) !== user.uid || !settings.ownerUid || (file && !storage)) {
      setToast('ارسال اعلام پرداخت در حال حاضر در دسترس نیست.');
      return;
    }
    setBookingSaving(true);
    let uploadedPath = '';
    try {
      let attachment: BookingAttachment | null = null;
      if (file) {
        const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1] || 'img';
        uploadedPath = `clubs/${clubId}/bookings/${booking.id}/${crypto.randomUUID()}.${extension}`;
        await uploadBytes(storageRef(storage!, uploadedPath), file, { contentType: file.type });
        attachment = { path: uploadedPath, name: safeAttachmentName(file), contentType: file.type, size: file.size };
      }
      const bookingRef = doc(db, 'clubs', clubId, 'bookings', booking.id);
      const messageRef = doc(collection(db, 'clubs', clubId, 'bookings', booking.id, 'messages'));
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(bookingRef);
        if (!snapshot.exists()) throw new Error('درخواست رزرو پیدا نشد.');
        const data = snapshot.data();
        if (!['awaiting_payment', 'needs_correction'].includes(String(data.status))) throw new Error('این درخواست دیگر در مرحلهٔ ثبت پرداخت نیست.');
        const deadline = data.phaseDeadlineAt?.toDate?.() as Date | undefined;
        if (deadline && deadline.getTime() <= Date.now()) throw new Error('مهلت پرداخت یا اصلاح تمام شده است.');
        const accountAppliedToman = Number(data.accountBalanceAppliedToman ?? 0);
        const reportedAmountToman = Math.max(0, Number(data.priceToman ?? 0) - accountAppliedToman);
        const notification = makeNotification(
          settings.ownerUid!, booking, 'payment_reported', 'اعلام پرداخت بازیکن',
          `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)} · ${formatToman(reportedAmountToman)} پرداخت بیرونی${accountAppliedToman > 0 ? ` و ${formatToman(accountAppliedToman)} از مانده` : ''} · برای تأیید نهایی بررسی کن.`,
        );
        const notificationRef = doc(db!, 'clubs', clubId, 'notifications', notification.id);
        transaction.update(bookingRef, {
          status: 'payment_submitted',
          paymentReportedAt: serverTimestamp(),
          paymentReportedAmountToman: reportedAmountToman,
          paymentNote: cleanNote,
          phaseDeadlineAt: null,
          phaseDeadlineKind: null,
          updatedAt: serverTimestamp(),
        });
        transaction.set(messageRef, {
          bookingId: booking.id,
          body: cleanNote || 'پرداخت انجام شد؛ لطفاً بررسی و تأیید کن.',
          senderUid: user.uid,
          senderRole: 'player',
          kind: 'payment_report',
          ...(attachment ? { attachmentPath: attachment.path, attachmentName: attachment.name, attachmentContentType: attachment.contentType, attachmentSize: attachment.size } : {}),
          createdAt: serverTimestamp(),
        });
        transaction.set(notificationRef, { ...notification, createdAt: serverTimestamp(), readAt: null });
      });
      setToast('اعلام پرداخت برای تأیید نهایی به باشگاه فرستاده شد.');
    } catch (error) {
      if (uploadedPath && storage) await deleteObject(storageRef(storage, uploadedPath)).catch(() => undefined);
      setToast(getFriendlyError(error));
    } finally {
      setBookingSaving(false);
    }
  }

  async function sendBookingMessage(booking: BookingRecord, body: string) {
    const cleanBody = body.trim();
    if (!cleanBody || cleanBody.length > 1500) return;
    const recipientUid = currentRole === 'owner' ? (booking.accountUid || booking.createdByUid) : settings.ownerUid;
    if (!recipientUid) {
      setToast('حساب دریافت‌کنندهٔ پیام پیدا نشد.');
      return;
    }
    const senderName = currentRole === 'owner' ? 'باشگاه' : 'بازیکن';
    const notificationText = `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)} · ${senderName}: ${cleanBody.slice(0, 120)}`;
    if (isDemo) {
      const now = new Date().toISOString();
      const message: BookingMessageRecord = {
        id: crypto.randomUUID(), bookingId: booking.id, body: cleanBody,
        senderUid: currentRole === 'owner' ? 'demo-owner' : 'demo-player',
        senderRole: currentRole, createdAt: now, kind: 'text',
      };
      const notification = makeNotification(recipientUid, booking, 'booking_message', 'پیام جدید دربارهٔ رزرو', notificationText, message.id);
      setDemoData((current) => ({
        ...current,
        bookingMessages: [...current.bookingMessages, message],
        notifications: [{ ...notification, createdAt: now }, ...current.notifications],
      }));
      return;
    }
    if (!db || !user) return;
    try {
      const batch = writeBatch(db);
      const messageRef = doc(collection(db, 'clubs', clubId, 'bookings', booking.id, 'messages'));
      const notification = makeNotification(recipientUid, booking, 'booking_message', 'پیام جدید دربارهٔ رزرو', notificationText, messageRef.id);
      const notificationRef = doc(db, 'clubs', clubId, 'notifications', notification.id);
      batch.set(messageRef, {
        bookingId: booking.id,
        body: cleanBody,
        senderUid: user.uid,
        senderRole: currentRole,
        kind: 'text',
        createdAt: serverTimestamp(),
      });
      batch.set(notificationRef, { ...notification, createdAt: serverTimestamp(), readAt: null });
      await batch.commit();
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function reviewBooking(
    booking: BookingRecord,
    decision: 'initial_approve' | 'initial_reject' | 'final_approve' | 'correction' | 'final_reject',
    reason = '',
  ) {
    const cleanReason = reason.trim();
    const initialDecision = decision === 'initial_approve' || decision === 'initial_reject';
    if (settings.archivedCourts.some((court) => court.id === booking.courtId)) {
      setToast('این زمین بایگانی شده است؛ بررسی درخواست جدید ممکن نیست.');
      return;
    }
    if (currentRole !== 'owner') return;
    if (initialDecision && booking.status !== 'pending') return;
    if (!initialDecision && !['payment_submitted', 'needs_correction'].includes(booking.status)) return;
    if (['correction', 'final_reject'].includes(decision) && !cleanReason) {
      setToast('برای درخواست اصلاح یا رد نهایی، دلیل را بنویس.');
      return;
    }
    if (cleanReason.length > 300) {
      setToast('دلیل حداکثر ۳۰۰ نویسه باشد.');
      return;
    }
    if (booking.phaseDeadlineAt && booking.status !== 'payment_submitted' && new Date(booking.phaseDeadlineAt).getTime() <= Date.now()) {
      setToast('مهلت این مرحله تمام شده است؛ درخواست در حال انقضا است.');
      return;
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const deadline = new Date(nowDate.getTime() + (decision === 'initial_approve' ? 15 : 15) * 60_000).toISOString();
    const location = `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)}`;
    const addDemoNotice = (current: DemoData, type: BookingNotificationType, title: string, body: string) => {
      const notification = makeNotification(booking.accountUid || booking.createdByUid, booking, type, title, body);
      return [{ ...notification, createdAt: now }, ...current.notifications];
    };
    const statusMessage = (body: string): BookingMessageRecord => ({
      id: crypto.randomUUID(), bookingId: booking.id, body, senderUid: 'demo-owner', senderRole: 'owner', createdAt: now, kind: 'status',
    });

    if (isDemo) {
      setDemoData((current) => {
        let notifications = current.notifications;
        let message: BookingMessageRecord | null = null;
        let addedPayment: PaymentRecord | null = null;
        let addedSession: SessionRecord | null = null;
        const updatedBookings = current.bookings.map((item): BookingRecord => {
          if (item.id !== booking.id) return item;
          if (decision === 'initial_approve') {
            notifications = addDemoNotice(current, 'initial_approved', 'تأیید اولیه شد', `${location} · ${formatToman(item.priceToman)} · تا ۱۵ دقیقه برای پرداخت فرصت داری.`);
            return { ...item, status: 'awaiting_payment', initialApprovedAt: now, initialApprovedByUid: 'demo-owner', phaseDeadlineAt: deadline, phaseDeadlineKind: 'payment' };
          }
          if (decision === 'initial_reject') {
            notifications = addDemoNotice(current, 'initial_rejected', 'درخواست رزرو رد شد', `${location}${cleanReason ? ` · دلیل: ${cleanReason}` : ''}`);
            message = statusMessage(cleanReason ? `درخواست رزرو رد شد: ${cleanReason}` : 'درخواست رزرو رد شد.');
            return { ...item, status: 'rejected', rejectedAt: now, rejectedByUid: 'demo-owner', rejectionReason: cleanReason, balanceHoldToman: 0, phaseDeadlineAt: '', phaseDeadlineKind: undefined };
          }
          if (decision === 'final_approve') {
            notifications = addDemoNotice(current, 'booking_confirmed', 'رزرو قطعی شد', `${location} · ${formatToman(item.priceToman)} · پرداخت تأیید شد.`);
            message = statusMessage('پرداخت بررسی و رزرو شما تأیید نهایی شد؛ سانس هم به دفتر حساب اضافه شد.');
            const paymentAmount = Math.max(0, item.paymentReportedAmountToman ?? 0);
            const sessionId = crypto.randomUUID();
            addedSession = {
              id: sessionId,
              bookingId: item.id,
              date: item.date,
              priceToman: item.priceToman,
              status: 'scheduled',
              note: `رزرو قطعی · ${item.courtName} · ${formatTimeRange(item.startTime, item.endTime)}`,
              createdAt: now,
              createdByUid: item.createdByUid,
              accountUid: item.accountUid || item.createdByUid,
              createdByEmail: item.createdByEmail ?? '',
            };
            if (paymentAmount > 0) {
              addedPayment = {
                id: crypto.randomUUID(),
                bookingId: item.id,
                amountToman: paymentAmount,
                note: `پرداخت رزرو · ${item.courtName} · ${formatTimeRange(item.startTime, item.endTime)}`,
                paidAt: item.paymentReportedAt?.slice(0, 10) || now.slice(0, 10),
                status: 'confirmed',
                createdAt: now,
                createdByUid: item.createdByUid,
                accountUid: item.accountUid || item.createdByUid,
                createdByEmail: item.createdByEmail ?? '',
                history: [],
                reviewedByUid: 'demo-owner',
                reviewedAt: now,
              };
            }
            return {
              ...item,
              status: 'booked',
              approvedAt: now,
              approvedByUid: 'demo-owner',
              balanceHoldToman: item.priceToman,
              paymentLedgerId: addedPayment?.id ?? '',
              sessionRecordId: sessionId,
              phaseDeadlineAt: '',
              phaseDeadlineKind: undefined,
            };
          }
          if (decision === 'correction') {
            notifications = addDemoNotice(current, 'payment_correction', 'پرداخت نیاز به اصلاح دارد', `${location} · ${cleanReason} · ۱۵ دقیقه برای اصلاح فرصت داری.`);
            message = statusMessage(`لطفاً پرداخت را اصلاح کن: ${cleanReason}`);
            return { ...item, status: 'needs_correction', correctionRequestedAt: now, correctionRequestedByUid: 'demo-owner', correctionNote: cleanReason, phaseDeadlineAt: deadline, phaseDeadlineKind: 'correction' };
          }
          notifications = addDemoNotice(current, 'booking_rejected', 'درخواست رزرو رد نهایی شد', `${location} · دلیل: ${cleanReason}`);
          message = statusMessage(`درخواست رزرو رد نهایی شد: ${cleanReason}`);
          return { ...item, status: 'rejected', rejectedAt: now, rejectedByUid: 'demo-owner', rejectionReason: cleanReason, balanceHoldToman: 0, phaseDeadlineAt: '', phaseDeadlineKind: undefined };
        });
        return {
          ...current,
          bookings: updatedBookings,
          payments: addedPayment ? [addedPayment, ...current.payments] : current.payments,
          sessions: addedSession ? [addedSession, ...current.sessions] : current.sessions,
          bookingMessages: message ? [...current.bookingMessages, message] : current.bookingMessages,
          notifications,
        };
      });
      setModal(null);
      setToast(decision === 'initial_approve' ? 'تأیید اولیه ثبت شد؛ بازیکن ۱۵ دقیقه برای پرداخت فرصت دارد.' : decision === 'initial_reject' || decision === 'final_reject' ? 'درخواست رد شد و سانس آزاد شد.' : decision === 'correction' ? 'درخواست اصلاح برای بازیکن فرستاده شد؛ سانس تا ۱۵ دقیقه قفل می‌ماند.' : 'پرداخت تأیید و رزرو قطعی شد.');
      return;
    }

    const firestore = db;
    if (!firestore || !user) return;
    setBookingSaving(true);
    try {
      const bookingRef = doc(firestore, 'clubs', clubId, 'bookings', booking.id);
      const publicRef = doc(firestore, 'clubs', clubId, 'publicSchedule', booking.id);
      const bookingAccountUid = booking.accountUid || booking.createdByUid;
      const balanceLockRef = doc(firestore, 'clubs', clubId, 'accountBalanceLocks', bookingAccountUid);
      const sessionRef = decision === 'final_approve' ? doc(collection(firestore, 'clubs', clubId, 'sessions')) : null;
      const paymentRef = decision === 'final_approve' ? doc(collection(firestore, 'clubs', clubId, 'payments')) : null;
      const notification = makeNotification(
        bookingAccountUid,
        booking,
        decision === 'initial_approve' ? 'initial_approved' : decision === 'initial_reject' ? 'initial_rejected' : decision === 'final_approve' ? 'booking_confirmed' : decision === 'correction' ? 'payment_correction' : 'booking_rejected',
        decision === 'initial_approve' ? 'تأیید اولیه شد' : decision === 'initial_reject' ? 'درخواست رزرو رد شد' : decision === 'final_approve' ? 'رزرو قطعی شد' : decision === 'correction' ? 'پرداخت نیاز به اصلاح دارد' : 'درخواست رزرو رد نهایی شد',
        decision === 'initial_approve'
          ? `${location} · ${formatToman(booking.priceToman)} · تا ۱۵ دقیقه برای پرداخت فرصت داری.`
          : decision === 'initial_reject'
            ? `${location}${cleanReason ? ` · دلیل: ${cleanReason}` : ''}`
            : decision === 'final_approve'
              ? `${location} · ${formatToman(booking.priceToman)} · پرداخت تأیید و رزرو قطعی شد.`
              : `${location} · دلیل: ${cleanReason}${decision === 'correction' ? ' · ۱۵ دقیقه برای اصلاح فرصت داری.' : ''}`,
      );
      const notificationRef = doc(firestore, 'clubs', clubId, 'notifications', notification.id);
      const statusMessageRef = decision === 'initial_reject' || decision === 'final_approve' || decision === 'correction' || decision === 'final_reject'
        ? doc(collection(firestore, 'clubs', clubId, 'bookings', booking.id, 'messages'))
        : null;
      await runTransaction(firestore, async (transaction) => {
        await transaction.get(balanceLockRef);
        const snapshot = await transaction.get(bookingRef);
        if (!snapshot.exists()) throw new Error('درخواست رزرو پیدا نشد.');
        const data = snapshot.data();
        const expectedStatus = initialDecision ? 'pending' : data.status;
        if (data.status !== expectedStatus || (initialDecision && data.status !== 'pending') || (!initialDecision && !['payment_submitted', 'needs_correction'].includes(String(data.status)))) {
          throw new Error('این درخواست در مرحلهٔ دیگری است یا قبلاً بررسی شده است.');
        }
        const ownerMessage = decision === 'initial_reject'
          ? cleanReason ? `درخواست رزرو رد شد: ${cleanReason}` : 'درخواست رزرو رد شد.'
          : decision === 'final_reject'
            ? `درخواست رزرو رد نهایی شد: ${cleanReason}`
            : decision === 'correction'
              ? `لطفاً پرداخت را اصلاح کن: ${cleanReason}`
              : 'پرداخت بررسی و رزرو شما تأیید نهایی شد.';
        const update: DocumentData = { updatedAt: serverTimestamp() };
        if (decision === 'initial_approve') {
          update.status = 'awaiting_payment';
          update.initialApprovedAt = serverTimestamp();
          update.initialApprovedByUid = user.uid;
          update.phaseDeadlineAt = Timestamp.fromDate(new Date(Date.now() + 15 * 60_000));
          update.phaseDeadlineKind = 'payment';
        } else if (decision === 'initial_reject' || decision === 'final_reject') {
          const lockIds = Array.isArray(data.lockIds) ? data.lockIds.map(String) : [];
          for (const lockId of lockIds) transaction.delete(doc(firestore, 'clubs', clubId, 'slotLocks', lockId));
          transaction.delete(publicRef);
          update.status = 'rejected';
          update.rejectedAt = serverTimestamp();
          update.rejectedByUid = user.uid;
          update.rejectionReason = cleanReason;
          update.balanceHoldToman = 0;
          update.phaseDeadlineAt = null;
          update.phaseDeadlineKind = null;
        } else if (decision === 'final_approve') {
          if (!sessionRef || !paymentRef) throw new Error('دفتر حساب برای این رزرو آماده نیست.');
          const paymentAmount = Math.max(0, Number(data.paymentReportedAmountToman ?? 0));
          update.status = 'booked';
          update.approvedAt = serverTimestamp();
          update.approvedByUid = user.uid;
          update.balanceHoldToman = Number(data.priceToman ?? 0);
          update.sessionRecordId = sessionRef.id;
          update.paymentLedgerId = paymentAmount > 0 ? paymentRef.id : null;
          update.phaseDeadlineAt = null;
          update.phaseDeadlineKind = null;
          transaction.set(sessionRef, {
            bookingId: booking.id,
            date: String(data.date ?? booking.date),
            priceToman: Number(data.priceToman ?? booking.priceToman),
            status: 'scheduled',
            note: `رزرو قطعی · ${String(data.courtName ?? booking.courtName)} · ${formatTimeRange(String(data.startTime ?? booking.startTime), String(data.endTime ?? booking.endTime))}`,
            createdAt: serverTimestamp(),
            createdByUid: String(data.createdByUid ?? booking.createdByUid),
            accountUid: String(data.accountUid ?? booking.accountUid ?? data.createdByUid ?? booking.createdByUid),
            createdByEmail: String(data.createdByEmail ?? booking.createdByEmail ?? ''),
          });
          if (paymentAmount > 0) {
            const reportedAt = data.paymentReportedAt?.toDate?.() as Date | undefined;
            transaction.set(paymentRef, {
              bookingId: booking.id,
              amountToman: paymentAmount,
              note: `پرداخت رزرو · ${String(data.courtName ?? booking.courtName)} · ${formatTimeRange(String(data.startTime ?? booking.startTime), String(data.endTime ?? booking.endTime))}`,
              paidAt: reportedAt ? reportedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
              status: 'confirmed',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdByUid: String(data.accountUid ?? booking.accountUid ?? data.createdByUid ?? booking.createdByUid),
              accountUid: String(data.accountUid ?? booking.accountUid ?? data.createdByUid ?? booking.createdByUid),
              createdByEmail: String(data.createdByEmail ?? booking.createdByEmail ?? ''),
              history: [],
              reviewedByUid: user.uid,
              reviewedAt: serverTimestamp(),
            });
          }
        } else {
          update.status = 'needs_correction';
          update.correctionRequestedAt = serverTimestamp();
          update.correctionRequestedByUid = user.uid;
          update.correctionNote = cleanReason;
          update.phaseDeadlineAt = Timestamp.fromDate(new Date(Date.now() + 15 * 60_000));
          update.phaseDeadlineKind = 'correction';
        }
        transaction.update(bookingRef, update);
        if (statusMessageRef) transaction.set(statusMessageRef, {
          bookingId: booking.id,
          body: ownerMessage,
          senderUid: user.uid,
          senderRole: 'owner',
          kind: 'status',
          createdAt: serverTimestamp(),
        });
        transaction.set(notificationRef, { ...notification, createdAt: serverTimestamp(), readAt: null });
        transaction.set(balanceLockRef, { uid: bookingAccountUid, updatedAt: serverTimestamp() }, { merge: true });
      });
      setModal(null);
      setToast(decision === 'initial_approve' ? 'تأیید اولیه ثبت شد؛ بازیکن ۱۵ دقیقه برای پرداخت فرصت دارد.' : decision === 'initial_reject' || decision === 'final_reject' ? 'درخواست رد شد و سانس آزاد شد.' : decision === 'correction' ? 'درخواست اصلاح برای بازیکن فرستاده شد؛ سانس تا ۱۵ دقیقه قفل می‌ماند.' : 'پرداخت تأیید و رزرو قطعی شد.');
    } catch (error) {
      setToast(getFriendlyError(error));
    } finally {
      setBookingSaving(false);
    }
  }

  async function expireRemoteBooking(booking: BookingRecord) {
    const firestore = db;
    if (!firestore || !user || (currentRole === 'owner' && !isAllowedUser)) return;
    const bookingRef = doc(firestore, 'clubs', clubId, 'bookings', booking.id);
    const publicRef = doc(firestore, 'clubs', clubId, 'publicSchedule', booking.id);
    const bookingAccountUid = booking.accountUid || booking.createdByUid;
    const balanceLockRef = doc(firestore, 'clubs', clubId, 'accountBalanceLocks', bookingAccountUid);
    const recipientUid = currentRole === 'owner' ? bookingAccountUid : settings.ownerUid;
    if (!recipientUid) return;
    const reason = booking.phaseDeadlineKind === 'initial_review'
      ? 'باشگاه در مهلت ۳۰ دقیقه‌ای تأیید اولیه نکرد.'
      : booking.phaseDeadlineKind === 'correction'
        ? 'مهلت ۱۵ دقیقه‌ای اصلاح پرداخت تمام شد.'
        : 'مهلت ۱۵ دقیقه‌ای پرداخت تمام شد.';
    const notification = makeNotification(
      recipientUid, booking, 'booking_expired', 'مهلت رزرو تمام شد',
      `${booking.courtName} · ${formatTimeRange(booking.startTime, booking.endTime)} · ${reason} سانس آزاد شد.`,
    );
    const notificationRef = doc(firestore, 'clubs', clubId, 'notifications', notification.id);
    try {
      await runTransaction(firestore, async (transaction) => {
        await transaction.get(balanceLockRef);
        const snapshot = await transaction.get(bookingRef);
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        const deadline = data.phaseDeadlineAt?.toDate?.() as Date | undefined;
        if (!['pending', 'awaiting_payment', 'needs_correction'].includes(String(data.status)) || !deadline || deadline.getTime() > Date.now()) return;
        if (currentRole === 'player' && (data.accountUid || data.createdByUid) !== user.uid) return;
        const lockIds = Array.isArray(data.lockIds) ? data.lockIds.map(String) : [];
        for (const lockId of lockIds) transaction.delete(doc(firestore, 'clubs', clubId, 'slotLocks', lockId));
        transaction.delete(publicRef);
        transaction.update(bookingRef, {
          status: 'expired',
          expiredAt: serverTimestamp(),
          expiryReason: reason,
          balanceHoldToman: 0,
          phaseDeadlineAt: null,
          phaseDeadlineKind: null,
          updatedAt: serverTimestamp(),
        });
        transaction.set(notificationRef, { ...notification, createdAt: serverTimestamp(), readAt: null });
        transaction.set(balanceLockRef, { uid: String(data.accountUid || data.createdByUid || booking.accountUid || booking.createdByUid), updatedAt: serverTimestamp() }, { merge: true });
      });
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function cancelBooking(booking: BookingRecord) {
    if (booking.status !== 'booked' || currentRole !== 'owner') return;
    const bookingAccountUid = booking.accountUid || booking.createdByUid;
    if (isDemo) {
      const cancelledAt = new Date().toISOString();
      const notification = makeNotification(
        bookingAccountUid, booking, 'booking_cancelled', 'رزرو لغو شد',
        `${booking.courtName} · ${formatJalaliDate(booking.date)} · ${formatTimeRange(booking.startTime, booking.endTime)} · باشگاه رزرو را لغو کرد و سانس آزاد شد.`,
      );
      setDemoData((current) => ({
        ...current,
        bookings: current.bookings.map((item) => item.id === booking.id
          ? { ...item, status: 'cancelled', cancelledAt, balanceHoldToman: 0 }
          : item),
        sessions: current.sessions.map((session) => session.id === booking.sessionRecordId && session.status === 'scheduled'
          ? { ...session, status: 'cancelled_by_club', note: `${session.note} · باشگاه رزرو را لغو کرد` }
          : session),
        notifications: [{ ...notification, createdAt: cancelledAt }, ...current.notifications],
      }));
      setToast('رزرو لغو شد و این بازه دوباره آزاد است.');
      return;
    }
    if (!db || !user || !clubId) return;
    const firestore = db;

    try {
      const bookingRef = doc(firestore, 'clubs', clubId, 'bookings', booking.id);
      const publicRef = doc(firestore, 'clubs', clubId, 'publicSchedule', booking.id);
      const balanceLockRef = doc(firestore, 'clubs', clubId, 'accountBalanceLocks', bookingAccountUid);
      const sessionRef = booking.sessionRecordId ? doc(firestore, 'clubs', clubId, 'sessions', booking.sessionRecordId) : null;
      const lockRefs = booking.lockIds.map((lockId) => doc(firestore, 'clubs', clubId, 'slotLocks', lockId));
      const notification = makeNotification(
        bookingAccountUid, booking, 'booking_cancelled', 'رزرو لغو شد',
        `${booking.courtName} · ${formatJalaliDate(booking.date)} · ${formatTimeRange(booking.startTime, booking.endTime)} · باشگاه رزرو را لغو کرد و سانس آزاد شد.`,
      );
      const notificationRef = doc(firestore, 'clubs', clubId, 'notifications', notification.id);
      await runTransaction(firestore, async (transaction) => {
        await transaction.get(balanceLockRef);
        const bookingSnapshot = await transaction.get(bookingRef);
        if (!bookingSnapshot.exists() || bookingSnapshot.data().status !== 'booked') {
          throw new Error('این رزرو قبلاً لغو شده است.');
        }
        const linkedSessionSnapshot = sessionRef ? await transaction.get(sessionRef) : null;
        if (linkedSessionSnapshot?.exists() && linkedSessionSnapshot.data().status !== 'scheduled') {
          throw new Error('وضعیت سانس در دفتر حساب ثبت شده است؛ از همان سابقه اصلاحش کن.');
        }
        const lockSnapshots = await Promise.all(lockRefs.map((lockRef) => transaction.get(lockRef)));
        lockSnapshots.forEach((snapshot, index) => {
          if (snapshot.exists() && snapshot.data().bookingId === booking.id) transaction.delete(lockRefs[index]);
        });
        transaction.update(bookingRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          balanceHoldToman: 0,
          updatedAt: serverTimestamp(),
        });
        if (sessionRef && linkedSessionSnapshot?.exists()) transaction.update(sessionRef, {
          status: 'cancelled_by_club',
          note: `${String(linkedSessionSnapshot.data().note ?? '')} · باشگاه رزرو را لغو کرد`,
          updatedAt: serverTimestamp(),
        });
        transaction.set(publicRef, {
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          courtId: booking.courtId,
          courtName: booking.courtName,
          status: 'cancelled',
          updatedAt: serverTimestamp(),
        });
        transaction.set(notificationRef, { ...notification, createdAt: serverTimestamp(), readAt: null });
        transaction.set(balanceLockRef, { uid: bookingAccountUid, updatedAt: serverTimestamp() }, { merge: true });
      });
      setToast('رزرو لغو شد و این بازه دوباره آزاد است.');
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  async function saveSettings(input: ClubSettings) {
    const newlyArchivedIds = settings.courts
      .filter((court) => !input.courts.some((activeCourt) => activeCourt.id === court.id))
      .map((court) => court.id);
    const unresolvedBookings = bookings.filter((booking) => newlyArchivedIds.includes(booking.courtId)
      && booking.date >= todayISO()
      && ['pending', 'awaiting_payment', 'payment_submitted', 'needs_correction', 'booked'].includes(booking.status));
    if (unresolvedBookings.length > 0) {
      setModal(null);
      setView('schedule');
      setScheduleDate(unresolvedBookings[0].date);
      setToast(`برای بایگانی این زمین، ابتدا ${formatNumber(unresolvedBookings.length)} درخواست یا رزرو آینده را تعیین‌تکلیف کن؛ سابقهٔ آن‌ها بعداً حفظ می‌شود.`);
      return;
    }
    if (isDemo) {
      setDemoData((current) => ({ ...current, settings: input }));
      setModal(null);
      setToast('تنظیمات نمایشی ذخیره شد.');
      return;
    }
    if (!db || !user || !clubId) return;
    try {
      const clubRef = doc(db, 'clubs', clubId);
      const inviteRef = doc(db, 'clubInvites', clubId);
      await runTransaction(db, async (transaction) => {
        const [clubSnapshot, inviteSnapshot] = await Promise.all([
          transaction.get(clubRef),
          transaction.get(inviteRef),
        ]);
        if (!clubSnapshot.exists() || !inviteSnapshot.exists()) throw new Error('اطلاعات باشگاه یا کد عضویت پیدا نشد.');
        transaction.update(clubRef, {
          clubName: input.clubName,
          defaultSessionPriceToman: input.defaultSessionPriceToman,
          publicScheduleEnabled: input.publicScheduleEnabled,
          ownerPhone: input.ownerPhone,
          courts: input.courts,
          archivedCourts: input.archivedCourts,
          updatedAt: serverTimestamp(),
        });
        transaction.update(inviteRef, { clubName: input.clubName, updatedAt: serverTimestamp() });
      });
      setModal(null);
      setToast('تنظیمات حساب ذخیره شد.');
    } catch (error) {
      setToast(getFriendlyError(error));
    }
  }

  if (!isDemo && !authResolved) {
    return <FullScreenLoader label="در حال بررسی ورود…" />;
  }

  if (!isDemo && !user) {
    return (
      <AuthScreen
        onSubmit={handleAuthSubmit}
        onGoogleSignIn={handleGoogleSignIn}
        busy={authBusy}
        error={authError}
        onSetup={() => setModal({ type: 'firebase' })}
        modal={modal}
        onCloseModal={() => setModal(null)}
      />
    );
  }

  if (!isDemo && user && !membershipsResolved) {
    return <FullScreenLoader label="در حال دریافت عضویت‌های باشگاه…" />;
  }

  if (!isDemo && user && (!activeMembership || showClubHub)) {
    return (
      <ClubHub
        email={user.email ?? ''}
        memberships={memberships}
        activeClubId={activeMembership?.clubId ?? ''}
        busy={clubHubBusy}
        error={clubHubError}
        googleLinked={user.providerData.some((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID)}
        linkBusy={authBusy}
        onLinkGoogle={handleGoogleLink}
        onSignOut={handleSignOut}
        onSelect={activateClub}
        onCreate={createClubFromHub}
        onJoin={joinClubFromHub}
        onClose={activeMembership ? () => setShowClubHub(false) : undefined}
      />
    );
  }

  const activityItems = [
    ...payments.map((payment) => ({ kind: 'payment' as const, date: payment.paidAt, createdAt: payment.createdAt, item: payment })),
    ...sessions.map((session) => ({ kind: 'session' as const, date: session.date, createdAt: session.createdAt, item: session })),
  ].sort((a, b) => {
    const dateDiff = new Date(`${b.date.slice(0, 10)}T12:00:00`).getTime() - new Date(`${a.date.slice(0, 10)}T12:00:00`).getTime();
    return dateDiff || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const visibleItems = tab === 'payments'
    ? activityItems.filter((item) => item.kind === 'payment')
    : tab === 'sessions'
      ? activityItems.filter((item) => item.kind === 'session')
      : activityItems;
  const activeBooking = modal?.type === 'bookingConversation' || modal?.type === 'bookingReview'
    ? bookings.find((booking) => booking.id === modal.booking.id) ?? modal.booking
    : undefined;

  return (
    <ActiveClubIdContext.Provider value={clubId}>
    <div className="app-shell" dir="rtl">
      <Header
        role={currentRole}
        email={isDemo ? (demoRole === 'owner' ? 'صاحب باشگاه (نمایشی)' : 'بازیکن (نمایشی)') : user?.email ?? ''}
        memberships={memberships}
        activeClubId={clubId}
        clubName={settings.clubName}
        onSelectClub={activateClub}
        onManageClubs={() => { setClubHubError(''); setShowClubHub(true); }}
        demo={isDemo}
        dataLoading={dataLoading}
        dataError={dataError}
        onSignOut={isDemo ? undefined : handleSignOut}
        onLinkGoogle={isDemo ? undefined : handleGoogleLink}
        googleLinked={Boolean(user?.providerData.some((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID))}
        linkBusy={authBusy}
        onDemoRoleChange={setDemoRole}
        notifications={userNotifications}
        browserNotificationPermission={browserNotificationPermission}
        onOpenNotification={openNotification}
        onRequestBrowserNotifications={() => void enableBrowserNotifications()}
      />

      <main className="page-wrap">
        {isDemo && (
          <div className="demo-banner" role="status">
            <div className="demo-banner-icon"><Info size={18} /></div>
            <div>
              <strong>پیش‌نمایش محلی — هنوز به Firebase وصل نیست</strong>
              <span>اطلاعات این حالت فقط در همین مرورگر ذخیره می‌شود و صاحب باشگاه آن را نمی‌بیند.</span>
            </div>
            <button className="banner-action" onClick={() => setModal({ type: 'firebase' })}>تنظیم اتصال Firebase</button>
          </div>
        )}

        {!isDemo && dataError && (
          <div className="error-banner" role="alert">
            <CircleAlert size={19} />
            <div><strong>اتصال به اطلاعات حساب مشکل دارد</strong><span>{dataError}</span></div>
            <button className="icon-button" onClick={() => window.location.reload()} aria-label="تلاش دوباره"><RefreshCcw size={17} /></button>
          </div>
        )}

        <section className="page-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /> حساب و برنامهٔ باشگاه ورزشی</div>
            <h1>حساب سانس</h1>
            <p>پرداخت‌ها، سانس‌ها و ماندهٔ حسابت؛ شفاف و یک‌جا.</p>
          </div>
          <div className="intro-actions">
            {currentRole === 'owner' && (
              <button className="button button-quiet" onClick={() => setModal({ type: 'settings' })}>
                <Settings2 size={17} /> تنظیمات حساب
              </button>
            )}
            <button className="button button-secondary" onClick={() => setModal({ type: 'session' })}>
              <CalendarDays size={17} /> ثبت سانس در حساب
            </button>
            {currentRole === 'player' && (
              <button className="button button-primary" onClick={() => setModal({ type: 'payment' })}>
                <Plus size={18} /> ثبت پرداخت
              </button>
            )}
          </div>
        </section>

        <nav className="main-nav" role="tablist" aria-label="بخش‌های حساب">
          <button className={`main-nav-item ${view === 'ledger' ? 'is-active' : ''}`} role="tab" aria-selected={view === 'ledger'} onClick={() => setView('ledger')}>
            <Wallet size={18} /> دفتر حساب
          </button>
          {(currentRole === 'owner' || settings.publicScheduleEnabled) && (
            <button className={`main-nav-item ${view === 'schedule' ? 'is-active' : ''}`} role="tab" aria-selected={view === 'schedule'} onClick={() => setView('schedule')}>
              <CalendarDays size={18} /> برنامهٔ سانس‌ها
            </button>
          )}
          {settings.archivedCourts.length > 0 && (
            <button className={`main-nav-item ${view === 'archive' ? 'is-active' : ''}`} role="tab" aria-selected={view === 'archive'} onClick={() => setView('archive')}>
              <History size={18} /> آرشیو
            </button>
          )}
        </nav>

        {view === 'ledger' ? <>
        <section className={`balance-card ${balance < 0 ? 'balance-debt' : ''}`}>
          <div className="balance-content">
            <div className="balance-label"><Wallet size={17} /> ماندهٔ حساب</div>
            <div className="balance-value">{formatToman(Math.abs(balance))}</div>
            <div className="balance-bottom">
              <span className={`balance-state ${balance < 0 ? 'state-debt' : ''}`}>
                {balance > 0 ? 'اعتبار پیش‌پرداخت' : balance < 0 ? 'بدهی به باشگاه' : 'حساب تسویه است'}
              </span>
              <span className="balance-caption">{balanceHoldToman > 0 ? `${formatToman(balanceHoldToman)} برای رزرو کنار گذاشته شده` : 'فقط پرداخت‌های تأییدشده در مانده حساب می‌شوند'}</span>
            </div>
          </div>
          <div className="balance-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-ball"><CircleDot size={44} strokeWidth={1.45} /></div>
            <span className="art-spark spark-one">✳</span>
            <span className="art-spark spark-two">✦</span>
          </div>
        </section>

        <section className="summary-grid" aria-label="خلاصه حساب">
          <SummaryCard
            icon={<Banknote size={19} />}
            tone="green"
            label="پرداخت تأییدشده"
            value={formatToman(confirmedPayments)}
            hint={`${payments.filter((payment) => payment.status === 'confirmed').length} پرداخت`}
          />
          <SummaryCard
            icon={<Activity size={19} />}
            tone="coral"
            label="هزینهٔ سانس‌ها"
            value={formatToman(chargeTotal)}
            hint={`${sessions.filter((session) => isChargeable(session.status)).length} سانس هزینه‌دار`}
          />
          <SummaryCard
            icon={<Clock3 size={19} />}
            tone="amber"
            label="در انتظار بررسی"
            value={`${formatNumber(pendingPayments.length + pendingCancellations.length)} مورد`}
            hint={`${formatToman(pendingTotal)} پرداخت · ${formatToman(pendingCancellationTotal)} لغو`}
          />
        </section>

        {currentRole === 'owner' && (pendingPayments.some((payment) => payment.status === 'pending') || pendingCancellations.length > 0) && (
          <div className="owner-tip"><ShieldCheck size={18} /><span>پرداخت‌ها و درخواست‌های لغو به‌موقع را از فهرست بررسی کن؛ لغو تا زمان تأیید در ماندهٔ نهایی محاسبه نمی‌شود.</span></div>
        )}

        <section className="ledger-card">
          <div className="ledger-heading">
            <div>
              <span className="section-kicker">ریز گردش</span>
              <h2>تاریخچهٔ حساب</h2>
            </div>
            <div className="ledger-total"><History size={17} /><span>{visibleItems.length} مورد</span></div>
          </div>

          <div className="tab-bar" role="tablist" aria-label="فیلتر گردش حساب">
            <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} label="همه" />
            <TabButton active={tab === 'payments'} onClick={() => setTab('payments')} label="پرداخت‌ها" />
            <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')} label="سانس‌ها" />
          </div>

          {dataLoading ? (
            <div className="list-loading"><LoaderCircle className="spin" size={23} /><span>در حال دریافت گردش حساب…</span></div>
          ) : visibleItems.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><ReceiptText size={24} /></div>
              <strong>هنوز موردی ثبت نشده</strong>
              <span>با ثبت اولین پرداخت یا سانس، ریزحساب اینجا نمایش داده می‌شود.</span>
            </div>
          ) : (
            <div className="activity-list">
              {visibleItems.map((entry) => entry.kind === 'payment' ? (
                <PaymentRow
                  key={`payment-${entry.item.id}`}
                  payment={entry.item}
                  role={currentRole}
                  demo={isDemo}
                  currentUid={user?.uid ?? 'demo-player'}
                  onConfirm={() => void reviewPayment(entry.item, 'confirmed')}
                  onCorrection={() => setModal({ type: 'review', payment: entry.item })}
                  onEdit={() => setModal({ type: 'payment', payment: entry.item })}
                />
              ) : (
                <SessionRow
                  key={`session-${entry.item.id}`}
                  session={entry.item}
                  role={currentRole}
                  demo={isDemo}
                  currentUid={user?.uid ?? 'demo-player'}
                  onEdit={() => setModal({ type: 'session', session: entry.item })}
                  onReview={(status) => void reviewSession(entry.item, status)}
                  onRequestCancellation={() => void requestScheduledSessionCancellation(entry.item)}
                />
              ))}
            </div>
          )}

          <div className="ledger-footnote"><Info size={15} /><span>لغو به‌موقع پس از تأیید صاحب باشگاه بدون هزینه است؛ تا قبل از بررسی در ماندهٔ نهایی حساب نمی‌شود.</span></div>
        </section>
        </> : view === 'schedule' ? (
          <ScheduleBoard
            role={currentRole}
            settings={settings}
            bookings={bookings}
            publicSchedule={publicSchedule}
            selectedDate={scheduleDate}
            onSelectDate={setScheduleDate}
            now={clockNow}
            loading={scheduleLoading}
            error={scheduleError}
            report={scheduleReport}
            onDismissReport={() => setScheduleReport('')}
            onCreate={(draft) => setModal({ type: 'booking', ...draft })}
            onRequest={(draft) => setModal({ type: 'requestBooking', ...draft })}
            onOpenConversation={(booking) => setModal({ type: 'bookingConversation', booking })}
            onReviewBooking={(booking) => setModal({ type: 'bookingReview', booking })}
            onSettings={() => setModal({ type: 'settings' })}
            onCancel={(booking) => void cancelBooking(booking)}
          />
        ) : (
          <BookingArchiveView
            role={currentRole}
            settings={settings}
            bookings={bookings}
            onOpenConversation={(booking) => setModal({ type: 'bookingConversation', booking })}
          />
        )}

        <footer className="page-footer">
          <span>سانس‌یار · حساب باشگاه ورزشی</span>
          <span>مبالغ به تومان · نسخهٔ آزمایشی</span>
        </footer>
      </main>

      {modal?.type === 'firebase' && <FirebaseSetupModal onClose={() => setModal(null)} />}
      {modal?.type === 'payment' && (
        <PaymentModal
          payment={modal.payment}
          onClose={() => setModal(null)}
          onSubmit={(input) => void savePayment(input, modal.payment)}
        />
      )}
      {modal?.type === 'session' && (
        <SessionModal
          session={modal.session}
          defaultPrice={settings.defaultSessionPriceToman}
          role={currentRole}
          onClose={() => setModal(null)}
          onSubmit={(input) => void saveSession(input, modal.session)}
        />
      )}
      {modal?.type === 'booking' && currentRole === 'owner' && (
        <BookingModal
          draft={modal}
          courts={settings.courts}
          members={remoteClubMembers.filter((member) => member.active && member.role === 'player')}
          defaultPrice={settings.defaultSessionPriceToman}
          busy={bookingSaving}
          onClose={() => setModal(null)}
          onSubmit={(input) => void saveBooking(input)}
        />
      )}
      {modal?.type === 'requestBooking' && currentRole === 'player' && (
        <RequestBookingModal
          draft={modal}
          courts={settings.courts}
          defaultPrice={settings.defaultSessionPriceToman}
          busy={bookingSaving}
          onClose={() => setModal(null)}
          onSubmit={(input) => void submitBookingRequest(modal, input)}
        />
      )}
      {modal?.type === 'bookingConversation' && activeBooking && (
        <BookingConversationModal
          booking={activeBooking}
          role={currentRole}
          demo={isDemo}
          isArchived={settings.archivedCourts.some((court) => court.id === activeBooking.courtId)}
          userUid={user?.uid ?? (currentRole === 'owner' ? 'demo-owner' : 'demo-player')}
          ownerPhone={settings.ownerPhone}
          demoMessages={demoData.bookingMessages}
          firestore={db}
          storage={storage}
          busy={bookingSaving}
          now={clockNow}
          availableBalanceToman={Math.max(0, balance)}
          onClose={() => setModal(null)}
          onSend={(body) => void sendBookingMessage(activeBooking, body)}
          onApplyBalance={() => void applyBookingBalance(activeBooking)}
          onSubmitPayment={(body, file) => void submitBookingPayment(activeBooking, body, file)}
        />
      )}
      {modal?.type === 'bookingReview' && activeBooking && currentRole === 'owner' && (
        <BookingReviewModal
          booking={activeBooking}
          busy={bookingSaving}
          onClose={() => setModal(null)}
          onOpenConversation={() => setModal({ type: 'bookingConversation', booking: activeBooking })}
          now={clockNow}
          onInitialApprove={() => void reviewBooking(activeBooking, 'initial_approve')}
          onInitialReject={(reason) => void reviewBooking(activeBooking, 'initial_reject', reason)}
          onFinalApprove={() => void reviewBooking(activeBooking, 'final_approve')}
          onRequestCorrection={(reason) => void reviewBooking(activeBooking, 'correction', reason)}
          onFinalReject={(reason) => void reviewBooking(activeBooking, 'final_reject', reason)}
        />
      )}
      {modal?.type === 'review' && (
        <ReviewModal
          payment={modal.payment}
          onClose={() => setModal(null)}
          onSubmit={(note) => void reviewPayment(modal.payment, 'correction_requested', note)}
        />
      )}
      {modal?.type === 'settings' && (
        <SettingsModal settings={settings} actorUid={user?.uid ?? (currentRole === 'owner' ? 'demo-owner' : '')} onClose={() => setModal(null)} onSubmit={(value) => void saveSettings(value)} />
      )}

      {toast && <div className="toast"><CheckCircle2 size={18} /><span>{toast}</span></div>}
    </div>
    </ActiveClubIdContext.Provider>
  );
}

function BookingArchiveView({ role, settings, bookings, onOpenConversation }: {
  role: UserRole;
  settings: ClubSettings;
  bookings: BookingRecord[];
  onOpenConversation: (booking: BookingRecord) => void;
}) {
  const [courtId, setCourtId] = useState('all');
  const [search, setSearch] = useState('');
  const archivedIds = new Set(settings.archivedCourts.map((court) => court.id));
  const needle = search.trim().toLocaleLowerCase();
  const archivedBookings = bookings
    .filter((booking) => archivedIds.has(booking.courtId))
    .filter((booking) => courtId === 'all' || booking.courtId === courtId)
    .filter((booking) => !needle || [booking.courtName, booking.bookedForName, booking.createdByEmail, settings.clubName].some((value) => (value ?? '').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return (
    <section className="booking-archive-screen">
      <div className="booking-archive-screen-heading"><div><span className="section-kicker">سابقهٔ نگهداری‌شده</span><h2>آرشیو زمین‌ها و رزروها</h2><p>باشگاه: {settings.clubName} · سابقه پاک نشده است.</p></div><History size={24} /></div>
      <div className="archive-access-note"><ShieldCheck size={16} /><span>مالک، سوابق باشگاه خودش را می‌بیند؛ بازیکن فقط سوابق رزروهای خودش را می‌بیند.</span></div>
      <div className="archive-filter-row">
        <div className="form-field"><label className="field-label" htmlFor="archive-court-filter">زمین بایگانی‌شده</label><select id="archive-court-filter" className="text-input select-input" value={courtId} onChange={(event) => setCourtId(event.target.value)}><option value="all">همهٔ زمین‌ها</option>{settings.archivedCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></div>
        {role === 'owner' && <div className="form-field"><label className="field-label" htmlFor="archive-search">جست‌وجوی رزروکننده</label><input id="archive-search" className="text-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام بازیکن، ایمیل یا باشگاه" /></div>}
      </div>
      <div className="booking-archive-screen-list">
        {archivedBookings.length === 0 ? <div className="empty-state"><div className="empty-icon"><History size={23} /></div><strong>سابقه‌ای پیدا نشد</strong><span>رزروهای زمین بایگانی‌شده در این حساب اینجا می‌مانند.</span></div> : archivedBookings.map((booking) => {
          const court = settings.archivedCourts.find((item) => item.id === booking.courtId);
          return <article className="booking-archive-screen-item" key={booking.id}>
            <div className="booking-archive-screen-main">
              <div className="booking-archive-screen-title"><strong>{court?.name ?? booking.courtName} · {formatDate(booking.date)} · {formatTimeRange(booking.startTime, booking.endTime)}</strong><span className={`booking-private-status status-${booking.status}`}>{bookingStatusLabel(booking.status)}</span></div>
              {role === 'owner' && <span className="booking-archive-player">{booking.bookedForName || 'نام ثبت نشده'}{booking.createdByEmail ? ` · ${booking.createdByEmail}` : ''}</span>}
              <span className="booking-archive-record-club">{settings.clubName} · {formatToman(booking.priceToman)}</span>
              {(booking.rejectionReason || booking.correctionNote || booking.expiryReason) && <small>{booking.correctionNote || booking.rejectionReason || booking.expiryReason}</small>}
            </div>
            <button className="button button-quiet" onClick={() => onOpenConversation(booking)}><MessageCircle size={15} /> پیام‌ها و رسیدها</button>
          </article>;
        })}
      </div>
    </section>
  );
}

function Header({
  role,
  email,
  memberships,
  activeClubId,
  clubName,
  onSelectClub,
  onManageClubs,
  demo,
  dataLoading,
  dataError,
  onSignOut,
  onLinkGoogle,
  googleLinked = false,
  linkBusy = false,
  onDemoRoleChange,
  notifications,
  browserNotificationPermission,
  onOpenNotification,
  onRequestBrowserNotifications,
}: {
  role: UserRole;
  email: string;
  memberships: ClubMembershipRecord[];
  activeClubId: string;
  clubName: string;
  onSelectClub: (clubId: string) => void;
  onManageClubs: () => void;
  demo: boolean;
  dataLoading: boolean;
  dataError: string;
  onSignOut?: () => void;
  onLinkGoogle?: () => void;
  googleLinked?: boolean;
  linkBusy?: boolean;
  onDemoRoleChange: (role: UserRole) => void;
  notifications: AppNotificationRecord[];
  browserNotificationPermission: string;
  onOpenNotification: (notification: AppNotificationRecord) => void;
  onRequestBrowserNotifications: () => void;
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const statusLabel = demo ? 'حالت نمایشی' : dataError ? 'نیازمند بررسی' : dataLoading ? 'در حال اتصال' : 'Firebase متصل';
  const [clubCodeCopied, setClubCodeCopied] = useState(false);

  async function copyClubCode() {
    try {
      await navigator.clipboard.writeText(activeClubId);
      setClubCodeCopied(true);
      window.setTimeout(() => setClubCodeCopied(false), 1800);
    } catch {
      setClubCodeCopied(false);
    }
  }
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand-lockup">
          <div className="brand-mark"><CircleDot size={25} strokeWidth={1.9} /></div>
          <div><strong>سانس‌یار</strong><span>حساب شفاف، بازی راحت</span></div>
        </div>
        <div className="topbar-right">
          <div className={`connection-pill ${demo ? 'connection-demo' : dataError ? 'connection-error' : ''}`}>
            <span className="connection-dot" />{statusLabel}
          </div>
          {!demo && memberships.length > 0 && (
            <div className="club-switcher">
              <label className="sr-only" htmlFor="active-club-select">باشگاه فعال</label>
              <select id="active-club-select" className="club-switch-select" value={activeClubId} onChange={(event) => onSelectClub(event.target.value)}>
                {memberships.map((membership) => <option key={membership.clubId} value={membership.clubId}>{membership.clubName} · {membership.role === 'owner' ? 'مالک' : 'بازیکن'}</option>)}
              </select>
              <button className="club-hub-button" onClick={onManageClubs} title="مدیریت باشگاه‌ها">باشگاه‌ها</button>
              <div className="club-share-code" title={activeClubId}>
                <span>کد عضویت</span><code>{activeClubId.slice(0, 7)}…</code>
                <button onClick={() => void copyClubCode()} aria-label="کپی کد عضویت">{clubCodeCopied ? 'کپی شد' : 'کپی'}</button>
              </div>
              <small className="club-active-name">{clubName}</small>
            </div>
          )}
          <div className="notification-control">
            <button className="notification-bell" aria-label={`اعلان‌ها${unreadCount ? `، ${unreadCount} خوانده‌نشده` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
              <Bell size={18} />{unreadCount > 0 && <span className="notification-count">{formatNumber(unreadCount)}</span>}
            </button>
            {notificationsOpen && (
              <section className="notification-popover" aria-label="اعلان‌ها">
                <div className="notification-popover-heading"><div><strong>اعلان‌های شما</strong><span>{role === 'owner' ? 'باشگاه' : 'بازیکن'}</span></div><button className="icon-button" aria-label="بستن اعلان‌ها" onClick={() => setNotificationsOpen(false)}><X size={15} /></button></div>
                {browserNotificationPermission !== 'unsupported' && (
                  <button className="notification-permission-button" onClick={onRequestBrowserNotifications}><Bell size={14} /> {browserNotificationPermission === 'granted' ? 'تنظیم اعلان‌های پس‌زمینه' : 'فعال‌سازی اعلان مرورگر'}</button>
                )}
                <div className="notification-list">
                  {notifications.length === 0 ? <div className="notification-empty">هنوز اعلانی نداری.</div> : notifications.map((notification) => {
                    const date = new Date(notification.createdAt);
                    const timeLabel = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
                    return <button className={`notification-item ${notification.readAt ? '' : 'is-unread'}`} key={notification.id} onClick={() => { onOpenNotification(notification); setNotificationsOpen(false); }}>
                      <span className="notification-item-dot" />
                      <span className="notification-item-copy"><strong>{notification.title}</strong><span>{notification.body}</span><time>{timeLabel}</time></span>
                    </button>;
                  })}
                </div>
              </section>
            )}
          </div>
          {demo ? (
            <div className="role-switch" aria-label="تغییر نقش نمایشی">
              <button className={role === 'player' ? 'selected' : ''} onClick={() => onDemoRoleChange('player')}>بازیکن</button>
              <button className={role === 'owner' ? 'selected' : ''} onClick={() => onDemoRoleChange('owner')}>صاحب باشگاه</button>
            </div>
          ) : (
            <div className="profile-menu">
              <div className="profile-avatar"><UserRound size={17} /></div>
              <div className="profile-copy"><strong>{role === 'owner' ? 'صاحب باشگاه' : 'بازیکن'}</strong><span dir="ltr">{email}</span></div>
              {!googleLinked && onLinkGoogle && <button className="signout-button profile-google-link" onClick={onLinkGoogle} disabled={linkBusy} title="پیوند Google به همین حساب" aria-label="پیوند حساب Google">{linkBusy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}</button>}
              <button className="signout-button" onClick={onSignOut} title="خروج" aria-label="خروج"><LogOut size={17} /></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function SummaryCard({ icon, tone, label, value, hint }: { icon: ReactNode; tone: string; label: string; value: string; hint: string }) {
  return (
    <article className="summary-card">
      <div className={`summary-icon ${tone}`}>{icon}</div>
      <div className="summary-copy"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>
      <span className="summary-accent" />
    </article>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button className={`tab-button ${active ? 'active' : ''}`} role="tab" aria-selected={active} onClick={onClick}>{label}</button>;
}

function PaymentRow({
  payment,
  role,
  demo,
  currentUid,
  onConfirm,
  onCorrection,
  onEdit,
}: {
  payment: PaymentRecord;
  role: UserRole;
  demo: boolean;
  currentUid: string;
  onConfirm: () => void;
  onCorrection: () => void;
  onEdit: () => void;
}) {
  const isOwner = role === 'owner';
  const canCorrect = role === 'player' && payment.status === 'correction_requested' && (demo || payment.createdByUid === currentUid);
  return (
    <article className="activity-row">
      <div className="row-icon payment-icon"><ArrowDownLeft size={19} /></div>
      <div className="row-main">
        <div className="row-title-line">
          <strong>پرداخت</strong>
          <StatusBadge status={payment.status} />
        </div>
        <div className="row-description">
          <span>{formatDate(payment.paidAt)}</span>
          {payment.note && <><i /> <span>{payment.note}</span></>}
        </div>
        {payment.reviewNote && payment.status === 'correction_requested' && (
          <div className="review-note"><Info size={14} /><span>یادداشت باشگاه: {payment.reviewNote}</span></div>
        )}
        {payment.history.length > 0 && (
          <div className="revision-note"><History size={13} /><span>{payment.history.length} اصلاح در سابقه ثبت شده</span></div>
        )}
      </div>
      <div className="row-amount payment-amount">
        <strong>{formatToman(payment.amountToman)}</strong>
        <span>{payment.status === 'confirmed' ? 'به اعتبار اضافه شد' : 'در مانده منظور نشده'}</span>
      </div>
      <div className="row-actions">
        {isOwner && payment.status === 'pending' && (
          <>
            <button className="row-action approve" onClick={onConfirm}><Check size={15} /> تأیید</button>
            <button className="row-action correct" onClick={onCorrection}><Pencil size={14} /> اصلاح</button>
          </>
        )}
        {canCorrect && <button className="row-action correct" onClick={onEdit}><Pencil size={14} /> اصلاح و ارسال</button>}
      </div>
    </article>
  );
}

function SessionRow({
  session,
  role,
  demo,
  currentUid,
  onEdit,
  onReview,
  onRequestCancellation,
}: {
  session: SessionRecord;
  role: UserRole;
  demo: boolean;
  currentUid: string;
  onEdit: () => void;
  onReview: (status: 'cancelled_on_time' | 'late_cancel') => void;
  onRequestCancellation: () => void;
}) {
  const chargeable = isChargeable(session.status);
  const cancellationPending = session.status === 'cancelled_on_time_pending';
  const scheduled = session.status === 'scheduled';
  const cancelledByClub = session.status === 'cancelled_by_club';
  const canEdit = role === 'owner' || (!session.bookingId && (demo || session.createdByUid === currentUid));
  const statusLabel = role === 'owner' && session.status === 'attended'
    ? 'سانس برگزار شد'
    : role === 'owner' && session.status === 'no_show'
      ? 'بازیکن حاضر نشد'
      : SESSION_STATUS_LABEL[session.status];
  return (
    <article className="activity-row">
      <div className="row-icon session-icon"><CalendarDays size={18} /></div>
      <div className="row-main">
        <div className="row-title-line">
          <strong>سانس ورزشی</strong>
          <span className={`session-status session-${session.status}`}>{statusLabel}</span>
        </div>
        <div className="row-description">
          <span>{formatDate(session.date)}</span>
          {session.note && <><i /> <span>{session.note}</span></>}
        </div>
        {session.reviewNote && <div className="review-note"><ShieldCheck size={14} /><span>بررسی باشگاه: {session.reviewNote}</span></div>}
      </div>
      <div className={`row-amount ${cancellationPending ? 'pending-session-amount' : chargeable ? 'session-amount' : 'free-amount'}`}>
        <strong>{cancellationPending ? formatToman(session.priceToman) : chargeable ? `− ${formatToman(session.priceToman)}` : 'بدون هزینه'}</strong>
        <span>{cancellationPending ? 'مبلغ احتمالی؛ هنوز محاسبه نشده' : chargeable ? 'از اعتبار کم شد / به بدهی اضافه شد' : scheduled ? 'هزینه پس از ثبت نتیجهٔ سانس' : cancelledByClub ? 'لغو از سوی باشگاه' : 'لغو به‌موقع؛ بدون هزینه'}</span>
      </div>
      <div className="row-actions">
        {role === 'owner' && cancellationPending && (
          <>
            <button className="row-action approve" onClick={() => onReview('cancelled_on_time')}><Check size={14} /> تأیید لغو</button>
            <button className="row-action correct" onClick={() => onReview('late_cancel')}><CircleAlert size={14} /> هزینه دارد</button>
          </>
        )}
        {role === 'player' && session.bookingId && scheduled && (
          <button className="row-action correct" onClick={onRequestCancellation}>درخواست لغو</button>
        )}
        {canEdit && (
          <button className="row-action edit-session" onClick={onEdit}>
            {session.bookingId && scheduled ? <CheckCircle2 size={14} /> : <Pencil size={14} />}
            {session.bookingId && scheduled ? 'ثبت نتیجه' : 'ویرایش'}
          </button>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const Icon = status === 'confirmed' ? CheckCircle2 : status === 'correction_requested' ? CircleAlert : Clock3;
  return <span className={`status-badge payment-${status}`}><Icon size={13} />{PAYMENT_STATUS_LABEL[status]}</span>;
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M43.6 24.5c0-1.5-.1-2.9-.4-4.3H24v8.1h11.1c-.5 2.6-2 4.8-4.3 6.3v5.3h6.9c4-3.7 6.3-9.1 6.3-15.4z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.9-5.3c-1.9 1.3-4.2 2.1-6.6 2.1-5.1 0-9.4-3.4-10.9-8H6v5.4C9.4 39.7 16.2 44 24 44z" />
      <path fill="#FBBC05" d="M13.1 27.9c-.4-1.2-.7-2.5-.7-3.9s.3-2.7.7-3.9v-5.4H6C4.7 17.3 4 20.5 4 24s.7 6.7 2 9.3l7.1-5.4z" />
      <path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3l5.8-5.8C34.1 6.1 29.5 4 24 4 16.2 4 9.4 8.3 6 14.7l7.1 5.4c1.5-4.6 5.8-8 10.9-8z" />
    </svg>
  );
}

function AuthScreen({
  onSubmit,
  onGoogleSignIn,
  busy,
  error,
  onSetup,
  modal,
  onCloseModal,
}: {
  onSubmit: (email: string, password: string, createAccount: boolean) => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
  busy: boolean;
  error: string;
  onSetup: () => void;
  modal: AppModal;
  onCloseModal: () => void;
}) {
  const [createAccount, setCreateAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const isSetupIncomplete = !hasFirebaseConfig;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    if (!email.trim() || !password) {
      setLocalError('ایمیل و رمز عبور را وارد کن.');
      return;
    }
    await onSubmit(email, password, createAccount);
  }

  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-side-art">
        <div className="auth-art-logo"><CircleDot size={32} /></div>
        <span className="auth-orbit auth-orbit-a" /><span className="auth-orbit auth-orbit-b" />
        <div className="auth-art-copy"><span>سانس‌یار</span><h1>حساب روشن،<br />بازی بی‌دغدغه.</h1><p>باشگاه‌ها، رزروها و حساب‌های مستقل را در یک حساب مدیریت کن.</p></div>
        <div className="auth-art-foot"><ShieldCheck size={16} /> عضویت پویا بر اساس حساب و باشگاه</div>
      </div>
      <div className="auth-form-side">
        <div className="auth-card">
          <div className="auth-mobile-brand"><CircleDot size={24} /> سانس‌یار</div>
          <span className="section-kicker">دفتر حساب مشترک</span>
          <h2>{createAccount ? 'ساخت حساب' : 'خوش برگشتی'}</h2>
          <p className="auth-description">با حساب Google یا ایمیل و رمز عبور وارد شو؛ سپس باشگاه بساز یا با کد عضویت بگیر.</p>
          {isSetupIncomplete && (
            <div className="auth-setup-notice"><Info size={17} /><span>اتصال Firebase کامل نیست.</span><button onClick={onSetup}>تنظیم اتصال</button></div>
          )}
          <button type="button" className="button auth-google-button" onClick={() => void onGoogleSignIn()} disabled={busy || isSetupIncomplete}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <GoogleMark />}
            {busy ? 'در حال اتصال…' : 'ادامه با Google'}
          </button>
          <div className="auth-divider"><span>یا با ایمیل و رمز عبور</span></div>
          <form onSubmit={submit} className="auth-form">
            <label className="field-label">ایمیل</label>
            <input className="text-input" type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
            <label className="field-label">رمز عبور</label>
            <input className="text-input" type="password" dir="ltr" autoComplete={createAccount ? 'new-password' : 'current-password'} placeholder="حداقل ۶ نویسه" value={password} onChange={(event) => setPassword(event.target.value)} />
            {(error || localError) && <div className="form-error"><CircleAlert size={16} />{localError || error}</div>}
            <button className="button button-primary auth-submit" disabled={busy || isSetupIncomplete}>
              {busy ? <LoaderCircle className="spin" size={18} /> : createAccount ? <UserRound size={17} /> : <ShieldCheck size={17} />}
              {busy ? 'لطفاً صبر کن…' : createAccount ? 'ساخت حساب' : 'ورود به حساب'}
            </button>
          </form>
          <div className="auth-toggle">
            {createAccount ? 'حساب داری؟' : 'بار اولته؟'}
            <button onClick={() => { setCreateAccount((value) => !value); setLocalError(''); }}>{createAccount ? 'وارد شو' : 'حساب بساز'}</button>
          </div>
          <div className="auth-note"><LockKeyholeIcon /><span>نقش مالک یا بازیکن از عضویت UID در هر باشگاه به‌دست می‌آید؛ ایمیل ثابت یا محدودیت تعداد عضو وجود ندارد.</span></div>
          <div className="auth-config-row"><button onClick={onSetup}>ویرایش تنظیمات Firebase</button></div>
        </div>
      </div>
      {modal?.type === 'firebase' && <FirebaseSetupModal onClose={onCloseModal} />}
    </div>
  );
}

function LockKeyholeIcon() {
  return <ShieldCheck size={16} />;
}

function ClubHub({ email, memberships, activeClubId, busy, error, googleLinked, linkBusy, onLinkGoogle, onSignOut, onSelect, onCreate, onJoin, onClose }: {
  email: string;
  memberships: ClubMembershipRecord[];
  activeClubId: string;
  busy: boolean;
  error: string;
  googleLinked: boolean;
  linkBusy: boolean;
  onLinkGoogle: () => void;
  onSignOut: () => void;
  onSelect: (clubId: string) => void;
  onCreate: (name: string) => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onClose?: () => void;
}) {
  const [clubName, setClubName] = useState('');
  const [clubCode, setClubCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onCreate(clubName);
  }

  function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onJoin(clubCode);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setCopiedCode(false);
    }
  }

  return (
    <div className="club-hub-page" dir="rtl">
      <header className="club-hub-topbar">
        <div className="brand-lockup"><div className="brand-mark"><CircleDot size={25} /></div><div><strong>سانس‌یار</strong><span>فضای باشگاه‌های شما</span></div></div>
        <div className="club-hub-account"><span dir="ltr">{email}</span>{googleLinked ? <span className="auth-provider-connected"><CheckCircle2 size={14} /> Google متصل</span> : <button className="button button-quiet auth-link-button" onClick={onLinkGoogle} disabled={linkBusy}><Link2 size={15} />{linkBusy ? 'در حال اتصال…' : 'پیوند Google'}</button>}{onClose && <button className="button button-quiet" onClick={onClose}>بازگشت به باشگاه</button>}<button className="signout-button" onClick={onSignOut} aria-label="خروج" title="خروج"><LogOut size={17} /></button></div>
      </header>
      <main className="club-hub-content">
        <section className="club-hub-heading"><span className="section-kicker">عضویت بر اساس حساب کاربری</span><h1>{memberships.length ? 'باشگاه فعال را انتخاب کن' : 'به یک باشگاه بپیوند یا باشگاهت را بساز'}</h1><p>حساب شما می‌تواند عضو هر تعداد باشگاه باشد. گردش مالی و رزروهای هر باشگاه مستقل نگهداری می‌شود.</p></section>
        {memberships.length > 0 && <section className="club-hub-memberships" aria-label="باشگاه‌های عضو‌شده">
          {memberships.map((membership) => <article className={`club-hub-membership ${membership.clubId === activeClubId ? 'is-active' : ''}`} key={membership.clubId}>
            <div className="club-hub-membership-icon"><CircleDot size={20} /></div>
            <div className="club-hub-membership-copy"><strong>{membership.clubName}</strong><span>{membership.role === 'owner' ? 'مالک باشگاه' : 'عضو / بازیکن'} · کد: <code>{membership.clubId}</code></span></div>
            <button className="button button-secondary" onClick={() => onSelect(membership.clubId)}>{membership.clubId === activeClubId ? 'باشگاه فعال' : 'انتخاب'}</button>
            {membership.role === 'owner' && <button className="club-hub-copy" onClick={() => void copyCode(membership.clubId)}>{copiedCode ? 'کپی شد' : 'کپی کد دعوت'}</button>}
          </article>)}
        </section>}
        <section className="club-hub-actions">
          <form className="club-hub-card" onSubmit={submitCreate}>
            <div className="club-hub-card-icon"><Plus size={20} /></div><span className="section-kicker">برای مالک یا مدیر</span><h2>ساخت باشگاه جدید</h2><p>باشگاه جدید شناسهٔ عضویت منحصربه‌فرد می‌گیرد؛ بعد می‌توانی کدش را با اعضا به‌اشتراک بگذاری.</p>
            <label className="field-label" htmlFor="new-club-name">نام باشگاه</label><input id="new-club-name" className="text-input" maxLength={100} required value={clubName} onChange={(event) => setClubName(event.target.value)} placeholder="مثلاً باشگاه محلهٔ ما" />
            <button className="button button-primary" disabled={busy || !clubName.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{busy ? 'در حال ساخت…' : 'ساخت و ورود به باشگاه'}</button>
          </form>
          <form className="club-hub-card" onSubmit={submitJoin}>
            <div className="club-hub-card-icon"><UserRound size={20} /></div><span className="section-kicker">برای بازیکن یا مالک</span><h2>عضویت با کد باشگاه</h2><p>برای پیوستن، کد دعوت را از مالک بگیر. باشگاه نسخهٔ قبلی باید ابتدا دسترسی UIDمحور و کد دعوت داشته باشد.</p>
            <label className="field-label" htmlFor="club-join-code">کد عضویت</label><input id="club-join-code" className="text-input" dir="ltr" autoComplete="off" value={clubCode} onChange={(event) => setClubCode(event.target.value)} placeholder="شناسهٔ باشگاه" />
            <button className="button button-secondary" disabled={busy || !clubCode.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <UserRound size={17} />}{busy ? 'در حال بررسی…' : 'عضویت / انتخاب باشگاه'}</button>
          </form>
        </section>
        {error && <div className="form-error club-hub-error"><CircleAlert size={16} />{error}</div>}
        <div className="club-hub-security"><ShieldCheck size={17} /><span>دسترسی و داده‌ها در Firestore بر اساس UID و عضویت همان باشگاه کنترل می‌شوند؛ ایمیل به‌تنهایی نقش مالک یا بازیکن را تعیین نمی‌کند.</span></div>
      </main>
    </div>
  );
}

function FirebaseSetupModal({ onClose }: { onClose: () => void }) {
  const current = getCurrentFirebaseSettings();
  const [draft, setDraft] = useState({
    apiKey: String(current.firebase.apiKey ?? ''),
    authDomain: String(current.firebase.authDomain ?? ''),
    projectId: String(current.firebase.projectId ?? ''),
    appId: String(current.firebase.appId ?? ''),
    messagingSenderId: String(current.firebase.messagingSenderId ?? ''),
    storageBucket: String(current.firebase.storageBucket ?? ''),
    vapidKey: current.vapidKey ?? '',
  });
  const [error, setError] = useState('');

  function update(key: keyof typeof draft, value: string) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.apiKey.trim() || !draft.authDomain.trim() || !draft.projectId.trim() || !draft.appId.trim()) {
      setError('Firebase Web App از کنسول باید این چهار مقدار را داشته باشد: apiKey، authDomain، projectId و appId.');
      return;
    }
    const settings: FirebaseLocalSettings = {
      firebase: {
        apiKey: draft.apiKey.trim(),
        authDomain: draft.authDomain.trim(),
        projectId: draft.projectId.trim(),
        appId: draft.appId.trim(),
        messagingSenderId: draft.messagingSenderId.trim() || undefined,
        storageBucket: draft.storageBucket.trim() || undefined,
      },
      vapidKey: draft.vapidKey.trim(),
    };
    saveFirebaseSettings(settings);
    window.location.reload();
  }

  return (
    <ModalFrame title="اتصال به Firebase" subtitle="پیکربندی Web App برای Auth، Firestore و Storage" onClose={onClose} icon={<CircleDot size={20} />} wide>
      <form className="modal-form" onSubmit={submit}>
        <div className="setup-callout"><Info size={18} /><div><strong>این فرم فقط برای تنظیم همین مرورگر است.</strong><span>اطلاعات Web App محرمانه نیست، اما هیچ‌وقت Service Account یا کلید خصوصی را اینجا وارد نکن. برای انتشار عمومی بعداً متغیرهای `.env.local` را تنظیم می‌کنیم.</span></div></div>
        <div className="form-section-title"><span>۱</span><div><strong>تنظیمات Firebase Web App</strong><small>Firebase Console ← Project settings ← Your apps</small></div></div>
        <div className="form-grid">
          <Field label="Web API key" dir="ltr" value={draft.apiKey} onChange={(value) => update('apiKey', value)} placeholder="AIza…" />
          <Field label="Auth domain" dir="ltr" value={draft.authDomain} onChange={(value) => update('authDomain', value)} placeholder="project-id.firebaseapp.com" />
          <Field label="Project ID" dir="ltr" value={draft.projectId} onChange={(value) => update('projectId', value)} placeholder="project-id" />
          <Field label="App ID" dir="ltr" value={draft.appId} onChange={(value) => update('appId', value)} placeholder="1:…:web:…" />
          <Field label="Messaging sender ID (اختیاری)" dir="ltr" value={draft.messagingSenderId} onChange={(value) => update('messagingSenderId', value)} />
          <Field label="Storage bucket (برای رسید لازم است)" dir="ltr" value={draft.storageBucket} onChange={(value) => update('storageBucket', value)} placeholder="project-id.firebasestorage.app" />
          <Field label="Web Push VAPID key (برای اعلان گوشی)" dir="ltr" value={draft.vapidKey} onChange={(value) => update('vapidKey', value)} placeholder="کلید عمومی از Firebase Cloud Messaging" />
        </div>
        <div className="setup-access-note"><ShieldCheck size={17} /><span>فهرست باشگاه‌ها، نقش‌ها و سطح دسترسی از عضویت UID و قواعد منتشرشدهٔ Firestore/Storage کنترل می‌شود؛ ایمیل‌های ثابت در تنظیمات لازم نیست.</span></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="setup-footer-note"><ShieldCheck size={16} /><span>روش‌های ورود موردنیاز (Email/Password یا Google) را در Firebase فعال و Rules چندباشگاهی را منتشر کن؛ برای ارسال رسید، Storage bucket و `storage.rules` نیز لازم است.</span></div>
        <div className="modal-actions">
          <a className="button button-quiet console-link" href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">باز کردن Firebase Console</a>
          <button type="button" className="button button-secondary" onClick={onClose}>فعلاً نه</button>
          <button className="button button-primary"><Check size={17} /> ذخیره و بررسی اتصال</button>
        </div>
      </form>
    </ModalFrame>
  );
}

function PaymentModal({ payment, onClose, onSubmit }: { payment?: PaymentRecord; onClose: () => void; onSubmit: (input: PaymentInput) => void }) {
  const [amount, setAmount] = useState(payment ? String(payment.amountToman) : '');
  const [paidAt, setPaidAt] = useState(payment?.paidAt ?? todayISO());
  const [note, setNote] = useState(payment?.note ?? '');
  const [error, setError] = useState('');
  const value = parseToman(amount);
  const correcting = Boolean(payment);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value <= 0) { setError('مبلغ باید بیشتر از صفر باشد.'); return; }
    if (!paidAt) { setError('تاریخ پرداخت را وارد کن.'); return; }
    onSubmit({ amountToman: value, note: note.trim(), paidAt });
  }

  return (
    <ModalFrame title={correcting ? 'اصلاح مبلغ پرداخت' : 'ثبت پرداخت'} subtitle={correcting ? 'پس از اصلاح، پرداخت دوباره برای تأیید صاحب باشگاه می‌رود.' : 'پرداخت تا زمان تأیید صاحب باشگاه در مانده حساب نمی‌شود.'} onClose={onClose} icon={<CreditCard size={20} />}>
      <form className="modal-form" onSubmit={submit}>
        {correcting && payment?.reviewNote && <div className="correction-callout"><Info size={17} /><span>یادداشت صاحب باشگاه: {payment.reviewNote}</span></div>}
        <label className="field-label" htmlFor="payment-amount">مبلغ پرداختی <span>تومان</span></label>
        <input id="payment-amount" className="text-input amount-input" dir="ltr" inputMode="numeric" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="مثلاً ۱۰۰۰۰۰۰" />
        <div className="amount-preview"><span>مبلغ قابل ثبت</span><strong>{value > 0 ? formatToman(value) : '— تومان'}</strong></div>
        <div className="form-grid">
          <div className="form-field"><label className="field-label" htmlFor="payment-date">تاریخ پرداخت</label><input id="payment-date" className="text-input" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></div>
          <div className="form-field"><label className="field-label" htmlFor="payment-note">شرح رسید (اختیاری)</label><input id="payment-note" className="text-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثلاً کارت‌به‌کارت، ساعت ۱۸" /></div>
        </div>
        <div className="inline-hint"><ReceiptText size={15} /><span>قبل از ارسال، مبلغِ قالب‌بندی‌شده را یک بار چک کن. تصویر رسید فعلاً ذخیره نمی‌شود.</span></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>انصراف</button><button className="button button-primary"><ArrowUpRight size={17} />{correcting ? 'ارسال اصلاح برای تأیید' : 'ثبت برای تأیید صاحب باشگاه'}</button></div>
      </form>
    </ModalFrame>
  );
}

function SessionModal({ session, defaultPrice, role, onClose, onSubmit }: { session?: SessionRecord; defaultPrice: number; role: UserRole; onClose: () => void; onSubmit: (input: SessionInput) => void }) {
  const [date, setDate] = useState(session?.date ?? todayISO());
  const [price, setPrice] = useState(session ? String(session.priceToman) : defaultPrice > 0 ? String(defaultPrice) : '');
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? 'attended');
  const [note, setNote] = useState(session?.note ?? '');
  const [error, setError] = useState('');
  const value = parseToman(price);
  const canChangeStatus = (role === 'owner' || !session)
    && session?.status !== 'cancelled_on_time'
    && session?.status !== 'cancelled_by_club';
  const linkedBooking = Boolean(session?.bookingId);
  const statusOptions: Array<{ value: SessionStatus; label: string }> = [
    ...(linkedBooking ? [{ value: 'scheduled' as const, label: 'برنامه‌ریزی‌شده — تا ثبت نتیجه بدون هزینه' }] : []),
    { value: 'attended', label: role === 'owner' ? linkedBooking ? 'سانس برگزار شد — هزینه پس از ثبت نتیجه' : 'سانس برگزار شد — هزینه دارد' : linkedBooking ? 'حضور داشتم — هزینه پس از ثبت نتیجه' : 'حضور داشتم — هزینه دارد' },
    { value: 'no_show', label: role === 'owner' ? linkedBooking ? 'بازیکن حاضر نشد — هزینه پس از ثبت نتیجه' : 'بازیکن حاضر نشد — هزینه دارد' : linkedBooking ? 'غیبت — هزینه پس از ثبت نتیجه' : 'نرفتم و لغو نکردم — هزینه دارد' },
    { value: 'late_cancel', label: linkedBooking ? 'لغو دیرهنگام — هزینه دارد و سانس آزاد می‌شود' : 'لغو دیرهنگام — هزینه دارد' },
    role === 'owner'
      ? { value: 'cancelled_on_time', label: 'لغو به‌موقع — تأییدشده و بدون هزینه' }
      : { value: 'cancelled_on_time_pending', label: 'لغو به‌موقع — منتظر تأیید صاحب باشگاه' },
  ];
  if (session && !statusOptions.some((option) => option.value === session.status)) {
    statusOptions.push({ value: session.status, label: SESSION_STATUS_LABEL[session.status] });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) { setError('تاریخ سانس را انتخاب کن.'); return; }
    if (value < 0 || (value === 0 && !linkedBooking)) { setError('قیمت این سانس باید بیشتر از صفر باشد.'); return; }
    onSubmit({ date, priceToman: value, status, note: note.trim() });
  }

  return (
    <ModalFrame title={session ? 'ویرایش سانس' : 'ثبت سانس'} subtitle={linkedBooking ? 'این سانس به رزرو تأییدشده پیوند دارد؛ هزینه فقط پس از ثبت نتیجه محاسبه می‌شود.' : 'قیمت همان سانس ذخیره می‌شود و با تغییر نرخ آینده عوض نمی‌شود.'} onClose={onClose} icon={<CalendarDays size={20} />}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="form-field"><label className="field-label" htmlFor="session-date">تاریخ سانس</label><input id="session-date" className="text-input" type="date" value={date} disabled={linkedBooking} onChange={(event) => setDate(event.target.value)} /></div>
          <div className="form-field"><label className="field-label" htmlFor="session-price">هزینهٔ همین سانس <span>تومان</span></label><input id="session-price" className="text-input" dir="ltr" inputMode="numeric" value={price} disabled={linkedBooking} onChange={(event) => setPrice(event.target.value)} placeholder="مثلاً ۳۵۰۰۰۰" /><small className="field-helper">{value > 0 ? formatToman(value) : linkedBooking ? 'طبق مبلغ رزرو' : 'مبلغ را به تومان وارد کن'}</small></div>
        </div>
        <div className="form-field"><label className="field-label" htmlFor="session-status">{linkedBooking ? 'وضعیت / نتیجهٔ سانس رزروشده' : 'وضعیت سانس'}</label><select id="session-status" className="text-input select-input" value={status} disabled={!canChangeStatus} onChange={(event) => setStatus(event.target.value as SessionStatus)}>
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {linkedBooking && status === 'scheduled' && <small className="field-helper">این سانس هنوز برگزار نشده است؛ هزینه تا ثبت نتیجه وارد ماندهٔ حساب نمی‌شود.</small>}
        {session && role === 'player' && <small className="field-helper">تغییر وضعیت ثبت‌شده با تأیید صاحب باشگاه انجام می‌شود.</small>}
        {!session && role === 'player' && <small className="field-helper">لغو به‌موقع پس از تأیید صاحب باشگاه بدون هزینه خواهد بود.</small>}
        </div>
        <div className="form-field"><label className="field-label" htmlFor="session-note">یادداشت (اختیاری)</label><textarea id="session-note" className="text-input textarea-input" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثلاً سانس دوشنبه ساعت ۲۰" /></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>انصراف</button><button className="button button-primary"><CalendarDays size={17} />{session ? 'ذخیرهٔ تغییرات' : 'ثبت سانس در حساب'}</button></div>
      </form>
    </ModalFrame>
  );
}

function ReviewModal({ payment, onClose, onSubmit }: { payment: PaymentRecord; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) { setError('برای درخواست اصلاح، علت را کوتاه بنویس.'); return; }
    onSubmit(note.trim());
  }
  return (
    <ModalFrame title="درخواست اصلاح پرداخت" subtitle="پرداخت در مانده نمی‌آید تا بازیکن اصلاحش کند و دوباره تأیید شود." onClose={onClose} icon={<Pencil size={20} />}>
      <form className="modal-form" onSubmit={submit}>
        <div className="review-payment-preview"><span>مبلغ ثبت‌شده</span><strong>{formatToman(payment.amountToman)}</strong><small>{payment.note || 'بدون شرح رسید'}</small></div>
        <div className="form-field"><label className="field-label" htmlFor="review-note">علت اصلاح</label><textarea id="review-note" className="text-input textarea-input" rows={3} autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثلاً مبلغ واردشده با رسید مطابقت ندارد؛ لطفاً مبلغ را بررسی کن." /></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>انصراف</button><button className="button button-primary"><Pencil size={16} />ارسال درخواست اصلاح</button></div>
      </form>
    </ModalFrame>
  );
}

function BookingModal({ draft, courts, members, defaultPrice, busy, onClose, onSubmit }: {
  draft: BookingDraft;
  courts: CourtInfo[];
  members: ClubMembershipRecord[];
  defaultPrice: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: BookingInput) => void;
}) {
  const [sport, setSport] = useState<SportType>('volleyball');
  const [bookedForName, setBookedForName] = useState('');
  const [accountUid, setAccountUid] = useState('');
  const [note, setNote] = useState('');
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [showEndCalendar, setShowEndCalendar] = useState(false);
  const [error, setError] = useState('');
  const [courtId, setCourtId] = useState(draft.courtId);
  const selectedCourt = courts.find((court) => court.id === courtId);
  const minimumRepeatEnd = shiftISODate(draft.date, 7);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourt) { setError('ابتدا در تنظیمات یک زمین اضافه کن.'); return; }
    if (!bookedForName.trim()) { setError('نام فرد یا گروه رزروکننده را وارد کن.'); return; }
    if (timeToMinutes(draft.endTime) - timeToMinutes(draft.startTime) !== 90) { setError('این بازه با مدت ۱.۵ ساعت هماهنگ نیست.'); return; }
    if (repeatWeekly && (!repeatUntil || repeatUntil < minimumRepeatEnd)) { setError('برای تکرار هفتگی، تاریخ پایان را انتخاب کن.'); return; }
    onSubmit({
      ...draft,
      courtId,
      courtName: selectedCourt.name,
      sport,
      accountUid: accountUid || undefined,
      bookedForName: bookedForName.trim(),
      priceToman: defaultPrice,
      note: note.trim(),
      repeatWeekly,
      repeatUntil: repeatWeekly ? repeatUntil : '',
    });
  }

  return (
    <ModalFrame title="ثبت رزرو سانس" subtitle="زمان از سانس‌های پیش‌فرض ۱.۵ ساعتهٔ تقویم انتخاب شده است." onClose={onClose} icon={<CalendarDays size={20} />}>
      <form className="modal-form" onSubmit={submit}>
        <div className="booking-slot-summary">
          <CalendarDays size={19} />
          <div><span>تاریخ شمسی</span><strong>{formatJalaliDate(draft.date)}</strong></div>
          <div><span>زمان سانس</span><strong>{formatTimeRange(draft.startTime, draft.endTime)}</strong></div>
        </div>
        <div className="form-grid">
          <div className="form-field"><label className="field-label" htmlFor="booking-court">زمین</label><select id="booking-court" className="text-input select-input" value={courtId} onChange={(event) => setCourtId(event.target.value)}>{courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></div>
          <div className="form-field"><label className="field-label" htmlFor="booking-sport">ورزش</label><select id="booking-sport" className="text-input select-input" value={sport} onChange={(event) => setSport(event.target.value as SportType)}><option value="volleyball">والیبال</option><option value="futsal">فوتسال</option><option value="other">ورزش دیگر</option></select></div>
        </div>
        <div className="form-grid">
          <div className="form-field"><label className="field-label" htmlFor="booking-name">نام فرد یا گروه رزروکننده</label><input id="booking-name" className="text-input" required maxLength={100} value={bookedForName} onChange={(event) => setBookedForName(event.target.value)} placeholder="برای نمای صاحب باشگاه" /></div>
          <div className="form-field"><span className="field-label">هزینه طبق نرخ باشگاه <span>تومان</span></span><div className="text-input booking-price-readonly" aria-readonly="true">{defaultPrice > 0 ? formatToman(defaultPrice) : 'رایگان · نرخ هنوز صفر است'}</div><small className="field-helper">مبلغ از تنظیمات باشگاه می‌آید و برای این رزرو جداگانه تغییر نمی‌کند.</small></div>
        </div>
        {members.length > 0 && <div className="form-field"><label className="field-label" htmlFor="booking-account">ثبت در حساب کدام بازیکن؟ <span>اختیاری</span></label><select id="booking-account" className="text-input select-input" value={accountUid} onChange={(event) => setAccountUid(event.target.value)}><option value="">بدون اتصال به حساب بازیکن</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.email || member.uid}</option>)}</select><small className="field-helper">با انتخاب عضو، این رزرو و سانس برنامه‌ریزی‌شده به حساب همان UID متصل می‌شوند؛ هزینه پس از ثبت نتیجه اعمال می‌شود.</small></div>}
        <label className={`recurrence-toggle ${repeatWeekly ? 'is-checked' : ''}`}>
          <input type="checkbox" checked={repeatWeekly} onChange={(event) => { setRepeatWeekly(event.target.checked); setError(''); }} />
          <span className="recurrence-checkbox" aria-hidden="true">{repeatWeekly ? <Check size={14} /> : null}</span>
          <span><strong>تکرار هفتگی همین روز و ساعت</strong><small>تا تاریخ پایانی که انتخاب می‌کنی؛ تاریخ پایان هم در نظر گرفته می‌شود.</small></span>
        </label>
        {repeatWeekly && (
          <div className="repeat-date-field">
            <button type="button" className={`jalali-date-choice ${repeatUntil ? 'has-date' : ''}`} onClick={() => setShowEndCalendar((shown) => !shown)}>
              <CalendarDays size={16} />
              <span>{repeatUntil ? `تکرار تا ${formatJalaliDate(repeatUntil)}` : 'انتخاب تاریخ پایان با تقویم شمسی'}</span>
              <ChevronDown size={16} />
            </button>
            {showEndCalendar && <JalaliCalendar compact value={repeatUntil || undefined} minDate={minimumRepeatEnd} onChange={(date) => { setRepeatUntil(date); setShowEndCalendar(false); setError(''); }} />}
            <small className="field-helper">نوبت‌های هفتگی تا این تاریخ ساخته می‌شوند؛ هر تاریخی که تداخل داشته باشد از گزارش مشخص می‌شود.</small>
          </div>
        )}
        <div className="form-field"><label className="field-label" htmlFor="booking-note">یادداشت (اختیاری)</label><textarea id="booking-note" className="text-input textarea-input" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="" /></div>
        <div className="inline-hint"><Eye size={15} /><span>نام رزروکننده فقط برای صاحب باشگاه ذخیره و نمایش داده می‌شود؛ نمای بازیکن فقط زمان، زمین و وضعیت رزرو را دریافت می‌کند.</span></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>انصراف</button><button className="button button-primary" disabled={busy}><CalendarDays size={17} />{busy ? 'در حال ثبت…' : repeatWeekly ? 'ثبت سانس‌های تکرارشونده' : 'ثبت در برنامه'}</button></div>
      </form>
    </ModalFrame>
  );
}

function RequestBookingModal({ draft, courts, defaultPrice, busy, onClose, onSubmit }: {
  draft: BookingDraft;
  courts: CourtInfo[];
  defaultPrice: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: RequestFormInput) => void;
}) {
  const [bookedForName, setBookedForName] = useState('');
  const [sport, setSport] = useState<SportType>('volleyball');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const courtName = courts.find((court) => court.id === draft.courtId)?.name ?? 'زمین';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookedForName.trim()) { setError('نام و نام خانوادگی را وارد کن.'); return; }
    if (message.trim().length > 1500) { setError('پیام حداکثر ۱۵۰۰ نویسه باشد.'); return; }
    onSubmit({ bookedForName, sport, message });
  }

  return (
    <ModalFrame title="درخواست رزرو سانس" subtitle="این درخواست تا بررسی صاحب باشگاه، سانس را موقتاً برای دیگران قفل می‌کند." onClose={onClose} icon={<MessageCircle size={20} />}>
      <form className="modal-form" onSubmit={submit}>
        <div className="booking-slot-summary">
          <CalendarDays size={19} />
          <div><span>تاریخ شمسی</span><strong>{formatJalaliDate(draft.date)}</strong></div>
          <div><span>{courtName}</span><strong>{formatTimeRange(draft.startTime, draft.endTime)}</strong></div>
        </div>
        <div className="form-field"><label className="field-label" htmlFor="request-booking-name">نام و نام خانوادگی</label><input id="request-booking-name" className="text-input" autoFocus required maxLength={100} value={bookedForName} onChange={(event) => setBookedForName(event.target.value)} placeholder="نام درخواست‌کننده" /></div>
        <div className="form-field"><label className="field-label" htmlFor="request-booking-sport">ورزش</label><select id="request-booking-sport" className="text-input select-input" value={sport} onChange={(event) => setSport(event.target.value as SportType)}><option value="volleyball">والیبال</option><option value="futsal">فوتسال</option><option value="other">ورزش دیگر</option></select></div>
        <div className="form-field"><label className="field-label" htmlFor="request-booking-message">پیام برای صاحب باشگاه <span>اختیاری</span></label><textarea id="request-booking-message" className="text-input textarea-input" rows={3} maxLength={1500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="مثلاً اگر دربارهٔ سانس یا پرداخت توضیحی داری بنویس." /><small className="field-helper">{formatNumber(message.length)} از ۱۵۰۰ نویسه</small></div>
        <div className="booking-price-summary"><Banknote size={17} /><span>هزینهٔ از پیش تعیین‌شدهٔ باشگاه</span><strong>{defaultPrice > 0 ? formatToman(defaultPrice) : 'رایگان'}</strong></div>
        <div className="inline-hint"><Info size={15} /><span>باشگاه تا ۳۰ دقیقه درخواست را بررسی می‌کند. پس از تأیید اولیه، ۱۵ دقیقه برای پرداخت فرصت داری و بعد رسید یا پیام پرداخت را می‌فرستی.</span></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>انصراف</button><button className="button button-primary" disabled={busy}><Send size={16} />{busy ? 'در حال ارسال…' : 'ارسال درخواست'}</button></div>
      </form>
    </ModalFrame>
  );
}

function BookingConversationModal({ booking, role, demo, isArchived, userUid, ownerPhone, demoMessages, firestore, storage, busy, now, availableBalanceToman, onClose, onSend, onApplyBalance, onSubmitPayment }: {
  booking: BookingRecord;
  role: UserRole;
  demo: boolean;
  isArchived: boolean;
  userUid: string;
  ownerPhone: string;
  demoMessages: BookingMessageRecord[];
  firestore: Firestore | null;
  storage: FirebaseStorage | null;
  busy: boolean;
  now: number;
  availableBalanceToman: number;
  onClose: () => void;
  onSend: (body: string) => void;
  onApplyBalance: () => void;
  onSubmitPayment: (body: string, file: File | null) => void;
}) {
  const clubId = useContext(ActiveClubIdContext);
  const [messages, setMessages] = useState<BookingMessageRecord[]>([]);
  const [body, setBody] = useState('');
  const [paymentBody, setPaymentBody] = useState('');
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [messageAttachmentUrls, setMessageAttachmentUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (demo) {
      const ownMessages = demoMessages
        .filter((message) => message.bookingId === booking.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setMessages(ownMessages);
      setLoadError('');
      return;
    }
    if (!firestore) return;
    const messagesQuery = query(
      collection(firestore, 'clubs', clubId, 'bookings', booking.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100),
    );
    return onSnapshot(messagesQuery, (snapshot) => {
      setMessages(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          bookingId: String(data.bookingId ?? booking.id),
          body: String(data.body ?? ''),
          senderUid: String(data.senderUid ?? ''),
          senderRole: data.senderRole === 'owner' ? 'owner' : 'player',
          createdAt: timestampToIso(data.createdAt),
          kind: data.kind === 'payment_report' || data.kind === 'status' ? data.kind : 'text',
          attachmentPath: typeof data.attachmentPath === 'string' ? data.attachmentPath : '',
          attachmentName: typeof data.attachmentName === 'string' ? data.attachmentName : '',
          attachmentContentType: typeof data.attachmentContentType === 'string' ? data.attachmentContentType : '',
          attachmentSize: Number(data.attachmentSize ?? 0),
        };
      }));
      setLoadError('');
    }, (error) => setLoadError(getFriendlyError(error)));
  }, [booking.id, demo, demoMessages, firestore]);

  useEffect(() => {
    let active = true;
    setAttachmentUrl(booking.attachmentDataUrl ?? '');
    if (!booking.attachmentPath || !storage || demo) return () => { active = false; };
    void getDownloadURL(storageRef(storage, booking.attachmentPath))
      .then((url) => { if (active) setAttachmentUrl(url); })
      .catch((error) => { if (active) setLoadError(getFriendlyError(error)); });
    return () => { active = false; };
  }, [booking.attachmentDataUrl, booking.attachmentPath, demo, storage]);

  useEffect(() => {
    let active = true;
    if (!storage || demo) return () => { active = false; };
    const attachments = messages.filter((message) => message.attachmentPath);
    void Promise.all(attachments.map(async (message) => {
      try { return [message.id, await getDownloadURL(storageRef(storage, message.attachmentPath!))] as const; }
      catch { return [message.id, ''] as const; }
    })).then((entries) => { if (active) setMessageAttachmentUrls(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [demo, messages, storage]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody || cleanBody.length > 1500) return;
    onSend(cleanBody);
    setBody('');
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanBody = paymentBody.trim();
    if (!cleanBody && !paymentFile) return;
    onSubmitPayment(cleanBody, paymentFile);
    setPaymentBody('');
    setPaymentFile(null);
  }

  const statusLabel = bookingStatusLabel(booking.status);
  const canSubmitPayment = !isArchived
    && role === 'player'
    && ['awaiting_payment', 'needs_correction'].includes(booking.status)
    && (!booking.phaseDeadlineAt || new Date(booking.phaseDeadlineAt).getTime() > now);
  const remainingToPayToman = Math.max(0, booking.priceToman - (booking.accountBalanceAppliedToman ?? 0));
  const availableToApplyToman = Math.min(remainingToPayToman, Math.max(0, availableBalanceToman));
  const phoneDigits = ownerPhone
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^0-9+]/g, '');

  return (
    <ModalFrame title="گفت‌وگوی رزرو" subtitle="وضعیت، پیام‌ها و رسیدهای این رزرو در سابقه می‌مانند." onClose={onClose} icon={<MessageCircle size={20} />} wide>
      <div className="modal-form booking-conversation">
        <div className="booking-conversation-summary">
          <div><span>{booking.courtName} · {formatJalaliDate(booking.date)}</span><strong>{formatTimeRange(booking.startTime, booking.endTime)}</strong></div>
          <div className="booking-conversation-price"><span>مبلغ سانس</span><strong>{formatToman(booking.priceToman)}</strong></div>
          <span className={`booking-private-status status-${booking.status}`}>{statusLabel}</span>
        </div>
        {isArchived && <div className="archive-access-note"><History size={16} /><span>این زمین بایگانی شده است؛ اطلاعات رزرو و گفت‌وگو برای سابقه حفظ می‌شوند.</span></div>}
        {(booking.accountBalanceAppliedToman ?? 0) > 0 && ['awaiting_payment', 'needs_correction', 'payment_submitted', 'booked'].includes(booking.status) && <div className="booking-flow-notice"><Wallet size={16} /><span>{formatToman(booking.accountBalanceAppliedToman ?? 0)} از ماندهٔ حساب برای این رزرو کنار گذاشته شده است{booking.status !== 'booked' && remainingToPayToman > 0 ? ` · ${formatToman(remainingToPayToman)} باقی‌مانده` : ''}.</span></div>}
        {booking.status === 'awaiting_payment' && <div className="booking-flow-notice"><Clock3 size={16} /><span>تأیید اولیه انجام شد. تا پایان مهلت، پرداخت را اعلام و رسید را بفرست: <strong>{timeRemaining(booking.phaseDeadlineAt, now)}</strong></span></div>}
        {booking.status === 'needs_correction' && <div className="correction-callout"><CircleAlert size={16} /><span>{booking.correctionNote || 'باشگاه درخواست اصلاح پرداخت داده است.'} · {timeRemaining(booking.phaseDeadlineAt, now)}</span></div>}
        {booking.status === 'payment_submitted' && <div className="booking-flow-notice"><Clock3 size={16} /><span>پرداخت اعلام شده است؛ سانس تا تأیید نهایی باشگاه قفل می‌ماند.</span></div>}
        {booking.status === 'rejected' && <div className="form-error"><CircleAlert size={16} /><span>{booking.rejectionReason ? `دلیل رد: ${booking.rejectionReason}` : 'درخواست رزرو رد شد.'}</span></div>}
        {booking.status === 'expired' && booking.expiryReason && <div className="form-error"><CircleAlert size={16} /><span>{booking.expiryReason}</span></div>}
        {role === 'player' && (ownerPhone.trim()
          ? <a className="contact-owner-inline" href={`tel:${phoneDigits}`}><Phone size={15} /> تماس تلفنی با صاحب باشگاه <span>{ownerPhone}</span></a>
          : <div className="contact-number-missing"><Phone size={15} /> شمارهٔ تماس صاحب باشگاه ثبت نشده است.</div>)}
        {booking.attachmentName && (
          <div className="booking-attachment-card">
            <Paperclip size={17} /><div><strong>پیوست قدیمی</strong><span>{booking.attachmentName} · {formatNumber(Math.ceil((booking.attachmentSize ?? 0) / 1024))} کیلوبایت</span></div>
            {attachmentUrl ? <a href={attachmentUrl} target="_blank" rel="noreferrer" className="attachment-open-link"><ExternalLink size={15} /> مشاهده</a> : <span className="attachment-loading">در حال دریافت…</span>}
          </div>
        )}
        {canSubmitPayment && booking.priceToman === 0 && (
          <button className="button button-primary" disabled={busy} onClick={() => onSubmitPayment('این رزرو رایگان است؛ پرداختی لازم نیست.', null)}><CheckCircle2 size={15} />تأیید رزرو رایگان</button>
        )}
        {canSubmitPayment && remainingToPayToman > 0 && availableToApplyToman > 0 && (
          <div className="balance-use-panel">
            <div><strong>استفاده از ماندهٔ حساب</strong><span>{formatToman(availableToApplyToman)} از اعتبارت برای این رزرو منظور می‌شود{remainingToPayToman > availableToApplyToman ? ` و ${formatToman(remainingToPayToman - availableToApplyToman)} باقی می‌ماند.` : '.'}</span></div>
            <button className="button button-secondary" disabled={busy} onClick={onApplyBalance}><Wallet size={15} /> استفاده از مانده</button>
          </div>
        )}
        {canSubmitPayment && remainingToPayToman > 0 && (
          <form className="booking-payment-submit" onSubmit={submitPayment}>
            <strong>{booking.status === 'needs_correction' ? 'اصلاح و ارسال دوباره' : 'اعلام پرداخت'}</strong>
            <small>مبلغ باقی‌مانده: {formatToman(remainingToPayToman)} از نرخ {formatToman(booking.priceToman)}. می‌توانی توضیح بنویسی، رسید پیوست کنی یا هر دو را بفرستی.</small>
            <textarea className="text-input textarea-input" rows={2} maxLength={1500} value={paymentBody} onChange={(event) => setPaymentBody(event.target.value)} placeholder="مثلاً پرداخت انجام شد؛ شمارهٔ پیگیری ..." />
            <label className={`receipt-file-picker ${paymentFile ? 'has-file' : ''} ${busy ? 'is-disabled' : ''}`}><Paperclip size={16} /><span>{paymentFile ? paymentFile.name : 'پیوست رسید (اختیاری)'}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={(event) => { setPaymentFile(event.target.files?.[0] ?? null); event.currentTarget.value = ''; }} /></label>
            <small className="field-helper">JPG، PNG، WebP یا PDF · حداکثر ۸ مگابایت در Firebase و ۲ مگابایت در حالت نمایشی</small>
            <button className="button button-primary" disabled={busy || (!paymentBody.trim() && !paymentFile)}><CheckCircle2 size={15} />{booking.status === 'needs_correction' ? 'ارسال باقیمانده' : 'پرداخت باقی‌مانده را اعلام کن'}</button>
          </form>
        )}
        {loadError && <div className="schedule-error" role="alert"><CircleAlert size={16} /><span>{loadError}</span></div>}
        <div className="booking-message-list" aria-live="polite">
          {messages.length === 0 ? <div className="empty-state booking-message-empty"><div className="empty-icon"><MessageCircle size={22} /></div><strong>هنوز پیامی نیست</strong><span>وضعیت و پیام‌های مربوط به درخواست در همین‌جا دیده می‌شود.</span></div> : messages.map((message) => {
            const mine = message.senderUid === userUid;
            const senderLabel = mine ? 'شما' : message.senderRole === 'owner' ? 'صاحب باشگاه' : 'بازیکن';
            const createdAt = new Date(message.createdAt);
            const timeLabel = Number.isNaN(createdAt.getTime()) ? '' : new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(createdAt);
            const fileUrl = message.attachmentDataUrl || messageAttachmentUrls[message.id];
            return <article className={`booking-message ${mine ? 'message-is-mine' : 'message-is-theirs'}`} key={message.id}>
              <div className="booking-message-meta"><strong>{message.kind === 'payment_report' ? `${senderLabel} · اعلام پرداخت` : senderLabel}</strong><time>{timeLabel}</time></div>
              <p>{message.body}</p>
              {message.attachmentName && <div className="booking-message-attachment"><Paperclip size={14} /><span>{message.attachmentName}</span>{fileUrl ? <a href={fileUrl} target="_blank" rel="noreferrer" className="attachment-open-link"><ExternalLink size={14} /> مشاهده رسید</a> : <span className="attachment-loading">در حال دریافت…</span>}</div>}
            </article>;
          })}
        </div>
        <form className="booking-message-compose" onSubmit={submitMessage}>
          <label className="sr-only" htmlFor="booking-message-body">پیام جدید</label>
          <textarea id="booking-message-body" className="text-input textarea-input" rows={2} maxLength={1500} value={body} onChange={(event) => setBody(event.target.value)} placeholder="پیام جدید بنویس…" />
          <div className="booking-message-compose-footer"><small>{formatNumber(body.length)} از ۱۵۰۰ نویسه</small><button className="button button-primary" disabled={!body.trim() || busy}><Send size={15} /> ارسال پیام</button></div>
        </form>
        {role === 'owner' && !isArchived && ['pending', 'payment_submitted', 'needs_correction'].includes(booking.status) && <button className="text-button owner-review-link" onClick={onClose}>بازگشت برای بررسی این مرحله</button>}
      </div>
    </ModalFrame>
  );
}

function BookingReviewModal({ booking, busy, now, onClose, onOpenConversation, onInitialApprove, onInitialReject, onFinalApprove, onRequestCorrection, onFinalReject }: {
  booking: BookingRecord;
  busy: boolean;
  now: number;
  onClose: () => void;
  onOpenConversation: () => void;
  onInitialApprove: () => void;
  onInitialReject: (reason: string) => void;
  onFinalApprove: () => void;
  onRequestCorrection: (reason: string) => void;
  onFinalReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [showInitialRejectReason, setShowInitialRejectReason] = useState(false);
  const isInitial = booking.status === 'pending';
  const isPaymentReview = booking.status === 'payment_submitted';
  const canReject = ['pending', 'payment_submitted', 'needs_correction'].includes(booking.status);

  function sendWithReason(action: 'initial_reject' | 'correction' | 'final_reject') {
    if (action !== 'initial_reject' && !reason.trim()) { setError('برای درخواست اصلاح یا رد نهایی، دلیل را بنویس.'); return; }
    setError('');
    if (action === 'initial_reject') onInitialReject(reason.trim());
    else if (action === 'correction') onRequestCorrection(reason.trim());
    else onFinalReject(reason.trim());
  }

  const stepCopy = isInitial
    ? 'اگر درخواست را تأیید اولیه کنی، بازیکن ۱۵ دقیقه برای پرداخت فرصت دارد.'
    : isPaymentReview
      ? 'رسید یا پیام پرداخت را بررسی کن؛ با تأیید نهایی، رزرو قطعی می‌شود.'
      : 'درخواست اصلاح برای بازیکن فرستاده شده؛ تا پایان مهلت اصلاح، سانس قفل می‌ماند.';

  return (
    <ModalFrame title={isInitial ? 'تأیید اولیهٔ درخواست' : 'بررسی پرداخت و تأیید نهایی'} subtitle={stepCopy} onClose={onClose} icon={<CheckCircle2 size={20} />}>
      <div className="modal-form">
        <div className="booking-review-summary">
          <span>{booking.courtName} · {formatJalaliDate(booking.date)}</span>
          <strong>{formatTimeRange(booking.startTime, booking.endTime)}</strong>
          <div><span className="sport-chip">{sportName(booking.sport)}</span><strong>{booking.bookedForName}</strong></div>
          <div className="booking-price-summary"><Banknote size={16} /><span>مبلغ تعیین‌شده در تنظیمات باشگاه</span><strong>{formatToman(booking.priceToman)}</strong></div>
          {isPaymentReview && <small className="field-helper">از ماندهٔ حساب: {formatToman(booking.accountBalanceAppliedToman ?? 0)} · پرداخت بیرونی برای ثبت در دفتر: {formatToman(booking.paymentReportedAmountToman ?? 0)}</small>}
          {booking.phaseDeadlineAt && <small className="field-helper">{timeRemaining(booking.phaseDeadlineAt, now)}</small>}
        </div>
        <button type="button" className="button button-quiet booking-open-conversation" onClick={onOpenConversation}><MessageCircle size={16} /> دیدن پیام‌ها و رسید پرداخت</button>
        {canReject && (!isInitial || showInitialRejectReason) && (
          <div className="form-field">
            <label className="field-label" htmlFor="booking-review-reason">{isInitial ? 'دلیل رد اولیه (اختیاری)' : 'دلیل اصلاح یا رد نهایی'}</label>
            <textarea id="booking-review-reason" className="text-input textarea-input" rows={3} maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value); setError(''); }} placeholder={isInitial ? 'در صورت تمایل، دلیل رد را بنویس.' : 'مثلاً رسید مبلغ کامل سانس را نشان نمی‌دهد.'} />
          </div>
        )}
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions booking-review-actions">
          {isInitial ? (
            showInitialRejectReason ? (
              <>
                <button type="button" className="button button-quiet" disabled={busy} onClick={() => { setShowInitialRejectReason(false); setError(''); }}>انصراف از رد</button>
                <button type="button" className="button button-danger" disabled={busy} onClick={() => sendWithReason('initial_reject')}><X size={16} /> ثبت رد درخواست</button>
              </>
            ) : (
              <>
                <button type="button" className="button button-danger" disabled={busy} onClick={() => { setShowInitialRejectReason(true); setError(''); }}><X size={16} /> رد درخواست</button>
                <button type="button" className="button button-primary" disabled={busy} onClick={onInitialApprove}><CheckCircle2 size={16} /> تأیید اولیه</button>
              </>
            )
          ) : isPaymentReview ? (
            <>
              <button type="button" className="button button-danger" disabled={busy} onClick={() => sendWithReason('final_reject')}><X size={16} /> رد نهایی با دلیل</button>
              <button type="button" className="button button-quiet" disabled={busy} onClick={() => sendWithReason('correction')}><Pencil size={15} /> درخواست اصلاح</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={onFinalApprove}><CheckCircle2 size={16} /> تأیید نهایی و قطعی‌کردن</button>
            </>
          ) : (
            <button type="button" className="button button-danger" disabled={busy} onClick={() => sendWithReason('final_reject')}><X size={16} /> رد نهایی با دلیل</button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

function SettingsModal({ settings, actorUid, onClose, onSubmit }: { settings: ClubSettings; actorUid: string; onClose: () => void; onSubmit: (settings: ClubSettings) => void }) {
  const [clubName, setClubName] = useState(settings.clubName);
  const [price, setPrice] = useState(settings.defaultSessionPriceToman ? String(settings.defaultSessionPriceToman) : '');
  const [publicScheduleEnabled, setPublicScheduleEnabled] = useState(settings.publicScheduleEnabled);
  const [ownerPhone, setOwnerPhone] = useState(settings.ownerPhone);
  const [courts, setCourts] = useState<CourtInfo[]>(settings.courts);
  const [archivedCourts, setArchivedCourts] = useState<ArchivedCourtInfo[]>(settings.archivedCourts ?? []);
  const [error, setError] = useState('');
  const value = parseToman(price);

  function updateCourt(id: string, name: string) {
    setCourts((items) => items.map((court) => court.id === id ? { ...court, name } : court));
  }

  function archiveCourt(court: CourtInfo) {
    setCourts((items) => items.filter((item) => item.id !== court.id));
    setArchivedCourts((items) => [{ ...court, archivedAt: new Date().toISOString(), archivedByUid: actorUid }, ...items.filter((item) => item.id !== court.id)]);
  }

  function restoreCourt(court: ArchivedCourtInfo) {
    setArchivedCourts((items) => items.filter((item) => item.id !== court.id));
    setCourts((items) => [...items, { id: court.id, name: court.name }]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedCourts = courts.map((court) => ({ ...court, name: court.name.trim() }));
    if (!clubName.trim()) { setError('نام باشگاه را وارد کن.'); return; }
    if (ownerPhone.trim().length > 30) { setError('شمارهٔ تماس را حداکثر در ۳۰ نویسه وارد کن.'); return; }
    if (cleanedCourts.some((court) => !court.name)) { setError('برای همهٔ زمین‌های فعال نام وارد کن.'); return; }
    if (new Set(cleanedCourts.map((court) => court.name.toLocaleLowerCase())).size !== cleanedCourts.length) { setError('نام زمین‌های فعال باید با هم متفاوت باشد.'); return; }
    onSubmit({
      ...settings,
      clubName: clubName.trim(),
      defaultSessionPriceToman: value,
      publicScheduleEnabled,
      ownerPhone: ownerPhone.trim(),
      courts: cleanedCourts,
      archivedCourts,
    });
  }

  return (
    <ModalFrame title="تنظیمات باشگاه" subtitle="زمین فعال را از برنامه کنار بگذار؛ سابقهٔ رزروهای آن برای آرشیو حفظ می‌شود." onClose={onClose} icon={<Settings2 size={20} />}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-field"><label className="field-label" htmlFor="club-name">نام باشگاه</label><input id="club-name" className="text-input" value={clubName} onChange={(event) => setClubName(event.target.value)} /></div>
        <div className="form-field"><label className="field-label" htmlFor="default-price">نرخ از پیش تعیین‌شدهٔ هر سانس <span>تومان</span></label><input id="default-price" className="text-input" dir="ltr" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="۰" /><small className="field-helper">{value > 0 ? formatToman(value) : 'مبلغ صفر به‌عنوان سانس رایگان نمایش داده می‌شود.'}</small></div>
        <div className="form-field"><label className="field-label" htmlFor="owner-phone">شمارهٔ تماس صاحب باشگاه</label><input id="owner-phone" className="text-input" type="tel" dir="ltr" value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} placeholder="مثلاً ‎+98 912 000 0000" /><small className="field-helper">این شماره برای بازیکنانِ مجاز به مشاهدهٔ برنامه نمایش داده می‌شود تا بتوانند تماس بگیرند.</small></div>
        <div className="settings-section-title"><MapPin size={17} /><strong>زمین‌های فعال</strong></div>
        <div className="court-editor-list">
          {courts.map((court, index) => (
            <div className="court-editor-row" key={court.id}>
              <label className="sr-only" htmlFor={`court-name-${court.id}`}>نام زمین {index + 1}</label>
              <input id={`court-name-${court.id}`} className="text-input" maxLength={100} value={court.name} onChange={(event) => updateCourt(court.id, event.target.value)} placeholder={`زمین ${index + 1}`} />
              <button type="button" className="icon-button court-remove" aria-label={`بایگانی ${court.name || `زمین ${index + 1}`}`} title="بایگانی زمین و نگه‌داشتن سابقه" onClick={() => archiveCourt(court)}><History size={17} /></button>
            </div>
          ))}
          {courts.length === 0 && <div className="empty-state schedule-empty"><strong>زمین فعالی نیست</strong><span>می‌توانی زمین تازه‌ای اضافه کنی یا از آرشیو برگردانی.</span></div>}
        </div>
        <button type="button" className="add-court-button" onClick={() => setCourts((items) => [...items, { id: crypto.randomUUID(), name: `زمین ${items.length + 1}` }])}><Plus size={16} />افزودن زمین</button>
        {archivedCourts.length > 0 && (
          <div className="archived-court-editor">
            <div className="settings-section-title"><History size={17} /><strong>زمین‌های بایگانی‌شده</strong></div>
            {archivedCourts.map((court) => <div className="archived-court-row" key={court.id}><div><strong>{court.name}</strong><small>سابقهٔ رزروها حفظ شده</small></div><button type="button" className="text-button" onClick={() => restoreCourt(court)}><RefreshCcw size={14} /> بازگرداندن</button></div>)}
          </div>
        )}
        <label className={`schedule-toggle ${publicScheduleEnabled ? 'is-enabled' : ''}`}>
          <input type="checkbox" checked={publicScheduleEnabled} onChange={(event) => setPublicScheduleEnabled(event.target.checked)} />
          <span className="schedule-toggle-icon">{publicScheduleEnabled ? <Eye size={19} /> : <EyeOff size={19} />}</span>
          <span className="schedule-toggle-copy"><strong>نمایش برنامه برای بازیکنان</strong><small>این تنظیم برای کل باشگاه است؛ برنامه به افراد یا سانس‌های خاص محدود نمی‌شود.</small></span>
          <span className="toggle-switch" aria-hidden="true" />
        </label>
        <div className="settings-policy"><ShieldCheck size={17} /><span>بازیکن فقط زمان، زمین، مبلغ سانس آزاد و آزاد یا رزرو بودن را می‌بیند؛ جزئیات رزروهای دیگران خصوصی می‌ماند. بایگانی زمین، رزروها و گفت‌وگوهای قبلی را حذف نمی‌کند.</span></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>انصراف</button><button className="button button-primary"><Check size={17} />ذخیره تنظیمات</button></div>
      </form>
    </ModalFrame>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  dir,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
  type?: string;
}) {
  return (
    <div className="form-field">
      <label className="field-label">{label}</label>
      <input className="text-input" type={type} dir={dir} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function ModalFrame({
  title,
  subtitle,
  icon,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <div className="modal-icon">{icon}</div>
          <div className="modal-title-copy"><h2>{title}</h2><p>{subtitle}</p></div>
          <button className="icon-button modal-close" onClick={onClose} aria-label="بستن"><X size={19} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function FullScreenLoader({ label }: { label: string }) {
  return <div className="fullscreen-loader" dir="rtl"><LoaderCircle className="spin" size={28} /><span>{label}</span></div>;
}

export default App;
