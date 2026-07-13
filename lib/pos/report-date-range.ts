import { resolveSafeTimeZone } from '@/lib/pos/canonical-transactions';

export type ReportDatePreset =
  | 'today'
  | 'yesterday'
  | 'thisMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'tillDate'
  | 'custom';

export interface ReportDateRange {
  start: string;
  end: string;
}

const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getBusinessDateInTimeZone(timeZone: string | null | undefined, date = new Date()): string {
  const safeTimeZone = resolveSafeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return dateFromParts(year, month, day);
}

export function addDaysToBusinessDate(dateString: string, days: number): string {
  if (!isValidBusinessDate(dateString)) return dateString;

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function getPresetBusinessDateRange(
  preset: ReportDatePreset,
  options: {
    anchorDate?: string;
    minDate?: string;
    timeZone?: string | null;
  }
): ReportDateRange {
  const today = isValidBusinessDate(options.anchorDate || '')
    ? options.anchorDate as string
    : getBusinessDateInTimeZone(options.timeZone);
  const [year, month] = today.split('-').map(Number);

  if (preset === 'today') {
    return { start: today, end: today };
  }

  if (preset === 'yesterday') {
    const yesterday = addDaysToBusinessDate(today, -1);
    return { start: yesterday, end: yesterday };
  }

  if (preset === 'thisMonth') {
    return { start: dateFromParts(year, month, 1), end: today };
  }

  if (preset === 'thisQuarter') {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return { start: dateFromParts(year, quarterStartMonth, 1), end: today };
  }

  if (preset === 'thisYear') {
    return { start: dateFromParts(year, 1, 1), end: today };
  }

  return {
    start: isValidBusinessDate(options.minDate || '') ? options.minDate as string : today,
    end: today,
  };
}

export function isValidBusinessDate(value: string): boolean {
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidBusinessDateRange(startDate: string, endDate: string): boolean {
  if (!isValidBusinessDate(startDate) || !isValidBusinessDate(endDate)) return false;
  return startDate <= endDate;
}
