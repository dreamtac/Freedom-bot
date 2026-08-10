import Holidays from "date-holidays";

const koreanHolidays = new Holidays("KR");

export function getKoreanTradingDate(now = new Date()): string {
  return formatDateInTimeZone(now, "Asia/Seoul");
}

export function getUsTradingDate(now = new Date()): string {
  return formatDateInTimeZone(now, "America/New_York");
}

export function isKoreanTradingDay(tradingDate: string): boolean {
  const date = parseTradingDate(tradingDate);
  if (
    !date ||
    isWeekend(date) ||
    (date.getUTCMonth() === 11 && date.getUTCDate() === 31)
  ) {
    return false;
  }
  const holidays = koreanHolidays.isHoliday(toKoreanNoon(date));
  return !holidays || holidays.every((holiday) => holiday.type !== "public");
}

export function getPreviousKoreanTradingDate(tradingDate: string): string | undefined {
  const date = parseTradingDate(tradingDate);
  if (!date) {
    return undefined;
  }

  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addUtcDays(date, -offset);
    const candidateDate = formatUtcDate(candidate);
    if (isKoreanTradingDay(candidateDate)) {
      return candidateDate;
    }
  }
  return undefined;
}

export function isUsTradingDay(tradingDate: string): boolean {
  const date = parseTradingDate(tradingDate);
  if (!date || isWeekend(date)) {
    return false;
  }
  return !getUsMarketHolidays(date.getUTCFullYear()).has(tradingDate);
}

export function isUsEarlyCloseDay(tradingDate: string): boolean {
  if (!isUsTradingDay(tradingDate)) {
    return false;
  }
  const date = parseTradingDate(tradingDate);
  if (!date) {
    return false;
  }

  const year = date.getUTCFullYear();
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  const dayAfterThanksgiving = addUtcDays(thanksgiving, 1);
  if (tradingDate === formatUtcDate(dayAfterThanksgiving)) {
    return true;
  }

  if (date.getUTCMonth() === 11 && date.getUTCDate() === 24) {
    return true;
  }

  const independenceHoliday = observedFixedHoliday(year, 6, 4);
  return tradingDate === getPreviousUsTradingDate(independenceHoliday);
}

function getPreviousUsTradingDate(date: Date): string | undefined {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = formatUtcDate(addUtcDays(date, -offset));
    if (isUsTradingDay(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function getUsMarketHolidays(year: number): Set<string> {
  const holidays = [
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    addUtcDays(getEasterSunday(year), -2),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ];

  const previousNewYear = observedFixedHoliday(year + 1, 0, 1);
  if (previousNewYear.getUTCFullYear() === year) {
    holidays.push(previousNewYear);
  }
  return new Set(holidays.map(formatUtcDate));
}

function observedFixedHoliday(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDay() === 6) {
    return addUtcDays(date, -1);
  }
  if (date.getUTCDay() === 0) {
    return addUtcDays(date, 1);
  }
  return date;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (occurrence - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addUtcDays(last, -offset);
}

function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

function parseTradingDate(value: string): Date | undefined {
  if (!/^\d{8}$/.test(value)) {
    return undefined;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return formatUtcDate(date) === value ? date : undefined;
}

function toKoreanNoon(date: Date): Date {
  return new Date(`${formatUtcDate(date).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}T12:00:00+09:00`);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
}

function isWeekend(date: Date): boolean {
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

function formatUtcDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year") ?? ""}${values.get("month") ?? ""}${values.get("day") ?? ""}`;
}
