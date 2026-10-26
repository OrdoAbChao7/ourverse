/**
 * Date handling for a Chinese-first product without a date library.
 * Local calendar values are the source of truth for display; ISO strings are
 * used only for ordering and transport.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function isValidDateString(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isValidTimeString(value: string): boolean {
  const match = TIME_RE.exec(value);
  if (!match) return false;
  const [, h, m] = match;
  const hours = Number(h);
  const minutes = Number(m);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
}

export function parseLocalDate(value: string): Date {
  if (!isValidDateString(value)) throw new Error(`无效日期：${value}`);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Builds a Date in the viewer's local timezone from the author-entered values. */
export function toLocalDate(occurredOn: string, occurredTime: string | null): Date {
  const base = parseLocalDate(occurredOn);
  if (occurredTime && isValidTimeString(occurredTime)) {
    const [h, m] = occurredTime.split(':').map(Number) as [number, number];
    base.setHours(h, m, 0, 0);
  } else {
    base.setHours(12, 0, 0, 0);
  }
  return base;
}

export function toIsoTimestamp(occurredOn: string, occurredTime: string | null): string {
  return toLocalDate(occurredOn, occurredTime).toISOString();
}

export function todayDateString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateStringOf(date: Date): string {
  return todayDateString(date);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Whole calendar days between two local dates (DST-safe via UTC normalization). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' && DATE_RE.test(value) ? parseLocalDate(value) : new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateShort(value: string | Date): string {
  const date = typeof value === 'string' && DATE_RE.test(value) ? parseLocalDate(value) : new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatMonth(value: string | Date): string {
  const date = typeof value === 'string' && DATE_RE.test(value) ? parseLocalDate(value) : new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatMonthShort(value: string | Date): string {
  const date = typeof value === 'string' && DATE_RE.test(value) ? parseLocalDate(value) : new Date(value);
  return `${date.getMonth() + 1}月`;
}

export function formatWeekday(value: string | Date): string {
  const date = typeof value === 'string' && DATE_RE.test(value) ? parseLocalDate(value) : new Date(value);
  return WEEKDAYS_ZH[date.getDay()] ?? '';
}

/** 2025年3月14日 · 周五 · 21:30 */
export function formatMemoryDate(occurredOn: string, occurredTime: string | null): string {
  const base = `${formatDate(occurredOn)} · ${formatWeekday(occurredOn)}`;
  return occurredTime ? `${base} · ${occurredTime}` : base;
}

export function formatTime(value: string): string {
  return value.slice(0, 5);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(date)} ${hh}:${mm}`;
}

export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24 && calendarDaysBetween(date, now) === 0) return `${diffHours} 小时前`;
  const days = calendarDaysBetween(date, now);
  if (days === 1) return '昨天';
  if (days > 1 && days < 30) return `${days} 天前`;
  if (days >= 30 && days < 365) return `${Math.floor(days / 30)} 个月前`;
  if (days >= 365) return `${Math.floor(days / 365)} 年前`;
  return formatDate(date);
}

export function monthKeyOf(value: string | Date): string {
  const date = typeof value === 'string' && DATE_RE.test(value) ? parseLocalDate(value) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthKey(key: string): Date {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1);
}

export function formatIsoForFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Human countdown: "3 天 04:12:09" or "04:12:09". */
export function formatCountdown(msRemaining: number): string {
  const clamped = Math.max(0, msRemaining);
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  return days > 0 ? `${days} 天 ${clock}` : clock;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
