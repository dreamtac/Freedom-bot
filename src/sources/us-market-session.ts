export type UsMarketSessionKind =
  | "day"
  | "pre"
  | "regular"
  | "after"
  | "closed";

export interface UsMarketSession {
  kind: UsMarketSessionKind;
  label: string;
  timeZone: "Asia/Seoul" | "America/New_York";
  localTime: string;
}

export function getUsMarketSession(now = new Date()): UsMarketSession {
  const korean = getMarketClock(now, "Asia/Seoul");
  if (
    isUsTradingDay(getKoreanTradingDate(now)) &&
    korean.minutes >= 10 * 60 &&
    korean.minutes < 17 * 60
  ) {
    return {
      kind: "day",
      label: "데이장",
      timeZone: "Asia/Seoul",
      localTime: korean.time,
    };
  }

  const eastern = getMarketClock(now, "America/New_York");
  const tradingDate = getUsTradingDate(now);
  if (!isUsTradingDay(tradingDate)) {
    return {
      kind: "closed",
      label: "휴장",
      timeZone: "America/New_York",
      localTime: eastern.time,
    };
  }
  if (eastern.minutes >= 4 * 60 && eastern.minutes < 9 * 60 + 30) {
    return {
      kind: "pre",
      label: "프리장",
      timeZone: "America/New_York",
      localTime: eastern.time,
    };
  }
  const regularClose = isUsEarlyCloseDay(tradingDate) ? 13 * 60 : 16 * 60;
  const afterClose = isUsEarlyCloseDay(tradingDate) ? 17 * 60 : 20 * 60;
  if (eastern.minutes >= 9 * 60 + 30 && eastern.minutes < regularClose) {
    return {
      kind: "regular",
      label: "정규장",
      timeZone: "America/New_York",
      localTime: eastern.time,
    };
  }
  if (eastern.minutes >= regularClose && eastern.minutes < afterClose) {
    return {
      kind: "after",
      label: "애프터장",
      timeZone: "America/New_York",
      localTime: eastern.time,
    };
  }
  return {
    kind: "closed",
    label: "장외",
    timeZone: "America/New_York",
    localTime: eastern.time,
  };
}

function getMarketClock(now: Date, timeZone: UsMarketSession["timeZone"]): {
  weekday: string;
  minutes: number;
  time: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  return {
    weekday: part("weekday"),
    minutes: hour * 60 + minute,
    time: part("hour") + ":" + part("minute"),
  };
}

import {
  getKoreanTradingDate,
  getUsTradingDate,
  isUsEarlyCloseDay,
  isUsTradingDay,
} from "./market-calendar.js";
