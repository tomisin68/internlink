/**
 * Relative time, tuned for a feed and a message list.
 *
 * Deliberately not `Intl.RelativeTimeFormat` for the short buckets: "1 minute
 * ago" is three times the width of "1m" in a message timestamp, and in a dense
 * list that width matters more than the extra clarity.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((now - then) / 1000);

  // A clock-skewed future timestamp should read as "now", not "-3m".
  if (seconds < 30) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;

  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Relative time in words, for places where the width is affordable.
 *
 * The terse `relativeTime` above exists because "1 minute ago" is three times
 * the width of "1m" in a dense message list. A notification row is not that
 * list: it is one line of prose already, and "2h" beside it reads like a code.
 * "an hour ago" and "yesterday" are what people say, so they are what this says.
 */
export function longRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((now - then) / 1000);

  // A clock-skewed future timestamp reads as "just now", never as "in -3m".
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24 && isSameDay(then, now)) {
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }

  if (isSameDay(then, now - 86_400_000)) return 'yesterday';

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;

  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * The bucket a notification belongs in — "Today", "Yesterday", "This week"…
 *
 * Grouping is what turns a wall of timestamps into a list you can skim: the
 * question is nearly always "what happened since I last looked", and a header
 * answers it without reading a single row.
 */
export function timeBucket(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Earlier';

  if (isSameDay(then, now)) return 'Today';
  if (isSameDay(then, now - 86_400_000)) return 'Yesterday';

  const days = Math.floor((now - then) / 86_400_000);
  if (days < 7) return 'This week';
  if (days < 30) return 'This month';
  return 'Earlier';
}

/** "Joined March 2025" — the line on a profile header. */
export function monthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

/** Long form for detail views, where the extra characters are affordable. */
export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Day separators in a message thread. */
export function dayLabel(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'short' });
}

/** 1,240 → "1.2k". Used on reaction and application counts. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`.replace('.0', '');
  return `${(value / 1_000_000).toFixed(1)}m`.replace('.0', '');
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
