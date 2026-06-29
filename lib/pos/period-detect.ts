import { createHash } from 'crypto';

export type PosPeriodType = 'shift' | 'day' | 'month' | 'year' | 'current' | 'unknown';

export type DetectedPeriod = {
  sourceStoreNumber: string | null;
  periodLabel: string | null;
  periodType: PosPeriodType;
  periodNumber: string | null;
  periodOpen: string | null;
  periodClose: string | null;
  periodHash: string;
};

function cleanText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseDateTime(value: string | null | undefined) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();

  const match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  const [, month, day, rawYear, hour, minute, second, meridiem] = match;
  let normalizedHour = Number(hour);
  if (meridiem?.toUpperCase() === 'PM' && normalizedHour < 12) normalizedHour += 12;
  if (meridiem?.toUpperCase() === 'AM' && normalizedHour === 12) normalizedHour = 0;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const iso = new Date(Number(year), Number(month) - 1, Number(day), normalizedHour, Number(minute), Number(second || '0'));
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

function periodTypeFromLabel(label: string | null): PosPeriodType {
  const normalized = cleanText(label).toLowerCase();
  if (normalized.includes('shift')) return 'shift';
  if (normalized.includes('day')) return 'day';
  if (normalized.includes('month')) return 'month';
  if (normalized.includes('year')) return 'year';
  if (normalized.includes('current')) return 'current';
  return 'unknown';
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cellText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractTableRows(htmlText: string) {
  return [...htmlText.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) => [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) => cellText(cellMatch[1])))
    .filter((row) => row.length > 0);
}

export function createPeriodHash(input: {
  storeId: string;
  sourceSystem: string;
  sourceStoreNumber: string | null;
  periodType: PosPeriodType;
  periodNumber: string | null;
  periodOpen: string | null;
  periodClose: string | null;
}) {
  return createHash('sha256')
    .update([
      input.storeId,
      input.sourceSystem,
      input.sourceStoreNumber || '',
      input.periodType,
      input.periodNumber || '',
      input.periodOpen || '',
      input.periodClose || '',
    ].join('|'))
    .digest('hex');
}

export function detectPeriod(htmlText: string, storeId: string, sourceSystem = 'verifone_commander'): DetectedPeriod {
  let periodType: PosPeriodType = 'unknown';
  let periodNumber: string | null = null;
  let periodOpen: string | null = null;
  let periodClose: string | null = null;
  let storeNumber: string | null = null;
  let periodLabel: string | null = null;

  const scanRows = extractTableRows(htmlText).slice(0, 30);

  for (const row of scanRows) {
    const col0 = (row[0] || '').trim();
    const col2 = (row[2] || '').trim();
    const normalizedCol0 = col0.toLowerCase();

    if (normalizedCol0.includes('store number')) {
      const match = col0.match(/store\s+number[:\s]+(\S+)/i);
      if (match) storeNumber = match[1].trim();
      continue;
    }

    if (normalizedCol0 === 'period') {
      periodLabel = col2 || null;
      periodType = periodTypeFromLabel(periodLabel);

      const numberMatch = col2.match(/[-–]\s*(\d+)\s*$/);
      if (numberMatch) periodNumber = numberMatch[1];
      continue;
    }

    if (normalizedCol0 === 'open period') {
      const parsed = parseDateTime(col2);
      if (parsed) periodOpen = parsed;
      continue;
    }

    if (normalizedCol0 === 'close period') {
      const parsed = parseDateTime(col2);
      if (parsed) periodClose = parsed;
      continue;
    }
  }

  return {
    sourceStoreNumber: storeNumber,
    periodLabel,
    periodType,
    periodNumber,
    periodOpen,
    periodClose,
    periodHash: createPeriodHash({
      storeId,
      sourceSystem,
      sourceStoreNumber: storeNumber,
      periodType,
      periodNumber,
      periodOpen,
      periodClose,
    }),
  };
}
