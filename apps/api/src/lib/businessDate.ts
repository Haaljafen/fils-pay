/**
 * The Asia/Bahrain business-day date (YYYY-MM-DD) of an instant. Daily
 * windows use this day (ADR-0003), so a capture after Bahrain midnight counts
 * toward the next day's volume, matching the reporting rebuild.
 */
const bahrainDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bahrain",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function bahrainDateString(instant: Date): string {
  return bahrainDayFormat.format(instant);
}
