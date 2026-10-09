export const SLOT_DURATION_MINUTES = 90;

export function timeToMinutes(value: string): number {
  if (value === '24:00') return 24 * 60;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function shiftISODate(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + amount, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const jalaliPartsFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
const jalaliMonthFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'long' });
const jalaliDateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const jalaliWeekdayFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long' });

export function jalaliParts(value: string | Date): { year: number; month: number; day: number } {
  const date = typeof value === 'string'
    ? new Date(`${value.slice(0, 10)}T12:00:00`)
    : value;
  const parts = jalaliPartsFormatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? 0),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? 0),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? 0),
  };
}

export function formatJalaliDate(value: string): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : `${jalaliWeekdayFormatter.format(date)} ${jalaliDateFormatter.format(date)}`;
}

export function getJalaliMonthStart(value: string): string {
  let cursor = value.slice(0, 10);
  const initial = jalaliParts(cursor);
  for (let index = 0; index < 31; index += 1) {
    const previous = shiftISODate(cursor, -1);
    const parts = jalaliParts(previous);
    if (parts.year !== initial.year || parts.month !== initial.month) break;
    cursor = previous;
  }
  return cursor;
}

export function getJalaliMonthDays(monthStart: string): string[] {
  const initial = jalaliParts(monthStart);
  const days: string[] = [];
  let cursor = monthStart;
  for (let index = 0; index < 32; index += 1) {
    const parts = jalaliParts(cursor);
    if (parts.year !== initial.year || parts.month !== initial.month) break;
    days.push(cursor);
    cursor = shiftISODate(cursor, 1);
  }
  return days;
}

export function formatJalaliMonth(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  const parts = jalaliParts(value);
  return `${jalaliMonthFormatter.format(date)} ${formatClock(String(parts.year))}`;
}

export function formatClock(value: string): string {
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  return value.replace(/\d/g, (digit) => persianDigits[Number(digit)]);
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${formatClock(startTime)} تا ${formatClock(endTime)}`;
}

function minutesToTime(value: number): string {
  if (value === 24 * 60) return '24:00';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export const DEFAULT_SESSION_SLOTS = Array.from({ length: 24 * 60 / SLOT_DURATION_MINUTES }, (_, index) => ({
  startTime: minutesToTime(index * SLOT_DURATION_MINUTES),
  endTime: minutesToTime((index + 1) * SLOT_DURATION_MINUTES),
}));

export function getWeeklyDates(startDate: string, endDate: string): string[] {
  if (endDate < startDate) return [];
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = shiftISODate(cursor, 7)) {
    dates.push(cursor);
  }
  return dates;
}

export function makeSlotLockIds(courtId: string, date: string, startTime: string, endTime: string): string[] {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (!date || start < 0 || start % 90 !== 0 || end - start !== 90 || end > 24 * 60) return [];
  // Every allowed reservation is one of the fixed, non-overlapping 90-minute slots.
  return [`${courtId}_${date}_${startTime}`];
}

export function bookingOverlaps(
  first: { startTime: string; endTime: string },
  second: { startTime: string; endTime: string },
): boolean {
  return timeToMinutes(first.startTime) < timeToMinutes(second.endTime)
    && timeToMinutes(second.startTime) < timeToMinutes(first.endTime);
}

export function jalaliMonthGridOffset(monthStart: string): number {
  const date = new Date(`${monthStart}T12:00:00`);
  // JavaScript starts weeks on Sunday; the Jalali calendar starts on Saturday.
  return (date.getDay() + 1) % 7;
}

export function localISODate(date: Date): string {
  return toISODate(date);
}
