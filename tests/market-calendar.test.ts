import { describe, expect, it } from "vitest";

import {
  getPreviousKoreanTradingDate,
  isKoreanTradingDay,
  isUsEarlyCloseDay,
  isUsTradingDay,
} from "../src/sources/market-calendar.js";

describe("market calendar", () => {
  it("주말과 설날을 한국 거래일에서 제외한다", () => {
    expect(isKoreanTradingDay("20260214")).toBe(false);
    expect(isKoreanTradingDay("20260217")).toBe(false);
    expect(isKoreanTradingDay("20260220")).toBe(true);
    expect(isKoreanTradingDay("20261231")).toBe(false);
    expect(getPreviousKoreanTradingDate("20260220")).toBe("20260216");
  });

  it("미국 거래소 휴장일과 조기 폐장일을 구분한다", () => {
    expect(isUsTradingDay("20260703")).toBe(false);
    expect(isUsEarlyCloseDay("20260702")).toBe(true);
    expect(isUsTradingDay("20261127")).toBe(true);
    expect(isUsEarlyCloseDay("20261127")).toBe(true);
    expect(isUsEarlyCloseDay("20261224")).toBe(true);
  });
});
