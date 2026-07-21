// Dates and times follow the phone: locale decides day/month order, the
// system clock setting decides 12h vs 24h. expo-localization is a native
// module — in bun tests and on web the require fails and en-GB stands in.
let deviceLocale: string | undefined;
let deviceHour12: boolean | undefined;
try {
  const { getLocales, getCalendars } = require('expo-localization');
  deviceLocale = getLocales()[0]?.languageTag;
  const uses24hourClock = getCalendars()[0]?.uses24hourClock;
  if (typeof uses24hourClock === 'boolean') deviceHour12 = !uses24hourClock;
} catch {}
const LOCALE = deviceLocale ?? 'en-GB';

/** 1234567 -> "1.23M", 45300 -> "45.3K", 812 -> "812". */
export function formatCrypto(amount: number): string {
  const value = Math.round(amount);
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString('en-US');
}

/** Always the full number, with thousands separators. */
export function formatExact(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12m ago", "3h ago", "5d ago", then a date. */
export function timeAgo(timestamp: number | null, now: number = Date.now()): string {
  if (timestamp === null) return 'never';
  const diff = now - timestamp;

  if (diff < 0) return 'in the future';
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return formatDate(timestamp);
}

/** "18 Jul" ("Jul 18" in the US) this year, with the year otherwise. */
export function formatDate(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "18 Jul, 19:00" — or "Jul 18, 7:00 PM" on a US 12-hour phone. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
  })}, ${formatTime(timestamp)}`;
}

/** "19:00" — or "7:00 PM" on a 12-hour phone. */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(LOCALE, {
    hour: deviceHour12 === true ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: deviceHour12,
  });
}

/** Shortens a long wallet address for display, keeping both ends. */
export function shortenAddress(address: string, keep = 6): string {
  if (address.length <= keep * 2 + 3) return address;
  return `${address.slice(0, keep)}…${address.slice(-keep)}`;
}

/** "1 target" / "5 targets". */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
