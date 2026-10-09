import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber, todayISO } from './domain';
import {
  getJalaliMonthDays,
  getJalaliMonthStart,
  formatJalaliMonth,
  jalaliMonthGridOffset,
  jalaliParts,
  shiftISODate,
} from './scheduleUtils';

const WEEKDAYS = [
  { label: 'ش', name: 'شنبه' },
  { label: 'ی', name: 'یکشنبه' },
  { label: 'د', name: 'دوشنبه' },
  { label: 'س', name: 'سه‌شنبه' },
  { label: 'چ', name: 'چهارشنبه' },
  { label: 'پ', name: 'پنجشنبه' },
  { label: 'ج', name: 'جمعه' },
];

export function JalaliCalendar({
  value,
  onChange,
  minDate,
  compact = false,
}: {
  value?: string;
  onChange: (date: string) => void;
  minDate?: string;
  compact?: boolean;
}) {
  const [monthStart, setMonthStart] = useState(() => getJalaliMonthStart(value ?? minDate ?? todayISO()));
  const monthDays = getJalaliMonthDays(monthStart);
  const offset = jalaliMonthGridOffset(monthStart);
  const today = todayISO();

  useEffect(() => {
    if (value) setMonthStart(getJalaliMonthStart(value));
  }, [value]);

  function shiftMonth(direction: -1 | 1) {
    const pivot = shiftISODate(monthStart, direction < 0 ? -1 : 35);
    setMonthStart(getJalaliMonthStart(pivot));
  }

  return (
    <div className={`jalali-calendar ${compact ? 'is-compact' : ''}`} dir="rtl">
      <div className="jalali-calendar-heading">
        <button type="button" className="icon-button calendar-month-arrow" onClick={() => shiftMonth(-1)} aria-label="ماه قبل"><ChevronRight size={17} /></button>
        <strong>{formatJalaliMonth(monthStart)}</strong>
        <button type="button" className="icon-button calendar-month-arrow" onClick={() => shiftMonth(1)} aria-label="ماه بعد"><ChevronLeft size={17} /></button>
      </div>
      <div className="jalali-calendar-grid jalali-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday.name} title={weekday.name}>{weekday.label}</span>)}
      </div>
      <div className="jalali-calendar-grid jalali-days">
        {Array.from({ length: offset }, (_, index) => <span className="calendar-empty-day" key={`empty-${monthStart}-${index}`} />)}
        {monthDays.map((date) => {
          const day = jalaliParts(date).day;
          const selected = Boolean(value && date === value);
          const isToday = date === today;
          const disabled = Boolean(minDate && date < minDate);
          return (
            <button
              type="button"
              key={date}
              className={`calendar-day ${selected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
              aria-label={formatJalaliMonth(date) + '، روز ' + formatNumber(day)}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(date)}
            >
              {formatNumber(day)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
