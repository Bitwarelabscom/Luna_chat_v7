/**
 * Time utility for formatting relative timestamps in memory context.
 * Zero dependencies - prevents circular imports.
 */

/**
 * Format a date as a human-readable relative time string.
 * Examples: "just now", "3 hours ago", "2 days ago", "last week", "3 months ago", "over a year ago"
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '';

  const then = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();

  // Future dates or invalid
  if (diffMs < 0 || isNaN(diffMs)) return '';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return 'last week';
  if (weeks < 4) return `${weeks} weeks ago`;
  if (months === 1) return 'last month';
  if (months < 12) return `${months} months ago`;
  if (years === 1) return 'about a year ago';
  return `over ${years} years ago`;
}
