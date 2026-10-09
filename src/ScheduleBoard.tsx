import { useMemo, useState } from 'react';
import { Ban, CalendarDays, CheckCircle2, ChevronDown, Clock3, CircleAlert, Eye, EyeOff, History, Info, LoaderCircle, MapPin, MessageCircle, Phone, X } from 'lucide-react';
import { formatDate, formatNumber, formatToman, type BookingRecord, type ClubSettings, type PublicScheduleRecord, type SportType, type UserRole } from './domain';
import { JalaliCalendar } from './JalaliCalendar';
import { DEFAULT_SESSION_SLOTS, bookingOverlaps, formatJalaliDate, formatTimeRange } from './scheduleUtils';

interface CalendarEntry extends Omit<PublicScheduleRecord, 'status'> {
  status: 'pending' | 'booked' | 'cancelled';
  sport?: SportType;
  priceToman?: number;
  privateBooking?: BookingRecord;
}

type SlotDraft = { date: string; courtId: string; startTime: string; endTime: string };

function sportName(sport: SportType): string {
  if (sport === 'volleyball') return 'والیبال';
  if (sport === 'futsal') return 'فوتسال';
  return 'ورزش دیگر';
}

function telHref(value: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const latin = value
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[^0-9+]/g, '');
  return `tel:${latin}`;
}

function bookingStatusLabel(status: BookingRecord['status']): string {
  if (status === 'pending') return 'در انتظار تأیید اولیه';
  if (status === 'awaiting_payment') return 'در انتظار پرداخت';
  if (status === 'payment_submitted') return 'در انتظار تأیید پرداخت';
  if (status === 'needs_correction') return 'نیازمند اصلاح پرداخت';
  if (status === 'booked') return 'رزرو قطعی';
  if (status === 'expired') return 'منقضی شده';
  if (status === 'rejected') return 'رد نهایی';
  return 'لغو شده';
}

function remainingLabel(deadline: string | undefined, now: number): string {
  if (!deadline) return '';
  const minutes = Math.ceil((new Date(deadline).getTime() - now) / 60_000);
  if (minutes <= 0) return 'مهلت تمام شده';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${formatNumber(hours)} ساعت و ${formatNumber(remainder)} دقیقه باقی‌مانده` : `${formatNumber(minutes)} دقیقه باقی‌مانده`;
}

export function ScheduleBoard({
  role,
  settings,
  bookings,
  publicSchedule,
  selectedDate,
  onSelectDate,
  now,
  loading,
  error,
  report,
  onDismissReport,
  onCreate,
  onRequest,
  onOpenConversation,
  onReviewBooking,
  onSettings,
  onCancel,
}: {
  role: UserRole;
  settings: ClubSettings;
  bookings: BookingRecord[];
  publicSchedule: PublicScheduleRecord[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  now: number;
  loading: boolean;
  error: string;
  report: string;
  onDismissReport: () => void;
  onCreate: (draft: SlotDraft) => void;
  onRequest: (draft: SlotDraft) => void;
  onOpenConversation: (booking: BookingRecord) => void;
  onReviewBooking: (booking: BookingRecord) => void;
  onSettings: () => void;
  onCancel: (booking: BookingRecord) => void;
}) {
  const [collapsedCourtIds, setCollapsedCourtIds] = useState<Set<string>>(() => new Set());
  const [showArchive, setShowArchive] = useState(false);
  const entries = useMemo<CalendarEntry[]>(() => {
    if (role === 'owner') {
      return bookings.map((booking) => ({
        id: booking.id,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        courtId: booking.courtId,
        courtName: booking.courtName,
        sport: booking.sport,
        priceToman: booking.priceToman,
        status: booking.status === 'booked' ? 'booked' : ['pending', 'awaiting_payment', 'payment_submitted', 'needs_correction'].includes(booking.status) ? 'pending' : 'cancelled',
        privateBooking: booking,
      }));
    }
    const merged = new Map<string, CalendarEntry>(publicSchedule.map((entry): [string, CalendarEntry] => [entry.id, { ...entry }]));
    for (const booking of bookings) {
      if (!['pending', 'awaiting_payment', 'payment_submitted', 'needs_correction', 'booked'].includes(booking.status)) continue;
      merged.set(booking.id, {
        id: booking.id,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        courtId: booking.courtId,
        courtName: booking.courtName,
        sport: booking.sport,
        priceToman: booking.priceToman,
        status: booking.status === 'booked' ? 'booked' : 'pending',
        privateBooking: booking,
      });
    }
    return [...merged.values()];
  }, [role, bookings, publicSchedule]);
  const activeCourtIds = new Set(settings.courts.map((court) => court.id));
  const dayEntries = entries.filter((entry) => entry.date === selectedDate
    && (entry.status === 'booked' || entry.status === 'pending')
    && activeCourtIds.has(entry.courtId));
  const courts = settings.courts;
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const myBookings = role === 'player' ? bookings.filter((booking) => booking.date === selectedDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const privateRequests = role === 'player'
    ? myBookings
    : bookings.filter((booking) => booking.date === selectedDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function getReservation(courtId: string, slot: typeof DEFAULT_SESSION_SLOTS[number]): CalendarEntry | undefined {
    return dayEntries.find((entry) => entry.courtId === courtId && bookingOverlaps(slot, entry));
  }

  function toggleCourt(courtId: string) {
    setCollapsedCourtIds((current) => {
      const next = new Set(current);
      if (next.has(courtId)) next.delete(courtId);
      else next.add(courtId);
      return next;
    });
  }

  return (
    <section className="schedule-card">
      <div className="schedule-heading">
        <div>
          <span className="section-kicker">نمای برنامه</span>
          <h2>تقویم سانس‌ها</h2>
          <p>{role === 'owner' ? 'روز را از تقویم شمسی انتخاب کن؛ هر سانس ۱.۵ ساعت است.' : 'وضعیت سانس‌ها و مبلغ هر سانس آزاد را ببین؛ جزئیات درخواست‌های دیگران خصوصی است.'}</p>
        </div>
        <div className="schedule-heading-actions">
          {settings.archivedCourts.length > 0 && <button className="button button-quiet schedule-settings-button" onClick={() => setShowArchive((shown) => !shown)}><History size={16} /> {showArchive ? 'بستن آرشیو' : 'آرشیو زمین‌ها'}</button>}
          {role === 'owner' && <button className="button button-quiet schedule-settings-button" onClick={onSettings}><Eye size={16} /> تنظیم نمایش</button>}
        </div>
      </div>

      {role === 'owner' && (
        <div className={`schedule-visibility ${settings.publicScheduleEnabled ? 'is-public' : 'is-private'}`}>
          {settings.publicScheduleEnabled ? <Eye size={17} /> : <EyeOff size={17} />}
          <span>{settings.publicScheduleEnabled ? 'نمایش برنامه برای بازیکنان فعال است.' : 'برنامه فقط برای صاحب باشگاه قابل مشاهده است.'}</span>
          <button className="text-button" onClick={onSettings}>تغییر</button>
        </div>
      )}

      {role === 'player' && (
        <div className="player-contact-strip">
          <div className="player-contact-copy"><strong>نیاز به پیگیری درخواست داری؟</strong><span>از گفت‌وگوی خصوصی برنامه استفاده کن یا با صاحب باشگاه تماس بگیر.</span></div>
          {settings.ownerPhone.trim() ? (
            <a className="button button-quiet contact-owner-button" href={telHref(settings.ownerPhone)}><Phone size={16} /> تماس با صاحب باشگاه</a>
          ) : (
            <span className="contact-number-missing"><Phone size={15} /> شمارهٔ تماس هنوز ثبت نشده است.</span>
          )}
        </div>
      )}

      {showArchive && (
        <section className="booking-archive-panel" aria-label="آرشیو زمین‌ها و رزروها">
          <div className="booking-archive-heading"><div><span className="section-kicker">سابقه حفظ شده</span><h3>آرشیو زمین‌ها و رزروها</h3></div><span>فقط سابقهٔ مجاز برای حساب تو</span></div>
          <p>زمین‌های بایگانی‌شده از برنامهٔ فعال کنار رفته‌اند؛ درخواست‌ها، رزروها و گفت‌وگویشان حذف نشده‌اند.</p>
          <div className="booking-archive-list">
            {settings.archivedCourts.map((court) => {
              const history = bookings.filter((booking) => booking.courtId === court.id).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
              return (
                <section className="booking-archive-court" key={court.id}>
                  <div className="booking-archive-court-heading"><MapPin size={16} /><strong>{court.name}</strong><span>{formatNumber(history.length)} سابقه</span></div>
                  {history.length ? (
                    <div className="booking-archive-items">
                      {history.slice(0, 100).map((booking) => (
                        <article className="booking-archive-item" key={booking.id}>
                          <div><strong>{formatDate(booking.date)} · {formatTimeRange(booking.startTime, booking.endTime)}</strong><span>{bookingStatusLabel(booking.status)}{role === 'owner' && booking.bookedForName ? ` · ${booking.bookedForName}` : ''}</span></div>
                          <button className="text-button" onClick={() => onOpenConversation(booking)}><MessageCircle size={14} /> گفت‌وگو</button>
                        </article>
                      ))}
                    </div>
                  ) : <small className="field-helper">برای این زمین سابقه‌ای در دسترس این حساب نیست.</small>}
                </section>
              );
            })}
          </div>
        </section>
      )}

      <div className="schedule-layout">
        <aside className="schedule-calendar-panel">
          <JalaliCalendar value={selectedDate} onChange={onSelectDate} />
          <div className="calendar-selected-day"><CalendarDays size={16} /><span>{formatJalaliDate(selectedDate)}</span></div>
        </aside>

        <div className="schedule-day-panel">
          <div className="day-plan-heading">
            <div><span className="section-kicker">برنامهٔ روز</span><h3>{formatJalaliDate(selectedDate)}</h3></div>
            <span className="slot-count"><Clock3 size={14} /> هر سانس ۱.۵ ساعت</span>
          </div>

          {report && (
            <div className="schedule-report" role="status">
              <CircleAlert size={18} />
              <span>{report}</span>
              <button className="icon-button" onClick={onDismissReport} aria-label="بستن گزارش"><X size={15} /></button>
            </div>
          )}
          {error && <div className="schedule-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}

          {privateRequests.length > 0 && (
            <section className={`my-booking-requests ${role === 'owner' ? 'owner-booking-requests' : ''}`} aria-label={role === 'owner' ? 'درخواست‌های رزرو برای صاحب باشگاه' : 'درخواست‌ها و رزروهای من'}>
              <div className="my-booking-requests-heading"><div><span className="section-kicker">{role === 'owner' ? 'جزئیات خصوصی' : 'خصوصی برای حساب تو'}</span><h3>{role === 'owner' ? 'درخواست‌ها و گفت‌وگوها' : 'درخواست‌ها و رزروهای من'}</h3></div><span>{formatNumber(privateRequests.length)} مورد</span></div>
              <div className="my-booking-request-list">
                {privateRequests.map((booking) => (
                  <article className="my-booking-request" key={booking.id}>
                    <div className="my-booking-request-main">
                      <strong>{booking.courtName} · {formatTimeRange(booking.startTime, booking.endTime)}{role === 'owner' ? ` · ${booking.bookedForName}` : ''}</strong>
                      <span>{bookingStatusLabel(booking.status)}{booking.phaseDeadlineAt && ['pending', 'awaiting_payment', 'needs_correction'].includes(booking.status) ? ` · ${remainingLabel(booking.phaseDeadlineAt, now)}` : ''}{booking.attachmentName ? ` · رسید: ${booking.attachmentName}` : ''}{booking.rejectionReason || booking.correctionNote ? ` · ${booking.correctionNote || booking.rejectionReason}` : ''}</span>
                    </div>
                    <div className="request-row-actions">
                      {role === 'owner' && ['pending', 'payment_submitted', 'needs_correction'].includes(booking.status) && <button className="text-button request-message-button" onClick={() => onReviewBooking(booking)}><CheckCircle2 size={14} /> بررسی</button>}
                      <button className="text-button request-message-button" onClick={() => onOpenConversation(booking)}><MessageCircle size={15} /> پیام‌ها و جزئیات</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {loading ? (
            <div className="list-loading"><LoaderCircle className="spin" size={23} /><span>در حال دریافت برنامه…</span></div>
          ) : courts.length === 0 ? (
            <div className="empty-state schedule-empty"><div className="empty-icon"><MapPin size={24} /></div><strong>زمینی تعریف نشده</strong><span>از تنظیمات باشگاه یک زمین اضافه کن.</span></div>
          ) : (
            <div className="court-schedule-list">
              {courts.map((court) => {
                const bookedCount = DEFAULT_SESSION_SLOTS.filter((slot) => getReservation(court.id, slot)).length;
                const isCollapsed = collapsedCourtIds.has(court.id);
                return (
                  <section className={`court-schedule ${isCollapsed ? 'is-collapsed' : ''}`} key={court.id}>
                    <button className="court-heading" type="button" onClick={() => toggleCourt(court.id)} aria-expanded={!isCollapsed} aria-controls={`court-slots-${court.id}`}>
                      <MapPin size={17} /><strong>{court.name}</strong><span>{formatNumber(bookedCount)} سانس مشغول</span><ChevronDown className="court-collapse-icon" size={17} />
                    </button>
                    {!isCollapsed && <div className="slot-grid" id={`court-slots-${court.id}`}>
                      {DEFAULT_SESSION_SLOTS.map((slot) => {
                        const entry = getReservation(court.id, slot);
                        const booking = entry?.privateBooking ?? (entry ? bookingById.get(entry.id) : undefined);
                        const isPending = entry?.status === 'pending';
                        return (
                          <article className={`time-slot-card ${entry ? (isPending ? 'slot-is-pending' : 'slot-is-booked') : 'slot-is-free'}`} key={`${court.id}-${slot.startTime}`}>
                            <div className="slot-card-top">
                              <strong className="slot-time">{formatTimeRange(slot.startTime, slot.endTime)}</strong>
                              <span className={`slot-status ${isPending ? 'status-pending' : entry ? 'status-booked' : 'status-free'}`}>
                                {booking ? bookingStatusLabel(booking.status) : isPending ? 'رزرو شده' : entry ? 'رزرو شده' : 'آزاد'}
                              </span>
                            </div>
                            {booking?.phaseDeadlineAt && <small className="slot-deadline">{remainingLabel(booking.phaseDeadlineAt, now)}</small>}
                            {role === 'player' && !entry && (
                              <span className="slot-player-price">{settings.defaultSessionPriceToman > 0 ? formatToman(settings.defaultSessionPriceToman) : 'رایگان'}</span>
                            )}
                            {entry && (role === 'owner' || booking) ? (
                              <div className="slot-booking-details">
                                <span className="sport-chip">{sportName(entry.sport ?? booking?.sport ?? 'other')}</span>
                                {role === 'owner' && booking?.bookedForName && <strong className="booking-person">{booking.bookedForName}</strong>}
                                {role === 'owner' && booking?.priceToman && booking.priceToman > 0 && <span className="booking-price">{formatToman(booking.priceToman)}</span>}
                                {role === 'player' && booking && booking.priceToman > 0 && <span className="booking-price">{formatToman(booking.priceToman)}</span>}
                              </div>
                            ) : !entry && role === 'owner' ? (
                              <button className="slot-reserve-button" onClick={() => onCreate({ date: selectedDate, courtId: court.id, startTime: slot.startTime, endTime: slot.endTime })}>
                                <CheckCircle2 size={14} /> ثبت رزرو این سانس
                              </button>
                            ) : !entry ? (
                              <button className="slot-request-button" onClick={() => onRequest({ date: selectedDate, courtId: court.id, startTime: slot.startTime, endTime: slot.endTime })}>
                                <MessageCircle size={14} /> درخواست این سانس
                              </button>
                            ) : null}
                            {booking && role === 'owner' && ['pending', 'payment_submitted', 'needs_correction'].includes(booking.status) && (
                              <button className="slot-review-button" onClick={() => onReviewBooking(booking)}><CheckCircle2 size={14} /> بررسی درخواست</button>
                            )}
                            {booking && role === 'player' && (
                              <button className="slot-message-button" onClick={() => onOpenConversation(booking)}><MessageCircle size={14} /> پیام‌ها و جزئیات</button>
                            )}
                            {booking?.status === 'booked' && role === 'owner' && (
                              <button
                                className="slot-cancel-button"
                                onClick={() => {
                                  if (window.confirm(`رزرو ${formatTimeRange(booking.startTime, booking.endTime)} در ${booking.courtName} لغو شود؟`)) onCancel(booking);
                                }}
                                aria-label={`لغو رزرو ${booking.bookedForName}`}
                                title="لغو رزرو"
                              ><Ban size={14} /><span>لغو رزرو</span></button>
                            )}
                          </article>
                        );
                      })}
                    </div>}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="schedule-footnote"><Info size={15} /><span>هر سانس ۱.۵ ساعت است و آخرین بازه از ۲۲:۳۰ تا ۲۴:۰۰ (نیمه‌شب) ادامه دارد. درخواست ابتدا تا ۳۰ دقیقه برای تأیید اولیه قفل می‌شود؛ پس از تأیید اولیه، بازیکن ۱۵ دقیقه برای پرداخت فرصت دارد. بازیکنان دیگر فقط آزاد یا رزرو شده بودن سانس را می‌بینند.</span></div>
    </section>
  );
}
