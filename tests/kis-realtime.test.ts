import { describe, expect, it } from "vitest";

import {
  parseDomesticTradeMessage,
  parseKrxNightFuturesTradeMessage,
  parseOverseasTradeMessage,
} from "../src/sources/kis-realtime.js";

describe("parseDomesticTradeMessage", () => {
  it("KIS 국내 체결가 WebSocket 메시지에서 현재가와 시가를 읽는다", () => {
    const values = Array<string>(46).fill("");
    values[0] = "005930";
    values[1] = "093001";
    values[2] = "72000";
    values[3] = "2";
    values[4] = "500";
    values[5] = "0.70";
    values[6] = "71800";
    values[7] = "71500";
    values[8] = "72500";
    values[9] = "71000";
    values[10] = "72100";
    values[11] = "72000";
    values[12] = "3";
    values[13] = "1234567";
    values[14] = "100000000";
    const row = values.join("^");

    expect(parseDomesticTradeMessage(`0|H0UNCNT0|001|${row}`)).toEqual([
      {
        code: "005930",
        market: "KRX",
        assetType: "domestic",
        tradeTime: "093001",
        price: 72_000,
        open: 71_500,
        high: 72_500,
        low: 71_000,
        volume: 1_234_567,
        change: 500,
        changeRate: 0.7,
      },
    ]);
  });

  it("다른 형식의 메시지와 시가가 없는 틱은 무시한다", () => {
    expect(parseDomesticTradeMessage("0|PINGPONG|001|anything")).toEqual([]);
    expect(parseDomesticTradeMessage("0|H0UNCNT0|001|005930^093001^72000")).toEqual([]);
  });

  it("NXT 체결가 메시지를 NXT 시장 틱으로 구분한다", () => {
    const values = Array<string>(46).fill("");
    values[0] = "005930";
    values[2] = "72500";
    values[7] = "71500";

    expect(parseDomesticTradeMessage(`0|H0NXCNT0|001|${values.join("^")}`)).toMatchObject([
      { code: "005930", market: "NXT", assetType: "domestic", price: 72_500, open: 71_500 },
    ]);
  });

  it("KIS 미국 주식 체결가 WebSocket 메시지를 읽는다", () => {
    const values = [
      "DNASAAPL", "AAPL", "NAS", "20260720", "20260720", "093001",
      "20260717", "160000", "180.00", "182.00", "179.50", "181.25", "2",
      "1.25", "0.69", "181.24", "181.26", "10", "12", "100", "1234567",
      "223456789", "700000", "534567", "13",
    ];
    expect(parseOverseasTradeMessage("0|HDFSCNT0|001|" + values.join("^"))).toEqual([
      {
        code: "AAPL",
        market: "NAS",
        assetType: "overseas",
        tradeTime: "093001",
        price: 181.25,
        open: 180,
        high: 182,
        low: 179.5,
        volume: 1_234_567,
        change: 1.25,
        changeRate: 0.69,
      },
    ]);
  });

  it("KIS KRX 야간선물 체결가 WebSocket 메시지를 읽는다", () => {
    const values = Array<string>(49).fill("");
    values[0] = "1A01609";
    values[1] = "215900";
    values[2] = "28.75";
    values[3] = "5";
    values[4] = "2.54";
    values[5] = "1103.75";
    values[6] = "1136.55";
    values[7] = "1140.20";
    values[8] = "1099.00";
    values[10] = "8568";

    expect(parseKrxNightFuturesTradeMessage(`0|H0MFCNT0|001|${values.join("^")}`)).toEqual([
      {
        code: "1A01609",
        market: "KRX_NIGHT_FUTURES",
        assetType: "nightFutures",
        tradeTime: "215900",
        price: 1103.75,
        open: 1136.55,
        high: 1140.2,
        low: 1099,
        volume: 8568,
        change: -28.75,
        changeRate: -2.54,
      },
    ]);
  });
});
