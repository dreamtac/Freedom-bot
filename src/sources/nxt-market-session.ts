export type NxtMarketSessionKind =
  | "pre"
  | "main"
  | "after"
  | "pause"
  | "closed";

export interface NxtMarketSession {
  kind: NxtMarketSessionKind;
  label: string;
  localTime: string;
}

export function getNxtMarketSession(now = new Date()): NxtMarketSession {
  const clock = getKoreanMarketClock(now);
  if (!isKoreanTradingDay(getKoreanTradingDate(now))) {
    return { kind: "closed", label: "NXT 휴장", localTime: clock.time };
  }
  if (clock.seconds >= 8 * 60 * 60 && clock.seconds < 8 * 60 * 60 + 50 * 60) {
    return { kind: "pre", label: "NXT 프리마켓", localTime: clock.time };
  }
  if (
    clock.seconds >= 9 * 60 * 60 + 30 &&
    clock.seconds < 15 * 60 * 60 + 20 * 60
  ) {
    return { kind: "main", label: "NXT 메인마켓", localTime: clock.time };
  }
  if (clock.seconds >= 15 * 60 * 60 + 40 * 60 && clock.seconds < 20 * 60 * 60) {
    return { kind: "after", label: "NXT 애프터마켓", localTime: clock.time };
  }
  if (
    (clock.seconds >= 8 * 60 * 60 + 50 * 60 &&
      clock.seconds < 9 * 60 * 60 + 30) ||
    (clock.seconds >= 15 * 60 * 60 + 20 * 60 &&
      clock.seconds < 15 * 60 * 60 + 40 * 60)
  ) {
    return { kind: "pause", label: "NXT 거래중단", localTime: clock.time };
  }
  return { kind: "closed", label: "NXT 장외", localTime: clock.time };
}

function getKoreanMarketClock(now: Date): {
  weekday: string;
  seconds: number;
  time: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  const second = Number(part("second"));
  return {
    weekday: part("weekday"),
    seconds: hour * 60 * 60 + minute * 60 + second,
    time: `${part("hour")}:${part("minute")}`,
  };
}

import { getKoreanTradingDate, isKoreanTradingDay } from "./market-calendar.js";
