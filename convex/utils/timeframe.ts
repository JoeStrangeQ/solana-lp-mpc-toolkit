export const MS_1H = 1000 * 60 * 60 * 1;
export const MS_1M = 1000 * 60;
export const MS_1S = 1000;

export function formatLastUpdated(minutesAgo: number): string {
  if (minutesAgo < 1) return "Last updated just now";
  if (minutesAgo === 1) return "Last updated 1 minute ago";
  return `Last updated ${minutesAgo} minutes ago`;
}
