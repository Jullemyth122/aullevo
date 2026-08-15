import { MONTH_NAMES_SHORT, MONTH_NAMES_FULL } from "./constants";

/**
 * Parses various date string formats into standard YYYY-MM-DD.
 */
export function parseDateString(str: string): string | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  let normalized = trimmed.toLowerCase();
  let monthIdx = -1;

  for (let i = 0; i < 12; i++) {
    if (
      normalized.includes(MONTH_NAMES_FULL[i]) ||
      normalized.includes(MONTH_NAMES_SHORT[i])
    ) {
      monthIdx = i;
      normalized = normalized
        .replace(MONTH_NAMES_FULL[i], ` ${i + 1} `)
        .replace(MONTH_NAMES_SHORT[i], ` ${i + 1} `);
      break;
    }
  }

  const parts = normalized
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3) return null;

  let year = -1;
  let month = -1;
  let day = -1;

  const yearIdx = parts.findIndex((p) => p >= 1000 && p <= 9999);
  if (yearIdx !== -1) {
    year = parts[yearIdx];
    parts.splice(yearIdx, 1);
  } else {
    const lastPart = parts[parts.length - 1];
    if (lastPart < 100) {
      year = lastPart + (lastPart < 50 ? 2000 : 1900);
      parts.splice(parts.length - 1, 1);
    }
  }

  if (year === -1) return null;

  if (monthIdx !== -1) {
    month = monthIdx + 1;
    day = parts[0];
  } else {
    const [first, second] = parts;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      day = second;
      month = first;
    } else {
      day = first;
      month = second;
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Format a YYYY-MM-DD date to a human readable display format like "November 20, 2003".
 */
export function formatDateForDisplay(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const year = parts[0];
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  if (month >= 1 && month <= 12) {
    return `${monthNames[month - 1]} ${day}, ${year}`;
  }
  return isoDate;
}
